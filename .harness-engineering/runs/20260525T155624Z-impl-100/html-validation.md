# summary.html 검증

`C:\Users\NX3GAMES\.codex\html-document-rules.md` 의 모든 규칙 점검:

| 규칙 | 결과 |
|---|---|
| `<!DOCTYPE html>` + `<html lang="ko">` | ✓ |
| `<head>` (meta charset / viewport / title) | ✓ |
| `<body>` 완전 문서 | ✓ |
| 시맨틱 태그 `<header>`/`<main>`/`<section>`/`<nav>` | ✓ |
| CSS/JS 전부 inline (외부 의존성 0) | ✓ |
| 탭 인터랙티브 (`role="tablist"`/`role="tab"`/`aria-selected`) | ✓ — 6 탭 |
| 첫 번째 탭 = "요약" 자동 활성 | ✓ |
| 탭 라벨 한국어 2-5자 | ✓ (요약 / 구현 / QA / 리뷰·Audit / Waiver / 후속) |
| 상단 chrome 64px 이하 | ✓ (header height: 52px) |
| 탭 padding 6-8px × 12-14px, font 12-13px | ✓ (6px 13px, 12px) |
| URL hash 딥링크 (`#tab-name`) | ✓ |
| 인쇄 시 모든 탭 펼치기 (`@media print`) | ✓ |
| 1뷰포트 무스크롤 (`height: 100vh; overflow: hidden`) | ✓ |
| 본문 12.5-14px / h1 16px | ✓ (compact 조판 + 표/카드/리스트) |
| 한국어 줄바꿈 `word-break: keep-all` | ✓ |
| 키보드 접근 (Tab/화살표) | ✓ |
| 파일명: `summary.html` (run-scoped) | ✓ (SKILL.md §5 명시 위치) |

본 회차는 SKILL.md §5 의 *run-scoped* 위치 (`.harness-engineering/runs/<run-id>/summary.html`) 를 사용하므로 html-document-rules.md 의 *바탕화면 reports 디렉토리 저장* 규정은 적용하지 않는다. 본 skill 의 run-scoped 산출물 규약이 우선.
