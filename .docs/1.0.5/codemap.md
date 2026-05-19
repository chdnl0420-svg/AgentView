# 1.0.5 Backlog Codemap

작성일: 2026-05-19

---

## 공용 (Common)

### 1. InputBar 히스토리 up/down 캐럿 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/InputBar.tsx |
| 함수 | navigateHistoryUp (L510-522), navigateHistoryDown (L524-542), applyHistory (L496-508) |
| 라인 | 496-542 |
| 현재 | applyHistory 내 ta.setSelectionRange(text.length, text.length). Down 복원 시 draftBeforeHistoryRef.current 길이로 이동(L529-534). |
| 누락 | ArrowDown 조건 historyIdx >= 0 체크만 있음(L755). historyIdx = -1 빈 상태 Down 키 반응 없음. |
| 방향 | applyHistory 호출 전 draftBeforeHistoryRef 캡처 타이밍 확인. 빈 draft 진입 시 caret이 0으로 남는 엣지케이스 수정. |

---

### 2. 입력 draft 저장 손실 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/App.tsx |
| 함수 | setDraft (L195-206), setNewDraft (L210-217), draftsRef (L184-188), persistResumeDrafts (L190-194) |
| 라인 | 184-217 |
| 현재 | newDraft는 saveJSON(NEW_DRAFT_KEY, d)로 매 변경 시 localStorage 저장. resume draft는 draftsRef Map + persistResumeDrafts. |
| 손실 | 전송 후 InputBar가 onDraftChange({prompt empty, attachments empty}) 호출 시 setDraft가 delete (InputBar.tsx L412). App.tsx L599 get(selected.sessionId) undefined면 InputBar 초기값 빈 문자열(L91). |
| 방향 | App.tsx L599에서 draft prop이 undefined면 { prompt: empty, attachments: [] }로 보정. |

---

### 3. 데스크톱 창 좌측 옵션 버튼 진입점

| 항목 | 내용 |
|------|------|
| 파일 | src/main/index.ts |
| 함수 | createWindow (L56-144) |
| 라인 | 56-73 (BrowserWindow 생성 옵션) |
| 현재 | autoHideMenuBar: true. 커스텀 타이틀바/창 컨트롤 없음. titleBarStyle 미설정. |
| 추가 위치 | src/renderer/App.tsx 최상단 -- UpdateBanner, FirstRunTutorial 이후. |
| 방향 | createWindow에 titleBarStyle:hidden 추가하거나, App.tsx 상단에 커스텀 .topbar 컴포넌트 추가해 최소화/옵션 버튼 배치. |

---

### 4. 인스톨러: installer.nsh / package.json nsis

| 항목 | 내용 |
|------|------|
| 파일 | resources/installer.nsh, package.json |
| 식별자 | package.json build.nsis 블록 (L59-70); installer.nsh !macro customInstall (L22-49) |
| 라인 | package.json:L59-70; installer.nsh:L22-49 |
| 현재 | oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true 이미 설정됨. FINISHPAGE_RUN 미설정. 실행 중 자동 종료 로직 없음. |
| 방향 | installer.nsh customInstall에 MUI_FINISHPAGE_RUN 정의 추가 및 실행 중인 AgentView 프로세스 종료 taskkill 구문 추가. |

---

### 5. 입력창 +버튼/히스토리/전송 라벨/hint 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/InputBar.tsx |
| 식별자 | .input-row div (L678-803) |
| 라인 | 678-803 |
| 현재 | +버튼 L679-687, textarea L689-764, 전송/취소 버튼 L765-799, hint span L801. |
| 방향 | hint 텍스트/위치 조정, +버튼 tooltip 변경, 전송 라벨 수정은 이 JSX 블록 내 text 교체. CSS: global.css .input-row, .input-send, .hint. |

---

