# AgentView 일반 사용자 편의·UX 개선 500+ 항목

## 요약

- **출처 모델**: Claude Code Desktop (2026 재설계), VS Code Copilot Chat, Cursor, Slack, Discord, ChatGPT Desktop, Warp Terminal, iTerm2, macOS Mail, Linear, Notion, WCAG 2.1/2.2, Electron 공식 문서
- **분류**: 13개 대카테고리 + 부록 (우선 추천 100개 / 대형 작업 50개)
- **크기 기준**: S = 1-3시간 / M = 반나절(4-8시간) / L = 며칠(2일+)
- **임팩트**: H = 높음 / M = 중간 / N = 낮음

---

## Category 1: SessionList (사이드바) — 56개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 1 | 검색어 매칭 글자 `<mark>` 하이라이트 | S | H | Slack, GitHub |
| 2 | 그룹(오늘/어제/이번 주) collapse/expand 토글 | S | M | macOS Mail |
| 3 | 세션 목록 가상 스크롤(Virtual List)로 성능 개선 | M | H | React-Virtual |
| 4 | 사이드바 너비 드래그 리사이즈 (min 160px, max 500px) | S | H | VS Code |
| 5 | 사이드바 완전 접기(collapse) 버튼 (아이콘 only 모드) | S | M | VS Code, Linear |
| 6 | 세션 핀(고정) 기능 — 상단에 고정 표시 | S | H | ChatGPT Desktop |
| 7 | 세션 아이콘/이모지 커스텀 설정 | S | M | Notion, Linear |
| 8 | 세션 카드 우클릭 → 폴더/태그 지정 | M | M | macOS Mail |
| 9 | 태그(Label) 시스템 — 색상 태그 부착 및 필터 | M | H | Linear, Gmail |
| 10 | 태그 기반 필터 버튼 (사이드바 상단) | M | H | Linear |
| 11 | 세션 즐겨찾기(Star) 표시 및 즐겨찾기 전용 그룹 | S | M | macOS Mail |
| 12 | 세션 카드 hover 시 작업 요약 툴팁 | S | M | Slack |
| 13 | 세션 카드 미리보기 텍스트 줄 수 설정(1줄/2줄/3줄) | S | N | 일반 best practice |
| 14 | 상태 필터에 `에러` 상태 추가 | S | H | 사용자 pain point |
| 15 | 상태 필터에 `대기 중(Pending)` 상태 추가 | S | M | Claude Code Desktop |
| 16 | 세션 목록 정렬 옵션 (최신순/생성순/이름순/활동빈도순) | S | M | macOS Mail |
| 17 | 실행 중인 세션 수 배지 (사이드바 헤더) | S | H | Slack unread badge |
| 18 | 세션 카드 아바타에 활성 상태 펄스 애니메이션 | S | M | Discord |
| 19 | 세션 일괄 삭제 (멀티 선택 + Delete) | M | H | macOS Mail |
| 20 | 세션 일괄 아카이브 기능 | M | M | ChatGPT sidebar |
| 21 | 아카이브 세션 별도 섹션 표시 및 복원 | M | M | Claude Code Desktop |
| 22 | 검색 결과에 세션 내부 메시지 전문 검색 포함 | L | H | Slack search, ChatGPT 2026 |
| 23 | Ctrl+K / Cmd+K 전역 세션 점프 팔레트 | S | H | Linear, Notion |
| 24 | 세션 목록 드래그로 순서 변경 (수동 정렬) | M | M | ChatGPT, Notion |
| 25 | 세션 그룹(폴더) 생성 및 관리 | M | H | Claude Projects |
| 26 | 그룹 안에 세션 드래그 이동 | M | M | Claude Projects |
| 27 | rename 중 Esc 취소 시 원래 이름 복원 | S | M | 기존 구현 개선 |
| 28 | rename 입력 Enter→저장, Tab→다음 세션 rename | S | M | VS Code rename |
| 29 | 키보드 ↑/↓ 탐색 시 스크롤 자동 추적 | S | H | 기존 구현 개선 |
| 30 | Enter→세션 열기, Space→선택(멀티셀렉트) | S | M | Linear keyboard |
| 31 | 우클릭 메뉴에 "새 탭으로 열기" 옵션 | M | M | Electron multi-pane |
| 32 | 우클릭 → "복사 세션 생성" | M | M | Claude Desktop |
| 33 | Ctrl+F / Cmd+F → 세션 목록 검색 포커스 | S | H | Slack Ctrl+F |
| 34 | 검색창 ESC → 검색 초기화 후 포커스 유지 | S | H | VS Code |
| 35 | 검색 히스토리 드롭다운 (최근 검색어 5개) | S | M | macOS Mail |
| 36 | 세션 목록 시간 그룹 헤더 고정(sticky) | S | M | macOS Mail |
| 37 | 세션 카드에 model 배지 표시 (색상 구분) | S | M | Claude Code Desktop |
| 38 | 세션 카드에 cwd 짧게 표시 (프로젝트 이름만) | S | M | Warp 탭 표시 |
| 39 | 세션 카드 마지막 활동 시간 상대 표시 | S | M | Slack, Discord |
| 40 | 세션 카드 마지막 활동 시간 절대시각 hover 툴팁 | S | M | Discord |
| 41 | 세션 카드 마지막 tool_use 이름 배지 | S | N | AgentView 특성 |
| 42 | 사이드바 하단 "새 세션" 버튼 항상 고정 | S | H | ChatGPT Desktop |
| 43 | 새 세션 버튼 Ctrl+N / Cmd+N 단축키 | S | H | Claude Code Desktop |
| 44 | 세션 count 총계 표시 | S | N | 일반 best practice |
| 45 | 사이드바 빈 상태 일러스트 + "첫 세션 시작" CTA | S | M | Slack onboarding |
| 46 | 우클릭 → "링크 복사" (딥링크 URL 스킴) | M | M | Slack message link |
| 47 | 세션 카드 hover 시 "재개" 아이콘 버튼 인라인 표시 | S | H | Discord |
| 48 | 세션 auto-archive 정책 설정 | M | M | Claude Code Desktop |
| 49 | 사이드바 테마 색상 커스터마이징 | M | N | Slack themes |
| 50 | 세션 목록 컴팩트 모드 / 편안한 모드 토글 | S | M | Slack density |
| 51 | 사이드바 backend 타입별 아이콘 구분 | S | M | AgentView 특성 |
| 52 | 드래그로 세션을 그룹 밖으로 꺼내기 | M | M | Claude Projects |
| 53 | 사이드바 폭 기억 (앱 재시작 후 복원) | S | M | VS Code persistence |
| 54 | 세션 카드 멀티선택 Shift+Click | S | M | macOS Mail |
| 55 | 필터 상태 + 검색어 동시 적용 AND 조건 | S | H | Slack search |
| 56 | 세션 카드 Ctrl+D → 즐겨찾기 토글 | S | M | Notion |

---

