import { useCallback, useRef, useState } from 'react';
import type { InputDraft } from '../components/InputBar';
import { loadJSON, saveJSON } from '../lib/persistence';

const NEW_DRAFT_KEY = 'draft.new';
const RESUME_DRAFTS_KEY = 'draft.resume';

/**
 * Drafts keyed by sessionId so the user's in-progress prompt + attachments
 * survive going back to the grid AND surviving an app restart (we mirror
 * them into localStorage on every change). The "new" draft (for the
 * composer when no session is open) is tracked separately so it doesn't
 * collide with per-session drafts.
 */
export function useDrafts() {
  const draftsRef = useRef<Map<string, InputDraft>>(
    new Map(
      Object.entries(loadJSON<Record<string, InputDraft>>(RESUME_DRAFTS_KEY, {}))
    )
  );
  const [, setDraftBump] = useState(0); // force re-render after draft change

  const persistResumeDrafts = useCallback(() => {
    const out: Record<string, InputDraft> = {};
    for (const [sid, d] of draftsRef.current.entries()) out[sid] = d;
    saveJSON(RESUME_DRAFTS_KEY, out);
  }, []);

  const setDraft = useCallback(
    (sessionId: string, draft: InputDraft) => {
      if (!draft.prompt && draft.attachments.length === 0) {
        draftsRef.current.delete(sessionId);
      } else {
        draftsRef.current.set(sessionId, draft);
      }
      persistResumeDrafts();
      setDraftBump((v) => v + 1);
    },
    [persistResumeDrafts]
  );

  const [newDraft, setNewDraftState] = useState<InputDraft>(() =>
    loadJSON<InputDraft>(NEW_DRAFT_KEY, { prompt: '', attachments: [] })
  );
  const setNewDraft = useCallback((d: InputDraft) => {
    setNewDraftState(d);
    if (!d.prompt && d.attachments.length === 0) {
      saveJSON(NEW_DRAFT_KEY, { prompt: '', attachments: [] });
    } else {
      saveJSON(NEW_DRAFT_KEY, d);
    }
  }, []);

  return { draftsRef, setDraft, newDraft, setNewDraft };
}
