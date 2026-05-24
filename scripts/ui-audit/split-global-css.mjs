// One-off: split src/renderer/styles/global.css into parts/ files
// and rewrite global.css as an @import list.
// Line ranges chosen from the existing /* ===== ... */ section markers
// (see Grep output during the refactor planning step).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.argv[2] || 'D:/Project/VisualAgents';
const SRC = join(ROOT, 'src/renderer/styles/global.css');
const OUT_DIR = join(ROOT, 'src/renderer/styles/parts');

// [start, end] inclusive 1-indexed line numbers from the un-split file.
// Confirmed against the Grep /* ===== ... */ output. Boundaries chosen so
// each part stays under the 400-line hard cap and groups cohesive selectors.
const PARTS = [
  ['tokens.css',         1,    43, ':root tokens (colors, radii, fonts, shadows)'],
  ['base.css',           45,   160, '* reset, user-select rules, html/body, scrollbar, button/input/select, select option styling, light-mode override'],
  ['layout.css',         162,  194, '.app shell — grid/flex containers, .app.no-chrome flex column, dashboard/detail-page slot overrides'],
  ['topbar.css',         196,  269, '.topbar, .brand, .tabs, .live-pill, .btn (primary/danger/ghost/sm)'],
  ['dashboard.css',      271,  419, '.dashboard, .dashboard.split, .grid-wrap, .section-head, .cards grid, .session-card/.job-card with pulse + flash, .status-tag, .card-* (head/title/cwd/snippet/foot), .empty-grid'],
  ['detail.css',         421,  672, '.detail-page, .toast, .thinking-* (line/meta/dots/action/sub), .markdown table + task list, .detail-head + meta-row + model-tag + perm-tag + badge-dropdown, .detail-body, .empty-detail'],
  ['conversation.css',   674,  993, '.conv + .msg + .avatar + .bubble core + role-line + content + cmd-chip + user-text keywords + .att-group accordion + .msg-attachments + .bubble-foot/copy/time + .queued + .bubble.fresh'],
  ['tool-message.css',   994,  1095, '.bubble.tool-bubble (collapsible) + .tool-header + .tool-input/output + .tool-detail.ask + .ask-q/.ask-header/.ask-question/.ask-options/.ask-answer'],
  ['attach-banner.css',  1097, 1160, '.attach-hint + .external-banner'],
  ['attachments.css',    1162, 1208, '.attachment-strip + .att-chip composer chips'],
  ['slash-popup.css',    1210, 1263, '.slash-popup + .slash-item dropdown'],
  ['input-bar.css',      1265, 1429, '.input-bar composer (meta-controls strip, worktree strip, composer card, input-row, input-send)'],
  ['markdown-stream.css', 1431, 1480, '.stream job log view + .markdown a/code/pre/blockquote/strong/p/h*/ul/ol/hr/table'],
  ['tool-group.css',     1482, 1525, '.tool-group collapsible header + body + nested tool bubbles'],
  ['ask-buttons.css',    1526, 1556, '.ask-options li + button.ask-option-btn'],
  ['permission.css',     1558, 1622, '.msg.permission + .permission-bubble + .permission-question + .permission-options + .permission-key + .permission-hint'],
  ['ask-panel.css',      1624, 1716, '.ask-panel slide-in panel above composer + ask-panel-* sub-elements'],
  ['meta-controls.css',  1717, 1799, '.max-account-toggle, .context-window dial + popup'],
  ['update-banner.css',  1801, 1884, '.update-banner update available banner'],
  ['tutorial.css',       1886, 1918, '.tutorial-modal first-run sequence'],
  ['ask-panel-extras.css', 1920, 1947, '.ask-panel multi-select + submit row additions'],
  ['context-popup.css',  1949, 1999, '.context-popup floating modal + arrow caret'],
  ['cli-status.css',     2001, 2049, '.cli-status-bar TUI-style bottom line indicator'],
  ['delete-mode.css',    2050, 2070, '.session-card delete-mode checkboxes + checked emphasis'],
  ['code-block.css',     2072, 2089, '.markdown pre code-block with copy button overlay'],
  ['icon-button.css',    2091, 2096, '.btn.sm.icon-only — trash icon variant'],
  ['single-mode.css',    2098, null, '.dashboard.single + .session-list panel + .single-workspace + .view-mode-toggle + cards override + delete-mode card outline + waiting pulse — remainder of file'],
];

const raw = await readFile(SRC, 'utf8');
const lines = raw.split('\n');
const total = lines.length;
await mkdir(OUT_DIR, { recursive: true });

const importLines = [];
const stats = [];
let coveredEnd = 0;

for (const [name, start, end, desc] of PARTS) {
  const realEnd = end === null ? total : end;
  if (start <= coveredEnd) {
    throw new Error(`overlap or out-of-order: ${name} starts at ${start} but prev ended ${coveredEnd}`);
  }
  // 1-indexed inclusive → slice() 0-indexed exclusive
  const slice = lines.slice(start - 1, realEnd).join('\n');
  const banner = `/* ${name} — ${desc}\n   Extracted from global.css lines ${start}-${realEnd} during 20260524T1217Z-refactor. */\n\n`;
  const trailingNewline = slice.endsWith('\n') ? '' : '\n';
  await writeFile(join(OUT_DIR, name), banner + slice + trailingNewline, 'utf8');
  importLines.push(`@import './parts/${name}';`);
  stats.push({ name, start, end: realEnd, lines: realEnd - start + 1 });
  coveredEnd = realEnd;
}

// Replace global.css with a banner + import list.
const newGlobal = `/* global.css — composition root for renderer styles.
   The actual rules live in parts/* (split during 20260524T1217Z-refactor
   to keep each file under the 400-line hard cap). Section order matters:
   tokens first so var(--*) resolves, base resets next, then layout/topbar
   before component styles, then mode overrides last.

   Map (start-end inclusive line ranges in the original file):
${stats.map((s) => `     ${s.name.padEnd(24)} ${String(s.start).padStart(4)}-${String(s.end).padStart(4)}  (${s.lines}L)`).join('\n')}
*/

${importLines.join('\n')}
`;

await writeFile(SRC, newGlobal, 'utf8');
console.log(`split into ${PARTS.length} parts. total covered: ${coveredEnd}/${total} lines.`);
for (const s of stats) {
  if (s.lines > 400) console.log(`  ⚠ ${s.name} ${s.lines}L (> 400 hard cap)`);
}
console.log('OK');
