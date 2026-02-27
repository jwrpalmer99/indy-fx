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
function normalizeSamplerFilter(value, fallback = "") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "nearest" || raw === "point") return "nearest";
  if (raw === "linear" || raw === "bilinear") return "linear";
  if (
    raw === "mipmap" ||
    raw === "mip" ||
    raw === "trilinear" ||
    raw === "linear-mipmap" ||
    raw === "linear_mipmap"
  ) {
    return "mipmap";
  }
  return fallback;
}

function normalizeSamplerWrap(value, fallback = "") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "clamp" || raw === "clamp_to_edge") return "clamp";
  if (
    raw === "mirror" ||
    raw === "mirrored" ||
    raw === "mirroredrepeat" ||
    raw === "mirrorrepeat" ||
    raw === "mirrored_repeat"
  ) {
    return "mirror";
  }
  if (raw === "repeat") return "repeat";
  return fallback;
}

function normalizeSamplerInternal(value, fallback = "") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (
    raw === "byte" ||
    raw === "ubyte" ||
    raw === "uint8" ||
    raw === "u8" ||
    raw === "unsigned_byte"
  ) {
    return "byte";
  }
  if (
    raw === "half" ||
    raw === "half_float" ||
    raw === "half-float" ||
    raw === "float16" ||
    raw === "f16"
  ) {
    return "half";
  }
  if (
    raw === "float" ||
    raw === "float32" ||
    raw === "f32"
  ) {
    return "float";
  }
  return fallback;
}

function applySamplerToBaseTexture(
  base,
  { samplerFilter = "", samplerWrap = "", fallbackFilter = "nearest", fallbackWrap = "clamp" } = {},
) {
  if (!base) return;
  const filter = normalizeSamplerFilter(samplerFilter, fallbackFilter);
  const wrap = normalizeSamplerWrap(samplerWrap, fallbackWrap);

  if (filter === "nearest") {
    base.scaleMode = PIXI.SCALE_MODES.NEAREST;
    base.mipmap = PIXI.MIPMAP_MODES.OFF;
  } else if (filter === "mipmap") {
    base.scaleMode = PIXI.SCALE_MODES.LINEAR;
    base.mipmap = PIXI.MIPMAP_MODES.ON;
  } else {
    base.scaleMode = PIXI.SCALE_MODES.LINEAR;
    base.mipmap = PIXI.MIPMAP_MODES.OFF;
  }

  if (wrap === "clamp") {
    base.wrapMode = PIXI.WRAP_MODES.CLAMP;
  } else if (wrap === "mirror") {
    base.wrapMode = PIXI.WRAP_MODES.MIRRORED_REPEAT ?? PIXI.WRAP_MODES.REPEAT;
  } else {
    base.wrapMode = PIXI.WRAP_MODES.REPEAT;
  }

  base.update?.();
}

function isPowerOfTwo(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return false;
  return (n & (n - 1)) === 0;
}

function tryGenerateMipmapsForRenderTexture(renderer, renderTexture) {
  const base = renderTexture?.baseTexture ?? null;
  if (!base) return;
  if (base.mipmap !== PIXI.MIPMAP_MODES.ON) return;
  const gl = renderer?.gl ?? renderer?.context?.gl ?? null;
  if (!gl) return;
  const isWebGL2 =
    typeof WebGL2RenderingContext !== "undefined" &&
    gl instanceof WebGL2RenderingContext;
  const width = Number(base.realWidth ?? base.width ?? renderTexture?.width ?? 0);
  const height = Number(base.realHeight ?? base.height ?? renderTexture?.height ?? 0);
  if (!isWebGL2 && (!isPowerOfTwo(width) || !isPowerOfTwo(height))) return;

  try {
    const textureSystem = renderer?.texture ?? renderer?.textureSystem ?? null;
    textureSystem?.bind?.(base, 0);
    const uid = renderer?.CONTEXT_UID ?? renderer?.context?.uid;
    const glTexEntry =
      uid != null ? base?._glTextures?.[uid] : null;
    const glTexture = glTexEntry?.texture ?? glTexEntry ?? null;
    if (!glTexture) return;
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.generateMipmap(gl.TEXTURE_2D);
  } catch (_err) {
    // Non-fatal; shader will still run without explicit mip generation.
  }
}

function isBufferDebugEnabled() {
  try {
    return game?.settings?.get?.(MODULE_ID, "shaderDebug") === true;
  } catch (_err) {
    return false;
  }
}

function formatDebugTimestamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function debugBufferLog(message, payload = undefined) {
  if (!isBufferDebugEnabled()) return;
  const prefix = `[${formatDebugTimestamp()}] ${MODULE_ID} | ${message}`;
  if (payload === undefined) console.debug(prefix);
  else console.debug(prefix, payload);
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

function getBufferValueClampForRenderType(renderTextureType) {
  // Half-float targets overflow to +/-Inf above ~65504. Clamp writes so
  // packed-data buffers (for example velocity encodings) don't poison samples.
  if (renderTextureType === PIXI_HALF_FLOAT_TYPE) return 60000;
  return 0;
}

function parseEditableAnnotation(commentText) {
  const text = String(commentText ?? "");
  const m = text.match(/@(?:editable|indyfx)\b\s*(?:=|:)?\s*([^\r\n]*)/i);
  if (!m) return null;
  // Allow chained annotations in one comment, e.g.:
  // @editable 0.5 @tip "..." @order 1
  return String(m[1] ?? "")
    .replace(/\s+@\w[\s\S]*$/i, "")
    .trim();
}

function parseEditableBoolLiteral(value) {
  let text = String(value ?? "").trim().toLowerCase();
  const ctor = text.match(/^bool\s*\(\s*(.*?)\s*\)$/);
  if (ctor) text = String(ctor[1] ?? "").trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}

function parseEditableNumberList(rawValue) {
  let text = String(rawValue ?? "").trim();
  if (!text) return [];
  const ctor = text.match(/^(?:vec[234])\s*\(([\s\S]*)\)\s*$/i);
  if (ctor) text = String(ctor[1] ?? "").trim();
  const arrayMatch = text.match(/^\[\s*([\s\S]*)\s*\]$/);
  if (arrayMatch) text = String(arrayMatch[1] ?? "").trim();
  if (!text) return [];
  return text
    .split(",")
    .map((part) => Number(String(part ?? "").trim()))
    .filter((value) => Number.isFinite(value));
}

function extractEditableUniformDefaults(source) {
  const text = String(source ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const defaults = {};

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = String(lines[lineIndex] ?? "");
    const m = line.match(
      /^\s*uniform\s+(float|int|bool|vec2|vec3|vec4)\s+([A-Za-z_]\w*)\s*;\s*(?:\/\/(.*))?\s*$/i,
    );
    if (!m) continue;
    const type = String(m[1] ?? "").toLowerCase();
    const name = String(m[2] ?? "").trim();
    if (!name) continue;

    let annotation = parseEditableAnnotation(m[3]);
    if (annotation === null) {
      const previousLine = lineIndex > 0 ? String(lines[lineIndex - 1] ?? "") : "";
      const previousComment = previousLine.match(/^\s*\/\/(.*)\s*$/);
      if (previousComment) annotation = parseEditableAnnotation(previousComment[1]);
    }
    if (annotation === null) continue;

    if (type === "vec2" || type === "vec3" || type === "vec4") {
      const expected = type === "vec2" ? 2 : type === "vec3" ? 3 : 4;
      const numbers = parseEditableNumberList(annotation);
      if (numbers.length < expected) continue;
      defaults[name] = numbers.slice(0, expected);
      continue;
    }

    if (type === "bool") {
      const parsedBool = parseEditableBoolLiteral(annotation);
      if (parsedBool === null) continue;
      defaults[name] = parsedBool;
      continue;
    }

    const parsedNumber = Number(annotation);
    if (!Number.isFinite(parsedNumber)) continue;
    defaults[name] = type === "int" ? Math.round(parsedNumber) : parsedNumber;
  }

  return defaults;
}

function normalizeCustomUniformValue(value) {
  if (value === true || value === false) return value;
  if (Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) {
    const values = value
      .slice(0, 4)
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    if (values.length >= 2) return values;
    return null;
  }
  if (value && typeof value === "object") {
    const values = ["x", "y", "z", "w"]
      .map((axis) => Number(value?.[axis]))
      .filter((entry) => Number.isFinite(entry));
    if (values.length >= 2) return values.slice(0, 4);
    return null;
  }
  return null;
}

function normalizeCustomUniformMap(value) {
  let source = value;
  if (typeof source === "string" && source.trim()) {
    try {
      source = JSON.parse(source);
    } catch (_err) {
      source = null;
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }
  const normalized = {};
  for (const [name, rawValue] of Object.entries(source)) {
    if (!/^[A-Za-z_]\w*$/.test(String(name ?? ""))) continue;
    const valueNormalized = normalizeCustomUniformValue(rawValue);
    if (valueNormalized === null) continue;
    normalized[String(name)] = valueNormalized;
  }
  return normalized;
}

function chooseBufferRenderTextureType(preferredInternal = "") {
  const { renderer, gl } = getRendererGlContext();
  if (!renderer || !gl) return null;
  const preferred = normalizeSamplerInternal(preferredInternal, "auto");
  if (preferred === "byte") return null;
  if (preferred === "half") {
    if (
      PIXI_HALF_FLOAT_TYPE &&
      (canRenderType(gl, PIXI_HALF_FLOAT_TYPE) ||
        probeRenderTextureType(renderer, gl, PIXI_HALF_FLOAT_TYPE))
    ) {
      return PIXI_HALF_FLOAT_TYPE;
    }
    if (
      PIXI_FLOAT_TYPE &&
      (canRenderType(gl, PIXI_FLOAT_TYPE) ||
        probeRenderTextureType(renderer, gl, PIXI_FLOAT_TYPE))
    ) {
      return PIXI_FLOAT_TYPE;
    }
    return null;
  }
  if (preferred === "float") {
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

function warnBufferPrecisionFallbackOnce({
  gl,
  renderTextureType,
  preferredInternal = "",
} = {}) {
  if (_didWarnBufferPrecisionFallback) return;
  const preferred = normalizeSamplerInternal(preferredInternal, "auto");
  if (preferred === "byte") return;
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
  constructor({
    source,
    size = 512,
    width = null,
    height = null,
    samplerInternal = "",
    customUniforms = null,
  } = {}) {
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
    this._lastUpdateMs = 0;
    this._samplerInternal = normalizeSamplerInternal(samplerInternal, "auto");
    this._renderTextureType = chooseBufferRenderTextureType(this._samplerInternal);
    warnBufferPrecisionFallbackOnce({
      gl: getRendererGlContext().gl,
      renderTextureType: this._renderTextureType,
      preferredInternal: this._samplerInternal,
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
    applySamplerToBaseTexture(this.texture?.baseTexture, {
      samplerFilter: "nearest",
      samplerWrap: "clamp",
    });
    applySamplerToBaseTexture(this._historyTexture?.baseTexture, {
      samplerFilter: "nearest",
      samplerWrap: "clamp",
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
      cpfxBufferValueClamp: getBufferValueClampForRenderType(
        this._renderTextureType,
      ),
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

    const editableDefaults = extractEditableUniformDefaults(source);
    for (const [name, value] of Object.entries(editableDefaults)) {
      if (Object.prototype.hasOwnProperty.call(uniforms, name)) continue;
      uniforms[name] = value;
    }
    const explicitCustomUniforms = normalizeCustomUniformMap(customUniforms);
    for (const [name, value] of Object.entries(explicitCustomUniforms)) {
      uniforms[name] = value;
    }

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
    this._clearSprite = new PIXI.Sprite(getSolidTexture([0, 0, 0, 0], 2));
    this._clearSprite.eventMode = "none";
    this._clearSprite.width = this.width;
    this._clearSprite.height = this.height;

    this._clearTargets();
    debugBufferLog("buffer channel created", {
      size: this.size,
      width: this.width,
      height: this.height,
      renderTextureType: this._renderTextureType,
      samplerInternal: this._samplerInternal,
      selfChannelCount: this._selfChannelIndices.size,
    });
  }

  _clearTargets(renderer = canvas?.app?.renderer) {
    if (!renderer || !this.texture || !this._historyTexture || !this._clearSprite) return;
    renderer.render(this._clearSprite, {
      renderTexture: this.texture,
      clear: true,
    });
    tryGenerateMipmapsForRenderTexture(renderer, this.texture);
    renderer.render(this._clearSprite, {
      renderTexture: this._historyTexture,
      clear: true,
    });
    tryGenerateMipmapsForRenderTexture(renderer, this._historyTexture);
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
    if (options?.samplerFilter || options?.samplerWrap) {
      applySamplerToBaseTexture((uniforms[uniformName] ?? null)?.baseTexture, {
        samplerFilter: options?.samplerFilter,
        samplerWrap: options?.samplerWrap,
      });
    }
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
    applySamplerToBaseTexture(this._historyTexture?.baseTexture, {
      samplerFilter: options?.samplerFilter,
      samplerWrap: options?.samplerWrap,
    });
  }

  update(dtSeconds = 1 / 60, renderer = canvas?.app?.renderer) {
    if (!this.texture || !this.mesh || !renderer) return;
    const tStart =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : 0;
    const dtValue = Number(dtSeconds);
    // Some ticker paths can report zero dt; keep feedback buffers animated.
    // Only clamp pathological dt spikes to avoid runaway steps while preserving
    // normal-time sync with the parent shader.
    const dtRaw = Number.isFinite(dtValue) && dtValue > 0 ? dtValue : 1 / 60;
    const dt = Math.min(dtRaw, 0.25);
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
    tryGenerateMipmapsForRenderTexture(renderer, this.texture);

    if (this._selfChannelIndices.size > 0 && this._historyTexture) {
      this._historyCopySprite.texture = this.texture;
      renderer.render(this._historyCopySprite, {
        renderTexture: this._historyTexture,
        clear: true,
      });
      tryGenerateMipmapsForRenderTexture(renderer, this._historyTexture);
    }
    uniforms.iFrame = currentFrame + 1;
    if (tStart > 0) {
      const tEnd = performance.now();
      this._lastUpdateMs = Math.max(0, tEnd - tStart);
    }
  }

  destroy() {
    this.mesh?.destroy({ children: true, texture: false, baseTexture: false });
    this.mesh = null;
    this._historyCopySprite?.destroy({ children: true, texture: false, baseTexture: false });
    this._historyCopySprite = null;
    this._clearSprite?.destroy({ children: true, texture: false, baseTexture: false });
    this._clearSprite = null;
    this.texture?.destroy(true);
    this.texture = null;
    this._historyTexture?.destroy(true);
    this._historyTexture = null;
    this._selfChannelIndices?.clear?.();
    this._selfChannelIndices = null;
    this.fallbackTextures = [];
  }
}
