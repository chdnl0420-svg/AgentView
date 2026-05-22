// Adoption — on daemon boot, walk the roster and clean up workers whose
// pid is no longer alive. Live workers are left untouched.
//
// chunk-5 scope: dead-only cleanup via process.kill(pid, 0). PID-reuse
// (zombie) detection — OS-level start-time / cmdline match — is deferred
// to chunk-5b. `isAlive` is injected so tests stay deterministic without
// having to spawn / kill real processes.

import type { Catalog } from './catalog.js';
import type { Roster, WorkerEntry } from './roster.js';
import { isProcessAlive } from './workers/claude.js';

export interface AdoptLiveOptions {
  roster: Roster;
  catalog: Catalog;
  /** Override for tests. Defaults to `isProcessAlive` (process.kill(pid, 0)). */
  isAlive?: (pid: number) => boolean;
}

export interface AdoptLiveResult {
  /** Entries left in place because their pid is still alive. */
  kept: WorkerEntry[];
  /** Entries removed because their pid is not alive. */
  cleaned: WorkerEntry[];
}

export async function adoptLive(opts: AdoptLiveOptions): Promise<AdoptLiveResult> {
  const isAlive = opts.isAlive ?? isProcessAlive;
  const kept: WorkerEntry[] = [];
  const cleaned: WorkerEntry[] = [];
  for (const entry of opts.roster.list()) {
    if (isAlive(entry.pid)) {
      kept.push(entry);
      continue;
    }
    // Catalog first so a failed write does not leave a roster row pointing
    // at a pid we already forgot about. `updateIfExists` re-reads the live
    // catalog inside its own lock — that protects against stale in-memory
    // state from another Catalog instance on the same file.
    await opts.catalog.updateIfExists(entry.sessionId, { status: 'crashed' });
    await opts.roster.unregister(entry.sessionId);
    cleaned.push(entry);
  }
  return { kept, cleaned };
}
