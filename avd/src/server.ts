// avd socket server — handshake + lifecycle + conversation subscriptions.
//
// `startServer` opens a Named Pipe (Windows) or AF_UNIX socket (Unix),
// accepts connections, runs a length-prefixed frame loop, answers
// HELLO with WELCOME, and routes subscribe-conversation /
// unsubscribe-conversation CTRL frames through the Subscriptions
// manager. Unknown CTRL cmds fall through to the chunk-2
// UNSUPPORTED_FRAME error so existing clients keep working.

import { createServer, type Server, type Socket } from 'node:net';
import { isAbsolute } from 'node:path';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { acquirePid, releasePid } from './pid.js';
import {
  encodeFrame,
  decodeFrame,
  FRAME_TYPE,
  type FrameTypeValue,
} from './protocol.js';
import { Subscriptions } from './subscriptions.js';

export interface ServerHandle {
  socketPath: string;
  close: () => Promise<void>;
}

export interface ServerOptions {
  pidPath: string;
  socketPath: string;
  /** Remote-shutdown hook — see chunk-2 verify-lifecycle script. */
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

function sendCtrlJson(socket: Socket, value: unknown): void {
  sendFrame(socket, FRAME_TYPE.CTRL, Buffer.from(JSON.stringify(value), 'utf8'));
}

function sendErr(socket: Socket, code: string, extra: Record<string, unknown> = {}): void {
  sendFrame(
    socket,
    FRAME_TYPE.ERR,
    Buffer.from(JSON.stringify({ code, ...extra }), 'utf8')
  );
}

function handleFrame(
  slot: ClientSlot,
  type: number,
  payload: Buffer,
  subscriptions: Subscriptions,
  onShutdownRequest?: () => void
): void {
  if (type === FRAME_TYPE.HELLO) {
    const welcome = JSON.stringify({ version: '0.1.0', sessions: [] });
    sendFrame(slot.socket, FRAME_TYPE.WELCOME, Buffer.from(welcome, 'utf8'));
    return;
  }
  if (type === FRAME_TYPE.CTRL) {
    let body: { cmd?: string; sessionId?: string; conversationPath?: string; intervalMs?: number } | undefined;
    try {
      body = JSON.parse(payload.toString('utf8')) as typeof body;
    } catch {
      sendErr(slot.socket, 'UNSUPPORTED_FRAME', { frameType: type });
      return;
    }
    const cmd = body?.cmd;
    if (cmd === 'shutdown' && onShutdownRequest) {
      sendCtrlJson(slot.socket, { ok: true });
      onShutdownRequest();
      return;
    }
    if (cmd === 'subscribe-conversation') {
      const sessionId = body?.sessionId;
      const conversationPath = body?.conversationPath;
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        sendErr(slot.socket, 'INVALID_SESSION');
        return;
      }
      if (typeof conversationPath !== 'string' || !isAbsolute(conversationPath)) {
        sendErr(slot.socket, 'INVALID_PATH');
        return;
      }
      const watchOpts = typeof body?.intervalMs === 'number' ? { intervalMs: body.intervalMs } : {};
      subscriptions
        .subscribe(sessionId, conversationPath, slot.socket, watchOpts)
        .then((r) => sendCtrlJson(slot.socket, { ok: true, sessionId, initialOffset: r.initialOffset }))
        .catch((err) => sendErr(slot.socket, 'SUBSCRIBE_FAILED', { reason: String((err as Error).message ?? err) }));
      return;
    }
    if (cmd === 'unsubscribe-conversation') {
      const sessionId = body?.sessionId;
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        sendErr(slot.socket, 'INVALID_SESSION');
        return;
      }
      subscriptions.unsubscribe(sessionId, slot.socket);
      sendCtrlJson(slot.socket, { ok: true });
      return;
    }
    // Unknown cmd — fall through to UNSUPPORTED_FRAME for chunk-2 compatibility.
  }
  sendErr(slot.socket, 'UNSUPPORTED_FRAME', { frameType: type });
}

function attachClient(
  socket: Socket,
  clients: Set<Socket>,
  subscriptions: Subscriptions,
  onShutdownRequest?: () => void
): void {
  const slot: ClientSlot = { socket, inbox: Buffer.alloc(0) };
  clients.add(socket);
  socket.on('close', () => {
    subscriptions.removeAll(socket);
    clients.delete(socket);
  });
  socket.on('data', (chunk) => {
    slot.inbox = Buffer.concat([slot.inbox, chunk]);
    for (;;) {
      let decoded;
      try {
        decoded = decodeFrame(slot.inbox);
      } catch (e) {
        socket.destroy(e as Error);
        return;
      }
      if (!decoded) return;
      slot.inbox = decoded.rest;
      handleFrame(slot, decoded.type, decoded.payload, subscriptions, onShutdownRequest);
    }
  });
  socket.on('error', () => { /* swallow */ });
}

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  await acquirePid(opts.pidPath);
  const clients = new Set<Socket>();
  const subscriptions = new Subscriptions((sock, push) => {
    sendCtrlJson(sock, { event: 'conversation-appended', ...push });
  });

  try {
    if (!opts.socketPath.startsWith('\\\\.\\pipe\\')) {
      await fs.mkdir(dirname(opts.socketPath), { recursive: true });
      await safeUnlink(opts.socketPath);
    }
    const server: Server = createServer((sock) =>
      attachClient(sock, clients, subscriptions, opts.onShutdownRequest)
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(opts.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const close = async (): Promise<void> => {
      for (const sock of clients) {
        subscriptions.removeAll(sock);
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
    if (!opts.socketPath.startsWith('\\\\.\\pipe\\')) {
      await safeUnlink(opts.socketPath);
    }
    await releasePid(opts.pidPath);
    throw err;
  }
}
