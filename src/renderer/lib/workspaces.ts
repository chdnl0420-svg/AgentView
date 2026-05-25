// Workspace layer — researcher items #355 / #356.
//
// A workspace is a named container that owns its own session subset. The
// sidebar shows the workspace switcher in its header; switching does NOT
// hide sessions, it just filters the active list. Sessions remain visible
// in the "전체" workspace at all times.

import { loadJSON, saveJSON } from './persistence';

export interface Workspace {
  id: string;
  name: string;
  /** Optional emoji glyph. */
  icon?: string;
  /** Explicitly-pinned session IDs. */
  sessionIds: string[];
}

const WORKSPACES_KEY = 'workspaces';
const ACTIVE_KEY = 'workspaceActive';

const DEFAULT: Workspace = { id: 'default', name: '기본', sessionIds: [] };
const ALL: Workspace = { id: '__all__', name: '전체', sessionIds: [] };

export function loadWorkspaces(): Workspace[] {
  const list = loadJSON<Workspace[]>(WORKSPACES_KEY, []);
  // Ensure the default workspace always exists. The "전체" pseudo-workspace
  // is virtual — never persisted — and inserted at the front so the picker
  // always shows it.
  const withDefault = list.length === 0 ? [DEFAULT] : list;
  return [ALL, ...withDefault];
}

export function saveWorkspaces(list: Workspace[]): void {
  // Strip the virtual __all__ entry before persisting.
  const persistable = list.filter((w) => w.id !== '__all__');
  saveJSON(WORKSPACES_KEY, persistable);
  window.dispatchEvent(new CustomEvent('agentview:workspaces-changed'));
}

export function activeWorkspaceId(): string {
  return loadJSON<string>(ACTIVE_KEY, '__all__');
}

export function setActiveWorkspace(id: string): void {
  saveJSON(ACTIVE_KEY, id);
  window.dispatchEvent(new CustomEvent('agentview:workspaces-changed'));
}

export function createWorkspace(name: string, icon?: string): Workspace {
  const id = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const w: Workspace = { id, name: name.trim(), icon, sessionIds: [] };
  const list = loadWorkspaces();
  saveWorkspaces([...list, w]);
  return w;
}

export function deleteWorkspace(id: string): void {
  if (id === '__all__' || id === 'default') return;
  saveWorkspaces(loadWorkspaces().filter((w) => w.id !== id));
  if (activeWorkspaceId() === id) setActiveWorkspace('__all__');
}

export function addSessionToWorkspace(workspaceId: string, sessionId: string): void {
  if (workspaceId === '__all__') return;
  const list = loadWorkspaces().map((w) => {
    if (w.id !== workspaceId) return w;
    if (w.sessionIds.includes(sessionId)) return w;
    return { ...w, sessionIds: [...w.sessionIds, sessionId] };
  });
  saveWorkspaces(list);
}

export function removeSessionFromWorkspace(workspaceId: string, sessionId: string): void {
  if (workspaceId === '__all__') return;
  const list = loadWorkspaces().map((w) =>
    w.id === workspaceId
      ? { ...w, sessionIds: w.sessionIds.filter((id) => id !== sessionId) }
      : w
  );
  saveWorkspaces(list);
}
