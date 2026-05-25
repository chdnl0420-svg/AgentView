import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { BgSession } from '@shared/types';
import { formatRelative } from '../lib/format';
import { loadJSON, saveJSON } from '../lib/persistence';
import { loadArchive, archive as doArchive, unarchive as doUnarchive } from '../lib/sessionArchive';
import {
  loadSessionTags,
  loadTagsMap,
  setTagsOf,
  type SessionTag
} from '../lib/sessionTags';
import {
  loadSortMode,
  saveSortMode,
  type SortMode
} from '../lib/sessionOrder';
import { SessionListMultiBar } from './SessionListMultiBar';
import { SessionListTagDialog } from './SessionListTagDialog';

const RENAMES_KEY = 'sessionRenames';
const PINS_KEY = 'sessionPins';
const FILTER_KEY = 'sessionList.filter';
const COLLAPSED_GROUPS_KEY = 'sessionList.collapsedGroups';
const SEARCH_HISTORY_KEY = 'sessionList.searchHistory';
const ARCHIVE_OPEN_KEY = 'sessionList.archiveOpen';
const SEARCH_HISTORY_MAX = 8;

type Filter = 'all' | 'active' | 'completed' | 'error' | 'waiting';
type GroupKey = 'today' | 'yesterday' | 'thisWeek' | 'older';

const FILTER_LABELS: Record<Filter, string> = {
  all: '모두',
  active: '실행 중',
  completed: '완료',
  error: '오류',
  waiting: '대기'
};
const FILTER_ORDER: Filter[] = ['all', 'active', 'completed', 'error', 'waiting'];

const GROUP_LABELS: Record<GroupKey, string> = {
  today: '오늘',
  yesterday: '어제',
  thisWeek: '이번 주',
  older: '이전'
};
const GROUP_ORDER: GroupKey[] = ['today', 'yesterday', 'thisWeek', 'older'];

const SORT_LABELS: Record<SortMode, string> = {
  updated: '최근 활동',
  created: '생성 순',
  name: '이름 순',
  manual: '직접 정렬'
};

function loadPins(): Set<string> {
  return new Set(loadJSON<string[]>(PINS_KEY, []));
}

function savePins(pins: Set<string>): void {
  saveJSON(PINS_KEY, Array.from(pins));
  window.dispatchEvent(new CustomEvent('agentview:pins-changed'));
}

function loadCollapsedGroups(): Set<string> {
  return new Set(loadJSON<string[]>(COLLAPSED_GROUPS_KEY, []));
}

function saveCollapsedGroups(set: Set<string>): void {
  saveJSON(COLLAPSED_GROUPS_KEY, Array.from(set));
}

function loadSearchHistory(): string[] {
  return loadJSON<string[]>(SEARCH_HISTORY_KEY, []);
}

function pushSearchHistory(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return loadSearchHistory();
  const prev = loadSearchHistory();
  const next = [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, SEARCH_HISTORY_MAX);
  saveJSON(SEARCH_HISTORY_KEY, next);
  return next;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const lowerText = text.toLowerCase();
  const lowerQ = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = lowerText.indexOf(lowerQ, i);
    if (hit === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(
      <mark key={`hl-${hit}`} className="hl">
        {text.slice(hit, hit + query.length)}
      </mark>
    );
    i = hit + query.length;
  }
  return parts;
}

interface SessionListProps {
  sessions: BgSession[];
  selectedId: string | null;
  onSelect: (s: BgSession) => void;
  onNewClick: () => void;
  renames: Record<string, string>;
  now: number;
}

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

function isErrorStatus(s: BgSession): boolean {
  return !s.alive && s.status === 'crashed';
}

function isWaitingStatus(s: BgSession): boolean {
  return s.alive && s.status === 'waiting';
}

