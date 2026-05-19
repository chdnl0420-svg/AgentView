// Fetch 5h + weekly usage quotas from claude.ai/api/oauth/usage. The
// endpoint requires the user's OAuth bearer token, which the local
// claude CLI stores at ~/.claude/.credentials.json after `claude login`.
// We read the token at runtime in the main process (NOT in the renderer)
// so the token never enters the browser context.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import https from 'node:https';

const CREDS_PATH = join(homedir(), '.claude', '.credentials.json');
const UA = 'AgentView/1.0';

export interface UsageData {
  fiveHour?: { used: number; limit: number; pct: number; resetIso?: string; resetIn?: string };
  weekly?:   { used: number; limit: number; pct: number; resetIso?: string; resetIn?: string };
  fetchedAt: number;
  raw?: unknown;
}

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
    const raw = await fs.readFile(CREDS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return pickToken(data);
  } catch {
    return null;
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

function ghJson(url: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'claude-code-oauth-2025-10-31'
        }
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
    req.on('error', reject);
    req.end();
  });
}

export async function fetchUsage(): Promise<UsageData | null> {
  const token = await readToken();
  if (!token) return null;
  try {
    // Endpoint shape (per the URL the user shared). The actual JSON keys
    // can vary, so we accept a few common shapes and pick what fits.
    const raw = (await ghJson('https://claude.ai/api/oauth/usage', token)) as Record<string, unknown>;
    const out: UsageData = { fetchedAt: Date.now(), raw };
    // Try shape: { five_hour: {used, limit, reset_at}, weekly: {...} }
    const five = (raw.five_hour || raw.fiveHour || raw['5h'] || raw.short_term) as
      | { used?: number; limit?: number; pct?: number; reset_at?: string; resetAt?: string; resetIso?: string }
      | undefined;
    const week = (raw.weekly || raw.long_term || raw.week) as
      | { used?: number; limit?: number; pct?: number; reset_at?: string; resetAt?: string; resetIso?: string }
      | undefined;
    if (five && typeof five === 'object') {
      const used = Number(five.used) || 0;
      const limit = Number(five.limit) || 0;
      const pct = typeof five.pct === 'number' ? five.pct : (limit > 0 ? Math.round((used / limit) * 100) : 0);
      const iso = five.reset_at || five.resetAt || five.resetIso;
      out.fiveHour = { used, limit, pct, resetIso: iso, resetIn: fmtResetIn(iso) };
    }
    if (week && typeof week === 'object') {
      const used = Number(week.used) || 0;
      const limit = Number(week.limit) || 0;
      const pct = typeof week.pct === 'number' ? week.pct : (limit > 0 ? Math.round((used / limit) * 100) : 0);
      const iso = week.reset_at || week.resetAt || week.resetIso;
      out.weekly = { used, limit, pct, resetIso: iso, resetIn: fmtResetIn(iso) };
    }
    return out;
  } catch (err) {
    console.warn('[usage] fetch failed', err instanceof Error ? err.message : err);
    return null;
  }
}
