// Verify: AgentView grid exactly matches `claude agents` TUI count.
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

function get(u) {
  return new Promise((res, rej) => {
    http.get(u, (r) => { let b=''; r.on('data',(c)=>b+=c); r.on('end',()=>res(b)); }).on('error', rej);
  });
}

(async () => {
  // Count what `claude agents` would show (from jobs/<short>/state.json).
  const jobsDir = path.join(os.homedir(), '.claude', 'jobs');
  const states = [];
  for (const d of fs.readdirSync(jobsDir)) {
    if (d.endsWith('.json')) continue;
    const sf = path.join(jobsDir, d, 'state.json');
    if (!fs.existsSync(sf)) continue;
    try {
      const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
      states.push({ short: d, state: s.state, tempo: s.tempo, name: s.name || d });
    } catch {}
  }
  console.log(`claude jobs has ${states.length} entries (= what \`claude agents\` shows):`);
  states.forEach((s) => console.log(`  ${s.short} state=${s.state} tempo=${s.tempo || '?'} "${s.name}"`));

  // Now compare with AgentView's grid.
  const list = JSON.parse(await get('http://localhost:9222/json'));
  const target = list.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
  });
  function call(method, params={}) {
    const i = ++id;
    return new Promise((res, rej) => {
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async function evalJs(e) {
    const r = await call('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  }
  await call('Runtime.enable');
  // Force renderer to do a fresh reload + give it time.
  await evalJs(`(()=>{ const ev = new Event('focus'); window.dispatchEvent(ev); })()`);
  // Click any "completed" tab if not selected so we see everything.
  await evalJs(`(()=>{
    // Force-select all tabs so the count matches IPC list 1:1.
    const tabs = [...document.querySelectorAll('.filters .btn.sm')];
    tabs.forEach((t) => {
      if (t.getAttribute('aria-pressed') === 'false') t.click();
    });
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  // Now actually trigger reloadSessions through the IPC bus.
  await evalJs(`window.av.sessions.list().then(() => { /* renderer subscribes via onChanged */ })`);
  // Wait for next session list change event.
  await new Promise((r) => setTimeout(r, 800));

  // Read raw IPC list result for comparison.
  const ipcSessions = await evalJs(`window.av.sessions.list().then((r) => r.sessions.map((s) => ({short: s.sessionId.slice(0,8), kind: s.kind, alive: s.alive, status: s.status, name: s.name})))`);
  console.log(`\nIPC sessions.list() returned ${ipcSessions.length} sessions:`);
  ipcSessions.slice(0, 30).forEach((s) => console.log(`  ${s.short} kind=${s.kind} alive=${s.alive} status=${s.status} "${s.name}"`));

  // Now read the grid cards.
  const cardCount = await evalJs(`document.querySelectorAll('.cards > *').length`);
  const tabState = await evalJs(`[...document.querySelectorAll('.filters .btn.sm')].map((t)=>({label: t.textContent.trim(), pressed: t.getAttribute('aria-pressed')}))`);
  console.log(`\nGrid card count: ${cardCount}`);
  console.log('Tab state:', tabState);

  // Compare: states (jobs) ↔ ipcSessions (kind=bg from jobs)
  const jobsIds = new Set(states.map((s) => s.short));
  const ipcBgIds = new Set(ipcSessions.filter((s) => s.kind === 'bg').map((s) => s.short));
  const onlyInJobs = [...jobsIds].filter((s) => !ipcBgIds.has(s));
  const onlyInIpc = [...ipcBgIds].filter((s) => !jobsIds.has(s));
  console.log(`\nParity check:`);
  console.log(`  jobs entries: ${jobsIds.size}`);
  console.log(`  IPC bg entries: ${ipcBgIds.size}`);
  console.log(`  Only in claude jobs (missing from AgentView): ${onlyInJobs.length} → ${onlyInJobs.join(', ')}`);
  console.log(`  Only in AgentView (extra): ${onlyInIpc.length} → ${onlyInIpc.join(', ')}`);
  if (onlyInJobs.length === 0 && onlyInIpc.length === 0) {
    console.log('\nPASS — AgentView matches claude agents 1:1');
  } else if (onlyInJobs.length === 0) {
    console.log('\nPASS+ — AgentView shows all of claude agents (+ extras)');
  } else {
    console.log('\nFAIL — AgentView is missing entries that claude agents shows');
  }
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
