// Region geometry/mask helpers extracted from main.js

export function getRegionShapeSignature(region) {
  const doc = region?.document ?? region;
  const num = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(4) : "nan";
  const shapes = doc?.shapes ?? [];
  const serial = JSON.stringify(shapes, (_key, value) => {
    if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(4));
    return value;
  });
  return `${num(doc?.x)}|${num(doc?.y)}|${serial}`;
}

function _rotateAround(p, center, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + (dx * c - dy * s),
    y: center.y + (dx * s + dy * c)
  };
}

function _pointsBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function _normalizePointArray(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  if (!raw.length) return [];
  if (typeof raw[0] === "number") {
    const out = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const x = Number(raw[i]);
      const y = Number(raw[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push({ x, y });
    }
    return out;
  }
  return raw
    .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function _buildPolygonShapeFromPoints(points, {
  id,
  isHole = false,
} = {}) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const bounds = _pointsBounds(points);
  if (!Number.isFinite(bounds?.minX) || !Number.isFinite(bounds?.minY) ||
      !Number.isFinite(bounds?.maxX) || !Number.isFinite(bounds?.maxY)) {
    return null;
  }
  return {
    id: id ?? null,
    kind: "polygon",
    isHole: isHole === true,
    points,
    bounds,
    center: {
      x: (bounds.minX + bounds.maxX) * 0.5,
      y: (bounds.minY + bounds.maxY) * 0.5
    },
    width: Math.max(2, bounds.maxX - bounds.minX),
    height: Math.max(2, bounds.maxY - bounds.minY),
    localMask: {
      type: "polygon",
      points: points.map((p) => ({ x: p.x - bounds.minX, y: p.y - bounds.minY }))
    }
  };
}

function _extractRegionShape(rawShape, index) {
  const shape = rawShape && typeof rawShape === "object" ? rawShape : {};
  const type = String(shape.type ?? shape.shape ?? shape.kind ?? "").toLowerCase();
  const holeOp = String(shape.operation ?? shape.op ?? shape.mode ?? "").toLowerCase();
  const isHole = (
    shape.hole === true ||
    shape.hole === 1 ||
    String(shape.hole).toLowerCase() === "true" ||
    shape.isHole === true ||
    shape.negative === true ||
    shape.positive === false ||
    holeOp === "subtract" ||
    holeOp === "hole" ||
    holeOp === "difference"
  );
  const ox = Number(shape.x ?? 0);
  const oy = Number(shape.y ?? 0);

  const rotationDeg = Number(shape.rotation ?? shape.angle ?? shape.direction ?? 0);
  const rotation = Number.isFinite(rotationDeg) ? (rotationDeg * Math.PI / 180) : 0;

  if (type === "rectangle" || type === "rect") {
    const w = Number(shape.width ?? shape.w);
    const h = Number(shape.height ?? shape.h);
    if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) return null;
    const center = { x: ox + w * 0.5, y: oy + h * 0.5 };
    const points = [
      { x: ox, y: oy },
      { x: ox + w, y: oy },
      { x: ox + w, y: oy + h },
      { x: ox, y: oy + h }
    ].map((p) => _rotateAround(p, center, rotation));
    return _buildPolygonShapeFromPoints(points, {
      id: `shape-${index}`,
      isHole
    });
  }

  if (type === "ellipse" || type === "circle") {
    // Foundry region data may store ellipses either as:
    // 1) center + radii: {x,y,radiusX,radiusY}
    // 2) top-left + width/height: {x,y,width,height}
    // Support both so imported/generated regions (e.g. CPR) work reliably.
    const radiusX = Number(shape.radiusX ?? shape.rx);
    const radiusY = Number(shape.radiusY ?? shape.ry);
    const uniformRadius = Number(shape.radius ?? shape.r);
    const hasExplicitRadii =
      Number.isFinite(radiusX) && radiusX > 0 &&
      Number.isFinite(radiusY) && radiusY > 0;
    const hasUniformRadius = Number.isFinite(uniformRadius) && uniformRadius > 0;

    let cx;
    let cy;
    let rx;
    let ry;

    if (hasExplicitRadii || hasUniformRadius) {
      // Radius-based format uses center coordinates.
      const centerX = Number(shape.cx ?? shape.centerX ?? shape.x);
      const centerY = Number(shape.cy ?? shape.centerY ?? shape.y);
      if (!(Number.isFinite(centerX) && Number.isFinite(centerY))) return null;
      cx = centerX;
      cy = centerY;
      rx = hasExplicitRadii ? radiusX : uniformRadius;
      ry = hasExplicitRadii ? radiusY : uniformRadius;
    } else {
      // Width/height format is top-left anchored.
      const w = Number(shape.width ?? shape.w);
      const h = Number(shape.height ?? shape.h);
      if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) return null;
      cx = ox + w * 0.5;
      cy = oy + h * 0.5;
      rx = w * 0.5;
      ry = h * 0.5;
    }

    if (!(Number.isFinite(rx) && rx > 0 && Number.isFinite(ry) && ry > 0)) return null;
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const dx = Math.sqrt((rx * c) * (rx * c) + (ry * s) * (ry * s));
    const dy = Math.sqrt((rx * s) * (rx * s) + (ry * c) * (ry * c));
    const bounds = {
      minX: cx - dx,
      minY: cy - dy,
      maxX: cx + dx,
      maxY: cy + dy
    };
    return {
      id: `shape-${index}`,
      kind: "ellipse",
      isHole,
      bounds,
      center: { x: cx, y: cy },
      width: Math.max(2, bounds.maxX - bounds.minX),
      height: Math.max(2, bounds.maxY - bounds.minY),
      localMask: {
        type: "ellipse",
        cx: cx - bounds.minX,
        cy: cy - bounds.minY,
        rx,
        ry,
        rotation
      }
    };
  }

  const rawPoints = _normalizePointArray(shape.points ?? shape.vertices ?? shape.polygon ?? shape.path);
  if (rawPoints.length >= 3) {
    const points = rawPoints.map((p) => ({ x: p.x + ox, y: p.y + oy }));
    return _buildPolygonShapeFromPoints(points, {
      id: `shape-${index}`,
      isHole
    });
  }

  return null;
}

