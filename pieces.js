// The pieces: basic shapes (ovals and capsules) pinned to points the live trackers find.
//
// Every piece has a FRAME: a center (x, y), an angle a, a length L along that angle and a width W
// across it (L ≥ W always). The frame is all the matcher needs: it reads the webcam's light/dark
// pattern inside the frame and finds a painting patch with the same pattern.
//
// Point numbers follow MediaPipe, which ml5 uses:
//   face: 0–467 (faceMesh)   hands: 0 wrist, 4 thumb tip, 8 index tip… (handPose)
//   body: 11/12 shoulders, 13/14 elbows, 15/16 wrists (bodyPose "BlazePose")

// ---------- frame builders ----------

// A capsule along the line from point i to point j, `width` pixels wide (a little longer than the
// bone, so neighbouring bones overlap at the joints).
function bone(lm, i, j, width, stretch = 1.15) {
  const [x1, y1] = lm[i], [x2, y2] = lm[j];
  return tidy({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, a: Math.atan2(y2 - y1, x2 - x1),
    L: Math.hypot(x2 - x1, y2 - y1) * stretch, W: width });
}

// The smallest box at angle `a` that holds the points `idx`, grown by `pad`.
function blob(lm, idx, a, pad, minW = 0) {
  const ca = Math.cos(a), sa = Math.sin(a);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const i of idx) {
    const u = lm[i][0] * ca + lm[i][1] * sa, v = -lm[i][0] * sa + lm[i][1] * ca;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const u = (u0 + u1) / 2, v = (v0 + v1) / 2;
  return tidy({ x: u * ca - v * sa, y: u * sa + v * ca, a,
    L: (u1 - u0) * pad, W: Math.max((v1 - v0) * pad, minW) });
}

// Keep the frame pointing the way the body part does (a nose runs down the face, a finger along
// its bone), but never let it be wider than it is long: then it just becomes round.
// (It used to turn a quarter turn instead, which flipped noses sideways on small or turned faces.)
function tidy(f) {
  return f.W > f.L ? { ...f, L: f.W } : f;
}

const d = (lm, i, j) => Math.hypot(lm[i][0] - lm[j][0], lm[i][1] - lm[j][1]);

// ---------- face: 10 separate pieces (plus two ears, below), gaps allowed ----------
// Every piece names the pool (tools/build_parts.py) it draws from: that part, or things shaped like it.

const faceAcross = (lm) => Math.atan2(lm[263][1] - lm[33][1], lm[263][0] - lm[33][0]); // eye to eye
const faceDown = (lm) => faceAcross(lm) + Math.PI / 2;

const FACE_PIECES = [
  // name         shape      pool        points                                              axis        pad
  ["forehead",   "oval",    "forehead", [10, 338, 297, 109, 67, 151, 108, 69, 337, 299], faceAcross, 1.0],
  ["rightCheek", "oval",    "cheek",    [50, 205, 187, 123, 116, 117, 118, 101, 36, 147, 213, 192, 207, 216, 206], faceDown, 1.0],
  ["leftCheek",  "oval",    "cheek",    [280, 425, 411, 352, 345, 346, 347, 330, 266, 376, 433, 416, 427, 436, 426], faceDown, 1.0],
  ["chin",       "oval",    "chin",     [152, 148, 176, 149, 377, 400, 378, 175, 199, 200, 18, 83, 313], faceAcross, 1.0],
  ["rightBrow",  "capsule", "brow",     [46, 53, 52, 65, 55, 70, 63, 105, 66, 107], faceAcross, 1.15],
  ["leftBrow",   "capsule", "brow",     [276, 283, 282, 295, 285, 300, 293, 334, 296, 336], faceAcross, 1.15],
  ["rightEye",   "oval",    "eye",      [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], faceAcross, 1.5],
  ["leftEye",    "oval",    "eye",      [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466], faceAcross, 1.5],
  ["nose",       "oval",    "nose",     [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327, 129, 358, 49, 279], faceDown, 1.1],
  ["mouth",      "oval",    "mouth",    [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185], faceAcross, 1.25],
].map(([name, shape, pool, idx, axis, pad]) => ({
  name, shape, pool, from: "face",
  frame: (lm) => blob(lm, idx, axis(lm), pad, 0.05 * d(lm, 234, 454)),
}));

