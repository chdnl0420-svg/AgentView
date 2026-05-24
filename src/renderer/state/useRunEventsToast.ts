import { useEffect, useState } from 'react';
import type { ClaudeRunEvent } from '@shared/types';

export interface ToastMessage {
  kind: 'error' | 'info';
  text: string;
}

/**
 * Subscribe to claude run events and translate the noteworthy ones into a
 * dismissable toast. Each event also triggers a sessions reload so the
 * disk-state side updates without waiting for the live watcher tick.
 *
 * Auto-dismiss after 5s; the user can also click the toast to close it.
 */
export function useRunEventsToast(onReload: () => void) {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    const off = window.av.sessions.onRunEvent((evt: ClaudeRunEvent) => {
      if (evt.type === 'error') {
        setToast({ kind: 'error', text: `claude 실행 실패: ${evt.message}` });
      } else if (evt.type === 'busy') {
        setToast({
          kind: 'info',
          text: '이 에이전트는 이미 작업 중입니다. 끝난 뒤 다시 보내주세요.'
        });
      } else if (evt.type === 'exit' && evt.exitCode !== 0 && evt.exitCode !== null) {
        const detail = evt.stderr ? ` (${evt.stderr.split('\n')[0].slice(0, 120)})` : '';
        setToast({ kind: 'error', text: `claude 종료 코드 ${evt.exitCode}${detail}` });
      } else if (evt.type === 'spawn') {
        setToast(null);
      }
      onReload();
    });
    return off;
  }, [onReload]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  return { toast, setToast };
}
