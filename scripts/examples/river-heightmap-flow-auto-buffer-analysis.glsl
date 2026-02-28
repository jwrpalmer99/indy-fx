// River analysis buffer for the auto-analyzed capture variant.
// R = final visible water mask (base detector only)
// G = final visible interior depth estimate
// B = shoreline / edge confidence
// A = unused
// Shared analysis controls are declared in the shader's commonSource.

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float saturation(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  return (maxC - minC) / max(0.08, maxC);
}

float boostedBlue(vec3 c) {
  float blueLead = max(c.b - max(c.r, c.g), 0.0);
  return clamp(c.b + blueLead * max(0.0, uAnalysisBlueBoost), 0.0, 1.0);
}

float coolMetric(vec3 c) {
  return boostedBlue(c) - 0.5 * (c.r + c.g);
}

float quickWaterHint(vec3 c) {
  float blue = boostedBlue(c);
  float cool = coolMetric(c);
  float cyan = min(c.g, blue) - c.r;
  float coolScore = smoothstep(-0.01, 0.22, max(cool, cyan * 0.85));
  float bluePresence = smoothstep(0.15, 0.78, blue);
  float darkAssist = smoothstep(0.15, 0.80, 1.0 - luma(c));
  float sat = saturation(c);
  float score = bluePresence * mix(coolScore, max(coolScore, darkAssist), 0.22);
  score *= 0.82 + 0.18 * smoothstep(0.02, 0.35, sat);
  return clamp(score, 0.0, 1.0);
}

float boundaryBarrier(
  vec3 c,
  vec3 cL,
  vec3 cR,
  vec3 cD,
  vec3 cU
) {
  float lit = luma(c);
  float litDiff = max(
    max(abs(lit - luma(cL)), abs(lit - luma(cR))),
    max(abs(lit - luma(cD)), abs(lit - luma(cU)))
  );
  float cool = coolMetric(c);
  float coolDiff = max(
    max(abs(cool - coolMetric(cL)), abs(cool - coolMetric(cR))),
    max(abs(cool - coolMetric(cD)), abs(cool - coolMetric(cU)))
  );
  float sat = saturation(c);
  float darkLine = smoothstep(0.22, 0.78, 1.0 - lit);
  float neutralLine = 1.0 - smoothstep(0.08, 0.40, sat);
  float localEdge = smoothstep(0.035, 0.16, max(litDiff, coolDiff * 0.85));
  return clamp(localEdge * darkLine * neutralLine, 0.0, 1.0);
}

vec2 classifyBaseRiver(
  vec3 c,
  vec3 localMean,
  float neighborhoodHint
) {
  float blue = boostedBlue(c);
  float sat = saturation(c);
  float lit = luma(c);
  float meanLit = luma(localMean);

  float cool = coolMetric(c);
  float meanCool = coolMetric(localMean);
  float cyan = min(c.g, blue) - c.r;

  float localCool = cool - meanCool * 0.55;
  float coolScore = smoothstep(-0.02, 0.18, max(localCool, cyan * 0.80));
  float bluePresence = smoothstep(0.16, 0.82, blue);
  float localDark = smoothstep(-0.01, 0.28, meanLit - lit + sat * 0.04);
  float meanBias = smoothstep(0.0, 0.18, meanCool) * 0.12;

  float baseMask = bluePresence * mix(coolScore, max(coolScore, localDark), 0.35);
  baseMask = mix(baseMask, neighborhoodHint, 0.45);
  baseMask = clamp(baseMask + meanBias, 0.0, 1.0);

  float deepBlue = smoothstep(0.02, 0.42, blue - 0.24 * c.r - 0.14 * c.g);
  float interiorDark = smoothstep(0.0, 0.32, meanLit - lit + 0.05);
  float baseDepth = clamp(baseMask * (deepBlue * 0.55 + interiorDark * 0.45), 0.0, 1.0);

  return vec2(baseMask, baseDepth);
}

vec3 sampleCaptureLocal(vec2 uv) {
  return texture(iChannel0, uv).rgb;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;
  vec2 texel = vec2(1.0 / iResolution.x, 1.0 / iResolution.y);

  vec3 c = sampleCaptureLocal(uv);
  vec3 cL = sampleCaptureLocal(uv - vec2(texel.x, 0.0));
  vec3 cR = sampleCaptureLocal(uv + vec2(texel.x, 0.0));
  vec3 cD = sampleCaptureLocal(uv - vec2(0.0, texel.y));
  vec3 cU = sampleCaptureLocal(uv + vec2(0.0, texel.y));
  vec3 cDL = sampleCaptureLocal(uv - texel);
  vec3 cDR = sampleCaptureLocal(uv + vec2(texel.x, -texel.y));
  vec3 cUL = sampleCaptureLocal(uv + vec2(-texel.x, texel.y));
  vec3 cUR = sampleCaptureLocal(uv + texel);

  vec3 localMean =
    (c + cL + cR + cD + cU + cDL + cDR + cUL + cUR) / 9.0;
  float edgeBarrier = boundaryBarrier(c, cL, cR, cD, cU);

  float hC = quickWaterHint(c);
  float hL = quickWaterHint(cL);
  float hR = quickWaterHint(cR);
  float hD = quickWaterHint(cD);
  float hU = quickWaterHint(cU);
  float hDL = quickWaterHint(cDL);
  float hDR = quickWaterHint(cDR);
  float hUL = quickWaterHint(cUL);
  float hUR = quickWaterHint(cUR);

  float hint =
    hC * 0.32 +
    hL * 0.10 +
    hR * 0.10 +
    hD * 0.10 +
    hU * 0.10 +
    hDL * 0.07 +
    hDR * 0.07 +
    hUL * 0.07 +
    hUR * 0.07;

  vec2 baseRiver = classifyBaseRiver(c, localMean, hint);
  float finalMask = baseRiver.x;
  float depth = clamp(baseRiver.y, 0.0, 1.0);

  float litGrad =
    abs(luma(cR) - luma(cL)) +
    abs(luma(cU) - luma(cD));
  float coolGrad =
    abs(coolMetric(cR) - coolMetric(cL)) +
    abs(coolMetric(cU) - coolMetric(cD));
  float edge = max(
    edgeBarrier,
    smoothstep(0.03, 0.22, max(litGrad, coolGrad * 1.15))
  );
  float shore = edge * finalMask * (1.0 - smoothstep(0.18, 0.92, depth));

  fragColor = vec4(
    finalMask,
    depth,
    packShoreSettled(clamp(shore, 0.0, 1.0), 0.0),
    0.0
  );
}
