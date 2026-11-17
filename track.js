// STEP 1 · TRACK. Three MediaPipe models (through ml5) watch the webcam: 468 points per face,
// 21 per hand, 17 per body. They report separately, so every frame we sort faces, hands and bodies
// into people (person slots), keeping each person in the same slot from frame to frame.

// Start the three trackers; their latest results land in `tracked`.
async function startTracking() {
  // We never use ml5's `flipped` option: everything is computed un-mirrored and the drawing
  // is mirrored at the end (see draw()), like Rockstar.
  const faceMesh = await ml5.faceMesh({ maxFaces: MAX_PEOPLE });
  faceMesh.detectStart(video, (r) => { tracked.faces = r.map((f) => f.keypoints.map((k) => [k.x, k.y])); });

  const handPose = await ml5.handPose({ maxHands: 2 * MAX_PEOPLE });
  handPose.detectStart(video, (r) => {
    tracked.hands = r.map((h) => ({ side: h.handedness, lm: h.keypoints.map((k) => [k.x, k.y]) }));
  });

  // MoveNet "multipose" follows several people at once (17 points each).
  const bodyPose = await ml5.bodyPose("MoveNet", { modelType: "MULTIPOSE_LIGHTNING", enableTracking: true });
  bodyPose.detectStart(video, (r) => {
    tracked.bodies = r.map((b, i) => ({ id: b.id ?? i, lm: b.keypoints.map((k) => [k.x, k.y, k.confidence ?? 1]) }));
  });
}

// The three trackers each report people separately, so every frame we sort faces, hands and
// bodies into person slots. Each thing joins the person it's closest to — using that person's
// body if it's visible, otherwise where their face / hand was last seen — closest pairs first,
// so one person's face can never be handed to someone else just because a point went missing.
function sortIntoPeople() {
  lastAt = [...Array(MAX_PEOPLE)].map((_, k) => lastAt[k] ?? {});
  people = [...Array(MAX_PEOPLE)].map(() => ({}));

  // trackers sometimes report the same face / hand / body twice, almost on top of each other
  tracked.faces = oneEach(tracked.faces, (f) => f[1], (f) => gap(f[234], f[454]));
  tracked.hands = oneEach(tracked.hands, (h) => h.lm[0], (h) => gap(h.lm[5], h.lm[17]));
  tracked.bodies = oneEach(tracked.bodies, (b) => middleOf(b.lm, [5, 6, 11, 12]),
    (b) => (b.lm[5][2] >= 0.2 && b.lm[6][2] >= 0.2 ? gap(b.lm[5], b.lm[6]) : 0));

  // bodies: keep the tracker's id in the same slot; new bodies take the slot whose body was nearest
  const bodies = tracked.bodies.map((b) => ({ ...b, at: middleOf(b.lm, [5, 6, 11, 12]) }));
  pairUp(bodies, MAX_PEOPLE,
    (b, k) => (lastAt[k].bodyId === b.id ? 0 : lastAt[k].body && b.at ? gap(b.at, lastAt[k].body) + 1 : 1e6),
    (b, k) => { people[k].body = b.lm; lastAt[k].bodyId = b.id; lastAt[k].body = b.at; });

  // faces: near the body's head (nose, eyes, ears), or where this person's face last was
  pairUp(tracked.faces, MAX_PEOPLE,
    (face, k) => {
      const head = people[k].body && middleOf(people[k].body, [0, 1, 2, 3, 4]);
      const at = head ?? lastAt[k].face;
      return at ? gap(face[1], at) : 1e6;
    },
    (face, k) => { people[k].face = face; lastAt[k].face = face[1]; });

  // hands: two slots per person (j = 2k is their left hand, 2k + 1 their right). A hand joins
  // the nearest body wrist (9 = their left, 10 = right), or where that hand last was, or failing
  // both, the person whose face is nearest (using the tracker's left/right guess)
  const handSlot = (j) => [j >> 1, j % 2 ? "rightHand" : "leftHand"];
  pairUp(tracked.hands, 2 * MAX_PEOPLE,
    (h, j) => {
      const [k, which] = handSlot(j);
      // wrist points are often low-confidence yet still in the right place, so accept them easily
      const wrist = people[k].body && middleOf(people[k].body, [which === "leftHand" ? 9 : 10], 0.05);
      if (wrist) return gap(h.lm[0], wrist);
      if (lastAt[k][which]) return gap(h.lm[0], lastAt[k][which]);
      // last resort, the nearest face: people stand side by side, so left-right counts most
      const face = people[k].face && h.side === (which === "leftHand" ? "Left" : "Right") ? people[k].face[1] : null;
      return face ? Math.abs(h.lm[0][0] - face[0]) + 0.2 * Math.abs(h.lm[0][1] - face[1]) : 1e6;
    },
    (h, j) => {
      const [k, which] = handSlot(j);
      people[k][which] = h.lm;
      lastAt[k][which] = h.lm[0];
    });
}

// Drop near-duplicates: two detections whose centers are closer than half their size are one thing.
function oneEach(things, center, size) {
  const kept = [];
  for (const t of things) {
    const c = center(t);
    const same = (k) => { const kc = center(k); return kc && gap(kc, c) < 0.5 * Math.max(size(k), size(t)); };
    if (!c || !kept.some(same)) kept.push(t);
  }
  return kept;
}

// Pair things with slots, closest pairs first; each thing and each slot is used at most once.
// cost(thing, slot) = a distance (1e6 = no idea where it belongs); give(thing, slot) records it.
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

// The average of a body's confident points among `idx`, or null if none are confident enough.
function middleOf(lm, idx, minConfidence = 0.2) {
  const ok = idx.filter((i) => lm[i][2] >= minConfidence);
  if (!ok.length) return null;
  return [ok.reduce((s, i) => s + lm[i][0], 0) / ok.length, ok.reduce((s, i) => s + lm[i][1], 0) / ok.length];
}

const gap = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]); // distance between two points (p5 already has a dist())
