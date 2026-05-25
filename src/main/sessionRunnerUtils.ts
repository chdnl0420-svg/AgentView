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

/**
 * Derive a stable session display name from the explicit `args.name` or,
 * if absent, the first meaningful line of the user's prompt. Skipping
 * code fences and the standard "Continue from where you left off."
 * resume blurb keeps the title from blinking through the 8-char hex
 * fallback while the daemon settles. The first sentence/clause is
 * preferred so a "Plan v3. Implement…" prompt yields "Plan v3" rather
 * than "Plan v3. Implement…".
 */
export function deriveSessionName(
  explicitName: string | null | undefined,
  prompt: string | null | undefined
): string | null {
  const explicit = (explicitName ?? '').trim();
  if (explicit) return explicit.slice(0, 60);
  const body = (prompt ?? '').replace(/\r\n/g, '\n');
  if (!body.trim()) return null;
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
    if (candidate) return candidate.slice(0, 60);
  }
  return null;
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
