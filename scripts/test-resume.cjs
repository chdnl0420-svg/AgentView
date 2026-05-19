// Try `claude --resume <sid>` via PTY and watch for trust-dialog vs prompt-ready
// markers. Streams the raw PTY output (with ANSI stripped) to stdout.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const pty = require('node-pty');

const SID = process.argv[2] || 'eecacf7d-02bc-4341-b21d-a6121c3f5157';
const CWD = process.argv[3] || path.join('D:\\', 'Project', 'VisualAgents', 'scripts');

const exe = path.join(
  os.homedir(),
  'AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
);
console.log('exe:', exe);
console.log('sid:', SID);
console.log('cwd:', CWD);

const args = ['--resume', SID, '--permission-mode', 'auto'];
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
let trustSeen = false;
let promptSeen = false;
let buf = '';

p.onData((d) => {
  const cleaned = d.replace(STRIP, '');
  buf += cleaned;
  if (buf.length > 6000) buf = buf.slice(-6000);
  if (!trustSeen && /trust this folder/i.test(buf)) {
    trustSeen = true;
    console.log(`[t+${Date.now() - start}ms] TRUST DIALOG detected → Enter`);
    setTimeout(() => p.write('\r'), 50);
  }
  if (!promptSeen && /Try\s+"|How can I help|claude-code|Tips for getting started|enter to confirm/i.test(buf)) {
    promptSeen = true;
    console.log(`[t+${Date.now() - start}ms] PROMPT-READY marker detected`);
  }
});

p.onExit(({ exitCode }) => {
  console.log(`PTY EXIT code=${exitCode}`);
});

const start = Date.now();

// At t=8s, type a probe message regardless of state.
setTimeout(() => {
  console.log(`[t+${Date.now() - start}ms] typing probe message`);
  p.write('이건 resume 확인 메시지');
  setTimeout(() => p.write('\r'), 100);
}, 8000);

setTimeout(() => {
  console.log('--- last 2000 chars of PTY output ---');
  console.log(buf.slice(-2000));
  try { p.kill(); } catch {}
  process.exit(0);
}, 16000);
