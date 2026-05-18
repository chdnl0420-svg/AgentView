export type SessionStatus = 'running' | 'idle' | 'waiting' | 'finished' | 'crashed' | 'unknown';

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

export interface NewJobInput {
  prompt: string;
  cwd: string;
  agent?: string | null;
  model?: string | null;
  name?: string | null;
}

export interface JobEvent {
  jobId: string;
  type: 'stdout' | 'stderr' | 'spawn' | 'exit' | 'error';
  data?: string;
  exitCode?: number | null;
  ts: number;
}

export interface JobInfo {
  jobId: string;
  pid: number | null;
  prompt: string;
  cwd: string;
  agent: string | null;
  model: string | null;
  name: string | null;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  output: string;
  errorOutput: string;
}
