# 2차 audit 검토 파일 리스트

Codex 가 2차 audit 진행 시 참조한 본 회차 산출물:

## 회차 산출물 (audit 입력)

- `.harness-engineering/runs/20260525T155624Z-impl-100/log.md`
- `01-detect/input.md` / `environment.md` / `cqrs-es-warning.md` / `run-mode.md` / `external-dependencies.md`
- `02-domain/waiver.md` / `picklist-100.md` / `picklist-sessionlist-heavy.md`
- `04-qa/result.md` / `coverage-waiver.md`
- `05-review/invocation.md` / `raw-result.md`
- `06-customer/waiver.md`
- `07-audit/1st-self-audit.md`

## 코드 변경 (audit 검증 대상)

신규 (11 lib + 5 components + 5 CSS):
- src/renderer/lib/shortcuts.ts / theme.ts / recentSessions.ts / sessionTags.ts / sessionGroups.ts / sessionArchive.ts / sessionOrder.ts / savedViews.ts / workspaces.ts / exportSession.ts / urlState.ts
- src/renderer/components/ShortcutHelp.tsx / CommandPalette.tsx / MessageSearch.tsx / SessionListMultiBar.tsx / SessionListTagDialog.tsx
- src/renderer/styles/parts/shortcut-help.css / command-palette.css / message-search.css / light-theme.css / session-list-extras.css

변경:
- src/renderer/App.tsx
- src/renderer/components/SessionList.tsx (955줄 — audit-7 FAIL 사유)
- src/renderer/components/SessionDetail.tsx
- src/renderer/components/SessionDetailBubbles.tsx
- src/main/index.ts
- src/main/ipc/misc.ts
- src/preload/index.ts
- src/shared/ipc-contracts.ts
- src/renderer/styles/global.css (imports)
