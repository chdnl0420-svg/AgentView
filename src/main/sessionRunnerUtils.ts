// Pure helpers used by SessionRunner. Extracted so the runner file
// keeps only the class + PTY-handling logic; everything here is
// framework-free and trivially testable.

import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { BackendKind, NewSessionInput } from '@shared/types';

const isWindows = platform() === 'win32';

/**
 * Routing decision for a new session request. After K + L1 every new
 * session resolves to the AVD ClaudeAdapter; the function is kept as a
 * single seam so re-enabling codex (or any future per-backend
 * branching) only needs to widen this return shape.
 */
export type BackendRoute = { worker: BackendKind };

export function routeBackend(_input: NewSessionInput): BackendRoute {
  return { worker: 'claude' };
}

export function normalizeAgentBackend(
  agent: string | null | undefined
): BackendKind | null {
  const value = (agent ?? '').trim().toLowerCase();
  return value === 'claude' || value === 'external-claude' || value === 'codex'
    ? value
    : null;
}

export function normalizeInputBackend(
  backend: NewSessionInput['backend']
): BackendKind | null {
  if (backend === 'claude' || backend === 'external-claude' || backend === 'codex') {
    return backend;
  }
  return null;
}

// Generic single-word prompts that read as "anonymous session" — augment
// these with a timestamp so multiple "테스트" sessions don't collide on
// the dashboard. Lowercased on lookup so casing doesn't matter.
const GENERIC_PROMPTS = new Set([
  'test', 'tests', 'hi', 'hello', 'hey', 'check', 'ok', 'yes', 'no', 'ping',
  '테스트', '테스트해줘', '확인', '응', '예', '아니오', '안녕', '안녕하세요', '하이'
]);

function shortTimestamp(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

/**
 * Derive a stable session display name from the explicit `args.name` or,
 * if absent, the first meaningful line of the user's prompt. Skipping
 * code fences and the standard "Continue from where you left off."
 * resume blurb keeps the title from blinking through the 8-char hex
 * fallback while the daemon settles. The first sentence/clause is
 * preferred so a "Plan v3. Implement…" prompt yields "Plan v3" rather
 * than "Plan v3. Implement…".
 *
 * When the prompt is empty or so short/generic that it would collide
 * with other anonymous-looking sessions ("테스트", "test", "hi", …), we
 * append a `MM/DD HH:mm` timestamp so the dashboard stays readable
 * instead of showing a wall of identical labels.
 */
export function deriveSessionName(
  explicitName: string | null | undefined,
  prompt: string | null | undefined,
  now: Date = new Date()
): string {
  const explicit = (explicitName ?? '').trim();
  if (explicit) return explicit.slice(0, 60);
  const body = (prompt ?? '').replace(/\r\n/g, '\n');
  if (!body.trim()) return `AVD 세션 · ${shortTimestamp(now)}`;
  // Walk line by line, skipping code fences and resume placeholders.
  const lines = body.split('\n');
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^continue from where you left off\.?$/i.test(line)) continue;
    if (/^\[?attached files\]?/i.test(line)) continue;
    // Strip leading bullet/heading markers so "## Plan" or "- todo" don't
    // bleed into the title.
    const stripped = line.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, '').trim();
    if (!stripped) continue;
    // Prefer cutting at the first sentence-ending punctuation so the title
    // is a self-contained phrase rather than a sliced clause.
    const sentenceMatch = /[.!?。！？]/.exec(stripped);
    let candidate = stripped;
    if (sentenceMatch && sentenceMatch.index >= 4 && sentenceMatch.index <= 30) {
      candidate = stripped.slice(0, sentenceMatch.index).trim();
    } else if (stripped.length > 32) {
      // Cut at the last whitespace before char 32 to avoid mid-word breaks.
      const slice = stripped.slice(0, 32);
      const lastSpace = slice.lastIndexOf(' ');
      candidate = (lastSpace >= 12 ? slice.slice(0, lastSpace) : slice).trim();
    }
    if (!candidate) continue;
    // Augment too-short or generic prompts with a timestamp so the dashboard
    // can tell multiple anonymous-looking sessions apart.
    const normalized = candidate.toLowerCase();
    if (candidate.length < 4 || GENERIC_PROMPTS.has(normalized)) {
      return `${candidate} · ${shortTimestamp(now)}`.slice(0, 60);
    }
    return candidate.slice(0, 60);
  }
  return `AVD 세션 · ${shortTimestamp(now)}`;
}

export function resolveClaudeExe(): string {
  if (isWindows) {
    const direct = join(
      homedir(),
      'AppData',
      'Roaming',
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe'
    );
    if (existsSync(direct)) return direct;
    return 'claude.cmd';
  }
  return 'claude';
}
