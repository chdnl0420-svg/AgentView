# AgentView 1.0.5 — 에이전트 자동 선택 기록

> 사용자 지시: 모든 질문·선택은 에이전트에게 위임. 자동 선택은 이 파일에 기록.

각 에이전트는 자기가 내린 비자명한 결정을 아래 형식으로 append:

```
## [에이전트명 / 영역]
- 결정: …
- 근거: …
- 영향: …
- 대안 있음: yes/no
- 사용자가 다르게 원할 가능성: 낮음/중간/높음
```

---

## [update-poll / 렌더러 업데이트 폴링 주기]
- 결정: `UpdateBanner.tsx` 의 폴링 주기를 1시간(60 * 60 * 1000) → 1분(60_000ms) 으로 변경. 매직 넘버는 파일 상단 `POLL_INTERVAL_MS` 상수로 추출.
- 근거: 요구사항 명시 — "신규 버전 체크 주기를 1분으로 변경". 마운트 즉시 1회 실행(`run()`) 은 기존 로직 유지.
- 영향: 렌더러에서 1분마다 `window.av.updater.check()` IPC 호출 → 메인 프로세스 `checkUpdate()` 가 GitHub API `/repos/chdnl0420-svg/AgentView-Release/releases/latest` 1회 GET. 인증 없는 GitHub API rate limit (IP당 60 req/h) 의 분당 1회는 안전 범위. 새 버전 발견 시 기존 toast/배너 동작 그대로.
- 대안 있음: yes (5분/10분 등). 요구사항이 1분으로 명시되어 채택.
- 사용자가 다르게 원할 가능성: 낮음 (요구사항 명시값과 동일)

## [update-poll / 메인 프로세스 updater]
- 결정: `src/main/updater.ts` 는 건드리지 않음.
- 근거: 메인 프로세스 측에는 자체 `setInterval` 폴링이 존재하지 않음 (요청 기반 `checkUpdate()` 함수만 export). 요구사항 "없다면 건드리지 말 것" 조건 충족.
- 영향: 없음
- 대안 있음: no
- 사용자가 다르게 원할 가능성: 낮음

## [installer / per-user 강제 (no privilege prompt)]
- 결정: `allowElevation: false` 추가. `oneClick:false` + `perMachine:false` 와 결합해 UAC 승격 다이얼로그 없이 곧장 `%LocalAppData%\Programs\AgentView` 로 설치되도록 강제.
- 근거: 요구사항 1번 "사용자/전체 선택 화면 스킵". electron-builder NSIS 는 `perMachine:false` 만으로는 elevate-needed 시 UAC 를 띄움. `allowElevation:false` 가 elevation 자체를 봉쇄.
- 영향: 시스템 전체 설치 불가. 모든 사용자는 자기 프로필에만 설치. 1.0.4 사용자가 system 경로에 깔려있었다면 자동 마이그레이션 안 됨 (필요시 추후 대응).
- 대안 있음: yes — `oneClick:true` (silent) 도 가능하지만 디렉토리 변경 옵션을 잃음.
- 사용자가 다르게 원할 가능성: 낮음

## [installer / 페이지 시퀀스 최소화]
- 결정: `MUI_PAGE_*` 매크로를 직접 재선언하지 않고 electron-builder 기본 템플릿 + `MUI_COMPONENTSPAGE_NODESC` + `MUI_FINISHPAGE_*` 정의만 추가. license/components 페이지는 license 파일과 components 그룹이 없어 자동 생략됨. `menuCategory:false` 로 시작 메뉴 폴더 입력 페이지도 비활성화.
- 근거: electron-builder 공식 권장 — 생성된 installer 템플릿을 통째로 덮어쓰지 말고 macro hook 만 사용. `MUI_PAGE_*` 직접 호출 시 중복 정의로 빌드 깨짐.
- 영향: 최종 페이지 흐름 = welcome → directory → instfiles → finish(Run 체크박스). 요구사항 2번의 "설치 경로 선택만" 에 가장 근접한 minimal 시퀀스.
- 대안 있음: yes — `oneClick:true` 로 전부 스킵 가능하지만 디렉토리 선택을 잃음.
- 사용자가 다르게 원할 가능성: 중간 (welcome 화면도 빼달라 할 수 있음)