### 6. FirstRunTutorial.tsx 폐기 + 대체 anchor

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/FirstRunTutorial.tsx |
| 함수 | FirstRunTutorial (L38-79), STEPS 배열 (L5-36) |
| 라인 | 1-79 (전체 파일) |
| 현재 | TUTORIAL_DONE_KEY = tutorial.done.v1 localStorage 플래그. App.tsx에서 L14 import, L590, L623 렌더. |
| anchor | (1) 새 작업 입력창: InputBar.tsx L678 .input-row 앞. (2) 권한/모델: InputBar.tsx L574-588. (3) 상단 패널: SessionDetail.tsx L703-713. (4) 필터 탭: App.tsx L748-787. |
| 방향 | 컴포넌트 전체 삭제 + App.tsx에서 import/렌더 3곳 제거 후, 각 anchor 위치에 inline hint 추가. |

---

## 옵션 (Options)

### 7. 버전 표시 데이터 소스

| 항목 | 내용 |
|------|------|
| 파일 | src/main/updater.ts, src/main/ipc.ts, src/renderer/components/UpdateBanner.tsx |
| 식별자 | updater.ts L71 app.getVersion(); ipc.ts L417 IPC.AppVersion; UpdateBanner.tsx L52 v{info.current} |
| 라인 | updater.ts:71; ipc.ts:417; UpdateBanner.tsx:52 |
| 현재 | checkUpdate() -> app.getVersion() -> current 필드. package.json L6 version: 1.0.4가 소스. |
| 방향 | package.json version을 1.0.5로 bump하면 모든 곳이 자동 반영. 별도 코드 수정 불필요. |

---

### 8. Enter-to-send 토글 적용 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/InputBar.tsx |
| 식별자 | onKeyDown 핸들러 내 Enter 처리 (L706-736), Ctrl+Enter send (L732-736) |
| 라인 | 706-736 |
| 현재 | Ctrl+Enter 또는 Meta+Enter만 전송. Enter 단독은 슬래시 커맨드 선택 외엔 동작 없음. |
| 방향 | localStorage 키 enterToSend boolean 추가 (persistence.ts loadJSON 사용). InputBar에 enterToSend state 추가. onKeyDown Enter 처리에 enterToSend && !e.shiftKey 조건 분기 추가. |

---

### 9. 시작 시 실행 (app.setLoginItemSettings)

| 항목 | 내용 |
|------|------|
| 파일 | src/main/index.ts (미구현), src/shared/ipc-contracts.ts (IPC 키 없음) |
| 현재 | app.setLoginItemSettings 호출 없음. 관련 IPC 없음. |
| 방향 | index.ts app.whenReady() 블록에 app.setLoginItemSettings({ openAtLogin }) 추가. ipc-contracts.ts에 LoginItemGet/LoginItemSet IPC 키 추가. ipc.ts에 ipcMain.handle 핸들러 추가. 옵션 패널 UI에 체크박스 연결. |

---

## 메인 화면 (Dashboard)

### 10. SessionCard 고정 높이 CSS 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/styles/global.css |
| 식별자 | .session-card, .job-card 규칙 (L299-309) |
| 라인 | L307: min-height: 138px; |
| 방향 | min-height: 138px 값 조정 또는 height로 변경. 반응형 처리는 @media (max-width:960px) 블록 (global.css L2033 부근)도 함께 수정. |

---

### 11. 새 작업 시 세션 이름 결정

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/App.tsx, src/main/sessionRunner.ts |
| 식별자 | onStartNewSession (App.tsx L506-561), displayName (L513); dispatchToDaemon payload (sessionRunner.ts L83-99) |
| 라인 | App.tsx:513, sessionRunner.ts:83-99 |
| 현재 | placeholder 카드 name은 App에서 프롬프트 첫 줄로 결정(L513). 실제 세션 name은 sessionScanner.ts L466 state.name || short에서 결정됨. |
| 방향 | dispatchToDaemon payload에 name: args.name || args.prompt.slice(0,40) 명시적 추가 (sessionRunner.ts L83-99). |

---

### 12. 삭제 모드 체크박스 / 상태 배지 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionCard.tsx, src/renderer/App.tsx |
| 식별자 | SessionCard.tsx L48-56 (checkbox), L62-64 (status-tag); App.tsx SessionsGrid L754-773 |
| 라인 | SessionCard.tsx:48-56; App.tsx:754-773 |
| 방향 | SessionCard.tsx의 checkbox 위치나 status badge 크기를 CSS 수정. App.tsx L754-773의 삭제모드 버튼/배지 레이아웃 조정. |

