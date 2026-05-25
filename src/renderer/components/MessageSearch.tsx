import { useEffect, useRef, useState } from 'react';

interface MessageSearchProps {
  open: boolean;
  initialQuery?: string;
  total: number;
  activeIdx: number;
  onQueryChange: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/**
 * In-session message search bar. Stays visible while the user navigates hits
 * with F3 / Shift+F3 (Enter / Shift+Enter inside the input also work) and
 * disappears on Escape.
 *
 * The component is a *thin controlled view* — actual highlight + scroll
 * logic lives in SessionDetail because only it owns the message DOM nodes.
 */
export function MessageSearch({
  open,
  initialQuery,
  total,
  activeIdx,
  onQueryChange,
  onNext,
  onPrev,
  onClose
}: MessageSearchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialQuery ?? '');

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    if (open) setValue(initialQuery ?? '');
  }, [open, initialQuery]);

  if (!open) return null;

  const label = total === 0
    ? value.length > 0 ? '결과 없음' : ''
    : `${activeIdx + 1} / ${total}`;

  return (
    <div className="msg-search" role="search" aria-label="세션 내 메시지 검색">
      <input
        ref={inputRef}
        type="text"
        className="msg-search-input"
        placeholder="이 세션 내 검색"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onQueryChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
            return;
          }
          if (e.key === 'F3') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
        aria-label="검색어"
      />
      <span className="msg-search-count" aria-live="polite">{label}</span>
      <button
        type="button"
        className="msg-search-btn"
        onClick={onPrev}
        disabled={total === 0}
        title="이전 결과 (Shift+Enter / Shift+F3)"
        aria-label="이전 결과"
      >↑</button>
      <button
        type="button"
        className="msg-search-btn"
        onClick={onNext}
        disabled={total === 0}
        title="다음 결과 (Enter / F3)"
        aria-label="다음 결과"
      >↓</button>
      <button
        type="button"
        className="msg-search-btn"
        onClick={onClose}
        title="닫기 (Esc)"
        aria-label="검색 닫기"
      >×</button>
    </div>
  );
}
