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

export class LiveWatcher extends EventEmitter {
  private sessionsWatcher: FSWatcher | null = null;
  private sessionsDebounce: NodeJS.Timeout | null = null;
  private metaWatchers = new Map<string, FSWatcher>();
  private convWatchers = new Map<string, ConversationWatchEntry>();
  private knownSessions = new Map<string, BgSession>();
  private alivePoll: NodeJS.Timeout | null = null;

  start(): void {
    this.startSessionsDirWatch();
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

  private async initialScan(): Promise<void> {
    const result = await scanSessions();
    for (const s of result.sessions) {
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
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.json')) continue;
      const filePath = join(dir, entry);
      seen.add(filePath);
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
      if (!seen.has(known)) {
        this.knownSessions.delete(known);
        this.detachMetaWatcher(known);
        changed = true;
      }
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