## [installer / 앱 자동 종료 전략]
- 결정: `customInit` 매크로에서 `nsProcess::_FindProcess` → `_KillProcess` 시도, 실패 시 `taskkill /F /IM AgentView.exe` 폴백. 둘 다 실패해도 설치는 계속.
- 근거: nsProcess 는 electron-builder 가 번들하지만 NSIS 버전에 따라 누락 가능. taskkill 은 모든 Windows 에 존재해 fail-safe. 실행 중인 exe 가 잠겨있으면 RMDir 가 실패해 업그레이드가 깨짐.
- 영향: 실행 중인 AgentView 가 강제 종료됨 (사용자 작업 손실 위험은 있으나 설치 진행 = 동의로 간주).
- 대안 있음: yes — graceful WM_CLOSE 후 대기. 복잡도 대비 이득 적음.
- 사용자가 다르게 원할 가능성: 낮음

## [installer / Finish 페이지 "실행" 체크박스]
- 결정: `MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_FILENAME}.exe"` + `MUI_FINISHPAGE_RUN_TEXT "AgentView 실행"` + electron-builder `runAfterFinish: true`.
- 근거: 요구사항 4번 "기본 체크". `runAfterFinish` 는 electron-builder 옵션, `MUI_FINISHPAGE_RUN` 는 NSIS 정의 — 둘 다 설정해 동작 보장.
- 영향: 설치 직후 자동으로 AgentView 가 켜짐 (사용자가 체크 해제하지 않은 한).
- 대안 있음: no
- 사용자가 다르게 원할 가능성: 낮음

## [InputBar / draft 자동 저장 키]
- 결정: localStorage 키 prefix `draft.<historyKey>` (PREFIX `agentview.` 와 합쳐 `agentview.draft.new` / `agentview.draft.s.<sessionId>`). `persistence.ts` 에 `draftKey()` 헬퍼 추가.
- 근거: 요구사항 2번 "자기 저장도 함께". historyKey 와 같은 namespace 를 따라야 history 와 draft 가 같은 세션 컨텍스트로 묶임. 헬퍼 함수로 추출해 InputBar 안에서 prefix 오타 가능성을 없앰.
- 영향: 앱이 비정상 종료돼도 mount 시 props.draft → persisted draft → 빈값 우선순위로 복원. 전송 성공 직후엔 `saveJSON(key, null)` 로 clear.
- 대안 있음: yes — props.draft 만 의존 (App.tsx 에 위임). 하지만 새 세션 화면을 떠났다 돌아오는 unmount/remount 시점에 부모 state 도 새로 만들어질 수 있어 자체 저장이 더 견고.
- 사용자가 다르게 원할 가능성: 낮음

## [InputBar / Enter-to-send 옵션 동기화]
- 결정: localStorage 키 `opt.enterToSend` (default false). 변경 동기화는 `storage` 이벤트 + 커스텀 `window` 이벤트 `opt:enterToSend` 둘 다 listen. 동일 BrowserWindow 내에서는 storage 이벤트가 fire 되지 않으므로 설정 패널 쪽이 `dispatchEvent(new Event('opt:enterToSend'))` 를 호출하면 됨.
- 근거: 요구사항 4번. storage 이벤트만으로는 같은 창에서 즉시 반영이 안 됨. 커스텀 이벤트는 in-app 변경에, storage 이벤트는 (있을 경우) 별도 창 변경에 대응.
- 영향: Enter 처리 분기 + placeholder + hint 텍스트가 옵션 값에 따라 즉시 갱신.
- 대안 있음: yes — context provider 로 전역 옵션 상태 관리. 단일 옵션이라 over-engineering 판단.
- 사용자가 다르게 원할 가능성: 낮음

