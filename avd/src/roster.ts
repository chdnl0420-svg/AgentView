// Worker roster — live (pid-backed) workers the daemon is currently
// running. Persisted to roster.json so a daemon restart can attempt
// adoption (chunk-5). Two invariants:
//   - one live worker per sessionId
//   - one sessionId per pid
// Both are enforced inside withFileLock so a fresh-read sees the
// on-disk truth (defeating "two Roster.open()" stale-state races).

import { readJson, withFileLock } from './atomic.js';
import type { BackendKind } from './catalog.js';
import { _writeFileUnlocked as writeFileUnlocked } from './catalog.js';

const BACKENDS: ReadonlySet<BackendKind> = new Set([
  'claude', 'external-claude', 'codex',
] as const);

export interface WorkerEntry {
  sessionId: string;
  pid: number;
  backend: BackendKind;
  startedAt: number;
}

interface RosterFile {
  version: 1;
  workers: Record<string, WorkerEntry>;
}

const EMPTY: RosterFile = { version: 1, workers: {} };

function isWorkerEntry(value: unknown): value is WorkerEntry {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === 'string' &&
    typeof r.pid === 'number' && Number.isInteger(r.pid) && r.pid > 0 &&
    typeof r.backend === 'string' && BACKENDS.has(r.backend as BackendKind) &&
    typeof r.startedAt === 'number'
  );
}

function isRosterFile(value: unknown): value is RosterFile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (!v.workers || typeof v.workers !== 'object') return false;
  for (const w of Object.values(v.workers as Record<string, unknown>)) {
    if (!isWorkerEntry(w)) return false;
  }
  return true;
}

function cloneEntry(e: WorkerEntry): WorkerEntry {
  return { ...e };
}

export class Roster {
  private constructor(private readonly path: string, private state: RosterFile) {}

  static async open(path: string): Promise<Roster> {
    const existing = await readJson<unknown>(path);
    const state: RosterFile = isRosterFile(existing) ? existing : { ...EMPTY, workers: {} };
    return new Roster(path, state);
  }

  async register(entry: Omit<WorkerEntry, 'startedAt'> & { startedAt?: number }): Promise<void> {
    if (!entry || typeof entry !== 'object') {
      throw new Error('roster: entry must be an object');
    }
    if (typeof entry.sessionId !== 'string' || entry.sessionId.length === 0) {
      throw new Error('roster: sessionId must be a non-empty string');
    }
    if (typeof entry.pid !== 'number' || !Number.isInteger(entry.pid) || entry.pid <= 0) {
      throw new Error(`roster: pid must be a positive integer (got ${String(entry.pid)})`);
    }
    if (typeof entry.backend !== 'string' || !BACKENDS.has(entry.backend)) {
      throw new Error(`roster: unknown backend ${String(entry.backend)}`);
    }
    if (entry.startedAt !== undefined && (typeof entry.startedAt !== 'number' || !Number.isFinite(entry.startedAt))) {
      throw new Error('roster: startedAt must be a finite number when provided');
    }
    await withFileLock(this.path, async () => {
      // Re-read on-disk truth so a stale in-memory copy from another
      // Roster instance does not bypass the uniqueness checks.
      const live = await readJson<unknown>(this.path);
      const liveState: RosterFile = isRosterFile(live) ? live : { ...EMPTY, workers: {} };
      if (liveState.workers[entry.sessionId]) {
        throw new Error(`roster: sessionId ${entry.sessionId} already has a live worker`);
      }
      for (const w of Object.values(liveState.workers)) {
        if (w.pid === entry.pid) {
          throw new Error(`roster: pid ${entry.pid} already registered to ${w.sessionId}`);
        }
      }
      const next: RosterFile = {
        version: 1,
        workers: {
          ...liveState.workers,
          [entry.sessionId]: {
            sessionId: entry.sessionId,
            pid: entry.pid,
            backend: entry.backend,
            startedAt: entry.startedAt ?? Date.now(),
          },
        },
      };
      await writeFileUnlocked(this.path, next);
      this.state = next;
    });
  }

  async unregister(sessionId: string): Promise<void> {
    await withFileLock(this.path, async () => {
      const live = await readJson<unknown>(this.path);
      const liveState: RosterFile = isRosterFile(live) ? live : { ...EMPTY, workers: {} };
      if (!liveState.workers[sessionId]) {
        // Already gone — keep in-memory aligned and return.
        this.state = liveState;
        return;
      }
      const { [sessionId]: _gone, ...rest } = liveState.workers;
      const next: RosterFile = { version: 1, workers: rest };
      await writeFileUnlocked(this.path, next);
      this.state = next;
    });
  }

  /** Defensive copy — external mutation must not affect internal state. */
  forSession(sessionId: string): WorkerEntry | null {
    const cur = this.state.workers[sessionId];
    return cur ? cloneEntry(cur) : null;
  }

  list(): WorkerEntry[] {
    return Object.values(this.state.workers).map(cloneEntry);
  }
}
