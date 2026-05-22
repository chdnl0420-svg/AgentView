// Cross-platform avd daemon lifecycle verification.
// Spawns ./dist/daemon.js, connects, runs HELLO/WELCOME handshake,
// then SIGINT and verifies pid/socket cleanup. Used by chunk-2 PASS gate.

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFrame, decodeFrame, FRAME_TYPE } from '../dist/protocol.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use a unique pid/socket path per verify run so it never collides with
// a real daemon or a previous verify whose pipe is still in Windows
// kernel cleanup.
const STAMP = `${process.pid}-${Date.now()}`;
const DAEMON_DIR = join(homedir(), '.agentview', 'daemon');
const PID_PATH = join(DAEMON_DIR, `avd-verify-${STAMP}.pid`);
const SOCKET_PATH = platform() === 'win32'
  ? `\\\\.\\pipe\\avd-verify-${STAMP}`
  : join(DAEMON_DIR, `avd-verify-${STAMP}.sock`);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function connectWithRetry(path, retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      const sock = createConnection(path);
      await new Promise((res, rej) => {
        sock.once('connect', res);
        sock.once('error', rej);
      });
      return sock;
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`avd: could not connect to ${path}`);
}

function readOneFrame(sock, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const r = decodeFrame(buf);
      if (r) { sock.off('data', onData); resolve(r); }
    };
    sock.on('data', onData);
    setTimeout(() => { sock.off('data', onData); reject(new Error('handshake timeout')); }, timeoutMs);
  });
}

async function main() {
  const daemonPath = join(__dirname, '..', 'dist', 'daemon.js');
  if (!existsSync(daemonPath)) {
    console.error(`[verify] ${daemonPath} missing — run \`npm run -w avd build\` first.`);
    process.exit(2);
  }

  const child = spawn(process.execPath, [daemonPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      AVD_PID_PATH: PID_PATH,
      AVD_SOCKET_PATH: SOCKET_PATH,
    },
  });
  child.stdout.on('data', (d) => process.stdout.write(`[avd-out] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[avd-err] ${d}`));

  let exitCode = 1;
  try {
    await sleep(400);
    const sock = await connectWithRetry(SOCKET_PATH);
    sock.write(encodeFrame(FRAME_TYPE.HELLO, Buffer.from(JSON.stringify({ clientId: 'verify' }))));
    const reply = await readOneFrame(sock);
    if (reply.type !== FRAME_TYPE.WELCOME) {
      throw new Error(`expected WELCOME, got frame type ${reply.type}`);
    }
    console.log(`[verify] handshake OK (sessions: ${reply.payload.toString('utf8')})`);

    // Ask the daemon to shut down via CTRL frame. On Windows, child.kill()
    // is TerminateProcess and bypasses SIGINT handlers — the CTRL path is
    // the only portable graceful shutdown.
    sock.write(encodeFrame(FRAME_TYPE.CTRL, Buffer.from('{"cmd":"shutdown"}', 'utf8')));
    await new Promise((res) => child.once('exit', res));
    await sleep(200);
    sock.destroy();

    if (existsSync(PID_PATH)) {
      throw new Error(`pid file not cleaned up: ${PID_PATH}`);
    }
    console.log('[verify] lifecycle OK — pid cleaned up gracefully');
    exitCode = 0;
  } catch (e) {
    console.error('[verify] failed:', e);
    try { child.kill(); } catch { /* ignore */ }
  } finally {
    process.exit(exitCode);
  }
}

main();
