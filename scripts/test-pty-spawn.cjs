const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const pty = require('node-pty');

const SESSIONS = path.join(os.homedir(), '.claude', 'sessions');
const beforeSet = new Set(fs.readdirSync(SESSIONS).filter((f) => f.endsWith('.json')));
console.log('BEFORE files:', beforeSet.size);

const CLAUDE_EXE = path.join(
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
const sessionId = require('node:crypto').randomUUID();
const args = ['--session-id', sessionId, '--permission-mode', 'auto'];
console.log('spawning:', CLAUDE_EXE, args.join(' '));

const p = pty.spawn(CLAUDE_EXE, args, {
  name: 'xterm-256color',
  cols: 200,
  rows: 50,
  cwd: __dirname,
  env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '0' },
  useConpty: true,
  encoding: 'utf8'
});
console.log('PTY pid:', p.pid);

let dataChunks = 0;
let buf = '';
p.onData((d) => {
  dataChunks++;
  buf += d;
  if (buf.length > 4000) buf = buf.slice(-4000);
});
process.on('exit', () => {
  console.log('--- PTY output ---');
  console.log(buf);
});
p.onExit(({ exitCode, signal }) => {
  console.log('PTY EXIT', exitCode, signal);
});

// Auto-answer "Yes, I trust this folder" by pressing Enter shortly after start.
setTimeout(() => {
  console.log('press Enter for trust dialog');
  try { p.write('\r'); } catch {}
}, 2500);

const start = Date.now();
const probe = setInterval(() => {
  const after = fs.readdirSync(SESSIONS).filter((f) => f.endsWith('.json'));
  const fresh = after.filter((f) => !beforeSet.has(f));
  const elapsed = Date.now() - start;
  console.log(`[t+${elapsed}ms] sessions: ${after.length} (new: ${fresh.length}) chunks: ${dataChunks}`);
  if (fresh.length > 0) {
    for (const f of fresh) {
      console.log('NEW', f);
      console.log(fs.readFileSync(path.join(SESSIONS, f), 'utf8'));
    }
    clearInterval(probe);
    setTimeout(() => {
      try { p.write('짧은 한글 prompt 테스트\r'); } catch {}
      setTimeout(() => {
        try { p.kill(); } catch {}
        process.exit(0);
      }, 3000);
    }, 100);
  }
}, 1500);

setTimeout(() => {
  console.log('TIMEOUT — no sessions file created');
  try { p.kill(); } catch {}
  process.exit(1);
}, 25000);
