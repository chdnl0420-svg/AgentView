// End-to-end smoke test after the recent regression fix.
//   1) the existing-session detail surfaces user message bubbles
//   2) clicking "새 작업 시작" creates a new card and the detail view loads
const http = require('node:http');
const WebSocket = require('ws');

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
  const page = tabs.find((t) => t.type === 'page' && t.url.startsWith('http://localhost'));
  if (!page) {
    console.error('no AgentView page');
    process.exit(1);
  }
  console.log('attached:', page.title);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));

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

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { try { return JSON.stringify(${expr}); } catch (e) { return JSON.stringify({ error: String(e) }); } })()`,
      returnByValue: true,
      awaitPromise: true
    });
    try {
      return JSON.parse(r.result.value);
    } catch {
      return r.result.value;
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Wait for the grid to render at least one card.
  for (let i = 0; i < 30; i++) {
    const n = await ev(`document.querySelectorAll('.session-card').length`);
    if (n > 0) break;
    await sleep(250);
  }

  // ── Test 1: existing card → user bubble appears with non-empty body ─────
  console.log('\n[T1] open first existing card and look for user bubbles');
  const opened = await ev(`(() => {
    const c = document.querySelector('.session-card');
    if (!c) return null;
    c.click();
    return c.querySelector('.card-title')?.textContent?.trim() || '(no title)';
  })()`);
  console.log('  opened:', opened);
  await sleep(700);
  const inDetail = await ev(`!!document.querySelector('.detail-page')`);
  console.log('  detail-page mounted:', inDetail);
  const userBubbles = await ev(`(() => {
    const els = Array.from(document.querySelectorAll('.msg.user .bubble .content'));
    return els
      .map((el) => (el.textContent || '').trim())
      .filter((t) => t.length > 0);
  })()`);
  console.log('  user bubble bodies (count):', userBubbles.length);
  if (userBubbles.length > 0) {
    console.log('  first:', JSON.stringify(userBubbles[0].slice(0, 100)));
  }
  const test1 = userBubbles.length > 0;

  // Back to grid before T2
  await ev(`(() => {
    const b = Array.from(document.querySelectorAll('.detail-page .btn')).find((x) => x.textContent.trim().startsWith('← 뒤로'));
    b?.click();
    return true;
  })()`);
  await sleep(400);

  // ── Test 2: type a new-task prompt and submit ──────────────────────────
  console.log('\n[T2] type a new prompt in the main composer and submit');
  const cardsBefore = await ev(`document.querySelectorAll('.session-card').length`);
  console.log('  cards before:', cardsBefore);
  const probeText = `AgentView 자동검증 ${Date.now() % 100000}`;
  const typed = await ev(`(() => {
    const ta = document.querySelector('.input-bar textarea.input-box');
    if (!ta) return false;
    const proto = Object.getPrototypeOf(ta);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(ta, ${JSON.stringify(probeText)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.value;
  })()`);
  console.log('  textarea contains:', JSON.stringify(typed));
  await sleep(150);
  const clicked = await ev(`(() => {
    const btn = Array.from(document.querySelectorAll('.input-bar .btn.primary')).find((b) => b.textContent.includes('새 작업 시작'));
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  })()`);
  console.log('  send button clicked:', clicked);
  await sleep(1200);
  const onDetail = await ev(`!!document.querySelector('.detail-page')`);
  console.log('  jumped to detail-page:', onDetail);
  // Poll up to ~25 seconds for the user bubble + thinking marker to land
  // (claude boot + first jsonl write usually takes 4-15s on first run).
  let probeBubble = false;
  let thinking = false;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    probeBubble = await ev(`(() => {
      const els = Array.from(document.querySelectorAll('.msg.user .bubble .content, .msg.user .user-text'));
      return els.some((el) => (el.textContent || '').includes(${JSON.stringify(probeText.slice(0, 20))}));
    })()`);
    thinking = await ev(`!!document.querySelector('.thinking-line, .thinking-dots')`);
    if (probeBubble || thinking) {
      console.log(`  t+${(i + 1) * 1000}ms — probe:${probeBubble} thinking:${thinking}`);
      break;
    }
  }
  console.log('  final probe text visible as user bubble:', probeBubble);
  console.log('  final thinking indicator visible:', thinking);
  const test2 = clicked && onDetail && (probeBubble || thinking);

  console.log('\n=== VERDICT ===');
  console.log('[T1] existing user bubbles render:', test1 ? 'PASS' : 'FAIL');
  console.log('[T2] new-task send flow:', test2 ? 'PASS' : 'FAIL');
  console.log('     probe visible in conv:', probeBubble ? 'YES' : 'NO');

  // restore: go back so we don't leave detail open
  await ev(`(() => {
    const b = Array.from(document.querySelectorAll('.detail-page .btn')).find((x) => x.textContent.trim().startsWith('← 뒤로'));
    b?.click();
    return true;
  })()`);

  ws.close();
  process.exit(test1 && test2 ? 0 : 2);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
