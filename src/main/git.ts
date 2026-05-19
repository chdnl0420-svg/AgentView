import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { GitBranchesResult } from '@shared/types';

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileP('git', args, {
      cwd,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(e.stderr?.trim() || e.message || 'git command failed');
  }
}

export async function listBranches(cwd: string): Promise<GitBranchesResult> {
  const empty: GitBranchesResult = { isRepo: false, current: '', branches: [] };
  if (!cwd || !cwd.trim()) return empty;
  try {
    await git(cwd, ['rev-parse', '--git-dir']);
  } catch {
    return empty;
  }
  let current = '';
  try {
    const { stdout } = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const v = stdout.trim();
    if (v && v !== 'HEAD') current = v;
  } catch {
    /* detached or empty */
  }
  let branches: string[] = [];
  try {
    const { stdout } = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    branches = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    branches = [];
  }
  let rootCwd: string | undefined;
  try {
    const { stdout } = await git(cwd, ['rev-parse', '--show-toplevel']);
    const root = stdout.trim();
    if (root) rootCwd = root;
  } catch {
    /* ignore */
  }
  return { isRepo: true, current, branches, rootCwd };
}

export async function suggestWorktreePath(cwd: string, branchOrSuffix: string): Promise<string> {
  const safe = (branchOrSuffix || 'agent').replace(/[\\/:*?"<>|]+/g, '-');
  const base = basename(cwd) || 'work';
  let candidate = join(cwd, '..', `${base}-wt-${safe}`);
  // Find a non-existing path so we never clobber.
  for (let i = 0; i < 20; i++) {
    try {
      await fs.access(candidate);
      candidate = join(cwd, '..', `${base}-wt-${safe}-${i + 1}`);
    } catch {
      return candidate;
    }
  }
  return candidate;
}

/**
 * Create a new git worktree at `worktreePath`, derived from `baseBranch`.
 * If `newBranch` is given (and differs from baseBranch), creates a new branch
 * inside the worktree (`-b`). Returns the resolved worktree path on success.
 */
export async function createWorktree(opts: {
  cwd: string;
  worktreePath: string;
  baseBranch: string;
  newBranch?: string | null;
}): Promise<string> {
  const { cwd, worktreePath, baseBranch, newBranch } = opts;
  if (!isAbsolute(worktreePath)) {
    throw new Error('worktreePath must be absolute');
  }
  // Refuse to overwrite an existing non-empty path.
  try {
    const entries = await fs.readdir(worktreePath);
    if (entries.length > 0) {
      throw new Error(`worktree 경로가 비어있지 않습니다: ${worktreePath}`);
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') {
      // readdir failed for a non-missing reason — still try git, it will error.
    }
  }
  const args = ['worktree', 'add'];
  if (newBranch && newBranch.trim() && newBranch.trim() !== baseBranch) {
    args.push('-b', newBranch.trim(), worktreePath, baseBranch);
  } else {
    args.push(worktreePath, baseBranch);
  }
  await git(cwd, args);
  return worktreePath;
}
