# Port <-> Web contract
Build output: `web/dist/doom.js` + `doom.wasm` + `doom.data` (ES module factory `createDoom`, MODULARIZE=1, EXPORT_ES6=1), built by `port/build.sh`.
WAD: `doom1.wad` preloaded at `/doom1.wad` in the Emscripten FS (downloaded by `scripts/fetch-wad.sh`, not committed).
Exported C functions (via ccall/cwrap, all prefixed `_`):
- `void doom_init(void)`  – starts the game (args: `doom -iwad /doom1.wad`), no blocking loop.
- `void doom_tick(void)`  – runs one game frame (call from requestAnimationFrame; game logic internally runs at 35 Hz based on time).
- `void doom_key(int doomkey, int down)` – doomkey = Doom key codes from doomdef.h (KEY_*, ASCII lowercase for letters).
- `void doom_mouse(int dx, int dy, int buttons)` – relative motion, buttons bitmask 1=left 2=right 4=middle.
- `uint8_t* doom_framebuffer(void)` – 320x200 8-bit palette indices (row-major).
- `uint8_t* doom_palette(void)` – 256*3 RGB bytes (gamma already applied), valid after each frame.
Sound: stubbed (silent) in v1. Net: disabled.
Submodule `third_party/DOOM` must NOT be modified; port uses files in `port/` that override originals + `port/patches/` applied to a copy in a build dir.

# Multiplayer contract (feature/multiplayer, v1: WebSocket relay)
Model: Doom lockstep. Each browser runs full sim; only doomcom packets (raw `doomdata_t`, up to ~`sizeof(doomdata_t)` bytes, see d_net.h) are exchanged. Relay server just forwards packets between nodes of a room. Packets are binary WebSocket messages.

## C <-> JS (port/overrides/i_net.c, owner: `net` agent)
Single player (no `?room=`) must keep working exactly as today.
- `void doom_net_config(int numplayers, int consoleplayer, int deathmatch, int skill, int episode, int map)` — called by JS BEFORE `doom_init` when in a room; I_InitNetwork then builds doomcom for netgame (numnodes = numplayers, node i == player i, node 'consoleplayer' is self, ticdup=1, extratics=1).
- C -> JS import (EM_JS / library): `Module.netSend(node, ptr, len)` — send `len` bytes at HEAPU8[ptr] to node `node`.
- JS -> C: `int doom_net_push(int node, uint8_t* ptr, int len)` — JS copies a received packet into wasm memory (use `_malloc`'d scratch buffer exported as `doom_net_buffer()`), C queues it per node (ring buffer); `I_NetCmd` with `doomcom->command == CMD_GET` pops one (remotenode = node, datalength = len) or sets remotenode = -1 if empty; CMD_SEND calls netSend.
- doom_tick must never block when packets are missing (return and let the next rAF retry; Doom's TryRunTics already waits on netgame).
- Optional: `unsigned doom_net_checksum(void)` — checksum of player positions (players[].mo->x/y/z) for desync detection.

## Relay protocol (owner: `relay` agent; file `server/relay.mjs`, dependency `ws` only)
WebSocket at `ws://host:8081/ws`. First message from client is JSON text: `{"type":"join","room":"abc","name":"Bob"}` (or `{"type":"create","room":"abc","max":4,"deathmatch":false,"skill":3,"episode":1,"map":1}`).
Server replies JSON: `{"type":"joined","player":N,"numplayers":K,"max":M}` and broadcasts `{"type":"roster","players":[names...]}` on change. Host (player 0) sends `{"type":"start"}`; server broadcasts `{"type":"start","numplayers":K,"deathmatch":..,"skill":..,"episode":..,"map":..}` with each client's own `player` index included in a per-client `{"type":"start",...,"player":N}`. After start, **binary** messages are game packets: client sends `[destNode(1 byte)] + payload`; server forwards `[srcNode(1 byte)] + payload` to dest (dest 255 = everyone else). Drop binary messages before start. Player leaving mid-game: broadcast `{"type":"left","player":N}`. Also serve `web/` statically on the same port-or-8080 via the existing scripts/serve.mjs logic (keep `npm start` working; add `npm run relay`).

## Web lobby (owner: `net` agent, JS side in web/net.js + small UI in web/index.html/main.js)
`?room=NAME` (optional `&server=ws://...`, default same host :8081) shows lobby (names, Start button for host, create/join), on `start` call `doom_net_config(...)`, then `doom_init`, wiring ws binary messages <-> `Module.netSend` / `doom_net_push`. Without `room` param: unchanged single-player.
