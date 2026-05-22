// chunk-5b — Codex worker stub. fake-claude lifecycle + 'codex:' prefix.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnCodexStub, killCodexStub, isProcessAlive } from '../../dist/workers/codex-stub.js';

test('spawnCodexStub returns a live pid; kill marks it dead', async () => {
  const handle = await spawnCodexStub({ sessionId: 'task-1', sleepMs: 30_000 });
  assert.ok(handle.pid > 0);
  // sessionId is normalized with 'codex:' prefix so catalog rows can be
  // identified by backend without inspecting the catalog itself.
  assert.ok(handle.sessionId.startsWith('codex:'), `expected codex: prefix, got ${handle.sessionId}`);
  assert.equal(isProcessAlive(handle.pid), true);
  await killCodexStub(handle);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(isProcessAlive(handle.pid), false);
});

test('spawnCodexStub idempotent on prefix — already-prefixed sessionId stays', async () => {
  const handle = await spawnCodexStub({ sessionId: 'codex:foo', sleepMs: 30_000 });
  assert.equal(handle.sessionId, 'codex:foo');
  await killCodexStub(handle);
});
