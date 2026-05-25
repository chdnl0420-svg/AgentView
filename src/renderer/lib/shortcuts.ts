// Cross-platform keyboard shortcut definitions + helpers.
//
// Owns:
//   - The canonical list of every global / scoped shortcut in the app, with
//     a Korean label so the ShortcutHelp panel can render them.
//   - Platform-aware modifier rendering (Ctrl on Win/Linux, ⌘ on macOS) so
//     the same definition can drive both tooltips and the help modal.
//   - A small `matches(e, accel)` predicate that the global keybind handler
//     in App.tsx uses to decide whether to fire each entry.
//
// The list is intentionally exhaustive so this single file is the source of
// truth for "what shortcuts does AgentView expose?".

export type ShortcutScope = 'global' | 'sidebar' | 'detail' | 'input';

export interface ShortcutDef {
  /** Stable identifier (used as React key + telemetry name). */
  id: string;
  /** Accelerator in normalized form, e.g. "Ctrl+K", "F6", "Alt+1". */
  accel: string;
  /** Korean label shown in the help panel. */
  label: string;
  /** Optional secondary accel (e.g. "Cmd+K" on macOS shows alongside). */
  macAccel?: string;
  scope: ShortcutScope;
  /** Optional category label for grouping in the help panel. */
  group?: string;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/** True when running on macOS — Cmd takes the place of Ctrl. */
export function isMacPlatform(): boolean {
  return isMac;
}

/** Render an accelerator with the platform-appropriate modifier glyphs. */
export function renderAccel(accel: string): string {
  if (!isMac) return accel;
  return accel
    .replace(/\bCtrl\b/g, '⌘')
    .replace(/\bAlt\b/g, '⌥')
    .replace(/\bShift\b/g, '⇧');
}

/** Same as renderAccel but returns the human-readable Ctrl/Cmd dual form. */
export function describeAccel(accel: string): string {
  return renderAccel(accel);
}

/**
 * Test whether a KeyboardEvent matches an accel string like "Ctrl+Shift+K".
 * Treats Ctrl and Cmd interchangeably so a single rule works on both macOS
 * and Windows/Linux. Modifier requirements are exact — Shift in the accel
 * means Shift must be down; absent means Shift must be up.
 */
export function matchesAccel(e: KeyboardEvent, accel: string): boolean {
  const parts = accel.split('+').map((p) => p.trim());
  const key = parts.pop();
  if (!key) return false;
  const wantCtrl = parts.includes('Ctrl') || parts.includes('Cmd');
  const wantShift = parts.includes('Shift');
  const wantAlt = parts.includes('Alt');
  const ctrlDown = e.ctrlKey || e.metaKey;
  if (wantCtrl !== ctrlDown) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  // Function keys + named keys must match exactly (case-insensitive). Single
  // letters match case-insensitively against e.key.
  if (key.length === 1) {
    return e.key.toLowerCase() === key.toLowerCase();
  }
  return e.key === key;
}

/**
 * Canonical shortcut list. Order in each group is intentional — the help
 * panel renders these top-to-bottom.
 */
export const SHORTCUTS: ShortcutDef[] = [
  // --- 전역 ---
  { id: 'new-session', accel: 'Ctrl+N', label: '새 작업 시작', scope: 'global', group: '전역' },
  { id: 'cmd-palette', accel: 'Ctrl+K', label: '명령 팔레트 / 세션 점프', scope: 'global', group: '전역' },
  { id: 'cmd-palette-2', accel: 'Ctrl+Shift+P', label: '명령 팔레트 (대체 단축키)', scope: 'global', group: '전역' },
  { id: 'shortcut-help', accel: 'Ctrl+/', label: '단축키 도움말', scope: 'global', group: '전역' },
  { id: 'shortcut-help-2', accel: 'F1', label: '단축키 도움말 (대체)', scope: 'global', group: '전역' },
  { id: 'options', accel: 'Ctrl+,', label: '옵션 패널', scope: 'global', group: '전역' },
  { id: 'fullscreen', accel: 'F11', label: '전체화면 토글', scope: 'global', group: '전역' },
  { id: 'close-session', accel: 'Ctrl+W', label: '현재 세션 닫기 (대시보드로)', scope: 'global', group: '전역' },
  { id: 'recent-toggle', accel: 'Ctrl+J', label: '최근 세션 빠른 전환', scope: 'global', group: '전역' },
  { id: 'next-session', accel: 'Ctrl+Tab', label: '다음 세션', scope: 'global', group: '전역' },
  { id: 'prev-session', accel: 'Ctrl+Shift+Tab', label: '이전 세션', scope: 'global', group: '전역' },
  { id: 'session-1', accel: 'Ctrl+1', label: '1번 세션으로', scope: 'global', group: '전역' },
  { id: 'session-9', accel: 'Ctrl+9', label: '9번 세션으로 (Ctrl+1..9)', scope: 'global', group: '전역' },
  // --- 포커스 이동 ---
  { id: 'focus-sidebar', accel: 'Alt+1', label: '사이드바 포커스', scope: 'global', group: '포커스' },
  { id: 'focus-workspace', accel: 'Alt+2', label: '메시지 영역 포커스', scope: 'global', group: '포커스' },
  { id: 'focus-input', accel: 'Alt+3', label: '입력창 포커스', scope: 'global', group: '포커스' },
  { id: 'focus-input-2', accel: 'Ctrl+L', label: '입력창 포커스 (대체)', scope: 'global', group: '포커스' },
  { id: 'f6-cycle', accel: 'F6', label: '사이드바 ↔ 워크스페이스 토글', scope: 'global', group: '포커스' },
  // --- 메시지 영역 ---
  { id: 'find-in-session', accel: 'Ctrl+F', label: '세션 내 메시지 검색', scope: 'detail', group: '메시지' },
  { id: 'find-next', accel: 'F3', label: '다음 검색 결과', scope: 'detail', group: '메시지' },
  { id: 'find-prev', accel: 'Shift+F3', label: '이전 검색 결과', scope: 'detail', group: '메시지' },
  { id: 'scroll-top', accel: 'Ctrl+Home', label: '메시지 맨 위로', scope: 'detail', group: '메시지' },
  { id: 'scroll-bottom', accel: 'Ctrl+End', label: '메시지 맨 아래로', scope: 'detail', group: '메시지' },
  // --- 사이드바 ---
  { id: 'focus-search', accel: 'Ctrl+K', label: '세션 검색 (사이드바 포커스 시)', scope: 'sidebar', group: '사이드바' },
  { id: 'session-up', accel: 'ArrowUp', label: '위 세션 선택', scope: 'sidebar', group: '사이드바' },
  { id: 'session-down', accel: 'ArrowDown', label: '아래 세션 선택', scope: 'sidebar', group: '사이드바' },
  // --- 입력창 ---
  { id: 'send', accel: 'Ctrl+Enter', label: '메시지 전송', scope: 'input', group: '입력' },
  { id: 'newline', accel: 'Shift+Enter', label: '줄바꿈', scope: 'input', group: '입력' },
  { id: 'history-prev', accel: 'ArrowUp', label: '이전 메시지 불러오기 (첫 줄에서)', scope: 'input', group: '입력' },
  { id: 'history-next', accel: 'ArrowDown', label: '다음 메시지 불러오기 (마지막 줄에서)', scope: 'input', group: '입력' },
  { id: 'cancel-stream', accel: 'Escape', label: '스트리밍 중단', scope: 'input', group: '입력' },
  { id: 'attach-file', accel: 'Ctrl+P', label: '파일 첨부 picker', scope: 'input', group: '입력' },
];

/** Returns shortcuts filtered by group, for the help panel. */
export function shortcutsByGroup(): Record<string, ShortcutDef[]> {
  const out: Record<string, ShortcutDef[]> = {};
  for (const s of SHORTCUTS) {
    const g = s.group ?? '기타';
    if (!out[g]) out[g] = [];
    out[g].push(s);
  }
  return out;
}
