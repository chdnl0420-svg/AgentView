import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function makeStubPlugin() {
  return {
    name: 'session-runner-avd-stubs',
    setup(buildApi) {
      const stub = (name) => ({ path: name, namespace: 'stub' });
      buildApi.onResolve({ filter: /^node-pty$/ }, () => stub('node-pty'));
      buildApi.onResolve({ filter: /^\.\/daemonAttach$/ }, () => stub('daemonAttach'));
      buildApi.onResolve({ filter: /^\.\/claudePreflight$/ }, () => stub('claudePreflight'));
      buildApi.onResolve({ filter: /^\.\/workspaceStore$/ }, () => stub('workspaceStore'));
      buildApi.onResolve({ filter: /^\.\/git$/ }, () => stub('git'));
      buildApi.onResolve({ filter: /^\.\/ownedSessions$/ }, () => stub('ownedSessions'));
      buildApi.onResolve({ filter: /^\.\/avdClient$/ }, () => stub('avdClient'));
      buildApi.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
        const key = 'globalThis.__sessionRunnerAvdTest';
        const modules = {
          'node-pty': `
            import { EventEmitter } from 'node:events';
            export function spawn() {
              ${key}.ptySpawns++;
              const p = new EventEmitter();
              p.pid = ${key}.ptyPid ?? 4321;
              p.onData = (fn) => { p.on('data', fn); };
              p.onExit = (fn) => { p.on('exit', fn); };
              p.write = (text) => { ${key}.ptyWrites.push(text); };
              p.kill = () => { p.emit('exit', { exitCode: 0, signal: null }); };
              return p;
            }
          `,
          daemonAttach: `
            export async function sendToBackgroundAgent() {
              ${key}.sendToBackgroundCalls++;
              return { ok: false, reason: 'NO_PIPE' };
            }
          `,
          claudePreflight: `
            export async function checkClaudeStatus() {
              ${key}.checkStatusCalls++;
              return { cliPath: 'claude', daemonAlive: false };
            }
            export async function ensureDaemonRunning() {
              ${key}.ensureDaemonCalls++;
              return false;
            }
          `,
          workspaceStore: `
            export async function appendSessionEvent(sessionId, type, message) {
              ${key}.sessionEvents.push({ sessionId, type, message });
            }
            export async function updateSessionStatus(sessionId, status) {
              ${key}.statusUpdates.push({ sessionId, status });
            }
            export async function writeSessionDoc(doc) {
              ${key}.sessionDocs.push(doc);
            }
          `,
          git: `
            export async function createWorktree({ worktreePath }) {
              ${key}.worktreeCalls++;
              return worktreePath;
            }
          `,
          ownedSessions: `
            export async function rememberOwned(sessionId) {
              ${key}.owned.push(sessionId);
            }
          `,
          avdClient: `
            export async function createAvdClient() {
              ${key}.createAvdClientCalls++;
              return {
                startSession: async (input) => {
                  ${key}.avdStartCalls.push(input);
                  if (${key}.avdStartError) throw ${key}.avdStartError;
                  return ${key}.avdStartAck;
                },
                sendMessage: async (input) => {
                  ${key}.avdSendCalls.push(input);
                  if (${key}.avdSendError) throw ${key}.avdSendError;
                  return { ok: true, sessionId: input.sessionId, deliveredAt: Date.now() };
                },
                close: async () => { ${key}.avdCloseCalls++; },
              };
            }
          `,
        };
        return { contents: modules[args.path], loader: 'js' };
      });
    },
  };
}

