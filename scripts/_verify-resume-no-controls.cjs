const WebSocket = require('ws');
const http = require('http');
function get(u){return new Promise((r1,r2)=>{http.get(u,(r)=>{let b='';r.on('data',(c)=>b+=c);r.on('end',()=>r1(b))}).on('error',r2)})}
(async () => {
  const list = JSON.parse(await get('http://localhost:9222/json'));
  const t = list.find((x) => x.type === 'page' && /index\.html/.test(x.url || ''));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id=0; const pending = new Map();
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (raw) => { const m=JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); } });
  function call(method,p={}){const i=++id;return new Promise((res,rej)=>{pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params:p}))})}
  async function evalJs(e){const r=await call('Runtime.evaluate',{expression:e,returnByValue:true});return r.result?.value;}
  await call('Runtime.enable');
  // Bounce to dashboard then open a session
  await evalJs("(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()");
  await new Promise((r)=>setTimeout(r,500));
  await evalJs("document.querySelector('.cards > *')?.click()");
  await new Promise((r)=>setTimeout(r,700));
  const r = await evalJs("(() => ({ inDetail: !!document.querySelector('.detail-page'), perm: !!document.querySelector('#perm-select'), permResume: !![...document.querySelectorAll('select')].find((s)=>s.id.startsWith('perm-select-')), modelResume: !![...document.querySelectorAll('select')].find((s)=>s.id.startsWith('model-select-')), composerExists: !!document.querySelector('.input-bar textarea.input-box') }))()");
  console.log(JSON.stringify(r, null, 2));
  if (r.inDetail && !r.permResume && !r.modelResume && r.composerExists) {
    console.log('PASS — resume composer has no model/permission selects but is still functional');
  } else {
    console.log('FAIL — see state above');
  }
  ws.close();
})();
