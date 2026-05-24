import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { ExternalClaudeAdapter } from '../../dist/workers/index.js';

function freshRoot(tag) {
  const root = join(tmpdir(), `avd-ext-send-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('external-claude worker.send forwards follow-up prompts through the same delivery path', async () => {
  const root = freshRoot('forward');
  try {
    const daemonDir = join(root, 'claude-daemon');
    const rosterPath = join(daemonDir, 'roster.json');
    const delivered = [];
    const adapter = new ExternalClaudeAdapter({
      daemonDir,
      pollIntervalMs: 5,
      maxPolls: 40,
      deliverySettleMs: 1,
      deliveryRetryMs: 1,
      deliverPrompt: async (worker, prompt) => {
        delivered.push({ worker, prompt });
      },
    });

    const pending = adapter.start({
      sessionId: '42345678-aaaa-bbbb-cccc-123456789abc',
      cwd: root,
      backend: 'external-claude',
      prompt: 'initial prompt',
    });

    await waitFor(() => existsSync(join(daemonDir, 'dispatch', '42345678.json')), 'dispatch payload');
    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(rosterPath, JSON.stringify({
      workers: {
        '42345678': {
          pid: process.pid,
          sessionId: '42345678-aaaa-bbbb-cccc-123456789abc',
          ptySock: join(root, 'forward.sock'),
          cwd: root,
        },
      },
    }), 'utf8');

    const handle = await pending;
    await waitFor(() => delivered.length === 1, 'initial prompt delivery');
    assert.equal(delivered[0].prompt, 'initial prompt');
    assert.equal(delivered[0].worker.ptySock, join(root, 'forward.sock'));

    // Now exercise the follow-up path under test.
    assert.equal(typeof handle.send, 'function', 'WorkerHandle.send should be defined');
    await handle.send('follow-up message', { permissionMode: null });
    assert.equal(delivered.length, 2);
    assert.equal(delivered[1].prompt, 'follow-up message');
    assert.equal(delivered[1].worker.ptySock, join(root, 'forward.sock'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('external-claude worker.send retries through deliveryMaxAttempts', async () => {
  const root = freshRoot('retry');
  try {
    const daemonDir = join(root, 'claude-daemon');
    const rosterPath = join(daemonDir, 'roster.json');
    let initialAttempts = 0;
    let followUpAttempts = 0;
    let phase = 'initial';
    const adapter = new ExternalClaudeAdapter({
      daemonDir,
      pollIntervalMs: 5,
      maxPolls: 40,
      deliverySettleMs: 1,
      deliveryRetryMs: 1,
      deliveryMaxAttempts: 4,
      deliverPrompt: async () => {
        if (phase === 'initial') {
          initialAttempts++;
          if (initialAttempts < 2) throw new Error('PIPE_NOT_READY');
          return;
        }
        followUpAttempts++;
        if (followUpAttempts < 3) throw new Error('PIPE_NOT_READY');
      },
    });

    const pending = adapter.start({
      sessionId: '52345678-aaaa-bbbb-cccc-123456789abc',
      cwd: root,
      backend: 'external-claude',
      prompt: 'first',
    });
    await waitFor(() => existsSync(join(daemonDir, 'dispatch', '52345678.json')), 'dispatch payload');
    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(rosterPath, JSON.stringify({
      workers: {
        '52345678': {
          pid: process.pid,
          sessionId: '52345678-aaaa-bbbb-cccc-123456789abc',
          ptySock: join(root, 'retry-send.sock'),
          cwd: root,
        },
      },
    }), 'utf8');

    const handle = await pending;
    await waitFor(() => initialAttempts === 2, 'initial prompt retry');
    phase = 'followup';
    await handle.send('follow-up retry');
    assert.equal(followUpAttempts, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
