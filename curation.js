// Shared by the sketch and the review page: combine the machine-made pools (library/parts.json)
// with your decisions from the review page (library/curation.json).
//
// curation.json, per part:
//   decisions: { scrapId: "approved" | "rejected" }
//   recrops:   { scrapId: [x, y, L, a] }     a new center, size and angle for a machine-made scrap
//   added:     [ {id, painting, x, y, L, a} ] scraps you cut yourself in the recrop editor
//   mirrored:  { scrapId: true }             painted the other way round (e.g. an ear facing left)
//   open:      { scrapId: true }             an open mouth (shown only while yours is open)
// (angles in radians: which way the scrap's long side runs in the painting)

const CUT_MARGIN = 1.3;
 // pieces are cut this much wider than W (same as MARGIN in build_parts.py)

// A scrap's name that survives rebuilding the pools: which painting, where, how big.
function scrapId(painting, x, y, L) {
  return `${painting}@${Math.round(x)},${Math.round(y)},${Math.round(L)}`;
}

// Returns {part: {shape, axis, aspect, scraps: [{id, painting, x, y, a, L, W, score, status, edited, added}]}}
// status is "new" (not reviewed yet), "approved" or "rejected".
function mergeCuration(parts, curation) {
  const out = {};
  for (const [name, part] of Object.entries(parts)) {
    if (!part.items?.length) continue;
    const cur = curation[name] ?? {};
    const [, , , axis, L0, W0] = part.items[0];
    const aspect = W0 / L0; // every scrap in a part has the same shape
    const best = part.items[0][6];
    const scraps = part.items.map(([painting, x, y, a, L, , score]) => {
      const id = scrapId(painting, x, y, L);
      const re = cur.recrops?.[id];
      if (re) [x, y, L, a = a] = re;
      return { id, painting, x, y, a, L, W: L * aspect, score, status: cur.decisions?.[id] ?? "new", edited: !!re,
        mirrored: !!cur.mirrored?.[id], open: !!cur.open?.[id] };
    });
    // your own scraps go first, and rank like the machine's best
    for (const s of [...(cur.added ?? [])].reverse()) {
      scraps.unshift({ ...s, a: s.a ?? axis, W: s.L * aspect, score: best,
        status: cur.decisions?.[s.id] ?? "approved", added: true, mirrored: !!cur.mirrored?.[s.id], open: !!cur.open?.[s.id] });
    }
    out[name] = { shape: part.shape, axis, aspect, scraps };
  }
  return out;
}
