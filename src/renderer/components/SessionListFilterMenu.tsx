import { useEffect, useRef, useState } from 'react';
import type React from 'react';

// Claude Code Desktop (2026.04 redesign) 의 사이드바 필터 menu 패턴.
// 헤더 우측 슬라이더 아이콘 → cascading popup 으로 다음 컨트롤 노출:
//   Status / Project / Environment / Last activity / Group by / Sort by /
//   Clear filters. 각 행은 우측 화살표 + 현재 선택값을 표시하고, hover/click
//   시 옆에 sub-panel 이 펼쳐져 값 목록을 보여준다.

export type StatusValue = 'active' | 'archived' | 'all';
export type EnvironmentValue = 'local' | 'cloud' | 'remote' | 'all';
export type LastActivityValue = '1d' | '3d' | '7d' | '30d' | 'all';
export type GroupByValue = 'project' | 'recency' | 'environment' | 'status';
export type SortByValue = 'recency' | 'created' | 'name';

export interface FilterState {
  status: StatusValue;
  project: string;            // 'all' or cwd basename
  environment: EnvironmentValue;
  lastActivity: LastActivityValue;
  groupBy: GroupByValue;
  sortBy: SortByValue;
}

export const DEFAULT_FILTERS: FilterState = {
  status: 'active',
  project: 'all',
  environment: 'all',
  lastActivity: '1d',
  groupBy: 'project',
  sortBy: 'recency'
};

const STATUS_LABEL: Record<StatusValue, string> = {
  active: 'Active',
  archived: 'Archived',
  all: 'All'
};
const ENV_LABEL: Record<EnvironmentValue, string> = {
  local: 'Local',
  cloud: 'Cloud',
  remote: 'Remote Control',
  all: 'All'
};
const LAST_ACTIVITY_LABEL: Record<LastActivityValue, string> = {
  '1d': '1d',
  '3d': '3d',
  '7d': '7d',
  '30d': '30d',
  all: 'All'
};
const GROUP_BY_LABEL: Record<GroupByValue, string> = {
  project: 'Project',
  recency: 'Recency',
  environment: 'Environment',
  status: 'Status'
};
const SORT_BY_LABEL: Record<SortByValue, string> = {
  recency: 'Recency',
  created: 'Created',
  name: 'Name'
};

type SubmenuId = 'status' | 'project' | 'environment' | 'lastActivity' | 'groupBy' | 'sortBy' | null;

interface SessionListFilterMenuProps {
  open: boolean;
  filters: FilterState;
  /** Distinct project names available in the current session list. */
  projectOptions: string[];
  onChange: (next: FilterState) => void;
  onClose: () => void;
  /** Anchor element rect used to position the popup relative to the trigger. */
  anchor: DOMRect | null;
}

/**
 * Cascading popup menu — matches the Claude Code Desktop sidebar filter
 * dropdown. Rendered as a portal-like absolute layer; the parent decides
 * when to mount via `open`.
 */
