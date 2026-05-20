import type { BgSession } from '@shared/types';
import { formatRelative } from '../lib/format';
import type { ViewMode } from '../lib/viewMode';

interface SessionListProps {
  sessions: BgSession[];
  selectedId: string | null;
  onSelect: (s: BgSession) => void;
  onNewClick: () => void;
  renames: Record<string, string>;
  now: number;
  viewMode: ViewMode;
  onViewModeToggle: () => void;
}

function dotClass(s: BgSession): string {
  if (!s.alive) return s.status === 'completed' ? 'completed' : 'finished';
  return s.status === 'running' ? 'running' : 'waiting';
}

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  onNewClick,
  renames,
  now,
  viewMode,
  onViewModeToggle
}: SessionListProps) {
  return (
    <div className="session-list">
      <div className="session-list-head">
        <button type="button" className="btn primary session-list-new" onClick={onNewClick}>
          ＋ 새 작업
        </button>
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
      </div>
      <div className="session-list-body">
        {sessions.length === 0 && (
          <div className="session-list-empty">세션 없음</div>
        )}
        {sessions.map((s) => {
          const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
          return (
            <button
              key={s.sessionId}
              type="button"
              className={`session-list-item ${s.sessionId === selectedId ? 'selected' : ''}`}
              onClick={() => onSelect(s)}
              title={name}
            >
              <span className={`session-list-dot ${dotClass(s)}`} />
              <span className="session-list-name">{name}</span>
              <span className="session-list-time">{formatRelative(s.updatedAt, now)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
