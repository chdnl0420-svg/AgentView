// Validate the marker-based delivery logic against a real claude resume PTY.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const pty = require('node-pty');

const SID = process.argv[2] || 'eecacf7d-02bc-4341-b21d-a6121c3f5157';
const CWD = process.argv[3] || 'D:\\Project\\VisualAgents\\scripts';
const PROMPT = process.argv[4] || '두번째 resume 시도 — 한 줄 ack 만 줘.';

const exe = path.join(
  os.homedir(),
  'AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
);
const args = ['--resume', SID, '--permission-mode', 'auto'];
console.log('spawning', exe, args.join(' '));

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
const TRUST = /trust this folder/i;
const READY = /How can I help|Tips for getting started|to interrupt|\/effort|to cycle/i;

const start = Date.now();
let outputBuf = '';
let trustHandled = false;
let promptDelivered = false;
let pendingPrompt = PROMPT;

const deliver = () => {
  if (promptDelivered || !pendingPrompt) return;
  promptDelivered = true;
  const text = pendingPrompt.replace(/\r?\n/g, ' ');
  console.log(`[t+${Date.now() - start}ms] write prompt`);
  p.write(text);
  setTimeout(() => p.write('\r'), 100);
};

p.onData((d) => {
  const cleaned = d.replace(STRIP, '');
  outputBuf = (outputBuf + cleaned).slice(-6000);

  if (!trustHandled && TRUST.test(outputBuf)) {
    trustHandled = true;
    console.log(`[t+${Date.now() - start}ms] TRUST → Enter`);
    p.write('\r');
    setTimeout(deliver, 1500);
    return;
  }
  if (!promptDelivered && READY.test(outputBuf)) {
    trustHandled = true;
    console.log(`[t+${Date.now() - start}ms] READY marker → deliver`);
    setTimeout(deliver, 350);
  }
});

p.onExit(({ exitCode, signal }) => {
  console.log(`PTY EXIT ${exitCode} signal=${signal}`);
});

setTimeout(() => {
  if (!promptDelivered) {
    console.log(`[t+${Date.now() - start}ms] FALLBACK deliver`);
    deliver();
  }
}, 8000);

setTimeout(() => {
  console.log('--- tail outputBuf ---');
  console.log(outputBuf.slice(-1500));
  try { p.kill(); } catch {}
  process.exit(0);
}, 18000);
