import { cpSync, mkdirSync, renameSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const ROOT = resolve('.');
const OUT_DIR = join(ROOT, 'dist', 'win-unpacked');
const APP_DIR = join(OUT_DIR, 'resources', 'app');
const ELECTRON_DIST = join(ROOT, 'node_modules', 'electron', 'dist');
const ICON_PATH = join(ROOT, 'resources', 'icon.ico');
const RCEDIT = join(
  homedir(),
  'AppData',
  'Local',
  'electron-builder',
  'Cache',
  'winCodeSign',
  '197675495',
  'rcedit-x64.exe'
);

if (!existsSync(ELECTRON_DIST)) {
  throw new Error('node_modules/electron/dist not found');
}
if (!existsSync(ICON_PATH)) {
  throw new Error('resources/icon.ico not found — run scripts/generate-icon.mjs first');
}
if (!existsSync(join(ROOT, 'out', 'main', 'index.js'))) {
  throw new Error('out/main/index.js not found — run electron-vite build first');
}

console.log('cleaning', OUT_DIR);
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

console.log('copying Electron runtime');
cpSync(ELECTRON_DIST, OUT_DIR, { recursive: true });
renameSync(join(OUT_DIR, 'electron.exe'), join(OUT_DIR, 'AgentView.exe'));

const defaultApp = join(OUT_DIR, 'resources', 'default_app.asar');
if (existsSync(defaultApp)) rmSync(defaultApp);

console.log('copying app bundle');
mkdirSync(APP_DIR, { recursive: true });
cpSync(join(ROOT, 'out'), join(APP_DIR, 'out'), { recursive: true });

const pkg = JSON.parse(
  execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(require("./package.json")))'], {
    cwd: ROOT
  }).toString()
);
const slimPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  main: pkg.main,
  author: pkg.author,
  dependencies: pkg.dependencies ?? {}
};
writeFileSync(join(APP_DIR, 'package.json'), JSON.stringify(slimPkg, null, 2));

const RUNTIME_DEPS = ['node-pty'];
for (const dep of RUNTIME_DEPS) {
  const src = join(ROOT, 'node_modules', dep);
  if (existsSync(src)) {
    cpSync(src, join(APP_DIR, 'node_modules', dep), { recursive: true });
  }
}

console.log('copying icon');
cpSync(ICON_PATH, join(OUT_DIR, 'resources', 'icon.ico'));
cpSync(join(ROOT, 'resources', 'icon.png'), join(OUT_DIR, 'resources', 'icon.png'));

if (existsSync(RCEDIT)) {
  console.log('embedding icon via rcedit');
  execFileSync(RCEDIT, [
    join(OUT_DIR, 'AgentView.exe'),
    '--set-icon', ICON_PATH,
    '--set-version-string', 'ProductName', 'AgentView',
    '--set-version-string', 'FileDescription', 'AgentView',
    '--set-version-string', 'CompanyName', 'VisualAgents',
    '--set-file-version', pkg.version,
    '--set-product-version', pkg.version
  ], { stdio: 'inherit' });
} else {
  console.warn('rcedit not found — icon will not be embedded in exe');
}

console.log('done:', join(OUT_DIR, 'AgentView.exe'));
