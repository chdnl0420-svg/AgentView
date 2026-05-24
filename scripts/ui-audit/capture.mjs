// UI audit capture — talks to the running Electron app over Chrome
// DevTools Protocol (port 9222), forces a few well-known viewMode
// states, screenshots each, and records the renderer console.
//
// Run with the app already up (`npm run dev`):
//   node scripts/ui-audit/capture.mjs
//
// Output:
//   .harness/screenshots/agentview-ui-audit/<view>.png
//   .harness/screenshots/agentview-ui-audit/console.json

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), '..', '..');
const OUT_DIR = join(REPO_ROOT, '.harness', 'screenshots', 'agentview-ui-audit');
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://localhost:9222';
const VIEWPORT = { width: 1440, height: 900 };

// We can't reliably reload an Electron renderer over CDP without dropping the
// session (Runtime.evaluate { location.reload() } never returns because the
// context tears down mid-call). Instead we set viewMode via Runtime.evaluate,
// dispatch a custom event the app listens for, and capture without reload.
const STEPS = [
  { id: 'view-current', viewMode: null, description: 'Current state, no toggle' },
  { id: 'view-cards-empty', viewMode: 'cards', description: 'Card grid + new task input bar' },
  { id: 'view-single-empty', viewMode: 'single', description: 'Single mode (left list + right new task)' },
];

async function fetchTargets() {
  const res = await fetch(`${CDP_HTTP}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list failed: ${res.status}`);
  return res.json();
}

async function pickPage() {
  const targets = await fetchTargets();
  const page = targets.find((t) =>
    t.type === 'page' && /localhost:5173|file:\/\/.*index\.html/.test(t.url || '')
  ) ?? targets.find((t) => t.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No page target with webSocketDebuggerUrl');
  return page;
}

function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error('CDP ws error: ' + (e?.message ?? e))));
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id !== undefined) {
      const slot = pending.get(msg.id);
      if (slot) {
        pending.delete(msg.id);
        if (msg.error) slot.reject(new Error(`${msg.method ?? ''} → ${msg.error.message}`));
        else slot.resolve(msg.result ?? {});
      }
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function close() { try { ws.close(); } catch { /* ignore */ } }
  return { ready, send, on, close };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function captureOne(cdp, step) {
  if (step.viewMode) {
    // We can't reload — the React app reads viewMode once at mount. Use the
    // app's own toggleViewMode by clicking the toggle button. Fallback:
    // set localStorage so the next manual reload picks it up.
    await cdp.send('Runtime.evaluate', {
      expression: `try { localStorage.setItem('viewMode', ${JSON.stringify(step.viewMode)}); } catch(e) {}`,
      returnByValue: true,
    });
    // Click the view-mode toggle button (data-tour='view-mode-toggle' lives
    // in the SessionList chrome). If it isn't on screen, skip silently.
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('[data-tour="view-mode-toggle"], button[title*="모드"], button[aria-label*="모드"]');
        if (el) el.click();
      })()`,
      returnByValue: true,
    });
    await sleep(800);
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (!shot?.data) throw new Error(`No screenshot data for ${step.id}`);
  const buf = Buffer.from(shot.data, 'base64');
  const file = join(OUT_DIR, `${step.id}.png`);
  await writeFile(file, buf);
  return { id: step.id, file, viewMode: step.viewMode, description: step.description, sizeBytes: buf.length };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const target = await pickPage();
  console.log(`[ui-audit] target ${target.title} @ ${target.url}`);
  const cdp = openCdp(target.webSocketDebuggerUrl);
  await cdp.ready;

  const consoleLog = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLog.push({
        ts: Date.now(),
        type: msg.params.type,
        text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleLog.push({
        ts: Date.now(),
        type: 'exception',
        text: msg.params.exceptionDetails?.exception?.description ?? 'unknown exception',
      });
    } else if (msg.method === 'Log.entryAdded') {
      consoleLog.push({
        ts: Date.now(),
        type: msg.params.entry.level,
        text: msg.params.entry.text,
        source: msg.params.entry.source,
      });
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false,
  });

  const captures = [];
  for (const step of STEPS) {
    console.log(`[ui-audit] capturing ${step.id} …`);
    captures.push(await captureOne(cdp, step));
  }

  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await writeFile(
    join(OUT_DIR, 'console.json'),
    JSON.stringify({ captures, console: consoleLog }, null, 2),
    'utf8'
  );
  cdp.close();
  console.log(`[ui-audit] done — ${captures.length} captures + console.json in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('[ui-audit] failed:', err);
  process.exit(1);
});
