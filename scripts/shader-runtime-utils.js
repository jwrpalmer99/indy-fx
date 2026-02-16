import { SceneAreaChannel } from "./shaders/scene-channel.js";
import { createShapeMaskTexture } from "./shaders/mask-shapes.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value ?? 0)));
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
  coneAngleDeg
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
    effectExtent = Math.max(1, shapeDistancePx, lineWidthPx * 0.5);
    customMaskTexture = createShapeMaskTexture({
      type: "rectangle",
      extentPx: effectExtent,
      distancePx: shapeDistancePx,
      lineWidthPx,
      directionDeg: shapeDirectionDeg
    });
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

export function setupShaderRuntimeChannels(shaderResult, shader, { captureSourceContainer = null } = {}) {
  const sceneAreaChannels = [];
  const runtimeBufferChannels = [];
  const runtimeImageChannels = [];
  const sceneCaptureBySize = new Map();

  for (const runtimeChannel of shaderResult.runtimeChannels ?? []) {
    const captureSize = runtimeChannel?.size ?? 512;
    const channelIndex = runtimeChannel?.channel;
    if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex > 3) continue;

    let capture = sceneCaptureBySize.get(captureSize);
    if (!capture) {
      capture = new SceneAreaChannel(captureSize, {
        sourceContainer: captureSourceContainer
      });
      sceneCaptureBySize.set(captureSize, capture);
      sceneAreaChannels.push(capture);
    }

    if (runtimeChannel?.runtimeBuffer && typeof runtimeChannel.runtimeBuffer.setChannel === "function") {
      runtimeChannel.runtimeBuffer.setChannel(channelIndex, capture.texture, [captureSize, captureSize]);
    } else {
      const uniformName = `iChannel${channelIndex}`;
      if (!(uniformName in shader.uniforms)) continue;
      shader.uniforms[uniformName] = capture.texture;

      if ("iChannelResolution" in shader.uniforms) {
        const channelRes = Array.from(shader.uniforms.iChannelResolution ?? []);
        while (channelRes.length < 12) channelRes.push(1);
        channelRes[channelIndex * 3] = captureSize;
        channelRes[channelIndex * 3 + 1] = captureSize;
        channelRes[channelIndex * 3 + 2] = 1;
        shader.uniforms.iChannelResolution = channelRes;
      }
    }
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
  shader.uniforms.time = timeTicks * 0.015 * speed;
  if ("uTime" in shader.uniforms) shader.uniforms.uTime = shader.uniforms.time;
  if ("iTime" in shader.uniforms) shader.uniforms.iTime = shader.uniforms.time;
  if ("iTimeDelta" in shader.uniforms) shader.uniforms.iTimeDelta = dt;
  if ("iFrame" in shader.uniforms) shader.uniforms.iFrame = (shader.uniforms.iFrame ?? 0) + 1;
  if ("iFrameRate" in shader.uniforms) shader.uniforms.iFrameRate = dt > 0 ? (1 / dt) : 60;
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








