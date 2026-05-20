// Workspace persistence — one markdown document per session under
// %USERPROFILE%\.claude\agentview\workspace\sessions\<sid>.md.
//
// Each doc has YAML frontmatter (status, prompt, cwd, agent, ts) plus a
// human-readable activity log that gets appended on every event. Two
// goals are served simultaneously:
//
//   1. Reduce context impact — the renderer never needs to keep an
//      entire session's prompt/status set in memory; it can load only
//      the headers and lazy-fetch the body when the user opens a card.
//   2. Resumability — if the app crashes mid-task, the next launch can
//      scan this folder for status:"pending" / "running" docs and
//      surface them with a "이어 작업" affordance.
//
// Reports / plans are rendered as standalone .html files (per CLAUDE.md
// Section 6) into the same workspace under ./reports/. The md files
// here are the operational log; html is the human-facing artifact.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(homedir(), '.claude', 'agentview', 'workspace');
const SESSIONS = join(ROOT, 'sessions');
const REPORTS = join(ROOT, 'reports');

export interface SessionDoc {
  sessionId: string;
  cwd: string;
  agent: string;
  name: string | null;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'crashed';
  createdAt: number;
  updatedAt?: number;
}

export interface SessionDocSummary {
  sessionId: string;
  status: SessionDoc['status'];
  prompt: string;
  cwd: string;
  agent: string;
  updatedAt: number;
  filePath: string;
}

function ensureDirSync(): Promise<unknown> {
  return Promise.all([
    fs.mkdir(SESSIONS, { recursive: true }),
    fs.mkdir(REPORTS, { recursive: true })
  ]);
}

function docPath(sessionId: string): string {
  return join(SESSIONS, `${sessionId}.md`);
}

function escapeYaml(v: string): string {
  if (!v) return '""';
  if (/[\n:'"]/.test(v) || v !== v.trim()) {
    return JSON.stringify(v);
  }
  return v;
}

function buildFrontmatter(doc: SessionDoc): string {
  const updated = doc.updatedAt ?? Date.now();
  const lines = [
    '---',
    `sessionId: ${doc.sessionId}`,
    `status: ${doc.status}`,
    `agent: ${escapeYaml(doc.agent)}`,
    `name: ${escapeYaml(doc.name || '')}`,
    `cwd: ${escapeYaml(doc.cwd)}`,
    `createdAt: ${new Date(doc.createdAt).toISOString()}`,
    `updatedAt: ${new Date(updated).toISOString()}`,
    '---',
    ''
  ];
  return lines.join('\n');
}

export async function writeSessionDoc(doc: SessionDoc): Promise<void> {
  await ensureDirSync();
  const body = [
    buildFrontmatter(doc),
    `# Session ${doc.sessionId.slice(0, 8)}`,
    '',
    `**작업:** ${doc.name || '(이름 없음)'}`,
    `**cwd:** \`${doc.cwd}\``,
    `**agent:** \`${doc.agent}\``,
    '',
    '## 최초 프롬프트',
    '',
    '```',
    doc.prompt || '(빈 프롬프트)',
    '```',
    '',
    '## 활동 로그',
    '',
    `- ${new Date(doc.createdAt).toISOString()} — created (status=${doc.status})`,
    ''
  ].join('\n');
  await fs.writeFile(docPath(doc.sessionId), body, 'utf8');
}

export async function appendSessionEvent(
  sessionId: string,
  kind: 'spawn' | 'resume' | 'error' | 'cancel' | 'status' | 'note' | 'permission-change' | 'model-change',
  text: string
): Promise<void> {
  const p = docPath(sessionId);
  try {
    const line = `- ${new Date().toISOString()} — ${kind}: ${text.replace(/\n/g, ' ').slice(0, 600)}\n`;
    await fs.appendFile(p, line, 'utf8');
  } catch {
    /* doc may not exist yet — best-effort */
  }
}

export async function updateSessionStatus(
  sessionId: string,
  status: SessionDoc['status']
): Promise<void> {
  const p = docPath(sessionId);
  let raw: string;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch {
    return;
  }
  const next = raw.replace(/^status:\s*.+$/m, `status: ${status}`);
  const withTs = next.replace(/^updatedAt:\s*.+$/m, `updatedAt: ${new Date().toISOString()}`);
  await fs.writeFile(p, withTs, 'utf8');
  await appendSessionEvent(sessionId, 'status', `→ ${status}`);
}

function parseFrontmatter(raw: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z][a-zA-Z0-9_]*):\s*(.+)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      try {
        value = JSON.parse(value.startsWith("'") ? `"${value.slice(1, -1)}"` : value);
      } catch {
        /* leave raw */
      }
    }
    out[kv[1]] = value;
  }
  return out;
}

