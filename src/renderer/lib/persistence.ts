const PREFIX = 'agentview.';

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
