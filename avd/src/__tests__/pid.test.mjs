// avd pid — atomic acquire / release tests.
// Loads compiled dist/pid.js.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { acquirePid, releasePid } from '../../dist/pid.js';

function freshPath() {
  const dir = join(tmpdir(), `avd-pid-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return { path: join(dir, 'avd.pid'), dir };
}

test('acquirePid creates pid file with own pid', async () => {
  const { path, dir } = freshPath();
  try {
    await acquirePid(path);
    assert.ok(existsSync(path));
    await releasePid(path);
    assert.ok(!existsSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('second acquirePid rejects when held by alive pid', async () => {
  const { path, dir } = freshPath();
  try {
    await acquirePid(path);
    await assert.rejects(() => acquirePid(path), /already running|alive/i);
    await releasePid(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquirePid overwrites stale (dead pid) file', async () => {
  const { path, dir } = freshPath();
  try {
    // Write a stale pid (1 is init/system — almost certainly not "us")
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, '999999\n', 'utf8'); // very unlikely pid
    await acquirePid(path);
    await releasePid(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
