import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BgSession, ScanSessionsResult, SessionStatus } from '@shared/types';
import { ensureHiddenLoaded } from './hiddenSessions';

const SESSIONS_DIR = join(homedir(), '.claude', 'sessions');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const DAEMON_ROSTER = join(homedir(), '.claude', 'daemon', 'roster.json');
const JOBS_DIR = join(homedir(), '.claude', 'jobs');
// avd daemon's persistent session catalog. We merge any entries that
// claude's `~/.claude/jobs/` scan didn't already cover (avd-only sessions:
// codex, external-claude with no jobs/<short>/state.json), so the
// dashboard shows them alongside legacy bg workers.
const AVD_CATALOG = join(homedir(), '.agentview', 'daemon', 'state.json');

/**
 * Subset of `avd/src/catalog.ts:SessionRecord` we rely on for the merge.
 * Kept local so the renderer build doesn't take a hard runtime dep on
 * the avd workspace just to read its on-disk file shape.
 */
interface AvdCatalogRecord {
  sessionId?: string;
  backend?: string;
  cwd?: string;
  startedAt?: number;
  updatedAt?: number;
  status?: string;
  pid?: number;
  name?: string;
  conversationPath?: string;
}

interface AvdCatalogFile {
  version?: number;
  sessions?: Record<string, AvdCatalogRecord>;
}

interface ClaudeJobState {
  state: string;        // "done" | "running" | ...
  tempo?: string;       // "active" | "idle" — drives the CLI's working/completed split
  detail?: string;
  name?: string;
  sessionId?: string;
  daemonShort?: string;
  cwd?: string;
  originCwd?: string;
  template?: string;
  backend?: string;
  createdAt?: string;
  updatedAt?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  linkScanPath?: string;
}

// Tolerant read with retry-on-failure. claude rewrites state.json
// atomically (tmp -> rename) during active work, which can intermittently
// trip fs.readFile or JSON.parse. A bare null result here would make the
// session vanish from the scan and reappear ~250ms later (card flicker
// on the dashboard). Retry once after a short delay to bridge the gap.
async function readJobState(short: string): Promise<ClaudeJobState | null> {
  const filePath = join(JOBS_DIR, short, 'state.json');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as ClaudeJobState;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 60));
    }
  }
  return null;
}

// In-memory cache: short -> { state, asOf }. When a fresh readJobState
// returns null but we saw this short recently, we serve the cached state
// for up to STATE_GRACE_MS so a transient atomic-rename window doesn't
// make the card disappear. Cleared after the grace expires.
const STATE_GRACE_MS = 6000;
const STATE_CACHE_MAX = 200;
const stateCache = new Map<string, { state: ClaudeJobState; asOf: number }>();
function rememberState(short: string, state: ClaudeJobState): void {
  stateCache.set(short, { state, asOf: Date.now() });
  // Cap the cache so a long-lived AgentView session that has touched many
  // job shorts doesn't grow this map unboundedly. The oldest entry is the
  // least useful — by definition past grace, so it's safe to drop.
  if (stateCache.size > STATE_CACHE_MAX) {
    const firstKey = stateCache.keys().next().value;
    if (firstKey !== undefined) stateCache.delete(firstKey);
  }
}
function recallState(short: string): ClaudeJobState | null {
  const hit = stateCache.get(short);
  if (!hit) return null;
  if (Date.now() - hit.asOf > STATE_GRACE_MS) {
    stateCache.delete(short);
    return null;
  }
  return hit.state;
}

interface RosterWorker {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  attempt?: number;
  dispatch?: { agent?: string };
}

interface DaemonRoster {
  proto?: number;
  supervisorPid?: number;
  updatedAt?: number;
  workers?: Record<string, RosterWorker>;
}

