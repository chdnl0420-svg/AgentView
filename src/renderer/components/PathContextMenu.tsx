// PathContextMenu — right-click menu attached to a file path. Renders at
// the caret point passed in via { x, y }. ESC or outside-click dismisses.
//
// Actions:
//   - 경로 복사       → navigator.clipboard.writeText(path)
//   - 파일 이름 복사  → basename(path)
//   - 탐색기에서 열기 → window.av.shell.openPath(parentDir)
//   - 파일 복사       → window.av.shell.copyFile(path) (clipboard CF_HDROP)

import React, { useEffect, useRef } from 'react';

export interface PathContextMenuProps {
  path: string;
  x: number;
  y: number;
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

export function PathContextMenu({ path, x, y, onClose }: PathContextMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Dismiss on ESC + outside click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  // Constrain the menu so it never overflows the viewport edge.
  const MENU_W = 220;
  const MENU_H = 188;
  const safeLeft = Math.min(Math.max(8, x), window.innerWidth - MENU_W - 8);
  const safeTop = Math.min(Math.max(8, y), window.innerHeight - MENU_H - 8);

  const onCopyPath = async () => {
    try { await navigator.clipboard.writeText(path); } catch { /* ignore */ }
    onClose();
  };
  const onCopyName = async () => {
    try { await navigator.clipboard.writeText(basename(path)); } catch { /* ignore */ }
    onClose();
  };
  const onOpenInExplorer = async () => {
    // Prefer reveal (highlights file in folder). Fall back to opening the
    // parent directory if reveal isn't available (e.g. path is a directory).
    try {
      // shell.reveal expects a *file* path — most session paths are files.
      const ok = await window.av.sessions.reveal(path).catch(() => false);
      if (!ok) await window.av.shell.openPath(parentDir(path) || path);
    } catch { /* ignore */ }
    onClose();
  };
  const onCopyFile = async () => {
    try { await window.av.shell.copyFile(path); } catch { /* ignore */ }
    onClose();
  };

  return (
    <div
      ref={rootRef}
      className="path-context-menu"
      role="menu"
      style={{ top: safeTop, left: safeLeft }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="path-context-menu-head" title={path}>
        {basename(path) || path}
      </div>
      <button type="button" role="menuitem" className="path-context-menu-item" onClick={onCopyPath}>
        <span className="path-context-menu-icon">📋</span>
        <span>경로 복사</span>
      </button>
      <button type="button" role="menuitem" className="path-context-menu-item" onClick={onCopyName}>
        <span className="path-context-menu-icon">🏷️</span>
        <span>파일 이름 복사</span>
      </button>
      <button type="button" role="menuitem" className="path-context-menu-item" onClick={onOpenInExplorer}>
        <span className="path-context-menu-icon">📂</span>
        <span>탐색기에서 열기</span>
      </button>
      <button type="button" role="menuitem" className="path-context-menu-item" onClick={onCopyFile}>
        <span className="path-context-menu-icon">📁</span>
        <span>파일 복사</span>
      </button>
    </div>
  );
}
