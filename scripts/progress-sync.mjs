// progress-sync.mjs — Render docs/progress/INDEX.md from chunk-*.md
// frontmatter. Zero external dependencies; runs as `node scripts/
// progress-sync.mjs` (no npm script is wired up in chunk-1; chunk-2
// will add `npm run progress:check`).
//
// chunk-1 of split-a-backend. Tested by scripts/__tests__/
// progress-sync.test.mjs using Node's built-in test runner.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROGRESS_DIR = join(__dirname, '..', 'docs', 'progress');
const INDEX_FILE = 'INDEX.md';

function parseFrontmatter(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return null;
  const block = text.slice(4, end);
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      out[key] = inner ? inner.split(',').map((s) => s.trim()).filter(Boolean) : [];
    } else {
      out[key] = val;
    }
  }
  return out;
}

function chunkOrder(id) {
  const m = /^chunk-(\d+)$/.exec(id ?? '');
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

export function renderIndex(progressDir = DEFAULT_PROGRESS_DIR) {
  const entries = existsSync(progressDir)
    ? readdirSync(progressDir).filter((f) => /^chunk-\d+\.md$/.test(f))
    : [];
  const rows = entries
    .map((file) => {
      const fm = parseFrontmatter(readFileSync(join(progressDir, file), 'utf8'));
      if (!fm) return null;
      const deps = Array.isArray(fm.depends_on) && fm.depends_on.length
        ? fm.depends_on.join(', ')
        : '—';
      return {
        order: chunkOrder(fm.id),
        line: `| ${fm.id ?? ''} | ${fm.title ?? ''} | ${fm.status ?? ''} | ${deps} |`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((r) => r.line);

  const lines = [
    '<!-- 자동 생성 — scripts/progress-sync.mjs 가 갱신. 직접 편집 금지. -->',
    '# Progress Index',
    '',
    '| id | title | status | depends_on |',
    '|----|-------|--------|------------|',
    ...rows,
  ];
  return lines.join('\n') + '\n';
}

export function writeIndex(progressDir = DEFAULT_PROGRESS_DIR) {
  const out = renderIndex(progressDir);
  writeFileSync(join(progressDir, INDEX_FILE), out, 'utf8');
  return out;
}

const invokedDirectly = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === new URL(`file:///${argv1.replace(/\\/g, '/')}`).href
    || import.meta.url.endsWith(argv1.replace(/\\/g, '/'));
})();

if (invokedDirectly) {
  writeIndex();
}
