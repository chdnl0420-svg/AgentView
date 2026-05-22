// chunk-5c — multiclient fan-out verification. Subscriptions already
// supports multiple subscribers via its Set<Socket> store; this test
// locks that behavior in so a future refactor can't accidentally
// collapse it to a single-listener implementation.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { startServer } from '../../dist/server.js';
import { AvdClient } from '../../dist/index.js';

function freshPaths(tag) {
  const root = join(tmpdir(), `avd-mc-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return {
    root,
    pidPath: join(root, 'daemon.pid'),
    socketPath: platform() === 'win32'
      ? `\\\\.\\pipe\\avd-mc-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`
      : join(root, 'daemon.sock'),
    conv: join(root, 'session.jsonl'),
  };
}

test('two clients subscribed to the same sessionId both receive each push', async () => {
  const { root, pidPath, socketPath, conv } = freshPaths('fanout');
  let server;
  const clientA = new AvdClient();
  const clientB = new AvdClient();
  try {
    writeFileSync(conv, 'seed\n');
    server = await startServer({ pidPath, socketPath });
    await clientA.connect(socketPath);
    await clientB.connect(socketPath);
    await clientA.subscribeConversation('shared', conv, { intervalMs: 50 });
    await clientB.subscribeConversation('shared', conv, { intervalMs: 50 });
    const pushesA = [];
    const pushesB = [];
    clientA.on('conversation-appended', (e) => pushesA.push(e));
    clientB.on('conversation-appended', (e) => pushesB.push(e));
    await new Promise((r) => setTimeout(r, 80));
    appendFileSync(conv, 'broadcast\n');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(pushesA.length, 1, `client A expected 1 push, got ${pushesA.length}`);
    assert.equal(pushesB.length, 1, `client B expected 1 push, got ${pushesB.length}`);
    assert.equal(pushesA[0].data, 'broadcast\n');
    assert.equal(pushesB[0].data, 'broadcast\n');
  } finally {
    await clientA.close().catch(() => {});
    await clientB.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('one client unsubscribing does not stop pushes to the other client', async () => {
  const { root, pidPath, socketPath, conv } = freshPaths('partial');
  let server;
  const clientA = new AvdClient();
  const clientB = new AvdClient();
  try {
    writeFileSync(conv, 'seed\n');
    server = await startServer({ pidPath, socketPath });
    await clientA.connect(socketPath);
    await clientB.connect(socketPath);
    await clientA.subscribeConversation('shared', conv, { intervalMs: 50 });
    await clientB.subscribeConversation('shared', conv, { intervalMs: 50 });
    const pushesA = [];
    const pushesB = [];
    clientA.on('conversation-appended', (e) => pushesA.push(e));
    clientB.on('conversation-appended', (e) => pushesB.push(e));
    // A unsubscribes; B stays subscribed.
    await clientA.unsubscribeConversation('shared');
    await new Promise((r) => setTimeout(r, 80));
    appendFileSync(conv, 'after-unsubA\n');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(pushesA.length, 0, `client A must not receive after unsubscribe (got ${pushesA.length})`);
    assert.equal(pushesB.length, 1, `client B should still receive (got ${pushesB.length})`);
    assert.equal(pushesB[0].data, 'after-unsubA\n');
  } finally {
    await clientA.close().catch(() => {});
    await clientB.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