function _extractRegionShapesFromPolygonTree(region) {
  const tree = region?.document?.polygonTree ?? region?.polygonTree ?? null;
  if (!tree) return [];
  const extracted = [];
  let index = 0;

  const pushNodePolygon = (node) => {
    if (!node) return;
    const points = _normalizePointArray(node?.points ?? node?.polygon?.points ?? []);
    if (points.length < 3) return;
    const shape = _buildPolygonShapeFromPoints(points, {
      id: `tree-shape-${index}`,
      isHole: node?.isHole === true
    });
    if (shape) {
      extracted.push(shape);
      index += 1;
    }
  };

  const walk = (node) => {
    if (!node) return;
    pushNodePolygon(node);
    const children = Array.isArray(node?.children) ? node.children : [];
    for (const child of children) walk(child);
  };

  const rootChildren = Array.isArray(tree?.children) ? tree.children : [];
  if (rootChildren.length) {
    for (const child of rootChildren) walk(child);
  } else {
    walk(tree);
  }
  return extracted;
}

const REGION_BASE_SHAPE_TYPES = new Set([
  "rectangle",
  "rect",
  "circle",
  "ellipse",
  "polygon",
]);

function _hasUnsupportedRegionShapeTypes(shapes) {
  const list = Array.isArray(shapes) ? shapes : [];
  for (const rawShape of list) {
    const type = String(
      rawShape?.type ??
      rawShape?.shape ??
      rawShape?.kind ??
      "",
    ).toLowerCase().trim();
    if (!type) continue;
    if (!REGION_BASE_SHAPE_TYPES.has(type)) return true;
  }
  return false;
}

function _collectRegionHoleNodes(region) {
  const tree = region?.document?.polygonTree ?? region?.polygonTree ?? null;
  if (!tree) return [];
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.isHole === true && typeof node.testPoint === "function") out.push(node);
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) walk(child);
  };
  walk(tree);
  return out;
}

function _sampleShapeInteriorPoints(shape) {
  const b = shape?.bounds;
  if (!b) return [];
  const cx = (b.minX + b.maxX) * 0.5;
  const cy = (b.minY + b.maxY) * 0.5;
  const qx = (b.maxX - b.minX) * 0.25;
  const qy = (b.maxY - b.minY) * 0.25;
  return [
    { x: cx, y: cy },
    { x: cx + qx, y: cy },
    { x: cx - qx, y: cy },
    { x: cx, y: cy + qy },
    { x: cx, y: cy - qy }
  ];
}

