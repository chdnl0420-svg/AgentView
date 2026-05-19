const WebSocket = require('ws');
const http = require('http');
function get(u){return new Promise((res,rej)=>{http.get(u,(r)=>{let b='';r.on('data',(c)=>b+=c);r.on('end',()=>res(b))}).on('error',rej)})}
(async () => {
  const list = JSON.parse(await get('http://localhost:9222/json'));
  const target = list.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
  });
  function call(method, params={}) { const i=++id; return new Promise((res,rej)=>{pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}))})}
  async function evalJs(e) { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; }
  await call('Runtime.enable');
  // Fetch scan result raw
  const result = await evalJs(`window.av.sessions.list().then((r) => r.sessions.map((s) => ({short: s.sessionId.slice(0,8), kind: s.kind, alive: s.alive, status: s.status, name: s.name, pid: s.pid})))`);
  console.log('IPC raw scan (', result.length, 'entries):');
  result.forEach((s) => console.log(' ', s));
  ws.close();
})();
