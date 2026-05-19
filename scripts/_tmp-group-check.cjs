const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
function get(u){return new Promise((res,rej)=>{http.get(u,(r)=>{let b='';r.on('data',(c)=>b+=c);r.on('end',()=>res(b))}).on('error',rej)})}
(async () => {
  const list = JSON.parse(await get('http://localhost:9222/json'));
  const target = list.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (raw) => { const m=JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); } });
  function call(method, params={}) { const i=++id; return new Promise((res,rej)=>{pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}))})}
  async function evalJs(e) { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; }
  await call('Runtime.enable');
  await call('Page.enable');
  const detail = await evalJs(`!!document.querySelector('.detail-body')`);
  if (!detail) {
    await evalJs(`(()=>{ const c=document.querySelector('.cards > *'); if (c) c.click(); })()`);
    await new Promise((r) => setTimeout(r, 700));
  }
  const stats = await evalJs(`(()=>{
    const groups = [...document.querySelectorAll('.tool-group')];
    const expanded = [...document.querySelectorAll('.tool-group-body')].length;
    return { groupCount: groups.length, expandedGroups: expanded };
  })()`);
  console.log('ToolGroup stats:', stats);
  const r = await call('Page.captureScreenshot', { format: 'png' });
  const file = 'C:/Users/NX3GAMES/Desktop/reports/av-screenshots/tool-group-' + Date.now() + '.png';
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('screenshot:', file);
  ws.close();
})();
