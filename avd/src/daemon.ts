// avd daemon entry. `node ./avd/dist/daemon.js` runs this.
//
// chunk-2 scope: bring up the server, register signal handlers for
// graceful shutdown, and exit cleanly. No worker spawn yet (chunk-3+).

import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { startServer, type ServerHandle } from './server.js';

const HOME = homedir();
const DAEMON_DIR = join(HOME, '.agentview', 'daemon');
// Env overrides exist primarily so the cross-platform verify-lifecycle
// script can use disposable paths and avoid colliding with a real
// running daemon. Production callers leave them unset.
const PID_PATH = process.env.AVD_PID_PATH ?? join(DAEMON_DIR, 'avd.pid');
const SOCKET_PATH = process.env.AVD_SOCKET_PATH ?? (platform() === 'win32'
  ? `\\\\.\\pipe\\avd-${process.env.USERNAME ?? 'user'}`
  : join(DAEMON_DIR, 'avd.sock'));

async function main(): Promise<void> {
  let handle: ServerHandle | null = null;
  let shuttingDown = false;

  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[avd] ${reason} — shutting down`);
    if (handle) {
      try { await handle.close(); } catch { /* nothing */ }
    }
    process.exit(0);
  };

  process.on('SIGINT', (sig) => { void shutdown(String(sig)); });
  process.on('SIGTERM', (sig) => { void shutdown(String(sig)); });

  handle = await startServer({
    pidPath: PID_PATH,
    socketPath: SOCKET_PATH,
    onShutdownRequest: () => { void shutdown('shutdown frame'); },
  });
  // eslint-disable-next-line no-console
  console.log(`[avd] listening on ${handle.socketPath} (pid ${process.pid})`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[avd] fatal:', err);
  process.exit(1);
});
