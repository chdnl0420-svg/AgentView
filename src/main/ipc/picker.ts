import { BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { IPC } from '@shared/ipc-contracts';

export function registerPicker(): void {
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
}
