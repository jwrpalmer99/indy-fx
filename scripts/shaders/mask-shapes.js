function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function drawConeMask(ctx, center, lengthPx, directionRad, coneAngleRad) {
  const start = directionRad - coneAngleRad * 0.5;
  const end = directionRad + coneAngleRad * 0.5;
  ctx.beginPath();
  ctx.moveTo(center, center);
  ctx.lineTo(center + Math.cos(start) * lengthPx, center + Math.sin(start) * lengthPx);
  ctx.arc(center, center, lengthPx, start, end, false);
  ctx.closePath();
  ctx.fill();
}

function drawLineMask(ctx, center, lengthPx, widthPx, directionRad) {
  const hx = Math.cos(directionRad);
  const hy = Math.sin(directionRad);
  const nx = -hy;
  const ny = hx;
  const halfW = widthPx * 0.5;

  const p0x = center + nx * halfW;
  const p0y = center + ny * halfW;
  const p1x = center - nx * halfW;
  const p1y = center - ny * halfW;
  const p2x = p1x + hx * lengthPx;
  const p2y = p1y + hy * lengthPx;
  const p3x = p0x + hx * lengthPx;
  const p3y = p0y + hy * lengthPx;

  ctx.beginPath();
  ctx.moveTo(p0x, p0y);
  ctx.lineTo(p1x, p1y);
  ctx.lineTo(p2x, p2y);
  ctx.lineTo(p3x, p3y);
  ctx.closePath();
  ctx.fill();
}

function drawRectangleMask(ctx, center, lengthPx, widthPx, directionRad) {
  const hx = Math.cos(directionRad);
  const hy = Math.sin(directionRad);
  const nx = -hy;
  const ny = hx;

  const p0x = center;
  const p0y = center;
  const p1x = center + hx * lengthPx;
  const p1y = center + hy * lengthPx;
  const p2x = p1x + nx * widthPx;
  const p2y = p1y + ny * widthPx;
  const p3x = center + nx * widthPx;
  const p3y = center + ny * widthPx;

  ctx.beginPath();
  ctx.moveTo(p0x, p0y);
  ctx.lineTo(p1x, p1y);
  ctx.lineTo(p2x, p2y);
  ctx.lineTo(p3x, p3y);
  ctx.closePath();
  ctx.fill();
}

function drawRectangleRayMask(ctx, center, lengthPx, directionRad) {
  const dx = Math.cos(directionRad) * lengthPx;
  const dy = Math.sin(directionRad) * lengthPx;
  const x0 = center;
  const y0 = center;
  const x1 = center + dx;
  const y1 = center + dy;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const width = Math.max(1, Math.abs(x1 - x0));
  const height = Math.max(1, Math.abs(y1 - y0));
  ctx.fillRect(left, top, width, height);
}

export function createShapeMaskTexture({
  type = "circle",
  size = 512,
  extentPx = 1,
  distancePx = 1,
  directionDeg = 0,
  coneAngleDeg = 60,
  lineWidthPx = 20
} = {}) {
  const safeExtent = Math.max(1, Number(extentPx) || 1);
  const safeDistance = Math.max(1, Number(distancePx) || 1);
  const safeWidth = Math.max(1, Number(lineWidthPx) || 1);
  const dir = degToRad(Number(directionDeg) || 0);
  const coneAngle = degToRad(clamp(Number(coneAngleDeg) || 60, 1, 179));

  const canvasEl = document.createElement("canvas");
  canvasEl.width = canvasEl.height = size;
  const ctx = canvasEl.getContext("2d");
  const center = size * 0.5;
  const scale = center / safeExtent;
  const lengthLocal = clamp(safeDistance * scale, 1, center);
  const widthLocal = clamp(safeWidth * scale, 1, size);

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(255,255,255,1)";

  if (type === "cone") {
    drawConeMask(ctx, center, lengthLocal, dir, coneAngle);
  } else if (type === "line") {
    drawLineMask(ctx, center, lengthLocal, widthLocal, dir);
  } else if (type === "rectangle") {
    drawRectangleMask(ctx, center, lengthLocal, widthLocal, dir);
  } else if (type === "rectangleRay") {
    drawRectangleRayMask(ctx, center, lengthLocal, dir);
  } else {
    ctx.beginPath();
    ctx.arc(center, center, lengthLocal, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }

  const texture = PIXI.Texture.from(canvasEl);
  if (texture.baseTexture) {
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    texture.baseTexture.update();
  }
  return texture;
}
