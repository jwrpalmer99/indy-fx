export const noiseShaderDefinition = {
  id: "noise",
  label: "Noise shader",
  type: "builtin",
  requiresResolution: false,
  usesNoiseTexture: false,
  fragment: `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;

uniform float time;
uniform float intensity;
uniform float falloffPower;
uniform float debugMode;
uniform vec2 noiseOffset;
uniform float density;
uniform float flowMode;
uniform float flowSpeed;
uniform float flowTurbulence;
uniform float shaderScale;
uniform vec2 shaderScaleXY;
uniform float shaderRotation;
uniform float shaderFlipX;
uniform float shaderFlipY;
uniform vec3 colorA;
uniform vec3 colorB;

vec2 cpfxRotate(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec2 hash22(vec2 p){
  vec2 q = vec2(
    dot(p, vec2(127.1, 311.7)),
    dot(p, vec2(269.5, 183.3))
  );
  return fract(sin(q) * 43758.5453123);
}
float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  vec2 g00 = hash22(i) * 2.0 - 1.0;
  vec2 g10 = hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
  vec2 g01 = hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
  vec2 g11 = hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0;
  float a = dot(g00, f);
  float b = dot(g10, f - vec2(1.0, 0.0));
  float c = dot(g01, f - vec2(0.0, 1.0));
  float d = dot(g11, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.5 + 0.5;
}
float fbm(vec2 p){
  float v=0.0, a=0.55, f=1.0;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for(int i=0;i<5;i++){
    v += a*noise(p*f);
    p = rot * p;
    f *= 2.02;
    a *= 0.55;
  }
  return v;
}

void main(){
  vec2 suv = vTextureCoord;
  if (shaderFlipX > 0.5) suv.x = 1.0 - suv.x;
  if (shaderFlipY > 0.5) suv.y = 1.0 - suv.y;
  vec2 uvCentered = cpfxRotate(suv - 0.5, shaderRotation);
  vec2 uv = uvCentered / max(shaderScaleXY, vec2(0.0001)) + 0.5;
  vec4 base = texture2D(uSampler, suv);
  vec2 uvC = uv - 0.5;
  vec2 uvCBase = suv - 0.5;
  float t = time;

  vec2 p = uvC * density + noiseOffset;
  vec2 warp = vec2(fbm(p*6.0 + vec2(2.3,1.7) + t*0.35),
                   fbm(p*6.0 + vec2(-1.4,4.6) + t*0.31)) - 0.5;

  float n = fbm(p*7.5 + warp*1.6 + t*0.12);
  n = pow(n, 1.6);
  n = clamp(n*1.25 - 0.10, 0.0, 1.0);

  float r = length(uvCBase);
  if (flowMode > 0.5) {
    float centerWeight = smoothstep(1.0, 0.0, r);
    vec2 dir = (r > 0.0001) ? normalize(uvC + warp * (0.5 + flowTurbulence)) : vec2(0.0, 0.0);
    vec2 pFlow = (uvC + dir * (t * flowSpeed * centerWeight)) * density + noiseOffset;
    vec2 t1 = vec2(sin(t*0.35), cos(t*0.35));
    vec2 t2 = vec2(sin(t*0.31 + 1.7), cos(t*0.31 + 1.7));
    vec2 warpFlow = vec2(fbm(pFlow*6.0 + vec2(2.3,1.7) + t1),
                         fbm(pFlow*6.0 + vec2(-1.4,4.6) + t2)) - 0.5;
    if (flowTurbulence > 0.001) {
      pFlow += warpFlow * flowTurbulence;
      warpFlow = vec2(fbm(pFlow*6.0 + vec2(2.3,1.7) + t1),
                      fbm(pFlow*6.0 + vec2(-1.4,4.6) + t2)) - 0.5;
    }
    float n1 = fbm(pFlow*7.5 + warpFlow*1.6 + t*0.12);
    vec2 pFlow2 = (uvC + dir * (t * flowSpeed * 0.55 * centerWeight) + warpFlow * 0.35) * density
                  + noiseOffset + vec2(37.2, -19.4);
    vec2 t3 = vec2(sin(t*0.22 + 0.6), cos(t*0.22 + 0.6));
    vec2 t4 = vec2(sin(t*0.19 + 2.1), cos(t*0.19 + 2.1));
    vec2 warpFlow2 = vec2(fbm(pFlow2*5.2 + vec2(4.1,1.3) + t3),
                          fbm(pFlow2*5.2 + vec2(-2.7,3.9) + t4)) - 0.5;
    float n2 = fbm(pFlow2*6.5 + warpFlow2*1.2 + t3*0.3);
    n = mix(n1, n2, 0.45);
    n = pow(n, 1.6);
    n = clamp(n*1.25 - 0.10, 0.0, 1.0);
  }
  r *= 2.0;
  float radial = clamp(1.0 - r, 0.0, 1.0);
  radial = pow(radial, max(0.01, falloffPower));
  float circleMask = 1.0 - smoothstep(1.0, 1.03, r);
  float a = base.a * n * intensity * radial * circleMask;

  if (debugMode > 0.5 && debugMode < 1.5) {
    gl_FragColor = vec4(uv, 0.0, 1.0);
    return;
  }
  if (debugMode > 1.5) {
    gl_FragColor = vec4(vec3(base.a), 1.0);
    return;
  }

  vec3 col = mix(colorA, colorB, n);
  gl_FragColor = vec4(col * a, a);
}`
};


