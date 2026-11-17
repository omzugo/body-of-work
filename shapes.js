// STEPS 2–3 · SHAPES, STEADIED. Each body part becomes a simple shape (pieces.js says how: a
// capsule between two joints, an oval around a cluster of points). Then the shapes are smoothed so
// they don't jitter, and fade in and out as body parts appear and disappear.

// The live frame for one piece, or null if that person / part isn't visible.
function frameNow(p) {
  const lm = people[p.who]?.[p.def.from];
  if (!lm) return null;
  if (p.def.needs) {
    // body points: hard to appear (confident), hard to disappear (only when quite unsure),
    // so pieces don't flicker when the tracker hovers around one threshold
    const need = p.f ? 0.15 : 0.4;
    if (p.def.needs.some((i) => lm[i][2] < need)) return null;
  }
  return p.def.frame(lm);
}

// Where is every shape right now? Turn this frame's points into shapes, smooth them, and fade
// shapes in and out as their body parts appear and disappear.
function updateShapes() {
  const targets = pieces.map(frameNow);
  const now = millis(), dt = Math.min(now - (lastDrawAt ?? now), 100) / 1000; // seconds since last frame
  lastDrawAt = now;
  pieces.forEach((p, i) => {
    const target = targets[i];
    if (target) {
      p.f = smoothFrame(p, target);
      p.out = target.out; // pieces that face a way (ears): which way is outward
      if (p.def.opening) {
        // an opening mouth: when it changes between open and closed, swap its scrap right away
        const amount = p.def.opening(people[p.who][p.def.from]);
        const open = p.open ? amount > MOUTH_CLOSES : amount > MOUTH_OPENS;
        if (open !== !!p.open) { p.open = open; p.swapNow = true; }
      }
      p.lastSeen = millis();
      p.alpha = Math.min(1, (p.alpha ?? 0) + dt / FADE_IN); // appear (or come back mid-dissolve)
    } else if (p.f) {
      const twin = liveTwin(p, targets);
      if (twin && !twin.patch && p.patch) {
        // the same feature reappeared in another person slot: hand over the scrap, so the
        // switch is invisible instead of every feature suddenly changing painting
        twin.patch = twin.next = p.patch;
        twin.flip = p.flip;
      }
      if (twin) twin.alpha = Math.max(twin.alpha ?? 0, p.alpha); // no fade for a switch either
      // lost: dissolve where it was (a leftover copy goes at once, or there'd be a double image)
      p.alpha = twin ? 0 : (p.alpha ?? 1) - dt / FADE_OUT;
      if (p.alpha <= 0) {
        p.f = null;
        p.filters = null;
        p.alpha = 0;
      }
    }
  });
}

// A shape waiting in place (its tracking was lost) is a leftover copy if the same feature is being
// tracked live right where it is — e.g. your face just moved to the other person slot. Without
// this, the old set of features freezes for a moment while the new set appears on top.
// Returns that live twin, or undefined.
function liveTwin(p, targets) {
  return pieces.find((q, i) => q !== p && q.def.name === p.def.name && targets[i] &&
    gap([targets[i].x, targets[i].y], [p.f.x, p.f.y]) < Math.max(p.f.L, targets[i].L));
}

// Smooth a piece's frame with a One Euro filter per number (Casiez, Roussel & Vogel, 2012):
// heavy smoothing when you're still (no jitter), light when you move fast (no lag).
function smoothFrame(p, target) {
  p.filters ??= { x: new OneEuro(), y: new OneEuro(), a: new OneEuro(), L: new OneEuro(), W: new OneEuro() };
  const dt = Math.max(deltaTime, 1) / 1000;
  // angles wrap around: take the short way from the last smoothed angle
  const a = p.f ? p.f.a + Math.atan2(Math.sin(target.a - p.f.a), Math.cos(target.a - p.f.a)) : target.a;
  return {
    x: p.filters.x.filter(target.x, dt), y: p.filters.y.filter(target.y, dt),
    a: p.filters.a.filter(a, dt), L: p.filters.L.filter(target.L, dt), W: p.filters.W.filter(target.W, dt),
  };
}

class OneEuro {
  filter(x, dt) {
    if (this.x === undefined) { this.x = x; this.speed = 0; return x; }
    const alpha = (cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.speed += alpha(1) * ((x - this.x) / dt - this.speed);    // how fast it's moving
    const cutoff = STEADY + RESPONSIVE * Math.abs(this.speed);     // faster → follow more closely
    this.x += alpha(cutoff) * (x - this.x);
    return this.x;
  }
}
