// Drop a dispatch JSON into ~/.claude/daemon/dispatch and watch roster.json
// for a new worker. Confirms whether the daemon picks up file-drop dispatches.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const DAEMON = path.join(os.homedir(), '.claude', 'daemon');
const ROSTER = path.join(DAEMON, 'roster.json');
const DISPATCH = path.join(DAEMON, 'dispatch');

const sid = crypto.randomUUID();
const short = sid.slice(0, 8);
const nonce = crypto.randomBytes(4).toString('hex');
const dispatchObj = {
  proto: 1,
  short,
  nonce,
  sessionId: sid,
  createdAt: Date.now(),
  source: 'spare',
  cwd: 'D:\\Project\\VisualAgents',
  launch: {
    mode: 'prompt',
    args: ['--session-id', sid, '--agent', 'claude']
  },
  env: {},
  isolation: 'none',
  respawnFlags: ['--agent', 'claude'],
  agent: 'claude',
  seed: { intent: 'AgentView dispatch test' },
  cols: 120,
  rows: 30
};

const target = path.join(DISPATCH, `${short}.json`);
fs.writeFileSync(target, JSON.stringify(dispatchObj, null, 2), 'utf8');
console.log('wrote', target);
console.log('short =', short);

function rosterWorkers() {
  try {
    const r = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
    return Object.keys(r.workers || {});
  } catch {
    return [];
  }
}

const before = new Set(rosterWorkers());
const start = Date.now();
const probe = setInterval(() => {
  const now = rosterWorkers();
  const fresh = now.filter((s) => !before.has(s));
  console.log(`[t+${Date.now() - start}ms] workers=${now.length} new=${JSON.stringify(fresh)}`);
  // also check if the dispatch file got consumed
  const stillThere = fs.existsSync(target);
  if (!stillThere) console.log('  dispatch file consumed');
  if (fresh.length > 0 || Date.now() - start > 8000) {
    clearInterval(probe);
    console.log('\nfinal:', { fresh, dispatchFileGone: !stillThere });
    // cleanup
    try { if (stillThere) fs.unlinkSync(target); } catch {}
    process.exit(0);
  }
}, 1000);
