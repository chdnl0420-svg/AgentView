import { promises as fs } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DAEMON_DIR = join(homedir(), '.claude', 'daemon');
const ROSTER_PATH = join(DAEMON_DIR, 'roster.json');

interface RosterWorker {
  pid: number;
  sessionId: string;
  rendezvousSock: string;
  ptySock: string;
  cliVersion?: string;
  cwd: string;
}

interface Roster {
  workers: Record<string, RosterWorker>;
}

async function readRoster(): Promise<Roster | null> {
  try {
    const raw = await fs.readFile(ROSTER_PATH, 'utf8');
    return JSON.parse(raw) as Roster;
  } catch {
    return null;
  }
}

export async function findWorkerForSession(sessionId: string): Promise<RosterWorker | null> {
  const r = await readRoster();
  if (!r) return null;
  for (const w of Object.values(r.workers)) {
    if (w.sessionId === sessionId) return w;
  }
  return null;
}

/** Build a single length-prefixed frame: <be32 length><1 byte type><payload>. */
function frame(type: number, payload: string | Buffer): Buffer {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const out = Buffer.alloc(5 + data.length);
  out.writeUInt32BE(data.length, 0);
  out[4] = type;
  data.copy(out, 5);
  return out;
}

const FRAME_CTRL = 1;
const FRAME_PTY = 0;

const CONNECT_TIMEOUT_MS = 4000;
const SETTLE_MS = 600;
const PROMPT_TO_ENTER_MS = 350;
const POST_PROMPT_HOLD_MS = 1200;
const ENTER_REPEAT_GAP_MS = 200;

/**
 * Send raw keystroke(s) to the running background agent. We hold the pipe open
 * long enough for the daemon to actually consume the bytes — closing too soon
 * after a write can leave a single ESC stranded.
 */
export async function sendKeyToBackgroundAgent(
  sessionId: string,
  bytes: string,
  options: { repeat?: number; hold?: number } = {}
): Promise<{ ok: boolean; reason?: string }> {
  const worker = await findWorkerForSession(sessionId);
  if (!worker) return { ok: false, reason: 'NO_WORKER' };
  const repeat = options.repeat ?? 1;
  const hold = options.hold ?? 900;
  return new Promise((resolve) => {
    let resolved = false;
    let sock: Socket;
    try {
      sock = connect({ path: worker.ptySock });
    } catch (err) {
      resolve({ ok: false, reason: err instanceof Error ? err.message : String(err) });
      return;
    }
    const done = (r: { ok: boolean; reason?: string }) => {
      if (resolved) return;
      resolved = true;
      try { sock.end(); } catch { /* ignore */ }
      resolve(r);
    };
    const timeout = setTimeout(() => done({ ok: false, reason: 'CONNECT_TIMEOUT' }), CONNECT_TIMEOUT_MS);
    sock.on('connect', () => {
      clearTimeout(timeout);
      try {
        sock.write(frame(FRAME_CTRL, JSON.stringify({ t: 'hello', clientPid: process.pid, version: worker.cliVersion ?? '2.1.141' })));
      } catch (err) {
        done({ ok: false, reason: err instanceof Error ? err.message : String(err) });
        return;
      }
      const sendOne = (n: number) => {
        try {
          sock.write(frame(FRAME_PTY, bytes));
        } catch (err) {
          done({ ok: false, reason: err instanceof Error ? err.message : String(err) });
          return;
        }
        if (n > 1) setTimeout(() => sendOne(n - 1), 120);
        else setTimeout(() => done({ ok: true }), hold);
      };
      setTimeout(() => sendOne(repeat), SETTLE_MS);
    });
    sock.on('error', (err) => { clearTimeout(timeout); done({ ok: false, reason: err.message }); });
    sock.on('close', () => { clearTimeout(timeout); if (!resolved) done({ ok: false, reason: 'CLOSED_EARLY' }); });
  });
}

/**
 * Open the daemon worker's pty pipe, perform the client handshake, send the
 * user's prompt as raw TUI input, and disconnect. The background agent picks
 * it up as if a `claude agents` TUI peer had typed it — same jsonl, same sid.
 */
