// Tests for the avd-aware routing in `src/main/ipc/sessions.ts` IPC
// handlers (SessionsResume / SessionsCancel / SessionsFork — chunk-12).
//
// The handlers normally fall through:
//   1) runner.hasSession (local PTY)
//   2) isExternalSessionAlive (claude daemon)
//   3) runner.resumeSession (legacy fallback)
//
// chunk-12 adds a NEW first branch that short-circuits when
// `runner.knowsAvdSession(sid) === true`. These tests assert:
//
//   - that branch is taken when the runner reports an avd session,
//   - downstream legacy lookups are NOT performed,
//   - the error wrapping (`AVD_SEND_FAILED:`, `FORK_NOT_SUPPORTED:`) is stable,
//   - `CANCEL_NOT_IMPLEMENTED` from chunk-10's not-yet-implemented cancel
//     falls back to the legacy path instead of bubbling out.
//
// Strategy: bundle `src/main/ipc/sessions.ts` with esbuild, with stub
// modules for every dependency it imports. The `electron` stub captures
// `ipcMain.handle(channel, fn)` into a Map so the test can invoke the
// handler directly with mock IPC args.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KEY = 'globalThis.__ipcSessionsAvdRoutingTest';

function makeStubPlugin() {
  return {
    name: 'ipc-sessions-stubs',
    setup(buildApi) {
      const stub = (name) => ({ path: name, namespace: 'stub' });
      buildApi.onResolve({ filter: /^electron$/ }, () => stub('electron'));
      buildApi.onResolve({ filter: /^\.\.\/sessionScanner$/ }, () => stub('sessionScanner'));
      buildApi.onResolve({ filter: /^\.\.\/daemonAttach$/ }, () => stub('daemonAttach'));
      buildApi.onResolve({ filter: /^\.\.\/promptDetector$/ }, () => stub('promptDetector'));
      buildApi.onResolve({ filter: /^\.\.\/ownedSessions$/ }, () => stub('ownedSessions'));
      buildApi.onResolve({ filter: /^\.\.\/hiddenSessions$/ }, () => stub('hiddenSessions'));
      buildApi.onResolve({ filter: /^\.\.\/claudePreflight$/ }, () => stub('claudePreflight'));
      buildApi.onResolve({ filter: /^\.\.\/workspaceStore$/ }, () => stub('workspaceStore'));
      buildApi.onResolve({ filter: /^\.\.\/conversationLoader$/ }, () => stub('conversationLoader'));
      buildApi.onResolve({ filter: /^\.\/broadcast$/ }, () => stub('broadcast'));
      buildApi.onResolve({ filter: /^\.\/loaders$/ }, () => stub('loaders'));
      buildApi.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
        const modules = {
          electron: `
            export const ipcMain = {
              handle(channel, fn) {
                ${KEY}.handlers.set(channel, fn);
              },
            };
            export const shell = {
              showItemInFolder() {},
            };
          `,
          sessionScanner: `
            export async function isExternalSessionAlive(sessionId) {
              ${KEY}.isExternalAliveCalls.push(sessionId);
              return ${KEY}.externalAlive;
            }
            export async function externalSessionState() {
              return null;
            }
            export async function scanSessions() {
              return { sessions: [], hidden: [] };
            }
          `,
          daemonAttach: `
            export async function sendToBackgroundAgent(sessionId, prompt) {
              ${KEY}.sendToBackgroundCalls.push({ sessionId, prompt });
              return { ok: false, reason: 'NO_PIPE' };
            }
            export async function sendKeyToBackgroundAgent() {
              return { ok: true };
            }
            export function tailAgentOutput() {
              return { close() {} };
            }
          `,
          promptDetector: `
            export class PromptScanner {
              ingest() { return null; }
              reset() {}
            }
          `,
          ownedSessions: `
            export async function ensureOwnedLoaded() { return new Set(); }
          `,
          hiddenSessions: `
            export async function markHidden() {}
          `,
          claudePreflight: `
            export async function checkClaudeStatus() {
              return { cliPath: null, daemonAlive: false };
            }
            export async function ensureDaemonRunning() { return false; }
          `,
          workspaceStore: `
            export async function appendSessionEvent(sessionId, type, message) {
              ${KEY}.sessionEvents.push({ sessionId, type, message });
            }
          `,
          conversationLoader: `
            export async function readConversation() { return null; }
          `,
          broadcast: `
            export function broadcast() {}
          `,
          loaders: `
            export async function loadAgents() { return []; }
          `,
        };
        return { contents: modules[args.path], loader: 'js' };
      });
    },
  };
}

