// avd socket server — handshake and lifecycle.
//
// `startServer` opens a Named Pipe (Windows) or AF_UNIX socket (Unix),
// accepts connections, runs a length-prefixed frame loop, and answers
// HELLO with WELCOME. Actual worker spawn / dispatch is wired up in
// chunk-3 and later; chunk-2 only proves the transport works.

import { createServer, type Server, type Socket } from 'node:net';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { acquirePid, releasePid } from './pid.js';
import {
  encodeFrame,
  decodeFrame,
  FRAME_TYPE,
  type FrameTypeValue,
} from './protocol.js';

export interface ServerHandle {
  /** Resolved socket path (or named-pipe address). */
  socketPath: string;
  /** Gracefully shut down: stop accepting, close clients, release pid. */
  close: () => Promise<void>;
}

export interface ServerOptions {
  pidPath: string;
  socketPath: string;
  /**
   * Optional remote-shutdown hook. When a client sends a CTRL frame
   * with payload `{"cmd":"shutdown"}` the server invokes this and the
   * caller is expected to close the server + exit the process. This is
   * how the cross-platform verify script triggers a graceful shutdown
   * on Windows, where TerminateProcess bypasses SIGINT handlers.
   */
  onShutdownRequest?: () => void;
}

interface ClientSlot {
  socket: Socket;
  inbox: Buffer;
}

function safeUnlink(path: string): Promise<void> {
  return fs.unlink(path).catch(() => {});
}

function sendFrame(socket: Socket, type: FrameTypeValue, payload: Buffer): void {
  try {
    socket.write(encodeFrame(type, payload));
  } catch {
    /* socket may have closed mid-write; ignore */
  }
}

function handleFrame(
  slot: ClientSlot,
  type: number,
  payload: Buffer,
  onShutdownRequest?: () => void
): void {
  if (type === FRAME_TYPE.HELLO) {
    // chunk-2 minimal handshake — sessionList is empty until chunk-3.
    const welcome = JSON.stringify({ version: '0.1.0', sessions: [] });
    sendFrame(slot.socket, FRAME_TYPE.WELCOME, Buffer.from(welcome, 'utf8'));
    return;
  }
  if (type === FRAME_TYPE.CTRL) {
    let cmd: string | undefined;
    try { cmd = (JSON.parse(payload.toString('utf8')) as { cmd?: string }).cmd; } catch { /* fallthrough */ }
    if (cmd === 'shutdown' && onShutdownRequest) {
      // ACK so the client can wait for the server-side close cleanly.
      sendFrame(slot.socket, FRAME_TYPE.CTRL, Buffer.from('{"ok":true}', 'utf8'));
      onShutdownRequest();
      return;
    }
  }
  // Unknown frame in chunk-2 — answer with ERR so the client can detect.
  const err = JSON.stringify({ code: 'UNSUPPORTED_FRAME', frameType: type });
  sendFrame(slot.socket, FRAME_TYPE.ERR, Buffer.from(err, 'utf8'));
}

function attachClient(
  socket: Socket,
  clients: Set<Socket>,
  onShutdownRequest?: () => void
): void {
  const slot: ClientSlot = { socket, inbox: Buffer.alloc(0) };
  clients.add(socket);
  socket.on('close', () => { clients.delete(socket); });
  socket.on('data', (chunk) => {
    slot.inbox = Buffer.concat([slot.inbox, chunk]);
    // Drain as many complete frames as the buffer holds.
    for (;;) {
      let decoded;
      try {
        decoded = decodeFrame(slot.inbox);
      } catch (e) {
        // Protocol error — close this client.
        socket.destroy(e as Error);
        return;
      }
      if (!decoded) return;
      slot.inbox = decoded.rest;
      handleFrame(slot, decoded.type, decoded.payload, onShutdownRequest);
    }
  });
  socket.on('error', () => { /* swallow */ });
}

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  await acquirePid(opts.pidPath);
  // Per-instance client set so two servers in the same process don't
  // interfere with each other on close().
  const clients = new Set<Socket>();

  try {
    // On Unix the socket file must not pre-exist.
    if (!opts.socketPath.startsWith('\\\\.\\pipe\\')) {
      await fs.mkdir(dirname(opts.socketPath), { recursive: true });
      await safeUnlink(opts.socketPath);
    }
    const server: Server = createServer((sock) => attachClient(sock, clients, opts.onShutdownRequest));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(opts.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const close = async (): Promise<void> => {
      // Force-disconnect all client sockets first; otherwise server.close()
      // waits indefinitely for them to end on their own.
      for (const sock of clients) {
        try { sock.destroy(); } catch { /* ignore */ }
      }
      clients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!opts.socketPath.startsWith('\\\\.\\pipe\\')) {
        await safeUnlink(opts.socketPath);
      }
      await releasePid(opts.pidPath);
    };

    return { socketPath: opts.socketPath, close };
  } catch (err) {
    // Listen / setup failed AFTER we grabbed the pid file. Release it so
    // a retry in the same process is not blocked by our own live pid.
    if (!opts.socketPath.startsWith('\\\\.\\pipe\\')) {
      await safeUnlink(opts.socketPath);
    }
    await releasePid(opts.pidPath);
    throw err;
  }
}
