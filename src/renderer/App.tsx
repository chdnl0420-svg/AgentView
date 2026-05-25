import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BgSession, NewSessionInput } from '@shared/types';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { InputBar } from './components/InputBar';
import { UpdateBanner } from './components/UpdateBanner';
import { SpotlightTour } from './components/SpotlightTour';
import { WindowChrome } from './components/WindowChrome';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ShortcutHelp } from './components/ShortcutHelp';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { isEmptyDeadSession } from './lib/sessionFilters';
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
import { matchesAccel } from './lib/shortcuts';
import { applyTheme, loadTheme, nextTheme, setTheme, watchSystemTheme, resolveTheme } from './lib/theme';
import { pushRecent, previousRecent } from './lib/recentSessions';
import { readUrlState, writeUrlState } from './lib/urlState';

const DEFAULT_CWD = 'D:\\Project\\VisualAgents';

function isEditableTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (t.isContentEditable ?? false);
}

export default function App() {
  const { scan, loading, flash, reloadSessions } = useSessionScan();
  const { agents, running } = useAgentsAndRunning();
  const { pending, setPending } = usePendingSessions(scan);
  const { draftsRef, setDraft, newDraft, setNewDraft } = useDrafts();
  const { queues, setQueue } = useQueues();
  const { renames, refresh: refreshRenames, activeBackend } = useRenames();
  const claudeStatus = useClaudeStatus();
  const now = useClock();
  const [selectedId, setSelectedId] = useState<string | null>(() => readUrlState().sessionId);
  const { toast, setToast } = useRunEventsToast(reloadSessions);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [theme, setThemeState] = useState(() => loadTheme());

  useBackForwardNav(selectedId, setSelectedId);

  // Apply persisted theme + react to system theme changes when in "system" mode.
  useEffect(() => {
    applyTheme(loadTheme());
    const teardown = watchSystemTheme();
    const onThemeChange = (e: Event) => {
      const detail = (e as CustomEvent<typeof theme>).detail;
      if (detail) setThemeState(detail);
    };
    window.addEventListener('agentview:theme-changed', onThemeChange as EventListener);
    return () => {
      teardown();
      window.removeEventListener('agentview:theme-changed', onThemeChange as EventListener);
    };
  }, []);

  // Push the active session into the recent-visits ring buffer so Ctrl+J and
  // the command palette can rank by recency. Also mirror the selected ID
  // into the URL hash so deep links like `#?id=<sid>` open the right
  // session on reload (researcher item #196).
  useEffect(() => {
    if (selectedId) pushRecent(selectedId);
    const cur = readUrlState();
    writeUrlState({ ...cur, sessionId: selectedId });
  }, [selectedId]);

  // OS notifications: surface session completions / crashes so the user
  // doesn't have to camp on the window. Clicking the notification focuses
  // the app + jumps to that session (researcher items #253 / #254 / #255).
  useEffect(() => {
    const off = window.av.sessions.onRunEvent((evt) => {
      if (evt.type === 'exit') {
        const ok = evt.exitCode === 0 || evt.exitCode === null;
        const session = (scan?.sessions ?? []).find((s) => s.sessionId === evt.sessionId);
        const name = session
          ? renames[evt.sessionId] || session.name || session.agent || evt.sessionId.slice(0, 8)
          : evt.sessionId.slice(0, 8);
        void window.av.app?.showNotification?.({
          title: ok ? '세션 완료' : '세션 종료 (오류)',
          body: ok
            ? `${name} — 작업이 완료되었습니다.`
            : `${name} — 종료 코드 ${evt.exitCode ?? '?'}`,
          sessionId: evt.sessionId,
          kind: ok ? 'success' : 'error'
        }).catch(() => undefined);
      }
    });
    return off;
  }, [scan, renames]);

  // When main forwards a notification click, focus the originating session.
  useEffect(() => {
    const onClick = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId) setSelectedId(detail.sessionId);
    };
    window.addEventListener('agentview:notification-click', onClick as EventListener);
    return () => window.removeEventListener('agentview:notification-click', onClick as EventListener);
  }, []);

  const sessionsList = useMemo(() => {
    const real = (scan?.sessions ?? []).filter((s) => !isEmptyDeadSession(s));
    if (pending.length === 0) return real;
    const realIds = new Set(real.map((s) => s.sessionId));
    const placeholders = pending
      .filter((p) => !(p.realSessionId && realIds.has(p.realSessionId)))
      .map(pendingToBgSession);
    return [...placeholders, ...real];
  }, [scan, pending]);

  const selected = useMemo<BgSession | null>(() => {
    if (!selectedId) return null;
    const hit = (scan?.sessions ?? []).find((s) => s.sessionId === selectedId);
    if (hit) return hit;
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

  // Sync the OS window title with the running-session count + selected name
  // so the OS task switcher / taskbar tooltip shows useful context. #263.
  useEffect(() => {
    const activeCount = sessionsList.filter((s) => s.alive).length;
    const name = selected
      ? renames[selected.sessionId] || selected.name || selected.agent || selected.sessionId.slice(0, 8)
      : null;
    const baseTitle = 'AgentView';
    const parts = [baseTitle];
    if (activeCount > 0) parts.push(`(${activeCount} 실행 중)`);
    if (name) parts.push(`· ${name}`);
    document.title = parts.join(' ');
    // Also broadcast the running-session count to main so it can update the
    // taskbar overlay icon / tray badge.
    window.av.app?.setSessionStats?.({ active: activeCount, total: sessionsList.length }).catch(() => undefined);
  }, [sessionsList, selected, renames]);

  // Jump to a specific session by ID — used by command palette, Ctrl+1..9, etc.
  const jumpToSession = useCallback(
    (id: string) => {
      const exists = sessionsList.find((s) => s.sessionId === id);
      if (!exists) return;
      setSelectedId(id);
    },
    [sessionsList]
  );

  // Cycle through sessions in the sidebar order. step = +1 for next, -1 for prev.
  const cycleSession = useCallback(
    (step: 1 | -1) => {
      const visible = sessionsList.filter((s) => !isEmptyDeadSession(s));
      if (visible.length === 0) return;
      const idx = selectedId ? visible.findIndex((s) => s.sessionId === selectedId) : -1;
      const nextIdx = idx < 0 ? 0 : (idx + step + visible.length) % visible.length;
      const next = visible[nextIdx];
      if (next) setSelectedId(next.sessionId);
    },
    [sessionsList, selectedId]
  );

  // Toggle to the previously-active session (Ctrl+J).
  const togglePrevious = useCallback(() => {
    const prev = previousRecent(selectedId);
    if (prev && prev !== selectedId) setSelectedId(prev);
  }, [selectedId]);

  // Global shortcuts (researcher items #43/#213 #220 #370 #227 + new items
  // #209 #210 #211 #212 #214 #221 #250 #145 #228-230 #206 #23 #164 #226).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editable = isEditableTarget(e.target);
      const inMatchableContext = (allowEditable: boolean) => allowEditable || !editable;

      // Help panel: F1 or Ctrl+/ → toggle (always wins, even inside editable).
      if (e.key === 'F1' || (matchesAccel(e, 'Ctrl+/') && !editable)) {
        e.preventDefault();
        setShortcutHelpOpen((v) => !v);
        return;
      }
      // Command palette: Ctrl+K or Ctrl+Shift+P. Ctrl+K is allowed even inside
      // editable targets (input/textarea) because that's where users most
      // often want to summon the palette.
      if (matchesAccel(e, 'Ctrl+K') && inMatchableContext(true)) {
        e.preventDefault();
        setCmdPaletteOpen((v) => !v);
        return;
      }
      if (matchesAccel(e, 'Ctrl+Shift+P') && inMatchableContext(true)) {
        e.preventDefault();
        setCmdPaletteOpen((v) => !v);
        return;
      }
      // New session
      if (matchesAccel(e, 'Ctrl+N') && !editable) {
        e.preventDefault();
        setSelectedId(null);
        return;
      }
      // Close current session → back to dashboard
      if (matchesAccel(e, 'Ctrl+W') && !editable) {
        e.preventDefault();
        setSelectedId(null);
        return;
      }
      // Cycle next / prev session
      if (matchesAccel(e, 'Ctrl+Tab')) {
        e.preventDefault();
        cycleSession(1);
        return;
      }
      if (matchesAccel(e, 'Ctrl+Shift+Tab')) {
        e.preventDefault();
        cycleSession(-1);
        return;
      }
      // Ctrl+J → toggle to previous session
      if (matchesAccel(e, 'Ctrl+J') && !editable) {
        e.preventDefault();
        togglePrevious();
        return;
      }
      // Ctrl+1..9 → jump to N-th session
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && !editable) {
        e.preventDefault();
        const visible = sessionsList.filter((s) => !isEmptyDeadSession(s));
        const idx = parseInt(e.key, 10) - 1;
        const target = visible[idx];
        if (target) setSelectedId(target.sessionId);
        return;
      }
      // Focus shortcuts (Alt+1/2/3, Ctrl+L).
      if (matchesAccel(e, 'Alt+1')) {
        e.preventDefault();
        (document.querySelector('.session-list') as HTMLElement | null)?.focus();
        return;
      }
      if (matchesAccel(e, 'Alt+2')) {
        e.preventDefault();
        const ws = document.querySelector('.single-workspace') as HTMLElement | null;
        (ws?.querySelector<HTMLElement>('[tabindex],input,textarea,button') ?? ws)?.focus();
        return;
      }
      if (matchesAccel(e, 'Alt+3') || matchesAccel(e, 'Ctrl+L')) {
        e.preventDefault();
        const inputEl = document.querySelector('.input-box') as HTMLElement | null;
        inputEl?.focus();
        return;
      }
      // Options panel toggle (Ctrl+,)
      if (matchesAccel(e, 'Ctrl+,') && !editable) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('agentview:open-options'));
        return;
      }
      // F11 → fullscreen toggle via main process
      if (e.key === 'F11') {
        e.preventDefault();
        window.av.app?.toggleFullscreen?.().catch(() => undefined);
        return;
      }
      // F6 keeps the sidebar↔workspace cycle from the previous global handler.
      if (e.key === 'F6') {
        e.preventDefault();
        const sidebar = document.querySelector('.session-list') as HTMLElement | null;
        const workspace = document.querySelector('.single-workspace') as HTMLElement | null;
        const inSidebar = sidebar?.contains(document.activeElement);
        if (inSidebar && workspace) {
          (workspace.querySelector<HTMLElement>('[tabindex],input,textarea,button') ?? workspace).focus();
        } else if (sidebar) {
          sidebar.focus();
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycleSession, togglePrevious, sessionsList]);

  // Build the static command-palette catalog. Session entries are added
  // dynamically inside the palette component itself.
  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'new-session',
        label: '새 작업 시작',
        hint: '대시보드로 돌아가서 새 세션 시작',
        accel: 'Ctrl+N',
        group: '명령',
        run: () => setSelectedId(null)
      },
      {
        id: 'shortcut-help',
        label: '단축키 도움말 열기',
        accel: 'Ctrl+/',
        group: '명령',
        run: () => setShortcutHelpOpen(true)
      },
      {
        id: 'next-session',
        label: '다음 세션',
        accel: 'Ctrl+Tab',
        group: '명령',
        run: () => cycleSession(1)
      },
      {
        id: 'prev-session',
        label: '이전 세션',
        accel: 'Ctrl+Shift+Tab',
        group: '명령',
        run: () => cycleSession(-1)
      },
      {
        id: 'recent-toggle',
        label: '최근 세션으로 전환',
        accel: 'Ctrl+J',
        group: '명령',
        run: togglePrevious
      },
      {
        id: 'theme-toggle',
        label: `테마 전환 (현재: ${resolveTheme(theme)})`,
        hint: 'System → Light → Dark 순환',
        group: '명령',
        run: () => {
          const next = nextTheme(theme);
          setTheme(next);
          setThemeState(next);
        }
      },
      {
        id: 'theme-light',
        label: '테마: 라이트 모드',
        group: '테마',
        run: () => {
          setTheme('light');
          setThemeState('light');
        }
      },
      {
        id: 'theme-dark',
        label: '테마: 다크 모드',
        group: '테마',
        run: () => {
          setTheme('dark');
          setThemeState('dark');
        }
      },
      {
        id: 'theme-system',
        label: '테마: 시스템 따라가기',
        group: '테마',
        run: () => {
          setTheme('system');
          setThemeState('system');
        }
      },
      {
        id: 'fullscreen',
        label: '전체화면 토글',
        accel: 'F11',
        group: '창',
        run: () => window.av.app?.toggleFullscreen?.().catch(() => undefined)
      },
      {
        id: 'open-options',
        label: '옵션 패널 열기',
        accel: 'Ctrl+,',
        group: '명령',
        run: () => window.dispatchEvent(new CustomEvent('agentview:open-options'))
      },
      {
        id: 'reload',
        label: '세션 목록 새로고침',
        group: '명령',
        run: () => reloadSessions()
      }
    ],
    [theme, cycleSession, togglePrevious, reloadSessions]
  );

  const onStartNewSession = useCallback(
    async (input: NewSessionInput) => {
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
      if (res && res.sessionId) {
        const realSessionId = res.sessionId;
        setPending((prev) =>
          prev.map((p) => (p.tempId === tempId ? { ...p, realSessionId } : p))
        );
        setSelectedId(realSessionId);
        for (const delay of [400, 900, 2000, 4000, 6500]) {
          window.setTimeout(() => reloadSessions(), delay);
        }
      } else {
        setPending((prev) => prev.filter((p) => p.tempId !== tempId));
      }
    },
    [reloadSessions, setPending]
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

  return (
    <ErrorBoundary>
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
      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        sessions={sessionsList}
        renames={renames}
        selectedId={selectedId}
        onJump={jumpToSession}
        commands={paletteCommands}
      />
      <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
      {toastNode}
    </div>
    </ErrorBoundary>
  );
}
