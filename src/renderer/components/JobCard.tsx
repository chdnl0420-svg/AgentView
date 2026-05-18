import type { JobInfo } from '@shared/types';
import { formatDuration, formatRelative, shortCwd } from '../lib/format';

interface JobCardProps {
  job: JobInfo;
  selected: boolean;
  onSelect: () => void;
  now: number;
}

export function JobCard({ job, selected, onSelect, now }: JobCardProps) {
  const isAlive = job.status === 'running' || job.status === 'starting';
  const elapsed = (job.finishedAt ?? now) - job.startedAt;
  const snippet = (job.output || job.errorOutput || job.prompt).slice(-220).trim();
  return (
    <div
      className={`job-card ${selected ? 'selected' : ''}`}
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
      <span className={`pulse ${isAlive ? 'alive' : 'dead'}`} />
      <div className="card-head">
        <span className={`status-tag ${job.status}`}>{statusLabel(job.status)}</span>
        <div className="card-title">{job.name || job.agent || '새 작업'}</div>
      </div>
      <div className="card-cwd" title={job.cwd}>{shortCwd(job.cwd, 64)}</div>
      <div className={`card-snippet ${snippet ? '' : 'empty'}`}>{snippet || '출력 대기 중…'}</div>
      <div className="card-foot">
        <span>{formatRelative(job.startedAt, now)}</span>
        <span className="pid">{formatDuration(elapsed)}</span>
      </div>
    </div>
  );
}

function statusLabel(status: JobInfo['status']): string {
  switch (status) {
    case 'starting': return '시작 중';
    case 'running': return '실행 중';
    case 'completed': return '완료';
    case 'failed': return '실패';
    case 'cancelled': return '취소됨';
    default: return status;
  }
}
