// Shared controls for the auto-buffer river shader.
// This source is injected into both the main pass and the nested analysis buffer.

uniform float uAnalysisBlueBoost; // @editable 0.0 @tip "Boost blue-dominant pixels when blue is already stronger than red and green." @order 1
uniform float uAnalysisSegTolerance; // @editable 0.22 @tip "Tolerance for expanding from nearby high-confidence water colors." @order 2
uniform float uWaterLevel; // @editable 0.5 @tip "Bias the automatically detected shoreline threshold." @order 3
uniform float uAnalysisGamma; // @editable 1.0 @tip "Gamma response applied to the auto-analysis mask and depth." @order 4
uniform float uAnalysisContrast; // @editable 1.0 @tip "Contrast applied to the auto-analysis mask and depth." @order 5
