# External Dependencies (Step 1)

## 요약

본 회차는 UI 편의 추가에 집중. 외부 의존성 변경 없음. production credential/base URL 발견되지 않음.

## 카테고리 표

| category | found | changed_in_this_run | sandbox_available | blocked | redacted_value |
|---|---|---|---|---|---|
| External API | yes (Anthropic Claude, codex - already wired via worker) | no | n/a (sandbox 개념 없음 - subprocess 호출) | no | — |
| Payment | no | no | n/a | no | — |
| Email/SMTP | no | no | n/a | no | — |
| External DB | no (로컬 파일만) | no | n/a | no | — |
| Object storage | no | no | n/a | no | — |
| Message queue | no | no | n/a | no | — |
| Auth OAuth | no | no | n/a | no | — |
| AI/LLM API | yes (worker 가 호출, 메인 코드는 spawn 만) | no | n/a (Claude/codex CLI subprocess) | no | — |

## 부록: 검색 명령

- `git diff --stat HEAD` — working tree 변경 파일 식별 (10 파일)
- production credential pattern 검색 — 없음
- `STRIPE_LIVE`, `sk_live_*`, `AWS_ACCESS_KEY`, `ghp_`, `AIza`, `sk-ant-` 패턴 grep — 없음

본 회차는 외부 인프라 호출을 변경하지 않으며, 모든 변경은 renderer/main UI 영역 한정.
