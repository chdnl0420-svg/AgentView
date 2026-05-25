import { useCallback, useEffect, useState } from 'react';
import type { AgentInfo, RunningSessionInfo } from '@shared/types';

/**
 * Owns the agent list (claude `agents`) + currently-running session list,
 * including the watcher that pushes updates to `running`.
 */
export function useAgentsAndRunning() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [running, setRunning] = useState<RunningSessionInfo[]>([]);

  const reloadAgents = useCallback(async () => {
    const list = await window.av.agents.list();
    setAgents(list);
  }, []);

  const reloadRunning = useCallback(async () => {
    const list = await window.av.sessions.runningList();
    setRunning(list);
  }, []);

  useEffect(() => {
    reloadAgents();
    reloadRunning();
  }, [reloadAgents, reloadRunning]);

  useEffect(() => {
    const off = window.av.sessions.onRunningChanged((list) => setRunning(list));
    return off;
  }, []);

  return { agents, running, reloadAgents, reloadRunning };
}
