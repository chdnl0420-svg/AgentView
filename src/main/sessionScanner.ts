import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BgSession, ScanSessionsResult, SessionStatus } from '@shared/types';

const SESSIONS_DIR = join(homedir(), '.claude', 'sessions');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

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
}

async function summarizeConversation(filePath: string): Promise<QuickConvSummary> {
  const summary: QuickConvSummary = {
    size: 0,
    messageCount: 0,
    lastUserText: '',
    lastAssistantText: ''
  };
  try {
    const s = await fs.stat(filePath);
    summary.size = s.size;
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
          /* skip malformed */
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
  if (!alive) return 'finished';
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
      return rawStatus ? 'unknown' : 'idle';
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

export async function scanSessions(): Promise<ScanSessionsResult> {
  const result: ScanSessionsResult = {
    sessions: [],
    errors: [],
    sessionsDir: SESSIONS_DIR
  };
  let entries: string[] = [];
  try {
    entries = await fs.readdir(SESSIONS_DIR);
  } catch {
    return result;
  }

  const files = entries.filter((e) => e.toLowerCase().endsWith('.json'));
  const parsed = await Promise.all(
    files.map(async (entry) => {
      const filePath = join(SESSIONS_DIR, entry);
      try {
        const s = await readSessionFromMetaPath(filePath);
        return { filePath, session: s };
      } catch (err) {
        return {
          filePath,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    })
  );

  for (const p of parsed) {
    if ('session' in p && p.session) result.sessions.push(p.session);
    else if ('error' in p && p.error) result.errors.push({ filePath: p.filePath, message: p.error });
  }

  result.sessions.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return result;
}

export function sessionsDir(): string {
  return SESSIONS_DIR;
}

export function projectsDir(): string {
  return PROJECTS_DIR;
}
