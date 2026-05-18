function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(s: string): string {
  let out = escape(s);
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const safeUrl = /^(https?:|mailto:)/.test(url) ? url : '#';
    return `<a href="${escape(safeUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return out;
}

interface Block {
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'ul' | 'ol' | 'code' | 'blockquote' | 'hr' | 'empty';
  content: string;
  items?: string[];
}

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const lines = src.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', content: buf.join('\n') });
      continue;
    }
    if (/^\s*$/.test(line)) { blocks.push({ type: 'empty', content: '' }); i++; continue; }
    if (/^---+\s*$/.test(line)) { blocks.push({ type: 'hr', content: '' }); i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: (`h${h[1].length}` as Block['type']), content: h[2].trim() });
      i++; continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', content: buf.join('\n') });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', content: '', items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', content: '', items });
      continue;
    }
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', content: buf.join(' ') });
  }

  return blocks
    .map((b) => {
      switch (b.type) {
        case 'h1': return `<h1>${renderInline(b.content)}</h1>`;
        case 'h2': return `<h2>${renderInline(b.content)}</h2>`;
        case 'h3': return `<h3>${renderInline(b.content)}</h3>`;
        case 'h4': return `<h4>${renderInline(b.content)}</h4>`;
        case 'p':  return `<p>${renderInline(b.content)}</p>`;
        case 'hr': return '<hr />';
        case 'code': return `<pre><code>${escape(b.content)}</code></pre>`;
        case 'blockquote': return `<blockquote>${renderInline(b.content)}</blockquote>`;
        case 'ul': return `<ul>${(b.items || []).map((it) => `<li>${renderInline(it)}</li>`).join('')}</ul>`;
        case 'ol': return `<ol>${(b.items || []).map((it) => `<li>${renderInline(it)}</li>`).join('')}</ol>`;
        default: return '';
      }
    })
    .join('\n');
}
