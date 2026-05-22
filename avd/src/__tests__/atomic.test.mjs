import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { writeJsonAtomic, readJson } from '../../dist/atomic.js';

function freshPath() {
  const dir = join(tmpdir(), `avd-atomic-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return { path: join(dir, 'data.json'), dir };
}

test('writeJsonAtomic round trip', async () => {
  const { path, dir } = freshPath();
  try {
    await writeJsonAtomic(path, { hello: 'world', n: 42 });
    const back = await readJson(path);
    assert.deepEqual(back, { hello: 'world', n: 42 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('parallel writes never corrupt the file', async () => {
  const { path, dir } = freshPath();
  try {
    const N = 25;
    await Promise.all(Array.from({ length: N }, (_, i) => writeJsonAtomic(path, { i })));
    // After parallel storms, the final file must be valid JSON with i in [0, N).
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(typeof parsed.i === 'number' && parsed.i >= 0 && parsed.i < N);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readJson returns null for missing file', async () => {
  const { path, dir } = freshPath();
  try {
    const r = await readJson(join(dir, 'nope.json'));
    assert.equal(r, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
