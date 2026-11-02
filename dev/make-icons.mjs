// Generates the PNG app icons without external dependencies: `node dev/make-icons.mjs`
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'icons');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 4x4 supersampling for smooth edges.
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const p = pixel((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size);
        r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = Math.round((a / 16) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const RED_TOP = [211, 47, 47], RED_BOT = [160, 20, 20], WHITE = [255, 255, 255];
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

// Glyph: a bold "T" inside a speech bubble, scaled by `s` around the centre.
function glyph(x, y, s) {
  const u = (v) => 0.5 + (v - 0.5) * s;
  const bubble = inRoundRect(x, y, u(0.2), u(0.2), u(0.8), u(0.72), 0.1 * s) ||
    (y >= u(0.7) && y <= u(0.84) && x >= u(0.3) && x - u(0.3) <= (u(0.84) - y) * 1.05 && x <= u(0.45));
  if (!bubble) return null;
  const tBar = inRoundRect(x, y, u(0.32), u(0.3), u(0.68), u(0.4), 0.02 * s);
  const tStem = inRoundRect(x, y, u(0.45), u(0.3), u(0.55), u(0.63), 0.02 * s);
  return tBar || tStem ? 'cut' : 'bubble';
}

function icon({ maskable = false, rounded = false } = {}) {
  return (x, y) => {
    if (rounded && !inRoundRect(x, y, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];
    const bg = RED_TOP.map((c, i) => c + (RED_BOT[i] - c) * y);
    const g = glyph(x, y, maskable ? 0.78 : 1);
    if (g === 'bubble') return [...WHITE, 1];
    return [...bg, 1];
  };
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, icon()));
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, icon({ rounded: true })));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, icon({ rounded: true })));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), png(512, icon({ maskable: true })));
fs.writeFileSync(path.join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d32f2f"/><stop offset="1" stop-color="#a01414"/></linearGradient></defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <path fill="#fff" fill-rule="evenodd" d="M30 20h40a10 10 0 0 1 10 10v32a10 10 0 0 1-10 10H45l-15 12V72a10 10 0 0 1-10-10V30a10 10 0 0 1 10-10zM32 30v10h13v23h10V40h13V30z"/>
</svg>
`);
console.log('icons written to', out);
