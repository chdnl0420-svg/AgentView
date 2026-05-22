// avd PID file — atomic acquire/release with stale-PID recovery.
//
// Both acquirePid and releasePid run inside the sibling lock directory
// `<path>.lock` so happy-path creators, stale-cleanup contenders, and
// the owner's release all serialize on the same primitive. mkdir is
// atomic on POSIX and NTFS, so only one starter holds the lock at a
// time, eliminating the acquire/release interleaving that allowed two
// starters to both observe success in earlier revisions.
//
// acquirePid(path):
//   1. mkdir(<path>.lock) with retries until exclusive.
//   2. Under the lock: read the pid file. If absent / empty / dead →
//      writeFile (truncate-replace) with our pid. If alive → throw.
//   3. rmdir(<path>.lock).
//
// releasePid(path):
//   - mkdir(<path>.lock) (best-effort), unlink the pid file, rmdir.

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    // EPERM = exists but we cannot signal → still considered alive.
    return err.code === 'EPERM';
  }
}

async function readExistingPid(path: string): Promise<number | null> {
  try {
    const body = (await fs.readFile(path, 'utf8')).trim();
    const pid = Number.parseInt(body, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function tryAcquireLockDir(lockPath: string, attempts: number, waitMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.mkdir(lockPath);
      return true;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw err;
      // Brief backoff so the holder can finish.
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return false;
}

export async function acquirePid(path: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const acquired = await tryAcquireLockDir(lockPath, 20, 100);
  if (!acquired) {
    throw new Error(`avd: lock contention on ${lockPath} — another starter is racing`);
  }
  try {
    const existing = await readExistingPid(path);
    if (existing !== null && isPidAlive(existing)) {
      throw new Error(
        `avd: another instance already running (pid ${existing}, file ${path})`
      );
    }
    // Absent / corrupt / dead — write our pid (truncate-replace is fine
    // because we hold the lock exclusively).
    await fs.writeFile(path, `${process.pid}\n`, { encoding: 'utf8' });
  } finally {
    await fs.rmdir(lockPath).catch(() => {});
  }
}

export async function releasePid(path: string): Promise<void> {
  const lockPath = `${path}.lock`;
  const acquired = await tryAcquireLockDir(lockPath, 20, 100);
  if (!acquired) {
    // Could not enter the mutex. Refuse to delete — better to leak the
    // pid file than to delete one a concurrent acquirer just wrote.
    // The eventual restart will see a stale file (our pid is gone) and
    // overwrite it safely under its own lock.
    return;
  }
  try {
    // Ownership check — only unlink if the file still names *us*. This
    // is the second safety net: if some racing party replaced our file
    // before we got the lock, we will not delete their pid.
    const existing = await readExistingPid(path);
    if (existing === process.pid) {
      await fs.unlink(path).catch(() => {});
    }
  } finally {
    await fs.rmdir(lockPath).catch(() => {});
  }
}
