import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { app } from 'electron';

const AUMID = 'com.visualagents.app';

/**
 * Refreshes the desktop shortcut for AgentView so double-clicking it always
 * launches the *current* build. The shortcut points at the electron.exe the
 * app is currently running through (so a rebuild + relaunch keeps it valid)
 * and writes the resources/icon.ico for proper desktop visuals.
 *
 * Runs on every app launch (Windows only). Failures are logged but don't
 * affect the rest of startup — the shortcut is a convenience, not a
 * blocking requirement.
 *
 * Also self-heals the **taskbar-pinned** shortcut at
 *   %APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\AgentView.lnk
 * if the user pinned it before a reinstall. NSIS deletes $INSTDIR during
 * upgrade, which can make the pinned LNK go dead because Windows briefly
 * sees the target exe missing. Re-writing the LNK with a fresh target +
 * the same AppUserModelID re-anchors the pin to the new build.
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

  // Taskbar-pinned shortcut location. We only touch it if it already
  // exists — pinning is the user's choice; we just keep it pointing at the
  // freshly-installed exe instead of letting it go stale after an upgrade.
  const pinnedDir = join(
    homedir(),
    'AppData',
    'Roaming',
    'Microsoft',
    'Internet Explorer',
    'Quick Launch',
    'User Pinned',
    'TaskBar'
  );
  const pinnedShortcut = join(pinnedDir, 'AgentView.lnk');

  // PowerShell COM call. Single-quote strings in PowerShell are literal
  // (no interpolation, no backtick escapes), so as long as our paths don't
  // contain ASCII single quotes we're safe. Doubled single quote escapes
  // any that do appear. We attach the AppUserModelID property so Windows
  // groups the shortcut's launches under the same taskbar entry as the
  // running app — this is the key to pin-stability across reinstalls.
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

  const writeShortcut = (path: string, mustExist: boolean): string => {
    const lines = [
      `$path = ${q(path)}`,
      mustExist ? `if (Test-Path -LiteralPath $path) {` : '',
      `$ws = New-Object -ComObject WScript.Shell`,
      `$s = $ws.CreateShortcut($path)`,
      `$s.TargetPath = ${q(target)}`,
      `$s.Arguments = ${q(args)}`,
      `$s.WorkingDirectory = ${q(workingDir)}`,
      `$s.IconLocation = ${q(icon)}`,
      `$s.Description = 'AgentView - Claude background agents'`,
      `$s.Save()`,
      // Stamp the AppUserModelID so Windows treats this LNK as "owned by"
      // our app and keeps the pin associated even after the exe is
      // replaced on upgrade. Requires Shell.Application + PropertyStore.
      `try {`,
      `  $shell = New-Object -ComObject Shell.Application`,
      `  $folder = $shell.Namespace((Split-Path -Parent $path))`,
      `  $item = $folder.ParseName((Split-Path -Leaf $path))`,
      `  if ($item) {`,
      `    $link = $item.GetLink`,
      `    if ($link) {`,
      `      $link.SetAppUserModelID(${q(AUMID)})`,
      `      $link.Save($path, $true) | Out-Null`,
      `    }`,
      `  }`,
      `} catch {}`,
      mustExist ? `}` : ''
    ].filter(Boolean);
    return lines.join('; ');
  };

  const script = [
    writeShortcut(shortcutPath, false),
    writeShortcut(pinnedShortcut, true),
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
      console.log(
        '[desktop-shortcut] refreshed →',
        shortcutPath,
        existsSync(pinnedShortcut) ? '+ pinned →' + pinnedShortcut : '',
        '(target:',
        target + ')'
      );
    }
  );
}
