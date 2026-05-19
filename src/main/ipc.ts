import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EVT, IPC } from '@shared/ipc-contracts';
import { externalSessionState, isExternalSessionAlive, scanSessions } from './sessionScanner';
import {
  sendKeyToBackgroundAgent,
  sendToBackgroundAgent,
  tailAgentOutput,
  type AgentOutputHandle
} from './daemonAttach';
import { PromptScanner } from './promptDetector';
import { fetchUsage } from './usageApi';
import { listBuiltinCommands } from './builtinCommands';
import { readConversation } from './conversationLoader';
import { SessionRunner } from './sessionRunner';
import { parseAgentFile } from './frontmatter';
import { LiveWatcher } from './liveWatcher';
import { listBranches, suggestWorktreePath } from './git';
import { ensureOwnedLoaded } from './ownedSessions';
import { markHidden } from './hiddenSessions';
import type {
  AgentInfo,
  NewSessionInput,
  ResumeMessageInput,
  RunningSessionInfo,
  SlashCommandEntry
} from '@shared/types';

const runner = new SessionRunner();
const liveWatcher = new LiveWatcher();

function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}

async function loadCommands(): Promise<SlashCommandEntry[]> {
  const dirs = [
    { p: join(homedir(), '.claude', 'commands'), scope: 'user' as const },
    { p: join(process.cwd(), '.claude', 'commands'), scope: 'project' as const }
  ];
  const out: SlashCommandEntry[] = [];
  const seen = new Set<string>();
  // Built-in CLI commands ship first so they show up alongside user/project
  // markdown commands and are still overridable by name (user/project win
  // because we add them later in the loop and dedup before pushing).
  for (const b of listBuiltinCommands()) {
    out.push(b);
    seen.add(b.name);
  }
  for (const d of dirs) {
    try {
      const entries = await fs.readdir(d.p);
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.md')) continue;
        if (entry.includes('.bak')) continue;
        const filePath = join(d.p, entry);
        const name = entry.replace(/\.md$/i, '');
        if (seen.has(name)) continue;
        seen.add(name);
        let description = '';
        try {
          const raw = await fs.readFile(filePath, 'utf8');
          const m = /^---\s*\n([\s\S]*?)\n---/.exec(raw);
          if (m) {
            const descMatch = /^description:\s*(.+)$/m.exec(m[1]);
            if (descMatch) description = descMatch[1].replace(/^["']|["']$/g, '').trim();
          }
          if (!description) {
            const firstNonEmpty = raw
              .replace(/^---[\s\S]*?---\n?/, '')
              .split(/\r?\n/)
              .find((l) => l.trim().length > 0);
            description = firstNonEmpty ? firstNonEmpty.slice(0, 120) : '';
          }
        } catch {
          /* ignore */
        }
        out.push({ name, scope: d.scope, description, filePath });
      }
    } catch {
      /* dir missing */
    }
  }
  out.sort((a, b) => {
    const order = { project: 0, user: 1, builtin: 2 } as const;
    const oa = order[a.scope];
    const ob = order[b.scope];
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name, 'ko');
  });
  return out;
}

async function loadAgents(): Promise<AgentInfo[]> {
  const dirs = [
    { p: join(homedir(), '.claude', 'agents'), scope: 'user' as const },
    { p: join(process.cwd(), '.claude', 'agents'), scope: 'project' as const }
  ];
  const out: AgentInfo[] = [];
  for (const d of dirs) {
    try {
      const entries = await fs.readdir(d.p);
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.md')) continue;
        if (entry.includes('.bak')) continue;
        const filePath = join(d.p, entry);
        try {
          const raw = await fs.readFile(filePath, 'utf8');
          out.push(parseAgentFile(filePath, raw, d.scope));
        } catch {
          /* skip */
        }
      }
    } catch {
      /* dir missing */
    }
  }
  out.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko');
  });
  return out;
}

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

function runningList(): RunningSessionInfo[] {
  const out: RunningSessionInfo[] = [];
  for (const [sid, pid] of runner.pidsBySession()) {
    out.push({ sessionId: sid, pid, startedAt: Date.now() });
  }
  return out;
}

