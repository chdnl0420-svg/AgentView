import type React from 'react';

interface SessionListMultiBarProps {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onTag: () => void;
  /** True when every selected session is already archived → flip the button to "복원". */
  allArchived: boolean;
}

/**
 * Floating action bar that pins to the bottom of the sidebar when the user
 * has selected ≥ 1 session in multi-select mode. Researcher items #19
 * (일괄 삭제) + #20 (일괄 아카이브) + tag system.
 */
export function SessionListMultiBar(props: SessionListMultiBarProps): React.ReactElement | null {
  const { count, onClear, onDelete, onArchive, onUnarchive, onTag, allArchived } = props;
  if (count === 0) return null;
  return (
    <div className="session-list-multibar" role="toolbar" aria-label="선택 세션 작업">
      <span className="session-list-multibar-count">{count}개 선택</span>
      <button
        type="button"
        className="session-list-multibar-btn"
        onClick={onTag}
        title="태그 지정 / 해제"
      >
        🏷 태그
      </button>
      {allArchived ? (
        <button
          type="button"
          className="session-list-multibar-btn"
          onClick={onUnarchive}
          title="아카이브 해제"
        >
          ⤴ 복원
        </button>
      ) : (
        <button
          type="button"
          className="session-list-multibar-btn"
          onClick={onArchive}
          title="선택 세션을 아카이브"
        >
          📦 아카이브
        </button>
      )}
      <button
        type="button"
        className="session-list-multibar-btn danger"
        onClick={onDelete}
        title="선택 세션 모두 삭제"
      >
        🗑 삭제
      </button>
      <button
        type="button"
        className="session-list-multibar-btn ghost"
        onClick={onClear}
        title="선택 해제"
        aria-label="선택 해제"
      >
        ×
      </button>
    </div>
  );
}
