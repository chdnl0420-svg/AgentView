# AgentView 릴리즈 노트

최신 버전이 가장 위에 옵니다. 모든 릴리즈 항목을 누적해서 보존합니다.

---

## v1.0.7 — 듀얼 모드 (카드/단일화면 전환)

### 새 기능
- **뷰 모드 전환** : 기존 카드 그리드 ↔ 단일화면(세션 리스트 + 우측 디테일) 토글.
- `SessionList` 사이드바 추가, `viewMode` 모드 상태 영속화.

### 기타
- 프로젝트 헌법 `CLAUDE.md` 추가 (TDD · 유지보수성 · 문서화 3대 원칙).

---

## v1.0.5 — UI 리프레시 · 옵션 팝오버 · 세션 화면 대규모 개선

사용자 백로그 42 항목 한 사이클 처리. 작업 산출물은 `.md`, 보고서/계획은 단일 HTML.

### 새 기능
- **타이틀바 옵션 버튼 + 팝오버** : 최소화 좌측 ⚙. 현재 버전 / 업데이트 받기 / Enter 로 전송 / Windows 시작 시 실행.
- **SpotlightTour** : 모달 튜토리얼 폐기. 실제 anchor 프레임 하이라이트 + 툴팁.
- **AskQuestionWizard** : 여러 질문 → 한 번에 하나씩 (현재/전체, 이전/다음, 추천 default, 마지막 일괄 전송).
- **FilePreviewModal** : 메시지 본문·첨부 경로 클릭 시 인앱 미리보기 (html/md/txt/image/json + 2MB 캡 + binary 감지).
- **PathContextMenu** : 우클릭 → 경로 복사 / 탐색기에서 열기 / 파일 복사 / 이름 복사.
- **Goal bar** : 입력창 위 현재 목표 표시, 완료 strikethrough.
- **내 메시지만 보기 토글**.
- **권한·모델 배지 즉시 변경** : 클릭 → 드롭다운 → 다음 메시지부터 적용 안내 토스트.
- **크래시 배너** : status='crashed' 감지 시 상단 빨간 배너.

### 변경
- **인스톨러** : per-user 강제 + 페이지 최소화 + 자동 종료(nsProcess→taskkill) + "AgentView 실행" 체크박스 기본 ON.
- **InputBar** : 좌측 컬럼 세로 스택(+ 작게, ↑↓ 미니버튼). 전송 라벨 "전송". Enter-to-send 옵션. draft 즉시 저장.
- **SessionCard** : 세로 고정 + waiting 글로우 + 삭제모드 배지 시프트 + PID 제거.
- **새 작업 자동 타이틀** : 프롬프트 첫 줄 28-32자.
- **타이틀 깜빡임 수정** : state.name 우선, short hex fallback 제거.
- **워크트리 옵트아웃 안전화** : 클라이언트 race + 서버측 가드.
- **상단 패널 정리** : PID / 메시지 수 / 용량 제거. 권한·모델 배지 clickable.
- **업데이트 폴링** : 1시간 → **1분**.
- **사용량 팝업** : 로컬 캐시 우선 → OAuth fallback. 키 매핑 + 0..1/0..100 정규화. weekly 없으면 "측정 불가". 모델명 줄 제거.
- **ToolBubble 라벨 구체화** : Read/Write/Edit/Bash/Grep 인자 + 파일 경로 자동 링크.
- **메시지 복사** : 첨부 `[Attach] <path>` 합성.
- **"Continue from where you left off." 사용자 echo 숨김**.
- **외부 에이전트 중복 전송 가드** + **작업 중 메시지 즉시 표시 회귀 수정**.

### 영향
- 옵션 패널 1회 클릭으로 핵심 토글 + 업데이트.
- 첫 실행 사용자가 anchor 기반 튜토리얼로 빠르게 적응.
- 메시지 입력 도중 앱이 꺼져도 자동 복원.

---

## v1.0.4 — Claude 자동 기동·인스톨러 CLI 설치·작업 영속화·메모리 절감

세션 시작 응답성과 신뢰성을 종합 개선한 릴리즈. 사용자가 직접 보고한 6 가지 이슈를 한 번에 처리.