---

### 13. 대기 중(idle) 카드 시각 효과

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/styles/global.css |
| 식별자 | .session-card.flash (L320-326), .session-card .pulse.alive (L332-336), .status-tag.idle (L356) |
| 라인 | 320-342 (flash/pulse), 354-363 (status-tag 색상) |
| 현재 | idle status에 --idle-soft (파란색) 배경. alive pulse는 초록 ripple. flash는 0.8s glow. |
| 방향 | .status-tag.idle에 idle 상태 전용 slow-pulse/shimmer 추가. 또는 .session-card에 data-status=idle CSS 선택자로 배경 그라디언트 조정. |

---

### 14. 신규 버전 체크 주기

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/UpdateBanner.tsx |
| 식별자 | useEffect 내 setInterval (L28) |
| 라인 | L28: window.setInterval(run, 60 * 60 * 1000) |
| 현재 | 1시간(3,600,000ms) 간격 폴링. |
| 방향 | 인터벌 값을 상수로 추출 후 원하는 주기로 변경 (예: 4 * 60 * 60 * 1000). |

---

## 세션 화면 (SessionDetail)

### 15. 작성 파일 경로 추출/렌더 (ToolBubble write 결과)

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/lib/toolSummary.ts, src/renderer/components/SessionDetail.tsx |
| 식별자 | summarizeToolUse (toolSummary.ts L14-84) case Write/Edit/Read (L27-31); ToolUseBubble (SessionDetail.tsx L1361-1421) |
| 라인 | toolSummary.ts:27-31; SessionDetail.tsx:1361-1421 |
| 현재 | Write/Edit/Read 도구에서 i.file_path의 basename만 summary에 표시. 전체 경로는 tooltip 없음. |
| 방향 | summarizeToolUse에서 full path를 title로 추가 반환하거나, ToolUseBubble summary span에 title={fullPath} 추가. 파일 클릭 -> window.av.shell.openPath 연결은 SegmentSpan (SessionDetail.tsx L1276-1297) 패턴 참고. |

---

### 16. 메시지 본문 내 파일 경로 정규식/링크화 함수

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/lib/userMessage.ts, src/renderer/components/SessionDetail.tsx |
| 식별자 | PATH_RE (userMessage.ts L175), segmentBody (L179-196), SegmentSpan (SessionDetail.tsx L1276-1297) |
| 라인 | userMessage.ts:175 PATH_RE -- Windows/POSIX 절대경로 매칭 |
| 현재 | segmentBody가 Windows/POSIX 절대경로를 kind:path segment로 분리 -> SegmentSpan에서 a 태그 + window.av.shell.openPath 연결됨. assistant message markdown 렌더(L1144-1158)에는 미적용. |
| 방향 | PATH_RE에서 누락된 경로 패턴 보완. assistant markdown에도 동일 링크화 적용 시 src/renderer/lib/markdown.ts 수정 필요. |

---

### 17. ToolBubble 라벨 결정 부분

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx |
| 식별자 | ToolUseBubble L1371-1372 (name = m.toolName ?? tool), ToolResultBubble L1426-1427 (label 결정) |
| 라인 | 1371-1372, 1426-1427 |
| 현재 | tool_use 버블: 도구명 표시. tool_result 버블: 고정 라벨 결과 또는 사용자 답변. |
| 방향 | ToolResultBubble에서 m.toolName을 참조해 {toolName} 결과 형태 라벨 표시. |

---

### 18. 메시지 복사 함수 (첨부 무시 여부)

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx |
| 식별자 | BubbleFooter (L1083-1108), UserBubble L1185 copyText, assistant bubble L1155 copyText |
| 라인 | 1083-1108 (BubbleFooter), 1185 (UserBubble), 1155 (assistant) |
| 현재 | UserBubble은 cleaned.body (첨부 제거 후 본문)를 복사. assistant bubble은 raw m.text를 복사. 첨부 경로는 UserBubble 복사 텍스트에서 제외됨. |
| 방향 | 첨부 포함 복사 원할 시 UserBubble L1185에서 copyText={m.text} (raw)로 변경. 현재 동작은 의도적이므로 변경 여부 확인 필요. |