export function registerIpc(): void {
  liveWatcher.on('sessions-changed', () => broadcast(EVT.SessionsChanged));
  // session-updated fires for every meta file in ~/.claude/sessions/, including
  // CLI interactive (REPL) chats. Drop those so the renderer's grid only ever
  // sees the same set CLI `claude agents` would show.
  liveWatcher.on('session-updated', async (s) => {
    const owned = await ensureOwnedLoaded();
    const kind = (s.kind || '').toLowerCase();
    if (kind === 'bg' || kind === 'app' || owned.has(s.sessionId)) {
      broadcast(EVT.SessionUpdated, s);
    }
  });
  liveWatcher.on('conversation-appended', (a) => broadcast(EVT.ConversationAppended, a));
  liveWatcher.start();

  runner.on('event', (e) => broadcast(EVT.ClaudeRunEvent, e));
  runner.on('procs-changed', () => broadcast(EVT.RunningChanged, runningList()));

  ipcMain.handle(IPC.SessionsList, async () => {
    const [agentsList, owned] = await Promise.all([loadAgents(), ensureOwnedLoaded()]);
    const agentNames = new Set(agentsList.map((a) => a.name));
    // Scanner now reads exclusively from ~/.claude/jobs/<short>/state.json
    // which is the same source `claude agents` uses — no further filtering
    // is needed here. owned + knownAgentNames are still passed for back-
    // compat with the ScanFilter interface, but the scanner no longer
    // consults them.
    return scanSessions(runner.pidsBySession(), runner.activePids(), {
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

  ipcMain.handle(IPC.SessionsNew, async (_e, input: NewSessionInput) => runner.startNewSession(input));
  ipcMain.handle(IPC.SessionsResume, async (_e, input: ResumeMessageInput) => {
    // Our PTY → type into the same stdin.
    if (runner.hasSession(input.sessionId)) {
      return runner.resumeSession(input);
    }
    // External alive → attach to the claude daemon's worker pipe directly.
    // claude TUI uses the same channel, so the agent picks up our text as
    // a normal user message in the same sid.
    const externalAlive = await isExternalSessionAlive(input.sessionId);
    if (externalAlive) {
      const result = await sendToBackgroundAgent(input.sessionId, input.prompt);
      if (result.ok) {
        return { sessionId: input.sessionId, pid: result.pid };
      }
      throw new Error(
        `ATTACH_FAILED: 외부 에이전트에 메시지를 전달하지 못했습니다 (${result.reason}). ` +
          `이 경우 분기로 진행하세요.`
      );
    }
    // External dead → resume is safe (no pid conflict).
    return runner.resumeSession(input);
  });
  ipcMain.handle(IPC.SessionsFork, async (_e, input: ResumeMessageInput) => runner.forkSession(input));
  ipcMain.handle(IPC.SessionsCancel, async (_e, sessionId: string) => {
    // Our PTY → kill it.
    if (runner.hasSession(sessionId)) {
      return runner.cancel(sessionId);
    }
    // External alive → retry loop: claude may not accept ESC in some modal
    // states (waiting for tool result, etc.). We poll until the worker is
    // idle / dead, up to MAX_TRIES, so the user only has to press once.
    const externalAlive = await isExternalSessionAlive(sessionId);
    if (!externalAlive) return false;

    runCancelLoop(sessionId).catch((err) => {
      console.error('[cancel] background loop failed', err);
    });
    return true; // we accepted the request; user doesn't need to retry
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

  ipcMain.handle(IPC.AgentsList, async () => loadAgents());
  ipcMain.handle(IPC.CommandsList, async () => loadCommands());

  ipcMain.handle(IPC.PickDirectory, async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      defaultPath: defaultPath || homedir()
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });
  ipcMain.handle(IPC.PickFiles, async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      defaultPath: defaultPath || homedir()
    });
    if (res.canceled) return [];
    return res.filePaths;
  });
  ipcMain.handle(IPC.GitBranches, async (_e, cwd: string) => listBranches(cwd));
  ipcMain.handle(IPC.GitDefaultWorktreePath, async (_e, cwd: string, branchOrSuffix: string) =>
    suggestWorktreePath(cwd, branchOrSuffix)
  );
  ipcMain.handle(IPC.SavePastedImage, async (_e, buffer: ArrayBuffer, ext: string) => {
    try {
      const safeExt = /^[a-zA-Z0-9]+$/.test(ext) ? ext.toLowerCase() : 'png';
      const dir = join(homedir(), '.claude', 'agentview-pastes');
      await fs.mkdir(dir, { recursive: true });
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .replace('Z', '');
      const filePath = join(dir, `paste-${stamp}.${safeExt}`);
      await fs.writeFile(filePath, Buffer.from(buffer));
      return filePath;
    } catch (err) {
      console.error('[paste] save failed', err);
      return null;
    }
  });

  ipcMain.handle(IPC.UpdaterCheck, async () => checkUpdate());
  ipcMain.handle(IPC.UpdaterDownload, async () => {
    try {
      const info = await checkUpdate();
      if (!info.available) return { ok: false, reason: 'NO_UPDATE' };
      await downloadAndInstall(info, (pct) => broadcast(EVT.UpdaterProgress, pct));
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(IPC.UpdaterOpenReleasePage, async () => {
    const info = await checkUpdate();
    revealReleasePage(info);
  });
  ipcMain.handle(IPC.AppVersion, async () => app.getVersion());
  ipcMain.handle(IPC.UsageFetch, async () => fetchUsage());
  ipcMain.handle(IPC.SessionsDelete, async (_e, sessionIds: string[]) => {
    // Layered deletion. The claude daemon respawns workers (attempt counter
    // visible in roster.json) and re-creates jobs/<short>/ after we wipe it,
    // so a bare "kill PID + rm dir" loses the race within seconds. We try
    // every layer the daemon could read from, and then mark the sessionId
    // as hidden so the UI ignores it even if the daemon brings it back.
    //
    //   A) Remove daemon spawn-cues: dispatch/<short>.json + pty-pids/<short>.pid
    //   B) Drop the worker from roster.json so the supervisor can't see it
    //   C) Kill the live worker PID, then wipe jobs/<short>/
    //   D) Record the sessionId in agentview-hidden.json as the UI safety net
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

        // D) Mark hidden first — scanSessions filters this immediately so the
        // card disappears from the grid even if a respawn races us.
        await markHidden(sid);

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

    return { ok: failed.length === 0, deleted, failed };
  });
  ipcMain.handle(IPC.ShellOpenPath, async (_e, p: string) => {
    try {
      const err = await shell.openPath(p);
      if (err) return { ok: false, reason: err };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function shutdownIpc(): void {
  liveWatcher.stop();
  liveWatcher.unwatchAll();
  runner.disposeAll();
}
