// Pure utility helpers used by SessionDetail and its child bubbles.
// Extracted so SessionDetail.tsx no longer carries every kitchen-sink
// formatter — these are framework-free and trivially unit-testable.

import type { BgSession, ConversationMessage } from '@shared/types';

export function statusLabel(s: BgSession): string {
  switch (s.status) {
    case 'running': return '실행 중';
    case 'idle': return '대기';
    case 'waiting': return '입력 대기';
    case 'completed': return '완료';
    case 'finished': return '종료';
    case 'crashed': return '오류';
    default: return '대기';
  }
}

export function answerSummary(answers: Record<string, string>): string {
  const entries = Object.entries(answers);
  if (entries.length === 0) return '';
  if (entries.length === 1) return entries[0][1];
  return entries.map(([, v]) => v).join(' / ');
}

export function roleInitial(role: ConversationMessage['role']): string {
  switch (role) {
    case 'user': return '나';
    case 'assistant': return 'AI';
    case 'tool': return '⚙';
    case 'system': return 'S';
    default: return '·';
  }
}

export function roleLabel(role: ConversationMessage['role']): string {
  switch (role) {
    case 'user': return '사용자';
    case 'assistant': return '에이전트';
    case 'tool': return '도구';
    case 'system': return '시스템';
    default: return role;
  }
}

export function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs === 0 ? `${m}m` : `${m}m ${rs}s`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 100000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function stringifyInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
