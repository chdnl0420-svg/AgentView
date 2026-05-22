---
id: chunk-5d
title: Feature-flagged sessionRunner avd bridge
status: done
depends_on: [chunk-5c]
owner: codex
started_at: 2026-05-22
completed_at: 2026-05-22
summary: Add avd start-session contract and route SessionRunner through avd when AVD_ENABLED is set
---

## Output
- `avd/src/client.ts`: `StartSessionInput`, `StartSessionAck`, and `AvdClient.startSession()`.
- `avd/src/server.ts`: `start-session` CTRL route with injected catalog, roster, and worker factory.
- `avd/src/index.ts`: start-session public types.
- `src/main/avdClient.ts`: start-session type re-exports for Electron main.
- `src/main/sessionRunner.ts`: `AVD_ENABLED` branch that calls avd and keeps the flag-off PTY path unchanged.
- `avd/src/__tests__/server-start-session.test.mjs`: avd server start-session contract coverage.
- `scripts/__tests__/session-runner-avd.test.mjs`: esbuild-based SessionRunner bridge coverage.

## Verification
- `npm -w avd run build; node --test avd/src/__tests__/server-start-session.test.mjs`: 4/4 PASS.
- `node --test scripts/__tests__/session-runner-avd.test.mjs`: 3/3 PASS.
- `npm -w avd test`: 69/69 PASS.
- `npm run typecheck`: only the pre-existing `src/renderer/App.tsx` `FirstRunTutorial` error remains.
- `git diff -- src\renderer src\main\sessionScanner.ts src\main\liveWatcher.ts`: empty diff.

## Review / QA
- Codex review pass 1: LGTM:NO for missing `agent` to `backend` fallback in the avd path. Reflected with a RED regression test and `normalizeAgentBackend()`.
- Codex review pass 2: LGTM:YES.
- Harness QA worker: PASS, 8/8 scenarios.
- Harness QA worker: pending.

## Next
- chunk-6: WorkerAdapter interface and ExternalClaudeAdapter.
