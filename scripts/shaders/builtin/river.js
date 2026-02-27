export const riverShaderDefinition = {
  id: "river",
  label: "River (top-down)",
  type: "builtin",
  requiresResolution: false,
  usesNoiseTexture: false,
  fragment: `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vTextureCoord;
uniform sampler2D uSampler;

// Standard system uniforms
uniform float time;
uniform float intensity;
uniform float flowSpeed;
uniform float flowTurbulence;
uniform float density;
uniform vec2  noiseOffset;
uniform vec2  shaderScaleXY;
uniform float shaderRotation;
uniform float shaderFlipX;
uniform float shaderFlipY;
uniform float debugMode;

// colorA = deep water colour,  colorB = shallow / near-shore water colour
uniform vec3 colorA;
uniform vec3 colorB;

// Custom uniforms – @editable annotations supply defaults when not configured
uniform vec3  colorMid;      // @editable vec3(0.08, 0.38, 0.62)
uniform float waterLevel;    // @editable 0.45
uniform float refractionStr; // @editable 0.03
uniform float normalStr;     // @editable 1.0
uniform float specularStr;   // @editable 0.5
uniform float foamAmt;       // @editable 0.8
uniform float foamWidth;     // @editable 0.06

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

vec2 cpfxRotate(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec2 hash22(vec2 p) {
    vec2 q = vec2(dot(p, vec2(127.1, 311.7)),
                  dot(p, vec2(269.5, 183.3)));
    return fract(sin(q) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 g00 = hash22(i)              * 2.0 - 1.0;
    vec2 g10 = hash22(i + vec2(1, 0)) * 2.0 - 1.0;
    vec2 g01 = hash22(i + vec2(0, 1)) * 2.0 - 1.0;
    vec2 g11 = hash22(i + vec2(1, 1)) * 2.0 - 1.0;
    float na = dot(g00, f);
    float nb = dot(g10, f - vec2(1, 0));
    float nc = dot(g01, f - vec2(0, 1));
    float nd = dot(g11, f - vec2(1, 1));
    return mix(mix(na, nb, u.x), mix(nc, nd, u.x), u.y) * 0.5 + 0.5;
}

float fbm(vec2 p) {
    float v    = 0.0;
    float amp  = 0.5;
    float freq = 1.0;
    mat2 rot   = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) {
        v    += amp * noise(p * freq);
        p     = rot * p;
        freq *= 2.02;
        amp  *= 0.5;
    }
    return v;
}

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

void main() {
    // -- UV setup ----------------------------------------------------------
    vec2 suv = vTextureCoord;
    if (shaderFlipX > 0.5) suv.x = 1.0 - suv.x;
    if (shaderFlipY > 0.5) suv.y = 1.0 - suv.y;
    vec2 uv = cpfxRotate(suv - 0.5, shaderRotation)
              / max(shaderScaleXY, vec2(0.0001)) + 0.5;

    // -- Heightmap ---------------------------------------------------------
    vec4  baseTex   = texture2D(uSampler, suv);
    float terrainH  = luma(baseTex.rgb);
    float maskAlpha = baseTex.a;

    // -- Depth -------------------------------------------------------------
    float wl     = max(waterLevel, 0.01);
    float depth  = wl - terrainH;                    // +ve = submerged
    float depthN = clamp(depth / wl, 0.0, 1.0);     // 0 = shore, 1 = deepest

    // -- Flow domain -------------------------------------------------------
    // Flow direction is +X in shader-space; rotate the shader to redirect flow.
    vec2 flowDir = vec2(1.0, 0.0);
    vec2 pBase   = uv * density * 3.0 + noiseOffset;

    // Two layers at different speeds create parallax surface depth.
    vec2 p1 = pBase + flowDir * time * flowSpeed;
    vec2 p2 = pBase * 0.65
              + flowDir * time * flowSpeed * 0.55
              + vec2(31.7, -17.3);

    // -- Domain warp: turbulence & eddies ----------------------------------
    float turbScale = max(flowTurbulence, 0.0);
    vec2 warp1 = vec2(fbm(p1 + vec2( 1.7,  2.3)),
                      fbm(p1 + vec2(-3.1,  0.9))) - 0.5;
    vec2 warpOff = warp1 * turbScale * 2.5;
    vec2 wp1 = p1 + warpOff;
    vec2 wp2 = p2 + warp1 * turbScale * 1.5;

    // -- Water-surface normals (FBM gradient) ------------------------------
    float eps    = 0.02;
    float invEps = 1.0 / eps;

    float h0  = fbm(wp1);
    float hx  = fbm(wp1 + vec2(eps, 0.0));
    float hy  = fbm(wp1 + vec2(0.0, eps));
    float h0b = fbm(wp2);
    float hxb = fbm(wp2 + vec2(eps, 0.0));
    float hyb = fbm(wp2 + vec2(0.0, eps));

    vec2 grad1 = vec2(h0  - hx,  h0  - hy)  * invEps;
    vec2 grad2 = vec2(h0b - hxb, h0b - hyb) * invEps;
    float nStr = max(normalStr, 0.0);
    vec2  wNorm = (grad1 * 0.6 + grad2 * 0.4) * nStr;

    // -- Eddies: swirl perpendicular to warp near the shoreline ------------
    float eddyStrength = exp(-abs(depth) * 10.0) * turbScale;
    vec2  eddyOff      = vec2(-warp1.y, warp1.x) * eddyStrength * 0.05;

    // -- Refraction --------------------------------------------------------
    float rStr     = max(refractionStr, 0.0);
    vec2  refractUV  = clamp(suv + wNorm * rStr + eddyOff, 0.001, 0.999);
    vec4  refractTex = texture2D(uSampler, refractUV);
    vec3  bedCol     = refractTex.rgb;

    // -- Depth colour ------------------------------------------------------
    vec3 cDeep    = colorA;    // user-configurable: deep water
    vec3 cShallow = colorB;    // user-configurable: shallow / shore
    vec3 cMid     = colorMid;
    // Fallback if colorMid hasn't been configured yet (all-zero default)
    if (dot(cMid, cMid) < 0.0001) cMid = vec3(0.08, 0.38, 0.62);

    vec3 waterCol;
    if (depthN < 0.5) {
        waterCol = mix(cShallow, cMid, depthN * 2.0);
    } else {
        waterCol = mix(cMid, cDeep, (depthN - 0.5) * 2.0);
    }

    // Blend refracted riverbed through shallow water
    float bedVis  = (1.0 - depthN) * 0.65;
    vec3  underCol = mix(waterCol, bedCol, bedVis);

    // -- Specular highlight ------------------------------------------------
    float sStr    = max(specularStr, 0.0);
    vec3 lightDir = normalize(vec3(0.4, 0.6, 1.0));
    vec3 viewDir  = vec3(0.0, 0.0, 1.0);
    vec3 halfDir  = normalize(lightDir + viewDir);
    vec3 N        = normalize(vec3(wNorm.x * 0.3, wNorm.y * 0.3, 1.0));
    float spec    = pow(max(0.0, dot(N, halfDir)), 48.0) * sStr;
    underCol += vec3(1.0, 0.97, 0.9) * spec;

    // -- Foam at shoreline -------------------------------------------------
    float foamW = max(foamWidth, 0.001);
    float fAmt  = max(foamAmt,  0.0);

    // Primary foam band just below the waterline
    float foamEdge = smoothstep(wl - foamW, wl + foamW * 0.3, terrainH);
    float foamN    = fbm(pBase * 2.0 + warpOff
                         + flowDir * time * flowSpeed * 2.0);
    foamN = smoothstep(0.38, 0.70, foamN);
    vec3 foamCol = vec3(foamEdge * foamN * fAmt);

    // Secondary wisps / vortex streaks slightly upstream
    float foamEdge2 = smoothstep(wl + foamW * 0.3, wl + foamW * 1.5, terrainH);
    float foamN2    = fbm(pBase * 3.5 + warpOff * 0.7
                          + flowDir * time * flowSpeed * 2.5
                          + vec2(5.3, -3.7));
    foamN2 = smoothstep(0.46, 0.76, foamN2);
    foamCol += vec3(foamEdge2 * foamN2 * fAmt * 0.5);

    underCol += foamCol;

    // -- Vortex: eddy-offset sample blended near shoreline ----------------
    vec2 eddyUV2 = clamp(refractUV + eddyOff * 2.5, 0.001, 0.999);
    vec4 eddyTex = texture2D(uSampler, eddyUV2);
    underCol = mix(underCol,
                   mix(waterCol, eddyTex.rgb, 0.25),
                   eddyStrength * 0.2);

    // -- Terrain above waterline (pass-through with foam spray) -----------
    vec3  terrainCol  = baseTex.rgb;
    float shoreSpray  = smoothstep(wl, wl + foamW * 2.5, terrainH)
                        * foamN * fAmt * 0.3;
    terrainCol = mix(terrainCol, vec3(1.0), shoreSpray);

    // -- Composite ---------------------------------------------------------
    float aboveWater = step(wl, terrainH);
    vec3  finalCol   = mix(underCol, terrainCol, aboveWater);
    float finalAlpha = maskAlpha * intensity;

    if (debugMode > 0.5 && debugMode < 1.5) {
        gl_FragColor = vec4(uv, 0.0, 1.0);
        return;
    }
    if (debugMode > 1.5) {
        gl_FragColor = vec4(vec3(maskAlpha), 1.0);
        return;
    }

    gl_FragColor = vec4(finalCol * finalAlpha, finalAlpha);
}
`
};
