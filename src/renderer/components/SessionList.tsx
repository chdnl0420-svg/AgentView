import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { BgSession } from '@shared/types';
import { formatRelative } from '../lib/format';
import { loadJSON, saveJSON } from '../lib/persistence';
import {
  SessionListFilterMenu,
  DEFAULT_FILTERS,
  type FilterState
} from './SessionListFilterMenu';

const RENAMES_KEY = 'sessionRenames';
const PINS_KEY = 'sessionPins';
const FILTERS_KEY = 'sessionList.filters';
const COLLAPSED_GROUPS_KEY = 'sessionList.collapsedGroups';
const ARCHIVED_KEY = 'sessionArchived';
const GROUPS_KEY = 'sessionGroups';
const GROUP_MEMBERSHIP_KEY = 'sessionGroupMembership';

interface UserGroup {
  id: string;
  name: string;
}

function loadPins(): Set<string> {
  return new Set(loadJSON<string[]>(PINS_KEY, []));
}

function savePins(pins: Set<string>): void {
  saveJSON(PINS_KEY, Array.from(pins));
  window.dispatchEvent(new CustomEvent('agentview:pins-changed'));
}

function loadArchived(): Set<string> {
  return new Set(loadJSON<string[]>(ARCHIVED_KEY, []));
}

function saveArchived(archived: Set<string>): void {
  saveJSON(ARCHIVED_KEY, Array.from(archived));
  window.dispatchEvent(new CustomEvent('agentview:archived-changed'));
}

function loadGroups(): UserGroup[] {
  return loadJSON<UserGroup[]>(GROUPS_KEY, []);
}

function saveGroups(groups: UserGroup[]): void {
  saveJSON(GROUPS_KEY, groups);
  window.dispatchEvent(new CustomEvent('agentview:groups-changed'));
}

function loadGroupMembership(): Record<string, string> {
  return loadJSON<Record<string, string>>(GROUP_MEMBERSHIP_KEY, {});
}

function saveGroupMembership(map: Record<string, string>): void {
  saveJSON(GROUP_MEMBERSHIP_KEY, map);
  window.dispatchEvent(new CustomEvent('agentview:group-membership-changed'));
}

// Highlight matches of `query` inside `text` by wrapping them with
// <mark class="hl">. Case-insensitive, plain substring search (no regex
// metacharacters). Returns the original text when query is empty.
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

type TimeGroupKey = 'today' | 'yesterday' | 'thisWeek' | 'older';

const TIME_GROUP_LABELS: Record<TimeGroupKey, string> = {
  today: '오늘',
  yesterday: '어제',
  thisWeek: '이번 주',
  older: '이전',
};
const TIME_GROUP_ORDER: TimeGroupKey[] = ['today', 'yesterday', 'thisWeek', 'older'];

