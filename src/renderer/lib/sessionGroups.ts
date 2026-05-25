// Session group (folder) system — researcher items #25 / #26 / #52.
//
// Each group has { id, name, sessionIds }. Lives in localStorage so the
// folders are local to the user's machine — no server / IPC round-trip.

import { loadJSON, saveJSON } from './persistence';

export interface SessionGroup {
  id: string;
  name: string;
  sessionIds: string[];
  /** Optional emoji / single-character glyph rendered next to the group header. */
  icon?: string;
  /** Whether the group is collapsed in the sidebar — purely UI state. */
  collapsed?: boolean;
}

const GROUPS_KEY = 'sessionGroups';

export function loadGroups(): SessionGroup[] {
  return loadJSON<SessionGroup[]>(GROUPS_KEY, []);
}

export function saveGroups(list: SessionGroup[]): void {
  saveJSON(GROUPS_KEY, list);
  window.dispatchEvent(new CustomEvent('agentview:groups-changed'));
}

export function groupContaining(sessionId: string): SessionGroup | null {
  for (const g of loadGroups()) {
    if (g.sessionIds.includes(sessionId)) return g;
  }
  return null;
}

export function createGroup(name: string, icon?: string): SessionGroup {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('group name required');
  const id = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const g: SessionGroup = { id, name: trimmed, sessionIds: [], icon };
  const list = loadGroups();
  saveGroups([...list, g]);
  return g;
}

export function renameGroup(groupId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const list = loadGroups().map((g) =>
    g.id === groupId ? { ...g, name: trimmed } : g
  );
  saveGroups(list);
}

export function deleteGroup(groupId: string): void {
  saveGroups(loadGroups().filter((g) => g.id !== groupId));
}

export function toggleCollapsed(groupId: string): void {
  const list = loadGroups().map((g) =>
    g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
  );
  saveGroups(list);
}

export function addToGroup(groupId: string, sessionId: string): void {
  const list = loadGroups().map((g) => {
    if (g.id !== groupId) {
      // Implicitly remove from any other group so a session lives in only one.
      return { ...g, sessionIds: g.sessionIds.filter((id) => id !== sessionId) };
    }
    if (g.sessionIds.includes(sessionId)) return g;
    return { ...g, sessionIds: [...g.sessionIds, sessionId] };
  });
  saveGroups(list);
}

export function removeFromGroup(sessionId: string): void {
  const list = loadGroups().map((g) => ({
    ...g,
    sessionIds: g.sessionIds.filter((id) => id !== sessionId)
  }));
  saveGroups(list);
}
