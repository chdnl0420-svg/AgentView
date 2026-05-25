// Session export — researcher items #109 (Markdown) + #110 (JSON) + #499.
//
// Generates a downloadable / clipboard-pastable representation of a
// conversation. The renderer triggers the download via an in-memory
// blob URL so we never touch the filesystem from the renderer process —
// the user's browser default-downloads handler decides where it lands.

import type { ConversationFile, ConversationMessage } from '@shared/types';

export type ExportFormat = 'markdown' | 'json';

function safeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  return trimmed || 'session';
}

function roleLabel(role: ConversationMessage['role']): string {
  switch (role) {
    case 'user': return '사용자';
    case 'assistant': return '어시스턴트';
    case 'system': return '시스템';
    case 'tool': return '도구';
    case 'meta': return '메타';
    default: return role;
  }
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toISOString();
}

/** Render a conversation as a single Markdown string. */
export function toMarkdown(file: ConversationFile, displayName: string): string {
  const lines: string[] = [];
  lines.push(`# ${displayName}`);
  lines.push('');
  lines.push(`- 세션 ID: \`${file.sessionId}\``);
  if (file.meta?.agentSetting) lines.push(`- 에이전트 설정: ${file.meta.agentSetting}`);
  if (file.meta?.lastPrompt) {
    const trimmed = file.meta.lastPrompt.split(/\r?\n/)[0];
    lines.push(`- 마지막 프롬프트: ${trimmed}`);
  }
  lines.push(`- 메시지 수: ${file.messages.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const m of file.messages) {
    const head = `## ${roleLabel(m.role)}${m.kind !== 'text' ? ` · ${m.kind}` : ''}`;
    lines.push(head);
    const stamp = formatTime(m.ts);
    if (stamp) lines.push(`*${stamp}*`);
    if (m.kind === 'tool_use') {
      lines.push('');
      lines.push(`**Tool:** \`${m.toolName ?? '?'}\``);
      if (m.toolInput !== undefined) {
        lines.push('```json');
        lines.push(JSON.stringify(m.toolInput, null, 2));
        lines.push('```');
      }
    } else if (m.kind === 'tool_result') {
      lines.push('');
      lines.push(`**Tool result** (\`${m.toolName ?? '?'}\`)`);
      if (m.text) {
        lines.push('```');
        lines.push(m.text);
        lines.push('```');
      }
    } else if (m.text) {
      lines.push('');
      lines.push(m.text);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Trigger a browser download for the provided text content. */
export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick — browsers want the URL alive long enough to start
  // the download but it should be GC'd eventually.
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface ExportOptions {
  format: ExportFormat;
  /** Display name used for the filename (sanitised). */
  displayName: string;
}

export function exportConversation(file: ConversationFile, opts: ExportOptions): void {
  const stem = safeFilename(opts.displayName);
  if (opts.format === 'json') {
    const payload = JSON.stringify(file, null, 2);
    downloadText(payload, `${stem}.json`, 'application/json;charset=utf-8');
    return;
  }
  const md = toMarkdown(file, opts.displayName);
  downloadText(md, `${stem}.md`, 'text/markdown;charset=utf-8');
}

/** Copy the conversation to the clipboard in the requested format. */
export async function copyConversation(file: ConversationFile, opts: ExportOptions): Promise<void> {
  const text = opts.format === 'json'
    ? JSON.stringify(file, null, 2)
    : toMarkdown(file, opts.displayName);
  await navigator.clipboard.writeText(text);
}