---

### 19. Continue from where you left off. 사용자 메시지 echo 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/lib/userMessage.ts |
| 식별자 | HARD_DROP_PATTERNS 배열 (L55-71), cleanUserMessage (L105-151) |
| 라인 | 55-71 |
| 현재 | cleanUserMessage에서 HARD_DROP_PATTERNS 일치 시 빈 메시지로 처리. Continue from where you left off. 패턴이 배열에 없어 렌더됨. |
| 방향 | HARD_DROP_PATTERNS 배열 (L55-71)에 /Continue from where you left off/i 패턴 추가. |

---

### 20. 타이틀 영문+숫자 변경 원인

| 항목 | 내용 |
|------|------|
| 파일 | src/main/sessionScanner.ts, src/main/liveWatcher.ts |
| 식별자 | jobStateToSession (L435-487) L466 name 결정, rosterWorkerToSession (L409-428) L419; liveWatcher.ts reloadMeta (L270-285) |
| 라인 | sessionScanner.ts:466 (name: state.name || short), L419 (name: short) |
| 현재 | 세션 name은 state.json의 name 필드. 초기 dispatch 시 name 없으면 short (8자 hex) 표시됨. |
| 방향 | dispatchToDaemon (sessionRunner.ts L60-126)의 payload에 name: args.name || args.prompt.slice(0,40) 명시적 추가. |

---

### 21. 외부 에이전트 전송 시 메시지 2개 입력 race

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx, src/main/ipc.ts |
| 식별자 | SessionDetail.tsx onSend (L546-560), sendNow (L523-544); ipc.ts IPC.SessionsResume handler (L231-269) |
| 라인 | ipc.ts:231-269 |
| 현재 | onSend는 busy 여부 관계없이 즉시 sendNow 호출. 빠른 2번 전송 시 두 sendToBackgroundAgent 호출이 소켓에 순차 전송됨. |
| 방향 | SessionDetail.tsx sendNow에 in-flight 가드(sendingRef) 추가 또는 InputBar의 sending state로 중복 방지. |

---

### 22. 작업 정보 패널 위치 (goal bar)

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx |
| 식별자 | header.detail-head (L636-813), div.meta-row (L696-723) |
| 라인 | 696-723 |
| 현재 | header 내 meta-row에 status-tag, model-tag, context-donut, PID, cwd, 메시지수가 나열됨. goal bar 전용 row 없음. |
| 방향 | meta-row 아래에 div.goal-row 추가 (session.name 또는 workspaceStore의 prompt 첫 줄). CSS global.css에 .goal-row 스타일 추가. |

---

### 23. 워크트리 옵션 무시되고 만들어지는 원인

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/InputBar.tsx, src/main/sessionRunner.ts |
| 식별자 | InputBar.tsx send() (L346-421) 내 wtOn 조건 (L357-380); sessionRunner.ts startNewSession (L179-307) 내 worktree 생성 (L189-207) |
| 라인 | InputBar.tsx:357-380; sessionRunner.ts:189-207 |
| 현재 | wtOn = wtEnabled && !!branchInfo?.isRepo (L357). branchInfo fetch는 cwd 변경 시마다 async 요청(L170-184). |
| race 원인 | branchInfo가 null이거나 isRepo: false -- branches IPC (L170-184) 응답 전에 send 버튼 클릭 시 wtOn = false가 됨. |
| 방향 | send()에서 wtEnabled이고 branchInfo가 아직 null이면 send를 대기 또는 경고 toast 표시. |

---

### 24. 내 메시지만 필터 추가 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx |
| 식별자 | renderMessages (L1512-1554), div.conv (L837-943) |
| 라인 | 836-943 |
| 방향 | SessionDetail에 showOnlyUser boolean state 추가. data.messages.filter(m => !showOnlyUser || m.role === user) 후 renderMessages에 전달. meta-row 옆에 토글 버튼 추가. |

---

