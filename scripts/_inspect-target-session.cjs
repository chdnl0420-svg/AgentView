const WebSocket = require('ws');
const http = require('http');
function get(u){return new Promise((r1,r2)=>{http.get(u,(r)=>{let b='';r.on('data',(c)=>b+=c);r.on('end',()=>r1(b))}).on('error',r2)})}
(async () => {
  const list = JSON.parse(await get('http://localhost:9222/json'));
  const t = list.find((x) => x.type === 'page' && /index\.html/.test(x.url || ''));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (raw) => { const m=JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); } });
  function call(method, params={}) { const i=++id; return new Promise((res,rej)=>{pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}))})}
  async function evalJs(e) { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; }
  await call('Runtime.enable');
  const info = await evalJs("window.av.sessions.list().then((r) => r.sessions.map((s) => ({ short: s.sessionId.slice(0,8), pid: s.pid, alive: s.alive, status: s.status, kind: s.kind, name: s.name || '?', cwd: s.cwd })))");
  console.log('All IPC sessions:');
  info.forEach((s) => console.log('  ' + JSON.stringify(s)));
  const tabs = await evalJs("[...document.querySelectorAll('.filters .btn.sm')].map((t)=>({label:t.textContent.trim(), pressed: t.getAttribute('aria-pressed')}))");
  console.log('\nTabs:', JSON.stringify(tabs));
  const cards = await evalJs("[...document.querySelectorAll('.cards > *')].map((c)=>(c.textContent || '').replace(/\s+/g, ' ').slice(0, 60))");
  console.log('\nVisible cards (' + cards.length + '):');
  cards.forEach((c, i) => console.log('  ' + i + ': ' + c));
  ws.close();
})();
