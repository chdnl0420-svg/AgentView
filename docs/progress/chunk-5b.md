---
id: chunk-5b
title: Zombie detect (OS-level) + Codex worker stub
status: done
depends_on: [chunk-5]
owner: claude
started_at: 2026-05-22
completed_at: 2026-05-22
summary: Linux/macOS process-info + adoption zombie detection + Codex stub
---

## 산출
- `avd/src/process-info.ts` — getProcessInfo (Linux /proc + macOS ps; Windows null fallback)
- `avd/src/workers/codex-stub.ts` — 'codex:' prefix worker stub (chunk-7 prep)
- `avd/src/adoption.ts` — isZombie + ZOMBIE_STARTTIME_THRESHOLD_MS=60s + getProcessInfo 기본값
- `avd/src/daemon.ts` — bootAdoption 이 getProcessInfo 명시 wire (production zombie 활성)

## 테스트
- 63/63 PASS (55 + chunk-5b 신규 8)
- process-info 3 + codex-stub 2 + adoption 3 (zombie + fallback + threshold boundary)

## 외부 검증
- Codex 3 pass (LGTM:NO 2회 → YES). production wiring + 테스트 flake 회피 반영.
- QA harness-qa-engineer: PASS (3 시나리오, lifecycle 회귀 영향 없음).
