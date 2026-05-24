// Single-instance avd daemon lifecycle. Lives in its own module so
// both `./index.ts` (which registers the `before-quit` cleanup) and
// `./sessionRunner.ts` (which calls `ensureAvdReady()` lazily before
// `startViaAvd`) can import it without forming a cycle:
//
//   index.ts → ipc/index.ts → sessionRunner.ts
//
// If `sessionRunner.ts` imported from `./index.ts`, that arrow would
// close into a cycle and the renderer's first session start would race
// with the registerIpc() bootstrap. Extracting the host getter here
// keeps both ends of the lazy-spawn handshake decoupled.

import { join } from 'node:path';
import { app } from 'electron';
import { AvdDaemonHost } from './avdDaemonHost';
import { defaultAvdSocketPath } from './avdClient';

let avdHost: AvdDaemonHost | null = null;

function getAvdHost(): AvdDaemonHost {
  if (!avdHost) {
    const daemonScript = app.isPackaged
      ? join(process.resourcesPath, 'avd', 'dist', 'daemon.js')
      : join(__dirname, '../../avd/dist/daemon.js');
    avdHost = new AvdDaemonHost({
      daemonScript,
      socketPath: defaultAvdSocketPath(),
      readyTimeoutMs: 30_000,
    });
  }
  return avdHost;
}

/**
 * Lazy spawn — called from sessionRunner.startViaAvd before any avd CTRL.
 * Idempotent: safe to call multiple times. No-op if already running.
 */
export async function ensureAvdReady(): Promise<void> {
  await getAvdHost().start();
}

/**
 * Fire-and-forget shutdown — Electron's `before-quit` lane cannot await
 * async work reliably across platforms, so callers should `void` this
 * promise and let the daemon's own process exit hook do final cleanup.
 */
export function shutdownAvdHost(): Promise<void> {
  if (!avdHost) return Promise.resolve();
  const host = avdHost;
  avdHost = null;
  return host.stop();
}
