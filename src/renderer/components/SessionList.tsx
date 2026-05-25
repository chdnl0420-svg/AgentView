import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BgSession } from '@shared/types';
import { formatRelative } from '../lib/format';
import { loadJSON, saveJSON } from '../lib/persistence';

const RENAMES_KEY = 'sessionRenames';

interface SessionListProps {
  sessions: BgSession[];
  selectedId: string | null;
  onSelect: (s: BgSession) => void;
  onNewClick: () => void;
  renames: Record<string, string>;
  now: number;
}

type Filter = 'all' | 'active' | 'completed';
type GroupKey = 'today' | 'yesterday' | 'thisWeek' | 'older';

const GROUP_LABELS: Record<GroupKey, string> = {
  today: '오늘',
  yesterday: '어제',
  thisWeek: '이번 주',
  older: '이전',
};
const GROUP_ORDER: GroupKey[] = ['today', 'yesterday', 'thisWeek', 'older'];

function dotClass(s: BgSession): string {
  if (!s.alive) return s.status === 'completed' ? 'completed' : s.status === 'crashed' ? 'crashed' : 'finished';
  return s.status === 'running' ? 'running' : 'waiting';
}

function statusLabel(s: BgSession): string {
  if (!s.alive) {
    if (s.status === 'crashed') return '오류';
    if (s.status === 'completed') return '완료';
    return '종료';
  }
  if (s.status === 'running') return '실행 중';
  if (s.status === 'waiting') return '대기';
  return '대기';
}

function isActive(s: BgSession): boolean {
  return s.alive;
}

function isCompleted(s: BgSession): boolean {
  return !s.alive && s.status === 'completed';
}

function matchesQuery(s: BgSession, name: string, preview: string, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    name.toLowerCase().includes(lower) ||
    (s.cwd ?? '').toLowerCase().includes(lower) ||
    (s.agent ?? '').toLowerCase().includes(lower) ||
    preview.toLowerCase().includes(lower)
  );
}

