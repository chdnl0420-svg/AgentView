// Verifies that `scanSessions` merges entries from the avd catalog
// (`~/.agentview/daemon/state.json`) on top of the legacy
// `~/.claude/jobs/` scan, so codex / external-claude sessions that
// only live in the avd registry still appear in the dashboard.
//
// We override $HOME / $USERPROFILE to a temp dir so the scan only
// sees the catalog file we drop in, and stub `./hiddenSessions` to
// avoid touching real user state.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function makeStubPlugin() {
  return {
    name: 'session-scanner-stubs',
    setup(buildApi) {
      const stub = (name) => ({ path: name, namespace: 'stub' });
      buildApi.onResolve({ filter: /^\.\/hiddenSessions$/ }, () => stub('hiddenSessions'));
      buildApi.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
        const modules = {
          hiddenSessions: `
            export async function ensureHiddenLoaded() {
              return new Set();
            }
          `,
        };
        return { contents: modules[args.path], loader: 'js' };
      });
    },
  };
}

async function loadSessionScanner(tmp) {
  const out = join(
    tmp,
    `sessionScanner-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  await build({
    entryPoints: ['src/main/sessionScanner.ts'],
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

async function withHome(homePath, fn) {
  const keys = ['HOME', 'USERPROFILE'];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) process.env[k] = homePath;
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('scanSessions merges avd catalog entries not already in claude jobs', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'session-scanner-avd-merge-'));
  try {
    // Lay out the daemon catalog under .agentview/daemon/state.json.
    const daemonDir = join(tmp, '.agentview', 'daemon');
    mkdirSync(daemonDir, { recursive: true });
    const catalogPath = join(daemonDir, 'state.json');
    const catalog = {
      version: 1,
      sessions: {
        'sess-codex-1': {
          sessionId: 'sess-codex-1',
          backend: 'codex',
          cwd: 'C:/some/cwd',
          startedAt: 1700000000000,
          status: 'idle',
          name: 'codex run',
        },
        'sess-ext-1': {
          sessionId: 'sess-ext-1',
          backend: 'external-claude',
          cwd: 'C:/another/cwd',
          startedAt: 1700000050000,
          status: 'running',
          // pid intentionally absent — alive should fall through to false
        },
      },
    };
    writeFileSync(catalogPath, JSON.stringify(catalog), 'utf8');

    // No .claude/jobs/ directory exists in `tmp`, so the legacy scan
    // returns an empty session list. Only the avd merge should populate
    // `result.sessions`.
    await withHome(tmp, async () => {
      const { scanSessions } = await loadSessionScanner(tmp);
      const result = await scanSessions();
      const ids = result.sessions.map((s) => s.sessionId).sort();
      assert.deepEqual(ids, ['sess-codex-1', 'sess-ext-1']);
      const codex = result.sessions.find((s) => s.sessionId === 'sess-codex-1');
      assert.ok(codex);
      assert.equal(codex.entrypoint, 'avd');
      assert.equal(codex.agent, 'codex');
      assert.equal(codex.name, 'codex run');
      assert.equal(codex.metaPath, catalogPath);
      const ext = result.sessions.find((s) => s.sessionId === 'sess-ext-1');
      assert.ok(ext);
      assert.equal(ext.agent, 'external-claude');
      assert.equal(ext.alive, false, 'no pid → alive=false');
      // Default name falls back to first 8 chars of sessionId.
      assert.equal(ext.name, 'sess-ext');
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanSessions tolerates missing avd catalog file', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'session-scanner-no-catalog-'));
  try {
    // No catalog file, no jobs dir → empty result, no throw.
    await withHome(tmp, async () => {
      const { scanSessions } = await loadSessionScanner(tmp);
      const result = await scanSessions();
      assert.deepEqual(result.sessions, []);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanSessions tolerates malformed avd catalog JSON', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'session-scanner-bad-catalog-'));
  try {
    const daemonDir = join(tmp, '.agentview', 'daemon');
    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(join(daemonDir, 'state.json'), '{not valid json', 'utf8');
    await withHome(tmp, async () => {
      const { scanSessions } = await loadSessionScanner(tmp);
      const result = await scanSessions();
      // Malformed JSON is swallowed — scan returns empty rather than throws.
      assert.deepEqual(result.sessions, []);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
