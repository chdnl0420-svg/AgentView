// End-to-end check that the back button preserves filter + scroll position.
// Drives the live Electron window via Chrome DevTools Protocol over ws.
const http = require('node:http');
const WebSocket = require('ws');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const tabs = await fetchJson('http://127.0.0.1:9222/json/list');
  const page = tabs.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'));
  if (!page) {
    console.error('no AgentView page found');
    process.exit(1);
  }
  console.log('attached:', page.title);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.once('open', resolve));

  let id = 0;
  const inflight = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString('utf8'));
    if (msg.id != null && inflight.has(msg.id)) {
      const { resolve, reject } = inflight.get(msg.id);
      inflight.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      inflight.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });

  await send('Runtime.enable');

  const evalExpr = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) {
      throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
    }
    return r.result.value;
  };

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // 0) wait for grid to render
  for (let i = 0; i < 30; i++) {
    const ready = await evalExpr(`!!document.querySelector('.filters')`);
    if (ready) break;
    await sleep(200);
  }

  // 1) initial filter state
  const initialActive = await evalExpr(`
    Array.from(document.querySelectorAll('.filters button'))
      .map(b => ({ label: b.textContent.trim(), active: b.classList.contains('primary') }))
  `);
  console.log('1) initial active:', initialActive);

  // 2) toggle "대기" filter on
  await evalExpr(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.filters button'))
        .find(b => b.textContent.trim().startsWith('대기'));
      btn?.click();
      return !!btn;
    })()
  `);
  await sleep(80);
  const afterToggle = await evalExpr(`
    Array.from(document.querySelectorAll('.filters button'))
      .map(b => ({ label: b.textContent.trim(), active: b.classList.contains('primary') }))
  `);
  console.log('2) after toggling "대기":', afterToggle);

  // 3) scroll grid down 200px
  await evalExpr(`
    (() => {
      const w = document.querySelector('.grid-wrap');
      if (!w) return null;
      w.scrollTop = 200;
      w.dispatchEvent(new Event('scroll'));
      return w.scrollTop;
    })()
  `);
  await sleep(80);
  const scrollBefore = await evalExpr(`document.querySelector('.grid-wrap')?.scrollTop ?? null`);
  console.log('3) scrollTop before navigate:', scrollBefore);

  // 4) click the first session card
  const clickedCard = await evalExpr(`
    (() => {
      const card = document.querySelector('.session-card');
      if (!card) return null;
      card.click();
      return card.querySelector('.card-title')?.textContent ?? '(no title)';
    })()
  `);
  console.log('4) clicked card:', clickedCard);
  await sleep(200);
  const enteredDetail = await evalExpr(`!!document.querySelector('.detail-page')`);
  console.log('   detail page mounted:', enteredDetail);

  // 5) click back
  await evalExpr(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.detail-page .btn'))
        .find(b => b.textContent.trim().startsWith('← 뒤로'));
      btn?.click();
      return !!btn;
    })()
  `);
  await sleep(250);

  // 6) verify filter still active + grid scroll restored
  const afterBack = await evalExpr(`
    Array.from(document.querySelectorAll('.filters button'))
      .map(b => ({ label: b.textContent.trim(), active: b.classList.contains('primary') }))
  `);
  console.log('6) after back, filter state:', afterBack);
  const scrollAfter = await evalExpr(`document.querySelector('.grid-wrap')?.scrollTop ?? null`);
  console.log('   scrollTop after back:', scrollAfter);

  const expectedActive = afterToggle.filter((b) => b.active).map((b) => b.label);
  const actualActive = afterBack.filter((b) => b.active).map((b) => b.label);
  const filterOk = JSON.stringify(expectedActive) === JSON.stringify(actualActive);
  const scrollOk = Math.abs((scrollAfter ?? 0) - (scrollBefore ?? 0)) <= 8;

  console.log('\n=== VERDICT ===');
  console.log('filter preserved:', filterOk ? 'PASS' : 'FAIL', '(expected', expectedActive, 'got', actualActive, ')');
  console.log('scroll preserved:', scrollOk ? 'PASS' : 'FAIL', '(', scrollBefore, '→', scrollAfter, ')');
  ws.close();
  process.exit(filterOk && scrollOk ? 0 : 2);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
