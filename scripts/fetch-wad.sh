#!/usr/bin/env bash
# Downloads the shareware doom1.wad to build/doom1.wad (not committed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/build/doom1.wad}"
# Canonical shareware IWAD (id Software, 1993). Other mirrors tried were 404/403.
URL="${DOOM_WAD_URL:-https://raw.githubusercontent.com/Akbar30Bill/DOOM_wads/master/doom1.wad}"
EXPECTED_MD5="${DOOM_WAD_MD5:-f0cefca49926d00903cf57551d901abe}"

mkdir -p "$(dirname "$DEST")"
if [ -f "$DEST" ]; then
  echo "already present: $DEST"
else
  echo "downloading $URL"
  curl -fL --retry 3 -o "$DEST.tmp" "$URL"
  mv "$DEST.tmp" "$DEST"
fi

SIZE=$(wc -c < "$DEST" | tr -d ' ')
if [ "$SIZE" -lt 4000000 ] || [ "$SIZE" -gt 4400000 ]; then
  echo "unexpected size $SIZE for doom1.wad (expected ~4.2MB)" >&2
  exit 1
fi
HEAD=$(head -c 4 "$DEST")
if [ "$HEAD" != "IWAD" ]; then
  echo "not an IWAD (header: $HEAD)" >&2
  exit 1
fi
if [ -n "$EXPECTED_MD5" ]; then
  GOT=$(md5 -q "$DEST" 2>/dev/null || md5sum "$DEST" | cut -d' ' -f1)
  [ "$GOT" = "$EXPECTED_MD5" ] || { echo "md5 mismatch: $GOT" >&2; exit 1; }
fi
echo "ok: $DEST ($SIZE bytes, $(file -b "$DEST"))"
