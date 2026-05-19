const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SHORT = process.argv[2] || '5f02ba3c';
const PROMPT = process.argv[3] || 'pipe attach 한 줄 ack';

const roster = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.claude', 'daemon', 'roster.json'), 'utf8')
);
const worker = roster.workers[SHORT];
if (!worker) {
  console.error('worker not found:', SHORT);
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

const sock = net.createConnection({ path: worker.ptySock });
let buf = Buffer.alloc(0);
let inputDelivered = false;

sock.on('connect', () => {
  console.log('CONNECTED');
});

sock.on('data', (d) => {
  buf = Buffer.concat([buf, d]);

  // Try parsing inbound frames just to log type frequencies.
  let off = 0;
  let typeCounts = {};
  while (off + 5 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (off + 5 + len > buf.length) break;
    const type = buf[off + 4];
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    if (type === 1) {
      // JSON control
      const payload = buf.subarray(off + 5, off + 5 + len).toString('utf8');
      console.log('CTRL >>', payload);
    }
    off += 5 + len;
  }
  buf = buf.subarray(off);

  // Once we've seen any output, deliver input.
  if (!inputDelivered && (typeCounts[0] || typeCounts[1])) {
    inputDelivered = true;
    setTimeout(() => {
      console.log('writing FRAMED type=0 prompt');
      sock.write(frame(0, PROMPT));
      setTimeout(() => sock.write(frame(0, '\r')), 120);
    }, 400);
  }
});

sock.on('error', (e) => console.log('ERROR', e.message));
sock.on('close', () => console.log('CLOSED'));

setTimeout(() => {
  console.log('done');
  try { sock.end(); } catch {}
  process.exit(0);
}, 9000);
