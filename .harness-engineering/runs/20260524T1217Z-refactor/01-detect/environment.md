# 감지 결과

- 언어: TypeScript (root + `avd/` 워크스페이스)
- 프레임워크: Electron 32 + React 18 + electron-vite 2 + vite 5
- UI 여부: true (React 렌더러)
- UI ↔ 기능 분리 적용: true — `<Component>.tsx` (UI) + `use<Component>.ts` 또는 별도 `*.logic.ts` (기능)
- 코드 컨벤션: TypeScript / React (글로벌 `~/.claude/rules/typescript/` 적용). C# 아니므로 L9ASIA 규약 미적용.
- 파일 이름 규약: React → `<Name>.tsx` (UI), `use<Name>.ts` 또는 `<name>.<role>.ts` (logic/state/util)

## 모놀리스 식별 (HARD CAP 400줄 초과)

| 파일 | 줄 수 | 책임 |
|---|---|---|
| `src/main/ipc.ts` | 772 | 모든 main-process IPC 핸들러 (sessions, agents, claude, window, picker, shell, terminal, file, git, app 등) |
| `src/renderer/App.tsx` | 957 | React root + scan/pending/agents/running/selected/viewMode/queues/drafts state + 이벤트 핸들러 + 라우팅 + 토스트 |
| `src/renderer/styles/global.css` | 2335 | 모든 스타일 (topbar, dashboard, cards, detail, conversation, attachment, slash, input-bar, markdown, single mode 등) |

## CRITICAL 외 (참고)

| 파일 | 줄 수 | 비고 |
|---|---|---|
| `src/main/index.ts` | 281 | 한도 내 (BrowserWindow lifecycle + protocol + menu) |
| `src/renderer/components/*` | 다양 | 이미 컴포넌트 단위 분리됨. 일부 (SessionDetail 등) 도 큰 편이지만 본 회차 scope 외 |
