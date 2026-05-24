import { useCallback, useState } from 'react';
import type { QueuedPrompt } from '../components/SessionDetail';

/**
 * Queued messages while an agent is busy. The first item is sent
 * automatically once the agent flips back to idle; the user can remove an
 * item with × and the prompt jumps back into the composer.
 */
export function useQueues() {
  const [queues, setQueues] = useState<Record<string, QueuedPrompt[]>>({});

  const setQueue = useCallback(
    (sessionId: string, updater: (prev: QueuedPrompt[]) => QueuedPrompt[]) => {
      setQueues((prev) => {
        const cur = prev[sessionId] ?? [];
        const next = updater(cur);
        if (next.length === 0) {
          if (!(sessionId in prev)) return prev;
          const { [sessionId]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [sessionId]: next };
      });
    },
    []
  );

  return { queues, setQueue };
}