## [InputBar / 좌측 컬럼 레이아웃]
- 결정: 기존 단일 `+` 버튼 자리를 `.input-left-col` 세로 스택으로 교체 — 위 `btn add-attach small` (`+`), 아래 `.history-nav` 가 `btn history-btn` 두 개(`↑` / `↓`).
- 근거: 요구사항 3번 "좌측 컬럼 세로 스택". history 미니버튼이 처음 사용자에게도 발견 가능하도록 키보드 ↑↓ 와 동등한 onClick 경로 제공.
- 영향: textarea 폭은 줄지 않음(원래 `+` 한 칸 자리에 4×28 정도 세로 스택). global.css 에 `.input-left-col`, `.btn.add-attach.small`, `.history-nav`, `.btn.history-btn` 스타일이 *없으면* 우선 브라우저 default 로 표시되지만 동작에는 영향 없음. css 작업은 메인 클로드 몫(쓰지 말라 명시됨).
- 대안 있음: yes — 가로 레이아웃 유지하고 history 버튼을 우측 send 버튼 옆에. 좌측에 모으는 편이 textarea 와 시각적 그룹화가 자연스러움.
- 사용자가 다르게 원할 가능성: 중간 (배치 취향 차이)

## [InputBar / 전송 버튼 라벨]
- 결정: `props.buttonLabel` 이 있으면 그대로, 없으면 `'전송'` (mode 구분 없이). 기존 `▶ 새 작업 시작` / `↗ 이어서 보내기` 기본값 제거.
- 근거: 요구사항 3번 명시. 호출 부 `App.tsx` 는 `buttonLabel` 을 안 넘기므로 신규 작업 화면에서는 `'전송'`. `SessionDetail.tsx` 는 `buttonLabel` 을 명시 (`'↗ 이어서 보내기'` 또는 `'↗ 외부 에이전트로 전송'`) — 그쪽은 그대로 표시되므로 외부 동작 변화 없음.
- 영향: 신규 세션 카드 composer 의 전송 버튼이 `전송` 으로 통일.
- 대안 있음: yes — `props.buttonLabel ?? (isNew ? '전송' : '전송')` 같은 분기. 동일 결과라 단순화.
- 사용자가 다르게 원할 가능성: 낮음

## [InputBar / ArrowDown 히스토리 가드]
- 결정: ArrowDown 단독 키 처리에서 `onLastLine && historyIdx >= 0` 일 때만 preventDefault + navigateHistoryDown. `historyIdx === -1` (빈 draft 상태) 면 default 캐럿 이동에 맡김.
- 근거: 요구사항 1번. 빈 draft 에서 ArrowDown 이 아무 일도 안 하면 사용자가 "버튼이 막혔다" 고 오해. default 동작 유지로 자연스러운 caret 끝 이동.
- 영향: 기존 L755 분기에 이미 들어있던 `historyIdx >= 0` 조건을 명시적 주석으로 보강. 동작 변화 없음(이미 그렇게 동작).
- 대안 있음: no
- 사용자가 다르게 원할 가능성: 낮음

## [InputBar / 워크트리 race 가드]
- 결정: `send()` 내부에서 `wtEnabled && branchInfo === null` 일 때 `window.av.git.branches()` 를 1초 timeout race 로 한 번 더 await. 결과를 `effectiveBranchInfo` 에 담아 wtOn / baseBranch 결정에 사용. timeout 시엔 `isRepo:false` 폴백 → wtOn=false 로 안전 fallback.
- 근거: 요구사항 5번 #23. cold start 직후 branchInfo fetch 가 끝나기 전 사용자가 빠르게 전송하면 wtEnabled 가 무시되던 race. 1초 budget 으로 fetch 재시도하되 영원히 기다리지 않음.
- 영향: 정상 케이스(브런치 fetch 이미 끝남)는 영향 0. cold-start race 케이스만 1초 이내 추가 fetch 발생. wtEnabled=false 일 땐 분기 자체를 안 타므로 항상 wtOn=false (요구사항 확인됨).
- 대안 있음: yes — useEffect 에 `setTimeout(fetch, 0)` 로 더 빨리 미리 fetch 하기. 이미 cwd 변경 useEffect 가 fetch 하고 있어 race 는 첫 mount 직후 극초 단위에만 발생 — 단순한 send-time 가드가 충분.
- 사용자가 다르게 원할 가능성: 낮음
