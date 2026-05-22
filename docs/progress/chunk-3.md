---
id: chunk-3
title: 세션 카탈로그 + Claude 워커 spawn
status: done
depends_on: [chunk-2]
owner: claude
started_at: 2026-05-22
completed_at: 2026-05-22
summary: state.json atomic + fake worker spawn (catalog/roster + transactional lock)
---

## 산출
- `avd/src/atomic.ts` — temp+rename writer + `withFileLock` (tail-identity cleanup, rename 실패 시 temp unlink)
- `avd/src/catalog.ts` — `Catalog` (state.json) + reload-inside-lock + snapshot-commit + runtime validation + patch allowlist + defensive copy
- `avd/src/roster.ts` — `Roster` (roster.json) + sessionId/pid uniqueness invariant + transactional register
- `avd/src/workers/index.ts` — Worker/SpawnRequest schema
- `avd/src/workers/claude.ts` — fake worker (node -e) + `exitPromise` + `hasExited` 게이트

## 테스트
- 34/34 PASS (atomic 3 + catalog 10 + roster 8 + workers-fake 1 + chunk-2 회귀 12)
- multi-instance race, duplicate pid, patch allowlist, defensive copy 모두 커버

## 외부 검증
- Codex 4 pass (LGTM:NO → NO → NO → YES). 회송 누적: 동일 enum (TYPE_SAFETY @ catalog.ts) 3회 — 임계 5 이하.
- QA harness-qa-engineer: PASS (3 시나리오, lifecycle 회귀 영향 없음).
