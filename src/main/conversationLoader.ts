import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ConversationFile, ConversationMessage } from '@shared/types';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
// Cap the in-memory conversation snapshot the renderer holds. Long sessions
// with hundreds of tool_use/tool_result rows easily exceed 4000 lines and
// the renderer ends up DOM-mounting every one — by far the biggest
// per-session memory hog. 1500 is plenty for chat context (claude itself
// effectively keeps about the same in its prompt) and lets `tailConversation`
// stream the live tail on top.
const MAX_LINES = 1500;

export async function findFileBySessionId(sessionId: string): Promise<string | null> {
  try {
    const dirs = await fs.readdir(PROJECTS_DIR);
    for (const d of dirs) {
      const candidate = join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
      try {
        const s = await fs.stat(candidate);
        if (s.isFile()) return candidate;
      } catch {
        /* not here */
      }
    }
  } catch {
    /* projects dir missing */
  }
  return null;
}

function pickText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if ((block as { type?: string }).type === 'text') {
      const t = (block as { text?: string }).text;
      if (t) parts.push(t);
    }
  }
  return parts.join('\n');
}

export function flattenLine(line: string): ConversationMessage[] {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const type = obj.type as string | undefined;
    if (type === 'last-prompt' || type === 'agent-setting' || type === 'permission-mode') {
      return [];
    }
    // NOTE: an earlier version dropped every line with `isMeta: true`, but
    // some claude builds also flag legitimate slash-command-driven user
    // messages that way. Hiding everything broke the chat. Keep the line —
    // the renderer's cleanUserMessage + isEmptyUserMessage strips actual
    // caveat/hook noise just from the text content.
    const uuid = String(obj.uuid ?? obj.leafUuid ?? randomUUID());
    const parentUuid = obj.parentUuid as string | undefined;
    const rawTs = obj.timestamp;
    const ts: number | undefined =
      typeof rawTs === 'number' && Number.isFinite(rawTs)
        ? rawTs
        : typeof rawTs === 'string' && Number.isFinite(Date.parse(rawTs))
        ? Date.parse(rawTs)
        : undefined;
    const msg = obj.message as
      | { role?: string; content?: unknown; model?: string; stop_reason?: string }
      | undefined;
    if (!msg) return [];
    const role = (msg.role ?? 'system') as ConversationMessage['role'];
    const content = msg.content;
    const out: ConversationMessage[] = [];
    if (Array.isArray(content)) {
      let textBuf = '';
      const tail: ConversationMessage[] = [];
      let idx = 0;
      for (const block of content) {
        idx++;
        if (!block || typeof block !== 'object') continue;
        const bt = (block as { type?: string }).type;
        if (bt === 'text') {
          const t = (block as { text?: string }).text ?? '';
          if (t) textBuf += (textBuf ? '\n\n' : '') + t;
        } else if (bt === 'tool_use') {
          tail.push({
            uuid: uuid + ':tu' + idx,
            parentUuid: uuid,
            ts,
            role,
            kind: 'tool_use',
            text: '',
            toolName: (block as { name?: string }).name,
            toolInput: (block as { input?: unknown }).input,
            toolUseId: (block as { id?: string }).id,
            model: msg.model,
            raw: block
          });
        } else if (bt === 'tool_result') {
          const rc = (block as { content?: unknown }).content;
          tail.push({
            uuid: uuid + ':tr' + idx,
            parentUuid: uuid,
            ts,
            role: 'tool',
            kind: 'tool_result',
            text: typeof rc === 'string' ? rc : pickText(rc),
            toolUseId: (block as { tool_use_id?: string }).tool_use_id,
            raw: block
          });
        }
      }
      if (textBuf) {
        out.push({
          uuid,
          parentUuid,
          ts,
          role,
          kind: 'text',
          text: textBuf,
          model: msg.model,
          stopReason: msg.stop_reason,
          raw: obj
        });
      }
      out.push(...tail);
    } else {
      const text = pickText(content);
      if (text || role) {
        out.push({
          uuid,
          parentUuid,
          ts,
          role,
          kind: 'text',
          text,
          model: msg.model,
          stopReason: msg.stop_reason,
          raw: obj
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export interface ConversationTailResult {
  newMessages: ConversationMessage[];
  nextOffset: number;
  sizeBytes: number;
}

export async function readConversation(sessionId: string): Promise<ConversationFile | null> {
  const filePath = await findFileBySessionId(sessionId);
  if (!filePath) return null;
  const stat = await fs.stat(filePath);
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const truncated = lines.length > MAX_LINES;
  const usable = truncated ? lines.slice(-MAX_LINES) : lines;
  const messages: ConversationMessage[] = [];
  const meta: ConversationFile['meta'] = {};
  for (const line of usable) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const t = obj.type as string | undefined;
      if (t === 'last-prompt') meta.lastPrompt = String(obj.lastPrompt ?? '');
      if (t === 'agent-setting') meta.agentSetting = String(obj.agentSetting ?? '');
      if (t === 'permission-mode') meta.permissionMode = String(obj.permissionMode ?? '');
    } catch {
      /* ignore */
    }
    const flat = flattenLine(line);
    if (flat.length > 0) messages.push(...flat);
  }
  return {
    sessionId,
    filePath,
    messages,
    sizeBytes: stat.size,
    truncated,
    meta
  };
}

/**
 * Read only the bytes added since `fromOffset` and parse new lines into messages.
 * Returns the next offset and any messages found. Used by the live watcher.
 */
export async function tailConversation(
  filePath: string,
  fromOffset: number
): Promise<ConversationTailResult> {
  const stat = await fs.stat(filePath);
  if (stat.size <= fromOffset) {
    return { newMessages: [], nextOffset: stat.size, sizeBytes: stat.size };
  }
  const length = stat.size - fromOffset;
  const fh = await fs.open(filePath, 'r');
  const newMessages: ConversationMessage[] = [];
  let nextOffset = stat.size;
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, fromOffset);
    const text = buf.toString('utf8');
    // If the last line is incomplete, keep its bytes for the next read.
    const lastNl = text.lastIndexOf('\n');
    const complete = lastNl === -1 ? '' : text.slice(0, lastNl);
    if (lastNl !== -1) {
      // bytes consumed = complete.length + 1 (for \n)
      // but we measured in chars; use Buffer.byteLength on the actual UTF-8 slice
      const consumedBytes = Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');
      nextOffset = fromOffset + consumedBytes;
    } else {
      // no full line yet; keep the offset at fromOffset (will retry on next change)
      nextOffset = fromOffset;
    }
    if (complete) {
      for (const line of complete.split(/\r?\n/)) {
        if (!line) continue;
        const flat = flattenLine(line);
        if (flat.length > 0) newMessages.push(...flat);
      }
    }
  } finally {
    await fh.close();
  }
  return { newMessages, nextOffset, sizeBytes: stat.size };
}

/**
 * Returns the byte offset where the *initial load* stopped reading, so a
 * subsequent tail() call only emits truly new messages.
 */
export async function conversationByteSize(filePath: string): Promise<number> {
  try {
    const s = await fs.stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}
