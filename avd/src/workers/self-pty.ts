// Production self-PTY spawner for ExternalClaudeAdapter's fallback path.
// Mirrors the proven Strategy B in src/main/sessionRunner.ts so AVD can
// bring a claude worker up without depending on the external
// `claude agents` supervisor — the same supervisor AVD was created to
// replace. Without this, a missing supervisor (the common shape on CLI
// versions whose `--headless` entry point does not exist) leaves every
// new session stuck at "boot" because dispatch files pile up in
// ~/.claude/daemon/dispatch/ with no one to process them.

import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { WorkerHandle, WorkerSendOptions } from './index.js';
import type { WorkerAdapterRequest } from './adapter.js';
import type { SelfPtySpawn } from './external-claude.js';

const isWindows = platform() === 'win32';

function defaultResolveClaudeExe(): string {
  if (isWindows) {
    const candidates = [
      join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
      join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      join(homedir(), 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
    ];
    for (const c of candidates) if (existsSync(c)) return c;
    return 'claude.cmd';
  }
  return 'claude';
}

// Claude CLI maps cwd into `~/.claude/projects/<slug>` by replacing
// path separators and the Windows drive colon with '-'. Mirrored here
// so the catalog can persist conversationPath before the jsonl exists.
// Example: 'D:\\Project\\VisualAgents' → 'D--Project-VisualAgents'.
function pathSlug(cwd: string): string {
  return cwd.replace(/[/\\:]/g, '-');
}

function conversationPathFor(sessionId: string, cwd: string): string {
  return join(homedir(), '.claude', 'projects', pathSlug(cwd), `${sessionId}.jsonl`);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface SelfPtyOptions {
  /** Resolve the claude executable. Override for tests. */
  resolveExe?: () => string;
  /** node-pty spawn function. Override for tests. */
  spawn?: typeof pty.spawn;
}

/** Build the production claude-CLI args from a WorkerAdapterRequest. Exposed for tests. */
export function buildSelfPtyArgs(request: WorkerAdapterRequest): string[] {
  const args: string[] = ['--session-id', request.sessionId];
  if (request.agent) args.push('--agent', request.agent);
  if (request.model) args.push('--model', request.model);
  if (request.name) args.push('--name', request.name);
  const permMode = (request.permissionMode ?? 'bypassPermissions').trim() || 'bypassPermissions';
  args.push('--permission-mode', permMode);
  const prompt = request.prompt ?? '';
  // Positional prompt MUST come last so commander parses all flags first.
  if (prompt.trim()) args.push(prompt);
  return args;
}

/**
 * Build a SelfPtySpawn that PTY-spawns the real claude CLI. Wire this
 * into createWorkerFactory({ externalClaudeOptions: { selfPtySpawn: ... } }).
 */
export function createSelfPtySpawn(options: SelfPtyOptions = {}): SelfPtySpawn {
  const resolveExe = options.resolveExe ?? defaultResolveClaudeExe;
  const spawnFn = options.spawn ?? pty.spawn;
  return async (request: WorkerAdapterRequest): Promise<WorkerHandle> => {
    const exe = resolveExe();
    const args = buildSelfPtyArgs(request);

    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    env.PYTHONIOENCODING = 'utf-8';
    env.FORCE_COLOR = '0';
    delete env.CI;

    const cwd = request.cwd && request.cwd.trim() ? request.cwd : process.cwd();
    const p: IPty = spawnFn(exe, args, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd,
      env,
      useConpty: true,
      encoding: 'utf8',
    });

    return {
      sessionId: request.sessionId,
      pid: p.pid,
      conversationPath: conversationPathFor(request.sessionId, cwd),
      isAlive: () => isProcessAlive(p.pid),
      stop: async () => {
        try { p.kill(); } catch { /* already dead */ }
      },
      send: async (followUp: string, _opts?: WorkerSendOptions) => {
        if (!isProcessAlive(p.pid)) throw new Error('WORKER_DEAD');
        try {
          p.write(followUp + '\r');
        } catch (err) {
          throw new Error(`WRITE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    };
  };
}
