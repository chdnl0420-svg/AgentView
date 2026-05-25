// Manual session ordering — researcher item #24.
//
// When the user drags sessions into a custom order we record their relative
// position here. The sidebar consults this map first, then falls back to
// timestamp ordering for anything not explicitly placed.

import { loadJSON, saveJSON } from './persistence';

const ORDER_KEY = 'sessionOrder';
const MODE_KEY = 'sessionSortMode';

export type SortMode = 'updated' | 'created' | 'name' | 'manual';

export function loadOrder(): Record<string, number> {
  return loadJSON<Record<string, number>>(ORDER_KEY, {});
}

export function saveOrder(idx: Record<string, number>): void {
  saveJSON(ORDER_KEY, idx);
  window.dispatchEvent(new CustomEvent('agentview:order-changed'));
}

export function reorder(ids: string[]): void {
  const next: Record<string, number> = {};
  ids.forEach((id, i) => {
    next[id] = i;
  });
  saveOrder(next);
}

export function loadSortMode(): SortMode {
  const v = loadJSON<string>(MODE_KEY, 'updated');
  if (v === 'updated' || v === 'created' || v === 'name' || v === 'manual') return v;
  return 'updated';
}

export function saveSortMode(mode: SortMode): void {
  saveJSON(MODE_KEY, mode);
  window.dispatchEvent(new CustomEvent('agentview:order-changed'));
}