export async function listSessionSummaries(): Promise<SessionDocSummary[]> {
  await ensureDirSync();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(SESSIONS);
  } catch {
    return [];
  }
  const out: SessionDocSummary[] = [];
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const filePath = join(SESSIONS, f);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const fm = parseFrontmatter(raw);
      const updatedIso = fm.updatedAt || fm.createdAt || '';
      const updatedAt = updatedIso ? Date.parse(updatedIso) : 0;
      const promptMatch = /```\n([\s\S]*?)\n```/.exec(raw);
      const status = (fm.status || 'pending') as SessionDoc['status'];
      out.push({
        sessionId: fm.sessionId || f.replace(/\.md$/, ''),
        status,
        prompt: promptMatch ? promptMatch[1].slice(0, 600) : '',
        cwd: fm.cwd || '',
        agent: fm.agent || 'claude',
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
        filePath
      });
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function readSessionDoc(sessionId: string): Promise<string | null> {
  try {
    return await fs.readFile(docPath(sessionId), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Render a markdown body to a standalone HTML file in the reports/
 * directory. Used by the "보고서 보기" affordance — CLAUDE.md Section 6
 * requires reports/plans as single-file HTML for human consumption.
 *
 * This is a deliberately tiny renderer: enough for headings, bullets,
 * code fences, and bold/italic. We don't pull in a markdown library
 * because we don't need round-trip fidelity here.
 */
export async function renderReportHtml(input: {
  title: string;
  markdown: string;
  reportId?: string;
}): Promise<string> {
  await ensureDirSync();
  const safeId =
    (input.reportId || input.title.replace(/[^A-Za-z0-9가-힣_-]+/g, '_').slice(0, 40)) +
    '_' +
    new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = join(REPORTS, `${safeId}.html`);
  const html = buildReportHtml(input.title, input.markdown);
  await fs.writeFile(out, html, 'utf8');
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  let inList = false;
  for (const ln of lines) {
    if (/^```/.test(ln)) {
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
        codeLang = '';
      } else {
        codeLang = ln.replace(/^```/, '').trim();
        out.push(`<pre><code data-lang="${escapeHtml(codeLang)}">`);
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(ln));
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(ln);
    if (heading) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      const level = heading[1].length;
      const slug = heading[2].toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '');
      out.push(`<h${level} id="${escapeHtml(slug)}">${inlineMd(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(ln)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineMd(ln.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (inList && !ln.trim()) {
      out.push('</ul>');
      inList = false;
      continue;
    }
    if (!ln.trim()) {
      out.push('');
      continue;
    }
    out.push(`<p>${inlineMd(ln)}</p>`);
  }
  if (inCode) out.push('</code></pre>');
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function inlineMd(line: string): string {
  let escaped = escapeHtml(line);
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return escaped;
}

function buildReportHtml(title: string, markdown: string): string {
  const body = mdToHtml(markdown);
  const generated = new Date().toLocaleString('ko-KR');
  // Tabs: 요약 / 본문. 첫 탭=요약 (per CLAUDE.md Section 6.3.1 B). For an
  // operational session doc we synthesize the summary from the first H1
  // + first paragraph; the full md goes under "본문".
  const firstHeading = /^#\s+(.+)$/m.exec(markdown);
  const summaryTitle = firstHeading ? firstHeading[1] : title;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #0b0d12;
    --panel: #131722;
    --border: #232838;
    --text: #e6e8ef;
    --muted: #8b91a4;
    --accent: #7c9bff;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f7fb;
      --panel: #ffffff;
      --border: #d8dde8;
      --text: #1c2030;
      --muted: #5c6378;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Pretendard', 'Inter', 'Noto Sans KR', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    min-height: 40px;
  }
  header h1 {
    font-size: 13px;
    margin: 0;
    color: var(--accent);
  }
  header .meta {
    font-size: 11px;
    color: var(--muted);
  }
  nav.tabs {
    display: flex;
    gap: 4px;
    padding: 4px 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  nav.tabs button {
    background: transparent;
    border: 0;
    color: var(--muted);
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
  }
  nav.tabs button[aria-selected="true"] {
    background: var(--accent);
    color: var(--bg);
  }
  main {
    height: calc(100vh - 88px);
    overflow: auto;
    padding: 20px 24px;
    line-height: 1.6;
  }
  [role="tabpanel"][hidden] { display: none; }
  h1, h2, h3 { line-height: 1.3; }
  code {
    background: rgba(124,155,255,0.12);
    padding: 1px 6px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', 'D2Coding', monospace;
    font-size: 12.5px;
  }
  pre code {
    display: block;
    padding: 12px 14px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow-x: auto;
  }
  ul { padding-left: 18px; }
  @media print {
    [role="tabpanel"] { display: block !important; }
    nav.tabs { display: none; }
  }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <span class="meta">${escapeHtml(generated)}</span>
</header>
<nav class="tabs" role="tablist">
  <button role="tab" aria-selected="true" data-tab="summary">한눈에</button>
  <button role="tab" aria-selected="false" data-tab="full">본문</button>
</nav>
<main>
  <section role="tabpanel" data-panel="summary">
    <h2>${escapeHtml(summaryTitle)}</h2>
    <p>아래 본문 탭에서 전체 활동 로그·프롬프트·상태 전환을 확인할 수 있습니다.</p>
    <p class="meta">생성: ${escapeHtml(generated)}</p>
  </section>
  <section role="tabpanel" data-panel="full" hidden>
    ${body}
  </section>
</main>
<script>
  (function() {
    const tabs = document.querySelectorAll('nav.tabs button');
    const panels = document.querySelectorAll('[role="tabpanel"]');
    tabs.forEach(function(btn) {
      btn.addEventListener('click', function() {
        const target = btn.getAttribute('data-tab');
        tabs.forEach(function(t) { t.setAttribute('aria-selected', t === btn ? 'true' : 'false'); });
        panels.forEach(function(p) {
          if (p.getAttribute('data-panel') === target) p.removeAttribute('hidden');
          else p.setAttribute('hidden', '');
        });
      });
    });
  })();
</script>
</body>
</html>`;
}

export function workspaceRoot(): string {
  return ROOT;
}
