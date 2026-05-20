export type ViewMode = 'cards' | 'single';

const KEY = 'agentview.viewMode';

export function getViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'single' ? 'single' : 'cards';
  } catch {
    return 'cards';
  }
}

export function setViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // ignore storage errors (private browsing, quota exceeded)
  }
}
