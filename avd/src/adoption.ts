// Adoption — on daemon boot, walk the roster and clean up workers whose
// pid is no longer alive (or, since chunk-5b, has been reused by an
// unrelated process). Live workers whose identity still matches the
// roster entry are left in place.
//
// chunk-5 scope: dead-only cleanup via process.kill(pid, 0).
// chunk-5b scope: optional zombie detection via OS process-info — if
//   isAlive=true AND the on-OS startTime drifts beyond
//   ZOMBIE_STARTTIME_THRESHOLD_MS from roster.startedAt, treat as a
//   zombie (PID reuse) and clean up. processInfo helpers may return
//   null (or throw) on platforms we don't yet cover (Windows) or under
//   transient OS errors — we conservatively keep the entry in that case
//   so adoption never *removes* a row without evidence.

import type { Catalog } from './catalog.js';
import type { Roster, WorkerEntry } from './roster.js';
import { getProcessInfo, type ProcessInfo } from './process-info.js';
import { isProcessAlive } from './workers/claude.js';

/** Beyond this drift, the OS-reported startTime cannot belong to the
 *  process roster.json says we spawned. 60s comfortably covers any
 *  jitter between roster.startedAt (Date.now()) and the kernel's view. */
const ZOMBIE_STARTTIME_THRESHOLD_MS = 60_000;

export interface AdoptLiveOptions {
  roster: Roster;
  catalog: Catalog;
  /** Override for tests. Defaults to `isProcessAlive` (process.kill(pid, 0)). */
  isAlive?: (pid: number) => boolean;
  /** OS-level identity check. Defaults to `getProcessInfo` (Linux/macOS
   *  return startTime; Windows returns null → keep, same as chunk-5).
   *  Tests pass an explicit function (or `null` to disable). */
  processInfo?: ((pid: number) => Promise<ProcessInfo | null>) | null;
}

export interface AdoptLiveResult {
  /** Entries left in place because their pid is still alive AND identity matches. */
  kept: WorkerEntry[];
  /** Entries removed (dead pid OR zombie via startTime drift). */
  cleaned: WorkerEntry[];
}

async function isZombie(
  entry: WorkerEntry,
  processInfo?: (pid: number) => Promise<ProcessInfo | null>
): Promise<boolean> {
  if (!processInfo) return false;
  let info: ProcessInfo | null;
  try {
    info = await processInfo(entry.pid);
  } catch {
    // OS lookup failed — be conservative and keep the entry.
    return false;
  }
  if (!info) return false;
  const drift = Math.abs(info.startTime - entry.startedAt);
  return drift > ZOMBIE_STARTTIME_THRESHOLD_MS;
}

export async function adoptLive(opts: AdoptLiveOptions): Promise<AdoptLiveResult> {
  const isAlive = opts.isAlive ?? isProcessAlive;
  // Default to the real OS helper — production daemons must run zombie
  // detection. Pass `processInfo: null` to disable (e.g. in legacy tests).
  const processInfo = opts.processInfo === null
    ? undefined
    : (opts.processInfo ?? getProcessInfo);
  const kept: WorkerEntry[] = [];
  const cleaned: WorkerEntry[] = [];
  for (const entry of opts.roster.list()) {
    const alive = isAlive(entry.pid);
    let shouldClean = !alive;
    if (alive && (await isZombie(entry, processInfo))) {
      shouldClean = true;
    }
    if (!shouldClean) {
      kept.push(entry);
      continue;
    }
    // Catalog first so a failed write does not leave a roster row pointing
    // at a pid we already forgot about. `updateIfExists` re-reads the live
    // catalog inside its own lock so a stale in-memory snapshot can't
    // bypass the update.
    await opts.catalog.updateIfExists(entry.sessionId, { status: 'crashed' });
    await opts.roster.unregister(entry.sessionId);
    cleaned.push(entry);
  }
  return { kept, cleaned };
}
