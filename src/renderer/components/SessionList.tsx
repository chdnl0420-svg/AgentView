import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { BgSession } from '@shared/types';
import { formatRelative } from '../lib/format';
import { loadJSON, saveJSON } from '../lib/persistence';

const RENAMES_KEY = 'sessionRenames';
const PINS_KEY = 'sessionPins';
const FILTER_KEY = 'sessionList.filter';
const PROJECT_FILTER_KEY = 'sessionList.projectFilter';
const ENV_FILTER_KEY = 'sessionList.envFilter';
const GROUP_BY_KEY = 'sessionList.groupBy';
const ALL_VALUE = '__all__';

function loadPins(): Set<string> {
  return new Set(loadJSON<string[]>(PINS_KEY, []));
}

function savePins(pins: Set<string>): void {
  saveJSON(PINS_KEY, Array.from(pins));
  window.dispatchEvent(new CustomEvent('agentview:pins-changed'));
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

// Claude Code Desktop (2026.04 redesign) 사이드바 필터 모델을 따른다.
//   status 차원: 단일 선택 드롭다운 (All / Running / Waiting / Completed)
//   project 차원: 단일 선택 드롭다운 (All / <cwd basename> ...)
//   environment 차원: 단일 선택 드롭다운 (All / <agent value> ...)
//   group by: 시간 그룹 (오늘/어제/이번 주/이전) vs 프로젝트 그룹
//
// 출처: claude.com/blog/claude-code-desktop-redesign, miraflow.ai,
//       devtoolpicks.com — 사이드바 상단 컨트롤이 status/project/environment
//       필터 + group by project 토글로 구성된다고 명시.

type Filter = 'all' | 'running' | 'waiting' | 'completed';
type GroupKey = 'today' | 'yesterday' | 'thisWeek' | 'older';
type GroupBy = 'time' | 'project';

const STATUS_LABELS: Record<Filter, string> = {
  all: '모든 상태',
  running: '실행 중',
  waiting: '대기',
  completed: '완료'
};

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

function isRunning(s: BgSession): boolean {
  return s.alive && s.status === 'running';
}

function isWaiting(s: BgSession): boolean {
  return s.alive && s.status !== 'running';
}

function isCompleted(s: BgSession): boolean {
  return !s.alive && s.status === 'completed';
}

function matchesStatus(s: BgSession, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'running') return isRunning(s);
  if (f === 'waiting') return isWaiting(s);
  if (f === 'completed') return isCompleted(s);
  return true;
}

/** cwd 의 마지막 디렉토리 이름 — Claude Code Desktop "Project" 필터 대응. */
function projectKey(s: BgSession): string {
  const cwd = s.cwd ?? '';
  if (!cwd) return '(미지정)';
  const norm = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  return norm.split('/').pop() || '(미지정)';
}

