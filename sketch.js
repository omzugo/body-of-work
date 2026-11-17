// BODY OF WORK — you (and a friend), live, collaged from scraps of paintings.
//
// Every frame, in order (each step has its own file):
//   1. track.js    the webcam's faces, hands and bodies, sorted into people
//   2. shapes.js   each body part becomes a simple shape (pieces.js says which)…
//   3. shapes.js   …smoothed, fading in and out
//   4. choose.js   each shape takes a scrap you approved for its part (review.html)
//   5. draw.js     each scrap is cut to its shape and laid on it
//   6. draw.js     drawn on white, body → face → hands, mirrored like a mirror
// The scraps were cut and reviewed beforehand (tools/, review.html).

// ---------- knobs to play with ----------
let MAX_PEOPLE = 2;    // how many people to collage at once
let SWAP_EVERY = 0.5;  // seconds between swapping one shape's scrap (they take turns, so with
                       // ~60 shapes each one keeps its painting for about half a minute)
let STEADY = 1.0;      // how still shapes sit when you're still: lower = steadier, but laggier
let RESPONSIVE = 0.01; // how quickly they catch up when you move fast: higher = snappier
let FADE_OUT = 0.35;   // seconds a shape takes to dissolve where it was, once its tracker loses it
let FADE_IN = 0.15;    // seconds a shape takes to appear
let MARGIN = CUT_MARGIN; // pieces are cut this much wider than the object (see curation.js)
let MOUTH_OPENS = 0.25;  // lip gap / mouth width above which the mouth counts as open…
let MOUTH_CLOSES = 0.15; // …and below which it counts as closed again (the gap stops flicker)
let EMPTY_GRAY = 200;     // the gray for shapes with no scrap yet (0 = black, 255 = white)
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
  document.fonts.load('15px "Google Sans"'); // fetch the font now, so the first message uses it

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
  const curation = await fetch("library/curation.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  lib = {
    paintings: (await (await fetch("library/paintings.json")).json()).paintings,
    parts: mergeCuration(await (await fetch("library/parts.json")).json(), curation),
  };
  for (let who = 0; who < MAX_PEOPLE; who++) {
    for (const def of PIECES) pieces.push({ def, who, f: null, patch: null, next: null, flip: false });
  }

  await startTracking(); // track.js
}

function draw() {
  background(255);
  if (!lib) return message("loading");

  sortIntoPeople();  // step 1: which face / hands / body belong to whom
  updateShapes();    // steps 2–3: points → shapes, smoothed, fading in and out
  if (!pieces.some((p) => p.f)) return message("looking");
  swapSome();        // step 4: choose scraps

  push();
  toScreen();        // step 6: webcam pixels → screen, mirrored like a mirror
  if (showVideo) { tint(255, 60); image(video, 0, 0); noTint(); }
  for (const p of pieces) if (p.f) p.patch ? drawPiece(p) : drawEmpty(p); // step 5: fill
  if (showShapes) for (const p of pieces) if (p.f) drawShapeOutline(p);
  pop();

  if (showCredits && lastSwap) drawCredit();
  if (showHelp) drawHelp();
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

// A quiet status line in the middle of the screen ("looking", "loading").
function message(t) {
  noStroke();
  fill(0, 128); // black at 50% opacity
  textFont("Google Sans"); // loaded from Google Fonts in index.html
  textSize(15);
  textAlign(CENTER, CENTER);
  text(t, width / 2, height / 2);
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
