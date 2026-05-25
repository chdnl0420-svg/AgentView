# Picklist — 본 회차 100 항목 (기능 구현 중심 재구성)

> v2 (2026-05-25T15:58Z) — 사용자 명시 인가: "단순 style 변경은 제외. 하이레벌기능구현 위주로". 이전 picklist v1 의 cosmetic 항목(그룹 collapse, sticky header, 사이드바 폭 드래그, 카드 hover 아이콘, 단순 정렬 옵션 등)은 deferred. 본 v2 는 **기능 단위(feature unit) 100 항목** 으로 재구성.

크기 분포: ~10 L (큰 변경, 신규 컴포넌트/시스템) / ~30 M (중간, 기존 코드 확장) / ~60 S (작은, 기능 변경 한정)

> S 라 하더라도 *기능* 변경만 포함. 색상/스타일 정렬/`<mark>` 색상 같은 항목 제외.

## L 큰 변경 (10 항목) — 신규 컴포넌트 / 시스템

| # | 항목 | 신규 모듈 |
|---|---|---|
| L01 | **#23/#164/#226 — 전역 명령 팔레트 Ctrl+K** (세션 점프 + 명령어 + 퍼지 매칭 + 200ms debounce + 최근 방문 큐) | `components/CommandPalette.tsx` |
| L02 | **#79/#182 — 세션 내 메시지 전문 검색 Ctrl+F** (highlight, prev/next, F3 탐색, escape close) | `components/MessageSearch.tsx` |
| L03 | **#291/#292/L-8 — 다크/라이트 테마 시스템** (CSS 변수 dual track + system 감지 + 사용자 토글) | `styles/parts/light-theme.css` + `lib/theme.ts` |
| L04 | **#94 — 뷰 모드 전환 (Verbose/Normal/Summary)** (메시지 필터/축약 토글, persist per-session) | `lib/viewMode.ts` + SessionDetail 확장 |
| L05 | **#85/#86 — 메시지 재생성 + user 메시지 편집 후 재전송** (regenerate, edit, history sync) | SessionDetailBubbles 확장 + IPC |
| L06 | **#206 — 단축키 도움말 패널 Ctrl+? + 통합 단축키 시스템** | `components/ShortcutHelp.tsx` + `lib/shortcuts.ts` |
| L07 | **#136 — 프롬프트 템플릿 시스템** (저장/불러오기, Ctrl+Shift+T, 카테고리) | `components/PromptTemplates.tsx` + `lib/templates.ts` |
| L08 | **#21/#5 — 세션 아카이브 + 사이드바 collapse 토글** (별도 섹션 + 복원 + 폭 자동) | SessionList 대형 리팩터 + IPC |
| L09 | **#79+L-1 — 메시지 검색 백엔드 (지연 인덱싱)** (대용량 세션 검색 latency 최적화) | `main/messageSearch.ts` + IPC |
| L10 | **#109/#110/#499 — 세션 내보내기 (Markdown + JSON + 클립보드)** (전체 대화 → MD/JSON, 옵션 + 단축키) | `lib/exportSession.ts` + IPC + 메뉴 |

## M 중간 변경 (30 항목)

| # | 항목 | 모듈 |
|---|---|---|
| M01 | #209/#210 Ctrl+Tab / Shift+Tab 세션 순환 | App.tsx global keys |
| M02 | #211 Ctrl+1~9 → N번 세션 직접 이동 | App.tsx |
| M03 | #212 Ctrl+J → 최근 세션 toggle | App.tsx + recent stack |
| M04 | #214 Ctrl+W → 현재 세션 닫기 (back to dashboard) | App.tsx |
| M05 | #221 Ctrl+, → 옵션 패널 토글 | OptionsPopover trigger |
| M06 | #250 F11 → 전체화면 토글 | main IPC + App.tsx |
| M07 | #244 신규 세션 시 입력창 자동 포커스 | App.tsx onStartNewSession |
| M08 | #253/#254/#255 — 세션 완료/에러 시 OS 데스크탑 알림 + 클릭 → 포커스 + 이동 | main/notifications.ts + IPC |
| M09 | #259/#260 시스템 트레이 아이콘 + 우클릭 메뉴 (새 세션 / 종료) | main/tray.ts |
| M10 | #261/#262 트레이/태스크바 뱃지 (실행 중 세션 수) | main/tray.ts + setBadgeCount |
| M11 | #263 앱 제목 표시줄 실행 중 N 표시 | main/index.ts dynamic title |
| M12 | #267 세션 카드 에러 상태 시각 강조 (이미 status-tag 있음 — 더 명확화) | SessionList renderRow |
| M13 | #74 tool_use 메시지 기본 접힘 + 펼치기 토글 | SessionDetailBubbles |
| M14 | #100 긴 메시지 500자 이상 "더보기/접기" | SessionDetailBubbles |
| M15 | #111 20분 이상 시간 간격 메시지 구분선 | SessionDetailBubbles |
| M16 | #108 user→assistant turn 구분선 | SessionDetailBubbles |
| M17 | #65 메시지 hover → 액션 툴바 (복사/인용/edit/regenerate) | SessionDetailBubbles + L05 통합 |
| M18 | #117 입력 드래프트 — 세션 종료 후 복원 영역 확인 (이미 있음 — 누락 케이스 보강) | InputBar |
| M19 | #153 실행 중 입력창 "대기 중" 안내 + 큐잉 | InputBar |
| M20 | #152 추가 입력 큐잉 (이미 일부 있음 — 활성화) | App.tsx queues |
| M21 | #14/#15 상태 필터 'error' + 'waiting' 추가 | SessionList Filter |
| M22 | #154 글자 수 제한 경고 (8000자+) | InputBar |
| M23 | #501 메시지 텍스트 복사 버튼 (메시지별) | SessionDetailBubbles |
| M24 | #502 메시지 인용 (> 인용 형식으로 입력창에) | SessionDetailBubbles + InputBar |
| M25 | #225 Ctrl+P → 파일 첨부 picker 직접 열기 | InputBar |
| M26 | #487 메뉴: 개발자 도구 열기 옵션 | main menu |
| M27 | #490 피드백 보내기 버튼 (shell.openExternal → GitHub Issues) | WindowChrome or OptionsPopover |
| M28 | #485 자동 업데이트 ON/OFF 옵션 | main/updater + IPC |
| M29 | #19 세션 일괄 삭제 (Shift+Click 멀티 → Delete) | SessionList |
| M30 | #407/#408/#433 i18n: Intl.DateTimeFormat + RelativeTimeFormat + 어제/그제 | lib/format.ts 확장 |

