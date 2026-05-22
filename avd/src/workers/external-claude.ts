import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { WorkerAdapter, WorkerAdapterRequest } from './adapter.js';
import type { WorkerHandle } from './index.js';

const DEFAULT_DAEMON_DIR = join(homedir(), '.claude', 'daemon');
const DEFAULT_POLL_MS = 200;
const DEFAULT_MAX_POLLS = 50;
const DEFAULT_DELIVERY_SETTLE_MS = 2500;
const DEFAULT_DELIVERY_RETRY_MS = 600;
const DEFAULT_DELIVERY_MAX_ATTEMPTS = 6;
const FRAME_CTRL = 1;
const FRAME_PTY = 0;
const CONNECT_TIMEOUT_MS = 4000;
const SETTLE_MS = 600;
const PROMPT_TO_ENTER_MS = 350;
const POST_PROMPT_HOLD_MS = 1200;

export interface ExternalClaudeRosterWorker {
  pid: number;
  sessionId: string;
  ptySock: string;
  cliVersion?: string;
  cwd: string;
}

export type PromptDelivery = (
  worker: ExternalClaudeRosterWorker,
  prompt: string
) => Promise<void>;

export interface ExternalClaudeAdapterOptions {
  daemonDir?: string;
  pollIntervalMs?: number;
  maxPolls?: number;
  deliverySettleMs?: number;
  deliveryRetryMs?: number;
  deliveryMaxAttempts?: number;
  deliverPrompt?: PromptDelivery;
  log?: Pick<Console, 'warn'>;
}

interface ExternalClaudeRoster {
  workers?: Record<string, ExternalClaudeRosterWorker>;
}

export class ExternalClaudeAdapter implements WorkerAdapter {
  private readonly daemonDir: string;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly deliverySettleMs: number;
  private readonly deliveryRetryMs: number;
  private readonly deliveryMaxAttempts: number;
  private readonly deliverPrompt: PromptDelivery;
  private readonly log: Pick<Console, 'warn'>;

  constructor(options: ExternalClaudeAdapterOptions = {}) {
    this.daemonDir = options.daemonDir ?? DEFAULT_DAEMON_DIR;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
    this.deliverySettleMs = options.deliverySettleMs ?? DEFAULT_DELIVERY_SETTLE_MS;
    this.deliveryRetryMs = options.deliveryRetryMs ?? DEFAULT_DELIVERY_RETRY_MS;
    this.deliveryMaxAttempts = options.deliveryMaxAttempts ?? DEFAULT_DELIVERY_MAX_ATTEMPTS;
    this.deliverPrompt = options.deliverPrompt ?? sendPromptToExternalClaude;
    this.log = options.log ?? console;
  }

