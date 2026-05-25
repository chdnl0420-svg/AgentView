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

test("late exit of stopped child A must not clobber a fresh child B", async () => {
  // Race scenario: stop(A) is in-flight (waiting on exit). Before A actually
  // emits exit, a concurrent start() races in and spawns child B. When A
  // finally exits, its exit listener must NOT clear this.child (which now
  // holds B). Without the guard, B's reference is clobbered and isRunning()
  // lies while a real daemon keeps running — resource leak.
  const tmp = mkdtempSync(join(tmpdir(), 'avd-daemon-host-race-'));
  try {
    const { AvdDaemonHost } = await loadAvdDaemonHost(tmp);
    const socketPath = makeSocketPath('race');
    const server = createServer((s) => s.end());
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });

    const spawned = [];
    // Manual stub: .kill() does NOT auto-emit exit. We control timing so
    // we can interleave A.kill → start(B) → A.exit and observe the guard.
    function makeManualStubChild() {
      const child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      child.stderr = new EventEmitter();
      child.stdout = new EventEmitter();
      child.kill = () => {
        child.killed = true;
      };
      spawned.push(child);
      return child;
    }

    const host = new AvdDaemonHost({
      daemonScript: 'irrelevant.js',
      socketPath,
      readyTimeoutMs: 2000,
      readyPollIntervalMs: 50,
      spawnFn: () => makeManualStubChild(),
    });

    try {
      // Spawn child A.
      await host.start();
      assert.equal(spawned.length, 1, 'first start spawns one child');
      const childA = host['child'];
      assert.ok(childA, 'child A reference is set after first start');

      // stop(A) — kicks off kill, then awaits exit. We do NOT await it yet:
      // hold the promise, simulate the race, then resolve A's exit after B
      // has been spawned.
      const stopPromise = host.stop();
      assert.equal(host['child'], null, 'stop() clears child field eagerly');

      // Concurrent start() — spawns child B while A's exit is still pending.
      await host.start();
      assert.equal(spawned.length, 2, 'second start spawns a fresh child');
      const childB = host['child'];
      assert.ok(childB && childB !== childA, 'child B is set and distinct from A');

      // Now A finally emits its exit (late). The exit listener must check
      // `this.child === myChild` and skip the clobber because the field
      // now points at B.
      childA.exitCode = 0;
      childA.emit('exit', 0);

      // stopPromise resolves once A's exit lands (its 'exit' listener inside
      // stop() also fires).
      await stopPromise;

      assert.equal(host['child'], childB, "A's late exit must not clear B's reference");
      assert.equal(host.isRunning(), true, 'host still reports running after late A exit');
    } finally {
      // Cleanup B properly.
      const childB = host['child'];
      if (childB) {
        // Trigger B's exit so host.stop() resolves promptly.
        setImmediate(() => {
          childB.exitCode = 0;
          childB.emit('exit', 0);
        });
      }
      await host.stop();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
