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

  // Pick the first alive bg session for our test
  const target = await evalJs(`
    window.av.sessions.list().then((r) => {
      const s = r.sessions.find((x) => x.alive);
      return s ? { sid: s.sessionId, cwd: s.cwd, name: s.name } : null;
    })
  `);
  if (!target) { console.log('NO alive session'); process.exit(1); }
  console.log('target session:', target.sid.slice(0,8), target.name);

  // Find the jsonl path
  const cwdEnc = (target.cwd || '').replace(/[\/:]/g, '-');
  const jsonl = path.join(os.homedir(), '.claude', 'projects', cwdEnc, target.sid + '.jsonl');
  console.log('jsonl:', jsonl);
  const beforeSize = fs.existsSync(jsonl) ? fs.statSync(jsonl).size : 0;
  console.log('jsonl size before:', beforeSize);

  // Bounce back to dashboard, then enter the target session
  await evalJs("(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()");
  await new Promise((r) => setTimeout(r, 400));
  // Click the matching card
  const clicked = await evalJs(`(()=>{
    const cards = [...document.querySelectorAll('.cards > *')];
    const c = cards.find((c) => (c.textContent || '').includes(${JSON.stringify(target.sid.slice(0,8))}));
    if (c) { c.click(); return true; }
    // fallback: click first card
    cards[0].click();
    return false;
  })()`);
  await new Promise((r) => setTimeout(r, 700));

  // Count user-text bubbles BEFORE
  const beforeBubbles = await evalJs(`document.querySelectorAll('.msg.user').length`);
  console.log('user bubbles before:', beforeBubbles);

  // Type the test message
  await evalJs("(()=>{ const ta = document.querySelector('.input-bar textarea.input-box'); if (ta) ta.focus(); })()");
  await new Promise((r) => setTimeout(r, 200));
  const testText = 'AV-OPTIMISTIC-TEST-' + Date.now();
  for (const ch of testText) { await call('Input.insertText', { text: ch }); await new Promise((r)=>setTimeout(r,3)); }
  await new Promise((r) => setTimeout(r, 250));

  // Click send (or Ctrl+Enter)
  await evalJs("(()=>{ const b=[...document.querySelectorAll('.input-send .btn.primary')].find((b)=>/이어서|↗|보내|시작/.test(b.textContent||'')); if (b && !b.disabled) b.click(); })()");

  // Wait up to 800ms for optimistic bubble
  let optimisticVisible = false;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const seen = await evalJs(`!![...document.querySelectorAll('.msg.user .content')].find((el)=>(el.textContent||'').includes(${JSON.stringify(testText)}))`);
    if (seen) { optimisticVisible = true; console.log('  optimistic bubble visible at ~' + ((i+1)*100) + 'ms'); break; }
  }

  // Wait up to 30s for the message to land in jsonl
  let inJsonl = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const text = fs.readFileSync(jsonl, 'utf8');
      if (text.includes(testText)) { inJsonl = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 800));
  }
  console.log('jsonl received message?', inJsonl, '(size:', fs.statSync(jsonl).size, ')');
  console.log('optimistic visible?', optimisticVisible);

  if (optimisticVisible && inJsonl) {
    console.log('PASS — optimistic UI + real jsonl delivery confirmed');
    process.exit(0);
  }
  console.log('FAIL — optimistic=' + optimisticVisible + ' jsonl=' + inJsonl);
  process.exit(1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
