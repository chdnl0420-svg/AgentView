// Use CDP to fetch an av-file:// URL for a Korean/space-laden path and check
// the response status + content-type.
const http = require('node:http');
const WebSocket = require('ws');
const fs = require('node:fs');

const TEST_PATH = process.argv[2] || 'C:\\Users\\NX3GAMES\\Downloads\\스크린샷 2026-05-18 163753.png';
console.log('test path:', TEST_PATH, 'exists:', fs.existsSync(TEST_PATH));

const fetchJson = (url) =>
  new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

async function main() {
  const tabs = await fetchJson('http://127.0.0.1:9222/json/list');
  const page = tabs.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'));
  if (!page) throw new Error('no AgentView page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => ws.once('open', res));

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

  const norm = TEST_PATH.replace(/\\/g, '/');
  let url;
  if (/^[a-zA-Z]:\//.test(norm)) {
    url = 'av-file://local/' + norm[0].toUpperCase() + '/' + encodeURI(norm.slice(3));
  } else {
    url = 'av-file://local/abs' + encodeURI(norm);
  }
  console.log('fetching:', url);

  const r = await send('Runtime.evaluate', {
    expression: `(async () => {
      const out = {};
      try {
        const r = await fetch(${JSON.stringify(url)});
        const ct = r.headers.get('content-type') || '';
        let size = 0;
        try { const blob = await r.blob(); size = blob.size; } catch (e) {}
        out.fetch = { ok: r.ok, status: r.status, type: ct, size };
      } catch (e) {
        out.fetch = { error: String(e) };
      }
      // img element check (this is what actual rendering relies on)
      out.img = await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve({ ok: true, w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = (ev) => resolve({ ok: false, err: 'img onerror' });
        im.src = ${JSON.stringify(url)};
        setTimeout(() => resolve({ ok: false, err: 'timeout' }), 3000);
      });
      return JSON.stringify(out);
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
  console.log('result:', r.result.value);
  ws.close();
  process.exit(r.result.value.ok && r.result.value.size > 0 ? 0 : 2);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
