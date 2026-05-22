// Worker interface — shape that ClaudeAdapter, ExternalClaudeAdapter
// (chunk-6), and CodexAdapter (chunk-7) all implement. chunk-3 only
// uses the fake-claude implementation; the contract is exported here
// so later adapters can drop in without changing server.ts.

export interface WorkerHandle {
  sessionId: string;
  pid: number;
  /** Best-effort liveness check — does not block. */
  isAlive(): boolean;
  /** Graceful shutdown. Returns when the process has exited (or 1s timeout). */
  stop(): Promise<void>;
}

export interface SpawnRequest {
  sessionId: string;
  cwd?: string;
  prompt?: string;
  /** Test-only — skip real CLI and use the node-echo fake worker. */
  fake?: boolean;
}
