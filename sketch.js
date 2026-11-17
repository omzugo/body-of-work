// PAINTED FACE — you (and a friend), live, collaged from scraps of paintings.
//
// The whole idea in four steps:
//   1. ml5 tracks faces, hands and bodies. pieces.js turns each person's points into ~60 basic
//      shapes (ovals and capsules): an oval per eye, a capsule per finger bone, per shin…
//   2. Every shape belongs to a part (eye, limb, foot…). tools/build_parts.py has already cut, for
//      each part, hundreds of painting scraps in exactly that shape: real eyes and eye-like
//      things for eyes; columns, trunks, legs for limbs; shoes, hooves, paws for feet.
//   3. Each shape picks a scrap from its part's pool, and follows the body every frame.
//   4. A few times a second one shape swaps to another scrap, so the collage keeps changing.

// ---------- knobs to play with ----------
let MAX_PEOPLE = 2;    // how many people to collage at once
let SWAP_EVERY = 0.5;  // seconds between swapping one shape's scrap (they take turns, so with
                       // ~60 shapes each one keeps its painting for about half a minute)
let STEADY = 1.0;      // how still shapes sit when you're still: lower = steadier, but laggier
let RESPONSIVE = 0.01; // how quickly they catch up when you move fast: higher = snappier
let FADE_OUT = 0.35;   // seconds a shape takes to dissolve where it was, once its tracker loses it
let FADE_IN = 0.15;    // seconds a shape takes to appear
let MARGIN = CUT_MARGIN; // pieces are cut this much wider than the object (see curation.js)
let TOP_K = 12;        // pick randomly among this many best scraps, for variety
let ONLY_APPROVED = true; // only scraps you approved on the review page (review.html); shapes
                          // whose part has none yet are plain gray. false = also unreviewed ones
let APPROVED_BONUS = 0.05; // (when false) how much to prefer approved scraps over unreviewed ones
let MOUTH_OPENS = 0.25;  // lip gap / mouth width above which the mouth counts as open…
let MOUTH_CLOSES = 0.15; // …and below which it counts as closed again (the gap stops flicker)
let EMPTY_GRAY = 200;     // the gray for shapes with no scrap yet (0 = black, 255 = white)
let BLUR = 0.03;       // how much to avoid stretching small scraps over big pieces
let STRETCH = 0.1;     // how much to avoid squashing a scrap into a different shape
let showShapes = false;   // outline every shape (press s)
let showVideo = false;    // faint webcam underneath (press v)
let showCredits = false;  // the latest swap's painting (press c)
let showHelp = false;     // the key list (press h)

// ---------- things the program keeps track of ----------
let video;
let tracked = { faces: [], hands: [], bodies: [] }; // latest results from each tracker
let people = [];       // per person slot: {face, leftHand, rightHand, body} (any can be null)
let pieces = [];       // every shape of every person: {def, who, f: smoothed frame, patch, next, flip}
let lastAt = [];       // per person slot: where their face, hands and body were last seen
let lib;               // {paintings: credits, parts: {part: {shape, items}}}
let nextSwap = 0, swapTurn = 0, lastSwap = null, lastDrawAt = null;

