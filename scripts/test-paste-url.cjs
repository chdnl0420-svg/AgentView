const fs = require('fs');

const inputPath = 'C:\\Users\\NX3GAMES\\.claude\\agentview-pastes\\paste-2026-05-18_11-37-40-979.png';
console.log('input:', inputPath);

const norm = inputPath.replace(/\\/g, '/');
console.log('normalized:', norm);

const drive = norm[0].toUpperCase();
const url = 'av-file://local/' + drive + '/' + encodeURI(norm.slice(3));
console.log('url:', url);

let after = url.replace(/^av-file:\/\/(?:[^/]*)?\//, '');
console.log('after:', after);
after = after.split('?')[0].split('#')[0];
const decoded = decodeURI(after);
console.log('decoded:', decoded);

const driveMatch = /^([a-zA-Z])\/(.*)$/.exec(decoded);
console.log('driveMatch:', driveMatch && [driveMatch[1], driveMatch[2]]);

let pathname = driveMatch[1].toUpperCase() + ':/' + driveMatch[2];
pathname = pathname.replace(/\//g, '\\');
console.log('pathname:', pathname);

try {
  const stats = fs.statSync(pathname);
  console.log('OK file exists, size:', stats.size);
} catch (err) {
  console.log('ERR:', err.message);
}

// Also test what `new URL(...).pathname` looks like (Chromium-style):
try {
  const parsed = new URL(url);
  console.log('URL.pathname:', parsed.pathname);
  console.log('URL.host:', parsed.host);
  console.log('URL.href:', parsed.href);
} catch (e) {
  console.log('URL parse err:', e.message);
}
