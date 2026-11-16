// DOOM web front-end. Talks to the wasm build via the contract in CONTRACT.md.
// Load order: ?mock=1 uses ./mock-doom.js, otherwise ./dist/doom.js.

const WIDTH = 320;
const HEIGHT = 200;
const FB_SIZE = WIDTH * HEIGHT;
const PAL_SIZE = 256 * 3;

// Doom key codes from doomdef.h (verified against linuxdoom-1.10).
const K = {
  RIGHTARROW: 0xae,
  LEFTARROW: 0xac,
  UPARROW: 0xad,
  DOWNARROW: 0xaf,
  ESCAPE: 27,
  ENTER: 13,
  TAB: 9,
  BACKSPACE: 127,
  PAUSE: 0xff,
  EQUALS: 0x3d,
  MINUS: 0x2d,
  RSHIFT: 0x80 + 0x36,
  RCTRL: 0x80 + 0x1d,
  RALT: 0x80 + 0x38,
  F1: 0x80 + 0x3b,
  F11: 0x80 + 0x57,
  F12: 0x80 + 0x58,
};

// KeyboardEvent.code -> Doom key (layout independent for the game keys).
const CODE_MAP = {
  ArrowRight: K.RIGHTARROW,
  ArrowLeft: K.LEFTARROW,
  ArrowUp: K.UPARROW,
  ArrowDown: K.DOWNARROW,
  Escape: K.ESCAPE,
  Enter: K.ENTER,
  NumpadEnter: K.ENTER,
  Tab: K.TAB,
  Backspace: K.BACKSPACE,
  Pause: K.PAUSE,
  ControlLeft: K.RCTRL,
  ControlRight: K.RCTRL,
  ShiftLeft: K.RSHIFT,
  ShiftRight: K.RSHIFT,
  AltLeft: K.RALT,
  AltRight: K.RALT,
  Space: 32,
  Minus: K.MINUS,
  NumpadSubtract: K.MINUS,
  Equal: K.EQUALS,
  NumpadAdd: K.EQUALS,
  F11: K.F11,
  F12: K.F12,
};
for (let i = 1; i <= 10; i++) CODE_MAP["F" + i] = K.F1 + (i - 1);

// Map a keyboard event to a Doom key code, or 0 if the key is not a game key.
function doomKeyFor(e) {
  if (e.code in CODE_MAP) return CODE_MAP[e.code];
  // Letters and digits / punctuation: use the produced character, lowercased.
  if (e.key && e.key.length === 1) {
    const c = e.key.toLowerCase().charCodeAt(0);
    if (c >= 0x21 && c <= 0x7e) return c;
  }
  return 0;
}

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const statusText = $("status-text");
const errorEl = $("error");
const errorDetail = $("error-detail");
const canvas = $("screen");
const ctx = canvas.getContext("2d");
const image = ctx.createImageData(WIDTH, HEIGHT);
const pixels = new Uint32Array(image.data.buffer); // RGBA as little-endian uint32

function showError(err) {
  statusEl.hidden = true;
  errorEl.hidden = false;
  errorDetail.textContent = String(err && (err.message || err));
  console.error(err);
}

function setStatus(text) {
  statusText.textContent = text;
}

async function loadModule(useMock) {
  const mod = useMock
    ? await import("./mock-doom.js")
    : await import("./dist/doom.js");
  const createDoom = mod.default || mod.createDoom;
  if (typeof createDoom !== "function") {
    throw new Error("dist/doom.js does not export createDoom");
  }
  return createDoom();
}

function bindWasm(Module) {
  const fn = {
    init: Module.cwrap("doom_init", null, []),
    tick: Module.cwrap("doom_tick", null, []),
    key: Module.cwrap("doom_key", null, ["number", "number"]),
    mouse: Module.cwrap("doom_mouse", null, ["number", "number", "number"]),
    framebuffer: Module.cwrap("doom_framebuffer", "number", []),
    palette: Module.cwrap("doom_palette", "number", []),
  };
  // HEAPU8 must be exported by the build (EXPORTED_RUNTIME_METHODS includes HEAPU8).
  if (!Module.HEAPU8) {
    throw new Error("wasm build does not expose Module.HEAPU8");
  }
  return fn;
}

// Input ------------------------------------------------------------------

const held = new Map(); // KeyboardEvent.code -> doom key currently down
let buttons = 0;
let wasm = null;

function sendKey(doomkey, down) {
  if (wasm && doomkey) wasm.key(doomkey, down ? 1 : 0);
}

function releaseAll() {
  for (const dk of held.values()) sendKey(dk, false);
  held.clear();
  if (buttons && wasm) wasm.mouse(0, 0, 0);
  buttons = 0;
}

function onKeyDown(e) {
  if (!wasm) return;
  const dk = doomKeyFor(e);
  if (!dk) return;
  e.preventDefault();
  if (e.repeat) return; // Doom does its own repeat handling
  if (held.has(e.code)) return;
  held.set(e.code, dk);
  sendKey(dk, true);
}

function onKeyUp(e) {
  const dk = held.get(e.code);
  if (dk === undefined) return;
  e.preventDefault();
  held.delete(e.code);
  sendKey(dk, false);
}

function onMouseMove(e) {
  if (!wasm || document.pointerLockElement !== canvas) return;
  if (e.movementX || e.movementY) {
    wasm.mouse(e.movementX | 0, e.movementY | 0, 0);
  }
}

function setButton(bit, down) {
  buttons = down ? buttons | bit : buttons & ~bit;
  if (wasm && document.pointerLockElement === canvas) wasm.mouse(0, 0, buttons);
}

function onMouseDown(e) {
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
    return;
  }
  e.preventDefault();
  if (e.button === 0) setButton(1, true);
  else if (e.button === 2) setButton(2, true);
  else if (e.button === 1) setButton(4, true);
}

function onMouseUp(e) {
  if (e.button === 0) setButton(1, false);
  else if (e.button === 2) setButton(2, false);
  else if (e.button === 1) setButton(4, false);
}

function onPointerLockChange() {
  const locked = document.pointerLockElement === canvas;
  document.body.classList.toggle("playing", locked);
  if (!locked) releaseAll();
}

function installInput() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseAll);
  document.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("pointerlockchange", onPointerLockChange);
  canvas.focus();
}

// Rendering loop ---------------------------------------------------------

function blitFrame(Module) {
  const fbPtr = wasm.framebuffer();
  const palPtr = wasm.palette();
  const heap = Module.HEAPU8; // re-read each frame: memory may have grown
  const fb = heap.subarray(fbPtr, fbPtr + FB_SIZE);
  const pal = heap.subarray(palPtr, palPtr + PAL_SIZE);

  // Build a 256-entry LUT of packed RGBA (little-endian: R lowest byte).
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const r = pal[i * 3], g = pal[i * 3 + 1], b = pal[i * 3 + 2];
    lut[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
  for (let i = 0; i < FB_SIZE; i++) pixels[i] = lut[fb[i]];
  ctx.putImageData(image, 0, 0);
}

function startLoop(Module) {
  const frame = () => {
    wasm.tick();
    blitFrame(Module);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Boot -------------------------------------------------------------------

async function main() {
  const useMock = new URLSearchParams(location.search).has("mock");
  setStatus(useMock ? "Loading DOOM (mock)…" : "Loading DOOM…");
  let Module;
  try {
    Module = await loadModule(useMock);
    wasm = bindWasm(Module);
  } catch (err) {
    showError(err);
    return;
  }
  statusEl.hidden = true;
  wasm.init();
  installInput();
  startLoop(Module);
}

main();