async function setup() {
  createCanvas(windowWidth, windowHeight);

  // index.html?test=some/image.jpg uses a still image instead of the webcam (handy for testing).
  const testImage = new URLSearchParams(location.search).get("test");
  if (testImage) {
    video = await loadImage(testImage);
  } else {
    video = createCapture(VIDEO);
    video.size(640, 480);
    video.hide();
  }

  // the scrap pools from tools/build_parts.py, with your review decisions applied (curation.js)
  const curation = migrateCuration(await fetch("library/curation.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  lib = {
    paintings: (await (await fetch("library/paintings.json")).json()).paintings,
    parts: mergeCuration(await (await fetch("library/parts.json")).json(), curation),
  };
  for (let who = 0; who < MAX_PEOPLE; who++) {
    for (const def of PIECES) pieces.push({ def, who, f: null, patch: null, next: null, flip: false });
  }

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

function draw() {
  background(255);
  if (!lib) return message("loading paintings…");

  sortIntoPeople();
  // Where is every shape right now? (null = that part isn't visible)
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
  if (!pieces.some((p) => p.f)) return message("step into view…");

  swapSome();

  // Draw in webcam pixels, scaled to fit the screen and mirrored like a mirror.
  push();
  const s = min(width / video.width, height / video.height);
  translate(width / 2, height / 2);
  scale(-s, s);
  translate(-video.width / 2, -video.height / 2);
  if (showVideo) { tint(255, 60); image(video, 0, 0); noTint(); }
  for (const p of pieces) if (p.f) p.patch ? drawPiece(p) : drawEmpty(p);
  if (showShapes) for (const p of pieces) if (p.f) drawShapeOutline(p);
  pop();

  if (showCredits && lastSwap) drawCredit();
  if (showHelp) drawHelp();
}

// A shape waiting in place (its tracking was lost) is a leftover copy if the same feature is being
// tracked live right where it is — e.g. your face just moved to the other person slot. Without
// this, the old set of features freezes for a moment while the new set appears on top.
// Returns that live twin, or undefined.
function liveTwin(p, targets) {
  return pieces.find((q, i) => q !== p && q.def.name === p.def.name && targets[i] &&
    gap([targets[i].x, targets[i].y], [p.f.x, p.f.y]) < Math.max(p.f.L, targets[i].L));
}

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

// ---------- who is who ----------

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

// ---------- choosing scraps ----------

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

// Pick a scrap from this piece's part pool: approved by you (see ONLY_APPROVED), well-matched,
// not blurry when enlarged, not squashed, and ideally from a painting no other piece is showing
// (if a part has only a few approved scraps, repeats are better than gray).
function pickScrap(p, allowRepeats = false) {
  const pool = lib.parts[p.def.pool];
  if (!pool) return null;
  const used = allowRepeats ? new Set() : new Set(pieces.filter((q) => q !== p && q.patch).map((q) => q.patch.painting));
  const aspect = p.f.W / p.f.L;
  const ranked = [];
  for (const s of pool.scraps) {
    if (s.status === "rejected" || (ONLY_APPROVED && s.status !== "approved") || used.has(s.painting)) continue;
    if (p.def.opening && s.open !== !!p.open) continue; // open mouths only while yours is open
    const blur = Math.max(0, Math.log2(p.f.L / s.L)) ** 2;
    const stretch = Math.log(s.W / s.L / aspect) ** 2;
    const bonus = s.status === "approved" ? APPROVED_BONUS : 0;
    ranked.push([s.score + bonus - BLUR * blur - STRETCH * stretch, s]);
  }
  ranked.sort((u, v) => v[0] - u[0]);
  if (!ranked.length) return allowRepeats ? null : pickScrap(p, true);
  return random(ranked.slice(0, TOP_K))[1];
}

// ---------- drawing ----------

// Cut the shape out of the painting and lay it on the frame.
function drawPiece(p) {
  const f = p.f, src = p.patch, [x0, y0, x1, y1] = src.tile.box;
  // Shapes are symmetric, so a scrap can go on either way round: pick the way that keeps the
  // painting's "up" pointing up on screen (no upside-down columns on a raised hand).
  // The ±0.25 gap stops it flipping back and forth when a limb is near horizontal.
  const c = Math.cos(src.a - f.a);
  if (p.flip && c > 0.25) p.flip = false;
  if (!p.flip && c < -0.25) p.flip = true;

  // Pieces that face a way (ears: outer edge away from the face). In a scrap the outer edge is
  // the painting's right-hand side (left, if you marked it mirrored on the review page). If that
  // would end up facing inward, mirror the scrap across its long axis (up stays up).
  const turn = f.a + (p.flip ? PI : 0);
  let mirror = false;
  if (p.out) {
    const side = src.mirrored ? -1 : 1, sx = f.L / src.L, sy = f.W / src.W;
    // follow the painting's right-hand direction through the same steps as the drawing below
    const wx = side * Math.cos(src.a) * sx, wy = -side * Math.sin(src.a) * sy;
    const dx = wx * Math.cos(turn) - wy * Math.sin(turn), dy = wx * Math.sin(turn) + wy * Math.cos(turn);
    mirror = dx * p.out[0] + dy * p.out[1] < 0;
  }

  push();
  drawingContext.globalAlpha = p.alpha ?? 1; // fading in or dissolving out
  translate(f.x, f.y);
  rotate(turn);
  clip(() => drawShape(p.def.shape, f.L, f.W * MARGIN)); // the scissors
  if (mirror) scale(1, -1);                               // flip across the long axis
  scale(f.L / src.L, f.W / src.W);                        // stretch the scrap to the piece's size
  rotate(-src.a);                                         // undo the scrap's own angle in its painting
  translate(-src.x, -src.y);
  image(src.tile.img, x0, y0, x1 - x0, y1 - y0); // the sharp tile, laid where it sits in its painting
  pop();
}

// A shape with no scrap yet (nothing approved for its part): plain gray.
function drawEmpty(p) {
  push();
  drawingContext.globalAlpha = p.alpha ?? 1;
  translate(p.f.x, p.f.y);
  rotate(p.f.a);
  noStroke();
  fill(EMPTY_GRAY);
  drawShape(p.def.shape, p.f.L, p.f.W * MARGIN);
  pop();
}

function drawShape(shape, L, W) {
  if (shape === "oval") ellipse(0, 0, L, W);
  else rect(-L / 2, -W / 2, L, W, W / 2); // capsule = rectangle with fully rounded ends
}

function drawShapeOutline(p) {
  push();
  translate(p.f.x, p.f.y);
  rotate(p.f.a);
  noFill();
  stroke(255, 0, 120);
  strokeWeight(1);
  drawShape(p.def.shape, p.f.L, p.f.W * MARGIN);
  pop();
}

function drawCredit() {
  const src = lastSwap.patch ?? lastSwap.next;
  if (!src) return;
  const c = lib.paintings[src.painting];
  noStroke();
  fill(90);
  textFont("monospace");
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text(`${lastSwap.def.name}  ←  ${c.title}${c.artist ? " — " + c.artist : ""}  (${c.subject})`, 12, height - 10);
}

function drawHelp() {
  noStroke();
  fill(0, 160);
  textFont("monospace");
  textSize(12);
  textAlign(LEFT, TOP);
  text("space  new scraps for everything\n" +
       "s      show shapes\n" +
       "v      show webcam\n" +
       "c      credit\n" +
       "f      fullscreen\n" +
       "h      hide this help", 12, 12);
}

function message(t) {
  noStroke();
  fill(120);
  textFont("monospace");
  textSize(16);
  textAlign(CENTER, CENTER);
  text(t, width / 2, height / 2);
}

// ---------- small helpers ----------

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


function keyPressed() {
  if (key === " ") pieces.forEach((p) => (p.patch = p.next = null));
  if (key === "s") showShapes = !showShapes;
  if (key === "v") showVideo = !showVideo;
  if (key === "c") showCredits = !showCredits;
  if (key === "h") showHelp = !showHelp;
  if (key === "f") fullscreen(!fullscreen());
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
