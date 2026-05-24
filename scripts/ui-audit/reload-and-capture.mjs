import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const OUT = 'D:/Project/VisualAgents/.harness/screenshots/agentview-ui-audit';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openCdp() {
  const res = await fetch('http://localhost:9222/json/list');
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && (t.url || '').includes('localhost:5173'));
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let nextId = 1; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) { const slot = pending.get(m.id); pending.delete(m.id); slot?.(m); }
  });
  function send(method, params = {}, timeoutMs = 5000) {
    const id = nextId++;
    return new Promise((res, rej) => {
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeoutMs);
    });
  }
  return { ws, send };
}

async function reloadAndShoot(name, viewMode) {
  // Open connection, set viewMode in localStorage, trigger reload
  {
    const { ws, send } = await openCdp();
    if (viewMode) {
      await send('Runtime.evaluate', { expression: `try { localStorage.setItem('viewMode', ${JSON.stringify(viewMode)}); } catch(e){}` });
    }
    // Fire reload without awaiting — the socket will likely die.
    send('Page.reload', { ignoreCache: true }).catch(() => {});
    await sleep(200);
    ws.close();
  }
  // Wait for page to come back up, then re-connect for screenshot
  await sleep(2500);
  const { ws, send } = await openCdp();
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  console.log('wrote', name);

  // Diagnose layout
  const diag = await send('Runtime.evaluate', { expression: `(() => {
    const ids = ['body', '.app', '.dashboard', '.grid-wrap', '.cards', '.input-bar', '.section-head', '.window-chrome', '.detail-page'];
    const out = {};
    for (const sel of ids) {
      const el = sel === 'body' ? document.body : document.querySelector(sel);
      if (!el) { out[sel] = null; continue; }
      const rc = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[sel] = { top: Math.round(rc.top), height: Math.round(rc.height), display: cs.display, paddingTop: cs.paddingTop, gridTemplateRows: cs.gridTemplateRows, flex: cs.flex };
    }
    out.__viewport = { w: innerWidth, h: innerHeight };
    return out;
  })()`, returnByValue: true });
  console.log(JSON.stringify(diag.result.result.value, null, 2));
  ws.close();
}

await mkdir(OUT, { recursive: true });
await reloadAndShoot('view-current', null);
await reloadAndShoot('view-cards-empty', 'cards');
await reloadAndShoot('view-single-empty', 'single');
console.log('done');
