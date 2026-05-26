import { app, ipcMain } from 'electron';
import { EVT, IPC } from '@shared/ipc-contracts';
import { checkUpdate, downloadAndInstall, revealReleasePage } from '../updater';
import { fetchUsage } from '../usageApi';
import { listBranches, suggestWorktreePath } from '../git';
import { checkClaudeStatus } from '../claudePreflight';
import { broadcast } from './broadcast';

/**
 * Misc surface — git inspection for worktrees, in-app updater, Claude CLI
 * preflight, app metadata, usage telemetry. Each is independent and tiny;
 * grouping them avoids ten 10-line files.
 */
export function registerMisc(): void {
  // Git surface used by the worktree composer chips.
  ipcMain.handle(IPC.GitBranches, async (_e, cwd: string) => listBranches(cwd));
  ipcMain.handle(IPC.GitDefaultWorktreePath, async (_e, cwd: string, branchOrSuffix: string) =>
    suggestWorktreePath(cwd, branchOrSuffix)
  );

  // Updater.
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

  // App + Claude CLI preflight + usage.
  ipcMain.handle(IPC.AppVersion, async () => app.getVersion());
  ipcMain.handle(IPC.UsageFetch, async () => fetchUsage());
  ipcMain.handle(IPC.ClaudeStatus, async (_e, force?: boolean) => checkClaudeStatus(!!force));
}
