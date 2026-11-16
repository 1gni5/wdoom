// Extracts Doom's own UI graphics from the (uncommitted) WAD into web/dist/ui/:
//   logo.png   - M_DOOM, the iconic title logo
//   font.png + font.json - STCFN menu font atlas (glyphs 33..95), used for headings
// No dependencies. Run: node scripts/extract-assets.mjs   (needs build/doom1.wad)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wadPath = join(root, 'build', 'doom1.wad');
if (!existsSync(wadPath)) { console.error('missing build/doom1.wad (run scripts/fetch-wad.sh)'); process.exit(1); }
const wad = readFileSync(wadPath);
const n = wad.readInt32LE(4), dir = wad.readInt32LE(8);
const lumps = new Map();
for (let i = 0; i < n; i++) {
  const o = dir + i * 16;
  const name = wad.toString('latin1', o + 8, o + 16).replace(/\0.*$/, '');
  if (!lumps.has(name)) lumps.set(name, wad.subarray(wad.readInt32LE(o), wad.readInt32LE(o) + wad.readInt32LE(o + 4)));
}
const pal = lumps.get('PLAYPAL');

function decodePatch(buf) {
  const w = buf.readInt16LE(0), h = buf.readInt16LE(2);
  const px = new Uint8Array(w * h * 4); // RGBA, transparent by default
  for (let x = 0; x < w; x++) {
    let p = buf.readInt32LE(8 + x * 4);
    for (;;) {
      const top = buf[p++];
      if (top === 0xff) break;
      const len = buf[p++]; p++;
      for (let k = 0; k < len; k++) {
        const c = buf[p++], y = top + k, o = (y * w + x) * 4;
        px[o] = pal[c * 3]; px[o + 1] = pal[c * 3 + 1]; px[o + 2] = pal[c * 3 + 2]; px[o + 3] = 255;
      }
      p++;
    }
  }
  return { w, h, px };
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = ~0; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = join(root, 'web', 'dist', 'ui');
mkdirSync(out, { recursive: true });

const logo = decodePatch(lumps.get('M_DOOM'));
writeFileSync(join(out, 'logo.png'), png(logo.w, logo.h, logo.px));

// Font atlas: one row, glyphs STCFN033..STCFN095 (uppercase only, like the game menu)
const glyphs = [];
for (let c = 33; c <= 95; c++) { const l = lumps.get('STCFN' + String(c).padStart(3, '0')); if (l) glyphs.push({ c, ...decodePatch(l) }); }
const H = Math.max(...glyphs.map((g) => g.h));
const W = glyphs.reduce((s, g) => s + g.w, 0);
const atlas = new Uint8Array(W * H * 4);
const meta = { height: H, space: 4, glyphs: {} };
let x0 = 0;
for (const g of glyphs) {
  for (let y = 0; y < g.h; y++) atlas.set(g.px.subarray(y * g.w * 4, (y + 1) * g.w * 4), (y * W + x0) * 4);
  meta.glyphs[String.fromCharCode(g.c)] = { x: x0, w: g.w };
  x0 += g.w;
}
writeFileSync(join(out, 'font.png'), png(W, H, atlas));
writeFileSync(join(out, 'font.json'), JSON.stringify(meta));
console.log(`ui assets -> web/dist/ui (logo ${logo.w}x${logo.h}, font ${glyphs.length} glyphs)`);