async function readDaemonRoster(): Promise<DaemonRoster | null> {
  try {
    const raw = await fs.readFile(DAEMON_ROSTER, 'utf8');
    const data = JSON.parse(raw) as DaemonRoster;
    if (data && typeof data === 'object' && data.workers && typeof data.workers === 'object') {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

// Decoded "C--Users-NX3GAMES--claude" → "C:\Users\NX3GAMES\.claude"
function decodeCwd(encoded: string): string {
  // best-effort: replace leading drive letter pattern
  const m = /^([A-Za-z])--(.*)$/.exec(encoded);
  if (m) {
    return `${m[1].toUpperCase()}:\\` + m[2].replace(/-/g, '\\');
  }
  return encoded.replace(/-/g, '\\');
}

function encodeCwd(cwd: string): string {
  return cwd.replace(/[\\/]/g, '-').replace(/:/g, '-');
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    return err.code === 'EPERM';
  }
}

async function statSafe(p: string): Promise<{ size: number; mtime: number } | null> {
  try {
    const s = await fs.stat(p);
    return { size: s.size, mtime: s.mtimeMs };
  } catch {
    return null;
  }
}

async function findConversationFile(cwd: string, sessionId: string): Promise<string | null> {
  const encoded = encodeCwd(cwd);
  const direct = join(PROJECTS_DIR, encoded, `${sessionId}.jsonl`);
  if ((await statSafe(direct)) !== null) return direct;
  try {
    const dirs = await fs.readdir(PROJECTS_DIR);
    for (const d of dirs) {
      const candidate = join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
      if ((await statSafe(candidate)) !== null) return candidate;
    }
  } catch {
    /* ignore */
  }
  return null;
}

interface QuickConvSummary {
  size: number;
  messageCount: number;
  lastUserText: string;
  lastAssistantText: string;
  lastActivity: number;
}

async function summarizeConversation(filePath: string): Promise<QuickConvSummary> {
  const summary: QuickConvSummary = {
    size: 0,
    messageCount: 0,
    lastUserText: '',
    lastAssistantText: '',
    lastActivity: 0
  };
  try {
    const s = await fs.stat(filePath);
    summary.size = s.size;
    summary.lastActivity = s.mtimeMs;
    const CHUNK = 64 * 1024;
    const start = Math.max(0, s.size - CHUNK);
    const fh = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(s.size - start);
      await fh.read(buf, 0, buf.length, start);
      const text = buf.toString('utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      const usable = start === 0 ? lines : lines.slice(1);
      summary.messageCount = usable.length;
      for (let i = usable.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(usable[i]);
          const msg = obj?.message;
          if (msg?.role === 'assistant' && !summary.lastAssistantText) {
            summary.lastAssistantText = extractFirstText(msg);
          }
          if (msg?.role === 'user' && !summary.lastUserText) {
            summary.lastUserText = extractFirstText(msg);
          }
          if (summary.lastUserText && summary.lastAssistantText) break;
        } catch {
          /* skip */
        }
      }
    } finally {
      await fh.close();
    }
  } catch {
    /* ignore */
  }
  return summary;
}

function extractFirstText(message: { content?: unknown }): string {
  const content = message?.content;
  if (typeof content === 'string') return truncate(content, 220);
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        const t = (block as { text?: string }).text ?? '';
        if (t) return truncate(t, 220);
      }
    }
  }
  return '';
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trim() + '…';
}

function classifyStatus(rawStatus: string | undefined, alive: boolean): SessionStatus {
  if (!alive) {
    if ((rawStatus ?? '').toLowerCase() === 'crashed') return 'crashed';
    return 'finished';
  }
  switch ((rawStatus ?? '').toLowerCase()) {
    case 'idle':
      return 'idle';
    case 'running':
    case 'busy':
    case 'working':
      return 'running';
    case 'waiting':
    case 'pending':
      return 'waiting';
    case 'crashed':
    case 'error':
      return 'crashed';
    default:
      // No status field on interactive/claude-desktop entries — treat as idle.
      return 'idle';
  }
}

export async function readSessionFromMetaPath(filePath: string): Promise<BgSession | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    const pid = Number(data.pid ?? 0);
    const sessionId = String(data.sessionId ?? '');
    const cwd = String(data.cwd ?? '');
    const alive = isPidAlive(pid);
    const conversationPath = sessionId ? await findConversationFile(cwd, sessionId) : null;
    const convSummary = conversationPath ? await summarizeConversation(conversationPath) : null;
    return {
      pid,
      sessionId,
      cwd,
      startedAt: Number(data.startedAt ?? Date.now()),
      updatedAt: Number(data.updatedAt ?? data.startedAt ?? Date.now()),
      version: data.version,
      kind: data.kind,
      entrypoint: data.entrypoint,
      name: data.name,
      agent: data.agent,
      jobId: data.jobId,
      status: classifyStatus(data.status, alive),
      alive,
      metaPath: filePath,
      conversationPath,
      conversationSize: convSummary?.size ?? 0,
      messageCount: convSummary?.messageCount,
      lastUserText: convSummary?.lastUserText,
      lastAssistantText: convSummary?.lastAssistantText
    };
  } catch {
    return null;
  }
}

