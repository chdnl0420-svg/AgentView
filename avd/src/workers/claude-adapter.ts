// Real ClaudeAdapter — chunk-6's intended deliverable, finally landed
// after AVD shipped enough to expose ExternalClaudeAdapter's design
// flaw: it asks the absent external claude supervisor to spawn workers
// AVD itself was built to replace. ClaudeAdapter PTY-spawns the claude
// CLI directly via the same createSelfPtySpawn that already powers
// J's fallback path, dropping the dispatch + roster-poll dance.
//
// Wire-up: createWorkerFactory({ claudeOptions: { spawn } }). The default
// branch (no options) builds createSelfPtySpawn() lazily so tests can
// construct an adapter without touching node-pty.

import type { WorkerAdapter, WorkerAdapterRequest } from './adapter.js';
import type { WorkerHandle } from './index.js';
import type { SelfPtySpawn } from './external-claude.js';
import { createSelfPtySpawn } from './self-pty.js';

export interface ClaudeAdapterOptions {
  /**
   * Override the spawn implementation. Production wiring (daemon.ts)
   * injects createSelfPtySpawn(). Tests inject a fake to assert
   * delegation without touching the real CLI.
   */
  spawn?: SelfPtySpawn;
}

export class ClaudeAdapter implements WorkerAdapter {
  private readonly spawnImpl: SelfPtySpawn;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.spawnImpl = options.spawn ?? createSelfPtySpawn();
  }

  async start(request: WorkerAdapterRequest): Promise<WorkerHandle> {
    return this.spawnImpl(request);
  }
}
