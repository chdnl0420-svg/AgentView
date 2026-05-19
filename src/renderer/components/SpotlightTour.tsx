import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadJSON, saveJSON } from '../lib/persistence';
import '../styles/spotlight.css';

const TOUR_DONE_KEY = 'tour.done.v2';

export interface SpotlightStep {
  /** CSS selector for the element to highlight. First match wins. */
  selector: string;
  /** Optional fallback selector tried when the primary selector misses. */
  fallback?: string;
  title: string;
  body: string;
  /** Where to put the tooltip relative to the anchor. Default: bottom. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

const DEFAULT_STEPS: SpotlightStep[] = [
  {
    selector: '.input-bar textarea, textarea.input-box',
    title: '새 작업 입력',
    body: '여기에 하고 싶은 작업을 적고 전송하면 백그라운드 에이전트가 즉시 시작됩니다.',
    placement: 'top'
  },
  {
    selector: '#agent-select',
    fallback: '.input-controls',
    title: '에이전트 / 모델 / 권한 선택',
    body: '특정 sub-agent, 사용할 모델, 권한 모드를 여기서 고를 수 있습니다. 권한은 다음 메시지부터 적용돼요.',
    placement: 'bottom'
  },
  {
    selector: '.input-left-col .add-attach, .input-row .add-attach',
    title: '첨부 + 메시지 히스토리',
    body: '왼쪽 + 로 파일 첨부, 그 아래 ↑↓ 미니버튼으로 이전 메시지 불러오기.',
    placement: 'right'
  },
  {
    selector: '.window-options-btn, .titlebar-options',
    fallback: '.update-banner',
    title: '옵션 / 업데이트',
    body: '타이틀바의 옵션 버튼에서 현재 버전, 업데이트 받기, Enter 로 전송, 윈도우 시작 시 실행을 설정할 수 있습니다.',
    placement: 'bottom'
  },
  {
    selector: '.session-card, .session-grid .new-task-card',
    title: '세션 카드',
    body: '시작한 작업은 카드로 표시됩니다. 클릭으로 들어가 대화·도구 사용·결과를 봅니다. 삭제 모드에서 카드를 선택해 일괄 정리도 가능합니다.',
    placement: 'right'
  }
];

interface SpotlightTourProps {
  steps?: SpotlightStep[];
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const TOOLTIP_W = 320;
const TOOLTIP_GAP = 12;

export function SpotlightTour({ steps = DEFAULT_STEPS }: SpotlightTourProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const done = loadJSON<boolean>(TOUR_DONE_KEY, false);
    if (!done) {
      // Defer one tick so initial layout settles.
      const t = window.setTimeout(() => setOpen(true), 350);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, []);

  const finish = () => {
    saveJSON(TOUR_DONE_KEY, true);
    setOpen(false);
  };

  const step = steps[idx];

  // Track the anchor element's bounding rect and re-measure on resize / scroll.
  useLayoutEffect(() => {
    if (!open || !step) return undefined;
    let cancelled = false;
    const measure = () => {
      const el = pickAnchor(step);
      if (!el) {
        setAnchorRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setAnchorRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    };
    const onResize = () => {
      if (cancelled) return;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [open, step]);

  if (!open || !step) return null;

  const isLast = idx === steps.length - 1;
  const isFirst = idx === 0;
  const target: Rect = anchorRect
    ? {
        top: anchorRect.top - PAD,
        left: anchorRect.left - PAD,
        width: anchorRect.width + PAD * 2,
        height: anchorRect.height + PAD * 2
      }
    : { top: 0, left: 0, width: 0, height: 0 };

  const tooltipPos = anchorRect
    ? tooltipPosition(target, step.placement ?? 'bottom')
    : { top: window.innerHeight / 2 - 80, left: window.innerWidth / 2 - TOOLTIP_W / 2 };

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Four dim panels surround the anchor; anchor stays bright. When the
          anchor isn't found we just dim the whole screen so the user still
          sees the explanation. */}
      {anchorRect ? (
        <>
          <div className="tour-dim" style={{ top: 0, left: 0, right: 0, height: target.top }} />
          <div
            className="tour-dim"
            style={{
              top: target.top + target.height,
              left: 0,
              right: 0,
              bottom: 0
            }}
          />
          <div
            className="tour-dim"
            style={{
              top: target.top,
              left: 0,
              width: target.left,
              height: target.height
            }}
          />
          <div
            className="tour-dim"
            style={{
              top: target.top,
              left: target.left + target.width,
              right: 0,
              height: target.height
            }}
          />
          <div
            className="tour-ring"
            style={{
              top: target.top,
              left: target.left,
              width: target.width,
              height: target.height
            }}
          />
        </>
      ) : (
        <div className="tour-dim" style={{ inset: 0 }} />
      )}

      <div className="tour-tooltip" style={{ top: tooltipPos.top, left: tooltipPos.left }}>
        <div className="tour-step-counter">
          {idx + 1} / {steps.length}
        </div>
        <h3 id="tour-title" className="tour-title">
          {step.title}
        </h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="btn ghost" onClick={finish}>
            건너뛰기
          </button>
          <div className="tour-nav">
            {!isFirst && (
              <button
                type="button"
                className="btn"
                onClick={() => setIdx((v) => Math.max(0, v - 1))}
              >
                이전
              </button>
            )}
            {!isLast && (
              <button
                type="button"
                className="btn primary"
                onClick={() => setIdx((v) => Math.min(steps.length - 1, v + 1))}
              >
                다음
              </button>
            )}
            {isLast && (
              <button type="button" className="btn primary" onClick={finish}>
                완료
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function pickAnchor(step: SpotlightStep): HTMLElement | null {
  const direct = document.querySelector<HTMLElement>(step.selector);
  if (direct && isVisible(direct)) return direct;
  if (step.fallback) {
    const fb = document.querySelector<HTMLElement>(step.fallback);
    if (fb && isVisible(fb)) return fb;
  }
  return null;
}

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return true;
}

function tooltipPosition(target: Rect, placement: 'top' | 'bottom' | 'left' | 'right'): {
  top: number;
  left: number;
} {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = target.top;
  let left = target.left;
  switch (placement) {
    case 'bottom':
      top = target.top + target.height + TOOLTIP_GAP;
      left = target.left + target.width / 2 - TOOLTIP_W / 2;
      break;
    case 'top':
      top = target.top - TOOLTIP_GAP - 180;
      left = target.left + target.width / 2 - TOOLTIP_W / 2;
      break;
    case 'left':
      top = target.top + target.height / 2 - 90;
      left = target.left - TOOLTIP_GAP - TOOLTIP_W;
      break;
    case 'right':
      top = target.top + target.height / 2 - 90;
      left = target.left + target.width + TOOLTIP_GAP;
      break;
  }
  // Clamp to viewport.
  if (left < 12) left = 12;
  if (left + TOOLTIP_W > vw - 12) left = vw - TOOLTIP_W - 12;
  if (top < 12) top = 12;
  if (top + 200 > vh - 12) top = vh - 220;
  return { top, left };
}
