import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BgSession } from '@shared/types';
import { loadRecent } from '../lib/recentSessions';
import { renderAccel } from '../lib/shortcuts';

export type PaletteCommand = {
  id: string;
  label: string;
  hint?: string;
  accel?: string;
  group: string;
  run: () => void;
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  sessions: BgSession[];
  renames: Record<string, string>;
  selectedId: string | null;
  onJump: (sessionId: string) => void;
  commands: PaletteCommand[];
}

// Light fuzzy matcher: every query character must appear in `text` in order
// (case-insensitive). Scoring favors consecutive matches and earlier hits.
function fuzzyScore(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  let score = 0;
  let lastHit = -2;
  for (const ch of q) {
    const hit = t.indexOf(ch, ti);
    if (hit < 0) return 0;
    score += hit === lastHit + 1 ? 4 : 1;
    if (hit < 12) score += 1; // bonus for early hits
    lastHit = hit;
    ti = hit + 1;
  }
  return score;
}

export function CommandPalette({
  open,
  onClose,
  sessions,
  renames,
  selectedId,
  onJump,
  commands
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  // 200ms debounce — researcher item #201. Keep the raw query in state for
  // controlled input, but feed the matchers from the debounced copy so a
  // user typing quickly doesn't trigger 8 filter passes. Pressing Enter
  // before the debounce fires flushes via flushNow() so the user never
  // executes against a stale candidate list (codex review P2).
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(id);
  }, [query]);
  const flushDebounce = useCallback(() => {
    setDebouncedQuery(query);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = (document.activeElement as HTMLElement) ?? null;
    setQuery('');
    setActiveIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      const el = previousActiveRef.current;
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, [open]);

  // Build the candidate list. Three groups, in order: commands, recent
  // sessions, all sessions (excluding ones already in recent).
  const items = useMemo(() => {
    const out: Array<
      | { kind: 'command'; cmd: PaletteCommand; score: number }
      | { kind: 'session'; session: BgSession; group: string; score: number }
    > = [];
    const q = debouncedQuery.trim();
    for (const cmd of commands) {
      const score = fuzzyScore(`${cmd.label} ${cmd.hint ?? ''}`, q);
      if (q === '' || score > 0) {
        out.push({ kind: 'command', cmd, score });
      }
    }
    const recent = loadRecent();
    const recentSet = new Set(recent);
    const byId = new Map(sessions.map((s) => [s.sessionId, s] as const));

    for (const id of recent) {
      const s = byId.get(id);
      if (!s) continue;
      if (id === selectedId) continue; // skip self
      const name = renames[id] || s.name || s.agent || id.slice(0, 8);
      const haystack = `${name} ${s.cwd ?? ''} ${s.agent ?? ''}`;
      const score = fuzzyScore(haystack, q);
      if (q === '' || score > 0) {
        out.push({ kind: 'session', session: s, group: '최근 방문', score });
      }
    }
    for (const s of sessions) {
      if (recentSet.has(s.sessionId)) continue;
      if (s.sessionId === selectedId) continue;
      const name = renames[s.sessionId] || s.name || s.agent || s.sessionId.slice(0, 8);
      const haystack = `${name} ${s.cwd ?? ''} ${s.agent ?? ''}`;
      const score = fuzzyScore(haystack, q);
      if (q === '' || score > 0) {
        out.push({ kind: 'session', session: s, group: '모든 세션', score });
      }
    }
    // Sort: commands always above sessions when q is empty; otherwise sort by
    // raw score within each kind so the most relevant entry bubbles to the
    // top regardless of group.
    if (q === '') {
      // already in command -> recent -> all order
      return out.slice(0, 40);
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 40);
  }, [commands, sessions, debouncedQuery, renames, selectedId]);

  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(Math.max(0, items.length - 1));
  }, [items.length, activeIdx]);

  const runItem = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item) return;
      onClose();
      if (item.kind === 'command') {
        item.cmd.run();
      } else {
        onJump(item.session.sessionId);
      }
    },
    [items, onClose, onJump]
  );

  // Keep the focused row scrolled into view as the user arrows up/down.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <div
      className="cmd-palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="cmd-palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="명령 팔레트"
      >
        <input
          ref={inputRef}
          type="text"
          className="cmd-palette-input"
          placeholder="명령어 또는 세션 검색 (퍼지 매칭 · ↑↓ 탐색 · Enter 실행)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIdx((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              // If the user typed faster than the 200ms debounce, the
              // candidate list above is still stale — flush before
              // executing so Enter always lands on what they see.
              if (debouncedQuery !== query) {
                flushDebounce();
                // Defer one frame so the items memo recomputes against the
                // flushed query before we invoke runItem.
                requestAnimationFrame(() => runItem(activeIdx));
              } else {
                runItem(activeIdx);
              }
            }
          }}
          aria-label="검색"
          aria-controls="cmd-palette-list"
          aria-activedescendant={`cmd-row-${activeIdx}`}
        />
        <div className="cmd-palette-list" ref={listRef} id="cmd-palette-list" role="listbox">
          {items.length === 0 && (
            <div className="cmd-palette-empty">일치하는 항목 없음</div>
          )}
          {items.map((item, idx) => {
            let group: string;
            let label: string;
            let hint: string | undefined;
            let accel: string | undefined;
            if (item.kind === 'command') {
              group = item.cmd.group;
              label = item.cmd.label;
              hint = item.cmd.hint;
              accel = item.cmd.accel;
            } else {
              group = item.group;
              const name =
                renames[item.session.sessionId] ||
                item.session.name ||
                item.session.agent ||
                item.session.sessionId.slice(0, 8);
              label = name;
              hint = item.session.cwd ?? undefined;
            }
            const showGroupHeader =
              idx === 0 ||
              (items[idx - 1].kind === item.kind &&
                (items[idx - 1] as { group?: string }).group === group) === false ||
              items[idx - 1].kind !== item.kind ||
              ('cmd' in items[idx - 1] && 'session' in item) ||
              (item.kind === 'session' &&
                (items[idx - 1].kind !== 'session' ||
                  (items[idx - 1] as { group: string }).group !== group));
            return (
              <div key={`${item.kind}-${idx}`} role="presentation">
                {showGroupHeader && (
                  <div className="cmd-palette-group">{group}</div>
                )}
                <button
                  type="button"
                  id={`cmd-row-${idx}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={idx === activeIdx}
                  className={`cmd-palette-row ${idx === activeIdx ? 'active' : ''}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runItem(idx);
                  }}
                >
                  <span className="cmd-palette-row-body">
                    <span className="cmd-palette-row-label">{label}</span>
                    {hint && (
                      <span className="cmd-palette-row-hint" title={hint}>
                        {hint.length > 60 ? '…' + hint.slice(-58) : hint}
                      </span>
                    )}
                  </span>
                  {accel && (
                    <kbd className="cmd-palette-row-accel">{renderAccel(accel)}</kbd>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmd-palette-foot">
          <span>↑↓ 탐색</span>
          <span>Enter 실행</span>
          <span>Esc 닫기</span>
        </div>
      </div>
    </div>
  );
}
