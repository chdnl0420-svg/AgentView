// Message bubble renderers extracted from SessionDetail.tsx. Owns the
// per-message visual concerns (user / assistant / tool_use / tool_result
// / meta) plus the tool-group collapsing logic. SessionDetail proper now
// only orchestrates state and renders headers + the composer.

import React, { useState } from 'react';
import type { ConversationMessage } from '@shared/types';
import { renderMarkdown } from '../lib/markdown';
import {
  isAskUserQuestionInput,
  parseAskUserQuestionResult,
  summarizeToolResult,
  summarizeToolUse
} from '../lib/toolSummary';
import {
  cleanUserMessage,
  isEmptyUserMessage,
  segmentBody,
  type Segment
} from '../lib/userMessage';
import {
  appendAttachmentsToPrompt,
  basename,
  fileUrl,
  iconFor,
  isImage
} from '../lib/attachments';
import { formatRelative } from '../lib/format';
import {
  answerSummary,
  roleInitial,
  roleLabel,
  stringifyInput
} from './SessionDetailFormatters';
import type { QueuedPrompt } from './SessionDetail';

function BubbleFooter({ ts, copyText }: { ts?: number; copyText: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bubble-foot">
      <button
        type="button"
        className="bubble-copy"
        onClick={async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(copyText);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            /* clipboard blocked */
          }
        }}
        title="메시지 복사"
        aria-label="메시지 복사"
      >
        {copied ? '✓ 복사됨' : '⧉ 복사'}
      </button>
      <span className="bubble-time">{ts ? formatRelative(ts) : ''}</span>
    </div>
  );
}

export function MessageBubble({
  m,
  fresh,
  onAnswer
}: {
  m: ConversationMessage;
  fresh: boolean;
  onAnswer?: (text: string) => void | Promise<void>;
}) {
  const role = m.role;
  const avatar = roleInitial(role);

  if (m.kind === 'tool_use') {
    return <ToolUseBubble m={m} fresh={fresh} onAnswer={onAnswer} />;
  }
  if (m.kind === 'tool_result') {
    return <ToolResultBubble m={m} fresh={fresh} />;
  }
  if (m.kind === 'meta') {
    return (
      <div className="msg meta">
        <div className="avatar">i</div>
        <div className={`bubble ${fresh ? 'fresh' : ''}`}>
          <div className="content">{m.text}</div>
          <BubbleFooter ts={m.ts} copyText={m.text} />
        </div>
      </div>
    );
  }

  if (role === 'user') {
    return <UserBubble m={m} fresh={fresh} />;
  }

  const html = role === 'assistant' ? renderMarkdown(m.text) : null;
  return (
    <div className={`msg ${role}`}>
      <div className="avatar">{avatar}</div>
      <div className={`bubble ${fresh ? 'fresh' : ''}`}>
        <div className="role-line">{roleLabel(role)}</div>
        {html ? (
          <div className="content markdown" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="content">{m.text || '(빈 메시지)'}</div>
        )}
        <BubbleFooter ts={m.ts} copyText={m.text} />
      </div>
    </div>
  );
}

function UserBubble({ m, fresh }: { m: ConversationMessage; fresh: boolean }) {
  const cleaned = cleanUserMessage(m.text);
  if (isEmptyUserMessage(cleaned)) return null;
  return (
    <div className="msg user">
      <div className="avatar">나</div>
      <div className={`bubble ${fresh ? 'fresh' : ''}`}>
        <div className="role-line">사용자</div>
        {cleaned.attachments.length > 0 && (
          <AttachmentGroup paths={cleaned.attachments} />
        )}
        {cleaned.command && (
          <div className="cmd-chip">
            <span className="cmd-slash">/</span>
            <span className="cmd-name">{cleaned.command.name}</span>
          </div>
        )}
        {cleaned.body && (
          <div className="content user-text">
            {segmentBody(cleaned.body).map((s, i) => (
              <SegmentSpan key={i} seg={s} />
            ))}
          </div>
        )}
        <BubbleFooter ts={m.ts} copyText={cleaned.body || m.text} />
      </div>
    </div>
  );
}

