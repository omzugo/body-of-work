function frameNow(p) {
  const lm = people[p.who]?.[p.def.from];
  if (!lm) return null;
  if (p.def.needs) {
    const need = p.f ? 0.15 : 0.4;
    if (p.def.needs.some((i) => lm[i][2] < need)) return null;
  }
  return p.def.frame(lm);
}

function updateShapes() {
  const targets = pieces.map(frameNow);
  const now = millis(), dt = Math.min(now - (lastDrawAt ?? now), 100) / 1000;
  lastDrawAt = now;
  pieces.forEach((p, i) => {
    const target = targets[i];
    if (target) {
      p.f = smoothFrame(p, target);
      p.out = target.out;
      if (p.def.opening) {
        const amount = p.def.opening(people[p.who][p.def.from]);
        const open = p.open ? amount > MOUTH_CLOSES : amount > MOUTH_OPENS;
        if (open !== !!p.open) { p.open = open; p.swapNow = true; }
      }
      p.lastSeen = millis();
      p.alpha = Math.min(1, (p.alpha ?? 0) + dt / FADE_IN);
    } else if (p.f) {
      const twin = liveTwin(p, targets);
      if (twin && !twin.patch && p.patch) {
        twin.patch = twin.next = p.patch;
        twin.flip = p.flip;
      }
      if (twin) twin.alpha = Math.max(twin.alpha ?? 0, p.alpha);
      p.alpha = twin ? 0 : (p.alpha ?? 1) - dt / FADE_OUT;
      if (p.alpha <= 0) {
        p.f = null;
        p.filters = null;
        p.alpha = 0;
      }
    }
  });
}

function liveTwin(p, targets) {
  return pieces.find((q, i) => q !== p && q.def.name === p.def.name && targets[i] &&
    gap([targets[i].x, targets[i].y], [p.f.x, p.f.y]) < Math.max(p.f.L, targets[i].L));
}

function smoothFrame(p, target) {
  p.filters ??= { x: new OneEuro(), y: new OneEuro(), a: new OneEuro(), L: new OneEuro(), W: new OneEuro() };
  const dt = Math.max(deltaTime, 1) / 1000;
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
    this.speed += alpha(1) * ((x - this.x) / dt - this.speed);
    const cutoff = STEADY + RESPONSIVE * Math.abs(this.speed);
    this.x += alpha(cutoff) * (x - this.x);
    return this.x;
  }
}
