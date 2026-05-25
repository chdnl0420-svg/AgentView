import { useCallback, useEffect, useRef, useState } from 'react';
import type { BgSession, ScanSessionsResult } from '@shared/types';

const FLASH_MS = 900;

/**
 * Mirrors `~/.claude/sessions/*` + jobs into renderer state. Owns:
 *   - the latest scan snapshot
 *   - per-card flash markers (briefly highlights a card after a status change)
 *   - debounced reload on bulk changes
 */
export function useSessionScan() {
  const [scan, setScan] = useState<ScanSessionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<Map<string, number>>(() => new Map());
  const reloadTimer = useRef<number | null>(null);

  const reloadSessions = useCallback(async () => {
    const result = await window.av.sessions.list();
    setScan(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    reloadSessions();
  }, [reloadSessions]);

  useEffect(() => {
    const offChanged = window.av.sessions.onChanged(() => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(reloadSessions, 200);
    });
    const offUpdated = window.av.sessions.onSessionUpdated((s: BgSession) => {
      setScan((prev) => {
        if (!prev) return prev;
        const idx = prev.sessions.findIndex((x) => x.sessionId === s.sessionId);
        let nextList: BgSession[];
        if (idx === -1) nextList = [s, ...prev.sessions];
        else {
          nextList = prev.sessions.slice();
          nextList[idx] = s;
        }
        nextList.sort((a, b) => {
          if (a.alive !== b.alive) return a.alive ? -1 : 1;
          return b.updatedAt - a.updatedAt;
        });
        return { ...prev, sessions: nextList };
      });
      setFlash((prev) => {
        const next = new Map(prev);
        next.set(s.sessionId, Date.now());
        return next;
      });
    });
    return () => {
      offChanged();
      offUpdated();
    };
  }, [reloadSessions]);

  // sweep stale flash markers
  useEffect(() => {
    if (flash.size === 0) return;
    const id = window.setTimeout(() => {
      const cutoff = Date.now() - FLASH_MS;
      setFlash((prev) => {
        const next = new Map<string, number>();
        for (const [k, v] of prev) if (v > cutoff) next.set(k, v);
        return next.size === prev.size ? prev : next;
      });
    }, FLASH_MS);
    return () => window.clearTimeout(id);
  }, [flash]);

  return { scan, loading, flash, reloadSessions };
}
