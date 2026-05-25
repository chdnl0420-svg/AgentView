# CQRS + Event Sourcing 풀세트 강제 경고

본 skill 은 모든 Aggregate 에 CQRS + Event Sourcing 풀세트를 강제 적용한다. 그러나 본 회차는:

- **회차 유형**: `feature-add` (UI 편의 광범위 추가)
- **도메인 적용 여부**: 부적합 (UI cosmetic feature 들의 모음 — Aggregate/Bounded Context 단위로 잘리지 않음)
- **대체 도메인 모델**: backlog 의 13 카테고리 + 우선 100 list (이전 회차 researcher 산출물)
- **waiver**: `02-domain/waiver.md` 에 명시 — CQRS/ES 부적합, 카테고리 카탈로그 대체

산업 권고 (Microsoft, Vernon 등) 는 단순 CRUD·MVP·UI cosmetic feature 에는 CQRS/ES 를 권하지 않는다. 본 skill 정책상 강제이나, 본 회차 같은 UI 광범위 추가 회차는 도메인 모델보다 카테고리 카탈로그가 더 효과적이다. 본 경고로 회차 진행 정당화.
