import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentInfo,
  BgSession,
  ClaudeRunEvent,
  NewSessionInput,
  RunningSessionInfo,
  ScanSessionsResult,
  SessionBackend
} from '@shared/types';
import { SessionCard } from './components/SessionCard';
import { SessionList } from './components/SessionList';
import { SessionDetail, type QueuedPrompt } from './components/SessionDetail';
import { InputBar, type InputDraft } from './components/InputBar';
import { UpdateBanner } from './components/UpdateBanner';
import { SpotlightTour } from './components/SpotlightTour';
import { WindowChrome } from './components/WindowChrome';
import { loadJSON, saveJSON } from './lib/persistence';
import { getViewMode, setViewMode, type ViewMode } from './lib/viewMode';

const NEW_DRAFT_KEY = 'draft.new';
const RESUME_DRAFTS_KEY = 'draft.resume';
const RENAMES_KEY = 'sessionRenames';
const LAST_BACKEND_KEY = 'lastBackend';

const DEFAULT_CWD = 'D:\\Project\\VisualAgents';
const FLASH_MS = 900;

// Re-read the user's saved rename map on each render of the dashboard. It's
// authored from SessionDetail (where the user typed it) and read here so the
// card grid + browser tab labels show the same custom name.
function loadRenames(): Record<string, string> {
  return loadJSON<Record<string, string>>(RENAMES_KEY, {});
}

type SessionFilter = 'running' | 'waiting' | 'completed' | 'finished';

// Split alive sessions into two tabs: "실행 중" (agent currently working) and
// "대기" (agent idle, waiting for next prompt). Without the 대기 tab, sessions
// that go idle would silently disappear from the default view.
function classify(s: BgSession): SessionFilter {
  if (s.alive) {
    return s.status === 'running' ? 'running' : 'waiting';
  }
  if (s.status === 'completed') return 'completed';
  return 'finished';
}

function isEmptyDeadSession(s: BgSession): boolean {
  if (s.alive) return false;
  // Claude job entries (kind:"bg") are always real — they came from
  // ~/.claude/jobs/<short>/state.json which is the same source `claude agents`
  // uses. Keep them regardless of pid/name so the AgentView grid mirrors
  // the CLI exactly.
  if ((s.kind || '').toLowerCase() === 'bg') return false;
  // Anonymous kind:"app" jsonl-only orphans with no meaningful title.
  const shortId = s.sessionId.slice(0, 8).toLowerCase();
  const title = (s.name || s.agent || '').trim().toLowerCase();
  if (!title || title === shortId || /^이름\s*없음$/.test(title)) return true;
  return false;
}

// Local placeholder for a brand-new agent we just dispatched. The daemon takes
// 2-5 s to write ~/.claude/jobs/<short>/state.json (the only source the
// sessions scanner reads), so without this the user clicks "▶ 새 작업 시작"
// and stares at an unchanged grid until the worker lands.
interface PendingSession {
  tempId: string;
  realSessionId: string | null;
  // Timestamp the real session first appeared in the disk scan. Used to delay
  // dropping the placeholder until the daemon-registered card has been visible
  // for a brief cooldown — without this, a single flaky scan tick (daemon
  // mid-write of state.json) silently unmounts the freshly-spawned agent card.
  realSeenAt: number | null;
  startedAt: number;
  prompt: string;
  cwd: string;
  agent: string;
  backend?: BgSession['backend'];
  name: string;
}

const PENDING_PREFIX = 'pending-';
const PENDING_MAX_LIFETIME_MS = 45_000;
// Keep the placeholder around for this long after the real session first
// appears in scan, so a transient miss on the next reload (the daemon writes
// jobs/<short>/state.json incrementally) doesn't cause the card to vanish.
const PENDING_HANDOFF_COOLDOWN_MS = 4_000;

