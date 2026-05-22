import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import {
  CodexAdapter,
  buildCodexCommand,
} from '../../dist/workers/index.js';

function freshRoot(tag) {
  const root = join(tmpdir(), `avd-codex-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('buildCodexCommand separates new session and resume command shapes', () => {
  const start = buildCodexCommand({
    sessionId: 's-new',
    cwd: 'C:\\work',
    backend: 'codex',
    prompt: 'secret prompt',
    model: 'gpt-5.3-codex',
  });
  assert.deepEqual(start.args, [
    'exec',
    '--json',
    '-C',
    'C:\\work',
    '--model',
    'gpt-5.3-codex',
    '-',
  ]);
  assert.equal(start.args.includes('secret prompt'), false);

  const resume = buildCodexCommand({
    sessionId: 's-resume',
    cwd: 'C:\\work',
    backend: 'codex',
    prompt: 'resume prompt',
    model: 'gpt-5.3-codex',
    resumeSessionId: 'native-session-123',
  });
  assert.deepEqual(resume.args, [
    'exec',
    'resume',
    '--json',
    '--model',
    'gpt-5.3-codex',
    'native-session-123',
    '-',
  ]);
  assert.equal(resume.args.includes('-C'), false);
  assert.equal(resume.args.includes('--sandbox'), false);
});

test('CodexAdapter writes complete JSONL lines, preserves malformed lines, and sends prompt via stdin', async () => {
  const root = freshRoot('stream');
  let handle;
  try {
    const fakeScript = join(root, 'fake-codex.cjs');
    const observedPath = join(root, 'observed.json');
    writeFileSync(fakeScript, `
const fs = require('node:fs');
const path = require('node:path');
const observed = path.join(process.cwd(), 'observed.json');
let stdin = '';
process.stdin.on('data', (chunk) => { stdin += chunk.toString('utf8'); });
process.stdin.on('end', () => {
  fs.writeFileSync(observed, JSON.stringify({ argv: process.argv.slice(2), stdin }), 'utf8');
  process.stdout.write('{"type":"session.started","session_id":"native-1"}\\n{"type"');
  setTimeout(() => {
    process.stdout.write(':"message","text":"hello"}\\nnot-json\\n{"type":"done"}\\n');
    setTimeout(() => process.exit(0), 20);
  }, 10);
});
`, 'utf8');

    const adapter = new CodexAdapter({
      codexBin: process.execPath,
      codexBaseArgs: [fakeScript],
      conversationDir: join(root, 'conversations'),
      killTimeoutMs: 25,
    });

    handle = await adapter.start({
      sessionId: 's-stream',
      cwd: root,
      backend: 'codex',
      prompt: 'hello from stdin',
    });

    assert.ok(handle.pid > 0);
    assert.equal(handle.sessionId, 's-stream');
    assert.equal(handle.conversationPath, join(root, 'conversations', 's-stream.jsonl'));

    await waitFor(() => existsSync(observedPath), 'fake codex observed input');
    const observed = JSON.parse(readFileSync(observedPath, 'utf8'));
    assert.deepEqual(observed.argv, [
      'exec',
      '--json',
      '-C',
      root,
      '-',
    ]);
    assert.equal(observed.stdin, 'hello from stdin');

    await waitFor(() => {
      if (!existsSync(handle.conversationPath)) return false;
      return readFileSync(handle.conversationPath, 'utf8').includes('{"type":"done"}\n');
    }, 'conversation JSONL output');
    const jsonl = readFileSync(handle.conversationPath, 'utf8');
    assert.equal(jsonl, [
      '{"type":"session.started","session_id":"native-1"}',
      '{"type":"message","text":"hello"}',
      'not-json',
      '{"type":"done"}',
      '',
    ].join('\n'));
    await waitFor(() => handle.isAlive() === false, 'fake codex child exit');
  } finally {
    if (handle) await handle.stop().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('CodexAdapter preserves UTF-8 characters split across stdout chunks', async () => {
  const root = freshRoot('utf8');
  let handle;
  try {
    const fakeScript = join(root, 'fake-codex-utf8.cjs');
    writeFileSync(fakeScript, `
const text = String.fromCharCode(0xd55c, 0xae00);
const line = Buffer.from(JSON.stringify({ type: 'message', text }) + '\\n', 'utf8');
const marker = Buffer.from(String.fromCharCode(0xd55c), 'utf8');
const split = line.indexOf(marker) + 1;
process.stdout.write(line.subarray(0, split));
setTimeout(() => {
  process.stdout.write(line.subarray(split));
  setTimeout(() => process.exit(0), 20);
}, 10);
`, 'utf8');

    const adapter = new CodexAdapter({
      codexBin: process.execPath,
      codexBaseArgs: [fakeScript],
      conversationDir: join(root, 'conversations'),
      killTimeoutMs: 25,
    });

    handle = await adapter.start({
      sessionId: 's-utf8',
      cwd: root,
      backend: 'codex',
      prompt: '',
    });

    const expected = JSON.stringify({
      type: 'message',
      text: String.fromCharCode(0xd55c, 0xae00),
    }) + '\n';

    await waitFor(() => {
      if (!existsSync(handle.conversationPath)) return false;
      return readFileSync(handle.conversationPath, 'utf8').endsWith('\n');
    }, 'split UTF-8 conversation JSONL output');

    const jsonl = readFileSync(handle.conversationPath, 'utf8');
    assert.equal(jsonl.includes('\ufffd'), false);
    assert.equal(jsonl, expected);
    assert.deepEqual(JSON.parse(jsonl), JSON.parse(expected));
    await waitFor(() => handle.isAlive() === false, 'fake codex UTF-8 child exit');
  } finally {
    if (handle) await handle.stop().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('CodexAdapter stop is idempotent and terminates a long-running child', async () => {
  const root = freshRoot('stop');
  try {
    const fakeScript = join(root, 'fake-codex-stop.cjs');
    writeFileSync(fakeScript, `
process.stdin.resume();
setInterval(() => {}, 1000);
`, 'utf8');
    const adapter = new CodexAdapter({
      codexBin: process.execPath,
      codexBaseArgs: [fakeScript],
      conversationDir: join(root, 'conversations'),
      killTimeoutMs: 25,
    });
    const handle = await adapter.start({
      sessionId: 's-stop',
      cwd: root,
      backend: 'codex',
      prompt: 'stay alive',
    });
    assert.equal(handle.isAlive(), true);
    await handle.stop();
    await handle.stop();
    await waitFor(() => handle.isAlive() === false, 'child exit after stop');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