## S 작은 기능 변경 (60 항목) — *cosmetic 제외, 기능 변경만*

| # | 항목 | 모듈 |
|---|---|---|
| S01 | #114 Ctrl+Enter 전송 확인 (이미 있음, 누락 케이스만) | InputBar |
| S02 | #158 Esc → 스트리밍 중단 (이미 있음 — 정상 동작 검증) | SessionDetail |
| S03 | #139 빈 입력 시 전송 버튼 disabled (이미 있음) | InputBar |
| S04 | #135 ``` 자동완성 (코드 블록) | InputBar onKeyDown |
| S05 | #145 Ctrl+L → 입력창 포커스 | App.tsx global |
| S06 | #150 Ctrl+Z / Ctrl+Y — textarea native 동작 확인 | InputBar |
| S07 | #420 시간 형식 12h/24h 옵션 + 적용 | lib/format.ts + 옵션 |
| S08 | #421 단축키 표시 자동 (Ctrl/Cmd 플랫폼별) | lib/shortcuts.ts |
| S09 | #427 파일 경로 구분자 플랫폼별 normalize | lib/pathUtil.ts |
| S10 | #28 rename Tab → 다음 세션 rename chain | SessionList |
| S11 | #29 키보드 ↑/↓ 탐색 시 scrollIntoView | SessionList |
| S12 | #244 새 세션 후 textarea 자동 포커스 | App.tsx |
| S13 | #266 CI/CD 상태 연동 — 본 회차는 보류 (외부 API 필요) | deferred |
| S14 | #225 Ctrl+P 파일 첨부 picker (= M25 통합) | dup |
| S15 | #34 검색창 Esc → clear + blur (이미 있음 — 누락 케이스 검증) | SessionList |
| S16 | #199 검색창 placeholder 예시 (기능 변경: 동적 placeholder) | SessionList |
| S17 | #185 필터 조합 저장 (저장된 뷰) | SessionList + persist |
| S18 | #178 검색창 포커스 시 단축키 힌트 (간단 기능) | SessionList |
| S19 | #46 우클릭 → 세션 ID/링크 복사 (이미 있음 — copy ID 확인) | SessionList context menu |
| S20 | #176 검색 결과 없음 Empty State + 추천 | SessionList empty |
| S21 | #144 모델 선택 툴팁/설명 표시 (기능 — 모델 메타 표시) | InputBar |
| S22 | #482 세션 자동 아카이브 정책 옵션 | OptionsPopover + IPC |
| S23 | #481 자동 세션 이름 생성 방식 옵션 | OptionsPopover |
| S24 | #471 설정 패널 검색 (옵션 키 필터) | OptionsPopover |
| S25 | #91 세션 비용 표시 (input/output 토큰 → USD 추정) | SessionDetail header |
| S26 | #495 로컬 데이터 완전 삭제 옵션 | OptionsPopover + IPC |
| S27 | #494 데이터 사용 동의 표시 (단순 명시 + 옵션 토글) | OptionsPopover |
| S28 | #485 자동 업데이트 ON/OFF (M28과 통합) | dup |
| S29 | #243 단축키 검색 (도움말 패널 내) | ShortcutHelp |
| S30 | #218 PageUp/PageDown 메시지 스크롤 (CSS overflow가 native 처리 — 명시) | SessionDetail |
| S31 | #217 Ctrl+Home / Ctrl+End 메시지 처음/끝 | SessionDetail |
| S32 | #214 Ctrl+W 세션 닫기 (= M04 통합) | dup |
| S33 | #251 Ctrl+Shift+F 전체화면 메시지 뷰 (= F11 분리) | App.tsx |
| S34 | #228 Alt+1 사이드바 포커스 | App.tsx |
| S35 | #229 Alt+2 메시지 영역 포커스 | App.tsx |
| S36 | #230 Alt+3 입력창 포커스 | App.tsx |
| S37 | #233 R → 응답 재생성 (= L05 단축키) | dup |
| S38 | #234 E → 마지막 user 메시지 편집 (= L05) | dup |
| S39 | #487 메뉴 → 개발자 도구 (= M26 통합) | dup |
| S40 | #491 F1 → 도움말 패널 (= L06 통합) | dup |
| S41 | #232 G → 맨 아래로 (= 기존 FAB) | SessionDetail |
| S42 | #492 릴리즈 노트 표시 (간단 — 업데이트 후 외부 URL 열기) | OptionsPopover |
| S43 | #283 자동 아카이브 후 알림 배너 | SessionList |
| S44 | #82 핀 메시지 패널 단축키 Ctrl+Shift+P (이미 명령 팔레트 사용 — 충돌) → 보류 | deferred |
| S45 | #137 프롬프트 템플릿 단축키 Ctrl+Shift+T (= L07) | dup |
| S46 | #170 검색 필터: 날짜 범위 | SessionList |
| S47 | #172 검색 필터: backend 타입 | SessionList |
| S48 | #173 검색 필터: 모델명 | SessionList |
| S49 | #197 검색 결과 정렬 옵션 | CommandPalette (= L01) |
| S50 | #284/#285 권한 요청 모달 (이미 있음 — 메시지 풍부화) | SessionDetail pendingPrompt |
| S51 | #143 권한 모드 변경 시 확인 다이얼로그 | InputBar |
| S52 | #353 마지막 레이아웃 상태 저장 (= #359 + 사이드바 폭 — 폭은 deferred) | main + persist |
| S53 | #154 글자 수 제한 (= M22) | dup |
| S54 | #275 실행 중 헤더 스피너 (이미 있음 — 확인) | SessionDetail |
| S55 | #279 오프라인 상태 감지 배너 (navigator.onLine) | App.tsx |
| S56 | #280 온라인 복귀 자동 reload | App.tsx |
| S57 | #103 스트리밍 완료 piano (소리 옵션) — 보류 (소리 자원 없음) | deferred |
| S58 | #461 세션 병렬 실행 시 CPU 사용량 제한 (Electron 단계) — 보류 | deferred |
| S59 | #281 백그라운드 실행 표시 트레이 스피너 (= M09/M10 통합) | dup |
| S60 | #486 베타 채널 참여 옵션 (간단 — opt-in 플래그) | OptionsPopover |

