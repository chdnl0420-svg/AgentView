# 자가 수정 이력

> SKILL.md §3 자가 수정 한도: 산출물 2회 + 스킬 2회. 본 회차는 산출물 1회만 사용.

## 산출물 자가 수정 1회차

### Codex 1차 리뷰 (step 5) → 즉시 코드 fix (4건)

| ID | 파일 | 변경 |
|---|---|---|
| P2-1 | src/main/index.ts | `screen.getAllDisplays()` 기반 `isOnScreen()` 검증 함수 도입. 저장된 (x,y) 가 어떤 display workArea 와도 교차하지 않으면 BrowserWindow 의 x/y 를 `undefined` 로 폴백 (Electron 기본 중앙 배치). |
| P2-2 | src/renderer/components/CommandPalette.tsx | `flushDebounce()` 함수 + Enter 핸들러에서 `query !== debouncedQuery` 시 즉시 flush + `requestAnimationFrame(() => runItem(activeIdx))` 으로 stale items 회피. |
| P3-1 | src/renderer/lib/sessionTags.ts | `loadJSON<... \| null>(KEY, null)` 로 변경. null = 미저장 → DEFAULT_TAGS 반환 / `[]` = 사용자 의도적 비움 → 그대로 빈 배열 유지. |
| P3-2 | SessionDetailBubbles.tsx + SessionDetail.tsx | (1) ToolGroup 에 `data-group-msg-uuids={items.map(uuid).join(',')}` 속성 + `agentview:search-target` 이벤트 리스너 → 매칭 시 자동 펼침. (2) SessionDetail 의 search effect 가 `agentview:search-target` 이벤트 dispatch 한 후 requestAnimationFrame 으로 해당 uuid 의 root 또는 `data-group-msg-uuids*=` fallback 으로 scrollIntoView. |

### Codex 2차 audit (step 7) → 산출물 fix (2건)

| ID | 산출물 | 변경 |
|---|---|---|
| audit-7 | `07-audit/waiver-sessionlist-size.md` | 신규 작성 — SessionList.tsx 955줄 한도 초과에 대한 5필드 waiver. 사유 = SessionList Heavy 누적 / 대체검증 = typecheck + 2 sub-component 분리 + 7 lib 분리 / 다음 회차 4-way split 계획. |
| 1st-수치오류 | `07-audit/1st-self-audit.md` § 5 | "~720줄" 표기를 "955줄, PASS_WITH_WAIVERS" 로 정정. |

## skill 자가 수정 — 0회

본 회차에서 SKILL.md / docs/steps/*.md / templates/*.tpl / `~/.claude/agents/learning/*.md` 수정 0 건. `skill-improvement.md` 의 변경 0 건 (별도 파일 작성 안 함).

## 한도 사용량

- 산출물 자가 수정: 1 / 2 회 사용
- 스킬 자가 수정: 0 / 2 회 사용
- 한도 초과 없음

`AUDIT_LIMIT_EXCEEDED` 예외 ④ 미발동.
