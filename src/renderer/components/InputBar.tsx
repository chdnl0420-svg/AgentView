import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentInfo,
  GitBranchesResult,
  NewSessionInput,
  PermissionMode,
  ResumeMessageInput,
  SessionBackend,
  SlashCommandEntry
} from '@shared/types';
import { shortCwd } from '../lib/format';
import { appendAttachmentsToPrompt } from '../lib/attachments';
import {
  ENTER_TO_SEND_KEY,
  draftKey,
  loadHistory,
  loadJSON,
  pushHistory,
  saveJSON
} from '../lib/persistence';
import { AttachmentChip } from './AttachmentChip';
import {
  BACKENDS,
  DEFAULT_PERM,
  LAST_BACKEND_KEY,
  LAST_CWD_KEY,
  LAST_MODEL_KEY,
  LAST_PERM_KEY,
  MODELS,
  NEW_BRANCH_SENTINEL,
  PERMS,
  WT_BASE_BRANCH_KEY,
  WT_ENABLED_KEY,
  isValidBranchName,
  loadLastBackend,
  loadLastCwd,
  loadLastModel,
  loadLastPerm
} from './InputBarConstants';

export interface InputDraft {
  prompt: string;
  attachments: string[];
}

interface BaseProps {
  agents: AgentInfo[];
  defaultCwd: string;
  compact?: boolean;
  busy?: boolean;
  placeholder?: string;
  buttonLabel?: string;
  onCancel?: () => void | Promise<void>;
  /** Optional controlled draft so the parent can persist it across mount cycles. */
  draft?: InputDraft;
  onDraftChange?: (draft: InputDraft) => void;
  /** localStorage key for command history (most-recent first). */
  historyKey?: string;
}

interface NewProps extends BaseProps {
  mode: 'new';
  onSend: (input: NewSessionInput) => Promise<void> | void;
}

interface ResumeProps extends BaseProps {
  mode: 'resume';
  sessionId: string;
  fixedCwd: string;
  fixedAgent?: string | null;
  fixedModel?: string | null;
  onSend: (input: ResumeMessageInput) => Promise<void> | void;
}

type InputBarProps = NewProps | ResumeProps;

