# Brief: port agent (cwd: ../port, branch `port`)
Goal: compile id Software's linuxdoom-1.10 C sources to WebAssembly with Emscripten (emcc 7.0 installed).
Read CONTRACT.md first and follow it exactly.
Source: /Users/j.ducange/Projects/web-doom/third_party/DOOM/linuxdoom-1.10 (submodule; DO NOT modify). 
Deliver in your worktree (only under port/ and scripts/):
- port/ overrides for i_video.c, i_system.c, i_sound.c, i_net.c, i_main.c (web versions, silent sound, no net), plus any small patches in port/patches/ for 64-bit / modern clang issues (long/pointer size, K&R decls, missing prototypes, big-endian macros, etc.).
- port/build.sh: copies sources to build/, applies overrides/patches, runs emcc with -sMODULARIZE -sEXPORT_ES6 -sEXPORTED_FUNCTIONS for contract functions, EXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPU8, --preload-file doom1.wad@/doom1.wad, -sALLOW_MEMORY_GROWTH, output to web/dist/doom.js.
- scripts/fetch-wad.sh: downloads shareware doom1.wad (e.g. from https://distro.ibiblio.org/slitaz/sources/packages/d/doom1.wad) to build/doom1.wad; verify with `file`/size (~4MB).
- Make main loop non-blocking: doom_init runs everything up to D_DoomLoop setup; doom_tick runs one iteration.
- Verify: build succeeds, and a node smoke test (port/smoke.mjs) loads the module, calls doom_init, runs ~100 doom_tick, and checks the framebuffer is non-empty (print a checksum).
Commit on your branch. When done, report to the lead with a short summary (files, how to build, test output). Do not touch web/ except web/dist output.
