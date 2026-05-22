---
id: chunk-8
title: Codex 디스크 스캔 + OS 자동시작 + 마이그
status: done
depends_on: [chunk-7]
owner:
started_at: 2026-05-22
completed_at: 2026-05-22
summary: ~/.codex 스캔 + autostart 스크립트 + jobs 마이그
---

# chunk-8 Progress

## Scope

- Added read-only Codex state discovery under injected `.codex` roots.
- Added dry-run-first autostart scripts for Windows Task Scheduler, macOS launchd, and Linux user systemd.
- Added legacy Claude jobs to AVD catalog migration tooling.
- Exported the scanner from the AVD public entry point.

## Verification

- `npm -w avd run build`: PASS
- `node --test avd/src/__tests__/codex-scan.test.mjs`: 4/4 PASS
- `node --test scripts/__tests__/codex-scan-and-migration.test.mjs`: 6/6 PASS
- `node --test avd/src/__tests__/codex-adapter.test.mjs`: 4/4 PASS
- `node --test avd/src/__tests__/external-claude.test.mjs`: 5/5 PASS
- `node --test avd/src/__tests__/server-start-session.test.mjs`: 6/6 PASS
- `node --test scripts/__tests__/session-runner-avd.test.mjs`: 4/4 PASS
- `npm -w avd test`: 84/84 PASS
- `npm run typecheck`: known pre-existing renderer error only, `src/renderer/App.tsx(643,10): Cannot find name 'FirstRunTutorial'`
- `git diff -- src\renderer src\main\sessionScanner.ts src\main\liveWatcher.ts`: empty

## Notes

- Migration dry-run writes no catalog file.
- Migration apply merges new records into an existing AVD catalog and preserves unrelated AVD sessions.
- Migration apply uses the AVD `Catalog.add()` path, and AVD file locking now uses an on-disk lock directory so separate Node processes serialize catalog writes.
- Codex scanner ignores non-session root JSONL files and reads `session_meta.payload` metadata from session transcripts.
- Autostart tests verify static dry-run/apply contract only; they do not register real OS services.
