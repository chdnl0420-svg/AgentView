// AskQuestionWizard — pagination UI for AskUserQuestion tool calls with
// more than one question. Shows one question at a time with prev/next +
// final submit button. Default selection: the option flagged as
// "recommended" (or first option if none).
//
// Keyboard:
//   - ←/→ : prev/next page
//   - Enter: next (or submit on last)
//   - Ctrl+Enter: submit immediately

import React, { useEffect, useMemo, useState } from 'react';
import type { AskQuestion } from '../lib/toolSummary';

interface AskQuestionWizardProps {
  questions: AskQuestion[];
  submitting: boolean;
  onSubmit: (selections: Record<number, string | string[]>) => void;
}

// AskQuestionOption may carry a `recommended` flag in the source data
// (claude often marks one option). We accept it loosely as an extension.
interface OptionWithFlag {
  label: string;
  description?: string;
  recommended?: boolean;
}

function pickDefault(q: AskQuestion): string | string[] {
  const opts = (q.options || []) as OptionWithFlag[];
  const rec = opts.find((o) => o.recommended);
  const fallback = opts[0]?.label || '';
  if (q.multiSelect) {
    return rec ? [rec.label] : (fallback ? [fallback] : []);
  }
  return rec ? rec.label : fallback;
}

export function AskQuestionWizard({ questions, submitting, onSubmit }: AskQuestionWizardProps) {
  const [page, setPage] = useState(0);
  const [selections, setSelections] = useState<Record<number, string | string[]>>(() => {
    const init: Record<number, string | string[]> = {};
    questions.forEach((q, i) => {
      init[i] = pickDefault(q);
    });
    return init;
  });

  // Reset when the question batch identity changes (parent passes a new
  // questions array reference for each new tool_use).
  const sig = useMemo(
    () => questions.map((q) => q.question).join('|'),
    [questions]
  );
  useEffect(() => {
    const init: Record<number, string | string[]> = {};
    questions.forEach((q, i) => {
      init[i] = pickDefault(q);
    });
    setSelections(init);
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const total = questions.length;
  const isLast = page === total - 1;
  const q = questions[page];
  const multi = !!q.multiSelect;
  const sel = selections[page];

  const isSelected = (label: string): boolean =>
    Array.isArray(sel) ? sel.includes(label) : sel === label;
  const toggle = (label: string) => {
    setSelections((prev) => {
      const next = { ...prev };
      if (multi) {
        const cur = Array.isArray(next[page]) ? (next[page] as string[]) : [];
        next[page] = cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label];
      } else {
        next[page] = next[page] === label ? '' : label;
      }
      return next;
    });
  };
  const allAnswered = useMemo(() => {
    return questions.every((_, i) => {
      const v = selections[i];
      if (Array.isArray(v)) return v.length > 0;
      return !!(v && typeof v === 'string' && v.length > 0);
    });
  }, [questions, selections]);

  const submit = () => {
    if (!allAnswered || submitting) return;
    onSubmit(selections);
  };
  const nextPage = () => {
    if (page < total - 1) setPage((p) => p + 1);
  };
  const prevPage = () => {
    if (page > 0) setPage((p) => p - 1);
  };

  // Global key handling — only when the wizard is mounted (so pendingAsk
  // is non-null). Ctrl+Enter sends, ← / → flip pages, Enter advances or
  // submits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore key events that originate from a textarea/input — the
      // composer takes precedence.
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'TEXTAREA' || tgt.tagName === 'INPUT')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextPage();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevPage();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (isLast) submit();
        else nextPage();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, total, isLast, allAnswered, submitting]);

  return (
    <div className="ask-panel ask-wizard" role="dialog" aria-label="에이전트 질문">
      <div className="ask-panel-head">
        <span className="ask-panel-icon">❓</span>
        <span className="ask-panel-title">에이전트의 질문</span>
        <span className="ask-wizard-counter">질문 {page + 1} / {total}</span>
      </div>
      <div className="ask-panel-q">
        {q.header && <div className="ask-panel-header">{q.header}</div>}
        <div className="ask-panel-question">
          {q.question}
          {multi && <span className="ask-panel-multi-badge">중복 선택 가능</span>}
        </div>
        {q.options && q.options.length > 0 && (
          <div className="ask-panel-options">
            {q.options.map((o, oi) => (
              <button
                key={oi}
                type="button"
                className={`ask-panel-option ${isSelected(o.label) ? 'selected' : ''}`}
                disabled={submitting}
                tabIndex={-1}
                onClick={() => toggle(o.label)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                aria-pressed={isSelected(o.label)}
              >
                <span className="ask-panel-key">{isSelected(o.label) ? '✓' : oi + 1}</span>
                <span className="ask-panel-option-body">
                  <strong>{o.label}</strong>
                  {o.description && <span className="ask-panel-desc">{o.description}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="ask-wizard-nav">
        <button
          type="button"
          className="btn sm"
          onClick={prevPage}
          disabled={page === 0 || submitting}
          tabIndex={-1}
        >
          ← 이전
        </button>
        <span className="ask-wizard-dots" aria-hidden="true">
          {questions.map((_, i) => (
            <span
              key={i}
              className={`ask-wizard-dot ${i === page ? 'active' : ''}`}
            />
          ))}
        </span>
        {isLast ? (
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={!allAnswered || submitting}
            tabIndex={-1}
          >
            {submitting ? '전송 중…' : '↗ 전송'}
          </button>
        ) : (
          <button
            type="button"
            className="btn sm"
            onClick={nextPage}
            disabled={submitting}
            tabIndex={-1}
          >
            다음 →
          </button>
        )}
      </div>
      <div className="ask-wizard-hint">
        ← / → 페이지 이동 · Enter 다음 · Ctrl+Enter 즉시 전송
      </div>
    </div>
  );
}
