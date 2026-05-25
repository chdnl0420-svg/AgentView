// Small visual chip used by the InputBar composer to display each
// staged attachment with a thumbnail (images) or icon (other files)
// plus a remove (×) button. Kept stand-alone so it can be reused by
// other composers (e.g., the planned new-session dialog).

import { basename, fileUrl, iconFor, isImage } from '../lib/attachments';

export function AttachmentChip({
  path,
  onRemove
}: {
  path: string;
  onRemove: () => void;
}) {
  const label = `${basename(path)}\n${path}`;
  if (isImage(path)) {
    return (
      <div className="att-chip att-image" title={label}>
        <img src={fileUrl(path)} alt={basename(path)} />
        <button type="button" className="att-x" onClick={onRemove} aria-label="첨부 제거">
          ×
        </button>
      </div>
    );
  }
  return (
    <div className="att-chip att-file" title={label}>
      <span className="att-icon">{iconFor(path)}</span>
      <button type="button" className="att-x" onClick={onRemove} aria-label="첨부 제거">
        ×
      </button>
    </div>
  );
}
