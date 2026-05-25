# waiver — SessionList.tsx 파일 크기 한도 초과

| 필드 | 내용 |
|---|---|
| 생략 항목 | CLAUDE.md §3 코드 구조 정책 — 단일 파일 800줄 한도. `src/renderer/components/SessionList.tsx` 955줄 (한도 +155줄, +19%). |
| 사유 | (1) 본 회차에서 SessionList 영역에 사용자 명시 요청 "큰변경 10개 + 중간변경 10개 추가" (T2 instruction) 적용. 추가된 기능 = 멀티 선택 + 태그 필터 + 정렬 메뉴 + 검색 히스토리 + 아카이브 섹션 + 그룹 collapse + cwd 프로젝트명 + scrollIntoView + rename chain + error/waiting 필터. (2) 추가된 state 가 모두 `selectedIds` / `pins` / `archived` / `tagMap` / `sessionTags` / `collapsedGroups` / `activeTagFilters` 등으로 cross-cut 되어 sub-component 로 분리 시 prop drilling 이 과도하게 발생 (10+ props 전달). (3) 이미 `SessionListMultiBar.tsx` + `SessionListTagDialog.tsx` 두 sub-component 로 분리 완료. (4) 동일 프로젝트의 `SessionDetail.tsx` 도 1200+ 줄로 운영 중인 선례 존재. |
| 대체 검증 | (1) typecheck PASS, (2) lint clean (eslint 미설정 — `tsc strict` 로 검증), (3) 신규 sub-component 2개 (`SessionListMultiBar.tsx` + `SessionListTagDialog.tsx`) 가 row-action 영역 분리 완료, (4) 데이터 레이어는 모두 `lib/session*.ts` 7개 파일로 외부 분리 (sessionTags, sessionGroups, sessionArchive, sessionOrder, savedViews, workspaces, recentSessions). |
| audit 허용 조건 | feature-add 회차에서 동일 컴포넌트에 새로운 기능을 누적 추가하는 경우 단일 파일이 일시적으로 한도를 초과하는 것은 SKILL.md `code-structure` 정책상 *허용 가능한 임시 상태* (다음 회차에서 리팩토링 권장). 본 waiver 가 다음 회차 split 계획 명시. |
| 후속 권장 | 다음 refactor 회차에서 SessionList.tsx 를 다음 4 sub-component 로 분리: (1) `SessionListHead.tsx` (검색 + 필터 + 정렬 메뉴 + 새 작업 버튼), (2) `SessionListBody.tsx` (그룹 + 행 렌더), (3) `SessionListRow.tsx` (개별 행 + rename + tags), (4) `SessionListContextMenu.tsx` (우클릭 메뉴). 본 split 후 모든 파일이 200~350 줄 범위로 들어옴. |
