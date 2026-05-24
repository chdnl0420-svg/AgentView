// Worker interface shared by ClaudeAdapter, ExternalClaudeAdapter, and the
// future CodexAdapter. Concrete adapters must return a pid-backed handle that
// server.ts can persist in catalog/roster.

export interface WorkerSendOptions {
  permissionMode?: string | null;
}

export interface WorkerHandle {
  sessionId: string;
  pid: number;
  /** Optional append-only conversation JSONL produced by the worker. */
  conversationPath?: string;
  /** Best-effort liveness check; does not block. */
  isAlive(): boolean;
  /** Graceful shutdown. Returns when the process has exited or timed out. */
  stop(): Promise<void>;
  /**
   * Send a follow-up prompt to the running worker. Adapters that do not
   * support follow-up delivery should throw an Error whose message starts
   * with `NOT_SUPPORTED:`. Adapters whose underlying process has died
   * should throw `Error('WORKER_DEAD')`.
   */
  send(prompt: string, opts?: WorkerSendOptions): Promise<void>;
}

export interface SpawnRequest {
  sessionId: string;
  cwd?: string;
  prompt?: string;
  /** Test-only hint for fake workers. */
  fake?: boolean;
}

export type {
  WorkerAdapter,
  WorkerAdapterRequest,
  WorkerFactory,
} from './adapter.js';
export {
  ExternalClaudeAdapter,
  createDispatchPayload,
  encodeExternalClaudeFrame,
  sendPromptToExternalClaude,
} from './external-claude.js';
export {
  CodexAdapter,
  buildCodexCommand,
} from './codex.js';

import { ExternalClaudeAdapter } from './external-claude.js';
import { CodexAdapter, type CodexAdapterOptions } from './codex.js';
import type { WorkerAdapter, WorkerAdapterRequest, WorkerFactory } from './adapter.js';

export interface WorkerFactoryOptions {
  externalClaude?: WorkerAdapter;
  codex?: WorkerAdapter;
  codexOptions?: CodexAdapterOptions;
}

export function createWorkerFactory(options: WorkerFactoryOptions = {}): WorkerFactory {
  const externalClaude = options.externalClaude ?? new ExternalClaudeAdapter();
  const codex = options.codex ?? new CodexAdapter(options.codexOptions);
  return async (request: WorkerAdapterRequest): Promise<WorkerHandle> => {
    if (request.backend === 'external-claude') {
      return externalClaude.start(request);
    }
    if (request.backend === 'codex') {
      return codex.start(request);
    }
    throw new Error('ADAPTER_UNAVAILABLE');
  };
}
