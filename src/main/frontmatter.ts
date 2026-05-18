import type { AgentInfo } from '@shared/types';
import { basename } from 'node:path';

type AgentScope = AgentInfo['scope'];

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

interface ParsedFront {
  data: Record<string, unknown>;
  body: string;
}

function parseFront(raw: string): ParsedFront {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return { data: {}, body: raw };
  return { data: parseYaml(m[1]), body: raw.slice(m[0].length) };
}

function parseYaml(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    out[key] = parseScalar(line.slice(idx + 1).trim());
  }
  return out;
}

function parseScalar(v: string): unknown {
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => stripQuotes(s.trim()));
  }
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : String(v);
}

function asTools(v: unknown): string[] | 'inherit' | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '*' || t.toLowerCase() === 'inherit') return 'inherit';
    if (!t) return null;
    return t.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return null;
}

export function parseAgentFile(filePath: string, raw: string, scope: AgentScope): AgentInfo {
  const { data, body } = parseFront(raw);
  const fileBase = basename(filePath).replace(/\.md$/i, '');
  return {
    name: asString(data.name) ?? fileBase,
    description: asString(data.description) ?? '',
    tools: asTools(data.tools),
    model: asString(data.model),
    scope,
    filePath,
    body: body.trim()
  };
}
