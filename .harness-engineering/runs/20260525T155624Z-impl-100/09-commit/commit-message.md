# commit message (draft)

본 회차는 큰 범위의 변경이라 단일 commit 으로 묶어 작성.

```
feat(app): 100+ UI conveniences — command palette, message search, theme, tags, archive, multi-select

본 회차 (.harness-engineering/runs/20260525T155624Z-impl-100) 의 결과로 다음
기능을 추가한다. 사용자 명시 인가: scope 100, cosmetic 제외, SessionList Heavy +20.

신규 모듈 (11 lib + 5 components + 5 CSS):
- lib/shortcuts.ts        — 단축키 카탈로그 + matchesAccel 매처
- lib/theme.ts            — dark/light/system 3-state 테마
- lib/recentSessions.ts   — 최근 방문 ring buffer (Ctrl+J)
- lib/sessionTags.ts      — 태그 카탈로그
- lib/sessionGroups.ts    — 폴더 시스템 (lib only)
- lib/sessionArchive.ts   — 아카이브 Set
- lib/sessionOrder.ts     — 정렬 모드 4종
- lib/savedViews.ts       — 저장된 뷰 (lib only)
- lib/workspaces.ts       — 워크스페이스 (lib only)
- lib/exportSession.ts    — MD/JSON 다운로드 + 클립보드
- lib/urlState.ts         — URL hash deep link
- components/ShortcutHelp.tsx     — Ctrl+/ 도움말 모달
- components/CommandPalette.tsx   — Ctrl+K 전역 팔레트 (퍼지 + 200ms debounce)
- components/MessageSearch.tsx    — Ctrl+F 세션 내 검색 + F3 prev/next
- components/SessionListMultiBar.tsx  — 멀티 선택 액션바
- components/SessionListTagDialog.tsx — 태그 편집 모달
- styles/parts/{shortcut-help,command-palette,message-search,light-theme,session-list-extras}.css

App.tsx 통합:
- 글로벌 키바인드 18종 (Ctrl+N/W/Tab/J/1..9/,/L/Alt+1-3/F11/F1/F6/Ctrl+K/Shift+P)
- OS 알림 디스패치 (세션 완료/오류) + 클릭 → 포커스+세션 점프
- URL hash deep link (선택 세션 자동 동기화)
- 테마 자동 적용 + 시스템 변경 watch
- 윈도우 제목 dynamic (실행 중 세션 수)
- 태스크바 overlay (Windows) + dock badge (macOS)

SessionList.tsx 강화 (큰변경 + 중간변경):
- Shift+Click range / Ctrl+Click toggle multi-select + bottom action bar
- 태그 chip + 필터 행 + 카드별 태그 표시
- error / waiting 상태 필터 추가
- 정렬 모드 메뉴 (최신/생성/이름)
- 검색 히스토리 dropdown (최근 8)
- 아카이브 collapsible 섹션
- 그룹 collapse/expand 토글
- cwd 프로젝트명 카드 표시
- 키보드 ↑/↓ scrollIntoView 추적
- rename Tab → 다음 세션 chain
- hover resume 아이콘

SessionDetail.tsx:
- MessageSearch (Ctrl+F + F3 prev/next + scrollIntoView + flash)
- Export 메뉴 (Markdown / JSON / 클립보드 복사)
- 검색 hit 시 접힌 도구 그룹 자동 펼침 (agentview:search-target)

main 통합:
- 윈도우 좌표 영속화 + multi-monitor isOnScreen() 검증
- app:* IPC 5종 (toggleFullscreen, setSessionStats, openDevTools, openFeedback, showNotification)

QA:
- npm run typecheck PASS (3-stage strict)
- npm -w avd test 103/103 PASS
- Mock 라이브러리 0 hit / production credential 0 hit

Codex review (1차) + audit (2차) 모두 자가 수정 완료:
- P2 isOnScreen multi-monitor 검증
- P2 CommandPalette Enter flushDebounce
- P3 sessionTags null vs [] 구분
- P3 SessionDetail 검색 hit 그룹 자동 펼침
- audit-7 SessionList.tsx 955줄 waiver (다음 회차 4-way split 계획)

판정: PASS_WITH_WAIVERS (4 waiver — DDD/coverage/customer/SessionList-size)

회차 산출물: .harness-engineering/runs/20260525T155624Z-impl-100/
- summary.md / summary.html (탭 6: 요약/구현/QA/리뷰·Audit/Waiver/후속)
- 01-detect / 02-domain / 04-qa / 05-review / 06-customer / 07-audit / 09-commit
```

자체 검증:
- type ✓ feat
- 본문에 "Why" 명시 (사용자 요청 + 기능 카탈로그)
- 푸쉬 금지 (SKILL.md §4) → commit 만
