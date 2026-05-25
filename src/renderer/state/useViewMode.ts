import { useCallback, useRef, useState } from 'react';
import { getViewMode, setViewMode as persistViewMode, type ViewMode } from '../lib/viewMode';

/**
 * View mode (cards grid vs single workspace) with a ref mirror so async
 * callbacks (e.g. onStartNewSession) can read the *current* value without
 * stale-closure capture.
 */
export function useViewMode() {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => getViewMode());
  const viewModeRef = useRef<ViewMode>(viewMode);

  const toggleViewMode = useCallback(() => {
    setViewModeState((prev) => {
      const next: ViewMode = prev === 'cards' ? 'single' : 'cards';
      viewModeRef.current = next;
      persistViewMode(next);
      return next;
    });
  }, []);

  return { viewMode, viewModeRef, toggleViewMode };
}
