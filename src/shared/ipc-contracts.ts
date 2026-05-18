import type {
  AgentInfo,
  BgSession,
  ConversationAppend,
  ConversationFile,
  JobEvent,
  JobInfo,
  NewJobInput,
  ScanSessionsResult
} from './types';

export const IPC = {
  SessionsList: 'sessions:list',
  SessionsRead: 'sessions:read',
  SessionsKill: 'sessions:kill',
  SessionsReveal: 'sessions:reveal',
  SessionsWatch: 'sessions:watch',
  SessionsUnwatch: 'sessions:unwatch',

  AgentsList: 'agents:list',

  JobsStart: 'jobs:start',
  JobsList: 'jobs:list',
  JobsCancel: 'jobs:cancel',
  JobsRead: 'jobs:read',

  PickDirectory: 'picker:directory'
} as const;

export const EVT = {
  SessionsChanged: 'sessions:changed',
  SessionUpdated: 'sessions:updated',
  ConversationAppended: 'sessions:conversationAppended',
  JobEvent: 'jobs:event',
  JobUpdated: 'jobs:updated'
} as const;

export interface AgentViewApi {
  sessions: {
    list(): Promise<ScanSessionsResult>;
    read(sessionId: string): Promise<ConversationFile | null>;
    kill(pid: number): Promise<{ ok: boolean; message?: string }>;
    reveal(filePath: string): Promise<boolean>;
    watch(sessionId: string): Promise<void>;
    unwatch(sessionId: string): Promise<void>;
    onChanged(handler: () => void): () => void;
    onSessionUpdated(handler: (s: BgSession) => void): () => void;
    onConversationAppended(handler: (a: ConversationAppend) => void): () => void;
  };
  agents: {
    list(): Promise<AgentInfo[]>;
  };
  jobs: {
    start(input: NewJobInput): Promise<JobInfo>;
    list(): Promise<JobInfo[]>;
    cancel(jobId: string): Promise<boolean>;
    read(jobId: string): Promise<JobInfo | null>;
    onEvent(handler: (e: JobEvent) => void): () => void;
    onUpdated(handler: (j: JobInfo) => void): () => void;
  };
  picker: {
    directory(defaultPath?: string): Promise<string | null>;
  };
}

declare global {
  interface Window {
    av: AgentViewApi;
  }
}
