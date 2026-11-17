// STEP 4 · CHOOSE. Each shape takes a scrap from its part's pool of scraps you approved on the
// review page. A shape with no scrap yet is drawn gray. Every SWAP_EVERY seconds one shape gets
// a new scrap, so the collage slowly changes.

// Give shapes that have nothing yet a scrap (a few per frame, so we never stall),
// plus the slow cycle: every SWAP_EVERY seconds the next visible shape gets a new one.
function swapSome() {
  let budget = 6;
  const swap = (p) => {
    const next = (p.next = pickScrap(p));
    // show it once its sharp tile has loaded (unless an even newer pick came along meanwhile)
    if (next) loadTile(next).then(() => { if (p.next === next) p.patch = next; });
    lastSwap = p;
  };
  for (const p of pieces) {
    if (p.swapNow && p.f) { p.swapNow = false; swap(p); continue; } // e.g. a mouth just opened
    if (!p.f || p.patch || p.next || !lib.parts[p.def.pool] || millis() < (p.retryAt ?? 0)) continue;
    if (budget-- <= 0) break;
    swap(p);
    if (!p.next) p.retryAt = millis() + 1000; // nothing suitable right now; try again in a second
  }

  if (millis() > nextSwap) {
    const visible = pieces.filter((p) => p.f && p.patch);
    if (visible.length) swap(visible[swapTurn++ % visible.length]);
    nextSwap = millis() + SWAP_EVERY * 1000;
  }
}

// Pick a scrap for this shape: one you approved for its part, ideally from a painting no other
// shape is showing (if a part has only a few, repeats beat gray), and for a mouth, an open one
// only while yours is open.
function pickScrap(p) {
  const pool = lib.parts[p.def.pool];
  if (!pool) return null;
  const fits = pool.scraps.filter((s) => s.status === "approved" && (!p.def.opening || s.open === !!p.open));
  const showing = new Set(pieces.filter((q) => q !== p && q.patch).map((q) => q.patch.painting));
  const fresh = fits.filter((s) => !showing.has(s.painting));
  return random(fresh.length ? fresh : fits) ?? null;
}

// A sharp cut of just the area around a scrap. tools/serve.py cuts it from the high-res copy of
// the painting the first time it's asked for (box in painting units), then keeps it.
function loadTile(s) {
  if (!s.tile) {
    const w = s.L, h = s.W * MARGIN, c = Math.abs(Math.cos(s.a)), sn = Math.abs(Math.sin(s.a));
    const hx = ((w / 2) * c + (h / 2) * sn) * 1.1 + 2, hy = ((w / 2) * sn + (h / 2) * c) * 1.1 + 2;
    const box = [Math.floor(s.x - hx), Math.floor(s.y - hy), Math.ceil(s.x + hx), Math.ceil(s.y + hy)];
    s.tile = { box, img: null };
    s.tile.loading = loadImage(`tiles/${s.painting}/${box.join("_")}.jpg`).then((img) => (s.tile.img = img));
  }
  return s.tile.loading;
}
