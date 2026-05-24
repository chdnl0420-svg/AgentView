// Tests for AvdDaemonHost — the lazy-spawn lifecycle host for the avd
// daemon. We bundle the .ts source with esbuild (matches the pattern
// in `session-runner-avd.test.mjs`) so the test runs on the unmodified
// production code path without requiring a separate TS compile step.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';

async function loadAvdDaemonHost(tmp) {
  const out = join(
    tmp,
    `avdDaemonHost-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  await build({
    entryPoints: ['src/main/avdDaemonHost.ts'],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
}

/** Build a stub ChildProcess that satisfies AvdDaemonHost's contract:
 *  - exitCode === null and !killed → isRunning() returns true
 *  - .kill() flips killed (so subsequent isRunning() returns false)
 *  - stderr/stdout are EventEmitters (host attaches `on('data')` listeners)
 */
function makeStubChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => {
    child.killed = true;
    // Defer the exit event so 'once' listeners attach in time.
    setImmediate(() => child.emit('exit', 0));
  };
  return child;
}

/** Pick a fresh socket / pipe path so parallel tests don't collide. */
function makeSocketPath(label) {
  const tag = `${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (platform() === 'win32') {
    return `\\\\.\\pipe\\avd-test-${tag}`;
  }
  return join(tmpdir(), `avd-test-${tag}.sock`);
}

test('start() spawns daemon and resolves once socket accepts connections', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'avd-daemon-host-ready-'));
  try {
    const { AvdDaemonHost } = await loadAvdDaemonHost(tmp);
    const socketPath = makeSocketPath('ready');
    const server = createServer((s) => s.end());
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });

    let spawnCalls = 0;
    const host = new AvdDaemonHost({
      daemonScript: 'irrelevant.js',
      socketPath,
      readyTimeoutMs: 2000,
      readyPollIntervalMs: 50,
      spawnFn: () => {
        spawnCalls++;
        return makeStubChild();
      },
    });
    try {
      await host.start();
      assert.equal(spawnCalls, 1, 'spawnFn called exactly once');
      assert.equal(host.isRunning(), true, 'host reports running after start');
    } finally {
      await host.stop();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('start() throws AVD_DAEMON_NOT_READY when socket never becomes available', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'avd-daemon-host-timeout-'));
  try {
    const { AvdDaemonHost } = await loadAvdDaemonHost(tmp);
    const socketPath = makeSocketPath('timeout');
    // No server — every connect() will fail with ENOENT / connection refused.
    const host = new AvdDaemonHost({
      daemonScript: 'irrelevant.js',
      socketPath,
      readyTimeoutMs: 300,
      readyPollIntervalMs: 50,
      spawnFn: () => makeStubChild(),
    });
    await assert.rejects(() => host.start(), /AVD_DAEMON_NOT_READY/);
    assert.equal(host.isRunning(), false, 'half-started child is cleaned up on timeout');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('start() is idempotent — concurrent calls share one spawn', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'avd-daemon-host-concurrent-'));
  try {
    const { AvdDaemonHost } = await loadAvdDaemonHost(tmp);
    const socketPath = makeSocketPath('concurrent');
    const server = createServer((s) => s.end());
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });

    let spawnCalls = 0;
    const host = new AvdDaemonHost({
      daemonScript: 'irrelevant.js',
      socketPath,
      readyTimeoutMs: 2000,
      readyPollIntervalMs: 50,
      spawnFn: () => {
        spawnCalls++;
        return makeStubChild();
      },
    });
    try {
      // Three parallel start() calls — only one spawn should happen.
      await Promise.all([host.start(), host.start(), host.start()]);
      assert.equal(spawnCalls, 1, 'concurrent starts collapse into a single spawn');

      // A start() AFTER the daemon is running is also a no-op.
      await host.start();
      assert.equal(spawnCalls, 1, 'already-running host does not respawn');
    } finally {
      await host.stop();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop() is safe on a never-started host', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'avd-daemon-host-stop-noop-'));
  try {
    const { AvdDaemonHost } = await loadAvdDaemonHost(tmp);
    const host = new AvdDaemonHost({
      daemonScript: 'irrelevant.js',
      socketPath: makeSocketPath('stop-noop'),
      readyTimeoutMs: 100,
      readyPollIntervalMs: 50,
      spawnFn: () => makeStubChild(),
    });
    // No exception, no hang.
    await host.stop();
    assert.equal(host.isRunning(), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
