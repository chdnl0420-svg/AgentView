import { useEffect, useMemo, useRef, useState } from 'react';
import { shortcutsByGroup, renderAccel, type ShortcutDef } from '../lib/shortcuts';

interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal panel listing every keyboard shortcut the app exposes, grouped by
 * section. Triggered by Ctrl+/ or F1 from the global key handler. Includes
 * a search box so users can filter by either the action label or the accel
 * string itself ("Ctrl+K" or "검색").
 */
export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  // Snapshot the previously-focused element when we open so we can restore
  // focus to it on close — researcher item #370.
  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = (document.activeElement as HTMLElement) ?? null;
    setQuery('');
    // Give the dialog a frame to mount, then focus the search box.
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      const el = previousActiveRef.current;
      if (el && typeof el.focus === 'function') {
        el.focus();
      }
    };
  }, [open]);

  // Esc closes; trap focus within the dialog otherwise.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'input, button, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const groups = useMemo(() => shortcutsByGroup(), []);
  const filtered = useMemo(() => {
    if (!query.trim()) return groups;
    const q = query.toLowerCase();
    const out: Record<string, ShortcutDef[]> = {};
    for (const [g, list] of Object.entries(groups)) {
      const hits = list.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.accel.toLowerCase().includes(q) ||
          renderAccel(s.accel).toLowerCase().includes(q)
      );
      if (hits.length > 0) out[g] = hits;
    }
    return out;
  }, [groups, query]);

  if (!open) return null;

  return (
    <div
      className="shortcut-help-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="shortcut-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
      >
        <header className="shortcut-help-head">
          <h2 id="shortcut-help-title">키보드 단축키</h2>
          <button
            type="button"
            className="shortcut-help-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>
        <input
          ref={searchRef}
          type="text"
          className="shortcut-help-search"
          placeholder="단축키나 동작 이름으로 검색 (예: Ctrl+K, 검색)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="단축키 검색"
        />
        <div className="shortcut-help-body">
          {Object.entries(filtered).length === 0 && (
            <div className="shortcut-help-empty">일치하는 단축키 없음</div>
          )}
          {Object.entries(filtered).map(([group, items]) => (
            <section key={group} className="shortcut-help-group">
              <h3 className="shortcut-help-group-title">{group}</h3>
              <ul className="shortcut-help-list">
                {items.map((s) => (
                  <li key={s.id} className="shortcut-help-row">
                    <span className="shortcut-help-label">{s.label}</span>
                    <kbd className="shortcut-help-kbd">{renderAccel(s.accel)}</kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="shortcut-help-foot">
          <span className="shortcut-help-hint">Esc 또는 닫기 버튼으로 닫기</span>
        </footer>
      </div>
    </div>
  );
}
