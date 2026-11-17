async function startTracking() {
  const faceMesh = await ml5.faceMesh({ maxFaces: MAX_PEOPLE });
  faceMesh.detectStart(video, (r) => { tracked.faces = r.map((f) => f.keypoints.map((k) => [k.x, k.y])); });

  const handPose = await ml5.handPose({ maxHands: 2 * MAX_PEOPLE });
  handPose.detectStart(video, (r) => {
    tracked.hands = r.map((h) => ({ side: h.handedness, lm: h.keypoints.map((k) => [k.x, k.y]) }));
  });

  const bodyPose = await ml5.bodyPose("MoveNet", { modelType: "MULTIPOSE_LIGHTNING", enableTracking: true });
  bodyPose.detectStart(video, (r) => {
    tracked.bodies = r.map((b, i) => ({ id: b.id ?? i, lm: b.keypoints.map((k) => [k.x, k.y, k.confidence ?? 1]) }));
  });
}

function sortIntoPeople() {
  lastAt = [...Array(MAX_PEOPLE)].map((_, k) => lastAt[k] ?? {});
  people = [...Array(MAX_PEOPLE)].map(() => ({}));

  tracked.faces = oneEach(tracked.faces, (f) => f[1], (f) => gap(f[234], f[454]));
  tracked.hands = oneEach(tracked.hands, (h) => h.lm[0], (h) => gap(h.lm[5], h.lm[17]));
  tracked.bodies = oneEach(tracked.bodies, (b) => middleOf(b.lm, [5, 6, 11, 12]),
    (b) => (b.lm[5][2] >= 0.2 && b.lm[6][2] >= 0.2 ? gap(b.lm[5], b.lm[6]) : 0));

  const bodies = tracked.bodies.map((b) => ({ ...b, at: middleOf(b.lm, [5, 6, 11, 12]) }));
  pairUp(bodies, MAX_PEOPLE,
    (b, k) => (lastAt[k].bodyId === b.id ? 0 : lastAt[k].body && b.at ? gap(b.at, lastAt[k].body) + 1 : 1e6),
    (b, k) => { people[k].body = b.lm; lastAt[k].bodyId = b.id; lastAt[k].body = b.at; });

  pairUp(tracked.faces, MAX_PEOPLE,
    (face, k) => {
      const head = people[k].body && middleOf(people[k].body, [0, 1, 2, 3, 4]);
      const at = head ?? lastAt[k].face;
      return at ? gap(face[1], at) : 1e6;
    },
    (face, k) => { people[k].face = face; lastAt[k].face = face[1]; });

  const handSlot = (j) => [j >> 1, j % 2 ? "rightHand" : "leftHand"];
  pairUp(tracked.hands, 2 * MAX_PEOPLE,
    (h, j) => {
      const [k, which] = handSlot(j);
      const wrist = people[k].body && middleOf(people[k].body, [which === "leftHand" ? 9 : 10], 0.05);
      if (wrist) return gap(h.lm[0], wrist);
      if (lastAt[k][which]) return gap(h.lm[0], lastAt[k][which]);
      const face = people[k].face && h.side === (which === "leftHand" ? "Left" : "Right") ? people[k].face[1] : null;
      return face ? Math.abs(h.lm[0][0] - face[0]) + 0.2 * Math.abs(h.lm[0][1] - face[1]) : 1e6;
    },
    (h, j) => {
      const [k, which] = handSlot(j);
      people[k][which] = h.lm;
      lastAt[k][which] = h.lm[0];
    });
}

function oneEach(things, center, size) {
  const kept = [];
  for (const t of things) {
    const c = center(t);
    const same = (k) => { const kc = center(k); return kc && gap(kc, c) < 0.5 * Math.max(size(k), size(t)); };
    if (!c || !kept.some(same)) kept.push(t);
  }
  return kept;
}

function pairUp(things, slots, cost, give) {
  const pairs = [];
  things.forEach((t, i) => { for (let k = 0; k < slots; k++) pairs.push([cost(t, k), i, k]); });
  pairs.sort((u, v) => u[0] - v[0]);
  const doneThing = new Set(), doneSlot = new Set();
  for (const [, i, k] of pairs) {
    if (doneThing.has(i) || doneSlot.has(k)) continue;
    give(things[i], k);
    doneThing.add(i);
    doneSlot.add(k);
  }
}

function middleOf(lm, idx, minConfidence = 0.2) {
  const ok = idx.filter((i) => lm[i][2] >= minConfidence);
  if (!ok.length) return null;
  return [ok.reduce((s, i) => s + lm[i][0], 0) / ok.length, ok.reduce((s, i) => s + lm[i][1], 0) / ok.length];
}

const gap = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
