// Minimal CDP probe to diagnose why Page.captureScreenshot hangs.
const res = await fetch('http://localhost:9222/json/list');
const [page] = await res.json();
console.log('target', page.title);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});
console.log('connected');

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  console.log('<<', JSON.stringify(m).slice(0, 200));
  if (m.id !== undefined) {
    const slot = pending.get(m.id);
    pending.delete(m.id);
    slot?.(m);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const payload = JSON.stringify({ id, method, params });
    console.log('>>', payload.slice(0, 200));
    ws.send(payload);
  });
}

console.log('---');
const v = await send('Browser.getVersion');
console.log('version', v.result?.product);

console.log('--- enable ---');
await send('Page.enable');
console.log('page.enable ok');

console.log('--- screenshot ---');
const shot = await send('Page.captureScreenshot', { format: 'png' });
console.log('screenshot size', shot.result?.data?.length);
ws.close();
