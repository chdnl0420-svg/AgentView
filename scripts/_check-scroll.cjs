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
  async function evalJs(e) { const r = await call('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result?.value; }
  await call('Runtime.enable');
  // Make sure dashboard
  await evalJs("(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()");
  await new Promise((r) => setTimeout(r, 400));
  const info = await evalJs("(()=>{ const wrap=document.querySelector('.grid-wrap'); const cards=document.querySelector('.cards'); const sh=document.querySelector('.section-head'); if(!wrap||!cards) return null; const wcs=getComputedStyle(wrap); const ccs=getComputedStyle(cards); return { wrapOverflowY: wcs.overflowY, wrapDisplay: wcs.display, cardsOverflowY: ccs.overflowY, sectionHeadShrink: getComputedStyle(sh).flexShrink, cardCount: document.querySelectorAll('.cards > *').length, cardsScrollHeight: cards.scrollHeight, cardsClientHeight: cards.clientHeight }; })()");
  console.log('Scroll state:', JSON.stringify(info, null, 2));
  const cardsScrolls = info && info.cardsOverflowY === 'auto';
  const wrapDoesnt = info && info.wrapOverflowY !== 'auto';
  console.log(cardsScrolls && wrapDoesnt ? 'PASS — only .cards scrolls' : 'FAIL — scroll not isolated');
  ws.close();
})();
