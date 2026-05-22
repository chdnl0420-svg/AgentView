---
id: chunk-7
title: CodexAdapter 본 구현 + resume
status: done
depends_on: [chunk-6]
owner:
started_at: 2026-05-22
completed_at: 2026-05-22
summary: codex exec --json + JSONL parser + adapter-level resume
---

# chunk-7 progress

## Goal

Implement the real `CodexAdapter` behind the avd `WorkerAdapter` boundary, including fake-CLI-tested command construction, JSONL stdout capture, adapter-level resume support, and graceful stop.

## Current implementation

- Added RED tests for new-session and resume command shapes.
- Added fake Codex CLI tests proving prompt delivery uses stdin, not argv.
- Added JSONL complete-line buffering so partial stdout chunks are held until newline.
- Added UTF-8 streaming decode so multibyte characters split across stdout chunks are preserved.
- Preserved malformed JSONL lines in the conversation file while warning instead of crashing.
- Added `resumeSessionId` and `conversationPath` to the AVD start-session contract.
- Added `WorkerHandle.conversationPath` and server persistence into catalog records.
- Added `CodexAdapter` and routed `backend: "codex"` through `createWorkerFactory()`.
- Kept direct `backend: "claude"` unsupported in the AVD worker factory.

## Verification

- `npm -w avd run build`: PASS
- `node --test avd/src/__tests__/codex-adapter.test.mjs`: 4/4 PASS
- `node --test avd/src/__tests__/external-claude.test.mjs`: 5/5 PASS
- `node --test avd/src/__tests__/server-start-session.test.mjs`: 6/6 PASS
- `node --test scripts/__tests__/session-runner-avd.test.mjs`: 4/4 PASS
- `npm -w avd test`: 80/80 PASS
- `npm run typecheck`: avd build + node typecheck PASS, only pre-existing `src/renderer/App.tsx(643,10): Cannot find name 'FirstRunTutorial'`
- `git diff -- src\renderer src\main\sessionScanner.ts src\main\liveWatcher.ts`: empty
- Harness step5 pass 2: LGTM:YES
- Harness step6 QA: PASS (`.harness/results/qa-agentview-codex-split-a-backend-chunk-7.md`)

## Next

Proceed to chunk-8 only after the chunk-7 incremental commit.