const LAST_ACTIVITY_MS: Record<'1d' | '3d' | '7d' | '30d', number> = {
  '1d': 86_400_000,
  '3d': 3 * 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** 환경 차원 매핑 — AgentView 의 backend/agent 값을 Claude Code Desktop 표기에 맞춤. */
function envOf(s: BgSession): 'local' | 'cloud' | 'remote' {
  const backend = s.backend ?? 'claude';
  if (backend === 'external-claude') return 'remote';
  // 본 앱은 cloud routine 이 없으므로 cloud 매칭은 0개. UX 일관성 위해 옵션은 노출.
  return 'local';
}

function projectKey(s: BgSession): string {
  const cwd = s.cwd ?? '';
  if (!cwd) return '(미지정)';
  const norm = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  return norm.split('/').pop() || '(미지정)';
}

function dotClass(s: BgSession): string {
  if (!s.alive) return s.status === 'completed' ? 'completed' : s.status === 'crashed' ? 'crashed' : 'finished';
  return s.status === 'running' ? 'running' : 'waiting';
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

function timeGroupOf(updatedAt: number, now: number): TimeGroupKey {
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

// `archived` 는 호출부에서 항상 전달돼야 정확한 status 분류가 되지만, 누락 시
// 함수 전체가 undefined.has() 로 폭발하는 사고가 한 번 있었기 때문에 default
// 빈 Set 으로 방어한다. 빈 Set 일 때는 명시적으로 보관 처리된 세션 0개로 간주.
function matchesFilters(
  s: BgSession,
  f: FilterState,
  now: number,
  archived: Set<string> = new Set()
): boolean {
  const isArchived = archived.has(s.sessionId);
  // Status — 'archived' 는 사용자가 명시적으로 보관 처리한 세션 OR 종료된 세션.
  // 'active' 는 alive 이면서 사용자가 보관하지 않은 세션.
  if (f.status === 'active' && (isArchived || !s.alive)) return false;
  if (f.status === 'archived' && !isArchived && s.alive) return false;
  // Project
  if (f.project !== 'all' && projectKey(s) !== f.project) return false;
  // Environment — 'all' 외 한 옵션만 매칭. 본 앱에 cloud 없음.
  if (f.environment !== 'all' && envOf(s) !== f.environment) return false;
  // Last activity
  if (f.lastActivity !== 'all') {
    const limit = LAST_ACTIVITY_MS[f.lastActivity];
    if (now - s.updatedAt > limit) return false;
  }
  return true;
}

function sortSessions(list: BgSession[], by: FilterState['sortBy'], renames: Record<string, string>): BgSession[] {
  const out = list.slice();
  if (by === 'recency') out.sort((a, b) => b.updatedAt - a.updatedAt);
  else if (by === 'created') out.sort((a, b) => b.startedAt - a.startedAt);
  else if (by === 'name') {
    out.sort((a, b) => {
      const an = (renames[a.sessionId] || a.name || a.agent || a.sessionId).toLowerCase();
      const bn = (renames[b.sessionId] || b.name || b.agent || b.sessionId).toLowerCase();
      return an.localeCompare(bn);
    });
  }
  return out;
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
  const [filters, setFilters] = useState<FilterState>(() =>
    loadJSON<FilterState>(FILTERS_KEY, DEFAULT_FILTERS)
  );
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<DOMRect | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { saveJSON(FILTERS_KEY, filters); }, [filters]);
  // 그룹 collapse 상태 — bucket.key 를 키로 저장.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() =>
    new Set(loadJSON<string[]>(COLLAPSED_GROUPS_KEY, []))
  );
  const toggleGroupCollapsed = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveJSON(COLLAPSED_GROUPS_KEY, Array.from(next));
      return next;
    });
  }, []);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: BgSession } | null>(null);
  const [groupSubmenuOpen, setGroupSubmenuOpen] = useState(false);
  const [pins, setPins] = useState<Set<string>>(() => loadPins());
  const [archived, setArchived] = useState<Set<string>>(() => loadArchived());
  const [groups, setGroups] = useState<UserGroup[]>(() => loadGroups());
  const [groupMembership, setGroupMembership] = useState<Record<string, string>>(() => loadGroupMembership());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Other windows / components fire agentview:pins-changed when they
  // toggle a pin — keep our local copy in sync so the "고정" group stays
  // accurate without a manual remount.
  useEffect(() => {
    const onPins = () => setPins(loadPins());
    const onArchived = () => setArchived(loadArchived());
    const onGroups = () => setGroups(loadGroups());
    const onMembership = () => setGroupMembership(loadGroupMembership());
    window.addEventListener('agentview:pins-changed', onPins);
    window.addEventListener('agentview:archived-changed', onArchived);
    window.addEventListener('agentview:groups-changed', onGroups);
    window.addEventListener('agentview:group-membership-changed', onMembership);
    return () => {
      window.removeEventListener('agentview:pins-changed', onPins);
      window.removeEventListener('agentview:archived-changed', onArchived);
      window.removeEventListener('agentview:groups-changed', onGroups);
      window.removeEventListener('agentview:group-membership-changed', onMembership);
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

  const toggleArchive = useCallback((sessionId: string) => {
    setArchived((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      saveArchived(next);
      return next;
    });
    setContextMenu(null);
  }, []);

  const assignGroup = useCallback((sessionId: string, groupId: string | null) => {
    setGroupMembership((prev) => {
      const next = { ...prev };
      if (groupId) next[sessionId] = groupId;
      else delete next[sessionId];
      saveGroupMembership(next);
      return next;
    });
    setGroupSubmenuOpen(false);
    setContextMenu(null);
  }, []);

  const createGroupAndAssign = useCallback((sessionId: string) => {
    const name = window.prompt('새 그룹 이름');
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    const newGroup: UserGroup = {
      id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed
    };
    setGroups((prev) => {
      const next = [...prev, newGroup];
      saveGroups(next);
      return next;
    });
    assignGroup(sessionId, newGroup.id);
  }, [assignGroup]);

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

  // contextMenu 의 키보드 단축키 (P/R/A/D) 가 참조해야 하는 핸들러는
  // 함수 본문 하단에 정의된다. TDZ 회피용 ref — 매 render 마다 최신
  // 함수로 갱신해두고, useEffect 안에서는 ref.current 만 호출한다.
  const menuActionsRef = useRef<{
    togglePin: (id: string) => void;
    toggleArchive: (id: string) => void;
    startRename: (s: BgSession) => void;
    onDelete: (s: BgSession) => void;
  } | null>(null);

  // Close context menu on any outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      setContextMenu(null);
      setGroupSubmenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      const actions = menuActionsRef.current;
      if (!actions) return;
      const s = contextMenu.session;
      const k = e.key.toLowerCase();
      if (k === 'p') {
        e.preventDefault();
        actions.togglePin(s.sessionId);
      } else if (k === 'r') {
        e.preventDefault();
        actions.startRename(s);
      } else if (k === 'a') {
        e.preventDefault();
        actions.toggleArchive(s.sessionId);
      } else if (k === 'd') {
        e.preventDefault();
        actions.onDelete(s);
      }
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

  // Distinct project list for the filter popup. Derived from the full
  // unfiltered session set so the project menu always shows every option.
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) set.add(projectKey(s));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sessions]);

  const filtered = useMemo(() => {
    const list = sessions.filter((s) => {
      const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
      const preview = s.lastUserText ?? '';
      if (!matchesQuery(s, name, preview, query)) return false;
      if (!matchesFilters(s, filters, now, archived)) return false;
      return true;
    });
    return sortSessions(list, filters.sortBy, renames);
  }, [sessions, query, filters, now, renames, archived]);

  // Pinned ones float to a separate "고정" group at the top, regardless of
  // grouping mode.
  const pinnedList = useMemo(
    () => filtered.filter((s) => pins.has(s.sessionId)),
    [filtered, pins]
  );

  type Bucket = { key: string; label: string; items: BgSession[] };

  const buckets = useMemo<Bucket[]>(() => {
    const nonPinned = filtered.filter((s) => !pins.has(s.sessionId));
    if (filters.groupBy === 'recency') {
      const map: Record<TimeGroupKey, BgSession[]> = { today: [], yesterday: [], thisWeek: [], older: [] };
      for (const s of nonPinned) map[timeGroupOf(s.updatedAt, now)].push(s);
      return TIME_GROUP_ORDER
        .filter((k) => map[k].length > 0)
        .map((k) => ({ key: k, label: TIME_GROUP_LABELS[k], items: map[k] }));
    }
    if (filters.groupBy === 'project') {
      const map = new Map<string, BgSession[]>();
      for (const s of nonPinned) {
        const k = projectKey(s);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(s);
      }
      return Array.from(map.entries())
        .sort((a, b) => (b[1][0]?.updatedAt ?? 0) - (a[1][0]?.updatedAt ?? 0))
        .map(([k, items]) => ({ key: `proj-${k}`, label: k, items }));
    }
    if (filters.groupBy === 'environment') {
      const map = new Map<string, BgSession[]>();
      for (const s of nonPinned) {
        const k = envOf(s);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(s);
      }
      const ORDER: Record<string, number> = { local: 0, cloud: 1, remote: 2 };
      return Array.from(map.entries())
        .sort((a, b) => (ORDER[a[0]] ?? 9) - (ORDER[b[0]] ?? 9))
        .map(([k, items]) => ({ key: `env-${k}`, label: k === 'local' ? 'Local' : k === 'cloud' ? 'Cloud' : 'Remote Control', items }));
    }
    // 'status' grouping
    const activeItems: BgSession[] = [];
    const archivedItems: BgSession[] = [];
    for (const s of nonPinned) (s.alive ? activeItems : archivedItems).push(s);
    return [
      activeItems.length ? { key: 'st-active', label: 'Active', items: activeItems } : null,
      archivedItems.length ? { key: 'st-archived', label: 'Archived', items: archivedItems } : null
    ].filter(Boolean) as Bucket[];
  }, [filtered, pins, filters.groupBy, now]);

  // Flat order for keyboard navigation: pinned first, then bucket order.
  // Collapsed groups are skipped so ↑/↓ navigation matches what the user sees.
  const flatOrder = useMemo(() => {
    const out: BgSession[] = [...pinnedList];
    for (const b of buckets) {
      if (collapsedGroups.has(b.key)) continue;
      out.push(...b.items);
    }
    return out;
  }, [buckets, pinnedList, collapsedGroups]);

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

  // 매 render 마다 최신 콜백을 ref 에 적재 — 위쪽 contextMenu useEffect 가
  // TDZ 없이 호출할 수 있게 한다.
  menuActionsRef.current = { togglePin, toggleArchive, startRename, onDelete };

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

  const filtersActive =
    filters.status !== DEFAULT_FILTERS.status ||
    filters.project !== DEFAULT_FILTERS.project ||
    filters.environment !== DEFAULT_FILTERS.environment ||
    filters.lastActivity !== DEFAULT_FILTERS.lastActivity;

  const emptyText =
    query || filtersActive
      ? '일치하는 세션 없음'
      : '세션 없음 — 위 "+ 새 작업"으로 시작하세요';

  const renderRow = (s: BgSession): React.ReactElement => {
    const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
    const preview = s.lastUserText || s.lastAssistantText || '';
    const previewSlice = preview.length > 60 ? preview.slice(0, 60) + '…' : preview;
    const isRenaming = renamingId === s.sessionId;
    const isPinned = pins.has(s.sessionId);
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
            <span className="session-list-name">
              {isPinned && <span className="session-list-pin-icon" aria-hidden="true">★ </span>}
              {highlightMatch(name, query)}
            </span>
          )}
          <span className="session-list-sub">
            {/* 상태 텍스트 ("실행 중"/"완료"/"대기"/...) 제거 — 색상 dot
                만으로 표현 (Claude Code Desktop 사이드바 패턴). */}
            {previewSlice && (
              <span className="session-list-preview" title={preview}>
                {highlightMatch(previewSlice, query)}
              </span>
            )}
            <span className="session-list-time">{formatRelative(s.updatedAt, now)}</span>
          </span>
        </span>
      </div>
    );
  };

  return (
    <div className="session-list" onKeyDown={onListKeyDown} ref={containerRef} tabIndex={0}>
      <div className="session-list-head">
        <button type="button" className="btn primary session-list-new" onClick={onNewClick}>
          ＋ 새 작업
        </button>
        <button
          ref={filterTriggerRef}
          type="button"
          className={`session-list-filter-trigger ${filtersActive ? 'has-active' : ''}`}
          onClick={() => {
            const rect = filterTriggerRef.current?.getBoundingClientRect() ?? null;
            setFilterAnchor(rect);
            setFilterMenuOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={filterMenuOpen}
          title="필터 메뉴"
          aria-label="세션 필터 메뉴"
        >
          {/* Filter / sliders icon (3 horizontal sliders) */}
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M2 3.5h7.5v1H2v-1zm10.5 0H14v1h-1.5v-1zM2 7.5h2.5v1H2v-1zm5.5 0H14v1H7.5v-1zM2 11.5h7.5v1H2v-1zm10.5 0H14v1h-1.5v-1z"
            />
            <circle cx="10.5" cy="4" r="1.5" fill="currentColor" />
            <circle cx="5.5" cy="8" r="1.5" fill="currentColor" />
            <circle cx="10.5" cy="12" r="1.5" fill="currentColor" />
          </svg>
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
      {/* Filter chip row removed — replaced by the SessionListFilterMenu
          popup triggered from the head slider icon (Claude Code Desktop
          2026.04 sidebar pattern). */}
      <div className="session-list-body">
        {flatOrder.length === 0 && (
          <div className="session-list-empty">{emptyText}</div>
        )}
        {pinnedList.length > 0 && (
          <div className="session-list-group">
            <div className="session-list-group-header">★ 고정</div>
            {pinnedList.map((s) => renderRow(s))}
          </div>
        )}
        {buckets.map((b) => {
          const isCollapsed = collapsedGroups.has(b.key);
          return (
            <div key={b.key} className="session-list-group">
              <button
                type="button"
                className="session-list-group-header collapsible"
                onClick={() => toggleGroupCollapsed(b.key)}
                aria-expanded={!isCollapsed}
                title={isCollapsed ? '펼치기' : '접기'}
              >
                <span className="session-list-group-caret" aria-hidden="true">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span className="session-list-group-label">{b.label}</span>
                <span className="session-list-group-count">{b.items.length}</span>
              </button>
              {!isCollapsed && b.items.map((s) => renderRow(s))}
            </div>
          );
        })}
      </div>
      <SessionListFilterMenu
        open={filterMenuOpen}
        filters={filters}
        projectOptions={projectOptions}
        anchor={filterAnchor}
        triggerRef={filterTriggerRef}
        onChange={setFilters}
        onClose={() => setFilterMenuOpen(false)}
      />
      {contextMenu && (() => {
        const s = contextMenu.session;
        const isPinned = pins.has(s.sessionId);
        const isArchivedRow = archived.has(s.sessionId);
        const currentGroupId = groupMembership[s.sessionId] ?? null;
        return (
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
              onClick={() => onOpenFolder(s)}
              disabled={!s.cwd}
            >
              <span className="session-list-menu-label">다음에서 열기</span>
              <span className="session-list-menu-caret">›</span>
            </button>
            <button
              type="button"
              className="session-list-menu-item"
              onClick={() => togglePin(s.sessionId)}
            >
              <span className="session-list-menu-label">{isPinned ? '고정 해제' : '고정'}</span>
              <span className="session-list-menu-kbd">P</span>
            </button>
            <button
              type="button"
              className="session-list-menu-item"
              onClick={() => onCopyId(s)}
              title="세션 ID 복사"
            >
              <span className="session-list-menu-label">세션 ID 복사</span>
              <span className="session-list-menu-kbd">U</span>
            </button>
            <button
              type="button"
              className="session-list-menu-item"
              onClick={() => startRename(s)}
            >
              <span className="session-list-menu-label">이름 변경</span>
              <span className="session-list-menu-kbd">R</span>
            </button>
            <button
              type="button"
              className="session-list-menu-item"
              onMouseEnter={() => setGroupSubmenuOpen(true)}
              onClick={() => setGroupSubmenuOpen((v) => !v)}
            >
              <span className="session-list-menu-label">그룹으로 이동</span>
              <span className="session-list-menu-caret">›</span>
              {groupSubmenuOpen && (
                <div
                  className="session-list-menu session-list-menu-submenu"
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {groups.length === 0 && (
                    <div className="session-list-menu-empty">그룹 없음</div>
                  )}
                  {groups.map((g, idx) => {
                    const checked = currentGroupId === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        className={`session-list-menu-item ${checked ? 'checked' : ''}`}
                        onClick={() => assignGroup(s.sessionId, checked ? null : g.id)}
                        title={g.name}
                      >
                        <span className="session-list-menu-label">{g.name}</span>
                        <span className="session-list-menu-kbd">{idx + 1}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="session-list-menu-item"
                    onClick={() => createGroupAndAssign(s.sessionId)}
                  >
                    <span className="session-list-menu-label">새 그룹…</span>
                    <span className="session-list-menu-kbd">{groups.length + 1}</span>
                  </button>
                </div>
              )}
            </button>
            <button
              type="button"
              className="session-list-menu-item"
              onClick={() => toggleArchive(s.sessionId)}
            >
              <span className="session-list-menu-label">{isArchivedRow ? '보관 해제' : '보관'}</span>
              <span className="session-list-menu-kbd">A</span>
            </button>
            <button
              type="button"
              className="session-list-menu-item danger"
              onClick={() => onDelete(s)}
            >
              <span className="session-list-menu-label">삭제</span>
              <span className="session-list-menu-kbd">D</span>
            </button>
          </div>
        );
      })()}
    </div>
  );
}
