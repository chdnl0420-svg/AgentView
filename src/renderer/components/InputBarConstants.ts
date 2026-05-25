// Constants and persistence helpers used by InputBar. Extracted so the
// component file is no longer a kitchen sink of dropdown options +
// localStorage keys + tiny validators.

import type { PermissionMode, SessionBackend } from '@shared/types';
import { loadJSON } from '../lib/persistence';

export const MODELS = [
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' }
];
export const DEFAULT_MODEL = 'sonnet';

export const LAST_MODEL_KEY = 'lastModel';
export const LAST_CWD_KEY = 'lastCwd';
export const WT_ENABLED_KEY = 'wt.enabled';
export const WT_BASE_BRANCH_KEY = 'wt.baseBranch';
export const LAST_BACKEND_KEY = 'lastBackend';
export const LAST_PERM_KEY = 'lastPermissionMode';
export const NEW_BRANCH_SENTINEL = '__new_branch__';

// AVD is the only active backend. Legacy `claude` (Strategy A→B in
// sessionRunner) and `codex` are paused until AVD is feature-complete;
// when codex is re-enabled, restore its entry here and re-activate the
// codex branch in routeBackend + createWorkerFactory.
export const BACKENDS: Array<{ value: SessionBackend; label: string; hint: string }> = [
  { value: 'avd', label: 'AVD', hint: 'AgentView 기본 실행 경로' }
];

// Claude permission modes — what claude CLI accepts via --permission-mode.
// 'bypassPermissions' is the user's preferred default (everything auto-runs),
// but we let them pick per-session and remember the last choice.
export const PERMS: Array<{ value: PermissionMode; label: string; hint: string }> = [
  { value: 'bypassPermissions', label: '전체 허용', hint: 'bypassPermissions — 모든 도구 자동 실행' },
  { value: 'acceptEdits',       label: '편집만 자동', hint: 'acceptEdits — 파일 편집만 자동, 그 외 도구는 묻는다' },
  { value: 'default',           label: '기본 확인',   hint: 'default — 매번 확인 prompt' },
  { value: 'plan',              label: '계획 모드',   hint: 'plan — 읽기 전용 (변경 불가)' }
];
export const DEFAULT_PERM: PermissionMode = 'acceptEdits';

export function loadLastPerm(): PermissionMode {
  const v = loadJSON<string>(LAST_PERM_KEY, DEFAULT_PERM);
  if (!PERMS.some((p) => p.value === v)) return DEFAULT_PERM;
  return v as PermissionMode;
}

export function loadLastModel(): string {
  const v = loadJSON<string>(LAST_MODEL_KEY, DEFAULT_MODEL);
  if (v && MODELS.some((m) => m.value === v)) return v;
  return DEFAULT_MODEL;
}

export function loadLastCwd(fallback: string): string {
  const v = loadJSON<string>(LAST_CWD_KEY, '');
  return typeof v === 'string' && v.trim() ? v : fallback;
}

export function loadLastBackend(): SessionBackend {
  const v = loadJSON<string>(LAST_BACKEND_KEY, 'avd');
  return BACKENDS.some((b) => b.value === v) ? (v as SessionBackend) : 'avd';
}

export function isValidBranchName(value: string): boolean {
  const v = value.trim();
  if (!v || v.startsWith('/') || v.endsWith('/') || v.endsWith('.')) return false;
  if (v.includes('..') || v.includes('@{') || v.includes('\\')) return false;
  return !/[\s~^:?*\[\]\x00-\x1f]/.test(v);
}