/** AgentView 의 환경 차원은 agent (claude / codex / external-claude / ...) 값. */
function envKey(s: BgSession): string {
  return s.agent || s.backend || '(기본)';
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
  const [filter, setFilter] = useState<Filter>(() => loadJSON<Filter>(FILTER_KEY, 'all'));
  const [projectFilter, setProjectFilter] = useState<string>(() =>
    loadJSON<string>(PROJECT_FILTER_KEY, ALL_VALUE)
  );
  const [envFilter, setEnvFilter] = useState<string>(() =>
    loadJSON<string>(ENV_FILTER_KEY, ALL_VALUE)
  );
  const [groupBy, setGroupBy] = useState<GroupBy>(() =>
    loadJSON<GroupBy>(GROUP_BY_KEY, 'time')
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Persist filter selections — Claude Code Desktop 도 사이드바 필터 상태를
  // 세션 간 유지하므로 동일하게 동작한다.
  useEffect(() => { saveJSON(FILTER_KEY, filter); }, [filter]);
  useEffect(() => { saveJSON(PROJECT_FILTER_KEY, projectFilter); }, [projectFilter]);
  useEffect(() => { saveJSON(ENV_FILTER_KEY, envFilter); }, [envFilter]);
  useEffect(() => { saveJSON(GROUP_BY_KEY, groupBy); }, [groupBy]);
  const [renameDraft, setRenameDraft] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; session: BgSession } | null>(null);
  const [pins, setPins] = useState<Set<string>>(() => loadPins());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Other windows / components fire agentview:pins-changed when they
  // toggle a pin — keep our local copy in sync so the "고정" group stays
  // accurate without a manual remount.
  useEffect(() => {
    const onChange = () => setPins(loadPins());
    window.addEventListener('agentview:pins-changed', onChange);
    return () => window.removeEventListener('agentview:pins-changed', onChange);
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

  // Build the option lists for project / environment dropdowns by walking the
  // session collection once. Counts are stable across re-renders thanks to
  // useMemo. status counts double as the label suffix in the dropdown options.
  const projectOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      const k = projectKey(s);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sessions]);
  const envOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      const k = envKey(s);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sessions]);
  const statusCounts = useMemo(
    () => ({
      all: sessions.length,
      running: sessions.filter(isRunning).length,
      waiting: sessions.filter(isWaiting).length,
      completed: sessions.filter(isCompleted).length,
    }),
    [sessions]
  );

  const filtered = useMemo(() => {
    const list = sessions.filter((s) => {
      const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
      const preview = s.lastUserText ?? '';
      if (!matchesQuery(s, name, preview, query)) return false;
      if (!matchesStatus(s, filter)) return false;
      if (projectFilter !== ALL_VALUE && projectKey(s) !== projectFilter) return false;
      if (envFilter !== ALL_VALUE && envKey(s) !== envFilter) return false;
      return true;
    });
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [sessions, query, filter, projectFilter, envFilter, renames]);

  // Bucket sessions: pinned ones float to a separate "고정" group at the
  // top, regardless of how recent they are; the rest fall back into
  // today/yesterday/thisWeek/older.
  const pinnedList = useMemo(
    () => filtered.filter((s) => pins.has(s.sessionId)),
    [filtered, pins]
  );
  // Time-grouped buckets — used when groupBy === 'time' (기본).
  const groupedByTime = useMemo(() => {
    const map: Record<GroupKey, BgSession[]> = { today: [], yesterday: [], thisWeek: [], older: [] };
    for (const s of filtered) {
      if (pins.has(s.sessionId)) continue;
      map[groupOf(s.updatedAt, now)].push(s);
    }
    return map;
  }, [filtered, now, pins]);

  // Project-grouped buckets — Claude Code Desktop 의 "Group by project" 동작.
  // 키는 projectKey(s) 결과이며, 그룹 정렬은 그룹 내 최신 세션의 updatedAt.
  const groupedByProject = useMemo(() => {
    const buckets = new Map<string, BgSession[]>();
    for (const s of filtered) {
      if (pins.has(s.sessionId)) continue;
      const k = projectKey(s);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(s);
    }
    return Array.from(buckets.entries()).sort((a, b) => {
      const aLatest = a[1][0]?.updatedAt ?? 0;
      const bLatest = b[1][0]?.updatedAt ?? 0;
      return bLatest - aLatest;
    });
  }, [filtered, pins]);

  // Flat order for keyboard navigation: pinned first, then whichever bucket
  // mode is active. Required so ↑/↓ 탐색이 시각 순서를 그대로 따라간다.
  const flatOrder = useMemo(() => {
    const out: BgSession[] = [...pinnedList];
    if (groupBy === 'project') {
      for (const [, items] of groupedByProject) out.push(...items);
    } else {
      for (const k of GROUP_ORDER) out.push(...groupedByTime[k]);
    }
    return out;
  }, [groupedByTime, groupedByProject, pinnedList, groupBy]);

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
    query || filter !== 'all' || projectFilter !== ALL_VALUE || envFilter !== ALL_VALUE
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
            <span className={`session-list-status ${dotClass(s)}`}>{statusLabel(s)}</span>
            {previewSlice && (
              <span className="session-list-preview" title={preview}>
                · {highlightMatch(previewSlice, query)}
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
      {/* Claude Code Desktop (2026.04) 사이드바 필터 패턴:
          상단에 status / project / environment 드롭다운 3 + group by 토글.
          기존 "모두/실행 중/완료" chip row 는 제거됨. 출처:
          claude.com/blog/claude-code-desktop-redesign + miraflow guide. */}
      <div className="session-list-controls" role="group" aria-label="세션 필터">
        <select
          className="session-list-control"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          aria-label="상태 필터"
          title="상태 필터"
        >
          <option value="all">{STATUS_LABELS.all} ({statusCounts.all})</option>
          <option value="running">{STATUS_LABELS.running} ({statusCounts.running})</option>
          <option value="waiting">{STATUS_LABELS.waiting} ({statusCounts.waiting})</option>
          <option value="completed">{STATUS_LABELS.completed} ({statusCounts.completed})</option>
        </select>
        <select
          className="session-list-control"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          aria-label="프로젝트 필터"
          title="프로젝트 필터"
        >
          <option value={ALL_VALUE}>모든 프로젝트 ({sessions.length})</option>
          {projectOptions.map(([k, n]) => (
            <option key={k} value={k}>{k} ({n})</option>
          ))}
        </select>
        <select
          className="session-list-control"
          value={envFilter}
          onChange={(e) => setEnvFilter(e.target.value)}
          aria-label="환경 필터"
          title="환경 필터 (에이전트 / 백엔드)"
        >
          <option value={ALL_VALUE}>모든 환경 ({sessions.length})</option>
          {envOptions.map(([k, n]) => (
            <option key={k} value={k}>{k} ({n})</option>
          ))}
        </select>
        <button
          type="button"
          className={`session-list-control session-list-groupby ${groupBy === 'project' ? 'on' : ''}`}
          onClick={() => setGroupBy((g) => (g === 'project' ? 'time' : 'project'))}
          aria-pressed={groupBy === 'project'}
          title={groupBy === 'project' ? '시간 그룹으로 보기' : '프로젝트 그룹으로 보기'}
        >
          {groupBy === 'project' ? '⊟ 프로젝트' : '⊞ 시간'}
        </button>
      </div>
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
        {groupBy === 'project'
          ? groupedByProject.map(([projectName, items]) => (
              <div key={projectName} className="session-list-group">
                <div className="session-list-group-header" title={projectName}>
                  📁 {projectName} <span className="session-list-group-count">({items.length})</span>
                </div>
                {items.map((s) => renderRow(s))}
              </div>
            ))
          : GROUP_ORDER.map((g) => {
              const items = groupedByTime[g];
              if (items.length === 0) return null;
              return (
                <div key={g} className="session-list-group">
                  <div className="session-list-group-header">{GROUP_LABELS[g]}</div>
                  {items.map((s) => renderRow(s))}
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
