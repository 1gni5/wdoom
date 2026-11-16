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
