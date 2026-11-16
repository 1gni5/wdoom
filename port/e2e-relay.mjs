// End-to-end: 2 wasm instances + real NetClient (web/net.js) + real relay (server/relay.mjs).
//   node port/e2e-relay.mjs   (after port/build.sh)
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'build', 'e2e');
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'package.json'), '{"type":"module"}\n');
for (const f of ['doom.js', 'doom.wasm', 'doom.data']) copyFileSync(join(root, 'web/dist', f), join(work, f));
const { NetClient } = await import(pathToFileURL(join(root, 'web/net.js')).href);
process.chdir(work);
const { default: createDoom } = await import(pathToFileURL(join(work, 'doom.js')).href);

const PORT = 18000 + Math.floor(Math.random() * 1000);
const relay = spawn('node', [join(root, 'server/relay.mjs'), String(PORT)], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('E2E FAIL: ' + m); relay.kill(); process.exit(1); };
setTimeout(() => fail('timeout'), 90000);
await sleep(800);

const url = `ws://127.0.0.1:${PORT}/ws`;
const clients = [];
for (const [i, name] of ['host', 'guest'].entries()) {
  const c = { sums: new Map() };
  c.startMsg = new Promise((res) => {
    c.net = new NetClient({ url, onStart: res, onError: (e) => fail(e.message) });
  });
  await c.net.connect(i === 0
    ? { type: 'create', room: 'e2e', name, max: 2, deathmatch: false, skill: 3, episode: 1, map: 1 }
    : { type: 'join', room: 'e2e', name });
  clients.push(c);
  await sleep(300);
}
clients[0].net.start();
for (const c of clients) {
  const m = await c.startMsg;
  const M = c.M = await createDoom();
  c.net.attach(M);
  M.ccall('doom_net_config', null, Array(6).fill('number'),
    [m.numplayers, m.player, m.deathmatch ? 1 : 0, m.skill, m.episode, m.map]);
  M.ccall('doom_init', null, [], []);
  c.tick = M.cwrap('doom_tick', null, []);
  c.key = M.cwrap('doom_key', null, ['number', 'number']);
  c.sum = M.cwrap('doom_net_checksum', 'number', []);
  c.gt = M.cwrap('doom_net_gametic', 'number', []);
}
const TICS = 300;
let it = 0;
while (Math.min(...clients.map((c) => c.gt())) < TICS) {
  if (it === 5) clients.forEach((c) => c.key(0xad, 1));
  if (it === 20) clients.forEach((c, k) => c.key(k ? 0xac : 0xae, 1));
  for (const c of clients) { c.tick(); const g = c.gt(); if (g > 0) c.sums.set(g, c.sum()); }
  it++;
  await sleep(5);
}
let cmp = 0, bad = 0;
for (const [g, s] of clients[0].sums) if (clients[1].sums.has(g)) { cmp++; if (clients[1].sums.get(g) !== s) bad++; }
console.log(`compared=${cmp} mismatches=${bad}`);
relay.kill();
console.log(cmp > TICS / 2 && !bad ? 'E2E PASS' : 'E2E FAIL');
process.exit(cmp > TICS / 2 && !bad ? 0 : 1);
