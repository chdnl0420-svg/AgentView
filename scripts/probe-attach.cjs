// Probe what frame format makes the daemon worker commit our text as a real
// user message in its jsonl. We try one variant per run; pass the variant as
// argv[1]. Reads roster.json each run for the latest pipe path.
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SHORT = '5b3116be'; // ~/  — safe-ish sandbox
const VARIANT = process.argv[2] || 'v1';
const SAFE_PROBE = process.argv[3] || 'probe ' + VARIANT + ' — ignore';

const roster = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.claude', 'daemon', 'roster.json'), 'utf8')
);
const worker = roster.workers[SHORT];
if (!worker) {
  console.error('worker not found');
  process.exit(2);
}
console.log('worker:', worker.pid, worker.sessionId);

function frame(type, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const out = Buffer.alloc(5 + data.length);
  out.writeUInt32BE(data.length, 0);
  out[4] = type;
  data.copy(out, 5);
  return out;
}

// Find the latest jsonl line count BEFORE we connect, so we can diff after.
const jsonlPath = (() => {
  const projDir = path.join(os.homedir(), '.claude', 'projects');
  for (const d of fs.readdirSync(projDir)) {
    const candidate = path.join(projDir, d, `${worker.sessionId}.jsonl`);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
})();
console.log('jsonl:', jsonlPath);
const beforeSize = jsonlPath ? fs.statSync(jsonlPath).size : 0;
console.log('jsonl size BEFORE:', beforeSize);

const sock = net.createConnection({ path: worker.ptySock });
let collected = '';

sock.on('connect', () => {
  console.log('CONNECTED, sending variant:', VARIANT);
  setTimeout(() => {
    switch (VARIANT) {
      case 'v1':
        // client hello (type=1) then raw bytes (type=0)
        sock.write(frame(1, JSON.stringify({ t: 'hello', clientPid: process.pid, version: '2.1.141' })));
        setTimeout(() => sock.write(frame(0, SAFE_PROBE + '\r')), 200);
        break;
      case 'v2':
        // JSON input event
        sock.write(frame(1, JSON.stringify({ t: 'input', data: SAFE_PROBE + '\r' })));
        break;
      case 'v3':
        // JSON keys event
        sock.write(frame(1, JSON.stringify({ t: 'keys', data: SAFE_PROBE + '\r' })));
        break;
      case 'v4':
        // type=2 raw bytes
        sock.write(frame(2, SAFE_PROBE + '\r'));
        break;
      case 'v5':
        // type=0 raw with manual sync/start sequence
        sock.write(frame(0, '\x02' + SAFE_PROBE + '\r'));
        break;
      case 'v6':
        // hello then JSON input
        sock.write(frame(1, JSON.stringify({ t: 'hello', clientPid: process.pid, version: '2.1.141', short: SHORT, nonce: worker.dispatch?.nonce })));
        setTimeout(() => sock.write(frame(1, JSON.stringify({ t: 'input', data: SAFE_PROBE + '\r' }))), 200);
        break;
      default:
        console.log('unknown variant', VARIANT);
    }
  }, 600);
});

sock.on('data', (d) => {
  collected += d.toString('utf8').replace(/[\x00-\x1f\x7f]/g, '.');
  if (collected.length > 6000) collected = collected.slice(-6000);
});
sock.on('error', (e) => console.log('ERROR', e.message));
sock.on('close', () => console.log('CLOSED'));

setTimeout(() => {
  try { sock.end(); } catch {}
  if (jsonlPath) {
    const afterSize = fs.statSync(jsonlPath).size;
    console.log('jsonl size AFTER:', afterSize, ' delta:', afterSize - beforeSize);
    if (afterSize > beforeSize) {
      const fd = fs.openSync(jsonlPath, 'r');
      const buf = Buffer.alloc(afterSize - beforeSize);
      fs.readSync(fd, buf, 0, buf.length, beforeSize);
      fs.closeSync(fd);
      console.log('--- new jsonl bytes ---');
      console.log(buf.toString('utf8').slice(0, 1500));
    }
  }
  console.log('--- inbound tail (cleaned) ---');
  console.log(collected.slice(-1500));
  process.exit(0);
}, 7000);
