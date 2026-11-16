# Report: web agent (branch `web-ui`)

Commit: `bb49436 web: browser front-end, mock module, zero-dep dev server`

## Delivered
- `web/index.html`, `web/style.css`, `web/main.js` (ES module): 320x200 canvas, 4:3 letterboxed fit, pixelated scaling. Each rAF: `doom_tick` then palette-indexed framebuffer → RGBA via a 256-entry LUT → `putImageData`.
- Keyboard: `KeyboardEvent.code`-based mapping to doomdef.h codes (verified against `linuxdoom-1.10/doomdef.h`: arrows 0xAC–0xAF, Ctrl 0x9D, Shift 0xB6, Alt 0xB8, F1–F10 = 0x80+0x3b.., F11/F12 = 0x80+0x57/0x58, Enter 13, Esc 27, Tab 9, Backspace 127, Pause 0xFF, Space 32); letters/digits/punctuation sent as lowercase ASCII. Game keys get `preventDefault`; key repeat ignored; all keys released on window blur.
- Mouse: click canvas → pointer lock; `movementX/Y` → `doom_mouse(dx,dy,0)`, button bitmask 1/2/4 on press/release. Esc releases pointer lock (browser behaviour) and releases held keys/buttons.
- Loading / error panel: if `dist/doom.js` fails to import, shows build instructions (`scripts/fetch-wad.sh`, `port/build.sh`, `node scripts/serve.mjs`).
- `web/mock-doom.js`: mock with the same exports (cwrap/ccall/HEAPU8); animated pattern + controllable dot. Used only with `?mock=1`.
- `scripts/serve.mjs`: zero-dep Node static server on :8080 (or `PORT`/argv). `.wasm` → `application/wasm`, `.data` → octet-stream, path-traversal guard, no-cache.

## Verified
- `node --check` on serve.mjs, main.js, mock-doom.js: OK.
- Server: index 200 (text/html), main.js 200 (text/javascript), missing dist → 404, `..` traversal → 404, mock 200.
- Mock driven from Node via its cwrap API: tick/key/framebuffer/palette behave as expected.
- **Not verified in a real browser** (none available in this environment). Real wasm build not yet present, so the Emscripten path is untested.

## Assumptions / things for the lead to check
1. The build must export `HEAPU8`: `EXPORTED_RUNTIME_METHODS=['cwrap','ccall','HEAPU8']` (main.js throws a clear error otherwise).
2. `createDoom()` is called with no args; WAD is found via the preloaded `/doom1.wad`, so `doom.data` must sit next to `doom.js` in `web/dist/`.
3. `doom_init` is called after `createDoom` resolves; no sound, so no user-gesture gating is needed.
4. Mouse dy is passed raw (screen-down positive). If mouse-forward feels inverted in-game, flip the sign in `onMouseMove`.
5. Nothing under `port/` or `third_party/` was touched.
