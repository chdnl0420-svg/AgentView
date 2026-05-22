// Codex worker stub — chunk-5b prep for chunk-7's full Codex adapter.
//
// Reuses the fake-claude spawn pattern but normalizes sessionId to a
// 'codex:' prefix so catalog/roster rows can be identified by backend
// without an extra lookup. chunk-7 will replace the node-echo body with
// a real `codex` CLI subprocess + JSONL stream parser.

import { spawn, type ChildProcess } from 'node:child_process';

export interface CodexStubOptions {
  sessionId: string;
  /** How long the stub child should pretend to be busy. */
  sleepMs?: number;
}

export interface CodexStubHandle {
  /** Normalized to start with 'codex:'. */
  sessionId: string;
  pid: number;
  child: ChildProcess;
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

function normalizeSessionId(raw: string): string {
  if (raw.startsWith('codex:')) return raw;
  return `codex:${raw}`;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export async function spawnCodexStub(opts: CodexStubOptions): Promise<CodexStubHandle> {
  const sessionId = normalizeSessionId(opts.sessionId);
  const sleepMs = opts.sleepMs ?? 60_000;
  const script = `setTimeout(()=>{},${sleepMs});`;
  const child = spawn(process.execPath, ['-e', script], {
    stdio: 'ignore',
    detached: false,
    windowsHide: true,
  });
  if (!child.pid) throw new Error('avd: failed to spawn codex stub (no pid)');
  const exited = new Promise<void>((resolve) => {
    if (hasExited(child)) { resolve(); return; }
    child.once('exit', () => resolve());
  });
  child.on('error', () => { /* exit will also fire */ });
  return { sessionId, pid: child.pid, child, exited };
}

export async function killCodexStub(handle: CodexStubHandle): Promise<void> {
  if (hasExited(handle.child)) {
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
  if (forced) await handle.exited;
}
