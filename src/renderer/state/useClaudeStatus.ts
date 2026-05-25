import { useEffect, useState } from 'react';

export interface ClaudeStatus {
  cliPath: string | null;
  cliVersion: string | null;
  daemonAlive: boolean;
  supervisorPid: number | null;
  checkedAt: number;
}

/**
 * Poll Claude CLI / daemon status so the user can see when the runtime is
 * missing or in the middle of being woken up, instead of staring at an
 * unresponsive composer. Cheap call (~ms) on first launch + every 30s.
 */
export function useClaudeStatus() {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await window.av.claude.status(false);
        if (!cancelled) setClaudeStatus(s);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return claudeStatus;
}
