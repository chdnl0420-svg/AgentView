// Conversation tailer — read appended bytes from a JSONL file by
// byte offset. Holds back partial (incomplete) lines until the next
// newline lands so callers always see complete records.
//
// chunk-4 ships fs.watchFile (interval 500ms) as the single watching
// strategy for platform consistency. fs.watch fallback is deferred to
// chunk-5+ if latency proves insufficient.

import { promises as fs, watchFile, unwatchFile } from 'node:fs';
import type { Stats } from 'node:fs';

export interface TailResult {
  data: string;
  nextOffset: number;
  sizeBytes: number;
}

/** Newline byte — we search at the buffer level, not the string level,
 *  so partial-multibyte UTF-8 writes can't shift the cut point. */
const LF = 0x0A;
const TAIL_SAMPLE = 64 * 1024; // bytes to scan when finding the last full-line offset

export async function conversationByteSize(filePath: string): Promise<number> {
  try {
    const s = await fs.stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

/**
 * Returns the byte offset of the start of the last *incomplete* line in the
 * file — i.e. the safe place to begin tailing so we never start in the
 * middle of a multibyte UTF-8 sequence. If the file ends with a newline this
 * is the file size; otherwise it is the byte position just after the most
 * recent newline.
 */
export async function safeStartOffset(filePath: string): Promise<number> {
  let size = 0;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return 0;
  }
  if (size === 0) return 0;
  const sample = Math.min(TAIL_SAMPLE, size);
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(sample);
    await fh.read(buf, 0, sample, size - sample);
    // Search the tail of the buffer for the last newline byte.
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i] === LF) {
        // Position right after the newline = start of the next line.
        return size - sample + i + 1;
      }
    }
    // No newline at all in the sampled tail; for safety, start from the file
    // beginning so we don't slice inside a multibyte char on the first read.
    return 0;
  } finally {
    await fh.close();
  }
}

export async function tail(filePath: string, fromOffset: number): Promise<TailResult> {
  const stat = await fs.stat(filePath);
  if (stat.size <= fromOffset) {
    return { data: '', nextOffset: stat.size, sizeBytes: stat.size };
  }
  const length = stat.size - fromOffset;
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, fromOffset);
    // Partial-line guard at the BYTE level — find the last LF inside the
    // buffer. This avoids `String#lastIndexOf('\n')` slicing inside a
    // multibyte UTF-8 char and also gives us an exact byte boundary so
    // `nextOffset` is a true byte position.
    const lastNlInBuf = buf.lastIndexOf(LF);
    if (lastNlInBuf === -1) {
      // No complete line yet — keep offset where it was so we re-read
      // these bytes once the line completes.
      return { data: '', nextOffset: fromOffset, sizeBytes: stat.size };
    }
    const completeBytes = buf.subarray(0, lastNlInBuf + 1);
    const data = completeBytes.toString('utf8');
    return {
      data,
      nextOffset: fromOffset + completeBytes.length,
      sizeBytes: stat.size,
    };
  } finally {
    await fh.close();
  }
}

export interface WatchOptions {
  /** Polling interval. Default 500 ms. Tests override with a shorter value. */
  intervalMs?: number;
}

export interface WatchHandle {
  filePath: string;
  /** Last byte offset emitted to the callback. */
  offset: number;
}

type TailCallback = (chunk: string, nextOffset: number) => void;

const handles = new WeakMap<WatchHandle, (cur: Stats, prev: Stats) => void>();

export async function watchConversation(
  filePath: string,
  cb: TailCallback,
  opts: WatchOptions = {}
): Promise<WatchHandle> {
  const interval = Math.max(50, opts.intervalMs ?? 500);
  // Start at the *safe* offset — never in the middle of a multibyte char.
  const initial = await safeStartOffset(filePath);
  const handle: WatchHandle = { filePath, offset: initial };
  let inFlight = false;
  const listener = (cur: Stats, prev: Stats): void => {
    if (cur.size === prev.size && cur.mtimeMs === prev.mtimeMs) return;
    if (inFlight) return;
    inFlight = true;
    tail(filePath, handle.offset)
      .then((r) => {
        if (r.data.length > 0) {
          handle.offset = r.nextOffset;
          cb(r.data, r.nextOffset);
        } else if (r.nextOffset !== handle.offset) {
          handle.offset = r.nextOffset;
        }
      })
      .catch(() => { /* swallow — the next poll retries */ })
      .finally(() => { inFlight = false; });
  };
  handles.set(handle, listener);
  watchFile(filePath, { interval, persistent: false }, listener);
  return handle;
}

export function unwatchConversation(handle: WatchHandle): void {
  const listener = handles.get(handle);
  if (!listener) return;
  unwatchFile(handle.filePath, listener);
  handles.delete(handle);
}
