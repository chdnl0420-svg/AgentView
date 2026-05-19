// Verify the new bg worker appears in AgentView's session grid.
const WebSocket = require('ws');
const http = require('http');

function get(u) {
  return new Promise((res, rej) => {
    http.get(u, (r) => { let b=''; r.on('data',(c)=>b+=c); r.on('end',()=>res(b)); }).on('error', rej);
  });
}

(async () => {
  const list = JSON.parse(await get('http://localhost:9222/json'));
  const target = list.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
  if (!target) { console.error('no page target'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
  });
  function call(method, params={}) {
    const i = ++id;
    return new Promise((res, rej) => {
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async function evalJs(e) {
    const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  }
  await call('Runtime.enable');
  // First click "뒤로" to go back to the dashboard if we're in a session detail.
  await evalJs(`(()=>{
    const b = document.querySelector('button.back');
    if (b) b.click();
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  // Force a reload of the session list.
  await evalJs(`window.av.sessions.list().then(r => window._lastScan = r)`);
  await new Promise((r) => setTimeout(r, 500));
  // Read the grid cards.
  const v = await evalJs(`(()=>{
    const cards = [...document.querySelectorAll('.cards .session-card, .cards > *')];
    return {
      grid: cards.length,
      cards: cards.slice(0, 12).map((c) => (c.textContent || '').replace(/\\s+/g, ' ').slice(0, 80))
    };
  })()`);
  console.log('Grid card count:', v.grid);
  console.log('Sample cards:');
  v.cards.forEach((c, i) => console.log(' ', i, c));
  // Also dump the raw scan.
  const scan = await evalJs(`(()=>{
    const r = window._lastScan;
    if (!r) return { error: 'no scan cache' };
    return r.sessions.map((s) => ({
      short: s.sessionId.slice(0,8),
      kind: s.kind,
      alive: s.alive,
      status: s.status,
      name: s.name,
      cwd: s.cwd
    }));
  })()`);
  console.log('\nIPC sessions.list() returned', scan.length, 'sessions:');
  scan.forEach((s) => console.log(' ', s.short, 'kind=' + s.kind, 'alive=' + s.alive, 'status=' + s.status, '"' + (s.name || '?') + '"', s.cwd));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
