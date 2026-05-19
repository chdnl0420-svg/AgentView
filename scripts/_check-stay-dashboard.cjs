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
  // Sample several scans rapidly to catch flicker
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const r = await evalJs("window.av.sessions.list().then((r) => r.sessions.map((s) => s.sessionId.slice(0,8)))");
    samples.push(r);
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('Sample 1:', samples[0].length, samples[0].sort().join(' '));
  console.log('Sample 2:', samples[1].length, samples[1].sort().join(' '));
  console.log('Sample 3:', samples[2].length, samples[2].sort().join(' '));
  console.log('Sample 4:', samples[3].length, samples[3].sort().join(' '));
  console.log('Sample 5:', samples[4].length, samples[4].sort().join(' '));
  console.log('Sample 6:', samples[5].length, samples[5].sort().join(' '));
  ws.close();
})();
