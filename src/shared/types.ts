export type SessionStatus =
  | 'running'
  | 'idle'
  | 'waiting'
  | 'finished'
  | 'crashed'
  | 'completed'
  | 'unknown';

/**
 * Which backend a Session is running on. Drives WorkerAdapter selection
 * in avd: `claude` = avd spawns claude CLI directly, `external-claude`
 * = avd routes through the existing ~/.claude/daemon, `codex` = avd
 * spawns codex CLI with --json. Defaults to 'claude' when absent so
 * pre-existing catalog entries keep working.
 */
export type BackendKind = 'claude' | 'external-claude' | 'codex';

export interface BgSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  version?: string;
  kind?: string;
  entrypoint?: string;
  name?: string;
  agent?: string;
  jobId?: string;
  status: SessionStatus;
  alive: boolean;
  metaPath: string;
  conversationPath: string | null;
  conversationSize: number;
  messageCount?: number;
  lastUserText?: string;
  lastAssistantText?: string;
  backend?: BackendKind;
}

export interface ScanSessionsResult {
  sessions: BgSession[];
  errors: { filePath: string; message: string }[];
  sessionsDir: string;
}

export interface ConversationMessage {
  uuid: string;
  parentUuid?: string;
  ts?: number;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'meta';
  kind: 'text' | 'tool_use' | 'tool_result' | 'meta';
  text: string;
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
  model?: string;
  stopReason?: string;
  raw: unknown;
}

export interface ConversationFile {
  sessionId: string;
  filePath: string;
  messages: ConversationMessage[];
  sizeBytes: number;
  truncated: boolean;
  meta: {
    permissionMode?: string;
    agentSetting?: string;
    lastPrompt?: string;
  };
}

export interface ConversationAppend {
  sessionId: string;
  filePath: string;
  newMessages: ConversationMessage[];
  sizeBytes: number;
}

export interface AgentInfo {
  name: string;
  description: string;
  tools: string[] | 'inherit' | null;
  model: string | null;
  scope: 'user' | 'project';
  filePath: string;
  body: string;
}

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan';

export interface NewSessionInput {
  prompt: string;
  cwd: string;
  agent?: string | null;
  model?: string | null;
  name?: string | null;
  /** Claude permission mode the new session boots with. Passed via
   *  `--permission-mode` to claude (and through the daemon dispatch).
   *  Falls back to 'default' if unset. */
  permissionMode?: PermissionMode | null;
  /** Optional new git worktree path. When set, AgentView creates the worktree
   *  before spawning claude inside it. */
  worktreePath?: string | null;
  /** Branch to base the new worktree on. Required when `worktreePath` is set. */
  baseBranch?: string | null;
  /** Optional new branch name to create inside the worktree. */
  newBranch?: string | null;
  /** Which backend the new session should run on. When null/undefined,
   *  avd treats this as the default backend ('claude'). */
  backend?: BackendKind | null;
}

export interface ResumeMessageInput {
  sessionId: string;
  prompt: string;
  cwd: string;
  agent?: string | null;
  model?: string | null;
  /** Claude permission mode. For an existing alive session this is mostly a
   *  no-op (permission is locked at spawn), but it's applied when the runner
   *  needs to respawn a dead session. */
  permissionMode?: PermissionMode | null;
}

export type ClaudeRunEvent =
  | { sessionId: string; type: 'spawn'; pid: number | null; ts: number }
  | { sessionId: string; type: 'exit'; exitCode: number | null; stderr?: string; ts: number }
  | { sessionId: string; type: 'error'; message: string; ts: number }
  | { sessionId: string; type: 'busy'; ts: number };

export interface RunningSessionInfo {
  sessionId: string;
  pid: number;
  startedAt: number;
}

export interface SlashCommandEntry {
  name: string;
  scope: 'user' | 'project' | 'builtin';
  description: string;
  filePath: string;
}

export interface GitBranchesResult {
  /** true when `cwd` is inside a git repository. */
  isRepo: boolean;
  /** Currently-checked-out branch (or '' if detached HEAD). */
  current: string;
  /** Local branches (without `refs/heads/` prefix). */
  branches: string[];
  /** When this cwd is itself a worktree, the linked main repo path. */
  rootCwd?: string;
}

export interface PermissionPromptEvent {
  sessionId: string;
  /** Stable id of the prompt (hash of question + options). Use for dedupe. */
  id: string;
  question: string;
  options: Array<{ key: string; label: string }>;
  detectedAt: number;
}
