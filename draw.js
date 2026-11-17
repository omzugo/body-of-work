// STEPS 5–6 · FILL AND COMPOSE. Each scrap is cut to its shape and laid on it; the picture is
// drawn in webcam pixels, then scaled to the screen and mirrored like a mirror.

// Draw in webcam pixels from here on, scaled to fit the screen and mirrored like a mirror.
function toScreen() {
  const s = min(width / video.width, height / video.height);
  translate(width / 2, height / 2);
  scale(-s, s);
  translate(-video.width / 2, -video.height / 2);
}

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