async function loadSessionRunner(tmp) {
  const out = join(tmp, `sessionRunner-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  await build({
    entryPoints: ['src/main/sessionRunner.ts'],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    plugins: [makeStubPlugin()],
    logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
}

function resetState() {
  globalThis.__sessionRunnerAvdTest = {
    avdStartAck: { ok: true, sessionId: 'unused', pid: 9999 },
    avdStartError: null,
    avdStartCalls: [],
    avdSendCalls: [],
    avdSendError: null,
    avdCloseCalls: 0,
    checkStatusCalls: 0,
    createAvdClientCalls: 0,
    ensureDaemonCalls: 0,
    owned: [],
    ptyPid: 4321,
    ptySpawns: 0,
    ptyWrites: [],
    sendToBackgroundCalls: 0,
    sessionDocs: [],
    sessionEvents: [],
    statusUpdates: [],
    worktreeCalls: 0,
  };
  return globalThis.__sessionRunnerAvdTest;
}

async function withEnv(key, value, fn) {
  const old = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  }
}

test('backend=external-claude preserves custom agent in avd start request', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'session-runner-avd-external-agent-'));
  try {
    const state = resetState();
    state.avdStartAck = { ok: true, sessionId: 's-external', pid: 6789 };
    const { SessionRunner } = await loadSessionRunner(tmp);
    const runner = new SessionRunner();
    const result = await runner.startNewSession({
      prompt: 'use planner',
      cwd: tmp,
      backend: 'external-claude',
      agent: 'planner',
      name: 'External planner',
    });
    assert.equal(state.avdStartCalls.length, 1);
    assert.equal(state.avdStartCalls[0].backend, 'external-claude');
    assert.equal(state.avdStartCalls[0].agent, 'planner');
    assert.equal(state.avdStartCalls[0].prompt, 'use planner');
    assert.equal(state.ptySpawns, 0);
    assert.deepEqual(result, { sessionId: 's-external', pid: 6789 });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('backend=claude uses legacy Claude preflight and dispatch path', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'session-runner-legacy-'));
  try {
    const state = resetState();
    // Keep the legacy dispatch poll short by letting it miss the roster and then use the PTY stub.
    writeFileSync(join(tmp, 'noop.txt'), 'noop');
    await withEnv('USERPROFILE', tmp, async () => {
      const { SessionRunner } = await loadSessionRunner(tmp);
      const runner = new SessionRunner();
      const result = await runner.startNewSession({
        prompt: 'hello',
        cwd: tmp,
        backend: 'claude',
      });
      assert.equal(state.createAvdClientCalls, 0, 'avd must not be touched for backend=claude');
      assert.equal(state.checkStatusCalls, 1);
      assert.equal(state.ensureDaemonCalls, 1);
      assert.equal(state.ptySpawns, 1);
      assert.equal(result.pid, 4321);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('backend=avd routes to avd with default external-claude worker', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'session-runner-avd-dropdown-'));
  try {
    const state = resetState();
    state.avdStartAck = { ok: true, sessionId: 's-avd', pid: 7777 };
    const { SessionRunner } = await loadSessionRunner(tmp);
    const runner = new SessionRunner();
    const result = await runner.startNewSession({
      prompt: 'hi',
      cwd: tmp,
      backend: 'avd',
      name: 'A',
    });
    assert.equal(state.createAvdClientCalls, 1);
    assert.equal(state.avdStartCalls.length, 1);
    assert.equal(state.avdStartCalls[0].backend, 'external-claude');
    assert.equal(state.ptySpawns, 0);
    assert.deepEqual(result, { sessionId: 's-avd', pid: 7777 });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('backend=codex routes to avd with codex worker', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'session-runner-avd-codex-'));
  try {
    const state = resetState();
    state.avdStartAck = { ok: true, sessionId: 's-codex', pid: 8888 };
    const { SessionRunner } = await loadSessionRunner(tmp);
    const runner = new SessionRunner();
    const result = await runner.startNewSession({
      prompt: 'gen',
      cwd: tmp,
      backend: 'codex',
    });
    assert.equal(state.avdStartCalls.length, 1);
    assert.equal(state.avdStartCalls[0].backend, 'codex');
    assert.equal(state.ptySpawns, 0);
    assert.deepEqual(result, { sessionId: 's-codex', pid: 8888 });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('sendAvdMessage calls AvdClient.sendMessage and serializes through avdClient lifecycle', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'session-runner-avd-send-'));
  try {
    const state = resetState();
    state.avdStartAck = { ok: true, sessionId: 's-send', pid: 9000 };
    const { SessionRunner } = await loadSessionRunner(tmp);
    const runner = new SessionRunner();
    await runner.startNewSession({ prompt: 'first', cwd: tmp, backend: 'avd' });
    assert.equal(runner.knowsAvdSession('s-send'), true);
    await runner.sendAvdMessage('s-send', 'follow-up', 'bypassPermissions');
    assert.equal(state.avdSendCalls.length, 1);
    assert.equal(state.avdSendCalls[0].sessionId, 's-send');
    assert.equal(state.avdSendCalls[0].prompt, 'follow-up');
    assert.equal(state.avdSendCalls[0].permissionMode, 'bypassPermissions');
    // close() must be called even on success (resource cleanup) — one for
    // startSession and one for sendAvdMessage.
    assert.ok(state.avdCloseCalls >= 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
