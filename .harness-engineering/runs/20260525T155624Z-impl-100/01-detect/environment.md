# 감지 결과

- 언어: TypeScript
- 프레임워크: Electron (main process) + React 18 (renderer)
- 런타임: Node.js (main), Chromium (renderer)
- 빌드: Vite + electron-builder
- 패키지 워크스페이스: `avd` (worker daemon), root (메인 앱)
- UI 여부: true
- UI ↔ 기능 분리 적용: true (객체 단위 파일 분리 + 컴포넌트별 CSS 분리 이미 적용)
- 파일 이름 규약:
  - 컴포넌트: PascalCase.tsx (SessionList.tsx, InputBar.tsx, …)
  - 상수/유틸: PascalCase + Constants/Utils 접미사 (InputBarConstants.ts, SessionDetailFormatters.ts)
  - 스타일: kebab-case.css (input-bar.css, conversation.css)
- 코드 컨벤션 참조: TypeScript 전용 — C# 파일 없음, l9asia 컨벤션 미적용
- 기존 컴포넌트 (renderer): 18 개 (renderer/components/), 스타일 파트 28 개 (renderer/styles/parts/)
- 기존 main 모듈: index.ts (BrowserWindow + IPC + tray), sessionRunner.ts, sessionScanner.ts, sessionRunnerUtils.ts
