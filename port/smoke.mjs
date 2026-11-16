// Node smoke test for the wasm build (run: node port/smoke.mjs after port/build.sh).
// Loads web/dist/doom.js, calls doom_init, ticks ~100 frames, checks the framebuffer.
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'web', 'dist');
const work = join(root, 'build', 'smoke');
const FRAMES = Number(process.env.FRAMES || 100);

for (const f of ['doom.js', 'doom.wasm', 'doom.data']) {
  if (!existsSync(join(dist, f))) { console.error(`missing ${f}; run port/build.sh`); process.exit(1); }
}
// Copy into an ESM-typed dir so Node can import the ES-module build.
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'package.json'), '{"type":"module"}\n');
for (const f of ['doom.js', 'doom.wasm', 'doom.data']) copyFileSync(join(dist, f), join(work, f));

// Emscripten 7's Node loader resolves doom.data relative to the CWD.
process.chdir(work);
const { default: createDoom } = await import(pathToFileURL(join(work, 'doom.js')).href);
const Module = await createDoom();

const fnv = (bytes) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
};

const t0 = Date.now();
Module.ccall('doom_init', null, [], []);
console.log(`doom_init ok (${Date.now() - t0} ms)`);

const fbPtr = Module.ccall('doom_framebuffer', 'number', [], []);
const palPtr = Module.ccall('doom_palette', 'number', [], []);
const tick = Module.cwrap('doom_tick', null, []);

let frames = 0;
for (; frames < FRAMES; frames++) {
  tick();
  // Let wall-clock time advance so the 35 Hz game clock moves on.
  if (frames % 10 === 9) await new Promise((r) => setTimeout(r, 30));
}

const fb = Module.HEAPU8.subarray(fbPtr, fbPtr + 320 * 200);
const pal = Module.HEAPU8.subarray(palPtr, palPtr + 256 * 3);
let nonzero = 0;
const seen = new Set();
for (const b of fb) { if (b) nonzero++; seen.add(b); }
const fbSum = fnv(fb);
const palSum = fnv(pal);
console.log(`ticks=${frames} framebuffer nonzero=${nonzero}/64000 distinct=${seen.size} fnv=${fbSum}`);
console.log(`palette fnv=${palSum} first=${[...pal.subarray(0, 6)].join(',')}`);

const ok = nonzero > 0 && seen.size > 1;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);
