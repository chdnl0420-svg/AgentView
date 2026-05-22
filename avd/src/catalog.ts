// Session catalog — the avd-side representation of every Session the
// daemon knows about. Persisted as state.json under
// ~/.agentview/daemon/. Mutations run inside withFileLock so we can
// (a) reload on-disk truth before merging (defeats stale state from
// another Catalog instance on the same file), and (b) snapshot the
// next state, persist it, then commit to memory so a failed write
// never leaves memory and disk diverged.

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { readJson, withFileLock } from './atomic.js';

export type BackendKind = 'claude' | 'external-claude' | 'codex';
export type SessionStatus = 'running' | 'idle' | 'completed' | 'crashed' | 'unknown';

const SESSION_STATUSES: ReadonlySet<SessionStatus> = new Set([
  'running', 'idle', 'completed', 'crashed', 'unknown',
] as const);
const BACKENDS: ReadonlySet<BackendKind> = new Set([
  'claude', 'external-claude', 'codex',
] as const);

export interface SessionRecord {
  sessionId: string;
  backend: BackendKind;
  cwd: string;
  startedAt: number;
  status: SessionStatus;
  pid?: number;
  name?: string;
  conversationPath?: string;
  updatedAt?: number;
}

/** Patch fields allowed via `update()` — narrower than full record. */
export type SessionPatch = Partial<Pick<
  SessionRecord,
  'backend' | 'cwd' | 'status' | 'pid' | 'name' | 'conversationPath'
>>;

const PATCH_ALLOWED_KEYS = new Set<keyof SessionPatch>([
  'backend', 'cwd', 'status', 'pid', 'name', 'conversationPath',
]);

/** Drop any keys not in the allowlist so a stray `{ startedAt: 'bad' }`
 *  from a JS caller cannot poison the on-disk schema. */
function pickPatch(patch: SessionPatch): SessionPatch {
  const out: SessionPatch = {};
  for (const key of Object.keys(patch) as Array<keyof SessionPatch>) {
    if (PATCH_ALLOWED_KEYS.has(key)) {
      // Index-narrowing copy — Object.assign keeps the value's runtime type.
      (out as Record<string, unknown>)[key] = patch[key] as unknown;
    }
  }
  return out;
}

interface CatalogFile {
  version: 1;
  sessions: Record<string, SessionRecord>;
}

const EMPTY: CatalogFile = { version: 1, sessions: {} };

function isSessionRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === 'string' &&
    typeof r.backend === 'string' && BACKENDS.has(r.backend as BackendKind) &&
    typeof r.cwd === 'string' &&
    typeof r.startedAt === 'number' &&
    typeof r.status === 'string' && SESSION_STATUSES.has(r.status as SessionStatus) &&
    (r.pid === undefined || (typeof r.pid === 'number' && Number.isInteger(r.pid) && r.pid > 0))
  );
}

function isCatalogFile(value: unknown): value is CatalogFile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (!v.sessions || typeof v.sessions !== 'object') return false;
  for (const rec of Object.values(v.sessions as Record<string, unknown>)) {
    if (!isSessionRecord(rec)) return false;
  }
  return true;
}

/** Runtime validation for caller-supplied records — fails early at the boundary. */
function assertValidRecord(record: SessionRecord): void {
  if (!record || typeof record !== 'object') {
    throw new Error('catalog: record must be an object');
  }
  if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) {
    throw new Error('catalog: sessionId must be a non-empty string');
  }
  if (typeof record.backend !== 'string' || !BACKENDS.has(record.backend)) {
    throw new Error(`catalog: unknown backend ${String(record.backend)}`);
  }
  if (typeof record.cwd !== 'string') {
    throw new Error('catalog: cwd must be a string');
  }
  if (typeof record.startedAt !== 'number' || !Number.isFinite(record.startedAt)) {
    throw new Error('catalog: startedAt must be a finite number');
  }
  if (typeof record.status !== 'string' || !SESSION_STATUSES.has(record.status)) {
    throw new Error(`catalog: unknown status ${String(record.status)}`);
  }
  if (record.pid !== undefined && (typeof record.pid !== 'number' || !Number.isInteger(record.pid) || record.pid <= 0)) {
    throw new Error(`catalog: pid must be a positive integer (got ${String(record.pid)})`);
  }
  if (record.name !== undefined && typeof record.name !== 'string') {
    throw new Error('catalog: name must be a string when provided');
  }
  if (record.conversationPath !== undefined && typeof record.conversationPath !== 'string') {
    throw new Error('catalog: conversationPath must be a string when provided');
  }
}

