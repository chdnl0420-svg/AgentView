import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { IPC } from '@shared/ipc-contracts';

const TEXT_EXTS = new Set([
  '.txt', '.log', '.csv', '.tsv', '.md', '.markdown', '.yml', '.yaml',
  '.toml', '.ini', '.cfg', '.conf', '.env',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.html', '.htm', '.xml', '.svg', '.css', '.scss',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.sql', '.gql', '.graphql'
]);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const HTML_EXTS = new Set(['.html', '.htm']);
const MD_EXTS = new Set(['.md', '.markdown']);
const JSON_EXTS = new Set(['.json']);
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_TEXT_BYTES = 512 * 1024; // truncate large text previews
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
};

interface FilePreviewPayload {
  kind:
    | 'html'
    | 'markdown'
    | 'text'
    | 'image'
    | 'json'
    | 'binary'
    | 'too-large'
    | 'missing';
  content?: string;
  dataUrl?: string;
  mime?: string;
  size?: number;
  reason?: string;
}

async function previewFileForRenderer(p: string): Promise<FilePreviewPayload> {
  if (!p || typeof p !== 'string') {
    return { kind: 'missing', reason: 'no path' };
  }
  let stat;
  try {
    stat = await fs.stat(p);
  } catch (err) {
    return {
      kind: 'missing',
      reason: err instanceof Error ? err.message : String(err)
    };
  }
  if (!stat.isFile()) {
    return { kind: 'missing', reason: 'not a file', size: stat.size };
  }
  const ext = extname(p).toLowerCase();
  // Image — always allowed even when "large" within the 2MB cap because a
  // jpg/png typically fits.
  if (IMAGE_EXTS.has(ext)) {
    if (stat.size > MAX_PREVIEW_BYTES) {
      return { kind: 'too-large', size: stat.size };
    }
    try {
      const buf = await fs.readFile(p);
      const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      return { kind: 'image', dataUrl, mime, size: stat.size };
    } catch (err) {
      return {
        kind: 'missing',
        reason: err instanceof Error ? err.message : String(err),
        size: stat.size
      };
    }
  }
  if (stat.size > MAX_PREVIEW_BYTES) {
    return { kind: 'too-large', size: stat.size };
  }
  if (HTML_EXTS.has(ext)) {
    const buf = await fs.readFile(p, 'utf8').catch(() => null);
    if (buf == null) return { kind: 'missing', reason: 'read failed', size: stat.size };
    return { kind: 'html', content: buf, mime: 'text/html', size: stat.size };
  }
  if (MD_EXTS.has(ext)) {
    const buf = await fs.readFile(p, 'utf8').catch(() => null);
    if (buf == null) return { kind: 'missing', reason: 'read failed', size: stat.size };
    return { kind: 'markdown', content: buf, mime: 'text/markdown', size: stat.size };
  }
  if (JSON_EXTS.has(ext)) {
    const buf = await fs.readFile(p, 'utf8').catch(() => null);
    if (buf == null) return { kind: 'missing', reason: 'read failed', size: stat.size };
    return { kind: 'json', content: buf, mime: 'application/json', size: stat.size };
  }
  if (TEXT_EXTS.has(ext) || stat.size <= MAX_TEXT_BYTES) {
    // Best-effort text read. If the file isn't valid utf-8 (e.g. an
    // unknown extension that is actually binary), bytes get replaced
    // characters — we accept that for preview.
    try {
      const buf = await fs.readFile(p);
      // Quick binary sniff — null byte in first 4KB → treat as binary.
      const head = buf.subarray(0, Math.min(buf.length, 4096));
      let hasNull = false;
      for (let i = 0; i < head.length; i++) {
        if (head[i] === 0) { hasNull = true; break; }
      }
      if (hasNull && !TEXT_EXTS.has(ext)) {
        return { kind: 'binary', size: stat.size };
      }
      let text = buf.toString('utf8');
      if (text.length > MAX_TEXT_BYTES) {
        text = text.slice(0, MAX_TEXT_BYTES) + '\n\n[…잘림 — 파일이 너무 큼…]';
      }
      return { kind: 'text', content: text, size: stat.size };
    } catch (err) {
      return {
        kind: 'missing',
        reason: err instanceof Error ? err.message : String(err),
        size: stat.size
      };
    }
  }
  return { kind: 'binary', size: stat.size };
}

export function registerFilePreview(): void {
  ipcMain.handle(IPC.FilePreview, async (_e, p: string) => previewFileForRenderer(p));
}