export function SessionListFilterMenu({
  open,
  filters,
  projectOptions,
  onChange,
  onClose,
  anchor
}: SessionListFilterMenuProps) {
  const [submenu, setSubmenu] = useState<SubmenuId>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Reset submenu only when the popup toggles between closed/open. Don't put
  // `submenu` in this effect's deps — that caused the listener teardown +
  // re-attach to fire on every submenu change, and the inline `setSubmenu(null)`
  // immediately collapsed any submenu the user had just opened.
  useEffect(() => {
    if (!open) return;
    setSubmenu(null);
  }, [open]);

  // Outside-click / Escape handlers. Use a functional state update for Escape
  // so we can read the latest `submenu` value without re-registering the
  // listener on every change.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setSubmenu((cur) => {
        if (cur) return null;
        onClose();
        return cur;
      });
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Anchor the popup just below the trigger, aligned to its right edge so
  // the popup hangs into the viewport on a narrow sidebar.
  const popupStyle: React.CSSProperties = anchor
    ? {
        position: 'fixed',
        top: anchor.bottom + 6,
        left: Math.max(8, anchor.right - 220)
      }
    : { position: 'fixed', top: 60, left: 12 };

  // submenu 의 값 선택 시 popup 전체를 닫는다 — 사용자 요구. 한 번의
  // 선택 → 사이드바 즉시 확인이 자연스러운 흐름.
  const pickValue = (next: FilterState) => {
    onChange(next);
    setSubmenu(null);
    onClose();
  };
  const setStatus = (v: StatusValue) => pickValue({ ...filters, status: v });
  const setProject = (v: string) => pickValue({ ...filters, project: v });
  const setEnvironment = (v: EnvironmentValue) => pickValue({ ...filters, environment: v });
  const setLastActivity = (v: LastActivityValue) => pickValue({ ...filters, lastActivity: v });
  const setGroupBy = (v: GroupByValue) => pickValue({ ...filters, groupBy: v });
  const setSortBy = (v: SortByValue) => pickValue({ ...filters, sortBy: v });
  const clearAll = () => pickValue({ ...DEFAULT_FILTERS });

  const renderSubmenu = () => {
    if (!submenu) return null;
    if (submenu === 'status') {
      return (
        <div className="sl-filter-submenu" role="menu">
          {(['active', 'archived', 'all'] as StatusValue[]).map((v) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={filters.status === v}
              className={`sl-filter-row ${filters.status === v ? 'checked' : ''}`}
              onClick={() => setStatus(v)}
            >
              <span>{STATUS_LABEL[v]}</span>
              {filters.status === v && <span className="sl-filter-check">✓</span>}
            </button>
          ))}
        </div>
      );
    }
    if (submenu === 'project') {
      return (
        <div className="sl-filter-submenu sl-filter-submenu-scroll" role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={filters.project === 'all'}
            className={`sl-filter-row ${filters.project === 'all' ? 'checked' : ''}`}
            onClick={() => setProject('all')}
          >
            <span>All projects</span>
            {filters.project === 'all' && <span className="sl-filter-check">✓</span>}
          </button>
          {projectOptions.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitemradio"
              aria-checked={filters.project === p}
              className={`sl-filter-row ${filters.project === p ? 'checked' : ''}`}
              onClick={() => setProject(p)}
              title={p}
            >
              <span className="sl-filter-row-label">{p}</span>
              {filters.project === p && <span className="sl-filter-check">✓</span>}
            </button>
          ))}
        </div>
      );
    }
    if (submenu === 'environment') {
      return (
        <div className="sl-filter-submenu" role="menu">
          {(['local', 'cloud', 'remote', 'all'] as EnvironmentValue[]).map((v) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={filters.environment === v}
              className={`sl-filter-row ${filters.environment === v ? 'checked' : ''}`}
              onClick={() => setEnvironment(v)}
            >
              <span>{ENV_LABEL[v]}</span>
              {filters.environment === v && <span className="sl-filter-check">✓</span>}
            </button>
          ))}
        </div>
      );
    }
    if (submenu === 'lastActivity') {
      return (
        <div className="sl-filter-submenu" role="menu">
          {(['1d', '3d', '7d', '30d', 'all'] as LastActivityValue[]).map((v) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={filters.lastActivity === v}
              className={`sl-filter-row ${filters.lastActivity === v ? 'checked' : ''}`}
              onClick={() => setLastActivity(v)}
            >
              <span>{LAST_ACTIVITY_LABEL[v]}</span>
              {filters.lastActivity === v && <span className="sl-filter-check">✓</span>}
            </button>
          ))}
        </div>
      );
    }
    if (submenu === 'groupBy') {
      return (
        <div className="sl-filter-submenu" role="menu">
          {(['project', 'recency', 'environment', 'status'] as GroupByValue[]).map((v) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={filters.groupBy === v}
              className={`sl-filter-row ${filters.groupBy === v ? 'checked' : ''}`}
              onClick={() => setGroupBy(v)}
            >
              <span>{GROUP_BY_LABEL[v]}</span>
              {filters.groupBy === v && <span className="sl-filter-check">✓</span>}
            </button>
          ))}
        </div>
      );
    }
    if (submenu === 'sortBy') {
      return (
        <div className="sl-filter-submenu" role="menu">
          {(['recency', 'created', 'name'] as SortByValue[]).map((v) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={filters.sortBy === v}
              className={`sl-filter-row ${filters.sortBy === v ? 'checked' : ''}`}
              onClick={() => setSortBy(v)}
            >
              <span>{SORT_BY_LABEL[v]}</span>
              {filters.sortBy === v && <span className="sl-filter-check">✓</span>}
            </button>
          ))}
        </div>
      );
    }
    return null;
  };

  const valueLabel = {
    status: STATUS_LABEL[filters.status],
    project: filters.project === 'all' ? 'All' : filters.project,
    environment: ENV_LABEL[filters.environment],
    lastActivity: LAST_ACTIVITY_LABEL[filters.lastActivity],
    groupBy: GROUP_BY_LABEL[filters.groupBy],
    sortBy: SORT_BY_LABEL[filters.sortBy]
  };

  const accent = (id: SubmenuId, isAccent: boolean) => {
    return isAccent ? 'sl-filter-value accent' : 'sl-filter-value';
  };

  return (
    <div className="sl-filter-popup-root" ref={rootRef} style={popupStyle} role="dialog" aria-label="필터 메뉴">
      {/* Main panel — hover 만으로 submenu 가 열린다 (클릭 이벤트는 의도적으로
          연결하지 않음, 사용자 요구). "Clear filters" 만 클릭 동작 유지. */}
      <div className="sl-filter-popup">
        <button
          type="button"
          role="menuitem"
          className={`sl-filter-row ${submenu === 'status' ? 'on' : ''}`}
          onMouseEnter={() => setSubmenu('status')}
        >
          <span>Status</span>
          <span className={accent(null, filters.status !== DEFAULT_FILTERS.status)}>{valueLabel.status}</span>
          <span className="sl-filter-caret">›</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={`sl-filter-row ${submenu === 'project' ? 'on' : ''}`}
          onMouseEnter={() => setSubmenu('project')}
        >
          <span>Project</span>
          <span className={accent(null, filters.project !== 'all')}>{valueLabel.project}</span>
          <span className="sl-filter-caret">›</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={`sl-filter-row ${submenu === 'environment' ? 'on' : ''}`}
          onMouseEnter={() => setSubmenu('environment')}
        >
          <span>Environment</span>
          <span className={accent(null, filters.environment !== 'all')}>{valueLabel.environment}</span>
          <span className="sl-filter-caret">›</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={`sl-filter-row ${submenu === 'lastActivity' ? 'on' : ''}`}
          onMouseEnter={() => setSubmenu('lastActivity')}
        >
          <span>Last activity</span>
          <span className={accent(null, filters.lastActivity !== DEFAULT_FILTERS.lastActivity)}>{valueLabel.lastActivity}</span>
          <span className="sl-filter-caret">›</span>
        </button>
        <div className="sl-filter-sep" />
        <button
          type="button"
          role="menuitem"
          className={`sl-filter-row ${submenu === 'groupBy' ? 'on' : ''}`}
          onMouseEnter={() => setSubmenu('groupBy')}
        >
          <span>Group by</span>
          <span className="sl-filter-value">{valueLabel.groupBy}</span>
          <span className="sl-filter-caret">›</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={`sl-filter-row ${submenu === 'sortBy' ? 'on' : ''}`}
          onMouseEnter={() => setSubmenu('sortBy')}
        >
          <span>Sort by</span>
          <span className="sl-filter-value">{valueLabel.sortBy}</span>
          <span className="sl-filter-caret">›</span>
        </button>
        <div className="sl-filter-sep" />
        <button
          type="button"
          role="menuitem"
          className="sl-filter-row sl-filter-clear"
          onMouseEnter={() => setSubmenu(null)}
          onClick={clearAll}
        >
          <span>Clear filters</span>
        </button>
      </div>
      {submenu && (
        <div className="sl-filter-submenu-wrapper">
          {renderSubmenu()}
        </div>
      )}
    </div>
  );
}
