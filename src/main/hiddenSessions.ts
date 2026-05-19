import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Sessions the user deleted via AgentView. The claude daemon may respawn
// the worker (it tracks each entry's attempt counter and re-creates the
// jobs/<short>/ directory after we wipe it), so deletion at the daemon
// layer is not always durable. This file is the UI-side safety net: any
// sessionId listed here is filtered out of scanSessions() regardless of
// what jobs/ / roster.json look like.
const HIDDEN_FILE = join(homedir(), '.claude', 'agentview-hidden.json');
const MAX_TRACKED = 2000;

let cache: Set<string> | null = null;
let cacheLoaded = false;
let saveTimer: NodeJS.Timeout | null = null;

async function load(): Promise<Set<string>> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(HIDDEN_FILE, 'utf8');
    const arr = JSON.parse(raw);
    cache = new Set(Array.isArray(arr) ? arr.filter((v) => typeof v === 'string') : []);
  } catch {
    cache = new Set();
  }
  cacheLoaded = true;
  return cache;
}

async function flush(): Promise<void> {
  if (!cache) return;
  const arr = Array.from(cache).slice(-MAX_TRACKED);
  try {
    await fs.mkdir(join(homedir(), '.claude'), { recursive: true });
    await fs.writeFile(HIDDEN_FILE, JSON.stringify(arr), 'utf8');
  } catch {
    /* best-effort */
  }
}

function scheduleFlush(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush().catch(() => {
      /* swallow */
    });
  }, 150);
}

export async function markHidden(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const set = await load();
  if (set.has(sessionId)) return;
  set.add(sessionId);
  scheduleFlush();
}

export async function unmarkHidden(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const set = await load();
  if (!set.delete(sessionId)) return;
  scheduleFlush();
}

export function hiddenSnapshot(): Set<string> {
  return cache ? new Set(cache) : new Set();
}

export async function ensureHiddenLoaded(): Promise<Set<string>> {
  if (cacheLoaded) return cache!;
  return load();
}
