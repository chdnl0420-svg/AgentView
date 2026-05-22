// chunk-4 conversation tailer — tail(filePath, fromOffset) round trip
// + partial line hold + offset idempotency + unwatchFile cleanup.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tail, conversationByteSize, watchConversation, unwatchConversation } from '../../dist/conversation.js';

function freshFile() {
  const dir = join(tmpdir(), `avd-conv-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return { path: join(dir, 'session.jsonl'), dir };
}

test('tail returns appended bytes and advances offset', async () => {
  const { path, dir } = freshFile();
  try {
    writeFileSync(path, 'line-1\nline-2\n');
    const initial = await conversationByteSize(path);
    appendFileSync(path, 'line-3\n');
    const r = await tail(path, initial);
    assert.equal(r.data, 'line-3\n');
    assert.equal(r.nextOffset, initial + Buffer.byteLength('line-3\n'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tail holds back partial (incomplete) line until newline lands', async () => {
  const { path, dir } = freshFile();
  try {
    writeFileSync(path, 'complete\n');
    let off = await conversationByteSize(path);
    // Write half a line — no trailing newline yet.
    appendFileSync(path, 'half-of-');
    const r1 = await tail(path, off);
    assert.equal(r1.data, '', 'partial line must not be emitted');
    assert.equal(r1.nextOffset, off, 'offset must not advance past partial');
    // Now complete the line.
    appendFileSync(path, 'a-line\n');
    const r2 = await tail(path, off);
    assert.equal(r2.data, 'half-of-a-line\n');
    assert.equal(r2.nextOffset, off + Buffer.byteLength('half-of-a-line\n'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tail with offset at EOF returns empty data, same offset', async () => {
  const { path, dir } = freshFile();
  try {
    writeFileSync(path, 'a\nb\n');
    const size = await conversationByteSize(path);
    const r = await tail(path, size);
    assert.equal(r.data, '');
    assert.equal(r.nextOffset, size);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('watchConversation calls back on append, unwatchConversation stops further callbacks', async () => {
  const { path, dir } = freshFile();
  try {
    writeFileSync(path, 'seed\n');
    const calls = [];
    // Use short interval for the test (default is 500 ms in production).
    const handle = await watchConversation(path, (chunk) => { calls.push(chunk); }, { intervalMs: 50 });
    // Append after a brief delay so the poller has time to register a baseline stat.
    await new Promise((r) => setTimeout(r, 80));
    appendFileSync(path, 'new-data\n');
    // Wait long enough for the poller to fire at least once.
    await new Promise((r) => setTimeout(r, 250));
    unwatchConversation(handle);
    assert.ok(calls.length >= 1, `expected at least 1 callback, got ${calls.length}`);
    assert.equal(calls.join(''), 'new-data\n');
    // After unwatch, further appends must not be observed.
    const sealedAt = calls.length;
    appendFileSync(path, 'late\n');
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(calls.length, sealedAt, 'unwatch must stop the poller');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
