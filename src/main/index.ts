import { app, BrowserWindow, Menu, protocol, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { registerIpc, shutdownIpc } from './ipc';
import { refreshDesktopShortcut } from './desktopShortcut';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8'
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'av-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false, stream: true }
  }
]);

const isDev = !!process.env.ELECTRON_RENDERER_URL;
if (isDev || process.env.AGENTVIEW_DEBUG_PORT) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env.AGENTVIEW_DEBUG_PORT || '9222'
  );
}

// Never let a stray async error in the main process tear down the whole
// window — log and keep running. Without this, an unhandled rejection in the
// cancel loop or daemon attach can take the app down.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection', reason);
});

function resolveIconPath(): string {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(__dirname, '../../resources', file);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'AgentView · Claude Code Background Agents',
    icon: resolveIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => win.show());

  // Anchors in chat messages have target="_blank". When the renderer asks
  // the runtime to open one, route it through the OS browser instead of
  // letting Electron spawn a child BrowserWindow inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[main] window-open intercepted:', url);
    if (/^(https?:|mailto:)/i.test(url)) {
      shell.openExternal(url).catch((err) => {
        console.error('[main] openExternal failed', err);
      });
    }
    return { action: 'deny' };
  });
  // Defensive: if any anchor without target tries an in-app navigation,
  // bounce it to the system browser instead of replacing our SPA.
  win.webContents.on('will-navigate', (event, url) => {
    const currentUrl = win.webContents.getURL();
    if (url !== currentUrl && /^(https?:|mailto:)/i.test(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {
        /* ignore */
      });
    }
  });

  // Standard Windows-style right-click menu on every input/textarea so the
  // user can cut/copy/paste/select all without keyboard shortcuts. Electron
  // doesn't show this by default — without it, right-click on the composer
  // does nothing. The 'role' shortcuts let Chromium handle the clipboard
  // commands natively, so this works for IME / Korean text too.
  win.webContents.on('context-menu', (_event, params) => {
    const isEditable = !!params.isEditable;
    const hasSelection = !!(params.selectionText && params.selectionText.length > 0);
    const template: MenuItemConstructorOptions[] = [];
    if (isEditable) {
      template.push(
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기', enabled: hasSelection },
        { role: 'copy', label: '복사', enabled: hasSelection },
        { role: 'paste', label: '붙여넣기' },
        { role: 'pasteAndMatchStyle', label: '서식 없이 붙여넣기' },
        { type: 'separator' },
        { role: 'selectAll', label: '모두 선택' }
      );
    } else if (hasSelection) {
      template.push(
        { role: 'copy', label: '복사' },
        { type: 'separator' },
        { role: 'selectAll', label: '모두 선택' }
      );
    } else {
      // Plain area (no editable target, no selection) — suppress the
      // context menu entirely. The user explicitly asked that "모두 선택"
      // not appear on dashboard labels / cards, because it lets them
      // accidentally select chrome text and then drag-select more.
      return;
    }
    Menu.buildFromTemplate(template).popup({ window: win });
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.visualagents.app');
  // Serve local files for image previews / file links inside the renderer.
  protocol.handle('av-file', async (request) => {
    // We expect URLs of the form:
    //   av-file://local/<drive>/<rest>   (Windows: drive letter as path seg 1)
    //   av-file://local/abs/<rest>       (POSIX absolute)
    const raw = request.url;
    let after = raw.replace(/^av-file:\/\/(?:[^/]*)?\//, '');
    after = after.split('?')[0].split('#')[0];
    let decoded: string;
    try {
      decoded = decodeURI(after);
    } catch {
      decoded = decodeURIComponent(after);
    }
    let pathname: string;
    const driveMatch = /^([a-zA-Z])\/(.*)$/.exec(decoded);
    if (driveMatch) {
      pathname = `${driveMatch[1].toUpperCase()}:/${driveMatch[2]}`;
    } else if (decoded.startsWith('abs/')) {
      pathname = '/' + decoded.slice(4);
    } else {
      pathname = decoded;
    }
    if (process.platform === 'win32') pathname = pathname.replace(/\//g, '\\');
    try {
      const data = await fs.readFile(pathname);
      const dot = pathname.lastIndexOf('.');
      const ext = dot > 0 ? pathname.slice(dot + 1).toLowerCase() : '';
      const type = MIME[ext] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[av-file] read failed', pathname, '←', raw, msg);
      return new Response(`not found: ${msg}`, { status: 404 });
    }
  });
  registerIpc();
  // Keep the bundled desktop shortcut pointing at the current build so the
  // user's "AgentView" icon on the desktop always launches the latest exe.
  // Runs async; failures are logged but don't block startup.
  refreshDesktopShortcut();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  shutdownIpc();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  shutdownIpc();
});
