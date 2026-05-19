import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { ClaudeRunEvent, NewSessionInput, ResumeMessageInput } from '@shared/types';
import { sendToBackgroundAgent } from './daemonAttach';
import { createWorktree } from './git';
import { rememberOwned } from './ownedSessions';

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
const DISPATCH_POLL_MS = 200;
// ~10 seconds. The old 2.4 s budget was too tight on slow machines and would
// silently fall back to Strategy B (direct PTY spawn), which produces a
// kind:"interactive" session that never appears in `claude agents`. Waiting
// longer keeps the registration in the bg-worker path so the new session
// actually shows up on the CLI side.
const DISPATCH_POLL_TRIES = 50;

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
}): Promise<number | null> {
  const short = args.sessionId.slice(0, 8);
  const launchArgs: string[] = ['--session-id', args.sessionId];
  if (args.agent) launchArgs.push('--agent', args.agent);
  if (args.model) launchArgs.push('--model', args.model);
  if (args.name) launchArgs.push('--name', args.name);
  // Propagate the user's permission selection into the bg worker spawn.
  // Without this, the daemon's claude defaults to "default" which blocks
  // on every tool prompt — invisible to AgentView.
  const permMode = (args.permissionMode || 'bypassPermissions').trim();
  launchArgs.push('--permission-mode', permMode);

  const payload = {
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
  try {
    await fsp.mkdir(DISPATCH_DIR, { recursive: true });
    const target = join(DISPATCH_DIR, `${short}.json`);
    await fsp.writeFile(target, JSON.stringify(payload), 'utf8');
    console.log('[runner] dispatched', short, 'cwd:', args.cwd);
  } catch (err) {
    console.error('[runner] dispatch write failed', err);
    return null;
  }
  for (let i = 0; i < DISPATCH_POLL_TRIES; i++) {
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
      permissionMode: input.permissionMode || null
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
      return { sessionId, pid: dispatchPid };
    }

    // Strategy B — fallback to direct PTY spawn. Used when the daemon isn't
    // up or didn't register a worker within the polling window. The session
    // is created as kind:"interactive" so it won't show in `claude agents`,
    // but at least the user gets a working chat.
    console.warn('[runner] daemon dispatch unavailable, falling back to direct PTY spawn');
    const slot = this.spawn(
      sessionId,
      ['--session-id', sessionId],
      { ...input, cwd: spawnCwd },
      input.prompt
    );
    if (!slot) return { sessionId, pid: null };
    slot.promptDelivered = true;
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
    slot.outputBuf = (slot.outputBuf + cleaned).slice(-6000);

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
