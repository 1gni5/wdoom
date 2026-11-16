// Renders text with Doom's own STCFN font (extracted from the WAD by scripts/extract-assets.mjs).
// Falls back silently (keeps the CSS text) if the assets are missing.
export async function applyDoomFont(selector = "[data-doomfont]") {
  let meta, atlas;
  try {
    meta = await (await fetch("dist/ui/font.json")).json();
    atlas = new Image();
    await new Promise((res, rej) => {
      atlas.onload = res;
      atlas.onerror = () => rej(new Error("font.png failed to load"));
      atlas.src = "dist/ui/font.png";
    });
  } catch { return false; }
  for (const el of document.querySelectorAll(selector)) {
    const text = (el.dataset.text || el.textContent).toUpperCase();
    const scale = Number(el.dataset.scale || 3);
    const tint = el.dataset.tint || "";
    let w = 0;
    for (const ch of text) w += (meta.glyphs[ch]?.w ?? meta.space) + 1;
    const c = document.createElement("canvas");
    c.width = Math.max(1, w); c.height = meta.height;
    const g = c.getContext("2d");
    let x = 0;
    for (const ch of text) {
      const gl = meta.glyphs[ch];
      if (gl) g.drawImage(atlas, gl.x, 0, gl.w, meta.height, x, 0, gl.w, meta.height);
      x += (gl?.w ?? meta.space) + 1;
    }
    if (tint) { // multiply keeps the glyph shading; destination-in restores the glyph shape
      const mask = document.createElement("canvas");
      mask.width = c.width; mask.height = c.height;
      mask.getContext("2d").drawImage(c, 0, 0);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = tint; g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(mask, 0, 0);
    }
    c.style.cssText = `image-rendering:pixelated;width:${c.width * scale}px;height:${c.height * scale}px;filter:drop-shadow(3px 3px 0 #000)`;
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", text);
    el.dataset.text = text;
    el.replaceChildren(c);
    el.classList.add("doomfont");
  }
  return true;
}
