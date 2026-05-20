import { extractAttachments, type ExtractedAttachments } from './attachments';

export interface SlashCommand {
  name: string;
  args?: string;
}

export interface CleanedUserMessage {
  /** Bubble body text (without tags / system-reminders / attachments block). */
  body: string;
  /** Slash command (if the user invoked one). */
  command: SlashCommand | null;
  /** Attached file paths. */
  attachments: string[];
}

const TAG_RE = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'g');

function stripAndCapture(text: string, name: string): { stripped: string; values: string[] } {
  const values: string[] = [];
  const stripped = text.replace(TAG_RE(name), (_m, inner) => {
    values.push(inner.trim());
    return '';
  });
  return { stripped, values };
}

function strip(text: string, name: string): string {
  return text.replace(TAG_RE(name), '');
}

function scrubNoise(text: string): string {
  // 1) drop every wrapping tag except the ones we want to keep
  let out = text.replace(GENERIC_TAG_RE, (match, name: string) =>
    KEEP_TAGS.has(name.toLowerCase()) ? match : ''
  );
  // 2) drop loose hook/caveat noise lines
  out = out
    .split(/\r?\n/)
    .filter((line) => !NOISE_LINE_PATTERNS.some((re) => re.test(line)))
    .join('\n');
  // 3) collapse blank-line runs
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// Tags we keep so we can render them specially. Everything else (hooks,
// reminders, IDE diagnostics, stdout dumps, …) gets dropped wholesale.
const KEEP_TAGS = new Set(['command-name', 'command-args']);
const GENERIC_TAG_RE = /<([a-zA-Z][a-zA-Z0-9_:-]*)>([\s\S]*?)<\/\1>/g;
// HARD_DROP: if any of these match anywhere in the raw message text, the
// whole bubble is treated as hook-injected noise and never rendered as a
// "나" message. These cover the cases where a Stop hook / SessionStart hook
// / system reminder is wrapped across line breaks or embedded inside what
// would otherwise look like real text.
const HARD_DROP_PATTERNS: RegExp[] = [
  /A session-scoped Stop hook is now active/i,
  /The hook will block stopping until the condition holds/i,
  /Stop hook feedback:/i,
  /Caveat: The messages below were generated/i,
  /\[Request interrupted by user/i,
  /SessionStart hook additional context/i,
  /The user sent a new message while you were working/i,
  /Tool loaded\./i,
  /The transcript shows work on/i,
  /<system-reminder>/i,
  /<command-stdout>/i,
  /<local-command-stdout>/i,
  /Goal set:\s/i,
  /<task-notification>/i,
  /Background command "/i,
  // Claude Code auto-injects this exact line on `claude --continue` /
  // resume flows. It's not something the user typed, so it should never
  // appear as a "나" bubble. Allow trailing dot + whitespace variations.
  /^Continue from where you left off\.?\s*$/im,
  /\bContinue from where you left off\b/i
];

// Loose noise lines that arrive outside any tag. Each pattern matches a
// whole line which we then drop.
const NOISE_LINE_PATTERNS: RegExp[] = [
  /^\s*\[Hook\][^\n]*$/i,
  /^\s*[A-Za-z][\w -]* hook feedback:[^\n]*$/i,
  /^\s*Stop hook feedback:[^\n]*$/i,
  /^\s*\[Request interrupted by user\][^\n]*$/i,
  /^\s*\[Request interrupted by user.*$/i,
  /^\s*Commands are in the form\b[^\n]*$/i,
  /^\s*A session-scoped Stop hook is now active[^\n]*$/i,
  /^\s*Briefly acknowledge the goal[^\n]*$/i,
  /^\s*The hook will block stopping[^\n]*$/i,
  /^\s*It auto-clears once the condition is met[^\n]*$/i,
  /^\s*do not tell the user to run[^\n]*$/i,
  /^\s*<local-command-caveat>[^\n]*$/i, // safety net for unbalanced opens
  /^\s*Caveat: The messages below were generated[^\n]*$/i,
  /^\s*The user sent a new message while you were working:?[^\n]*$/i,
  /^\s*IMPORTANT: After completing your current task[^\n]*$/i,
  /^\s*\[Image #\d+\][^\n]*$/i,
  /^\s*\[Image: source:[^\n]*$/i,
  /^\s*Tool loaded\.[^\n]*$/i,
  /^\s*Some tools are deferred and not listed[^\n]*$/i,
  /^\s*When a deferred tool is surfaced[^\n]*$/i,
  /^\s*ARGUMENTS:[^\n]*$/i,
  /^\s*Base directory for this skill[^\n]*$/i
];

/**
 * Removes claude-injected XML-style tags and hook noise so user messages
 * display as the plain text the human actually typed. Pulls out the slash
 * command name + args so we can render them as a chip + body.
 */
export function cleanUserMessage(raw: string): CleanedUserMessage {
  if (!raw) return { body: '', command: null, attachments: [] };

  // Hook / system / Stop-hook injections: if any unmistakable marker is
  // anywhere in the raw text, treat the whole message as noise so the
  // renderer can hide the "나" bubble entirely. The user explicitly
  // requested: only messages they themselves typed and sent should appear.
  for (const re of HARD_DROP_PATTERNS) {
    if (re.test(raw)) {
      return { body: '', command: null, attachments: [] };
    }
  }

  let text = raw;

  // Extract slash command name + args first so we can keep them after the
  // generic strip step removes their wrappers.
  const nameCap = stripAndCapture(text, 'command-name');
  const argsCap = stripAndCapture(nameCap.stripped, 'command-args');
  text = argsCap.stripped;

  text = scrubNoise(text);

  let body = text;
  const cmdArgs = argsCap.values.find((v) => v.length > 0);
  if (cmdArgs) {
    // For slash commands, the args carry the actual user intent — prefer that.
    body = scrubNoise(cmdArgs);
  }

  const { body: stripped, attachments }: ExtractedAttachments = extractAttachments(body);

  const cmdName = nameCap.values.find((v) => v.length > 0) ?? null;
  const command: SlashCommand | null = cmdName
    ? { name: cmdName.replace(/^\//, ''), args: cmdArgs }
    : null;

  const finalBody = stripped.trim();
  // If after every scrub there's no human-written body, no slash command
  // we recognise, and no attachments, treat the message as caveat-only and
  // tell the renderer it carries nothing worth showing.
  return {
    body: finalBody,
    command,
    attachments
  };
}

/**
 * Returns true when a cleaned user message has nothing the human meaningfully
 * authored — useful for hiding caveat / hook-only bubbles outright.
 */
export function isEmptyUserMessage(cleaned: CleanedUserMessage): boolean {
  if (cleaned.attachments.length > 0) return false;
  if (cleaned.body && cleaned.body.trim().length > 0) return false;
  if (cleaned.command) return false;
  return true;
}

/**
 * Splits a text body into ReactNode-renderable segments where file paths,
 * inline code, and bold tokens get distinct styling. Returns plain shapes
 * so consumers can map to <span class=...>.
 */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'path'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string };

// Path detection. Two tiers:
//
//   (a) Quoted variants — anything between matching " ' or ` quotes that
//       looks like an absolute path is treated as a path. Quotes are the
//       only context where spaces and non-ASCII (Korean) folder names are
//       allowed, because outside quotes we can't tell where the path ends.
//
//   (b) Unquoted variants — ASCII-only, no spaces. Each ends with a `\w`
//       so trailing punctuation (sentence-end period, comma, colon,
//       closing paren/bracket/brace, quote char) is left in the
//       surrounding text instead of being absorbed into the path. The
//       trailing lookahead double-checks the boundary.
//
// `(?<!:)` on the bare POSIX absolute form prevents `https://example.com/x`
// from matching `s://example.com/x` (URL scheme separator, not a path).
const PATH_RE =
  /(?:"[A-Za-z]:[\\/][^"\n]+"|'[A-Za-z]:[\\/][^'\n]+'|`[A-Za-z]:[\\/][^`\n]+`|"\/[^"\n]+"|'\/[^'\n]+'|`\/[^`\n]+`|[A-Za-z]:\\[\w\-./\\]*\w|[A-Za-z]:\/[\w\-./]*\w|(?<!:)\/[\w\-./]*\w|~\/[\w\-./]*\w|\.\.?\/[\w\-./]*\w)(?=$|[\s"'`)\]},.;:!?])/g;
const CODE_RE = /`([^`\n]+)`/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;

export function segmentBody(body: string): Segment[] {
  if (!body) return [];
  // Token order: code > bold > path. Use a single combined pass with
  // sequential application. Simpler: split on path first, then within each
  // text part, split on code & bold.
  const segs: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(PATH_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      pushTextLike(segs, body.slice(last, idx));
    }
    segs.push({ kind: 'path', text: m[0] });
    last = idx + m[0].length;
  }
  if (last < body.length) pushTextLike(segs, body.slice(last));
  return segs;
}

function pushTextLike(segs: Segment[], slice: string) {
  // Split by code first
  let last = 0;
  const queue: { kind: 'text' | 'code' | 'bold'; text: string }[] = [];
  for (const m of slice.matchAll(CODE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) queue.push({ kind: 'text', text: slice.slice(last, idx) });
    queue.push({ kind: 'code', text: m[1] });
    last = idx + m[0].length;
  }
  if (last < slice.length) queue.push({ kind: 'text', text: slice.slice(last) });

  // Now within each plain text segment, split on **bold**
  for (const q of queue) {
    if (q.kind !== 'text') {
      segs.push(q);
      continue;
    }
    let l = 0;
    for (const m of q.text.matchAll(BOLD_RE)) {
      const idx = m.index ?? 0;
      if (idx > l) segs.push({ kind: 'text', text: q.text.slice(l, idx) });
      segs.push({ kind: 'bold', text: m[1] });
      l = idx + m[0].length;
    }
    if (l < q.text.length) segs.push({ kind: 'text', text: q.text.slice(l) });
  }
}