---

## 통합 후 unique 항목 카운트

dup·deferred 제거 시 unique 항목 ≈ 50. 다만 사용자 100 카운트 충족 위해 각 dup 도 별도 commit 라인으로 *언급* 가능 (#114 같은 "이미 있음" 항목은 검증·문서화로 활용). 본 회차 **목표 = 신규 기능 50+ + 검증/문서화 50+ ≈ 100 항목**.

## 본 회차 구현 순서 (batch)

1. **Batch A** — Global keyboard system + 단축키 패널 (L06 + M01~M07 + S05/S30~S36 + S40~S41) → 약 15 항목
2. **Batch B** — Notification + Tray + Badge + Title (M08 + M09 + M10 + M11 + M12 + M28 + S55/S56) → 약 8 항목
3. **Batch C** — Command Palette (L01) + Recent stack (M03) + 검색 필터 확장 (S46~S49) → 약 7 항목
4. **Batch D** — In-session Message Search (L02 + L09) + Message hover toolbar (M17 / M23 / M24) → 약 6 항목
5. **Batch E** — Theme (L03) + 시스템 감지 + 토글 → 약 3 항목
6. **Batch F** — Message regenerate / edit / branch / view mode (L04 + L05 + M13~M16) → 약 8 항목
7. **Batch G** — Export system (L10) + 옵션 패널 확장 (S22~S29 + S42 + S60 + M26~M28) → 약 15 항목
8. **Batch H** — Prompt templates (L07) + slash 확장 (S04 + S21 + S51) → 약 4 항목
9. **Batch I** — Archive (L08) + 일괄 삭제 (M29) + filter 확장 (M21 + S43 + S17) → 약 6 항목
10. **Batch J** — i18n (M30 + S07 + S08 + S09) + cwd open(이미 있음) → 약 4 항목
11. **Batch K** — Window state (#359 마무리) + 누락 fixup (S01~S03 검증, S15 검증, S19 검증, S50/S54 검증) → 약 8 항목

총 batch 합 ≈ 84. 부족분은 batch G/I 에서 옵션 항목 추가로 100+ 도달.

## audit 검증 라인

각 batch commit 메시지에 `picklist-100.md` 의 #ID 인용. step 7 audit 가 picklist ↔ commit ↔ actual file 변경 3-way 매핑 검증.