// How open the mouth is: the gap between the inner edges of the lips (points 13, 14) relative to
// the mouth's width (61 to 291). About 0 when closed, 0.5 or more wide open. While it's open, the
// mouth shows only scraps you marked "open" on the review page (key o).
FACE_PIECES.find((p) => p.name === "mouth").opening = (lm) => d(lm, 13, 14) / d(lm, 61, 291);

// Ears. The face tracker has no points on the ears, so each one sits just outside the face's edge,
// between eye level and the bottom of the nose (points 127/234/93 on their right, 356/454/323 on
// their left), nudged outward. Drawn behind the rest of the face.
function ear(lm, idx, edge) {
  const f = blob(lm, idx, faceDown(lm), 1.6, 0.1 * d(lm, 234, 454));
  const [mx, my] = lm[168], dx = lm[edge][0] - mx, dy = lm[edge][1] - my, n = Math.hypot(dx, dy) || 1;
  const push = 0.06 * d(lm, 234, 454); // away from the middle of the face
  // `out`: which way the ear's outer edge should face (away from the face), so the sketch can
  // mirror a scrap that would otherwise face inward
  return { ...f, x: f.x + (dx / n) * push, y: f.y + (dy / n) * push, out: [dx / n, dy / n] };
}
const EAR_PIECES = [
  { name: "rightEar", shape: "oval", pool: "ear", from: "face", frame: (lm) => ear(lm, [127, 234, 93], 234) },
  { name: "leftEar", shape: "oval", pool: "ear", from: "face", frame: (lm) => ear(lm, [356, 454, 323], 454) },
];

// ---------- hands: a palm plus every finger bone, for each hand ----------

const FINGERS = { thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };

function handPieces(hand) {
  const pieces = [{
    name: `${hand} palm`, shape: "oval", from: hand, pool: "palm",
    frame: (lm) => blob(lm, [0, 1, 5, 9, 13, 17], Math.atan2(lm[9][1] - lm[0][1], lm[9][0] - lm[0][0]), 1.1),
  }];
  for (const [finger, joints] of Object.entries(FINGERS)) {
    for (let k = 0; k < 3; k++) {
      pieces.push({
        name: `${hand} ${finger} ${k + 1}`, shape: "capsule", from: hand, pool: "digit",
        frame: (lm) => bone(lm, joints[k], joints[k + 1], (finger === "thumb" ? 0.26 : 0.21) * d(lm, 5, 17)),
      });
    }
  }
  return pieces;
}

// ---------- body: shoulders down to feet ----------
// bodyPose "MoveNet" (which can track several people) numbers 17 points:
//   5/6 shoulders, 7/8 elbows, 9/10 wrists, 11/12 hips, 13/14 knees, 15/16 ankles (odd = their left)

// The shoulder line gives a little coordinate system: S = shoulder width, M = midpoint,
// `down` points from the shoulders toward the hips.
function torso(lm) {
  const [x1, y1] = lm[5], [x2, y2] = lm[6];
  const S = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / S, uy = (y2 - y1) / S;
  return { S, M: [(x1 + x2) / 2, (y1 + y2) / 2], down: [uy, -ux], a: Math.atan2(uy, ux) };
}
const along = (t, k) => [t.M[0] + t.down[0] * k * t.S, t.M[1] + t.down[1] * k * t.S];
const seen = (lm, ...idx) => idx.every((i) => lm[i][2] >= 0.3);

// A foot: a short capsule from the ankle, sideways, pointing away from the body's middle.
function foot(lm, knee, ankle) {
  const t = torso(lm), [ax, ay] = lm[ankle];
  const out = Math.sign(ax - t.M[0]) || 1;
  const sx = ay - lm[knee][1], sy = -(ax - lm[knee][0]); // shin direction turned a quarter
  const n = Math.hypot(sx, sy) || 1, k = out * Math.sign(sx || 1) * 0.35 * t.S / n;
  return bone([[ax, ay], [ax + sx * k, ay + sy * k]], 0, 1, 0.16 * t.S, 1.2);
}

