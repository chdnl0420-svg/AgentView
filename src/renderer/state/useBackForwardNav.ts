import { useEffect, useRef } from 'react';

/**
 * Browser-style back/forward navigation between dashboard ↔ detail view.
 *   - Back (Esc / Mouse XButton1 / button=3) leaves the detail and
 *     remembers the sid so the next forward press can restore it.
 *   - Forward (Mouse XButton2 / button=4) re-enters the most-recent
 *     detail.
 * The listener stays attached in both modes because the forward press
 * must work when selectedId is null.
 */
export function useBackForwardNav(
  selectedId: string | null,
  setSelectedId: (sid: string | null) => void
) {
  const lastSelectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedId) lastSelectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const isTextTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true;
      return t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId && !isTextTarget(e.target)) {
        e.preventDefault();
        setSelectedId(null);
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      // Windows physical mouse: XButton1 (back) -> button=3, XButton2 (forward) -> button=4.
      if (e.button === 3 && selectedId) {
        e.preventDefault();
        setSelectedId(null);
        return;
      }
      if (e.button === 4 && !selectedId && lastSelectedIdRef.current) {
        e.preventDefault();
        setSelectedId(lastSelectedIdRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [selectedId, setSelectedId]);
}
