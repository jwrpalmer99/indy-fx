import { SHADER_VERT } from "./common.js";
import { getSolidTexture } from "./textures.js";
import { adaptShaderToyBufferFragment } from "./shadertoy-adapter.js";

const CHANNEL_INDICES = [0, 1, 2, 3];
const MODULE_ID = "indy-fx";

function isBufferDebugEnabled() {
  try {
    return game?.settings?.get?.(MODULE_ID, "shaderDebug") === true;
  } catch (_err) {
    return false;
  }
}

function debugBufferLog(message, payload = undefined) {
  if (!isBufferDebugEnabled()) return;
  if (payload === undefined) console.debug(`${MODULE_ID} | ${message}`);
  else console.debug(`${MODULE_ID} | ${message}`, payload);
}

function getTextureSize(texture, fallback = 2) {
  const w = texture?.baseTexture?.realWidth ?? texture?.width ?? fallback;
  const h = texture?.baseTexture?.realHeight ?? texture?.height ?? fallback;
  return [Math.max(1, w), Math.max(1, h)];
}

export class ShaderToyBufferChannel {
  constructor({ source, size = 512 } = {}) {
    this.size = Math.max(2, Math.round(Number(size) || 512));
    this.time = 0;
    this._debugTickCounter = 0;
    this.texture = PIXI.RenderTexture.create({
      width: this.size,
      height: this.size,
      resolution: 1,
      scaleMode: PIXI.SCALE_MODES.LINEAR,
    });
    this._historyTexture = PIXI.RenderTexture.create({
      width: this.size,
      height: this.size,
      resolution: 1,
      scaleMode: PIXI.SCALE_MODES.LINEAR,
    });
    this._selfChannelIndices = new Set();

    this.fallbackTextures = CHANNEL_INDICES.map(() =>
      getSolidTexture([0, 0, 0, 255], 2),
    );
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
      iTime: 0,
      iTimeDelta: 1 / 60,
      iFrame: 0,
      iFrameRate: 60,
      iDate: [0, 0, 0, 0],
      iChannelResolution,
      shaderScale: 1.0,
      shaderScaleXY: [1, 1],
      shaderRotation: 0,
      shaderFlipX: 0,
      shaderFlipY: 0,
      cpfxPreserveTransparent: 1,
      cpfxForceOpaqueCaptureAlpha: 0,
      // Shadertoy-compatible buffer shaders commonly use iResolution.xy.
      // Keep it in sync with the internal buffer resolution.
      iResolution: [this.size, this.size, 1],
      resolution: [this.size, this.size],
    };

    const fragment = adaptShaderToyBufferFragment(source);
    const shader = PIXI.Shader.from(SHADER_VERT, fragment, uniforms);

    const verts = new Float32Array([
      0,
      0,
      this.size,
      0,
      this.size,
      this.size,
      0,
      this.size,
    ]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const geom = new PIXI.Geometry()
      .addAttribute("aVertexPosition", verts, 2)
      .addAttribute("aTextureCoord", uvs, 2)
      .addIndex(indices);

    this.mesh = new PIXI.Mesh(geom, shader);
    this.mesh.eventMode = "none";

    this._historyCopySprite = new PIXI.Sprite(this.texture);
    this._historyCopySprite.eventMode = "none";
    this._historyCopySprite.width = this.size;
    this._historyCopySprite.height = this.size;

    this.update(0);
    debugBufferLog("buffer channel created", {
      size: this.size,
      selfChannelCount: this._selfChannelIndices.size,
    });
  }

  _setChannelResolution(index, resolution = [1, 1]) {
    const uniforms = this.mesh?.shader?.uniforms;
    if (!uniforms) return;
    const channelRes = Array.from(uniforms.iChannelResolution ?? []);
    while (channelRes.length < 12) channelRes.push(1);
    const w = Math.max(1, Number(resolution?.[0]) || 1);
    const h = Math.max(1, Number(resolution?.[1]) || 1);
    channelRes[index * 3] = w;
    channelRes[index * 3 + 1] = h;
    channelRes[index * 3 + 2] = 1;
    uniforms.iChannelResolution = channelRes;
  }

