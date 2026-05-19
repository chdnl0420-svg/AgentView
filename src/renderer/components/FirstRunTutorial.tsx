import { useEffect, useState } from 'react';
import { loadJSON, saveJSON } from '../lib/persistence';

const TUTORIAL_DONE_KEY = 'tutorial.done.v1';
const STEPS = [
  {
    title: 'AgentView 에 오신 것을 환영합니다',
    body: 'Claude Code 의 백그라운드 에이전트를 데스크톱에서 한눈에 관리합니다. 사이드바 카드들이 곧 표시될 모든 에이전트 입니다.',
    icon: '👋'
  },
  {
    title: '새 작업 시작하기',
    body: '하단 입력창에 작업을 적고 ▶ 새 작업 시작 (또는 Ctrl+Enter) 을 누르면 백그라운드 에이전트가 즉시 dispatch 됩니다. claude agents CLI 와 동기화됩니다.',
    icon: '▶'
  },
  {
    title: '권한 모드',
    body: '권한 dropdown 으로 에이전트의 권한 레벨을 선택합니다. 전체 허용은 Max 계정에서만 활성화됩니다. 기본은 편집만 자동.',
    icon: '🛡'
  },
  {
    title: '에이전트에 답변하기',
    body: '에이전트가 질문하거나 권한 확인을 요청하면 화면 하단에 답변 패널이 떠 옵션을 클릭으로 응답할 수 있습니다.',
    icon: '❓'
  },
  {
    title: '컨텍스트 사용량',
    body: '에이전트 작업 창 상단의 도넛 아이콘을 누르면 현재 토큰 사용량과 남은 컨텍스트를 볼 수 있습니다.',
    icon: '🍩'
  },
  {
    title: '준비 완료!',
    body: '이제 입력창에 작업을 입력하면 됩니다. 마우스 뒤로/앞으로 버튼으로 화면 이동도 가능합니다.',
    icon: '🚀'
  }
];

export function FirstRunTutorial(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const done = loadJSON<boolean>(TUTORIAL_DONE_KEY, false);
    if (!done) setOpen(true);
  }, []);
  if (!open) return null;
  const finish = () => {
    saveJSON(TUTORIAL_DONE_KEY, true);
    setOpen(false);
  };
  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;
  return (
    <div className="tutorial-backdrop" onClick={() => undefined}>
      <div className="tutorial-modal">
        <button type="button" className="tutorial-skip" onClick={finish} aria-label="튜토리얼 건너뛰기">건너뛰기</button>
        <div className="tutorial-icon">{cur.icon}</div>
        <h2 className="tutorial-title">{cur.title}</h2>
        <p className="tutorial-body">{cur.body}</p>
        <div className="tutorial-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`tutorial-dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>
        <div className="tutorial-actions">
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep((v) => v - 1)}>이전</button>
          )}
          {!isLast && (
            <button className="btn primary" onClick={() => setStep((v) => v + 1)}>다음</button>
          )}
          {isLast && (
            <button className="btn primary" onClick={finish}>시작하기</button>
          )}
        </div>
        <div className="tutorial-step-label">{step + 1} / {STEPS.length}</div>
      </div>
    </div>
  );
}