## Category 2: SessionDetail 헤더 + 메시지 — 55개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 57 | 헤더 cwd 경로 클릭 → 파일 탐색기 열기 | S | H | Warp terminal |
| 58 | 헤더 cwd 경로 hover 툴팁 (전체 경로) | S | M | VS Code 상태바 |
| 59 | 헤더 model 클릭 → 모델 변경 드롭다운 | S | H | Claude Code Desktop |
| 60 | 헤더 permission 클릭 → 권한 변경 드롭다운 | S | H | Claude Code Desktop |
| 61 | 헤더 고정 핀 버튼 | S | M | ChatGPT |
| 62 | 헤더 공유 버튼 → 세션 내보내기 | M | M | Slack export |
| 63 | 세션 제목 헤더 클릭 inline rename | S | H | ChatGPT Desktop |
| 64 | 헤더 상태 클릭 → 세션 일시정지/재개 | M | H | Claude Code Desktop |
| 65 | 메시지 bubble hover → 액션 툴바 (복사/핀/인용/더보기) | S | H | Slack |
| 66 | 복사 버튼 클릭 시 체크 아이콘 피드백 (1초) | S | H | ChatGPT, GitHub |
| 67 | 코드 블록 언어별 syntax highlight | M | H | GitHub, VS Code |
| 68 | 코드 블록 상단 언어 배지 + 복사 버튼 | S | H | ChatGPT, GitHub |
| 69 | 코드 블록 접기/펼치기 (100줄 이상 자동 접기) | S | M | GitHub |
| 70 | 코드 블록 "편집기에서 열기" 버튼 | M | M | Cursor |
| 71 | 메시지 내 파일 경로 클릭 → 파일 탐색기 열기 | S | H | Warp block output |
| 72 | 메시지 내 URL 자동 하이퍼링크 + 외부 브라우저 | S | H | Slack, Discord |
| 73 | 메시지 내 URL hover → 오픈그래프 미리보기 카드 | M | M | Slack, Discord |
| 74 | tool_use 메시지 기본 접힘 + 클릭 펼치기 | S | H | Claude Code Desktop |
| 75 | tool_use 실행 시간 표시 | S | M | AgentView 특성 |
| 76 | tool_result 에러 시 빨간 border + 에러 메시지 강조 | S | H | 일반 best practice |
| 77 | 메시지 버블 좌우 정렬 (user 오른쪽, assistant 왼쪽) | S | M | ChatGPT, Discord |
| 78 | 메시지 시간 표시 (각 메시지 우하단) | S | M | Discord |
| 79 | 메시지 전문 검색 (Ctrl+F) → 스크롤 이동 + 하이라이트 | M | H | Slack Ctrl+F |
| 80 | 검색 히트 prev/next 탐색 (Ctrl+G / Ctrl+Shift+G) | S | H | Slack, VS Code |
| 81 | 메시지 핀(bookmark) 기능 → 핀 목록 패널 | M | M | Slack pin |
| 82 | 핀 목록 패널 단축키 (Ctrl+Shift+P) | S | M | Slack |
| 83 | 메시지 분기(branch) — 특정 메시지에서 새 세션 시작 | L | H | Claude Code Side Chat |
| 84 | "이 메시지부터 재실행" 기능 | L | H | ChatGPT regenerate |
| 85 | 메시지 재생성(Regenerate) 버튼 | M | H | ChatGPT |
| 86 | 메시지 편집(Edit) 버튼 (user 메시지) → 재전송 | M | H | ChatGPT |
| 87 | 도넛 차트 hover → 토큰 상세 툴팁 | S | M | 기존 개선 |
| 88 | 도넛 차트 클릭 → 토큰 상세 패널 펼치기 | S | M | Claude Code Desktop |
| 89 | 컨텍스트 윈도우 사용률 프로그레스 바 | S | H | Claude Code Desktop |
| 90 | 컨텍스트 80% 초과 시 경고 표시 | S | H | Claude Code Desktop |
| 91 | 세션 내 총 비용 표시 (USD, opt-in) | M | M | Claude Code Desktop |
| 92 | 스크롤 맨 아래로 FAB 버튼 (새 메시지 도착 시) | S | H | Slack, Discord |
| 93 | 새 메시지 알림 배너 "N개 새 메시지" | S | H | Slack |
| 94 | 세션 상세 뷰 모드 전환 (Verbose/Normal/Summary) | M | H | Claude Code Desktop |
| 95 | 뷰 모드 Ctrl+O 단축키 | S | M | Claude Code Desktop |
| 96 | meta 메시지 배경 색상 구분 | S | M | 기존 개선 |
| 97 | 메시지 bubble 최대 너비 설정 | S | M | ChatGPT |
| 98 | 메시지 폰트 크기 설정 | S | M | Slack, Discord |
| 99 | 메시지 줄 간격 설정 | S | N | 일반 best practice |
| 100 | 긴 메시지 "더 보기/접기" (500자 이상 자동 접기) | S | M | Slack |
| 101 | 스트리밍 중 취소 버튼 (Esc 또는 Stop 버튼) | S | H | ChatGPT, Claude |
| 102 | 스트리밍 중 커서 깜빡임 애니메이션 | S | M | ChatGPT |
| 103 | 스트리밍 완료 후 시각적 피드백 | S | M | 일반 best practice |
| 104 | 메시지 bubble 드래그 텍스트 선택 지원 | S | H | 기본 접근성 |
| 105 | 이미지 첨부 메시지 클릭 → 라이트박스 확대 보기 | S | M | Slack, Discord |
| 106 | 이미지 우클릭 → "이미지 저장" | S | M | Slack |
| 107 | Markdown 렌더링 ON/OFF 토글 (raw text 보기) | S | M | VS Code, GitHub |
| 108 | turn 구분선 (사용자 입력 → 어시스턴트 응답 그룹화) | S | M | Claude Code Desktop |
| 109 | 전체 세션 JSON 내보내기 | M | M | ChatGPT export |
| 110 | 전체 세션 Markdown 내보내기 | M | M | ChatGPT export |
| 111 | 메시지 간 시간 간격 표시 (20분 이상 경과 시 구분선) | S | M | Slack |

---

