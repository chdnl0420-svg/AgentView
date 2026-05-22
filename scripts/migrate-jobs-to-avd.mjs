import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUSES = new Set(['running', 'idle', 'completed', 'crashed', 'unknown']);

export async function buildMigrationRecords({ jobsDir, cwdFallback = process.cwd() }) {
  const records = [];
  let entries;
  try {
    entries = await fs.readdir(jobsDir, { withFileTypes: true });
  } catch {
    return records;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statePath = join(jobsDir, entry.name, 'state.json');
    const state = await readJson(statePath);
    if (!state || typeof state !== 'object' || Array.isArray(state)) continue;
    records.push(toSessionRecord(entry.name, state, cwdFallback));
  }

  records.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return records;
}

export async function runMigration(argv = process.argv.slice(2), io = {}) {
  const options = parseArgs(argv);
  const jobsDir = options.jobsDir ?? join(homedir(), '.claude', 'jobs');
  const catalogPath = options.catalog ?? join(homedir(), '.agentview', 'daemon', 'state.json');
  const records = await buildMigrationRecords({
    jobsDir,
    cwdFallback: options.cwdFallback ?? process.cwd(),
  });
  const result = { applied: options.apply, catalogPath, jobsDir, records };

  if (options.apply) {
    await mergeCatalog(catalogPath, records);
  }

  const stdout = io.stdout ?? process.stdout;
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function parseArgs(argv) {
  const options = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--jobs-dir') {
      options.jobsDir = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg === '--catalog') {
      options.catalog = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg === '--cwd-fallback') {
      options.cwdFallback = requireValue(argv, ++i, arg);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function toSessionRecord(jobId, state, cwdFallback) {
  const sessionId = firstString(state.sessionId, state.session_id, state.id) ?? jobId;
  const record = {
    sessionId,
    backend: 'external-claude',
    cwd: firstString(state.cwd, state.workspace, state.worktreePath) ?? cwdFallback,
    startedAt: finiteNumber(state.startedAt) ?? finiteNumber(state.createdAt) ?? 0,
    status: normalizeStatus(state.status),
  };
  const pid = positiveInteger(state.pid);
  if (pid !== undefined) record.pid = pid;
  const name = firstString(state.name, state.title);
  if (name) record.name = name;
  const conversationPath = firstString(state.conversationPath, state.transcriptPath, state.logPath);
  if (conversationPath) record.conversationPath = conversationPath;
  return record;
}

function normalizeStatus(value) {
  if (value === 'done' || value === 'finished' || value === 'success') return 'completed';
  if (typeof value === 'string' && STATUSES.has(value)) return value;
  return 'unknown';
}

async function mergeCatalog(catalogPath, records) {
  const { Catalog } = await import('../avd/dist/catalog.js');
  const catalog = await Catalog.open(catalogPath);
  for (const record of records) {
    await catalog.add(record);
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  runMigration().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
