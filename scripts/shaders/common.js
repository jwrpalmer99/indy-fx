export const SHADER_VERT = `
precision mediump float;
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;
void main() {
  vTextureCoord = aTextureCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

export function hexToRgb01(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

const RESERVED_UNIFORM_NAMES = new Set([
  "time",
  "uTime",
  "iTime",
  "iTimeDelta",
  "iFrame",
  "iFrameRate",
  "iDate",
  "iResolution",
  "iMouse",
  "iChannelResolution",
  "iChannel0",
  "iChannel1",
  "iChannel2",
  "iChannel3",
  "uSampler",
  "globalAlpha",
  "resolution",
  "intensity",
  "falloffPower",
  "debugMode",
  "noiseOffset",
  "density",
  "flowMode",
  "flowSpeed",
  "flowTurbulence",
  "shaderScale",
  "shaderScaleXY",
  "shaderRotation",
  "cpfxTokenRotation",
  "shaderFlipX",
  "shaderFlipY",
  "cpfxBufferValueClamp",
  "colorA",
  "colorB",
  "cpfxPreserveTransparent",
  "cpfxForceOpaqueCaptureAlpha",
  "cpfxChannelType0",
  "cpfxChannelType1",
  "cpfxChannelType2",
  "cpfxChannelType3",
  "cpfxVolumeLayout0",
  "cpfxVolumeLayout1",
  "cpfxVolumeLayout2",
  "cpfxVolumeLayout3",
  "cpfxVolumeSampleParams0",
  "cpfxVolumeSampleParams1",
  "cpfxVolumeSampleParams2",
  "cpfxVolumeSampleParams3",
  "cpfxVolumeUvParams0",
  "cpfxVolumeUvParams1",
  "cpfxVolumeUvParams2",
  "cpfxVolumeUvParams3",
  "cpfxSamplerVflip0",
  "cpfxSamplerVflip1",
  "cpfxSamplerVflip2",
  "cpfxSamplerVflip3",
  "cpfxSamplerWrap0",
  "cpfxSamplerWrap1",
  "cpfxSamplerWrap2",
  "cpfxSamplerWrap3",
]);

function isValidCustomUniformName(name) {
  const key = String(name ?? "").trim();
  if (!key) return false;
  if (!/^[A-Za-z_]\w*$/.test(key)) return false;
  if (RESERVED_UNIFORM_NAMES.has(key)) return false;
  return true;
}

function normalizeCustomUniformValue(raw) {
  if (raw === true || raw === false) return raw;
  if (Number.isFinite(Number(raw))) return Number(raw);
  if (Array.isArray(raw)) {
    const values = raw
      .slice(0, 4)
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    if (values.length >= 2) return values;
    return null;
  }
  if (raw && typeof raw === "object") {
    const maybeVec = ["x", "y", "z", "w"]
      .map((axis) => Number(raw?.[axis]))
      .filter((entry) => Number.isFinite(entry));
    if (maybeVec.length >= 2) return maybeVec.slice(0, 4);
    return null;
  }
  return null;
}

function extractCustomUniforms(rawMap) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return {};
  const map = {};
  for (const [name, rawValue] of Object.entries(rawMap)) {
    if (!isValidCustomUniformName(name)) continue;
    const normalized = normalizeCustomUniformValue(rawValue);
    if (normalized === null) continue;
    map[name] = normalized;
  }
  return map;
}

export function buildBaseUniforms(cfg) {
  const toFiniteNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const toBoolean = (value, fallback = false) => {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1" || value === "true" || value === "on") return true;
    if (value === 0 || value === "0" || value === "false" || value === "off") return false;
    return fallback;
  };

  const scalarScale = Math.max(0.01, toFiniteNumber(cfg.scale ?? cfg.shaderScale, 1.0));
  const axisScaleX = Math.max(0.01, toFiniteNumber(cfg.scaleX ?? cfg.shaderScaleX, 1.0));
  const axisScaleY = Math.max(0.01, toFiniteNumber(cfg.scaleY ?? cfg.shaderScaleY, 1.0));
  const scaleX = Math.max(0.01, scalarScale * axisScaleX);
  const scaleY = Math.max(0.01, scalarScale * axisScaleY);
  const explicitRotation = Number(cfg.shaderRotation ?? cfg.shaderRotationRad);
  const flipHorizontal = toBoolean(
    cfg.flipHorizontal ?? cfg.shaderFlipHorizontal ?? cfg.flipX,
    false,
  );
  const flipVertical = toBoolean(
    cfg.flipVertical ?? cfg.shaderFlipVertical ?? cfg.flipY,
    false,
  );
  const explicitRotationDeg = Number(cfg.shaderRotationDeg);
  const rotation = Number.isFinite(explicitRotation)
    ? explicitRotation
    : (Number.isFinite(explicitRotationDeg)
      ? (explicitRotationDeg * Math.PI / 180)
      : 0);

  const uniforms = {
    time: 0,
    intensity: toFiniteNumber(cfg.intensity, 1.0),
    falloffPower: toFiniteNumber(cfg.falloffPower, 1.6),
    debugMode: toFiniteNumber(cfg.debugMode, 0),
    noiseOffset: Array.isArray(cfg.noiseOffset) ? cfg.noiseOffset : [0, 0],
    density: toFiniteNumber(cfg.density, 1.0),
    flowMode: toFiniteNumber(cfg.flowMode, 1),
    flowSpeed: toFiniteNumber(cfg.flowSpeed, 0.8),
    flowTurbulence: toFiniteNumber(cfg.flowTurbulence, 0.35),
    shaderScale: scalarScale,
    shaderScaleXY: [scaleX, scaleY],
    shaderRotation: rotation,
    cpfxTokenRotation: toFiniteNumber(cfg.cpfxTokenRotation, 0),
    shaderFlipX: flipHorizontal ? 1.0 : 0.0,
    shaderFlipY: flipVertical ? 1.0 : 0.0,
    cpfxBufferValueClamp: toFiniteNumber(cfg.cpfxBufferValueClamp, 0),
    colorA: hexToRgb01(cfg.colorA ?? 0xFF4A9A),
    colorB: hexToRgb01(cfg.colorB ?? 0xFFB14A)
  };

  const customUniforms = extractCustomUniforms(cfg?.customUniforms);
  for (const [name, value] of Object.entries(customUniforms)) {
    uniforms[name] = value;
  }

  return uniforms;
}



