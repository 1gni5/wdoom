## Multiplayer (WebSocket relay)

Doom's lockstep netcode runs unchanged in every browser; only `doomdata_t`
packets (≤ 104 bytes) go through a dumb relay (`server/relay.mjs`).

**Usage:** `npm run relay`, then open `http://host:8080/?room=NAME` in 2–4
browsers (optional `&server=ws://host:8081/ws`). One player clicks *Create
room* (players/skill/map/deathmatch), the others *Join room*; the host presses
*Start*. Without `?room=` the game is single player, unchanged.

**Relay protocol** (see CONTRACT.md): first text message `create`/`join`; relay
answers `joined`, `roster`, `start` (with this client's `player`), `left`.
After `start`, binary messages: client → `[destNode][payload]`, relay →
`[srcNode][payload]`. Nodes seen by JS are *player indices*; 255 = everyone.

**C/JS interface** (`port/overrides/i_net.c`, `web/net.js`):
- `doom_net_config(numplayers, consoleplayer, deathmatch, skill(1-5), episode, map)`
  before `doom_init`; makes `I_InitNetwork` build a netgame (ticdup 1, extratics 1).
- `Module.netSend(node, ptr, len)` – C → JS, send bytes at `HEAPU8[ptr]`.
- `doom_net_buffer()` / `doom_net_push(node, ptr, len)` – JS → C, packets are
  queued in a 128-entry ring; `CMD_GET` pops one (`remotenode=-1` if empty).
- `doom_net_checksum()` / `doom_net_gametic()` – state hash (positions, angle,
  health) and current tic, for desync detection.

Doom numbers the local machine as node 0 and remotes 1..; `i_net.c` translates
to/from player indices. Two patches (`port/patches/d_net.patch`, web only):
`D_ArbitrateNetStart` is skipped (the lobby already agreed on settings) and
`TryRunTics` returns instead of spinning when remote tics are missing, so
`doom_tick` never blocks; lost packets are covered by Doom's own retransmit.

**Test:** `npm run test:net` (`PLAYERS=2..4 TICS=400 DROP=0.2` optional) runs
N wasm instances over in-process queues and compares `doom_net_checksum` at
each common gametic.

## Public deployment (container)

`Dockerfile` packages the relay. Run `npm run build` first (it bundles `web/`,
including `web/dist`). The browser connects to `wss://<same host>/ws` by default.

    docker build -t web-doom .
    docker run -p 8081:8081 web-doom          # game + relay on one origin

Azure Container Apps: enable external ingress, target port 8081 (WebSocket works
out of the box). Keep **one replica** (min = max = 1): rooms live in memory, so
players of a room must hit the same instance. Health probe: `GET /healthz`.

Env vars: `PORT` (8081), `SERVE_STATIC=0` (relay only), `ALLOWED_ORIGINS`
(comma-separated, restricts WebSocket origins), `MAX_ROOMS` (200),
`MAX_CONN_PER_IP` (20).

Split hosting (game on a static site/CDN, relay in the container): run with
`SERVE_STATIC=0 ALLOWED_ORIGINS=https://your.site` and set `relayUrl` in
`web/config.js` to `wss://<container-app-fqdn>/ws`.

### Releases

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`: it builds the wasm,
runs the tests, then publishes a GitHub release with `web-doom-web-*.tar.gz`
(static game), `web-doom-relay-*.tar.gz` (relay only) and `SHA256SUMS`, and pushes
the image `ghcr.io/1gni5/wdoom:<version>` / `:latest`. `ci.yml` runs build + tests
on every push to `main` and on pull requests.
