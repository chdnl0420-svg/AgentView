// Fetch 5h + weekly usage quotas so the AgentView header donut matches the
// `/cost` output of Claude Code itself.
//
// Strategy:
//   1. Try the local cache that the `claude` CLI writes after every turn.
//      That's the same file `/cost` reads, so values are guaranteed to
//      match what the user sees there.
//   2. Fall back to the OAuth `claude.ai/api/oauth/usage` endpoint when
//      no local cache is present.
//   3. Never block forever — every IO has a small budget and any failure
//      collapses to `available:false` so the UI can render "측정 불가"
//      instead of spinning forever.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import https from 'node:https';

const CLAUDE_DIR = join(homedir(), '.claude');
const CREDS_PATH = join(CLAUDE_DIR, '.credentials.json');
// Candidate local cache files written by the claude CLI. We probe each in
// order and use the first one that has a recognisable shape. Names can
// drift between CLI versions, so we keep a generous list.
const LOCAL_CANDIDATES = [
  join(CLAUDE_DIR, 'usage.json'),
  join(CLAUDE_DIR, 'usage_cache.json'),
  join(CLAUDE_DIR, 'cache', 'usage.json'),
  join(CLAUDE_DIR, 'state', 'usage.json'),
  join(CLAUDE_DIR, 'statsig', 'usage.json')
];

const UA = 'AgentView/1.0';
const HTTP_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_MS = 1_500;

export interface UsageBucket {
  used: number;
  limit: number;
  pct: number;
  resetIso?: string;
  resetIn?: string;
}

export interface UsageData {
  fiveHour?: UsageBucket;
  weekly?: UsageBucket;
  available: boolean;
  source: 'local' | 'oauth' | 'none';
  reason?: string;
  fetchedAt: number;
  raw?: unknown;
}

// ---------- token extraction ----------------------------------------------

function pickToken(obj: unknown, depth = 0): string | null {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  const KEYS = ['access_token', 'accessToken', 'oauth_token', 'token', 'bearer'];
  for (const k of KEYS) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.length > 16) return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const found = pickToken(v, depth + 1);
    if (found) return found;
  }
  return null;
}

async function readToken(): Promise<string | null> {
  try {
    const raw = await readWithTimeout(CREDS_PATH, READ_TIMEOUT_MS);
    if (raw == null) return null;
    return pickToken(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ---------- io helpers -----------------------------------------------------

async function readWithTimeout(path: string, ms: number): Promise<string | null> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const result = await Promise.race<Promise<string | null>>([
      fs.readFile(path, 'utf8'),
      new Promise<string | null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      })
    ]);
    return result;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fmtResetIn(iso?: string): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  const diff = t - Date.now();
  if (diff <= 0) return '0분';
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${m}분 후`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return `${h}시간 ${mm}분 후`;
  const d = Math.floor(h / 24);
  return `${d}일 후`;
}

function httpJson(url: string, headers: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      }
    );
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error('http timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------- bucket extraction ---------------------------------------------

const FIVE_HOUR_KEYS = [
  'five_hour_block',
  'fiveHourBlock',
  'five_hour',
  'fiveHour',
  '5h',
  'short_term',
  'current_block',
  'block'
];

const WEEKLY_KEYS = [
  'weekly',
  'weekly_usage',
  'week',
  'long_term',
  'weekly_all_models',
  'weekly_limit_percent'
];

function deepFind(
  raw: unknown,
  keys: readonly string[],
  depth = 0
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || depth > 4) return undefined;
  const obj = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (v && typeof v === 'object') return v as Record<string, unknown>;
  }
  for (const v of Object.values(obj)) {
    if (!v || typeof v !== 'object') continue;
    const found = deepFind(v, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Coerce a usage bucket into our canonical shape. Accepts a wide set of key
 * variations so we survive CLI version drift.
 */
function toBucket(b: Record<string, unknown> | undefined): UsageBucket | undefined {
  if (!b) return undefined;
  const used = Number(b.used ?? b.consumed ?? b.value ?? 0);
  const limit = Number(b.limit ?? b.max ?? b.quota ?? b.cap ?? 0);
  let pct: number | undefined;
  for (const k of ['pct', 'percent', 'percentage', 'usage_percent', 'usagePercent']) {
    const v = (b as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      pct = v;
      break;
    }
  }
  if (pct == null && limit > 0) pct = Math.round((used / limit) * 100);
  if (pct == null) pct = 0;
  // Some sources express the percent as a 0..1 ratio. Normalise.
  if (pct > 0 && pct <= 1 && !(used > 1 && limit > 1)) pct = Math.round(pct * 100);
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  const iso =
    (b.reset_at as string | undefined) ||
    (b.resetAt as string | undefined) ||
    (b.resetIso as string | undefined) ||
    (b.expires_at as string | undefined) ||
    (b.expiresAt as string | undefined);
  return { used, limit, pct, resetIso: iso, resetIn: fmtResetIn(iso) };
}

// Some shapes nest the buckets under e.g. `data` / `usage` / `result`.
function unwrap(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  for (const k of ['data', 'usage', 'result', 'payload', 'body']) {
    const v = obj[k];
    if (v && typeof v === 'object') return v;
  }
  return obj;
}

function parseUsage(raw: unknown): { fiveHour?: UsageBucket; weekly?: UsageBucket } {
  const root = unwrap(raw);
  const five = deepFind(root, FIVE_HOUR_KEYS);
  const week = deepFind(root, WEEKLY_KEYS);
  return { fiveHour: toBucket(five), weekly: toBucket(week) };
}

// ---------- local cache reader --------------------------------------------

async function readLocalUsage(): Promise<{
  fiveHour?: UsageBucket;
  weekly?: UsageBucket;
  raw?: unknown;
} | null> {
  for (const p of LOCAL_CANDIDATES) {
    const body = await readWithTimeout(p, READ_TIMEOUT_MS);
    if (!body) continue;
    try {
      const json = JSON.parse(body);
      const parsed = parseUsage(json);
      if (parsed.fiveHour || parsed.weekly) return { ...parsed, raw: json };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// ---------- public entry ---------------------------------------------------

export async function fetchUsage(): Promise<UsageData> {
  const fetchedAt = Date.now();
  const local = await readLocalUsage();
  if (local && (local.fiveHour || local.weekly)) {
    return {
      fiveHour: local.fiveHour,
      weekly: local.weekly,
      available: true,
      source: 'local',
      fetchedAt,
      raw: local.raw
    };
  }

  const token = await readToken();
  if (!token) {
    return {
      available: false,
      source: 'none',
      reason: 'no token + no local cache',
      fetchedAt
    };
  }

  try {
    const raw = await httpJson('https://claude.ai/api/oauth/usage', {
      'User-Agent': UA,
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'claude-code-oauth-2025-10-31'
    });
    const parsed = parseUsage(raw);
    return {
      fiveHour: parsed.fiveHour,
      weekly: parsed.weekly,
      available: !!(parsed.fiveHour || parsed.weekly),
      source: 'oauth',
      reason: parsed.fiveHour || parsed.weekly ? undefined : 'shape not recognised',
      fetchedAt,
      raw
    };
  } catch (err) {
    return {
      available: false,
      source: 'none',
      reason: err instanceof Error ? err.message : String(err),
      fetchedAt
    };
  }
}