const BODY_PIECES = [
  { name: "leftThigh", shape: "capsule", pool: "limb", needs: [5, 6, 11, 13],
    frame: (lm) => bone(lm, 11, 13, 0.36 * torso(lm).S) },
  { name: "rightThigh", shape: "capsule", pool: "limb", needs: [5, 6, 12, 14],
    frame: (lm) => bone(lm, 12, 14, 0.36 * torso(lm).S) },
  { name: "leftShin", shape: "capsule", pool: "limb", needs: [5, 6, 13, 15],
    frame: (lm) => bone(lm, 13, 15, 0.28 * torso(lm).S) },
  { name: "rightShin", shape: "capsule", pool: "limb", needs: [5, 6, 14, 16],
    frame: (lm) => bone(lm, 14, 16, 0.28 * torso(lm).S) },
  { name: "leftFoot", shape: "capsule", pool: "foot", needs: [5, 6, 13, 15],
    frame: (lm) => foot(lm, 13, 15) },
  { name: "rightFoot", shape: "capsule", pool: "foot", needs: [5, 6, 14, 16],
    frame: (lm) => foot(lm, 14, 16) },
  { name: "hips", shape: "oval", pool: "hips", needs: [5, 6, 11, 12],
    frame: (lm) => { const t = torso(lm), b = bone(lm, 11, 12, 0); return { ...b, L: Math.max(b.L * 1.4, 0.75 * t.S), W: 0.4 * t.S }; } },
  { name: "shoulders", shape: "capsule", pool: "shoulder", needs: [5, 6],
    frame: (lm) => bone(lm, 5, 6, 0.3 * torso(lm).S, 1.25) }, // one wide piece, tip to tip
  { name: "neck", shape: "capsule", pool: "neck", needs: [5, 6],
    frame: (lm) => { const t = torso(lm); return bone([t.M, along(t, -0.35)], 0, 1, 0.2 * t.S, 1); } },
  { name: "chest", shape: "oval", pool: "chest", needs: [5, 6],
    frame: (lm) => { const t = torso(lm), [x, y] = along(t, 0.35); return { x, y, a: t.a, L: 0.8 * t.S, W: 0.45 * t.S }; } },
  { name: "belly", shape: "oval", pool: "belly", needs: [5, 6],
    frame: (lm) => {
      const t = torso(lm);
      // halfway between chest and hips when the hips are visible, otherwise a guess
      const [x, y] = seen(lm, 11, 12)
        ? [(t.M[0] + (lm[11][0] + lm[12][0]) / 2 * 1.5) / 2.5, (t.M[1] + (lm[11][1] + lm[12][1]) / 2 * 1.5) / 2.5]
        : along(t, 0.85);
      return { x, y, a: t.a, L: 0.6 * t.S, W: 0.45 * t.S };
    } },
  { name: "leftUpperArm", shape: "capsule", pool: "limb", needs: [5, 6, 7],
    frame: (lm) => bone(lm, 5, 7, 0.32 * torso(lm).S) },
  { name: "rightUpperArm", shape: "capsule", pool: "limb", needs: [5, 6, 8],
    frame: (lm) => bone(lm, 6, 8, 0.32 * torso(lm).S) },
  { name: "leftForearm", shape: "capsule", pool: "limb", needs: [5, 6, 7, 9],
    frame: (lm) => bone(lm, 7, 9, 0.26 * torso(lm).S) },
  { name: "rightForearm", shape: "capsule", pool: "limb", needs: [5, 6, 8, 10],
    frame: (lm) => bone(lm, 8, 10, 0.26 * torso(lm).S) },
].map((p) => ({ ...p, from: "body" }));

// One person's pieces, drawn in this order: body at the back, then face, then hands in front.
const PIECES = [...BODY_PIECES, ...EAR_PIECES, ...FACE_PIECES, ...handPieces("leftHand"), ...handPieces("rightHand")];
