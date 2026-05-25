import { useMemo } from 'react';
import type { BgSession } from '@shared/types';
import { SessionCard } from './SessionCard';
import { classify, type SessionFilter } from '../lib/sessionFilters';
import type { ViewMode } from '../lib/viewMode';

interface SessionsGridProps {
  sessions: BgSession[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (s: BgSession) => void;
  now: number;
  flashMap: Map<string, number>;
  filter: Set<SessionFilter>;
  onFilterChange: (next: Set<SessionFilter>) => void;
  renames: Record<string, string>;
  deleteMode: boolean;
  selectedForDelete: Set<string>;
  onToggleDelete: (sid: string) => void;
  onToggleDeleteMode: () => void;
  onPerformBulkDelete: () => void;
  viewMode: ViewMode;
  onViewModeToggle: () => void;
}

export function SessionsGrid({
  sessions,
  loading,
  selectedId,
  onSelect,
  now,
  flashMap,
  filter,
  onFilterChange,
  renames,
  deleteMode,
  selectedForDelete,
  onToggleDelete,
  onToggleDeleteMode,
  onPerformBulkDelete,
  viewMode,
  onViewModeToggle
}: SessionsGridProps) {
  const toggle = (key: SessionFilter) => {
    const next = new Set(filter);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onFilterChange(next);
  };

  const counts = useMemo(() => {
    const c: Record<SessionFilter, number> = {
      running: 0,
      waiting: 0,
      completed: 0,
      finished: 0
    };
    for (const s of sessions) c[classify(s)]++;
    return c;
  }, [sessions]);

  const filtered = useMemo(() => {
    if (filter.size === 0) return sessions;
    return sessions.filter((s) => filter.has(classify(s)));
  }, [sessions, filter]);

  const tabs: { key: SessionFilter; label: string }[] = [
    { key: 'running', label: '실행 중' },
    { key: 'waiting', label: '대기' },
    { key: 'completed', label: '완료' },
    { key: 'finished', label: '종료' }
  ];

  return (
    <>
      <div className="section-head">
        <div className="section-head-left" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2>
            백그라운드 에이전트 <span className="count">{filtered.length}개</span>
          </h2>
          <button
            type="button"
            className={`btn sm icon-only ${deleteMode ? 'danger' : 'ghost'}`}
            onClick={onToggleDeleteMode}
            title={deleteMode ? '삭제 모드 종료' : '여러 세션 선택해 일괄 삭제'}
            aria-label={deleteMode ? '삭제 취소' : '삭제 모드'}
          >
            {deleteMode ? '✕' : '🗑'}
          </button>
          {deleteMode && (
            <button
              type="button"
              className="btn sm danger"
              disabled={selectedForDelete.size === 0}
              onClick={onPerformBulkDelete}
              title="선택된 세션을 모두 삭제합니다"
            >
              삭제 완료 ({selectedForDelete.size})
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="view-mode-toggle" title="보기 모드 전환">
            <button
              type="button"
              className={`view-mode-btn ${viewMode === 'cards' ? 'active' : ''}`}
              onClick={() => viewMode !== 'cards' && onViewModeToggle()}
              disabled={viewMode === 'cards'}
              title="카드 모드"
              aria-label="카드 모드"
              aria-pressed={viewMode === 'cards' ? 'true' : 'false'}
            >
              ▣
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === 'single' ? 'active' : ''}`}
              onClick={() => viewMode !== 'single' && onViewModeToggle()}
              disabled={viewMode === 'single'}
              title="단일화면 모드"
              aria-label="단일화면 모드"
              aria-pressed={viewMode === 'single' ? 'true' : 'false'}
            >
              ▤
            </button>
          </div>
          <div className="filters" title="여러 탭을 동시에 선택할 수 있습니다">
            {tabs.map((t) => (
              <button
                key={t.key}
                className={`btn sm ${filter.has(t.key) ? 'primary' : 'ghost'}`}
                onClick={() => toggle(t.key)}
                aria-pressed={filter.has(t.key)}
              >
                {t.label} {counts[t.key]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {loading && <div className="empty-grid">로딩 중…</div>}
      {!loading && filtered.length === 0 && (
        <div className="empty-grid">
          <div className="icon">🌙</div>
          <div>표시할 에이전트가 없습니다.</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            아래 입력창에 작업을 적으면 새 백그라운드 에이전트가 시작됩니다.
          </div>
        </div>
      )}
      <div className="cards">
        {filtered.map((s) => (
          <SessionCard
            key={s.sessionId || s.pid}
            session={s}
            selected={s.sessionId === selectedId}
            onSelect={() => onSelect(s)}
            now={now}
            flash={flashMap.has(s.sessionId)}
            overrideName={renames[s.sessionId] || undefined}
            deleteMode={deleteMode}
            checkedForDelete={selectedForDelete.has(s.sessionId)}
            onToggleDelete={() => onToggleDelete(s.sessionId)}
          />
        ))}
      </div>
    </>
  );
}