function inferRegionShapeHolesFromTree(region, shapes) {
  const list = Array.isArray(shapes) ? shapes : [];
  const holeNodes = _collectRegionHoleNodes(region);
  if (!holeNodes.length) return list;

  for (const shape of list) {
    if (shape?.isHole === true) continue;
    const samples = _sampleShapeInteriorPoints(shape);
    if (!samples.length) continue;
    let hit = 0;
    for (const pt of samples) {
      const inside = holeNodes.some((node) => {
        try {
          return node.testPoint(pt);
        } catch (_err) {
          return false;
        }
      });
      if (inside) hit += 1;
    }
    if (hit >= Math.ceil(samples.length * 0.6)) {
      shape.isHole = true;
    }
  }
  return list;
}

export function extractRegionShapes(region) {
  const doc = region?.document ?? region;
  const shapes = Array.isArray(doc?.shapes) ? doc.shapes : [];
  const extracted = shapes
    .map((shape, index) => _extractRegionShape(shape, index))
    .filter((shape) => !!shape && Number.isFinite(shape.width) && Number.isFinite(shape.height));
  const hasUnsupportedTypes = _hasUnsupportedRegionShapeTypes(shapes);
  const partialExtraction = shapes.length > 0 && extracted.length < shapes.length;
  const shouldUseTreeFallback = hasUnsupportedTypes || partialExtraction || extracted.length === 0;

  if (shouldUseTreeFallback) {
    const fromTree = _extractRegionShapesFromPolygonTree(region)
      .filter((shape) => !!shape && Number.isFinite(shape.width) && Number.isFinite(shape.height));
    if (fromTree.length > 0) return fromTree;
  }

  return inferRegionShapeHolesFromTree(region, extracted);
}

export function computeRegionBounds(shapes) {
  if (!Array.isArray(shapes) || !shapes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    const bounds = shape.bounds;
    if (!bounds) continue;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(2, maxX - minX),
    height: Math.max(2, maxY - minY),
    center: { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 }
  };
}

function areShapeBoundsContiguous(a, b, epsilon = 0.5) {
  const ax = a?.bounds;
  const bx = b?.bounds;
  if (!ax || !bx) return false;
  const dx = Math.max(0, Math.max(ax.minX - bx.maxX, bx.minX - ax.maxX));
  const dy = Math.max(0, Math.max(ax.minY - bx.maxY, bx.minY - ax.maxY));
  return dx <= epsilon && dy <= epsilon;
}

function _groupContiguousRegionShapesByBounds(shapes, epsilon = 0.5) {
  const list = Array.isArray(shapes) ? shapes : [];
  const n = list.length;
  if (!n) return [];

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (areShapeBoundsContiguous(list[i], list[j], epsilon)) unite(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(list[i]);
  }
  return [...groups.values()];
}

function _normalizeBoundsRect(boundsLike) {
  if (!boundsLike) return null;
  if (Number.isFinite(boundsLike.minX) && Number.isFinite(boundsLike.maxX) &&
      Number.isFinite(boundsLike.minY) && Number.isFinite(boundsLike.maxY)) {
    return {
      minX: Number(boundsLike.minX),
      minY: Number(boundsLike.minY),
      maxX: Number(boundsLike.maxX),
      maxY: Number(boundsLike.maxY)
    };
  }
  if (Number.isFinite(boundsLike.x) && Number.isFinite(boundsLike.y) &&
      Number.isFinite(boundsLike.width) && Number.isFinite(boundsLike.height)) {
    const x = Number(boundsLike.x);
    const y = Number(boundsLike.y);
    const w = Number(boundsLike.width);
    const h = Number(boundsLike.height);
    return {
      minX: x,
      minY: y,
      maxX: x + w,
      maxY: y + h
    };
  }
  return null;
}

