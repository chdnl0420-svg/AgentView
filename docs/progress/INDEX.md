<!-- 자동 생성 — scripts/progress-sync.mjs 가 갱신. 직접 편집 금지. -->
# Progress Index

| id | title | status | depends_on |
|----|-------|--------|------------|
| chunk-1 | types + 진행추적 셋업 | in-progress | — |
| chunk-2 | avd 패키지 골격 + PID/소켓 lifecycle | pending | chunk-1 |
| chunk-3 | 세션 카탈로그 + Claude 워커 spawn | pending | chunk-2 |
| chunk-4 | conversations 구독 + AgentView 클라이언트 어댑터 | pending | chunk-3 |
| chunk-5 | adoption + Codex 워커 기본 + 다중 클라이언트 | pending | chunk-4 |
| chunk-6 | WorkerAdapter 인터페이스 + ExternalClaudeAdapter | pending | chunk-5 |
| chunk-7 | CodexAdapter 본 구현 + resume | pending | chunk-6 |
| chunk-8 | Codex 디스크 스캔 + OS 자동시작 + 마이그 | pending | chunk-7 |
