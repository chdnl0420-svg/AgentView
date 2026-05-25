import { useEffect, useState } from 'react';
import type { ScanSessionsResult } from '@shared/types';
import {
  PENDING_HANDOFF_COOLDOWN_MS,
  PENDING_MAX_LIFETIME_MS,
  type PendingSession
} from '../lib/pendingSession';

/**
 * Owns optimistic placeholder cards for sessions we just dispatched. The
 * cleanup logic is two-stage:
 *   1. As soon as the real session first appears in scan, stamp realSeenAt.
 *   2. Only drop the placeholder after PENDING_HANDOFF_COOLDOWN_MS has
 *      elapsed since that first sighting — gives the daemon time to finish
 *      writing state.json so a flaky reload tick doesn't unmount the card.
 * PENDING_MAX_LIFETIME_MS is the absolute safety net for a failed dispatch
 * that never lands a real session.
 */
export function usePendingSessions(scan: ScanSessionsResult | null) {
  const [pending, setPending] = useState<PendingSession[]>([]);

  // Stage 1+2 cleanup driven by scan changes.
  useEffect(() => {
    if (pending.length === 0) return;
    const scannedIds = new Set((scan?.sessions ?? []).map((s) => s.sessionId));
    const now = Date.now();
    setPending((prev) => {
      let changed = false;
      const next: PendingSession[] = [];
      for (const p of prev) {
        if (now - p.startedAt > PENDING_MAX_LIFETIME_MS) {
          changed = true;
          continue;
        }
        const inScan = p.realSessionId !== null && scannedIds.has(p.realSessionId);
        if (inScan && p.realSeenAt === null) {
          changed = true;
          next.push({ ...p, realSeenAt: now });
          continue;
        }
        if (p.realSeenAt !== null && now - p.realSeenAt >= PENDING_HANDOFF_COOLDOWN_MS) {
          changed = true;
          continue;
        }
        next.push(p);
      }
      return changed ? next : prev;
    });
  }, [scan, pending]);

  // Re-trigger the cleanup after the handoff cooldown so the placeholder is
  // dropped even if no new scan arrives in that window. Without this, a quiet
  // daemon (worker started, no further updates) leaves the placeholder around
  // until the next user interaction or PENDING_MAX_LIFETIME_MS.
  useEffect(() => {
    const pendingHandoff = pending.find((p) => p.realSeenAt !== null);
    if (!pendingHandoff) return;
    const fireAt = pendingHandoff.realSeenAt! + PENDING_HANDOFF_COOLDOWN_MS;
    const delay = Math.max(0, fireAt - Date.now());
    const id = window.setTimeout(() => {
      setPending((prev) => {
        const now = Date.now();
        let changed = false;
        const next = prev.filter((p) => {
          if (p.realSeenAt !== null && now - p.realSeenAt >= PENDING_HANDOFF_COOLDOWN_MS) {
            changed = true;
            return false;
          }
          return true;
        });
        return changed ? next : prev;
      });
    }, delay + 16);
    return () => window.clearTimeout(id);
  }, [pending]);

  return { pending, setPending };
}
