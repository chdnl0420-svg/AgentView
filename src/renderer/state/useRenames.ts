import { useEffect, useState } from 'react';
import type { SessionBackend } from '@shared/types';
import { loadJSON } from '../lib/persistence';

const RENAMES_KEY = 'sessionRenames';

function loadRenames(): Record<string, string> {
  return loadJSON<Record<string, string>>(RENAMES_KEY, {});
}

/**
 * SessionDetail writes the rename map to localStorage directly; refresh
 * our copy whenever the selection or window focus changes so the new name
 * lands on the dashboard cards. Also tracks the active backend chip so
 * the renderer can switch composer defaults in one place.
 */
export function useRenames() {
  const [renames, setRenames] = useState<Record<string, string>>(() => loadRenames());
  const [activeBackend, setActiveBackend] = useState<SessionBackend>(() => {
    const saved = loadJSON<string>('lastBackend', 'avd');
    return saved === 'claude' || saved === 'codex' || saved === 'avd' ? saved : 'avd';
  });

  useEffect(() => {
    const onFocus = () => setRenames(loadRenames());
    const onBackendChanged = (e: Event) => {
      const next = (e as CustomEvent<SessionBackend>).detail;
      if (next === 'claude' || next === 'codex' || next === 'avd') setActiveBackend(next);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onFocus);
    window.addEventListener('agentview:renames-changed', onFocus as EventListener);
    window.addEventListener('agentview:backend-changed', onBackendChanged as EventListener);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onFocus);
      window.removeEventListener('agentview:renames-changed', onFocus as EventListener);
      window.removeEventListener('agentview:backend-changed', onBackendChanged as EventListener);
    };
  }, []);

  /** Force a re-read after the user dismisses the detail view. */
  const refresh = () => setRenames(loadRenames());

  return { renames, refresh, activeBackend };
}