function projectNameOf(cwd: string): string {
  if (!cwd) return '';
  const norm = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const last = norm.split('/').pop() || '';
  return last;
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

function applySort(list: BgSession[], mode: SortMode, renames: Record<string, string>): BgSession[] {
  const copy = list.slice();
  if (mode === 'created') {
    copy.sort((a, b) => b.startedAt - a.startedAt);
  } else if (mode === 'name') {
    copy.sort((a, b) => {
      const an = (renames[a.sessionId] || a.name || a.agent || a.sessionId).toLowerCase();
      const bn = (renames[b.sessionId] || b.name || b.agent || b.sessionId).toLowerCase();
      return an.localeCompare(bn);
    });
  } else {
    copy.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return copy;
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
  const [filter, setFilter] = useState<Filter>(() => loadJSON<Filter>(FILTER_KEY, 'all'));
  const [sortMode, setSortMode] = useState<SortMode>(() => loadSortMode());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: BgSession } | null>(null);
  const [pins, setPins] = useState<Set<string>>(() => loadPins());
  const [archived, setArchived] = useState<Set<string>>(() => loadArchive());
  const [tagMap, setTagMap] = useState<Record<string, SessionTag>>(() => loadTagsMap());
  const [sessionTags, setSessionTags] = useState<Record<string, string[]>>(() => loadSessionTags());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => loadCollapsedGroups());
  const [archiveOpen, setArchiveOpen] = useState<boolean>(() => loadJSON<boolean>(ARCHIVE_OPEN_KEY, false));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => loadSearchHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [activeTagFilters, setActiveTagFilters] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => { saveJSON(FILTER_KEY, filter); }, [filter]);
  useEffect(() => { saveSortMode(sortMode); }, [sortMode]);
  useEffect(() => { saveJSON(ARCHIVE_OPEN_KEY, archiveOpen); }, [archiveOpen]);

  useEffect(() => {
    const onPins = () => setPins(loadPins());
    const onArchive = () => setArchived(loadArchive());
    const onTags = () => {
      setTagMap(loadTagsMap());
      setSessionTags(loadSessionTags());
    };
    window.addEventListener('agentview:pins-changed', onPins);
    window.addEventListener('agentview:archive-changed', onArchive);
    window.addEventListener('agentview:tags-changed', onTags);
    return () => {
      window.removeEventListener('agentview:pins-changed', onPins);
      window.removeEventListener('agentview:archive-changed', onArchive);
      window.removeEventListener('agentview:tags-changed', onTags);
    };
  }, []);

  const togglePin = useCallback((sessionId: string) => {
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      savePins(next);
      return next;
    });
    setContextMenu(null);
  }, []);

  // Sidebar-scoped Ctrl/Cmd+K → focus search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        // The CommandPalette also listens for Ctrl+K — if any modal is open
        // it captures the event first. As a fallback (no palette), focus the
        // sidebar search instead so the keystroke is still useful.
        const palette = document.querySelector('.cmd-palette-dialog');
        if (palette) return;
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  useEffect(() => {
    if (!sortMenuOpen && !historyOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.session-list-sort-menu') || t.closest('.session-list-sort-btn')) return;
      if (t.closest('.session-list-search-history')) return;
      setSortMenuOpen(false);
      setHistoryOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [sortMenuOpen, historyOpen]);

  const counts = useMemo(
    () => ({
      all: sessions.length,
      active: sessions.filter(isActive).length,
      completed: sessions.filter(isCompleted).length,
      error: sessions.filter(isErrorStatus).length,
      waiting: sessions.filter(isWaitingStatus).length,
      archive: sessions.filter((s) => archived.has(s.sessionId)).length
    }),
    [sessions, archived]
  );

  const filtered = useMemo(() => {
    const list = sessions.filter((s) => {
      const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
      const preview = s.lastUserText ?? '';
      if (!matchesQuery(s, name, preview, query)) return false;
      if (filter === 'active' && !isActive(s)) return false;
      if (filter === 'completed' && !isCompleted(s)) return false;
      if (filter === 'error' && !isErrorStatus(s)) return false;
      if (filter === 'waiting' && !isWaitingStatus(s)) return false;
      if (activeTagFilters.size > 0) {
        const tags = sessionTags[s.sessionId] ?? [];
        if (!tags.some((t) => activeTagFilters.has(t))) return false;
      }
      return true;
    });
    return applySort(list, sortMode, renames);
  }, [sessions, query, filter, renames, sortMode, activeTagFilters, sessionTags]);

  // Bucket: archived → bottom; pinned → top; rest → time/manual groups.
  const archivedList = useMemo(
    () => filtered.filter((s) => archived.has(s.sessionId)),
    [filtered, archived]
  );
  const visibleNonArchived = useMemo(
    () => filtered.filter((s) => !archived.has(s.sessionId)),
    [filtered, archived]
  );
  const pinnedList = useMemo(
    () => visibleNonArchived.filter((s) => pins.has(s.sessionId)),
    [visibleNonArchived, pins]
  );
  const grouped = useMemo(() => {
    const map: Record<GroupKey, BgSession[]> = { today: [], yesterday: [], thisWeek: [], older: [] };
    for (const s of visibleNonArchived) {
      if (pins.has(s.sessionId)) continue;
      map[groupOf(s.updatedAt, now)].push(s);
    }
    return map;
  }, [visibleNonArchived, now, pins]);

  const flatOrder = useMemo(() => {
    const out: BgSession[] = [...pinnedList];
    for (const k of GROUP_ORDER) {
      if (collapsedGroups.has(k)) continue;
      out.push(...grouped[k]);
    }
    if (archiveOpen) out.push(...archivedList);
    return out;
  }, [grouped, pinnedList, collapsedGroups, archiveOpen, archivedList]);

  const toggleGroup = (k: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      saveCollapsedGroups(next);
      return next;
    });
  };

  const onSelectRow = useCallback(
    (s: BgSession, e?: React.MouseEvent) => {
      const shift = !!e?.shiftKey;
      const ctrl = !!(e?.ctrlKey || e?.metaKey);
      if (shift && lastSelectedRef.current) {
        // Shift-click: select range in flat order between last anchor and this row.
        const ids = flatOrder.map((x) => x.sessionId);
        const a = ids.indexOf(lastSelectedRef.current);
        const b = ids.indexOf(s.sessionId);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (let i = lo; i <= hi; i++) next.add(ids[i]);
            return next;
          });
        }
        return;
      }
      if (ctrl) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(s.sessionId)) next.delete(s.sessionId);
          else next.add(s.sessionId);
          return next;
        });
        lastSelectedRef.current = s.sessionId;
        return;
      }
      lastSelectedRef.current = s.sessionId;
      setSelectedIds(new Set());
      onSelect(s);
    },
    [flatOrder, onSelect]
  );

  // Multi-select bar action handlers.
  const clearSelection = () => setSelectedIds(new Set());
  const bulkArchive = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    doArchive(ids);
    setArchived(loadArchive());
    clearSelection();
  };
  const bulkUnarchive = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    doUnarchive(ids);
    setArchived(loadArchive());
    clearSelection();
  };
  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length}개 세션을 삭제합니다. 되돌릴 수 없습니다.`)) return;
    await window.av.sessions.deleteMany?.(ids).catch(() => undefined);
    clearSelection();
  };
  const allSelectedArchived = useMemo(() => {
    if (selectedIds.size === 0) return false;
    for (const id of selectedIds) if (!archived.has(id)) return false;
    return true;
  }, [selectedIds, archived]);

  const intersectionTags = useMemo(() => {
    if (selectedIds.size === 0) return [] as string[];
    const lists = Array.from(selectedIds).map((id) => sessionTags[id] ?? []);
    if (lists.length === 0) return [] as string[];
    return lists.reduce<string[]>(
      (acc, cur) => acc.filter((t) => cur.includes(t)),
      lists[0].slice()
    );
  }, [selectedIds, sessionTags]);

  const applyTagsToSelection = (tagIds: string[]) => {
    for (const id of selectedIds) setTagsOf(id, tagIds);
    setSessionTags(loadSessionTags());
    setTagMap(loadTagsMap());
  };

  const commitRename = useCallback(
    (sessionId: string) => {
      const trimmed = renameDraft.trim();
      saveRename(sessionId, trimmed || null);
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

  // Tab while renaming → save current and jump to the next row's rename.
  const renameTabNext = useCallback(
    (curId: string) => {
      commitRename(curId);
      const idx = flatOrder.findIndex((s) => s.sessionId === curId);
      const next = flatOrder[idx + 1];
      if (next) {
        // Kick off rename on the next session — defer one frame so the
        // commit above has time to dispatch the rename change event.
        requestAnimationFrame(() => startRename(next));
      }
    },
    [flatOrder, commitRename, startRename]
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

  const onArchiveSingle = useCallback((s: BgSession) => {
    setContextMenu(null);
    if (archived.has(s.sessionId)) doUnarchive([s.sessionId]);
    else doArchive([s.sessionId]);
    setArchived(loadArchive());
  }, [archived]);

  // Keyboard ↑/↓/Enter while the list has focus. scrollIntoView so the
  // newly-selected row stays in view (#29).
  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (renamingId) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      const idx = flatOrder.findIndex((s) => s.sessionId === selectedId);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = flatOrder[Math.min(flatOrder.length - 1, Math.max(-1, idx) + 1)];
        if (next) {
          onSelect(next);
          rowRefs.current.get(next.sessionId)?.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = flatOrder[Math.max(0, idx - 1)];
        if (prev) {
          onSelect(prev);
          rowRefs.current.get(prev.sessionId)?.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter') {
        const cur = flatOrder.find((s) => s.sessionId === selectedId);
        if (cur) onSelect(cur);
      }
    },
    [flatOrder, renamingId, onSelect, selectedId]
  );

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setQuery('');
      setHistoryOpen(false);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Enter') {
      if (query.trim()) setSearchHistory(pushSearchHistory(query));
      setHistoryOpen(false);
    } else if (e.key === 'ArrowDown' && historyOpen) {
      e.preventDefault();
      // Move focus to the first history item
      const first = document.querySelector<HTMLElement>('.session-list-search-history button');
      first?.focus();
    }
  };

  const allTags = useMemo(() => Object.values(tagMap), [tagMap]);
  const toggleTagFilter = (id: string) => {
    setActiveTagFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const emptyText =
    query || filter !== 'all' || activeTagFilters.size > 0
      ? '일치하는 세션 없음'
      : '세션 없음 — 위 "+ 새 작업"으로 시작하세요';

  const renderRow = (s: BgSession): React.ReactElement => {
    const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
    const preview = s.lastUserText || s.lastAssistantText || '';
    const previewSlice = preview.length > 60 ? preview.slice(0, 60) + '…' : preview;
    const isRenaming = renamingId === s.sessionId;
    const isPinned = pins.has(s.sessionId);
    const isMultiSelected = selectedIds.has(s.sessionId);
    const tags = sessionTags[s.sessionId] ?? [];
    const projectName = projectNameOf(s.cwd ?? '');
    return (
      <div
        key={s.sessionId}
        ref={(el) => {
          if (el) rowRefs.current.set(s.sessionId, el);
          else rowRefs.current.delete(s.sessionId);
        }}
        className={`session-list-item ${s.sessionId === selectedId ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''}`}
        onClick={(e) => !isRenaming && onSelectRow(s, e)}
        onDoubleClick={(e) => {
          e.preventDefault();
          startRename(s);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, session: s });
        }}
        role="option"
        aria-selected={s.sessionId === selectedId || isMultiSelected}
        tabIndex={-1}
        title={s.cwd ? `${name}\n${s.cwd}` : name}
      >
        <span className={`session-list-dot ${dotClass(s)}`} aria-hidden="true" />
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
                } else if (e.key === 'Tab') {
                  e.preventDefault();
                  renameTabNext(s.sessionId);
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
            <span className="session-list-name">
              {isPinned && <span className="session-list-pin-icon" aria-hidden="true">★ </span>}
              {highlightMatch(name, query)}
            </span>
          )}
          {tags.length > 0 && (
            <span className="session-list-tags" aria-label="태그">
              {tags.map((tid) => {
                const t = tagMap[tid];
                if (!t) return null;
                return (
                  <span key={tid} className="session-list-tag" style={{ background: t.color }} title={t.name}>
                    {t.name}
                  </span>
                );
              })}
            </span>
          )}
          <span className="session-list-sub">
            <span className={`session-list-status ${dotClass(s)}`}>{statusLabel(s)}</span>
            {projectName && (
              <span className="session-list-project" title={s.cwd ?? ''}>
                · {projectName}
              </span>
            )}
            {previewSlice && (
              <span className="session-list-preview" title={preview}>
                · {highlightMatch(previewSlice, query)}
              </span>
            )}
            <span className="session-list-time" title={new Date(s.updatedAt).toLocaleString('ko-KR')}>
              {formatRelative(s.updatedAt, now)}
            </span>
          </span>
        </span>
        {/* researcher item #47 — quick-resume icon shown on hover; clicking
            also routes through onSelect so the side panel opens. */}
        {s.alive && (
          <button
            type="button"
            className="session-list-resume-icon"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(s);
            }}
            title="이 세션 열기"
            aria-label="세션 열기"
          >▶</button>
        )}
      </div>
    );
  };

  return (
    <div className="session-list" onKeyDown={onListKeyDown} ref={containerRef} tabIndex={0} role="listbox" aria-label="세션 목록">
      <div className="session-list-head">
        <button type="button" className="btn primary session-list-new" onClick={onNewClick}>
          ＋ 새 작업
        </button>
        <button
          type="button"
          className="session-list-sort-btn"
          title="정렬 모드"
          aria-label="정렬 모드"
          onClick={() => setSortMenuOpen((v) => !v)}
        >
          ⇅ {SORT_LABELS[sortMode]}
        </button>
        {sortMenuOpen && (
          <div className="session-list-sort-menu" role="menu">
            {(['updated', 'created', 'name'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="menuitem"
                className={sortMode === m ? 'active' : ''}
                onClick={() => {
                  setSortMode(m);
                  setSortMenuOpen(false);
                }}
              >
                {SORT_LABELS[m]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="session-list-search-row">
        <span className="session-list-search-icon" aria-hidden="true">⌕</span>
        <input
          ref={searchRef}
          type="text"
          className="session-list-search"
          placeholder="검색 (Ctrl+K) · 이름·폴더·미리보기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setHistoryOpen(searchHistory.length > 0 && !query)}
          onBlur={() => window.setTimeout(() => setHistoryOpen(false), 120)}
          onKeyDown={onSearchKey}
          aria-label="세션 검색"
        />
        {query && (
          <button
            type="button"
            className="session-list-search-clear"
            onClick={() => setQuery('')}
            aria-label="검색어 지우기"
            title="검색어 지우기 (Esc)"
          >×</button>
        )}
        {historyOpen && (
          <div className="session-list-search-history" role="listbox" aria-label="검색 기록">
            {searchHistory.map((h) => (
              <button
                key={h}
                type="button"
                role="option"
                aria-selected={false}
                className="session-list-search-history-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(h);
                  setHistoryOpen(false);
                }}
              >
                <span>↺ {h}</span>
              </button>
            ))}
            {searchHistory.length === 0 && (
              <div className="session-list-search-history-empty">최근 검색 없음</div>
            )}
          </div>
        )}
      </div>
      <div className="session-list-filters" role="tablist">
        {FILTER_ORDER.map((f) => (
          <button
            key={f}
            type="button"
            className={`session-list-filter ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
          >
            {FILTER_LABELS[f]} <span className="session-list-filter-count">{counts[f]}</span>
          </button>
        ))}
      </div>
      {allTags.length > 0 && (
        <div className="session-list-tag-filters" aria-label="태그 필터">
          {allTags.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`session-list-tag-filter ${activeTagFilters.has(t.id) ? 'on' : ''}`}
              style={{
                borderColor: activeTagFilters.has(t.id) ? t.color : 'transparent',
                background: activeTagFilters.has(t.id) ? t.color : 'transparent'
              }}
              onClick={() => toggleTagFilter(t.id)}
              aria-pressed={activeTagFilters.has(t.id)}
            >
              {t.name}
            </button>
          ))}
          {activeTagFilters.size > 0 && (
            <button
              type="button"
              className="session-list-tag-filter clear"
              onClick={() => setActiveTagFilters(new Set())}
              title="태그 필터 모두 해제"
            >
              초기화
            </button>
          )}
        </div>
      )}
      <div className="session-list-body">
        {flatOrder.length === 0 && (
          <div className="session-list-empty">{emptyText}</div>
        )}
        {pinnedList.length > 0 && (
          <div className="session-list-group">
            <div className="session-list-group-header">★ 고정 ({pinnedList.length})</div>
            {pinnedList.map(renderRow)}
          </div>
        )}
        {GROUP_ORDER.map((g) => {
          const items = grouped[g];
          if (items.length === 0) return null;
          const isCollapsed = collapsedGroups.has(g);
          return (
            <div key={g} className="session-list-group">
              <button
                type="button"
                className="session-list-group-header collapsible"
                onClick={() => toggleGroup(g)}
                aria-expanded={!isCollapsed}
              >
                <span className="session-list-group-caret" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                {GROUP_LABELS[g]} <span className="session-list-group-count">({items.length})</span>
              </button>
              {!isCollapsed && items.map(renderRow)}
            </div>
          );
        })}
        {counts.archive > 0 && (
          <div className="session-list-group">
            <button
              type="button"
              className="session-list-group-header collapsible archive-toggle"
              onClick={() => setArchiveOpen((v) => !v)}
              aria-expanded={archiveOpen}
            >
              <span className="session-list-group-caret" aria-hidden="true">{archiveOpen ? '▾' : '▸'}</span>
              📦 아카이브 <span className="session-list-group-count">({counts.archive})</span>
            </button>
            {archiveOpen && archivedList.map(renderRow)}
          </div>
        )}
      </div>
      <SessionListMultiBar
        count={selectedIds.size}
        onClear={clearSelection}
        onDelete={bulkDelete}
        onArchive={bulkArchive}
        onUnarchive={bulkUnarchive}
        onTag={() => setTagDialogOpen(true)}
        allArchived={allSelectedArchived}
      />
      <SessionListTagDialog
        open={tagDialogOpen}
        appliedTagIds={intersectionTags}
        onClose={() => setTagDialogOpen(false)}
        onApply={applyTagsToSelection}
      />
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
            onClick={() => togglePin(contextMenu.session.sessionId)}
          >
            {pins.has(contextMenu.session.sessionId) ? '☆ 고정 해제' : '★ 상단 고정'}
          </button>
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
            onClick={() => {
              setSelectedIds(new Set([contextMenu.session.sessionId]));
              setTagDialogOpen(true);
              setContextMenu(null);
            }}
          >
            🏷 태그 지정
          </button>
          <button
            type="button"
            className="session-list-menu-item"
            onClick={() => onArchiveSingle(contextMenu.session)}
          >
            {archived.has(contextMenu.session.sessionId) ? '⤴ 아카이브 해제' : '📦 아카이브'}
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
