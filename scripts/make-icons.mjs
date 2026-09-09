// Generates PWA icons (public/icons/*.png) with a tiny self-contained PNG encoder.
// No dependencies: node:zlib + hand-rolled CRC/CHUNK.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'icons');

// ---------- PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const si = y * w * 4 + x * 4;
      const di = y * (w * 4 + 1) + 1 + x * 4;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      raw[di + 3] = rgba[si + 3];
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- the sprite ----------
const BG = [0x0b, 0x0d, 0x14];
const GREEN = [0x33, 0xff, 0x66];
const DARK = [0x10, 0x14, 0x1f];
const WHEEL = [0x3a, 0x41, 0x52];

// 22 x 11 pixel car, nearest-scaled to each icon size.
const CAR = [
  '..........####........',
  '.......########.......',
  '......#..####..#......',
  '.....##..####..##.....',
  '....##############....',
  '...#################..',
  '...################...',
  '..###........###......',
  '..oo..........oo......',
];
const CAR_W = Math.max(...CAR.map((r) => r.length));
const carGrid = CAR.map((r) => (r + ' '.repeat(CAR_W)).slice(0, CAR_W));

const CAR_H = carGrid.length;
// carve out the windshield/roof window (dark) — rows 1-3, cols 8-11
for (let y = 1; y <= 3; y++) {
  for (let x = 8; x <= 11; x++) {
    if (carGrid[y][x] === '#') carGrid[y] = carGrid[y].slice(0, x) + 'x' + carGrid[y].slice(x + 1);
  }
}

function px(w, h) {
  const out = Buffer.alloc(w * h * 4);
  // letterbox the car (aspect 22:9) centered in the square
  const s = Math.min(w / CAR_W, h / CAR_H);
  const ox = (w - CAR_W * s) / 2;
  const oy = (h - CAR_H * s) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = BG[0];
      out[i + 1] = BG[1];
      out[i + 2] = BG[2];
      out[i + 3] = 255;
      const cx = Math.floor((x - ox) / s);
      const cy = Math.floor((y - oy) / s);
      if (cx >= 0 && cx < CAR_W && cy >= 0 && cy < CAR_H) {
        const ch = carGrid[cy][cx];
        let c = null;
        if (ch === '#') c = GREEN;
        else if (ch === 'o') c = WHEEL;
        else if (ch === 'x') c = DARK;
        if (c) {
          out[i] = c[0];
          out[i + 1] = c[1];
          out[i + 2] = c[2];
        }
      }
    }
  }
  return out;
}

function makeIcon(size, { maskable } = {}) {
  // maskable: keep content inside the inner 80% safe zone
  const s = maskable ? Math.floor(size * 0.8) : size;
  const img = px(s, s);
  if (s === size) return encodePNG(s, s, img);
  // paste centered on full-size bg
  const full = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    full[i * 4] = BG[0];
    full[i * 4 + 1] = BG[1];
    full[i * 4 + 2] = BG[2];
    full[i * 4 + 3] = 255;
  }
  const off = Math.floor((size - s) / 2);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const si = (y * s + x) * 4;
      const di = ((y + off) * size + x + off) * 4;
      full[di] = img[si];
      full[di + 1] = img[si + 1];
      full[di + 2] = img[si + 2];
      full[di + 3] = 255;
    }
  return encodePNG(size, size, full);
}

fs.mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-64.png', 64],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-180.png', 180],
  ['icon-maskable-512.png', 512, { maskable: true }],
];
for (const [name, size, opts] of targets) {
  const png = makeIcon(size, opts);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`  ${name}  ${png.length} bytes`);
}
console.log('icons OK →', path.relative(process.cwd(), OUT));
