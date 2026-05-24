# Files included in commit

## src/main/ipc 분리
- DELETED: `src/main/ipc.ts`
- ADDED: `src/main/ipc/index.ts`
- ADDED: `src/main/ipc/broadcast.ts`
- ADDED: `src/main/ipc/loaders.ts`
- ADDED: `src/main/ipc/sessions.ts`
- ADDED: `src/main/ipc/picker.ts`
- ADDED: `src/main/ipc/workspace.ts`
- ADDED: `src/main/ipc/filePreview.ts`
- ADDED: `src/main/ipc/windowChrome.ts`
- ADDED: `src/main/ipc/misc.ts`

## src/renderer App.tsx + state + components + lib
- MODIFIED: `src/renderer/App.tsx`
- ADDED: `src/renderer/components/SessionsGrid.tsx`
- ADDED: `src/renderer/lib/sessionFilters.ts`
- ADDED: `src/renderer/lib/pendingSession.ts`
- ADDED: `src/renderer/state/*.ts` (11 hooks)

## src/renderer styles
- MODIFIED: `src/renderer/styles/global.css`
- ADDED: `src/renderer/styles/parts/*.css` (27 files)

## tooling
- ADDED: `scripts/ui-audit/split-global-css.mjs`

## 산출물
- ADDED: `.harness-engineering/README.md`
- ADDED: `.harness-engineering/runs/20260524T1217Z-refactor/**`