function groupOf(updatedAt: number, now: number): GroupKey {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const itemStart = new Date(updatedAt);
  itemStart.setHours(0, 0, 0, 0);
  const diffDays = Math.round((todayStart.getTime() - itemStart.getTime()) / 86_400_000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'thisWeek';
  return 'older';
}

function saveRename(sessionId: string, name: string | null): void {
  const cur = loadJSON<Record<string, string>>(RENAMES_KEY, {});
  if (name && name.trim()) cur[sessionId] = name.trim();
  else delete cur[sessionId];
  saveJSON(RENAMES_KEY, cur);
  window.dispatchEvent(new CustomEvent('agentview:renames-changed'));
}

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  onNewClick,
  renames,
  now
}: SessionListProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: BgSession } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Ctrl/Cmd+K anywhere → focus session search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close context menu on any outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const counts = useMemo(
    () => ({
      all: sessions.length,
      active: sessions.filter(isActive).length,
      completed: sessions.filter(isCompleted).length,
    }),
    [sessions]
  );

  const filtered = useMemo(() => {
    const list = sessions.filter((s) => {
      const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
      const preview = s.lastUserText ?? '';
      if (!matchesQuery(s, name, preview, query)) return false;
      if (filter === 'active') return isActive(s);
      if (filter === 'completed') return isCompleted(s);
      return true;
    });
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [sessions, query, filter, renames]);

  const grouped = useMemo(() => {
    const map: Record<GroupKey, BgSession[]> = { today: [], yesterday: [], thisWeek: [], older: [] };
    for (const s of filtered) {
      map[groupOf(s.updatedAt, now)].push(s);
    }
    return map;
  }, [filtered, now]);

  // Flat order for keyboard navigation (matches the visible group order).
  const flatOrder = useMemo(() => {
    const out: BgSession[] = [];
    for (const k of GROUP_ORDER) out.push(...grouped[k]);
    return out;
  }, [grouped]);

  const commitRename = useCallback(
    (sessionId: string) => {
      const trimmed = renameDraft.trim();
      saveRename(sessionId, trimmed || null);
      // Best-effort server-side rename so `claude agents` shows the same label.
      window.av.sessions.renameJob?.(sessionId, trimmed || null).catch(() => undefined);
      setRenamingId(null);
      setRenameDraft('');
    },
    [renameDraft]
  );

  const startRename = useCallback(
    (s: BgSession) => {
      const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
      setRenamingId(s.sessionId);
      setRenameDraft(name);
      setContextMenu(null);
    },
    [renames]
  );

  const onDelete = useCallback(
    (s: BgSession) => {
      setContextMenu(null);
      const name = renames[s.sessionId] || s.name || s.sessionId.slice(0, 8);
      if (!window.confirm(`이 세션을 삭제하시겠습니까?\n\n${name}`)) return;
      window.av.sessions.deleteMany?.([s.sessionId]).catch(() => undefined);
    },
    [renames]
  );

  const onOpenFolder = useCallback((s: BgSession) => {
    setContextMenu(null);
    if (!s.cwd) return;
    window.av.shell.openPath(s.cwd).catch(() => undefined);
  }, []);

  const onCopyId = useCallback((s: BgSession) => {
    setContextMenu(null);
    navigator.clipboard.writeText(s.sessionId).catch(() => undefined);
  }, []);

  // Keyboard ↑/↓/Enter while the list has focus.
  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (renamingId) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      const idx = flatOrder.findIndex((s) => s.sessionId === selectedId);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = flatOrder[Math.min(flatOrder.length - 1, Math.max(-1, idx) + 1)];
        if (next) onSelect(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = flatOrder[Math.max(0, idx - 1)];
        if (prev) onSelect(prev);
      } else if (e.key === 'Enter') {
        const cur = flatOrder.find((s) => s.sessionId === selectedId);
        if (cur) onSelect(cur);
      }
    },
    [flatOrder, renamingId, onSelect, selectedId]
  );

  const emptyText =
    query || filter !== 'all'
      ? '일치하는 세션 없음'
      : '세션 없음 — 위 “+ 새 작업”으로 시작하세요';

  return (
    <div className="session-list" onKeyDown={onListKeyDown} ref={containerRef} tabIndex={0}>
      <div className="session-list-head">
        <button type="button" className="btn primary session-list-new" onClick={onNewClick}>
          ＋ 새 작업
        </button>
      </div>
      <div className="session-list-search-row">
        <span className="session-list-search-icon" aria-hidden="true">⌕</span>
        <input
          ref={searchRef}
          type="text"
          className="session-list-search"
          placeholder="검색 (Ctrl+K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="세션 검색"
        />
        {query && (
          <button
            type="button"
            className="session-list-search-clear"
            onClick={() => setQuery('')}
            aria-label="검색어 지우기"
            title="검색어 지우기 (Esc)"
          >
            ×
          </button>
        )}
      </div>
      <div className="session-list-filters" role="tablist">
        <button
          type="button"
          className={`session-list-filter ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        >
          모두 <span className="session-list-filter-count">{counts.all}</span>
        </button>
        <button
          type="button"
          className={`session-list-filter ${filter === 'active' ? 'active' : ''}`}
          onClick={() => setFilter('active')}
          aria-pressed={filter === 'active'}
        >
          실행 중 <span className="session-list-filter-count">{counts.active}</span>
        </button>
        <button
          type="button"
          className={`session-list-filter ${filter === 'completed' ? 'active' : ''}`}
          onClick={() => setFilter('completed')}
          aria-pressed={filter === 'completed'}
        >
          완료 <span className="session-list-filter-count">{counts.completed}</span>
        </button>
      </div>
      <div className="session-list-body">
        {flatOrder.length === 0 && (
          <div className="session-list-empty">{emptyText}</div>
        )}
        {GROUP_ORDER.map((g) => {
          const items = grouped[g];
          if (items.length === 0) return null;
          return (
            <div key={g} className="session-list-group">
              <div className="session-list-group-header">{GROUP_LABELS[g]}</div>
              {items.map((s) => {
                const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
                const preview = s.lastUserText || s.lastAssistantText || '';
                const isRenaming = renamingId === s.sessionId;
                return (
                  <div
                    key={s.sessionId}
                    className={`session-list-item ${s.sessionId === selectedId ? 'selected' : ''}`}
                    onClick={() => !isRenaming && onSelect(s)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      startRename(s);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, session: s });
                    }}
                    role="button"
                    tabIndex={-1}
                    title={s.cwd ? `${name}\n${s.cwd}` : name}
                  >
                    <span className={`session-list-dot ${dotClass(s)}`} />
                    <span className="session-list-item-body">
                      {isRenaming ? (
                        <input
                          autoFocus
                          type="text"
                          className="session-list-rename-input"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => commitRename(s.sessionId)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename(s.sessionId);
                            } else if (e.key === 'Escape') {
                              setRenamingId(null);
                              setRenameDraft('');
                            }
                            e.stopPropagation();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="세션 이름 변경"
                        />
                      ) : (
                        <span className="session-list-name">{name}</span>
                      )}
                      <span className="session-list-sub">
                        <span className={`session-list-status ${dotClass(s)}`}>{statusLabel(s)}</span>
                        {preview && (
                          <span className="session-list-preview" title={preview}>
                            · {preview.length > 60 ? preview.slice(0, 60) + '…' : preview}
                          </span>
                        )}
                        <span className="session-list-time">{formatRelative(s.updatedAt, now)}</span>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <div
          className="session-list-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          role="menu"
        >
          <button
            type="button"
            className="session-list-menu-item"
            onClick={() => startRename(contextMenu.session)}
          >
            ✎ 이름 변경
          </button>
          <button
            type="button"
            className="session-list-menu-item"
            onClick={() => onOpenFolder(contextMenu.session)}
            disabled={!contextMenu.session.cwd}
          >
            📁 폴더 열기
          </button>
          <button
            type="button"
            className="session-list-menu-item"
            onClick={() => onCopyId(contextMenu.session)}
          >
            ⧉ 세션 ID 복사
          </button>
          <div className="session-list-menu-sep" />
          <button
            type="button"
            className="session-list-menu-item danger"
            onClick={() => onDelete(contextMenu.session)}
          >
            🗑 삭제
          </button>
        </div>
      )}
    </div>
  );
}
