import { useEffect, useRef, useState } from 'react';
import { OptionsPopover } from './OptionsPopover';
import '../styles/window-chrome.css';

/**
 * Custom title bar that lives flush with the top of the window. Provides:
 *   - Drag region across the entire bar except interactive buttons.
 *   - Options popover trigger (gear icon, left of the standard window controls).
 *   - Minimize / maximize / close buttons (Windows-style, no native chrome).
 *
 * The native title bar is suppressed in `main/index.ts` via
 * `titleBarStyle:'hidden'`, so this is what the user sees at the top.
 */
export function WindowChrome(): JSX.Element {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const v = await window.av.window?.isMaximized?.();
        if (!cancelled && typeof v === 'boolean') setMaximized(v);
      } catch {
        // window IPC not yet present — leave as false
      }
    };
    sync();
    const off = window.av.window?.onMaximizedChanged?.((m) => setMaximized(m));
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const minimize = () => window.av.window?.minimize?.();
  const toggleMax = () => window.av.window?.toggleMaximize?.();
  const close = () => window.av.window?.close?.();

  return (
    <header className="window-chrome" data-tour-id="window-chrome">
      <div className="window-drag">
        <span className="window-title">AgentView</span>
      </div>
      <div className="window-actions">
        <button
          ref={btnRef}
          type="button"
          className="window-options-btn"
          title="옵션"
          aria-label="옵션 열기"
          onClick={() => setOptionsOpen((v) => !v)}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M9.6 1.5h-3.2l-.42 1.66a5.5 5.5 0 0 0-1.32.77L3.05 3.4 1.45 6.16l1.37.99a5.5 5.5 0 0 0 0 1.7l-1.37.99 1.6 2.77 1.6-.54a5.5 5.5 0 0 0 1.32.77l.42 1.66h3.2l.42-1.66a5.5 5.5 0 0 0 1.32-.77l1.6.54 1.6-2.77-1.37-.99a5.5 5.5 0 0 0 0-1.7l1.37-.99-1.6-2.77-1.6.54a5.5 5.5 0 0 0-1.32-.77L9.6 1.5Zm-1.6 8.4a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8Z"
            />
          </svg>
        </button>
        <button
          type="button"
          className="window-btn min"
          title="최소화"
          aria-label="창 최소화"
          onClick={minimize}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <button
          type="button"
          className="window-btn max"
          title={maximized ? '복원' : '최대화'}
          aria-label={maximized ? '창 복원' : '창 최대화'}
          onClick={toggleMax}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="2.5" width="6" height="6" stroke="currentColor" fill="none" />
              <rect x="3.5" y="0.5" width="6" height="6" stroke="currentColor" fill="none" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="window-btn close"
          title="닫기"
          aria-label="창 닫기"
          onClick={close}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
      {optionsOpen && (
        <OptionsPopover
          anchorEl={btnRef.current}
          onClose={() => setOptionsOpen(false)}
        />
      )}
    </header>
  );
}
