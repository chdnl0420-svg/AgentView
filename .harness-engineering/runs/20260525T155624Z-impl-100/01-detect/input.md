# input

## goal

AgentView 일반 사용자 편의·UX 개선을 500 항목 backlog 에서 **100 항목** 실 구현으로 옮긴다. 작은/중간/큰 변경 모두 포함.

## scope

- **포함**: backlog `improvements-500.md` 의 우선 100 list + 카테고리별 미구현 분포
  - SessionList (Category 1), SessionDetail/메시지 (Category 2), 입력바 (Category 3), 검색·필터 (Category 4), 키보드 (Category 5), 알림 (Category 6), 테마 (Category 7), 패널/레이아웃 (Category 8), 접근성 (Category 9), i18n (Category 10), 성능/안정성 (Category 11), 온보딩/설정 (Category 12), 공유 (Category 13)
- **포함**: 큰 변경(L) 후보 — 최소 5개 (분할 패널 / 명령 팔레트 / 메시지 검색 / 다크모드 / 한국어 초성검색)
- **포함**: 중간 변경(M) 후보 — 최소 25개
- **포함**: 작은 변경(S) 후보 — 나머지 (60+)
- **제외**: 외부 인프라 호출 변경. production credential·base URL 사용. Mock 라이브러리 추가.

## non-functional

- 빌드 (`npm run typecheck`) clean
- `npm -w avd test` 회귀 없음 (103 pass 유지)
- 접근성 (WCAG 2.1 AA) 위반 안 늘림
- 한국어 줄바꿈 (`word-break: keep-all`) 유지
- prefers-reduced-motion 지원

## constraints

- Electron (main + renderer) + React + TypeScript
- IPC bridge 변경 시 main + preload + renderer 모두 동기화
- 기존 컴포넌트 구조 (객체별 파일 분리) 준수
- 새 의존성 추가 최소화 (특별한 이유 없으면 추가 안 함)

## open-questions

- (자동 결정) **테마 시스템**: CSS 변수 dual-track (light/dark) 으로 라이트 모드 추가 (#291, #292). 기존 다크 톤 유지하면서 light variant 도입.
- (자동 결정) **명령 팔레트**: Ctrl+K 전역 팔레트 (#23, #164) 신규 컴포넌트. 세션 jump + 명령어 두 카테고리.
- (자동 결정) **메시지 전문 검색**: 세션 내 Ctrl+F (#79). client-side scan + highlight + prev/next.
- (자동 결정) **창 상태 영속화**: 이미 진행 중인 #359 마무리 + 검증.
- (자동 결정) **분할 패널**: 본 회차에서는 토대만 — 사이드바 리사이즈 (#4), 사이드바 접기 (#5), 입력창 영역 동적 (#112) 정도. 4분할 그리드 등 본격 #326 은 별 PR 권장.
