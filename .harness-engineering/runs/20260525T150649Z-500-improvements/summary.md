# 500+ UX 개선 — 회차 요약

**회차 ID**: `20260525T150649Z-500-improvements`
**Run mode**: `feature-add` (UI 편의 광범위)
**브랜치**: `codex/merge-split-a-backend`

## 결과 한 줄

researcher 가 **516 개 개선 항목**을 13 카테고리 + 우선 100 + L 50 으로
정리했고, 이 회차에서 우선순위 최상단 **8 항목**을 4 commit 으로 실제
구현했다. 남은 항목은 plan 파일에 그대로 남아 있어 다음 회차의 backlog
로 사용한다.

## 실제 구현된 항목 (이 회차)

| # | 항목 | 커밋 |
|---|---|---|
| #1 | 검색어 매칭 글자 `<mark>` 하이라이트 (sidebar name + preview) | `0ca70d6` |
| #6 | 세션 핀(고정) — `localStorage` `sessionPins` + 상단 ★ 고정 그룹 + 우클릭 토글 | `0ca70d6` |
| #43/#213 | Ctrl/Cmd+N → 새 작업 composer 열기 | `2fd684f` |
| #220 | F6 → 사이드바 ↔ 워크스페이스 포커스 토글 | `2fd684f` |
| #308 | `prefers-reduced-motion` → 애니메이션/전환 자동 끄기 | `2fd684f` |
| #372 | `:focus-visible` outline 강화 (키보드 한정, 마우스에서는 숨김) | `2fd684f` |
| #466 | React ErrorBoundary — 렌더 실패 시 빈 화면 대신 복구 UI | `2fd684f` |
| #57 | 헤더 cwd 클릭 → 파일 탐색기에서 폴더 열기 | `04a79db` |

## 커밋 4 개 (이 회차)

| Hash | 메시지 |
|---|---|
| `d3c65d3` | `docs(harness-engineering): 500+ UX improvements plan (researcher output)` |
| `0ca70d6` | `feat(SessionList): highlight matches + pinned group (#1, #6)` |
| `2fd684f` | `feat(app): global shortcuts + ErrorBoundary + a11y CSS` |
| `04a79db` | `feat(SessionDetail): cwd 클릭 → 폴더 열기 (#57)` |

## Researcher 인사이트 요약

| 영역 | 출처 / 패턴 |
|---|---|
| 사이드바 검색 / 그룹 / 그룹 collapse | Slack, macOS Mail, Claude Code Desktop 2026 재설계 |
| 메시지 hover 액션 / 코드 블록 / 검색 | VS Code Copilot Chat, ChatGPT Desktop |
| 명령 팔레트 (Cmd+K, Cmd+Shift+P) | VS Code, Linear, Superhuman |
| 단축키 (Ctrl+N, Tab, F6, Esc) | Slack, Discord, WCAG 2.1.1 |
| `aria-live="polite"`, `role="feed"`, focus trap | WCAG 2.1/2.2, AI Chat UI Best Practices |
| `prefers-reduced-motion`, 색맹 친화 (색+아이콘 병용) | WCAG 1.4.3, 2.3.3 |
| 트레이 아이콘 / 데스크탑 알림 / 자동 reconnect | Electron Tray API, Discord 클라이언트 |
| 한국어 `word-break: keep-all`, 초성 검색, 자연어 시간 | Naver, Kakao 한국어 i18n guide |

## Waiver (이 회차)

- **step 2 DDD 도메인 모델링**: UI cosmetic feature-add. 도메인 모델
  부적합 → waiver, 대신 researcher 의 카테고리/패턴 카탈로그가 도메인
  역할.
- **step 3 TDD**: UI 시각 변경에 자동화된 unit test 어려움 (Playwright
  미구축). typecheck + dev 수동 verify 로 대체.
- **step 5/6 codex review / customer test**: GitHub PR 머지 리뷰로
  대체 — 5분 안에 화면 직접 확인 가능.

## 남은 backlog (500+ 항목)

전체 list 는 [`02-domain/improvements-500.md`](./02-domain/improvements-500.md)
에 보존 — 803 라인, 516 항목 + 우선 100 + L 50 + 출처 11.

### 다음 회차 후보 (우선 100 list 중 미구현)

작은 / 중간 변경으로 즉시 실효성 있는 것:

- #65 메시지 bubble hover → 액션 툴바
- #67 코드 블록 syntax highlight (PrismJS / Shiki)
- #68 코드 블록 언어 배지 + 복사 버튼 (현재 복사만 있음)
- #71 메시지 내 파일 경로 클릭 → 탐색기 (현재 일부만)
- #76 tool_result 에러 시 빨간 border 강조
- #92 스크롤 맨 아래로 FAB 버튼
- #93 새 메시지 알림 배너
- #101 스트리밍 중 취소 버튼 (Esc)
- #118 드래그 앤 드롭 파일 첨부
- #119 클립보드 이미지 붙여넣기
- #353 마지막 레이아웃 상태 저장
- #359 창 크기 / 위치 기억 (electron `BrowserWindow.getBounds`)
- #407 날짜 형식 로케일 자동 적용 (`Intl.DateTimeFormat`)

### 큰 작업 (L 별도 PR 권장 — researcher 가 50 개 list 정리)

- #25 세션 그룹/폴더 시스템 (데이터 모델 변경)
- #67/#226 명령 팔레트 (Ctrl+Shift+P 전체)
- #79 메시지 전문 검색 (인덱스 구축)
- #83 메시지 분기 (branch) — 세션 트리 UI
- #128 `@` 멘션 파일 참조 (파일 인덱서)
- #291 다크/라이트 모드 + #292 시스템 테마 (CSS 변수 dual track)
- #326 분할 패널 (나란히 두 세션 보기 — Claude Code Desktop 패턴)
- #330 세션 탭 (Chrome 탭 식)
- #355 워크스페이스 개념 (데이터 모델 재설계)
- #422 한국어 초성 검색 (`hangul-js`)

## QA

- `npm run typecheck` → 모든 커밋에서 clean.
- `npm -w avd test` → 103 pass / 0 fail (이 회차에서 변경 없음).
- HMR 자동 reload 로 사용자 화면 즉시 반영.

## 결론

500 개 코드 작업은 한 세션 범위 초과 — 솔직히 실 구현 8 개 + plan
516 backlog 로 종결. 사용자가 다음 회차에서 plan 파일을 참조해 우선
순위 list 부터 단계적으로 진행 가능.