export function InputBar(props: InputBarProps) {
  const isNew = props.mode === 'new';
  // History key drives both the ArrowUp/Down history list AND the autosaved
  // draft. We need it BEFORE the prompt/attachments useState so the initial
  // value can come from persisted state when the parent didn't pass a draft.
  const historyKey = props.historyKey ?? (isNew ? 'new' : `s.${(props as ResumeProps).sessionId}`);

  // Initial draft resolution priority:
  //   1. props.draft (parent-controlled)
  //   2. persisted draft.<historyKey>
  //   3. empty
  // We do this lazily inside useState so it only runs once per mount.
  const [prompt, setPromptState] = useState<string>(() => {
    if (props.draft && typeof props.draft.prompt === 'string') return props.draft.prompt;
    const persisted = loadJSON<{ prompt?: string; attachments?: string[] } | null>(
      draftKey(historyKey),
      null
    );
    return persisted && typeof persisted.prompt === 'string' ? persisted.prompt : '';
  });
  const [cwd, setCwdState] = useState(
    isNew ? loadLastCwd(props.defaultCwd) : props.fixedCwd
  );
  // Persist the user's working-folder choice so it survives both parent
  // re-renders (which used to clobber it through a useEffect) and full app
  // restarts. Only meaningful in `new` mode — resume mode is locked to the
  // session's own cwd.
  const setCwd = useCallback(
    (next: string) => {
      setCwdState(next);
      if (isNew) saveJSON(LAST_CWD_KEY, next);
    },
    [isNew]
  );
  const [agent, setAgent] = useState<string>(isNew ? '' : props.fixedAgent ?? '');
  const [backend, setBackendState] = useState<SessionBackend>(() =>
    isNew ? loadLastBackend() : 'claude'
  );
  const [model, setModel] = useState<string>(() => {
    if (!isNew && props.fixedModel) return props.fixedModel;
    return loadLastModel();
  });
  const [attachments, setAttachmentsState] = useState<string[]>(() => {
    if (props.draft && Array.isArray(props.draft.attachments)) return props.draft.attachments;
    const persisted = loadJSON<{ prompt?: string; attachments?: string[] } | null>(
      draftKey(historyKey),
      null
    );
    return persisted && Array.isArray(persisted.attachments) ? persisted.attachments : [];
  });
  const [sending, setSending] = useState(false);
  const sendingLockRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const lastSentRef = useRef<{ prompt: string; attachments: string[] } | null>(null);

  // Persist model choice whenever the user changes it.
  const onModelChange = useCallback((v: string) => {
    setModel(v);
    if (v) saveJSON(LAST_MODEL_KEY, v);
  }, []);

  // Permission mode — same persistence pattern as model. The user explicitly
  // requested that the last selection comes back next launch.
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(() =>
    loadLastPerm()
  );
  const onPermissionChange = useCallback((v: PermissionMode) => {
    setPermissionModeState(v);
    saveJSON(LAST_PERM_KEY, v);
  }, []);

  // Worktree settings (new mode only). Checkbox enables the worktree spawn,
  // and the select picks the base branch the new worktree is forked from
  // (defaults to the current branch). Worktree path itself is still derived.
  const [wtEnabled, setWtEnabledState] = useState<boolean>(() =>
    isNew ? loadJSON<boolean>(WT_ENABLED_KEY, false) : false
  );
  const [wtBaseBranch, setWtBaseBranchState] = useState<string>(() =>
    isNew ? loadJSON<string>(WT_BASE_BRANCH_KEY, '') : ''
  );
  const [newBranchEditing, setNewBranchEditing] = useState(false);
  const [newBranchDraft, setNewBranchDraft] = useState('');
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [branchInfo, setBranchInfo] = useState<GitBranchesResult | null>(null);

  const setBackend = useCallback((v: SessionBackend) => {
    setBackendState(v);
    if (isNew) saveJSON(LAST_BACKEND_KEY, v);
    window.dispatchEvent(new CustomEvent('agentview:backend-changed', { detail: v }));
    if (v !== 'claude') setAgent('');
  }, [isNew]);

  const setWtEnabled = useCallback((v: boolean) => {
    setWtEnabledState(v);
    saveJSON(WT_ENABLED_KEY, v);
  }, []);
  const setWtBaseBranch = useCallback((v: string) => {
    setWtBaseBranchState(v);
    saveJSON(WT_BASE_BRANCH_KEY, v);
  }, []);

  // Whenever branch info refreshes, snap the selected base branch to the
  // current branch if the user hasn't picked one yet (or their saved choice
  // no longer exists in this repo).
  useEffect(() => {
    if (!branchInfo?.isRepo) return;
    const valid =
      wtBaseBranch === NEW_BRANCH_SENTINEL ||
      (wtBaseBranch && branchInfo.branches.includes(wtBaseBranch));
    if (!valid) {
      const fallback = branchInfo.current || branchInfo.branches[0] || '';
      if (fallback) setWtBaseBranchState(fallback);
    }
  }, [branchInfo, wtBaseBranch]);

  // Refresh branch list whenever the new-mode cwd changes — we still need
  // to know whether cwd is inside a git repo so we can enable/disable the
  // worktree checkbox.
  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    window.av.git
      .branches(cwd || props.defaultCwd)
      .then((info) => {
        if (!cancelled) setBranchInfo(info);
      })
      .catch(() => {
        if (!cancelled) setBranchInfo({ isRepo: false, current: '', branches: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [isNew, cwd, props.defaultCwd]);

  // When the agent flips back to idle, clear the cancelling spinner so the
  // user gets visual confirmation that the stop took effect.
  useEffect(() => {
    if (!props.busy) setCancelling(false);
  }, [props.busy]);

  useEffect(() => {
    if (!cancelling) return;
    const id = window.setTimeout(() => setCancelling(false), 12000);
    return () => window.clearTimeout(id);
  }, [cancelling]);

  // Wrap state setters so the parent always sees the latest draft AND we
  // synchronously persist to localStorage under `draft.<historyKey>`. This
  // means even if the app is killed (not gracefully closed), the user's
  // half-typed message comes back next launch.
  const onDraftChange = props.onDraftChange;
  const setPrompt = useCallback(
    (val: React.SetStateAction<string>) => {
      setPromptState((prev) => {
        const next = typeof val === 'function' ? (val as (p: string) => string)(prev) : val;
        if (onDraftChange) onDraftChange({ prompt: next, attachments });
        saveJSON(draftKey(historyKey), { prompt: next, attachments });
        return next;
      });
    },
    [onDraftChange, attachments, historyKey]
  );
  const setAttachments = useCallback(
    (val: React.SetStateAction<string[]>) => {
      setAttachmentsState((prev) => {
        const next = typeof val === 'function' ? (val as (p: string[]) => string[])(prev) : val;
        if (onDraftChange) onDraftChange({ prompt, attachments: next });
        saveJSON(draftKey(historyKey), { prompt, attachments: next });
        return next;
      });
    },
    [onDraftChange, prompt, historyKey]
  );
  const [commands, setCommands] = useState<SlashCommandEntry[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFocus, setSlashFocus] = useState(0);
  const [caret, setCaret] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // History navigation (ArrowUp / ArrowDown). historyIdx === -1 means we're
  // editing a fresh draft; >=0 means we're showing history[idx]. The
  // `historyKey` constant lives at the top of the component because the
  // initial prompt/attachments state also depends on it.
  const [history, setHistory] = useState<string[]>(() => loadHistory(historyKey));
  const [historyIdx, setHistoryIdx] = useState(-1);
  const draftBeforeHistoryRef = useRef('');

  // Reload history when the bar mounts / sessionId changes.
  useEffect(() => {
    setHistory(loadHistory(historyKey));
    setHistoryIdx(-1);
  }, [historyKey]);

  // "Enter to send" preference. Default off (Ctrl/Meta+Enter sends). We
  // listen on `storage` (cross-tab/cross-window) AND a custom `opt:enterToSend`
  // window event so a settings panel elsewhere can publish changes without
  // forcing a full reload.
  const [enterToSend, setEnterToSend] = useState<boolean>(() =>
    loadJSON<boolean>(ENTER_TO_SEND_KEY, false)
  );
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.endsWith(ENTER_TO_SEND_KEY)) {
        setEnterToSend(loadJSON<boolean>(ENTER_TO_SEND_KEY, false));
      }
    };
    const onCustom = () => {
      setEnterToSend(loadJSON<boolean>(ENTER_TO_SEND_KEY, false));
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('opt:enterToSend', onCustom as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('opt:enterToSend', onCustom as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.av.commands.list().then((list) => {
      if (!cancelled) setCommands(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Track whether the user has explicitly picked a model in this session.
  // Once they have, we never overwrite their choice with the session's
  // historical model field (which would silently discard their selection).
  const userPickedModelRef = useRef(false);
  const wrappedOnModelChange = useCallback((v: string) => {
    userPickedModelRef.current = true;
    onModelChange(v);
  }, [onModelChange]);
  useEffect(() => {
    if (!isNew) {
      setCwd(props.fixedCwd);
      setAgent(props.fixedAgent ?? '');
      if (props.fixedModel && !userPickedModelRef.current) {
        setModel(props.fixedModel);
      }
    }
  }, [
    isNew,
    (!isNew && props.fixedCwd) || '',
    (!isNew && (props.fixedAgent ?? '')) || '',
    (!isNew && (props.fixedModel ?? '')) || ''
  ]);

  const disabled = sending;

  const addAttachments = async () => {
    const picked = await window.av.picker.files(isNew ? props.defaultCwd : props.fixedCwd);
    if (picked.length === 0) return;
    setAttachments((prev) => {
      const seen = new Set(prev);
      const next = [...prev];
      for (const p of picked) if (!seen.has(p)) next.push(p);
      return next;
    });
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const explorerFiles: Array<File & { path?: string }> = [];
    if (cd.files && cd.files.length > 0) {
      for (let i = 0; i < cd.files.length; i++) {
        explorerFiles.push(cd.files[i] as File & { path?: string });
      }
    }
    const items = cd.items;
    const imageItems: DataTransferItem[] = [];
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
          imageItems.push(items[i]);
        }
      }
    }
    if (explorerFiles.length === 0 && imageItems.length === 0) return;
    e.preventDefault();

    const newPaths: string[] = [];

    for (const f of explorerFiles) {
      if (f.path && f.path.trim()) {
        newPaths.push(f.path);
      } else if (f.type.startsWith('image/')) {
        const buf = await f.arrayBuffer();
        const ext = (f.type.split('/')[1] || 'png').toLowerCase().split(';')[0];
        const saved = await window.av.picker.savePastedImage(buf, ext);
        if (saved) newPaths.push(saved);
      }
    }
    for (const item of imageItems) {
      const file = item.getAsFile() as (File & { path?: string }) | null;
      if (!file) continue;
      if (file.path && newPaths.includes(file.path)) continue;
      if (file.path && file.path.trim()) {
        if (!newPaths.includes(file.path)) newPaths.push(file.path);
        continue;
      }
      const buf = await file.arrayBuffer();
      const ext = (file.type.split('/')[1] || 'png').toLowerCase().split(';')[0];
      const saved = await window.av.picker.savePastedImage(buf, ext);
      if (saved) newPaths.push(saved);
    }

    if (newPaths.length > 0) {
      setAttachments((prev) => {
        const seen = new Set(prev);
        const next = [...prev];
        for (const p of newPaths) if (!seen.has(p)) next.push(p);
        return next;
      });
    }
  };

  const removeAttachment = (path: string) => {
    setAttachments((prev) => prev.filter((p) => p !== path));
  };

  const send = async () => {
    const trimmed = prompt.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    if (sendingLockRef.current) return;
    sendingLockRef.current = true;
    setSending(true);
    try {
      const finalPrompt = appendAttachmentsToPrompt(trimmed, attachments);
      if (isNew) {
        // Worktree mode race guard (#23): wtEnabled loads synchronously from
        // localStorage but branchInfo is fetched async. If the user hits
        // send before the first branch fetch finishes we'd silently fall
        // back to wtOn=false. Retry once (1s budget) before giving up.
        let effectiveBranchInfo: GitBranchesResult | null = branchInfo;
        if (wtEnabled && effectiveBranchInfo === null) {
          try {
            effectiveBranchInfo = await Promise.race([
              window.av.git.branches(cwd || props.defaultCwd),
              new Promise<GitBranchesResult>((resolve) =>
                setTimeout(
                  () => resolve({ isRepo: false, current: '', branches: [] }),
                  1000
                )
              )
            ]);
            if (effectiveBranchInfo) setBranchInfo(effectiveBranchInfo);
          } catch {
            effectiveBranchInfo = { isRepo: false, current: '', branches: [] };
          }
        }
        // Worktree mode: enabled when the checkbox is on AND the cwd is a
        // git repo. Branch + path are derived automatically — current branch
        // as base, a fresh `<repo>-wt-agent-<n>` sibling path.
        const wtOn = wtEnabled && !!effectiveBranchInfo?.isRepo;
        let worktreePath: string | null = null;
        let baseBranch: string | null = null;
        let finalNewBranch: string | null = null;
        if (wtOn) {
          const branchFromInput = (newBranch || '').trim();
          if (branchFromInput && !isValidBranchName(branchFromInput)) {
            alert('새 브랜치 이름에 사용할 수 없는 문자가 있습니다.');
            return;
          }
          finalNewBranch = branchFromInput || null;
          baseBranch =
            (wtBaseBranch &&
            wtBaseBranch !== NEW_BRANCH_SENTINEL &&
            effectiveBranchInfo!.branches.includes(wtBaseBranch)
              ? wtBaseBranch
              : effectiveBranchInfo!.current) ||
            effectiveBranchInfo!.branches[0] ||
            'HEAD';
          try {
            worktreePath = await window.av.git.defaultWorktreePath(
              cwd.trim() || props.defaultCwd,
              'agent'
            );
          } catch {
            worktreePath = null;
          }
          if (!worktreePath) {
            alert('워크트리 경로를 자동으로 결정하지 못했습니다.');
            return;
          }
        }
        await props.onSend({
          prompt: finalPrompt,
          cwd: cwd.trim() || props.defaultCwd,
          agent: backend === 'claude' ? agent || null : null,
          backend,
          model: model || null,
          name: null,
          permissionMode,
          worktreePath,
          baseBranch,
          newBranch: finalNewBranch
        });
      } else {
        await props.onSend({
          sessionId: props.sessionId,
          prompt: finalPrompt,
          cwd: cwd || props.fixedCwd,
          agent: agent || props.fixedAgent || null,
          model: model || props.fixedModel || null,
          permissionMode
        });
      }
      lastSentRef.current = { prompt: trimmed, attachments: [...attachments] };
      // Push into history so ArrowUp finds it next time. Only the text portion
      // — attachments come back via the attachment chips on the last message.
      if (trimmed) {
        const next = pushHistory(historyKey, trimmed);
        setHistory(next);
      }
      setPromptState('');
      setAttachmentsState([]);
      setHistoryIdx(-1);
      if (onDraftChange) onDraftChange({ prompt: '', attachments: [] });
      // Clear the autosaved draft so a restarted app doesn't restore
      // text the user has already sent.
      saveJSON(draftKey(historyKey), null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, ''));
    } finally {
      setSending(false);
      sendingLockRef.current = false;
    }
  };

  const pickDir = async () => {
    if (!isNew) return;
    const picked = await window.av.picker.directory(cwd || props.defaultCwd);
    if (picked) setCwd(picked);
  };

  const showRich = !(props.compact === true) && isNew;
  const hasInput = prompt.trim().length > 0 || attachments.length > 0;
  const canSend = !disabled && hasInput;
  const showCancelButton = !!props.busy && !hasInput && !!props.onCancel;

  const slashQuery = useMemo(() => {
    const pos = Math.min(caret, prompt.length);
    const before = prompt.slice(0, pos);
    const m = /(?:^|\s)\/([\w-]*)$/.exec(before);
    return m ? m[1] : null;
  }, [prompt, caret]);
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    return commands.filter((c) => c.name.toLowerCase().includes(q));
  }, [commands, slashQuery]);

  useEffect(() => {
    setSlashOpen(slashQuery !== null && slashMatches.length > 0);
    setSlashFocus(0);
  }, [slashQuery, slashMatches.length]);

  const acceptCommand = useCallback(
    (cmd: SlashCommandEntry) => {
      const ta = textareaRef.current;
      const insertion = '/' + cmd.name + ' ';
      const pos = ta ? ta.selectionStart ?? prompt.length : prompt.length;
      const before = prompt.slice(0, pos);
      const after = prompt.slice(pos);
      const m = /(?:^|\s)\/([\w-]*)$/.exec(before);
      let newBefore: string;
      if (m) {
        const tokenStart = before.length - (m[1].length + 1);
        newBefore = before.slice(0, tokenStart) + insertion;
      } else {
        newBefore = before + insertion;
      }
      const next = newBefore + after;
      setPrompt(next);
      setSlashOpen(false);
      const newCaret = newBefore.length;
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCaret, newCaret);
        }
        setCaret(newCaret);
      });
    },
    [prompt, setPrompt]
  );

  const syncCaret = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    setCaret(ta.selectionStart ?? 0);
  }, []);

  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!slashOpen) return;
    const el = slashItemRefs.current[slashFocus];
    el?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [slashFocus, slashOpen]);

  // Apply a history entry to the textarea and move caret to end so the user
  // can keep typing where they left off.
  const applyHistory = useCallback(
    (idx: number, text: string) => {
      setHistoryIdx(idx);
      setPrompt(text);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.setSelectionRange(text.length, text.length);
        setCaret(text.length);
      });
    },
    [setPrompt]
  );

  const navigateHistoryUp = useCallback(() => {
    if (history.length === 0) return false;
    if (historyIdx < 0) {
      draftBeforeHistoryRef.current = prompt;
      applyHistory(0, history[0]);
      return true;
    }
    if (historyIdx < history.length - 1) {
      applyHistory(historyIdx + 1, history[historyIdx + 1]);
      return true;
    }
    return false;
  }, [history, historyIdx, prompt, applyHistory]);

  const navigateHistoryDown = useCallback(() => {
    if (historyIdx <= 0) {
      if (historyIdx === 0) {
        setHistoryIdx(-1);
        setPrompt(draftBeforeHistoryRef.current);
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (!ta) return;
          const txt = draftBeforeHistoryRef.current;
          ta.setSelectionRange(txt.length, txt.length);
          setCaret(txt.length);
        });
        return true;
      }
      return false;
    }
    applyHistory(historyIdx - 1, history[historyIdx - 1]);
    return true;
  }, [history, historyIdx, applyHistory, setPrompt]);

  return (
    <div className="input-bar">
      {showRich && (
        <>
          <div className="input-controls">
            <div className="control">
              <label htmlFor="backend-select">백엔드</label>
              <select
                id="backend-select"
                value={backend}
                onChange={(e) => setBackend(e.target.value as SessionBackend)}
              >
                {BACKENDS.map((b) => (
                  <option key={b.value} value={b.value} title={b.hint}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            {backend === 'claude' && (
              <div className="control">
                <label htmlFor="agent-select">에이전트</label>
                <select id="agent-select" value={agent} onChange={(e) => setAgent(e.target.value)}>
                  <option value="">기본 (claude)</option>
                  {props.agents.map((a) => (
                    <option key={`${a.scope}:${a.name}`} value={a.name}>
                      {a.scope === 'project' ? '◆ ' : ''}{a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="control">
              <label htmlFor="model-select">모델</label>
              <select
                id="model-select"
                value={model}
                onChange={(e) => wrappedOnModelChange(e.target.value)}
              >
                {MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="control" title="claude 의 --permission-mode 플래그로 전달됩니다">
              <label htmlFor="perm-select">권한</label>
              <select
                id="perm-select"
                value={permissionMode}
                onChange={(e) => onPermissionChange(e.target.value as PermissionMode)}
                title={PERMS.find((p) => p.value === permissionMode)?.hint || ''}
              >
                {PERMS.map((p) => (
                  <option key={p.value} value={p.value} title={p.hint}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="control">
              <label>작업 폴더</label>
              <button type="button" className="cwd-pick" onClick={pickDir} title={cwd}>
                <span>📂</span>
                <span className="path">{shortCwd(cwd || props.defaultCwd, 56)}</span>
              </button>
            </div>
            <label
              className="wt-switch"
              title="체크하면 별도 워크트리에서 새 에이전트를 실행합니다. 선택한 브런치를 베이스로 새 워크트리를 만듭니다."
            >
              <input
                id="wt-toggle"
                type="checkbox"
                checked={wtEnabled}
                onChange={(e) => setWtEnabled(e.target.checked)}
                disabled={!branchInfo?.isRepo}
              />
              <span>
                {branchInfo?.isRepo ? '새 워크트리 사용' : '새 워크트리 사용 (git 저장소 아님)'}
              </span>
            </label>
            {wtEnabled && branchInfo?.isRepo && (
              <div className="control wt-base">
                <label htmlFor="wt-base-select">시작 브런치</label>
                {newBranchEditing ? (
                  <input
                    id="wt-base-select"
                    className="wt-new-branch"
                    value={newBranchDraft}
                    autoFocus
                    placeholder="새 브랜치 이름"
                    onChange={(e) => setNewBranchDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const next = newBranchDraft.trim();
                        if (!isValidBranchName(next)) {
                          alert('새 브랜치 이름에 사용할 수 없는 문자가 있습니다.');
                          return;
                        }
                        setNewBranch(next);
                        setWtBaseBranch(NEW_BRANCH_SENTINEL);
                        setNewBranchEditing(false);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setNewBranchEditing(false);
                        setNewBranchDraft(newBranch || '');
                        if (wtBaseBranch === NEW_BRANCH_SENTINEL) {
                          setWtBaseBranch(branchInfo.current || branchInfo.branches[0] || '');
                          setNewBranch(null);
                        }
                      }
                    }}
                  />
                ) : (
                  <select
                    id="wt-base-select"
                    value={wtBaseBranch}
                    onChange={(e) => {
                      if (e.target.value === NEW_BRANCH_SENTINEL) {
                        setNewBranchEditing(true);
                        setNewBranchDraft(newBranch || '');
                        setWtBaseBranch(NEW_BRANCH_SENTINEL);
                        return;
                      }
                      setNewBranch(null);
                      setWtBaseBranch(e.target.value);
                    }}
                    title="새 워크트리를 이 브런치 기반으로 생성합니다"
                  >
                    {!branchInfo.branches.includes(wtBaseBranch) &&
                      wtBaseBranch &&
                      wtBaseBranch !== NEW_BRANCH_SENTINEL && (
                        <option value={wtBaseBranch}>{wtBaseBranch}</option>
                      )}
                    {branchInfo.branches.map((b) => (
                      <option key={b} value={b}>
                        {b === branchInfo.current ? `${b}  (현재)` : b}
                      </option>
                    ))}
                    <option value={NEW_BRANCH_SENTINEL}>
                      {newBranch ? `+ 새 브랜치: ${newBranch}` : '+ 새 브랜치'}
                    </option>
                  </select>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* compact (resume) mode intentionally has no model/permission selects:
          claude locks both at spawn time. Changing them mid-session has no
          effect on the running agent, so the controls were removed to
          avoid the false impression that they take effect. New work begins
          on the dashboard composer where the selects DO apply. */}

      {attachments.length > 0 && (
        <div className="attachment-strip" data-testid="attachment-strip">
          {attachments.map((p) => (
            <AttachmentChip key={p} path={p} onRemove={() => removeAttachment(p)} />
          ))}
        </div>
      )}

      {slashOpen && (
        <div className="slash-popup" role="listbox">
          {slashMatches.map((c, i) => (
            <button
              key={`${c.scope}:${c.name}`}
              ref={(el) => {
                slashItemRefs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={i === slashFocus}
              className={`slash-item ${i === slashFocus ? 'focus' : ''}`}
              onMouseEnter={() => setSlashFocus(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptCommand(c);
              }}
            >
              <span className="slash-name">
                {c.scope === 'project' && <span className="slash-scope project">◆</span>}
                {c.scope === 'builtin' && <span className="slash-scope builtin">⚙</span>}
                /{c.name}
              </span>
              {c.description && <span className="slash-desc">{c.description}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="input-row">
        {/* Left column: small attachment button on top, mini history nav
            below. Stacking these vertically frees horizontal space for the
            textarea and matches the new compact composer layout. */}
        <div className="input-left-col">
          <button
            type="button"
            className="btn add-attach small"
            onClick={addAttachments}
            disabled={disabled}
            title="파일 첨부"
            aria-label="파일 첨부"
          >
            +
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="input-box"
          placeholder={
            props.placeholder ??
            (isNew
              ? `새 작업을 입력하세요 — ${
                  enterToSend ? 'Enter' : 'Ctrl+Enter'
                } 로 전송됩니다.`
              : `이 에이전트에 이어서 보낼 메시지 — ${
                  enterToSend ? 'Enter' : 'Ctrl+Enter'
                } 로 전송됩니다.`)
          }
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            // Any edit leaves history-navigation mode.
            if (historyIdx >= 0) setHistoryIdx(-1);
          }}
          onSelect={syncCaret}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (slashOpen) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashFocus((i) => (i + 1) % slashMatches.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashFocus((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey)) {
                const m = slashMatches[slashFocus];
                if (m) {
                  e.preventDefault();
                  acceptCommand(m);
                  return;
                }
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setSlashOpen(false);
                return;
              }
            }
            // Enter handling.
            //   enterToSend=true  → Enter sends, Shift+Enter newline.
            //   enterToSend=false → Ctrl/Meta+Enter sends, bare Enter newline.
            // Slash popup always wins (handled above) so command picking
            // still works in both modes.
            if (e.key === 'Enter') {
              if (enterToSend) {
                if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                  e.preventDefault();
                  send();
                  return;
                }
                // Shift+Enter falls through to default newline insertion.
              } else if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                send();
                return;
              }
            }
            // History navigation. Only fire when the caret sits on the first
            // (ArrowUp) or last (ArrowDown) visual line of the textarea so we
            // don't hijack normal multi-line navigation.
            if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              const ta = e.currentTarget;
              const pos = ta.selectionStart ?? 0;
              const onFirstLine = !ta.value.slice(0, pos).includes('\n');
              if (onFirstLine && history.length > 0) {
                if (navigateHistoryUp()) {
                  e.preventDefault();
                }
              }
              return;
            }
            if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              const ta = e.currentTarget;
              const pos = ta.selectionEnd ?? ta.value.length;
              const onLastLine = !ta.value.slice(pos).includes('\n');
              // historyIdx === -1 means we're already on the fresh draft;
              // there is nothing newer to navigate to, so swallow nothing
              // and let the default caret behavior run.
              if (onLastLine && historyIdx >= 0) {
                e.preventDefault();
                navigateHistoryDown();
              }
              return;
            }
          }}
          disabled={disabled}
          rows={2}
        />
        <div className="input-send">
          {showCancelButton ? (
            <button
              className="btn danger"
              onClick={() => {
                if (cancelling) return;
                setCancelling(true);
                const last = lastSentRef.current;
                if (last) {
                  setPromptState(last.prompt);
                  setAttachmentsState(last.attachments);
                  if (onDraftChange) {
                    onDraftChange({ prompt: last.prompt, attachments: last.attachments });
                  }
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }
                try {
                  Promise.resolve(props.onCancel?.()).catch(() => {
                    /* swallow */
                  });
                } catch {
                  setCancelling(false);
                }
              }}
              disabled={cancelling}
              title="에이전트의 현재 작업 중단 (ESC). 마지막 메시지가 입력창에 복원됩니다."
            >
              {cancelling ? '⌛ 중지 중…' : '⏹ 중지'}
            </button>
          ) : (
            <button className="btn primary" onClick={send} disabled={!canSend}>
              {sending ? '전송 중…' : (
                <>
                  {props.buttonLabel ?? '전송'}
                  <span className="btn-shortcut">{enterToSend ? 'Enter' : 'Ctrl+Enter'}</span>
                </>
              )}
            </button>
          )}
          <span className="hint">
            {showCancelButton
              ? '입력하면 전송으로 전환'
              : enterToSend
              ? 'Shift+Enter 줄바꿈 · ↑↓ 히스토리'
              : 'Enter 줄바꿈 · ↑↓ 히스토리'}
          </span>
        </div>
      </div>
    </div>
  );
}
