---
id: chunk-5
title: Worker adoption (dead cleanup)
status: done
depends_on: [chunk-4]
owner: claude
started_at: 2026-05-22
completed_at: 2026-05-22
summary: daemon boot 시 dead pid cleanup. zombie 검출은 chunk-5b
---

## 산출
- `avd/src/adoption.ts` — adoptLive(opts) 신규
- `avd/src/catalog.ts` — Catalog.updateIfExists 추가 (live disk read inside lock)
- `avd/src/daemon.ts` — acquirePid → bootAdoption → startServer(pidAlreadyHeld:true)
- `avd/src/server.ts` — pidAlreadyHeld 옵션 추가

## 테스트
- 55/55 PASS (45 + adoption 10)
- multi-instance stale-bypass / catalog-first ordering / wiring 검증 모두 포함

## 외부 검증
- Codex 6 pass (LGTM:NO 5회 → YES).
- QA harness-qa-engineer: PASS (3 시나리오).
