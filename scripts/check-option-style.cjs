const WebSocket = require('ws');
const http = require('http');
function get(u){return new Promise((res,rej)=>{http.get(u,(r)=>{let b='';r.on('data',(c)=>b+=c);r.on('end',()=>res(b))}).on('error',rej)})}
(async () => {
  const list = JSON.parse(await get('http://localhost:9222/json'));
  const target = list.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (raw) => { const m=JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); } });
  function call(method, params={}) { const i=++id; return new Promise((res,rej)=>{pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}))})}
  async function evalJs(e) { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result?.value; }
  await call('Runtime.enable');
  // Bounce back to dashboard if needed
  await evalJs(`(()=>{ const btns=[...document.querySelectorAll('button.btn.sm')]; const back=btns.find((b)=>/뒤로/.test(b.textContent||'')); if (back) back.click(); })()`);
  await new Promise((r) => setTimeout(r, 400));
  const info = await evalJs(`(()=>{
    const selects = [...document.querySelectorAll('.input-controls select')];
    const out = selects.map((s) => {
      const cs = getComputedStyle(s);
      const opts = [...s.options].slice(0, 2).map((o) => {
        const os = getComputedStyle(o);
        return { value: o.value, label: o.label, color: os.color, bg: os.backgroundColor };
      });
      return {
        id: s.id || '(no-id)',
        selectColor: cs.color,
        selectBg: cs.backgroundColor,
        options: opts
      };
    });
    return out;
  })()`);
  console.log(JSON.stringify(info, null, 2));
  ws.close();
})();
