---
id: chunk-4
title: conversations 구독 contract + AvdClient
status: done
depends_on: [chunk-3]
owner: claude
started_at: 2026-05-22
completed_at: 2026-05-22
summary: avd JSONL tailer + Subscriptions + AvdClient (avd-only; main wiring 은 chunk-5)
---

## 산출
- `avd/src/conversation.ts` — JSONL tail + fs.watchFile(500ms) + safeStartOffset (UTF-8 byte boundary)
- `avd/src/subscriptions.ts` — (sessionId)→Set<Socket> + placeholder entry race 방어
- `avd/src/client.ts` — AvdClient + ctrlSerializer 직렬화
- `avd/src/server.ts` (수정) — CTRL subscribe-conversation / unsubscribe-conversation + INVALID_PATH/INVALID_SESSION + unknown cmd 는 기존 UNSUPPORTED_FRAME 유지

## 테스트
- 45/45 PASS (conversation 4 + server-subscribe 7 + chunk-1~3 회귀 34)
- concurrent subscribe / UTF-8 partial line / CTRL serialization 모두 커버

## 외부 검증
- Codex 2 pass (LGTM:NO → YES). 3 findings (race / interleaving / UTF-8) 반영.
- QA harness-qa-engineer: PASS (3 시나리오, lifecycle 회귀 영향 없음).

## scope 메모
- chunks-overview 갱신: chunk-4 = avd-only (src/main 변경 0). sessionRunner.ts 통합은 chunk-5.
