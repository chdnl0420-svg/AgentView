import { ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EVT, IPC } from '@shared/ipc-contracts';
import type {
  NewSessionInput,
  PermissionMode,
  ResumeMessageInput,
  RunningSessionInfo
} from '@shared/types';
import { externalSessionState, isExternalSessionAlive, scanSessions } from '../sessionScanner';
import {
  sendKeyToBackgroundAgent,
  sendToBackgroundAgent,
  tailAgentOutput,
  type AgentOutputHandle
} from '../daemonAttach';
import { PromptScanner } from '../promptDetector';
import { ensureOwnedLoaded } from '../ownedSessions';
import { markHidden } from '../hiddenSessions';
import { checkClaudeStatus, ensureDaemonRunning } from '../claudePreflight';
import { appendSessionEvent } from '../workspaceStore';
import { readConversation } from '../conversationLoader';
import type { AvdSessionManager } from '../avd';
import type { LiveWatcher } from '../liveWatcher';
import { broadcast } from './broadcast';
import { loadAgents } from './loaders';

const cancelInFlight = new Set<string>();

async function runCancelLoop(sessionId: string): Promise<void> {
  if (cancelInFlight.has(sessionId)) return;
  cancelInFlight.add(sessionId);
  const MAX_TRIES = 15; // ~22s upper bound at 1.5s/try
  try {
    for (let i = 0; i < MAX_TRIES; i++) {
      try {
        await sendKeyToBackgroundAgent(sessionId, '\x1b', { repeat: 2, hold: 400 });
      } catch (err) {
        console.error('[cancel] sendKey failed', err);
      }
      await new Promise((res) => setTimeout(res, 1500));
      let state: Awaited<ReturnType<typeof externalSessionState>> | null = null;
      try {
        state = await externalSessionState(sessionId);
      } catch (err) {
        console.error('[cancel] state check failed', err);
      }
      if (!state || !state.alive) return;
      if (state.status === 'idle' || state.status === 'waiting' || state.status === 'finished') {
        return;
      }
    }
  } catch (err) {
    console.error('[cancel] loop crashed', err);
  } finally {
    cancelInFlight.delete(sessionId);
  }
}

interface SessionDeps {
  manager: AvdSessionManager;
  liveWatcher: LiveWatcher;
  runningList: () => RunningSessionInfo[];
}

