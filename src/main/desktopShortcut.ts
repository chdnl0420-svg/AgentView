import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { app } from 'electron';

/**
 * Refreshes the desktop shortcut for AgentView so double-clicking it always
 * launches the *current* build. The shortcut points at the electron.exe the
 * app is currently running through (so a rebuild + relaunch keeps it valid)
 * and writes the resources/icon.ico for proper desktop visuals.
 *
 * Runs on every app launch (Windows only). Failures are logged but don't
 * affect the rest of startup — the shortcut is a convenience, not a
 * blocking requirement.
 */
export function refreshDesktopShortcut(): void {
  if (platform() !== 'win32') return;

  const desktop = join(homedir(), 'Desktop');
  if (!existsSync(desktop)) return;

  const shortcutPath = join(desktop, 'AgentView.lnk');
  // process.execPath is the electron.exe currently hosting us. When running
  // unpackaged via `node_modules\electron\dist\electron.exe .`, this is the
  // bundled Electron runtime. When packaged later, it'll be AgentView.exe.
  const target = process.execPath;
  // When unpackaged we need to pass the project root as the first argument
  // ("." in cwd) so Electron knows which app to load. Packaged builds embed
  // the app, so no argument is needed.
  const projectRoot = app.isPackaged
    ? resolve(app.getAppPath(), '..')
    : resolve(__dirname, '..', '..');
  const args = app.isPackaged ? '' : '"' + projectRoot + '"';
  const workingDir = projectRoot;
  const iconCandidates = [
    join(projectRoot, 'resources', 'icon.ico'),
    join(process.resourcesPath || '', 'icon.ico')
  ];
  const icon = iconCandidates.find((p) => p && existsSync(p)) || target;

  // PowerShell COM call. Single-quote strings in PowerShell are literal
  // (no interpolation, no backtick escapes), so as long as our paths don't
  // contain ASCII single quotes we're safe. Doubled single quote escapes
  // any that do appear.
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const script = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut(${q(shortcutPath)})`,
    `$s.TargetPath = ${q(target)}`,
    `$s.Arguments = ${q(args)}`,
    `$s.WorkingDirectory = ${q(workingDir)}`,
    `$s.IconLocation = ${q(icon)}`,
    `$s.Description = 'AgentView - Claude background agents'`,
    `$s.Save()`,
    `Write-Output 'OK'`
  ].join('; ');

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    { windowsHide: true },
    (err, stdout, stderr) => {
      if (err) {
        console.error('[desktop-shortcut] refresh failed:', err.message);
        return;
      }
      const out = (stdout || '').trim();
      if (out !== 'OK') {
        console.warn('[desktop-shortcut] unexpected output:', out, stderr);
        return;
      }
      console.log('[desktop-shortcut] refreshed →', shortcutPath, '(target:', target + ')');
    }
  );
}
