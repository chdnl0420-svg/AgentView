function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= n) return clean;
  return clean.slice(0, n) + '…';
}

function basename(p: string): string {
  if (!p) return '';
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

export function summarizeToolUse(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;

  switch (name) {
    case 'Bash':
    case 'PowerShell': {
      const cmd = typeof i.command === 'string' ? i.command : '';
      const desc = typeof i.description === 'string' ? i.description : '';
      // Task 17: "Bash: <command 첫 80자>" — desc remains primary when set.
      if (desc) return `${desc} — ${truncate(cmd, 80)}`;
      return truncate(cmd, 80);
    }
    case 'Read': {
      const fp = typeof i.file_path === 'string' ? i.file_path : '';
      const off = typeof i.offset === 'number' ? (i.offset as number) : null;
      const lim = typeof i.limit === 'number' ? (i.limit as number) : null;
      if (off != null && lim != null) return `${fp}:${off}-${off + lim - 1}`;
      if (off != null) return `${fp}:${off}+`;
      return fp || '';
    }
    case 'Write': {
      const fp = typeof i.file_path === 'string' ? i.file_path : '';
      return fp || '';
    }
    case 'Edit': {
      const fp = typeof i.file_path === 'string' ? i.file_path : '';
      const replaceAll = (i.replace_all === true);
      const edits = Array.isArray((i as { edits?: unknown[] }).edits)
        ? ((i as { edits: unknown[] }).edits).length
        : 0;
      const suffix = edits > 1
        ? ` (${edits} edits)`
        : replaceAll
          ? ' (replace all)'
          : ' (replace 1)';
      return `${fp}${suffix}`;
    }
    case 'NotebookEdit': {
      const fp = typeof i.file_path === 'string' ? i.file_path : '';
      return fp || '';
    }
    case 'Grep': {
      const pat = typeof i.pattern === 'string' ? i.pattern : '';
      const inGlob = typeof i.glob === 'string' && i.glob ? i.glob : '';
      const inPath = typeof i.path === 'string' && i.path ? basename(i.path) : '';
      const scope = inGlob || inPath;
      // Task 17: Grep '<pattern>' in <glob>
      const head = `'${truncate(pat, 60)}'`;
      return scope ? truncate(`${head} in ${scope}`, 120) : head;
    }
    case 'Glob': {
      const pat = typeof i.pattern === 'string' ? i.pattern : '';
      return truncate(pat, 100);
    }
    case 'WebFetch':
    case 'WebSearch': {
      const url = typeof i.url === 'string' ? i.url : '';
      const q = typeof i.query === 'string' ? i.query : '';
      return truncate(url || q, 100);
    }
    case 'AskUserQuestion': {
      const qs = i.questions;
      if (!Array.isArray(qs)) return '질문';
      if (qs.length === 1) {
        const first = qs[0] as { question?: string };
        return truncate(first?.question ?? '질문', 100);
      }
      return `${qs.length}개의 질문`;
    }
    case 'TaskCreate':
    case 'TaskUpdate': {
      const subject = typeof i.subject === 'string' ? i.subject : '';
      const status = typeof i.status === 'string' ? i.status : '';
      const taskId = typeof i.taskId === 'string' ? i.taskId : '';
      if (subject) return truncate(subject, 100);
      if (taskId) return `#${taskId}${status ? ` → ${status}` : ''}`;
      return status;
    }
    case 'Agent':
    case 'Task': {
      const desc = typeof i.description === 'string' ? i.description : '';
      const sub = typeof i.subagent_type === 'string' ? `[${i.subagent_type}] ` : '';
      return truncate(sub + desc, 100);
    }
    case 'Skill': {
      const skill = typeof i.skill === 'string' ? i.skill : '';
      const args = typeof i.args === 'string' ? ` ${i.args}` : '';
      return truncate(`/${skill}${args}`, 100);
    }
    default: {
      // generic: first string-like value
      for (const v of Object.values(i)) {
        if (typeof v === 'string' && v.trim()) return truncate(v, 100);
      }
      return '';
    }
  }
}

/**
 * Returns the absolute file path referenced by a Read/Write/Edit/NotebookEdit
 * tool call (when present). Used to render a clickable chip below the bubble.
 */
export function extractToolFilePath(name: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as Record<string, unknown>;
  if (
    name === 'Read' ||
    name === 'Write' ||
    name === 'Edit' ||
    name === 'NotebookEdit'
  ) {
    return typeof i.file_path === 'string' ? (i.file_path as string) : null;
  }
  return null;
}

export function summarizeToolResult(text: string): string {
  if (!text) return '(결과 없음)';
  const head = truncate(text, 110);
  const lines = text.split(/\r?\n/).filter(Boolean).length;
  return lines > 1 ? `${head} · ${lines}줄` : head;
}

export interface AskQuestionOption {
  label: string;
  description?: string;
}

export interface AskQuestion {
  question: string;
  header?: string;
  options?: AskQuestionOption[];
  multiSelect?: boolean;
}

export function isAskUserQuestionInput(
  name: string,
  input: unknown
): { questions: AskQuestion[] } | null {
  if (name !== 'AskUserQuestion') return null;
  if (!input || typeof input !== 'object') return null;
  const qs = (input as { questions?: unknown }).questions;
  if (!Array.isArray(qs)) return null;
  const out: AskQuestion[] = [];
  for (const q of qs) {
    if (!q || typeof q !== 'object') continue;
    const qo = q as Record<string, unknown>;
    out.push({
      question: typeof qo.question === 'string' ? qo.question : '',
      header: typeof qo.header === 'string' ? qo.header : undefined,
      multiSelect: typeof qo.multiSelect === 'boolean' ? qo.multiSelect : undefined,
      options: Array.isArray(qo.options)
        ? qo.options
            .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
            .map((o) => ({
              label: typeof o.label === 'string' ? o.label : '',
              description: typeof o.description === 'string' ? o.description : undefined
            }))
        : undefined
    });
  }
  return { questions: out };
}

/**
 * AskUserQuestion 의 tool_result 는 보통
 *   "User has answered your questions: \"Question text\"=\"Selected label\""
 * 또는 JSON `{"answers": {...}}` 형태로 옴.
 * 둘 다 인식해서 question → answer 맵으로 반환.
 */
export function parseAskUserQuestionResult(raw: string): Record<string, string> | null {
  if (!raw) return null;
  // JSON path
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.includes('"answers"')) {
    try {
      const obj = JSON.parse(trimmed) as { answers?: unknown };
      if (obj.answers && typeof obj.answers === 'object') {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj.answers as Record<string, unknown>)) {
          out[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
        return Object.keys(out).length > 0 ? out : null;
      }
    } catch {
      /* not JSON */
    }
  }
  // Text path: User has answered your questions: "Q"="A", "Q2"="A2"
  if (raw.includes('User has answered your questions')) {
    const out: Record<string, string> = {};
    const re = /"((?:[^"\\]|\\.)+)"\s*=\s*"((?:[^"\\]|\\.)+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      out[unescape(m[1])] = unescape(m[2]);
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

function unescape(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\n/g, '\n');
}
