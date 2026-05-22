// OS process info — best-effort cross-platform helper used by adoption
// to detect PID-reuse zombies. chunk-5b ships Linux + macOS; Windows
// returns null (deferred — tasklist does not provide startTime and we
// don't want to pull a PowerShell dependency into the daemon yet).
//
// Contract: returns null on any failure (process not found, permission
// denied, unsupported platform, command crash) and NEVER throws.

import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';

export interface ProcessInfo {
  /** epoch milliseconds when the process started. */
  startTime: number;
  /** raw command line; best-effort, may be empty on macOS. */
  command: string;
}

function isUsablePid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0;
}

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 2000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? err.message) });
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// ---- Linux ---------------------------------------------------------------

async function readLinuxBootTimeSec(): Promise<number | null> {
  try {
    const raw = await fs.readFile('/proc/stat', 'utf8');
    for (const line of raw.split('\n')) {
      if (line.startsWith('btime ')) {
        const v = Number(line.slice(6).trim());
        return Number.isFinite(v) ? v : null;
      }
    }
  } catch {
    /* /proc not mounted */
  }
  return null;
}

async function getProcessInfoLinux(pid: number): Promise<ProcessInfo | null> {
  let stat: string;
  try {
    stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
  // /proc/<pid>/stat 22nd field is starttime. comm (2nd field) is wrapped
  // in parens and may itself contain spaces or ')', so split on the LAST
  // ')' to keep the post-comm fields aligned.
  const closeIdx = stat.lastIndexOf(')');
  if (closeIdx < 0) return null;
  const after = stat.slice(closeIdx + 2); // skip ') '
  const parts = after.split(' ');
  // After comm, field index 1 is 'state'. starttime is the 22nd /proc field,
  // which is index (22 - 3) = 19 in the post-comm array (fields 1 & 2 were
  // before comm; field 3 starts the post-comm split).
  const startTicks = Number(parts[19]);
  if (!Number.isFinite(startTicks)) return null;
  const btime = await readLinuxBootTimeSec();
  if (btime === null) return null;
  // CLK_TCK is 100 on every Linux distribution we care about (assumed).
  const startTimeMs = btime * 1000 + (startTicks / 100) * 1000;

  let command = '';
  try {
    const raw = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8');
    // cmdline is NUL-separated; collapse to a space-delimited string.
    command = raw.replace(/\0+$/u, '').replace(/\0/g, ' ').trim();
  } catch {
    /* cmdline gone — keep blank */
  }
  return { startTime: startTimeMs, command };
}

// ---- macOS ---------------------------------------------------------------

async function getProcessInfoMac(pid: number): Promise<ProcessInfo | null> {
  // `ps -o lstart=,command= -p <pid>` — empty header (=) keeps parsing simple.
  // lstart format is "Thu May 22 09:30:15 2026" (5 tokens).
  const { stdout } = await execFileAsync('ps', ['-o', 'lstart=,command=', '-p', String(pid)]);
  const line = stdout.trim();
  if (!line) return null;
  const tokens = line.split(/\s+/);
  if (tokens.length < 6) return null;
  const lstart = tokens.slice(0, 5).join(' ');
  const ms = Date.parse(lstart);
  if (!Number.isFinite(ms)) return null;
  const command = tokens.slice(5).join(' ');
  return { startTime: ms, command };
}

// ---- public --------------------------------------------------------------

export async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  if (!isUsablePid(pid)) return null;
  const plat = platform();
  try {
    if (plat === 'linux') return await getProcessInfoLinux(pid);
    if (plat === 'darwin') return await getProcessInfoMac(pid);
    return null; // Windows + everything else — deferred to a later chunk.
  } catch {
    return null;
  }
}
