# 본 회차 commit 제외 파일

## 민감 파일 (non-waivable invariant #4)

본 회차에 민감 파일 변경 0건. 다음 패턴 grep — 0 hit:
- `*.env*` / `*.credentials*` / `*.key*` / `*.pem` / `*.p12` / `*.pfx`
- `sk_live_*` / `sk-ant-*` / `AKIA[0-9A-Z]{16}` / `ghp_*` / `AIza[0-9A-Za-z_-]{35}`
- `STRIPE_LIVE` / `OPENAI_PROJECT` / `ANTHROPIC_KEY`

## 이전 회차 작업 잔류 (본 회차 미포함)

다음은 이전 회차에서 working tree 에 남은 변경. 본 회차 commit 에 포함시키지 않음 — 사용자가 별도 commit / discard 결정:

```
M  package-lock.json                                    # 이전 작업 잔류
M  package.json                                          # 이전 작업 잔류
M  scripts/_test-3goals.cjs                             # 이전 작업 CRLF 변환
M  scripts/_test-rename-reflect.cjs                     # 이전 작업 CRLF 변환
M  scripts/_verify-select.cjs                           # 이전 작업 CRLF 변환
M  scripts/_verify-trash.cjs                            # 이전 작업 CRLF 변환
M  scripts/test-harness.cjs                             # 이전 작업 CRLF 변환
M  scripts/verify-url-autolink.cjs                      # 이전 작업 CRLF 변환
M  .harness-engineering/README.md                       # 이전 회차에서 다른 회차에 대한 업데이트
?? .harness-engineering/runs/20260524T1351Z-followup-audit-v2/  # 이전 회차 산출물
```

본 회차 commit 은 본 회차 변경 + 회차 산출물 폴더만 포함. 위 파일들은 working tree 에 남겨두고 사용자가 결정.

## 푸쉬 금지 (non-waivable invariant #5)

SKILL.md §4 정책상 본 skill 은 `git push` 를 하지 않는다. step 9 는 `git commit` 까지만. 사용자가 직접 push.
