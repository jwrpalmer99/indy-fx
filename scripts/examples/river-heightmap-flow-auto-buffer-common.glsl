// Shared controls for the auto-buffer river shader.
// This source is injected into both the main pass and the nested analysis buffer.

float packShoreSettled(float shore, float settled) {
  return clamp(shore, 0.0, 1.0);
}

float unpackSettled(float packedValue) {
  return 0.0;
}

float unpackShore(float packedValue) {
  return clamp(packedValue, 0.0, 1.0);
}

uniform float uAnalysisBlueBoost; // @editable 0.0 @min 0.0 @max 10.0 @tip "Boost blue-dominant pixels when blue is already stronger than red and green." @order 1
uniform float uWaterLevel; // @editable 0.5 @min 0.0 @max 1.0 @tip "Bias the automatically detected shoreline threshold." @order 2
uniform float uAnalysisGamma; // @editable 1.0 @min 0.1 @max 3.0 @tip "Gamma response applied to the auto-analysis mask and depth." @order 3
uniform float uAnalysisContrast; // @editable 1.0 @min 0.1 @max 3.0 @tip "Contrast applied to the auto-analysis mask and depth." @order 4
