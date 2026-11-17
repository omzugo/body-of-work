function toScreen() {
  const s = min(width / video.width, height / video.height);
  translate(width / 2, height / 2);
  scale(-s, s);
  translate(-video.width / 2, -video.height / 2);
}

function drawPiece(p) {
  const f = p.f, src = p.patch, [x0, y0, x1, y1] = src.tile.box;
  const c = Math.cos(src.a - f.a);
  if (p.flip && c > 0.25) p.flip = false;
  if (!p.flip && c < -0.25) p.flip = true;

  const turn = f.a + (p.flip ? PI : 0);
  let mirror = false;
  if (p.out) {
    const side = src.mirrored ? -1 : 1, sx = f.L / src.L, sy = f.W / src.W;
    const wx = side * Math.cos(src.a) * sx, wy = -side * Math.sin(src.a) * sy;
    const dx = wx * Math.cos(turn) - wy * Math.sin(turn), dy = wx * Math.sin(turn) + wy * Math.cos(turn);
    mirror = dx * p.out[0] + dy * p.out[1] < 0;
  }

  push();
  drawingContext.globalAlpha = p.alpha ?? 1;
  translate(f.x, f.y);
  rotate(turn);
  clip(() => drawShape(p.def.shape, f.L, f.W * MARGIN));
  if (mirror) scale(1, -1);
  scale(f.L / src.L, f.W / src.W);
  rotate(-src.a);
  translate(-src.x, -src.y);
  image(src.tile.img, x0, y0, x1 - x0, y1 - y0);
  pop();
}

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
  else rect(-L / 2, -W / 2, L, W, W / 2);
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
