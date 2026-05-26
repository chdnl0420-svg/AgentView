import type {
  AgentInfo,
  BgSession,
  ClaudeRunEvent,
  ConversationAppend,
  ConversationFile,
  GitBranchesResult,
  NewSessionInput,
  PermissionMode,
  PermissionPromptEvent,
  ResumeMessageInput,
  RunningSessionInfo,
  ScanSessionsResult,
  SlashCommandEntry
} from './types';

export const IPC = {
  SessionsList: 'sessions:list',
  SessionsRead: 'sessions:read',
  SessionsKill: 'sessions:kill',
  SessionsReveal: 'sessions:reveal',
  SessionsWatch: 'sessions:watch',
  SessionsUnwatch: 'sessions:unwatch',

  SessionsNew: 'sessions:new',
  SessionsResume: 'sessions:resume',
  SessionsFork: 'sessions:fork',
  SessionsCancel: 'sessions:cancel',
  SessionsRunningList: 'sessions:running',
  SessionsWatchOutput: 'sessions:watchOutput',
  SessionsUnwatchOutput: 'sessions:unwatchOutput',
  SessionsAnswerPrompt: 'sessions:answerPrompt',
  SessionsRenameJob: 'sessions:renameJob',

  UpdaterCheck: 'updater:check',
  UpdaterDownload: 'updater:download',
  UpdaterOpenReleasePage: 'updater:openReleasePage',
  AppVersion: 'app:version',
  ShellOpenPath: 'shell:openPath',
  SessionsDelete: 'sessions:delete',
  UsageFetch: 'usage:fetch',

  AgentsList: 'agents:list',
  CommandsList: 'commands:list',

  PickDirectory: 'picker:directory',
  PickFiles: 'picker:files',
  SavePastedImage: 'picker:savePastedImage',

  GitBranches: 'git:branches',
  GitDefaultWorktreePath: 'git:defaultWorktreePath',

  WorkspaceList: 'workspace:list',
  WorkspaceRead: 'workspace:read',
  WorkspaceExportReport: 'workspace:exportReport',
  WorkspaceOpenRoot: 'workspace:openRoot',
  ClaudeStatus: 'claude:status',

  // ----- 1.0.5 SessionDetail mega-pass -----
  /** Typed preview of an arbitrary file path. Returns { kind, content?, … } */
  FilePreview: 'file:preview',
  /** Put a single file onto the system clipboard so it can be pasted in Explorer. */
  ShellCopyFile: 'shell:copyFile',
  /** Patch the live session's permission mode (best-effort, may need respawn). */
  SessionsSetPermission: 'sessions:setPermission',
  /** Patch the live session's preferred model (best-effort, may need respawn). */
  SessionsSetModel: 'sessions:setModel',

  // ----- 1.0.5 window chrome + options popover -----
  WindowMinimize: 'window:minimize',
  WindowToggleMaximize: 'window:toggleMaximize',
  WindowClose: 'window:close',
  WindowIsMaximized: 'window:isMaximized',
  OptionsGetAutostart: 'options:getAutostart',
  OptionsSetAutostart: 'options:setAutostart'
} as const;

export const EVT = {
  SessionsChanged: 'sessions:changed',
  SessionUpdated: 'sessions:updated',
  ConversationAppended: 'sessions:conversationAppended',
  ClaudeRunEvent: 'sessions:runEvent',
  RunningChanged: 'sessions:runningChanged',
  PermissionPrompt: 'sessions:permissionPrompt',
  UpdaterProgress: 'updater:progress',
  WindowMaximizedChanged: 'window:maximizedChanged'
} as const;

