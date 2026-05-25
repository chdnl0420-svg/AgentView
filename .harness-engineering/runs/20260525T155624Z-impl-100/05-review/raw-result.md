# Codex 리뷰 raw 결과 (verbatim)

## Summary

타입체크는 통과하나, 창 복원 좌표 검증 누락과 명령 팔레트 Enter 실행 타이밍 버그가 실제 사용자 흐름을 깨는 문제로 남아 있음. 태그 삭제 엣지 케이스 및 도구 메시지 검색 히트 스크롤 결함도 존재하나 차단 수준은 아님. merge 전 P2 2건 수정 권장.

## Issues by Severity

### CRITICAL

(없음)

### HIGH (P2 — merge 전 수정 권장)

- `src/main/index.ts:152-153` **창 좌표 화면 외 복원 버그**
  다중 모니터 환경에서 종료 후 해당 모니터를 분리하거나 해상도가 변경되면, 저장된 `x`/`y`를 검증 없이 `BrowserWindow`에 그대로 전달해 앱 창이 보이지 않는 화면 밖에 복원된다. 저장된 bounds가 현재 display workArea와 교차하는지 확인하고, 교차하지 않으면 기본 중앙 위치로 폴백해야 한다.

- `src/renderer/components/CommandPalette.tsx:63-66` **Enter 실행 타이밍 — stale items 문제**
  사용자가 검색어를 입력하고 200ms 디바운스가 끝나기 전에 Enter를 누르면, `items` 목록이 이전 검색어(대개 빈 문자열) 기준으로 계산된 상태이므로 의도와 다른 첫 번째 명령이 실행된다. Enter 핸들러에서 `debouncedQuery` 대신 `query`를 즉시 사용하거나, Enter 입력 시점에 디바운스를 즉시 flush해야 한다.

### MEDIUM (P3 — merge 후 후속 수정 가능)

- `src/renderer/lib/sessionTags.ts:29-30` **마지막 태그 삭제 시 기본 태그 재등장**
  태그 카탈로그를 전부 삭제하면 저장 값이 `[]`가 되는데, `loadTagCatalog()`가 빈 배열을 "저장된 적 없음" 상태와 동일하게 취급하여 기본 태그 전체를 다시 반환한다. 사용자가 마지막 태그를 삭제해도 삭제가 되돌아간 것처럼 보이는 UX 결함이다. `loadJSON`의 `null` 반환과 `[]` 반환을 구분하거나 별도의 sentinel 값을 사용해야 한다.

- `src/renderer/components/SessionDetailBubbles.tsx:508-510` **접힌 도구 그룹 내 검색 히트 스크롤 불가**
  검색 결과가 접힌 도구 그룹의 두 번째 이후 `tool_use`/`tool_result`에 매칭되면, DOM에는 그룹 첫 항목의 `data-msg-uuid`만 존재하므로 검색 히트 수는 늘어나지만 해당 항목으로 스크롤/하이라이트가 되지 않는다. 도구 그룹의 모든 개별 항목에 `data-msg-uuid`를 붙이거나, 검색 히트 시 해당 그룹을 자동으로 펼쳐야 한다.

### LOW

(Codex 리뷰에서 별도 제기된 LOW 항목 없음)

## 리뷰 요청 항목별 추가 소견

(원문에서 review 요청 10개 항목에 대해 모두 "이슈 없음" / 정상 범주로 판정)

## Path Forward

**fix now (merge 전 필수)**
1. `src/main/index.ts` — 저장된 `x`/`y` 좌표를 `screen.getDisplayMatching()` 또는 `screen.getAllDisplays()`의 workArea와 교차 검증하여 화면 밖이면 `undefined`로 폴백
2. `src/renderer/components/CommandPalette.tsx` — Enter 핸들러에서 `items`의 기반이 되는 검색어를 `query`(즉시값)로 계산하거나, keydown Enter 시 디바운스 타이머를 즉시 flush

**fix soon (P3, merge 후 후속)**
3. `src/renderer/lib/sessionTags.ts` — `loadJSON` null vs `[]` 구분으로 "사용자가 의도적으로 비운 카탈로그" 상태 보존
4. `src/renderer/components/SessionDetailBubbles.tsx` — 도구 그룹 내 모든 메시지에 `data-msg-uuid` 부착 또는 검색 히트 시 그룹 자동 펼침

## LGTM

**NO** — P2 이슈 2건 수정 후 재확인 필요
