// River analysis buffer for the auto-analyzed capture variant.
// R = water likelihood / mask
// G = interior depth estimate
// B = shoreline / edge confidence
// A = 1.0

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float saturation(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  return (maxC - minC) / max(0.08, maxC);
}

float coolMetric(vec3 c) {
  return c.b - 0.5 * (c.r + c.g);
}

float quickWaterHint(vec3 c) {
  float cool = coolMetric(c);
  float cyan = min(c.g, c.b) - c.r;
  float coolScore = smoothstep(-0.01, 0.22, max(cool, cyan * 0.85));
  float bluePresence = smoothstep(0.15, 0.78, c.b);
  float darkAssist = smoothstep(0.15, 0.80, 1.0 - luma(c));
  float sat = saturation(c);
  float score = bluePresence * mix(coolScore, max(coolScore, darkAssist), 0.22);
  score *= 0.82 + 0.18 * smoothstep(0.02, 0.35, sat);
  return clamp(score, 0.0, 1.0);
}

vec2 classifyRiver(vec3 c, vec3 localMean, float neighborhoodHint) {
  float sat = saturation(c);
  float lit = luma(c);
  float meanLit = luma(localMean);

  float cool = coolMetric(c);
  float meanCool = coolMetric(localMean);
  float cyan = min(c.g, c.b) - c.r;

  float localCool = cool - meanCool * 0.55;
  float coolScore = smoothstep(-0.02, 0.18, max(localCool, cyan * 0.80));
  float bluePresence = smoothstep(0.16, 0.82, c.b);
  float localDark = smoothstep(-0.01, 0.28, meanLit - lit + sat * 0.04);
  float meanBias = smoothstep(0.0, 0.18, meanCool) * 0.12;

  float mask = bluePresence * mix(coolScore, max(coolScore, localDark), 0.35);
  mask = mix(mask, neighborhoodHint, 0.45);
  mask = clamp(mask + meanBias, 0.0, 1.0);
  mask = pow(mask, 0.90);

  float deepBlue = smoothstep(0.02, 0.42, c.b - 0.24 * c.r - 0.14 * c.g);
  float interiorDark = smoothstep(0.0, 0.32, meanLit - lit + 0.05);
  float depth = clamp(mask * (deepBlue * 0.55 + interiorDark * 0.45), 0.0, 1.0);

  return vec2(mask, depth);
}

vec3 sampleCaptureRaw(vec2 rawUv) {
  return texture(iChannel0, rawUv).rgb;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;
  vec2 rawUv = cpfx_rawUv();
  vec2 texel = vec2(1.0 / iResolution.x, 1.0 / iResolution.y);

  vec3 c = sampleCaptureRaw(rawUv);
  vec3 cL = sampleCaptureRaw(rawUv - vec2(texel.x, 0.0));
  vec3 cR = sampleCaptureRaw(rawUv + vec2(texel.x, 0.0));
  vec3 cD = sampleCaptureRaw(rawUv - vec2(0.0, texel.y));
  vec3 cU = sampleCaptureRaw(rawUv + vec2(0.0, texel.y));
  vec3 cDL = sampleCaptureRaw(rawUv - texel);
  vec3 cDR = sampleCaptureRaw(rawUv + vec2(texel.x, -texel.y));
  vec3 cUL = sampleCaptureRaw(rawUv + vec2(-texel.x, texel.y));
  vec3 cUR = sampleCaptureRaw(rawUv + texel);

  vec3 localMean =
    (c + cL + cR + cD + cU + cDL + cDR + cUL + cUR) / 9.0;

  float hint =
    quickWaterHint(c) * 0.32 +
    quickWaterHint(cL) * 0.10 +
    quickWaterHint(cR) * 0.10 +
    quickWaterHint(cD) * 0.10 +
    quickWaterHint(cU) * 0.10 +
    quickWaterHint(cDL) * 0.07 +
    quickWaterHint(cDR) * 0.07 +
    quickWaterHint(cUL) * 0.07 +
    quickWaterHint(cUR) * 0.07;

  vec2 river = classifyRiver(c, localMean, hint);
  float mask = river.x;
  float depth = river.y;

  float litGrad =
    abs(luma(cR) - luma(cL)) +
    abs(luma(cU) - luma(cD));
  float coolGrad =
    abs(coolMetric(cR) - coolMetric(cL)) +
    abs(coolMetric(cU) - coolMetric(cD));
  float edge = smoothstep(0.03, 0.22, max(litGrad, coolGrad * 1.15));
  float shore = edge * mask * (1.0 - smoothstep(0.18, 0.92, depth));

  fragColor = vec4(mask, depth, clamp(shore, 0.0, 1.0), 1.0);
}
