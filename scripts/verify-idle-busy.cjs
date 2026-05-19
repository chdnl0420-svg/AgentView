// Verifies: a session whose status tag says 대기 (idle) does NOT show the
// 작업 중 thinking indicator in its detail view, and the composer is free
// to send (not in cancel mode).
const http = require('node:http');
const WebSocket = require('ws');

const fetchJson = (url) =>
  new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

async function main() {
  const tabs = await fetchJson('http://127.0.0.1:9222/json/list');
  const page = tabs.find((t) => t.type === 'page' && t.url.startsWith('http://localhost'));
  if (!page) { console.error('no AgentView page'); process.exit(1); }
  console.log('attached:', page.title);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));

  let id = 0;
  const inflight = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString('utf8'));
    if (msg.id != null && inflight.has(msg.id)) {
      const { resolve, reject } = inflight.get(msg.id);
      inflight.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (m, p) => new Promise((resolve, reject) => {
    const mid = ++id;
    inflight.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method: m, params: p || {} }));
  });
  await send('Runtime.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { try { return JSON.stringify(${expr}); } catch (e) { return JSON.stringify({ error: String(e) }); } })()`,
      returnByValue: true,
      awaitPromise: true
    });
    try { return JSON.parse(r.result.value); } catch { return r.result.value; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Activate the 대기 filter so only idle/waiting cards remain visible.
  await ev(`(() => {
    const all = Array.from(document.querySelectorAll('.filters button'));
    for (const b of all) if (b.classList.contains('primary') && !b.textContent.trim().startsWith('대기')) b.click();
    const w = all.find((b) => b.textContent.trim().startsWith('대기'));
    if (w && !w.classList.contains('primary')) w.click();
    return true;
  })()`);
  await sleep(400);

  // Pick the first card whose status-tag text contains '대기'.
  const picked = await ev(`(() => {
    const cards = Array.from(document.querySelectorAll('.session-card'));
    const idle = cards.find((c) => (c.querySelector('.status-tag')?.textContent || '').includes('대기'));
    if (!idle) return null;
    idle.click();
    return idle.querySelector('.card-title')?.textContent?.trim() || '(no title)';
  })()`);
  console.log('clicked idle card:', picked);
  if (!picked) {
    console.log('no 대기 card available — skipping test');
    process.exit(0);
  }
  await sleep(700);
  const thinkingShown = await ev(`!!document.querySelector('.thinking-line, .thinking-dots')`);
  const sendBtnLabel = await ev(`(() => {
    const btn = document.querySelector('.input-bar .btn.primary, .input-bar .btn.danger');
    return btn ? btn.textContent.trim() : null;
  })()`);
  const cancelMode = await ev(`!!document.querySelector('.input-bar .btn.danger')`);
  const statusTag = await ev(`(() => {
    const t = document.querySelector('.detail-head .status-tag');
    return t ? t.textContent.trim() : null;
  })()`);

  console.log('detail status tag:', statusTag);
  console.log('thinking indicator visible:', thinkingShown);
  console.log('send button label:', sendBtnLabel);
  console.log('cancel mode active:', cancelMode);

  const pass = !thinkingShown && !cancelMode;
  console.log('\nVERDICT:', pass ? 'PASS — idle card no longer renders as busy' : 'FAIL');

  // Back to grid
  await ev(`(() => {
    const b = Array.from(document.querySelectorAll('.detail-page .btn')).find((x) => x.textContent.trim().startsWith('← 뒤로'));
    b?.click();
    return true;
  })()`);
  ws.close();
  process.exit(pass ? 0 : 2);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
