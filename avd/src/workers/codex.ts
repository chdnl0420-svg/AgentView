import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { WorkerAdapter, WorkerAdapterRequest } from './adapter.js';
import type { WorkerHandle, WorkerSendOptions } from './index.js';

const DEFAULT_KILL_TIMEOUT_MS = 1000;

export interface CodexAdapterOptions {
  codexBin?: string;
  codexBaseArgs?: string[];
  conversationDir?: string;
  killTimeoutMs?: number;
  log?: Pick<Console, 'warn'>;
}

export interface CodexCommand {
  command: string;
  args: string[];
}

export class CodexAdapter implements WorkerAdapter {
  private readonly codexBin: string;
  private readonly codexBaseArgs: string[];
  private readonly conversationDir: string;
  private readonly killTimeoutMs: number;
  private readonly log: Pick<Console, 'warn'>;

  constructor(options: CodexAdapterOptions = {}) {
    this.codexBin = options.codexBin ?? 'codex';
    this.codexBaseArgs = options.codexBaseArgs ?? [];
    this.conversationDir = options.conversationDir ?? join(process.cwd(), '.agentview', 'codex-conversations');
    this.killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
    this.log = options.log ?? console;
  }

  async start(request: WorkerAdapterRequest): Promise<WorkerHandle> {
    const conversationPath = resolveConversationPath(request, this.conversationDir);
    await fs.mkdir(dirnameOf(conversationPath), { recursive: true });
    await fs.appendFile(conversationPath, '', 'utf8');

    const command = buildCodexCommand(request, {
      codexBin: this.codexBin,
      codexBaseArgs: this.codexBaseArgs,
    });
    const child = spawn(command.command, command.args, {
      cwd: request.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (!child.pid) throw new Error('CODEX_START_FAILED');

    const exitState = createExitState(child);
    const writer = new JsonlWriter(conversationPath, this.log);
    child.stdout?.on('data', (chunk) => {
      writer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stdout?.on('end', () => {
      writer.flushPartial();
    });
    child.stderr?.on('data', () => {
      /* bounded stderr diagnostics can be added after the command contract is stable */
    });
    child.on('error', (err) => {
      this.log.warn(`[avd] codex child error: ${err.message}`);
    });

    child.stdin?.end(request.prompt ?? '');

    return {
      sessionId: request.sessionId,
      pid: child.pid,
      conversationPath,
      isAlive: () => !exitState.exited && isProcessAlive(child.pid ?? -1),
      stop: async () => {
        await stopChild(child, exitState.exitedPromise, this.killTimeoutMs);
      },
      // codex CLI is invoked via `codex exec [resume] --json ... -`, which
      // reads a single prompt from stdin and then exits — `child.stdin` is
      // already closed (`child.stdin.end(...)`) above. The backend has no
      // mechanism to deliver a follow-up message into the same session.
      // Until codex grows a long-lived RPC, follow-ups must be modeled as
      // a brand-new session (chunk-7 resumeSessionId path).
      send: async (_prompt: string, _opts?: WorkerSendOptions) => {
        throw new Error(
          'NOT_SUPPORTED: codex backend does not support follow-up messages — start a new session instead'
        );
      },
    };
  }
}

export function buildCodexCommand(
  request: WorkerAdapterRequest,
  options: Pick<CodexAdapterOptions, 'codexBin' | 'codexBaseArgs'> = {}
): CodexCommand {
  const command = options.codexBin ?? 'codex';
  const args = [...(options.codexBaseArgs ?? [])];
  if (request.resumeSessionId) {
    args.push('exec', 'resume', '--json');
    if (request.model) args.push('--model', request.model);
    args.push(request.resumeSessionId, '-');
    return { command, args };
  }
  args.push('exec', '--json');
  if (request.cwd) args.push('-C', request.cwd);
  if (request.model) args.push('--model', request.model);
  if (request.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }
  args.push('-');
  return { command, args };
}

class JsonlWriter {
  private buffered = '';
  private readonly decoder = new StringDecoder('utf8');
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly log: Pick<Console, 'warn'>
  ) {}

  push(chunk: Buffer): void {
    this.consume(this.decoder.write(chunk));
  }

  flushPartial(): void {
    const tail = this.decoder.end();
    if (tail) this.consume(tail);
    if (!this.buffered) return;
    const line = `${this.buffered}\n`;
    this.buffered = '';
    this.enqueue(line);
  }

  private consume(text: string): void {
    this.buffered += text;
    for (;;) {
      const nl = this.buffered.indexOf('\n');
      if (nl === -1) return;
      const line = this.buffered.slice(0, nl + 1);
      this.buffered = this.buffered.slice(nl + 1);
      this.enqueue(line);
    }
  }

  private enqueue(line: string): void {
    validateJsonlLine(line, this.log);
    this.writeQueue = this.writeQueue
      .then(() => fs.appendFile(this.filePath, line, 'utf8'))
      .catch((err) => {
        this.log.warn(`[avd] failed to append codex JSONL: ${err instanceof Error ? err.message : String(err)}`);
      });
  }
}

function validateJsonlLine(line: string, log: Pick<Console, 'warn'>): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    JSON.parse(trimmed);
  } catch {
    log.warn('[avd] codex emitted malformed JSONL line; preserving raw line');
  }
}

function resolveConversationPath(request: WorkerAdapterRequest, conversationDir: string): string {
  if (request.conversationPath) return request.conversationPath;
  return join(conversationDir, `${safeFileName(request.sessionId)}.jsonl`);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function dirnameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx === -1 ? '.' : path.slice(0, idx);
}

interface ExitState {
  exited: boolean;
  exitedPromise: Promise<void>;
}

function createExitState(child: ChildProcess): ExitState {
  const state: ExitState = {
    exited: child.exitCode !== null || child.signalCode !== null,
    exitedPromise: Promise.resolve(),
  };
  state.exitedPromise = new Promise<void>((resolve) => {
    if (state.exited) {
      resolve();
      return;
    }
    child.once('exit', () => {
      state.exited = true;
      resolve();
    });
  });
  return state;
}

async function stopChild(child: ChildProcess, exited: Promise<void>, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await exited;
    return;
  }
  try { child.kill('SIGINT'); } catch { /* ignore */ }
  const settled = await raceExit(exited, timeoutMs);
  if (!settled) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    await raceExit(exited, timeoutMs);
  }
}

async function raceExit(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    return err.code === 'EPERM';
  }
}
