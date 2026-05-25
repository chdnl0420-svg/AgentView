// Saved views — researcher items #185 / #186.
//
// A view is the combination of (search query + status filter + tag filter +
// sort mode) that the user wants to recall with one click. Stored locally.

import { loadJSON, saveJSON } from './persistence';
import type { SortMode } from './sessionOrder';

export type StatusFilter = 'all' | 'active' | 'completed' | 'error' | 'waiting';

export interface SavedView {
  id: string;
  name: string;
  query: string;
  filter: StatusFilter;
  tagIds: string[];
  sort: SortMode;
}

const KEY = 'savedViews';

export function loadSavedViews(): SavedView[] {
  return loadJSON<SavedView[]>(KEY, []);
}

export function saveSavedViews(list: SavedView[]): void {
  saveJSON(KEY, list);
  window.dispatchEvent(new CustomEvent('agentview:views-changed'));
}

export function addView(view: Omit<SavedView, 'id'>): SavedView {
  const id = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const v: SavedView = { ...view, id };
  saveSavedViews([...loadSavedViews(), v]);
  return v;
}

export function deleteView(viewId: string): void {
  saveSavedViews(loadSavedViews().filter((v) => v.id !== viewId));
}

export function findView(viewId: string): SavedView | null {
  return loadSavedViews().find((v) => v.id === viewId) ?? null;
}
