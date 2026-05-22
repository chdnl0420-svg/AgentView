import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { Roster } from '../../dist/roster.js';

function freshPath() {
  const dir = join(tmpdir(), `avd-roster-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return { path: join(dir, 'roster.json'), dir };
}

test('register/unregister flow', async () => {
  const { path, dir } = freshPath();
  try {
    const r = await Roster.open(path);
    await r.register({ sessionId: 's1', pid: 1234, backend: 'claude' });
    const got = r.forSession('s1');
    assert.equal(got.pid, 1234);
    await r.unregister('s1');
    assert.equal(r.forSession('s1'), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('duplicate sessionId rejected (invariant)', async () => {
  const { path, dir } = freshPath();
  try {
    const r = await Roster.open(path);
    await r.register({ sessionId: 's1', pid: 1, backend: 'claude' });
    await assert.rejects(
      () => r.register({ sessionId: 's1', pid: 2, backend: 'claude' }),
      /already/i
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('list returns all workers', async () => {
  const { path, dir } = freshPath();
  try {
    const r = await Roster.open(path);
    await r.register({ sessionId: 'a', pid: 1, backend: 'claude' });
    await r.register({ sessionId: 'b', pid: 2, backend: 'codex' });
    const all = r.list();
    assert.equal(all.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('duplicate pid rejected across sessions (invariant)', async () => {
  const { path, dir } = freshPath();
  try {
    const r = await Roster.open(path);
    await r.register({ sessionId: 's1', pid: 4242, backend: 'claude' });
    await assert.rejects(
      () => r.register({ sessionId: 's2', pid: 4242, backend: 'codex' }),
      /pid 4242 already registered/i
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two Roster instances on the same file — second register sees the first', async () => {
  // This is the multi-instance race Codex HIGH-1 flagged: two Roster.open()
  // both load empty state; without re-reading inside the lock the second
  // register would happily land a duplicate sessionId on disk.
  const { path, dir } = freshPath();
  try {
    const a = await Roster.open(path);
    const b = await Roster.open(path);
    await a.register({ sessionId: 's1', pid: 1111, backend: 'claude' });
    await assert.rejects(
      () => b.register({ sessionId: 's1', pid: 2222, backend: 'codex' }),
      /already has a live worker/i
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('forSession returns defensive copy (external mutation does not leak)', async () => {
  const { path, dir } = freshPath();
  try {
    const r = await Roster.open(path);
    await r.register({ sessionId: 's1', pid: 7, backend: 'claude' });
    const got = r.forSession('s1');
    got.pid = 9999;
    const again = r.forSession('s1');
    assert.equal(again.pid, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects malformed entry at the boundary', async () => {
  const { path, dir } = freshPath();
  try {
    const r = await Roster.open(path);
    await assert.rejects(
      () => r.register({ sessionId: '', pid: 1, backend: 'claude' }),
      /sessionId/i
    );
    await assert.rejects(
      () => r.register({ sessionId: 's', pid: 1, backend: 'nope' }),
      /unknown backend/i
    );
    await assert.rejects(
      () => r.register({ sessionId: 's', pid: 1, backend: 'claude', startedAt: 'when' }),
      /startedAt/i
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects invalid pid (non-integer / non-positive)', async () => {
  const { path, dir } = freshPath();
  try {
    const r = await Roster.open(path);
    await assert.rejects(
      () => r.register({ sessionId: 's1', pid: 0, backend: 'claude' }),
      /positive integer/i
    );
    await assert.rejects(
      () => r.register({ sessionId: 's2', pid: -5, backend: 'claude' }),
      /positive integer/i
    );
    await assert.rejects(
      () => r.register({ sessionId: 's3', pid: 1.5, backend: 'claude' }),
      /positive integer/i
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
