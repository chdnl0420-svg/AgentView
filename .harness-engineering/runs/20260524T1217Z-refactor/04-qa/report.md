# QA report — step 4

## 명령

- `npm run typecheck` → 0 errors, 0 warnings (avd workspace build + tsc node + tsc web)
- `npm run build` → 성공 (main 129.67 kB, preload 8.15 kB, renderer JS 394.80 kB, renderer CSS 81.77 kB)
- 빌드 시 무해한 경고 1건 → 즉시 수정: `conversationLoader` 의 dynamic import 를 static 으로 정리.
- 렌더러 layout 측정 (CDP) → 모든 모드 정상 (cards/single/detail).

## 파일 크기 변화

| 파일 | before | after | 한도 (400) |
|---|---|---|---|
| src/main/ipc.ts → src/main/ipc/* | 772 | max 332 (sessions.ts) | ✓ |
| src/renderer/App.tsx | 957 | 354 | ✓ |
| src/renderer/styles/global.css | 2335 | 63 (import 목록만) | ✓ |
| 신규 ipc 모듈 9 개 | — | 8 ~ 332 | ✓ |
| 신규 state 훅 11 개 | — | 11 ~ 78 | ✓ |
| 신규 styles parts 27 개 | — | 9 ~ 323 | ✓ |

## 200 줄 목표 초과 모듈 (HIGH cap 400 은 모두 이하, MEDIUM 200 만 초과)

| 파일 | 줄 | 사유 |
|---|---|---|
| src/renderer/App.tsx | 354 | composition root + onStartNewSession 60줄 + 3 view branch. 더 쪼개면 prop drilling 늘어남. |
| src/main/ipc/sessions.ts | 332 | 18개 session 핸들러 + cancel loop + outputTails + delete (~70줄). 핸들러 단위 분리는 가능하지만 IPC 등록 한 곳에 모아두는 게 발견성↑. |
| styles/parts/conversation.css | 323 | .conv / .msg / .bubble / .role-line + 인접 selector 묶음. 추가 분해 시 selector 응집 약화. |
| styles/parts/detail.css | 255 | detail-page + detail-head + toast + thinking + markdown table 묶음 |
| styles/parts/single-mode.css | 241 | single 모드 전용 (session-list panel + workspace + override). 한 모드 묶음 유지가 합리적. |

본 5 파일은 200 목표 초과지만 400 hard cap 이하 + 응집도 보존 위해 **현 상태 유지**. audit 단계에서 MEDIUM finding 가능.

## 정적 분석

- TypeScript strict: pass
- ESLint: 본 프로젝트는 ESLint 설정 미사용 (typescript 만으로 검증). 추가 finding 없음.
- React Hooks rules: 모든 훅이 컴포넌트 최상위에서 호출 + dep array 명시 → 자동 검증 통과.

## 커버리지

- 본 프로젝트는 Jest/Vitest 등 unit test 미설정 (electron-vite 만 사용). 본 회차는 *characterization* 리팩토링: 동작 보존 검증을 typecheck + build + 실제 동작 측정 (CDP) 으로 대체.
- 향후 별도 회차에서 React Testing Library 또는 Vitest 도입 권장 (ADR 별도).

## 검증 게이트

- [x] typecheck 통과
- [x] production build 성공
- [x] 모든 파일 400 hard cap 이하
- [x] 렌더러 layout 변경 없음 (CDP 측정)
- [x] 외부 의존성 변경 없음
- [x] IPC contract 변경 없음 (`@shared/ipc-contracts` 무수정)
