import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GRAD_START = [0x7c, 0x9b, 0xff];
const GRAD_END = [0xb3, 0x88, 0xff];
const A_COLOR = [0x0b, 0x0d, 0x12];
const RADIUS_RATIO = 7 / 26;
const SUPERSAMPLE = 4;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function gradientColor(x, y, w, h) {
  const t = Math.max(0, Math.min(1, (x + y) / (w + h - 2)));
  return [
    Math.round(lerp(GRAD_START[0], GRAD_END[0], t)),
    Math.round(lerp(GRAD_START[1], GRAD_END[1], t)),
    Math.round(lerp(GRAD_START[2], GRAD_END[2], t))
  ];
}

function inRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  if (x >= r && x <= w - r - 1) return true;
  if (y >= r && y <= h - r - 1) return true;
  let cx, cy;
  if (x < r && y < r) { cx = r; cy = r; }
  else if (x > w - r - 1 && y < r) { cx = w - r - 1; cy = r; }
  else if (x < r && y > h - r - 1) { cx = r; cy = h - r - 1; }
  else { cx = w - r - 1; cy = h - r - 1; }
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function inLetterA(x, y, size) {
  const s = size / 256;
  const apexX = 128 * s, apexY = 50 * s;
  const baseLX = 62 * s, baseLY = 206 * s;
  const baseRX = 194 * s, baseRY = 206 * s;
  const halfW = 17 * s;
  const yMin = 48 * s, yMax = 206 * s;

  if (y >= yMin && y <= yMax) {
    if (distToSegment(x, y, baseLX, baseLY, apexX, apexY) <= halfW) return true;
    if (distToSegment(x, y, apexX, apexY, baseRX, baseRY) <= halfW) return true;
  }
  const cbY1 = 140 * s, cbY2 = 162 * s;
  const cbX1 = 80 * s, cbX2 = 176 * s;
  if (y >= cbY1 && y <= cbY2 && x >= cbX1 && x <= cbX2) return true;

  return false;
}

function renderIcon(size) {
  const ss = SUPERSAMPLE;
  const W = size * ss;
  const radius = Math.round(size * RADIUS_RATIO) * ss;
  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const xs = x * ss + sx;
          const ys = y * ss + sy;
          if (inRoundedRect(xs, ys, W, W, radius)) {
            const lx = xs / ss;
            const ly = ys / ss;
            if (inLetterA(lx, ly, size)) {
              r += A_COLOR[0]; g += A_COLOR[1]; b += A_COLOR[2];
            } else {
              const c = gradientColor(xs, ys, W, W);
              r += c[0]; g += c[1]; b += c[2];
            }
            a += 255;
          }
          count++;
        }
      }
      const idx = (y * size + x) * 4;
      pixels[idx] = Math.round(r / count);
      pixels[idx + 1] = Math.round(g / count);
      pixels[idx + 2] = Math.round(b / count);
      pixels[idx + 3] = Math.round(a / count);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(pixels, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0;
    pixels.subarray(y * stride, (y + 1) * stride).forEach((v, i) => {
      raw[y * (1 + stride) + 1 + i] = v;
    });
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', deflateSync(raw, { level: 9 }));
  const iend = makeChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

mkdirSync('resources', { recursive: true });

const main = renderIcon(256);
writeFileSync('resources/icon.png', encodePNG(main, 256, 256));
console.log('wrote resources/icon.png');

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({
  size,
  png: encodePNG(renderIcon(size), size, size)
}));
writeFileSync('resources/icon.ico', encodeICO(images));
console.log('wrote resources/icon.ico (' + sizes.join(', ') + ')');
