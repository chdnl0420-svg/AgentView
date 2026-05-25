# Review target files — 20260524T1217Z-refactor

Purpose: AgentView 의 monolithic 파일 3개 (ipc.ts 772줄, App.tsx 957줄, global.css 2335줄) 를 모두 400줄 hard cap 이하 모듈로 분리한 mechanical refactor. **로직 변경 없음**, 단 구조 분해 + 파일 이동만.

## Branch
`codex/merge-split-a-backend`

## Changed/added/deleted files (50)

### main process IPC split (`src/main/ipc.ts` → `src/main/ipc/*`)
- DELETED: `src/main/ipc.ts` (772 lines)
- ADDED: `src/main/ipc/index.ts` — composition root (registerIpc + shutdownIpc)
- ADDED: `src/main/ipc/broadcast.ts`
- ADDED: `src/main/ipc/loaders.ts` — loadCommands + loadAgents + AgentsList/CommandsList
- ADDED: `src/main/ipc/sessions.ts` — all Sessions* handlers + cancel loop + outputTails
- ADDED: `src/main/ipc/picker.ts` — PickDirectory/PickFiles/SavePastedImage
- ADDED: `src/main/ipc/workspace.ts` — Workspace*
- ADDED: `src/main/ipc/filePreview.ts` — FilePreview handler + previewFileForRenderer
- ADDED: `src/main/ipc/windowChrome.ts` — Window*/Options*/Shell*
- ADDED: `src/main/ipc/misc.ts` — Git*/Updater*/AppVersion/UsageFetch/ClaudeStatus

### Renderer state hooks (extract from `src/renderer/App.tsx`)
- MODIFIED: `src/renderer/App.tsx` (957 → 354 lines)
- ADDED: `src/renderer/components/SessionsGrid.tsx`
- ADDED: `src/renderer/lib/sessionFilters.ts` — classify + isEmptyDeadSession + SessionFilter
- ADDED: `src/renderer/lib/pendingSession.ts` — PendingSession type + makeTempId + pendingToBgSession + PENDING_* constants
- ADDED: `src/renderer/state/useSessionScan.ts`
- ADDED: `src/renderer/state/useAgentsAndRunning.ts`
- ADDED: `src/renderer/state/usePendingSessions.ts`
- ADDED: `src/renderer/state/useDrafts.ts`
- ADDED: `src/renderer/state/useQueues.ts`
- ADDED: `src/renderer/state/useRenames.ts`
- ADDED: `src/renderer/state/useClaudeStatus.ts`
- ADDED: `src/renderer/state/useClock.ts`
- ADDED: `src/renderer/state/useBackForwardNav.ts`
- ADDED: `src/renderer/state/useRunEventsToast.ts`
- ADDED: `src/renderer/state/useDeleteMode.ts`
- ADDED: `src/renderer/state/useViewMode.ts`

### Renderer styles split (`src/renderer/styles/global.css` → `parts/*`)
- MODIFIED: `src/renderer/styles/global.css` (2335 → 63 lines, just @import list)
- ADDED: `src/renderer/styles/parts/*.css` (27 files)

### Tooling
- ADDED: `scripts/ui-audit/split-global-css.mjs` — one-off splitter (kept for reference)

## Focus

Mechanical refactor → focus on:
1. **동작 보존**: registerIpc / shutdownIpc / window.av.* 공개 표면 동일하게 유지하나, 내부 핸들러가 정확히 동일하게 등록되는지.
2. **State hook 분리 안정성**: useEffect dep array, cleanup 함수, ref vs state 가 원본과 동일한 timing 으로 동작.
3. **CSS @import 순서**: tokens → reset → layout → components → mode overrides 순서 보존 (specificity / cascade 영향).
4. **circular import 없음**.
5. **dead code 없음** — 분리 후 사용 안 되는 변수/import.

## Out of scope (변경 안 함)

- IPC contract (`@shared/types`, `@shared/ipc-contracts`)
- preload bridge
- daemon, watcher, sessionRunner, scanner 등 main 부속 모듈
- 다른 untracked 변경 (package.json, scripts/_*.cjs 등)
- 기능 변경 / 신규 기능
