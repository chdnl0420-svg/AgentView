import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addTagToCatalog,
  loadTagCatalog,
  removeTagFromCatalog,
  type SessionTag,
} from '../lib/sessionTags';

interface SessionListTagDialogProps {
  open: boolean;
  /** Currently-applied tag IDs across all selected sessions (intersect). */
  appliedTagIds: string[];
  onClose: () => void;
  /** Called when the user wants to set the union of these tag IDs on every selected session. */
  onApply: (tagIds: string[]) => void;
}

const PRESET_COLORS = ['#f47474', '#f0c25c', '#6dd9a8', '#7c9bff', '#b388ff', '#5fb6e0', '#9aa5b8'];

/**
 * Tag picker dialog for the multi-select bar. Shows the catalog with
 * checkboxes (intersection of the selected sessions' current tags) and
 * lets the user add new tags inline.
 */
export function SessionListTagDialog({
  open,
  appliedTagIds,
  onClose,
  onApply
}: SessionListTagDialogProps) {
  const [catalog, setCatalog] = useState<SessionTag[]>(() => loadTagCatalog());
  const [picked, setPicked] = useState<Set<string>>(new Set(appliedTagIds));
  const [addingName, setAddingName] = useState('');
  const [addingColor, setAddingColor] = useState(PRESET_COLORS[0]);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setCatalog(loadTagCatalog());
    setPicked(new Set(appliedTagIds));
    previousActiveRef.current = (document.activeElement as HTMLElement) ?? null;
    const t = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('input,button')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      const el = previousActiveRef.current;
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, [open, appliedTagIds]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const doAdd = () => {
    const name = addingName.trim();
    if (!name) return;
    const tag = addTagToCatalog(name, addingColor);
    setCatalog([...catalog, tag]);
    setPicked((prev) => new Set([...prev, tag.id]));
    setAddingName('');
  };

  const doRemove = (tagId: string) => {
    if (!window.confirm('태그를 카탈로그에서 삭제합니다. (모든 세션에서 해제됨)')) return;
    removeTagFromCatalog(tagId);
    setCatalog(loadTagCatalog());
    setPicked((prev) => {
      const next = new Set(prev);
      next.delete(tagId);
      return next;
    });
  };

  const renderedCatalog = useMemo(() => catalog, [catalog]);

  if (!open) return null;
  return (
    <div
      className="tag-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="tag-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="태그 지정"
      >
        <header className="tag-dialog-head">
          <h3>태그 지정</h3>
          <button type="button" className="tag-dialog-close" onClick={onClose} aria-label="닫기">×</button>
        </header>
        <div className="tag-dialog-body">
          <ul className="tag-dialog-list">
            {renderedCatalog.map((t) => (
              <li key={t.id} className="tag-dialog-row">
                <label className="tag-dialog-label">
                  <input
                    type="checkbox"
                    checked={picked.has(t.id)}
                    onChange={() => togglePick(t.id)}
                  />
                  <span className="tag-dialog-chip" style={{ background: t.color }}>
                    {t.name}
                  </span>
                </label>
                <button
                  type="button"
                  className="tag-dialog-row-del"
                  onClick={() => doRemove(t.id)}
                  title="카탈로그에서 태그 삭제"
                  aria-label="카탈로그에서 삭제"
                >🗑</button>
              </li>
            ))}
            {renderedCatalog.length === 0 && (
              <li className="tag-dialog-empty">아직 태그가 없습니다. 아래에서 추가하세요.</li>
            )}
          </ul>
          <div className="tag-dialog-add">
            <input
              type="text"
              placeholder="새 태그 이름"
              value={addingName}
              onChange={(e) => setAddingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  doAdd();
                }
              }}
              aria-label="새 태그 이름"
            />
            <div className="tag-dialog-colors" role="radiogroup" aria-label="색상 선택">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={addingColor === c}
                  className={`tag-dialog-color ${addingColor === c ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => setAddingColor(c)}
                  aria-label={`색상 ${c}`}
                />
              ))}
            </div>
            <button type="button" className="btn sm primary" onClick={doAdd} disabled={!addingName.trim()}>
              ＋ 추가
            </button>
          </div>
        </div>
        <footer className="tag-dialog-foot">
          <button type="button" className="btn sm" onClick={onClose}>취소</button>
          <button
            type="button"
            className="btn sm primary"
            onClick={() => {
              onApply(Array.from(picked));
              onClose();
            }}
          >
            적용
          </button>
        </footer>
      </div>
    </div>
  );
}
