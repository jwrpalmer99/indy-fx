import { SHADER_VERT } from "./common.js";
import { getSolidTexture } from "./textures.js";
import { adaptShaderToyBufferFragment } from "./shadertoy-adapter.js";

const CHANNEL_INDICES = [0, 1, 2, 3];

function getTextureSize(texture, fallback = 2) {
  const w = texture?.baseTexture?.realWidth ?? texture?.width ?? fallback;
  const h = texture?.baseTexture?.realHeight ?? texture?.height ?? fallback;
  return [Math.max(1, w), Math.max(1, h)];
}

export class ShaderToyBufferChannel {
  constructor({ source, size = 512 } = {}) {
    this.size = Math.max(2, Math.round(Number(size) || 512));
    this.time = 0;
    this.texture = PIXI.RenderTexture.create({
      width: this.size,
      height: this.size,
      resolution: 1,
      scaleMode: PIXI.SCALE_MODES.LINEAR
    });

    this.fallbackTextures = CHANNEL_INDICES.map(() => getSolidTexture([0, 0, 0, 255], 2));
    const iChannelResolution = [];
    for (const texture of this.fallbackTextures) {
      const [w, h] = getTextureSize(texture, 2);
      iChannelResolution.push(w, h, 1);
    }

    const uniforms = {
      iChannel0: this.fallbackTextures[0],
      iChannel1: this.fallbackTextures[1],
      iChannel2: this.fallbackTextures[2],
      iChannel3: this.fallbackTextures[3],
      iMouse: [0, 0, 0, 0],
      uTime: 0,
      iTimeDelta: 1 / 60,
      iFrame: 0,
      iFrameRate: 60,
      iDate: [0, 0, 0, 0],
      iChannelResolution,
      shaderScale: 1.0,
      shaderScaleXY: [1, 1],
      shaderRotation: 0,
      resolution: [this.size, this.size]
    };

    const fragment = adaptShaderToyBufferFragment(source);
    const shader = PIXI.Shader.from(SHADER_VERT, fragment, uniforms);

    const verts = new Float32Array([
      0, 0,
      this.size, 0,
      this.size, this.size,
      0, this.size
    ]);
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const geom = new PIXI.Geometry()
      .addAttribute("aVertexPosition", verts, 2)
      .addAttribute("aTextureCoord", uvs, 2)
      .addIndex(indices);

    this.mesh = new PIXI.Mesh(geom, shader);
    this.mesh.eventMode = "none";
    this.update(0);
  }

  setChannel(index, texture, resolution = [1, 1]) {
    if (!this.mesh?.shader?.uniforms) return;
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    const uniforms = this.mesh.shader.uniforms;
    const uniformName = `iChannel${index}`;
    uniforms[uniformName] = texture ?? this.fallbackTextures[index];

    const channelRes = Array.from(uniforms.iChannelResolution ?? []);
    while (channelRes.length < 12) channelRes.push(1);
    const w = Math.max(1, Number(resolution?.[0]) || 1);
    const h = Math.max(1, Number(resolution?.[1]) || 1);
    channelRes[index * 3] = w;
    channelRes[index * 3 + 1] = h;
    channelRes[index * 3 + 2] = 1;
    uniforms.iChannelResolution = channelRes;
  }

  update(dtSeconds = 1 / 60, renderer = canvas?.app?.renderer) {
    if (!this.texture || !this.mesh || !renderer) return;
    const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 1 / 60;
    const uniforms = this.mesh.shader.uniforms;

    this.time += dt;
    uniforms.uTime = this.time;
    uniforms.iTimeDelta = dt;
    uniforms.iFrame = (uniforms.iFrame ?? 0) + 1;
    uniforms.iFrameRate = dt > 0 ? (1 / dt) : 60;
    const now = new Date();
    const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + (now.getMilliseconds() / 1000);
    uniforms.iDate = [now.getFullYear(), now.getMonth() + 1, now.getDate(), seconds];

    renderer.render(this.mesh, {
      renderTexture: this.texture,
      clear: true
    });
  }

  destroy() {
    this.mesh?.destroy({ children: true, texture: false, baseTexture: false });
    this.mesh = null;
    this.texture?.destroy(true);
    this.texture = null;
    this.fallbackTextures = [];
  }
}
