import type {
  AgentInfo,
  BgSession,
  ClaudeRunEvent,
  ConversationAppend,
  ConversationFile,
  GitBranchesResult,
  NewSessionInput,
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
  ClaudeStatus: 'claude:status'
} as const;

export const EVT = {
  SessionsChanged: 'sessions:changed',
  SessionUpdated: 'sessions:updated',
  ConversationAppended: 'sessions:conversationAppended',
  ClaudeRunEvent: 'sessions:runEvent',
  RunningChanged: 'sessions:runningChanged',
  PermissionPrompt: 'sessions:permissionPrompt',
  UpdaterProgress: 'updater:progress'
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
  };
  commands: {
    list(): Promise<SlashCommandEntry[]>;
  };
  picker: {
    directory(defaultPath?: string): Promise<string | null>;
    files(defaultPath?: string): Promise<string[]>;
    savePastedImage(buffer: ArrayBuffer, ext: string): Promise<string | null>;
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
}

declare global {
  interface Window {
    av: AgentViewApi;
  }
}
