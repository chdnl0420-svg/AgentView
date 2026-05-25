import { app, BrowserWindow, ipcMain, Notification, nativeImage, shell } from 'electron';
import { EVT, IPC } from '@shared/ipc-contracts';
import { checkUpdate, downloadAndInstall, revealReleasePage } from '../updater';
import { fetchUsage } from '../usageApi';
import { listBranches, suggestWorktreePath } from '../git';
import { checkClaudeStatus } from '../claudePreflight';
import { broadcast } from './broadcast';

const FEEDBACK_URL = 'https://github.com/chdnl0420-svg/AgentView-Release/issues/new';

/**
 * Generate a tiny PNG overlay icon showing `n` (1-99) for the taskbar overlay
 * badge. Returns null when n <= 0 so callers can `setOverlayIcon(null)` to clear.
 */
function buildBadgeIcon(n: number): Electron.NativeImage | null {
  if (n <= 0) return null;
  const size = 16;
  const display = n > 99 ? '99+' : String(n);
  // 16x16 RGBA bitmap rendered as a flat colored circle with text. We draw
  // by manually filling pixels — keeps the dependency surface zero. The
  // resulting image is intentionally crude; the OS scales it for the
  // overlay icon position so 16x16 is enough.
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 0.5;
  // Crashed-style red so the user notices N active jobs at a glance.
  const fillR = 244, fillG = 116, fillB = 116;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const inside = dx * dx + dy * dy <= r * r;
      const idx = (y * size + x) * 4;
      if (inside) {
        pixels[idx] = fillR;
        pixels[idx + 1] = fillG;
        pixels[idx + 2] = fillB;
        pixels[idx + 3] = 255;
      } else {
        pixels[idx + 3] = 0;
      }
    }
  }
  const img = nativeImage.createFromBuffer(pixels, { width: size, height: size });
  // Electron doesn't expose a canvas to render `display`, so we lean on
  // setOverlayIcon's accessible description for screen readers. The colored
  // circle is the visual cue; the number lives in the tooltip.
  void display;
  return img;
}

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

  // ----- impl-100 batch A: window/app convenience IPCs -----
  ipcMain.handle(IPC.AppToggleFullscreen, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow();
    if (!win) return false;
    const next = !win.isFullScreen();
    win.setFullScreen(next);
    return next;
  });

  ipcMain.handle(IPC.AppSetSessionStats, async (e, stats: { active: number; total: number } | undefined) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow();
    if (!win) return;
    const active = Math.max(0, stats?.active ?? 0);
    try {
      if (process.platform === 'win32') {
        const icon = buildBadgeIcon(active);
        win.setOverlayIcon(icon, active > 0 ? `${active}개 세션 실행 중` : '');
      } else if (process.platform === 'darwin') {
        app.dock?.setBadge?.(active > 0 ? String(active) : '');
      }
    } catch {
      /* ignore platform-specific failures */
    }
  });

  ipcMain.handle(IPC.AppOpenDevTools, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow();
    win?.webContents.openDevTools({ mode: 'detach' });
  });

  ipcMain.handle(IPC.AppOpenFeedback, async () => {
    await shell.openExternal(FEEDBACK_URL).catch(() => undefined);
  });

  ipcMain.handle(
    IPC.AppShowNotification,
    async (
      e,
      input: { title: string; body: string; sessionId?: string; kind?: 'info' | 'success' | 'error' } | undefined
    ) => {
      if (!input || !Notification.isSupported()) return;
      const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow();
      const note = new Notification({
        title: input.title || 'AgentView',
        body: input.body || '',
        silent: input.kind !== 'error'
      });
      note.on('click', () => {
        if (!win) return;
        if (!win.isVisible()) win.show();
        if (win.isMinimized()) win.restore();
        win.focus();
        win.webContents.send('notification:click', { sessionId: input.sessionId });
      });
      note.show();
    }
  );
}
