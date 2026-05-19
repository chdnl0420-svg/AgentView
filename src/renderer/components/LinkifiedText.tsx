// LinkifiedText — swaps file-path and url substrings of an arbitrary text
// blob into clickable spans. Used as a *post-processor* on rendered
// markdown nodes so assistant bodies get the same file-link affordances
// as user bubbles.
//
// Click  : opens FilePreviewModal (when onPathClick provided), else
//          falls back to window.av.shell.openPath.
// RightClick: opens PathContextMenu via onPathContext callback.

import React from 'react';
import { segmentBody, type Segment } from '../lib/userMessage';

interface LinkifiedTextProps {
  text: string;
  onPathClick?: (path: string) => void;
  onPathContext?: (path: string, x: number, y: number) => void;
}

// URL detection mirrors SegmentSpan's autolinkText in SessionDetail.tsx
// but kept local so this component is portable.
const URL_RE = /(https?:\/\/[^\s<)\]]+|www\.[A-Za-z0-9][^\s<)\]]*)/gi;

function PathLink({
  path,
  onPathClick,
  onPathContext
}: {
  path: string;
  onPathClick?: (path: string) => void;
  onPathContext?: (path: string, x: number, y: number) => void;
}) {
  return (
    <a
      className="kw kw-path"
      title={`${path} — 클릭해 미리보기 · 우클릭으로 메뉴`}
      href="#"
      onClick={(e) => {
        e.preventDefault();
        if (onPathClick) onPathClick(path);
        else void window.av.shell.openPath(path).catch(() => undefined);
      }}
      onContextMenu={(e) => {
        if (!onPathContext) return;
        e.preventDefault();
        onPathContext(path, e.clientX, e.clientY);
      }}
    >
      {path}
    </a>
  );
}

function renderTextWithUrls(text: string): React.ReactNode[] {
  if (!text) return [text];
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
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
  if (last < text.length) out.push(text.slice(last));
  if (out.length === 0) out.push(text);
  return out;
}

export function LinkifiedText({ text, onPathClick, onPathContext }: LinkifiedTextProps) {
  const segs: Segment[] = segmentBody(text);
  return (
    <>
      {segs.map((s, i) => {
        switch (s.kind) {
          case 'path':
            return (
              <PathLink
                key={i}
                path={s.text}
                onPathClick={onPathClick}
                onPathContext={onPathContext}
              />
            );
          case 'code':
            return <code key={i} className="kw kw-code">{s.text}</code>;
          case 'bold':
            return <strong key={i} className="kw kw-bold">{s.text}</strong>;
          case 'text':
          default:
            return <React.Fragment key={i}>{renderTextWithUrls(s.text)}</React.Fragment>;
        }
      })}
    </>
  );
}
