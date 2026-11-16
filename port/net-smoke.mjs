// Multiplayer sync test: N wasm instances connected through in-process packet queues.
//   node port/net-smoke.mjs   (after port/build.sh)   env: PLAYERS=2..4 TICS=400
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'web', 'dist');
const work = join(root, 'build', 'netsmoke');
const N = Number(process.env.PLAYERS || 2);
const TICS = Number(process.env.TICS || 400);

for (const f of ['doom.js', 'doom.wasm', 'doom.data'])
  if (!existsSync(join(dist, f))) { console.error(`missing ${f}; run port/build.sh`); process.exit(1); }
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'package.json'), '{"type":"module"}\n');
for (const f of ['doom.js', 'doom.wasm', 'doom.data']) copyFileSync(join(dist, f), join(work, f));
process.chdir(work);
const { default: createDoom } = await import(pathToFileURL(join(work, 'doom.js')).href);

const nodes = [];
const inbox = Array.from({ length: N }, () => []); // packets in flight to player i: {src, data}
const stats = { sent: 0, dropped: 0 };
const DROP = Number(process.env.DROP || 0); // fraction of packets to drop (loss test)

for (let i = 0; i < N; i++) {
  const M = await createDoom();
  const n = {
    i, M,
    cfg: M.cwrap('doom_net_config', null, Array(6).fill('number')),
    push: M.cwrap('doom_net_push', 'number', ['number', 'number', 'number']),
    bufp: M.ccall('doom_net_buffer', 'number', [], []),
    tick: M.cwrap('doom_tick', null, []),
    key: M.cwrap('doom_key', null, ['number', 'number']),
    sum: M.cwrap('doom_net_checksum', 'number', []),
    gametic: M.cwrap('doom_net_gametic', 'number', []),
    sums: new Map(),
  };
  M.netSend = (dest, ptr, len) => {
    const data = Uint8Array.from(M.HEAPU8.subarray(ptr, ptr + len));
    stats.sent++;
    if (Math.random() < DROP) { stats.dropped++; return; }
    if (dest === 255) { for (let j = 0; j < N; j++) if (j !== i) inbox[j].push({ src: i, data }); }
    else inbox[dest].push({ src: i, data });
  };
  n.cfg(N, i, 0, 3, 1, 1);
  M.ccall('doom_init', null, [], []);
  nodes.push(n);
}

const deliver = (n) => {
  const q = inbox[n.i];
  while (q.length) {
    const { src, data } = q.shift();
    n.M.HEAPU8.set(data, n.bufp);
    n.push(src, n.bufp, data.length);
  }
};

const KEYS = { up: 0xad, left: 0xac, right: 0xae, ctrl: 0x80 + 0x1d, space: 32 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let iter = 0;
const start = Date.now();
while (Math.min(...nodes.map((n) => n.gametic())) < TICS) {
  if (Date.now() - start > 120000) { console.error('NET FAIL: timeout, gametics=' + nodes.map((n) => n.gametic())); process.exit(1); }
  // scripted input: everyone walks, players turn differently, some fire / use
  if (iter === 5) for (const n of nodes) n.key(KEYS.up, 1);
  if (iter === 20) nodes.forEach((n, k) => n.key(k % 2 ? KEYS.left : KEYS.right, 1));
  if (iter % 97 === 50) nodes.forEach((n, k) => n.key(KEYS.ctrl, (iter / 97 + k) & 1));
  if (iter % 131 === 60) nodes.forEach((n, k) => n.key(KEYS.space, (k + (iter / 131 | 0)) & 1));
  for (const n of nodes) {
    deliver(n);
    n.tick();
    const g = n.gametic();
    if (g > 0) n.sums.set(g, n.sum());
  }
  iter++;
  if (iter % 4 === 0) await sleep(5);
}

let compared = 0, bad = 0, firstBad = -1;
const distinct = new Set();
for (const [g, s] of nodes[0].sums) {
  if (!nodes.every((n) => n.sums.has(g))) continue;
  compared++;
  distinct.add(s);
  if (!nodes.every((n) => n.sums.get(g) === s)) { bad++; if (firstBad < 0) firstBad = g; }
}
console.log(`players=${N} gametics=${nodes.map((n) => n.gametic())} compared=${compared} distinct-states=${distinct.size} mismatches=${bad} packets=${stats.sent} dropped=${stats.dropped}`);
const ok = compared >= TICS / 2 && bad === 0 && distinct.size > 20;
console.log(ok ? 'NET SMOKE PASS' : `NET SMOKE FAIL (first mismatch at gametic ${firstBad})`);
process.exit(ok ? 0 : 1);
