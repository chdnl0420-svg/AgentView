import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentInfo,
  BgSession,
  ConversationAppend,
  ConversationFile,
  ConversationMessage,
  PermissionMode,
  RunningSessionInfo
} from '@shared/types';
import { renderMarkdown } from '../lib/markdown';
import {
  extractToolFilePath,
  isAskUserQuestionInput,
  parseAskUserQuestionResult,
  summarizeToolResult,
  summarizeToolUse
} from '../lib/toolSummary';
import { cleanUserMessage, isEmptyUserMessage, segmentBody, type Segment } from '../lib/userMessage';
import {
  appendAttachmentsToPrompt,
  basename,
  fileUrl,
  iconFor,
  isImage
} from '../lib/attachments';
import { formatRelative } from '../lib/format';
import { InputBar, type InputDraft } from './InputBar';
import { loadJSON, saveJSON } from '../lib/persistence';
import { FilePreviewModal } from './FilePreviewModal';
import { PathContextMenu } from './PathContextMenu';
import { AskQuestionWizard } from './AskQuestionWizard';
import { LinkifiedText } from './LinkifiedText';
import { ContextDonut } from './ContextDonut';
import { statusLabel, formatDurationShort, formatTokens } from './SessionDetailFormatters';
import { renderMessages, QueuedBubble } from './SessionDetailBubbles';

