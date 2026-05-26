import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { IPC } from '@shared/ipc-contracts';
import { listBuiltinCommands } from '../builtinCommands';
import { parseAgentFile } from '../frontmatter';
import type { AgentInfo, SlashCommandEntry } from '@shared/types';

export async function loadCommands(sessionCwd?: string | null): Promise<SlashCommandEntry[]> {
  // Project-scoped commands live under <cwd>/.claude/commands. In a packaged
  // electron build `process.cwd()` is the install dir (e.g. Program Files),
  // not the user's project — so we honor an explicit cwd from the renderer
  // and only fall back to process.cwd() in dev when the caller didn't supply
  // one. This mirrors what Claude Code Desktop does (it scans the project
  // root that's currently open in the sidebar).
  const projectRoot = sessionCwd && sessionCwd.trim() ? sessionCwd : process.cwd();
  const dirs = [
    { p: join(homedir(), '.claude', 'commands'), scope: 'user' as const },
    { p: join(projectRoot, '.claude', 'commands'), scope: 'project' as const }
  ];
  const out: SlashCommandEntry[] = [];
  const seen = new Set<string>();
  // Built-in CLI commands ship first so they show up alongside user/project
  // markdown commands and are still overridable by name (user/project win
  // because we add them later in the loop and dedup before pushing).
  for (const b of listBuiltinCommands()) {
    out.push(b);
    seen.add(b.name);
  }
  for (const d of dirs) {
    try {
      const entries = await fs.readdir(d.p);
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.md')) continue;
        if (entry.includes('.bak')) continue;
        const filePath = join(d.p, entry);
        const name = entry.replace(/\.md$/i, '');
        if (seen.has(name)) continue;
        seen.add(name);
        let description = '';
        try {
          const raw = await fs.readFile(filePath, 'utf8');
          const m = /^---\s*\n([\s\S]*?)\n---/.exec(raw);
          if (m) {
            const descMatch = /^description:\s*(.+)$/m.exec(m[1]);
            if (descMatch) description = descMatch[1].replace(/^["']|["']$/g, '').trim();
          }
          if (!description) {
            const firstNonEmpty = raw
              .replace(/^---[\s\S]*?---\n?/, '')
              .split(/\r?\n/)
              .find((l) => l.trim().length > 0);
            description = firstNonEmpty ? firstNonEmpty.slice(0, 120) : '';
          }
        } catch {
          /* ignore */
        }
        out.push({ name, scope: d.scope, description, filePath });
      }
    } catch {
      /* dir missing */
    }
  }
  out.sort((a, b) => {
    const order = { project: 0, user: 1, builtin: 2 } as const;
    const oa = order[a.scope];
    const ob = order[b.scope];
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name, 'ko');
  });
  return out;
}

export async function loadAgents(): Promise<AgentInfo[]> {
  const dirs = [
    { p: join(homedir(), '.claude', 'agents'), scope: 'user' as const },
    { p: join(process.cwd(), '.claude', 'agents'), scope: 'project' as const }
  ];
  const out: AgentInfo[] = [];
  for (const d of dirs) {
    try {
      const entries = await fs.readdir(d.p);
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.md')) continue;
        if (entry.includes('.bak')) continue;
        const filePath = join(d.p, entry);
        try {
          const raw = await fs.readFile(filePath, 'utf8');
          out.push(parseAgentFile(filePath, raw, d.scope));
        } catch {
          /* skip */
        }
      }
    } catch {
      /* dir missing */
    }
  }
  out.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko');
  });
  return out;
}

export function registerLoaders(): void {
  ipcMain.handle(IPC.AgentsList, async () => loadAgents());
  ipcMain.handle(IPC.CommandsList, async (_e, cwd?: string | null) =>
    loadCommands(cwd ?? null)
  );
}
