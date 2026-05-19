// Spawn `claude agents` in a PTY, capture initial TUI frame, then quit.
// Goal: count exactly what the CLI shows so we can match it in AgentView.
const pty = require('node-pty');
const path = require('path');
const os = require('os');

const exe = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'npm',
  'node_modules',
  '@anthropic-ai',
  'claude-code',
  'bin',
  'claude.exe'
);

const p = pty.spawn(exe, ['agents'], {
  name: 'xterm-256color',
  cols: 200,
  rows: 50,
  cwd: os.homedir(),
  env: process.env,
  useConpty: true,
  encoding: 'utf8'
});

let buf = '';
p.onData((chunk) => {
  buf += chunk;
});

setTimeout(() => {
  // Quit the TUI: send 'q'
  try {
    p.write('q');
  } catch {}
  setTimeout(() => {
    try { p.kill(); } catch {}
    // Strip ANSI
    const stripped = buf.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\]0;[^\x07]*\x07|\x1b[\(\)][A-Z0-9]|\x1b[=>]|\r/g, '');
    console.log('=== RAW (last 8KB) ===');
    console.log(stripped.slice(-8000));
    process.exit(0);
  }, 500);
}, 4000);
