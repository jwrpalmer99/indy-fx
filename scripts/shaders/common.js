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

  return {
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
    colorA: hexToRgb01(cfg.colorA ?? 0xFF4A9A),
    colorB: hexToRgb01(cfg.colorB ?? 0xFFB14A)
  };
}



