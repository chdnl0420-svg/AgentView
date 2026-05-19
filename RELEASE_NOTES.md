# AgentView 릴리즈 노트

최신 버전이 가장 위에 옵니다. 모든 릴리즈 항목을 누적해서 보존합니다.

---

## v1.0.2 — 자동 업데이트 배너 복구

`src/main/ipc.ts` 가 `./updater` 모듈을 import 하지 않아 IPC 핸들러가 런타임에 `ReferenceError` 를 던졌고, `UpdateBanner` 의 빈 catch 가 이를 삼키며 **자동 업데이트 배너가 한 번도 표시되지 않던 버그** 를 수정한 핫픽스.

### 수정
- `src/main/ipc.ts` 에 `app` (electron), `checkUpdate` / `downloadAndInstall` / `revealReleasePage` (`./updater`) import 추가
- 이제 앱 시작 시 + 매 1시간마다 `/releases/latest` 폴링이 정상 동작 → 새 버전 발견 시 상단에 "새 버전 vX.Y.Z 가 있습니다" 배너 노출 → 1-클릭 다운로드/설치/재시작

### 영향
- v1.0.0·v1.0.1 설치본은 같은 버그가 있어 v1.0.2 를 자동으로 인지 못 함 → **한 번만 수동으로 v1.0.2 인스톨러를 받아 설치** 하면, 이후 모든 릴리즈는 인앱 배너로 자동 안내됨.

---

## v1.0.1 — UX 핫픽스

대시보드에서 "▶ 새 작업 시작" 을 눌렀을 때의 카드 지연·깜빡임을 잡은 작은 패치 릴리즈.

### 수정
- 사용자가 "▶ 새 작업 시작" 을 누르는 순간 그리드 맨 앞에 placeholder 카드를 즉시 띄움
- 이전: daemon 이 `~/.claude/jobs/<short>/state.json` 을 쓸 때까지 2–5초 동안 카드 없음 → 한참 뒤에 카드가 깜빡이며 등장
- 지금: 클릭 즉시 카드 표시 → 실제 세션이 잡히면 같은 sid 로 자연스럽게 교체 (handoff)
- 안전망: 45초 안에 dispatch 실패하거나 jobs/<short>/ 가 생기지 않으면 placeholder 자동 제거 → "시작 중…" 카드가 영구히 남는 일 없음
- placeholder 클릭은 detail 진입 차단 (잠시 후 클릭 가능 안내 토스트)

---

## v1.0.0 — 첫 정식 릴리즈

Claude Code 의 백그라운드 에이전트를 한글이 깨지지 않는 데스크톱 UI 로 관리하는 첫 1.0 릴리즈.

### 세션 관리
- `~/.claude/jobs/<short>/state.json` 단일 소스로 `claude agents` CLI 와 1:1 동기화
- daemon dispatch 로 새 `kind:"bg"` 워커 생성 (sessionId 안정, PID 교체에 면역)
- 세션 이름 변경 시 `state.json` 의 `name` + `nameSource:"user"` 갱신 → CLI 에 즉시 반영
- 상태 색 구분: 실행 중 / 대기 / 완료 / 종료
- 카드 깜빡임 fix (state.json atomic-rewrite race + 6초 grace 캐시)

### 메시지 전송
- 작업 중에 메시지 보내도 즉시 ptySock 으로 전달 (대기열 제거)
- Optimistic UI: 보낸 메시지 100ms 안에 화면에 표시
- Enter 더블 전송 + 1.2s hold → 작업 중에도 Enter 안 먹는 문제 해소
- 첨부 파일: + 버튼 / 클립보드 paste / 드래그
- ↑ / ↓ 로 이전 전송 히스토리

### 권한 시스템
- 권한 모드 dropdown: default / acceptEdits / bypassPermissions / plan
- `bypassPermissions` 는 Max 계정 토글 활성화 시에만 선택 가능
- 새 세션 spawn 시 `--permission-mode <mode>` 적용
- inline TUI 권한 prompt 감지 → 모달 표시 → 클릭으로 응답

### AskUserQuestion
- 별도 sticky 패널 (composer 위) 로 prominent 표시
- 옵션 클릭 → 즉시 전송, 기존 tool-bubble 안 클릭 UI 는 제거

### 컨텍스트 사용량
- 헤더 도넛 아이콘: 현재 / 최대 토큰, 모델, % 표시
- 75% 이상 빨강, 50–74% 노랑, 그 외 초록

### 네비게이션
- 마우스 XButton1 (뒤로) — dashboard 로
- 마우스 XButton2 (앞으로) — 마지막 detail view 로
- Esc — detail 닫기
- 우클릭 컨텍스트 메뉴 — 잘라내기 / 복사 / 붙여넣기 / 모두 선택

### UI 디테일
- 메시지 안 URL 자동 링크 (외부 브라우저로 열림)
- 메시지 안 markdown 렌더링 (표 / task list / 취소선 포함)
- 도구 메시지 그룹화 — 연속 tool_use / tool_result 한 묶음으로 collapsed
- 노란 도구 색 시인성 향상 (alpha 0.05 → 0.12, border 0.20 → 0.45)
- select 드롭다운 옵션 다크 테마 명도 대비 확보 (WCAG AAA)
- 워크트리 체크박스 + base branch select 를 한 줄에 통합
- 입력창 composer 카드 단일 박스 (focus-within accent ring)

### 자동 업데이트 (v1.0.2 에서 실제 동작 시작)
- GitHub Releases 폴링 (시작 시 + 1시간마다)
- 새 버전 발견 시 헤더에 업데이트 배너
- 1-클릭 다운로드 + NSIS 자동 설치 + 앱 재시작 (silent mode)

### 첫 실행 튜토리얼
- 6 단계 modal: 환영 / 새 작업 / 권한 / 답변 / 컨텍스트 / 시작
- 건너뛰기 가능, localStorage 에 완료 flag

### 메시지 처리
- "나" 버블 hard-drop: Stop hook, Caveat, system-reminder 등 14 패턴
- AgentView 가 보낸 메시지만 표시되도록 노이즈 제거

### 기타
- 바탕화면 바로가기 자동 생성 + 매 launch 자동 갱신
- 외부 CLI 에이전트 hint 배너 제거 (메시지 영역 확장)
- 분기(fork) 버튼 제거

## 시스템 요구사항 (전 버전 공통)

- Windows 10/11 x64
- claude CLI ≥ 2.1.141, daemon 실행 중
