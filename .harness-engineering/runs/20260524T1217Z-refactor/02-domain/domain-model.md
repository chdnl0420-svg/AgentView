# 도메인 (모듈 경계) 모델 — 리팩토링 adapt

본 회차는 신규 도메인이 아닌 기존 모놀리스 **분해**. DDD 용어를 다음과 같이 매핑한다.

| DDD 개념 | 본 회차 매핑 |
|---|---|
| Bounded Context | Electron process boundary (main / renderer) + 렌더러 내부의 **state vs view vs style** 책임 boundary |
| Aggregate | 응집 모듈 (한 책임 단위) |
| Entity | 모듈 내 class / object |
| VO | 인터페이스·타입 (이미 `@shared/types` 에 정의됨, 변경 안 함) |
| Domain Event | IPC channel 메시지 (이미 `@shared/ipc-contracts` 정의, 변경 안 함) |
| Command | IPC handler invocation |
| Repository | 외부 어댑터 (file system, daemon, watcher) — 이미 별도 모듈 (`liveWatcher`, `sessionScanner` 등) |
| Application Service | renderer 의 use-case 훅 (예: `useSessionScan`) |

---

## Bounded Context 1: main process IPC

**파일 분해 대상**: `src/main/ipc.ts` (772 lines) → `src/main/ipc/*` (7 modules)

| Aggregate (응집 모듈) | 책임 | 산출 파일 |
|---|---|---|
| ipc composition root | `registerIpc()` + `shutdownIpc()` 만. 각 sub-registrar 호출 | `src/main/ipc/index.ts` |
| broadcast | `broadcast()` helper | `src/main/ipc/broadcast.ts` |
| loaders | `loadCommands()` + `loadAgents()` + `AgentsList`/`CommandsList` 핸들러 | `src/main/ipc/loaders.ts` |
| sessions | 모든 Sessions* 핸들러 + cancel loop + outputTails + runningList | `src/main/ipc/sessions.ts` |
| picker | PickDirectory, PickFiles, SavePastedImage | `src/main/ipc/picker.ts` |
| workspace | Workspace* 핸들러 | `src/main/ipc/workspace.ts` |
| filePreview | FilePreview 핸들러 + 헬퍼 + extension 상수 | `src/main/ipc/filePreview.ts` |
| windowChrome | Window* + Options* + Shell* (단순 OS 연동) | `src/main/ipc/windowChrome.ts` |
| misc | Git, Updater, ClaudeStatus, AppVersion, UsageFetch | `src/main/ipc/misc.ts` |

**예상 줄 수**: 각 80~250 줄 (모두 400 hard cap 이하).

---

## Bounded Context 2: renderer state (React)

**파일 분해 대상**: `src/renderer/App.tsx` (957 lines) → `src/renderer/App.tsx` (≤250) + `src/renderer/state/*` + `src/renderer/components/SessionsGrid.tsx`

| Aggregate (응집 훅·모듈) | 책임 | 산출 파일 |
|---|---|---|
| App composition | 3 view branch 라우팅 + JSX 조립만 | `src/renderer/App.tsx` |
| SessionsGrid | 카드 그리드 + 필터 탭 + 삭제 모드 UI (현 App.tsx 안 sub-component) | `src/renderer/components/SessionsGrid.tsx` |
| useSessionScan | scan + reloadSessions + sessions watcher + onSessionUpdated + flash | `src/renderer/state/useSessionScan.ts` |
| usePendingSessions | pending state + makeTempId + pendingToBgSession + 자동 정리 로직 | `src/renderer/state/usePendingSessions.ts` |
| useAgentsAndRunning | agents/running state + 두 watcher | `src/renderer/state/useAgentsAndRunning.ts` |
| useDrafts | newDraft + resume drafts + 영속화 | `src/renderer/state/useDrafts.ts` |
| useQueues | queue state + setQueue | `src/renderer/state/useQueues.ts` |
| useRenames | renames + storage focus listener + backend-changed event | `src/renderer/state/useRenames.ts` |
| useClaudeStatus | claudeStatus 폴링 | `src/renderer/state/useClaudeStatus.ts` |
| useDeleteMode | deleteMode + selectedForDelete + performBulkDelete | `src/renderer/state/useDeleteMode.ts` |
| useBackForwardNav | Esc + mouse XButton1/2 → selectedId | `src/renderer/state/useBackForwardNav.ts` |
| useRunEventsToast | run-event 구독 + toast state + auto-dismiss | `src/renderer/state/useRunEventsToast.ts` |
| sessionFilters | classify + isEmptyDeadSession + filter 상수 | `src/renderer/lib/sessionFilters.ts` |
| pendingSession (type) | PendingSession interface + 헬퍼 (makeTempId, pendingToBgSession) | `src/renderer/lib/pendingSession.ts` |

