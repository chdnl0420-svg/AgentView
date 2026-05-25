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
  const root = join(tmpdir(), `avd-send-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return {
    root,
    cwd: root,
    pidPath: join(root, 'daemon.pid'),
    catalogPath: join(root, 'state.json'),
    rosterPath: join(root, 'roster.json'),
    socketPath: platform() === 'win32'
      ? `\\\\.\\pipe\\avd-send-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`
      : join(root, 'daemon.sock'),
  };
}

test('send-message rejects unknown sessionId with UNKNOWN_SESSION', async () => {
  const { root, pidPath, socketPath, catalogPath, rosterPath } = freshPaths('unknown');
  let server;
  let client;
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async (req) => ({
        sessionId: req.sessionId,
        pid: process.pid,
        isAlive: () => true,
        stop: async () => {},
        send: async () => {},
      }),
    });
    client = new AvdClient();
    await client.connect(socketPath);

    await assert.rejects(
      () => client.sendMessage({ sessionId: 'does-not-exist', prompt: 'hello' }),
      /UNKNOWN_SESSION/
    );
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('send-message returns { ok: true } for a registered worker handle', async () => {
  const { root, cwd, pidPath, socketPath, catalogPath, rosterPath } = freshPaths('ok');
  let server;
  let client;
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    const sent = [];
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async (req) => ({
        sessionId: req.sessionId,
        pid: process.pid,
        isAlive: () => true,
        stop: async () => {},
        send: async (prompt, opts) => {
          sent.push({ prompt, opts });
        },
      }),
    });
    client = new AvdClient();
    await client.connect(socketPath);

    const startAck = await client.startSession({
      sessionId: 's-send-ok',
      cwd,
      backend: 'claude',
      prompt: 'initial',
    });
    assert.equal(startAck.ok, true);

    const ack = await client.sendMessage({
      sessionId: 's-send-ok',
      prompt: 'follow-up message',
      permissionMode: 'plan',
    });
    assert.equal(ack.ok, true);
    assert.equal(ack.sessionId, 's-send-ok');
    assert.equal(typeof ack.deliveredAt, 'number');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].prompt, 'follow-up message');
    assert.equal(sent[0].opts.permissionMode, 'plan');
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('send-message returns WORKER_DEAD when handle.isAlive is false', async () => {
  const { root, cwd, pidPath, socketPath, catalogPath, rosterPath } = freshPaths('dead');
  let server;
  let client;
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async (req) => ({
        sessionId: req.sessionId,
        pid: process.pid,
        isAlive: () => false,
        stop: async () => {},
        send: async () => {
          throw new Error('should not call send on dead worker');
        },
      }),
    });
    client = new AvdClient();
    await client.connect(socketPath);

    await client.startSession({
      sessionId: 's-dead',
      cwd,
      backend: 'claude',
      prompt: 'initial',
    });

    await assert.rejects(
      () => client.sendMessage({ sessionId: 's-dead', prompt: 'follow-up' }),
      /WORKER_DEAD/
    );
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('send-message returns SEND_FAILED when worker.send throws', async () => {
  const { root, cwd, pidPath, socketPath, catalogPath, rosterPath } = freshPaths('fail');
  let server;
  let client;
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async (req) => ({
        sessionId: req.sessionId,
        pid: process.pid,
        isAlive: () => true,
        stop: async () => {},
        send: async () => {
          throw new Error('PIPE_BROKEN');
        },
      }),
    });
    client = new AvdClient();
    await client.connect(socketPath);

    await client.startSession({
      sessionId: 's-fail',
      cwd,
      backend: 'claude',
      prompt: 'initial',
    });

    await assert.rejects(
      () => client.sendMessage({ sessionId: 's-fail', prompt: 'follow-up' }),
      /SEND_FAILED/
    );
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('send-message rejects empty prompt', async () => {
  const { root, cwd, pidPath, socketPath, catalogPath, rosterPath } = freshPaths('empty');
  let server;
  let client;
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    server = await startServer({
      pidPath,
      socketPath,
      catalog,
      roster,
      workerFactory: async (req) => ({
        sessionId: req.sessionId,
        pid: process.pid,
        isAlive: () => true,
        stop: async () => {},
        send: async () => {},
      }),
    });
    client = new AvdClient();
    await client.connect(socketPath);

    await client.startSession({
      sessionId: 's-empty',
      cwd,
      backend: 'claude',
      prompt: 'initial',
    });

    await assert.rejects(
      () => client.sendMessage({ sessionId: 's-empty', prompt: '' }),
      /INVALID_SEND_REQUEST/
    );
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
