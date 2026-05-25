import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildSelfPtyArgs, createSelfPtySpawn } from '../../dist/workers/self-pty.js';

test('buildSelfPtyArgs places positional prompt last after all flags', () => {
  const args = buildSelfPtyArgs({
    sessionId: 'sp111111-aaaa-bbbb-cccc-123456789abc',
    cwd: 'D:\\Project\\X',
    backend: 'external-claude',
    agent: 'claude',
    model: 'opus',
    name: 'Test',
    permissionMode: 'default',
    prompt: 'hello world',
  });
  assert.deepEqual(args, [
    '--session-id', 'sp111111-aaaa-bbbb-cccc-123456789abc',
    '--agent', 'claude',
    '--model', 'opus',
    '--name', 'Test',
    '--permission-mode', 'default',
    'hello world',
  ]);
});

test('buildSelfPtyArgs defaults permission-mode to bypassPermissions when blank', () => {
  const args = buildSelfPtyArgs({
    sessionId: 'sp222222-aaaa-bbbb-cccc-123456789abc',
    cwd: 'D:\\Project\\X',
    backend: 'external-claude',
    agent: 'claude',
    permissionMode: '   ',
  });
  assert.ok(args.includes('--permission-mode'));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
});

test('buildSelfPtyArgs omits prompt entirely when blank', () => {
  const args = buildSelfPtyArgs({
    sessionId: 'sp333333-aaaa-bbbb-cccc-123456789abc',
    cwd: 'D:\\Project\\X',
    backend: 'external-claude',
    prompt: '   ',
  });
  // Last arg should be the permission-mode value, NOT a blank prompt.
  assert.equal(args[args.length - 1], 'bypassPermissions');
});

test('createSelfPtySpawn forwards args to injected spawn and returns WorkerHandle', async () => {
  const calls = [];
  const fakePty = {
    pid: 77777,
    write: () => {},
    kill: () => {},
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
    resize: () => {},
    process: 'claude',
  };
  const fakeSpawn = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    return fakePty;
  };
  const selfPty = createSelfPtySpawn({
    resolveExe: () => 'C:/fake/claude.exe',
    spawn: fakeSpawn,
  });
  const handle = await selfPty({
    sessionId: 'sp444444-aaaa-bbbb-cccc-123456789abc',
    cwd: 'D:\\Project\\VisualAgents',
    backend: 'external-claude',
    agent: 'claude',
    model: 'opus',
    name: 'Boot test',
    permissionMode: 'default',
    prompt: 'hi',
  });
  assert.equal(handle.sessionId, 'sp444444-aaaa-bbbb-cccc-123456789abc');
  assert.equal(handle.pid, 77777);
  assert.equal(
    handle.conversationPath,
    join(homedir(), '.claude', 'projects', 'D--Project-VisualAgents', 'sp444444-aaaa-bbbb-cccc-123456789abc.jsonl')
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, 'C:/fake/claude.exe');
  assert.equal(calls[0].opts.cwd, 'D:\\Project\\VisualAgents');
  assert.equal(calls[0].opts.name, 'xterm-256color');
  assert.deepEqual(calls[0].args, [
    '--session-id', 'sp444444-aaaa-bbbb-cccc-123456789abc',
    '--agent', 'claude',
    '--model', 'opus',
    '--name', 'Boot test',
    '--permission-mode', 'default',
    'hi',
  ]);
});

test('createSelfPtySpawn WorkerHandle.send throws WORKER_DEAD for invalid pid', async () => {
  const fakePty = {
    pid: -1, // invalid pid → isProcessAlive returns false
    write: () => {},
    kill: () => {},
    onData: () => ({ dispose: () => {} }),
    onExit: () => ({ dispose: () => {} }),
    resize: () => {},
    process: 'claude',
  };
  const selfPty = createSelfPtySpawn({
    resolveExe: () => 'C:/fake/claude.exe',
    spawn: () => fakePty,
  });
  const handle = await selfPty({
    sessionId: 'sp555555-aaaa-bbbb-cccc-123456789abc',
    cwd: 'D:\\Project\\X',
    backend: 'external-claude',
  });
  await assert.rejects(() => handle.send('follow-up'), /WORKER_DEAD/);
});
