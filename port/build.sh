#!/usr/bin/env bash
# Builds linuxdoom-1.10 to WebAssembly -> web/dist/doom.{js,wasm,data}
#
#   port/build.sh            # needs emcc on PATH and build/doom1.wad (fetched if missing)
#
# Env overrides:
#   DOOM_SRC   path to linuxdoom-1.10 (default: third_party/DOOM/linuxdoom-1.10, then
#              ../web-doom/third_party/DOOM/linuxdoom-1.10)
#   OUT_DIR    output dir (default: web/dist)
#   OPT        emcc optimisation flag (default: -O2)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DOOM_SRC="${DOOM_SRC:-}"
if [ -z "$DOOM_SRC" ]; then
  for cand in "$ROOT/third_party/DOOM/linuxdoom-1.10" "$ROOT/../web-doom/third_party/DOOM/linuxdoom-1.10" \
              "/Users/j.ducange/Projects/web-doom/third_party/DOOM/linuxdoom-1.10"; do
    if [ -f "$cand/d_main.c" ]; then DOOM_SRC="$cand"; break; fi
  done
fi
[ -f "$DOOM_SRC/d_main.c" ] || { echo "DOOM source not found (set DOOM_SRC)" >&2; exit 1; }

OUT_DIR="${OUT_DIR:-$ROOT/web/dist}"
OPT="${OPT:--O2}"
BUILD="$ROOT/build"
SRC="$BUILD/src"
WAD="$BUILD/doom1.wad"

command -v emcc >/dev/null || { echo "emcc not found on PATH" >&2; exit 1; }
command -v patch >/dev/null || { echo "patch not found" >&2; exit 1; }

# 1. fresh copy of the pristine sources (submodule is never modified)
rm -rf "$SRC"
mkdir -p "$SRC"
cp "$DOOM_SRC"/*.c "$DOOM_SRC"/*.h "$SRC/"

# 2. web overrides replace the platform files
rm -f "$SRC"/i_video.c "$SRC"/i_system.c "$SRC"/i_sound.c "$SRC"/i_net.c "$SRC"/i_main.c
cp "$ROOT"/port/overrides/*.c "$SRC/"

# 3. compatibility / web patches (unified diffs, -p1 relative to $SRC)
for p in "$ROOT"/port/patches/*.patch; do
  [ -e "$p" ] || continue
  echo "patch: $(basename "$p")"
  patch -d "$SRC" -p1 --no-backup-if-mismatch -s < "$p"
done

# 4. WAD
if [ ! -f "$WAD" ]; then
  "$ROOT/scripts/fetch-wad.sh" "$WAD"
fi

# 5. compile + link
mkdir -p "$OUT_DIR"
SOURCES=$(ls "$SRC"/*.c)
EXPORTS='["_doom_init","_doom_tick","_doom_key","_doom_mouse","_doom_framebuffer","_doom_palette","_doom_net_config","_doom_net_push","_doom_net_buffer","_doom_net_checksum","_doom_net_gametic"]'
RUNTIME='["ccall","cwrap","HEAPU8"]'

emcc $OPT $SOURCES \
  -DNORMALUNIX -DLINUX -DDOOM_WEB \
  -Wno-implicit-int -Wno-return-type -Wno-pointer-sign -Wno-int-conversion \
  -Wno-incompatible-pointer-types -Wno-format -Wno-deprecated-non-prototype \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createDoom \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS="$RUNTIME" \
  -sALLOW_MEMORY_GROWTH=1 \
  --preload-file "$WAD@/doom1.wad" \
  -o "$OUT_DIR/doom.js"

echo "built: $OUT_DIR/doom.js (+ doom.wasm, doom.data)"
