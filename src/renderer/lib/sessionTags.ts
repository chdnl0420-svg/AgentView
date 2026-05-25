// Session tag (label) system — researcher items #9 / #10 / #183.
//
// Each tag is { id, name, color } and a session can hold any number of tag
// IDs. The whole catalog lives in localStorage; no IPC round-trip needed.
// Components consume `loadTagsMap()` for fast O(1) tag lookups by ID and
// `loadSessionTags()` for the session→tag-IDs index.

import { loadJSON, saveJSON } from './persistence';

export interface SessionTag {
  id: string;
  name: string;
  /** A CSS color string — supports named, hex, or `var(--...)`. */
  color: string;
}

const TAG_CATALOG_KEY = 'sessionTagCatalog';
const SESSION_TAGS_KEY = 'sessionTags';

const DEFAULT_TAGS: SessionTag[] = [
  { id: 'urgent', name: '긴급', color: '#f47474' },
  { id: 'review', name: '검토 중', color: '#f0c25c' },
  { id: 'in-progress', name: '진행 중', color: '#6dd9a8' },
  { id: 'todo', name: '할 일', color: '#7c9bff' },
  { id: 'done', name: '완료', color: '#5fb6e0' },
];

export function loadTagCatalog(): SessionTag[] {
  // Distinguish "never saved" from "explicitly emptied" so the user can
  // delete every default tag and keep the catalog empty without it being
  // resurrected on the next read (codex review P3). The sentinel uses
  // `null` as the fallback so an empty array stays as-is.
  const raw = loadJSON<SessionTag[] | null>(TAG_CATALOG_KEY, null);
  if (raw === null) return DEFAULT_TAGS;
  return raw;
}

export function saveTagCatalog(list: SessionTag[]): void {
  saveJSON(TAG_CATALOG_KEY, list);
  window.dispatchEvent(new CustomEvent('agentview:tags-changed'));
}

export function loadTagsMap(): Record<string, SessionTag> {
  const map: Record<string, SessionTag> = {};
  for (const t of loadTagCatalog()) map[t.id] = t;
  return map;
}

export function loadSessionTags(): Record<string, string[]> {
  return loadJSON<Record<string, string[]>>(SESSION_TAGS_KEY, {});
}

export function saveSessionTags(idx: Record<string, string[]>): void {
  saveJSON(SESSION_TAGS_KEY, idx);
  window.dispatchEvent(new CustomEvent('agentview:tags-changed'));
}

export function tagsOf(sessionId: string): string[] {
  const idx = loadSessionTags();
  return idx[sessionId] ?? [];
}

export function setTagsOf(sessionId: string, tagIds: string[]): void {
  const idx = loadSessionTags();
  if (tagIds.length === 0) delete idx[sessionId];
  else idx[sessionId] = Array.from(new Set(tagIds));
  saveSessionTags(idx);
}

export function toggleTag(sessionId: string, tagId: string): string[] {
  const cur = tagsOf(sessionId);
  const next = cur.includes(tagId) ? cur.filter((t) => t !== tagId) : [...cur, tagId];
  setTagsOf(sessionId, next);
  return next;
}

export function addTagToCatalog(name: string, color: string): SessionTag {
  const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const tag: SessionTag = { id, name, color };
  const list = loadTagCatalog();
  saveTagCatalog([...list, tag]);
  return tag;
}

export function removeTagFromCatalog(tagId: string): void {
  saveTagCatalog(loadTagCatalog().filter((t) => t.id !== tagId));
  // Cascade-delete: remove from every session's tag list.
  const idx = loadSessionTags();
  for (const sid of Object.keys(idx)) {
    idx[sid] = idx[sid].filter((id) => id !== tagId);
    if (idx[sid].length === 0) delete idx[sid];
  }
  saveSessionTags(idx);
}
