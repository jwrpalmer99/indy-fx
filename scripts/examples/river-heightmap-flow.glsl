// River Over Depth Map (top-down)
// Usage in Indy FX:
// 1) Import/create a shader and paste this source.
// 2) Set iChannel0 to your riverbed texture (token/tile image or scene capture).
// 3) Tune uniforms in Edit Variables (all @editable fields below).

uniform float uFlowAngleDeg;      // @editable 24.0
uniform float uFlowSpeed;         // @editable 0.28
uniform float uTurbulence;        // @editable 1.0
uniform float uWaterLevel;        // @editable 0.85
uniform float uTransparency;      // @editable 0.42
uniform float uRefraction;        // @editable 0.05
uniform float uDiffraction;       // @editable 0.0025
uniform float uRefractionFlow;    // @editable 0.55
uniform float uIor;               // @editable 1.333
uniform float uNormalIntensity;   // @editable 1.7
uniform float uSpecularity;       // @editable 1.6
uniform float uShininess;         // @editable 48.0
uniform float uFoamIntensity;     // @editable 1.0
uniform float uFoamThreshold;     // @editable 0.18
uniform float uFoamSpeed;         // @editable 1.0
uniform float uVortexStrength;    // @editable 0.85
uniform vec3 uDeepColor;          // @editable 0.01,0.24,0.43
uniform vec3 uMediumColor;        // @editable 0.07,0.45,0.57
uniform vec3 uShallowColor;       // @editable 0.30,0.74,0.67
uniform vec3 uDepthWeights;       // @editable 0.0,0.4,1.0
uniform float uDepthGamma;        // @editable 1.0
uniform float uFixLand;           // @editable 1.0
uniform float uDebugHeightVsWater;  // @editable 0.0
uniform float uSiltIntensity;     // @editable 0.35
uniform float uSiltScale;         // @editable 12.0
uniform float uSiltSpeed;         // @editable 1.0
uniform float uSiltContrast;      // @editable 0.55
uniform float uSiltShallowBias;   // @editable 0.65
uniform float uSiltDepthBias;     // @editable 0.25
uniform vec3 uSiltColorA;         // @editable 0.53,0.59,0.42
uniform vec3 uSiltColorB;         // @editable 0.34,0.43,0.30

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float depthMapFromRgb(vec3 c) {
  vec3 w = uDepthWeights;
  float wsumAbs = abs(w.x) + abs(w.y) + abs(w.z);
  // Signed channel weights are supported; positive-only weights behave as before.
  float d = wsumAbs > 0.00001
    ? dot(c - vec3(0.5), w) / wsumAbs + 0.5
    : luma(c);
  float g = max(0.01, uDepthGamma);
  float depthLinear = pow(clamp(d, 0.0, 1.0), g);
  if (uFixLand > 0.5) {
    // Keep land correction gentle so depth weights remain meaningful.
    float warmVsBlue = max(c.r - c.b, 0.0);
    float greenVsBlue = max(c.g - c.b, 0.0);
    depthLinear -= warmVsBlue * 0.18 + greenVsBlue * 0.10;
  }
  depthLinear = clamp(depthLinear, 0.0, 1.0);
  // Direct mapping: brighter weighted values map to deeper terrain.
  return depthLinear;
}

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i + vec2(0.0, 0.0));
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i += 1) {
    v += a * noise2(p);
    p = m * p * 2.01;
    a *= 0.52;
  }
  return v;
}

float sampleDepth(vec2 uv) {
  return depthMapFromRgb(texture(iChannel0, uv).rgb);
}

