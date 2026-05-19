const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

  // Pick a session
  const sid = await evalJs("window.av.sessions.list().then((r) => r.sessions[0]?.sessionId)");
  if (!sid) { console.log('no sessions'); process.exit(1); }
  const short = sid.slice(0, 8);
  const sf = path.join(os.homedir(), '.claude', 'jobs', short, 'state.json');
  if (!fs.existsSync(sf)) { console.log('no state.json:', sf); process.exit(1); }

  // Read original name
  const before = JSON.parse(fs.readFileSync(sf, 'utf8'));
  const originalName = before.name;
  console.log('short:', short, 'original name:', originalName);

  // Call renameJob via IPC
  const testName = '__CLI_RENAME_TEST__' + Date.now();
  const r1 = await evalJs(`window.av.sessions.renameJob(${JSON.stringify(sid)}, ${JSON.stringify(testName)})`);
  console.log('renameJob result:', r1);

  // Read back state.json
  const after = JSON.parse(fs.readFileSync(sf, 'utf8'));
  console.log('after name:', after.name, 'nameSource:', after.nameSource);

  let pass1 = after.name === testName && after.nameSource === 'user';
  console.log(pass1 ? 'PASS — claude jobs/state.json updated with new name' : 'FAIL');

  // Reset (null = clear override)
  const r2 = await evalJs(`window.av.sessions.renameJob(${JSON.stringify(sid)}, null)`);
  console.log('reset result:', r2);
  const cleared = JSON.parse(fs.readFileSync(sf, 'utf8'));
  console.log('after reset — has name?', 'name' in cleared, 'nameSource:', cleared.nameSource);

  // Restore the original name
  if (originalName) {
    await evalJs(`window.av.sessions.renameJob(${JSON.stringify(sid)}, ${JSON.stringify(originalName)})`);
  }

  process.exit(pass1 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
