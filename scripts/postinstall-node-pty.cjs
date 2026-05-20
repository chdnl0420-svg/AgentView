// node-pty postinstall — ensure the prebuilt binaries land in
// node_modules/node-pty/build/Release even when `npm install` runs inside
// a worktree where electron-rebuild's gyp step fails (Windows missing
// VS Build Tools, or this is a release worktree off the main tree).
//
// Strategy: locate a sibling worktree / the main project root that already
// has node_modules/node-pty/build/Release populated, and copy the .node
// binaries + conpty/ directory across.

const fs = require('node:fs');
const path = require('node:path');

const SELF_RELEASE = path.join(__dirname, '..', 'node_modules', 'node-pty', 'build', 'Release');
if (hasBuiltBinary(SELF_RELEASE)) {
  console.log('[postinstall-node-pty] prebuilts already present:', SELF_RELEASE);
  process.exit(0);
}

const candidates = collectCandidates();
for (const dir of candidates) {
  const src = path.join(dir, 'node_modules', 'node-pty', 'build', 'Release');
  if (!hasBuiltBinary(src)) continue;
  console.log('[postinstall-node-pty] copying prebuilts from', src);
  try {
    fs.mkdirSync(SELF_RELEASE, { recursive: true });
    copyRecursive(src, SELF_RELEASE);
    console.log('[postinstall-node-pty] done — copied prebuilts into', SELF_RELEASE);
    process.exit(0);
  } catch (err) {
    console.warn('[postinstall-node-pty] copy failed:', err && err.message);
  }
}

console.warn(
  '[postinstall-node-pty] WARNING: no prebuilt node-pty binaries found. ' +
    'Build will run but the app will fail to spawn PTY sessions. ' +
    'Run @electron/rebuild manually or point at a main tree that has node-pty built.'
);
process.exit(0);

function hasBuiltBinary(dir) {
  if (!fs.existsSync(dir)) return false;
  const entries = fs.readdirSync(dir);
  return entries.some((f) => f.endsWith('.node'));
}

function collectCandidates() {
  // Project root and one level up — covers the common "worktree off main"
  // layout where the main tree has the built binaries.
  const here = path.resolve(__dirname, '..');
  const cands = new Set();
  cands.add(path.resolve(here, '..'));
  cands.add(path.resolve(here, '..', '..'));
  // .claude/worktrees siblings
  const siblings = path.resolve(here, '..');
  try {
    if (fs.existsSync(siblings)) {
      for (const name of fs.readdirSync(siblings)) {
        cands.add(path.join(siblings, name));
      }
    }
  } catch {
    /* ignore */
  }
  // Anything explicitly pointed to by env
  if (process.env.AGENTVIEW_PTY_DONOR) cands.add(process.env.AGENTVIEW_PTY_DONOR);
  return [...cands].filter((p) => p !== here);
}

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}