vec2 flowWarp(vec2 p, vec2 flowDir, float t, float turb) {
  float tt = t * (0.35 + turb * 0.55);
  vec2 q = vec2(
    fbm(p * 0.85 + vec2(0.0, tt * 0.9)),
    fbm(p * 0.82 + vec2(13.7, -tt * 0.7))
  ) - 0.5;
  vec2 r = vec2(
    fbm(p * 1.37 + q * 2.4 + vec2(-tt * 1.3, 4.2)),
    fbm(p * 1.41 + q * 2.1 + vec2(tt * 1.1, -8.3))
  ) - 0.5;
  vec2 swirl = vec2(r.y - q.x, q.y - r.x);
  float spin = sin(dot(p, flowDir.yx * vec2(1.7, -2.3)) + tt * 2.6);
  return (swirl * 2.0 + q + r) * (0.25 + turb * 0.9) +
    flowDir.yx * spin * 0.15 * (0.2 + turb);
}

float surfaceField(vec2 uv, vec2 flowDir, float t, float turb) {
  vec2 p = uv * 7.5;
  float advTime = t * (1.0 + turb * 0.9);
  vec2 baseAdv = p - flowDir * advTime;
  vec2 warpA = flowWarp(baseAdv + vec2(2.1, -1.3), flowDir, t, turb);
  vec2 warpB = flowWarp(baseAdv * 1.23 + vec2(-6.2, 4.4), flowDir, t + 3.7, turb);
  vec2 q1 = baseAdv + warpA;
  vec2 q2 =
    baseAdv * 1.75 - warpB * 1.35 +
    flowDir.yx * sin(t * 1.8 + dot(baseAdv, vec2(1.3, -1.1)));

  float crests =
    sin(dot(q1, flowDir * vec2(5.8, 4.1)) +
    fbm(q2 + vec2(t * 0.8, -t * 0.6)) * 3.14159);
  float chop = sin(dot(q2, flowDir.yx * vec2(3.2, -5.4)) + t * 2.1);
  float micro = fbm(q1 * 2.2 + warpB * 2.0 + vec2(t * 1.5, -t * 1.2)) * 2.0 - 1.0;
  float macro = fbm(q2 * 0.95 - warpA * 1.7 + vec2(-t * 0.5, t * 0.4)) * 2.0 - 1.0;
  float vort = sin((warpA.x - warpB.y) * 8.0 + t * (1.2 + turb * 1.7));

  return
    crests * 0.35 +
    chop * 0.22 +
    micro * 0.28 +
    macro * 0.18 +
    vort * 0.16;
}

