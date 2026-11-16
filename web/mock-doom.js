// Mock of the wasm build for front-end testing without a real Doom build.
// Used only when the page is opened with ?mock=1. Mirrors the contract in CONTRACT.md.
export default async function createDoom() {
  const MEM = 1 << 20;
  const FB_OFF = 0;
  const PAL_OFF = 65536;
  const buf = new ArrayBuffer(MEM);
  const HEAPU8 = new Uint8Array(buf);
  const keys = new Set();
  let t = 0;
  let px = 160, py = 100, mouseX = 0;

  // Simple 256-entry palette: greyscale ramp with a coloured band.
  for (let i = 0; i < 256; i++) {
    HEAPU8[PAL_OFF + i * 3] = i;
    HEAPU8[PAL_OFF + i * 3 + 1] = (i * 7) & 255;
    HEAPU8[PAL_OFF + i * 3 + 2] = 255 - i;
  }

  const fns = {
    doom_init() {
      console.info("[mock] doom_init");
    },
    doom_tick() {
      t++;
      if (keys.has(0xae)) px += 2; // right arrow
      if (keys.has(0xac)) px -= 2; // left arrow
      if (keys.has(0xad)) py -= 2; // up arrow
      if (keys.has(0xaf)) py += 2; // down arrow
      px = Math.max(0, Math.min(319, px + mouseX));
      mouseX = 0;
      for (let y = 0; y < 200; y++) {
        for (let x = 0; x < 320; x++) {
          const d = Math.hypot(x - px, y - py);
          HEAPU8[FB_OFF + y * 320 + x] = d < 12
            ? 250
            : (x + y + t) & 127;
        }
      }
    },
    doom_key(key, down) {
      if (down) keys.add(key); else keys.delete(key);
    },
    doom_mouse(dx, _dy, _buttons) {
      mouseX += dx;
    },
    doom_framebuffer() {
      return FB_OFF;
    },
    doom_palette() {
      return PAL_OFF;
    },
  };

  return {
    HEAPU8,
    cwrap(name) {
      const f = fns[name];
      if (!f) throw new Error("mock: unknown export " + name);
      return f;
    },
    ccall(name, _ret, _args, params) {
      return fns[name](...(params || []));
    },
  };
}
