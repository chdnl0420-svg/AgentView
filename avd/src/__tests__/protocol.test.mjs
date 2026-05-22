// avd protocol — frame encode/decode tests.
// Loads compiled dist/protocol.js. RED phase: dist does not exist.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { encodeFrame, decodeFrame, FRAME_TYPE } from '../../dist/protocol.js';

test('encode→decode round trip for HELLO', () => {
  const payload = Buffer.from('hello', 'utf8');
  const buf = encodeFrame(FRAME_TYPE.HELLO, payload);
  const result = decodeFrame(buf);
  assert.ok(result);
  assert.equal(result.type, FRAME_TYPE.HELLO);
  assert.equal(result.payload.toString('utf8'), 'hello');
  assert.equal(result.rest.length, 0);
});

test('decode returns null for partial header', () => {
  const partial = Buffer.from([0x00, 0x00, 0x00]); // header is 5 bytes
  assert.equal(decodeFrame(partial), null);
});

test('decode returns null when payload incomplete', () => {
  // header says length=5 but payload only has 2 bytes
  const partial = Buffer.from([0x00, 0x00, 0x00, 0x05, 0x02, 0xAA, 0xBB]);
  assert.equal(decodeFrame(partial), null);
});

test('decode keeps remainder after a complete frame', () => {
  const frame1 = encodeFrame(FRAME_TYPE.HELLO, Buffer.from('A'));
  const frame2 = encodeFrame(FRAME_TYPE.WELCOME, Buffer.from('B'));
  const combined = Buffer.concat([frame1, frame2]);
  const r = decodeFrame(combined);
  assert.ok(r);
  assert.equal(r.payload.toString(), 'A');
  assert.equal(r.rest.length, frame2.length);
});

test('encode zero-length payload', () => {
  const buf = encodeFrame(FRAME_TYPE.ERR, Buffer.alloc(0));
  const r = decodeFrame(buf);
  assert.ok(r);
  assert.equal(r.type, FRAME_TYPE.ERR);
  assert.equal(r.payload.length, 0);
});
