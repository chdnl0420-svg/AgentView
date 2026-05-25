import { ipcMain, shell } from 'electron';
import { IPC } from '@shared/ipc-contracts';
import {
  listSessionSummaries,
  readSessionDoc,
  renderReportHtml,
  workspaceRoot
} from '../workspaceStore';

/**
 * Workspace surface — per-session `.md` docs and exported HTML reports
 * under `<userData>/.claude/agentview/workspace/`. The renderer reads this
 * to surface interrupted tasks on launch and to export reports.
 */
export function registerWorkspace(): void {
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
}