// Build a session card from a jsonl file even when there's no matching
// sessions/{pid}.json (true for sessions we started via `claude --print`).
async function readSessionFromJsonl(
  jsonlPath: string,
  pidHint: number | null,
  activePids: Set<number>
): Promise<BgSession | null> {
  try {
    const stat = await fs.stat(jsonlPath);
    if (!stat.isFile()) return null;
    const fileName = jsonlPath.split(/[\\/]/).pop() ?? '';
    const sessionId = fileName.replace(/\.jsonl$/i, '');
    if (!sessionId) return null;
    const dirName = jsonlPath.split(/[\\/]/).slice(-2, -1)[0] ?? '';
    const cwd = decodeCwd(dirName);
    const summary = await summarizeConversation(jsonlPath);
    const pid = pidHint ?? 0;
    const alive = pid > 0 && activePids.has(pid);
    // jsonl-only entries come from sessions this app started. Live = running,
    // dead = the agent finished its task (completed).
    const status: SessionStatus = alive ? 'running' : 'completed';
    return {
      pid,
      sessionId,
      cwd,
      startedAt: Math.max(0, stat.mtimeMs - stat.size), // rough; we don't know real start
      updatedAt: stat.mtimeMs,
      version: undefined,
      kind: 'app',
      entrypoint: 'app',
      name: summary.lastUserText ? truncate(summary.lastUserText, 60) : sessionId.slice(0, 8),
      agent: 'claude',
      jobId: sessionId.slice(0, 8),
      status,
      alive,
      metaPath: jsonlPath,
      conversationPath: jsonlPath,
      conversationSize: summary.size,
      messageCount: summary.messageCount,
      lastUserText: summary.lastUserText,
      lastAssistantText: summary.lastAssistantText
    };
  } catch {
    return null;
  }
}

async function scanProjectsJsonl(
  pidsBySession: Map<string, number>,
  activePids: Set<number>,
  ownedSessionIds: Set<string> = new Set()
): Promise<BgSession[]> {
  const out: BgSession[] = [];
  let topDirs: string[] = [];
  try {
    topDirs = await fs.readdir(PROJECTS_DIR);
  } catch {
    return out;
  }
  for (const dir of topDirs) {
    const dirPath = join(PROJECTS_DIR, dir);
    let files: string[] = [];
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) continue;
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.jsonl')) continue;
      const sessionId = f.replace(/\.jsonl$/i, '');
      const filePath = join(dirPath, f);
      const pidHint = pidsBySession.get(sessionId) ?? null;
      const session = await readSessionFromJsonl(filePath, pidHint, activePids);
      if (!session) continue;
      // jsonl-only entries with no pid information are completed work whose
      // owner process is gone. By user request we hide anonymous ones, but
      // keep AgentView-owned (= we spawned them) so `claude agents` style
      // "completed" history is preserved — CLI shows these in the Completed
      // section even after their roster entry is gone.
      if (session.pid === 0 && !session.alive && !ownedSessionIds.has(sessionId)) {
        continue;
      }
      out.push(session);
    }
  }
  return out;
}

export interface ScanFilter {
  /** sessionIds that AgentView itself started (and remembers across runs). */
  ownedSessionIds?: Set<string>;
  /** Agent names that exist under ~/.claude/agents/ (or project agents). */
  knownAgentNames?: Set<string>;
}

function passesAgentViewFilter(s: BgSession, filter: ScanFilter): boolean {
  // Always allow sessions AgentView started (we remember them per-uuid).
  if (filter.ownedSessionIds && filter.ownedSessionIds.has(s.sessionId)) return true;
  // Match CLI `claude agents`: every kind:"bg" worker (daemon-managed) and
  // every AgentView-spawned jsonl-only entry (kind:"app") should show up.
  // These two kinds together are exactly what the user expects to see.
  const kind = (s.kind || '').toLowerCase();
  if (kind === 'bg' || kind === 'app') return true;
  // Sessions whose `agent` field matches a real agent file are also kept
  // (legacy support for entries spawned via `claude /agents` or CLI flag).
  const agentName = (s.agent || '').trim();
  if (agentName && filter.knownAgentNames && filter.knownAgentNames.has(agentName)) {
    return true;
  }
  return false;
}

