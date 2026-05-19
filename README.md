# AgentView

Claude Code 의 백그라운드 에이전트를 한글이 깨지지 않는 데스크톱 UI 로 관리하는 Electron 앱.

## 주요 기능

- **CLI 와 1:1 동기화** — `~/.claude/jobs/<short>/state.json` 을 직접 읽어 `claude agents` 의 목록과 정확히 일치
- **새 작업 dispatch** — daemon 채널로 새 `kind:"bg"` 워커 생성 (1.5–5 초)
- **AskUserQuestion 응답 UI** — 입력창 위 sticky 패널로 옵션 클릭 → 즉시 전송
- **inline 권한 prompt** — TUI 의 "Do you want to ...?" 를 모달로 surfacing
- **컨텍스트 사용량 도넛** — 헤더 도넛 클릭 시 현재 토큰 / max context / 모델 표시
- **권한 모드 선택** — `default / acceptEdits / bypassPermissions / plan` (Max 계정만 bypassPermissions)
- **자동 업데이트** — GitHub Releases 폴링, 1-클릭 설치 + 재시작
- **마우스 뒤로/앞으로** — XButton1 / XButton2 로 dashboard ↔ detail 이동
- **세션 이름 변경** — AgentView 에서 변경하면 `claude agents` CLI 에서도 동일하게 표시
- **상태 색 구분** — 실행 중(초록) / 대기(파랑) / 완료(청록) / 종료(회색)

## 설치

[Releases](https://github.com/chdnl0420-svg/AgentView-Release/releases/latest) 에서 최신 `AgentView-Setup-x.y.z.exe` 다운로드 → 실행.

설치 후 바탕화면 바로가기가 자동 생성됩니다.

## 빠른 시작

1. 앱을 처음 실행하면 6 단계 튜토리얼이 표시됩니다.
2. 하단 입력창에 작업을 입력합니다.
3. 권한 모드를 선택합니다 (기본: 편집만 자동).
4. **Ctrl + Enter** 또는 우측 **▶ 새 작업 시작** 을 누릅니다.
5. 새 에이전트가 dashboard 에 카드로 나타납니다.
6. 카드를 클릭해 세션 detail 에 진입, 추가 메시지를 보내거나 권한 prompt 에 답할 수 있습니다.

## 단축키

| 조작 | 동작 |
|---|---|
| Ctrl + Enter | 메시지 전송 (또는 새 작업 시작) |
| Esc | detail view 닫기 (dashboard 로) |
| 마우스 XButton1 (뒤로) | dashboard 복귀 |
| 마우스 XButton2 (앞으로) | 마지막 detail view 복귀 |
| ↑ / ↓ (입력창에서) | 이전 전송 히스토리 탐색 |
| 우클릭 (입력창) | 잘라내기 / 복사 / 붙여넣기 / 모두 선택 |

## 권한 모드

| 라벨 | claude flag | 설명 |
|---|---|---|
| 기본 확인 | `default` | 매 도구마다 사용자 확인 |
| 편집만 자동 | `acceptEdits` | 파일 편집은 자동, 그 외 도구는 확인 |
| 전체 허용 (Max 전용) | `bypassPermissions` | 모든 도구 자동 실행 — Max 계정 필요 |
| 계획 모드 | `plan` | 읽기 전용, 변경 없음 |

권한이 필요한 동작이 발생하면 AgentView 상단에 **권한 요청** 카드가 떠 옵션을 클릭으로 응답할 수 있습니다.

## 시스템 요구사항

- Windows 10/11 (x64)
- `claude` CLI 가 설치되어 있고 `~/.claude` 에 데몬이 실행 중
- 디스크 약 200MB

## 빌드 (개발자)

```bash
npm install
npm run build
npm run build:win   # NSIS 인스톨러 생성
```

## 라이선스

MIT
