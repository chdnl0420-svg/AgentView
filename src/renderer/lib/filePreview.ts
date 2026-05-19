// Renderer-side helper that wraps the main-process file:preview IPC. The
// renderer never reads files directly — the modal asks main for a typed
// payload (markdown/text/html/image/json/binary/too-large). Keeps the
// sandbox boundary clean.

export type FilePreviewKind =
  | 'html'
  | 'markdown'
  | 'text'
  | 'image'
  | 'json'
  | 'binary'
  | 'too-large'
  | 'missing';

export interface FilePreviewResult {
  kind: FilePreviewKind;
  /** UTF-8 string for text/markdown/html/json; base64 data URI for image. */
  content?: string;
  /** Image data URI when kind === 'image'. */
  dataUrl?: string;
  /** Mime type when known. */
  mime?: string;
  /** File size in bytes (when stat succeeded). */
  size?: number;
  /** Human-readable error reason when kind === 'missing'. */
  reason?: string;
}

export async function previewFile(path: string): Promise<FilePreviewResult> {
  // Avoid throwing into render — main returns a typed payload always.
  try {
    const r = (await window.av.file.preview(path)) as FilePreviewResult | null;
    if (!r) return { kind: 'missing', reason: 'preview returned null' };
    return r;
  } catch (err) {
    return {
      kind: 'missing',
      reason: err instanceof Error ? err.message : String(err)
    };
  }
}
