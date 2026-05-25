# SessionList Heavy — 추가 큰변경 10 + 중간변경 10

> 사용자 명시 인가 (T2 2026-05-25T16:05Z): "세션리스트쪽 큰변경10개 중간변경 10개 추가". 본 picklist 가 기본 picklist-100 위에 SessionList 영역을 강화한다.

## L (큰변경) 10개

| ID | 항목 | 신규/변경 모듈 | 비고 |
|---|---|---|---|
| SL-L01 | **세션 그룹(폴더) 시스템 — #25/#26/#52** | `lib/sessionGroups.ts` + SessionList 폴더 트리 + IPC `groups.list/create/rename/delete` + drag-into-group | localStorage `sessionGroups` 우선 (단순 데이터 모델) |
| SL-L02 | **태그(Label) 시스템 — #9/#10/#183** | `lib/sessionTags.ts` + 태그 색상 chip + 필터 버튼 + 우클릭 메뉴 | localStorage `sessionTags` |
| SL-L03 | **세션 일괄 선택 + 일괄 삭제/아카이브 toolbar — #19/#20/#54** | SessionList multi-select mode + bottom action bar (Delete/Archive/Tag) | Shift+Click range, Ctrl+Click toggle |
| SL-L04 | **아카이브 섹션 + 복원 — #21** | SessionList collapsed "아카이브" group + localStorage `sessionArchive` + 우클릭 unarchive | 데이터 손실 없음 (그냥 숨김 토글) |
| SL-L05 | **드래그 수동 정렬 + custom order persist — #24** | HTML5 DnD + localStorage `sessionOrder` + 정렬모드에서 시간순 무시 | 정렬모드 OFF 시 시간순 fallback |
| SL-L06 | **저장된 뷰 (Linear-style saved views) — #185/#186** | `lib/savedViews.ts` + SessionList head dropdown + view = (search query + filter + sort + tags) | 즐겨찾기 검색 통합 |
| SL-L07 | **세션 검색 — 메시지 본문 매칭 (사이드바 검색 확장) — #22/#79 일부** | SessionList 검색 시 conversation 첫 N개 메시지 indexOf + 매치 카드 표시 | client-side, 인덱스 없이 단순 scan |
| SL-L08 | **가상 스크롤 (1000+ 세션 성능) — #3/#437** | react 자체 구현 (외부 lib 없이 IntersectionObserver + window slice) | 500+ 세션 환경에서만 활성화 |
| SL-L09 | **워크스페이스 분리 — #355/#356** | `lib/workspaces.ts` + 사이드바 헤더 workspace switcher + 세션이 어느 workspace 소속인지 메타 | 기본 workspace = "기본" |
| SL-L10 | **딥링크 URL state (필터+검색+선택) — #196** | App.tsx hash router (`#?q=foo&filter=running&id=...`) + 복사 가능한 링크 + 외부 deep-link 처리 | 외부에서 클릭 시 해당 세션 자동 열림 |

## M (중간변경) 10개

| ID | 항목 | 모듈 |
|---|---|---|
| SL-M01 | 정렬 옵션 (최신/생성/이름/활동빈도) #16 | SessionList head dropdown |
| SL-M02 | 상태 필터 '에러' + '대기 중' 확장 #14/#15 | SessionList Filter union 확장 |
| SL-M03 | 실행 중 세션 수 배지 (헤더) #17 | SessionList head badge |
| SL-M04 | 키보드 ↑/↓ 탐색 시 scrollIntoView #29 | SessionList onListKeyDown |
| SL-M05 | rename Tab → 다음 세션 chain rename #28 | SessionList rename input |
| SL-M06 | Ctrl+D → 선택 세션 즐겨찾기(★) 토글 #56 | App.tsx + SessionList |
| SL-M07 | 검색 히스토리 드롭다운 (최근 5) #35 | SessionList search popover |
| SL-M08 | 우클릭 → 세션 복제 (clone draft) #32 | SessionList context menu |
| SL-M09 | 검색 필터: cwd/프로젝트 #174 | SessionList filter + matchesQuery |
| SL-M10 | 세션 카드 hover → 재개 아이콘 인라인 표시 #47 (기능: 클릭 시 즉시 재개·attach) | SessionList renderRow + IPC |

## 우선 구현 순서

본 회차 batch C 로 진입 (단축키 / 알림 / 트레이 다음):

1. SL-M01~M03 (정렬 + 필터 + 배지) — 1 commit
2. SL-M04~M06 (키보드 + rename chain + star) — 1 commit
3. SL-M07~M10 (검색 히스토리 + clone + cwd 필터 + resume hover) — 1 commit
4. SL-L02 태그 시스템 + SL-L03 multi-select toolbar — 1 commit (둘이 UX 강하게 결합)
5. SL-L01 그룹 폴더 — 1 commit
6. SL-L04 아카이브 — 1 commit
7. SL-L05 드래그 정렬 — 1 commit
8. SL-L06 저장된 뷰 + SL-L07 메시지 검색 — 1 commit
9. SL-L08 가상 스크롤 — 1 commit
10. SL-L09 워크스페이스 — 1 commit
11. SL-L10 URL deep link — 1 commit

총 11 commits. M 10개 + L 10개 = 20 항목. 기본 picklist-100 의 80~100 항목과 합쳐 총 약 100~120 unique 기능 항목.
