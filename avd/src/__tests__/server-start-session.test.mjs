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
      agent: 'planner',
      prompt: 'hello',
      name: 'Start success',
    });

    assert.deepEqual(ack, { ok: true, sessionId: 's-success', pid: workerPid });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].cwd, cwd);
    assert.equal(seen[0].prompt, 'hello');
    assert.equal(seen[0].agent, 'planner');

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

    let called = false;
    let stopped = false;
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async (req) => {
        called = true;
        return {
          sessionId: req.sessionId,
          pid: process.pid + 1,
          isAlive: () => true,
          stop: async () => { stopped = true; },
        };
      },
    });
    client = new AvdClient();
    await client.connect(socketPath);

    await assert.rejects(
      () => client.startSession({ sessionId: 's-existing', cwd, backend: 'claude', prompt: 'dupe' }),
      /START_SESSION_FAILED/
    );

    assert.equal(called, false);
    assert.equal(stopped, false);
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

test('concurrent duplicate start-session calls only invoke worker factory once', async () => {
  const { root, cwd, pidPath, socketPath, catalogPath, rosterPath } = freshPaths('concurrent-duplicate');
  let server;
  let clientA;
  let clientB;
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    let releaseFactory;
    const factoryGate = new Promise((resolve) => { releaseFactory = resolve; });
    let calls = 0;
    let stopped = 0;
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async (req) => {
        calls++;
        const pid = process.pid + 100 + calls;
        await factoryGate;
        return {
          sessionId: req.sessionId,
          pid,
          isAlive: () => true,
          stop: async () => { stopped++; },
        };
      },
    });
    clientA = new AvdClient();
    clientB = new AvdClient();
    await clientA.connect(socketPath);
    await clientB.connect(socketPath);

    const first = clientA
      .startSession({ sessionId: 's-race', cwd, backend: 'external-claude', prompt: 'a' })
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }));
    const second = clientB
      .startSession({ sessionId: 's-race', cwd, backend: 'external-claude', prompt: 'b' })
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls, 1);

    releaseFactory();
    const results = await Promise.all([first, second]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
    assert.equal(stopped, 0);

    const rec = catalog.get('s-race');
    assert.equal(rec.backend, 'external-claude');
    assert.equal(roster.forSession('s-race')?.sessionId, 's-race');
  } finally {
    if (clientA) await clientA.close().catch(() => {});
    if (clientB) await clientB.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
