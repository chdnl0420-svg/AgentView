// In-app updater. Polls the public releases repo's GitHub API once at
// launch (and on user request), compares the latest tag to this build,
// downloads the .exe asset, and hands off to NSIS for the actual install.
//
// We deliberately do NOT use electron-updater so we can ship a single
// NSIS installer without the Squirrel runtime overhead. The installer
// handles uninstall + install + relaunch by itself.

import { app, shell } from 'electron';
import { promises as fs, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import https from 'node:https';

const RELEASE_REPO = 'chdnl0420-svg/AgentView-Release';
const UA = 'AgentView-Updater/1.0';

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  releaseUrl?: string;
  installerUrl?: string;
  installerName?: string;
  notes?: string;
}

interface GhRelease {
  tag_name: string;
  name?: string;
  body?: string;
  html_url?: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

function ghJson(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(
        `https://api.github.com${path}`,
        { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`GitHub API ${res.statusCode}`));
              return;
            }
            try { resolve(JSON.parse(body)); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
          });
        }
      )
      .on('error', reject);
  });
}

function semverGt(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  try {
    const rel = (await ghJson(`/repos/${RELEASE_REPO}/releases/latest`)) as GhRelease;
    const latest = (rel.tag_name || '').replace(/^v/, '');
    if (!latest) return { current, latest: null, available: false };
    const installer = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    return {
      current,
      latest,
      available: semverGt(latest, current),
      releaseUrl: rel.html_url,
      installerUrl: installer?.browser_download_url,
      installerName: installer?.name,
      notes: rel.body
    };
  } catch (err) {
    console.warn('[updater] check failed:', err instanceof Error ? err.message : err);
    return { current, latest: null, available: false };
  }
}

function downloadToFile(url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        downloadToFile(res.headers.location, dest, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      res.on('data', (chunk) => {
        got += chunk.length;
        if (total && onProgress) onProgress(Math.min(100, Math.round((got / total) * 100)));
      });
      res.pipe(file);
      file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())));
    });
    req.on('error', reject);
  });
}

export async function downloadAndInstall(info: UpdateInfo, onProgress?: (pct: number) => void): Promise<void> {
  if (!info.installerUrl) throw new Error('No installer URL in release');
  const fileName = info.installerName || `AgentView-${info.latest}-setup.exe`;
  const dest = join(tmpdir(), fileName);
  try { await fs.unlink(dest); } catch { /* ignore */ }
  await downloadToFile(info.installerUrl, dest, onProgress);
  // Launch the installer detached, then quit the running app so NSIS can
  // overwrite the binary. /S = silent. NSIS config has runAfterFinish:true
  // so the new build auto-launches once install completes.
  const child = spawn(dest, ['/S'], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  setTimeout(() => { try { app.quit(); } catch { /* ignore */ } }, 600);
}

export function revealReleasePage(info: UpdateInfo): void {
  if (info.releaseUrl) shell.openExternal(info.releaseUrl);
}
