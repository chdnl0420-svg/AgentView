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

  // Verify preload API surface
  const api = await evalJs(`({
    watchOutput: typeof window.av.sessions.watchOutput,
    unwatchOutput: typeof window.av.sessions.unwatchOutput,
    answerPrompt: typeof window.av.sessions.answerPrompt,
    onPermissionPrompt: typeof window.av.sessions.onPermissionPrompt
  })`);
  console.log('API surface:', api);
  const allFns = Object.values(api).every((v) => v === 'function');
  console.log('All four = function?', allFns);

  // Enter a session detail to verify mount-time watchOutput IPC succeeds.
  // Go to dashboard first
  await evalJs("(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()");
  await new Promise((r) => setTimeout(r, 400));
  await evalJs("document.querySelector('.cards > *').click()");
  await new Promise((r) => setTimeout(r, 600));

  // Manually call watchOutput on a known sessionId — should resolve without throwing
  const tryWatch = await evalJs(`
    (async () => {
      try {
        // Find currently selected session id by looking at the DOM
        const sidText = document.querySelector('.empty-detail [style*="font-size: 12"]')?.textContent || '';
        const m = sidText.match(/[0-9a-f]{8}-[0-9a-f-]+/);
        const sid = m ? m[0] : null;
        if (!sid) return { ok: false, reason: 'no session id visible' };
        await window.av.sessions.watchOutput(sid);
        return { ok: true, sid: sid.slice(0,8) };
      } catch (e) {
        return { ok: false, reason: e.message || String(e) };
      }
    })()
  `);
  console.log('watchOutput IPC:', tryWatch);

  // Manually simulate a permission prompt event from the renderer side by
  // dispatching a synthetic event the SessionDetail listener uses. Since
  // onPermissionPrompt uses ipcRenderer.on under the hood, we cannot inject
  // from the page. But we CAN verify the listener was attached by checking
  // if the API call returned a deregister function.
  const listenerWired = await evalJs(`(()=>{
    const off = window.av.sessions.onPermissionPrompt(() => {});
    const wired = typeof off === 'function';
    if (wired) off();
    return wired;
  })()`);
  console.log('onPermissionPrompt returns deregister fn?', listenerWired);

  if (allFns && tryWatch.ok && listenerWired) {
    console.log('PASS — permission prompt API surface + subscription wired');
    process.exit(0);
  } else {
    console.log('FAIL — see details above');
    process.exit(1);
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