  async start(request: WorkerAdapterRequest): Promise<WorkerHandle> {
    const short = request.sessionId.slice(0, 8);
    await this.writeDispatch(short, request);
    const worker = await this.waitForWorker(short, request.sessionId);
    if (!worker) {
      throw new Error(`EXTERNAL_CLAUDE_UNAVAILABLE session=${short}`);
    }
    const prompt = request.prompt ?? '';
    if (prompt.trim()) {
      void this.deliverPromptWithRetry(worker, prompt).catch((err) => {
        this.log.warn(
          `[avd] external-claude prompt delivery failed for ${short}: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }
    return {
      sessionId: request.sessionId,
      pid: worker.pid,
      isAlive: () => isProcessAlive(worker.pid),
      stop: async () => {
        try {
          process.kill(worker.pid);
        } catch {
          /* best effort */
        }
      },
    };
  }

  private async writeDispatch(short: string, request: WorkerAdapterRequest): Promise<void> {
    const dispatchPath = join(this.daemonDir, 'dispatch', `${short}.json`);
    await fs.mkdir(dirname(dispatchPath), { recursive: true });
    await fs.writeFile(dispatchPath, JSON.stringify(createDispatchPayload(short, request)), 'utf8');
  }

  private async waitForWorker(short: string, sessionId: string): Promise<ExternalClaudeRosterWorker | null> {
    const polls = Math.max(1, this.maxPolls);
    for (let i = 0; i < polls; i++) {
      await delay(this.pollIntervalMs);
      const worker = await this.readRosterWorker(short, sessionId);
      if (worker) return worker;
    }
    return null;
  }

  private async readRosterWorker(short: string, sessionId: string): Promise<ExternalClaudeRosterWorker | null> {
    try {
      const raw = await fs.readFile(join(this.daemonDir, 'roster.json'), 'utf8');
      const roster = JSON.parse(raw) as ExternalClaudeRoster;
      const worker = roster.workers?.[short];
      if (isRosterWorker(worker) && worker.sessionId === sessionId) return worker;
    } catch {
      /* roster not ready */
    }
    return null;
  }

  private async deliverPromptWithRetry(worker: ExternalClaudeRosterWorker, prompt: string): Promise<void> {
    await delay(Math.max(0, this.deliverySettleMs));
    const attempts = Math.max(1, this.deliveryMaxAttempts);
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.deliverPrompt(worker, prompt);
        return;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await delay(Math.max(0, this.deliveryRetryMs));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

export function createDispatchPayload(short: string, request: WorkerAdapterRequest): Record<string, unknown> {
  const agent = normalizeString(request.agent) ?? 'claude';
  const prompt = request.prompt ?? '';
  const name = deriveSessionName(request.name, prompt);
  const launchArgs = ['--session-id', request.sessionId];
  if (agent) launchArgs.push('--agent', agent);
  if (request.model) launchArgs.push('--model', request.model);
  if (name) launchArgs.push('--name', name);
  const permissionMode = (request.permissionMode || 'bypassPermissions').trim();
  launchArgs.push('--permission-mode', permissionMode);

  const payload: Record<string, unknown> = {
    proto: 1,
    short,
    nonce: randomBytes(4).toString('hex'),
    sessionId: request.sessionId,
    createdAt: Date.now(),
    source: 'spare',
    cwd: request.cwd ?? '',
    launch: { mode: 'prompt', args: launchArgs },
    env: {},
    isolation: 'none',
    respawnFlags: ['--agent', agent],
    agent,
    seed: { intent: prompt },
    cols: 120,
    rows: 30,
  };
  if (name) payload.name = name;
  return payload;
}

export function encodeExternalClaudeFrame(type: number, payload: string | Buffer): Buffer {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const out = Buffer.alloc(5 + data.length);
  out.writeUInt32BE(data.length, 0);
  out[4] = type;
  data.copy(out, 5);
  return out;
}

export async function sendPromptToExternalClaude(
  worker: ExternalClaudeRosterWorker,
  prompt: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let resolved = false;
    let sock: Socket;
    const done = (err?: Error): void => {
      if (resolved) return;
      resolved = true;
      try { sock.end(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve();
    };
    try {
      sock = connect({ path: worker.ptySock });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const timeout = setTimeout(() => done(new Error('CONNECT_TIMEOUT')), CONNECT_TIMEOUT_MS);
    sock.on('connect', () => {
      clearTimeout(timeout);
      try {
        const hello = JSON.stringify({
          t: 'hello',
          clientPid: process.pid,
          version: worker.cliVersion ?? '2.1.141',
        });
        sock.write(encodeExternalClaudeFrame(FRAME_CTRL, hello));
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      setTimeout(() => {
        try {
          sock.write(encodeExternalClaudeFrame(FRAME_PTY, prompt.replace(/\r?\n/g, ' ')));
        } catch (err) {
          done(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        setTimeout(() => {
          try {
            sock.write(encodeExternalClaudeFrame(FRAME_PTY, '\r'));
          } catch {
            /* socket gone */
          }
          setTimeout(() => done(), POST_PROMPT_HOLD_MS);
        }, PROMPT_TO_ENTER_MS);
      }, SETTLE_MS);
    });
    sock.on('error', (err) => {
      clearTimeout(timeout);
      done(err);
    });
    sock.on('close', () => {
      clearTimeout(timeout);
      if (!resolved) done(new Error('CLOSED_EARLY'));
    });
  });
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

function isRosterWorker(value: unknown): value is ExternalClaudeRosterWorker {
  if (!value || typeof value !== 'object') return false;
  const worker = value as Record<string, unknown>;
  return (
    typeof worker.pid === 'number' &&
    Number.isInteger(worker.pid) &&
    worker.pid > 0 &&
    typeof worker.sessionId === 'string' &&
    typeof worker.ptySock === 'string' &&
    typeof worker.cwd === 'string'
  );
}

function normalizeString(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

function deriveSessionName(explicitName: string | null | undefined, prompt: string | null | undefined): string | null {
  const explicit = normalizeString(explicitName);
  if (explicit) return explicit.slice(0, 60);
  const body = (prompt ?? '').replace(/\r\n/g, '\n');
  if (!body.trim()) return null;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('```')) continue;
    if (/^continue from where you left off\.?$/i.test(line)) continue;
    if (/^\[?attached files\]?/i.test(line)) continue;
    const stripped = line.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, '').trim();
    if (!stripped) continue;
    const sentenceMatch = /[.!?。！？]/.exec(stripped);
    if (sentenceMatch && sentenceMatch.index >= 4 && sentenceMatch.index <= 30) {
      return stripped.slice(0, sentenceMatch.index).trim().slice(0, 60);
    }
    if (stripped.length <= 32) return stripped.slice(0, 60);
    const slice = stripped.slice(0, 32);
    const lastSpace = slice.lastIndexOf(' ');
    return (lastSpace >= 12 ? slice.slice(0, lastSpace) : slice).trim().slice(0, 60);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