## Category 3: 입력바 (Composer) — 52개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 112 | 입력창 자동 높이 조절 (최대 10줄) | S | H | ChatGPT, Discord |
| 113 | 입력 중 Shift+Enter → 줄바꿈 | S | H | Slack, Discord |
| 114 | 입력 중 Ctrl+Enter → 전송 | S | H | Discord 설정 |
| 115 | 입력 중 Ctrl+↑ → 이전 메시지 편집 불러오기 | S | M | Slack, Discord |
| 116 | 입력 히스토리 ↑/↓ 탐색 | S | M | iTerm2, Warp |
| 117 | 입력 드래프트 자동 저장 (앱 종료 후 복원) | S | H | Slack draft |
| 118 | 드래그 앤 드롭 파일 첨부 (이미지/텍스트/PDF) | M | H | Discord, Slack |
| 119 | 클립보드 이미지 붙여넣기 (Ctrl+V) | S | H | Discord, Slack |
| 120 | 파일 첨부 후 미리보기 썸네일 | S | H | Discord, Slack |
| 121 | 첨부 파일 제거 버튼 (미리보기 옆 X) | S | H | Discord |
| 122 | 파일 첨부 타입 제한 안내 | S | M | 일반 best practice |
| 123 | 슬래시 명령어 자동완성 팝업 최근 사용순 정렬 | S | M | Discord |
| 124 | 슬래시 명령어 팝업 키보드 ↑/↓ + Enter 선택 | S | H | Discord, Slack |
| 125 | 슬래시 명령어 팝업 Esc → 닫기 | S | M | Discord |
| 126 | 슬래시 명령어 설명 툴팁 (오른쪽에 설명) | S | M | VS Code Copilot |
| 127 | 슬래시 명령어 퍼지 검색 지원 | S | H | VS Code Copilot |
| 128 | @멘션 문법으로 파일/디렉토리 참조 | M | H | VS Code Copilot #mention |
| 129 | @ 입력 시 파일 탐색 팝업 (퍼지 검색) | M | H | VS Code Copilot |
| 130 | # 입력 시 툴 선택 팝업 | M | M | VS Code Copilot |
| 131 | 입력창 글자 수 카운터 (선택적) | S | N | Twitter 유사 |
| 132 | 입력창 마크다운 실시간 미리보기 모드 | M | M | GitHub, GitLab |
| 133 | 입력창 Bold/Italic/Code 서식 버튼 툴바 | S | M | Slack, Discord |
| 134 | 입력창 Ctrl+B Bold, Ctrl+I Italic 단축키 | S | M | Slack |
| 135 | 입력창 코드 블록 ``` 자동완성 | S | H | Discord, Slack |
| 136 | 프롬프트 템플릿 저장/불러오기 | M | H | Warp Workflows |
| 137 | 프롬프트 템플릿 팝업 Ctrl+Shift+T | S | M | Warp |
| 138 | 입력창 플레이스홀더 텍스트 다양화 | S | N | 일반 best practice |
| 139 | 전송 버튼 비활성화 (빈 입력 시) | S | M | Discord |
| 140 | 전송 버튼 hover 색상 변화 + 툴팁 | S | N | 일반 best practice |
| 141 | 워크트리 옵션 드롭다운 기억 | S | M | 기존 개선 |
| 142 | 백엔드 selector 드롭다운 아이콘+이름 표시 | S | M | 기존 개선 |
| 143 | 권한 모드 변경 시 확인 다이얼로그 | S | M | 일반 best practice |
| 144 | 모델 선택 드롭다운에 모델 설명 툴팁 | S | M | 일반 best practice |
| 145 | 입력창 포커스 단축키 (Ctrl+L / Cmd+L) | S | H | iTerm2 |
| 146 | 입력창 전체 선택 Ctrl+A → 클리어 Ctrl+K | S | M | iTerm2 |
| 147 | 긴 입력 펼치기 (전체화면 입력 모달) | M | M | Notion |
| 148 | 음성 입력 버튼 (Web Speech API) | L | M | ChatGPT voice |
| 149 | 음성 입력 시 실시간 텍스트 미리보기 | M | M | ChatGPT voice |
| 150 | 입력창 실행 취소/재실행 (Ctrl+Z / Ctrl+Y) | S | H | 기본 UX |
| 151 | 입력창 중단점 설정 (긴 작업 전 체크포인트) | L | M | Claude Code Desktop |
| 152 | "작업 중" 상태에서 추가 입력 큐잉 기능 | M | H | Claude Code Desktop |
| 153 | 세션 실행 중 입력창 비활성화 + "대기 중" 안내 | S | H | 일반 best practice |
| 154 | 입력창 하단 글자 수 제한 경고 (8000자 근접) | S | M | Twitter, Slack |
| 155 | 입력창 자동 완성 (유사 이전 메시지 제안) | M | M | Warp AI suggest |
| 156 | 입력창 오탈자 교정 제안 밑줄 | S | N | 일반 best practice |
| 157 | 입력창 언어 전환 스펠체크 | S | N | 일반 best practice |
| 158 | 응답 스트리밍 중 Esc 단축키 → 중단 | S | H | ChatGPT |
| 159 | 세션 시작 전 확인 다이얼로그 | M | M | 일반 best practice |
| 160 | 입력창 텍스트 에디터 확장 모드 | M | M | Notion, Linear |
| 161 | 이모지 입력 : 트리거 팝업 | S | M | Slack, Discord |
| 162 | 파일 경로 자동완성 (/ 입력 시 cwd 기준 탐색) | M | H | Warp, iTerm2 |
| 163 | 입력창 접기(최소화) 토글 | S | M | 일반 best practice |

---

## Category 4: 검색 & 필터 — 42개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 164 | 전역 검색 팔레트 Ctrl+K / Cmd+K | S | H | Linear, Notion, VS Code |
| 165 | 전역 검색 — 세션 이름 + 메시지 전문 동시 검색 | M | H | Slack |
| 166 | 전역 검색 결과 카테고리별 섹션 | M | M | Slack, macOS Spotlight |
| 167 | 검색 결과 메시지 컨텍스트 스니펫 표시 | M | M | Slack |
| 168 | 검색 결과 클릭 → 해당 메시지로 스크롤 이동 | M | H | Slack |
| 169 | 검색 연산자 지원 (from: before: after: in:) | L | M | Slack advanced search |
| 170 | 검색 필터: 날짜 범위 | M | M | Slack, macOS Mail |
| 171 | 검색 필터: 세션 상태 | S | M | 기존 필터 확장 |
| 172 | 검색 필터: backend 타입 | S | M | AgentView |
| 173 | 검색 필터: 모델명 | S | N | AgentView |
| 174 | 검색 필터: cwd/프로젝트 | M | M | 일반 best practice |
| 175 | 검색 최근 기록 저장 및 팝업 | S | M | macOS Mail |
| 176 | 검색 결과 없음 Empty State + 추천 검색어 | S | M | Slack |
| 177 | 검색 결과 단어 매칭 수 표시 | S | M | Slack |
| 178 | 검색창 포커스 시 단축키 힌트 | S | N | 일반 best practice |
| 179 | 검색 결과 키보드 ↑/↓ 탐색 | S | H | Slack |
| 180 | 검색 모드에서 Esc → 종료 | S | H | Slack, VS Code |
| 181 | 세션 목록 검색어 하이라이트 | S | H | Slack |
| 182 | 메시지 내 검색어 하이라이트 | M | H | Ctrl+F 기능 |
| 183 | 세션 태그 기반 검색 | M | M | Linear |
| 184 | 세션 상태 기반 필터 드롭다운 복수 선택 | S | M | Linear |
| 185 | 필터 조합 저장 (저장된 뷰) | M | M | Linear saved views |
| 186 | 즐겨찾기 검색 저장 | M | M | Slack |
| 187 | 검색 결과 내보내기 (CSV/JSON) | L | N | macOS Mail |
| 188 | 검색 팔레트 최근 방문 세션 Quick Switch | S | H | Linear, VS Code |
| 189 | 전역 검색에서 명령어 실행 | M | M | Linear command palette |
| 190 | 명령어 팔레트 퍼지 매칭 (오타 허용) | S | H | VS Code, Linear |
| 191 | 명령어 팔레트 결과 그룹 (최근/추천/모든 명령) | S | M | Linear |
| 192 | 명령어 팔레트 Shift+Enter → 백그라운드 실행 | M | M | Linear |
| 193 | 검색 팔레트 세션 썸네일 미리보기 | M | N | 일반 best practice |
| 194 | 사이드바 필터 클리어 버튼 (모두 초기화) | S | M | macOS Mail |
| 195 | 세션 목록 그룹별 개수 표시 | S | M | macOS Mail |
| 196 | 필터 상태 URL 파라미터 저장 | M | M | Linear |
| 197 | 검색 결과 정렬 옵션 (관련도/날짜) | S | M | Slack |
| 198 | 전역 검색 Opening Animation | S | N | Linear, Figma |
| 199 | 검색창 프롬프트 예시 텍스트 | S | N | 일반 best practice |
| 200 | 검색 단축키 안내 (결과 없을 때) | S | N | 일반 best practice |
| 201 | 검색 실시간 결과 (입력 200ms debounce) | S | H | Slack |
| 202 | 검색 결과 탐색 중 Shift+Enter → 새 탭에서 열기 | M | M | Slack |
| 203 | 저장된 필터 사이드바 퀵 버튼 | S | M | Linear |
| 204 | 검색 모드 vs 필터 모드 명확한 구분 UI | S | M | 일반 best practice |
| 205 | 전역 검색에서 날짜 자연어 입력 (어제, 이번 주) | M | M | Notion |

---

## Category 5: 키보드 단축키 & 내비게이션 — 47개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 206 | 단축키 목록 패널 (Ctrl+? / Cmd+?) | S | H | Slack |
| 207 | 단축키 패널 우측 사이드바로 고정 옵션 | S | M | Slack |
| 208 | 단축키 사용자 커스터마이징 | L | M | VS Code keybindings |
| 209 | Ctrl+Tab 세션 순환 탐색 | S | H | Slack, iTerm2 |
| 210 | Ctrl+Shift+Tab 역방향 세션 순환 | S | H | Slack |
| 211 | Ctrl+1~9 → 세션 번호 직접 이동 | S | H | Slack workspace |
| 212 | Ctrl+J → 최근 세션 바로 전환 | S | H | VS Code |
| 213 | Ctrl+N / Cmd+N → 새 세션 | S | H | Claude Code Desktop |
| 214 | Ctrl+W → 현재 세션 닫기 (아카이브) | S | M | 브라우저 탭 UX |
| 215 | Ctrl+Shift+N → 새 세션을 사이드 패널로 열기 | M | M | Claude Code Desktop |
| 216 | Alt+← / Alt+→ 세션 이동 | S | M | 브라우저 네비게이션 |
| 217 | Ctrl+Home / Ctrl+End → 메시지 맨 위/아래 | S | M | 일반 UX |
| 218 | PageUp / PageDown → 메시지 스크롤 | S | M | 일반 UX |
| 219 | Ctrl+F → 현재 세션 메시지 내 검색 | S | H | 브라우저 표준 |
| 220 | F6 / Shift+F6 → 사이드바 ↔ 상세 포커스 이동 | S | H | Slack accessibility |
| 221 | Ctrl+, / Cmd+, → 설정 열기 | S | H | VS Code, Slack |
| 222 | Ctrl+Shift+E → 세션 내보내기 | S | M | 일반 best practice |
| 223 | Ctrl+Shift+C → 전체 대화 복사 | S | M | 일반 best practice |
| 224 | Ctrl+Shift+K → AI 명령어 팔레트 (자연어 명령) | S | H | Warp AI |
| 225 | Ctrl+P / Cmd+P → 파일 참조 팝업 | S | M | VS Code Copilot |
| 226 | Ctrl+Shift+P → 전체 명령 팔레트 | S | H | VS Code |
| 227 | Escape → 포커스 해제 / 팝업 닫기 | S | H | 표준 UX |
| 228 | Alt+1 → 사이드바 포커스 | S | M | Slack |
| 229 | Alt+2 → 메시지 영역 포커스 | S | M | Slack |
| 230 | Alt+3 → 입력창 포커스 | S | M | Slack |
| 231 | J/K → 메시지 탐색 (vim 스타일, 선택적 모드) | M | M | Linear vim mode |
| 232 | G → 맨 아래로 이동 (vim 스타일) | M | M | Linear |
| 233 | R → 응답 재생성 단축키 | M | M | 단축키 |
| 234 | E → 마지막 user 메시지 편집 | M | M | 단축키 |
| 235 | Tab → 포커스 이동 (논리적 순서) | S | H | WCAG 2.1.1 |
| 236 | Shift+Tab → 역방향 포커스 이동 | S | H | WCAG 2.1.1 |
| 237 | 모든 대화형 요소 키보드 접근 가능 | M | H | WCAG 2.1.1 |
| 238 | 포커스 시각적 표시 (outline 항상 표시) | S | H | WCAG 2.4.7 |
| 239 | 단축키 충돌 감지 시 경고 | M | M | VS Code |
| 240 | 세션 생성일 기준 정렬 단축키 | S | N | 일반 best practice |
| 241 | 단축키 힌트 툴팁 (버튼 hover 시) | S | M | VS Code, Linear |
| 242 | 전역 단축키 (앱 포커스 없어도 동작) | M | M | Electron global shortcut |
| 243 | 단축키 검색 (단축키 목록에서 기능명 검색) | S | M | VS Code |
| 244 | 새 세션 생성 시 세션 이름 자동 포커스 | S | M | 일반 best practice |
| 245 | 세션 이름 변경 후 Enter → 다음 세션 rename 체인 | S | N | 일반 best practice |
| 246 | 단축키 히트 시 시각 피드백 | S | N | 일반 best practice |
| 247 | 명령 팔레트 최근 실행 명령 상단 표시 | S | M | Linear, VS Code |
| 248 | 명령 팔레트 카테고리 구분선 | S | N | VS Code |
| 249 | Ctrl+Z → 세션 삭제 취소 (undo) | M | H | macOS Mail |
| 250 | F11 → 전체화면 / 포커스 모드 토글 | S | M | 일반 Electron |
| 251 | Ctrl+Shift+F → 전체화면 메시지 뷰 | S | M | 일반 best practice |
| 252 | 단축키 안내 온보딩 팝업 (첫 실행 시) | S | M | Linear onboarding |

---

## Category 6: 알림 & 상태 표시 — 38개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 253 | 세션 완료 시 데스크탑 알림 (OS 네이티브) | S | H | Electron Notification API |
| 254 | 세션 에러 시 데스크탑 알림 + 에러 요약 | S | H | Electron Notification API |
| 255 | 알림 클릭 → 앱 포커스 + 해당 세션 이동 | S | H | Electron |
| 256 | 알림 설정 페이지 (종류별 ON/OFF) | S | M | Slack notification settings |
| 257 | 방해 금지 모드 (알림 일시 중단) | S | M | macOS 방해 금지 모드 |
| 258 | 방해 금지 시간대 설정 | S | M | Slack |
| 259 | 시스템 트레이 아이콘 (최소화 시 트레이 유지) | M | H | Electron tray |
| 260 | 트레이 아이콘 우클릭 → 빠른 새 세션 시작 | M | H | Electron tray |
| 261 | 트레이 아이콘 뱃지 (실행 중 세션 수) | S | H | Electron badge |
| 262 | 태스크바/독 뱃지 (실행 중 세션 수) | S | H | Electron setOverlayIcon |
| 263 | 앱 제목 표시줄에 실행 중 세션 수 표시 | S | M | 일반 best practice |
| 264 | 세션 타임아웃 전 경고 알림 | M | M | 일반 best practice |
| 265 | 토큰 사용량 임계값 도달 알림 | M | M | Claude Code Desktop |
| 266 | CI/CD 상태 연동 알림 (GitHub Actions 완료) | L | M | Claude Code Desktop |
| 267 | 세션 내 에러 인디케이터 (카드 에러 뱃지) | S | H | 일반 best practice |
| 268 | 세션 목록 실시간 업데이트 (IPC 이벤트) | M | H | 기존 개선 |
| 269 | 새 세션 생성 시 애니메이션 (슬라이드 인) | S | M | ChatGPT |
| 270 | 세션 완료 시 체크 아이콘 애니메이션 | S | M | 일반 best practice |
| 271 | 세션 진행 상태 프로그레스 바 (카드 하단) | M | M | Linear |
| 272 | 세션 마지막 오류 메시지 인라인 표시 | S | M | 일반 best practice |
| 273 | 알림 소리 ON/OFF 설정 | S | M | Slack |
| 274 | 알림 소리 커스텀 선택 | M | N | Slack |
| 275 | 실행 중 세션 헤더 스피너 애니메이션 | S | M | 기존 개선 |
| 276 | 앱 업데이트 알림 배너 | M | M | Electron auto-update |
| 277 | 업데이트 다운로드 진행률 표시 | M | M | Electron |
| 278 | 업데이트 설치 후 재시작 확인 다이얼로그 | S | M | Electron |
| 279 | 오프라인 상태 감지 + 연결 오류 배너 | M | H | 일반 best practice |
| 280 | 오프라인 → 온라인 복구 시 자동 재연결 | M | H | 일반 best practice |
| 281 | 세션 백그라운드 실행 표시기 (트레이 스피너) | S | M | Electron tray |
| 282 | 알림 히스토리 패널 (최근 알림 N개) | M | M | macOS 알림 센터 |
| 283 | 세션 완료 → 자동 아카이브 알림 배너 | S | M | Claude Code Desktop |
| 284 | 권한 요청 시 허용/거부 팝업 알림 | S | H | Claude Code Desktop |
| 285 | 권한 요청 내용 상세 표시 | S | H | Claude Code Desktop |
| 286 | 세션 충돌/병합 충돌 감지 알림 | M | H | Claude Code Desktop |
| 287 | 알림 그룹화 (동일 세션 알림 묶음) | M | M | macOS 알림 그룹 |
| 288 | Focus 모드 - 활성 세션 외 알림 일시 중단 | M | M | Slack focus |
| 289 | 알림 스누즈 기능 (N분 후 재알림) | M | M | Slack 리마인더 |
| 290 | 알림 내 액션 버튼 ("세션 보기" 버튼) | M | H | macOS 알림 액션 |

---

## Category 7: 테마 & 외관 — 35개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 291 | 다크 모드 / 라이트 모드 전환 | M | H | 모든 주요 앱 |
| 292 | 시스템 테마 자동 감지 (prefers-color-scheme) | S | H | CSS 표준 |
| 293 | 예약 시간대 테마 전환 | M | M | 일반 best practice |
| 294 | 고대비 모드 (WCAG AAA) | M | H | WCAG accessibility |
| 295 | 사용자 정의 색상 테마 (CSS 커스텀 속성) | L | M | VS Code themes |
| 296 | 폰트 패밀리 선택 | S | M | VS Code |
| 297 | 폰트 크기 글로벌 설정 (12px ~ 20px) | S | H | VS Code |
| 298 | 코드 폰트 별도 설정 (JetBrains Mono 등) | S | M | VS Code |
| 299 | 리가처(ligature) 폰트 ON/OFF | S | N | VS Code |
| 300 | 사이드바 배경 색상 강도 조절 | S | N | Slack theme |
| 301 | 메시지 버블 스타일 선택 (버블형/플랫형) | S | M | 일반 best practice |
| 302 | 배경 이미지/패턴 설정 | M | N | Discord |
| 303 | 투명도 효과 설정 (macOS Vibrancy, Win Acrylic) | M | M | Discord, Slack |
| 304 | 메시지 가독성 줄 간격 조절 슬라이더 | S | M | 일반 best practice |
| 305 | 타임스탬프 형식 설정 (상대/절대/없음) | S | M | Discord |
| 306 | 날짜 형식 설정 (YYYY-MM-DD / MM/DD/YY) | S | M | i18n best practice |
| 307 | 컴팩트 뷰 / 넓은 뷰 토글 | S | M | Slack density |
| 308 | 애니메이션 감소 모드 (prefers-reduced-motion) | S | H | WCAG 2.3.3 |
| 309 | 사이드바 아이콘 크기 조절 | S | N | 일반 best practice |
| 310 | 메시지 최대 너비 설정 | S | M | ChatGPT |
| 311 | 코드 블록 테마 선택 (Monokai/Solarized 등) | S | M | VS Code |
| 312 | 색맹 친화 팔레트 옵션 | M | H | accessibility |
| 313 | 상태 색상 사용자 정의 | M | M | 일반 best practice |
| 314 | 테마 import/export (JSON) | M | N | VS Code |
| 315 | 커뮤니티 테마 갤러리 | L | N | VS Code marketplace |
| 316 | 앱 창 투명도 조절 | M | N | Electron |
| 317 | 시스템 기본 글꼴 사용 옵션 | S | N | 일반 best practice |
| 318 | 헤더 세션 상태별 배경 색상 | S | M | 일반 best practice |
| 319 | 설정 화면 미리보기 (테마 변경 실시간 반영) | S | M | Slack |
| 320 | 글씨 렌더링 antialiasing 설정 | S | N | macOS |
| 321 | HiDPI / Retina 디스플레이 자동 대응 | S | H | Electron |
| 322 | 사용자 아바타/프로필 사진 설정 | S | N | Discord |
| 323 | 세션 카드 배경 색상 커스텀 | M | M | Notion |
| 324 | 테마 적용 애니메이션 (페이드 전환) | S | N | 일반 best practice |
| 325 | 설정 변경 실행 취소 (이전 테마 복원) | S | M | VS Code |

---

## Category 8: 다중 패널 & 레이아웃 — 38개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 326 | 분할 패널 (좌우 나란히 두 세션 동시 보기) | L | H | Claude Code Desktop |
| 327 | 분할 패널 드래그 리사이즈 | M | H | Claude Code Desktop |
| 328 | 분할 패널 최대 4분할 그리드 | L | M | Claude Code Desktop |
| 329 | 패널 레이아웃 저장/불러오기 (작업 유형별 프리셋) | M | M | Claude Code Desktop |
| 330 | 세션 탭 형식 (단일 패널에 탭으로 세션 표시) | M | H | iTerm2, Windows Terminal |
| 331 | 탭 순서 드래그 변경 | S | M | 브라우저 탭 |
| 332 | 탭 핀(고정) 기능 | S | M | 브라우저 탭 |
| 333 | 탭 duplicating (세션 복제 탭) | M | M | 브라우저 |
| 334 | 탭 분리 (별도 창으로 꺼내기) | L | M | Chrome, iTerm2 |
| 335 | 멀티 윈도우 지원 (앱 창 여러 개) | L | M | Electron multi-window |
| 336 | 창 간 세션 드래그 이동 | L | N | Electron |
| 337 | 미니 모드 (위젯 크기 미니 팝업) | L | M | 일반 Electron |
| 338 | 메시지 패널과 터미널 통합 뷰 | L | H | Claude Code Desktop |
| 339 | 파일 브라우저 사이드패널 통합 | L | M | Claude Code Desktop |
| 340 | diff 뷰어 패널 통합 | L | H | Claude Code Desktop |
| 341 | 사이드 채팅 패널 (메인 스레드 분기) | L | H | Claude Code Desktop Cmd+; |
| 342 | 패널 최대화/복원 버튼 | S | M | 일반 UX |
| 343 | 패널 숨기기 토글 (사이드바 숨기기) | S | H | VS Code |
| 344 | 수직/수평 분할 선택 | M | M | iTerm2 |
| 345 | 패널 간 포커스 이동 단축키 (Ctrl+Shift+Arrow) | S | M | VS Code |
| 346 | 세션 비교 뷰 (두 세션 메시지 나란히) | L | N | 일반 best practice |
| 347 | 포커스 모드 (사이드바 숨김 + 메시지 전체화면) | S | M | VS Code Zen Mode |
| 348 | 프레젠테이션 모드 (헤더/사이드바 숨김) | M | N | Keynote, VS Code |
| 349 | 패널 색상 구분 (여러 세션 열 때 패널 테두리 색) | S | M | iTerm2 |
| 350 | 가로 스크롤 지원 (넓은 코드 블록) | S | M | VS Code |
| 351 | 패널 동기화 스크롤 (비교 뷰용) | L | N | diff tools |
| 352 | 레이아웃 리셋 단축키 (기본 레이아웃으로 복원) | S | M | VS Code |
| 353 | 마지막 레이아웃 상태 저장 (앱 재시작 후 복원) | S | H | VS Code workspace |
| 354 | 세션별 레이아웃 저장 | M | M | Warp |
| 355 | 워크스페이스 개념 (세션 + 설정 그룹) | L | H | Claude Code Desktop |
| 356 | 워크스페이스 전환 단축키 | S | M | Slack workspace |
| 357 | 워크스페이스 내보내기/가져오기 | L | N | VS Code workspace |
| 358 | 외부 모니터 지원 (창 두 번째 모니터로 이동) | S | M | Electron |
| 359 | 창 크기/위치 기억 | S | H | Electron |
| 360 | 창 최소 크기 제한 | S | M | Electron |
| 361 | 패널 분할 비율 저장 | S | M | 일반 best practice |
| 362 | 패널 분할 스냅 포인트 (25%/33%/50%/66%/75%) | S | M | react-split-pane |
| 363 | 사이드바 + 상세 비율 사용자 저장 | S | M | 기존 개선 |

---

## Category 9: 접근성 (a11y) — 40개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 364 | 모든 버튼에 aria-label 부착 | S | H | WCAG 4.1.2 |
| 365 | 모든 아이콘 버튼에 role="button" + aria-label | S | H | WCAG |
| 366 | 스트리밍 메시지 aria-live="polite" 영역 | S | H | WCAG, ChatGPT |
| 367 | 메시지 목록 role="feed" + aria-busy | S | M | ARIA feed pattern |
| 368 | 세션 목록 role="listbox" + aria-selected | S | H | WCAG |
| 369 | 다이얼로그 aria-modal="true" + 포커스 트랩 | S | H | WCAG 2.1 |
| 370 | 팝업 Esc 닫기 + 포커스 복원 | S | H | WCAG 2.1 |
| 371 | 스크린 리더 "loading" 상태 aria-busy 알림 | S | H | WCAG |
| 372 | 고포커스 표시 (outline: 2px solid) | S | H | WCAG 2.4.7 |
| 373 | 포커스 순서 논리적 배치 | S | H | WCAG 2.4.3 |
| 374 | 건너뛰기 링크 (Skip to main content) | S | M | WCAG 2.4.1 |
| 375 | 색상만으로 상태 구분 금지 (아이콘/텍스트 병용) | S | H | WCAG 1.4.1 |
| 376 | 텍스트 최소 대비율 4.5:1 | S | H | WCAG 1.4.3 |
| 377 | 대형 텍스트 최소 대비율 3:1 | S | H | WCAG 1.4.3 |
| 378 | 색맹 친화 상태 표시 (빨강/초록 이외 구분) | M | H | accessibility |
| 379 | 모든 이미지 대체 텍스트 (alt) | S | H | WCAG 1.1.1 |
| 380 | 동적 콘텐츠 변경 aria-live 알림 | S | H | WCAG |
| 381 | 폼 입력 라벨 연결 (label for) | S | H | WCAG 1.3.1 |
| 382 | 오류 메시지 role="alert" + 즉시 알림 | S | H | WCAG |
| 383 | 키보드만으로 모든 기능 사용 가능 | M | H | WCAG 2.1.1 |
| 384 | 드래그 기능 대체 수단 제공 | M | H | WCAG 2.1.1 |
| 385 | 텍스트 크기 200% 확대 시 레이아웃 무너짐 없음 | M | H | WCAG 1.4.4 |
| 386 | 가로 스크롤 없이 320px 너비 대응 | M | M | WCAG 1.4.10 |
| 387 | 애니메이션 prefers-reduced-motion 준수 | S | H | WCAG 2.3.3 |
| 388 | 자동 재생 미디어 없음 (또는 정지 버튼) | S | M | WCAG 1.4.2 |
| 389 | 세션 목록 스크린 리더 landmark roles | S | M | WCAG |
| 390 | 명령 팔레트 aria-combobox 패턴 | S | H | ARIA APG |
| 391 | 드롭다운 aria-expanded 상태 | S | H | ARIA |
| 392 | 탭 컴포넌트 aria-tabs 패턴 | S | H | ARIA APG |
| 393 | 체크박스/라디오 aria-checked | S | H | ARIA |
| 394 | 메뉴 aria-menu 패턴 | S | H | ARIA APG |
| 395 | 토스트 알림 role="status" | S | M | WCAG |
| 396 | 접근성 설정 패널 (폰트/대비/모션) | M | H | accessibility |
| 397 | 스크린 리더 테스트 (NVDA, JAWS, VoiceOver) | M | H | 표준 테스트 |
| 398 | 자동화된 접근성 검사 CI 통합 (axe-core) | M | H | axe DevTools |
| 399 | 포커스 링 숨기기 방지 (outline: none 금지) | S | H | WCAG |
| 400 | 대화 내용 텍스트 선택/복사 완전 지원 | S | H | 기본 접근성 |
| 401 | 스크롤 영역 aria-label 설명 | S | M | WCAG |
| 402 | 비디오/GIF 일시정지 버튼 | S | M | WCAG |
| 403 | 고대비 테마 + 아이콘 고대비 SVG | M | H | Windows 고대비 모드 |

---

## Category 10: 국제화 & 로컬라이제이션 — 33개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 404 | 한국어 / 영어 인터페이스 언어 전환 | M | H | i18n best practice |
| 405 | 언어 설정 즉시 반영 (앱 재시작 불필요) | M | M | i18n best practice |
| 406 | 시스템 언어 자동 감지 | S | M | i18n best practice |
| 407 | 날짜 형식 로케일별 자동 적용 | S | H | i18n 날짜 형식 |
| 408 | 상대 시간 표시 로케일별 적용 | S | M | i18n |
| 409 | 시간대(timezone) 설정 및 변환 | M | M | i18n |
| 410 | 숫자 형식 로케일별 적용 (1,000 vs 1.000) | S | N | i18n |
| 411 | RTL 언어 지원 구조 (아랍어 등) | L | M | i18n |
| 412 | 한국어 줄바꿈 처리 (word-break: keep-all) | S | H | 한국어 특성 |
| 413 | 한국어 폰트 최적화 (Pretendard, Noto Sans KR) | S | M | 한국어 UX |
| 414 | 영어 전용 기술 용어 번역 정책 | M | M | i18n |
| 415 | 번역 키 파일 분리 (ko.json, en.json) | M | H | i18n 구현 |
| 416 | 번역 누락 시 fallback (영어 표시) | S | M | i18n |
| 417 | 번역 컨텍스트 주석 | M | N | i18n |
| 418 | 긴 번역 텍스트 레이아웃 대응 (독일어 15% 확장 등) | M | M | i18n |
| 419 | 복수형 처리 (N개의 세션 / 1개의 세션) | S | M | i18n Intl API |
| 420 | 오전/오후 vs AM/PM 시간 형식 | S | M | i18n |
| 421 | 키보드 단축키 로케일별 표기 (Ctrl vs Cmd) | S | M | macOS/Windows |
| 422 | 한국어 검색 초성 검색 지원 | M | H | 한국어 특성 |
| 423 | 한국어 자음/모음 부분 일치 검색 | M | H | 한국어 특성 |
| 424 | UTF-8 인코딩 일관 적용 | S | H | i18n 기본 |
| 425 | 이모지 한국어 컨텍스트 지원 | S | N | 일반 best practice |
| 426 | 통화/비용 표시 로케일별 형식 (₩ vs $) | S | M | i18n |
| 427 | 파일 경로 구분자 플랫폼별 처리 (/ vs \) | S | H | Windows/macOS |
| 428 | 언어 전환 단축키 (Ctrl+Shift+L) | S | M | i18n UX |
| 429 | 한국어/영어 혼합 메시지 렌더링 처리 | S | M | 한국어 특성 |
| 430 | 시스템 로케일 설정과 앱 설정 분리 | S | M | i18n |
| 431 | i18n 테스트 자동화 (pseudo-localization) | M | M | i18n QA |
| 432 | 스크린 리더 한국어 TTS 지원 | L | M | a11y + i18n |
| 433 | 날짜 "N일 전" → "어제", "그제" 자연어 변환 | S | M | 한국어 UX |
| 434 | 한국어 경어체 UI 텍스트 (합쇼체 통일) | M | M | 한국어 UX |
| 435 | 언어 추가 플러그인 구조 | L | N | VS Code i18n |
| 436 | 한국어 맞춤법 검사 입력창 연동 | M | M | 한국어 UX |

---

## Category 11: 성능 & 안정성 — 30개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 437 | 세션 목록 가상 스크롤 (1000+ 세션 성능) | M | H | React-Virtual |
| 438 | 메시지 목록 가상 스크롤 (긴 세션 성능) | M | H | React-Virtual |
| 439 | 이미지 레이지 로딩 | S | M | web 성능 |
| 440 | 코드 블록 syntax highlight 지연 처리 | M | H | 스트리밍 UX |
| 441 | 앱 시작 시간 최적화 (스플래시 스크린) | M | H | Electron |
| 442 | 메모리 사용량 모니터링 패널 (개발자 모드) | M | M | Electron 디버깅 |
| 443 | 오래된 세션 데이터 자동 정리 (90일 이상) | M | M | 일반 best practice |
| 444 | 세션 데이터 SQLite/IndexedDB 효율적 저장 | M | H | Electron 데이터 |
| 445 | IPC 채널 최적화 (불필요한 폴링 제거) | M | H | Electron |
| 446 | 렌더러 프로세스 충돌 자동 복구 | M | H | Electron 안정성 |
| 447 | 앱 충돌 보고서 자동 전송 (opt-in) | M | M | Electron crashReporter |
| 448 | 대용량 세션 페이지네이션 (무한 스크롤) | M | M | 일반 best practice |
| 449 | 세션 검색 인덱스 캐시 | M | M | 검색 성능 |
| 450 | 네트워크 요청 재시도 로직 (exponential backoff) | M | H | 일반 best practice |
| 451 | GPU 가속 텍스트 렌더링 | M | M | Electron |
| 452 | 비활성 탭 메모리 절약 | M | M | Chrome Tab Freeze |
| 453 | 앱 백그라운드 시 리소스 절약 모드 | M | M | Electron |
| 454 | 세션 데이터 백업 (로컬 자동 백업) | M | H | 일반 best practice |
| 455 | 데이터 복원 기능 (백업에서 복원) | M | H | 일반 best practice |
| 456 | 앱 설정 동기화 (클라우드 백업, 선택적) | L | M | VS Code Settings Sync |
| 457 | 앱 업데이트 증분 다운로드 | M | M | Electron auto-update |
| 458 | 세션 스트리밍 중단 시 자동 재연결 | M | H | 일반 best practice |
| 459 | 앱 응답 없음 감지 + 재시작 안내 | M | H | Electron |
| 460 | 메인/렌더러 프로세스 분리 명확화 | M | H | Electron 보안 |
| 461 | 세션 병렬 실행 시 CPU 사용량 제한 | M | M | 일반 best practice |
| 462 | 스트리밍 데이터 버퍼링 최적화 | M | H | 스트리밍 UX |
| 463 | 앱 설치 크기 최적화 | L | M | Electron |
| 464 | 코드 스플리팅 (초기 번들 크기 최소화) | M | M | React performance |
| 465 | 프리페치 (다음 세션 데이터 미리 로드) | M | M | 일반 best practice |
| 466 | 에러 바운더리 (React Error Boundary) 전체 적용 | S | H | React best practice |

---

## Category 12: 온보딩 & 설정 — 30개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 467 | 첫 실행 온보딩 투어 (단계별 UI 하이라이트) | M | H | Slack, Linear 온보딩 |
| 468 | 온보딩 건너뛰기 버튼 | S | H | 일반 best practice |
| 469 | 온보딩 재실행 옵션 ("투어 다시 보기") | S | M | 일반 best practice |
| 470 | 설정 패널 탭 구성 (일반/단축키/알림/외관/계정) | M | H | VS Code |
| 471 | 설정 검색 기능 | S | H | VS Code |
| 472 | 설정 변경 실시간 미리보기 | S | M | VS Code |
| 473 | 설정 내보내기/가져오기 (JSON) | M | M | VS Code |
| 474 | 설정 초기화 버튼 (기본값 복원) | S | M | 일반 best practice |
| 475 | 키보드 단축키 설정 탭 | M | M | VS Code |
| 476 | 알림 설정 탭 (종류별 ON/OFF) | S | M | Slack |
| 477 | API 키 관리 설정 | M | H | Claude Code Desktop |
| 478 | 기본 모델 설정 | S | H | Claude Code Desktop |
| 479 | 기본 권한 모드 설정 | S | H | Claude Code Desktop |
| 480 | 기본 백엔드 설정 | S | H | AgentView |
| 481 | 자동 세션 이름 생성 방식 설정 | S | M | Claude Code Desktop |
| 482 | 세션 자동 아카이브 정책 설정 | S | M | Claude Code Desktop |
| 483 | 데이터 저장 경로 변경 설정 | M | M | 일반 best practice |
| 484 | 프록시 설정 | M | M | Electron network |
| 485 | 자동 업데이트 ON/OFF | S | M | Electron |
| 486 | 베타 채널 참여 설정 | S | N | 일반 best practice |
| 487 | 개발자 도구 열기 옵션 | S | M | Electron |
| 488 | 로그 레벨 설정 (Debug/Info/Error) | S | M | 개발자 옵션 |
| 489 | 로그 파일 위치 표시 + 열기 버튼 | S | M | 일반 best practice |
| 490 | 피드백 보내기 버튼 (GitHub Issues 연동) | S | M | 일반 best practice |
| 491 | 도움말 페이지 링크 (F1 → 문서 열기) | S | M | VS Code |
| 492 | 릴리즈 노트 표시 (업데이트 후 자동 표시) | S | M | 일반 best practice |
| 493 | 체험판/라이선스 상태 표시 | S | M | 일반 best practice |
| 494 | 데이터 사용 동의 및 개인정보 설정 | M | H | GDPR |
| 495 | 로컬 데이터 완전 삭제 옵션 | M | H | 개인정보보호 |
| 496 | 계정 로그인 / 로그아웃 (클라우드 동기화 시) | M | M | 일반 best practice |

---

## Category 13: 협업 & 공유 — 20개

| # | 항목 | 크기 | 임팩트 | 출처/근거 |
|---|---|---|---|---|
| 497 | 세션 공유 링크 생성 (읽기 전용 URL) | L | M | Slack message link |
| 498 | 세션 Markdown 내보내기 | M | M | ChatGPT |
| 499 | 세션 JSON 내보내기 | M | M | 일반 best practice |
| 500 | 세션 PDF 내보내기 | M | M | ChatGPT |
| 501 | 특정 메시지 복사 버튼 (텍스트만) | S | H | ChatGPT, Slack |
| 502 | 특정 메시지 인용 (> 인용 형식으로 입력창에 삽입) | S | M | Discord, Slack |
| 503 | 세션 스크린샷 캡처 (전체 대화) | L | M | 일반 best practice |
| 504 | GitHub 이슈에 세션 내용 자동 붙여넣기 | L | M | Claude Code Desktop |
| 505 | PR 설명에 세션 요약 삽입 | L | M | Claude Code Desktop |
| 506 | 팀 공유 세션 그룹 (읽기 전용 협업) | L | M | Claude Projects |
| 507 | 세션 버전 기록 (편집 히스토리) | L | N | Notion |
| 508 | 세션 diff 비교 (변경사항 추적) | L | N | Notion |
| 509 | 이메일로 세션 내보내기 | M | N | 일반 best practice |
| 510 | Slack으로 세션 내보내기 인테그레이션 | L | N | 일반 best practice |
| 511 | 세션 공개/비공개 설정 | L | M | 일반 best practice |
| 512 | 세션 워터마크 표시 (공유 시 출처 표기) | M | N | ChatGPT watermark |
| 513 | 공유 세션 만료 날짜 설정 | M | M | Slack |
| 514 | 세션 내 코드 블록 Gist 공유 | M | M | GitHub Gist |
| 515 | 특정 메시지 딥링크 (앱 내 특정 메시지 URL) | M | M | Slack |
| 516 | 세션 요약 자동 생성 (AI 요약) | L | H | Claude Code Desktop |

---

## 우선 진행 추천 (S+M, 임팩트 H/M, 즉시 구현 가능) — 100개

S·M 크기, 임팩트 H·M인 항목 엄선.

| 우선순위 | # | 항목 | 크기 | 임팩트 |
|---|---|---|---|---|
| 1 | 1 | 검색어 매칭 글자 mark 하이라이트 | S | H |
| 2 | 6 | 세션 핀(고정) 기능 | S | H |
| 3 | 23 | Ctrl+K 전역 세션 점프 팔레트 | S | H |
| 4 | 33 | Ctrl+F → 세션 목록 검색 포커스 | S | H |
| 5 | 34 | 검색창 ESC → 초기화 | S | H |
| 6 | 43 | 새 세션 Ctrl+N 단축키 | S | H |
| 7 | 47 | 세션 카드 hover 시 재개 아이콘 버튼 | S | H |
| 8 | 55 | 필터 상태 + 검색어 AND 조건 | S | H |
| 9 | 57 | 헤더 cwd 경로 클릭 → 파일 탐색기 | S | H |
| 10 | 63 | 세션 제목 헤더 inline rename | S | H |
| 11 | 64 | 헤더 상태 클릭 → 세션 일시정지/재개 | M | H |
| 12 | 65 | 메시지 bubble hover → 액션 툴바 | S | H |
| 13 | 66 | 복사 버튼 체크 아이콘 피드백 | S | H |
| 14 | 67 | 코드 블록 syntax highlight | M | H |
| 15 | 68 | 코드 블록 언어 배지 + 복사 버튼 | S | H |
| 16 | 71 | 메시지 내 파일 경로 클릭 → 탐색기 | S | H |
| 17 | 72 | 메시지 내 URL 자동 하이퍼링크 | S | H |
| 18 | 74 | tool_use 기본 접힘 + 클릭 펼치기 | S | H |
| 19 | 76 | tool_result 에러 시 빨간 border 강조 | S | H |
| 20 | 79 | 메시지 전문 검색 Ctrl+F | M | H |
| 21 | 80 | 검색 히트 prev/next 탐색 | S | H |
| 22 | 85 | 메시지 재생성 버튼 | M | H |
| 23 | 86 | user 메시지 편집 버튼 | M | H |
| 24 | 89 | 컨텍스트 윈도우 사용률 프로그레스 바 | S | H |
| 25 | 90 | 컨텍스트 80% 초과 경고 | S | H |
| 26 | 92 | 스크롤 맨 아래로 FAB 버튼 | S | H |
| 27 | 93 | 새 메시지 알림 배너 | S | H |
| 28 | 94 | 세션 상세 뷰 모드 전환 (Verbose/Normal/Summary) | M | H |
| 29 | 101 | 스트리밍 중 취소 버튼 (Esc) | S | H |
| 30 | 104 | 메시지 bubble 텍스트 선택 지원 | S | H |
| 31 | 112 | 입력창 자동 높이 조절 | S | H |
| 32 | 113 | Shift+Enter → 줄바꿈 | S | H |
| 33 | 114 | Ctrl+Enter → 전송 | S | H |
| 34 | 117 | 입력 드래프트 자동 저장 | S | H |
| 35 | 118 | 드래그 앤 드롭 파일 첨부 | M | H |
| 36 | 119 | 클립보드 이미지 붙여넣기 | S | H |
| 37 | 120 | 파일 첨부 썸네일 미리보기 | S | H |
| 38 | 121 | 첨부 파일 제거 X 버튼 | S | H |
| 39 | 124 | 슬래시 명령어 팝업 키보드 탐색 | S | H |
| 40 | 127 | 슬래시 명령어 퍼지 검색 | S | H |
| 41 | 128 | @멘션 파일 참조 | M | H |
| 42 | 135 | 코드 블록 ``` 자동완성 | S | H |
| 43 | 136 | 프롬프트 템플릿 저장/불러오기 | M | H |
| 44 | 145 | 입력창 포커스 단축키 Ctrl+L | S | H |
| 45 | 150 | 입력창 Ctrl+Z / Ctrl+Y | S | H |
| 46 | 152 | 추가 입력 큐잉 기능 | M | H |
| 47 | 153 | 세션 실행 중 입력창 "대기 중" 안내 | S | H |
| 48 | 158 | Esc → 스트리밍 중단 | S | H |
| 49 | 162 | 파일 경로 자동완성 | M | H |
| 50 | 164 | 전역 검색 팔레트 Ctrl+K | S | H |
| 51 | 165 | 세션명 + 메시지 전문 동시 검색 | M | H |
| 52 | 168 | 검색 결과 클릭 → 메시지 스크롤 | M | H |
| 53 | 179 | 검색 키보드 ↑/↓ 탐색 | S | H |
| 54 | 180 | 검색 Esc → 종료 | S | H |
| 55 | 181 | 세션 목록 검색어 하이라이트 | S | H |
| 56 | 182 | 메시지 내 검색어 하이라이트 | M | H |
| 57 | 188 | 검색 팔레트 최근 방문 세션 Quick Switch | S | H |
| 58 | 190 | 명령어 팔레트 퍼지 매칭 | S | H |
| 59 | 201 | 검색 실시간 결과 200ms debounce | S | H |
| 60 | 206 | 단축키 목록 패널 Ctrl+? | S | H |
| 61 | 209 | Ctrl+Tab 세션 순환 | S | H |
| 62 | 213 | Ctrl+N 새 세션 | S | H |
| 63 | 219 | Ctrl+F 현재 세션 메시지 검색 | S | H |
| 64 | 220 | F6 사이드바 ↔ 패널 포커스 이동 | S | H |
| 65 | 221 | Ctrl+, 설정 열기 | S | H |
| 66 | 224 | Ctrl+Shift+K AI 명령어 팔레트 | S | H |
| 67 | 226 | Ctrl+Shift+P 전체 명령 팔레트 | S | H |
| 68 | 227 | Escape → 팝업 닫기 | S | H |
| 69 | 235 | Tab 논리적 포커스 이동 | S | H |
| 70 | 237 | 모든 기능 키보드 접근 가능 | M | H |
| 71 | 238 | 포커스 시각적 표시 항상 표시 | S | H |
| 72 | 249 | Ctrl+Z 세션 삭제 취소 | M | H |
| 73 | 253 | 세션 완료 데스크탑 알림 | S | H |
| 74 | 254 | 세션 에러 데스크탑 알림 | S | H |
| 75 | 255 | 알림 클릭 → 앱 포커스 + 세션 이동 | S | H |
| 76 | 259 | 시스템 트레이 아이콘 | M | H |
| 77 | 260 | 트레이 우클릭 → 새 세션 | M | H |
| 78 | 261 | 트레이 아이콘 뱃지 | S | H |
| 79 | 262 | 태스크바 뱃지 | S | H |
| 80 | 267 | 세션 카드 에러 뱃지 | S | H |
| 81 | 279 | 오프라인 상태 감지 배너 | M | H |
| 82 | 280 | 오프라인→온라인 자동 재연결 | M | H |
| 83 | 284 | 권한 요청 허용/거부 팝업 | S | H |
| 84 | 285 | 권한 요청 내용 상세 표시 | S | H |
| 85 | 291 | 다크/라이트 모드 전환 | M | H |
| 86 | 292 | 시스템 테마 자동 감지 | S | H |
| 87 | 297 | 폰트 크기 글로벌 설정 | S | H |
| 88 | 308 | 애니메이션 prefers-reduced-motion | S | H |
| 89 | 321 | HiDPI / Retina 자동 대응 | S | H |
| 90 | 343 | 패널 숨기기 토글 (사이드바 숨기기) | S | H |
| 91 | 353 | 마지막 레이아웃 상태 저장 | S | H |
| 92 | 359 | 창 크기/위치 기억 | S | H |
| 93 | 364 | 모든 버튼 aria-label | S | H |
| 94 | 366 | 스트리밍 aria-live="polite" | S | H |
| 95 | 369 | 다이얼로그 포커스 트랩 | S | H |
| 96 | 370 | Esc → 팝업 닫기 + 포커스 복원 | S | H |
| 97 | 372 | 고포커스 표시 outline | S | H |
| 98 | 375 | 색상+아이콘 병용 상태 표시 | S | H |
| 99 | 407 | 날짜 형식 로케일 자동 적용 | S | H |
| 100 | 466 | React Error Boundary 전체 적용 | S | H |

