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
  async function evalJs(e) { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result?.value; }
  await call('Runtime.enable');
  await evalJs("(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()");
  await new Promise((r) => setTimeout(r, 400));
  const r = await evalJs(`(() => {
    const samples = ['.session-card', '.tabs button', '.status-tag', '.section-head', '.topbar', '.filters .btn.sm'];
    return samples.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, found: false };
      return { sel, userSelect: getComputedStyle(el).userSelect };
    });
  })()`);
  console.log(JSON.stringify(r, null, 2));
  ws.close();
})();
