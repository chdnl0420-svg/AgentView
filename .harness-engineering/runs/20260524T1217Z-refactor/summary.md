# Refactor summary — 20260524T1217Z-refactor

## 한눈에

| 항목 | 값 |
|---|---|
| 회차 | 20260524T1217Z-refactor |
| 목표 | AgentView (Electron + React + TS) 모놀리스 파일 구조 분리 |
| 변경 파일 | 50 (추가 47 / 수정 2 / 삭제 1) |
| 모두 400줄 hard cap 이하 | ✓ |
| typecheck / build | green / green |
| codex 외부 검토 | **LGTM** (신규 결함 0건) |
| customer 회귀 | 없음 (UX 변화 없음 = 의도된 결과) |

## 분리 전 → 분리 후

| 파일 | before | after |
|---|---|---|
| `src/main/ipc.ts` | 772줄 단일 파일 | `src/main/ipc/` 9개 모듈 (최대 332줄) |
| `src/renderer/App.tsx` | 957줄 단일 컴포넌트 | App.tsx 354줄 + SessionsGrid 169줄 + 11개 state hook + 2개 lib |
| `src/renderer/styles/global.css` | 2335줄 단일 stylesheet | global.css 63줄 (@import 목록) + parts/ 27개 |

## 분리 구조

### main IPC (9 modules)

```
src/main/ipc/
├── index.ts          # registerIpc + shutdownIpc + 공유 runner/liveWatcher
├── broadcast.ts      # broadcast() helper
├── loaders.ts        # loadCommands/loadAgents + handlers
├── sessions.ts       # 18 Sessions* handlers + cancel loop + outputTails
├── picker.ts         # PickDirectory/PickFiles/SavePastedImage
├── workspace.ts      # Workspace* (list/read/exportReport/openRoot)
├── filePreview.ts    # FilePreview + previewFileForRenderer + 확장자 상수
├── windowChrome.ts   # Window*/Options*/Shell* (OS 연동)
└── misc.ts           # Git*/Updater*/AppVersion/UsageFetch/ClaudeStatus
```

### Renderer state (11 hooks + 2 helpers + 1 component)

```
src/renderer/
├── App.tsx                              # 354L — composition + 3 view branch
├── components/SessionsGrid.tsx          # 169L — 카드 그리드 + 필터 + 삭제 UI
├── lib/sessionFilters.ts                # classify + isEmptyDeadSession + SessionFilter type
├── lib/pendingSession.ts                # PendingSession type + makeTempId + pendingToBgSession + PENDING_* 상수
└── state/
    ├── useSessionScan.ts                # scan + reloadSessions + sessions watcher + flash
    ├── useAgentsAndRunning.ts           # agents/running + watchers
    ├── usePendingSessions.ts            # pending + 2-stage cleanup
    ├── useDrafts.ts                     # newDraft + resume drafts + 영속화
    ├── useQueues.ts                     # queue per session
    ├── useRenames.ts                    # renames + storage focus listener + backend change
    ├── useClaudeStatus.ts               # claudeStatus 30s 폴링
    ├── useClock.ts                      # 1Hz now state
    ├── useBackForwardNav.ts             # Esc + mouse XButton1/2 → selectedId
    ├── useRunEventsToast.ts             # run-event 구독 + toast + auto-dismiss
    ├── useDeleteMode.ts                 # deleteMode + selectedForDelete + performBulkDelete
    └── useViewMode.ts                   # viewMode + viewModeRef + toggle
```

### Renderer styles (27 parts)

