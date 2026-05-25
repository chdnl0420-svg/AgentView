import type { BgSession } from '@shared/types';
import { formatRelative } from '../lib/format';

interface SessionListProps {
  sessions: BgSession[];
  selectedId: string | null;
  onSelect: (s: BgSession) => void;
  onNewClick: () => void;
  renames: Record<string, string>;
  now: number;
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
  now
}: SessionListProps) {
  return (
    <div className="session-list">
      <div className="session-list-head">
        <button type="button" className="btn primary session-list-new" onClick={onNewClick}>
          ＋ 새 작업
        </button>
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
