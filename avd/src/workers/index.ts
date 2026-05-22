// Worker interface shared by ClaudeAdapter, ExternalClaudeAdapter, and the
// future CodexAdapter. Concrete adapters must return a pid-backed handle that
// server.ts can persist in catalog/roster.

export interface WorkerHandle {
  sessionId: string;
  pid: number;
  /** Best-effort liveness check; does not block. */
  isAlive(): boolean;
  /** Graceful shutdown. Returns when the process has exited or timed out. */
  stop(): Promise<void>;
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

import { ExternalClaudeAdapter } from './external-claude.js';
import type { WorkerAdapter, WorkerAdapterRequest, WorkerFactory } from './adapter.js';

export interface WorkerFactoryOptions {
  externalClaude?: WorkerAdapter;
}

export function createWorkerFactory(options: WorkerFactoryOptions = {}): WorkerFactory {
  const externalClaude = options.externalClaude ?? new ExternalClaudeAdapter();
  return async (request: WorkerAdapterRequest): Promise<WorkerHandle> => {
    if (request.backend === 'external-claude') {
      return externalClaude.start(request);
    }
    throw new Error('ADAPTER_UNAVAILABLE');
  };
}