---

## 큰 작업 (L) — 별도 PR 추천 — 50개

| # | 항목 | 임팩트 | 비고 |
|---|---|---|---|
| L-1 | 22 — 세션 내부 메시지 전문 검색 | H | 검색 인덱스 구축 필요 |
| L-2 | 25 — 세션 그룹(폴더) 시스템 | H | 데이터 모델 변경 필요 |
| L-3 | 83 — 메시지 분기(branch) | H | 세션 분기 로직 |
| L-4 | 84 — 메시지부터 재실행 (fork) | H | 세션 복제 + 히스토리 |
| L-5 | 148 — 음성 입력 (Web Speech API) | M | 플랫폼 권한 필요 |
| L-6 | 169 — 검색 연산자 지원 | M | 검색 파서 구현 |
| L-7 | 208 — 단축키 사용자 커스터마이징 | M | 키 바인딩 시스템 |
| L-8 | 295 — 사용자 정의 색상 테마 | M | CSS 변수 시스템 |
| L-9 | 326 — 분할 패널 (나란히 두 세션) | H | 레이아웃 엔진 재설계 |
| L-10 | 328 — 4분할 그리드 | M | 패널 그리드 시스템 |
| L-11 | 330 — 세션 탭 형식 | H | 탭 컴포넌트 시스템 |
| L-12 | 334 — 탭 별도 창으로 꺼내기 | M | Electron 다중 창 |
| L-13 | 335 — 멀티 윈도우 지원 | M | Electron IPC 확장 |
| L-14 | 338 — 메시지 + 터미널 통합 뷰 | H | 통합 패널 시스템 |
| L-15 | 339 — 파일 브라우저 사이드패널 | M | 파일 트리 컴포넌트 |
| L-16 | 340 — diff 뷰어 패널 | H | diff 렌더링 엔진 |
| L-17 | 341 — 사이드 채팅 패널 | H | 세션 분기 + 패널 |
| L-18 | 355 — 워크스페이스 개념 | H | 데이터 모델 재설계 |
| L-19 | 357 — 워크스페이스 내보내기/가져오기 | N | 직렬화 포맷 |
| L-20 | 411 — RTL 언어 지원 | M | CSS logical properties |
| L-21 | 422 — 한국어 초성 검색 | H | 검색 엔진 확장 |
| L-22 | 423 — 한국어 자음/모음 부분 일치 | H | 검색 엔진 확장 |
| L-23 | 432 — 한국어 TTS 스크린 리더 | M | TTS 엔진 통합 |
| L-24 | 435 — 언어 추가 플러그인 구조 | N | 플러그인 시스템 |
| L-25 | 456 — 설정 클라우드 동기화 | M | 클라우드 백엔드 |
| L-26 | 463 — 앱 설치 크기 최적화 | M | 빌드 파이프라인 |
| L-27 | 496 — 계정 로그인/로그아웃 | M | 인증 시스템 |
| L-28 | 497 — 세션 공유 링크 | M | URL 공유 시스템 |
| L-29 | 503 — 세션 스크린샷 캡처 | M | 렌더링 캡처 |
| L-30 | 504 — GitHub 이슈 자동 붙여넣기 | M | GitHub API 통합 |
| L-31 | 505 — PR 설명에 세션 요약 삽입 | M | GitHub API 통합 |
| L-32 | 506 — 팀 공유 세션 그룹 | M | 협업 서버 필요 |
| L-33 | 516 — 세션 요약 자동 생성 | H | AI 요약 API 호출 |
| L-34 | 266 — CI/CD 상태 연동 알림 | M | GitHub API webhooks |
| L-35 | 129 — 파일 탐색 @멘션 팝업 | H | 파일 인덱서 |
| L-36 | 151 — 입력 체크포인트 설정 | M | 상태 스냅샷 |
| L-37 | 9 — 태그(Label) 시스템 | H | DB 스키마 변경 |
| L-38 | 162 — 파일 경로 자동완성 | H | 파일 시스템 탐색 |
| L-39 | 346 — 세션 비교 뷰 | N | diff UI |
| L-40 | 396 — 접근성 설정 패널 | H | 설정 확장 |
| L-41 | 398 — axe-core CI 통합 | H | CI 파이프라인 |
| L-42 | 315 — 커뮤니티 테마 갤러리 | N | 마켓플레이스 서버 |
| L-43 | 337 — 미니 모드 위젯 | M | Electron BrowserView |
| L-44 | 149 — 음성 입력 실시간 미리보기 | M | Web Speech API |
| L-45 | 507 — 세션 버전 기록 | N | 히스토리 DB |
| L-46 | 508 — 세션 diff 비교 | N | diff 서비스 |
| L-47 | 510 — Slack 인테그레이션 내보내기 | N | Slack API |
| L-48 | 19 — 세션 일괄 삭제 멀티선택 | H | 멀티셀렉트 + 확인 |
| L-49 | 83 — 세션 분기 브랜치 UI | H | 트리 뷰 |
| L-50 | 22 — 메시지 검색 인덱스 서비스 | H | 별도 검색 서비스 |