vec3 computeSurfaceNormal(vec2 uv, vec2 flowDir, float t, float normalIntensity, float turb) {
  vec2 e = vec2(1.0 / iResolution.x, 1.0 / iResolution.y);
  float hL = surfaceField(uv - vec2(e.x, 0.0), flowDir, t, turb);
  float hR = surfaceField(uv + vec2(e.x, 0.0), flowDir, t, turb);
  float hD = surfaceField(uv - vec2(0.0, e.y), flowDir, t, turb);
  float hU = surfaceField(uv + vec2(0.0, e.y), flowDir, t, turb);
  vec2 g = vec2(hR - hL, hU - hD) * normalIntensity;
  return normalize(vec3(-g.x, -g.y, 1.0));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;
  vec4 bed = texture(iChannel0, uv);
  float bedDepthMap = depthMapFromRgb(bed.rgb);

  float t = uTime * max(0.0, uFlowSpeed);
  vec2 flowDir = normalize(rot2(radians(uFlowAngleDeg)) * vec2(1.0, 0.0));
  vec3 N = computeSurfaceNormal(uv, flowDir, t, max(0.01, uNormalIntensity), max(0.0, uTurbulence));

  // Depth-map-derived water depth.
  float rawDepth = uWaterLevel + bedDepthMap - 1.0;
  float depth = clamp(rawDepth, 0.0, 1.0);
  float waterMask = smoothstep(0.002, 0.03, depth);
  if (uDebugHeightVsWater > 0.5) {
    float level01 = clamp(uWaterLevel, 0.0, 1.0);
    float edge = 1.0 - smoothstep(0.0, 0.02, abs(rawDepth));
    vec3 landWater = mix(
      vec3(0.55, 0.15, 0.10),
      vec3(0.08, 0.38, 0.90),
      step(0.0, rawDepth)
    );
    // Debug depth ramp: deeper = darker.
    vec3 debugDepth = vec3(1.0 - bedDepthMap);
    vec3 debugColor = mix(debugDepth, landWater, 0.65);
    debugColor = mix(debugColor, vec3(1.0, 0.92, 0.18), edge);

    // Top bar marker for the current water level (normalized 0-1).
    float barBand = step(uv.y, 0.03);
    float marker = 1.0 - smoothstep(0.0, 0.0035, abs(uv.x - level01));
    debugColor = mix(debugColor, vec3(0.02), barBand * 0.65);
    debugColor = mix(debugColor, vec3(0.0, 1.0, 1.0), barBand * marker);

    fragColor = vec4(debugColor, 1.0);
    return;
  }

  // Terrain slope for shoreline foam.
  vec2 texel = vec2(1.0 / iResolution.x, 1.0 / iResolution.y);
  float hL = sampleDepth(uv - vec2(texel.x, 0.0));
  float hR = sampleDepth(uv + vec2(texel.x, 0.0));
  float hD = sampleDepth(uv - vec2(0.0, texel.y));
  float hU = sampleDepth(uv + vec2(0.0, texel.y));
  vec2 terrainGrad = vec2(hR - hL, hU - hD);
  float slope = length(terrainGrad);

  // Refracted riverbed with configurable diffraction.
  // Blend physical (IOR-based) and flow-driven distortion for readable top-down motion.
  float eta = 1.0 / max(1.01, uIor);
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 refrV = refract(-viewDir, N, eta);
  vec2 physOffset = (refrV.xy / max(0.20, refrV.z + 0.20)) * uRefraction;
  float flowDistA = surfaceField(uv * 1.35 + flowDir * 0.23, flowDir, t * 1.10, max(0.0, uTurbulence));
  float flowDistB = surfaceField(uv * 1.28 + flowDir.yx * vec2(-0.31, 0.17), flowDir, t * 0.94, max(0.0, uTurbulence));
  float flowRefractStrength =
    (0.015 + 0.030 * clamp(uRefraction, 0.0, 1.5)) *
    max(0.0, uRefractionFlow);
  vec2 flowOffset = vec2(flowDistA, flowDistB) * flowRefractStrength;
  vec2 refractOffset = (physOffset + flowOffset) *
    mix(0.35, 1.20, smoothstep(0.0, 1.0, depth));
  vec2 chroma = N.xy * uDiffraction;
  vec2 uvR = clamp(uv + refractOffset + chroma, 0.0, 1.0);
  vec2 uvG = clamp(uv + refractOffset, 0.0, 1.0);
  vec2 uvB = clamp(uv + refractOffset - chroma, 0.0, 1.0);
  vec3 refractedBed = vec3(
    texture(iChannel0, uvR).r,
    texture(iChannel0, uvG).g,
    texture(iChannel0, uvB).b
  );

  // Depth color ramp: shallow -> medium -> deep.
  float dShallowToMid = smoothstep(0.08, 0.45, depth);
  float dMidToDeep = smoothstep(0.40, 0.95, depth);
  vec3 waterColor = mix(uShallowColor, uMediumColor, dShallowToMid);
  waterColor = mix(waterColor, uDeepColor, dMidToDeep);

  // Eddies and vortices in the flow field.
  vec2 flowUV = uv * 9.0 - flowDir * t * 0.75;
  float eddyNoise = fbm(flowUV + vec2(4.7, -2.1));
  float eddyBand = sin((eddyNoise * 2.0 - 1.0) * 9.5 + t * 2.2);
  float eddy = 0.5 + 0.5 * eddyBand;

  // Foam locked to terrain/water onlap: always present at contact, then shaped by slope/flow.
  float shoreWidth = mix(0.015, 0.10, clamp(uFoamThreshold * 2.5, 0.0, 1.0));
  float shorelineBand = 1.0 - smoothstep(0.0, shoreWidth, abs(rawDepth));
  float waterSide = smoothstep(-shoreWidth * 0.15, shoreWidth * 0.55, rawDepth);
  float shoreline = shorelineBand * waterSide;

  vec2 bankToShallow = normalize(-terrainGrad + vec2(1e-5, 1e-5));
  float flowImpact = max(0.0, dot(flowDir, bankToShallow));
  float speedFactor = max(0.0, uFlowSpeed);
  float speedNorm = clamp(speedFactor / 2.0, 0.0, 1.0);
  float foamSpeed = max(0.0, uFoamSpeed);
  float foamRate = (0.20 + speedFactor * 0.85) * (0.25 + foamSpeed);
  vec2 flowNormal = vec2(-flowDir.y, flowDir.x);

  float slopeFoam = smoothstep(
    uFoamThreshold * 0.03,
    uFoamThreshold * 0.28 + 0.005,
    slope
  );
  float shoreVar = 0.65 + 0.35 * fbm(
    uv * 18.0 + bankToShallow * 2.2 - flowDir * t * 0.35
  );
  float interfaceBase = shoreline * shoreVar * (0.42 + 0.58 * slopeFoam);

  // Build shoreline mist in flow-space with softer, cloud-like breakup.
  float along = dot(uv, flowDir);
  float across = dot(uv, flowNormal);
  vec2 flowCoord = vec2(along, across);
  vec2 driftDir = normalize(
    flowDir * (0.75 + 0.45 * flowImpact) +
    flowNormal * (0.16 + 0.28 * (1.0 - flowImpact)) +
    vec2(1e-5, 1e-5)
  );
  vec2 foamDrift = driftDir * (uTime * foamRate);

  vec2 mistUvA = flowCoord * vec2(11.0, 7.5) -
    foamDrift * vec2(2.8, 2.2) + bankToShallow * 1.6;
  vec2 mistUvB = flowCoord.yx * vec2(9.2, 8.7) -
    foamDrift * vec2(3.4, 2.6) - bankToShallow.yx * 1.2 + vec2(3.7, -2.5);
  vec2 mistUvC = (mistUvA + mistUvB) * 0.62 + vec2(-4.1, 2.9);

  float mistA = fbm(mistUvA);
  float mistB = fbm(mistUvB);
  float mistC = fbm(mistUvC);
  float mistBody = smoothstep(0.30, 0.82, mistA * 0.48 + mistB * 0.34 + mistC * 0.18);
  float mistWisp = 1.0 - smoothstep(0.12, 0.56, abs(mistA - mistB));
  float foamDetail = clamp(mistBody * (0.62 + 0.38 * mistWisp), 0.0, 1.0);
  float speedFoamBoost = mix(0.72, 1.30, speedNorm);
  float foam = interfaceBase *
    speedFoamBoost *
    (0.68 + 0.32 * flowImpact) *
    foamDetail;
  float churn = shoreline *
    mix(0.20, 0.70, speedNorm) *
    (0.20 + 0.60 * flowImpact) *
    uVortexStrength *
    smoothstep(0.45, 0.90, mistC);
  float foamMask = clamp((foam + churn * 0.20) * uFoamIntensity, 0.0, 1.0);
  foamMask = smoothstep(0.0, 0.85, foamMask);

  // Water body composition:
  // The riverbed is the original scene capture (iChannel0), sampled with refraction.
  // Depth map is only used to drive tint/opacity, not as the displayed bed color.
  float transparency = clamp(uTransparency, 0.0, 1.0);
  float depthTransmission = exp(-depth * 1.9);
  float depthOcclusion = mix(1.0, depthTransmission, 0.80);
  // Ensure uTransparency = 1.0 keeps the refracted capture fully visible.
  float bedVisibility = clamp(
    transparency * mix(1.0, depthOcclusion, 1.0 - transparency),
    0.0,
    1.0
  );
  float waterTintStrength = 1.0 - bedVisibility;

  // uTransparency = 0.0 -> fully opaque water (no bed visibility).
  // uTransparency = 1.0 -> refracted bed strongly visible, especially in shallows.
  vec3 waterBody = mix(refractedBed, waterColor, waterTintStrength);
  waterBody += vec3((eddy - 0.5) * 0.03 * bedVisibility);

  // Suspended silt as soft underwater plumes (cloud/smoke-like rather than streaky).
  float siltScale = max(0.5, uSiltScale);
  float siltSpeed = max(0.0, uSiltSpeed);
  float turb = max(0.0, uTurbulence);
  float siltTravel = t * (0.20 + 0.80 * siltSpeed);
  vec2 plumeDir = normalize(flowDir + vec2(1e-5, 1e-5));
  vec2 plumeBase = uv * (0.20 * siltScale);
  vec2 plumeWarp = flowWarp(
    plumeBase * 0.55 + vec2(2.7, -1.9),
    flowDir,
    t * 0.55 + 0.9,
    turb
  ) * (0.45 + 0.35 * turb);
  vec2 plumeUvA = plumeBase - plumeDir * siltTravel + plumeWarp;
  vec2 plumeUvB = plumeBase * 1.45 - plumeDir * (siltTravel * 1.2) - plumeWarp * 0.75 + vec2(4.2, -3.6);
  float plumeA = fbm(plumeUvA);
  float plumeB = fbm(plumeUvB);
  float plumeC = fbm((plumeUvA + plumeUvB) * 0.65 + vec2(-2.4, 3.1));
  float billow = plumeA * 0.52 + plumeB * 0.33 + plumeC * 0.15;
  float cloudBody = smoothstep(0.30, 0.86, billow);
  float cloudWisp = 1.0 - smoothstep(0.16, 0.62, abs(plumeA - plumeB));
  float cloudField = clamp(cloudBody * (0.55 + 0.45 * cloudWisp), 0.0, 1.0);
  float cloudContrast = clamp(uSiltContrast, 0.0, 1.0);
  cloudField = smoothstep(
    max(0.05, cloudContrast * 0.25),
    min(0.98, 0.55 + cloudContrast * 0.35),
    cloudField
  );
  float shallowMask = 1.0 - smoothstep(0.12, 0.90, depth);
  // Depth target control for plume placement: 0.0 = shallow, 1.0 = deep.
  float depthTarget = clamp(uSiltDepthBias, 0.0, 1.0);
  float targetMask = 1.0 - smoothstep(0.0, 0.55, abs(depth - depthTarget));
  float siltDepthMask = mix(targetMask, shallowMask, clamp(uSiltShallowBias, 0.0, 1.0));
  float siltAmount = clamp(uSiltIntensity, 0.0, 2.0) * siltDepthMask * cloudField;
  // Soft, airy opacity response.
  float plumeAlpha = 1.0 - exp(-siltAmount * 1.2);
  vec3 siltTone = mix(uSiltColorA, uSiltColorB, plumeB);
  vec3 plumeColor = mix(waterBody, siltTone, 0.50);
  waterBody = mix(waterBody, plumeColor, clamp(plumeAlpha, 0.0, 1.0) * 0.85);
  waterBody += vec3(0.02) * plumeAlpha * (0.35 + 0.65 * cloudWisp);

  // Simple top-down lighting/specular.
  vec3 L = normalize(vec3(-0.32, -0.26, 0.91));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float ndl = clamp(dot(N, L), 0.0, 1.0);
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), max(4.0, uShininess));
  float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  vec3 specCol = vec3(spec * (0.35 + fresnel) * uSpecularity);
  waterBody *= (0.96 + 0.04 * ndl);

  vec3 foamColor = vec3(0.95, 0.98, 1.0);
  vec3 wetResult = waterBody + specCol;
  wetResult = mix(wetResult, foamColor, foamMask);

  // Exposed terrain where water is too shallow.
  vec3 finalColor = mix(bed.rgb, wetResult, waterMask);
  // Scene-capture alpha may be zero on some paths; keep water visible on regions.
  float finalAlpha = 1.0;
  fragColor = vec4(finalColor, finalAlpha);
}
