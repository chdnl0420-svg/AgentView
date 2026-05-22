// Fake worker spawn test — uses node -e to simulate a long-running CLI
// worker without depending on the real `claude` binary. Verifies that
// spawnFakeWorker returns a live pid and that killWorker cleans up.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnFakeWorker, killWorker, isProcessAlive } from '../../dist/workers/claude.js';

test('fake worker stays alive then dies on kill', async () => {
  const handle = await spawnFakeWorker({ sessionId: 's-fake', sleepMs: 30_000 });
  assert.ok(handle.pid > 0);
  assert.equal(isProcessAlive(handle.pid), true);
  await killWorker(handle);
  // Give the OS a moment to reap.
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(isProcessAlive(handle.pid), false);
});
