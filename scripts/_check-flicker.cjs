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
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const sids = await evalJs("window.av.sessions.list().then((r) => r.sessions.map((s) => s.sessionId.slice(0,8)).sort())");
    samples.push(sids);
    await new Promise((r) => setTimeout(r, 400));
  }
  const counts = samples.map((s) => s.length);
  console.log('Sample counts over 3.2s:', counts);
  const baseline = new Set(samples[0]);
  let drifts = 0;
  for (let i = 1; i < samples.length; i++) {
    const set = new Set(samples[i]);
    const onlyLeft = [...baseline].filter((x) => !set.has(x));
    const onlyRight = [...set].filter((x) => !baseline.has(x));
    if (onlyLeft.length || onlyRight.length) {
      drifts++;
      console.log(`  drift at i=${i}: -${onlyLeft.join(',')} +${onlyRight.join(',')}`);
    }
  }
  console.log(drifts === 0 ? 'PASS — no flicker over 3.2s' : `FAIL — ${drifts} drifts detected`);
  ws.close();
})();
