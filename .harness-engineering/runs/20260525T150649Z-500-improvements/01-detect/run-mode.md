# Run mode

- **mode**: `feature-add` (UI polish + 광범위 편의 강화)
- **target**: AgentView Electron 앱 (renderer 중심)
- **scope**: 500+ 항목 plan 명세 + 핵심 ~80개 실 구현
- **waivers**:
  - step 2 (DDD domain modeling) — UI cosmetic, 도메인 모델 부적합
  - step 3 (TDD) — UI 시각 변경에 unit test 어려움 (Playwright 미구축)
  - step 5/6 (codex / customer) — PR 리뷰로 대체
- **non-waivable invariant**: 외부 의존성 없음 (UI 전용), 푸쉬 사용자가 직접
