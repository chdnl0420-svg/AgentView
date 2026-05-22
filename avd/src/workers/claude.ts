// Claude worker — chunk-3 ships a fake-worker primitive so the
// daemon's spawn/track/kill pipeline can be exercised without
// requiring the real `claude` CLI to be installed.
//
// The real claude CLI integration arrives in chunk-4 (PTY mirroring +
// conversation JSONL tail). At that point ClaudeAdapter (chunk-6)
// will reuse spawnFakeWorker's lifecycle plumbing.

import { spawn, type ChildProcess } from 'node:child_process';

export interface FakeWorkerOptions {
  sessionId: string;
  /** How long the child should pretend to be busy. */
  sleepMs?: number;
}

export interface FakeWorkerHandle {
  sessionId: string;
  pid: number;
  child: ChildProcess;
  /** Resolves once the child has actually exited. */
  exited: Promise<void>;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    return err.code === 'EPERM';
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export async function spawnFakeWorker(opts: FakeWorkerOptions): Promise<FakeWorkerHandle> {
  const sleepMs = opts.sleepMs ?? 60_000;
  const script = `setTimeout(()=>{},${sleepMs});`;
  // stdio:'ignore' — fake worker has no output we consume in chunk-3.
  // Piping would back-pressure the child if the test reader never
  // drains, and there is no test contract that depends on its stdout.
  const child = spawn(process.execPath, ['-e', script], {
    stdio: 'ignore',
    detached: false,
    windowsHide: true,
  });
  if (!child.pid) {
    throw new Error('avd: failed to spawn fake worker (no pid)');
  }
  const exited = new Promise<void>((resolve) => {
    if (hasExited(child)) { resolve(); return; }
    child.once('exit', () => resolve());
  });
  // The child emits 'error' if the executable could not start; rely on
  // pid check above for the common case but also resolve `exited` so
  // callers do not hang.
  child.on('error', () => { /* exit will fire too */ });
  return { sessionId: opts.sessionId, pid: child.pid, child, exited };
}

export async function killWorker(handle: FakeWorkerHandle): Promise<void> {
  if (hasExited(handle.child)) {
    // Already gone — make sure exited resolves before we return.
    await handle.exited;
    return;
  }
  try { handle.child.kill(); } catch { /* ignore */ }
  let forced = false;
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (!hasExited(handle.child)) {
        forced = true;
        try { handle.child.kill('SIGKILL'); } catch { /* ignore */ }
      }
      resolve();
    }, 1000);
  });
  await Promise.race([handle.exited, timeout]);
  if (forced) await handle.exited; // ensure exit observable after SIGKILL
}
