# Brief: web agent (cwd: ../web-ui, branch `web-ui`)
Goal: build the browser front-end for a WebAssembly port of Doom. Read CONTRACT.md first and follow it exactly. Another agent builds the wasm (port/build.sh -> web/dist/doom.js); you do NOT write C.
Deliver only under web/ and scripts/serve.* :
- web/index.html, web/main.js (ES module, imports ./dist/doom.js createDoom), web/style.css.
- Canvas 320x200 scaled (CSS pixelated, aspect 4:3 fit), render via doom_framebuffer + doom_palette into ImageData each requestAnimationFrame after doom_tick.
- Keyboard mapping to Doom key codes (arrows=0xAE/0xAF/0xAD/0xAC, ctrl fire=0x9D, shift=0xB6, alt=0xB8, space=' ', enter=13, esc=27, tab=9, letters lowercase ASCII, F1-F10 = 0x80+0x3b.. per doomdef.h in /Users/j.ducange/Projects/web-doom/third_party/DOOM/linuxdoom-1.10/doomdef.h – verify there), pointer lock mouse on canvas click, preventDefault for game keys.
- Loading/error screen when dist/doom.js is missing (show build instructions).
- Zero-dependency static dev server: scripts/serve.mjs (node, correct wasm MIME, serves web/ on :8080).
- Test your JS with a mock module if dist is not available yet; keep a web/mock-doom.js used only with ?mock=1.
Commit on your branch. When done, report to the lead with short summary. Do not touch port/.
