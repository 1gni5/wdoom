// Multiplayer client: WebSocket relay protocol (see CONTRACT.md / docs/multiplayer.md).
// Pure JS, no DOM. Usage:
//   const net = new NetClient({ url, onRoster, onStart, onLeft, onError, onClose });
//   await net.connect({ type: "create"|"join", room, name, ... });
//   net.attach(Module, wasmFns)   // wires Module.netSend and incoming packets
export class NetClient {
  constructor(handlers = {}) {
    this.h = handlers;
    this.ws = null;
    this.player = -1;
    this.numplayers = 0;
    this.started = false;
    this.Module = null;
    this.fns = null;
  }

  // Relay URL precedence: ?server= (handled by caller) > config.js relayUrl >
  // same origin /ws (relay serves the page, or a reverse proxy/ingress routes /ws).
  // Local dev static server (port 8080) falls back to the relay on :8081.
  static defaultUrl(loc = globalThis.location) {
    const cfg = globalThis.DOOM_CONFIG?.relayUrl;
    if (cfg) return cfg;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    if (loc.port === "8080") return `${proto}//${loc.hostname}:8081/ws`;
    return `${proto}//${loc.host}/ws`;
  }

  connect(first) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.h.url || NetClient.defaultUrl());
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        ws.send(JSON.stringify(first));
        resolve();
      };
      ws.onerror = () => {
        if (!opened) reject(new Error("cannot connect to relay " + ws.url));
      };
      ws.onclose = () => this.h.onClose?.();
      ws.onmessage = (ev) => this._onMessage(ev);
    });
  }

  _onMessage(ev) {
    if (typeof ev.data !== "string") return this._onPacket(new Uint8Array(ev.data));
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    switch (m.type) {
      case "joined":
        this.player = m.player;
        this.numplayers = m.numplayers;
        this.h.onJoined?.(m);
        break;
      case "roster":
        this.h.onRoster?.(m.players || []);
        break;
      case "start":
        if (typeof m.player === "number") this.player = m.player;
        this.started = true;
        this.h.onStart?.(m);
        break;
      case "left":
        this.h.onLeft?.(m.player);
        break;
      case "error":
        this.h.onError?.(new Error(m.message || m.error || "relay error"));
        break;
    }
  }

  // Host only: ask the relay to start the game.
  start() {
    this.ws?.send(JSON.stringify({ type: "start" }));
  }

  // Wire the wasm module: outgoing packets via Module.netSend, incoming via doom_net_push.
  attach(Module) {
    this.Module = Module;
    this.push = Module.cwrap("doom_net_push", "number", ["number", "number", "number"]);
    this.bufPtr = Module.ccall("doom_net_buffer", "number", [], []);
    this.out = new Uint8Array(1 + 512);
    Module.netSend = (node, ptr, len) => {
      const ws = this.ws;
      if (!this.started || !ws || ws.readyState !== 1) return;
      this.out[0] = node & 0xff;
      this.out.set(Module.HEAPU8.subarray(ptr, ptr + len), 1); // HEAPU8 re-read: memory may grow
      ws.send(this.out.slice(0, 1 + len));
    };
  }

  _onPacket(buf) {
    if (!this.started || !this.Module || buf.length < 2) return;
    const src = buf[0];
    const len = buf.length - 1;
    this.Module.HEAPU8.set(buf.subarray(1), this.bufPtr);
    this.push(src, this.bufPtr, len);
  }

  close() {
    this.ws?.close();
  }
}
