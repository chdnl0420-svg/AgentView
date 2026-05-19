// Interactive QA harness: drive AgentView through CDP, capture screenshots,
// and produce a report of issues found.
//
// Usage:  node scripts/test-harness.cjs <scenario>
// Scenarios:
//   dashboard      — initial view
//   open-session   — click a card and open detail
//   compose        — type into the composer + check controls
//   right-click    — fire a context menu via real RClick
//   tabs           — click each filter tab and verify counts
//   all            — run all of the above in order

const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const CDP_HOST = 'http://localhost:9222';
const OUT_DIR = path.join('C:', 'Users', 'NX3GAMES', 'Desktop', 'reports', 'av-screenshots');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function get(u) {
  return new Promise((res, rej) => {
    http.get(u, (r) => { let b=''; r.on('data',(c)=>b+=c); r.on('end',()=>res(b)); }).on('error', rej);
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
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
  send(method, params={}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result?.value;
  }
  async screenshot(label) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT_DIR, `${Date.now()}-${label}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  async type(s) {
    for (const ch of s) {
      await this.send('Input.insertText', { text: ch });
      await new Promise((r) => setTimeout(r, 6));
    }
  }
  async click(x, y, button = 'left') {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
  }
  async rightClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  }
  close() { try { this.ws.close(); } catch {} }
}

const log = (...a) => console.log('[test]', ...a);
const issues = [];
const note = (severity, area, msg) => { issues.push({ severity, area, msg }); log(`  ${severity.toUpperCase()} ${area}: ${msg}`); };

async function findPage() {
  const list = JSON.parse(await get(`${CDP_HOST}/json`));
  return list.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
}

async function dashboard(cdp) {
  log('=== scenario: dashboard ===');
  // Go back to dashboard if currently in detail view.
  await cdp.eval(`(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()`);
  await new Promise((r) => setTimeout(r, 500));
  await cdp.screenshot('01-dashboard');
  const info = await cdp.eval(`(()=>{
    const cards = [...document.querySelectorAll('.session-card, .cards > *')];
    const tabs = [...document.querySelectorAll('.filters .btn.sm')].map((t)=>({label:t.textContent.trim(), pressed:t.getAttribute('aria-pressed')}));
    const composerVisible = !!document.querySelector('.input-bar .input-box');
    return { cardCount: cards.length, tabs, composerVisible };
  })()`);
  log('card count:', info.cardCount);
  log('tabs:', info.tabs);
  if (info.cardCount === 0) note('warn', 'dashboard', 'no cards visible (sessions empty?)');
  if (!info.composerVisible) note('high', 'dashboard', 'composer (input-bar) missing on dashboard');
  return info;
}

async function openSession(cdp) {
  log('=== scenario: open-session ===');
  const before = await cdp.eval(`(()=>{
    const c = document.querySelector('.session-card, .cards > *');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2, label: (c.textContent||'').slice(0,40).trim() };
  })()`);
  if (!before) { note('high', 'open-session', 'no card to click'); return; }
  log('clicking card:', before.label);
  await cdp.click(before.x, before.y);
  await new Promise((r) => setTimeout(r, 700));
  await cdp.screenshot('02-session-detail');
  const detail = await cdp.eval(`(()=>{
    const head = document.querySelector('.detail-head');
    const body = document.querySelector('.detail-body');
    const conv = document.querySelector('.conv');
    const composer = document.querySelector('.input-bar .input-box');
    const back = [...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||''));
    return {
      hasHeader: !!head,
      hasBody: !!body,
      hasConv: !!conv,
      messageCount: conv ? conv.querySelectorAll('.msg').length : 0,
      hasComposer: !!composer,
      hasBackBtn: !!back
    };
  })()`);
  log('detail:', detail);
  if (!detail.hasHeader) note('high', 'detail', 'header missing');
  if (!detail.hasComposer) note('high', 'detail', 'composer missing in detail view');
  if (!detail.hasBackBtn) note('medium', 'detail', 'back button not found');
  if (detail.messageCount === 0) note('medium', 'detail', 'no messages rendered (jsonl empty? or fresh?)');
  return detail;
}

async function compose(cdp) {
  log('=== scenario: compose-controls ===');
  const ctrls = await cdp.eval(`(()=>{
    const rows = [...document.querySelectorAll('.input-bar .input-controls')];
    return rows.map((r,i)=>({
      i, top: Math.round(r.getBoundingClientRect().top),
      children: [...r.children].map((c) => c.className || c.tagName)
    }));
  })()`);
  log('control rows:', JSON.stringify(ctrls));
  if (ctrls.length > 1) {
    // Multiple .input-controls rows mean wt-controls didn't get merged in.
    note('medium', 'compose', `expected 1 controls row, found ${ctrls.length}`);
  }
  // Try typing a tiny phrase and check the send button enables.
  await cdp.eval(`(()=>{ const ta=document.querySelector('.input-bar textarea.input-box'); if (ta) ta.focus(); })()`);
  await new Promise((r) => setTimeout(r, 200));
  await cdp.type('hello qa');
  await new Promise((r) => setTimeout(r, 300));
  const btn = await cdp.eval(`(()=>{
    const b = [...document.querySelectorAll('.input-send .btn.primary')][0];
    if (!b) return null;
    return { text: b.textContent.trim(), disabled: b.disabled };
  })()`);
  log('send button after typing:', btn);
  if (!btn || btn.disabled) note('high', 'compose', 'send button stayed disabled after typing');
  await cdp.screenshot('03-composer-typed');
  // Clear it so we don't accidentally send.
  await cdp.eval(`(()=>{ const ta=document.querySelector('.input-bar textarea.input-box'); if (ta) { const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(ta,''); ta.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
}

async function tabsScenario(cdp) {
  log('=== scenario: tabs ===');
  // First go back to dashboard
  await cdp.eval(`(()=>{ const b=[...document.querySelectorAll('button.btn.sm')].find((b)=>/뒤로/.test(b.textContent||'')); if (b) b.click(); })()`);
  await new Promise((r) => setTimeout(r, 400));
  const tabsBefore = await cdp.eval(`[...document.querySelectorAll('.filters .btn.sm')].map((t)=>({label:t.textContent.trim(), pressed:t.getAttribute('aria-pressed')}))`);
  log('tabs initial:', tabsBefore);
  // Click each tab in sequence and count cards.
  for (let i = 0; i < tabsBefore.length; i++) {
    const idx = i;
    const r = await cdp.eval(`(()=>{
      const tabs=[...document.querySelectorAll('.filters .btn.sm')];
      const t = tabs[${idx}];
      const rect = t.getBoundingClientRect();
      return { x: rect.x+rect.width/2, y: rect.y+rect.height/2, label: t.textContent.trim() };
    })()`);
    await cdp.click(r.x, r.y);
    await new Promise((r) => setTimeout(r, 200));
    const count = await cdp.eval(`document.querySelectorAll('.cards > *').length`);
    log(`  tab ${r.label}: ${count} cards visible`);
    await cdp.screenshot(`04-tab-${idx}-${r.label.replace(/\s+/g,'_').replace(/[^\w가-힣-]/g,'')}`);
  }
}

async function dropdowns(cdp) {
  log('=== scenario: dropdown options ===');
  // The native dropdown popup can't be screenshotted (it's an OS window).
  // Check the computed colors on options instead — confirms styling applies.
  const styles = await cdp.eval(`(()=>{
    const selects = [...document.querySelectorAll('.input-controls select')];
    return selects.map((s) => {
      const opt = s.options[1] || s.options[0];
      if (!opt) return { id: s.id, opts: 0 };
      const cs = getComputedStyle(opt);
      return { id: s.id, color: cs.color, bg: cs.backgroundColor };
    });
  })()`);
  log('option styles:', JSON.stringify(styles, null, 2));
  for (const s of styles) {
    if (s.bg && /rgba?\(0, 0, 0, 0\)/.test(s.bg)) {
      note('medium', 'dropdown', `${s.id}: option has transparent bg`);
    }
  }
}

async function main() {
  const target = await findPage();
  if (!target) { console.error('NO TARGET'); process.exit(1); }
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const scenario = process.argv[2] || 'all';
  if (scenario === 'all' || scenario === 'dashboard') await dashboard(cdp);
  if (scenario === 'all' || scenario === 'open-session') await openSession(cdp);
  if (scenario === 'all' || scenario === 'compose') await compose(cdp);
  if (scenario === 'all' || scenario === 'tabs') await tabsScenario(cdp);
  if (scenario === 'all' || scenario === 'dropdowns') await dropdowns(cdp);

  console.log('\n========= Issue Summary =========');
  if (issues.length === 0) console.log('No issues found.');
  for (const i of issues) console.log(`  [${i.severity.toUpperCase()}] ${i.area}: ${i.msg}`);
  console.log(`\nScreenshots: ${OUT_DIR}`);
  cdp.close();
  process.exit(issues.filter((i) => i.severity === 'high').length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
