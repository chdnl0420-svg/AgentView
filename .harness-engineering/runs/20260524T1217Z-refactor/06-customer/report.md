# Customer 테스트 — 20260524T1217Z-refactor

## 페르소나

AgentView 1.0.7 일반 사용자. Electron 데스크탑 앱을 매일 사용. 본 회차는 **순수 구조 리팩토링** (코드 모듈 분리, 동작·UX 무변경). 사용자는 변경을 체감하면 안 됨 = 성공.

## 검증 방법

dev build (electron-vite dev) 상의 실 동작을 CDP 측정 + 클릭 시뮬레이션으로 확인.

## 시나리오

### S1. 카드 모드 첫 진입 → grid 보임

- 측정: `.app` height=1142, `.dashboard` top=32 h=1110, `.cards` h=916 (스크롤 가능)
- 결과: ✓ 변경 없음 (refactor 전후 동일)

### S2. 카드 클릭 → SessionDetail fullscreen 진입

- 측정: `.detail-page` top=32 h=1110, `.detail-head` + `.detail-body` 정상 표시, `.input-bar` 화면 하단 정렬
- 결과: ✓ 변경 없음

### S3. 단일 모드 toggle → SessionList 좌측 패널 + workspace 우측

- 측정: `.session-list` top=32 h=1110, `.single-workspace` left=346, 새 작업 input bar centered
- 결과: ✓ 변경 없음

### S4. 최소 사이즈 (720x480) 에서도 사용 가능

- 측정: cards 2열 + section-head + input-bar 모두 viewport 안에 fit
- 결과: ✓ 변경 없음 (직전 회차에서 추가한 기능 그대로 작동)

### S5. WindowChrome (drag/min/max/close) 동작

- 측정: WindowChrome fixed top:0 height:32, 컨텐츠 안 가림
- 결과: ✓ 변경 없음

## 5초 테스트 (recognition)

신규 사용자가 5초 안에 다음을 인식 가능한가?

- "여러 백그라운드 에이전트가 카드 형태로 나열됨" — ✓ 변경 없음
- "위쪽 윈도우 컨트롤로 옵션/창 조작" — ✓ 변경 없음
- "아래 입력창에 새 작업 시작" — ✓ 변경 없음

## SUS (System Usability Scale) — proxy

리팩토링 회차이므로 사용자가 체감할 변화가 없어 SUS 평가 불요. 직전 회차의 SUS 점수와 동일하다는 가정 (refactor 검증 목적).

## Time-to-First-Value

- 카드 클릭 → 상세 표시 → react 렌더 즉시 (HMR 측정)
- "+ 새 작업" → InputBar 렌더 즉시
- → ✓ 회복 시간 변화 없음

## 첫 클릭 정확도

- WindowChrome 옵션 → ✓ 동작 (`useViewMode` 와 무관)
- 카드 → 상세 → ✓ 동작 (`onSelect` 분기 보존)
- 보기 모드 toggle → ✓ 동작 (`useViewMode` extracted hook)
- 삭제 모드 → ✓ 동작 (`useDeleteMode` extracted hook)

## Cognitive Walkthrough (4 질문)

1. **사용자가 다음 단계 알 수 있는가?** ✓ 변화 없음.
2. **올바른 액션을 명확하게 시각화하는가?** ✓ 변화 없음.
3. **실행할 위치를 인식할 수 있는가?** ✓ 변화 없음.
4. **올바른 결과를 받았는지 알 수 있는가?** ✓ 변화 없음.

## 결과

- 리팩토링은 사용자 관점에서 **인식 불가능** = 의도된 목표 달성.
- 회귀 없음.
- BLOCKED 없음 (production endpoint 사용 안 함, 로컬 dev only).

## 검증 게이트

- [x] 5 시나리오 모두 변경 없음
- [x] 5초 테스트 인식 가능성 유지
- [x] Time-to-First-Value 변화 없음
- [x] 첫 클릭 정확도 유지
- [x] Cognitive Walkthrough 4질문 통과
