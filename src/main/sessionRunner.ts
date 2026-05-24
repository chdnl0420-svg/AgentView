import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { BackendKind, ClaudeRunEvent, NewSessionInput, ResumeMessageInput } from '@shared/types';
import { sendToBackgroundAgent } from './daemonAttach';
import { createWorktree } from './git';
import { rememberOwned } from './ownedSessions';
import { checkClaudeStatus, ensureDaemonRunning } from './claudePreflight';
import { appendSessionEvent, updateSessionStatus, writeSessionDoc } from './workspaceStore';
import { createAvdClient } from './avdClient';

const WORKER_SETTLE_MS = 2500;
const ATTACH_RETRY_MS = 600;
const ATTACH_MAX_RETRIES = 6;

interface PtySlot {
  sessionId: string;
  pid: number;
  startedAt: number;
  pty: IPty;
  pendingPrompt: string | null;
  promptDelivered: boolean;
  trustHandled: boolean;
  outputBuf: string;
  fallbackTimer: NodeJS.Timeout | null;
}

const isWindows = platform() === 'win32';
const ANSI_STRIP = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\]0;[^\x07]*\x07|\x1b[\(\)][A-Z0-9]|\x1b[=>]|\r/g;

const TRUST_MARKER = /trust this folder/i;
// Anything claude's prompt-box UI prints once it's ready to accept text.
const READY_MARKER =
  /How can I help|Tips for getting started|to interrupt|\/effort|to cycle|auto mode on|shift\+tab|Welcome back|Run \/init|Try ".+"/i;
const FALLBACK_DELIVER_MS = 12000;

const DAEMON_DIR = join(homedir(), '.claude', 'daemon');
const DISPATCH_DIR = join(DAEMON_DIR, 'dispatch');
const ROSTER_PATH = join(DAEMON_DIR, 'roster.json');
const JOBS_DIR = join(homedir(), '.claude', 'jobs');
const DISPATCH_POLL_MS = 200;

type CreateAvdClient = typeof createAvdClient;

interface SessionRunnerOptions {
  createAvdClient?: CreateAvdClient;
}

/**
 * Routing decision for a new session request. chunk-11 removed the
 * legacy `AVD_ENABLED` env var: backend selection now flows from the
 * `input.backend` dropdown value alone. `'avd'` is a convenience alias
 * for the default `'external-claude'` worker.
 */
type BackendRoute =
  | { via: 'avd'; worker: BackendKind }
  | { via: 'legacy'; worker: null };

function routeBackend(input: NewSessionInput): BackendRoute {
  switch (input.backend) {
    case 'avd':
      return { via: 'avd', worker: 'external-claude' };
    case 'external-claude':
      return { via: 'avd', worker: 'external-claude' };
    case 'codex':
      return { via: 'avd', worker: 'codex' };
    case 'claude':
      return { via: 'legacy', worker: null };
    default:
      return { via: 'legacy', worker: null };
  }
}

/**
 * Tracks sessions that were started through the avd adapter so the IPC
 * layer (chunk-12) can route follow-up messages to the same worker
 * instead of the legacy daemon dispatch path.
 */
interface AvdSessionInfo {
  sessionId: string;
  backend: BackendKind;
  pid: number;
  cwd: string;
  startedAt: number;
}

function normalizeAgentBackend(agent: string | null | undefined): BackendKind | null {
  const value = (agent ?? '').trim().toLowerCase();
  return value === 'claude' || value === 'external-claude' || value === 'codex'
    ? value
    : null;
}

function normalizeInputBackend(backend: NewSessionInput['backend']): BackendKind | null {
  if (backend === 'claude' || backend === 'external-claude' || backend === 'codex') return backend;
  return null;
}

/**
 * Derive a stable session display name from the explicit `args.name` or, if
 * absent, the first meaningful line of the user's prompt. Skipping code
 * fences and the standard "Continue from where you left off." resume blurb
 * keeps the title from blinking through the 8-char hex fallback while the
 * daemon settles. The first sentence/clause is preferred so a "Plan v3.
 * Implement…" prompt yields "Plan v3" rather than "Plan v3. Implement…".
 */
