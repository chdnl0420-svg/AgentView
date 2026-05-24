// Lazy-spawn host for the avd daemon. After chunk-11 stripped the
// `AVD_ENABLED` env var, every dropdown selection of "AVD" / "External
// Claude" / "Codex" routes through `createAvdClient` → connect to the
// daemon socket. If the daemon process isn't running, every connect
// fails. This class owns its lifecycle so the renderer never has to
// know whether the daemon was pre-started or auto-spawned.
//
// Design notes:
//  - `start()` is idempotent. Concurrent callers all await the same
//    in-flight start promise. A no-op when the daemon is already up.
//  - Readiness is observed by polling-connect to the listening socket
//    (Unix socket path or Windows named pipe). The daemon writes its
//    pid + accepts connections in one boot phase, so a successful
//    connect proves "ready to handle CTRL frames".
//  - `stop()` is fire-and-forget safe — Electron's `before-quit` lane
//    cannot await async work reliably across platforms.

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { connect } from 'node:net';

export interface AvdDaemonHostOptions {
  /** Absolute path to the avd daemon entrypoint (e.g. avd/dist/daemon.js) */
  daemonScript: string;
  /** Socket path the daemon will listen on */
  socketPath: string;
  /** Max ms to wait for the socket to accept connections */
  readyTimeoutMs?: number;
  /** Polling interval while waiting for ready */
  readyPollIntervalMs?: number;
  /** Optional injection for tests */
  spawnFn?: (command: string, args: readonly string[], options?: SpawnOptions) => ChildProcess;
}

type RequiredOptions = Required<Omit<AvdDaemonHostOptions, 'spawnFn'>> &
  Pick<AvdDaemonHostOptions, 'spawnFn'>;

export class AvdDaemonHost {
  private child: ChildProcess | null = null;
  private readonly opts: RequiredOptions;
  private startPromise: Promise<void> | null = null;

  constructor(options: AvdDaemonHostOptions) {
    this.opts = {
      readyTimeoutMs: options.readyTimeoutMs ?? 30_000,
      readyPollIntervalMs: options.readyPollIntervalMs ?? 200,
      daemonScript: options.daemonScript,
      socketPath: options.socketPath,
      spawnFn: options.spawnFn,
    };
  }

  /**
   * Idempotent. Returns existing in-flight start promise if a previous
   * start() is still pending. No-op if daemon is already running.
   */
  async start(): Promise<void> {
    if (this.isRunning()) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.doStart();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  isRunning(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    // Only clear the field if it still refers to this child — a concurrent
    // start() racing with stop() may have already replaced it.
    if (this.child === child) this.child = null;
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(() => resolve(), 2000);
      child.once('exit', () => {
        clearTimeout(fallback);
        resolve();
      });
    });
  }

  private async doStart(): Promise<void> {
    const spawnFn = this.opts.spawnFn ?? spawn;
    const myChild = spawnFn(process.execPath, [this.opts.daemonScript], {
      detached: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.child = myChild;
    myChild.stderr?.on('data', (b: Buffer) => {
      console.error('[avd-daemon]', b.toString().trimEnd());
    });
    myChild.stdout?.on('data', (b: Buffer) => {
      console.log('[avd-daemon]', b.toString().trimEnd());
    });
    myChild.once('exit', (code) => {
      console.log('[avd-daemon] exited with code', code);
      // Only clear the field if it still refers to this child — a concurrent
      // start() may have replaced it with a fresh instance.
      if (this.child === myChild) this.child = null;
    });
    await this.waitSocketReady();
  }

  private async waitSocketReady(): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < this.opts.readyTimeoutMs) {
      try {
        await new Promise<void>((res, rej) => {
          const sock = connect(this.opts.socketPath);
          sock.once('connect', () => {
            sock.end();
            res();
          });
          sock.once('error', rej);
        });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, this.opts.readyPollIntervalMs));
      }
    }
    // Cleanup the half-started child before throwing
    await this.stop().catch(() => undefined);
    throw new Error('AVD_DAEMON_NOT_READY');
  }
}
