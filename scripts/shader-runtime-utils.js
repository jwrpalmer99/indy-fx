import { SceneAreaChannel } from "./shaders/scene-channel.js";
import { createShapeMaskTexture } from "./shaders/mask-shapes.js";

const RUNTIME_DEBUG_MODULE_ID = "indy-fx";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value ?? 0)));
}

function normalizeCaptureResolutionScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1.0;
  return Math.max(0.25, Math.min(1.0, n));
}

function isRuntimeDebugEnabled() {
  try {
    return game?.settings?.get?.(RUNTIME_DEBUG_MODULE_ID, "shaderDebug") === true;
  } catch (_err) {
    return false;
  }
}

function formatDebugTimestamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function runtimeDebugLog(message, payload = undefined) {
  if (!isRuntimeDebugEnabled()) return;
  const prefix = `[${formatDebugTimestamp()}] ${RUNTIME_DEBUG_MODULE_ID} | ${message}`;
  if (payload === undefined) console.debug(prefix);
  else console.debug(prefix, payload);
}

const SHADER_MOUSE_STATE = {
  listenersBound: false,
  clientX: Number.NaN,
  clientY: Number.NaN,
  downClientX: Number.NaN,
  downClientY: Number.NaN,
  hasDownPosition: false,
  isDown: false,
};

