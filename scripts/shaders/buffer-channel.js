import { SHADER_VERT } from "./common.js";
import { getSolidTexture } from "./textures.js";
import { adaptShaderToyBufferFragment } from "./shadertoy-adapter.js";

const CHANNEL_INDICES = [0, 1, 2, 3];
const MODULE_ID = "indy-fx";
const PIXI_TEXTURE_TYPES = typeof PIXI !== "undefined" ? PIXI?.TYPES ?? {} : {};
const PIXI_FLOAT_TYPE = PIXI_TEXTURE_TYPES?.FLOAT ?? null;
const PIXI_HALF_FLOAT_TYPE = PIXI_TEXTURE_TYPES?.HALF_FLOAT ?? null;
let _didWarnBufferPrecisionFallback = false;
const _renderTypeProbeCache = new Map();

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

function getRendererGlContext() {
  const renderer = canvas?.app?.renderer;
  const gl = renderer?.gl ?? renderer?.context?.gl ?? null;
  return { renderer, gl };
}

function canRenderType(gl, type) {
  if (!gl || !type) return false;
  try {
    const isWebGL2 =
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext;
    if (isWebGL2) {
      if (type === PIXI_FLOAT_TYPE) {
        return !!gl.getExtension("EXT_color_buffer_float");
      }
      if (type === PIXI_HALF_FLOAT_TYPE) {
        return (
          !!gl.getExtension("EXT_color_buffer_float") ||
          !!gl.getExtension("EXT_color_buffer_half_float")
        );
      }
      return false;
    }

    if (type === PIXI_FLOAT_TYPE) {
      return (
        !!gl.getExtension("OES_texture_float") &&
        !!gl.getExtension("WEBGL_color_buffer_float")
      );
    }
    if (type === PIXI_HALF_FLOAT_TYPE) {
      return (
        !!gl.getExtension("OES_texture_half_float") &&
        !!gl.getExtension("EXT_color_buffer_half_float")
      );
    }
  } catch (_err) {
    return false;
  }
  return false;
}

function makeRenderTexture(width, height, type = null) {
  const targetWidth = Math.max(2, Math.round(Number(width) || 2));
  const targetHeight = Math.max(2, Math.round(Number(height) || 2));
  const options = {
    width: targetWidth,
    height: targetHeight,
    resolution: 1,
    scaleMode: PIXI.SCALE_MODES.NEAREST,
  };
  if (type) options.type = type;
  if (PIXI.FORMATS?.RGBA !== undefined) options.format = PIXI.FORMATS.RGBA;
  return PIXI.RenderTexture.create(options);
}

function chooseBufferRenderTextureType() {
  const { renderer, gl } = getRendererGlContext();
  if (!renderer || !gl) return null;
  if (
    PIXI_FLOAT_TYPE &&
    (canRenderType(gl, PIXI_FLOAT_TYPE) ||
      probeRenderTextureType(renderer, gl, PIXI_FLOAT_TYPE))
  ) {
    return PIXI_FLOAT_TYPE;
  }
  if (
    PIXI_HALF_FLOAT_TYPE &&
    (canRenderType(gl, PIXI_HALF_FLOAT_TYPE) ||
      probeRenderTextureType(renderer, gl, PIXI_HALF_FLOAT_TYPE))
  ) {
    return PIXI_HALF_FLOAT_TYPE;
  }
  return null;
}

function clearGlErrors(gl) {
  if (!gl || typeof gl.getError !== "function") return;
  for (let i = 0; i < 8; i++) {
    const err = gl.getError();
    if (err === gl.NO_ERROR) break;
  }
}

function probeRenderTextureType(renderer, gl, type) {
  if (!renderer || !gl || !type) return false;
  const isWebGL2 =
    typeof WebGL2RenderingContext !== "undefined" &&
    gl instanceof WebGL2RenderingContext;
  const key = `${isWebGL2 ? 2 : 1}:${String(type)}`;
  if (_renderTypeProbeCache.has(key)) {
    return _renderTypeProbeCache.get(key) === true;
  }

  let ok = false;
  let probeRt = null;
  let probeSprite = null;
  try {
    clearGlErrors(gl);
    probeRt = makeRenderTexture(4, 4, type);
    if (probeRt?.baseTexture?.type !== type) {
      ok = false;
    } else {
      probeSprite = new PIXI.Sprite(getSolidTexture([255, 255, 255, 255], 2));
      renderer.render(probeSprite, {
        renderTexture: probeRt,
        clear: true,
      });
      const err = gl.getError?.();
      ok = err === undefined || err === gl.NO_ERROR;
    }
  } catch (_err) {
    ok = false;
  } finally {
    try {
      probeSprite?.destroy?.({ children: false, texture: false, baseTexture: false });
    } catch (_err) {
      // Non-fatal cleanup.
    }
    try {
      probeRt?.destroy?.(true);
    } catch (_err) {
      // Non-fatal cleanup.
    }
  }

  _renderTypeProbeCache.set(key, ok);
  return ok;
}

function warnBufferPrecisionFallbackOnce({ gl, renderTextureType } = {}) {
  if (_didWarnBufferPrecisionFallback) return;
  if (!gl) return;
  if (renderTextureType === PIXI_FLOAT_TYPE || renderTextureType === PIXI_HALF_FLOAT_TYPE) return;

  _didWarnBufferPrecisionFallback = true;
  const message =
    "Indy FX: ShaderToy buffer render textures are using 8-bit fallback (no float/half-float color buffer support). Some multi-pass shaders may render incorrectly.";
  try {
    ui?.notifications?.warn?.(message, { permanent: false });
  } catch (_err) {
    // Non-fatal.
  }
  console.warn(`${MODULE_ID} | ${message}`);
}

