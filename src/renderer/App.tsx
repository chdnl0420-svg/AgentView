import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentInfo,
  BgSession,
  JobEvent,
  JobInfo,
  ScanSessionsResult
} from '@shared/types';
import { SessionCard } from './components/SessionCard';
import { JobCard } from './components/JobCard';
import { ConversationView } from './components/ConversationView';
import { JobStreamView } from './components/JobStreamView';
import { InputBar } from './components/InputBar';

type Tab = 'sessions' | 'jobs';
type SelectionKind = 'session' | 'job' | null;

interface Selection {
  kind: SelectionKind;
  id: string | null;
}

const DEFAULT_CWD = 'D:\\Project\\VisualAgents';
const FLASH_MS = 900;

export default function App() {
  const [tab, setTab] = useState<Tab>('sessions');
  const [scan, setScan] = useState<ScanSessionsResult | null>(null);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: null, id: null });
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<Map<string, number>>(() => new Map());
  const reloadTimer = useRef<number | null>(null);

  const reloadSessions = useCallback(async () => {
    const result = await window.av.sessions.list();
    setScan(result);
    setLoadingSessions(false);
  }, []);

  const reloadJobs = useCallback(async () => {
    const list = await window.av.jobs.list();
    setJobs(list);
  }, []);

  const reloadAgents = useCallback(async () => {
    const list = await window.av.agents.list();
    setAgents(list);
  }, []);

  useEffect(() => {
    reloadSessions();
    reloadJobs();
    reloadAgents();
  }, [reloadSessions, reloadJobs, reloadAgents]);

  // periodic clock for relative time
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // sessions watcher (file-level updates)
  useEffect(() => {
    const offChanged = window.av.sessions.onChanged(() => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(reloadSessions, 200);
    });
    const offUpdated = window.av.sessions.onSessionUpdated((s: BgSession) => {
      setScan((prev) => {
        if (!prev) return prev;
        const idx = prev.sessions.findIndex((x) => x.sessionId === s.sessionId);
        let nextList: BgSession[];
        if (idx === -1) {
          nextList = [s, ...prev.sessions];
        } else {
          nextList = prev.sessions.slice();
          nextList[idx] = s;
        }
        nextList.sort((a, b) => {
          if (a.alive !== b.alive) return a.alive ? -1 : 1;
          return b.updatedAt - a.updatedAt;
        });
        return { ...prev, sessions: nextList };
      });
      // flash the card briefly
      setFlash((prev) => {
        const next = new Map(prev);
        next.set(s.sessionId, Date.now());
        return next;
      });
    });
    return () => {
      offChanged();
      offUpdated();
    };
  }, [reloadSessions]);

  // sweep stale flash markers
  useEffect(() => {
    if (flash.size === 0) return;
    const id = window.setTimeout(() => {
      const cutoff = Date.now() - FLASH_MS;
      setFlash((prev) => {
        const next = new Map<string, number>();
        for (const [k, v] of prev) if (v > cutoff) next.set(k, v);
        return next.size === prev.size ? prev : next;
      });
    }, FLASH_MS);
    return () => window.clearTimeout(id);
  }, [flash]);

  // job stream
  useEffect(() => {
    const offEvt = window.av.jobs.onEvent((e: JobEvent) => {
      setJobs((prev) =>
        prev.map((j) => {
          if (j.jobId !== e.jobId) return j;
          if (e.type === 'stdout') return { ...j, output: appendClipped(j.output, e.data ?? '') };
          if (e.type === 'stderr')
            return { ...j, errorOutput: appendClipped(j.errorOutput, e.data ?? '') };
          return j;
        })
      );
    });
    const offUpd = window.av.jobs.onUpdated((j: JobInfo) => {
      setJobs((prev) => {
        const exists = prev.some((x) => x.jobId === j.jobId);
        if (exists) return prev.map((x) => (x.jobId === j.jobId ? mergeJob(x, j) : x));
        return [j, ...prev];
      });
    });
    return () => {
      offEvt();
      offUpd();
    };
  }, []);

  const sessionsList = scan?.sessions ?? [];
  const activeCount = sessionsList.filter(
    (s) => s.alive && s.status !== 'finished' && s.status !== 'crashed'
  ).length;
  const jobsAliveCount = jobs.filter((j) => j.status === 'running' || j.status === 'starting').length;

  const selectedSession = useMemo(() => {
    if (selection.kind !== 'session' || !selection.id) return null;
    return sessionsList.find((s) => s.sessionId === selection.id) ?? null;
  }, [sessionsList, selection]);

  const selectedJob = useMemo(() => {
    if (selection.kind !== 'job' || !selection.id) return null;
    return jobs.find((j) => j.jobId === selection.id) ?? null;
  }, [jobs, selection]);

  const onJobStarted = useCallback((jobId: string) => {
    setTab('jobs');
    setSelection({ kind: 'job', id: jobId });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">A</div>
          <span>AgentView</span>
          <span className="sub">· claude agents 데스크톱 매니저</span>
        </div>
        <nav className="tabs" role="tablist">
          <button
            role="tab"
            className={tab === 'sessions' ? 'active' : ''}
            onClick={() => setTab('sessions')}
          >
            🟢 Background Sessions ({activeCount}/{sessionsList.length})
          </button>
          <button
            role="tab"
            className={tab === 'jobs' ? 'active' : ''}
            onClick={() => setTab('jobs')}
          >
            ⚡ My Jobs ({jobsAliveCount}/{jobs.length})
          </button>
        </nav>
        <span className="spacer" />
        <span className="live-pill" title="CLI 변경사항이 자동으로 반영됩니다">
          <span className="dot" />
          LIVE
        </span>
        <button
          className="btn sm ghost"
          onClick={() => {
            reloadSessions();
            reloadJobs();
            reloadAgents();
          }}
          title="새로고침 (Ctrl+R)"
        >
          ↻ 새로고침
        </button>
      </header>

      <div className={`dashboard ${selection.kind ? 'split' : ''}`}>
        <div className="grid-wrap">
          {tab === 'sessions' ? (
            <SessionsGrid
              sessions={sessionsList}
              loading={loadingSessions}
              selectedId={selection.kind === 'session' ? selection.id : null}
              onSelect={(s) => setSelection({ kind: 'session', id: s.sessionId })}
              now={now}
              flashMap={flash}
            />
          ) : (
            <JobsGrid
              jobs={jobs}
              selectedId={selection.kind === 'job' ? selection.id : null}
              onSelect={(j) => setSelection({ kind: 'job', id: j.jobId })}
              now={now}
            />
          )}
        </div>

        {selection.kind && (
          <aside className="detail-pane">
            {selectedSession ? (
              <ConversationView session={selectedSession} />
            ) : selectedJob ? (
              <JobStreamView job={selectedJob} now={now} />
            ) : (
              <div className="empty-detail">
                <div className="icon">🗂</div>
                <div>선택한 항목을 찾을 수 없습니다.</div>
                <button
                  className="btn sm"
                  style={{ marginTop: 12 }}
                  onClick={() => setSelection({ kind: null, id: null })}
                >
                  닫기
                </button>
              </div>
            )}
          </aside>
        )}

        <InputBar agents={agents} defaultCwd={DEFAULT_CWD} onStarted={onJobStarted} />
      </div>
    </div>
  );
}

