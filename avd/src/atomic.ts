// Atomic JSON read/write — temp file + rename.
// rename() is atomic on POSIX and on NTFS (MoveFileEx with REPLACE
// flag). Parallel writers serialize through an in-process queue plus a
// lock directory next to the target file, so separate AVD processes also
// reload and write catalog/roster state one at a time.

import { promises as fs } from 'node:fs';
import { dirname, basename } from 'node:path';

const inflight = new Map<string, Promise<unknown>>();
const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 60_000;

async function withProcessQueue<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = inflight.get(path) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  // Compose the tail promise once and remember it by identity so the
  // cleanup branch below can detect "I am the last writer" and free
  // the map entry. Comparing against `gate` here was a bug — the map
  // never matched and entries leaked.
  const tail = prev.then(() => gate);
  inflight.set(path, tail);
  try {
    await prev; // wait our turn
    return await fn();
  } finally {
    release();
    if (inflight.get(path) === tail) inflight.delete(path);
  }
}

async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  return withProcessQueue(path, async () => {
    const releaseDiskLock = await acquireDiskLock(path);
    try {
      return await fn();
    } finally {
      await releaseDiskLock();
    }
  });
}

async function acquireDiskLock(path: string): Promise<() => Promise<void>> {
  const lockDir = `${path}.lock`;
  const startedAt = Date.now();
  await fs.mkdir(dirname(lockDir), { recursive: true });

  for (;;) {
    try {
      await fs.mkdir(lockDir);
      await fs.writeFile(`${lockDir}/owner.json`, JSON.stringify({
        pid: process.pid,
        acquiredAt: Date.now(),
      }), 'utf8');
      return async () => {
        await fs.rm(lockDir, { recursive: true, force: true });
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      await removeStaleLock(lockDir).catch(() => { /* another process owns it */ });
      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        throw new Error(`atomic: timed out acquiring lock for ${path}`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

async function removeStaleLock(lockDir: string): Promise<void> {
  const stat = await fs.stat(lockDir);
  if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
    await fs.rm(lockDir, { recursive: true, force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exposed so catalog/roster can run reload→check→write as one transaction. */
export function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  return withLock(path, fn);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await withLock(path, async () => {
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const body = JSON.stringify(value, null, 2);
    try {
      await fs.writeFile(tmp, body, 'utf8');
      await fs.rename(tmp, path);
    } catch (err) {
      // Best-effort cleanup so failed writes do not litter the directory
      // with `*.tmp.*` files.
      await fs.unlink(tmp).catch(() => { /* ignore */ });
      throw err;
    }
  });
}

export async function readJson<T = unknown>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Exported for tests / observability — not part of the contract.
export function _basename(path: string): string { return basename(path); }
