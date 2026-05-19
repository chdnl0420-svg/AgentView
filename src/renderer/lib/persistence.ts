const PREFIX = 'agentview.';

/**
 * localStorage key for the user's "Enter to send" preference. When true,
 * a bare Enter sends the message and Shift+Enter inserts a newline. When
 * false (default), Ctrl/Meta+Enter sends and Enter inserts a newline.
 *
 * Components that read this should also listen on `window` for the custom
 * event of the same name to react when the setting changes elsewhere.
 */
export const ENTER_TO_SEND_KEY = 'opt.enterToSend';

/** Build the localStorage key used by InputBar to autosave its draft. */
export function draftKey(historyKey: string): string {
  return `draft.${historyKey}`;
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, val: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(val));
  } catch {
    /* quota exceeded etc */
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function pushHistory(key: string, entry: string, max = 100): string[] {
  const trimmed = entry.trim();
  if (!trimmed) return loadJSON<string[]>(`history.${key}`, []);
  const prev = loadJSON<string[]>(`history.${key}`, []);
  // Most-recent first; de-dupe consecutive identical sends.
  const next = [trimmed, ...prev.filter((p) => p !== trimmed)].slice(0, max);
  saveJSON(`history.${key}`, next);
  return next;
}

export function loadHistory(key: string): string[] {
  return loadJSON<string[]>(`history.${key}`, []);
}
