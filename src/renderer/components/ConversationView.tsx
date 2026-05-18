import { useEffect, useRef, useState } from 'react';
import type {
  BgSession,
  ConversationAppend,
  ConversationFile,
  ConversationMessage
} from '@shared/types';
import { formatBytes } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { summarizeToolResult, summarizeToolUse, isAskUserQuestionInput, parseAskUserQuestionResult } from '../lib/toolSummary';

interface ConversationViewProps {
  session: BgSession;
}

export function ConversationView({ session }: ConversationViewProps) {
  const [data, setData] = useState<ConversationFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setFreshIds(new Set());
    window.av.sessions
      .read(session.sessionId)
      .then((conv) => {
        if (!cancelled) setData(conv);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.sessionId]);

  // Start/stop live tailing of this conversation file in main process
  useEffect(() => {
    window.av.sessions.watch(session.sessionId);
    return () => {
      window.av.sessions.unwatch(session.sessionId);
    };
  }, [session.sessionId]);

  // Append new messages as they stream in
  useEffect(() => {
    const off = window.av.sessions.onConversationAppended((evt: ConversationAppend) => {
      if (evt.sessionId !== session.sessionId) return;
      setData((prev) => {
        if (!prev) {
          return {
            sessionId: session.sessionId,
            filePath: evt.filePath,
            messages: evt.newMessages,
            sizeBytes: evt.sizeBytes,
            truncated: false,
            meta: {}
          };
        }
        const seen = new Set(prev.messages.map((m) => m.uuid));
        const additions = evt.newMessages.filter((m) => !seen.has(m.uuid));
        if (additions.length === 0) {
          return { ...prev, sizeBytes: evt.sizeBytes };
        }
        return {
          ...prev,
          messages: [...prev.messages, ...additions],
          sizeBytes: evt.sizeBytes
        };
      });
      // mark newly arrived for fresh animation
      setFreshIds((prev) => {
        const next = new Set(prev);
        for (const m of evt.newMessages) next.add(m.uuid);
        return next;
      });
      window.setTimeout(() => {
        setFreshIds((prev) => {
          const next = new Set(prev);
          for (const m of evt.newMessages) next.delete(m.uuid);
          return next;
        });
      }, 1200);
    });
    return off;
  }, [session.sessionId]);

  // Auto scroll when new messages arrive (if not user-scrolled away)
  useEffect(() => {
    if (!autoScroll || !bodyRef.current) return;
    const el = bodyRef.current;
    el.scrollTop = el.scrollHeight;
  }, [data?.messages.length, autoScroll]);

  return (
    <>
      <div className="detail-head">
        <div className="title">
          <h3>{session.name || session.agent || session.sessionId}</h3>
          <div className="meta-row">
            <span>PID {session.pid}</span>
            <span>·</span>
            <span title={session.cwd}>{session.cwd}</span>
            {data && (
              <>
                <span>·</span>
                <span>{data.messages.length}개 메시지 · {formatBytes(data.sizeBytes)}</span>
              </>
            )}
          </div>
        </div>
        <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          자동 스크롤
        </label>
        <button
          className="btn sm"
          onClick={() => session.conversationPath && window.av.sessions.reveal(session.conversationPath)}
          disabled={!session.conversationPath}
          title="대화 파일 위치 열기"
        >
          📁 파일
        </button>
        {session.alive && (
          <button
            className="btn sm danger"
            onClick={async () => {
              if (!confirm(`PID ${session.pid} 세션을 종료할까요?`)) return;
              await window.av.sessions.kill(session.pid);
            }}
            title="세션 강제 종료"
          >
            ⏻ 종료
          </button>
        )}
      </div>
      <div className="detail-body" ref={bodyRef}>
        {loading && <div className="empty-detail">대화 로드 중…</div>}
        {!loading && !data && (
          <div className="empty-detail">
            <div className="icon">💬</div>
            <div>이 세션에 대한 대화 로그를 찾지 못했습니다.</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>세션 ID: {session.sessionId}</div>
          </div>
        )}
        {!loading && data && data.messages.length === 0 && (
          <div className="empty-detail">
            <div className="icon">📭</div>
            <div>아직 메시지가 없습니다. CLI 에서 입력하면 여기에 곧바로 보입니다.</div>
          </div>
        )}
        {!loading && data && data.messages.length > 0 && (
          <div className="conv">
            {data.truncated && (
              <div className="msg meta">
                <div className="avatar">…</div>
                <div className="bubble">
                  <div className="content">이전 메시지가 너무 많아 최근 일부만 표시합니다.</div>
                </div>
              </div>
            )}
            {data.messages.map((m) => (
              <MessageBubble key={m.uuid} m={m} fresh={freshIds.has(m.uuid)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function MessageBubble({ m, fresh }: { m: ConversationMessage; fresh: boolean }) {
  const role = m.role;
  const avatar = roleInitial(role);

  if (m.kind === 'tool_use') {
    return <ToolUseBubble m={m} fresh={fresh} />;
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
        </div>
      </div>
    );
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
      </div>
    </div>
  );
}

function ToolUseBubble({ m, fresh }: { m: ConversationMessage; fresh: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const name = m.toolName ?? 'tool';
  const summary = summarizeToolUse(name, m.toolInput);
  const askInput = isAskUserQuestionInput(name, m.toolInput);
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
      </div>
    </div>
  );
}

function ToolResultBubble({ m, fresh }: { m: ConversationMessage; fresh: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const answer = parseAskUserQuestionResult(m.text);
  const summary = answer
    ? answerSummary(answer)
    : summarizeToolResult(m.text || '');
  const label = answer ? '🙋 사용자 답변' : '↩ 결과';
  return (
    <div className="msg tool">
      <div className="avatar">↩</div>
      <div className={`bubble tool-bubble ${fresh ? 'fresh' : ''}`}>
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
      </div>
    </div>
  );
}

function answerSummary(answers: Record<string, string>): string {
  const entries = Object.entries(answers);
  if (entries.length === 0) return '';
  if (entries.length === 1) return entries[0][1];
  return entries.map(([_, v]) => v).join(' / ');
}

function roleInitial(role: ConversationMessage['role']): string {
  switch (role) {
    case 'user': return '나';
    case 'assistant': return 'AI';
    case 'tool': return '⚙';
    case 'system': return 'S';
    default: return '·';
  }
}
function roleLabel(role: ConversationMessage['role']): string {
  switch (role) {
    case 'user': return '사용자';
    case 'assistant': return '에이전트';
    case 'tool': return '도구';
    case 'system': return '시스템';
    default: return role;
  }
}
function stringifyInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}
