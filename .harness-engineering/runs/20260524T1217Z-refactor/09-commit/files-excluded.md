# Files excluded from commit (intentional)

본 회차 scope 밖. 사용자가 작업 중인 untracked / 수정 항목은 손대지 않는다.

- `package.json`, `package-lock.json` — 사용자의 다른 진행 중 변경
- `scripts/_test-3goals.cjs`
- `scripts/_test-rename-reflect.cjs`
- `scripts/_verify-select.cjs`
- `scripts/_verify-trash.cjs`
- `scripts/test-harness.cjs`
- `scripts/verify-url-autolink.cjs`

민감 파일 감지: 없음 (.env / credentials.* 등 없음).