// Path click + context menu shared callbacks. Components below the bubbles
// thread these down so a single FilePreviewModal / PathContextMenu instance
// lives at the page root.
interface PathHandlers {
  onPathClick: (path: string) => void;
  onPathContext: (path: string, x: number, y: number) => void;
}
const PathHandlersContext = React.createContext<PathHandlers | null>(null);
function usePathHandlers(): PathHandlers | null {
  return React.useContext(PathHandlersContext);
}

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: '기본',
  acceptEdits: '편집 자동 승인',
  bypassPermissions: '모든 권한 자동',
  plan: '계획 모드'
};
const PERMISSION_ORDER: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const MODEL_OPTIONS: Array<{ value: string | null; label: string }> = [
  { value: null, label: '기본 (자동)' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' }
];

const RENAMES_KEY = 'sessionRenames';
function loadRenames(): Record<string, string> {
  return loadJSON<Record<string, string>>(RENAMES_KEY, {});
}
function saveRename(sessionId: string, name: string | null): void {
  const cur = loadRenames();
  if (name && name.trim()) cur[sessionId] = name.trim();
  else delete cur[sessionId];
  saveJSON(RENAMES_KEY, cur);
  // Notify the App (same tab — native 'storage' doesn't fire for self).
  window.dispatchEvent(new CustomEvent('agentview:renames-changed'));
}

export interface QueuedPrompt {
  id: string;
  prompt: string;
  attachments: string[];
  createdAt: number;
}

interface SessionDetailProps {
  session: BgSession;
  agents: AgentInfo[];
  running: RunningSessionInfo[];
  onBack: () => void;
  onForked?: (oldSessionId: string, newSessionId: string) => void;
  draft?: InputDraft;
  onDraftChange?: (draft: InputDraft) => void;
  queue?: QueuedPrompt[];
  onQueueChange?: (updater: (prev: QueuedPrompt[]) => QueuedPrompt[]) => void;
}

export function SessionDetail({
  session,
  agents,
  running,
  onBack,
  onForked,
  draft,
  onDraftChange,
  queue = [],
  onQueueChange
}: SessionDetailProps) {
  const [data, setData] = useState<ConversationFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef<boolean>(true);

  // ---- File preview modal + path context menu (page-level singletons) ----
  const [preview, setPreview] = useState<{ path: string } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const onPathClick = useCallback((p: string) => setPreview({ path: p }), []);
  const onPathContext = useCallback(
    (p: string, x: number, y: number) => setCtxMenu({ x, y, path: p }),
    []
  );
  const pathHandlers = useMemo<PathHandlers>(
    () => ({ onPathClick, onPathContext }),
    [onPathClick, onPathContext]
  );

  // ---- "Only my messages" filter (per-session, persisted) ----
  const onlyMineKey = `view.onlyMine.${session.sessionId}`;
  const [onlyMine, setOnlyMine] = useState<boolean>(() => loadJSON<boolean>(onlyMineKey, false));
  useEffect(() => {
    setOnlyMine(loadJSON<boolean>(onlyMineKey, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);
  const toggleOnlyMine = () => {
    setOnlyMine((v) => {
      const next = !v;
      saveJSON(onlyMineKey, next);
      return next;
    });
  };

  // ---- Goal bar (workspace doc prompt OR meta.lastPrompt) + completed toggle ----
  const goalDoneKey = `goal.done.${session.sessionId}`;
  const [goalDone, setGoalDone] = useState<boolean>(() => loadJSON<boolean>(goalDoneKey, false));
  const [workspacePrompt, setWorkspacePrompt] = useState<string | null>(null);
  useEffect(() => {
    setGoalDone(loadJSON<boolean>(goalDoneKey, false));
    setWorkspacePrompt(null);
    let cancelled = false;
    window.av.workspace
      .read(session.sessionId)
      .then((md) => {
        if (cancelled || !md) return;
        const m = /```\n([\s\S]*?)\n```/.exec(md);
        if (m) setWorkspacePrompt(m[1].trim().split(/\r?\n/)[0].slice(0, 240));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);
  const toggleGoalDone = () => {
    setGoalDone((v) => {
      const next = !v;
      saveJSON(goalDoneKey, next);
      return next;
    });
  };

  // ---- Crash banner dismiss (resets per session) ----
  const [crashDismissed, setCrashDismissed] = useState(false);
  useEffect(() => {
    setCrashDismissed(false);
  }, [session.sessionId]);

  // ---- Top-panel badge dropdowns + transient toast for "다음 메시지부터 적용" ----
  const [permDropdownOpen, setPermDropdownOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [badgeToast, setBadgeToast] = useState<string | null>(null);
  useEffect(() => {
    if (!badgeToast) return;
    const t = window.setTimeout(() => setBadgeToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [badgeToast]);
  useEffect(() => {
    if (!permDropdownOpen && !modelDropdownOpen) return;
    const close = () => {
      setPermDropdownOpen(false);
      setModelDropdownOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [permDropdownOpen, modelDropdownOpen]);
  // Goal text shown in the goal-row: workspace doc prompt first, then last
  // user message, then nothing (the row hides itself).
  const goalText = workspacePrompt || null;
  // Korean label for the four claude permission modes.
  const permLabel = (mode: string): string => {
    switch (mode) {
      case 'bypassPermissions': return '전체 허용';
      case 'acceptEdits': return '편집만 자동';
      case 'default': return '기본 확인';
      case 'plan': return '계획 모드';
      default: return mode;
    }
  };

  // ---- Permission / Model dropdowns + ephemeral toast ----
  const [permMenuOpen, setPermMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [miniToast, setMiniToast] = useState<string | null>(null);
  useEffect(() => {
    if (!miniToast) return;
    const t = window.setTimeout(() => setMiniToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [miniToast]);

  // ---- Send race / idempotency guards ----
  const sendingRef = useRef(false);
  const lastSentRef = useRef<{ sig: string; at: number } | null>(null);

  // "Busy" purely tracks the agent's reported status. A live PTY that's just
  // sitting idle waiting for the next prompt is NOT busy — the card already
  // says 대기, and the chat input must accept the next message immediately.
  const busy = session.alive && session.status === 'running';

  // tick every second while busy to keep the "작업 중" line live
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  // Turn start = timestamp of the most recent user message we can see.
  // Token usage = sum of input + output from the most recent assistant message.
  // Model = most recent assistant message's model field.
  const turnInfo = useMemo(() => {
    const msgs = data?.messages ?? [];
    let startedAt: number | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let model: string | undefined;
    // Most-recent tool_use BEFORE the agent finishes that turn — that's the
    // tool claude is currently waiting on (or just ran). We use it to label
    // the "작업 중" spinner with what's actually happening right now instead
    // of a generic "agent thinking" line.
    let currentTool: { name?: string; summary?: string } | undefined;
    // Recent assistant text snippet so the user has more context while the
    // model is mid-stream (claude often emits a short status sentence before
    // calling a tool — show that).
    let recentAssistantText: string | undefined;
    let recentToolResult: { name?: string; text?: string } | undefined;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!startedAt && m.role === 'user' && m.ts) startedAt = m.ts;
      if (m.role === 'assistant') {
        if (!model && m.model) model = m.model;
        if (!inputTokens && !outputTokens) {
          // Display only the freshly-written input tokens. cache_read /
          // cache_creation portions are huge for a brand-new session
          // (system prompt, tools list, CLAUDE.md, skills) and made the
          // footer look like the user already spent tens of thousands
          // of tokens before typing anything.
          const raw = m.raw as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } };
          const u = raw?.message?.usage;
          if (u) {
            inputTokens = u.input_tokens || 0;
            outputTokens = u.output_tokens || 0;
          }
        }
        if (!recentAssistantText && m.kind === 'text' && m.text) {
          // Take just the last short paragraph as a hint of what claude is doing.
          const tail = m.text.trim().split(/\n{2,}/).pop() || '';
          if (tail) recentAssistantText = tail.slice(0, 160);
        }
      }
      if (!currentTool && m.kind === 'tool_use' && m.toolName) {
        currentTool = {
          name: m.toolName,
          summary: summarizeToolUse(m.toolName, m.toolInput)
        };
      }
      if (!recentToolResult && m.kind === 'tool_result') {
        recentToolResult = {
          name: m.toolName,
          text: summarizeToolResult(m.text)
        };
      }
      if (
        startedAt &&
        (inputTokens || outputTokens) &&
        model &&
        currentTool &&
        recentAssistantText
      ) break;
    }
    return {
      startedAt,
      inputTokens,
      outputTokens,
      model,
      currentTool,
      recentAssistantText,
      recentToolResult
    };
  }, [data?.messages]);

  const elapsedMs = turnInfo.startedAt ? tick - turnInfo.startedAt : 0;
  const elapsedLabel = elapsedMs > 0 ? formatDurationShort(elapsedMs) : '';
  const totalTokens = turnInfo.inputTokens + turnInfo.outputTokens;

  // The most-recent UNANSWERED AskUserQuestion tool_use in the conversation.
  // "Unanswered" = no tool_result with a matching toolUseId appears AFTER it.
  // Exposed as a dedicated panel above the composer so the user can answer
  // without scrolling, matching the Claude Code desktop AskUserQuestion UX.
  const pendingAsk = useMemo(() => {
    const msgs = data?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.kind !== 'tool_use') continue;
      const parsed = isAskUserQuestionInput(m.toolName ?? '', m.toolInput);
      if (!parsed) continue;
      // Check if any tool_result with matching toolUseId came after.
      let answered = false;
      for (let j = i + 1; j < msgs.length; j++) {
        const r = msgs[j];
        if (r.kind === 'tool_result' && r.toolUseId === m.toolUseId) {
          answered = true;
          break;
        }
      }
      if (answered) return null;
      return { uuid: m.uuid, toolUseId: m.toolUseId, questions: parsed.questions };
    }
    return null;
  }, [data?.messages]);
  const [submittingAsk, setSubmittingAsk] = useState(false);
  // CLI-style status bar verbs + tips rotate while the agent is busy. The
  // CLI cycles through these for visual life — we mirror the same set.
  const CLI_VERBS = [
    'Percolating', 'Thinking', 'Crafting', 'Pondering',
    'Brewing', 'Cogitating', 'Working', 'Computing'
  ];
  const CLI_TIPS = [
    'Use /btw to ask a quick side question without interrupting current work',
    'Press Esc twice to stop the current run',
    'Drag and drop files into the composer to attach',
    'Ctrl+Enter sends your message',
    'Click the donut icon up top to see context usage',
    'Mouse XButton1/XButton2 navigates back/forward'
  ];
  const cliVerb = useMemo(() => CLI_VERBS[Math.floor((tick / 8000) % CLI_VERBS.length)], [tick]);
  const cliTip = useMemo(() => CLI_TIPS[Math.floor((tick / 12000) % CLI_TIPS.length)], [tick]);
  // Selected answer per question. For multiSelect=true questions, value is
  // an array of labels; otherwise a single label string. Cleared whenever
  // the pendingAsk identity changes (new question batch arrives).
  const [askSelections, setAskSelections] = useState<Record<number, string | string[]>>({});
  useEffect(() => {
    setAskSelections({});
  }, [pendingAsk?.uuid]);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  // claude.ai /api/oauth/usage data (5h + weekly). Refreshed every 60s
  // while the popup is open + on first open. null means "not fetched yet"
  // or fetch failed (e.g. no OAuth token).
  const [usage, setUsage] = useState<{
    fiveHour?: { used: number; limit: number; pct: number; resetIso?: string; resetIn?: string };
    weekly?: { used: number; limit: number; pct: number; resetIso?: string; resetIn?: string };
    fetchedAt: number;
  } | null>(null);
  useEffect(() => {
    if (!contextPanelOpen) return;
    let cancelled = false;
    const run = async () => {
      try {
        const r = await window.av.sessions.fetchUsage();
        if (!cancelled) setUsage(r);
      } catch { /* swallow */ }
    };
    run();
    const t = window.setInterval(run, 60_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [contextPanelOpen]);
  const contextBtnRef = useRef<HTMLButtonElement | null>(null);
  const [contextPanelPos, setContextPanelPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!contextPanelOpen) { setContextPanelPos(null); return; }
    const btn = contextBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setContextPanelPos({ top: r.bottom + 8, left: Math.max(8, r.right - 340) });
  }, [contextPanelOpen]);
  // Context window size by model. Falls back to 200k for unknown models.
  // Opus / Sonnet with the 1M context flag is detected by the model string
  // containing "1m" — claude exposes that as part of the model name.
  const contextWindow = useMemo(() => {
    const m = (turnInfo.model || '').toLowerCase();
    if (m.includes('1m')) return 1_000_000;
    if (m.includes('opus')) return 1_000_000;
    if (m.includes('haiku')) return 200_000;
    if (m.includes('sonnet')) return 200_000;
    return 200_000;
  }, [turnInfo.model]);
  const contextUsed = turnInfo.inputTokens + turnInfo.outputTokens;
  const contextPct = Math.min(100, Math.round((contextUsed / contextWindow) * 100));
  const toggleAskOption = (qi: number, label: string, multi: boolean) => {
    setAskSelections((prev) => {
      const next = { ...prev };
      if (multi) {
        const cur = Array.isArray(next[qi]) ? (next[qi] as string[]) : [];
        next[qi] = cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label];
      } else {
        // Single-select toggle: clicking the same option clears the choice.
        next[qi] = next[qi] === label ? '' : label;
      }
      return next;
    });
  };
  const allAskAnswered = useMemo(() => {
    if (!pendingAsk) return false;
    return pendingAsk.questions.every((_, qi) => {
      const v = askSelections[qi];
      if (Array.isArray(v)) return v.length > 0;
      return !!(v && typeof v === 'string' && v.length > 0);
    });
  }, [pendingAsk, askSelections]);
  const onSubmitAsk = async () => {
    if (!pendingAsk || submittingAsk || !allAskAnswered) return;
    setSubmittingAsk(true);
    try {
      const parts: string[] = [];
      pendingAsk.questions.forEach((q, qi) => {
        const v = askSelections[qi];
        const ans = Array.isArray(v) ? v.join(', ') : (v as string);
        if (pendingAsk.questions.length > 1) {
          parts.push(`Q${qi + 1}: ${ans}`);
        } else {
          parts.push(ans);
        }
      });
      await sendNow({
        sessionId: session.sessionId,
        prompt: parts.join('\n'),
        cwd: session.cwd,
        agent: session.agent ?? null,
        model: null
      });
    } finally {
      setSubmittingAsk(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setFreshIds(new Set());
    window.av.sessions
      .read(session.sessionId)
      .then((conv) => {
        if (!cancelled) setData(conv);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.sessionId]);

  useEffect(() => {
    window.av.sessions.watch(session.sessionId);
    return () => {
      window.av.sessions.unwatch(session.sessionId);
    };
  }, [session.sessionId]);

  // Global click-to-copy for code blocks rendered via dangerouslySetInnerHTML.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.classList.contains('code-copy-btn')) return;
      const code = t.getAttribute('data-code') || '';
      if (!code) return;
      const txt = code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      navigator.clipboard.writeText(txt).then(() => {
        const prev = t.textContent;
        t.textContent = '✓ 복사됨';
        window.setTimeout(() => { if (t.isConnected) t.textContent = prev || '복사'; }, 1400);
      }).catch(() => undefined);
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  // Watch the worker's TUI output for inline permission prompts so we can
  // surface them as a modal in the chat panel — otherwise the prompt lives
  // entirely inside the daemon's terminal and the user can't answer it.
  const [pendingPrompt, setPendingPrompt] = useState<{
    id: string;
    question: string;
    options: Array<{ key: string; label: string }>;
  } | null>(null);
  const [answering, setAnswering] = useState(false);
  useEffect(() => {
    window.av.sessions.watchOutput(session.sessionId);
    const off = window.av.sessions.onPermissionPrompt((p) => {
      if (p.sessionId !== session.sessionId) return;
      setPendingPrompt({ id: p.id, question: p.question, options: p.options });
    });
    return () => {
      off();
      window.av.sessions.unwatchOutput(session.sessionId);
    };
  }, [session.sessionId]);
  const onAnswerPrompt = async (key: string) => {
    if (!pendingPrompt || answering) return;
    setAnswering(true);
    try {
      await window.av.sessions.answerPrompt(session.sessionId, key);
      setPendingPrompt(null);
    } finally {
      setAnswering(false);
    }
  };

  // When the session is brand-new (or being attached for the first time),
  // ~/.claude/projects/<cwd>/<sid>.jsonl does not exist yet — the initial
  // read() returns null and the live watcher attaches to a missing file.
  // Poll read() in the background until the jsonl appears, then re-call
  // watch() so the live tail kicks in. Stops once data is non-null or after
  // ~90 seconds (caps log traffic for genuinely-defunct sessions).
  useEffect(() => {
    if (loading) return;
    if (data) return;
    let cancelled = false;
    const POLL_MS = 1500;
    const MAX_ATTEMPTS = 60;
    let attempts = 0;
    let timer: number | null = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        const conv = await window.av.sessions.read(session.sessionId);
        if (cancelled) return;
        if (conv) {
          setData(conv);
          // Re-attach the live tail now that the file exists.
          window.av.sessions.watch(session.sessionId);
          return;
        }
      } catch {
        /* ignore — try again on next tick */
      }
      if (attempts++ < MAX_ATTEMPTS) {
        timer = window.setTimeout(tick, POLL_MS);
      }
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loading, data, session.sessionId]);

  useEffect(() => {
    const off = window.av.sessions.onConversationAppended((evt: ConversationAppend) => {
      if (evt.sessionId !== session.sessionId) return;
      setData((prev) => {
        if (!prev) {
          return {
            sessionId: session.sessionId,
            filePath: evt.filePath,
            messages: evt.newMessages,
            sizeBytes: evt.sizeBytes,
            truncated: false,
            meta: {}
          };
        }
        const seen = new Set(prev.messages.map((m) => m.uuid));
        const additions = evt.newMessages.filter((m) => !seen.has(m.uuid));
        if (additions.length === 0) return { ...prev, sizeBytes: evt.sizeBytes };
        // 1.0.5 — dropped the optimisticTextsRef dedupe layer. The optimistic
        // refs were always empty (the placeholder path was removed earlier
        // but the dedupe loop lingered), so this used to be dead code that
        // also masked real in-flight user messages from rendering.
        return {
          ...prev,
          messages: [...prev.messages, ...additions],
          sizeBytes: evt.sizeBytes
        };
      });
      setFreshIds((prev) => {
        const next = new Set(prev);
        for (const m of evt.newMessages) next.add(m.uuid);
        return next;
      });
      window.setTimeout(() => {
        setFreshIds((prev) => {
          const next = new Set(prev);
          for (const m of evt.newMessages) next.delete(m.uuid);
          return next;
        });
      }, 1200);
    });
    return off;
  }, [session.sessionId]);

  useEffect(() => {
    if (!stickToBottomRef.current || !bodyRef.current) return;
    const el = bodyRef.current;
    el.scrollTop = el.scrollHeight;
  }, [data?.messages.length, busy, queue.length]);

  // When a new queued message is added, force-scroll to the bottom so the
  // user sees the new pending bubble even if they had scrolled up.
  const lastQueueLenRef = useRef(queue.length);
  useEffect(() => {
    if (queue.length > lastQueueLenRef.current && bodyRef.current) {
      stickToBottomRef.current = true;
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
    lastQueueLenRef.current = queue.length;
  }, [queue.length]);

  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 60;
  };

  const isOurs = running.some((r) => r.sessionId === session.sessionId);
  // External and currently alive → claude won't let us attach.
  const externalAlive = !isOurs && session.alive;

  const sendNow = async (input: {
    sessionId: string;
    prompt: string;
    cwd: string;
    agent?: string | null;
    model?: string | null;
    permissionMode?: import('@shared/types').PermissionMode | null;
  }) => {
    // Rely on the jsonl tail for ALL message rendering. Optimistic UI was
    // causing duplicated bubbles when dedupe text-matching missed a case
    // (slash commands, attachments, claude internal re-write). jsonl tail
    // is fast enough — the message appears within ~500ms of send.
    stickToBottomRef.current = true;
    await window.av.sessions.sendMessage({
      sessionId: input.sessionId,
      prompt: input.prompt,
      cwd: input.cwd || session.cwd,
      agent: input.agent ?? session.agent ?? null,
      model: input.model ?? null,
      permissionMode: input.permissionMode ?? null
    });
  };

  const onSend = async (input: {
    sessionId: string;
    prompt: string;
    cwd: string;
    agent?: string | null;
    model?: string | null;
    permissionMode?: import('@shared/types').PermissionMode | null;
  }) => {
    // Always send immediately — even if the agent is currently busy. The
    // daemon attach (ptySock frame protocol) types the message into claude's
    // TUI input buffer; claude reads it as soon as its current turn allows.
    // Previously we queued and auto-flushed on idle, which felt laggy —
    // user explicitly asked for "에이전트에 즉시 입력".
    await sendNow(input);
  };

  // Queue is now legacy — onSend always sends immediately. Drain any
  // pre-existing queued items on mount or whenever the queue changes by
  // firing them right away so they don't sit forever.
  useEffect(() => {
    if (!queue || queue.length === 0) return;
    if (!onQueueChange) return;
    const next = queue[0];
    onQueueChange((prev) => prev.slice(1));
    const finalPrompt = appendAttachmentsToPrompt(next.prompt, next.attachments);
    sendNow({
      sessionId: session.sessionId,
      prompt: finalPrompt,
      cwd: session.cwd
    }).catch((err) => {
      console.error('[queue] send failed', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.length]);

  // Rename state — persisted in localStorage so the override survives reloads.
  // We don't write back to the meta file because (a) some sessions don't have
  // one and (b) it's owned by claude itself.
  const [renames, setRenames] = useState<Record<string, string>>(() => loadRenames());
  const overrideName = renames[session.sessionId];
  const displayName =
    overrideName || session.name || session.agent || session.sessionId.slice(0, 8);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(displayName);
  useEffect(() => {
    if (!editingName) setDraftName(displayName);
  }, [displayName, editingName]);
  const commitRename = () => {
    const next = draftName.trim();
    saveRename(session.sessionId, next || null);
    setRenames(loadRenames());
    setEditingName(false);
    // Push the new title into the underlying job's state.json so
    // `claude agents` in the CLI shows the same name. Best-effort —
    // failures here do not undo the local rename.
    window.av.sessions
      .renameJob(session.sessionId, next || null)
      .catch((err) => console.error('[rename] CLI sync failed', err));
  };

  // Pick the most informative model label we can: the one from the latest
  // assistant message (matches what claude actually used), falling back to
  // a short tag from the meta if we haven't seen an assistant turn yet.
  const modelLabel = turnInfo.model || data?.meta.agentSetting || null;

  const [forking, setForking] = useState(false);
  const onForkClick = async () => {
    if (forking) return;
    const prompt = window.prompt(
      '새 분기 세션의 첫 메시지를 입력하세요. (원본 대화 컨텍스트는 그대로 이어집니다.)',
      ''
    );
    if (!prompt || !prompt.trim()) return;
    setForking(true);
    try {
      const res = await window.av.sessions.fork({
        sessionId: session.sessionId,
        prompt: prompt.trim(),
        cwd: session.cwd,
        agent: session.agent ?? null,
        model: null
      });
      if (res.sessionId && onForked) onForked(session.sessionId, res.sessionId);
    } finally {
      setForking(false);
    }
  };

  return (
    <div className="detail-page">
      <header className="detail-head">
        <button className="btn sm" onClick={onBack} title="에이전트 목록으로">
          ← 뒤로
        </button>
        <div className="title">
          {editingName ? (
            <input
              autoFocus
              className="title-edit"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingName(false);
                  setDraftName(displayName);
                }
              }}
            />
          ) : (
            <h3 className="title-name">
              <span
                className="title-text"
                title="클릭해서 이름 변경"
                onClick={() => setEditingName(true)}
              >
                {displayName}
              </span>
              <button
                type="button"
                className="title-edit-btn"
                onClick={() => setEditingName(true)}
                title="세션 이름 변경"
                aria-label="세션 이름 변경"
              >
                ✎
              </button>
              {overrideName && (
                <button
                  type="button"
                  className="title-edit-btn"
                  onClick={() => {
                    saveRename(session.sessionId, null);
                    setRenames(loadRenames());
                    window.av.sessions
                      .renameJob(session.sessionId, null)
                      .catch(() => undefined);
                  }}
                  title="원래 이름으로 되돌리기"
                  aria-label="이름 초기화"
                >
                  ↺
                </button>
              )}
            </h3>
          )}
          <div className="meta-row">
            <span className={`status-tag ${session.status}`}>{statusLabel(session)}</span>
            {data?.meta?.permissionMode && (
              <button
                type="button"
                className="perm-tag clickable"
                title="권한 모드 (다음 메시지부터 적용)"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setPermDropdownOpen((v) => !v)}
              >
                🛡 {permLabel(data.meta.permissionMode as string)}
                <span className="caret">▾</span>
              </button>
            )}
            {permDropdownOpen && (
              <div className="badge-dropdown" role="menu" onMouseDown={(e) => e.stopPropagation()}>
                {(['bypassPermissions','acceptEdits','default','plan'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      setPermDropdownOpen(false);
                      try {
                        await window.av.sessions.setPermission(session.sessionId, m);
                        setBadgeToast('권한이 다음 메시지부터 적용됩니다.');
                      } catch {/* ignore */}
                    }}
                  >{permLabel(m)}</button>
                ))}
              </div>
            )}
            {modelLabel && (
              <button
                type="button"
                className="model-tag clickable"
                title="모델 (다음 메시지부터 적용)"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setModelDropdownOpen((v) => !v)}
              >
                🧠 {modelLabel}
                <span className="caret">▾</span>
              </button>
            )}
            {modelDropdownOpen && (
              <div className="badge-dropdown" role="menu" onMouseDown={(e) => e.stopPropagation()}>
                {(['opus','sonnet','haiku'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      setModelDropdownOpen(false);
                      try {
                        await window.av.sessions.setModel(session.sessionId, m);
                        setBadgeToast('모델이 다음 메시지부터 적용됩니다.');
                      } catch {/* ignore */}
                    }}
                  >{m}</button>
                ))}
              </div>
            )}
            <button
              ref={contextBtnRef}
              type="button"
              className="context-donut"
              onClick={() => setContextPanelOpen((v) => !v)}
              aria-expanded={contextPanelOpen}
              aria-label="컨텍스트 사용량 보기"
              title={`컨텍스트 ${formatTokens(contextUsed)} / ${formatTokens(contextWindow)} (${contextPct}%)`}
            >
              <ContextDonut percent={contextPct} />
            </button>
            <span title={session.cwd}>{session.cwd}</span>
            <button
              type="button"
              className={`filter-toggle ${onlyMine ? 'on' : ''}`}
              title="내 메시지만 보기"
              onClick={() => {
                const next = !onlyMine;
                setOnlyMine(next);
                saveJSON('view.onlyMine.' + session.sessionId, next);
              }}
            >
              👤 내 메시지만
            </button>
          </div>
          {badgeToast && (
            <div className="badge-toast" role="status">{badgeToast}</div>
          )}
          {session.status === 'crashed' && !crashDismissed && (
            <div className="crash-banner" role="alert">
              <span>⚠ 에이전트가 비정상 종료되었습니다. 마지막 응답을 확인하세요.</span>
              <button type="button" className="x" onClick={() => setCrashDismissed(true)} aria-label="닫기">×</button>
            </div>
          )}
          {goalText && (
            <div className={`goal-row ${goalDone ? 'completed' : ''}`}>
              <input
                type="checkbox"
                checked={goalDone}
                onChange={(e) => {
                  setGoalDone(e.target.checked);
                  saveJSON('goal.done.' + session.sessionId, e.target.checked);
                }}
                aria-label="목표 완료"
              />
              <span className="goal-text">🎯 {goalText}</span>
            </div>
          )}
          {contextPanelOpen && (
            <>
              <div
                className="context-popup-backdrop"
                onClick={() => setContextPanelOpen(false)}
                aria-hidden="true"
              />
              <div className="context-popup" role="dialog" aria-label="컨텍스트 사용량" style={contextPanelPos ? { top: contextPanelPos.top, left: contextPanelPos.left, right: 'auto' } : undefined}>
                <div className="context-popup-head">
                  <span className="context-popup-title">컨텍스트 사용량</span>
                  <button
                    type="button"
                    className="context-popup-close"
                    onClick={() => setContextPanelOpen(false)}
                    aria-label="닫기"
                  >×</button>
                </div>
                <div className="context-row context-row-head">
                  <span className="context-row-label">사용 중</span>
                  <span className="context-row-value">
                    <strong>{formatTokens(contextUsed)}</strong>
                    {' / '}
                    {formatTokens(contextWindow)}{' '}
                    <span className="context-row-pct">({contextPct}%)</span>
                  </span>
                </div>
                <div className="context-bar context-bar-large">
                  <div
                    className="context-bar-fill"
                    style={{ width: `${contextPct}%` }}
                  />
                </div>
                <div className="context-row">
                  <span className="context-row-label">남은 컨텍스트</span>
                  <span className="context-row-value">
                    <strong style={{ color: 'var(--running)' }}>
                      {formatTokens(Math.max(0, contextWindow - contextUsed))}
                    </strong>{' '}
                    <span className="context-row-pct">({Math.max(0, 100 - contextPct)}%)</span>
                  </span>
                </div>
                <div className="context-row context-row-foot">
                  <span className="context-row-label">5시간 제한</span>
                  <span className="context-row-value">
                    {usage?.fiveHour ? (
                      <>
                        <strong>{usage.fiveHour.pct}%</strong>
                        {usage.fiveHour.resetIn && (
                          <span className="context-row-pct"> · {usage.fiveHour.resetIn} 초기화</span>
                        )}
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
                        {usage ? '측정 불가' : '불러오는 중…'}
                      </span>
                    )}
                  </span>
                </div>
                {usage?.fiveHour && (
                  <div className="context-bar" style={{ marginBottom: 2 }}>
                    <div className="context-bar-fill" style={{ width: `${Math.min(100, usage.fiveHour.pct)}%` }} />
                  </div>
                )}
                <div className="context-row">
                  <span className="context-row-label">주간 한도</span>
                  <span className="context-row-value">
                    {usage?.weekly ? (
                      <>
                        <strong>{usage.weekly.pct}%</strong>
                        {usage.weekly.resetIn && (
                          <span className="context-row-pct"> · {usage.weekly.resetIn} 초기화</span>
                        )}
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
                        {usage ? '측정 불가' : '불러오는 중…'}
                      </span>
                    )}
                  </span>
                </div>
                {usage?.weekly && (
                  <div className="context-bar" style={{ marginBottom: 4 }}>
                    <div className="context-bar-fill" style={{ width: `${Math.min(100, usage.weekly.pct)}%` }} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="detail-body" ref={bodyRef} onScroll={onBodyScroll}>
        {loading && <div className="empty-detail">대화 로드 중…</div>}
        {!loading && !data && (
          <div className="empty-detail">
            <div className="icon">{session.alive ? '⏳' : '💬'}</div>
            <div>
              {session.alive
                ? '세션 부팅 중입니다. 대화 로그 파일이 곧 생성됩니다…'
                : '이 세션에 대한 대화 로그를 찾지 못했습니다.'}
            </div>
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>
              세션 ID: {session.sessionId}
            </div>
          </div>
        )}
        {!loading && data && data.messages.length === 0 && (
          <div className="empty-detail">
            <div className="icon">📭</div>
            <div>아직 메시지가 없습니다. 아래에 입력하면 에이전트가 작업을 시작합니다.</div>
          </div>
        )}
        {!loading && data && data.messages.length > 0 && (
          <div className="conv">
            {data.truncated && (
              <div className="msg meta">
                <div className="avatar">…</div>
                <div className="bubble">
                  <div className="content">이전 메시지가 너무 많아 최근 일부만 표시합니다.</div>
                </div>
              </div>
            )}
            {renderMessages(data.messages, freshIds, session.sessionId, (prompt) =>
              sendNow({
                sessionId: session.sessionId,
                prompt,
                cwd: session.cwd,
                agent: session.agent ?? null,
                model: null
              })
            )}
            {pendingPrompt && (
              <div className="msg permission">
                <div className="avatar">⚠</div>
                <div className="bubble permission-bubble">
                  <div className="role-line">권한 요청</div>
                  <div className="permission-question">{pendingPrompt.question}</div>
                  <div className="permission-options">
                    {pendingPrompt.options.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        className="btn permission-option"
                        disabled={answering}
                        onClick={() => onAnswerPrompt(o.key)}
                      >
                        <span className="permission-key">{o.key}</span>
                        <span>{o.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="permission-hint">
                    선택지를 클릭하면 에이전트에 즉시 전송됩니다 (Esc 키는 우측 ⏹ 중지 버튼).
                  </div>
                </div>
              </div>
            )}
            {busy && (
              <div className="msg assistant">
                <div className="avatar">AI</div>
                <div className="bubble fresh thinking-bubble">
                  <div className="role-line">에이전트</div>
                  <div className="content thinking-line">
                    <span className="thinking-dots"><span /><span /><span /></span>
                    {turnInfo.currentTool ? (
                      <>
                        <strong className="thinking-action">
                          🔧 {turnInfo.currentTool.name}
                        </strong>
                        <span className="thinking-meta">실행 중</span>
                      </>
                    ) : (
                      '작업 중'
                    )}
                    {elapsedLabel && <span className="thinking-meta">· {elapsedLabel}</span>}
                    {totalTokens > 0 && (
                      <span className="thinking-meta">
                        · {formatTokens(totalTokens)} tokens
                      </span>
                    )}
                  </div>
                  {turnInfo.currentTool?.summary && (
                    <div className="thinking-sub">
                      <span className="thinking-sub-label">대상:</span>{' '}
                      {turnInfo.currentTool.summary}
                    </div>
                  )}
                  {turnInfo.recentAssistantText && (
                    <div className="thinking-sub thinking-sub-text">
                      <span className="thinking-sub-label">최근 출력:</span>{' '}
                      {turnInfo.recentAssistantText}
                    </div>
                  )}
                </div>
              </div>
            )}
            {queue.map((item) => (
              <QueuedBubble
                key={item.id}
                item={item}
                onRemove={() => {
                  if (!onQueueChange) return;
                  onQueueChange((prev) => prev.filter((q) => q.id !== item.id));
                  // Restore the recalled message back into the composer.
                  if (onDraftChange) {
                    const baseDraft = draft ?? { prompt: '', attachments: [] };
                    onDraftChange({
                      prompt: baseDraft.prompt
                        ? `${item.prompt}\n${baseDraft.prompt}`
                        : item.prompt,
                      attachments: [
                        ...new Set([...item.attachments, ...baseDraft.attachments])
                      ]
                    });
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {busy && (
        <div className="cli-status-bar" role="status" aria-live="polite">
          <span className="cli-status-asterisk">*</span>
          <span className="cli-status-verb">{cliVerb}</span>
          <span className="cli-status-paren">(
            {elapsedLabel && <span className="cli-status-elapsed">{elapsedLabel}</span>}
            {totalTokens > 0 && (
              <>
                <span className="cli-status-sep"> · </span>
                <span className="cli-status-tokens">↑ {formatTokens(totalTokens)} tokens</span>
              </>
            )}
            {turnInfo.currentTool?.name && (
              <>
                <span className="cli-status-sep"> · </span>
                <span className="cli-status-hint">{turnInfo.currentTool.name}</span>
              </>
            )}
          )</span>
        </div>
      )}

      {pendingAsk && (
        <div className="ask-panel" role="dialog" aria-label="에이전트 질문">
          <div className="ask-panel-head">
            <span className="ask-panel-icon">❓</span>
            <span className="ask-panel-title">에이전트의 질문</span>
            <span className="ask-panel-hint">선택 후 '에이전트에 전송' 버튼을 누르세요</span>
          </div>
          {pendingAsk.questions.map((q, qi) => {
            const multi = !!q.multiSelect;
            const sel = askSelections[qi];
            const isSelected = (label: string) =>
              Array.isArray(sel) ? sel.includes(label) : sel === label;
            return (
              <div className="ask-panel-q" key={qi}>
                {q.header && <div className="ask-panel-header">{q.header}</div>}
                <div className="ask-panel-question">
                  {q.question}
                  {multi && (
                    <span className="ask-panel-multi-badge">중복 선택 가능</span>
                  )}
                </div>
                {q.options && q.options.length > 0 && (
                  <div className="ask-panel-options">
                    {q.options.map((o, oi) => (
                      <button
                        key={oi}
                        type="button"
                        className={`ask-panel-option ${isSelected(o.label) ? 'selected' : ''}`}
                        disabled={submittingAsk}
                        tabIndex={-1}
                        onClick={() => toggleAskOption(qi, o.label, multi)}
                        onKeyDown={(e) => {
                          // Prevent Enter / Space from selecting an option —
                          // user reports Enter on composer accidentally
                          // toggles a focused ask option.
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        aria-pressed={isSelected(o.label)}
                      >
                        <span className="ask-panel-key">{isSelected(o.label) ? '✓' : oi + 1}</span>
                        <span className="ask-panel-option-body">
                          <strong>{o.label}</strong>
                          {o.description && (
                            <span className="ask-panel-desc">{o.description}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="ask-panel-submit-row">
            <button
              type="button"
              className="btn primary ask-panel-submit"
              disabled={submittingAsk || !allAskAnswered}
              tabIndex={-1}
              onClick={onSubmitAsk}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              {submittingAsk ? '전송 중…' : '↗ 에이전트에 전송'}
            </button>
          </div>
        </div>
      )}

      <InputBar
        mode="resume"
        sessionId={session.sessionId}
        fixedCwd={session.cwd}
        fixedAgent={session.agent ?? null}
        fixedModel={null}
        agents={agents}
        defaultCwd={session.cwd}
        compact
        busy={busy}
        draft={draft}
        onDraftChange={onDraftChange}
        onSend={onSend}
        onCancel={async () => {
          await window.av.sessions.cancel(session.sessionId);
        }}
        placeholder={
          externalAlive
            ? '외부 에이전트에 직접 전송. Ctrl+Enter.'
            : '이 에이전트에 이어서 보낼 메시지. Ctrl+Enter.'
        }
      />
    </div>
  );
}
