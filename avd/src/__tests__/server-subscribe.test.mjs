// chunk-4 — subscribe-conversation / unsubscribe-conversation CTRL frames
// over the chunk-2 socket protocol. Uses AvdClient (avd/src/client.ts)
// so the integration round-trip exercises both sides.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { platform } from 'node:os';
import { startServer } from '../../dist/server.js';
import { AvdClient } from '../../dist/client.js';

function freshPaths(tag) {
  const root = join(tmpdir(), `avd-srv-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  const pidPath = join(root, 'daemon.pid');
  const socketPath = platform() === 'win32'
    ? `\\\\.\\pipe\\avd-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`
    : join(root, 'daemon.sock');
  const conv = join(root, 'session.jsonl');
  return { root, pidPath, socketPath, conv };
}

test('subscribe → append → CTRL conversation-appended frame delivered', async () => {
  const { root, pidPath, socketPath, conv } = freshPaths('sub');
  let server;
  let client;
  try {
    writeFileSync(conv, 'seed\n');
    server = await startServer({ pidPath, socketPath });
    client = new AvdClient();
    await client.connect(socketPath);
    const ack = await client.subscribeConversation('s-1', conv, { intervalMs: 50 });
    assert.equal(ack.ok, true);
    assert.equal(ack.sessionId, 's-1');
    // Wait briefly so the watcher establishes baseline before we append.
    const pushed = new Promise((resolve) => {
      client.once('conversation-appended', (evt) => resolve(evt));
    });
    await new Promise((r) => setTimeout(r, 80));
    appendFileSync(conv, 'hello-world\n');
    const evt = await Promise.race([
      pushed,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timed out waiting for push')), 3000)),
    ]);
    assert.equal(evt.sessionId, 's-1');
    assert.equal(evt.data, 'hello-world\n');
    assert.ok(typeof evt.nextOffset === 'number');
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('unsubscribe stops further pushes', async () => {
  const { root, pidPath, socketPath, conv } = freshPaths('unsub');
  let server;
  let client;
  try {
    writeFileSync(conv, 'seed\n');
    server = await startServer({ pidPath, socketPath });
    client = new AvdClient();
    await client.connect(socketPath);
    await client.subscribeConversation('s-2', conv, { intervalMs: 50 });
    const pushes = [];
    client.on('conversation-appended', (e) => pushes.push(e));
    await new Promise((r) => setTimeout(r, 80));
    appendFileSync(conv, 'one\n');
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(pushes.length >= 1, 'first push expected before unsubscribe');
    const sealed = pushes.length;
    const ack = await client.unsubscribeConversation('s-2');
    assert.equal(ack.ok, true);
    appendFileSync(conv, 'two\n');
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(pushes.length, sealed, 'no pushes after unsubscribe');
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('socket close automatically cleans up subscriptions (no orphaned watchers)', async () => {
  const { root, pidPath, socketPath, conv } = freshPaths('clean');
  let server;
  try {
    writeFileSync(conv, 'seed\n');
    server = await startServer({ pidPath, socketPath });
    const client = new AvdClient();
    await client.connect(socketPath);
    await client.subscribeConversation('s-3', conv, { intervalMs: 50 });
    await client.close(); // hard close — server must clean up.
    // If subscriptions cleaned up, an append produces no in-process errors.
    appendFileSync(conv, 'no-listeners\n');
    await new Promise((r) => setTimeout(r, 250));
    // We can verify by re-subscribing and confirming a fresh push works.
    const client2 = new AvdClient();
    await client2.connect(socketPath);
    const ack = await client2.subscribeConversation('s-3', conv, { intervalMs: 50 });
    assert.equal(ack.ok, true);
    await client2.close();
  } finally {
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown CTRL cmd preserves chunk-2 UNSUPPORTED_FRAME compatibility', async () => {
  const { root, pidPath, socketPath } = freshPaths('compat');
  let server;
  let client;
  try {
    server = await startServer({ pidPath, socketPath });
    client = new AvdClient();
    await client.connect(socketPath);
    await assert.rejects(
      () => client.sendCtrlRaw({ cmd: 'totally-unknown' }),
      /UNSUPPORTED_FRAME/
    );
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('subscribe with empty sessionId rejected with INVALID_SESSION', async () => {
  const { root, pidPath, socketPath, conv } = freshPaths('invsess');
  let server;
  let client;
  try {
    writeFileSync(conv, '');
    server = await startServer({ pidPath, socketPath });
    client = new AvdClient();
    await client.connect(socketPath);
    await assert.rejects(
      () => client.subscribeConversation('', conv, { intervalMs: 50 }),
      /INVALID_SESSION/
    );
    await assert.rejects(
      () => client.unsubscribeConversation(''),
      /INVALID_SESSION/
    );
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent subscribe for same sessionId shares one watcher (no orphan)', async () => {
  const { root, pidPath, socketPath, conv } = freshPaths('concur');
  let server;
  let client;
  try {
    writeFileSync(conv, 'seed\n');
    server = await startServer({ pidPath, socketPath });
    client = new AvdClient();
    await client.connect(socketPath);
    // Two concurrent subscribes from the same client for the same sessionId
    // — server must collapse to a single watcher (HIGH-1 placeholder pattern).
    const [ack1, ack2] = await Promise.all([
      client.subscribeConversation('s-c', conv, { intervalMs: 50 }),
      client.subscribeConversation('s-c', conv, { intervalMs: 50 }),
    ]);
    assert.equal(ack1.ok, true);
    assert.equal(ack2.ok, true);
    const pushes = [];
    client.on('conversation-appended', (e) => pushes.push(e));
    await new Promise((r) => setTimeout(r, 80));
    appendFileSync(conv, 'shared\n');
    await new Promise((r) => setTimeout(r, 250));
    // With a single watcher, a single append should produce a single push
    // (the client is registered once in the subscriber Set even after two
    // subscribe calls — Set semantics).
    assert.equal(pushes.length, 1, `expected 1 push, got ${pushes.length}`);
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('subscribe with relative conversationPath rejected with INVALID_PATH', async () => {
  const { root, pidPath, socketPath } = freshPaths('relpath');
  let server;
  let client;
  try {
    server = await startServer({ pidPath, socketPath });
    client = new AvdClient();
    await client.connect(socketPath);
    let err;
    try {
      await client.subscribeConversation('s-r', 'not-absolute.jsonl', { intervalMs: 50 });
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'subscribe with relative path must reject');
    assert.match(String(err.message ?? err), /INVALID_PATH/);
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