export function deriveSessionName(
  explicitName: string | null | undefined,
  prompt: string | null | undefined
): string | null {
  const explicit = (explicitName ?? '').trim();
  if (explicit) return explicit.slice(0, 60);
  const body = (prompt ?? '').replace(/\r\n/g, '\n');
  if (!body.trim()) return null;
  // Walk line by line, skipping code fences and resume placeholders.
  const lines = body.split('\n');
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^continue from where you left off\.?$/i.test(line)) continue;
    if (/^\[?attached files\]?/i.test(line)) continue;
    // Strip leading bullet/heading markers so "## Plan" or "- todo" don't
    // bleed into the title.
    const stripped = line.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, '').trim();
    if (!stripped) continue;
    // Prefer cutting at the first sentence-ending punctuation so the title
    // is a self-contained phrase rather than a sliced clause.
    const sentenceMatch = /[.!?。！？]/.exec(stripped);
    let candidate = stripped;
    if (sentenceMatch && sentenceMatch.index >= 4 && sentenceMatch.index <= 30) {
      candidate = stripped.slice(0, sentenceMatch.index).trim();
    } else if (stripped.length > 32) {
      // Cut at the last whitespace before char 32 to avoid mid-word breaks.
      const slice = stripped.slice(0, 32);
      const lastSpace = slice.lastIndexOf(' ');
      candidate = (lastSpace >= 12 ? slice.slice(0, lastSpace) : slice).trim();
    }
    if (candidate) return candidate.slice(0, 60);
  }
  return null;
}
// ~10 seconds. The old 2.4 s budget was too tight on slow machines and would
// silently fall back to Strategy B (direct PTY spawn), which produces a
// kind:"interactive" session that never appears in `claude agents`. Waiting
// longer keeps the registration in the bg-worker path so the new session
// actually shows up on the CLI side.
const DISPATCH_POLL_TRIES = 50;
// Fast-fail when the bg daemon supervisor is provably down. Without this
// we waste the full 10s above before realizing nothing will ever pick the
// dispatch file up. With it the user sees Strategy B (PTY) within ~2s.
const DISPATCH_POLL_TRIES_NO_DAEMON = 8;

/**
 * Drop a dispatch JSON file into ~/.claude/daemon/dispatch and wait for the
 * daemon to register a worker with our short id. Returns the worker pid, or
 * null if the daemon never picked it up (daemon down, dispatch rejected, …).
 */
async function dispatchToDaemon(args: {
  sessionId: string;
  cwd: string;
  agent: string;
  model: string | null;
  name: string | null;
  prompt: string;
  permissionMode?: string | null;
  /** Bound the daemon-registration wait. Pass DISPATCH_POLL_TRIES_NO_DAEMON
   *  when preflight reports supervisor dead so we don't waste 10s. */
  maxTries?: number;
}): Promise<number | null> {
  const short = args.sessionId.slice(0, 8);
  // Resolve a non-empty name so the daemon's state.json gets a stable label
  // immediately. Without this the bg-worker registers with `name === ''` and
  // the dashboard cards briefly render the 8-char hex short until claude's
  // own status loop catches up (the "title flicker" bug). Falls back to a
  // prompt-derived title when the caller didn't supply one explicitly.
  const resolvedName = deriveSessionName(args.name, args.prompt);
  const launchArgs: string[] = ['--session-id', args.sessionId];
  if (args.agent) launchArgs.push('--agent', args.agent);
  if (args.model) launchArgs.push('--model', args.model);
  if (resolvedName) launchArgs.push('--name', resolvedName);
  // Propagate the user's permission selection into the bg worker spawn.
  // Without this, the daemon's claude defaults to "default" which blocks
  // on every tool prompt — invisible to AgentView.
  const permMode = (args.permissionMode || 'bypassPermissions').trim();
  launchArgs.push('--permission-mode', permMode);

  const payload: Record<string, unknown> = {
    proto: 1,
    short,
    nonce: randomBytes(4).toString('hex'),
    sessionId: args.sessionId,
    createdAt: Date.now(),
    source: 'spare',
    cwd: args.cwd,
    launch: { mode: 'prompt', args: launchArgs },
    env: {},
    isolation: 'none',
    respawnFlags: args.agent ? ['--agent', args.agent] : ['--agent', 'claude'],
    agent: args.agent || 'claude',
    seed: { intent: args.prompt },
    cols: 120,
    rows: 30
  };
  // Top-level `name` so the daemon's state-writer picks up our derived label
  // on the very first state.json flush, before any --name CLI parse happens.
  if (resolvedName) payload.name = resolvedName;
  try {
    await fsp.mkdir(DISPATCH_DIR, { recursive: true });
    const target = join(DISPATCH_DIR, `${short}.json`);
    await fsp.writeFile(target, JSON.stringify(payload), 'utf8');
    console.log('[runner] dispatched', short, 'cwd:', args.cwd);
  } catch (err) {
    console.error('[runner] dispatch write failed', err);
    return null;
  }
  const tries = Math.max(1, args.maxTries ?? DISPATCH_POLL_TRIES);
  for (let i = 0; i < tries; i++) {
    await new Promise((res) => setTimeout(res, DISPATCH_POLL_MS));
    try {
      const raw = await fsp.readFile(ROSTER_PATH, 'utf8');
      const r = JSON.parse(raw) as { workers?: Record<string, { pid: number }> };
      const w = r.workers?.[short];
      if (w && w.pid) {
        console.log('[runner] daemon worker registered', short, 'pid:', w.pid);
        return w.pid;
      }
    } catch {
      /* roster not readable this tick */
    }
  }
  console.warn('[runner] daemon did not register worker for', short);
  return null;
}

