// URL deep-link state — researcher item #196.
//
// We use the hash portion of the document URL (`#?id=...&q=...&filter=...`)
// because Electron file:// loads can't write to history.pushState for the
// path, but hash updates work fine and survive reload. The renderer reads
// the current hash on mount and writes it back when state changes.

export interface UrlState {
  sessionId: string | null;
  query: string;
  filter: string;
}

const EMPTY: UrlState = { sessionId: null, query: '', filter: 'all' };

function decodeHashParams(): URLSearchParams {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw.startsWith('?')) return new URLSearchParams();
  return new URLSearchParams(raw.slice(1));
}

export function readUrlState(): UrlState {
  if (typeof window === 'undefined') return EMPTY;
  const params = decodeHashParams();
  return {
    sessionId: params.get('id') || null,
    query: params.get('q') || '',
    filter: params.get('filter') || 'all'
  };
}

export function writeUrlState(s: UrlState): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (s.sessionId) params.set('id', s.sessionId);
  if (s.query) params.set('q', s.query);
  if (s.filter && s.filter !== 'all') params.set('filter', s.filter);
  const next = params.toString();
  // Avoid an infinite update loop when the state matches what's already there.
  const currentHash = window.location.hash.replace(/^#/, '');
  const desired = next ? `?${next}` : '';
  if (currentHash === desired) return;
  window.history.replaceState(null, '', `${window.location.pathname}#${desired}`);
}
