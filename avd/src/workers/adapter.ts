import type { BackendKind } from '../catalog.js';
import type { SpawnRequest, WorkerHandle } from './index.js';

export interface WorkerAdapterRequest extends SpawnRequest {
  backend: BackendKind;
  agent?: string | null;
  name?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  resumeSessionId?: string | null;
  conversationPath?: string | null;
}

export interface WorkerAdapter {
  start(request: WorkerAdapterRequest): Promise<WorkerHandle>;
}

export type WorkerFactory = (request: WorkerAdapterRequest) => Promise<WorkerHandle>;
