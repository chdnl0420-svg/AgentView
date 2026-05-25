// Session enumeration for the AgentView dashboard.
//
// AVD-only after K: every active session is registered in
// ~/.agentview/daemon/state.json by the avd ClaudeAdapter. The legacy
// scanning of ~/.claude/jobs/ and the claude daemon roster is gone —
// AgentView's grid no longer leaks pre-K leftovers or interactive
// REPL chats that happen to share a cwd.
//
// External-session helpers (isExternalSessionAlive / externalSessionState)
// are kept because the SessionsResume IPC still uses them to attach to
// pre-K sessions that live only under ~/.claude/sessions/.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BgSession, ScanSessionsResult, SessionStatus } from '@shared/types';
import { ensureHiddenLoaded } from './hiddenSessions';

const SESSIONS_DIR = join(homedir(), '.claude', 'sessions');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const AVD_CATALOG = join(homedir(), '.agentview', 'daemon', 'state.json');

/**
 * Subset of `avd/src/catalog.ts:SessionRecord` we rely on for the read.
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

function encodeCwd(cwd: string): string {
  return cwd.replace(/[\\/]/g, '-').replace(/:/g, '-');
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
      return 'idle';
  }
}

/**
 * Convert an avd catalog record to the BgSession shape the renderer
 * expects. Conversation summary is enriched from the jsonl on disk
 * when conversationPath resolves; otherwise the card carries only
 * the catalog-level metadata.
 */
async function avdRecordToSession(
  record: AvdCatalogRecord,
  hidden: Set<string>
): Promise<BgSession | null> {
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : '';
  if (!sessionId) return null;
  if (hidden.has(sessionId)) return null;
  const pid = typeof record.pid === 'number' && record.pid > 0 ? record.pid : 0;
  const alive = pid > 0 && isPidAlive(pid);
  const startedAt = typeof record.startedAt === 'number' ? record.startedAt : Date.now();
  let updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : startedAt;
  const cwd = typeof record.cwd === 'string' ? record.cwd : '';
  let conversationPath: string | null = typeof record.conversationPath === 'string'
    ? record.conversationPath
    : null;
  // Fall back to a projects-dir lookup when the catalog entry pre-dates
  // the conversationPath field, so older avd-tracked sessions still
  // render their last message preview.
  if (!conversationPath) {
    conversationPath = await findConversationFile(cwd, sessionId);
  }
  const session: BgSession = {
    pid,
    sessionId,
    cwd,
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
  if (conversationPath) {
    const summary = await summarizeConversation(conversationPath);
    session.conversationSize = summary.size;
    session.messageCount = summary.messageCount;
    session.lastUserText = summary.lastUserText;
    session.lastAssistantText = summary.lastAssistantText;
    if (summary.lastActivity > session.updatedAt) updatedAt = summary.lastActivity;
    session.updatedAt = updatedAt;
  }
  return session;
}

export interface ScanFilter {
  /** sessionIds that AgentView itself started (and remembers across runs). */
  ownedSessionIds?: Set<string>;
  /** Agent names that exist under ~/.claude/agents/ (or project agents). */
  knownAgentNames?: Set<string>;
}

export async function scanSessions(
  _pidsBySession: Map<string, number> = new Map(),
  _activePids: Set<number> = new Set(),
  _filter: ScanFilter = {}
): Promise<ScanSessionsResult> {
  const result: ScanSessionsResult = {
    sessions: [],
    errors: [],
    sessionsDir: SESSIONS_DIR
  };
  const hidden = await ensureHiddenLoaded();
  let raw: string;
  try {
    raw = await fs.readFile(AVD_CATALOG, 'utf8');
  } catch {
    return result; // catalog missing — fresh install
  }
  let data: AvdCatalogFile;
  try {
    data = JSON.parse(raw) as AvdCatalogFile;
  } catch {
    return result; // half-written or corrupted — render an empty grid
  }
  const sessions = data.sessions;
  if (!sessions || typeof sessions !== 'object') return result;
  for (const record of Object.values(sessions)) {
    if (!record || typeof record !== 'object') continue;
    const session = await avdRecordToSession(record, hidden);
    if (session) result.sessions.push(session);
  }
  result.sessions.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  return result;
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

export function sessionsDir(): string {
  return SESSIONS_DIR;
}

/**
 * Returns true if some external process currently owns the sessionId as a
 * live background agent (sessions/{pid}.json exists and the pid is alive).
 * SessionsResume IPC uses this to retry attach-to-claude flows on pre-K
 * external sessions; not consulted by the dashboard scan after K.
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
 * Returns the current liveness/status for a sessionId by inspecting
 * ~/.claude/sessions/. Used by the cancel loop to know when ESC actually
 * landed on a pre-K external session.
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