### 새 기능
- **Claude Code preflight** : 앱 시작 시 `claude --version` + `~/.claude/daemon/roster.json` 확인. CLI 미설치면 상단 빨강 배너 + 설치 안내 버튼, 데몬 dead 면 노랑 배너 표시.
- **데몬 자동 부팅** : 새 작업 시작 시 supervisor 가 죽어있으면 `claude agents --headless` 를 백그라운드로 띄워서 ~2.5 초 안에 깨우고, 안 되면 곧바로 직접 PTY 폴백 (기존 10 초 대기 → 최대 2 초).
- **메시지 보낼 때도 자동 복구** : 외부 워커에 prompt 전달 실패 (`NO_WORKER`) 시 데몬을 한 번 부팅하고 자동 재시도.
- **작업 영속화 (.md)** : 모든 세션의 프롬프트·상태·전이를 `%USERPROFILE%\.claude\agentview\workspace\sessions\<sid>.md` 에 YAML frontmatter + 활동 로그로 기록. 앱 크래시 / 중단되어도 다른 세션이 파일을 읽고 이어 작업 가능.
- **HTML 리포트** : 세션 .md 를 단일 파일 HTML 로 export (탭 인터랙티브, 첫 탭=요약). IPC `workspace:exportReport` 로 호출.
- **인스톨러에서 CLI 자동 설치** : NSIS `customInstall` 매크로가 설치 직후 `where claude` 로 미존재 시 `npm install -g @anthropic-ai/claude-code` 자동 실행 (best-effort).

### 수정
- **업데이트 패널 축소** : 24px 미만 단일 줄로 컴팩트화 (기존 ~48px). 폰트·버튼 크기 축소, ellipsis 처리.
- **메모리 절감** :
  - `readConversation` 캡 4000 → 1500 라인 (장기 세션에서 가장 큰 절약).
  - PTY rolling buffer 6KB → 4KB.
  - `tailAgentOutput` 재연결 지수 backoff (1.5 s → 30 s 까지) — 죽은 세션에 무한 폴링하지 않음.
  - `sessionScanner` stateCache 200 entry cap.
- **작업표시줄 핀 LNK 보존** : 재설치 후에도 핀이 유지되도록
  - 메인 프로세스가 시작할 때 핀된 LNK 가 있으면 새 exe 경로/아이콘으로 갱신.
  - NSIS `customInstall` 이 설치 직후 핀 LNK 의 TargetPath/IconLocation 을 새 빌드로 다시 씀.
  - NSIS `customUnInstall` 이 핀 LNK · 워크스페이스 데이터를 보존하도록 명시.

### 영향
- "Claude Code 꺼져있으면 새 작업·메시지 무반응" 증상 → 자동 부팅 + 폴백 + 상태 배너로 항상 진행 가능.
- 새 작업 시작 후 응답 도착까지의 무반응 구간이 평균 10 초 → 0–2 초.
- 작업표시줄에 고정한 AgentView 아이콘이 새 인스톨러 실행 후에도 그대로 살아있음.
- 긴 세션에서 렌더러 메모리 사용량 30–50% 절감 (메시지 캡 + 버퍼 캡).
- 앱이 강제 종료돼도 `%USERPROFILE%\.claude\agentview\workspace\sessions\<sid>.md` 에 진행 상태가 남아 다음 세션이 이어 작업 가능.

---

## v1.0.3 — 새 작업 카드 안정화 + claude agents 등록 누락 수정

`▶ 새 작업 시작` 직후 카드가 잠시 보였다 사라졌다 반복하다가 한참 뒤에야 정착하던 깜빡임, 그리고 가끔 새 세션이 `claude agents` CLI 목록에 등록되지 않던 두 가지 문제를 함께 잡은 핫픽스.

### 수정
- 데몬 dispatch 등록 대기 시간을 2.4s → 10s 로 확장 — 느린 머신에서 데몬이 워커를 등록하기 전에 Strategy B(직접 PTY) 로 폴백되어 `kind:"interactive"` 세션이 만들어지던 케이스 제거 → 새 세션이 항상 `kind:"bg"` 로 `claude agents` 에 등장
- placeholder 카드의 제거 시점에 4초 핸드오프 쿨다운 추가 — 데몬이 `~/.claude/jobs/<short>/state.json` 을 점진적으로 쓰는 동안 한두 번의 폴링 스캔이 세션을 일시적으로 놓쳐도 카드가 사라지지 않도록 안정화
- 쿨다운 만료 타이머를 별도 effect 로 분리 — 새 스캔 이벤트가 도착하지 않아도 placeholder 가 정확한 시점에 정리됨

### 효과
- 클릭 직후 → 카드 즉시 등장 → 끝까지 같은 위치 유지 → 데이터가 채워지며 자연스럽게 실세션으로 교체 (깜빡임 0)
- 새 작업이 `claude agents` CLI 출력에 빠지는 일 없음

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
