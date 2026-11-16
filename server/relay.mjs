#!/usr/bin/env node
// WebSocket relay/lobby server for web-doom multiplayer (see CONTRACT.md).
// Serves web/ statically over HTTP and the lobby/relay at ws(s)://host:PORT/ws.
// Usage: node server/relay.mjs [port]   (default 8081, or $PORT)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..", "web");

export const MAX_TEXT_BYTES = 2048; // control messages
export const MAX_PACKET_BYTES = 512; // one game packet incl. the 1-byte header
const MAX_PLAYERS = 4;
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 200);
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP || 20);
const HEARTBEAT_MS = 30000;
// SERVE_STATIC=0 -> API-only relay (game hosted elsewhere, e.g. a CDN/static site).
const SERVE_STATIC = process.env.SERVE_STATIC !== "0";
// ALLOWED_ORIGINS=https://doom.example.com,https://other.example (empty = any origin)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const ROOM_RE = /^[A-Za-z0-9_-]{1,32}$/;
const NAME_MAX = 32;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".wad": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (urlPath.endsWith("/")) urlPath += "index.html";
  const filePath = path.join(webRoot, path.normalize(urlPath));
  if (!filePath.startsWith(webRoot + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found: " + urlPath);
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Cache-Control": "no-cache" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

const int = (v, lo, hi, def) => {
  const n = Number.isInteger(v) ? v : def;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * Create a relay server. Returns { server, wss, rooms, close() }.
 * Call server.listen(port) yourself (port 0 = random, useful for tests).
 */
export function createRelay() {
  /** @type {Map<string, Room>} */
  const rooms = new Map();
  // Room: { name, max, deathmatch, skill, episode, map, started, clients: Client[] }
  // Client: { ws, room: Room|null, player: number, name: string }

  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") return res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    if (!SERVE_STATIC) return res.writeHead(404).end("Not found");
    serveStatic(req, res);
  });
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4096,
    verifyClient: ({ origin, req }) => {
      if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return false;
      const ip = clientIp(req);
      let n = 0;
      for (const c of wss.clients) if (c.ip === ip) n++;
      return n < MAX_CONN_PER_IP;
    },
  });
  // Behind Container Apps ingress the real client is the first X-Forwarded-For entry.
  const clientIp = (req) =>
    String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  const send = (ws, obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  const broadcast = (room, obj, except = null) => {
    for (const c of room.clients) if (c !== except) send(c.ws, obj);
  };
  const rosterOf = (room) => ({ type: "roster", players: room.clients.map((c) => c.name) });
  const broadcastRoster = (room) => broadcast(room, rosterOf(room));

  function removeRoom(room) {
    if (rooms.get(room.name) === room) rooms.delete(room.name);
  }

  function leave(client) {
    const room = client.room;
    if (!room) return;
    client.room = null;
    if (!room.started) {
      if (client.player === 0) {
        // Host left the lobby: close the room for everyone.
        broadcast(room, { type: "closed", reason: "host left" }, client);
        for (const c of room.clients) if (c !== client) c.room = null;
        room.clients = [];
        removeRoom(room);
        return;
      }
      room.clients.splice(room.clients.indexOf(client), 1);
      // Re-index so node numbers stay contiguous 0..K-1.
      room.clients.forEach((c, i) => {
        if (c.player !== i) {
          c.player = i;
          send(c.ws, { type: "joined", player: i, numplayers: room.clients.length, max: room.max });
        }
      });
      broadcastRoster(room);
      if (room.clients.length === 0) removeRoom(room);
      return;
    }
    // Mid-game: keep the slot index (lockstep nodes are fixed), just notify.
    room.clients = room.clients.filter((c) => c !== client);
    broadcast(room, { type: "left", player: client.player });
    if (room.clients.length === 0) removeRoom(room);
  }

  function handleJoinOrCreate(ws, msg) {
    const name = typeof msg.name === "string" ? msg.name.slice(0, NAME_MAX) : "";
    if (typeof msg.room !== "string" || !ROOM_RE.test(msg.room)) {
      return send(ws, { type: "error", message: "invalid room name" }), ws.close();
    }
    let room = rooms.get(msg.room);
    if (msg.type === "create") {
      if (room) return send(ws, { type: "error", message: "room exists" }), ws.close();
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: "error", message: "server busy" }), ws.close();
      room = {
        name: msg.room,
        max: int(msg.max, 2, MAX_PLAYERS, MAX_PLAYERS),
        deathmatch: msg.deathmatch === true,
        skill: int(msg.skill, 1, 5, 3),
        episode: int(msg.episode, 1, 4, 1),
        map: int(msg.map, 1, 9, 1),
        started: false,
        clients: [],
      };
      rooms.set(room.name, room);
    } else {
      if (!room) return send(ws, { type: "error", message: "no such room" }), ws.close();
      if (room.started) return send(ws, { type: "error", message: "game already started" }), ws.close();
      if (room.clients.length >= room.max) return send(ws, { type: "error", message: "room full" }), ws.close();
    }
    const client = { ws, room, player: room.clients.length, name: name || `Player${room.clients.length + 1}` };
    room.clients.push(client);
    ws.client = client;
    send(ws, { type: "joined", player: client.player, numplayers: room.clients.length, max: room.max });
    broadcastRoster(room);
  }

  function handleStart(client) {
    const room = client.room;
    if (!room || room.started) return;
    if (client.player !== 0) return send(client.ws, { type: "error", message: "only host can start" });
    if (room.clients.length < 2) return send(client.ws, { type: "error", message: "need at least 2 players" });
    room.started = true;
    const numplayers = room.clients.length;
    for (const c of room.clients) {
      send(c.ws, {
        type: "start",
        numplayers,
        deathmatch: room.deathmatch,
        skill: room.skill,
        episode: room.episode,
        map: room.map,
        player: c.player,
      });
    }
  }

  function handlePacket(client, data) {
    const room = client.room;
    if (!room || !room.started) return; // drop packets before start
    if (data.length < 2 || data.length > MAX_PACKET_BYTES) return;
    const dest = data[0];
    const out = Buffer.concat([Buffer.from([client.player]), data.subarray(1)]);
    if (dest === 255) {
      for (const c of room.clients) if (c !== client && c.ws.readyState === c.ws.OPEN) c.ws.send(out);
      return;
    }
    if (dest === client.player) return;
    const target = room.clients.find((c) => c.player === dest);
    if (target && target.ws.readyState === target.ws.OPEN) target.ws.send(out);
  }

  // Drop dead connections (idle NAT/ingress timeouts) so rooms don't leak.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.alive === false) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws, req) => {
    ws.ip = clientIp(req);
    ws.alive = true;
    ws.on("pong", () => { ws.alive = true; });
    let joined = false;
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (joined) handlePacket(ws.client, Buffer.from(data));
        return;
      }
      if (joined) {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg && msg.type === "start") handleStart(ws.client);
        return;
      }
      if (data.length > MAX_TEXT_BYTES) return ws.close();
      let msg;
      try { msg = JSON.parse(data.toString()); } catch {
        send(ws, { type: "error", message: "bad json" });
        return ws.close();
      }
      if (!msg || typeof msg !== "object") return ws.close();
      if (msg.type === "create" || msg.type === "join") {
        joined = true;
        handleJoinOrCreate(ws, msg);
      } else {
        send(ws, { type: "error", message: "expected create or join" });
        ws.close();
      }
    });
    ws.on("close", () => {
      if (ws.client) leave(ws.client);
    });
    ws.on("error", () => {});
  });

  return {
    server,
    wss,
    rooms,
    close() {
      return new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      });
    },
  };
}

// Run as a script.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || process.env.PORT || 8081);
  const { server } = createRelay();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Relay + static web at http://localhost:${port}  (ws path /ws)`);
    console.log(`Multiplayer lobby: http://localhost:${port}/?room=NAME`);
  });
}