type SessionFilter = 'all' | 'running' | 'waiting' | 'finished';

function classify(s: BgSession): Exclude<SessionFilter, 'all'> {
  if (!s.alive || s.status === 'finished' || s.status === 'crashed') return 'finished';
  if (s.status === 'running') return 'running';
  return 'waiting';
}

function SessionsGrid({
  sessions,
  loading,
  selectedId,
  onSelect,
  now,
  flashMap
}: {
  sessions: BgSession[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (s: BgSession) => void;
  now: number;
  flashMap: Map<string, number>;
}) {
  const [filter, setFilter] = useState<SessionFilter>('all');

  const counts = useMemo(() => {
    const c = { all: sessions.length, running: 0, waiting: 0, finished: 0 };
    for (const s of sessions) c[classify(s)]++;
    return c;
  }, [sessions]);

  const filtered = useMemo(() => {
    if (filter === 'all') return sessions;
    return sessions.filter((s) => classify(s) === filter);
  }, [sessions, filter]);

  return (
    <>
      <div className="section-head">
        <h2>
          백그라운드 세션 <span className="count">{filtered.length}개</span>
        </h2>
        <div className="filters">
          <button
            className={`btn sm ${filter === 'all' ? 'primary' : 'ghost'}`}
            onClick={() => setFilter('all')}
          >전체 {counts.all}</button>
          <button
            className={`btn sm ${filter === 'running' ? 'primary' : 'ghost'}`}
            onClick={() => setFilter('running')}
          >실행 중 {counts.running}</button>
          <button
            className={`btn sm ${filter === 'waiting' ? 'primary' : 'ghost'}`}
            onClick={() => setFilter('waiting')}
          >대기 {counts.waiting}</button>
          <button
            className={`btn sm ${filter === 'finished' ? 'primary' : 'ghost'}`}
            onClick={() => setFilter('finished')}
          >종료 {counts.finished}</button>
        </div>
      </div>
      {loading && <div className="empty-grid">로딩 중…</div>}
      {!loading && filtered.length === 0 && (
        <div className="empty-grid">
          <div className="icon">🌙</div>
          <div>아직 백그라운드 세션이 없습니다.</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            아래 입력창에서 작업을 보내거나 터미널에서 <code>claude</code> 로 새 세션을 시작하세요.
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
          />
        ))}
      </div>
    </>
  );
}

function JobsGrid({
  jobs,
  selectedId,
  onSelect,
  now
}: {
  jobs: JobInfo[];
  selectedId: string | null;
  onSelect: (j: JobInfo) => void;
  now: number;
}) {
  return (
    <>
      <div className="section-head">
        <h2>
          내가 시작한 작업 <span className="count">{jobs.length}개</span>
        </h2>
      </div>
      {jobs.length === 0 ? (
        <div className="empty-grid">
          <div className="icon">✨</div>
          <div>아직 시작한 작업이 없습니다.</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>
            아래 입력창에 프롬프트를 입력하고 Ctrl+Enter 를 누르세요.
          </div>
        </div>
      ) : (
        <div className="cards">
          {jobs.map((j) => (
            <JobCard
              key={j.jobId}
              job={j}
              selected={j.jobId === selectedId}
              onSelect={() => onSelect(j)}
              now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}

const MAX_OUTPUT_CHARS_CLIENT = 256 * 1024;
function appendClipped(prev: string, chunk: string): string {
  const next = prev + chunk;
  if (next.length <= MAX_OUTPUT_CHARS_CLIENT) return next;
  return next.slice(next.length - MAX_OUTPUT_CHARS_CLIENT);
}

function mergeJob(prev: JobInfo, next: JobInfo): JobInfo {
  return {
    ...next,
    output: next.output || prev.output,
    errorOutput: next.errorOutput || prev.errorOutput
  };
}
