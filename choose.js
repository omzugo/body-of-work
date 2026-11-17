function swapSome() {
  let budget = 6;
  const swap = (p) => {
    const next = (p.next = pickScrap(p));
    if (next) loadTile(next).then(() => { if (p.next === next) p.patch = next; });
    lastSwap = p;
  };
  for (const p of pieces) {
    if (p.swapNow && p.f) { p.swapNow = false; swap(p); continue; }
    if (!p.f || p.patch || p.next || !lib.parts[p.def.pool] || millis() < (p.retryAt ?? 0)) continue;
    if (budget-- <= 0) break;
    swap(p);
    if (!p.next) p.retryAt = millis() + 1000;
  }

  if (millis() > nextSwap) {
    const visible = pieces.filter((p) => p.f && p.patch);
    if (visible.length) swap(visible[swapTurn++ % visible.length]);
    nextSwap = millis() + SWAP_EVERY * 1000;
  }
}

function pickScrap(p) {
  const pool = lib.parts[p.def.pool];
  if (!pool) return null;
  const fits = pool.scraps.filter((s) => s.status === "approved" && (!p.def.opening || s.open === !!p.open));
  const showing = new Set(pieces.filter((q) => q !== p && q.patch).map((q) => q.patch.painting));
  const fresh = fits.filter((s) => !showing.has(s.painting));
  return random(fresh.length ? fresh : fits) ?? null;
}

function loadTile(s) {
  if (!s.tile) {
    const { box, url } = tileFor(s);
    s.tile = { box, img: null };
    s.tile.loading = loadImage(url).then((img) => (s.tile.img = img));
  }
  return s.tile.loading;
}