### 25. 작업 중 추가 메시지 표시 누락 회귀

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx |
| 식별자 | onConversationAppended handler (L427-494), optimisticTextsRef (L82-83), dedupe 로직 (L447-473) |
| 라인 | 427-494 |
| 현재 | optimisticTextsRef.current는 항상 빈 배열(L82, optimistic UI 제거됨 -- L534 주석 참조). dedupe 블록(L447-473)은 사실상 dead code. toDrop이 항상 빈 Set. |
| 방향 | dedupe 블록(L447-473) 제거 또는 단순 seen Set 기반 dedup으로 교체. 메시지 누락 발생 시 flattenLine (conversationLoader.ts L48-149)의 uuid 생성 로직 검토. |

---

### 26. 크래시 상태 전파

| 항목 | 내용 |
|------|------|
| 파일 | src/main/sessionRunner.ts, src/main/sessionScanner.ts |
| 식별자 | sessionRunner.ts p.onExit (L484-501), finalStatus 결정 (L498-499), updateSessionStatus (L500); sessionScanner.ts jobStateToSession (L449-454) |
| 라인 | sessionRunner.ts:498-500; sessionScanner.ts:449-454 |
| 현재 | sessionRunner의 updateSessionStatus는 workspaceStore(.md)만 업데이트. sessionScanner는 jobs/state.json의 state/tempo 필드로 status 결정 -- 두 소스가 diverge. |
| 방향 | sessionRunner.ts p.onExit (L484-501)에서 직접 jobs/state.json의 state 필드를 crashed로 패치 (ipc.ts L325-343의 renameJob 패턴 참고). |

---

### 27. AskUserQuestion 렌더링 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx |
| 식별자 | pendingAsk useMemo (L174-194), div.ask-panel (L968-1042), ToolUseBubble 내 askInput 렌더 (L1388-1413) |
| 라인 | 968-1042 (ask-panel JSX), 174-194 (pendingAsk 산출) |
| 현재 | 미응답 AskUserQuestion은 화면 하단 .ask-panel에 표시(L968). 동일 질문이 ToolUseBubble expanded 시에도 렌더됨(L1388). onSubmitAsk (L284-308)로 sendNow 호출. |
| 방향 | 현재 구현 완성도 높음. 개선 시 ask-panel의 위치/스타일 조정은 global.css .ask-panel 규칙 수정. |

---

## 상단 패널 (Detail Header)

### 28. 권한 배지/모델 배지/메시지수/용량/PID/cwd 표시 위치

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx |
| 식별자 | div.meta-row (L696-723) |
| 라인 | 696-723 |
| 현재 | L697 status-tag, L698-701 model-tag, L702-712 context-donut, L713 PID, L715-716 cwd, L717-720 메시지수/용량. 권한 배지 없음 -- data?.meta.permissionMode 값은 있으나 표시 안 됨. |
| 방향 | data?.meta.permissionMode가 있으면 span.perm-tag 추가 (L701 model-tag 옆). CSS global.css에 .perm-tag 스타일 추가. |

---

### 29. 권한/모델 즉시 변경 시 sessionRunner에 반영하는 경로

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx, src/renderer/components/InputBar.tsx |
| 식별자 | InputBar L635-639 (resume mode no permission select 주석), SessionDetail.tsx onSend (L546-560), sendNow permissionMode (L543) |
| 라인 | InputBar.tsx:635-639; SessionDetail.tsx:543 |
| 현재 | resume mode InputBar에서 permissionMode select 없음(L635-639 주석 참조). PTY 재사용 path에서 permission 인자 무시됨(sessionRunner.ts L338-362). |
| 방향 | resume mode에서 권한 변경은 새 세션 시작 없이는 PTY에 적용 불가. 즉시 적용 원할 시 resume 시에도 권한 select 표시 + 변경 시 fork 세션 생성 유도 토스트 추가. |

---

## 컨텍스트 사용량 (Usage)

### 30. usageApi.ts의 5h block 산출, 주간 데이터 소스

| 항목 | 내용 |
|------|------|
| 파일 | src/main/usageApi.ts |
| 식별자 | fetchUsage (L97-131), five/week 변수 (L106-111), ghJson 호출 (L103) |
| 라인 | 97-131 |
| 엔드포인트 | https://claude.ai/api/oauth/usage |
| 데이터 소스 | ~/.claude/.credentials.json에서 OAuth token 읽어 Authorization Bearer로 호출. 응답의 five_hour/fiveHour/5h/short_term 키 중 하나를 fiveHour로, weekly/long_term/week를 weekly로 매핑. |
| 방향 | 실제 API 응답 shape가 다를 경우 L106-111의 키 목록 보완. fmtResetIn (L46-59)의 시간 포맷 변경. |

