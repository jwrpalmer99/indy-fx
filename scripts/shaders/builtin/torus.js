export const torusShaderDefinition = {
  id: "torus",
  label: "SDF torus",
  type: "builtin",
  requiresResolution: true,
  usesNoiseTexture: false,
  fragment: `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float time;
uniform float intensity;
uniform vec2 resolution;
uniform float debugMode;
uniform float shaderScale;
uniform vec2 shaderScaleXY;
uniform float shaderRotation;
uniform float shaderFlipX;
uniform float shaderFlipY;

#define PI 3.14159265359

void pR(inout vec2 p, float a) {
    p = cos(a)*p + sin(a)*vec2(p.y, -p.x);
}

vec2 cpfxRotate(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float smax(float a, float b, float r) {
    vec2 u = max(vec2(r + a,r + b), vec2(0.0));
    return min(-r, max (a, b)) + length(u);
}

vec3 pal(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d) {
    return a + b*cos(6.28318*(c*t+d));
}

vec3 spectrum(float n) {
    return pal(n, vec3(0.5,0.5,0.5), vec3(0.5,0.5,0.5), vec3(1.0,1.0,1.0), vec3(0.0,0.33,0.67));
}

vec4 inverseStereographic(vec3 p, out float k) {
    k = 2.0/(1.0+dot(p,p));
    return vec4(k*p,k-1.0);
}

float fTorus(vec4 p4) {
    float d1 = length(p4.xy) / length(p4.zw) - 1.0;
    float d2 = length(p4.zw) / length(p4.xy) - 1.0;
    float d = d1 < 0.0 ? -d1 : d2;
    d /= PI;
    return d;
}

float fixDistance(float d, float k) {
    float sn = sign(d);
    d = abs(d);
    d = d / k * 1.82;
    d += 1.0;
    d = pow(d, 0.5);
    d -= 1.0;
    d *= 5.0/3.0;
    d *= sn;
    return d;
}

float mapScene(vec3 p, float t) {
    float k;
    vec4 p4 = inverseStereographic(p, k);
    pR(p4.zy, t * -PI / 2.0);
    pR(p4.xw, t * -PI / 2.0);
    float d = fTorus(p4);
    d = abs(d);
    d -= 0.2;
    d = fixDistance(d, k);
    d = smax(d, length(p) - 1.85, 0.2);
    return d;
}

mat3 calcLookAtMatrix(vec3 ro, vec3 ta, vec3 up) {
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww,up));
    vec3 vv = normalize(cross(uu,ww));
    return mat3(uu, vv, ww);
}

void main() {
    vec2 suv = vTextureCoord;
    if (shaderFlipX > 0.5) suv.x = 1.0 - suv.x;
    if (shaderFlipY > 0.5) suv.y = 1.0 - suv.y;
    vec2 uv = cpfxRotate(suv - 0.5, shaderRotation) / max(shaderScaleXY, vec2(0.0001)) + 0.5;
    vec2 fragCoord = uv * resolution;
    vec2 p = (-resolution + 2.0 * fragCoord) / resolution.y;

    float t = mod(time / 2.0, 1.0);

    vec3 camPos = vec3(1.8, 5.5, -5.5) * 1.75;
    vec3 camTar = vec3(0.0, 0.0, 0.0);
    vec3 camUp = vec3(-1.0, 0.0, -1.5);
    mat3 camMat = calcLookAtMatrix(camPos, camTar, camUp);
    float focalLength = 5.0;

    vec3 rayDirection = normalize(camMat * vec3(p, focalLength));
    vec3 rayPosition = camPos;
    float rayLength = 0.0;
    float distance = 0.0;
    vec3 color = vec3(0.0);
    vec3 c;

    const float ITER = 82.0;
    const float FUDGE_FACTORR = 0.8;
    const float INTERSECTION_PRECISION = 0.001;
    const float MAX_DIST = 20.0;

    for (float i = 0.0; i < ITER; i += 1.0) {
        rayLength += max(INTERSECTION_PRECISION, abs(distance) * FUDGE_FACTORR);
        rayPosition = camPos + rayDirection * rayLength;
        distance = mapScene(rayPosition, t);

        c = vec3(max(0.0, 0.01 - abs(distance)) * 0.5);
        c *= vec3(1.4, 2.1, 1.7);

        c += vec3(0.6, 0.25, 0.7) * FUDGE_FACTORR / 160.0;
        c *= smoothstep(20.0, 7.0, length(rayPosition));

        float rl = smoothstep(MAX_DIST, 0.1, rayLength);
        c *= rl;
        c *= spectrum(rl * 6.0 - 0.6);

        color += c;
        if (rayLength > MAX_DIST) {
            break;
        }
    }

    color = pow(color, vec3(1.0 / 1.8)) * 2.0;
    color = pow(color, vec3(2.0)) * 3.0;
    color = pow(color, vec3(1.0 / 2.2));

    vec4 base = texture2D(uSampler, vTextureCoord);
    if (debugMode > 0.5 && debugMode < 1.5) {
        gl_FragColor = vec4(uv, 0.0, 1.0);
        return;
    }
    if (debugMode > 1.5) {
        gl_FragColor = vec4(vec3(base.a), 1.0);
        return;
    }
    float a = base.a;
    gl_FragColor = vec4(color * a * intensity, a);
}`
};

