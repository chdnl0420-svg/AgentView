import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OWNED_FILE = join(homedir(), '.claude', 'agentview-owned.json');
const MAX_TRACKED = 500;

let cache: Set<string> | null = null;
let cacheLoaded = false;
let saveTimer: NodeJS.Timeout | null = null;

async function load(): Promise<Set<string>> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(OWNED_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      cache = new Set(arr.filter((v) => typeof v === 'string'));
    } else {
      cache = new Set();
    }
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
    await fs.writeFile(OWNED_FILE, JSON.stringify(arr), 'utf8');
  } catch {
    /* best-effort */
  }
}

export async function rememberOwned(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const set = await load();
  if (set.has(sessionId)) return;
  set.add(sessionId);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush().catch(() => {
      /* swallow */
    });
  }, 200);
}

export function ownedSnapshot(): Set<string> {
  return cache ? new Set(cache) : new Set();
}

export async function ensureOwnedLoaded(): Promise<Set<string>> {
  if (cacheLoaded) return cache!;
  return load();
}
