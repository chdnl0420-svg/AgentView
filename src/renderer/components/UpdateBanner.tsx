import { useEffect, useState } from 'react';

interface UpdateState {
  current: string;
  latest: string | null;
  available: boolean;
  releaseUrl?: string;
  notes?: string;
}
type Phase = 'idle' | 'downloading' | 'installing' | 'error';

export function UpdateBanner(): JSX.Element | null {
  const [info, setInfo] = useState<UpdateState | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const r = await window.av.updater.check();
        if (!cancelled) setInfo(r);
      } catch { /* swallow */ }
    };
    run();
    const t = window.setInterval(run, 60 * 60 * 1000);
    const off = window.av.updater.onProgress((pct) => setProgress(pct));
    return () => { cancelled = true; window.clearInterval(t); off(); };
  }, []);

  if (!info?.available) return null;

  const startUpdate = async () => {
    setPhase('downloading');
    setErr(null);
    const r = await window.av.updater.download();
    if (!r.ok) {
      setPhase('error');
      setErr(r.reason || '알 수 없는 오류');
      return;
    }
    setPhase('installing');
  };

  return (
    <>
      <div className="update-banner" role="status" aria-live="polite">
        <span className="update-icon">⬆</span>
        <span className="update-text">
          새 버전 <strong>v{info.latest}</strong> 가 있습니다 (현재 v{info.current})
        </span>
        <button
          type="button"
          className="btn primary sm"
          onClick={() => setConfirmOpen(true)}
          disabled={phase !== 'idle'}
        >업데이트</button>
        {info.releaseUrl && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => window.av.updater.openReleasePage()}
          >릴리즈 노트</button>
        )}
      </div>

      {confirmOpen && (
        <div className="update-modal-backdrop" onClick={() => phase === 'idle' && setConfirmOpen(false)}>
          <div className="update-modal" onClick={(e) => e.stopPropagation()}>
            <h3>업데이트 설치</h3>
            <p>
              v{info.latest} 설치 파일을 다운로드한 후 <strong>AgentView 가 자동으로 종료되고
              설치 프로그램이 실행</strong>됩니다. 설치 완료 후 새 버전이 자동으로 다시 열립니다.
            </p>
            <ul className="update-modal-list">
              <li>다운로드 중 앱을 계속 사용해도 됩니다.</li>
              <li>설치 시작 시 현재 창이 잠시 닫혔다 새로 열립니다.</li>
              <li>백그라운드 에이전트는 영향 받지 않습니다 (daemon 별도 프로세스).</li>
            </ul>
            {phase === 'downloading' && (
              <div className="update-progress-row">
                <div className="update-progress">
                  <div className="update-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <span className="update-progress-pct">{progress}%</span>
              </div>
            )}
            {phase === 'installing' && (
              <div className="update-installing">
                ⏳ 설치 프로그램 실행 중 — 잠시 후 앱이 종료됩니다…
              </div>
            )}
            {phase === 'error' && (
              <div className="update-error">⚠ 다운로드 실패: {err}</div>
            )}
            <div className="update-modal-actions">
              {phase === 'idle' && (
                <>
                  <button className="btn ghost" onClick={() => setConfirmOpen(false)}>나중에</button>
                  <button className="btn primary" onClick={startUpdate}>지금 설치</button>
                </>
              )}
              {phase === 'error' && (
                <>
                  <button className="btn ghost" onClick={() => { setPhase('idle'); setConfirmOpen(false); }}>닫기</button>
                  <button className="btn primary" onClick={startUpdate}>다시 시도</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
