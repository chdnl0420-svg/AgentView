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
  // Force fresh reload through the renderer's own reloadSessions to update React state
  // Find React state via component tree — actually let's just emulate the filter ourselves
  const out = await evalJs(`(async () => {
    const r = await window.av.sessions.list();
    // Apply same filters the renderer uses
    function isEmptyDeadSession(s) {
      if (s.alive) return false;
      if ((s.kind||'').toLowerCase()==='bg') return false;
      const shortId = s.sessionId.slice(0,8).toLowerCase();
      const title = (s.name||s.agent||'').trim().toLowerCase();
      if (!title || title===shortId || /^이름\\s*없음$/.test(title)) return true;
      return false;
    }
    function classify(s) {
      if (s.alive) return s.status==='running' ? 'running' : 'waiting';
      if (s.status==='completed') return 'completed';
      return 'finished';
    }
    const after = r.sessions.filter((s) => !isEmptyDeadSession(s));
    return {
      ipcCount: r.sessions.length,
      afterFilter: after.length,
      filteredOut: r.sessions.filter((s) => isEmptyDeadSession(s)).map((s) => s.sessionId.slice(0,8)+' kind='+s.kind+' alive='+s.alive+' name="'+s.name+'"'),
      buckets: after.reduce((acc, s) => {
        const k = classify(s);
        acc[k] = (acc[k]||0)+1;
        return acc;
      }, {})
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  ws.close();
})();
