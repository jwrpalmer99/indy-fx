export function parseHexColorLike(value, fallback = 0xFFFFFF) {
  if (Number.isFinite(Number(value))) {
    const n = Math.round(Number(value));
    return Math.max(0, Math.min(0xFFFFFF, n));
  }
  const clean = String(value ?? "")
    .trim()
    .replace(/^#|^0x/i, "")
    .replace(/[^0-9a-f]/gi, "");
  if (!clean) return fallback;
  const n = parseInt(clean.slice(0, 6), 16);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(0xFFFFFF, n));
}
export function parseDistanceValue(value, fallback) {
  if (Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const m = value.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : fallback;
}

export function sceneUnitsToPixels(distanceUnits) {
  if (canvas.grid?.getPixelsFromDistance) {
    return canvas.grid.getPixelsFromDistance(distanceUnits);
  }
  const dims = canvas.dimensions ?? canvas.scene?.dimensions;
  const gridSize = dims?.size ?? canvas.scene?.grid?.size ?? canvas.grid?.size ?? 100;
  const gridDistance = dims?.distance ?? canvas.scene?.grid?.distance ?? canvas.grid?.distance ?? 5;
  if (!Number.isFinite(distanceUnits) || distanceUnits <= 0) return gridSize;
  return (distanceUnits / Math.max(0.0001, gridDistance)) * gridSize;
}

export function scenePixelsToUnits(distancePixels) {
  if (canvas.grid?.getDistanceFromPixels) {
    return canvas.grid.getDistanceFromPixels(distancePixels);
  }
  const dims = canvas.dimensions ?? canvas.scene?.dimensions;
  const gridSize = dims?.size ?? canvas.scene?.grid?.size ?? canvas.grid?.size ?? 100;
  const gridDistance = dims?.distance ?? canvas.scene?.grid?.distance ?? canvas.grid?.distance ?? 5;
  if (!Number.isFinite(distancePixels) || distancePixels <= 0) return gridDistance;
  return (distancePixels / Math.max(0.0001, gridSize)) * gridDistance;
}

export function getTokenCenter(tok) {
  const preview = tok?._preview ?? tok?.preview;
  const live = (preview && preview.destroyed !== true) ? preview : tok;
  return live?.center ?? { x: live?.x + (live?.w / 2), y: live?.y + (live?.h / 2) };
}

const SHAPE_TYPES = new Set(["circle", "cone", "line", "rectangle"]);

export function normalizeShapeType(shape) {
  const normalized = String(shape ?? "circle").toLowerCase().trim();
  return SHAPE_TYPES.has(normalized) ? normalized : "circle";
}

export function worldPointFromPointerEvent(event) {
  const global = event?.data?.global ?? event?.global;
  if (!global || !canvas.stage?.toLocal) return null;
  const p = canvas.stage.toLocal(global);
  return { x: p.x, y: p.y };
}

export function drawPlacementPreview(gfx, {
  origin,
  target,
  shape = "circle",
  coneAngleDeg = 60,
  lineWidthPx = 100
} = {}) {
  if (!gfx || !origin || !target) return;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const dir = Math.atan2(dy, dx);
  const shapeType = normalizeShapeType(shape);

  gfx.clear();
  gfx.lineStyle(2, 0x00ff88, 0.95);
  gfx.beginFill(0x00ff88, 0.18);

  if (shapeType === "line") {
    const hx = Math.cos(dir);
    const hy = Math.sin(dir);
    const nx = -hy;
    const ny = hx;
    const halfW = Math.max(2, lineWidthPx * 0.5);
    const p0x = origin.x + nx * halfW;
    const p0y = origin.y + ny * halfW;
    const p1x = origin.x - nx * halfW;
    const p1y = origin.y - ny * halfW;
    const p2x = p1x + hx * dist;
    const p2y = p1y + hy * dist;
    const p3x = p0x + hx * dist;
    const p3y = p0y + hy * dist;
    gfx.moveTo(p0x, p0y);
    gfx.lineTo(p1x, p1y);
    gfx.lineTo(p2x, p2y);
    gfx.lineTo(p3x, p3y);
    gfx.closePath();
  } else if (shapeType === "cone") {
    const half = (Math.max(1, Math.min(179, coneAngleDeg)) * Math.PI / 180) * 0.5;
    const a0 = dir - half;
    const a1 = dir + half;
    gfx.moveTo(origin.x, origin.y);
    gfx.lineTo(origin.x + Math.cos(a0) * dist, origin.y + Math.sin(a0) * dist);
    gfx.arc(origin.x, origin.y, dist, a0, a1, false);
    gfx.lineTo(origin.x, origin.y);
  } else if (shapeType === "rectangle") {
    const hx = Math.cos(dir);
    const hy = Math.sin(dir);
    const nx = -hy;
    const ny = hx;
    const halfW = Math.max(2, lineWidthPx * 0.5);
    const p0 = { x: origin.x + nx * halfW, y: origin.y + ny * halfW };
    const p1 = { x: origin.x - nx * halfW, y: origin.y - ny * halfW };
    const p2 = { x: p1.x + hx * dist, y: p1.y + hy * dist };
    const p3 = { x: p0.x + hx * dist, y: p0.y + hy * dist };
    gfx.moveTo(p0.x, p0.y);
    gfx.lineTo(p1.x, p1.y);
    gfx.lineTo(p2.x, p2.y);
    gfx.lineTo(p3.x, p3.y);
    gfx.closePath();
  } else {
    gfx.drawCircle(origin.x, origin.y, dist);
  }

  gfx.endFill();
}

