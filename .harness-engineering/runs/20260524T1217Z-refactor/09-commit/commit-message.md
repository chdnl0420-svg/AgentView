# Commit message (자연어)

```
refactor: split monolithic ipc.ts / App.tsx / global.css into per-module files

3 hard-cap violations (400-line policy) split with no behavior change:

  - src/main/ipc.ts (772L) → src/main/ipc/ (9 modules, max 332L)
      index/broadcast/loaders/sessions/picker/workspace/filePreview/
      windowChrome/misc — each registers its own IPC handlers, index.ts
      owns the shared SessionRunner + LiveWatcher.

  - src/renderer/App.tsx (957L) → 354L composition root + 11 state hooks
    + SessionsGrid sub-component + 2 lib helpers. Hooks: useSessionScan,
    useAgentsAndRunning, usePendingSessions, useDrafts, useQueues,
    useRenames, useClaudeStatus, useClock, useBackForwardNav,
    useRunEventsToast, useDeleteMode, useViewMode.

  - src/renderer/styles/global.css (2335L) → 63L @import composition
    root + 27 cohesive parts/*.css (tokens → base → layout → topbar →
    components → mode overrides).

All files now <400 hard cap. typecheck + build pass. CDP layout
measurement before/after identical. Codex review LGTM (no new defects;
HIGH/MEDIUM findings are pre-existing patterns preserved from origin —
see .harness-engineering/runs/20260524T1217Z-refactor/05-review/result.md).

9-step harness-engineering workflow artefacts under
.harness-engineering/runs/20260524T1217Z-refactor/ (log, domain map,
QA/review/customer/audit reports, summary md+html).
```
