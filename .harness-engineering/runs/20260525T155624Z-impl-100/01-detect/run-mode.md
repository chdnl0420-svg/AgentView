# Run Mode

- 감지 결과: `feature-add`
- 근거 (자동 판정 신호):
  - 사용자 입력에 `개선사항`/`편의사항`/`추가` 키워드 — feature-add 시그널
  - `.harness-engineering/runs/` 에 이전 회차 다수 존재 (첫 회차 아님)
  - 기존 도메인 모델 (이전 회차 `20260525T150649Z-500-improvements/02-domain/improvements-500.md` 516 항목 backlog) 존재
- DDD 강제: 해당 Aggregate 만 풀세트 → **본 회차는 UI cosmetic 다수, Aggregate 분해 부적합 → waiver 필요** (`02-domain/waiver.md`)
- TDD 강제: 풀세트 → **UI 시각 변경에 자동화 unit test 어려움, Playwright 미구축 → waiver 필요** (`03-tdd/waiver.md` 또는 본 mode 문서에서 명시)
- 커버리지 강제: 80%+ (변경 영역) → **avd 패키지는 기존 103 pass 유지, 본 회차에서 renderer 단위 테스트 추가 무리 → waiver 필요**
- non-waivable invariant: 7개 항상 강제 (run-modes.md §non-waivable 참조)
- 사용자 변경 안내: 자동 감지가 틀렸다 판단되면 회차 종료 후 변경하지 말고, 다음 회차 시작 시 자연어 목표에 명시 (예: "new-domain 회차로 진행해줘").