function makeTempId(): string {
  const rnd =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${PENDING_PREFIX}${rnd}`;
}

function pendingToBgSession(p: PendingSession): BgSession {
  return {
    pid: 0,
    sessionId: p.realSessionId || p.tempId,
    cwd: p.cwd,
    startedAt: p.startedAt,
    updatedAt: p.startedAt,
    kind: 'bg',
    entrypoint: 'pending',
    name: p.name,
    agent: p.agent,
    backend: p.backend,
    jobId: (p.realSessionId || p.tempId).slice(0, 8),
    status: 'running',
    alive: true,
    metaPath: '',
    conversationPath: null,
    conversationSize: 0,
    lastUserText: p.prompt
  };
}

interface ClaudeStatus {
  cliPath: string | null;
  cliVersion: string | null;
  daemonAlive: boolean;
  supervisorPid: number | null;
  checkedAt: number;
}

export default function App() {
  const [scan, setScan] = useState<ScanSessionsResult | null>(null);
  const [pending, setPending] = useState<PendingSession[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [running, setRunning] = useState<RunningSessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<ViewMode>(() => getViewMode());
  const viewModeRef = useRef<ViewMode>(viewMode);
  const [loading, setLoading] = useState(true);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [activeBackend, setActiveBackend] = useState<SessionBackend>(() => {
    const saved = loadJSON<string>(LAST_BACKEND_KEY, 'avd');
    return saved === 'claude' || saved === 'codex' || saved === 'avd' ? saved : 'avd';
  });
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<Map<string, number>>(() => new Map());
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [filter, setFilter] = useState<Set<SessionFilter>>(
    () => new Set(['running', 'waiting', 'completed'])
  );
  const [renames, setRenames] = useState<Record<string, string>>(() => loadRenames());
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(() => new Set());
  const toggleViewMode = useCallback(() => {
    setViewModeState((prev) => {
      const next: ViewMode = prev === 'cards' ? 'single' : 'cards';
      viewModeRef.current = next;
      setViewMode(next);
      return next;
    });
  }, []);
  const toggleDeleteMode = useCallback(() => {
    setDeleteMode((v) => {
      if (v) setSelectedForDelete(new Set());
      return !v;
    });
  }, []);
  const toggleDeleteSelection = useCallback((sid: string) => {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid); else next.add(sid);
      return next;
    });
  }, []);
  const performBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedForDelete);
    if (ids.length === 0) return;
    const confirmMsg = `${ids.length}개 세션을 삭제합니다. claude agents 에서도 함께 제거됩니다. 계속할까요?`;
    if (!window.confirm(confirmMsg)) return;
    const result = await window.av.sessions.deleteMany(ids);
    if (result.failed.length > 0) {
      setToast({ kind: 'error', text: `일부 삭제 실패 (${result.failed.length}건): ${result.failed[0].reason}` });
    } else {
      setToast({ kind: 'info', text: `${result.deleted.length}개 세션을 삭제했습니다.` });
    }
    setSelectedForDelete(new Set());
    setDeleteMode(false);
    reloadSessions();
  }, [selectedForDelete]);
  // SessionDetail writes to localStorage directly; refresh ours whenever the
  // selection or window focus changes so the new name lands on the cards.
  useEffect(() => {
    const onFocus = () => setRenames(loadRenames());
    const onBackendChanged = (e: Event) => {
      const next = (e as CustomEvent<SessionBackend>).detail;
      if (next === 'claude' || next === 'codex' || next === 'avd') setActiveBackend(next);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onFocus);
    window.addEventListener('agentview:renames-changed', onFocus as EventListener);
    window.addEventListener('agentview:backend-changed', onBackendChanged as EventListener);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onFocus);
      window.removeEventListener('agentview:renames-changed', onFocus as EventListener);
      window.removeEventListener('agentview:backend-changed', onBackendChanged as EventListener);
    };
  }, []);
  const reloadTimer = useRef<number | null>(null);
  const gridScrollRef = useRef<number>(0);
  // Drafts keyed by sessionId so the user's in-progress prompt + attachments
  // survive going back to the grid AND surviving an app restart (we mirror
  // them into localStorage on every change).
  const draftsRef = useRef<Map<string, InputDraft>>(
    new Map(
      Object.entries(loadJSON<Record<string, InputDraft>>(RESUME_DRAFTS_KEY, {}))
    )
  );
  const [, setDraftBump] = useState(0); // force re-render after draft change
  const persistResumeDrafts = useCallback(() => {
    const out: Record<string, InputDraft> = {};
    for (const [sid, d] of draftsRef.current.entries()) out[sid] = d;
    saveJSON(RESUME_DRAFTS_KEY, out);
  }, []);
  const setDraft = useCallback(
    (sessionId: string, draft: InputDraft) => {
      if (!draft.prompt && draft.attachments.length === 0) {
        draftsRef.current.delete(sessionId);
      } else {
        draftsRef.current.set(sessionId, draft);
      }
      persistResumeDrafts();
      setDraftBump((v) => v + 1);
    },
    [persistResumeDrafts]
  );
  const [newDraft, setNewDraftState] = useState<InputDraft>(() =>
    loadJSON<InputDraft>(NEW_DRAFT_KEY, { prompt: '', attachments: [] })
  );
  const setNewDraft = useCallback((d: InputDraft) => {
    setNewDraftState(d);
    if (!d.prompt && d.attachments.length === 0) {
      saveJSON(NEW_DRAFT_KEY, { prompt: '', attachments: [] });
    } else {
      saveJSON(NEW_DRAFT_KEY, d);
    }
  }, []);

  // Queued messages while an agent is busy. The first item is sent
  // automatically once the agent flips back to idle; the user can remove an
  // item with × and the prompt jumps back into the composer.
  const [queues, setQueues] = useState<Record<string, QueuedPrompt[]>>({});
  const setQueue = useCallback(
    (sessionId: string, updater: (prev: QueuedPrompt[]) => QueuedPrompt[]) => {
      setQueues((prev) => {
        const cur = prev[sessionId] ?? [];
        const next = updater(cur);
        if (next.length === 0) {
          if (!(sessionId in prev)) return prev;
          const { [sessionId]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [sessionId]: next };
      });
    },
    []
  );

  const reloadSessions = useCallback(async () => {
    const result = await window.av.sessions.list();
    setScan(result);
    setLoading(false);
  }, []);

  const reloadAgents = useCallback(async () => {
    const list = await window.av.agents.list();
    setAgents(list);
  }, []);

  const reloadRunning = useCallback(async () => {
    const list = await window.av.sessions.runningList();
    setRunning(list);
  }, []);

  useEffect(() => {
    reloadSessions();
    reloadAgents();
    reloadRunning();
  }, [reloadSessions, reloadAgents, reloadRunning]);

  // Poll Claude CLI / daemon status so the user can see when the runtime
  // is missing or in the middle of being woken up, instead of staring at
  // an unresponsive composer. Cheap call (~ms) on first launch + every 30s.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await window.av.claude.status(false);
        if (!cancelled) setClaudeStatus(s);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // periodic clock
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Browser-style back/forward navigation between dashboard <-> detail view.
  // - Back (Esc / Mouse XButton1 / button=3) leaves the detail and remembers
  //   the sid in lastSelectedIdRef so the next forward press can restore it.
  // - Forward (Mouse XButton2 / button=4) re-enters the most-recent detail.
  // The listener stays attached in both modes because the forward press
  // must work when selectedId is null.
  const lastSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId) lastSelectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    const isTextTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true;
      return t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId && !isTextTarget(e.target)) {
        e.preventDefault();
        setSelectedId(null);
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      // Windows physical mouse: XButton1 (back) -> button=3, XButton2 (forward) -> button=4.
      if (e.button === 3 && selectedId) {
        e.preventDefault();
        setSelectedId(null);
        return;
      }
      if (e.button === 4 && !selectedId && lastSelectedIdRef.current) {
        e.preventDefault();
        setSelectedId(lastSelectedIdRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [selectedId]);

  // sessions watcher
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
        if (idx === -1) nextList = [s, ...prev.sessions];
        else {
          nextList = prev.sessions.slice();
          nextList[idx] = s;
        }
        nextList.sort((a, b) => {
          if (a.alive !== b.alive) return a.alive ? -1 : 1;
          return b.updatedAt - a.updatedAt;
        });
        return { ...prev, sessions: nextList };
      });
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

  // running list updates
  useEffect(() => {
    const off = window.av.sessions.onRunningChanged((list) => setRunning(list));
    return off;
  }, []);

  // run events (toast on errors / busy)
  useEffect(() => {
    const off = window.av.sessions.onRunEvent((evt: ClaudeRunEvent) => {
      if (evt.type === 'error') {
        setToast({ kind: 'error', text: `claude 실행 실패: ${evt.message}` });
      } else if (evt.type === 'busy') {
        setToast({ kind: 'info', text: '이 에이전트는 이미 작업 중입니다. 끝난 뒤 다시 보내주세요.' });
      } else if (evt.type === 'exit' && evt.exitCode !== 0 && evt.exitCode !== null) {
        const detail = evt.stderr ? ` (${evt.stderr.split('\n')[0].slice(0, 120)})` : '';
        setToast({ kind: 'error', text: `claude 종료 코드 ${evt.exitCode}${detail}` });
      } else if (evt.type === 'spawn') {
        setToast(null);
      }
      // Sessions disk-state will update via the live watcher (sessions/jsonl files).
      reloadSessions();
    });
    return off;
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

  // auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const sessionsList = useMemo(() => {
    const real = (scan?.sessions ?? []).filter((s) => !isEmptyDeadSession(s));
    if (pending.length === 0) return real;
    const realIds = new Set(real.map((s) => s.sessionId));
    // Hide a placeholder once the daemon-registered card with the same
    // sessionId has actually landed in the scan — that's the seamless handoff.
    const placeholders = pending
      .filter((p) => !(p.realSessionId && realIds.has(p.realSessionId)))
      .map(pendingToBgSession);
    return [...placeholders, ...real];
  }, [scan, pending]);

  // Two-stage placeholder cleanup:
  //  1. As soon as the real session first appears in scan, stamp realSeenAt.
  //  2. Only drop the placeholder after PENDING_HANDOFF_COOLDOWN_MS has
  //     elapsed since that first sighting — gives the daemon time to finish
  //     writing state.json so a flaky reload tick doesn't unmount the card.
  // PENDING_MAX_LIFETIME_MS remains the absolute safety net for a failed
  // dispatch that never lands a real session.
  useEffect(() => {
    if (pending.length === 0) return;
    const scannedIds = new Set((scan?.sessions ?? []).map((s) => s.sessionId));
    const now = Date.now();
    setPending((prev) => {
      let changed = false;
      const next: PendingSession[] = [];
      for (const p of prev) {
        if (now - p.startedAt > PENDING_MAX_LIFETIME_MS) {
          changed = true;
          continue;
        }
        const inScan = p.realSessionId !== null && scannedIds.has(p.realSessionId);
        if (inScan && p.realSeenAt === null) {
          changed = true;
          next.push({ ...p, realSeenAt: now });
          continue;
        }
        if (p.realSeenAt !== null && now - p.realSeenAt >= PENDING_HANDOFF_COOLDOWN_MS) {
          changed = true;
          continue;
        }
        next.push(p);
      }
      return changed ? next : prev;
    });
  }, [scan, pending]);

  // Re-trigger the cleanup after the handoff cooldown so the placeholder is
  // dropped even if no new scan arrives in that window. Without this, a quiet
  // daemon (worker started, no further updates) leaves the placeholder around
  // until the next user interaction or PENDING_MAX_LIFETIME_MS.
  useEffect(() => {
    const pendingHandoff = pending.find((p) => p.realSeenAt !== null);
    if (!pendingHandoff) return;
    const fireAt = pendingHandoff.realSeenAt! + PENDING_HANDOFF_COOLDOWN_MS;
    const delay = Math.max(0, fireAt - Date.now());
    const id = window.setTimeout(() => {
      setPending((prev) => {
        const now = Date.now();
        let changed = false;
        const next = prev.filter((p) => {
          if (p.realSeenAt !== null && now - p.realSeenAt >= PENDING_HANDOFF_COOLDOWN_MS) {
            changed = true;
            return false;
          }
          return true;
        });
        return changed ? next : prev;
      });
    }, delay + 16);
    return () => window.clearTimeout(id);
  }, [pending]);
  // Look up the selected session in the raw scan (not the filtered grid)
  // so that brand-new sessions can show up in the detail view even before
  // the next sessions watcher tick pulls them into the visible filter.
  const selected = useMemo<BgSession | null>(() => {
    if (!selectedId) return null;
    const hit = (scan?.sessions ?? []).find((s) => s.sessionId === selectedId);
    if (hit) return hit;
    // Placeholder while the sessions watcher catches up with a freshly
    // spawned agent. Lets SessionDetail mount immediately instead of
    // bouncing back to the grid for the first second after "새 작업 시작".
    return {
      sessionId: selectedId,
      pid: 0,
      cwd: DEFAULT_CWD,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      name: '시작 중…',
      agent: 'claude',
      status: 'idle',
      alive: true,
      metaPath: '',
      conversationPath: null,
      conversationSize: 0
    };
  }, [scan, selectedId]);

  const onStartNewSession = useCallback(
    async (input: NewSessionInput) => {
      // Drop an optimistic placeholder card on the grid the moment the user
      // clicks "▶ 새 작업 시작". Without this they sit in front of an
      // unchanged grid for 2-5 s while the daemon-spawned worker writes
      // ~/.claude/jobs/<short>/state.json — the only thing the scanner reads.
      const tempId = makeTempId();
      const displayName = (input.name?.trim() || input.prompt.trim().split(/\r?\n/)[0] || '새 작업').slice(0, 60);
      setPending((prev) => [
        {
          tempId,
          realSessionId: null,
          realSeenAt: null,
          startedAt: Date.now(),
          prompt: input.prompt,
          cwd: input.cwd,
          agent: input.agent || 'claude',
          backend: input.backend || 'claude',
          name: displayName
        },
        ...prev
      ]);
      let res: { sessionId: string | null } | null = null;
      try {
        res = await window.av.sessions.newSession({
          prompt: input.prompt,
          cwd: input.cwd,
          agent: input.agent ?? null,
          backend: input.backend ?? null,
          model: input.model ?? null,
          name: input.name ?? null,
          permissionMode: input.permissionMode ?? null,
          worktreePath: input.worktreePath ?? null,
          baseBranch: input.baseBranch ?? null,
          newBranch: input.newBranch ?? null
        });
      } catch (err) {
        setPending((prev) => prev.filter((p) => p.tempId !== tempId));
        throw err;
      }
      // Stay on the dashboard so the user can keep dispatching new work
      // without bouncing into the detail view. Poll a few times so the
      // freshly-spawned card appears in the grid as soon as the daemon
      // registers the worker (~3-5s) and the jsonl starts being written.
      if (res && res.sessionId) {
        const realSessionId = res.sessionId;
        setPending((prev) =>
          prev.map((p) => (p.tempId === tempId ? { ...p, realSessionId } : p))
        );
        // In single mode, auto-select the newly started session
        if (viewModeRef.current === 'single') {
          setSelectedId(realSessionId);
        }
        for (const delay of [400, 900, 2000, 4000, 6500]) {
          window.setTimeout(() => reloadSessions(), delay);
        }
      } else {
        setPending((prev) => prev.filter((p) => p.tempId !== tempId));
      }
    },
    [reloadSessions]
  );

  const toastNode = toast ? (
    <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
      {toast.text}
    </div>
  ) : null;

  const claudeStatusBanner = activeBackend === 'claude' && claudeStatus && !claudeStatus.cliPath ? (
    <div className="claude-status-banner error" role="status">
      <span>⚠</span>
      <span>Claude Code CLI 가 설치돼있지 않습니다.</span>
      <button
        type="button"
        className="btn sm primary"
        onClick={() => window.av.shell.openPath('https://github.com/anthropics/claude-code')}
      >설치 안내</button>
    </div>
  ) : activeBackend === 'claude' && claudeStatus && claudeStatus.cliPath && !claudeStatus.daemonAlive ? (
    <div className="claude-status-banner warn" role="status">
      <span>◐</span>
      <span>Claude Code 백그라운드 데몬이 꺼져있습니다 — 새 작업 시작 시 자동으로 깨웁니다.</span>
    </div>
  ) : null;
  // Card mode: open session → fullscreen detail
  if (selected && viewMode === 'cards') {
    return (
      <>
        <WindowChrome />
        <UpdateBanner />
        {claudeStatusBanner}
        <SpotlightTour />
        <SessionDetail
          session={selected}
          agents={agents}
          running={running}
          onBack={() => {
            setRenames(loadRenames());
            setSelectedId(null);
          }}
          draft={draftsRef.current.get(selected.sessionId)}
          onDraftChange={(d) => setDraft(selected.sessionId, d)}
          queue={queues[selected.sessionId] ?? []}
          onQueueChange={(updater) => setQueue(selected.sessionId, updater)}
          onForked={(_old, next) => {
            setSelectedId(next);
            setToast({
              kind: 'info',
              text:
                '이 에이전트가 CLI에서 이미 실행 중이라 새 분기 세션으로 이어갑니다. 원본은 그대로 두고 새 sid로 진행됩니다.'
            });
            window.setTimeout(reloadSessions, 600);
          }}
        />
        {toastNode}
      </>
    );
  }

  // Single mode: SessionList (left) + work area (right)
  if (viewMode === 'single') {
    return (
      <div className="app no-chrome">
        <WindowChrome />
        <UpdateBanner />
        {claudeStatusBanner}
        <SpotlightTour />
        <div className="dashboard single">
          <SessionList
            sessions={sessionsList}
            selectedId={selectedId}
            onSelect={(s) => {
              if (s.sessionId.startsWith(PENDING_PREFIX)) {
                setToast({ kind: 'info', text: '에이전트가 시작 중입니다. 잠시만 기다려주세요.' });
                return;
              }
              setSelectedId(s.sessionId);
            }}
            onNewClick={() => setSelectedId(null)}
            renames={renames}
            now={now}
            viewMode={viewMode}
            onViewModeToggle={toggleViewMode}
          />
          <div className="single-workspace">
            {selected ? (
              <SessionDetail
                session={selected}
                agents={agents}
                running={running}
                onBack={() => {
                  setRenames(loadRenames());
                  setSelectedId(null);
                }}
                draft={draftsRef.current.get(selected.sessionId)}
                onDraftChange={(d) => setDraft(selected.sessionId, d)}
                queue={queues[selected.sessionId] ?? []}
                onQueueChange={(updater) => setQueue(selected.sessionId, updater)}
                onForked={(_old, next) => {
                  setSelectedId(next);
                  setToast({
                    kind: 'info',
                    text:
                      '이 에이전트가 CLI에서 이미 실행 중이라 새 분기 세션으로 이어갑니다. 원본은 그대로 두고 새 sid로 진행됩니다.'
                  });
                  window.setTimeout(reloadSessions, 600);
                }}
              />
            ) : (
              <div className="single-new-task">
                <InputBar
                  mode="new"
                  agents={agents}
                  defaultCwd={DEFAULT_CWD}
                  draft={newDraft}
                  onDraftChange={setNewDraft}
                  onSend={onStartNewSession}
                />
              </div>
            )}
          </div>
        </div>
        {toast && (
          <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
            {toast.text}
          </div>
        )}
      </div>
    );
  }

  // Card mode: session grid + input bar
  return (
    <div className="app no-chrome">
      <WindowChrome />
      <UpdateBanner />
      {claudeStatusBanner}
      <SpotlightTour />
      <div className="dashboard">
        <div
          className="grid-wrap"
          ref={(el) => {
            if (!el) return;
            // Restore the scroll position from the last time we left the grid.
            if (gridScrollRef.current) el.scrollTop = gridScrollRef.current;
          }}
          onScroll={(e) => {
            gridScrollRef.current = (e.target as HTMLDivElement).scrollTop;
          }}
        >
          <SessionsGrid
            sessions={sessionsList}
            loading={loading}
            selectedId={null}
            onSelect={(s) => {
              if (deleteMode) {
                toggleDeleteSelection(s.sessionId);
                return;
              }
              // Pre-realSessionId placeholders have a temp id that nothing on
              // disk knows about — opening detail would render an empty shell.
              // The card swaps to the real id automatically as soon as
              // newSession resolves; until then a click is a no-op.
              if (s.sessionId.startsWith(PENDING_PREFIX)) {
                setToast({ kind: 'info', text: '에이전트가 시작 중입니다. 잠시만 기다려주세요.' });
                return;
              }
              setSelectedId(s.sessionId);
            }}
            now={now}
            flashMap={flash}
            filter={filter}
            onFilterChange={setFilter}
            renames={renames}
            deleteMode={deleteMode}
            selectedForDelete={selectedForDelete}
            onToggleDelete={toggleDeleteSelection}
            onToggleDeleteMode={toggleDeleteMode}
            onPerformBulkDelete={performBulkDelete}
            viewMode={viewMode}
            onViewModeToggle={toggleViewMode}
          />
        </div>

        <InputBar
          mode="new"
          agents={agents}
          defaultCwd={DEFAULT_CWD}
          draft={newDraft}
          onDraftChange={setNewDraft}
          onSend={onStartNewSession}
        />
      </div>

      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function SessionsGrid({
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
}: {
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
}) {
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
