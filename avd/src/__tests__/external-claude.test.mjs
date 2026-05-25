import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  ExternalClaudeAdapter,
  createWorkerFactory,
} from '../../dist/workers/index.js';

function freshRoot(tag) {
  const root = join(tmpdir(), `avd-external-claude-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('ExternalClaudeAdapter writes legacy dispatch payload, returns roster pid, and schedules prompt delivery', async () => {
  const root = freshRoot('success');
  try {
    const daemonDir = join(root, 'claude-daemon');
    const dispatchPath = join(daemonDir, 'dispatch', '12345678.json');
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
      sessionId: '12345678-aaaa-bbbb-cccc-123456789abc',
      cwd: root,
      backend: 'external-claude',
      agent: 'planner',
      prompt: 'Write the plan',
      name: 'Planner run',
      model: 'sonnet',
      permissionMode: 'plan',
    });

    await waitFor(() => existsSync(dispatchPath), 'dispatch payload');
    const payload = JSON.parse(readFileSync(dispatchPath, 'utf8'));
    assert.equal(payload.proto, 1);
    assert.equal(payload.short, '12345678');
    assert.match(payload.nonce, /^[0-9a-f]{8}$/);
    assert.equal(typeof payload.createdAt, 'number');
    assert.equal(payload.source, 'spare');
    assert.equal(payload.cwd, root);
    assert.deepEqual(payload.launch, {
      mode: 'prompt',
      args: [
        '--session-id',
        '12345678-aaaa-bbbb-cccc-123456789abc',
        '--agent',
        'planner',
        '--model',
        'sonnet',
        '--name',
        'Planner run',
        '--permission-mode',
        'plan',
      ],
    });
    assert.deepEqual(payload.env, {});
    assert.equal(payload.isolation, 'none');
    assert.deepEqual(payload.respawnFlags, ['--agent', 'planner']);
    assert.equal(payload.agent, 'planner');
    assert.deepEqual(payload.seed, { intent: 'Write the plan' });
    assert.equal(payload.cols, 120);
    assert.equal(payload.rows, 30);
    assert.equal(payload.name, 'Planner run');

    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(rosterPath, JSON.stringify({
      workers: {
        '12345678': {
          pid: process.pid,
          sessionId: '12345678-aaaa-bbbb-cccc-123456789abc',
          ptySock: join(root, 'pty.sock'),
          cliVersion: '2.1.141',
          cwd: root,
        },
      },
    }), 'utf8');

    const handle = await pending;
    assert.equal(handle.sessionId, '12345678-aaaa-bbbb-cccc-123456789abc');
    assert.equal(handle.pid, process.pid);
    await waitFor(() => delivered.length === 1, 'prompt delivery');
    assert.equal(delivered[0].prompt, 'Write the plan');
    assert.equal(delivered[0].worker.ptySock, join(root, 'pty.sock'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ExternalClaudeAdapter retries prompt delivery after roster appears before pty is ready', async () => {
  const root = freshRoot('retry');
  try {
    const daemonDir = join(root, 'claude-daemon');
    const rosterPath = join(daemonDir, 'roster.json');
    let attempts = 0;
    const adapter = new ExternalClaudeAdapter({
      daemonDir,
      pollIntervalMs: 5,
      maxPolls: 20,
      deliverySettleMs: 1,
      deliveryRetryMs: 1,
      deliveryMaxAttempts: 4,
      deliverPrompt: async () => {
        attempts++;
        if (attempts < 3) throw new Error('PIPE_NOT_READY');
      },
    });

    const pending = adapter.start({
      sessionId: '22345678-aaaa-bbbb-cccc-123456789abc',
      cwd: root,
      backend: 'external-claude',
      prompt: 'retry prompt',
    });
    await waitFor(() => existsSync(join(daemonDir, 'dispatch', '22345678.json')), 'dispatch payload');
    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(rosterPath, JSON.stringify({
      workers: {
        '22345678': {
          pid: process.pid,
          sessionId: '22345678-aaaa-bbbb-cccc-123456789abc',
          ptySock: join(root, 'retry.sock'),
          cwd: root,
        },
      },
    }), 'utf8');

    await pending;
    await waitFor(() => attempts === 3, 'prompt delivery retry');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ExternalClaudeAdapter ignores short-key roster entries for a different full sessionId', async () => {
  const root = freshRoot('mismatch');
  try {
    const daemonDir = join(root, 'claude-daemon');
    const adapter = new ExternalClaudeAdapter({
      daemonDir,
      pollIntervalMs: 5,
      maxPolls: 2,
      deliverPrompt: async () => {
        throw new Error('must not deliver to mismatched worker');
      },
    });
    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(join(daemonDir, 'roster.json'), JSON.stringify({
      workers: {
        '32345678': {
          pid: process.pid,
          sessionId: '32345678-different-session',
          ptySock: join(root, 'wrong.sock'),
          cwd: root,
        },
      },
    }), 'utf8');

    await assert.rejects(
      () => adapter.start({
        sessionId: '32345678-aaaa-bbbb-cccc-123456789abc',
        cwd: root,
        backend: 'external-claude',
        prompt: 'hello',
      }),
      /EXTERNAL_CLAUDE_UNAVAILABLE/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ExternalClaudeAdapter rejects when external daemon never registers worker', async () => {
  const root = freshRoot('timeout');
  try {
    const adapter = new ExternalClaudeAdapter({
      daemonDir: join(root, 'claude-daemon'),
      pollIntervalMs: 5,
      maxPolls: 2,
      deliverPrompt: async () => {
        throw new Error('should not deliver without roster worker');
      },
    });
    await assert.rejects(
      () => adapter.start({
        sessionId: '87654321-aaaa-bbbb-cccc-123456789abc',
        cwd: root,
        backend: 'external-claude',
        prompt: 'hello',
      }),
      /EXTERNAL_CLAUDE_UNAVAILABLE/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('createWorkerFactory routes external-claude and codex adapters', async () => {
  const externalCalls = [];
  const codexCalls = [];
  const factory = createWorkerFactory({
    externalClaude: {
      start: async (request) => {
        externalCalls.push(request);
        return {
          sessionId: request.sessionId,
          pid: process.pid,
          isAlive: () => true,
          stop: async () => {},
        };
      },
    },
    codex: {
      start: async (request) => {
        codexCalls.push(request);
        return {
          sessionId: request.sessionId,
          pid: process.pid,
          isAlive: () => true,
          stop: async () => {},
        };
      },
    },
  });

  const handle = await factory({
    sessionId: 's-ext',
    cwd: process.cwd(),
    backend: 'external-claude',
    prompt: 'hello',
  });
  assert.equal(handle.pid, process.pid);
  assert.equal(externalCalls.length, 1);

  const codexHandle = await factory({ sessionId: 's-codex', cwd: process.cwd(), backend: 'codex' });
  assert.equal(codexHandle.pid, process.pid);
  assert.equal(codexCalls.length, 1);

  await assert.rejects(
    () => factory({ sessionId: 's-claude', cwd: process.cwd(), backend: 'claude' }),
    /ADAPTER_UNAVAILABLE/
  );
});

test('createWorkerFactory forwards externalClaudeOptions to the default ExternalClaudeAdapter', async () => {
  const root = freshRoot('factory-opts');
  try {
    let selfPtyCalled = false;
    const factory = createWorkerFactory({
      externalClaudeOptions: {
        daemonDir: join(root, 'claude-daemon'),
        pollIntervalMs: 5,
        maxPolls: 1,
        selfPtySpawn: async (request) => {
          selfPtyCalled = true;
          return {
            sessionId: request.sessionId,
            pid: 54321,
            isAlive: () => true,
            stop: async () => {},
            send: async () => {},
          };
        },
      },
    });
    const handle = await factory({
      sessionId: 'fa222222-aaaa-bbbb-cccc-123456789abc',
      cwd: root,
      backend: 'external-claude',
      prompt: 'hello',
    });
    assert.equal(handle.pid, 54321);
    assert.equal(selfPtyCalled, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ExternalClaudeAdapter falls back to selfPtySpawn when external daemon never registers worker', async () => {
  const root = freshRoot('fallback');
  try {
    const selfPtyCalls = [];
    const adapter = new ExternalClaudeAdapter({
      daemonDir: join(root, 'claude-daemon'),
      pollIntervalMs: 5,
      maxPolls: 2,
      deliverPrompt: async () => {
        throw new Error('must not deliver via roster path when falling back');
      },
      selfPtySpawn: async (request) => {
        selfPtyCalls.push(request);
        return {
          sessionId: request.sessionId,
          pid: 99999,
          conversationPath: join(root, `${request.sessionId}.jsonl`),
          isAlive: () => true,
          stop: async () => {},
          send: async () => {},
        };
      },
    });
    const handle = await adapter.start({
      sessionId: 'fb111111-aaaa-bbbb-cccc-123456789abc',
      cwd: root,
      backend: 'external-claude',
      prompt: 'hello',
      agent: 'claude',
    });
    assert.equal(handle.pid, 99999);
    assert.equal(handle.sessionId, 'fb111111-aaaa-bbbb-cccc-123456789abc');
    assert.equal(handle.conversationPath, join(root, 'fb111111-aaaa-bbbb-cccc-123456789abc.jsonl'));
    assert.equal(selfPtyCalls.length, 1);
    assert.equal(selfPtyCalls[0].cwd, root);
    assert.equal(selfPtyCalls[0].prompt, 'hello');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
