const WebSocket = require('ws');
const http = require('http');
function get(u){return new Promise((r1,r2)=>{http.get(u,(r)=>{let b='';r.on('data',(c)=>b+=c);r.on('end',()=>r1(b))}).on('error',r2)})}
(async () => {
  const list = JSON.parse(await get('http://localhost:9222/json'));
  const t = list.find((x) => x.type === 'page' && /index\.html/.test(x.url || ''));
  if (!t) { console.error('NO PAGE'); process.exit(1); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (raw) => { const m=JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); } });
  function call(method, params={}) { const i=++id; return new Promise((res,rej)=>{pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}))})}
  async function evalJs(e) { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; }
  await call('Runtime.enable');

  // Step 1: go to dashboard, select all tabs
  await evalJs("(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()");
  await new Promise((r) => setTimeout(r, 400));
  await evalJs("[...document.querySelectorAll('.filters .btn.sm')].forEach((t)=>{ if(t.getAttribute('aria-pressed')==='false') t.click() })");
  await new Promise((r) => setTimeout(r, 300));

  // Step 2: get the first card's sessionId-derived data + original title
  const before = await evalJs(`(()=>{
    const card = document.querySelector('.cards > *');
    if (!card) return null;
    return {
      title: (card.querySelector('.card-title')?.textContent || '').trim(),
      raw: (card.textContent || '').slice(0, 60)
    };
  })()`);
  if (!before) { console.error('NO CARD'); process.exit(1); }
  console.log('BEFORE rename — card title:', JSON.stringify(before.title));

  // Step 3: click the card to enter detail
  await evalJs("document.querySelector('.cards > *').click()");
  await new Promise((r) => setTimeout(r, 700));

  // Step 4: click the title edit pencil
  await evalJs("(()=>{ const btn=document.querySelector('.title-edit-btn'); if (btn) btn.click(); })()");
  await new Promise((r) => setTimeout(r, 300));

  // Step 5: clear the input and type a unique new name
  const newName = '_RENAME_TEST_' + Date.now();
  await evalJs(`(()=>{
    const input = document.querySelector('input.title-edit');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(newName)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  // Press Enter via CDP keyboard
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await new Promise((r) => setTimeout(r, 400));

  // Step 6: go back to dashboard
  await evalJs("(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()");
  await new Promise((r) => setTimeout(r, 600));

  // Step 7: read the first card's title again
  const after = await evalJs(`(()=>{
    const card = document.querySelector('.cards > *');
    if (!card) return null;
    return (card.querySelector('.card-title')?.textContent || '').trim();
  })()`);
  console.log('AFTER rename  — card title:', JSON.stringify(after));
  console.log('Expected new name:', JSON.stringify(newName));
  if (after && after.includes('_RENAME_TEST_')) {
    console.log('PASS — grid card title reflects the rename in real time');
    ws.close();
    process.exit(0);
  } else {
    console.log('FAIL — grid card title did NOT update (still:', JSON.stringify(after), ')');
    ws.close();
    process.exit(1);
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
