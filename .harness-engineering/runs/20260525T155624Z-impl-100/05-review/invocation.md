# step 5 — codex-reviewer 호출

## 호출 컨텍스트

- Agent: `codex-reviewer` (subagent_type)
- 호출 시점: step 4 QA PASS 직후, commit 직전
- 목적: P0/P1/P2/P3 분류로 리뷰 + LGTM:YES/NO 명시
- 변경 범위: 본 회차 신규/변경 모든 파일 (위 picklist 참조)

## 입력

- 신규 파일 목록 (11 lib + 5 components + 5 CSS)
- 변경 파일 목록 (App.tsx, SessionList.tsx, SessionDetail.tsx, SessionDetailBubbles.tsx, main/index.ts, main/ipc/misc.ts, preload/index.ts, shared/ipc-contracts.ts)
- 의심 영역 10개 명시 (multi-select, fuzzy 매칭, hit scroll, badge icon, onRunEvent 재구독, blob URL XSS, IPC injection, TS 엄격, ARIA, 메모리 누수)

## 결과 요약

- **LGTM: NO** — P2 2건 fix-before-merge 필요
- P2 #1: window restore 좌표 검증 누락 (multi-monitor → 화면 밖)
- P2 #2: CommandPalette Enter — debounce 200ms 미경과 시 stale items 실행
- P3 #3: sessionTags 빈 카탈로그 vs 미저장 구분 안 됨
- P3 #4: 접힌 도구 그룹 내 검색 히트 시 scroll-to 실패
- 보안 영역 (blob URL, IPC injection) — 이슈 없음
- TypeScript / ARIA / 메모리 누수 — 이슈 없음

## 자가 수정 (P2 모두 + P3 모두)

| ID | 파일 | 조치 |
|---|---|---|
| P2 #1 | src/main/index.ts | `screen.getAllDisplays()` workArea 교차 검증 `isOnScreen()` 함수 도입 → 화면 밖이면 x/y `undefined` 폴백 |
| P2 #2 | src/renderer/components/CommandPalette.tsx | Enter 핸들러에서 `query !== debouncedQuery` 시 `flushDebounce()` 후 `requestAnimationFrame(() => runItem(activeIdx))` 으로 stale list 회피 |
| P3 #3 | src/renderer/lib/sessionTags.ts | `loadJSON<... | null>(KEY, null)` 로 빈 배열 vs 미저장 구분 |
| P3 #4 | SessionDetailBubbles.tsx + SessionDetail.tsx | `data-group-msg-uuids` 속성 추가 + `agentview:search-target` 이벤트로 ToolGroup 자동 펼침 + fallback querySelector |

자가 수정 후 typecheck PASS 재검증.

## 산출물

- `05-review/invocation.md` (본 파일)
- `05-review/raw-result.md` (Codex 응답 verbatim)
