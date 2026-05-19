// E2E verification: drive AgentView's "새 작업 시작" through CDP and check
// that a new kind:"bg" worker appears in claude's daemon roster.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const CDP_HOST = 'http://localhost:9222';
const ROSTER = path.join(os.homedir(), '.claude', 'daemon', 'roster.json');

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

function readRosterShorts() {
  try {
    const r = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
    return new Set(Object.keys(r.workers || {}));
  } catch {
    return new Set();
  }
}

async function pickPageTarget() {
  const list = JSON.parse(await get(`${CDP_HOST}/json`));
  for (const t of list) {
    if (t.type === 'page' && /out\/renderer\/index\.html/.test(t.url || '')) {
      return t;
    }
  }
  throw new Error('renderer target not found');
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString('utf8'));
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result?.value;
  }
  // Real keystroke simulation — actually fires through Chrome's input
  // pipeline, so React's controlled-input state updates properly.
  async typeChar(ch) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: ch,
      unmodifiedText: ch,
      key: ch,
      code: 'Key' + ch.toUpperCase()
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ch,
      code: 'Key' + ch.toUpperCase()
    });
  }
  async type(s) {
    for (const ch of s) {
      await this.send('Input.insertText', { text: ch });
      // Allow React to flush.
      await new Promise((r) => setTimeout(r, 8));
    }
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function main() {
  const before = readRosterShorts();
  console.log(`[verify] roster baseline: ${before.size} workers`);
  console.log('  ', [...before].join(', '));

  const target = await pickPageTarget();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');

  // If a SessionDetail is currently mounted, bounce back to the dashboard
  // so the "새 작업 시작" composer is the one we type into. The back button
  // doesn't have a stable class — find it by its label "← 뒤로".
  await cdp.eval(`(()=>{
    const btns = [...document.querySelectorAll('button.btn.sm')];
    const back = btns.find((b) => /뒤로/.test(b.textContent || ''));
    if (back) back.click();
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  // Focus the textarea.
  await cdp.eval(`(()=>{
    const ta = document.querySelector('.input-bar textarea.input-box');
    if (!ta) return false;
    ta.focus();
    return true;
  })()`);

  const promptText = `e2e roundtrip ${Date.now()}`;
  console.log('[verify] typing prompt:', promptText);
  await cdp.type(promptText);

  // Allow React's onChange to settle.
  await new Promise((r) => setTimeout(r, 200));

  const beforeClick = await cdp.eval(`(()=>{
    const btns = [...document.querySelectorAll('.input-send .btn.primary')];
    return btns.map(b => ({ text: b.textContent.trim(), disabled: b.disabled }));
  })()`);
  console.log('[verify] button state:', beforeClick);

  // Click the "▶ 새 작업 시작" button.
  const clicked = await cdp.eval(`(()=>{
    const btns = [...document.querySelectorAll('.input-send .btn.primary')];
    const target = btns.find((b) => /새 작업 시작/.test(b.textContent || ''));
    if (!target) return { ok: false, reason: 'no-button', count: btns.length };
    if (target.disabled) return { ok: false, reason: 'disabled' };
    target.click();
    return { ok: true };
  })()`);
  console.log('[verify] button click:', clicked);
  if (!clicked.ok) {
    console.error('FAIL: send button not clickable');
    cdp.close();
    process.exit(1);
  }

  // Poll roster for a new worker.
  console.log('[verify] polling roster for new worker (up to 20s)...');
  const DEADLINE = Date.now() + 20000;
  let added = null;
  while (Date.now() < DEADLINE) {
    const cur = readRosterShorts();
    for (const s of cur) {
      if (!before.has(s)) {
        added = s;
        break;
      }
    }
    if (added) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!added) {
    console.error('FAIL: no new worker appeared in roster within 20s');
    cdp.close();
    process.exit(1);
  }
  console.log(`[verify] new worker registered: ${added}`);

  const r = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
  const w = r.workers[added];
  console.log(`  pid=${w.pid} cwd=${w.cwd} sessionId=${w.sessionId.slice(0, 8)}...`);

  // Also verify the conversation jsonl gets the prompt within ~10s.
  const sid = w.sessionId;
  const cwdEnc = (w.cwd || '').replace(/[\\/:]/g, '-');
  const jsonlPath = path.join(os.homedir(), '.claude', 'projects', cwdEnc, sid + '.jsonl');
  console.log('[verify] watching jsonl:', jsonlPath);
  const promptDeadline = Date.now() + 15000;
  let promptSeen = false;
  while (Date.now() < promptDeadline) {
    try {
      const text = fs.readFileSync(jsonlPath, 'utf8');
      if (text.includes(promptText)) {
        promptSeen = true;
        break;
      }
    } catch {
      /* file may not exist yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (promptSeen) console.log('[verify] prompt landed in jsonl ✓');
  else console.warn('[verify] prompt NOT seen in jsonl within 15s (worker exists but prompt delivery may have failed)');

  cdp.close();
  if (promptSeen) {
    console.log('PASS — daemon dispatch + prompt delivery confirmed E2E');
    process.exit(0);
  }
  console.log('PARTIAL PASS — worker registered but prompt delivery failed');
  process.exit(2);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
