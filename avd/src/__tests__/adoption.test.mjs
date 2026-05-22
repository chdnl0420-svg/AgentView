// chunk-5 — adoption (dead-only cleanup). Verifies that
// dead workers are unregistered + catalog crashed, live ones stay.
// Zombie pid (OS-level reuse) detection deferred to chunk-5b.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { Catalog } from '../../dist/catalog.js';
import { Roster } from '../../dist/roster.js';
import { adoptLive } from '../../dist/adoption.js';

function freshPaths() {
  const dir = join(tmpdir(), `avd-adopt-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    rosterPath: join(dir, 'roster.json'),
    catalogPath: join(dir, 'state.json'),
  };
}

test('dead pid → unregister + catalog status=crashed', async () => {
  const { dir, rosterPath, catalogPath } = freshPaths();
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    await catalog.add({ sessionId: 's1', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running', pid: 1 });
    await roster.register({ sessionId: 's1', pid: 1, backend: 'claude' });
    // isAlive=false → s1 must be cleaned up.
    const result = await adoptLive({ roster, catalog, isAlive: () => false });
    assert.equal(result.cleaned.length, 1);
    assert.equal(result.cleaned[0].sessionId, 's1');
    assert.equal(result.kept.length, 0);
    assert.equal(roster.forSession('s1'), null);
    assert.equal(catalog.get('s1').status, 'crashed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('live pid → keep (catalog unchanged)', async () => {
  const { dir, rosterPath, catalogPath } = freshPaths();
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    await catalog.add({ sessionId: 's2', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running', pid: 2 });
    await roster.register({ sessionId: 's2', pid: 2, backend: 'claude' });
    const result = await adoptLive({ roster, catalog, isAlive: () => true });
    assert.equal(result.kept.length, 1);
    assert.equal(result.kept[0].sessionId, 's2');
    assert.equal(result.cleaned.length, 0);
    assert.equal(roster.forSession('s2').pid, 2);
    assert.equal(catalog.get('s2').status, 'running'); // unchanged
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('live pid + 오래된 startedAt → keep (zombie 오탐 차단)', async () => {
  const { dir, rosterPath, catalogPath } = freshPaths();
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    // startedAt 한참 과거 (1년 전) — chunk-5 는 그래도 isAlive=true 만 보고 keep 해야 함.
    const longAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    await catalog.add({ sessionId: 's3', backend: 'claude', cwd: '/x', startedAt: longAgo, status: 'running', pid: 3 });
    await roster.register({ sessionId: 's3', pid: 3, backend: 'claude', startedAt: longAgo });
    const result = await adoptLive({ roster, catalog, isAlive: () => true });
    assert.equal(result.kept.length, 1);
    assert.equal(result.cleaned.length, 0);
    assert.equal(catalog.get('s3').status, 'running'); // zombie 오탐 차단
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('roster 비어있음 → no-op', async () => {
  const { dir, rosterPath, catalogPath } = freshPaths();
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    const result = await adoptLive({ roster, catalog, isAlive: () => true });
    assert.equal(result.kept.length, 0);
    assert.equal(result.cleaned.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('catalog 에 sessionId 없으면 roster cleanup 만 (catalog 미수정)', async () => {
  const { dir, rosterPath, catalogPath } = freshPaths();
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    // roster 에만 등록 — catalog 에는 없음.
    await roster.register({ sessionId: 'orphan', pid: 99, backend: 'claude' });
    const result = await adoptLive({ roster, catalog, isAlive: () => false });
    assert.equal(result.cleaned.length, 1);
    assert.equal(roster.forSession('orphan'), null);
    assert.equal(catalog.list().length, 0); // catalog 미수정
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('동시 다수 dead pids → 모두 cleanup', async () => {
  const { dir, rosterPath, catalogPath } = freshPaths();
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    for (const sid of ['a', 'b', 'c']) {
      const pid = sid.charCodeAt(0);
      await catalog.add({ sessionId: sid, backend: 'claude', cwd: '/x', startedAt: 0, status: 'running', pid });
      await roster.register({ sessionId: sid, pid, backend: 'claude' });
    }
    const result = await adoptLive({ roster, catalog, isAlive: () => false });
    assert.equal(result.cleaned.length, 3);
    assert.equal(roster.list().length, 0);
    for (const sid of ['a', 'b', 'c']) {
      assert.equal(catalog.get(sid).status, 'crashed');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bootAdoption — Catalog.open + Roster.open + adoptLive complete before returning', async () => {
  // Codex pass1 MEDIUM-2 / pass2 MEDIUM-C: bootAdoption must finish all
  // reconciliation before any caller (daemon.ts main()) advances to
  // startServer. We inject `isAlive` so the assertion is deterministic.
  const { bootAdoption } = await import('../../dist/daemon.js');
  const { dir, rosterPath, catalogPath } = freshPaths();
  try {
    const seedCat = await Catalog.open(catalogPath);
    const seedRos = await Roster.open(rosterPath);
    await seedCat.add({ sessionId: 'live', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running', pid: 111 });
    await seedCat.add({ sessionId: 'dead', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running', pid: 222 });
    await seedRos.register({ sessionId: 'live', pid: 111, backend: 'claude' });
    await seedRos.register({ sessionId: 'dead', pid: 222, backend: 'claude' });
    // Deterministic: only pid 111 is "alive".
    const result = await bootAdoption({ catalogPath, rosterPath, isAlive: (pid) => pid === 111 });
    assert.equal(result.kept.length, 1, 'exactly 1 worker kept');
    assert.equal(result.kept[0].sessionId, 'live');
    assert.equal(result.cleaned.length, 1, 'exactly 1 worker cleaned');
    assert.equal(result.cleaned[0].sessionId, 'dead');
    // The on-disk state must reflect adoption *before* bootAdoption resolves
    // — anyone reading the roster/catalog after this point sees the
    // reconciled view that startServer should observe.
    const verifyCat = await Catalog.open(catalogPath);
    assert.equal(verifyCat.get('live').status, 'running');
    assert.equal(verifyCat.get('dead').status, 'crashed');
    const verifyRos = await Roster.open(rosterPath);
    assert.equal(verifyRos.forSession('live').pid, 111);
    assert.equal(verifyRos.forSession('dead'), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('catalog update happens before roster unregister (retry-safety on update failure)', async () => {
  // Codex pass2 MEDIUM-B: if catalog.update() fails, the roster row must
  // still be there so the next boot can retry. We force a catalog write
  // failure by pointing it at a directory we then turn into a file.
  const { dir, rosterPath } = freshPaths();
  // catalogPath is intentionally a path under a regular *file* parent —
  // any write attempt rejects with ENOTDIR.
  const catalogFile = join(dir, 'state.json');
  const catalogChildOfFile = join(catalogFile, 'forbidden.json');
  try {
    // First, create a real catalog file with our row + then make its parent
    // structure such that updateIfExists can still happen.
    const seedCat = await Catalog.open(catalogFile);
    const seedRos = await Roster.open(rosterPath);
    await seedCat.add({ sessionId: 'will-fail', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running', pid: 333 });
    await seedRos.register({ sessionId: 'will-fail', pid: 333, backend: 'claude' });
    // Now open a Catalog whose path is under a file (write impossible).
    // updateIfExists should reject — but it won't even hit that catalog
    // because the row is missing; instead, use the seeded catalog with
    // a stub that throws to simulate the disk failure.
    const failingCatalog = await Catalog.open(catalogFile);
    failingCatalog.updateIfExists = async () => { throw new Error('disk error'); };
    const failingAdopt = async () => {
      const { adoptLive } = await import('../../dist/adoption.js');
      return adoptLive({ catalog: failingCatalog, roster: seedRos, isAlive: () => false });
    };
    await assert.rejects(failingAdopt, /disk error/);
    // Roster row must still be there — proof that catalog runs first.
    assert.equal(seedRos.forSession('will-fail').pid, 333);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('adoptLive reads live disk for catalog (stale in-memory does not skip update)', async () => {
  // Codex pass2 MEDIUM-A: another Catalog instance may have added a row
  // that our `catalog.list()` snapshot does not see. updateIfExists
  // re-reads the live catalog inside its lock so we still flip status.
  const { dir, rosterPath, catalogPath } = freshPaths();
  try {
    const adoptCat = await Catalog.open(catalogPath);
    const otherCat = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    // 'adoptCat' starts with an empty in-memory list. The other catalog
    // adds 'late' — only on disk, not in adoptCat's snapshot.
    await otherCat.add({ sessionId: 'late', backend: 'claude', cwd: '/x', startedAt: 0, status: 'running', pid: 444 });
    await roster.register({ sessionId: 'late', pid: 444, backend: 'claude' });
    // adoptLive uses adoptCat — stale, but updateIfExists must still
    // catch the disk row.
    const { adoptLive } = await import('../../dist/adoption.js');
    await adoptLive({ catalog: adoptCat, roster, isAlive: () => false });
    // Verify on disk — `late` must be flipped to crashed despite the
    // stale in-memory snapshot.
    const verify = await Catalog.open(catalogPath);
    assert.equal(verify.get('late').status, 'crashed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('mixed live + dead — only dead get cleaned', async () => {
  const { dir, rosterPath, catalogPath } = freshPaths();
  try {
    const catalog = await Catalog.open(catalogPath);
    const roster = await Roster.open(rosterPath);
    for (const sid of ['live', 'dead']) {
      const pid = sid === 'live' ? 100 : 200;
      await catalog.add({ sessionId: sid, backend: 'claude', cwd: '/x', startedAt: 0, status: 'running', pid });
      await roster.register({ sessionId: sid, pid, backend: 'claude' });
    }
    const isAlive = (pid) => pid === 100; // only 'live' survives
    const result = await adoptLive({ roster, catalog, isAlive });
    assert.equal(result.kept.length, 1);
    assert.equal(result.cleaned.length, 1);
    assert.equal(result.kept[0].sessionId, 'live');
    assert.equal(result.cleaned[0].sessionId, 'dead');
    assert.equal(catalog.get('live').status, 'running');
    assert.equal(catalog.get('dead').status, 'crashed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
