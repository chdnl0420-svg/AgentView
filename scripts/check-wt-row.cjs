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
    const rows = [...document.querySelectorAll('.input-bar > .input-controls')];
    return rows.map((r, i) => {
      const children = [...r.children];
      const top = r.getBoundingClientRect().top;
      return {
        rowIndex: i,
        top,
        childCount: children.length,
        children: children.map((c) => {
          const label = c.querySelector('label')?.textContent || c.textContent || '';
          return { cls: c.className, label: label.trim().slice(0, 30) };
        })
      };
    });
  })()`);
  console.log(JSON.stringify(info, null, 2));
  ws.close();
})();
