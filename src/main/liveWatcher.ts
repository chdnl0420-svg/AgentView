import { watch, type FSWatcher } from 'node:fs';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { EventEmitter } from 'node:events';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  conversationByteSize,
  findFileBySessionId,
  tailConversation
} from './conversationLoader';
import {
  readSessionFromMetaPath,
  scanSessions,
  sessionsDir
} from './sessionScanner';
import type { BgSession, ConversationAppend, ConversationMessage } from '@shared/types';

interface ConversationWatchEntry {
  sessionId: string;
  filePath: string;
  offset: number;
  watcher: FSWatcher;
  debounce: NodeJS.Timeout | null;
}

/**
 * Polls live sessions every N ms so PID liveness changes are picked up
 * even when the meta file doesn't get rewritten.
 */
const ALIVE_POLL_MS = 3000;

/**
 * When a sessions/{pid}.json file disappears, keep its session in the
 * registry for this long before treating the removal as real. The claude
 * daemon respawns workers periodically and during the ~hundreds of ms
 * between old-PID delete and new-PID write the file is genuinely missing
 * — without a grace window, the AgentView grid flickers the card off
 * then back on every respawn.
 */
const REMOVE_GRACE_MS = 6000;

export class LiveWatcher extends EventEmitter {
  private sessionsWatcher: FSWatcher | null = null;
  private sessionsDebounce: NodeJS.Timeout | null = null;
  private metaWatchers = new Map<string, FSWatcher>();
  private convWatchers = new Map<string, ConversationWatchEntry>();
  private knownSessions = new Map<string, BgSession>();
  private firstMissingAt = new Map<string, number>();
  private rosterWatcher: FSWatcher | null = null;
  private rosterDebounce: NodeJS.Timeout | null = null;
  private jobsWatcher: FSWatcher | null = null;
  private alivePoll: NodeJS.Timeout | null = null;

  start(): void {
    this.startSessionsDirWatch();
    this.startRosterWatch();
    this.startJobsWatch();
    this.initialScan();
    this.startAlivePoll();
  }

  stop(): void {
    if (this.sessionsWatcher) {
      try {
        this.sessionsWatcher.close();
      } catch {
        /* ignore */
      }
      this.sessionsWatcher = null;
    }
    if (this.rosterWatcher) {
      try {
        this.rosterWatcher.close();
      } catch {
        /* ignore */
      }
      this.rosterWatcher = null;
    }
    if (this.rosterDebounce) {
      clearTimeout(this.rosterDebounce);
      this.rosterDebounce = null;
    }
    if (this.jobsWatcher) {
      try { this.jobsWatcher.close(); } catch { /* ignore */ }
      this.jobsWatcher = null;
    }
    for (const w of this.metaWatchers.values()) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.metaWatchers.clear();
    for (const entry of this.convWatchers.values()) {
      try {
        entry.watcher.close();
      } catch {
        /* ignore */
      }
      if (entry.debounce) clearTimeout(entry.debounce);
    }
    this.convWatchers.clear();
    if (this.alivePoll) clearInterval(this.alivePoll);
    this.alivePoll = null;
  }

  /**
   * Watch ~/.claude/jobs/ (the dir + each <short>/state.json) so we pick up
   * tempo/state transitions claude writes when a worker flips
   * busy→idle / idle→done. This is the same source `claude agents` reads,
   * so without watching it AgentView would lag behind the CLI for several
   * seconds (until the next alivePoll tick).
   */
  private startJobsWatch(): void {
    const jobsDir = join(userClaudeDir(), 'jobs');
    if (!existsSync(jobsDir)) return;
    try {
      // Watching the parent dir with recursive=true catches both new
      // <short>/ directories appearing and individual state.json file
      // writes inside them. Most Windows filesystems support recursive,
      // but if not we fall back to non-recursive (which still catches
      // dir-level adds).
      const watcher = watch(jobsDir, { recursive: true, persistent: false }, () => {
        if (this.rosterDebounce) clearTimeout(this.rosterDebounce);
        this.rosterDebounce = setTimeout(() => this.emit('sessions-changed'), 250);
      });
      if (this.jobsWatcher) {
        try { this.jobsWatcher.close(); } catch { /* ignore */ }
      }
      this.jobsWatcher = watcher;
    } catch {
      /* recursive may fail on some filesystems; non-fatal */
    }
  }

