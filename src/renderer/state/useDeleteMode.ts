import { useCallback, useState } from 'react';

export interface DeleteModeApi {
  deleteMode: boolean;
  selectedForDelete: Set<string>;
  toggleDeleteMode: () => void;
  toggleDeleteSelection: (sid: string) => void;
  /**
   * Confirm + dispatch the bulk delete IPC. On success, clears the
   * selection and exits delete mode. The caller threads a reload + toast
   * setter so this hook stays free of UI concerns.
   */
  performBulkDelete: () => Promise<void>;
}

interface UseDeleteModeDeps {
  onReload: () => void;
  notify: (kind: 'error' | 'info', text: string) => void;
}

export function useDeleteMode({ onReload, notify }: UseDeleteModeDeps): DeleteModeApi {
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(() => new Set());

  const toggleDeleteMode = useCallback(() => {
    setDeleteMode((v) => {
      if (v) setSelectedForDelete(new Set());
      return !v;
    });
  }, []);

  const toggleDeleteSelection = useCallback((sid: string) => {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }, []);

  const performBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedForDelete);
    if (ids.length === 0) return;
    const confirmMsg = `${ids.length}개 세션을 삭제합니다. claude agents 에서도 함께 제거됩니다. 계속할까요?`;
    if (!window.confirm(confirmMsg)) return;
    const result = await window.av.sessions.deleteMany(ids);
    if (result.failed.length > 0) {
      notify('error', `일부 삭제 실패 (${result.failed.length}건): ${result.failed[0].reason}`);
    } else {
      notify('info', `${result.deleted.length}개 세션을 삭제했습니다.`);
    }
    setSelectedForDelete(new Set());
    setDeleteMode(false);
    onReload();
  }, [selectedForDelete, onReload, notify]);

  return {
    deleteMode,
    selectedForDelete,
    toggleDeleteMode,
    toggleDeleteSelection,
    performBulkDelete
  };
}