async function loadIpcSessions(tmp) {
  const out = join(
    tmp,
    `ipcSessions-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  await build({
    entryPoints: ['src/main/ipc/sessions.ts'],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    plugins: [makeStubPlugin()],
    alias: {
      '@shared': resolve('src/shared'),
    },
    logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
}

function resetState() {
  globalThis.__ipcSessionsAvdRoutingTest = {
    handlers: new Map(),
    externalAlive: false,
    isExternalAliveCalls: [],
    sendToBackgroundCalls: [],
    sessionEvents: [],
  };
  return globalThis.__ipcSessionsAvdRoutingTest;
}

/** Build a mock SessionRunner where each method is opt-in spy. */
function makeMockRunner(overrides = {}) {
  const calls = {
    knowsAvdSession: [],
    sendAvdMessage: [],
    cancelAvdSession: [],
    forgetAvdSession: [],
    getAvdSession: [],
    hasSession: [],
    resumeSession: [],
    forkSession: [],
    cancel: [],
  };
  const runner = {
    knowsAvdSession(sid) {
      calls.knowsAvdSession.push(sid);
      return overrides.knowsAvdSession ? overrides.knowsAvdSession(sid) : false;
    },
    async sendAvdMessage(sid, prompt, permissionMode) {
      calls.sendAvdMessage.push({ sid, prompt, permissionMode });
      if (overrides.sendAvdMessage) return overrides.sendAvdMessage(sid, prompt, permissionMode);
    },
    async cancelAvdSession(sid) {
      calls.cancelAvdSession.push(sid);
      if (overrides.cancelAvdSession) return overrides.cancelAvdSession(sid);
      return false;
    },
    forgetAvdSession(sid) {
      calls.forgetAvdSession.push(sid);
    },
    getAvdSession(sid) {
      calls.getAvdSession.push(sid);
      if (overrides.getAvdSession) return overrides.getAvdSession(sid);
      return null;
    },
    hasSession(sid) {
      calls.hasSession.push(sid);
      return overrides.hasSession ? overrides.hasSession(sid) : false;
    },
    async resumeSession(input) {
      calls.resumeSession.push(input);
      if (overrides.resumeSession) return overrides.resumeSession(input);
      return { sessionId: input.sessionId, pid: null };
    },
    forkSession(input) {
      calls.forkSession.push(input);
      if (overrides.forkSession) return overrides.forkSession(input);
      return { sessionId: 'new', pid: 99, forkedFrom: input.sessionId };
    },
    cancel(sid) {
      calls.cancel.push(sid);
      if (overrides.cancel) return overrides.cancel(sid);
      return false;
    },
    pidsBySession() { return new Map(); },
    activePids() { return new Set(); },
    startNewSession() { return Promise.resolve({ sessionId: 'x', pid: null }); },
  };
  return { runner, calls };
}

function makeLiveWatcher() {
  return {
    async watchConversation() {},
    unwatchConversation() {},
  };
}

async function setup(overrides) {
  const tmp = mkdtempSync(join(tmpdir(), 'ipc-sessions-avd-routing-'));
  const state = resetState();
  const mod = await loadIpcSessions(tmp);
  const { runner, calls } = makeMockRunner(overrides);
  mod.registerSessions({
    runner,
    liveWatcher: makeLiveWatcher(),
    runningList: () => [],
  });
  return { tmp, state, calls, handlers: state.handlers };
}

function cleanup(tmp) {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// SessionsResume
// ---------------------------------------------------------------------------

test('SessionsResume: avd-tracked session routes to sendAvdMessage and skips legacy paths', async () => {
  const { tmp, state, calls, handlers } = await setup({
    knowsAvdSession: (sid) => sid === 's-avd',
    getAvdSession: (sid) => (sid === 's-avd' ? { sessionId: sid, pid: 4242, backend: 'codex', cwd: '/x', startedAt: 0 } : null),
  });
  try {
    const handler = handlers.get('sessions:resume');
    assert.ok(handler, 'sessions:resume handler not registered');
    const result = await handler({}, {
      sessionId: 's-avd',
      prompt: 'follow up',
      permissionMode: 'bypassPermissions',
    });
    assert.equal(calls.sendAvdMessage.length, 1);
    assert.deepEqual(calls.sendAvdMessage[0], {
      sid: 's-avd',
      prompt: 'follow up',
      permissionMode: 'bypassPermissions',
    });
    // Critical: legacy lookups MUST NOT run when avd branch wins.
    assert.equal(calls.hasSession.length, 0);
    assert.equal(state.isExternalAliveCalls.length, 0);
    assert.equal(calls.resumeSession.length, 0);
    // Returned pid comes from getAvdSession.
    assert.deepEqual(result, { sessionId: 's-avd', pid: 4242 });
  } finally {
    cleanup(tmp);
  }
});

test('SessionsResume: non-avd session falls through to legacy resumeSession when hasSession=true', async () => {
  const { tmp, calls, handlers } = await setup({
    knowsAvdSession: () => false,
    hasSession: (sid) => sid === 's-legacy',
    resumeSession: (input) => ({ sessionId: input.sessionId, pid: 1111 }),
  });
  try {
    const handler = handlers.get('sessions:resume');
    const result = await handler({}, {
      sessionId: 's-legacy',
      prompt: 'hi',
      permissionMode: null,
    });
    assert.equal(calls.sendAvdMessage.length, 0, 'avd send must NOT be called');
    assert.equal(calls.hasSession.length, 1);
    assert.equal(calls.resumeSession.length, 1);
    assert.deepEqual(result, { sessionId: 's-legacy', pid: 1111 });
  } finally {
    cleanup(tmp);
  }
});

test('SessionsResume: when sendAvdMessage throws, wraps with AVD_SEND_FAILED prefix', async () => {
  const { tmp, handlers } = await setup({
    knowsAvdSession: () => true,
    sendAvdMessage: async () => {
      throw new Error('socket disconnected');
    },
  });
  try {
    const handler = handlers.get('sessions:resume');
    await assert.rejects(
      handler({}, {
        sessionId: 's-avd',
        prompt: 'p',
        permissionMode: null,
      }),
      (err) => err instanceof Error && err.message.startsWith('AVD_SEND_FAILED:') && /socket disconnected/.test(err.message),
    );
  } finally {
    cleanup(tmp);
  }
});

// ---------------------------------------------------------------------------
// SessionsCancel
// ---------------------------------------------------------------------------

test('SessionsCancel: avd-tracked session routes to cancelAvdSession and forgets on success', async () => {
  const { tmp, calls, handlers } = await setup({
    knowsAvdSession: (sid) => sid === 's-avd',
    cancelAvdSession: async () => true,
  });
  try {
    const handler = handlers.get('sessions:cancel');
    const result = await handler({}, 's-avd');
    assert.equal(calls.cancelAvdSession.length, 1);
    assert.equal(calls.cancelAvdSession[0], 's-avd');
    assert.equal(calls.forgetAvdSession.length, 1, 'session must be forgotten after successful cancel');
    assert.equal(result, true);
    // Legacy paths must not run.
    assert.equal(calls.hasSession.length, 0);
    assert.equal(calls.cancel.length, 0);
  } finally {
    cleanup(tmp);
  }
});

test('SessionsCancel: CANCEL_NOT_IMPLEMENTED falls through to legacy path instead of throwing', async () => {
  const { tmp, state, calls, handlers } = await setup({
    knowsAvdSession: (sid) => sid === 's-avd',
    cancelAvdSession: async () => {
      throw new Error('CANCEL_NOT_IMPLEMENTED: chunk-10 will add cancel-session CTRL');
    },
    hasSession: () => false,
  });
  state.externalAlive = false;
  try {
    const handler = handlers.get('sessions:cancel');
    // Should resolve (not throw). Because hasSession=false and externalAlive=false,
    // the legacy path returns false.
    const result = await handler({}, 's-avd');
    assert.equal(calls.cancelAvdSession.length, 1);
    // forget must NOT be called when cancel didn't succeed.
    assert.equal(calls.forgetAvdSession.length, 0);
    // Legacy path was reached.
    assert.equal(calls.hasSession.length, 1);
    assert.equal(result, false);
  } finally {
    cleanup(tmp);
  }
});

test('SessionsCancel: non-CANCEL_NOT_IMPLEMENTED errors wrap with AVD_CANCEL_FAILED prefix', async () => {
  const { tmp, handlers } = await setup({
    knowsAvdSession: () => true,
    cancelAvdSession: async () => {
      throw new Error('something else broke');
    },
  });
  try {
    const handler = handlers.get('sessions:cancel');
    await assert.rejects(
      handler({}, 's-avd'),
      (err) => err instanceof Error && err.message.startsWith('AVD_CANCEL_FAILED:') && /something else broke/.test(err.message),
    );
  } finally {
    cleanup(tmp);
  }
});

// ---------------------------------------------------------------------------
// SessionsFork
// ---------------------------------------------------------------------------

test('SessionsFork: avd-tracked session throws FORK_NOT_SUPPORTED with stable prefix', async () => {
  const { tmp, calls, handlers } = await setup({
    knowsAvdSession: (sid) => sid === 's-avd',
  });
  try {
    const handler = handlers.get('sessions:fork');
    await assert.rejects(
      handler({}, { sessionId: 's-avd', prompt: 'x', permissionMode: null }),
      (err) => err instanceof Error && err.message.startsWith('FORK_NOT_SUPPORTED:'),
    );
    // forkSession on the runner must NOT be called.
    assert.equal(calls.forkSession.length, 0);
  } finally {
    cleanup(tmp);
  }
});

test('SessionsFork: non-avd session falls through to runner.forkSession', async () => {
  const { tmp, calls, handlers } = await setup({
    knowsAvdSession: () => false,
    forkSession: (input) => ({ sessionId: 'new-uuid', pid: 7, forkedFrom: input.sessionId }),
  });
  try {
    const handler = handlers.get('sessions:fork');
    const result = await handler({}, { sessionId: 's-legacy', prompt: 'x', permissionMode: null });
    assert.equal(calls.forkSession.length, 1);
    assert.deepEqual(result, { sessionId: 'new-uuid', pid: 7, forkedFrom: 's-legacy' });
  } finally {
    cleanup(tmp);
  }
});