function AttachmentGroup({ paths }: { paths: string[] }) {
  // Collapsed by default so a screenshot-heavy message doesn't blow out the
  // bubble. Expanded → one row per file with thumbnail + full path so the
  // user can verify what got attached.
  const [open, setOpen] = useState(paths.length <= 2);
  if (paths.length === 0) return null;
  return (
    <div className={`att-group ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="att-group-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="att-group-chev">{open ? '▾' : '▸'}</span>
        <span className="att-group-icon">📎</span>
        <span className="att-group-count">첨부 {paths.length}개</span>
        {!open && (
          <span className="att-group-preview">
            {paths.slice(0, 3).map((p) => basename(p)).join(', ')}
            {paths.length > 3 && ` 외 ${paths.length - 3}개`}
          </span>
        )}
      </button>
      {open && (
        <ul className="att-group-list">
          {paths.map((p) => (
            <li key={p} className="att-group-row">
              <UserAttachment path={p} />
              <div className="att-group-meta">
                <a
                  className="att-group-name"
                  href={fileUrl(p)}
                  target="_blank"
                  rel="noreferrer"
                  title={p}
                >
                  {basename(p)}
                </a>
                <span className="att-group-path" title={p}>{p}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SEG_URL_RE = /(https?:\/\/[^\s<)\]]+|www\.[A-Za-z0-9][^\s<)\]]*)/gi;

function autolinkText(text: string): React.ReactNode {
  if (!text) return null;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  SEG_URL_RE.lastIndex = 0;
  while ((m = SEG_URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let url = m[0];
    let trailing = '';
    while (/[).,!?;:]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    const href = /^https?:/i.test(url) ? url : `https://${url}`;
    out.push(
      <a
        key={`u-${m.index}`}
        className="kw kw-url"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {url}
      </a>
    );
    if (trailing) out.push(trailing);
    last = m.index + m[0].length;
  }
  if (last === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function SegmentSpan({ seg }: { seg: Segment }) {
  switch (seg.kind) {
    case 'text':
      return <span>{autolinkText(seg.text)}</span>;
    case 'path':
      return (
        <a
          className="kw kw-path"
          title={`${seg.text} — 클릭해 파일/폴더 열기`}
          href="#"
          onClick={(e) => {
            e.preventDefault();
            void window.av.shell.openPath(seg.text).catch(() => undefined);
          }}
        >{seg.text}</a>
      );
    case 'code':
      return <code className="kw kw-code">{seg.text}</code>;
    case 'bold':
      return <strong className="kw kw-bold">{seg.text}</strong>;
  }
}

export function QueuedBubble({ item, onRemove }: { item: QueuedPrompt; onRemove: () => void }) {
  // The queued message hasn't been sent yet, so the agent hasn't seen the
  // attachments either — we recompose the same `@`-prefixed prompt the
  // composer would, so the copy button gives the user the exact text that
  // will eventually land in the chat.
  const copyText = item.attachments.length > 0
    ? appendAttachmentsToPrompt(item.prompt, item.attachments)
    : item.prompt;
  return (
    <div className="msg user queued">
      <div className="avatar">나</div>
      <div className="bubble queued-bubble">
        <div className="role-line">
          <span className="queued-badge">⏳ 예약 전송</span>
          <button
            type="button"
            className="queued-remove"
            onClick={onRemove}
            title="예약 취소 — 메시지를 입력창에 다시 가져옵니다"
            aria-label="예약 취소"
          >
            ×
          </button>
        </div>
        {item.attachments.length > 0 && (
          <AttachmentGroup paths={item.attachments} />
        )}
        {item.prompt && <div className="content user-text">{item.prompt}</div>}
        <BubbleFooter ts={item.createdAt} copyText={copyText} />
      </div>
    </div>
  );
}

function UserAttachment({ path }: { path: string }) {
  const label = `${basename(path)}\n${path}`;
  if (isImage(path)) {
    return (
      <a
        className="msg-att msg-att-image"
        href={fileUrl(path)}
        target="_blank"
        rel="noreferrer"
        title={label}
      >
        <img src={fileUrl(path)} alt={basename(path)} />
      </a>
    );
  }
  return (
    <a
      className="msg-att msg-att-file"
      href={fileUrl(path)}
      target="_blank"
      rel="noreferrer"
      title={label}
    >
      <span className="msg-att-icon">{iconFor(path)}</span>
    </a>
  );
}

function ToolUseBubble({
  m,
  fresh,
  onAnswer
}: {
  m: ConversationMessage;
  fresh: boolean;
  onAnswer?: (text: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = m.toolName ?? 'tool';
  const summary = summarizeToolUse(name, m.toolInput);
  const askInput = isAskUserQuestionInput(name, m.toolInput);
  void onAnswer;
  return (
    <div className="msg tool">
      <div className="avatar">⚙</div>
      <div className={`bubble tool-bubble ${fresh ? 'fresh' : ''}`}>
        <button
          type="button"
          className="tool-header"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="tool-chev">{expanded ? '▾' : '▸'}</span>
          <span className="tool-name">🔧 {name}</span>
          {summary && <span className="tool-summary">{summary}</span>}
        </button>
        {expanded && (
          askInput ? (
            <div className="tool-detail ask">
              {askInput.questions.map((q, i) => (
                <div className="ask-q" key={i}>
                  {q.header && <div className="ask-header">{q.header}</div>}
                  <div className="ask-question">{q.question}</div>
                  {q.options && q.options.length > 0 && (
                    <ul className="ask-options">
                      {q.options.map((o, oi) => (
                        <li key={oi}>
                          <strong>{o.label}</strong>
                          {o.description && <span> — {o.description}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ) : (
            m.toolInput !== undefined && (
              <pre className="tool-input">{stringifyInput(m.toolInput)}</pre>
            )
          )
        )}
        <BubbleFooter
          ts={m.ts}
          copyText={`${m.toolName ?? 'tool'}\n${stringifyInput(m.toolInput)}`}
        />
      </div>
    </div>
  );
}

// researcher item #76 — flag tool_result bubbles that look like errors
// with a red accent border so failures jump out instead of blending
// into the long tool-call stack. Matches common claude-cli error
// patterns plus a generic "Error: …" prefix.
function looksLikeError(text: string | undefined): boolean {
  if (!text) return false;
  const s = text.slice(0, 400);
  return /\b(error|exception|traceback|fatal|failed|cannot|denied|forbidden|timeout)\b/i.test(s)
    || /^\s*Error[:\s]/i.test(s)
    || /^\s*\[[A-Z]+\]\s*Error/.test(s);
}

function ToolResultBubble({ m, fresh }: { m: ConversationMessage; fresh: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const answer = parseAskUserQuestionResult(m.text);
  const summary = answer ? answerSummary(answer) : summarizeToolResult(m.text || '');
  const label = answer ? '🙋 사용자 답변' : '↩ 결과';
  const isError = !answer && looksLikeError(m.text);
  return (
    <div className={`msg tool ${isError ? 'tool-error' : ''}`}>
      <div className="avatar">{isError ? '⚠' : '↩'}</div>
      <div className={`bubble tool-bubble ${fresh ? 'fresh' : ''} ${isError ? 'tool-bubble-error' : ''}`}>
        <button
          type="button"
          className="tool-header"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="tool-chev">{expanded ? '▾' : '▸'}</span>
          <span className="tool-name">{label}</span>
          {summary && <span className="tool-summary">{summary}</span>}
        </button>
        {expanded && (
          answer ? (
            <div className="tool-detail ask">
              {Object.entries(answer).map(([q, a]) => (
                <div className="ask-q" key={q}>
                  <div className="ask-header">질문</div>
                  <div className="ask-question">{q}</div>
                  <div className="ask-header">답변</div>
                  <div className="ask-answer">{a}</div>
                </div>
              ))}
            </div>
          ) : (
            <pre className="tool-output">{m.text || '(결과 없음)'}</pre>
          )
        )}
        <BubbleFooter ts={m.ts} copyText={m.text || ''} />
      </div>
    </div>
  );
}

// Render the chat scroll with consecutive tool_use / tool_result messages
// collapsed into a single 1-line group header. Click the header to expand
// and see every tool bubble inside.
export function renderMessages(
  messages: ConversationMessage[],
  freshIds: Set<string>,
  sessionId: string,
  onAnswer: (text: string) => void | Promise<void>
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.kind === 'tool_use' || m.kind === 'tool_result') {
      const group: ConversationMessage[] = [m];
      let j = i + 1;
      while (
        j < messages.length &&
        (messages[j].kind === 'tool_use' || messages[j].kind === 'tool_result')
      ) {
        group.push(messages[j]);
        j++;
      }
      const groupFresh = group.some((g) => freshIds.has(g.uuid));
      out.push(
        <ToolGroup
          key={`tg-${m.uuid}`}
          items={group}
          freshIds={freshIds}
          fresh={groupFresh}
          onAnswer={onAnswer}
        />
      );
      i = j;
      continue;
    }
    out.push(
      <MessageBubble key={m.uuid} m={m} fresh={freshIds.has(m.uuid)} onAnswer={onAnswer} />
    );
    i++;
  }
  // sessionId is reserved for future per-group keying; reference once to
  // satisfy strict unused-arg checking.
  void sessionId;
  return out;
}

function ToolGroup({
  items,
  freshIds,
  fresh,
  onAnswer
}: {
  items: ConversationMessage[];
  freshIds: Set<string>;
  fresh: boolean;
  onAnswer: (text: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const toolUses = items.filter((m) => m.kind === 'tool_use');
  const lastTool = toolUses[toolUses.length - 1];
  const lastToolName = lastTool?.toolName ?? '도구';
  // Ship the verbose summary inline so the aggregate header reads
  // "도구 N회 · 최근: Read src/foo.ts" rather than the bare tool name. The
  // summarizer already encodes file paths / commands / queries safely.
  const lastToolBlurb = lastTool
    ? summarizeToolUse(lastTool.toolName ?? '', lastTool.toolInput)
    : '';
  const askUnanswered = items.find(
    (m) => m.kind === 'tool_use' && isAskUserQuestionInput(m.toolName ?? '', m.toolInput)
  );
  // Force-expand if there's an unanswered AskUserQuestion — the user can't
  // answer if the group is collapsed.
  const effectiveExpanded = expanded || !!askUnanswered;
  return (
    <div className={`msg tool tool-group ${fresh ? 'fresh-group' : ''}`}>
      <div className="avatar">⚙</div>
      <div className="bubble tool-bubble tool-group-bubble">
        <button
          type="button"
          className="tool-header tool-group-header"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={effectiveExpanded}
        >
          <span className="tool-chev">{effectiveExpanded ? '▾' : '▸'}</span>
          <span className="tool-name">
            🔧 도구 {toolUses.length}회 · 최근: {lastToolName}
            {lastToolBlurb ? (
              <span className="tool-blurb" style={{ marginLeft: 6, color: 'var(--muted, #9aa1ad)', fontWeight: 400 }}>
                {lastToolBlurb}
              </span>
            ) : null}
          </span>
          {askUnanswered && (
            <span className="tool-summary" style={{ color: 'var(--accent)' }}>
              ❓ 응답 대기
            </span>
          )}
        </button>
        {effectiveExpanded && (
          <div className="tool-group-body">
            {items.map((m) => (
              <MessageBubble
                key={m.uuid}
                m={m}
                fresh={freshIds.has(m.uuid)}
                onAnswer={onAnswer}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
