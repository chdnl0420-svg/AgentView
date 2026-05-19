const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9222/devtools/page/1CF56CEB3111E1742393F52F6E56B5F6');
let id = 0;
const pending = new Map();
ws.on('open', async () => {
  function send(method, params={}) {
    const i = ++id;
    return new Promise((res, rej) => {
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async function evalJs(e) {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
    return r.result?.value;
  }
  await send('Runtime.enable');
  const v = await evalJs(`(()=>{
    const btns = [...document.querySelectorAll('.input-send .btn')];
    return btns.map(b => ({ text: b.textContent.trim(), cls: b.className, disabled: b.disabled }));
  })()`);
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
});
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
});
