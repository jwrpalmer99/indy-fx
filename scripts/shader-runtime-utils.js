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

function runtimeDebugLog(message, payload = undefined) {
  if (!isRuntimeDebugEnabled()) return;
  if (payload === undefined) console.debug(`${RUNTIME_DEBUG_MODULE_ID} | ${message}`);
  else console.debug(`${RUNTIME_DEBUG_MODULE_ID} | ${message}`, payload);
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
    if (raw === "baseEffects") return "belowTokens";
    if (raw === "belowTiles") return "belowTokens";
    if (raw === "effects") return "belowTokens";
    if (raw === "interface") return "interfacePrimary";
    if (raw === "drawingsLayer") return "drawings";
    return raw;
  };

  const layerName = normalizeLayerName(layerNameRaw);

  const interfaceLayer = canvas?.interface?.primary ?? canvas?.interface;

  const worldLayer = (layerName === "belowTokens")
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
  const sceneCaptureByResolution = new Map();
  const resolvedCaptureResolutionScale =
    normalizeCaptureResolutionScale(captureResolutionScale);

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
    const [baseWidth, baseHeight] = getBaseCaptureResolution(runtimeChannel, channelIndex);
    const captureWidth = Math.max(
      16,
      Math.round(baseWidth * resolvedCaptureResolutionScale),
    );
    const captureHeight = Math.max(
      16,
      Math.round(baseHeight * resolvedCaptureResolutionScale),
    );
    const captureKey = `${captureWidth}x${captureHeight}`;

    let wasCreated = false;
    let capture = sceneCaptureByResolution.get(captureKey);
    if (!capture) {
      capture = new SceneAreaChannel(captureWidth, captureHeight, {
        sourceContainer: captureSourceContainer
      });
      sceneCaptureByResolution.set(captureKey, capture);
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

export function updateShaderTimeUniforms(shader, dt, speed, timeTicks) {
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