function updateTrackedPointerPosition(event) {
  const clientX = Number(event?.clientX);
  const clientY = Number(event?.clientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  SHADER_MOUSE_STATE.clientX = clientX;
  SHADER_MOUSE_STATE.clientY = clientY;
  return true;
}

function ensureShaderMouseListeners() {
  if (SHADER_MOUSE_STATE.listenersBound) return;
  if (typeof window === "undefined" || !window?.addEventListener) return;

  const onPointerMove = (event) => {
    updateTrackedPointerPosition(event);
  };
  const onPointerDown = (event) => {
    const button = Number(event?.button ?? 0);
    if (Number.isFinite(button) && button !== 0) return;
    if (updateTrackedPointerPosition(event)) {
      SHADER_MOUSE_STATE.downClientX = SHADER_MOUSE_STATE.clientX;
      SHADER_MOUSE_STATE.downClientY = SHADER_MOUSE_STATE.clientY;
      SHADER_MOUSE_STATE.hasDownPosition = true;
    }
    SHADER_MOUSE_STATE.isDown = true;
  };
  const onPointerUp = (event) => {
    const button = Number(event?.button ?? 0);
    if (Number.isFinite(button) && button !== 0) return;
    updateTrackedPointerPosition(event);
    SHADER_MOUSE_STATE.isDown = false;
  };
  const onBlur = () => {
    SHADER_MOUSE_STATE.isDown = false;
  };

  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("blur", onBlur, true);
  SHADER_MOUSE_STATE.listenersBound = true;
}

function getRendererGlobalPointFromClient(clientX, clientY) {
  const x = Number(clientX);
  const y = Number(clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  // Prefer Foundry's world mapping to stay accurate across pan/zoom/camera transforms.
  const worldFromClient = canvas?.canvasCoordinatesFromClient?.({ x, y });
  const worldX = Number(worldFromClient?.x);
  const worldY = Number(worldFromClient?.y);
  if (
    Number.isFinite(worldX) &&
    Number.isFinite(worldY) &&
    canvas?.stage?.toGlobal
  ) {
    try {
      const global = canvas.stage.toGlobal(new PIXI.Point(worldX, worldY));
      if (Number.isFinite(global?.x) && Number.isFinite(global?.y)) {
        return new PIXI.Point(global.x, global.y);
      }
    } catch (_err) {
      // Fall through to renderer-space mapping.
    }
  }

  const renderer = canvas?.app?.renderer;
  const view = renderer?.view ?? canvas?.app?.view;
  if (!renderer || !view) return null;
  const rect = view.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const gx = (x - rect.left) * (renderer.width / rect.width);
  const gy = (y - rect.top) * (renderer.height / rect.height);
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return null;
  return new PIXI.Point(gx, gy);
}

function getRendererGlobalPointFromInteraction() {
  const renderer = canvas?.app?.renderer;
  const eventsGlobal = renderer?.events?.pointer?.global;
  const interactionGlobal = renderer?.plugins?.interaction?.mouse?.global;
  const global = eventsGlobal ?? interactionGlobal ?? null;
  const x = Number(global?.x);
  const y = Number(global?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return new PIXI.Point(x, y);
}

function resolveShaderResolution(uniforms, fallback = [1, 1]) {
  const source =
    Array.isArray(uniforms?.iResolution) && uniforms.iResolution.length >= 2
      ? uniforms.iResolution
      : Array.isArray(uniforms?.resolution) && uniforms.resolution.length >= 2
      ? uniforms.resolution
      : fallback;
  const w = Math.max(1, Number(source?.[0]) || Number(fallback?.[0]) || 1);
  const h = Math.max(1, Number(source?.[1]) || Number(fallback?.[1]) || 1);
  return [w, h];
}

function resolveSceneUvRect() {
  const dims = canvas?.dimensions ?? canvas?.scene?.dimensions ?? {};
  const rect = dims?.sceneRect ?? dims?.rect ?? null;
  const x = Number(rect?.x ?? dims?.sceneX ?? dims?.x ?? 0);
  const y = Number(rect?.y ?? dims?.sceneY ?? dims?.y ?? 0);
  const width = Number(rect?.width ?? dims?.sceneWidth ?? dims?.width ?? 0);
  const height = Number(rect?.height ?? dims?.sceneHeight ?? dims?.height ?? 0);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width,
    height,
  };
}

function toSceneUvFromWorldPoint(worldPoint, sceneRect) {
  if (!sceneRect) return null;
  const wx = Number(worldPoint?.x);
  const wy = Number(worldPoint?.y);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  return [
    (wx - sceneRect.x) / Math.max(1e-6, sceneRect.width),
    1.0 - ((wy - sceneRect.y) / Math.max(1e-6, sceneRect.height)),
  ];
}

function findCachedContainerAncestor(displayObject) {
  let current = displayObject?.parent ?? null;
  while (current) {
    if (current === canvas?.primary) return current;
    if (current?.renderTexture && current?.sprite) return current;
    current = current.parent ?? null;
  }
  return null;
}

function transformPointToAncestorLocal(displayObject, localPoint, ancestor) {
  if (!displayObject || !ancestor) return null;
  let x = Number(localPoint?.x);
  let y = Number(localPoint?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  let current = displayObject;
  while (current && current !== ancestor) {
    current.transform?.updateLocalTransform?.();
    const matrix = current.localTransform ?? current.transform?.localTransform ?? null;
    if (!matrix) return null;
    const nextX = matrix.a * x + matrix.c * y + matrix.tx;
    const nextY = matrix.b * x + matrix.d * y + matrix.ty;
    x = nextX;
    y = nextY;
    current = current.parent ?? null;
  }

  if (current !== ancestor) return null;
  return new PIXI.Point(x, y);
}

function resolveSceneWorldPointFromDisplayLocal(displayObject, localPoint) {
  if (!displayObject || !canvas?.stage?.toLocal) return null;

  const cachedAncestor = findCachedContainerAncestor(displayObject);
  if (cachedAncestor?.sprite?.worldTransform) {
    const cachedLocal = transformPointToAncestorLocal(displayObject, localPoint, cachedAncestor);
    if (cachedLocal) {
      const matrix = cachedAncestor.sprite.worldTransform;
      const globalPoint = new PIXI.Point(
        matrix.a * cachedLocal.x + matrix.c * cachedLocal.y + matrix.tx,
        matrix.b * cachedLocal.x + matrix.d * cachedLocal.y + matrix.ty,
      );
      try {
        const worldPoint = canvas.stage.toLocal(globalPoint);
        const wx = Number(worldPoint?.x);
        const wy = Number(worldPoint?.y);
        if (Number.isFinite(wx) && Number.isFinite(wy)) {
          return new PIXI.Point(wx, wy);
        }
      } catch (_err) {
        // Fall through to direct display-object mapping below.
      }
    }
  }

  if (!displayObject?.toGlobal) return null;
  try {
    const globalPoint = displayObject.toGlobal(new PIXI.Point(localPoint.x, localPoint.y));
    const worldPoint = canvas.stage.toLocal(globalPoint);
    const wx = Number(worldPoint?.x);
    const wy = Number(worldPoint?.y);
    if (Number.isFinite(wx) && Number.isFinite(wy)) {
      return new PIXI.Point(wx, wy);
    }
  } catch (_err) {
    // Give up and let caller fall back.
  }

  return null;
}

function tryResolveSceneUvTransformFromMeshGeometry(mouseTarget, sceneRect) {
  if (!mouseTarget?.geometry?.getBuffer || !mouseTarget?.toGlobal || !canvas?.stage?.toLocal) {
    return null;
  }

  try {
    const posBuffer =
      mouseTarget.geometry.getBuffer("aVertexPosition") ??
      mouseTarget.geometry.getBuffer("aPosition");
    const uvBuffer =
      mouseTarget.geometry.getBuffer("aTextureCoord") ??
      mouseTarget.geometry.getBuffer("aUV");
    const positions = posBuffer?.data;
    const uvs = uvBuffer?.data;
    if (!positions || !uvs) return null;

    const vertexCount = Math.min(
      Math.floor(positions.length / 2),
      Math.floor(uvs.length / 2),
    );
    if (vertexCount < 3) return null;

    const points = [];
    for (let i = 0; i < vertexCount; i += 1) {
      const px = Number(positions[i * 2]);
      const py = Number(positions[i * 2 + 1]);
      const u = Number(uvs[i * 2]);
      const v = Number(uvs[i * 2 + 1]);
      if (![px, py, u, v].every(Number.isFinite)) continue;
      const worldPoint = resolveSceneWorldPointFromDisplayLocal(
        mouseTarget,
        new PIXI.Point(px, py),
      );
      const sceneUv = toSceneUvFromWorldPoint(worldPoint, sceneRect);
      if (!sceneUv) continue;
      points.push({
        localUv: [u, v],
        sceneUv,
      });
    }

    if (points.length < 3) return null;

    for (let i = 0; i < points.length - 2; i += 1) {
      const p0 = points[i];
      for (let j = i + 1; j < points.length - 1; j += 1) {
        const p1 = points[j];
        for (let k = j + 1; k < points.length; k += 1) {
          const p2 = points[k];
          const du1x = p1.localUv[0] - p0.localUv[0];
          const du1y = p1.localUv[1] - p0.localUv[1];
          const du2x = p2.localUv[0] - p0.localUv[0];
          const du2y = p2.localUv[1] - p0.localUv[1];
          const det = du1x * du2y - du1y * du2x;
          if (!Number.isFinite(det) || Math.abs(det) <= 1e-6) continue;

          const invDet = 1 / det;
          const ds1x = p1.sceneUv[0] - p0.sceneUv[0];
          const ds1y = p1.sceneUv[1] - p0.sceneUv[1];
          const ds2x = p2.sceneUv[0] - p0.sceneUv[0];
          const ds2y = p2.sceneUv[1] - p0.sceneUv[1];

          const axisU = [
            (du2y * ds1x - du1y * ds2x) * invDet,
            (du2y * ds1y - du1y * ds2y) * invDet,
          ];
          const axisV = [
            (-du2x * ds1x + du1x * ds2x) * invDet,
            (-du2x * ds1y + du1x * ds2y) * invDet,
          ];
          const origin = [
            p0.sceneUv[0] - p0.localUv[0] * axisU[0] - p0.localUv[1] * axisV[0],
            p0.sceneUv[1] - p0.localUv[0] * axisU[1] - p0.localUv[1] * axisV[1],
          ];

          if (
            origin.every(Number.isFinite) &&
            axisU.every(Number.isFinite) &&
            axisV.every(Number.isFinite)
          ) {
            return { origin, axisU, axisV };
          }
        }
      }
    }
  } catch (_err) {
    // Fall back to bounds-based mapping below.
  }

  return null;
}

function syncUniformSceneUvTransform(uniforms, origin, axisU, axisV) {
  if (!uniforms || typeof uniforms !== "object") return;
  if ("cpfxSceneUvOrigin" in uniforms) uniforms.cpfxSceneUvOrigin = origin;
  if ("cpfxSceneUvAxisU" in uniforms) uniforms.cpfxSceneUvAxisU = axisU;
  if ("cpfxSceneUvAxisV" in uniforms) uniforms.cpfxSceneUvAxisV = axisV;
}

function syncShaderSceneUvUniforms(shader, { mouseTarget = null, runtimeBuffers = null } = {}) {
  const uniforms = shader?.uniforms;
  if (!uniforms || typeof uniforms !== "object") return;

  let origin = [0, 1];
  let axisU = [1, 0];
  let axisV = [0, -1];

  const sceneRect = resolveSceneUvRect();
  if (
    sceneRect &&
    mouseTarget?.toGlobal &&
    canvas?.stage?.toLocal
  ) {
    const geometryTransform = tryResolveSceneUvTransformFromMeshGeometry(
      mouseTarget,
      sceneRect,
    );
    if (geometryTransform) {
      origin = geometryTransform.origin;
      axisU = geometryTransform.axisU;
      axisV = geometryTransform.axisV;
    } else if (typeof mouseTarget.getLocalBounds === "function") {
      try {
        const bounds = mouseTarget.getLocalBounds();
        const bx = Number(bounds?.x);
        const by = Number(bounds?.y);
        const bw = Number(bounds?.width);
        const bh = Number(bounds?.height);
        if (
          Number.isFinite(bx) &&
          Number.isFinite(by) &&
          Number.isFinite(bw) &&
          bw > 1e-6 &&
          Number.isFinite(bh) &&
          bh > 1e-6
        ) {
          const tlWorld = resolveSceneWorldPointFromDisplayLocal(
            mouseTarget,
            new PIXI.Point(bx, by),
          );
          const trWorld = resolveSceneWorldPointFromDisplayLocal(
            mouseTarget,
            new PIXI.Point(bx + bw, by),
          );
          const blWorld = resolveSceneWorldPointFromDisplayLocal(
            mouseTarget,
            new PIXI.Point(bx, by + bh),
          );

          const tlUv = toSceneUvFromWorldPoint(tlWorld, sceneRect);
          const trUv = toSceneUvFromWorldPoint(trWorld, sceneRect);
          const blUv = toSceneUvFromWorldPoint(blWorld, sceneRect);
          if (tlUv && trUv && blUv) {
            origin = tlUv;
            axisU = [trUv[0] - tlUv[0], trUv[1] - tlUv[1]];
            axisV = [blUv[0] - tlUv[0], blUv[1] - tlUv[1]];
          }
        }
      } catch (_err) {
        // Leave the default local UV mapping in place.
      }
    }
  }

  syncUniformSceneUvTransform(uniforms, origin, axisU, axisV);

  const buffers = Array.isArray(runtimeBuffers) ? runtimeBuffers : [];
  for (const runtimeBuffer of buffers) {
    const bufferUniforms = runtimeBuffer?.mesh?.shader?.uniforms;
    if (!bufferUniforms || typeof bufferUniforms !== "object") continue;
    syncUniformSceneUvTransform(bufferUniforms, origin, axisU, axisV);
  }
}

function applyShaderUvTransformToMouse(u, v, uniforms) {
  let stUvX = Number(u);
  let stUvY = 1 - Number(v);
  if (!Number.isFinite(stUvX)) stUvX = 0;
  if (!Number.isFinite(stUvY)) stUvY = 0;

  if (Number(uniforms?.shaderFlipX) > 0.5) stUvX = 1 - stUvX;
  if (Number(uniforms?.shaderFlipY) > 0.5) stUvY = 1 - stUvY;

  const rotation = Number(uniforms?.shaderRotation);
  const rot = Number.isFinite(rotation) ? rotation : 0;
  const scaleX = Math.max(
    0.0001,
    Number(uniforms?.shaderScaleXY?.[0]) ||
      Number(uniforms?.shaderScale) ||
      1,
  );
  const scaleY = Math.max(
    0.0001,
    Number(uniforms?.shaderScaleXY?.[1]) ||
      Number(uniforms?.shaderScale) ||
      1,
  );

  const dx = stUvX - 0.5;
  const dy = stUvY - 0.5;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const rx = c * dx - s * dy;
  const ry = s * dx + c * dy;

  return [
    (rx / scaleX) + 0.5,
    (ry / scaleY) + 0.5,
  ];
}

function shaderMouseCoordsFromGlobal(globalPoint, mouseTarget, uniforms, resolution) {
  const [resX, resY] = resolveShaderResolution(
    { resolution },
    [1, 1],
  );
  const renderer = canvas?.app?.renderer;
  const defaultU =
    renderer && renderer.width > 0
      ? Number(globalPoint?.x) / Number(renderer.width)
      : 0;
  const defaultV =
    renderer && renderer.height > 0
      ? Number(globalPoint?.y) / Number(renderer.height)
      : 0;
  let u = defaultU;
  let v = defaultV;

  if (mouseTarget?.toLocal && typeof mouseTarget.getLocalBounds === "function") {
    try {
      const local = mouseTarget.toLocal(globalPoint);
      const bounds = mouseTarget.getLocalBounds();
      const bw = Number(bounds?.width);
      const bh = Number(bounds?.height);
      if (
        Number.isFinite(local?.x) &&
        Number.isFinite(local?.y) &&
        Number.isFinite(bw) &&
        bw > 1e-6 &&
        Number.isFinite(bh) &&
        bh > 1e-6
      ) {
        u = (Number(local.x) - Number(bounds.x)) / bw;
        v = (Number(local.y) - Number(bounds.y)) / bh;
      }
    } catch (_err) {
      // Keep renderer-space fallback.
    }
  }

  const clampedU = clamp01(u);
  const clampedV = clamp01(v);
  const [shaderU, shaderV] = applyShaderUvTransformToMouse(
    clampedU,
    clampedV,
    uniforms,
  );
  return [shaderU * resX, shaderV * resY];
}

function remapShaderToyMouseUniform(mouseUniform, fromResolution, toResolution) {
  const fromW = Math.max(1e-6, Number(fromResolution?.[0]) || 1);
  const fromH = Math.max(1e-6, Number(fromResolution?.[1]) || 1);
  const toW = Math.max(1, Number(toResolution?.[0]) || 1);
  const toH = Math.max(1, Number(toResolution?.[1]) || 1);
  const mx = Number(mouseUniform?.[0]) || 0;
  const my = Number(mouseUniform?.[1]) || 0;
  const mz = Number(mouseUniform?.[2]) || 0;
  const mw = Number(mouseUniform?.[3]) || 0;
  const sign = (mz < 0 || mw < 0) ? -1 : 1;
  return [
    (mx / fromW) * toW,
    (my / fromH) * toH,
    sign * (Math.abs(mz) / fromW) * toW,
    sign * (Math.abs(mw) / fromH) * toH,
  ];
}

function buildShaderToyMouseUniform(shader, { mouseTarget = null } = {}) {
  ensureShaderMouseListeners();
  const uniforms = shader?.uniforms;
  const prior = Array.isArray(uniforms?.iMouse)
    ? uniforms.iMouse
    : [0, 0, 0, 0];
  const resolution = resolveShaderResolution(uniforms, [1, 1]);
  const pointerGlobal = Number.isFinite(SHADER_MOUSE_STATE.clientX) && Number.isFinite(SHADER_MOUSE_STATE.clientY)
    ? getRendererGlobalPointFromClient(
      SHADER_MOUSE_STATE.clientX,
      SHADER_MOUSE_STATE.clientY,
    )
    : getRendererGlobalPointFromInteraction();
  if (!pointerGlobal) {
    return [
      Number(prior[0]) || 0,
      Number(prior[1]) || 0,
      Number(prior[2]) || 0,
      Number(prior[3]) || 0,
    ];
  }

  const pointerDownGlobal =
    SHADER_MOUSE_STATE.hasDownPosition &&
    Number.isFinite(SHADER_MOUSE_STATE.downClientX) &&
    Number.isFinite(SHADER_MOUSE_STATE.downClientY)
      ? getRendererGlobalPointFromClient(
        SHADER_MOUSE_STATE.downClientX,
        SHADER_MOUSE_STATE.downClientY,
      )
      : null;

  const [mouseX, mouseY] = shaderMouseCoordsFromGlobal(
    pointerGlobal,
    mouseTarget,
    uniforms,
    resolution,
  );
  let mouseDownX = 0;
  let mouseDownY = 0;
  if (pointerDownGlobal) {
    [mouseDownX, mouseDownY] = shaderMouseCoordsFromGlobal(
      pointerDownGlobal,
      mouseTarget,
      uniforms,
      resolution,
    );
  }
  const sign = SHADER_MOUSE_STATE.isDown ? 1 : -1;
  return [mouseX, mouseY, sign * mouseDownX, sign * mouseDownY];
}

export function syncShaderMouseUniforms(
  shader,
  { mouseTarget = null, runtimeBuffers = null } = {},
) {
  const uniforms = shader?.uniforms;
  if (!uniforms || typeof uniforms !== "object") return [0, 0, 0, 0];
  const buffers = Array.isArray(runtimeBuffers) ? runtimeBuffers : [];
  const rootWantsMouse = Object.prototype.hasOwnProperty.call(uniforms, "iMouse");
  const buffersWantMouse = buffers.some((runtimeBuffer) =>
    Object.prototype.hasOwnProperty.call(
      runtimeBuffer?.mesh?.shader?.uniforms ?? {},
      "iMouse",
    ));
  if (!rootWantsMouse && !buffersWantMouse) return [0, 0, 0, 0];
  const mouseUniform = buildShaderToyMouseUniform(shader, { mouseTarget });
  if ("iMouse" in uniforms) {
    uniforms.iMouse = mouseUniform;
  }

  if (buffers.length > 0) {
    const sourceResolution = resolveShaderResolution(uniforms, [1, 1]);
    for (const runtimeBuffer of buffers) {
      const bufferUniforms = runtimeBuffer?.mesh?.shader?.uniforms;
      if (!bufferUniforms || !("iMouse" in bufferUniforms)) continue;
      const bufferResolution = resolveShaderResolution(
        bufferUniforms,
        sourceResolution,
      );
      bufferUniforms.iMouse = remapShaderToyMouseUniform(
        mouseUniform,
        sourceResolution,
        bufferResolution,
      );
    }
  }
  return mouseUniform;
}

export function resolveShaderWorldLayer(moduleId, cfg, { allowTokenLayer = false, tokenTarget = null } = {}) {
  const shaderLayerSetting = cfg.layer ?? game.settings.get(moduleId, "shaderLayer") ?? "inherit";
  const layerNameRaw = shaderLayerSetting === "inherit"
    ? (game.settings.get(moduleId, "layer") ?? "interfacePrimary")
    : shaderLayerSetting;

  const normalizeLayerName = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "interfacePrimary";
    if (raw === "token") return "interfacePrimary";
    if (raw === "sceneCaptureRaw" || raw === "primary") return "sceneRaw";
    if (raw === "sceneRaw") return "sceneRaw";
    if (raw === "baseEffects") return "belowTokens";
    if (raw === "belowTiles") return "belowTiles";
    if (raw === "effects") return "belowTokens";
    if (raw === "interface") return "interfacePrimary";
    if (raw === "drawingsLayer") return "drawings";
    return raw;
  };

  const layerName = normalizeLayerName(layerNameRaw);

  const interfaceLayer = canvas?.interface?.primary ?? canvas?.interface;
  const primaryGroup = canvas?.primary ?? canvas?.tiles?.parent ?? interfaceLayer;
  const sceneRawLayer = canvas?.primary?.sprite ?? primaryGroup;

  const worldLayer = (layerName === "belowTiles")
    ? primaryGroup
    : (layerName === "sceneRaw")
    ? sceneRawLayer
    : (layerName === "belowTokens")
    ? interfaceLayer
    : (layerName === "drawings")
      ? canvas.drawings
      : interfaceLayer;

  if (worldLayer?.sortableChildren !== undefined) worldLayer.sortableChildren = true;
  return worldLayer;
}

export function buildDirectionalMaskTexture({
  shape,
  radiusPx,
  shapeDistancePx,
  lineWidthPx,
  shapeDirectionDeg,
  coneAngleDeg,
  rectangleFromDirectionDistance = false,
}) {
  let effectExtent = radiusPx;
  let customMaskTexture = null;

  if (shape === "circle") {
    effectExtent = Math.max(1, shapeDistancePx);
  } else if (shape === "cone") {
    effectExtent = Math.max(1, shapeDistancePx);
    customMaskTexture = createShapeMaskTexture({
      type: "cone",
      extentPx: effectExtent,
      distancePx: shapeDistancePx,
      directionDeg: shapeDirectionDeg,
      coneAngleDeg
    });
  } else if (shape === "line") {
    effectExtent = Math.max(1, shapeDistancePx, lineWidthPx * 0.5);
    customMaskTexture = createShapeMaskTexture({
      type: "line",
      extentPx: effectExtent,
      distancePx: shapeDistancePx,
      lineWidthPx,
      directionDeg: shapeDirectionDeg
    });
  } else if (shape === "rectangle") {
    if (rectangleFromDirectionDistance) {
      // Keep template "distance" at full scale in mask space; using abs(dx/dy)
      // here shrinks rectangle sides at non-45 angles.
      effectExtent = Math.max(1, shapeDistancePx);
      customMaskTexture = createShapeMaskTexture({
        type: "rectangleRay",
        extentPx: effectExtent,
        distancePx: shapeDistancePx,
        directionDeg: shapeDirectionDeg,
      });
    } else {
      effectExtent = Math.max(
        1,
        shapeDistancePx,
        lineWidthPx,
        Math.hypot(shapeDistancePx, lineWidthPx),
      );
      customMaskTexture = createShapeMaskTexture({
        type: "rectangle",
        extentPx: effectExtent,
        distancePx: shapeDistancePx,
        lineWidthPx,
        directionDeg: shapeDirectionDeg
      });
    }
  }

  return { effectExtent, customMaskTexture };
}

export function createQuadGeometry(halfWidth, halfHeight) {
  const verts = new Float32Array([
    -halfWidth, -halfHeight,
    halfWidth, -halfHeight,
    halfWidth, halfHeight,
    -halfWidth, halfHeight
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", verts, 2)
    .addAttribute("aTextureCoord", uvs, 2)
    .addIndex(indices);
}

export function setupShaderRuntimeChannels(
  shaderResult,
  shader,
  {
    captureSourceContainer = null,
    captureResolutionScale = 1.0,
    debugContext = null,
  } = {},
) {
  const sceneAreaChannels = [];
  const runtimeBufferChannels = [];
  const runtimeImageChannels = [];
  const sceneCaptureByKey = new Map();
  const resolvedCaptureResolutionScale =
    normalizeCaptureResolutionScale(captureResolutionScale);
  const normalizeRuntimeCaptureMode = (mode) =>
    String(mode ?? "").trim() === "sceneCaptureRaw"
      ? "sceneCaptureRaw"
      : "sceneCapture";

  const getBaseCaptureResolution = (runtimeChannel, channelIndex) => {
    const fallbackSize = Math.max(
      16,
      Math.round(Number(runtimeChannel?.size ?? 512) || 512),
    );
    const explicitResolution = Array.isArray(runtimeChannel?.resolution)
      ? runtimeChannel.resolution
      : null;
    const explicitWidth = Number(explicitResolution?.[0]);
    const explicitHeight = Number(explicitResolution?.[1]);
    if (
      Number.isFinite(explicitWidth) &&
      explicitWidth > 0 &&
      Number.isFinite(explicitHeight) &&
      explicitHeight > 0
    ) {
      return [explicitWidth, explicitHeight];
    }

    const uniforms = shader?.uniforms;
    const channelRes = Array.isArray(uniforms?.iChannelResolution)
      ? uniforms.iChannelResolution
      : null;
    if (channelRes && Number.isInteger(channelIndex)) {
      const offset = channelIndex * 3;
      const w = Number(channelRes[offset]);
      const h = Number(channelRes[offset + 1]);
      if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
        return [w, h];
      }
    }

    return [fallbackSize, fallbackSize];
  };

  for (const runtimeChannel of shaderResult.runtimeChannels ?? []) {
    const channelIndex = runtimeChannel?.channel;
    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 3) continue;
    const captureMode = normalizeRuntimeCaptureMode(runtimeChannel?.mode);
    const [baseWidth, baseHeight] = getBaseCaptureResolution(runtimeChannel, channelIndex);
    const captureWidth = Math.max(
      16,
      Math.round(baseWidth * resolvedCaptureResolutionScale),
    );
    const captureHeight = Math.max(
      16,
      Math.round(baseHeight * resolvedCaptureResolutionScale),
    );
    const captureKey = `${captureMode}:${captureWidth}x${captureHeight}`;

    let wasCreated = false;
    let capture = sceneCaptureByKey.get(captureKey);
    if (!capture) {
      capture = new SceneAreaChannel(captureWidth, captureHeight, {
        captureMode,
        sourceContainer: captureSourceContainer
      });
      sceneCaptureByKey.set(captureKey, capture);
      sceneAreaChannels.push(capture);
      wasCreated = true;
    }

    if (runtimeChannel?.runtimeBuffer && typeof runtimeChannel.runtimeBuffer.setChannel === "function") {
      runtimeChannel.runtimeBuffer.setChannel(channelIndex, capture.texture, [captureWidth, captureHeight]);
    } else {
      const uniformName = `iChannel${channelIndex}`;
      if (!(uniformName in shader.uniforms)) continue;
      shader.uniforms[uniformName] = capture.texture;

      if ("iChannelResolution" in shader.uniforms) {
        const channelRes = Array.from(shader.uniforms.iChannelResolution ?? []);
        while (channelRes.length < 12) channelRes.push(1);
        channelRes[channelIndex * 3] = captureWidth;
        channelRes[channelIndex * 3 + 1] = captureHeight;
        channelRes[channelIndex * 3 + 2] = 1;
        shader.uniforms.iChannelResolution = channelRes;
      }
    }

    runtimeDebugLog("runtime scene capture channel configured", {
      targetType: debugContext?.targetType ?? null,
      targetId: debugContext?.targetId ?? null,
      shaderId: debugContext?.shaderId ?? shaderResult?.shaderId ?? null,
      channel: channelIndex,
      captureMode,
      captureResolutionScale: resolvedCaptureResolutionScale,
      baseResolution: [baseWidth, baseHeight],
      captureResolution: [captureWidth, captureHeight],
      reusedCapture: !wasCreated,
      sharedCaptureKey: captureKey,
      captureCount: sceneAreaChannels.length,
      boundToRuntimeBuffer:
        !!(runtimeChannel?.runtimeBuffer && typeof runtimeChannel.runtimeBuffer.setChannel === "function"),
    });
  }

  for (const runtimeBufferChannel of shaderResult.runtimeBufferChannels ?? []) {
    const runtimeBuffer = runtimeBufferChannel?.runtimeBuffer;
    if (!runtimeBuffer || typeof runtimeBuffer.update !== "function") continue;
    runtimeBufferChannels.push(runtimeBuffer);
  }

  for (const runtimeImageChannel of shaderResult.runtimeImageChannels ?? []) {
    if (!runtimeImageChannel || typeof runtimeImageChannel.destroy !== "function") continue;
    runtimeImageChannels.push(runtimeImageChannel);
  }

  return { sceneAreaChannels, runtimeBufferChannels, runtimeImageChannels };
}

export function createFadeAlphaComputer(cfg) {
  const baseAlpha = clamp01(cfg.alpha ?? 1);
  const displayTimeMs = Math.max(0, Number(cfg.displayTimeMs ?? 0));
  const easeInMs = Math.max(0, Number(cfg.easeInMs ?? 0));
  const easeOutMs = Math.max(0, Number(cfg.easeOutMs ?? 0));

  const computeFadeAlpha = (ms) => {
    let fade = 1.0;
    if (easeInMs > 0) fade = Math.min(fade, clamp01(ms / easeInMs));
    if (displayTimeMs > 0 && easeOutMs > 0) {
      const remaining = Math.max(0, displayTimeMs - ms);
      fade = Math.min(fade, clamp01(remaining / easeOutMs));
    }
    return baseAlpha * fade;
  };

  return {
    baseAlpha,
    displayTimeMs,
    easeInMs,
    easeOutMs,
    computeFadeAlpha
  };
}

export function updateShaderTimeUniforms(
  shader,
  dt,
  speed,
  timeTicks,
  { mouseTarget = null, runtimeBuffers = null } = {},
) {
  if (!shader?.uniforms) return;
  syncShaderSceneUvUniforms(shader, { mouseTarget, runtimeBuffers });
  syncShaderMouseUniforms(shader, { mouseTarget, runtimeBuffers });
  const safeDt = Math.max(0, Number(dt) || 0);
  const safeSpeed = Math.max(0, Number(speed) || 0);
  const safeTime = Math.max(0, Number(timeTicks) || 0);
  const shaderDt = safeDt * safeSpeed;
  shader.uniforms.time = safeTime * safeSpeed;
  if ("uTime" in shader.uniforms) shader.uniforms.uTime = shader.uniforms.time;
  if ("iTime" in shader.uniforms) shader.uniforms.iTime = shader.uniforms.time;
  if ("iTimeDelta" in shader.uniforms) shader.uniforms.iTimeDelta = shaderDt;
  if ("iFrame" in shader.uniforms) {
    // Match ShaderToy-style semantics: current frame number is visible during this
    // draw, then the counter advances for the next draw.
    let frame = Number(shader._indyFxFrameCounter);
    if (!Number.isFinite(frame) || frame < 0) {
      frame = Math.max(0, Number(shader.uniforms.iFrame) || 0);
    }
    shader.uniforms.iFrame = frame;
    shader._indyFxFrameCounter = frame + 1;
  }
  if ("iFrameRate" in shader.uniforms) shader.uniforms.iFrameRate = shaderDt > 0 ? (1 / shaderDt) : 60;
  if ("iDate" in shader.uniforms) {
    const now = new Date();
    const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + (now.getMilliseconds() / 1000);
    shader.uniforms.iDate = [now.getFullYear(), now.getMonth() + 1, now.getDate(), seconds];
  }
}

export function destroyShaderRuntimeEntry(entry, { preserveWhiteMask = false } = {}) {
  if (!entry) return;
  for (const capture of (entry.sceneAreaChannels ?? [])) {
    capture.destroy();
  }
  for (const runtimeBuffer of (entry.runtimeBufferChannels ?? [])) {
    runtimeBuffer.destroy?.();
  }
  for (const runtimeImageChannel of (entry.runtimeImageChannels ?? [])) {
    runtimeImageChannel.destroy?.();
  }
  if (entry.customMaskTexture && entry.customMaskTexture !== PIXI.Texture.WHITE) {
    entry.customMaskTexture.destroy(true);
  }
  entry.spriteDebugGfx?.destroy({ children: true });
  entry.debugGfx?.destroy({ children: true });
  entry.container?.destroy({ children: true });
}

export function destroyRegionClusterRuntime(cluster) {
  for (const capture of (cluster?.sceneAreaChannels ?? [])) {
    capture.destroy();
  }
  for (const runtimeBuffer of (cluster?.runtimeBufferChannels ?? [])) {
    runtimeBuffer.destroy?.();
  }
  for (const runtimeImageChannel of (cluster?.runtimeImageChannels ?? [])) {
    runtimeImageChannel.destroy?.();
  }
  cluster?.customMaskTexture?.destroy(true);
}








