// avd daemon entry. `node ./avd/dist/daemon.js` runs this.
//
// chunk-5: at boot we adopt any roster entries whose pid is still alive
// and clean up the dead ones. This is the only persistent state we keep
// across daemon restarts so we have to reconcile it with the running
// world before we accept any client connections.

import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Catalog } from './catalog.js';
import { Roster } from './roster.js';
import { adoptLive, type AdoptLiveResult } from './adoption.js';
import { acquirePid, releasePid } from './pid.js';
import { getProcessInfo } from './process-info.js';
import { startServer, type ServerHandle } from './server.js';
import { createWorkerFactory, createSelfPtySpawn } from './workers/index.js';

const HOME = homedir();
const DAEMON_DIR = join(HOME, '.agentview', 'daemon');
// Env overrides exist primarily so the cross-platform verify-lifecycle
// script can use disposable paths and avoid colliding with a real
// running daemon. Production callers leave them unset.
const PID_PATH = process.env.AVD_PID_PATH ?? join(DAEMON_DIR, 'avd.pid');
const SOCKET_PATH = process.env.AVD_SOCKET_PATH ?? (platform() === 'win32'
  ? `\\\\.\\pipe\\avd-${process.env.USERNAME ?? 'user'}`
  : join(DAEMON_DIR, 'avd.sock'));
const ROSTER_PATH = process.env.AVD_ROSTER_PATH ?? join(DAEMON_DIR, 'roster.json');
const CATALOG_PATH = process.env.AVD_CATALOG_PATH ?? join(DAEMON_DIR, 'state.json');

export interface BootAdoptionResult extends AdoptLiveResult {
  catalog: Catalog;
  roster: Roster;
}

/**
 * Exported so tests can verify the boot sequence (Catalog.open → Roster.open
 * → adoptLive) runs before `startServer` ever opens the listening socket.
 * `isAlive` is injectable so tests don't depend on whatever process happens
 * to own a given pid on the host.
 */
export async function bootAdoption(paths: {
  catalogPath: string;
  rosterPath: string;
  isAlive?: (pid: number) => boolean;
  /**
   * Override for tests. `null` disables OS-level zombie detection so
   * test pids (e.g. 111) don't accidentally match a real OS process's
   * startTime. Production callers leave this undefined → `getProcessInfo`.
   */
  processInfo?: ((pid: number) => Promise<import('./process-info.js').ProcessInfo | null>) | null;
}): Promise<BootAdoptionResult> {
  const catalog = await Catalog.open(paths.catalogPath);
  const roster = await Roster.open(paths.rosterPath);
  // Pass processInfo explicitly so the wiring is grep-able — production
  // daemons MUST run zombie detection on Linux/macOS; Windows falls back
  // to null inside getProcessInfo so the runtime cost there is zero.
  const processInfo = paths.processInfo === undefined ? getProcessInfo : paths.processInfo;
  const result = await adoptLive({
    catalog,
    roster,
    isAlive: paths.isAlive,
    processInfo,
  });
  return { ...result, catalog, roster };
}

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

  // Acquire the daemon singleton lock *before* touching persistent state.
  // Without this, a second daemon process whose acquirePid() would later
  // fail can still mutate roster/catalog rows it does not own.
  await acquirePid(PID_PATH);
  try {
    // Reconcile persistent state *before* the server starts accepting
    // clients. Pid lock is already held so no other daemon can race.
    const adopt = await bootAdoption({ catalogPath: CATALOG_PATH, rosterPath: ROSTER_PATH });
    if (adopt.kept.length > 0 || adopt.cleaned.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[avd] adoption: kept=${adopt.kept.length} cleaned=${adopt.cleaned.length}`);
    }

    handle = await startServer({
      pidPath: PID_PATH,
      socketPath: SOCKET_PATH,
      pidAlreadyHeld: true,
      catalog: adopt.catalog,
      roster: adopt.roster,
      workerFactory: createWorkerFactory({
        // K-era routing: every backend resolved by sessionRunner.routeBackend
        // arrives here as `claude`, which the new ClaudeAdapter handles
        // by spawning the claude CLI directly via createSelfPtySpawn().
        // No more ~/.claude/daemon/dispatch/<short>.json writes and no
        // more roster.json polling — the supervisor dependency is gone.
        claudeOptions: {
          spawn: createSelfPtySpawn(),
        },
        codexOptions: {
          conversationDir: join(DAEMON_DIR, 'conversations'),
        },
      }),
      onShutdownRequest: () => { void shutdown('shutdown frame'); },
    });
  } catch (err) {
    await releasePid(PID_PATH).catch(() => { /* nothing */ });
    throw err;
  }
  // eslint-disable-next-line no-console
  console.log(`[avd] listening on ${handle.socketPath} (pid ${process.pid})`);
}

// Only auto-run when this module is the program entry point. Importing
// `bootAdoption` from a test must not trigger startServer.
const isEntry = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[avd] fatal:', err);
    process.exit(1);
  });
}
