# waiver — step 4 커버리지 미달

| 필드 | 내용 |
|---|---|
| 생략 항목 | step 4 변경 영역(renderer) 단위 테스트 80%+ 커버리지 |
| 사유 | 본 회차는 feature-add UI 편의 기능 다수 추가. 프로젝트에 Playwright/Vitest/Jest UI 테스트 인프라가 구축되어 있지 않음. 기존 avd 워커 패키지의 103 테스트는 모두 통과 (회귀 없음). renderer 신규 모듈은 strict TypeScript 정적 분석으로 검증. |
| 대체 검증 | (1) `npm run typecheck` 전체 통과 (3-stage strict mode), (2) `npm -w avd test` 103/103 pass, (3) `grep` 으로 Mock 라이브러리 0 hit, (4) production endpoint 도입 0건 — `01-detect/external-dependencies.md` |
| audit 허용 조건 | feature-add `run-mode` 의 § 5 표 "커버리지 강제 → 80%+ (변경 영역) → waiver 허용" 명시 충족. 본 회차 후속 회차에서 Playwright e2e 인프라 도입을 권장. |
| 후속 권장 | (1) Playwright e2e 인프라 도입, (2) lib/shortcuts.ts / lib/theme.ts / lib/exportSession.ts 등 pure 함수 부터 vitest unit test 추가 |
