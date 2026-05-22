import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { platform } from 'node:os';
import { startServer } from '../../dist/server.js';
import { AvdClient } from '../../dist/client.js';
import { Catalog } from '../../dist/catalog.js';
import { Roster } from '../../dist/roster.js';

function freshPaths(tag) {
  const root = join(tmpdir(), `avd-start-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return {
    root,
    cwd: root,
    pidPath: join(root, 'daemon.pid'),
    catalogPath: join(root, 'state.json'),
    rosterPath: join(root, 'roster.json'),
    socketPath: platform() === 'win32'
      ? `\\\\.\\pipe\\avd-start-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`
      : join(root, 'daemon.sock'),
  };
}

test('start-session rejects with ADAPTER_UNAVAILABLE when no worker factory is configured', async () => {
  const { root, cwd, pidPath, socketPath } = freshPaths('unavailable');
  let server;
  let client;
  try {
    server = await startServer({ pidPath, socketPath });
    client = new AvdClient();
    await client.connect(socketPath);
    await assert.rejects(
      () => client.startSession({ sessionId: 's-unavailable', cwd, backend: 'claude', prompt: 'hello' }),
      /ADAPTER_UNAVAILABLE/
    );
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('start-session with injected worker factory returns pid and persists catalog plus roster', async () => {
  const { root, cwd, pidPath, socketPath, catalogPath, rosterPath } = freshPaths('success');
  let server;
  let client;
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    const workerPid = process.pid;
    const seen = [];
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async (req) => {
        seen.push(req);
        return {
          sessionId: req.sessionId,
          pid: workerPid,
          isAlive: () => true,
          stop: async () => {},
        };
      },
    });
    client = new AvdClient();
    await client.connect(socketPath);

    const ack = await client.startSession({
      sessionId: 's-success',
      cwd,
      backend: 'claude',
      prompt: 'hello',
      name: 'Start success',
    });

    assert.deepEqual(ack, { ok: true, sessionId: 's-success', pid: workerPid });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].cwd, cwd);
    assert.equal(seen[0].prompt, 'hello');

    const rec = catalog.get('s-success');
    assert.equal(rec.backend, 'claude');
    assert.equal(rec.cwd, cwd);
    assert.equal(rec.status, 'running');
    assert.equal(rec.pid, workerPid);
    assert.equal(rec.name, 'Start success');

    const worker = roster.forSession('s-success');
    assert.ok(worker);
    assert.equal(worker.pid, workerPid);
    assert.equal(worker.backend, 'claude');
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('start-session validates request body before worker factory is called', async () => {
  const { root, pidPath, socketPath, catalogPath, rosterPath } = freshPaths('invalid');
  let server;
  let client;
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    let called = false;
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async () => {
        called = true;
        throw new Error('should not be called');
      },
    });
    client = new AvdClient();
    await client.connect(socketPath);

    await assert.rejects(
      () => client.startSession({ sessionId: 's-bad', cwd: 'relative/path', backend: 'claude' }),
      /INVALID_START_REQUEST/
    );
    assert.equal(called, false);
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('start-session duplicate roster failure leaves existing catalog entry intact', async () => {
  const { root, cwd, pidPath, socketPath, catalogPath, rosterPath } = freshPaths('duplicate');
  let server;
  let client;
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    await catalog.add({
      sessionId: 's-existing',
      backend: 'claude',
      cwd,
      startedAt: 1000,
      status: 'running',
      pid: process.pid,
      name: 'Existing',
    });
    await roster.register({
      sessionId: 's-existing',
      backend: 'claude',
      pid: process.pid,
      startedAt: 1000,
    });

    let stopped = false;
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async (req) => ({
        sessionId: req.sessionId,
        pid: process.pid + 1,
        isAlive: () => true,
        stop: async () => { stopped = true; },
      }),
    });
    client = new AvdClient();
    await client.connect(socketPath);

    await assert.rejects(
      () => client.startSession({ sessionId: 's-existing', cwd, backend: 'claude', prompt: 'dupe' }),
      /START_SESSION_FAILED/
    );

    assert.equal(stopped, true);
    const rec = catalog.get('s-existing');
    assert.equal(rec.name, 'Existing');
    assert.equal(rec.pid, process.pid);
    const worker = roster.forSession('s-existing');
    assert.ok(worker);
    assert.equal(worker.pid, process.pid);
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
