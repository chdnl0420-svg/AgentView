import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { BackendKind, ClaudeRunEvent, NewSessionInput, ResumeMessageInput } from '@shared/types';
import { sendToBackgroundAgent } from './daemonAttach';
import { createWorktree } from './git';
import { rememberOwned } from './ownedSessions';
import { appendSessionEvent, updateSessionStatus, writeSessionDoc } from './workspaceStore';
import { createAvdClient } from './avdClient';
import { ensureAvdReady } from './avdDaemonLifecycle';
import {
  deriveSessionName,
  normalizeAgentBackend,
  normalizeInputBackend,
  resolveClaudeExe,
  routeBackend,
} from './sessionRunnerUtils';

// Re-export for callers that imported deriveSessionName from this module
// before the utils split — keeps existing import paths working.
export { deriveSessionName };

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

const ANSI_STRIP = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\]0;[^\x07]*\x07|\x1b[\(\)][A-Z0-9]|\x1b[=>]|\r/g;

const TRUST_MARKER = /trust this folder/i;
// Anything claude's prompt-box UI prints once it's ready to accept text.
const READY_MARKER =
  /How can I help|Tips for getting started|to interrupt|\/effort|to cycle|auto mode on|shift\+tab|Welcome back|Run \/init|Try ".+"/i;
const FALLBACK_DELIVER_MS = 12000;

type CreateAvdClient = typeof createAvdClient;
type EnsureAvdReady = typeof ensureAvdReady;

interface SessionRunnerOptions {
  createAvdClient?: CreateAvdClient;
  /** Override for tests. Production uses the singleton `ensureAvdReady`
   *  exported by `./avdDaemonLifecycle`. */
  ensureAvdReady?: EnsureAvdReady;
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
  private readonly ensureAvdReady: EnsureAvdReady;

  constructor(options: SessionRunnerOptions = {}) {
    super();
    this.createAvdClient = options.createAvdClient ?? createAvdClient;
    this.ensureAvdReady = options.ensureAvdReady ?? ensureAvdReady;
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
    return this.startViaAvd(
      sessionId,
      { ...input, backend: route.worker },
      spawnCwd,
    );
  }

  private async startViaAvd(
    sessionId: string,
    input: NewSessionInput,
    cwd: string
  ): Promise<{ sessionId: string; pid: number | null; forkedFrom?: null }> {
    // Lazy-spawn the avd daemon before any CTRL frame. If the spawn
    // (or the wait-for-ready poll) fails, surface a clean error event
    // to the renderer instead of letting `createAvdClient` raise a raw
    // ECONNREFUSED. Idempotent — a no-op when the daemon is already up.
    try {
      await this.ensureAvdReady();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('event', {
        sessionId,
        type: 'error',
        message: `avd 데몬 자동 시작 실패: ${message}`,
        ts: Date.now()
      } satisfies ClaudeRunEvent);
      appendSessionEvent(sessionId, 'error', `avd-daemon-start-failed: ${message}`).catch(() => undefined);
      return { sessionId, pid: null };
    }
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
