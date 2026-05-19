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

  // --- Test 1: Max toggle / bypassPermissions gating ---
  // Go to dashboard
  await evalJs("(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()");
  await new Promise((r) => setTimeout(r, 500));
  const permState = await evalJs(`(()=>{
    const sel = document.querySelector('#perm-select');
    const toggle = document.querySelector('label.max-toggle input');
    if (!sel || !toggle) return { found: false };
    const bypass = [...sel.options].find((o) => o.value === 'bypassPermissions');
    return {
      found: true,
      maxChecked: toggle.checked,
      bypassDisabled: bypass?.disabled ?? null,
      bypassLabel: bypass?.label ?? null
    };
  })()`);
  console.log('Test 1 — Max gate:', permState);
  let test1Pass = permState.found && permState.bypassDisabled === !permState.maxChecked;
  console.log(test1Pass ? '  PASS — bypassPermissions correctly gated by Max toggle' : '  FAIL');

  // Toggle Max on
  await evalJs("document.querySelector('label.max-toggle input').click()");
  await new Promise((r) => setTimeout(r, 200));
  const after = await evalJs(`(()=>{
    const sel = document.querySelector('#perm-select');
    const bypass = [...sel.options].find((o) => o.value === 'bypassPermissions');
    return { maxChecked: document.querySelector('label.max-toggle input').checked, bypassDisabled: bypass.disabled };
  })()`);
  console.log('  after Max toggle on:', after);
  test1Pass = test1Pass && after.maxChecked === true && after.bypassDisabled === false;
  console.log(test1Pass ? '  PASS — Max toggle on => bypassPermissions enabled' : '  FAIL');
  // Toggle back off
  await evalJs("document.querySelector('label.max-toggle input').click()");

  // --- Test 2: Context donut button + panel ---
  // Enter a session detail
  await evalJs("document.querySelector('.cards > *').click()");
  await new Promise((r) => setTimeout(r, 700));
  const donut = await evalJs(`(()=>{
    const btn = document.querySelector('button.context-donut');
    if (!btn) return { found: false };
    btn.click();
    return new Promise((res) => setTimeout(() => {
      const panel = document.querySelector('.context-panel');
      const rows = panel ? [...panel.querySelectorAll('.context-row-label')].map((r) => r.textContent) : [];
      res({ found: true, panelOpen: !!panel, rows });
    }, 200));
  })()`);
  console.log('Test 2 — context donut:', donut);
  const test2Pass = donut.found && donut.panelOpen && donut.rows.length >= 3;
  console.log(test2Pass ? '  PASS — context donut + panel render' : '  FAIL');

  // --- Test 3: Forward button (XButton2 = button=4) ---
  // Go back to dashboard first
  await evalJs("(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()");
  await new Promise((r) => setTimeout(r, 400));
  // Confirm we're on dashboard
  const beforeFwd = await evalJs("({ dashboard: !!document.querySelector('.dashboard'), detail: !!document.querySelector('.detail-page') })");
  // Simulate mouse forward button (button=4) via CDP. Chromium mouse event indices match.
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 100, y: 100, button: 'forward', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 100, y: 100, button: 'forward', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 400));
  const afterFwd = await evalJs("({ dashboard: !!document.querySelector('.dashboard'), detail: !!document.querySelector('.detail-page') })");
  console.log('Test 3 — forward mouse:', { before: beforeFwd, after: afterFwd });
  const test3Pass = beforeFwd.dashboard && !beforeFwd.detail && afterFwd.detail;
  console.log(test3Pass ? '  PASS — mouse forward restored detail view' : '  FAIL — forward did not navigate (CDP button enum may differ)');

  ws.close();
  console.log(`\n${[test1Pass, test2Pass, test3Pass].filter(Boolean).length}/3 tests passed`);
  process.exit(test1Pass && test2Pass && test3Pass ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