export function registerSessions({ manager, liveWatcher, runningList }: SessionDeps): void {
  ipcMain.handle(IPC.SessionsList, async () => {
    const [agentsList, owned] = await Promise.all([loadAgents(), ensureOwnedLoaded()]);
    const agentNames = new Set(agentsList.map((a) => a.name));
    // Scanner now reads exclusively from ~/.claude/jobs/<short>/state.json
    // which is the same source `claude agents` uses — no further filtering
    // is needed here. owned + knownAgentNames are still passed for back-
    // compat with the ScanFilter interface, but the scanner no longer
    // consults them.
    return scanSessions(manager.pidsBySession(), manager.activePids(), {
      ownedSessionIds: owned,
      knownAgentNames: agentNames
    });
  });
  ipcMain.handle(IPC.SessionsRead, async (_e, sessionId: string) => readConversation(sessionId));
  ipcMain.handle(IPC.SessionsKill, async (_e, pid: number) => {
    try {
      process.kill(pid, 'SIGTERM');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(IPC.SessionsReveal, async (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
    return true;
  });
  ipcMain.handle(IPC.SessionsWatch, async (_e, sessionId: string) => {
    await liveWatcher.watchConversation(sessionId);
  });
  ipcMain.handle(IPC.SessionsUnwatch, async (_e, sessionId: string) => {
    liveWatcher.unwatchConversation(sessionId);
  });

  ipcMain.handle(IPC.SessionsNew, async (_e, input: NewSessionInput) => manager.spawn(input));
  ipcMain.handle(IPC.SessionsResume, async (_e, input: ResumeMessageInput) => {
    // Single seam: manager.status(sid) tells us PTY vs AVD vs gone. The
    // PTY/AVD branches route through manager.resume() — it picks the
    // delivery channel from the sessionTable kind. Gone falls back to
    // legacy daemon-attach (claude background-agent socket) so external
    // alive sessions get attached instead of respawned.
    const status = manager.status(input.sessionId);

    if (status.kind === 'running-by-us' && status.runner === 'avd') {
      try {
        // manager.resume() already records the "avd prompt=..." event
        // internally. Do not duplicate it here.
        return await manager.resume(input);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // avd daemon lost the handle (e.g. daemon restart). Drop tracking
        // so a retry falls through to legacy paths instead of looping on
        // UNKNOWN_SESSION forever.
        if (/UNKNOWN_SESSION|UNKNOWN_AVD_SESSION/.test(message)) {
          manager.untrack(input.sessionId);
        }
        throw new Error(`AVD_SEND_FAILED: ${message}`);
      }
    }

    if (status.kind === 'running-by-us' && status.runner === 'pty') {
      return manager.resume(input);
    }

    // External alive → attach to the claude daemon's worker pipe directly.
    // claude TUI uses the same channel, so the agent picks up our text as
    // a normal user message in the same sid.
    const externalAlive = await isExternalSessionAlive(input.sessionId);
    if (externalAlive) {
      const result = await sendToBackgroundAgent(input.sessionId, input.prompt);
      if (result.ok) {
        appendSessionEvent(input.sessionId, 'resume', `prompt=${input.prompt.slice(0, 60)}`).catch(() => undefined);
        return { sessionId: input.sessionId, pid: result.pid };
      }
      // The daemon may have died between scan and dispatch. Try one bootstrap
      // + retry before reporting the failure to the user — that's exactly the
      // "Claude Code wasn't running, just start it" UX requested for 1.0.4.
      const cliStatus = await checkClaudeStatus(true);
      if (cliStatus.cliPath && !cliStatus.daemonAlive) {
        await ensureDaemonRunning();
        const retry = await sendToBackgroundAgent(input.sessionId, input.prompt);
        if (retry.ok) {
          appendSessionEvent(
            input.sessionId,
            'resume',
            `recovered-after-bootstrap; prompt=${input.prompt.slice(0, 60)}`
          ).catch(() => undefined);
          return { sessionId: input.sessionId, pid: retry.pid };
        }
      }
      throw new Error(
        `ATTACH_FAILED: 외부 에이전트에 메시지를 전달하지 못했습니다 (${result.reason}). ` +
          `이 경우 분기로 진행하세요.`
      );
    }
    // External dead → respawn via manager (PtyRunner with --resume).
    return manager.resume(input);
  });
  ipcMain.handle(IPC.SessionsFork, async (_e, input: ResumeMessageInput) => {
    // AVD-tracked sessions cannot be forked — `claude --fork-session`
    // assumes a claude conversation file. Surface a clear, prefixed error
    // so the renderer can show an actionable toast instead of failing
    // opaquely when the user tries to branch an avd session.
    const status = manager.status(input.sessionId);
    if (status.kind === 'running-by-us' && status.runner === 'avd') {
      throw new Error(
        'FORK_NOT_SUPPORTED: avd 백엔드 세션은 분기를 지원하지 않습니다. 새 세션을 시작해주세요.'
      );
    }
    return manager.fork(input);
  });
  ipcMain.handle(IPC.SessionsCancel, async (_e, sessionId: string) => {
    // Single seam: manager.cancel() returns a discriminated union so we
    // branch cleanly without try/catch on a stringly-typed throw.
    const result = await manager.cancel(sessionId);
    switch (result.kind) {
      case 'cancelled':
        return true;
      case 'unknown-session': {
        // Not tracked here — last chance: maybe an external worker is alive.
        const externalAlive = await isExternalSessionAlive(sessionId);
        if (!externalAlive) return false;
        runCancelLoop(sessionId).catch((err) => {
          console.error('[cancel] background loop failed', err);
        });
        return true; // request accepted; user doesn't need to retry
      }
      case 'not-supported': {
        // AVD cancel CTRL not shipped yet (chunk-10). Release tracking
        // so future ops fall through to legacy paths, then try the
        // external cancel loop.
        manager.untrack(sessionId);
        console.warn('[ipc] avd cancel not supported, falling back', sessionId, result.reason);
        const externalAlive = await isExternalSessionAlive(sessionId);
        if (externalAlive) {
          runCancelLoop(sessionId).catch((err) => {
            console.error('[cancel] background loop failed', err);
          });
          return true;
        }
        return false;
      }
      case 'error':
        throw new Error(`AVD_CANCEL_FAILED: ${result.message}`);
    }
  });
  ipcMain.handle(IPC.SessionsRunningList, async () => runningList());

  // ---- Permission prompt detection ----
  // Per-session tail: open a ptySock listener while the renderer is viewing
  // this session, scan the stripped output for permission prompts, and emit
  // them as PermissionPrompt events. Closed on unwatchOutput.
  const outputTails = new Map<string, { handle: AgentOutputHandle; scanner: PromptScanner }>();

  ipcMain.handle(IPC.SessionsWatchOutput, async (_e, sessionId: string) => {
    if (outputTails.has(sessionId)) return;
    const scanner = new PromptScanner();
    const handle = tailAgentOutput(sessionId, (text) => {
      const hit = scanner.ingest(text);
      if (hit) {
        broadcast(EVT.PermissionPrompt, {
          sessionId,
          id: hit.id,
          question: hit.question,
          options: hit.options,
          detectedAt: Date.now()
        });
      }
    });
    outputTails.set(sessionId, { handle, scanner });
  });
  ipcMain.handle(IPC.SessionsUnwatchOutput, async (_e, sessionId: string) => {
    const entry = outputTails.get(sessionId);
    if (!entry) return;
    try { entry.handle.close(); } catch { /* ignore */ }
    outputTails.delete(sessionId);
  });
  ipcMain.handle(IPC.SessionsRenameJob, async (_e, sessionId: string, name: string | null) => {
    // Mirror the AgentView rename back into claude's own job state so the
    // CLI `claude agents` view shows the same title. Each session maps to
    // ~/.claude/jobs/<short>/state.json — we patch its `name` field and
    // bump nameSource to 'user' so claude doesn't auto-overwrite on the
    // next status flush.
    try {
      const short = sessionId.slice(0, 8);
      const sf = join(homedir(), '.claude', 'jobs', short, 'state.json');
      const raw = await fs.readFile(sf, 'utf8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (name && name.trim()) {
        data.name = name.trim();
        data.nameSource = 'user';
      } else {
        // Clearing the override — let claude re-derive automatically.
        delete data.name;
        data.nameSource = 'auto';
      }
      await fs.writeFile(sf, JSON.stringify(data, null, 2), 'utf8');
      return { ok: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, reason };
    }
  });

  ipcMain.handle(
    IPC.SessionsAnswerPrompt,
    async (_e, sessionId: string, key: string) => {
      const result = await sendKeyToBackgroundAgent(sessionId, key + '\r', {
        repeat: 1,
        hold: 600
      });
      const entry = outputTails.get(sessionId);
      if (entry) entry.scanner.reset();
      return result;
    }
  );

  ipcMain.handle(IPC.SessionsDelete, async (_e, sessionIds: string[]) => {
    // Layered deletion. The claude daemon respawns workers (attempt counter
    // visible in roster.json) and re-creates jobs/<short>/ after we wipe it,
    // so a bare "kill PID + rm dir" loses the race within seconds. We try
    // every layer the daemon could read from, and then mark the sessionId
    // as hidden so the UI ignores it even if the daemon brings it back.
    //
    //   D0) Mark hidden — UI safety net first (card disappears immediately)
    //   L0) Close local watchers/tails BEFORE wiping files so we don't keep
    //       reading a path that's about to vanish (avoids ENOENT churn and
    //       stale handles in our process).
    //   A) Remove daemon spawn-cues: dispatch/<short>.json + pty-pids/<short>.pid
    //   B) Drop the worker from roster.json so the supervisor can't see it
    //   C) Kill the live worker PID, then wipe jobs/<short>/
    //   L1) Cancel + untrack the local AvdSessionManager entry so follow-up
    //       actions can't reattach to a deleted session.
    const claudeDir = join(homedir(), '.claude');
    const daemonDir = join(claudeDir, 'daemon');
    const jobsDir = join(claudeDir, 'jobs');
    const rosterPath = join(daemonDir, 'roster.json');
    const deleted: string[] = [];
    const failed: Array<{ sessionId: string; reason: string }> = [];

    // Read the roster once; we'll rewrite it after collecting all PIDs.
    let roster: { workers?: Record<string, { pid?: number }> } | null = null;
    try {
      const raw = await fs.readFile(rosterPath, 'utf8');
      roster = JSON.parse(raw);
    } catch { /* roster missing */ }

    for (const sid of sessionIds) {
      try {
        const short = sid.slice(0, 8);

        // D0) Mark hidden first — scanSessions filters this immediately so
        // the card disappears from the grid even if a respawn races us.
        await markHidden(sid);

        // L0) Tear down OUR process's watchers/tails before wiping files.
        // Order matters: if the watcher polls a deleted jsonl it churns
        // ENOENT, and the prompt scanner on a dead ptySock leaks the FIFO
        // open handle.
        try { liveWatcher.unwatchConversation(sid); } catch { /* ignore */ }
        const tail = outputTails.get(sid);
        if (tail) {
          try { tail.handle.close(); } catch { /* ignore */ }
          outputTails.delete(sid);
        }

        // A) Remove daemon spawn-cues so a respawn can't reconstruct the
        // worker from a stale dispatch file or pid pin.
        await fs.rm(join(daemonDir, 'dispatch', `${short}.json`), { force: true });
        await fs.rm(join(daemonDir, 'pty-pids', `${short}.pid`), { force: true });

        // B) Drop from in-memory roster snapshot (written back below).
        const pid = roster?.workers?.[short]?.pid;
        if (roster?.workers && short in roster.workers) {
          delete roster.workers[short];
        }

        // C) Kill the live worker. Windows treats SIGTERM as TerminateProcess
        // for non-console targets, which is what we want here. ESRCH/EPERM
        // means the PID is already gone.
        if (pid && pid > 0) {
          try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
        }
        await fs.rm(join(jobsDir, short), { recursive: true, force: true });

        // L1) Drop in-memory references so the renderer can't bring back a
        // zombie via resume/cancel paths. cancel() kills the local PTY
        // for our slots; untrack drops the metadata. Both idempotent.
        try { await manager.cancel(sid); } catch { /* not a local slot */ }
        try { manager.untrack(sid); } catch { /* not tracked */ }

        deleted.push(sid);
      } catch (err) {
        failed.push({ sessionId: sid, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    // Write the roster back once at the end so concurrent writers (the
    // daemon itself) overlap with us minimally. If the daemon rewrites the
    // file before us we lose the edit, but the hidden list still blocks
    // the card from reappearing.
    if (roster) {
      try {
        await fs.writeFile(rosterPath, JSON.stringify(roster, null, 2), 'utf8');
      } catch { /* daemon may have rewritten — hidden list still protects UI */ }
    }

    // 렌더러 세션 리스트 강제 새로고침. liveWatcher 의 'sessions-changed'
    // 이벤트는 디렉터리 변화를 감지하지만 jobs/<short>/ 디렉터리 삭제만으로는
    // 트리거가 늦거나 안 됨 → 카드가 그대로 남아 사용자는 "삭제 안 됨" 으로
    // 보임. 명시적으로 SessionsChanged 를 broadcast 해 useSessionScan 이
    // reloadSessions() 를 실행하게 한다.
    if (deleted.length > 0) {
      broadcast(EVT.SessionsChanged);
    }

    return { ok: failed.length === 0, deleted, failed };
  });

  // Patch the live session's permission mode. The current AvdSessionManager
  // doesn't expose a hot-swap so we mirror the renderer's intent into the
  // session doc; subsequent send paths read this when respawning. Best
  // effort — failures don't block the UI.
  ipcMain.handle(IPC.SessionsSetPermission, async (_e, sessionId: string, mode: PermissionMode) => {
    try {
      await appendSessionEvent(
        sessionId,
        'permission-change',
        `mode=${mode}`
      ).catch(() => undefined);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.SessionsSetModel, async (_e, sessionId: string, model: string | null) => {
    try {
      await appendSessionEvent(
        sessionId,
        'model-change',
        `model=${model ?? 'default'}`
      ).catch(() => undefined);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}
