import type { BgSession } from '@shared/types';
import { formatRelative, shortCwd } from '../lib/format';

interface SessionCardProps {
  session: BgSession;
  selected: boolean;
  onSelect: () => void;
  now: number;
  flash?: boolean;
}

export function SessionCard({ session, selected, onSelect, now, flash }: SessionCardProps) {
  const snippet =
    session.lastAssistantText ||
    session.lastUserText ||
    (session.alive ? '대기 중…' : '세션 종료됨');
  return (
    <div
      className={`session-card ${selected ? 'selected' : ''} ${flash ? 'flash' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span
        className={`pulse ${session.alive ? 'alive' : 'dead'}`}
        title={session.alive ? '실행 중' : '종료'}
      />
      <div className="card-head">
        <span className={`status-tag ${session.status}`}>{statusLabel(session.status)}</span>
        <div className="card-title">{session.name || session.agent || '이름 없음'}</div>
      </div>
      <div className="card-cwd" title={session.cwd}>{shortCwd(session.cwd, 64)}</div>
      <div className={`card-snippet ${snippet ? '' : 'empty'}`}>{snippet}</div>
      <div className="card-foot">
        <span>{formatRelative(session.updatedAt, now)}</span>
        <span className="pid">PID {session.pid}</span>
      </div>
    </div>
  );
}

function statusLabel(status: BgSession['status']): string {
  switch (status) {
    case 'running': return '실행 중';
    case 'idle': return '대기';
    case 'waiting': return '입력 대기';
    case 'finished': return '종료됨';
    case 'crashed': return '오류';
    default: return '알 수 없음';
  }
}