export function groupContiguousRegionShapes(shapes, epsilon = 0.5, region = null) {
  const list = Array.isArray(shapes) ? shapes : [];
  if (!list.length) return [];

  // Prefer Foundry's polygon tree topology when available.
  const tree = region?.document?.polygonTree ?? region?.polygonTree ?? null;
  const rawChildren = Array.isArray(tree?.children) ? tree.children : [];
  const components = rawChildren.filter((node) => node && node.isHole !== true);
  if (components.length) {
    const groups = components.map(() => []);
    const unassigned = [];

    for (const shape of list) {
      const center = shape?.center ?? {
        x: (shape?.bounds?.minX + shape?.bounds?.maxX) * 0.5,
        y: (shape?.bounds?.minY + shape?.bounds?.maxY) * 0.5
      };
      let assigned = false;
      for (let i = 0; i < components.length; i += 1) {
        const comp = components[i];
        try {
          if (typeof comp.testPoint === "function" && comp.testPoint(center)) {
            groups[i].push(shape);
            assigned = true;
            break;
          }
        } catch (_err) {
          // Continue with bounds fallback below.
        }

        const rb = _normalizeBoundsRect(comp?.bounds);
        if (!rb) continue;
        if (center.x >= rb.minX - epsilon && center.x <= rb.maxX + epsilon &&
            center.y >= rb.minY - epsilon && center.y <= rb.maxY + epsilon) {
          groups[i].push(shape);
          assigned = true;
          break;
        }
      }

      if (!assigned) unassigned.push(shape);
    }

    const resolvedGroups = groups.filter((g) => g.length > 0);
    if (unassigned.length) {
      const stillUnassigned = [];
      for (const shape of unassigned) {
        let attached = false;
        for (const group of resolvedGroups) {
          if (group.some((member) => areShapeBoundsContiguous(shape, member, epsilon))) {
            group.push(shape);
            attached = true;
            break;
          }
        }
        if (!attached) stillUnassigned.push(shape);
      }
      if (stillUnassigned.length) {
        resolvedGroups.push(..._groupContiguousRegionShapesByBounds(stillUnassigned, epsilon));
      }
    }
    if (resolvedGroups.length) return resolvedGroups;
  }

  // Fallback when polygon tree is unavailable.
  return _groupContiguousRegionShapesByBounds(list, epsilon);
}

export function createRegionShapeMaskTexture(shape) {
  const width = Math.max(2, Math.ceil(shape?.width ?? 2));
  const height = Math.max(2, Math.ceil(shape?.height ?? 2));
  const localMask = shape?.localMask ?? { type: "polygon", points: [] };

  const canvasEl = document.createElement("canvas");
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,1)";

  if (localMask.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      Number(localMask.cx ?? width * 0.5),
      Number(localMask.cy ?? height * 0.5),
      Math.max(1, Number(localMask.rx ?? width * 0.5)),
      Math.max(1, Number(localMask.ry ?? height * 0.5)),
      Number(localMask.rotation ?? 0),
      0,
      Math.PI * 2
    );
    ctx.closePath();
    ctx.fill();
  } else {
    const pts = Array.isArray(localMask.points) ? localMask.points : [];
    if (pts.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, width, height);
    }
  }

  const texture = PIXI.Texture.from(canvasEl);
  if (texture.baseTexture) {
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    texture.baseTexture.update();
  }
  return texture;
}

