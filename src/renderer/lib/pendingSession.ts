import type { BgSession } from '@shared/types';

/**
 * Local placeholder for a brand-new agent we just dispatched. The daemon
 * takes 2-5s to write ~/.claude/jobs/<short>/state.json (the only source
 * the sessions scanner reads), so without this the user clicks "▶ 새 작업
 * 시작" and stares at an unchanged grid until the worker lands.
 */
export interface PendingSession {
  tempId: string;
  realSessionId: string | null;
  /**
   * Timestamp the real session first appeared in the disk scan. Used to
   * delay dropping the placeholder until the daemon-registered card has
   * been visible for a brief cooldown — without this, a single flaky scan
   * tick (daemon mid-write of state.json) silently unmounts the freshly
   * spawned agent card.
   */
  realSeenAt: number | null;
  startedAt: number;
  prompt: string;
  cwd: string;
  agent: string;
  backend?: BgSession['backend'];
  name: string;
}

export const PENDING_PREFIX = 'pending-';
export const PENDING_MAX_LIFETIME_MS = 45_000;
/**
 * Keep the placeholder around for this long after the real session first
 * appears in scan, so a transient miss on the next reload (the daemon
 * writes jobs/<short>/state.json incrementally) doesn't cause the card to
 * vanish.
 */
export const PENDING_HANDOFF_COOLDOWN_MS = 4_000;

export function makeTempId(): string {
  const rnd =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${PENDING_PREFIX}${rnd}`;
}

export function pendingToBgSession(p: PendingSession): BgSession {
  return {
    pid: 0,
    sessionId: p.realSessionId || p.tempId,
    cwd: p.cwd,
    startedAt: p.startedAt,
    updatedAt: p.startedAt,
    kind: 'bg',
    entrypoint: 'pending',
    name: p.name,
    agent: p.agent,
    backend: p.backend,
    jobId: (p.realSessionId || p.tempId).slice(0, 8),
    status: 'running',
    alive: true,
    metaPath: '',
    conversationPath: null,
    conversationSize: 0,
    lastUserText: p.prompt
  };
}
