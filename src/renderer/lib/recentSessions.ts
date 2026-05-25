// Recent-session ring buffer — drives Ctrl+J quick-toggle + the "최근 방문"
// section of the command palette. Stored in localStorage so the user's
// recent stack survives reloads (but not across machines).

import { loadJSON, saveJSON } from './persistence';

const KEY = 'recentSessions';
const MAX = 12;

/** Most-recent first. Returns up to MAX session IDs. */
export function loadRecent(): string[] {
  return loadJSON<string[]>(KEY, []);
}

export function pushRecent(sessionId: string): string[] {
  if (!sessionId) return loadRecent();
  const prev = loadRecent();
  const next = [sessionId, ...prev.filter((id) => id !== sessionId)].slice(0, MAX);
  saveJSON(KEY, next);
  window.dispatchEvent(new CustomEvent('agentview:recent-changed'));
  return next;
}

export function dropRecent(sessionId: string): string[] {
  const next = loadRecent().filter((id) => id !== sessionId);
  saveJSON(KEY, next);
  window.dispatchEvent(new CustomEvent('agentview:recent-changed'));
  return next;
}

/** Returns the *previous* session relative to `currentSessionId` — null if none. */
export function previousRecent(currentSessionId: string | null): string | null {
  const stack = loadRecent();
  if (stack.length === 0) return null;
  if (!currentSessionId) return stack[0] ?? null;
  // The most recent entry IS the current session (we just pushed it). The
  // "previous" is the one before that.
  const idx = stack.indexOf(currentSessionId);
  if (idx < 0) return stack[0] ?? null;
  return stack[idx + 1] ?? null;
}
