import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { buildMigrationRecords, runMigration } from '../migrate-jobs-to-avd.mjs';

const execFileAsync = promisify(execFile);

function freshRoot(tag) {
  const root = join(tmpdir(), `avd-migration-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeJob(jobsDir, id, state) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
  return dir;
}

test('buildMigrationRecords maps legacy Claude job state without mutating jobs', async () => {
  const root = freshRoot('dry');
  try {
    const jobsDir = join(root, '.claude', 'jobs');
    const jobDir = writeJob(jobsDir, 'job-a', {
      sessionId: 'legacy-a',
      cwd: 'D:/Project/VisualAgents',
      startedAt: 1710000000000,
      status: 'running',
      pid: 1234,
      name: 'legacy job',
      conversationPath: join(root, 'conversation.jsonl'),
    });

    const records = await buildMigrationRecords({ jobsDir, cwdFallback: root });

    assert.equal(records.length, 1);
    assert.deepEqual(records[0], {
      sessionId: 'legacy-a',
      backend: 'external-claude',
      cwd: 'D:/Project/VisualAgents',
      startedAt: 1710000000000,
      status: 'running',
      pid: 1234,
      name: 'legacy job',
      conversationPath: join(root, 'conversation.jsonl'),
    });
    assert.equal(existsSync(join(jobDir, 'state.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runMigration dry-run writes planned records to stdout and does not create catalog', async () => {
  const root = freshRoot('cli-dry');
  try {
    const jobsDir = join(root, 'jobs');
    const catalogPath = join(root, 'daemon', 'state.json');
    writeJob(jobsDir, 'job-b', { id: 'legacy-b', cwd: root, status: 'done' });
    const chunks = [];

    const result = await runMigration([
      '--jobs-dir', jobsDir,
      '--catalog', catalogPath,
      '--cwd-fallback', root,
    ], { stdout: { write: (chunk) => chunks.push(String(chunk)) } });

    assert.equal(result.applied, false);
    assert.equal(result.records.length, 1);
    assert.equal(existsSync(catalogPath), false);
    assert.match(chunks.join(''), /"sessionId": "legacy-b"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runMigration apply merges records and preserves existing AVD catalog sessions', async () => {
  const root = freshRoot('apply');
  try {
    const jobsDir = join(root, 'jobs');
    const catalogPath = join(root, 'daemon', 'state.json');
    mkdirSync(join(root, 'daemon'), { recursive: true });
    writeFileSync(catalogPath, JSON.stringify({
      version: 1,
      sessions: {
        'keep-me': {
          sessionId: 'keep-me',
          backend: 'codex',
          cwd: root,
          startedAt: 100,
          status: 'idle',
        },
      },
    }, null, 2), 'utf8');
    writeJob(jobsDir, 'job-c', { sessionId: 'legacy-c', cwd: root, startedAt: 200, status: 'crashed' });

    const result = await runMigration([
      '--jobs-dir', jobsDir,
      '--catalog', catalogPath,
      '--cwd-fallback', root,
      '--apply',
    ], { stdout: { write: () => {} } });
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

    assert.equal(result.applied, true);
    assert.equal(catalog.sessions['keep-me'].backend, 'codex');
    assert.equal(catalog.sessions['legacy-c'].backend, 'external-claude');
    assert.equal(existsSync(join(jobsDir, 'job-c', 'state.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent migration apply calls do not drop unrelated catalog sessions', async () => {
  const root = freshRoot('concurrent');
  try {
    const catalogPath = join(root, 'daemon', 'state.json');
    const runs = [];
    for (let i = 0; i < 8; i++) {
      const jobsDir = join(root, `jobs-${i}`);
      writeJob(jobsDir, `job-${i}`, {
        sessionId: `legacy-${i}`,
        cwd: root,
        startedAt: i + 1,
        status: 'running',
      });
      runs.push(runMigration([
        '--jobs-dir', jobsDir,
        '--catalog', catalogPath,
        '--cwd-fallback', root,
        '--apply',
      ], { stdout: { write: () => {} } }));
    }

    await Promise.all(runs);
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

    for (let i = 0; i < 8; i++) {
      assert.equal(catalog.sessions[`legacy-${i}`].backend, 'external-claude');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('separate migration processes do not drop unrelated catalog sessions', async () => {
  const root = freshRoot('processes');
  try {
    const catalogPath = join(root, 'daemon', 'state.json');
    const runs = [];
    for (let i = 0; i < 6; i++) {
      const jobsDir = join(root, `process-jobs-${i}`);
      writeJob(jobsDir, `job-${i}`, {
        sessionId: `process-legacy-${i}`,
        cwd: root,
        startedAt: i + 10,
        status: 'running',
      });
      runs.push(execFileAsync(process.execPath, [
        'scripts/migrate-jobs-to-avd.mjs',
        '--jobs-dir', jobsDir,
        '--catalog', catalogPath,
        '--cwd-fallback', root,
        '--apply',
      ], { cwd: process.cwd() }));
    }

    await Promise.all(runs);
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

    for (let i = 0; i < 6; i++) {
      assert.equal(catalog.sessions[`process-legacy-${i}`].backend, 'external-claude');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('autostart scripts default to dry-run and require explicit apply flags', () => {
  const win = readFileSync('scripts/avd-autostart-win.ps1', 'utf8');
  const mac = readFileSync('scripts/avd-autostart-mac.sh', 'utf8');
  const linux = readFileSync('scripts/avd-autostart-linux.sh', 'utf8');

  assert.match(win, /\[switch\]\$Apply/);
  assert.match(win, /schtasks/);
  assert.match(win, /Dry-run/);
  assert.match(mac, /--apply/);
  assert.match(mac, /launchctl/);
  assert.match(mac, /Dry-run/);
  assert.match(linux, /--apply/);
  assert.match(linux, /systemctl --user/);
  assert.match(linux, /Dry-run/);
  assert.match(mac, /xml_escape/);
  assert.match(linux, /systemd_quote/);
  assert.match(win, /Quote-TaskArg/);
});