```
src/renderer/styles/
├── global.css        # 63L — @import 목록 (composition root)
└── parts/
    ├── tokens.css            ─ :root CSS vars
    ├── base.css              ─ *, user-select, html/body, scrollbar, button, input, select option
    ├── layout.css            ─ .app shell / .app.no-chrome flex column
    ├── topbar.css            ─ .topbar / .brand / .tabs / .live-pill / .btn
    ├── dashboard.css         ─ .dashboard / .grid-wrap / .section-head / .cards / .session-card / .status-tag
    ├── detail.css            ─ .detail-page / .detail-head / .detail-body / .toast / .thinking-*
    ├── conversation.css      ─ .conv / .msg / .bubble / 첨부 그룹 / queued
    ├── tool-message.css      ─ .bubble.tool-bubble 접기 (header/input/output) + .ask-q
    ├── attach-banner.css     ─ .attach-hint / .external-banner
    ├── attachments.css       ─ .attachment-strip / .att-chip (composer)
    ├── slash-popup.css       ─ .slash-popup / .slash-item
    ├── input-bar.css         ─ .input-bar composer
    ├── markdown-stream.css   ─ .stream + .markdown 렌더링
    ├── tool-group.css        ─ .tool-group 접기
    ├── ask-buttons.css       ─ .ask-options li + button.ask-option-btn
    ├── permission.css        ─ .msg.permission + .permission-*
    ├── ask-panel.css         ─ .ask-panel slide-in
    ├── meta-controls.css     ─ .max-account-toggle / .context-window
    ├── update-banner.css     ─ .update-banner
    ├── tutorial.css          ─ .tutorial-modal
    ├── ask-panel-extras.css  ─ .ask-panel multi-select
    ├── context-popup.css     ─ .context-popup
    ├── cli-status.css        ─ .cli-status-bar
    ├── delete-mode.css       ─ .session-card delete-mode 체크박스
    ├── code-block.css        ─ .markdown pre 코드블록 copy 버튼
    ├── icon-button.css       ─ .btn.sm.icon-only
    └── single-mode.css       ─ .dashboard.single + .session-list + .single-workspace + view-mode toggle
```

## 검증 결과

| 단계 | 결과 |
|---|---|
| step 1 — detect | 외부 의존성 0, 모놀리스 3개 식별 |
| step 2 — domain (adapt) | Bounded Context = main IPC / renderer state / renderer styles |
| step 3 — TDD (characterization) | 분리 전후 typecheck/build 통과, layout 측정 동일 |
| step 4 — QA | typecheck green, build green, 모든 파일 400 이하 |
| step 5 — codex review | **LGTM** (HIGH/MEDIUM 모두 pre-existing) |
| step 6 — customer | 5 시나리오 회귀 없음 (refactor 의도된 invisibility) |
| step 7 — audit | PASS, 자가 수정 0회 |

## 회차 외 ADR (별도 회차 권장)

1. **`usePendingSessions.ts` stage-1 cleanup effect 의 `[scan, pending]` dep array** — 함수형 setPending 사용에도 불구하고 pending 변경 시 effect 재실행 → 피드백 루프 잠재. **원본 보존**이라 본 회차 미수정.
2. **`DEFAULT_CWD` 하드코딩 (`D:\\Project\\VisualAgents`)** — 다른 개발 환경 즉시 오작동. 사용자 home 또는 마지막 cwd persist 권장.
3. **본 회차 200줄 권장 초과 5 파일** — App.tsx (354), ipc/sessions.ts (332), styles/conversation.css (323), detail.css (255), single-mode.css (241). 응집도 보존 위해 의도적 유지. 향후 React Testing Library 도입과 함께 재분리 검토.
4. **단위 테스트 없음** — characterization 으로 대체. Vitest/RTL 도입 권장.

## 산출물

- 도메인 모델 (adapt): `02-domain/domain-model.md`
- QA 보고: `04-qa/report.md`
- Codex 리뷰: `05-review/result.md` + `05-review/file-list.md`
- Customer 결과: `06-customer/report.md`
- Audit findings: `07-audit/findings.md`
- 진행 log: `log.md`
- 본 보고서 HTML: `summary.html`

## 커밋 (step 9 예정)

- 메시지 (자연어): "refactor: split monolithic ipc.ts / App.tsx / global.css into per-module files (all <400 lines)"
- 포함 파일: 위 50개 (`src/main/ipc/*`, `src/renderer/{App.tsx,components/SessionsGrid.tsx,lib/{sessionFilters,pendingSession}.ts,state/*,styles/{global.css,parts/*.css}}`, `scripts/ui-audit/split-global-css.mjs`) + `.harness-engineering/runs/20260524T1217Z-refactor/**`.
- 제외: 사용자가 작업 중인 untracked 변경 (`package.json`, `scripts/_*.cjs` 등) — 손대지 않음.
- push: 안 함 (사람이 직접).
