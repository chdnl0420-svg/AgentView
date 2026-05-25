// Small SVG donut showing context-window usage percent. Click target
// lives in the SessionDetail header meta-row; the popup panel below it
// renders the breakdown (input/output tokens + model). Matches the
// compact dial look from the Claude Code desktop status bar.

import React from 'react';

export function ContextDonut({ percent }: { percent: number }) {
  const safe = Math.max(0, Math.min(100, percent));
  const r = 9;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - safe / 100);
  // Pick a fill color matching how "full" the context is — green when
  // there is plenty of room, yellow as it climbs, red near the limit.
  let stroke = 'var(--running)';
  if (safe >= 75) stroke = 'var(--crashed)';
  else if (safe >= 50) stroke = 'var(--waiting)';
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle
        cx="11"
        cy="11"
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth="3"
      />
      <circle
        cx="11"
        cy="11"
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeDasharray={`${circ}`}
        strokeDashoffset={`${offset}`}
        transform="rotate(-90 11 11)"
        strokeLinecap="round"
      />
    </svg>
  );
}