  /**
   * Watch ~/.claude/daemon/roster.json so card visibility tracks the
   * daemon's own view of live bg workers. Each rewrite (worker spawn,
   * respawn, death) emits a sessions-changed event so the renderer
   * re-pulls and includes any newly-registered sessionId. Without this
   * the only signal we get is the per-PID sessions/{pid}.json file
   * appearing — which is briefly missing during respawn.
   */
  private startRosterWatch(): void {
    const rosterPath = join(userClaudeDir(), 'daemon', 'roster.json');
    try {
      // watch the parent directory rather than the file itself so we still
      // pick up the file appearing for the first time
      this.rosterWatcher = watch(
        dirname(rosterPath),
        { persistent: false },
        (_evt, fname) => {
          if (fname && String(fname) !== basename(rosterPath)) return;
          if (this.rosterDebounce) clearTimeout(this.rosterDebounce);
          this.rosterDebounce = setTimeout(() => this.emit('sessions-changed'), 250);
        }
      );
    } catch {
      this.rosterWatcher = null;
    }
  }

  private async initialScan(): Promise<void> {
    const result = await scanSessions();
    const sd = sessionsDir();
    for (const s of result.sessions) {
      // Only sessions/{pid}.json paths get meta-watched / grace-tracked
      // here. jobs/<short>/state.json entries are covered by the jobs
      // recursive watcher; tracking them in knownSessions would make
      // refreshSessionsDir mistakenly flag them as removed (they are
      // never in `seen`, which only enumerates sessions/).
      if (!s.metaPath || !s.metaPath.startsWith(sd)) continue;
      this.knownSessions.set(s.metaPath, s);
      this.attachMetaWatcher(s.metaPath);
    }
    this.emit('sessions-changed');
  }

  private startSessionsDirWatch(): void {
    const dir = sessionsDir();
    if (!existsSync(dir)) return;
    try {
      this.sessionsWatcher = watch(dir, { persistent: false }, () => {
        if (this.sessionsDebounce) clearTimeout(this.sessionsDebounce);
        this.sessionsDebounce = setTimeout(() => this.refreshSessionsDir(), 180);
      });
    } catch {
      this.sessionsWatcher = null;
    }
  }

