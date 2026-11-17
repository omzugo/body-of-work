let MAX_PEOPLE = 2;
let SWAP_EVERY = 0.5;
let STEADY = 1.0;
let RESPONSIVE = 0.01;
let FADE_OUT = 0.35;
let FADE_IN = 0.15;
let MARGIN = CUT_MARGIN;
let MOUTH_OPENS = 0.25;
let MOUTH_CLOSES = 0.15;
let EMPTY_GRAY = 200;
let showShapes = false;
let showVideo = false;
let showCredits = false;
let showHelp = false;

let video;
let tracked = { faces: [], hands: [], bodies: [] };
let people = [];
let pieces = [];
let lastAt = [];
let lib;
let nextSwap = 0, swapTurn = 0, lastSwap = null, lastDrawAt = null;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  document.fonts.load('15px "Google Sans"');

  const testImage = new URLSearchParams(location.search).get("test");
  if (testImage) {
    video = await loadImage(testImage);
  } else {
    video = createCapture(VIDEO);
    video.size(640, 480);
    video.hide();
  }

  const curation = await fetch("library/curation.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  lib = {
    paintings: (await (await fetch("library/paintings.json")).json()).paintings,
    parts: mergeCuration(await (await fetch("library/parts.json")).json(), curation),
  };
  for (let who = 0; who < MAX_PEOPLE; who++) {
    for (const def of PIECES) pieces.push({ def, who, f: null, patch: null, next: null, flip: false });
  }

  await startTracking();
}

function draw() {
  background(255);
  if (!lib) return message("loading");

  sortIntoPeople();
  updateShapes();
  if (!pieces.some((p) => p.f)) return message("looking");
  swapSome();

  push();
  toScreen();
  if (showVideo) { tint(255, 60); image(video, 0, 0); noTint(); }
  for (const p of pieces) if (p.f) p.patch ? drawPiece(p) : drawEmpty(p);
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

function message(t) {
  noStroke();
  fill(0, 128);
  textFont("Google Sans");
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