function _applyRegionRadialMask(ctx, width, height, { useGradientMask = false, radiusPx = null, gradientMaskFadeStart = 0.8 } = {}) {
  if (!ctx) return;
  if (useGradientMask !== true) return;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const requestedRadius = Number(radiusPx);
  const defaultRadius = Math.max(1, Math.min(width, height) * 0.5);
  const radius = (Number.isFinite(requestedRadius) && requestedRadius > 0)
    ? requestedRadius
    : defaultRadius;
  ctx.globalCompositeOperation = "destination-in";
  const fadeStart = Math.max(0, Math.min(0.999, Number(gradientMaskFadeStart) || 0.8));
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(fadeStart, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}
export function createRegionCompositeMaskTexture(shapes, regionBounds, { useGradientMask = false, radiusPx = null, gradientMaskFadeStart = 0.8 } = {}) {
  const width = Math.max(2, Math.ceil(regionBounds?.width ?? 2));
  const height = Math.max(2, Math.ceil(regionBounds?.height ?? 2));
  const oxRegion = Number(regionBounds?.minX ?? 0);
  const oyRegion = Number(regionBounds?.minY ?? 0);

  const canvasEl = document.createElement("canvas");
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,1)";

  const solids = [];
  const holes = [];
  for (const shape of (shapes ?? [])) {
    if (shape?.isHole === true) holes.push(shape);
    else solids.push(shape);
  }

  const drawShape = (shape, composite = "source-over") => {
    const localMask = shape?.localMask ?? { type: "polygon", points: [] };
    const shapeOffsetX = Number(shape?.bounds?.minX ?? 0) - oxRegion;
    const shapeOffsetY = Number(shape?.bounds?.minY ?? 0) - oyRegion;
    ctx.globalCompositeOperation = composite;

    if (localMask.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(
        shapeOffsetX + Number(localMask.cx ?? 0),
        shapeOffsetY + Number(localMask.cy ?? 0),
        Math.max(1, Number(localMask.rx ?? 1)),
        Math.max(1, Number(localMask.ry ?? 1)),
        Number(localMask.rotation ?? 0),
        0,
        Math.PI * 2
      );
      ctx.closePath();
      ctx.fill();
      return;
    }

    const pts = Array.isArray(localMask.points) ? localMask.points : [];
    if (pts.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(shapeOffsetX + pts[0].x, shapeOffsetY + pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(shapeOffsetX + pts[i].x, shapeOffsetY + pts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
  };

  for (const shape of solids) drawShape(shape, "source-over");
  for (const shape of holes) drawShape(shape, "destination-out");
  _applyRegionRadialMask(ctx, width, height, { useGradientMask, radiusPx, gradientMaskFadeStart });
  ctx.globalCompositeOperation = "source-over";

  const texture = PIXI.Texture.from(canvasEl);
  if (texture.baseTexture) {
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    texture.baseTexture.update();
  }
  return texture;
}

export function getRegionSolidComponents(region) {
  const tree = region?.document?.polygonTree ?? region?.polygonTree ?? null;
  const children = Array.isArray(tree?.children) ? tree.children : [];
  return children.filter((node) => node && node.isHole !== true);
}

export function getRegionComponentBounds(component) {
  const rb = _normalizeBoundsRect(component?.bounds);
  if (!rb) return null;
  const width = Math.max(2, rb.maxX - rb.minX);
  const height = Math.max(2, rb.maxY - rb.minY);
  return {
    minX: rb.minX,
    minY: rb.minY,
    maxX: rb.maxX,
    maxY: rb.maxY,
    width,
    height,
    center: { x: (rb.minX + rb.maxX) * 0.5, y: (rb.minY + rb.maxY) * 0.5 }
  };
}

function _getRegionTreeNodePoints(node) {
  const raw = node?.points ?? node?.polygon?.points ?? [];
  return _normalizePointArray(raw);
}

export function createRegionComponentMaskTexture(component, componentBounds, { useGradientMask = false, radiusPx = null, gradientMaskFadeStart = 0.8 } = {}) {
  const width = Math.max(2, Math.ceil(componentBounds?.width ?? 2));
  const height = Math.max(2, Math.ceil(componentBounds?.height ?? 2));
  const ox = Number(componentBounds?.minX ?? 0);
  const oy = Number(componentBounds?.minY ?? 0);

  const canvasEl = document.createElement("canvas");
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,1)";

  const drawNode = (node) => {
    if (!node) return;
    const points = _getRegionTreeNodePoints(node);
    if (points.length >= 3) {
      ctx.globalCompositeOperation = node.isHole === true ? "destination-out" : "source-over";
      ctx.beginPath();
      ctx.moveTo(points[0].x - ox, points[0].y - oy);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x - ox, points[i].y - oy);
      }
      ctx.closePath();
      ctx.fill();
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) drawNode(child);
  };

  drawNode(component);
  _applyRegionRadialMask(ctx, width, height, { useGradientMask, radiusPx, gradientMaskFadeStart });
  ctx.globalCompositeOperation = "source-over";

  const texture = PIXI.Texture.from(canvasEl);
  if (texture.baseTexture) {
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    texture.baseTexture.update();
  }
  return texture;
}

export function applyAspectRatioScale(scaleX, scaleY, width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  // Symmetric compensation so normalized-UV shaders do not stretch on non-square bounds.
  // Note: X/Y factors are oriented to match region UV usage where wider regions
  // need smaller X scale and larger Y scale to preserve circular patterns.
  const xFactor = Math.sqrt(h / w);
  const yFactor = Math.sqrt(w / h);
  return {
    scaleX: Math.max(0.0001, scaleX * xFactor),
    scaleY: Math.max(0.0001, scaleY * yFactor)
  };
}


