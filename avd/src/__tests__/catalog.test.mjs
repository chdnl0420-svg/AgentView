import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { Catalog } from '../../dist/catalog.js';

function freshPath() {
  const dir = join(tmpdir(), `avd-catalog-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return { path: join(dir, 'state.json'), dir };
}

test('add → get → list', async () => {
  const { path, dir } = freshPath();
  try {
    const cat = await Catalog.open(path);
    await cat.add({ sessionId: 's1', backend: 'claude', cwd: '/x', startedAt: 1, status: 'running' });
    const got = cat.get('s1');
    assert.equal(got.sessionId, 's1');
    assert.equal(got.backend, 'claude');
    const list = cat.list();
    assert.equal(list.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('update existing session', async () => {
  const { path, dir } = freshPath();
  try {
    const cat = await Catalog.open(path);
    await cat.add({ sessionId: 's2', backend: 'codex', cwd: '/y', startedAt: 0, status: 'running' });
    await cat.update('s2', { status: 'completed' });
    const got = cat.get('s2');
    assert.equal(got.status, 'completed');
    assert.equal(got.backend, 'codex'); // untouched fields preserved
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reload from disk preserves state', async () => {
  const { path, dir } = freshPath();
  try {
    const cat1 = await Catalog.open(path);
    await cat1.add({ sessionId: 'sa', backend: 'claude', cwd: '/a', startedAt: 0, status: 'running' });
    const cat2 = await Catalog.open(path);
    assert.equal(cat2.list().length, 1);
    assert.equal(cat2.get('sa').backend, 'claude');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('get/list return defensive copies (external mutation does not leak)', async () => {
  const { path, dir } = freshPath();
  try {
    const cat = await Catalog.open(path);
    await cat.add({ sessionId: 's', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running' });
    const got = cat.get('s');
    got.status = 'crashed';
    assert.equal(cat.get('s').status, 'running');
    const list = cat.list();
    list[0].cwd = '/mutated';
    assert.equal(cat.get('s').cwd, '/x');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects invalid backend', async () => {
  const { path, dir } = freshPath();
  try {
    const cat = await Catalog.open(path);
    await assert.rejects(
      () => cat.add({ sessionId: 's', backend: 'nope', cwd: '/x', startedAt: 0, status: 'running' }),
      /unknown backend/i
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects non-positive pid', async () => {
  const { path, dir } = freshPath();
  try {
    const cat = await Catalog.open(path);
    await assert.rejects(
      () => cat.add({ sessionId: 's', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running', pid: 0 }),
      /positive integer/i
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two Catalog instances on the same file — second add does not erase the first', async () => {
  // Codex pass2 HIGH-A: stale in-memory state of instance B must not
  // overwrite instance A's add. Fix: reload-inside-lock pattern.
  const { path, dir } = freshPath();
  try {
    const a = await Catalog.open(path);
    const b = await Catalog.open(path);
    await a.add({ sessionId: 's-a', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running' });
    await b.add({ sessionId: 's-b', backend: 'codex', cwd: '/y', startedAt: 1, status: 'running' });
    // Reopen — both records must be present on disk.
    const fresh = await Catalog.open(path);
    const ids = fresh.list().map((r) => r.sessionId).sort();
    assert.deepEqual(ids, ['s-a', 's-b']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects malformed record at the boundary', async () => {
  const { path, dir } = freshPath();
  try {
    const cat = await Catalog.open(path);
    await assert.rejects(
      () => cat.add({ sessionId: '', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running' }),
      /sessionId/i
    );
    await assert.rejects(
      () => cat.add({ sessionId: 's', backend: 'claude', cwd: '/x', startedAt: 'nope', status: 'running' }),
      /startedAt/i
    );
    await assert.rejects(
      () => cat.add({ sessionId: 's', backend: 'claude', cwd: '/x', startedAt: 0, status: 'gone' }),
      /unknown status/i
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects malformed patch at the boundary', async () => {
  const { path, dir } = freshPath();
  try {
    const cat = await Catalog.open(path);
    await cat.add({ sessionId: 's', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running' });
    await assert.rejects(
      () => cat.update('s', { status: 'banana' }),
      /unknown status/i
    );
    await assert.rejects(
      () => cat.update('s', { backend: 'nope' }),
      /unknown backend/i
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects unknown patch fields (allowlist) — JS caller cannot poison schema', async () => {
  // Codex pass3 MEDIUM-C: { startedAt: 'bad' } / { foo: 'bar' } must not
  // ride through `...patch` spread and corrupt the persisted record.
  const { path, dir } = freshPath();
  try {
    const cat = await Catalog.open(path);
    await cat.add({ sessionId: 's', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running' });
    await assert.rejects(
      () => cat.update('s', { startedAt: 'bad' }),
      /unknown field/i
    );
    await assert.rejects(
      () => cat.update('s', { foo: 'bar' }),
      /unknown field/i
    );
    // And the file must still pass the loader's shape check after the rejection.
    const cat2 = await Catalog.open(path);
    assert.equal(cat2.list().length, 1);
    assert.equal(cat2.get('s').startedAt, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('write failure does not leave memory and disk diverged', async () => {
  // Force a bad path (writing into a path whose parent is a regular file).
  const { path, dir } = freshPath();
  try {
    const cat = await Catalog.open(path);
    await cat.add({ sessionId: 's-ok', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running' });
    // Snapshot state on disk after the successful write.
    const beforeRaw = readFileSync(path, 'utf8');
    // Now attempt to add to a Catalog whose backing file lives under a
    // non-directory parent — should reject and *not* mutate in-memory state.
    const badPath = join(path, 'forbidden.json'); // path is a file, not a dir
    const cat2 = await Catalog.open(badPath);
    await assert.rejects(
      () => cat2.add({ sessionId: 's-x', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running' })
    );
    assert.equal(cat2.list().length, 0); // in-memory unchanged after failure
    // Original file untouched.
    assert.equal(readFileSync(path, 'utf8'), beforeRaw);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
