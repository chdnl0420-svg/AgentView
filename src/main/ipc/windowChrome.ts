import { app, BrowserWindow, clipboard, ipcMain, nativeImage, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { IPC } from '@shared/ipc-contracts';

/**
 * Custom title-bar IPC + options popover + shell helpers triggered from
 * the renderer's `<WindowChrome />`. We resolve the BrowserWindow from
 * `event.sender` so multi-window setups can't accidentally control the
 * wrong frame.
 */
export function registerWindowChrome(): void {
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

  ipcMain.handle(IPC.ShellOpenPath, async (_e, p: string) => {
    try {
      const err = await shell.openPath(p);
      if (err) return { ok: false, reason: err };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
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
}