function assertValidPatch(patch: SessionPatch): void {
  if (!patch || typeof patch !== 'object') {
    throw new Error('catalog: patch must be an object');
  }
  // Reject any unknown keys outright so a typo cannot silently no-op
  // and a malicious key cannot ride the allowlist boundary.
  for (const key of Object.keys(patch)) {
    if (!PATCH_ALLOWED_KEYS.has(key as keyof SessionPatch)) {
      throw new Error(`catalog: patch contains unknown field "${key}"`);
    }
  }
  if (patch.backend !== undefined && !BACKENDS.has(patch.backend)) {
    throw new Error(`catalog: unknown backend ${String(patch.backend)}`);
  }
  if (patch.status !== undefined && !SESSION_STATUSES.has(patch.status)) {
    throw new Error(`catalog: unknown status ${String(patch.status)}`);
  }
  if (patch.cwd !== undefined && typeof patch.cwd !== 'string') {
    throw new Error('catalog: cwd must be a string');
  }
  if (patch.pid !== undefined && (typeof patch.pid !== 'number' || !Number.isInteger(patch.pid) || patch.pid <= 0)) {
    throw new Error(`catalog: pid must be a positive integer (got ${String(patch.pid)})`);
  }
  if (patch.name !== undefined && typeof patch.name !== 'string') {
    throw new Error('catalog: name must be a string when provided');
  }
  if (patch.conversationPath !== undefined && typeof patch.conversationPath !== 'string') {
    throw new Error('catalog: conversationPath must be a string when provided');
  }
}

function cloneRecord(r: SessionRecord): SessionRecord {
  return { ...r };
}

export class Catalog {
  private constructor(private readonly path: string, private state: CatalogFile) {}

  static async open(path: string): Promise<Catalog> {
    const existing = await readJson<unknown>(path);
    const state: CatalogFile = isCatalogFile(existing) ? existing : { ...EMPTY, sessions: {} };
    return new Catalog(path, state);
  }

  async add(record: SessionRecord): Promise<void> {
    assertValidRecord(record);
    await withFileLock(this.path, async () => {
      const live = await readLiveCatalog(this.path);
      const next: CatalogFile = {
        version: 1,
        sessions: {
          ...live.sessions,
          [record.sessionId]: { ...record, updatedAt: Date.now() },
        },
      };
      await writeFileUnlocked(this.path, next);
      this.state = next;
    });
  }

  async update(sessionId: string, patch: SessionPatch): Promise<void> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('catalog: sessionId must be a non-empty string');
    }
    assertValidPatch(patch);
    const safePatch = pickPatch(patch);
    await withFileLock(this.path, async () => {
      const live = await readLiveCatalog(this.path);
      const cur = live.sessions[sessionId];
      if (!cur) throw new Error(`catalog: unknown sessionId ${sessionId}`);
      const next: CatalogFile = {
        version: 1,
        sessions: {
          ...live.sessions,
          [sessionId]: { ...cur, ...safePatch, sessionId, updatedAt: Date.now() },
        },
      };
      await writeFileUnlocked(this.path, next);
      this.state = next;
    });
  }

  async remove(sessionId: string): Promise<void> {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('catalog: sessionId must be a non-empty string');
    }
    await withFileLock(this.path, async () => {
      const live = await readLiveCatalog(this.path);
      if (!live.sessions[sessionId]) {
        // Already gone — keep memory aligned with disk.
        this.state = live;
        return;
      }
      const { [sessionId]: _gone, ...rest } = live.sessions;
      const next: CatalogFile = { version: 1, sessions: rest };
      await writeFileUnlocked(this.path, next);
      this.state = next;
    });
  }

  /** Synchronous, returns a defensive copy so external code cannot mutate state. */
  get(sessionId: string): SessionRecord {
    const cur = this.state.sessions[sessionId];
    if (!cur) throw new Error(`catalog: unknown sessionId ${sessionId}`);
    return cloneRecord(cur);
  }

  list(): SessionRecord[] {
    return Object.values(this.state.sessions).map(cloneRecord);
  }
}

// ---- shared helpers --------------------------------------------------------

async function readLiveCatalog(path: string): Promise<CatalogFile> {
  const existing = await readJson<unknown>(path);
  return isCatalogFile(existing) ? existing : { ...EMPTY, sessions: {} };
}

/** Like writeJsonAtomic, but skips the lock — caller must already hold it. */
async function writeFileUnlocked(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(tmp, path);
  } catch (err) {
    await fs.unlink(tmp).catch(() => { /* ignore */ });
    throw err;
  }
}

export { writeFileUnlocked as _writeFileUnlocked };
