const CUT_MARGIN = 1.3;

function tileFor(s) {
  const w = s.L, h = s.W * CUT_MARGIN, c = Math.abs(Math.cos(s.a)), sn = Math.abs(Math.sin(s.a));
  const hx = ((w / 2) * c + (h / 2) * sn) * 1.1 + 2, hy = ((w / 2) * sn + (h / 2) * c) * 1.1 + 2;
  const box = [Math.floor(s.x - hx), Math.floor(s.y - hy), Math.ceil(s.x + hx), Math.ceil(s.y + hy)];
  return { box, url: `tiles/${s.painting}/${box.join("_")}.jpg` };
}

function scrapId(painting, x, y, L) {
  return `${painting}@${Math.round(x)},${Math.round(y)},${Math.round(L)}`;
}

function mergeCuration(parts, curation) {
  const out = {};
  for (const [name, part] of Object.entries(parts)) {
    if (!part.items?.length) continue;
    const cur = curation[name] ?? {};
    const [, , , axis, L0, W0] = part.items[0];
    const aspect = W0 / L0;
    const best = part.items[0][6];
    const scraps = part.items.map(([painting, x, y, a, L, , score]) => {
      const id = scrapId(painting, x, y, L);
      const re = cur.recrops?.[id];
      if (re) [x, y, L, a = a] = re;
      return { id, painting, x, y, a, L, W: L * aspect, score, status: cur.decisions?.[id] ?? "new", edited: !!re,
        mirrored: !!cur.mirrored?.[id], open: !!cur.open?.[id] };
    });
    for (const s of [...(cur.added ?? [])].reverse()) {
      scraps.unshift({ ...s, a: s.a ?? axis, W: s.L * aspect, score: best,
        status: cur.decisions?.[s.id] ?? "approved", added: true, mirrored: !!cur.mirrored?.[s.id], open: !!cur.open?.[s.id] });
    }
    out[name] = { shape: part.shape, axis, aspect, scraps };
  }
  return out;
}
