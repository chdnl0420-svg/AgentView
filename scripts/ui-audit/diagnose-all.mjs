// Measure layouts in cards/single/detail modes.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openCdp() {
  const res = await fetch('http://localhost:9222/json/list');
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && (t.url || '').includes('localhost:5173'));
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) { const slot = pending.get(m.id); pending.delete(m.id); slot?.(m); }
  });
  function send(method, params = {}, timeoutMs = 8000) {
    const id = nextId++;
    return new Promise((res, rej) => {
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeoutMs);
    });
  }
  return { ws, send };
}

const { ws, send } = await openCdp();
const evalExpr = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.result?.value;
};
const measure = async (label) => {
  const data = await evalExpr(`(() => {
    const sels = ['body','.app','.dashboard','.dashboard.single','.session-list','.single-workspace','.grid-wrap','.cards','.input-bar','.section-head','.window-chrome','.detail-page','.detail-head','.detail-body'];
    const out = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = null; continue; }
      const rc = el.getBoundingClientRect();
      out[sel] = { top: Math.round(rc.top), left: Math.round(rc.left), w: Math.round(rc.width), h: Math.round(rc.height) };
    }
    out.__viewport = { w: innerWidth, h: innerHeight };
    return out;
  })()`);
  console.log('\n==', label, '==');
  console.log(JSON.stringify(data, null, 2));
};

// Force cards mode first
await evalExpr(`localStorage.setItem('viewMode','cards')`);
await sleep(300);
await measure('cards mode (current state)');

// Click first session card to enter detail
const cardClicked = await evalExpr(`(() => {
  const c = document.querySelector('.cards .session-card');
  if (!c) return 'no card';
  c.click();
  return 'clicked';
})()`);
console.log('\n>> open detail:', cardClicked);
await sleep(700);
await measure('cards mode + detail (selected)');

// Back to grid
await evalExpr(`(() => {
  const back = document.querySelector('.detail-head button[title*="뒤로"], .detail-head .btn');
  if (back) { back.click(); return 'back'; }
  // fallback: dispatch Escape
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return 'escape';
})()`);
await sleep(400);

// Switch to single mode via toggle
await evalExpr(`(() => {
  const btn = document.querySelector('[aria-label="단일화면 모드"]');
  if (btn) btn.click();
  return btn ? 'clicked' : 'no toggle';
})()`);
await sleep(400);
await measure('single mode');

ws.close();
