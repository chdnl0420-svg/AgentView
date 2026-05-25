import { BrowserWindow } from 'electron';

/** Send an IPC event to every open browser window. */
export function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}
