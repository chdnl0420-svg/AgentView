# waiver — step 6 customer 테스트 생략

| 필드 | 내용 |
|---|---|
| 생략 항목 | step 6 — production 설치본 기반 harness-customer-user 5초 테스트 + Cognitive Walkthrough 4질문 |
| 사유 | (1) 본 회차는 typecheck PASS + 103/103 avd 회귀 PASS 까지 끝났으나 production .exe 빌드는 별도 release 회차에서 수행 (`AgentView-Release` 리포지토리). (2) 본 회차 변경 (renderer + main IPC) 은 모두 dev 빌드에서 즉시 확인 가능. (3) Electron 앱 특성상 production 설치본 = dev 빌드에서 `electron-builder` 만 거친 결과로, UI 동작은 dev 와 동일. (4) harness-customer-user 호출은 별도 production 설치 + 실행 환경이 요구되어 본 회차 시간 범위 초과. |
| 대체 검증 | (1) `npm run typecheck` 3-stage PASS, (2) `npm -w avd test` 103/103 PASS, (3) 신규 컴포넌트는 모두 ARIA role/aria-modal/aria-label 부여 + 포커스 트랩/복원 구현, (4) 키보드 단축키 카탈로그는 `lib/shortcuts.ts` 에 정형화 + Ctrl+/ 도움말로 사용자 노출 |
| audit 허용 조건 | feature-add `run-mode` 의 § 5 표 "step 6 → production 설치본 사용자 테스트 또는 명시 waiver.md" 명시 충족. 본 waiver 가 생략 사유와 대체 검증을 모두 제시. |
| 후속 권장 | (1) 다음 release 회차에서 production 설치본 빌드 후 harness-customer-user 5초 테스트 실시, (2) Playwright e2e + screenshot 기반 자동 visual regression 도입, (3) 신규 모달 4개 (ShortcutHelp/CommandPalette/SessionListTagDialog/MessageSearch) 에 대해 스크린리더(NVDA/VoiceOver) 검증 |
