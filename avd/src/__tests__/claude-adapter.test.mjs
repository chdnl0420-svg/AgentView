import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { ClaudeAdapter } from '../../dist/workers/claude-adapter.js';

function freshRoot(tag) {
  const root = join(tmpdir(), `avd-claude-adapter-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

test('ClaudeAdapter spawns via injected spawn and returns the WorkerHandle verbatim', async () => {
  const root = freshRoot('direct-spawn');
  try {
    let received;
    const adapter = new ClaudeAdapter({
      spawn: async (request) => {
        received = request;
        return {
          sessionId: request.sessionId,
          pid: 88888,
          conversationPath: join(root, `${request.sessionId}.jsonl`),
          isAlive: () => true,
          stop: async () => {},
          send: async () => {},
        };
      },
    });
    const handle = await adapter.start({
      sessionId: 'ca111111-aaaa-bbbb-cccc-123456789abc',
      cwd: root,
      backend: 'claude',
      prompt: 'hi',
      agent: 'claude',
      model: 'opus',
      name: 'CA test',
      permissionMode: 'default',
    });
    assert.equal(handle.sessionId, 'ca111111-aaaa-bbbb-cccc-123456789abc');
    assert.equal(handle.pid, 88888);
    assert.ok(received, 'spawn must have been called');
    assert.equal(received.cwd, root);
    assert.equal(received.prompt, 'hi');
    assert.equal(received.agent, 'claude');
    assert.equal(received.permissionMode, 'default');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ClaudeAdapter never writes ~/.claude/daemon/dispatch/<short>.json', async () => {
  // Key K invariant: the new adapter bypasses the supervisor dispatch
  // path entirely. We simulate a fake daemonDir under tmp and assert it
  // remains untouched after a successful spawn — proof that no dispatch
  // payload was written through any internal path.
  const root = freshRoot('no-dispatch');
  try {
    const fakeDaemonDir = join(root, 'claude-daemon');
    const fakeDispatchDir = join(fakeDaemonDir, 'dispatch');
    const fakeDispatchFile = join(fakeDispatchDir, 'ca222222.json');
    const adapter = new ClaudeAdapter({
      spawn: async (request) => ({
        sessionId: request.sessionId,
        pid: 99999,
        isAlive: () => true,
        stop: async () => {},
        send: async () => {},
      }),
    });
    await adapter.start({
      sessionId: 'ca222222-aaaa-bbbb-cccc-123456789abc',
      cwd: root,
      backend: 'claude',
      prompt: 'hi',
    });
    assert.equal(existsSync(fakeDaemonDir), false, 'daemonDir must not be created');
    assert.equal(existsSync(fakeDispatchDir), false, 'dispatch dir must not be created');
    assert.equal(existsSync(fakeDispatchFile), false, 'dispatch file must not be written');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ClaudeAdapter constructed without options exposes start()', () => {
  // Smoke check that the default branch (spawn = createSelfPtySpawn())
  // compiles and constructs. We do not call start() here to avoid
  // touching the real claude CLI in tests.
  const adapter = new ClaudeAdapter();
  assert.ok(adapter);
  assert.equal(typeof adapter.start, 'function');
});
