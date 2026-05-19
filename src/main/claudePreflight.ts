// Claude Code preflight + bootstrap. Answers two questions:
//   1. Is the `claude` CLI installed and reachable on PATH or in the
//      expected npm-global location?
//   2. Is the bg daemon supervisor running so kind:"bg" worker dispatch
//      can succeed?
//
// Both checks are cheap enough to run on app launch AND before every
// `startNewSession` / `sendMessage` so the UI can react ("Claude Code 를
// 깨우는 중…") instead of staring at an unchanging screen for ~10s while
// the daemon poll loops do nothing.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const isWindows = platform() === 'win32';
const ROSTER_PATH = join(homedir(), '.claude', 'daemon', 'roster.json');

export interface ClaudeStatus {
  /** Path to the claude executable we found, or null if unreachable. */
  cliPath: string | null;
  /** Version string from `claude --version`, or null on failure. */
  cliVersion: string | null;
  /** roster.json parses and supervisorPid is alive. */
  daemonAlive: boolean;
  /** Last-known supervisor pid (even if dead — informational). */
  supervisorPid: number | null;
  /** When we last refreshed this snapshot. */
  checkedAt: number;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    return err.code === 'EPERM';
  }
}

/**
 * Resolve the `claude` binary. Mirrors sessionRunner.resolveClaudeExe but
 * also returns null when nothing exists so callers can show an install
 * banner. We probe a few well-known npm-global locations on Windows
 * (npm 8 vs npm 10 differ) and fall back to PATH.
 */
export function resolveClaudeCli(): string | null {
  if (isWindows) {
    const candidates = [
      join(
        homedir(),
        'AppData',
        'Roaming',
        'npm',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'bin',
        'claude.exe'
      ),
      join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      join(homedir(), 'AppData', 'Local', 'Programs', 'claude', 'claude.exe')
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    // PATH probe via where.exe (synchronous, ~10ms when found).
    try {
      const r = spawnSync('where', ['claude'], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout) {
        const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        if (first && existsSync(first)) return first;
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  // POSIX
  try {
    const r = spawnSync('which', ['claude'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout) {
      const p = r.stdout.trim();
      if (p && existsSync(p)) return p;
    }
  } catch {
    /* ignore */
  }
  return null;
}

let cachedStatus: ClaudeStatus | null = null;
const STATUS_CACHE_MS = 4000;

export async function checkClaudeStatus(force = false): Promise<ClaudeStatus> {
  if (!force && cachedStatus && Date.now() - cachedStatus.checkedAt < STATUS_CACHE_MS) {
    return cachedStatus;
  }
  const cliPath = resolveClaudeCli();
  let cliVersion: string | null = null;
  if (cliPath) {
    // 1.5s budget — spawnSync blocks the main process, but --version is fast.
    try {
      const r = spawnSync(cliPath, ['--version'], { encoding: 'utf8', timeout: 1500 });
      if (r.status === 0 && r.stdout) {
        cliVersion = r.stdout.trim().split(/\r?\n/)[0];
      }
    } catch {
      /* keep null */
    }
  }

  let supervisorPid: number | null = null;
  let daemonAlive = false;
  try {
    const raw = await fs.readFile(ROSTER_PATH, 'utf8');
    const data = JSON.parse(raw) as { supervisorPid?: number };
    if (typeof data.supervisorPid === 'number') {
      supervisorPid = data.supervisorPid;
      daemonAlive = isPidAlive(data.supervisorPid);
    }
  } catch {
    /* roster missing or unreadable */
  }

  cachedStatus = { cliPath, cliVersion, daemonAlive, supervisorPid, checkedAt: Date.now() };
  return cachedStatus;
}

/**
 * Bootstrap the bg daemon if it's down. We spawn `claude agents --headless`
 * detached — claude exposes this entrypoint to ensure the supervisor is up
 * without taking over the user's terminal. If that subcommand isn't
 * available on the installed CLI, we fall back to a no-op so dispatch
 * skips straight to Strategy B (direct PTY spawn) and the user still gets
 * a working chat.
 */
let bootstrapInFlight: Promise<boolean> | null = null;
export async function ensureDaemonRunning(): Promise<boolean> {
  const status = await checkClaudeStatus();
  if (!status.cliPath) return false;
  if (status.daemonAlive) return true;
  if (bootstrapInFlight) return bootstrapInFlight;

  bootstrapInFlight = (async () => {
    try {
      // Detached spawn so the supervisor outlives AgentView. windowsHide
      // suppresses the console window. We pass a known-safe subcommand —
      // `agents --headless` boots the supervisor and exits the front-end.
      const child = spawn(status.cliPath!, ['agents', '--headless'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.on('error', (err) => {
        console.warn('[preflight] daemon bootstrap spawn failed:', err.message);
      });
      child.unref();
    } catch (err) {
      console.warn('[preflight] daemon bootstrap exception:', err);
      bootstrapInFlight = null;
      return false;
    }
    // Poll roster.json for up to 2.5s for the supervisor to register.
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const fresh = await checkClaudeStatus(true);
      if (fresh.daemonAlive) {
        bootstrapInFlight = null;
        return true;
      }
    }
    bootstrapInFlight = null;
    return false;
  })();
  return bootstrapInFlight;
}

export function invalidateStatusCache(): void {
  cachedStatus = null;
}