/**
 * Patch jobs/<short>/state.json with our derived display name *only when the
 * worker has no name yet*. Preserves any user-renamed label (nameSource ===
 * 'user' or any non-empty `name` already present). Atomic write via tmp+
 * rename, mirroring the renameJob IPC pattern in ipc.ts.
 *
 * Retries briefly because the daemon writes state.json *after* the roster
 * entry appears, so the first read can lose the race. Best-effort —
 * dashboard liveWatcher reads from this file and will re-emit on update.
 */
async function backfillJobStateName(sessionId: string, name: string): Promise<void> {
  if (!name) return;
  const short = sessionId.slice(0, 8);
  const statePath = join(JOBS_DIR, short, 'state.json');
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 400 : 600));
    try {
      const raw = await fsp.readFile(statePath, 'utf8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      const existingName = typeof data.name === 'string' ? data.name.trim() : '';
      const nameSource = typeof data.nameSource === 'string' ? data.nameSource : '';
      // Preserve any user-supplied label (renameJob writes nameSource:'user').
      if (nameSource === 'user') return;
      if (existingName) return;
      data.name = name;
      // Mark as 'auto' so renameJob can still override later, and so claude's
      // own derivation loop knows we already filled in a default title.
      data.nameSource = 'auto';
      const tmp = statePath + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await fsp.rename(tmp, statePath);
      return;
    } catch {
      /* state.json not written yet — keep retrying */
    }
  }
}

function resolveClaudeExe(): string {
  if (isWindows) {
    const direct = join(
      homedir(),
      'AppData',
      'Roaming',
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe'
    );
    if (existsSync(direct)) return direct;
    return 'claude.cmd';
  }
  return 'claude';
}

/**
 * Spawns `claude` in interactive mode through a PTY so that:
 *  - claude registers a real session in ~/.claude/sessions/{pid}.json
 *  - the conversation jsonl is updated on disk while the agent works
 *  - we can keep typing into the same PTY for follow-up messages
 *
 * The boot sequence varies:
 *   - first-time cwd: shows "Trust this folder?" with option 1 highlighted
 *   - trusted cwd:   jumps straight to the welcome screen + prompt box
 * So we watch PTY output for either marker before delivering the prompt.
 */
export class SessionRunner extends EventEmitter {
  private slots = new Map<string, PtySlot>();
  private avdSessions = new Map<string, AvdSessionInfo>();
  private readonly createAvdClient: CreateAvdClient;

