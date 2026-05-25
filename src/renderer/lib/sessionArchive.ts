// Session archive — researcher item #21.
//
// Archive is a soft-hide: archived sessions still exist on disk and inside
// the daemon, they're just collapsed under an "아카이브" section in the
// sidebar so the user's daily list stays focused.

import { loadJSON, saveJSON } from './persistence';

const ARCHIVE_KEY = 'sessionArchive';

export function loadArchive(): Set<string> {
  return new Set(loadJSON<string[]>(ARCHIVE_KEY, []));
}

export function saveArchive(set: Set<string>): void {
  saveJSON(ARCHIVE_KEY, Array.from(set));
  window.dispatchEvent(new CustomEvent('agentview:archive-changed'));
}

export function isArchived(sessionId: string): boolean {
  return loadArchive().has(sessionId);
}

export function archive(sessionIds: string[]): void {
  const set = loadArchive();
  for (const id of sessionIds) set.add(id);
  saveArchive(set);
}

export function unarchive(sessionIds: string[]): void {
  const set = loadArchive();
  for (const id of sessionIds) set.delete(id);
  saveArchive(set);
}

export function toggleArchive(sessionId: string): boolean {
  const set = loadArchive();
  if (set.has(sessionId)) {
    set.delete(sessionId);
    saveArchive(set);
    return false;
  }
  set.add(sessionId);
  saveArchive(set);
  return true;
}
