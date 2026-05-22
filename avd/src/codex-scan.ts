import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface CodexConversationRecord {
  sessionId: string;
  conversationPath: string;
  cwd?: string;
  updatedAt: number;
}

export interface CodexScanDiagnostic {
  path: string;
  reason: 'NO_VALID_JSON_LINES' | 'READ_FAILED';
}

export interface CodexScanResult {
  roots: string[];
  conversations: CodexConversationRecord[];
  diagnostics: CodexScanDiagnostic[];
}

export interface CodexScanOptions {
  homeDir?: string;
  roots?: string[];
  maxDepth?: number;
}

type JsonObject = Record<string, unknown>;

export async function scanCodexState(options: CodexScanOptions = {}): Promise<CodexScanResult> {
  const roots = options.roots ?? (options.homeDir ? [join(options.homeDir, '.codex')] : []);
  const maxDepth = options.maxDepth ?? 8;
  const existingRoots: string[] = [];
  const conversations: CodexConversationRecord[] = [];
  const diagnostics: CodexScanDiagnostic[] = [];

  for (const root of roots) {
    if (!(await isDirectory(root))) continue;
    existingRoots.push(root);
    for await (const filePath of walkJsonl(root, maxDepth)) {
      if (!isSessionTranscriptPath(filePath)) continue;
      const record = await readConversationRecord(filePath);
      if (record) {
        conversations.push(record);
      } else {
        diagnostics.push({ path: filePath, reason: 'NO_VALID_JSON_LINES' });
      }
    }
  }

  conversations.sort((a, b) => a.conversationPath.localeCompare(b.conversationPath));
  diagnostics.sort((a, b) => a.path.localeCompare(b.path));
  return { roots: existingRoots, conversations, diagnostics };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function* walkJsonl(dir: string, maxDepth: number, depth = 0): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < maxDepth) yield* walkJsonl(child, maxDepth, depth + 1);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      yield child;
    }
  }
}

async function readConversationRecord(path: string): Promise<CodexConversationRecord | null> {
  let raw: string;
  let stat;
  try {
    [raw, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)]);
  } catch {
    return null;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseJsonObject(trimmed);
    if (!parsed) continue;
    const meta = extractSessionMetadata(parsed);
    if (!meta) continue;
    return {
      sessionId: meta.sessionId,
      conversationPath: path,
      ...(meta.cwd ? { cwd: meta.cwd } : {}),
      updatedAt: stat.mtimeMs,
    };
  }

  return null;
}

function isSessionTranscriptPath(path: string): boolean {
  return path.split(/[\\/]+/).includes('sessions');
}

function extractSessionMetadata(record: JsonObject): { sessionId: string; cwd?: string } | null {
  if (record.type === 'session_meta' && isObject(record.payload)) {
    const sessionId = firstString(record.payload.id, record.payload.session_id, record.payload.sessionId);
    if (!sessionId) return null;
    return {
      sessionId,
      cwd: firstString(record.payload.cwd, record.payload.working_directory, record.payload.workingDirectory),
    };
  }

  const sessionId = firstString(record.session_id, record.sessionId, record.id);
  if (!sessionId) return null;
  return {
    sessionId,
    cwd: firstString(record.cwd, record.working_directory, record.workingDirectory),
  };
}

function parseJsonObject(line: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    return null;
  }
  return null;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
