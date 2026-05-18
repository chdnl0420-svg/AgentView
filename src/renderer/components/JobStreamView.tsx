import { useEffect, useRef, useState } from 'react';
import type { JobInfo } from '@shared/types';
import { formatDuration } from '../lib/format';

interface JobStreamViewProps {
  job: JobInfo;
  now: number;
}

export function JobStreamView({ job, now }: JobStreamViewProps) {
  const [autoscroll, setAutoscroll] = useState(true);
  const streamRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!autoscroll || !streamRef.current) return;
    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [job.output, job.errorOutput, autoscroll]);

  const elapsed = (job.finishedAt ?? now) - job.startedAt;
  const isAlive = job.status === 'running' || job.status === 'starting';

  return (
    <>
      <div className="detail-head">
        <div className="title">
          <h3>{job.name || job.agent || '새 작업'}</h3>
          <div className="meta-row">
            <span>{job.status}</span>
            <span>·</span>
            <span>{formatDuration(elapsed)}</span>
            {job.pid && (<><span>·</span><span>PID {job.pid}</span></>)}
            <span>·</span>
            <span title={job.cwd}>{job.cwd}</span>
            {job.agent && (<><span>·</span><span>@{job.agent}</span></>)}
          </div>
        </div>
        <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          자동 스크롤
        </label>
        {isAlive && (
          <button className="btn sm danger" onClick={() => window.av.jobs.cancel(job.jobId)}>
            ⏹ 중단
          </button>
        )}
      </div>
      <div className="detail-body">
        <div className="bubble" style={{ marginBottom: 12 }}>
          <div className="role-line">요청한 프롬프트</div>
          <div className="content" style={{ whiteSpace: 'pre-wrap' }}>{job.prompt}</div>
        </div>
        <pre className="stream" ref={streamRef}>
          {job.output || (isAlive ? '⏳ 출력 대기 중…' : '(출력 없음)')}
          {job.errorOutput && (
            <>
              {'\n\n--- stderr ---\n'}
              <span className="err">{job.errorOutput}</span>
            </>
          )}
        </pre>
      </div>
    </>
  );
}