**예상 줄 수**: 각 50~200 줄.

---

## Bounded Context 3: renderer styles

**파일 분해 대상**: `src/renderer/styles/global.css` (2335 lines) → `src/renderer/styles/global.css` (≤90 — tokens + base) + `src/renderer/styles/parts/*.css` (10+ files), 모두 global.css 에서 `@import` 로 묶음.

| 파트 | 책임 | 산출 파일 |
|---|---|---|
| tokens | `:root` CSS vars | `parts/tokens.css` |
| reset | html/body/scrollbar/select-option | `parts/reset.css` |
| user-select | user-select 화이트리스트 | `parts/select-rules.css` |
| topbar | .topbar / .brand / .tabs / .live-pill / .btn | `parts/topbar.css` |
| layout | .app / .dashboard / .grid-wrap / .section-head / .cards | `parts/layout.css` |
| cards | .session-card / .card-* / .status-tag / .empty-grid | `parts/cards.css` |
| detail | .detail-page / .detail-head / .detail-body / .empty-detail | `parts/detail.css` |
| toast | .toast / .thinking-* | `parts/toast.css` |
| markdown | .markdown * / .md-table | `parts/markdown.css` |
| conversation | .conv / .msg / .bubble / .role-line | `parts/conversation.css` |
| tool | .bubble.tool-bubble / .tool-group / .tool-header | `parts/tool.css` |
| attachments | .att-chip / .msg-attachments / .att-group / .attach-hint / .external-banner | `parts/attachments.css` |
| slash-popup | .slash-popup / .slash-item | `parts/slash-popup.css` |
| input-bar | .input-bar / .input-controls / .input-row / .input-send / .wt-controls | `parts/input-bar.css` |
| permissions | .permission-* / .ask-panel | `parts/permissions.css` |
| job-stream | .stream | `parts/job-stream.css` |
| single-mode | .dashboard.single / .session-list / .single-workspace / .view-mode-* / .cards override | `parts/single-mode.css` |

**`global.css` 최종 형태**:
```css
@import './parts/tokens.css';
@import './parts/reset.css';
@import './parts/select-rules.css';
@import './parts/topbar.css';
@import './parts/layout.css';
@import './parts/cards.css';
@import './parts/detail.css';
@import './parts/toast.css';
@import './parts/markdown.css';
@import './parts/conversation.css';
@import './parts/tool.css';
@import './parts/attachments.css';
@import './parts/slash-popup.css';
@import './parts/input-bar.css';
@import './parts/permissions.css';
@import './parts/job-stream.css';
@import './parts/single-mode.css';
```

각 파트 80~300 줄.

---

## 외부 의존성·인프라

- **변경 없음** — 본 회차는 IPC 계약·도메인 인터페이스를 보존한다.
- `@shared/types`, `@shared/ipc-contracts` 무수정.
- preload, daemon, watcher 모듈 무수정.

## CQRS / Event Sourcing ADR

- **적용 안 함** (회차 scope 외). `cqrs-es-warning.md` 에 사유 명시. 본 회차는 모듈 경계만 정리.

## 검증 게이트

- [x] Bounded Context 식별 (main IPC / renderer state / renderer styles)
- [x] Aggregate 별 책임 분리 명시
- [x] 객체별 파일 분리 계획 수립
- [x] 외부 의존성 변경 없음 확인
- [x] UI ↔ 기능 분리 — renderer state hooks 가 logic, App.tsx + SessionsGrid 가 view