  private async refreshSessionsDir(): Promise<void> {
    const dir = sessionsDir();
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    const seen = new Set<string>();
    let changed = false;
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.json')) continue;
      const filePath = join(dir, entry);
      seen.add(filePath);
      // File reappeared — clear any pending grace timer.
      this.firstMissingAt.delete(filePath);
      if (!this.knownSessions.has(filePath)) {
        const s = await readSessionFromMetaPath(filePath);
        if (s) {
          this.knownSessions.set(filePath, s);
          this.attachMetaWatcher(filePath);
          this.emit('session-updated', s);
          changed = true;
        }
      }
    }
    for (const known of Array.from(this.knownSessions.keys())) {
      if (seen.has(known)) continue;
      // First time we noticed this file is gone — start the grace clock and
      // don't remove yet. claude's daemon respawns workers with a new PID,
      // which means the old PID's meta file vanishes for a few hundred ms
      // before being replaced. Removing eagerly causes card flicker.
      const since = this.firstMissingAt.get(known);
      if (!since) {
        this.firstMissingAt.set(known, now);
        continue;
      }
      if (now - since < REMOVE_GRACE_MS) {
        // Still inside the grace window — defer removal.
        continue;
      }
      this.knownSessions.delete(known);
      this.firstMissingAt.delete(known);
      this.detachMetaWatcher(known);
      changed = true;
    }
    if (changed) this.emit('sessions-changed');
  }

  private attachMetaWatcher(filePath: string): void {
    if (this.metaWatchers.has(filePath)) return;
    let debounce: NodeJS.Timeout | null = null;
    try {
      const w = watch(filePath, { persistent: false }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => this.reloadMeta(filePath), 120);
      });
      this.metaWatchers.set(filePath, w);
    } catch {
      /* file might be gone already */
    }
  }

  private detachMetaWatcher(filePath: string): void {
    const w = this.metaWatchers.get(filePath);
    if (w) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
      this.metaWatchers.delete(filePath);
    }
  }

  private async reloadMeta(filePath: string): Promise<void> {
    const s = await readSessionFromMetaPath(filePath);
    if (!s) return;
    const prev = this.knownSessions.get(filePath);
    this.knownSessions.set(filePath, s);
    if (
      !prev ||
      prev.alive !== s.alive ||
      prev.status !== s.status ||
      prev.updatedAt !== s.updatedAt ||
      prev.conversationSize !== s.conversationSize ||
      prev.name !== s.name
    ) {
      this.emit('session-updated', s);
    }
  }

  private startAlivePoll(): void {
    this.alivePoll = setInterval(async () => {
      for (const [path, prev] of Array.from(this.knownSessions.entries())) {
        const fresh = await readSessionFromMetaPath(path);
        if (!fresh) continue;
        if (
          fresh.alive !== prev.alive ||
          fresh.status !== prev.status ||
          fresh.conversationSize !== prev.conversationSize
        ) {
          this.knownSessions.set(path, fresh);
          this.emit('session-updated', fresh);
        }
      }
    }, ALIVE_POLL_MS);
  }

  async watchConversation(sessionId: string): Promise<void> {
    if (this.convWatchers.has(sessionId)) return;
    const filePath = await findFileBySessionId(sessionId);
    if (!filePath) return;
    const offset = await conversationByteSize(filePath);
    const entry: ConversationWatchEntry = {
      sessionId,
      filePath,
      offset,
      watcher: null as unknown as FSWatcher,
      debounce: null
    };

    const fireTail = async () => {
      const cur = this.convWatchers.get(sessionId);
      if (!cur) return;
      try {
        const r = await tailConversation(cur.filePath, cur.offset);
        cur.offset = r.nextOffset;
        if (r.newMessages.length > 0) {
          const append: ConversationAppend = {
            sessionId: cur.sessionId,
            filePath: cur.filePath,
            newMessages: r.newMessages,
            sizeBytes: r.sizeBytes
          };
          this.emit('conversation-appended', append);
        }
      } catch {
        /* file gone or unreadable */
      }
    };

    try {
      // watch directory rather than file directly — atomic writes replace the file
      const dir = dirname(filePath);
      const target = basename(filePath);
      entry.watcher = watch(dir, { persistent: false }, (_evt, fname) => {
        if (fname && String(fname) !== target) return;
        if (entry.debounce) clearTimeout(entry.debounce);
        entry.debounce = setTimeout(fireTail, 80);
      });
    } catch {
      return;
    }
    this.convWatchers.set(sessionId, entry);
    // initial: nothing new (offset = current size), but check in case file already grew
    fireTail();
  }

  unwatchConversation(sessionId: string): void {
    const entry = this.convWatchers.get(sessionId);
    if (!entry) return;
    try {
      entry.watcher.close();
    } catch {
      /* ignore */
    }
    if (entry.debounce) clearTimeout(entry.debounce);
    this.convWatchers.delete(sessionId);
  }

  unwatchAll(): void {
    for (const id of Array.from(this.convWatchers.keys())) this.unwatchConversation(id);
  }
}

// Convenience absolute-path helper for callers
export function userClaudeDir(): string {
  return join(homedir(), '.claude');
}