/**
 * Build a BgSession from a daemon roster entry. Used as the *authoritative*
 * source for kind:"bg" workers — the roster's sessionId is stable across
 * PID changes (the daemon respawns workers and rewrites this file), so it
 * fills the transient gap where ~/.claude/sessions/{pid}.json is briefly
 * missing during a respawn. Status/conversation data is enriched from the
 * meta + jsonl scans when available.
 */
function rosterWorkerToSession(short: string, w: RosterWorker, alive: boolean): BgSession {
  return {
    pid: Number(w.pid) || 0,
    sessionId: String(w.sessionId || ''),
    cwd: String(w.cwd || ''),
    startedAt: Number(w.startedAt) || Date.now(),
    updatedAt: Number(w.startedAt) || Date.now(),
    version: undefined,
    kind: 'bg',
    entrypoint: 'daemon',
    name: short,
    agent: (w.dispatch && w.dispatch.agent) || 'claude',
    jobId: short,
    status: alive ? 'idle' : 'finished',
    alive,
    metaPath: DAEMON_ROSTER,
    conversationPath: null,
    conversationSize: 0
  };
}

/**
 * Build a BgSession from a claude jobs/<short>/state.json entry. This is the
 * exact source `claude agents` reads, so AgentView's grid matches the CLI
 * 1:1 — no synthetic filtering, no missing entries.
 */
async function jobStateToSession(
  short: string,
  state: ClaudeJobState,
  roster: DaemonRoster | null
): Promise<BgSession | null> {
  const sessionId = state.sessionId;
  if (!sessionId) return null;
  const cwd = state.cwd || state.originCwd || '';
  const worker = roster?.workers?.[short];
  const pid = worker ? Number(worker.pid) : 0;
  const alive = pid > 0 && isPidAlive(pid);
  // Translate claude's tempo/state into AgentView's status enum. The CLI shows
  // tempo:'active' under "Working" and tempo:'idle' under "Completed", with
  // the row's state ('done' vs others) being secondary. We mirror that exactly.
  let status: SessionStatus;
  if (alive) {
    status = state.tempo === 'active' ? 'running' : 'idle';
  } else {
    status = state.state === 'done' ? 'completed' : 'finished';
  }
  const createdMs = state.createdAt ? Date.parse(state.createdAt) : Date.now();
  const updatedMs = state.updatedAt ? Date.parse(state.updatedAt) : createdMs;
  const session: BgSession = {
    pid: pid || 0,
    sessionId,
    cwd,
    startedAt: Number.isFinite(createdMs) ? createdMs : Date.now(),
    updatedAt: Number.isFinite(updatedMs) ? updatedMs : Date.now(),
    version: undefined,
    kind: 'bg',
    entrypoint: 'daemon',
    name: state.name || short,
    agent: state.template || 'claude',
    jobId: short,
    status,
    alive,
    metaPath: join(JOBS_DIR, short, 'state.json'),
    conversationPath: state.linkScanPath || null,
    conversationSize: 0
  };
  const jsonlPath =
    state.linkScanPath || (sessionId ? await findConversationFile(cwd, sessionId) : null);
  if (jsonlPath) {
    const summary = await summarizeConversation(jsonlPath);
    session.conversationPath = jsonlPath;
    session.conversationSize = summary.size;
    session.messageCount = summary.messageCount;
    session.lastUserText = summary.lastUserText;
    session.lastAssistantText = summary.lastAssistantText;
    if (summary.lastActivity > session.updatedAt) session.updatedAt = summary.lastActivity;
  }
  return session;
}

