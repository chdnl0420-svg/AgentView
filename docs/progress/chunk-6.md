---
id: chunk-6
title: WorkerAdapter interface + ExternalClaudeAdapter
status: done
depends_on: [chunk-5d]
owner:
started_at: 2026-05-22
completed_at: 2026-05-22
summary: avd workerFactory boundary, external-claude dispatch adapter, initial prompt delivery preservation.
---

# chunk-6 progress

## Goal

Move the existing Claude daemon dispatch path behind the avd WorkerAdapter boundary for `backend: external-claude`, while keeping `claude` direct spawn and real `codex` execution out of this chunk.

## Current implementation

- Added RED tests for legacy dispatch payload compatibility, roster pid adoption, prompt delivery scheduling, unsupported Codex routing, and `agent` propagation through the avd start-session path.
- Added `WorkerAdapter` / `WorkerFactory` contracts.
- Added `ExternalClaudeAdapter` with dispatch JSON creation, full-session roster validation, roster polling, and best-effort prompt delivery to the external Claude worker `ptySock`.
- Added prompt delivery settle/retry behavior to mirror the existing main-process daemon dispatch path.
- Added pre-worker duplicate session guard so an existing roster entry cannot be killed by a failed duplicate start.
- Added per-server in-flight duplicate guard so concurrent starts for the same session invoke `workerFactory` only once.
- Wired the production avd daemon to pass boot-adopted `Catalog` / `Roster` instances and a default worker factory into `startServer`.
- Added optional `agent` to avd start-session client/server contract and forwarded it from `SessionRunner`.

## Verification

- `npm -w avd run build`: PASS
- `node --test avd/src/__tests__/external-claude.test.mjs`: 5/5 PASS
- `node --test avd/src/__tests__/server-start-session.test.mjs`: 5/5 PASS
- `node --test scripts/__tests__/session-runner-avd.test.mjs`: 4/4 PASS
- `npm -w avd test`: 75/75 PASS
- `npm run typecheck`: avd build PASS, only pre-existing `src/renderer/App.tsx(643,10): Cannot find name 'FirstRunTutorial'`
- `git diff -- src\renderer src\main\sessionScanner.ts src\main\liveWatcher.ts`: empty
- Harness step5 implementation review pass 3: LGTM:YES
- Harness step6 QA: PASS (`.harness/results/qa-agentview-codex-split-a-backend-chunk-6.md`)

## Next

Chunk-6 is ready for incremental commit. After the commit, proceed to chunk-7 planning only; do not modify chunk-7 code before its plan/review gate.
