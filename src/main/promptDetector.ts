// Detect inline TUI prompts that claude renders on the agent's terminal.
// Scans a rolling buffer of stripped-ANSI text for the permission gate
// shape: "Do you want to X? 1. Yes / 2. ... / 3. No". Each detected prompt
// is hashed so a stream of repeated PTY frames doesn't re-emit it.

export interface PromptOption {
  key: string;
  label: string;
}

export interface DetectedPrompt {
  id: string;
  question: string;
  options: PromptOption[];
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\]0;[^\x07]*\x07|\x1b[\(\)][A-Z0-9]|\x1b[=>]|\r/g;
const MAX_BUF = 16_000;
const PROMPT_CONFIRM_RE =
  /(?:Do you want to|Do you trust|Would you like to|Approve)\s+([^?\n]{1,300})\?\s*\n([\s\S]{0,800}?)(?=\n\s*\n|Esc to|Tab to|$)/i;
const OPTION_RE = /(?:[›▶❯>]\s*)?(\d+)\.\s+([^\n]{1,200})/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export class PromptScanner {
  private buf = '';
  private lastEmittedId: string | null = null;
  private lastEmittedAt = 0;

  ingest(chunk: string): DetectedPrompt | null {
    this.buf = (this.buf + stripAnsi(chunk)).slice(-MAX_BUF);
    const m = this.buf.match(PROMPT_CONFIRM_RE);
    if (!m) return null;
    const question = (m[0].split('?')[0] + '?').trim();
    const body = m[2] || '';
    const options: PromptOption[] = [];
    for (const om of body.matchAll(OPTION_RE)) {
      options.push({
        key: om[1],
        label: om[2].trim().replace(/\s*\(shift\+tab\)\s*$/i, '')
      });
    }
    if (options.length < 2) return null;
    const id = djb2(question + '|' + options.map((o) => o.label).join('|'));
    const now = Date.now();
    if (id === this.lastEmittedId && now - this.lastEmittedAt < 8000) return null;
    this.lastEmittedId = id;
    this.lastEmittedAt = now;
    return { id, question, options };
  }

  reset(): void {
    this.lastEmittedId = null;
    this.lastEmittedAt = 0;
    this.buf = '';
  }
}

// Usage-quota scanner — captures the "5시간 제한 NN% · MM분 후 초기화"
// and "주간 NN% · MM 후 초기화" lines claude TUI renders at the bottom of
// `claude agents`. These values aren't exposed via any local file claude
// caches; the only way to surface them in AgentView is to scrape the
// rendered TUI text. The scanner runs alongside PromptScanner on the
// same ptySock tail.

export interface UsageQuota {
  fiveHour?: { pct: number; resetIn?: string };
  weekly?: { pct: number; resetIn?: string };
  capturedAt: number;
}

const FIVE_HOUR_RE =
  /5\s*시간(?:\s*제한)?\s*(\d{1,3})%(?:\s*[·•\.,]?\s*([^\n\r]{1,40}?(?:초기화|reset|남음)))?/i;
const WEEKLY_RE =
  /(?:주간(?:[·•\s]*전체\s*모델)?|weekly)\s*(\d{1,3})%(?:\s*[·•\.,]?\s*([^\n\r]{1,40}?(?:초기화|reset|남음)))?/i;

const QUOTA_BUF_MAX = 12_000;

export class UsageQuotaScanner {
  private buf = '';
  private last: UsageQuota | null = null;

  ingest(chunk: string): UsageQuota | null {
    this.buf = (this.buf + chunk.replace(ANSI_RE, '')).slice(-QUOTA_BUF_MAX);
    const five = FIVE_HOUR_RE.exec(this.buf);
    const week = WEEKLY_RE.exec(this.buf);
    if (!five && !week) return null;
    const out: UsageQuota = { capturedAt: Date.now() };
    if (five) {
      out.fiveHour = {
        pct: Math.min(100, parseInt(five[1], 10) || 0),
        resetIn: five[2]?.trim()
      };
    }
    if (week) {
      out.weekly = {
        pct: Math.min(100, parseInt(week[1], 10) || 0),
        resetIn: week[2]?.trim()
      };
    }
    // Dedupe: only emit when the values actually changed.
    if (
      this.last &&
      this.last.fiveHour?.pct === out.fiveHour?.pct &&
      this.last.weekly?.pct === out.weekly?.pct
    ) {
      return null;
    }
    this.last = out;
    return out;
  }

  snapshot(): UsageQuota | null {
    return this.last;
  }
}
