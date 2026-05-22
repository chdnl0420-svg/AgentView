// avd frame protocol — length-prefixed frames over a socket.
//
// Layout (network byte order):
//   <BE32 length><1 byte type><payload[length]>
//
// `length` covers ONLY the payload, not the type byte. A frame with
// length=0 is valid (signal-only frame). Mirrors the format already
// used by src/main/daemonAttach.ts so the client side can stay
// unchanged after chunk-4 wires the AgentView main to avd.

import { Buffer } from 'node:buffer';

/** Frame type discriminator. Single byte. */
export const FRAME_TYPE = {
  /** Raw PTY bytes (worker stdout/stderr stream). */
  PTY: 0,
  /** Control message (JSON payload). */
  CTRL: 1,
  /** Client handshake greeting. */
  HELLO: 2,
  /** Server handshake response. */
  WELCOME: 3,
  /** Server-side error notification. */
  ERR: 4,
} as const;

export type FrameTypeValue = (typeof FRAME_TYPE)[keyof typeof FRAME_TYPE];

const HEADER_BYTES = 5;
const MAX_PAYLOAD = 16 * 1024 * 1024; // 16 MiB defensive ceiling

/**
 * Encode a single frame. `payload` must be a Buffer; pass Buffer.alloc(0)
 * for signal-only frames.
 */
export function encodeFrame(type: FrameTypeValue, payload: Buffer): Buffer {
  if (payload.length > MAX_PAYLOAD) {
    throw new Error(`avd: payload exceeds ${MAX_PAYLOAD} bytes`);
  }
  const out = Buffer.alloc(HEADER_BYTES + payload.length);
  out.writeUInt32BE(payload.length, 0);
  out[4] = type;
  if (payload.length > 0) payload.copy(out, HEADER_BYTES);
  return out;
}

export interface DecodedFrame {
  type: number;
  payload: Buffer;
  /** Remaining bytes after the consumed frame (next frames or partial). */
  rest: Buffer;
}

/**
 * Try to decode one frame off the head of `buf`. Returns null when the
 * buffer does not yet contain a full frame (caller should buffer more).
 */
export function decodeFrame(buf: Buffer): DecodedFrame | null {
  if (buf.length < HEADER_BYTES) return null;
  const len = buf.readUInt32BE(0);
  if (len > MAX_PAYLOAD) {
    throw new Error(`avd: incoming frame length ${len} exceeds ${MAX_PAYLOAD}`);
  }
  const total = HEADER_BYTES + len;
  if (buf.length < total) return null;
  const type = buf[4]!;
  const payload = buf.subarray(HEADER_BYTES, total);
  const rest = buf.subarray(total);
  return { type, payload, rest };
}
