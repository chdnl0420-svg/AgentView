// Atomic JSON read/write — temp file + rename.
// rename() is atomic on POSIX and on NTFS (MoveFileEx with REPLACE
// flag). Parallel writers serialize through the per-path mutex below
// so the *last* completed write wins and partial state is never on
// disk under the canonical name.

import { promises as fs } from 'node:fs';
import { dirname, basename } from 'node:path';

const inflight = new Map<string, Promise<unknown>>();

async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
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
