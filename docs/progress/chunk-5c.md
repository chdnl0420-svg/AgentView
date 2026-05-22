---
id: chunk-5c
title: Multiclient fan-out verification + main avd adapter
status: done
depends_on: [chunk-5b]
owner: codex
started_at: 2026-05-22
completed_at: 2026-05-22
summary: Public avd client entry, Electron main wrapper, multiclient tests, and root build/typecheck contract
---

## Output
- `avd/src/index.ts`: narrow public `avd` client barrel.
- `src/main/avdClient.ts`: Electron main helper for `AvdClient` and default socket path resolution.
- `avd/src/__tests__/multiclient.test.mjs`: two-client fan-out and partial unsubscribe coverage.
- `avd/package.json`: package `types` and `exports`.
- `avd/tsconfig.json`: declaration output enabled.
- `package.json`: root dev/build/typecheck now build `avd` before Electron paths.
- `AGENTS.md`: repository instructions mirrored from `CLAUDE.md`.

## Verification
- `npm -w avd test`: 65/65 PASS.
- `npm -w avd run clean; npm run typecheck`: `avd` build runs first; only the pre-existing `src/renderer/App.tsx` `FirstRunTutorial` error remains.
- `git diff -- src/main/sessionRunner.ts`: empty diff.

## Review / QA
- Codex review pass 1: LGTM:NO for root build/typecheck contract. Reflected in `package.json`.
- Codex review pass 2: LGTM:YES.
- Harness QA worker: PASS, 5/5 scenarios.

## Next
- chunk-5d: feature-flagged `sessionRunner` avd path. Do not start until chunk-5c commit lands.