---

## 출처 목록

| 출처 | URL/참고 |
|---|---|
| Claude Code Desktop 재설계 (2026) | https://claude.com/blog/claude-code-desktop-redesign |
| Claude Code Desktop 상세 가이드 | https://miraflow.ai/blog/claude-code-desktop-redesign-parallel-sessions-routines-workspace-guide |
| VS Code Copilot Chat 문서 | https://code.visualstudio.com/docs/copilot/chat/copilot-chat |
| Slack 키보드 단축키 | https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts |
| Slack 접근성 | https://slack.com/accessibility |
| AI Chat UI Best Practices 2026 | https://thefrontkit.com/blogs/ai-chat-ui-best-practices |
| Warp Terminal | https://www.warp.dev/ |
| WCAG 2.1 키보드 접근성 | https://testparty.ai/blog/keyboard-accessibility-guide |
| 명령 팔레트 UX 패턴 | https://medium.com/design-bootcamp/command-palette-ux-patterns-1-d6b6e68f30c1 |
| AI 채팅 UI 비교 2025 | https://intuitionlabs.ai/articles/conversational-ai-ui-comparison-2025 |
| Electron Tray 문서 | https://www.electronjs.org/docs/latest/api/tray |
| i18n 날짜 형식 | https://phrase.com/blog/posts/date-time-localization/ |
| NN/G 드래그 앤 드롭 UX | https://www.nngroup.com/articles/drag-drop/ |
| 다크 모드 UX best practices | https://blog.logrocket.com/ux-design/dark-mode-ui-design-best-practices-and-examples/ |
| Superhuman 명령 팔레트 | https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/ |
