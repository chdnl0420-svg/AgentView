const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']);

export function basename(p: string): string {
  if (!p) return '';
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

export function ext(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  if (i <= 0) return '';
  return b.slice(i + 1).toLowerCase();
}

export function isImage(p: string): boolean {
  return IMAGE_EXTS.has(ext(p));
}

export function iconFor(p: string): string {
  switch (ext(p)) {
    case 'md':
    case 'mdx':
      return '📝';
    case 'txt':
    case 'log':
      return '📄';
    case 'pdf':
      return '📕';
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return '🧾';
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'tsx':
    case 'jsx':
      return '🟦';
    case 'py':
      return '🐍';
    case 'rs':
      return '🦀';
    case 'go':
      return '🐹';
    case 'java':
    case 'kt':
      return '☕';
    case 'cs':
      return '🔷';
    case 'cpp':
    case 'cc':
    case 'c':
    case 'h':
    case 'hpp':
      return '🧠';
    case 'rb':
      return '💎';
    case 'php':
      return '🐘';
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
      return '⌨️';
    case 'html':
    case 'htm':
      return '🌐';
    case 'css':
    case 'scss':
    case 'less':
      return '🎨';
    case 'sql':
      return '🗄️';
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
    case 'rar':
      return '🗜️';
    case 'mp4':
    case 'mov':
    case 'avi':
    case 'mkv':
      return '🎞️';
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'ogg':
      return '🎵';
    case 'xlsx':
    case 'xls':
    case 'csv':
      return '📊';
    case 'docx':
    case 'doc':
      return '📑';
    case 'pptx':
    case 'ppt':
      return '🎤';
    default:
      return '📎';
  }
}

export function fileUrl(p: string): string {
  // Format: av-file://local/<drive-letter>/<rest>   (Windows)
  //         av-file://local/abs/<rest>              (POSIX absolute)
  // The fixed `local` host avoids the URL parser eating the drive-letter colon,
  // and the drive letter becomes the first path segment. The main-process
  // handler reverses this back into a real filesystem path.
  const norm = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(norm)) {
    const drive = norm[0].toUpperCase();
    return 'av-file://local/' + drive + '/' + encodeURI(norm.slice(3));
  }
  if (norm.startsWith('/')) {
    return 'av-file://local/abs' + encodeURI(norm);
  }
  return encodeURI(norm);
}

export const ATTACHMENT_BLOCK_MARK = '[Attached files]';

/**
 * Append attached file paths to a user prompt in a format that:
 *  1. is human-readable in the chat log
 *  2. uses claude code's `@<path>` reference syntax so the agent automatically
 *     reads the files instead of treating the path as bare text. Without `@`
 *     claude often replies "file not found" because nothing told it to fetch
 *     the screenshot.
 */
export function appendAttachmentsToPrompt(prompt: string, attachments: string[]): string {
  if (attachments.length === 0) return prompt;
  return (
    prompt.trim() +
    '\n\n' +
    ATTACHMENT_BLOCK_MARK +
    '\n' +
    attachments.map((p) => '@' + p).join('\n')
  );
}

export interface ExtractedAttachments {
  body: string;
  attachments: string[];
}

/**
 * Extract a trailing [Attached files] block from a user message and return
 * the cleaned body + the file paths. Tolerates extra trailing whitespace.
 */
export function extractAttachments(text: string): ExtractedAttachments {
  if (!text) return { body: text, attachments: [] };
  const idx = text.lastIndexOf(ATTACHMENT_BLOCK_MARK);
  if (idx === -1) return { body: text, attachments: [] };
  // The block must start on its own line.
  const before = text.slice(0, idx);
  if (before.length > 0 && before[before.length - 1] !== '\n') {
    return { body: text, attachments: [] };
  }
  const after = text.slice(idx + ATTACHMENT_BLOCK_MARK.length);
  const lines = after.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { body: text, attachments: [] };
  // Accept absolute Windows paths or POSIX absolute paths, with an optional
  // leading `@` (claude code reference syntax we now emit).
  const stripAt = (l: string) => (l.startsWith('@') ? l.slice(1) : l);
  const isPath = (l: string) =>
    /^[a-zA-Z]:[\\\/]/.test(l) || l.startsWith('/') || l.startsWith('~');
  const attachments: string[] = [];
  for (const line of lines) {
    const p = stripAt(line);
    if (isPath(p)) attachments.push(p);
    else break;
  }
  if (attachments.length === 0) return { body: text, attachments: [] };
  return { body: before.replace(/\s+$/, ''), attachments };
}
