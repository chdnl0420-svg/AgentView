// FilePreviewModal — modal preview for a file path. Asks main via the
// file:preview IPC for a typed result; renders the right surface for the
// kind. HTML uses sandboxed iframe srcdoc so the page can't reach out.

import React, { useEffect, useMemo, useState } from 'react';
import { previewFile, type FilePreviewResult } from '../lib/filePreview';
import { renderMarkdown } from '../lib/markdown';

interface FilePreviewModalProps {
  path: string;
  onClose: () => void;
}

function basename(p: string): string {
  if (!p) return '';
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}
function parentDir(p: string): string {
  if (!p) return '';
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(0, i);
}
function formatBytes(n: number): string {
  if (!n || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreviewModal({ path, onClose }: FilePreviewModalProps) {
  const [state, setState] = useState<{ loading: boolean; result: FilePreviewResult | null }>({
    loading: true,
    result: null
  });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, result: null });
    previewFile(path).then((r) => {
      if (!cancelled) setState({ loading: false, result: r });
    });
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onOpenExternal = async () => {
    await window.av.shell.openPath(path).catch(() => undefined);
  };
  const onRevealParent = async () => {
    await window.av.shell.openPath(parentDir(path) || path).catch(() => undefined);
  };

  return (
    <div
      className="file-preview-modal-backdrop"
      role="dialog"
      aria-label="파일 미리보기"
      onClick={onClose}
    >
      <div className="file-preview-modal" onClick={(e) => e.stopPropagation()}>
        <header className="file-preview-modal-head">
          <div className="file-preview-modal-title" title={path}>
            <span className="file-preview-modal-name">{basename(path)}</span>
            <span className="file-preview-modal-path">{path}</span>
          </div>
          <div className="file-preview-modal-actions">
            <button type="button" className="btn sm" onClick={onRevealParent} title="상위 폴더 열기">
              📂 폴더
            </button>
            <button type="button" className="btn sm" onClick={onOpenExternal} title="기본 프로그램으로 열기">
              ↗ 외부
            </button>
            <button type="button" className="btn sm" onClick={onClose} aria-label="닫기" title="닫기 (ESC)">
              ×
            </button>
          </div>
        </header>
        <div className="file-preview-modal-body">
          {state.loading && <div className="file-preview-modal-loading">불러오는 중…</div>}
          {!state.loading && state.result && (
            <PreviewBody result={state.result} path={path} onOpenExternal={onOpenExternal} />
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewBody({
  result,
  path,
  onOpenExternal
}: {
  result: FilePreviewResult;
  path: string;
  onOpenExternal: () => void;
}) {
  const sizeLabel = useMemo(() => formatBytes(result.size || 0), [result.size]);

  if (result.kind === 'missing') {
    return (
      <div className="file-preview-modal-empty">
        <div>파일을 읽을 수 없습니다.</div>
        {result.reason && <div className="file-preview-modal-reason">{result.reason}</div>}
        <button type="button" className="btn" onClick={onOpenExternal}>
          ↗ 탐색기/기본 프로그램으로 열어보기
        </button>
      </div>
    );
  }

  if (result.kind === 'too-large') {
    return (
      <div className="file-preview-modal-empty">
        <div>용량이 큽니다 ({sizeLabel}). 미리보기 대신 탐색기에서 열어주세요.</div>
        <button type="button" className="btn" onClick={onOpenExternal}>
          ↗ 외부에서 열기
        </button>
      </div>
    );
  }

  if (result.kind === 'image') {
    const src = result.dataUrl || result.content || '';
    return (
      <div className="file-preview-modal-image-wrap">
        <img className="file-preview-modal-image" src={src} alt={basename(path)} />
      </div>
    );
  }

  if (result.kind === 'html') {
    const srcDoc = result.content || '';
    return (
      <iframe
        className="file-preview-modal-iframe"
        sandbox=""
        srcDoc={srcDoc}
        title={basename(path)}
      />
    );
  }

  if (result.kind === 'markdown') {
    const html = renderMarkdown(result.content || '');
    return (
      <div
        className="file-preview-modal-markdown markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  if (result.kind === 'json') {
    let body = result.content || '';
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* keep as-is */
    }
    return <pre className="file-preview-modal-pre">{body}</pre>;
  }

  if (result.kind === 'text') {
    return <pre className="file-preview-modal-pre">{result.content || ''}</pre>;
  }

  // binary
  return (
    <div className="file-preview-modal-empty">
      <div>바이너리 파일입니다 ({sizeLabel}). 미리보기는 지원되지 않습니다.</div>
      <button type="button" className="btn" onClick={onOpenExternal}>
        ↗ 외부에서 열기
      </button>
    </div>
  );
}
