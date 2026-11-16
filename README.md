# web-doom

id Software's original Doom source (linuxdoom-1.10) compiled to WebAssembly with Emscripten and packaged as a static web app.

## Layout
| Path | Purpose |
|---|---|
| `third_party/DOOM` | Git submodule of https://github.com/id-Software/DOOM (never modified) |
| `port/overrides/` | Web replacements for `i_video/i_system/i_sound/i_net/i_main` (+ doom_init/doom_tick exports) |
| `port/patches/` | Small patches for 64-bit / modern clang issues |
| `port/build.sh` | Copies sources to `build/`, applies overrides + patches, runs `emcc` -> `web/dist/` |
| `port/smoke.mjs` | Node smoke test (100 frames, checks framebuffer) |
| `scripts/fetch-wad.sh` | Downloads the shareware `doom1.wad` into `build/` |
| `scripts/serve.mjs` | Zero-dependency static server for `web/` |
| `web/` | Front-end: canvas renderer, keyboard + pointer-lock mouse |
| `CONTRACT.md` | JS <-> C interface (exported functions) |

## Workflow
```sh
brew install emscripten node          # prerequisites (macOS)
git clone --recurse-submodules <this repo>   # or: git submodule update --init
npm run setup     # init submodule + download shareware WAD
npm run build     # -> web/dist/doom.{js,wasm,data}
npm test          # node smoke test
npm start         # http://localhost:8080
```

## How it works
- The platform layer is replaced: video writes the 320x200 8-bit framebuffer + palette to memory, JS paints it to a `<canvas>`; input comes from JS via `doom_key` / `doom_mouse`.
- Doom's blocking `D_DoomLoop` is split into `doom_init()` and `doom_tick()`; JS calls the latter from `requestAnimationFrame`.
- The WAD is preloaded into the Emscripten virtual filesystem (`/doom1.wad`).
- Sound is stubbed (silent) and networking disabled.

## Multiplayer (2-4 players, WebSocket relay)
```sh
npm run relay      # relay + lobby server on :8081 (also serves web/)
```
Open `http://<host-LAN-IP>:8081/?room=NAME` in each browser (find the IP with `ipconfig getifaddr en0`; allow Node through the macOS firewall). The first player creates the room (host, picks max players), the others join with the same URL, and the host clicks Start. Doom's lockstep netcode runs unchanged; the relay only forwards packets. See `docs/multiplayer.md`.

Tests: `npm run test:net` (in-process sync), `npm run test:relay` (server), `npm run test:e2e` (real relay + 2 wasm clients).
Known limit: a player disconnecting mid-game can stall the others.

## Controls
Arrows move/turn, Ctrl fire, Space use, Shift run, Alt strafe, Esc menu. Click the canvas to capture the mouse.

## Notes
- Shareware `doom1.wad` is freely distributable but is not committed (`.gitignore`); the full game WAD is not included.
- The Doom source is under the id Software GPL license (see `third_party/DOOM/LICENSE.TXT`).
- Known limits: no sound; input verified headless in node (menu navigation, new game, movement), multiplayer verified between two browsers on a LAN.
- Orchestration briefs used to build this are in `briefs/`.
