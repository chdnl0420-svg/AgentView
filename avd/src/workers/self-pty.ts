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
  // 기본을 'default' 로. 이전엔 'bypassPermissions' 였지만 최신 claude CLI 는
  // 그 모드 boot 시 경고 배너 → Enter 대기로 막혀서 사용자가 "작업 중" 으로만
  // 표시되는 좀비를 봤음.
  const permMode = (request.permissionMode ?? 'default').trim() || 'default';
  args.push('--permission-mode', permMode);
  // NOTE: prompt 는 positional 로 넘기지 않는다. legacy sessionRunner 와
  // 같이 PTY 가 READY_MARKER 를 보낸 뒤 키스트로크로 prompt 를 입력하고 \r 로
  // 제출함. positional 로 넘기고 또 keystroke 로 deliver 하면 prompt 가
  // 두 번 입력돼 claude 가 두 번째 입력을 별도 메시지로 본다.
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

    // ── Initial prompt delivery state machine ──────────────────────────────
    // claude TUI 는 spawn 시 positional prompt 가 있어도 자동 submit 하지
    // 않는다. legacy sessionRunner 처럼 PTY 출력에서 boot markers 를 감지하고
    // 키스트로크로 prompt + Enter 를 전송해야 함. 누락 시 claude 가 살아있는
    // 채로 입력 대기하며 jsonl 생성도 안 되어 사용자 입장에선 "작업 중" 으로만
    // 무한 표시됨.
    const ANSI_STRIP = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\]0;[^\x07]*\x07|\x1b[\(\)][A-Z0-9]|\x1b[=>]|\r/g;
    const TRUST_MARKER = /trust this folder/i;
    // claude TUI 가 입력 받을 준비됐을 때 출력되는 보조 문구들
    const READY_MARKER =
      /How can I help|Tips for getting started|to interrupt|\/effort|to cycle|auto mode on|shift\+tab|Welcome back|Run \/init|Try ".+"/i;
    const FALLBACK_DELIVER_MS = 12_000;

    const initialPrompt =
      typeof request.prompt === 'string' && request.prompt.trim()
        ? request.prompt
        : '';
    let pendingPrompt: string | null = initialPrompt || null;
    let promptDelivered = !initialPrompt;
    let trustHandled = false;
    let outputBuf = '';

    function deliverPrompt(): void {
      if (!pendingPrompt) return;
      const lines = pendingPrompt.split(/\r?\n/);
      pendingPrompt = null;
      promptDelivered = true;
      const writeNext = (i: number): void => {
        if (i >= lines.length) {
          setTimeout(() => {
            try { p.write('\r'); } catch { /* gone */ }
          }, 80);
          return;
        }
        try {
          p.write(lines[i]!);
          if (i < lines.length - 1) p.write('\n');
        } catch {
          return;
        }
        setTimeout(() => writeNext(i + 1), 40);
      };
      writeNext(0);
    }

    if (initialPrompt) {
      const dataSub = p.onData((chunk) => {
        const cleaned = chunk.replace(ANSI_STRIP, '');
        outputBuf = (outputBuf + cleaned).slice(-4096);
        if (!trustHandled && TRUST_MARKER.test(outputBuf)) {
          trustHandled = true;
          setTimeout(() => {
            try { p.write('y\r'); } catch { /* gone */ }
            setTimeout(() => {
              if (pendingPrompt && !promptDelivered) deliverPrompt();
            }, 400);
          }, 100);
        }
        if (!promptDelivered && READY_MARKER.test(outputBuf)) {
          trustHandled = true;
          setTimeout(() => {
            if (pendingPrompt && !promptDelivered) deliverPrompt();
          }, 200);
        }
        if (promptDelivered && trustHandled) {
          // 둘 다 끝나면 onData scan 떼서 메모리 leak 방지.
          dataSub.dispose();
        }
      });
      // Fallback: 마커가 안 보여도 12s 후 무조건 deliver.
      const fallback = setTimeout(() => {
        if (pendingPrompt && !promptDelivered) {
          trustHandled = true;
          deliverPrompt();
        }
      }, FALLBACK_DELIVER_MS);
      p.onExit(() => clearTimeout(fallback));
    }
    // ────────────────────────────────────────────────────────────────────────

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