  setChannel(index, texture, resolution = [1, 1]) {
    if (!this.mesh?.shader?.uniforms) return;
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    this._selfChannelIndices.delete(index);
    const uniforms = this.mesh.shader.uniforms;
    const uniformName = `iChannel${index}`;
    uniforms[uniformName] = texture ?? this.fallbackTextures[index];
    this._setChannelResolution(index, resolution);
  }

  setChannelSelf(index, resolution = [this.size, this.size]) {
    if (!this.mesh?.shader?.uniforms) return;
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    this._selfChannelIndices.add(index);
    const uniforms = this.mesh.shader.uniforms;
    uniforms[`iChannel${index}`] = this._historyTexture;
    this._setChannelResolution(index, resolution);
  }

  update(dtSeconds = 1 / 60, renderer = canvas?.app?.renderer) {
    if (!this.texture || !this.mesh || !renderer) return;
    const dtRaw = Number(dtSeconds);
    // Some ticker paths can report zero dt; keep feedback buffers animated.
    const dt = Number.isFinite(dtRaw) && dtRaw > 0 ? dtRaw : 1 / 60;
    const usedFallbackDt = !(Number.isFinite(dtRaw) && dtRaw > 0);
    const uniforms = this.mesh.shader.uniforms;

    const currentFrame = Number.isFinite(Number(uniforms.iFrame))
      ? Number(uniforms.iFrame)
      : 0;
    this.time += dt;
    uniforms.uTime = this.time;
    uniforms.iTime = this.time;
    uniforms.iTimeDelta = dt;
    // ShaderToy buffer shaders frequently branch on iFrame==0 for one-time init.
    // Present current frame to this render, then increment after rendering.
    uniforms.iFrame = currentFrame;
    uniforms.iFrameRate = dt > 0 ? 1 / dt : 60;
    const now = new Date();
    const seconds =
      now.getHours() * 3600 +
      now.getMinutes() * 60 +
      now.getSeconds() +
      now.getMilliseconds() / 1000;
    uniforms.iDate = [
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate(),
      seconds,
    ];
    this._debugTickCounter += 1;
    if (this._debugTickCounter === 1 || this._debugTickCounter % 60 === 0) {
      debugBufferLog("buffer tick", {
        frame: currentFrame,
        nextFrame: currentFrame + 1,
        iTime: Number(uniforms.iTime ?? 0),
        dtRaw: Number.isFinite(dtRaw) ? dtRaw : null,
        dtUsed: dt,
        usedFallbackDt,
        selfChannelCount: this._selfChannelIndices.size,
        iChannelResolution: Array.from(uniforms.iChannelResolution ?? []),
      });
    }

    for (const index of this._selfChannelIndices) {
      uniforms[`iChannel${index}`] = this._historyTexture;
    }

    renderer.render(this.mesh, {
      renderTexture: this.texture,
      clear: true,
    });

    if (this._selfChannelIndices.size > 0 && this._historyTexture) {
      this._historyCopySprite.texture = this.texture;
      renderer.render(this._historyCopySprite, {
        renderTexture: this._historyTexture,
        clear: true,
      });
    }
    uniforms.iFrame = currentFrame + 1;
  }

  destroy() {
    this.mesh?.destroy({ children: true, texture: false, baseTexture: false });
    this.mesh = null;
    this._historyCopySprite?.destroy({ children: true, texture: false, baseTexture: false });
    this._historyCopySprite = null;
    this.texture?.destroy(true);
    this.texture = null;
    this._historyTexture?.destroy(true);
    this._historyTexture = null;
    this._selfChannelIndices?.clear?.();
    this._selfChannelIndices = null;
    this.fallbackTextures = [];
  }
}