export async function sendToBackgroundAgent(
  sessionId: string,
  prompt: string,
  signal?: AbortSignal
): Promise<{ ok: true; pid: number } | { ok: false; reason: string }> {
  const worker = await findWorkerForSession(sessionId);
  if (!worker) {
    return { ok: false, reason: 'NO_WORKER' };
  }
  return new Promise((resolve) => {
    let resolved = false;
    let sock: Socket;
    try {
      sock = connect({ path: worker.ptySock });
    } catch (err) {
      resolve({ ok: false, reason: err instanceof Error ? err.message : String(err) });
      return;
    }

    const done = (result: { ok: true; pid: number } | { ok: false; reason: string }) => {
      if (resolved) return;
      resolved = true;
      try {
        sock.end();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timeout = setTimeout(() => done({ ok: false, reason: 'CONNECT_TIMEOUT' }), CONNECT_TIMEOUT_MS);

    const onAbort = () => done({ ok: false, reason: 'ABORTED' });
    signal?.addEventListener('abort', onAbort, { once: true });

    sock.on('connect', () => {
      clearTimeout(timeout);
      // Step 1 — client hello. Mirror the server's hello shape.
      const hello = JSON.stringify({
        t: 'hello',
        clientPid: process.pid,
        version: worker.cliVersion ?? '2.1.141'
      });
      try {
        sock.write(frame(FRAME_CTRL, hello));
      } catch (err) {
        done({ ok: false, reason: err instanceof Error ? err.message : String(err) });
        return;
      }
      // Step 2 — type the prompt body, then in a *separate* frame fire the
      // Enter keypress. Combining them into one PTY frame makes claude treat
      // the trailing \r as part of the typed text, leaving the message
      // sitting in the input box unsubmitted.
      const sendPrompt = () => {
        const text = prompt.replace(/\r?\n/g, ' ');
        try {
          sock.write(frame(FRAME_PTY, text));
        } catch (err) {
          done({ ok: false, reason: err instanceof Error ? err.message : String(err) });
          return;
        }
        setTimeout(() => {
          try {
            sock.write(frame(FRAME_PTY, '\r'));
          } catch {
            /* socket gone */
          }
          setTimeout(() => done({ ok: true, pid: worker.pid }), POST_PROMPT_HOLD_MS);
        }, PROMPT_TO_ENTER_MS);
      };
      setTimeout(sendPrompt, SETTLE_MS);
    });

    sock.on('error', (err) => {
      clearTimeout(timeout);
      done({ ok: false, reason: err.message });
    });

    sock.on('close', () => {
      // If we get here before sending, treat it as an error. The server
      // generally keeps the pipe open after our prompt frame, so a normal
      // post-prompt close also lands here after done() resolved.
      clearTimeout(timeout);
      if (!resolved) done({ ok: false, reason: 'CLOSED_EARLY' });
    });
  });
}

// ============================================================================
// Persistent agent-output tail. AgentView opens a long-lived rendezvous
// connection to the worker's pty pipe so it can observe everything claude
// renders on its TUI surface — used to detect inline permission prompts
// like "Do you want to create test.txt? 1. Yes / 2. ... / 3. No" that
// otherwise live entirely inside the daemon's terminal and are invisible
// to the desktop chat panel.
// ============================================================================

export interface AgentOutputHandle {
  close: () => void;
}

export function tailAgentOutput(
  sessionId: string,
  onText: (chunk: string) => void
): AgentOutputHandle {
  let closed = false;
  let sock: Socket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const open = async () => {
    if (closed) return;
    const worker = await findWorkerForSession(sessionId);
    if (!worker) {
      reconnectTimer = setTimeout(open, 1500);
      return;
    }
    try {
      sock = connect({ path: worker.ptySock });
    } catch {
      reconnectTimer = setTimeout(open, 1500);
      return;
    }
    let buf = Buffer.alloc(0);
    sock.on('connect', () => {
      try {
        const hello = JSON.stringify({
          t: 'hello',
          clientPid: process.pid,
          version: worker.cliVersion ?? '2.1.141'
        });
        sock!.write(frame(FRAME_CTRL, hello));
      } catch {
        /* will retry */
      }
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // Parse all complete frames present in buf
      while (buf.length >= 5) {
        const len = buf.readUInt32BE(0);
        if (buf.length < 5 + len) break;
        const type = buf[4];
        const payload = buf.slice(5, 5 + len);
        buf = buf.slice(5 + len);
        if (type === FRAME_PTY) {
          try {
            onText(payload.toString('utf8'));
          } catch {
            /* swallow listener errors */
          }
        }
      }
    });
    const reconnect = () => {
      if (sock) {
        try { sock.end(); } catch { /* ignore */ }
        sock = null;
      }
      if (closed) return;
      reconnectTimer = setTimeout(open, 1500);
    };
    sock.on('error', reconnect);
    sock.on('close', reconnect);
  };
  open();
  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (sock) {
        try { sock.end(); } catch { /* ignore */ }
      }
    }
  };
}