  constructor(options: SessionRunnerOptions = {}) {
    super();
    this.createAvdClient = options.createAvdClient ?? createAvdClient;
  }

  pidsBySession(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [sid, s] of this.slots) out.set(sid, s.pid);
    return out;
  }

  activePids(): Set<number> {
    const out = new Set<number>();
    for (const s of this.slots.values()) out.add(s.pid);
    return out;
  }

  /** Last ~6 KB of PTY output for the given session (debugging). */
  ptyTail(sessionId: string): string {
    const slot = this.slots.get(sessionId);
    return slot?.outputBuf ?? '';
  }

  async startNewSession(input: NewSessionInput): Promise<{
    sessionId: string;
    pid: number | null;
    forkedFrom?: null;
  }> {
    const sessionId = randomUUID();
    // If the user requested a new worktree, create it before spawning so
    // claude lands in the right folder. Failure aborts the spawn so the user
    // sees the git error in a toast rather than a session at the wrong cwd.
    let spawnCwd = input.cwd;
    if (input.worktreePath && input.worktreePath.trim()) {
      try {
        spawnCwd = await createWorktree({
          cwd: input.cwd,
          worktreePath: input.worktreePath.trim(),
          baseBranch: (input.baseBranch || '').trim() || 'HEAD',
          newBranch: input.newBranch?.trim() || null
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit('event', {
          sessionId,
          type: 'error',
          message: `worktree 생성 실패: ${message}`,
          ts: Date.now()
        } satisfies ClaudeRunEvent);
        return { sessionId, pid: null };
      }
    }
    // Always remember this sessionId so the IPC scan filter (kind:"bg" + owned)
    // shows it even before its meta lands on disk. Done up-front so the
    // renderer's first reload after newSession() returns sees the entry.
    await rememberOwned(sessionId).catch(() => {
      /* best-effort */
    });
    this.rememberLastPrompt(sessionId, input.prompt);
    // Persist a markdown blueprint for this task so an interrupted/crashed
    // app can resume from it on the next launch. Goal-1+7 of release 1.0.4.
    writeSessionDoc({
      sessionId,
      cwd: spawnCwd,
      agent: input.agent || 'claude',
      name: input.name || null,
      prompt: input.prompt,
      status: 'pending',
      createdAt: Date.now()
    }).catch(() => {
      /* best-effort */
    });

    const route = routeBackend(input);
    if (route.via === 'avd') {
      return this.startViaAvd(
        sessionId,
        { ...input, backend: route.worker },
        spawnCwd,
      );
    }

    // Preflight — is claude CLI even installed? Is the bg supervisor up?
    // If supervisor is down, kick a bootstrap (claude agents --headless) so
    // Strategy A has a chance to land, but cap the polling at 2s instead of
    // 10s so the UI doesn't stall when the bootstrap fails.
    const status = await checkClaudeStatus();
    if (!status.cliPath) {
      const msg =
        'Claude Code CLI 가 설치돼있지 않습니다. PowerShell 에서 "npm install -g @anthropic-ai/claude-code" 로 설치 후 다시 시도해주세요.';
      this.emit('event', {
        sessionId,
        type: 'error',
        message: msg,
        ts: Date.now()
      } satisfies ClaudeRunEvent);
      appendSessionEvent(sessionId, 'error', msg).catch(() => undefined);
      return { sessionId, pid: null };
    }
    let daemonAlive = status.daemonAlive;
    if (!daemonAlive) {
      console.log('[runner] daemon supervisor not alive — bootstrap attempt');
      daemonAlive = await ensureDaemonRunning();
    }

    // Strategy A — daemon dispatch. Writes ~/.claude/daemon/dispatch/<short>.json
    // so the supervisor spawns claude as a kind:"bg" worker. This is the only
    // way for a new session to show up in `claude agents`. Once the worker
    // appears in roster.json, attach via its ptySock and send the prompt as
    // raw TUI input — same channel resumeSession uses for external workers.
    const dispatchPid = await dispatchToDaemon({
      sessionId,
      cwd: spawnCwd,
      agent: input.agent || 'claude',
      model: input.model || null,
      name: input.name || null,
      prompt: input.prompt,
      permissionMode: input.permissionMode || null,
      maxTries: daemonAlive ? undefined : DISPATCH_POLL_TRIES_NO_DAEMON
    });
    if (dispatchPid !== null) {
      this.deliverInitialPromptToBgWorker(sessionId, input.prompt).catch((err) => {
        console.error('[runner] bg-prompt deliver failed', err);
        this.emit('event', {
          sessionId,
          type: 'error',
          message: `daemon 워커에 프롬프트 전달 실패. 입력창에서 다시 보내주세요. (${err instanceof Error ? err.message : String(err)})`,
          ts: Date.now()
        } satisfies ClaudeRunEvent);
      });
      this.emit('event', {
        sessionId,
        type: 'spawn',
        pid: dispatchPid,
        ts: Date.now()
      } satisfies ClaudeRunEvent);
      appendSessionEvent(sessionId, 'spawn', `bg-worker pid=${dispatchPid}`).catch(() => undefined);
      return { sessionId, pid: dispatchPid };
    }

    // Strategy B — fallback to direct PTY spawn. Used when the daemon isn't
    // up or didn't register a worker within the polling window. The session
    // is created as kind:"interactive" so it won't show in `claude agents`,
    // but at least the user gets a working chat.
    console.warn('[runner] daemon dispatch unavailable, falling back to direct PTY spawn');
    appendSessionEvent(
      sessionId,
      'note',
      `daemon-dispatch-failed; fallback=direct-pty; daemonAlive=${daemonAlive}`
    ).catch(() => undefined);
    const slot = this.spawn(
      sessionId,
      ['--session-id', sessionId],
      { ...input, cwd: spawnCwd },
      input.prompt
    );
    if (!slot) return { sessionId, pid: null };
    slot.promptDelivered = true;
    appendSessionEvent(sessionId, 'spawn', `direct-pty pid=${slot.pid}`).catch(() => undefined);
    return { sessionId, pid: slot.pid };
  }

  /**
   * After dispatchToDaemon registers a worker, give the claude TUI a moment
   * to come up, then send the user's initial prompt via the ptySock. The
   * worker is in idle "waiting for first input" mode by then, so the prompt
   * gets logged as if a `claude agents` TUI peer typed it.
   *
   * Retries the attach a few times — the daemon writes the roster entry
   * before claude has actually opened the named pipe for reads, so the
   * first connect can race and fail.
   */
  private async deliverInitialPromptToBgWorker(
    sessionId: string,
    prompt: string
  ): Promise<void> {
    if (!prompt || !prompt.trim()) return;
    await new Promise((r) => setTimeout(r, WORKER_SETTLE_MS));
    let lastReason = '';
    for (let i = 0; i < ATTACH_MAX_RETRIES; i++) {
      const result = await sendToBackgroundAgent(sessionId, prompt);
      if (result.ok) {
        console.log('[runner] bg-worker prompt delivered', sessionId.slice(0, 8));
        return;
      }
      lastReason = result.reason;
      await new Promise((r) => setTimeout(r, ATTACH_RETRY_MS));
    }
    throw new Error(`ATTACH_${lastReason || 'UNKNOWN'}`);
  }

  private async startViaAvd(
    sessionId: string,
    input: NewSessionInput,
    cwd: string
  ): Promise<{ sessionId: string; pid: number | null; forkedFrom?: null }> {
    let client: Awaited<ReturnType<CreateAvdClient>> | null = null;
    try {
      client = await this.createAvdClient();
      // `input.backend` is the normalized worker backend at this point —
      // `routeBackend` has already mapped 'avd' → 'external-claude' upstream.
      const workerBackend =
        normalizeInputBackend(input.backend) ?? normalizeAgentBackend(input.agent) ?? 'claude';
      const ack = await client.startSession({
        sessionId,
        cwd,
        backend: workerBackend,
        agent: input.agent ?? null,
        prompt: input.prompt,
        name: input.name ?? null,
        model: input.model ?? null,
        permissionMode: input.permissionMode ?? null,
      });
      this.avdSessions.set(ack.sessionId, {
        sessionId: ack.sessionId,
        backend: workerBackend,
        pid: ack.pid,
        cwd,
        startedAt: Date.now(),
      });
      this.emit('event', {
        sessionId: ack.sessionId,
        type: 'spawn',
        pid: ack.pid,
        ts: Date.now()
      } satisfies ClaudeRunEvent);
      appendSessionEvent(ack.sessionId, 'spawn', `avd pid=${ack.pid}`).catch(() => undefined);
      return { sessionId: ack.sessionId, pid: ack.pid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('event', {
        sessionId,
        type: 'error',
        message: `avd start failed: ${message}`,
        ts: Date.now()
      } satisfies ClaudeRunEvent);
      appendSessionEvent(sessionId, 'error', `avd start failed: ${message}`).catch(() => undefined);
      return { sessionId, pid: null };
    } finally {
      if (client) await client.close().catch(() => undefined);
    }
  }

  resumeSession(input: ResumeMessageInput): {
    sessionId: string;
    pid: number | null;
    forkedFrom?: string | null;
  } {
    const existing = this.slots.get(input.sessionId);
    if (existing) {
      // Already alive — type into the same PTY immediately.
      this.tryDeliver(existing, input.prompt);
      this.rememberLastPrompt(input.sessionId, input.prompt);
      appendSessionEvent(input.sessionId, 'resume', `inline prompt=${input.prompt.slice(0, 60)}`).catch(() => undefined);
      return { sessionId: input.sessionId, pid: existing.pid };
    }
    // Dead PTY → respawn with the prompt as a positional arg so claude
    // submits it on boot (same reasoning as startNewSession).
    const slot = this.spawn(input.sessionId, ['--resume', input.sessionId], input, input.prompt);
    if (!slot) return { sessionId: input.sessionId, pid: null };
    slot.promptDelivered = true;
    this.rememberLastPrompt(input.sessionId, input.prompt);
    rememberOwned(input.sessionId).catch(() => {
      /* best-effort */
    });
    appendSessionEvent(input.sessionId, 'resume', `respawn pid=${slot.pid} prompt=${input.prompt.slice(0, 60)}`).catch(() => undefined);
    return { sessionId: input.sessionId, pid: slot.pid };
  }

  /**
   * Fork an external (or finished) session into a brand-new sessionId so we
   * don't collide with a background agent that's already running under the
   * original sid. The new session carries over the original conversation
   * context — see `claude --fork-session`.
   */
  forkSession(input: ResumeMessageInput): {
    sessionId: string;
    pid: number | null;
    forkedFrom: string;
  } {
    const newId = randomUUID();
    const slot = this.spawn(
      newId,
      ['--resume', input.sessionId, '--fork-session', '--session-id', newId],
      input,
      input.prompt
    );
    if (!slot) {
      return { sessionId: newId, pid: null, forkedFrom: input.sessionId };
    }
    slot.promptDelivered = true;
    rememberOwned(newId).catch(() => {
      /* best-effort */
    });
    return { sessionId: newId, pid: slot.pid, forkedFrom: input.sessionId };
  }

  hasSession(sessionId: string): boolean {
    return this.slots.has(sessionId);
  }

  /** True when this sessionId was started through the avd adapter and is
   *  still tracked in-memory. chunk-12's IPC layer uses this to pick the
   *  right follow-up routing path. */
  knowsAvdSession(sessionId: string): boolean {
    return this.avdSessions.has(sessionId);
  }

  getAvdSession(sessionId: string): AvdSessionInfo | null {
    return this.avdSessions.get(sessionId) ?? null;
  }

  forgetAvdSession(sessionId: string): void {
    this.avdSessions.delete(sessionId);
  }

  /**
   * Send a follow-up prompt to an avd-started session. Opens a short-lived
   * AvdClient connection, dispatches `send-message`, and closes it again
   * — the daemon owns the worker handle, we just relay the prompt.
   */
  async sendAvdMessage(
    sessionId: string,
    prompt: string,
    permissionMode: string | null,
  ): Promise<void> {
    if (!this.avdSessions.has(sessionId)) {
      throw new Error('UNKNOWN_AVD_SESSION');
    }
    const client = await this.createAvdClient();
    try {
      await client.sendMessage({ sessionId, prompt, permissionMode });
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /**
   * Cancel an avd-started session.
   *
   * NOTE: chunk-10 will wire up the actual `cancel-session` CTRL frame on
   * the avd server. Until then this method intentionally throws so callers
   * (chunk-12's IPC handler) can fall through to the legacy cancel path or
   * surface a clear UX message instead of silently no-op'ing.
   */
  async cancelAvdSession(sessionId: string): Promise<boolean> {
    if (!this.avdSessions.has(sessionId)) return false;
    // Intentionally not opening a client yet — chunk-10 lands the
    // cancel-session CTRL on the avd server. Throwing keeps the contract
    // explicit so the IPC layer can branch.
    throw new Error('CANCEL_NOT_IMPLEMENTED: chunk-10 will add cancel-session CTRL');
  }

  cancel(sessionId: string): boolean {
    const slot = this.slots.get(sessionId);
    if (!slot) return false;
    try {
      slot.pty.kill();
    } catch {
      return false;
    }
    return true;
  }

  disposeAll(): void {
    for (const sid of Array.from(this.slots.keys())) this.cancel(sid);
  }

  // ------- internals -------

  private spawn(
    sessionId: string,
    sessionArgs: string[],
    input: {
      cwd: string;
      agent?: string | null;
      model?: string | null;
      name?: string | null;
      permissionMode?: string | null;
    },
    initialPrompt?: string | null
  ): PtySlot | null {
    const exe = resolveClaudeExe();
    // claude CLI accepts: default, acceptEdits, bypassPermissions, plan.
    // Fall back to bypassPermissions so AgentView-spawned sessions don't
    // hang on permission prompts the user can't see in the chat panel.
    const permMode = (input.permissionMode || 'bypassPermissions').trim();
    const args = [...sessionArgs, '--permission-mode', permMode];
    if (input.agent) args.push('--agent', input.agent);
    if (input.model) args.push('--model', input.model);
    if (input.name) args.push('--name', input.name);
    // Positional prompt MUST come last so commander parses all flags first.
    if (initialPrompt && initialPrompt.trim()) {
      args.push(initialPrompt);
    }

    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    env.PYTHONIOENCODING = 'utf-8';
    env.FORCE_COLOR = '0';
    delete env.CI;

    let p: IPty;
    try {
      console.log('[runner] spawn', exe, args.join(' '), 'cwd:', input.cwd);
      p = pty.spawn(exe, args, {
        name: 'xterm-256color',
        cols: 200,
        rows: 50,
        cwd: input.cwd && input.cwd.trim() ? input.cwd : process.cwd(),
        env,
        useConpty: true,
        encoding: 'utf8'
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[runner] spawn failed', message);
      this.emit('event', {
        sessionId,
        type: 'error',
        message: `claude PTY 시작 실패: ${message}`,
        ts: Date.now()
      } satisfies ClaudeRunEvent);
      return null;
    }

    const slot: PtySlot = {
      sessionId,
      pid: p.pid,
      startedAt: Date.now(),
      pty: p,
      pendingPrompt: null,
      promptDelivered: false,
      trustHandled: false,
      outputBuf: '',
      fallbackTimer: null
    };
    this.slots.set(sessionId, slot);

    p.onData((chunk) => this.onPtyData(slot, chunk));
    p.onExit(({ exitCode, signal }) => {
      if (slot.fallbackTimer) {
        clearTimeout(slot.fallbackTimer);
        slot.fallbackTimer = null;
      }
      this.slots.delete(sessionId);
      this.emit('event', {
        sessionId,
        type: 'exit',
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        stderr: signal ? `signal=${signal}` : slot.outputBuf.slice(-400) || undefined,
        ts: Date.now()
      } satisfies ClaudeRunEvent);
      this.emit('procs-changed');
      const finalStatus: 'completed' | 'crashed' =
        typeof exitCode === 'number' && exitCode !== 0 ? 'crashed' : 'completed';
      updateSessionStatus(sessionId, finalStatus).catch(() => undefined);
    });

    // Fallback: if neither marker shows up in time, deliver the prompt anyway.
    slot.fallbackTimer = setTimeout(() => {
      slot.fallbackTimer = null;
      if (slot.pendingPrompt && !slot.promptDelivered) {
        slot.trustHandled = true;
        this.deliverPrompt(slot);
      }
    }, FALLBACK_DELIVER_MS);

    this.emit('event', {
      sessionId,
      type: 'spawn',
      pid: p.pid ?? null,
      ts: slot.startedAt
    } satisfies ClaudeRunEvent);
    this.emit('procs-changed');
    return slot;
  }

  private onPtyData(slot: PtySlot, chunk: string): void {
    const cleaned = chunk.replace(ANSI_STRIP, '');
    // 4KB rolling buffer — enough to spot the trust + ready markers and
    // capture a stderr tail on exit, but small enough that hundreds of
    // parallel sessions don't pile up MB of unused log text.
    slot.outputBuf = (slot.outputBuf + cleaned).slice(-4000);

    // Trust dialog → press Enter to accept option 1 ("Yes, I trust this folder").
    if (!slot.trustHandled && TRUST_MARKER.test(slot.outputBuf)) {
      slot.trustHandled = true;
      console.log('[runner] trust dialog detected, sending Enter', slot.sessionId);
      try {
        slot.pty.write('\r');
      } catch {
        return;
      }
      // After trust, give the welcome screen ~1.5s before sending prompt.
      setTimeout(() => {
        if (slot.pendingPrompt && !slot.promptDelivered) this.deliverPrompt(slot);
      }, 1500);
      return;
    }

    // Prompt box ready (already-trusted cwd) → send right away.
    if (!slot.promptDelivered && READY_MARKER.test(slot.outputBuf)) {
      if (!slot.trustHandled) console.log('[runner] ready marker detected', slot.sessionId);
      slot.trustHandled = true;
      // tiny delay so the cursor lands in the input box
      setTimeout(() => {
        if (slot.pendingPrompt && !slot.promptDelivered) this.deliverPrompt(slot);
      }, 350);
    }
  }

  private tryDeliver(slot: PtySlot, prompt: string): void {
    if (slot.promptDelivered && slot.trustHandled) {
      // PTY is settled — send straight away.
      slot.pendingPrompt = prompt;
      slot.promptDelivered = false;
      this.deliverPrompt(slot);
      return;
    }
    slot.pendingPrompt = prompt;
    // Boot sequence will deliver it as soon as the prompt is ready.
  }

  private deliverPrompt(slot: PtySlot): void {
    if (!slot.pendingPrompt) return;
    // claude's TUI submits on \r and inserts a newline on \n (Shift+Enter).
    // We need newlines preserved so the "[Attached files]" block stays
    // separable from the body — otherwise claude gets `body [Attached files] @C:\path`
    // on one line and treats the path as part of the prose. Split on newlines
    // and send each line separately, with \n between them and \r at the end.
    const lines = slot.pendingPrompt.split(/\r?\n/);
    slot.pendingPrompt = null;
    slot.promptDelivered = true;
    console.log('[runner] deliver prompt', slot.sessionId, 'lines:', lines.length);
    const writeNext = (i: number) => {
      if (i >= lines.length) {
        setTimeout(() => {
          try {
            slot.pty.write('\r');
          } catch {
            /* gone */
          }
        }, 80);
        return;
      }
      try {
        slot.pty.write(lines[i]);
        if (i < lines.length - 1) slot.pty.write('\n');
      } catch (err) {
        console.error('[runner] write prompt failed', err);
        return;
      }
      // small per-line delay so the TUI keeps up with multi-line input.
      setTimeout(() => writeNext(i + 1), 40);
    };
    writeNext(0);
  }

  /** Returns the most recent prompt we sent to this session, if any. */
  lastPromptOf(sessionId: string): string | null {
    return this.lastPrompts.get(sessionId) ?? null;
  }

  rememberLastPrompt(sessionId: string, prompt: string): void {
    this.lastPrompts.set(sessionId, prompt);
  }

  private lastPrompts = new Map<string, string>();
}
