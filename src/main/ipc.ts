import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { homedir } from 'node:os';
import { EVT, IPC } from '@shared/ipc-contracts';
import { checkUpdate, downloadAndInstall, revealReleasePage } from './updater';
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
import { checkClaudeStatus, ensureDaemonRunning } from './claudePreflight';
import {
  appendSessionEvent,
  listSessionSummaries,
  readSessionDoc,
  renderReportHtml,
  updateSessionStatus,
  workspaceRoot
} from './workspaceStore';
import type {
  AgentInfo,
  NewSessionInput,
  PermissionMode,
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
        appendSessionEvent(input.sessionId, 'resume', `prompt=${input.prompt.slice(0, 60)}`).catch(() => undefined);
        return { sessionId: input.sessionId, pid: result.pid };
      }
      // The daemon may have died between scan and dispatch. Try one bootstrap
      // + retry before reporting the failure to the user — that's exactly the
      // "Claude Code wasn't running, just start it" UX requested for 1.0.4.
      const status = await checkClaudeStatus(true);
      if (status.cliPath && !status.daemonAlive) {
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

  // ----- Workspace (.claude/agentview/workspace) — per-session .md +
  //       reports/ html. Used by the renderer to surface interrupted tasks
  //       on launch and to export reports when the user asks.
  ipcMain.handle(IPC.WorkspaceList, async () => listSessionSummaries());
  ipcMain.handle(IPC.WorkspaceRead, async (_e, sessionId: string) => readSessionDoc(sessionId));
  ipcMain.handle(IPC.WorkspaceExportReport, async (_e, sessionId: string) => {
    try {
      const md = await readSessionDoc(sessionId);
      if (!md) return { ok: false, reason: 'NOT_FOUND' };
      const reportPath = await renderReportHtml({
        title: `AgentView Session ${sessionId.slice(0, 8)} Report`,
        markdown: md,
        reportId: `session-${sessionId.slice(0, 8)}`
      });
      // Open the html report in the OS default browser per CLAUDE.md
      // Section 6.3.1 (D) — user clicks → real browser.
      shell.openPath(reportPath).catch(() => undefined);
      return { ok: true, path: reportPath };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(IPC.WorkspaceOpenRoot, async () => {
    await shell.openPath(workspaceRoot()).catch(() => undefined);
  });

  // ----- Claude Code preflight status. The renderer polls this on launch
  //       (and on submit failure) so it can show a "CLI 가 없음 / 데몬 깨우는 중"
  //       banner instead of falling into an empty 10s wait. Goal 5 of 1.0.4.
  ipcMain.handle(IPC.ClaudeStatus, async (_e, force?: boolean) => {
    const status = await checkClaudeStatus(!!force);
    return status;
  });

  // ----- 1.0.5 SessionDetail surface -----

  // File preview: returns a typed payload (markdown/text/html/image/json/
  // binary/too-large/missing) so the renderer modal can render the right
  // surface without ever calling fs itself.
  ipcMain.handle(IPC.FilePreview, async (_e, p: string) => {
    return previewFileForRenderer(p);
  });

  // Copy a single file onto the system clipboard so the user can paste it
  // into Explorer / another app. Windows requires CF_HDROP; Electron's
  // clipboard.write supports it via the writeBuffer API.
  ipcMain.handle(IPC.ShellCopyFile, async (_e, p: string) => {
    try {
      const stat = await fs.stat(p);
      if (!stat.isFile()) {
        return { ok: false, reason: 'NOT_A_FILE' };
      }
      // Cross-platform fallback: copy the path text + the image bitmap
      // (when applicable). On Windows the path alone is enough for most
      // paste targets (Explorer accepts text paths).
      if (process.platform === 'win32') {
        const ext = extname(p).toLowerCase();
        if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.bmp') {
          try {
            const img = nativeImage.createFromPath(p);
            if (!img.isEmpty()) clipboard.writeImage(img);
          } catch { /* ignore image clip */ }
        }
      }
      clipboard.writeText(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  // Patch the live session's permission mode. The current sessionRunner
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

  // ----- 1.0.5 window chrome + options popover -----
  // The renderer's <WindowChrome /> drives the OS window via these IPCs.
  // We deliberately resolve the window from the event sender so multi-window
  // setups don't accidentally minimise the wrong frame.
  ipcMain.handle(IPC.WindowMinimize, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.handle(IPC.WindowToggleMaximize, (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle(IPC.WindowClose, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
  ipcMain.handle(IPC.WindowIsMaximized, (e) => {
    return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle(IPC.OptionsGetAutostart, async () => {
    try {
      return !!app.getLoginItemSettings().openAtLogin;
    } catch {
      return false;
    }
  });
  ipcMain.handle(IPC.OptionsSetAutostart, async (_e, on: boolean) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
      return { ok: true };
    } catch (err) {
      console.error('[options] setAutostart failed', err);
      return { ok: false };
    }
  });
}

// ---- File preview helpers ----

const TEXT_EXTS = new Set([
  '.txt', '.log', '.csv', '.tsv', '.md', '.markdown', '.yml', '.yaml',
  '.toml', '.ini', '.cfg', '.conf', '.env',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.html', '.htm', '.xml', '.svg', '.css', '.scss',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.sql', '.gql', '.graphql'
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const HTML_EXTS = new Set(['.html', '.htm']);
const MD_EXTS = new Set(['.md', '.markdown']);
const JSON_EXTS = new Set(['.json']);
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_TEXT_BYTES = 512 * 1024; // truncate large text previews
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
};

interface FilePreviewPayload {
  kind:
    | 'html'
    | 'markdown'
    | 'text'
    | 'image'
    | 'json'
    | 'binary'
    | 'too-large'
    | 'missing';
  content?: string;
  dataUrl?: string;
  mime?: string;
  size?: number;
  reason?: string;
}

async function previewFileForRenderer(p: string): Promise<FilePreviewPayload> {
  if (!p || typeof p !== 'string') {
    return { kind: 'missing', reason: 'no path' };
  }
  let stat;
  try {
    stat = await fs.stat(p);
  } catch (err) {
    return {
      kind: 'missing',
      reason: err instanceof Error ? err.message : String(err)
    };
  }
  if (!stat.isFile()) {
    return { kind: 'missing', reason: 'not a file', size: stat.size };
  }
  const ext = extname(p).toLowerCase();
  // Image — always allowed even when "large" within the 2MB cap because a
  // jpg/png typically fits.
  if (IMAGE_EXTS.has(ext)) {
    if (stat.size > MAX_PREVIEW_BYTES) {
      return { kind: 'too-large', size: stat.size };
    }
    try {
      const buf = await fs.readFile(p);
      const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      return { kind: 'image', dataUrl, mime, size: stat.size };
    } catch (err) {
      return {
        kind: 'missing',
        reason: err instanceof Error ? err.message : String(err),
        size: stat.size
      };
    }
  }
  if (stat.size > MAX_PREVIEW_BYTES) {
    return { kind: 'too-large', size: stat.size };
  }
  if (HTML_EXTS.has(ext)) {
    const buf = await fs.readFile(p, 'utf8').catch(() => null);
    if (buf == null) return { kind: 'missing', reason: 'read failed', size: stat.size };
    return { kind: 'html', content: buf, mime: 'text/html', size: stat.size };
  }
  if (MD_EXTS.has(ext)) {
    const buf = await fs.readFile(p, 'utf8').catch(() => null);
    if (buf == null) return { kind: 'missing', reason: 'read failed', size: stat.size };
    return { kind: 'markdown', content: buf, mime: 'text/markdown', size: stat.size };
  }
  if (JSON_EXTS.has(ext)) {
    const buf = await fs.readFile(p, 'utf8').catch(() => null);
    if (buf == null) return { kind: 'missing', reason: 'read failed', size: stat.size };
    return { kind: 'json', content: buf, mime: 'application/json', size: stat.size };
  }
  if (TEXT_EXTS.has(ext) || stat.size <= MAX_TEXT_BYTES) {
    // Best-effort text read. If the file isn't valid utf-8 (e.g. an
    // unknown extension that is actually binary), bytes get replaced
    // characters — we accept that for preview.
    try {
      const buf = await fs.readFile(p);
      // Quick binary sniff — null byte in first 4KB → treat as binary.
      const head = buf.subarray(0, Math.min(buf.length, 4096));
      let hasNull = false;
      for (let i = 0; i < head.length; i++) {
        if (head[i] === 0) { hasNull = true; break; }
      }
      if (hasNull && !TEXT_EXTS.has(ext)) {
        return { kind: 'binary', size: stat.size };
      }
      let text = buf.toString('utf8');
      if (text.length > MAX_TEXT_BYTES) {
        text = text.slice(0, MAX_TEXT_BYTES) + '\n\n[…잘림 — 파일이 너무 큼…]';
      }
      return { kind: 'text', content: text, size: stat.size };
    } catch (err) {
      return {
        kind: 'missing',
        reason: err instanceof Error ? err.message : String(err),
        size: stat.size
      };
    }
  }
  return { kind: 'binary', size: stat.size };
}

export function shutdownIpc(): void {
  liveWatcher.stop();
  liveWatcher.unwatchAll();
  runner.disposeAll();
}
