import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EVT, IPC } from '@shared/ipc-contracts';
import { scanSessions } from './sessionScanner';
import { readConversation } from './conversationLoader';
import { JobRunner } from './jobRunner';
import { parseAgentFile } from './frontmatter';
import { LiveWatcher } from './liveWatcher';
import type { AgentInfo, NewJobInput } from '@shared/types';

const jobs = new JobRunner();
const liveWatcher = new LiveWatcher();

function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
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

export function registerIpc(): void {
  liveWatcher.on('sessions-changed', () => broadcast(EVT.SessionsChanged));
  liveWatcher.on('session-updated', (s) => broadcast(EVT.SessionUpdated, s));
  liveWatcher.on('conversation-appended', (a) => broadcast(EVT.ConversationAppended, a));
  liveWatcher.start();

  ipcMain.handle(IPC.SessionsList, async () => scanSessions());
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

  ipcMain.handle(IPC.AgentsList, async () => loadAgents());

  ipcMain.handle(IPC.JobsStart, async (_e, input: NewJobInput) => jobs.start(input));
  ipcMain.handle(IPC.JobsList, async () => jobs.list());
  ipcMain.handle(IPC.JobsCancel, async (_e, jobId: string) => jobs.cancel(jobId));
  ipcMain.handle(IPC.JobsRead, async (_e, jobId: string) => jobs.get(jobId));

  ipcMain.handle(IPC.PickDirectory, async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      defaultPath: defaultPath || homedir()
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  jobs.on('event', (evt) => broadcast(EVT.JobEvent, evt));
  jobs.on('updated', (j) => broadcast(EVT.JobUpdated, j));
}

export function shutdownIpc(): void {
  liveWatcher.stop();
  liveWatcher.unwatchAll();
  jobs.disposeAll();
}
