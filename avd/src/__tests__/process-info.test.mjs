// chunk-5b — cross-platform process-info helper. Linux/macOS return
// {startTime,command}; Windows returns null (zombie detection deferred).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { platform } from 'node:os';
import { getProcessInfo } from '../../dist/process-info.js';

const IS_WINDOWS = platform() === 'win32';

test('self pid — Linux/macOS returns info; Windows returns null', async () => {
  const info = await getProcessInfo(process.pid);
  if (IS_WINDOWS) {
    assert.equal(info, null, 'Windows must null-fallback (chunk-5b scope)');
    return;
  }
  assert.ok(info, 'Linux/macOS must return non-null for self pid');
  assert.ok(typeof info.startTime === 'number', 'startTime must be a number (epoch ms)');
  // startTime should be very close to "now" since we just started the test
  // process. Use a generous 60s window so CI overhead does not flake.
  const now = Date.now();
  assert.ok(now - info.startTime < 60_000, `startTime ${info.startTime} too far behind now=${now}`);
  assert.ok(now - info.startTime > -5_000, 'startTime cannot be in the future');
  assert.ok(typeof info.command === 'string' && info.command.length > 0, 'command must be a non-empty string');
});

test('nonexistent pid returns null', async () => {
  // 2^31 - 1 is way past any sane PID.
  const info = await getProcessInfo(2147483647);
  assert.equal(info, null);
});

test('invalid pid (zero / negative / non-integer) returns null', async () => {
  assert.equal(await getProcessInfo(0), null);
  assert.equal(await getProcessInfo(-1), null);
  assert.equal(await getProcessInfo(1.5), null);
  assert.equal(await getProcessInfo(NaN), null);
});
