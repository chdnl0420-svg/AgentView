// AvdClient — small EventEmitter-flavored adapter for talking to the
// chunk-2/chunk-4 socket server.
//
// chunk-4 only ships this inside the avd workspace; main-process wiring
// is intentionally deferred to chunk-5 (where sessionRunner.ts will
// switch to a feature-flagged avd path). Keeping the client here means
// it ships with the same build+test infra as the daemon and we can
// integration-test the round-trip without touching Electron.

import { connect, type Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import {
  encodeFrame,
  decodeFrame,
  FRAME_TYPE,
} from './protocol.js';

interface PendingCtrl {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

export interface SubscribeAck {
  ok: true;
  sessionId: string;
  initialOffset: number;
}

export interface SubscribeOptions {
  /** Test-only hint — see chunk-4 conversation tailer. */
  intervalMs?: number;
}

export interface StartSessionInput {
  sessionId: string;
  cwd: string;
  backend?: 'claude' | 'external-claude' | 'codex' | null;
  agent?: string | null;
  prompt?: string | null;
  name?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  resumeSessionId?: string | null;
  conversationPath?: string | null;
}

export interface StartSessionAck {
  ok: true;
  sessionId: string;
  pid: number;
}

export class AvdClient extends EventEmitter {
  private socket: Socket | null = null;
  private inbox: Buffer = Buffer.alloc(0);
  private welcomeWaiter: PendingCtrl | null = null;
  /**
   * FIFO of ctrl callers — the server replies in send-order, and
   * conversation-appended pushes are filtered out before they reach
   * this queue.
   */
  private ctrlQueue: PendingCtrl[] = [];
  /** Serializes CTRL sends so server replies match send order exactly. */
  private ctrlSerializer: Promise<void> = Promise.resolve();
  private closing = false;

  async connect(socketPath: string): Promise<void> {
    if (this.socket) throw new Error('avdclient: already connected');
    const sock = connect(socketPath);
    this.socket = sock;
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error): void => {
        sock.off('connect', onConn);
        reject(e);
      };
      const onConn = (): void => {
        sock.off('error', onErr);
        resolve();
      };
      sock.once('error', onErr);
      sock.once('connect', onConn);
    });
    sock.on('data', (chunk) => this.handleData(chunk));
    sock.on('close', () => this.handleClose());
    sock.on('error', (e) => this.emit('error', e));
    // Send HELLO and wait for WELCOME so callers can subscribe right after connect.
    await this.handshake();
  }

  private handshake(): Promise<Record<string, unknown>> {
    if (!this.socket) throw new Error('avdclient: not connected');
    return new Promise((resolve, reject) => {
      this.welcomeWaiter = { resolve, reject };
      this.socket!.write(encodeFrame(FRAME_TYPE.HELLO, Buffer.alloc(0)));
    });
  }

  private handleData(chunk: Buffer): void {
    this.inbox = Buffer.concat([this.inbox, chunk]);
    for (;;) {
      let decoded;
      try { decoded = decodeFrame(this.inbox); } catch (e) {
        this.emit('error', e);
        this.socket?.destroy();
        return;
      }
      if (!decoded) return;
      this.inbox = decoded.rest;
      this.dispatchFrame(decoded.type, decoded.payload);
    }
  }

  private dispatchFrame(type: number, payload: Buffer): void {
    if (type === FRAME_TYPE.WELCOME) {
      const w = this.welcomeWaiter;
      this.welcomeWaiter = null;
      try {
        const parsed = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
        w?.resolve(parsed);
      } catch (e) {
        w?.reject(e as Error);
      }
      return;
    }
    if (type === FRAME_TYPE.CTRL) {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
      } catch (e) {
        const q = this.ctrlQueue.shift();
        q?.reject(e as Error);
        return;
      }
      if (body.event === 'conversation-appended') {
        this.emit('conversation-appended', body);
        return;
      }
      const q = this.ctrlQueue.shift();
      q?.resolve(body);
      return;
    }
    if (type === FRAME_TYPE.ERR) {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
      } catch {
        body = { code: 'PARSE_ERROR' };
      }
      const q = this.ctrlQueue.shift();
      if (q) q.reject(new Error(String(body.code ?? 'UNKNOWN_ERR')));
      else this.emit('server-error', body);
      return;
    }
    // chunk-2 sends PTY (0) frames too; chunk-4 does not yet consume them.
  }

  private handleClose(): void {
    if (this.welcomeWaiter) {
      const w = this.welcomeWaiter;
      this.welcomeWaiter = null;
      w.reject(new Error('avdclient: connection closed before WELCOME'));
    }
    const pending = this.ctrlQueue.splice(0);
    for (const p of pending) p.reject(new Error('avdclient: connection closed'));
    if (!this.closing) this.emit('close');
    this.socket = null;
  }

  /**
   * Send an arbitrary CTRL JSON body and return the server's reply
   * (resolved on CTRL reply, rejected on ERR). Calls are serialized
   * because the server replies in send-order — interleaving two
   * in-flight CTRL frames would otherwise let an unsubscribe ack
   * resolve a pending subscribe promise.
   */
  sendCtrlRaw(body: unknown): Promise<Record<string, unknown>> {
    if (!this.socket) return Promise.reject(new Error('avdclient: not connected'));
    const prev = this.ctrlSerializer;
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    this.ctrlSerializer = prev.then(() => gate);
    return prev.then(() => new Promise<Record<string, unknown>>((resolve, reject) => {
      this.ctrlQueue.push({
        resolve: (v) => { release(); resolve(v); },
        reject: (e) => { release(); reject(asErrPayload(e)); },
      });
      this.socket!.write(encodeFrame(FRAME_TYPE.CTRL, Buffer.from(JSON.stringify(body), 'utf8')));
    }));
  }

  async subscribeConversation(
    sessionId: string,
    conversationPath: string,
    opts: SubscribeOptions = {}
  ): Promise<SubscribeAck> {
    const body: Record<string, unknown> = {
      cmd: 'subscribe-conversation',
      sessionId,
      conversationPath,
    };
    if (typeof opts.intervalMs === 'number') body.intervalMs = opts.intervalMs;
    const reply = await this.sendCtrlRaw(body);
    return reply as unknown as SubscribeAck;
  }

  async unsubscribeConversation(sessionId: string): Promise<{ ok: true }> {
    const reply = await this.sendCtrlRaw({ cmd: 'unsubscribe-conversation', sessionId });
    return reply as unknown as { ok: true };
  }

  async startSession(input: StartSessionInput): Promise<StartSessionAck> {
    const reply = await this.sendCtrlRaw({
      cmd: 'start-session',
      sessionId: input.sessionId,
      cwd: input.cwd,
      backend: input.backend ?? 'claude',
      agent: input.agent ?? null,
      prompt: input.prompt ?? null,
      name: input.name ?? null,
      model: input.model ?? null,
      permissionMode: input.permissionMode ?? null,
      resumeSessionId: input.resumeSessionId ?? null,
      conversationPath: input.conversationPath ?? null,
    });
    return reply as unknown as StartSessionAck;
  }

  async close(): Promise<void> {
    this.closing = true;
    const sock = this.socket;
    if (!sock) return;
    await new Promise<void>((resolve) => {
      sock.once('close', () => resolve());
      try { sock.end(); } catch { resolve(); }
    });
  }
}

function asErrPayload(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(String(e));
}
