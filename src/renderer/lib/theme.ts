// Theme manager — light/dark/system tri-state with persistence.
//
// CSS variables live in tokens.css (dark = default) and parts/light-theme.css
// (light variants under [data-theme="light"]). This module only sets the
// data-theme attribute on <html>; the cascade does the rest.

import { loadJSON, saveJSON } from './persistence';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'opt.theme';

export function loadTheme(): ThemeMode {
  const v = loadJSON<string>(THEME_KEY, 'system');
  return v === 'light' || v === 'dark' ? v : 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Effective resolved theme — what's actually applied to the DOM. */
export function resolveTheme(mode: ThemeMode = loadTheme()): 'light' | 'dark' {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

/** Apply the theme to the document root. Idempotent. */
export function applyTheme(mode: ThemeMode = loadTheme()): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(mode);
  document.documentElement.setAttribute('data-theme', resolved);
  // Sync the color-scheme CSS property so native form controls / scrollbars
  // pick the right palette automatically.
  document.documentElement.style.colorScheme = resolved;
}

export function setTheme(mode: ThemeMode): void {
  saveJSON(THEME_KEY, mode);
  applyTheme(mode);
  window.dispatchEvent(new CustomEvent('agentview:theme-changed', { detail: mode }));
}

/**
 * Install a once-per-app listener that re-applies the theme whenever the OS
 * preference changes — only meaningful while the user is on "system" mode.
 * Returns a teardown function so callers can hot-swap inside React effects.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    const mode = loadTheme();
    if (mode === 'system') applyTheme('system');
  };
  // Modern browsers — addEventListener; legacy fallback uses addListener.
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else mq.addListener(onChange);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', onChange);
    else mq.removeListener(onChange);
  };
}

/** Cycle through system → light → dark → system. Used by the global toggle. */
export function nextTheme(cur: ThemeMode = loadTheme()): ThemeMode {
  if (cur === 'system') return 'light';
  if (cur === 'light') return 'dark';
  return 'system';
}
