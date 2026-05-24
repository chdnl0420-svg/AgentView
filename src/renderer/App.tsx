import { useCallback, useMemo, useRef, useState } from 'react';
import type { BgSession, NewSessionInput } from '@shared/types';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { SessionsGrid } from './components/SessionsGrid';
import { InputBar } from './components/InputBar';
import { UpdateBanner } from './components/UpdateBanner';
import { SpotlightTour } from './components/SpotlightTour';
import { WindowChrome } from './components/WindowChrome';
import { isEmptyDeadSession, type SessionFilter } from './lib/sessionFilters';
import {
  PENDING_PREFIX,
  makeTempId,
  pendingToBgSession,
  type PendingSession
} from './lib/pendingSession';
import { useSessionScan } from './state/useSessionScan';
import { useAgentsAndRunning } from './state/useAgentsAndRunning';
import { usePendingSessions } from './state/usePendingSessions';
import { useDrafts } from './state/useDrafts';
import { useQueues } from './state/useQueues';
import { useRenames } from './state/useRenames';
import { useClaudeStatus } from './state/useClaudeStatus';
import { useClock } from './state/useClock';
import { useBackForwardNav } from './state/useBackForwardNav';
import { useRunEventsToast } from './state/useRunEventsToast';
import { useDeleteMode } from './state/useDeleteMode';
import { useViewMode } from './state/useViewMode';

const DEFAULT_CWD = 'D:\\Project\\VisualAgents';

export default function App() {
  const { scan, loading, flash, reloadSessions } = useSessionScan();
  const { agents, running } = useAgentsAndRunning();
  const { pending, setPending } = usePendingSessions(scan);
  const { draftsRef, setDraft, newDraft, setNewDraft } = useDrafts();
  const { queues, setQueue } = useQueues();
  const { renames, refresh: refreshRenames, activeBackend } = useRenames();
  const claudeStatus = useClaudeStatus();
  const now = useClock();
  const { viewMode, viewModeRef, toggleViewMode } = useViewMode();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Set<SessionFilter>>(
    () => new Set(['running', 'waiting', 'completed'])
  );
  const { toast, setToast } = useRunEventsToast(reloadSessions);
  const notify = useCallback(
    (kind: 'error' | 'info', text: string) => setToast({ kind, text }),
    [setToast]
  );
  const {
    deleteMode,
    selectedForDelete,
    toggleDeleteMode,
    toggleDeleteSelection,
    performBulkDelete
  } = useDeleteMode({ onReload: reloadSessions, notify });

  useBackForwardNav(selectedId, setSelectedId);

  const gridScrollRef = useRef<number>(0);

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
      const placeholder: PendingSession = {
        tempId,
        realSessionId: null,
        realSeenAt: null,
        startedAt: Date.now(),
        prompt: input.prompt,
        cwd: input.cwd,
        agent: input.agent || 'claude',
        backend: input.backend || 'claude',
        name: displayName
      };
      setPending((prev) => [placeholder, ...prev]);
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
    [reloadSessions, setPending, viewModeRef]
  );

  const toastNode = toast ? (
    <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
      {toast.text}
    </div>
  ) : null;

  const claudeStatusBanner =
    activeBackend === 'claude' && claudeStatus && !claudeStatus.cliPath ? (
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
      <div className="app no-chrome detail-only">
        <WindowChrome />
        <UpdateBanner />
        {claudeStatusBanner}
        <SpotlightTour />
        <SessionDetail
          session={selected}
          agents={agents}
          running={running}
          onBack={() => {
            refreshRenames();
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
      </div>
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
                  refreshRenames();
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
        {toastNode}
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
      {toastNode}
    </div>
  );
}
