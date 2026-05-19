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
  // Grab any alive bg session via IPC
  const r = await evalJs(`window.av.sessions.list().then((r) => r.sessions[0]?.sessionId)`);
  if (!r) { console.log('no sessions'); process.exit(1); }
  console.log('test sid:', r.slice(0,8));
  // watchOutput should resolve without throwing
  const watchRes = await evalJs(`
    (async () => {
      try {
        await window.av.sessions.watchOutput(${JSON.stringify(r)});
        await window.av.sessions.unwatchOutput(${JSON.stringify(r)});
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message || String(e) };
      }
    })()
  `);
  console.log('watchOutput round-trip:', watchRes);
  if (watchRes.ok) {
    console.log('PASS — watchOutput/unwatchOutput IPC handlers respond');
    process.exit(0);
  } else {
    console.log('FAIL —', watchRes.reason);
    process.exit(1);
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