export async function scanSessions(
  pidsBySession: Map<string, number> = new Map(),
  activePids: Set<number> = new Set(),
  filter: ScanFilter = {}
): Promise<ScanSessionsResult> {
  const result: ScanSessionsResult = {
    sessions: [],
    errors: [],
    sessionsDir: SESSIONS_DIR
  };

  // Single source of truth — claude's own jobs registry. This is exactly
  // what `claude agents` reads, so AgentView grid mirrors the CLI 1:1.
  // Anything outside this directory (interactive REPL chats, legacy
  // jsonl-only entries) is intentionally hidden per user requirement.
  let shorts: string[] = [];
  try {
    shorts = await fs.readdir(JOBS_DIR);
  } catch {
    /* dir doesn't exist on a fresh system */
  }
  const roster = await readDaemonRoster();
  // UI-side safety net: sessions the user deleted via AgentView. The claude
  // daemon respawns workers (it tracks an attempt counter and re-creates
  // jobs/<short>/ after we wipe it), so even after we tear down the daemon
  // entry the session can reappear. Filter those out so deletion sticks
  // even when the daemon ignores our removal.
  const hidden = await ensureHiddenLoaded();
  for (const short of shorts) {
    if (short.endsWith('.json')) continue; // pins.json etc.
    let state = await readJobState(short);
    if (state) {
      rememberState(short, state);
    } else {
      // Atomic-write race or temporary fs hiccup. Fall back to the most
      // recent cached state (within STATE_GRACE_MS) so the card doesn't
      // blink off the grid. Beyond grace, treat the worker as gone.
      state = recallState(short);
      if (!state) continue;
    }
    if (state.sessionId && hidden.has(state.sessionId)) continue;
    const session = await jobStateToSession(short, state, roster);
    if (!session) continue;
    result.sessions.push(session);
  }

  // Merge avd catalog entries that aren't already represented by a
  // claude job. Codex sessions and external-claude sessions that the
  // user started while the legacy daemon was down only live in the
  // avd catalog — without this merge they'd vanish from the dashboard
  // even though they're still running.
  await mergeAvdCatalog(result.sessions);

  result.sessions.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return result;
}

/**
 * Read `~/.agentview/daemon/state.json` (the avd catalog) and append
 * any sessions whose sessionId isn't already in `out`. Missing file is
 * the common case (avd never ran) — we swallow it. Malformed JSON is
 * also non-fatal so a half-written catalog never breaks the scan.
 */
async function mergeAvdCatalog(out: BgSession[]): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(AVD_CATALOG, 'utf8');
  } catch {
    return; // catalog missing — normal if avd never ran
  }
  let data: AvdCatalogFile;
  try {
    data = JSON.parse(raw) as AvdCatalogFile;
  } catch {
    return; // half-written or corrupted — skip rather than throw
  }
  const sessions = data.sessions;
  if (!sessions || typeof sessions !== 'object') return;
  const seen = new Set(out.map((s) => s.sessionId));
  for (const record of Object.values(sessions)) {
    if (!record || typeof record !== 'object') continue;
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : '';
    if (!sessionId || seen.has(sessionId)) continue;
    const pid = typeof record.pid === 'number' && record.pid > 0 ? record.pid : 0;
    const alive = pid > 0 && isPidAlive(pid);
    const startedAt = typeof record.startedAt === 'number' ? record.startedAt : Date.now();
    const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : startedAt;
    const conversationPath = typeof record.conversationPath === 'string'
      ? record.conversationPath
      : null;
    const session: BgSession = {
      pid,
      sessionId,
      cwd: typeof record.cwd === 'string' ? record.cwd : '',
      startedAt,
      updatedAt,
      version: undefined,
      kind: 'bg',
      entrypoint: 'avd',
      name: typeof record.name === 'string' && record.name ? record.name : sessionId.slice(0, 8),
      agent: typeof record.backend === 'string' && record.backend ? record.backend : 'claude',
      jobId: sessionId.slice(0, 8),
      status: classifyStatus(record.status, alive),
      alive,
      metaPath: AVD_CATALOG,
      conversationPath,
      conversationSize: 0
    };
    out.push(session);
    seen.add(sessionId);
  }
}

export function sessionsDir(): string {
  return SESSIONS_DIR;
}

export function projectsDir(): string {
  return PROJECTS_DIR;
}

/**
 * Returns true if some external process currently owns the sessionId as a
 * live background agent (sessions/{pid}.json exists and the pid is alive).
 */
export async function isExternalSessionAlive(sessionId: string): Promise<boolean> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(SESSIONS_DIR);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.json')) continue;
    const filePath = join(SESSIONS_DIR, entry);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (data.sessionId !== sessionId) continue;
      const pid = Number(data.pid ?? 0);
      return isPidAlive(pid);
    } catch {
      /* skip */
    }
  }
  return false;
}

/**
 * Returns the current liveness/status for a sessionId by inspecting sessions/.
 * Used by the cancel loop to know when ESC actually landed.
 */
export async function externalSessionState(
  sessionId: string
): Promise<{ alive: boolean; status: SessionStatus } | null> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(SESSIONS_DIR);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.json')) continue;
    const filePath = join(SESSIONS_DIR, entry);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (data.sessionId !== sessionId) continue;
      const pid = Number(data.pid ?? 0);
      const alive = isPidAlive(pid);
      return { alive, status: classifyStatus(data.status, alive) };
    } catch {
      /* skip */
    }
  }
  return null;
}