---

### 31. 팝업 컴포넌트 (Usage popup)

| 항목 | 내용 |
|------|------|
| 파일 | src/renderer/components/SessionDetail.tsx |
| 식별자 | contextPanelOpen state (L219), div.context-popup (L730-810), ContextDonut (L1617-1651) |
| 라인 | 219-249 (state/effect), 724-811 (팝업 JSX) |
| 현재 | SessionDetail header의 .context-donut 버튼 클릭 시 toggle. contextPanelPos로 버튼 아래에 절대 위치 배치. 60초 interval로 usage 갱신(L238). |
| 방향 | 팝업 위치/크기 조정은 global.css .context-popup 규칙. 내용 추가는 SessionDetail.tsx L730-810 JSX 수정. |

---

## 후속 (Follow-up)

### 32. workspaceStore의 .md 리스트 IPC (이미 노출)

| 항목 | 내용 |
|------|------|
| 파일 | src/main/ipc.ts, src/main/workspaceStore.ts, src/shared/ipc-contracts.ts |
| 식별자 | IPC.WorkspaceList (ipc-contracts.ts L52), ipcMain.handle(IPC.WorkspaceList, ...) (ipc.ts L502), listSessionSummaries (workspaceStore.ts L159-193) |
| 라인 | ipc.ts:502; ipc-contracts.ts:52 |
| 현재 | WorkspaceList IPC 이미 노출됨. renderer에서 window.av.workspace.list()로 호출 가능. renderer에서 아직 사용 안 함. |
| 방향 | App.tsx에 재개 가능한 작업 섹션 추가 시 window.av.workspace.list() 호출해 status:pending 항목 필터링해 표시. |

---

### 33. HTML 보고서 export IPC

| 항목 | 내용 |
|------|------|
| 파일 | src/main/ipc.ts, src/main/workspaceStore.ts, src/shared/ipc-contracts.ts |
| 식별자 | IPC.WorkspaceExportReport (ipc-contracts.ts L54), ipcMain.handle(IPC.WorkspaceExportReport, ...) (ipc.ts L504-520), renderReportHtml (workspaceStore.ts L212-226) |
| 라인 | ipc.ts:504-520; workspaceStore.ts:212-226 |
| 현재 | IPC 핸들러 구현 완료. renderReportHtml이 .md -> .html 변환 후 shell.openPath로 OS 브라우저 열기. renderer에서 아직 보고서 보기 버튼 없음. |
| 방향 | SessionDetail.tsx header 또는 goal bar 영역에 보고서 버튼 추가 -> window.av.workspace.exportReport(session.sessionId) 호출. |

---

### 34. CLI 가이드 페이지 후보 (scripts/)

| 항목 | 내용 |
|------|------|
| 디렉토리 | scripts/ (프로젝트 루트) |
| 현재 | 디버깅/테스트 스크립트 40개+. generate-icon.mjs, pack-portable.mjs 등 빌드 보조. 사용자 대면 CLI 가이드 없음. |
| 방향 | 신규 scripts/cli-guide.html 작성. 앱 내 도움말 버튼에서 window.av.shell.openPath 호출로 열기. |

---

### 35. node-pty prebuilt 위치

| 항목 | 내용 |
|------|------|
| 파일 | package.json |
| 식별자 | node-pty: ^1.1.0 (L21), @electron/rebuild: ^4.0.4 (L25) |
| 라인 | package.json:21, 25 |
| 현재 | @electron/rebuild devDependency만 있고 postinstall rebuild 스크립트 없음. electron-builder는 extraResources에 .node 파일 자동 포함 안 함. |
| 방향 | package.json scripts에 postinstall: electron-rebuild 추가. 또는 electron-builder의 extraFiles에 node_modules/node-pty/build/Release/*.node 명시. |

---


*끝 -- 총 35개 항목 매핑 완료*