export class ShaderToyBufferChannel {
  constructor({ source, size = 512, width = null, height = null } = {}) {
    const fallbackSize = Math.max(2, Math.round(Number(size) || 512));
    const widthRaw = Number(width);
    const heightRaw = Number(height);
    this.width = Math.max(
      2,
      Math.round(
        Number.isFinite(widthRaw) && widthRaw > 0 ? widthRaw : fallbackSize,
      ),
    );
    this.height = Math.max(
      2,
      Math.round(
        Number.isFinite(heightRaw) && heightRaw > 0 ? heightRaw : fallbackSize,
      ),
    );
    this.size = Math.max(this.width, this.height);
    this.time = 0;
    this._renderTextureType = chooseBufferRenderTextureType();
    warnBufferPrecisionFallbackOnce({
      gl: getRendererGlContext().gl,
      renderTextureType: this._renderTextureType,
    });
    this.texture = makeRenderTexture(
      this.width,
      this.height,
      this._renderTextureType,
    );
    this._historyTexture = makeRenderTexture(
      this.width,
      this.height,
      this._renderTextureType,
    );
    if (this.texture?.baseTexture) {
      this.texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      this.texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
      this.texture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;
      this.texture.baseTexture.update?.();
    }
    if (this._historyTexture?.baseTexture) {
      this._historyTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      this._historyTexture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
      this._historyTexture.baseTexture.wrapMode = PIXI.WRAP_MODES.CLAMP;
      this._historyTexture.baseTexture.update?.();
    }
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
      cpfxChannelType0: 0,
      cpfxChannelType1: 0,
      cpfxChannelType2: 0,
      cpfxChannelType3: 0,
      cpfxVolumeLayout0: [1, 1, 1],
      cpfxVolumeLayout1: [1, 1, 1],
      cpfxVolumeLayout2: [1, 1, 1],
      cpfxVolumeLayout3: [1, 1, 1],
      cpfxSamplerVflip0: 0,
      cpfxSamplerVflip1: 0,
      cpfxSamplerVflip2: 0,
      cpfxSamplerVflip3: 0,
      shaderScale: 1.0,
      shaderScaleXY: [1, 1],
      shaderRotation: 0,
      shaderFlipX: 0,
      shaderFlipY: 0,
      cpfxPreserveTransparent: 1,
      cpfxForceOpaqueCaptureAlpha: 0,
      // Shadertoy-compatible buffer shaders commonly use iResolution.xy.
      // Keep it in sync with the internal buffer resolution.
      iResolution: [this.width, this.height, 1],
      resolution: [this.width, this.height],
    };

    const fragment = adaptShaderToyBufferFragment(source);
    const shader = PIXI.Shader.from(SHADER_VERT, fragment, uniforms);

    const verts = new Float32Array([
      0,
      0,
      this.width,
      0,
      this.width,
      this.height,
      0,
      this.height,
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
    this._historyCopySprite.width = this.width;
    this._historyCopySprite.height = this.height;

    this.update(0);
    debugBufferLog("buffer channel created", {
      size: this.size,
      width: this.width,
      height: this.height,
      renderTextureType: this._renderTextureType,
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

  setChannel(index, texture, resolution = [1, 1], options = {}) {
    if (!this.mesh?.shader?.uniforms) return;
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    this._selfChannelIndices.delete(index);
    const uniforms = this.mesh.shader.uniforms;
    const uniformName = `iChannel${index}`;
    uniforms[uniformName] = texture ?? this.fallbackTextures[index];
    this._setChannelResolution(index, resolution);
    const channelType = Number(options?.channelType ?? 0);
    uniforms[`cpfxChannelType${index}`] =
      Number.isFinite(channelType) && channelType >= 0 ? channelType : 0;
    const layout = Array.isArray(options?.volumeLayout)
      ? options.volumeLayout
      : [1, 1, 1];
    uniforms[`cpfxVolumeLayout${index}`] = [
      Math.max(1, Number(layout?.[0]) || 1),
      Math.max(1, Number(layout?.[1]) || 1),
      Math.max(1, Number(layout?.[2]) || 1),
    ];
    uniforms[`cpfxSamplerVflip${index}`] = options?.samplerVflip ? 1 : 0;
  }

  setChannelSelf(index, resolution = [this.width, this.height], options = {}) {
    if (!this.mesh?.shader?.uniforms) return;
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    this._selfChannelIndices.add(index);
    const uniforms = this.mesh.shader.uniforms;
    uniforms[`iChannel${index}`] = this._historyTexture;
    this._setChannelResolution(index, resolution);
    uniforms[`cpfxChannelType${index}`] = 0;
    uniforms[`cpfxVolumeLayout${index}`] = [1, 1, 1];
    uniforms[`cpfxSamplerVflip${index}`] = options?.samplerVflip ? 1 : 0;
  }

  update(dtSeconds = 1 / 60, renderer = canvas?.app?.renderer) {
    if (!this.texture || !this.mesh || !renderer) return;
    const dtValue = Number(dtSeconds);
    // Some ticker paths can report zero dt; keep feedback buffers animated.
    // Clamp very large dt spikes (low FPS/tab throttling) to avoid unstable
    // jumps in complex multipass shaders that depend on incremental updates.
    const dtRaw = Number.isFinite(dtValue) && dtValue > 0 ? dtValue : 1 / 60;
    const dt = Math.min(dtRaw, 1 / 24);
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
