import type { BgSession } from '@shared/types';

export type SessionFilter = 'running' | 'waiting' | 'completed' | 'finished';

/**
 * Split alive sessions into "실행 중" (agent currently working) and "대기"
 * (agent idle, waiting for next prompt). Without the 대기 bucket, sessions
 * that go idle would silently disappear from the default view.
 */
export function classify(s: BgSession): SessionFilter {
  if (s.alive) {
    return s.status === 'running' ? 'running' : 'waiting';
  }
  if (s.status === 'completed') return 'completed';
  return 'finished';
}

/**
 * Anonymous kind:"app" jsonl-only orphans with no meaningful title. Claude
 * job entries (kind:"bg") are always real — they came from
 * ~/.claude/jobs/<short>/state.json which is the same source `claude
 * agents` uses, so they're kept regardless of pid/name so the AgentView
 * grid mirrors the CLI exactly.
 */
export function isEmptyDeadSession(s: BgSession): boolean {
  if (s.alive) return false;
  if ((s.kind || '').toLowerCase() === 'bg') return false;
  const shortId = s.sessionId.slice(0, 8).toLowerCase();
  const title = (s.name || s.agent || '').trim().toLowerCase();
  if (!title || title === shortId || /^이름\s*없음$/.test(title)) return true;
  return false;
}
