// avd server — handshake integration test.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { startServer } from '../../dist/server.js';
import { encodeFrame, decodeFrame, FRAME_TYPE } from '../../dist/protocol.js';

function freshPaths() {
  const dir = join(tmpdir(), `avd-server-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const pidPath = join(dir, 'avd.pid');
  const socketPath = platform() === 'win32'
    ? `\\\\.\\pipe\\avd-test-${process.pid}-${Date.now()}`
    : join(dir, 'avd.sock');
  return { dir, pidPath, socketPath };
}

function readOneFrame(client) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const r = decodeFrame(buf);
      if (r) {
        client.off('data', onData);
        client.off('error', onError);
        resolve(r);
      }
    };
    const onError = (e) => { client.off('data', onData); reject(e); };
    client.on('data', onData);
    client.on('error', onError);
    setTimeout(() => { client.off('data', onData); reject(new Error('timeout')); }, 3000);
  });
}

test('HELLO → WELCOME handshake', async () => {
  const { dir, pidPath, socketPath } = freshPaths();
  let server;
  try {
    server = await startServer({ pidPath, socketPath });
    const client = createConnection(socketPath);
    await new Promise((res, rej) => { client.once('connect', res); client.once('error', rej); });
    client.write(encodeFrame(FRAME_TYPE.HELLO, Buffer.from(JSON.stringify({ clientId: 't1' }))));
    const reply = await readOneFrame(client);
    assert.equal(reply.type, FRAME_TYPE.WELCOME);
    client.end();
  } finally {
    if (server) await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
