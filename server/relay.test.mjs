// Run: node --test server/relay.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createRelay } from "./relay.mjs";

let relay, port;
before(async () => {
  relay = createRelay();
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  port = relay.server.address().port;
});
after(() => relay.close());

// Minimal client wrapper: queues text (parsed) and binary messages.
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const texts = [];
    const bins = [];
    const waiters = [];
    const pump = () => {
      for (let i = 0; i < waiters.length; i++) {
        const w = waiters[i];
        const q = w.kind === "bin" ? bins : texts;
        const idx = q.findIndex(w.match);
        if (idx >= 0) {
          const [item] = q.splice(idx, 1);
          waiters.splice(i, 1);
          return w.resolve(item), pump();
        }
      }
    };
    ws.on("message", (data, isBinary) => {
      if (isBinary) bins.push(Buffer.from(data));
      else texts.push(JSON.parse(data.toString()));
      pump();
    });
    ws.on("open", () => resolve({
      ws,
      send: (o) => ws.send(JSON.stringify(o)),
      sendBin: (b) => ws.send(Buffer.from(b)),
      next: (type, ms = 1000, pred = () => true) => waitFor(texts, "text", (m) => m.type === type && pred(m), ms),
      nextBin: (ms = 1000) => waitFor(bins, "bin", () => true, ms),
      noBin: (ms = 150) => new Promise((r) => setTimeout(() => r(bins.length === 0), ms)),
      closed: () => new Promise((r) => ws.once("close", r)),
    }));
    ws.on("error", reject);
    function waitFor(q, kind, match, ms) {
      return new Promise((resolve, reject) => {
        const idx = q.findIndex(match);
        if (idx >= 0) return resolve(q.splice(idx, 1)[0]);
        const t = setTimeout(() => reject(new Error(`timeout waiting for ${kind}`)), ms);
        waiters.push({ kind, match, resolve: (v) => (clearTimeout(t), resolve(v)) });
      });
    }
  });
}

test("create, join, roster, start with player indices", async () => {
  const host = await connect();
  host.send({ type: "create", room: "r1", max: 3, deathmatch: true, skill: 4, episode: 1, map: 2 });
  assert.deepEqual(await host.next("joined"), { type: "joined", player: 0, numplayers: 1, max: 3 });
  assert.deepEqual((await host.next("roster")).players, ["Player1"]);

  const bob = await connect();
  bob.send({ type: "join", room: "r1", name: "Bob" });
  assert.deepEqual(await bob.next("joined"), { type: "joined", player: 1, numplayers: 2, max: 3 });
  assert.deepEqual((await host.next("roster")).players, ["Player1", "Bob"]);
  assert.deepEqual((await bob.next("roster")).players, ["Player1", "Bob"]);

  const cy = await connect();
  cy.send({ type: "join", room: "r1", name: "Cy" });
  await cy.next("joined");

  // Non-host cannot start.
  bob.send({ type: "start" });
  assert.equal((await bob.next("error")).message, "only host can start");

  host.send({ type: "start" });
  const s0 = await host.next("start");
  const s1 = await bob.next("start");
  const s2 = await cy.next("start");
  assert.equal(s0.numplayers, 3);
  assert.deepEqual([s0.player, s1.player, s2.player], [0, 1, 2]);
  assert.equal(s0.deathmatch, true);
  assert.equal(s0.skill, 4);
  assert.equal(s0.map, 2);
  assert.equal(s0.episode, 1);

  // Binary routing: dest node, src prefix.
  host.sendBin([1, 0xaa, 0xbb]);
  assert.deepEqual([...(await bob.nextBin())], [0, 0xaa, 0xbb]);
  assert.ok(await cy.noBin(), "cy must not receive a packet addressed to bob");

  bob.sendBin([0, 7, 8, 9]);
  assert.deepEqual([...(await host.nextBin())], [1, 7, 8, 9]);

  // Broadcast to everyone else.
  cy.sendBin([255, 5]);
  assert.deepEqual([...(await host.nextBin())], [2, 5]);
  assert.deepEqual([...(await bob.nextBin())], [2, 5]);

  // Oversize packet dropped, connection stays alive.
  bob.sendBin(new Uint8Array(600).fill(1));
  bob.sendBin([0, 42]);
  assert.deepEqual([...(await host.nextBin())], [1, 42]);

  // Mid-game leave notifies others.
  cy.ws.close();
  assert.deepEqual(await host.next("left"), { type: "left", player: 2 });
  assert.deepEqual(await bob.next("left"), { type: "left", player: 2 });

  host.ws.close();
  bob.ws.close();
});

test("binary before start is dropped", async () => {
  const host = await connect();
  host.send({ type: "create", room: "early" });
  await host.next("joined");
  const bob = await connect();
  bob.send({ type: "join", room: "early" });
  await bob.next("joined");
  host.sendBin([1, 1, 2, 3]);
  assert.ok(await bob.noBin(), "packet before start must be dropped");
  host.ws.close();
  bob.ws.close();
});

test("room full, duplicate room, unknown room, bad json", async () => {
  const a = await connect();
  a.send({ type: "create", room: "tiny", max: 2 });
  await a.next("joined");

  const dup = await connect();
  dup.send({ type: "create", room: "tiny" });
  assert.equal((await dup.next("error")).message, "room exists");

  const b = await connect();
  b.send({ type: "join", room: "tiny" });
  await b.next("joined");

  const c = await connect();
  c.send({ type: "join", room: "tiny" });
  assert.equal((await c.next("error")).message, "room full");

  const none = await connect();
  none.send({ type: "join", room: "nope" });
  assert.equal((await none.next("error")).message, "no such room");

  const bad = await connect();
  bad.ws.send("{not json");
  assert.equal((await bad.next("error")).message, "bad json");

  const badName = await connect();
  badName.send({ type: "create", room: "../etc" });
  assert.equal((await badName.next("error")).message, "invalid room name");

  a.ws.close();
  b.ws.close();
});

test("pre-start leave re-indexes; empty rooms are removed", async () => {
  const host = await connect();
  host.send({ type: "create", room: "lobby3" });
  await host.next("joined");
  const x = await connect();
  x.send({ type: "join", room: "lobby3", name: "X" });
  await x.next("joined");
  const y = await connect();
  y.send({ type: "join", room: "lobby3", name: "Y" });
  await y.next("joined");

  x.ws.close();
  await host.next("roster", 1000, (m) => m.players.length === 2 && m.players[1] === "Y");
  const j = await y.next("joined");
  assert.equal(j.player, 1);
  host.send({ type: "start" });
  assert.equal((await y.next("start")).player, 1);

  host.ws.close();
  y.ws.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(relay.rooms.has("lobby3"), false);
});
