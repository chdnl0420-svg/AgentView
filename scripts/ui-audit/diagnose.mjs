// Diagnose layout: measure .app, .dashboard, .grid-wrap, .input-bar, body
const res = await fetch('http://localhost:9222/json/list');
const targets = await res.json();
const page = targets.find((t) => t.type === 'page' && (t.url || '').includes('localhost:5173'));
if (!page) { console.error('no page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined) { pending.get(m.id)?.(m); pending.delete(m.id); }
});
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
const evalExpr = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.result?.value;
};

// Force cards view first
await evalExpr(`localStorage.setItem('viewMode','cards')`);

const data = await evalExpr(`(() => {
  const ids = ['body', '#root', '.app', '.dashboard', '.grid-wrap', '.cards', '.input-bar', '.section-head', '.window-chrome', '.update-banner', '.spotlight-tour'];
  const out = {};
  for (const sel of ids) {
    const el = sel === 'body' ? document.body : document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[sel] = {
      top: Math.round(r.top), left: Math.round(r.left),
      width: Math.round(r.width), height: Math.round(r.height),
      display: cs.display,
      position: cs.position,
      gridTemplateRows: cs.gridTemplateRows,
      paddingTop: cs.paddingTop,
      overflow: cs.overflow + '/' + cs.overflowY,
      zIndex: cs.zIndex,
    };
  }
  out.__appChildren = Array.from(document.querySelector('.app')?.children || []).map((c, i) => ({
    i, tag: c.tagName.toLowerCase(), cls: c.className.toString().slice(0,80),
    rect: { top: Math.round(c.getBoundingClientRect().top), height: Math.round(c.getBoundingClientRect().height) },
    pos: getComputedStyle(c).position,
  }));
  out.__viewport = { w: window.innerWidth, h: window.innerHeight };
  out.__bodyPadTop = getComputedStyle(document.body).paddingTop;
  return out;
})()`);
console.log(JSON.stringify(data, null, 2));
ws.close();
