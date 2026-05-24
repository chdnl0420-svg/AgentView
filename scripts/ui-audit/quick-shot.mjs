// One-shot screenshot using captureBeyondViewport (works even when window hidden).
import { writeFile } from 'node:fs/promises';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = await fetch('http://localhost:9222/json/list');
const targets = await res.json();
const page = targets.find((t) => t.type === 'page' && (t.url || '').includes('localhost:5173'));
if (!page) { console.error('no page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined) { const slot = pending.get(m.id); pending.delete(m.id); slot?.(m); }
});
function send(method, params = {}, timeoutMs = 8000) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeoutMs);
  });
}
const file = process.argv[2] || '.harness/screenshots/agentview-ui-audit/after-fix.png';
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);
try {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(file, Buffer.from(r.result.data, 'base64'));
  console.log('wrote', file, 'bytes', r.result.data.length);
} finally {
  ws.close();
}
