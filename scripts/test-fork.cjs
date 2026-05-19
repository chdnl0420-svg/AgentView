// Verify that --resume <sid> --fork-session --session-id <new> works:
// 1) does NOT collide with the live original session,
// 2) creates a new jsonl using <new> as the filename.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const pty = require('node-pty');

const ORIG_SID = process.argv[2];
const CWD = process.argv[3];
if (!ORIG_SID || !CWD) {
  console.error('usage: node test-fork.cjs <original-sid> <cwd>');
  process.exit(2);
}
const NEW_SID = crypto.randomUUID();

const exe = path.join(
  os.homedir(),
  'AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
);
const args = ['--resume', ORIG_SID, '--fork-session', '--session-id', NEW_SID, '--permission-mode', 'auto'];
console.log('ORIG:', ORIG_SID);
console.log('NEW:', NEW_SID);
console.log('cwd:', CWD);
console.log('args:', args.join(' '));

const PROJ = path.join(os.homedir(), '.claude', 'projects');
const before = new Set();
for (const d of fs.readdirSync(PROJ)) {
  try {
    for (const f of fs.readdirSync(path.join(PROJ, d))) before.add(`${d}/${f}`);
  } catch {}
}

const p = pty.spawn(exe, args, {
  name: 'xterm-256color',
  cols: 200,
  rows: 50,
  cwd: CWD,
  env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '0' },
  useConpty: true,
  encoding: 'utf8'
});
console.log('PTY pid:', p.pid);

const STRIP = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\]0;[^\x07]*\x07|\x1b[\(\)][A-Z0-9]|\x1b[=>]|\r/g;
const READY = /How can I help|Tips for getting started|to interrupt|\/effort|to cycle/i;
let buf = '';
let delivered = false;

const PROMPT = '포크 세션 — 한 줄 ack 만 줘.';
const deliver = () => {
  if (delivered) return;
  delivered = true;
  console.log('typing prompt');
  p.write(PROMPT);
  setTimeout(() => p.write('\r'), 80);
};

p.onData((d) => {
  buf = (buf + d.replace(STRIP, '')).slice(-6000);
  if (!delivered && READY.test(buf)) {
    console.log('READY → deliver');
    setTimeout(deliver, 300);
  }
});

p.onExit(({ exitCode }) => {
  console.log('EXIT', exitCode);
});

setTimeout(() => {
  if (!delivered) {
    console.log('FALLBACK deliver');
    deliver();
  }
}, 7000);

setTimeout(() => {
  const after = new Set();
  for (const d of fs.readdirSync(PROJ)) {
    try {
      for (const f of fs.readdirSync(path.join(PROJ, d))) after.add(`${d}/${f}`);
    } catch {}
  }
  const fresh = [...after].filter((x) => !before.has(x));
  console.log('new jsonl files:', fresh);
  console.log('--- tail ---');
  console.log(buf.slice(-1500));
  try { p.kill(); } catch {}
  process.exit(0);
}, 16000);