export interface AgentViewApi {
  sessions: {
    list(): Promise<ScanSessionsResult>;
    read(sessionId: string): Promise<ConversationFile | null>;
    kill(pid: number): Promise<{ ok: boolean; message?: string }>;
    reveal(filePath: string): Promise<boolean>;
    watch(sessionId: string): Promise<void>;
    unwatch(sessionId: string): Promise<void>;
    newSession(
      input: NewSessionInput
    ): Promise<{ sessionId: string; pid: number | null; forkedFrom?: string | null }>;
    sendMessage(
      input: ResumeMessageInput
    ): Promise<{ sessionId: string; pid: number | null; forkedFrom?: string | null }>;
    fork(
      input: ResumeMessageInput
    ): Promise<{ sessionId: string; pid: number | null; forkedFrom: string }>;
    cancel(sessionId: string): Promise<boolean>;
    runningList(): Promise<RunningSessionInfo[]>;
    watchOutput(sessionId: string): Promise<void>;
    unwatchOutput(sessionId: string): Promise<void>;
    answerPrompt(sessionId: string, key: string): Promise<{ ok: boolean; reason?: string }>;
    renameJob(sessionId: string, name: string | null): Promise<{ ok: boolean; reason?: string }>;
    setPermission(sessionId: string, mode: PermissionMode): Promise<{ ok: boolean; reason?: string }>;
    setModel(sessionId: string, model: string | null): Promise<{ ok: boolean; reason?: string }>;
    deleteMany(sessionIds: string[]): Promise<{ ok: boolean; deleted: string[]; failed: Array<{ sessionId: string; reason: string }> }>;
    fetchUsage(): Promise<{
      fiveHour?: { used: number; limit: number; pct: number; resetIso?: string; resetIn?: string };
      weekly?: { used: number; limit: number; pct: number; resetIso?: string; resetIn?: string };
      fetchedAt: number;
    } | null>;
    onChanged(handler: () => void): () => void;
    onSessionUpdated(handler: (s: BgSession) => void): () => void;
    onConversationAppended(handler: (a: ConversationAppend) => void): () => void;
    onRunEvent(handler: (e: ClaudeRunEvent) => void): () => void;
    onRunningChanged(handler: (info: RunningSessionInfo[]) => void): () => void;
    onPermissionPrompt(handler: (p: PermissionPromptEvent) => void): () => void;
  };
  updater: {
    check(): Promise<{
      current: string;
      latest: string | null;
      available: boolean;
      releaseUrl?: string;
      installerUrl?: string;
      installerName?: string;
      notes?: string;
    }>;
    download(): Promise<{ ok: boolean; reason?: string }>;
    openReleasePage(): Promise<void>;
    onProgress(handler: (pct: number) => void): () => void;
    version(): Promise<string>;
  };
  agents: {
    list(): Promise<AgentInfo[]>;
  };
  shell: {
    openPath(path: string): Promise<{ ok: boolean; reason?: string }>;
    copyFile(path: string): Promise<{ ok: boolean; reason?: string }>;
  };
  file: {
    preview(path: string): Promise<{
      kind: 'html' | 'markdown' | 'text' | 'image' | 'json' | 'binary' | 'too-large' | 'missing';
      content?: string;
      dataUrl?: string;
      mime?: string;
      size?: number;
      reason?: string;
    } | null>;
  };
  commands: {
    /**
     * Lists builtin + user (`~/.claude/commands`) + project (`<cwd>/.claude/commands`)
     * slash commands. Pass the *session's* cwd — passing nothing falls back
     * to `process.cwd()` which in a packaged build is the install dir, not
     * the user's project, so project-scoped commands silently vanish.
     */
    list(cwd?: string | null): Promise<SlashCommandEntry[]>;
  };
  picker: {
    directory(defaultPath?: string): Promise<string | null>;
    files(defaultPath?: string): Promise<string[]>;
    savePastedImage(buffer: ArrayBuffer, ext: string): Promise<string | null>;
    /**
     * Returns the absolute filesystem path for a renderer-side File object.
     * Required since Electron 32 (which dropped File.path). Returns ''
     * when the File originated outside the OS file system (e.g. a generated
     * blob).
     */
    pathForFile(file: File): string;
  };
  git: {
    branches(cwd: string): Promise<GitBranchesResult>;
    defaultWorktreePath(cwd: string, branchOrSuffix: string): Promise<string>;
  };
  workspace: {
    list(): Promise<Array<{
      sessionId: string;
      status: 'pending' | 'running' | 'completed' | 'crashed';
      prompt: string;
      cwd: string;
      agent: string;
      updatedAt: number;
      filePath: string;
    }>>;
    read(sessionId: string): Promise<string | null>;
    exportReport(sessionId: string): Promise<{ ok: boolean; path?: string; reason?: string }>;
    openRoot(): Promise<void>;
  };
  claude: {
    status(force?: boolean): Promise<{
      cliPath: string | null;
      cliVersion: string | null;
      daemonAlive: boolean;
      supervisorPid: number | null;
      checkedAt: number;
    }>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizedChanged(handler: (m: boolean) => void): () => void;
  };
  options: {
    getAutostart(): Promise<boolean>;
    setAutostart(on: boolean): Promise<{ ok: boolean }>;
  };
}

declare global {
  interface Window {
    av: AgentViewApi;
  }
}
