import { SHADER_VERT, buildBaseUniforms } from "./common.js";
import {
  getCircleMaskTexture,
  getNoiseTexture,
  getRadialTexture,
  getSolidTexture,
} from "./textures.js";
import { noiseShaderDefinition } from "./builtin/noise.js";
import { torusShaderDefinition } from "./builtin/torus.js";
import { globeShaderDefinition } from "./builtin/globe.js";
import { ShaderToyBufferChannel } from "./buffer-channel.js";
import { PlaceableImageChannel } from "./placeable-image-channel.js";
import { SceneAreaChannel } from "./scene-channel.js";
import {
  adaptShaderToyFragment,
  extractReferencedChannels,
  validateShaderToySource,
} from "./shadertoy-adapter.js";

const BUILTIN_SHADERS = [
  noiseShaderDefinition,
  torusShaderDefinition,
  globeShaderDefinition,
];
const DEFAULT_SHADER_ID = "noise";
const CHANNEL_INDICES = [0, 1, 2, 3];
const CHANNEL_MODES = new Set([
  "auto",
  "none",
  "empty",
  "white",
  "noise",
  "noiseBw",
  "noiseRgb",
  "sceneCapture",
  "tokenTileImage",
  "tokenImage",
  "tileImage",
  "image",
  "buffer",
]);
const MAX_BUFFER_CHAIN_DEPTH = 10;
const DEFAULT_BUFFER_SIZE = 512;
const IMPORTED_NOISE_TEXTURE_SIZE = 1024;
const PLACEABLE_IMAGE_CAPTURE_SIZE = 1024;
const PLACEABLE_IMAGE_PREVIEW_SIZE = 512;
const SHADERTOY_MEDIA_ORIGIN = "https://www.shadertoy.com";
const THUMBNAIL_SIZE = 256;
const THUMBNAIL_CAPTURE_SECONDS = 1.0;
const BACKGROUND_COMPILE_SIZE = 96;
const PREVIEW_SCENE_CAPTURE_TEXTURE = "modules/indy-fx/images/indyFX_solid.webp";
const PREVIEW_PLACEABLE_CAPTURE_TEXTURE = "modules/indy-fx/images/indyFX.webp";
const IMPORTED_SHADER_DEFAULT_KEYS = [
  "layer",
  "useGradientMask",
  "gradientMaskFadeStart",
  "alpha",
  "intensity",
  "speed",
  "bloom",
  "bloomStrength",
  "bloomBlur",
  "bloomQuality",
  "scale",
  "scaleX",
  "scaleY",
  "scaleToToken",
  "tokenScaleMultiplier",
  "scaleWithTokenTexture",
  "rotateWithToken",
  "flipHorizontal",
  "flipVertical",
  "shaderRotationDeg",
  "shapeDistanceUnits",
  "falloffPower",
  "density",
  "flowMode",
  "flowSpeed",
  "flowTurbulence",
  "colorA",
  "colorB",
  "captureScale",
  "captureRotationDeg",
  "captureFlipHorizontal",
  "captureFlipVertical",
  "displayTimeMs",
  "easeInMs",
  "easeOutMs",
"preloadShader",
];

function isDebugLoggingEnabled(moduleId = "indy-fx") {
  try {
    return game?.settings?.get?.(String(moduleId ?? "indy-fx"), "shaderDebug") === true;
  } catch (_err) {
    return false;
  }
}

function debugLog(moduleId, message, payload = undefined) {
  if (!isDebugLoggingEnabled(moduleId)) return;
  if (payload === undefined) console.debug(`${moduleId} | ${message}`);
  else console.debug(`${moduleId} | ${message}`, payload);
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeHexColor(value, fallback = "FFFFFF") {
  const fallbackClean = String(fallback ?? "FFFFFF")
    .replace(/^#|^0x/i, "")
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 6)
    .padStart(6, "0")
    .toUpperCase();
  if (value === null || value === undefined) return fallbackClean;
  if (Number.isFinite(Number(value))) {
    const n = Math.max(0, Math.min(0xffffff, Math.round(Number(value))));
    return n.toString(16).padStart(6, "0").toUpperCase();
  }
  const clean = String(value)
    .trim()
    .replace(/^#|^0x/i, "")
    .replace(/[^0-9a-f]/gi, "");
  if (!clean) return fallbackClean;
  return clean.slice(0, 6).padStart(6, "0").toUpperCase();
}

function hexColorToNumber(value, fallback = 0xffffff) {
  const normalized = normalizeHexColor(
    value,
    fallback.toString(16).padStart(6, "0"),
  );
  const n = parseInt(normalized, 16);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeName(name) {
  const cleaned = String(name ?? "").trim();
  return cleaned || "Imported Shader";
}

function slugify(input) {
  return (
    String(input)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "shader"
  );
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function normalizeChannelMode(mode) {
  const candidate = String(mode ?? "").trim();
  if (candidate === "noise") return "noiseRgb";
  if (candidate === "tokenImage" || candidate === "tileImage")
    return "tokenTileImage";
  if (CHANNEL_MODES.has(candidate)) return candidate;
  return "auto";
}

function parseBooleanLike(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true" ||
    value === "on"
  );
}

function getTextureSize(texture, fallback = 256) {
  const w = texture?.baseTexture?.realWidth ?? texture?.width ?? fallback;
  const h = texture?.baseTexture?.realHeight ?? texture?.height ?? fallback;
  return [Math.max(1, w), Math.max(1, h)];
}

function getTextureDebugInfo(texture, fallback = 256) {
  if (!texture) return { exists: false };
  const base = texture?.baseTexture ?? null;
  const resource = base?.resource ?? null;
  const source = resource?.source ?? null;
  let sourceHint = null;
  try {
    if (typeof source === "string") sourceHint = source;
    else if (typeof source?.currentSrc === "string" && source.currentSrc) sourceHint = source.currentSrc;
    else if (typeof source?.src === "string" && source.src) sourceHint = source.src;
    else if (source?.tagName) sourceHint = String(source.tagName);
  } catch (_err) {
    sourceHint = null;
  }
  return {
    exists: true,
    className: texture?.constructor?.name ?? typeof texture,
    valid: base?.valid === true,
    width: Number(base?.realWidth ?? texture?.width ?? fallback),
    height: Number(base?.realHeight ?? texture?.height ?? fallback),
    resolution: Number(base?.resolution ?? texture?.resolution ?? 1),
    resourceClass: resource?.constructor?.name ?? null,
    resourceUrl: resource?.url ?? sourceHint ?? null,
    sourceClass: source?.constructor?.name ?? null,
  };
}

function normalizeBufferSize(value, fallback = DEFAULT_BUFFER_SIZE) {
  const size = Number(value);
  if (!Number.isFinite(size)) return fallback;
  return Math.max(64, Math.min(2048, Math.round(size)));
}

function normalizeChannelInput(raw, depth = 0) {
  if (!raw || typeof raw !== "object")
    return {
      mode: "auto",
      path: "",
      source: "",
      channels: {},
      size: DEFAULT_BUFFER_SIZE,
    };
  const nested = {};
  const nestedRaw = raw.channels;
  if (
    depth < MAX_BUFFER_CHAIN_DEPTH &&
    nestedRaw &&
    typeof nestedRaw === "object"
  ) {
    for (const index of CHANNEL_INDICES) {
      const key = `iChannel${index}`;
      const child = normalizeChannelInput(
        nestedRaw?.[key] ?? nestedRaw?.[index],
        depth + 1,
      );
      if (child.mode !== "auto") nested[key] = child;
    }
  }
  return {
    mode: normalizeChannelMode(raw.mode),
    path: String(raw.path ?? "").trim(),
    source: String(raw.source ?? "").trim(),
    channels: nested,
    size: normalizeBufferSize(raw.size, DEFAULT_BUFFER_SIZE),
  };
}

function channelConfigNeedsLivePreview(config, depth = 0) {
  if (!config || typeof config !== "object") return false;
  if (depth > MAX_BUFFER_CHAIN_DEPTH) return false;
  for (const index of CHANNEL_INDICES) {
    const key = `iChannel${index}`;
    const entry = config[key] ?? config[index];
    if (!entry || typeof entry !== "object") continue;
    const mode = normalizeChannelMode(entry.mode ?? "auto");
    if (mode === "sceneCapture" || mode === "tokenTileImage") return true;
    if (mode === "buffer" && channelConfigNeedsLivePreview(entry.channels, depth + 1)) {
      return true;
    }
  }
  return false;
}

function channelConfigHasMode(config, matchMode, depth = 0) {
  if (!config || typeof config !== "object") return false;
  if (depth > MAX_BUFFER_CHAIN_DEPTH) return false;
  for (const index of CHANNEL_INDICES) {
    const key = `iChannel${index}`;
    const entry = config[key] ?? config[index];
    if (!entry || typeof entry !== "object") continue;
    const mode = normalizeChannelMode(entry.mode ?? "auto");
    if (mode === matchMode) return true;
    if (mode === "buffer" && channelConfigHasMode(entry.channels, matchMode, depth + 1)) {
      return true;
    }
  }
  return false;
}

function extractShaderToyId(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const direct = raw.match(/^[A-Za-z0-9_-]{6,12}$/);
  if (direct) return direct[0];
  const m = raw.match(/shadertoy\.com\/(?:view|embed)\/([A-Za-z0-9_-]{6,12})/i);
  if (m) return m[1];
  return "";
}

function toShaderToyMediaUrl(src) {
  const value = String(src ?? "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${SHADERTOY_MEDIA_ORIGIN}${value}`;
  return `${SHADERTOY_MEDIA_ORIGIN}/${value.replace(/^\/+/, "")}`;
}

function stripCodeFence(text) {
  const raw = String(text ?? "").trim();
  const fenced = raw.match(/^```(?:json|js|javascript)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : raw;
}

function extractBracketPayload(text) {
  const raw = String(text ?? "");
  const firstObj = raw.indexOf("{");
  const firstArr = raw.indexOf("[");
  let start = -1;
  if (firstObj < 0) start = firstArr;
  else if (firstArr < 0) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start < 0) return raw.trim();

  const lastObj = raw.lastIndexOf("}");
  const lastArr = raw.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (end <= start) return raw.trim();
  return raw.slice(start, end + 1).trim();
}

function parseShaderToyJsonPayload(input) {
  if (input && typeof input === "object") return input;
  let text = stripCodeFence(String(input ?? ""));
  text = text.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("JSON payload is empty.");

  const extracted = extractBracketPayload(text);
  const candidates = [text, extracted].filter(
    (v, idx, arr) => v && arr.indexOf(v) === idx,
  );
  const errors = [];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      errors.push(err);
    }
  }

  for (const candidate of candidates) {
    try {
      // Fallback for console object-literal dumps (single quotes/trailing commas).
      // This is user-provided local input, not remote code execution.
      return Function(`"use strict"; return (${candidate});`)();
    } catch (err) {
      errors.push(err);
    }
  }

  const first = errors[0];
  throw new Error(
    `Could not parse ShaderToy JSON. ${String(first?.message ?? first ?? "Unknown parse error")}`,
  );
}

function withGlobalAlpha(fragmentSource) {
  let source = String(fragmentSource ?? "");
  const alphaSupport = `
uniform float globalAlpha;
vec4 cpfx_applyAlpha(vec4 c) {
  return vec4(c.rgb * globalAlpha, c.a * globalAlpha);
}
`;

  const precisionRe = /(precision\s+\w+\s+float\s*;\s*\n?)/;
  if (precisionRe.test(source)) {
    source = source.replace(precisionRe, `$1${alphaSupport}`);
  } else {
    source = `precision mediump float;\n${alphaSupport}${source}`;
  }

  source = source.replace(
    /gl_FragColor\s*=\s*([^;]+);/g,
    "gl_FragColor = cpfx_applyAlpha($1);",
  );
  return source;
}

function createPreviewGeometry(size) {
  const s = Math.max(2, Number(size) || THUMBNAIL_SIZE);
  const verts = new Float32Array([0, 0, s, 0, s, s, 0, s]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", verts, 2)
    .addAttribute("aTextureCoord", uvs, 2)
    .addIndex(indices);
}

function updatePreviewShaderUniforms(shader, dtSeconds, speed, frameTicker) {
  const dt = Math.max(0, Number(dtSeconds) || 0);
  shader.uniforms.time = frameTicker * 0.015 * speed;
  if ("uTime" in shader.uniforms) shader.uniforms.uTime = shader.uniforms.time;
  if ("iTimeDelta" in shader.uniforms) shader.uniforms.iTimeDelta = dt;
  if ("iFrame" in shader.uniforms)
    shader.uniforms.iFrame = (shader.uniforms.iFrame ?? 0) + 1;
  if ("iFrameRate" in shader.uniforms)
    shader.uniforms.iFrameRate = dt > 0 ? 1 / dt : 60;
  if ("iDate" in shader.uniforms) {
    const now = new Date();
    const seconds =
      now.getHours() * 3600 +
      now.getMinutes() * 60 +
      now.getSeconds() +
      now.getMilliseconds() / 1000;
    shader.uniforms.iDate = [
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate(),
      seconds,
    ];
  }
}

export class ShaderManager {

  constructor(moduleId) {
    this.moduleId = moduleId;
    this.shaderLibrarySetting = "shaderLibrary";
    this.selectionSetting = "shaderPreset";
    this.builtinById = new Map(BUILTIN_SHADERS.map((s) => [s.id, s]));

    this._shaderLibraryRevision = 0;
    this._shaderLibrarySettingHookId = null;
    this._shaderChoiceCache = null;
    this._shaderChoiceCacheByTarget = new Map();
    this._tokenTileUsageCache = null;
    this._backgroundCompilePending = new Set();
    this._backgroundCompileDone = new Set();
    this._previewCaptureTextureCache = new Map();
    this._pendingPreviewTextureLoads = new Set();
    this._pendingThumbnailRegenerations = new Map();
    this._thumbnailRenderer = null;
    this._thumbnailRendererCanvas = null;
    this._thumbnailRendererSize = 0;
  
    this._ensurePreviewReferenceTexturesLoaded();
  }


  registerSettings() {
    game.settings.register(this.moduleId, this.shaderLibrarySetting, {
      name: "Imported shader presets",
      scope: "world",
      config: false,
      type: Object,
      default: [],
    });
  }

  _getModuleAssetPath(relativePath, fallbackPath = "") {
    const relative = String(relativePath ?? "").trim().replace(/^\/+/, "");
    const fallback = String(fallbackPath ?? "").trim();
    if (!relative) return fallback;

    const modulePathRaw = game?.modules?.get?.(this.moduleId)?.path;
    const modulePath = String(modulePathRaw ?? "").trim().replace(/\/+$/, "");
    if (modulePath) return `${modulePath}/${relative}`;

    const moduleId = String(this.moduleId ?? "").trim();
    if (moduleId) return `modules/${moduleId}/${relative}`;
    return fallback;
  }

  _getPreviewSceneCaptureTexturePath() {
    return this._getModuleAssetPath(
      "images/indyFX_solid.webp",
      PREVIEW_SCENE_CAPTURE_TEXTURE,
    );
  }

  _getPreviewPlaceableCaptureTexturePath() {
    return this._getModuleAssetPath(
      "images/indyFX.webp",
      PREVIEW_PLACEABLE_CAPTURE_TEXTURE,
    );
  }

  _ensurePreviewReferenceTexturesLoaded() {
    this._ensurePreviewTextureLoaded(this._getPreviewSceneCaptureTexturePath());
    this._ensurePreviewTextureLoaded(this._getPreviewPlaceableCaptureTexturePath());
  }

  _ensurePreviewTextureLoaded(path) {
    if (!globalThis.PIXI?.Texture?.from) return null;
    const normalized = String(path ?? "").trim();
    if (!normalized) return null;

    const texture = PIXI.Texture.from(normalized);
    const base = texture?.baseTexture;
    if (!base) return null;

    base.wrapMode = PIXI.WRAP_MODES.CLAMP;
    base.scaleMode = PIXI.SCALE_MODES.LINEAR;
    base.mipmap = PIXI.MIPMAP_MODES.OFF;

    if (base.valid === true) {
      base.update?.();
      return texture;
    }

    const key = normalized;
    if (!this._pendingPreviewTextureLoads.has(key)) {
      this._pendingPreviewTextureLoads.add(key);
      const finalize = () => {
        this._pendingPreviewTextureLoads.delete(key);
        this._previewCaptureTextureCache.clear();
        debugLog(this.moduleId, "preview reference texture ready", {
          path: normalized,
          valid: base.valid === true,
          width: Number(base.realWidth ?? 0),
          height: Number(base.realHeight ?? 0),
        });
      };
      base.once?.("loaded", finalize);
      base.once?.("update", finalize);
      base.once?.("error", (err) => {
        this._pendingPreviewTextureLoads.delete(key);
        debugLog(this.moduleId, "preview reference texture failed", {
          path: normalized,
          message: String(err?.message ?? err),
        });
      });
    }

    base.update?.();
    return texture;
  }

  _ensureThumbnailRenderer(size = THUMBNAIL_SIZE) {
    const nextSize = Math.max(
      32,
      Math.min(2048, Math.round(Number(size) || THUMBNAIL_SIZE)),
    );
    const needsCreate =
      !this._thumbnailRenderer || this._thumbnailRenderer.destroyed === true;

    if (needsCreate) {
      try {
        this._thumbnailRenderer?.destroy?.(false);
      } catch (_err) {
        /* ignore */
      }
      const canvas = document.createElement("canvas");
      canvas.width = nextSize;
      canvas.height = nextSize;
      let renderer = null;
      try {
        renderer = new PIXI.Renderer({
          canvas,
          width: nextSize,
          height: nextSize,
          antialias: true,
          autoDensity: false,
          backgroundAlpha: 0,
          clearBeforeRender: true,
          powerPreference: "high-performance",
        });
      } catch (_errCanvas) {
        renderer = new PIXI.Renderer({
          view: canvas,
          width: nextSize,
          height: nextSize,
          antialias: true,
          autoDensity: false,
          backgroundAlpha: 0,
          clearBeforeRender: true,
          powerPreference: "high-performance",
        });
      }
      this._thumbnailRenderer = renderer;
      this._thumbnailRendererCanvas =
        renderer?.view ?? renderer?.canvas ?? canvas;
      this._thumbnailRendererSize = nextSize;
      debugLog(this.moduleId, "thumbnail renderer created", { size: nextSize });
      return this._thumbnailRenderer;
    }

    if (this._thumbnailRendererSize !== nextSize) {
      try {
        this._thumbnailRenderer.resize(nextSize, nextSize);
      } catch (_err) {
        /* ignore */
      }
      this._thumbnailRendererSize = nextSize;
      debugLog(this.moduleId, "thumbnail renderer resized", { size: nextSize });
    }

    return this._thumbnailRenderer;
  }

  _invalidateShaderChoiceCaches() {
    this._shaderChoiceCache = null;
    this._tokenTileUsageCache = null;
    this._shaderChoiceCacheByTarget.clear();
    this._backgroundCompileDone.clear();
  }

  _ensureShaderLibrarySettingHook() {
    if (this._shaderLibrarySettingHookId !== null) return;
    if (!globalThis?.Hooks?.on) return;

    this._shaderLibrarySettingHookId = Hooks.on("updateSetting", (setting) => {
      const key = String(setting?.key ?? setting?.id ?? "").trim();
      if (key !== (this.moduleId + "." + this.shaderLibrarySetting)) return;
      this._shaderLibraryRevision += 1;
      this._invalidateShaderChoiceCaches();
    });
  }
  _resolvePreviewTarget({ targetType = null, targetId = null } = {}) {
    const explicitType = String(targetType ?? "").trim().toLowerCase();
    const explicitId = String(targetId ?? "").trim();
    if ((explicitType === "token" || explicitType === "tile") && explicitId) {
      return { targetType: explicitType, targetId: explicitId };
    }
    return { targetType: null, targetId: null };
  }

  _buildLiveScenePreviewChannel(size = THUMBNAIL_SIZE) {
    const stage = canvas?.stage;
    const app = canvas?.app;
    const renderer = app?.renderer;
    if (!stage || !app?.screen || !renderer) return null;

    const captureSize = Math.max(64, Math.min(2048, Math.round(Number(size) || THUMBNAIL_SIZE)));
    const zoom = Math.max(0.0001, Math.abs(stage.worldTransform?.a ?? 1));
    const centerGlobal = new PIXI.Point(app.screen.width * 0.5, app.screen.height * 0.5);
    const centerWorld = stage.toLocal(centerGlobal);
    const radiusWorldX = Math.max(1, (app.screen.width * 0.5) / zoom);
    const radiusWorldY = Math.max(1, (app.screen.height * 0.5) / zoom);

    const channel = new SceneAreaChannel(captureSize);
    channel.update({
      centerWorld,
      radiusWorldX,
      radiusWorldY,
    });
    return channel;
  }

  _debugSampleTextureAlpha(texture, sampleSize = 16, rendererOverride = null) {
    if (!isDebugLoggingEnabled(this.moduleId)) return null;
    const renderer = rendererOverride ?? canvas?.app?.renderer;
    const extractPixels =
      (typeof renderer?.extract?.pixels === "function"
        ? renderer.extract.pixels.bind(renderer.extract)
        : null) ??
      (typeof renderer?.plugins?.extract?.pixels === "function"
        ? renderer.plugins.extract.pixels.bind(renderer.plugins.extract)
        : null);
    if (!renderer || !extractPixels) {
      debugLog(this.moduleId, "preview alpha sampler unavailable", {
        hasRenderer: !!renderer,
        hasExtractPixels: typeof renderer?.extract?.pixels === "function",
        hasPluginExtractPixels: typeof renderer?.plugins?.extract?.pixels === "function",
      });
      return null;
    }
    if (!texture) return null;

    const size = Math.max(4, Math.min(32, Math.round(Number(sampleSize) || 16)));
    const target = PIXI.RenderTexture.create({
      width: size,
      height: size,
      resolution: 1,
      scaleMode: PIXI.SCALE_MODES.LINEAR,
    });
    const stage = new PIXI.Container();
    const sprite = new PIXI.Sprite(texture);
    sprite.x = 0;
    sprite.y = 0;
    sprite.width = size;
    sprite.height = size;
    stage.addChild(sprite);

    try {
      renderer.render(stage, { renderTexture: target, clear: true });
      const pixels = extractPixels(target);
      if (!pixels || !pixels.length) return { ok: false, reason: "no-pixels" };

      let minA = 255;
      let maxA = 0;
      let nonZero = 0;
      let sumA = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        const a = Number(pixels[i]) || 0;
        if (a > 0) nonZero += 1;
        if (a < minA) minA = a;
        if (a > maxA) maxA = a;
        sumA += a;
      }
      const total = Math.max(1, Math.floor(pixels.length / 4));
      return {
        ok: true,
        total,
        nonZero,
        zero: total - nonZero,
        minA,
        maxA,
        avgA: Number((sumA / total).toFixed(3)),
      };
    } catch (err) {
      return {
        ok: false,
        reason: String(err?.message ?? err),
      };
    } finally {
      stage.destroy({ children: true });
      target.destroy(true);
    }
  }

  _getTransformedPreviewCaptureTexture(
    textureInput,
    {
      captureRotationDeg = 0,
      captureFlipHorizontal = false,
      captureFlipVertical = false,
      forceOpaqueAlpha = false,
    } = {},
  ) {
    let sourceTexture = null;
    let cacheSourceKey = null;

    if (typeof textureInput === "string") {
      const path = String(textureInput ?? "").trim();
      if (!path) return null;
      sourceTexture = this._ensurePreviewTextureLoaded(path);
      cacheSourceKey = "url:" + path;
    } else if (
      textureInput instanceof PIXI.Texture ||
      textureInput instanceof PIXI.RenderTexture ||
      (textureInput && typeof textureInput === "object" && textureInput.baseTexture)
    ) {
      sourceTexture = textureInput;
    }

    if (!sourceTexture) {
      debugLog(this.moduleId, "preview capture texture: no source", {
        textureInputType: typeof textureInput,
      });
      return null;
    }

    debugLog(this.moduleId, "preview capture texture: source resolved", {
      textureInputType: typeof textureInput,
      cacheSourceKey,
      source: getTextureDebugInfo(sourceTexture, 1024),
    });

    const rotationDeg = toFiniteNumber(captureRotationDeg, 0);
    const flipH = parseBooleanLike(captureFlipHorizontal);
    const flipV = parseBooleanLike(captureFlipVertical);
    const forceOpaque = parseBooleanLike(forceOpaqueAlpha);
    const needsTransform =
      Math.abs(rotationDeg) > 0.0001 ||
      flipH === true ||
      flipV === true ||
      forceOpaque === true;

    const sourceBase = sourceTexture?.baseTexture;
    if (sourceBase) {
      sourceBase.wrapMode = PIXI.WRAP_MODES.CLAMP;
      sourceBase.scaleMode = PIXI.SCALE_MODES.LINEAR;
      sourceBase.mipmap = PIXI.MIPMAP_MODES.OFF;
      sourceBase.update?.();
      if (sourceBase.valid !== true) {
        debugLog(this.moduleId, "preview capture texture: source base not valid", {
          cacheSourceKey,
          needsTransform,
          source: getTextureDebugInfo(sourceTexture, 1024),
        });
        // Keep returning the source texture so preview channels can become valid
        // once the asset finishes loading, instead of hard-falling to null.
        return sourceTexture;
      }
    }
    if (!needsTransform) {
      debugLog(this.moduleId, "preview capture texture: passthrough", {
        cacheSourceKey,
        rotationDeg,
        flipH,
        flipV,
        forceOpaque,
        source: getTextureDebugInfo(sourceTexture, 1024),
      });
      return sourceTexture;
    }

    let cacheKey = null;
    if (cacheSourceKey) {
      cacheKey = [
        cacheSourceKey,
        Number(rotationDeg).toFixed(4),
        flipH ? "1" : "0",
        flipV ? "1" : "0",
        forceOpaque ? "1" : "0",
      ].join("|");
      const cached = this._previewCaptureTextureCache.get(cacheKey);
      const cachedBaseValid = cached?.baseTexture?.valid === true || cached?.valid === true;
      const cachedIsLegacyRenderTexture = cached instanceof PIXI.RenderTexture;
      if (cachedBaseValid && !cachedIsLegacyRenderTexture) {
        debugLog(this.moduleId, "preview capture texture: cache hit", {
          cacheKey,
          texture: getTextureDebugInfo(cached, 1024),
        });
        return cached;
      }
      if (cachedIsLegacyRenderTexture) {
        debugLog(this.moduleId, "preview capture texture: cache bypass legacy renderTexture", {
          cacheKey,
          texture: getTextureDebugInfo(cached, 1024),
        });
      }
    }

    const [width, height] = getTextureSize(sourceTexture, 1024);

    // Use CPU canvas transform for image-backed textures so the resulting texture
    // can be sampled by any renderer context (editor/library preview renderers).
    const sourceElement = sourceBase?.resource?.source ?? null;
    if (sourceElement && typeof document !== "undefined") {
      try {
        const canvasEl = document.createElement("canvas");
        canvasEl.width = Math.max(1, Math.round(width));
        canvasEl.height = Math.max(1, Math.round(height));
        const ctx = canvasEl.getContext("2d", { alpha: true });
        if (ctx) {
          ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
          ctx.save();
          ctx.translate(canvasEl.width * 0.5, canvasEl.height * 0.5);
          ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
          ctx.rotate((rotationDeg * Math.PI) / 180);
          ctx.drawImage(
            sourceElement,
            -canvasEl.width * 0.5,
            -canvasEl.height * 0.5,
            canvasEl.width,
            canvasEl.height,
          );
          ctx.restore();

          if (forceOpaque) {
            const img = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
            const data = img.data;
            for (let i = 3; i < data.length; i += 4) data[i] = 255;
            ctx.putImageData(img, 0, 0);
          }

          const transformed = PIXI.Texture.from(canvasEl);
          const transformedBase = transformed?.baseTexture;
          if (transformedBase) {
            transformedBase.wrapMode = PIXI.WRAP_MODES.CLAMP;
            transformedBase.scaleMode = PIXI.SCALE_MODES.LINEAR;
            transformedBase.mipmap = PIXI.MIPMAP_MODES.OFF;
            transformedBase.update?.();
          }
          if (cacheKey) this._previewCaptureTextureCache.set(cacheKey, transformed);
          debugLog(this.moduleId, "preview capture texture: transformed (canvas)", {
            cacheKey,
            rotationDeg,
            flipH,
            flipV,
            forceOpaque,
            source: getTextureDebugInfo(sourceTexture, 1024),
            target: getTextureDebugInfo(transformed, 1024),
            targetAlphaSample: this._debugSampleTextureAlpha(transformed, 16),
          });
          return transformed;
        }
      } catch (err) {
        debugLog(this.moduleId, "preview capture texture: canvas transform failed", {
          cacheSourceKey,
          message: String(err?.message ?? err),
        });
      }
    }

    // Fallback path for non-image-backed textures.
    const renderer = canvas?.app?.renderer;
    if (!renderer) {
      debugLog(this.moduleId, "preview capture texture: no renderer", {
        cacheSourceKey,
      });
      return sourceTexture;
    }

    const target = PIXI.RenderTexture.create({
      width,
      height,
      resolution: 1,
      scaleMode: PIXI.SCALE_MODES.LINEAR,
    });
    const stage = new PIXI.Container();
    const sprite = new PIXI.Sprite(sourceTexture);
    sprite.anchor.set(0.5, 0.5);
    sprite.x = width * 0.5;
    sprite.y = height * 0.5;
    sprite.scale.set(flipH ? -1 : 1, flipV ? -1 : 1);
    sprite.rotation = (rotationDeg * Math.PI) / 180;
    if (forceOpaque) {
      sprite.filters = [
        new PIXI.Filter(
          undefined,
          "varying vec2 vTextureCoord;uniform sampler2D uSampler;void main(){vec4 c=texture2D(uSampler,vTextureCoord);gl_FragColor=vec4(c.rgb,1.0);}",
        ),
      ];
    }
    stage.addChild(sprite);
    try {
      renderer.render(stage, { renderTexture: target, clear: true });
      const base = target?.baseTexture;
      if (base) {
        base.wrapMode = PIXI.WRAP_MODES.CLAMP;
        base.scaleMode = PIXI.SCALE_MODES.LINEAR;
        base.mipmap = PIXI.MIPMAP_MODES.OFF;
        base.update?.();
      }
      if (cacheKey) this._previewCaptureTextureCache.set(cacheKey, target);
      debugLog(this.moduleId, "preview capture texture: transformed (renderTexture)", {
        cacheKey,
        rotationDeg,
        flipH,
        flipV,
        forceOpaque,
        source: getTextureDebugInfo(sourceTexture, 1024),
        target: getTextureDebugInfo(target, 1024),
        targetAlphaSample: this._debugSampleTextureAlpha(target, 16),
      });
      return target;
    } catch (err) {
      debugLog(this.moduleId, "preview capture texture: transform failed", {
        cacheSourceKey,
        message: String(err?.message ?? err),
      });
      target.destroy(true);
      return sourceTexture;
    } finally {
      stage.destroy({ children: true });
    }
  }

  getDefaultImportedShaderDefaults() {

    return {
      layer: String(
        game.settings.get(this.moduleId, "shaderLayer") ?? "inherit",
      ),
      useGradientMask:
        game.settings.get(this.moduleId, "shaderGradientMask") === true,
      gradientMaskFadeStart: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderGradientFadeStart"),
        0.8,
      ),
      alpha: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderAlpha"),
        1.0,
      ),
      intensity: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderIntensity"),
        1.0,
      ),
      speed: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderSpeed"),
        1.0,
      ),
      bloom: true,
      bloomStrength: 1.0,
      bloomBlur: 7.0,
      bloomQuality: 2.0,
      scale: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderScale"),
        1.0,
      ),
      scaleX: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderScaleX"),
        1.0,
      ),
      scaleY: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderScaleY"),
        1.0,
      ),
      scaleToToken: false,
      tokenScaleMultiplier: 1.0,
      scaleWithTokenTexture: false,
      rotateWithToken: false,
      flipHorizontal: false,
      flipVertical: false,
      shaderRotationDeg: 0,
      shapeDistanceUnits: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderRadiusUnits"),
        20,
      ),
      falloffPower: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderFalloff"),
        1.6,
      ),
      density: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderDensity"),
        1.0,
      ),
      flowMode: game.settings.get(this.moduleId, "shaderFlow") === true ? 1 : 0,
      flowSpeed: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderFlowSpeed"),
        0.8,
      ),
      flowTurbulence: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderFlowTurbulence"),
        0.35,
      ),
      colorA: normalizeHexColor(
        game.settings.get(this.moduleId, "shaderColorA"),
        "FF4A9A",
      ),
      colorB: normalizeHexColor(
        game.settings.get(this.moduleId, "shaderColorB"),
        "FFB14A",
      ),
      captureScale: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderCaptureScale"),
        1.0,
      ),
      captureRotationDeg: 0.0,
      captureFlipHorizontal: false,
      captureFlipVertical: false,
      displayTimeMs: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderDisplayTimeMs"),
        0,
      ),
      easeInMs: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderEaseInMs"),
        250,
      ),
      easeOutMs: toFiniteNumber(
        game.settings.get(this.moduleId, "shaderEaseOutMs"),
        250,
      ),
    preloadShader: false,
    };
  }

  normalizeImportedShaderDefaults(defaults = {}, fallback = null) {
    const source = defaults && typeof defaults === "object" ? defaults : {};
    const base =
      fallback && typeof fallback === "object"
        ? foundry.utils.mergeObject({}, fallback, { inplace: false })
        : this.getDefaultImportedShaderDefaults();

    const layerRaw = String(source.layer ?? base.layer ?? "inherit").trim();
    const layer = [
      "inherit",
      "token",
      "interfacePrimary",
      "interface",
      "effects",
    ].includes(layerRaw)
      ? layerRaw
      : "inherit";

    const normalized = {
      layer,
      useGradientMask:
        source.useGradientMask === true ||
        source.useGradientMask === "on" ||
        source.useGradientMask === "true",
      gradientMaskFadeStart: Math.max(
        0,
        Math.min(
          1,
          toFiniteNumber(
            source.gradientMaskFadeStart,
            base.gradientMaskFadeStart,
          ),
        ),
      ),
      alpha: Math.max(0, Math.min(1, toFiniteNumber(source.alpha, base.alpha))),
      intensity: Math.max(
        0,
        Math.min(50, toFiniteNumber(source.intensity, base.intensity)),
      ),
      speed: Math.max(
        0,
        Math.min(10, toFiniteNumber(source.speed, base.speed)),
      ),
      bloom:
        source.bloom === true ||
        source.bloom === 1 ||
        source.bloom === "1" ||
        source.bloom === "true" ||
        source.bloom === "on",
      bloomStrength: Math.max(
        0,
        Math.min(3, toFiniteNumber(source.bloomStrength, base.bloomStrength)),
      ),
      bloomBlur: Math.max(
        0,
        Math.min(20, toFiniteNumber(source.bloomBlur, base.bloomBlur)),
      ),
      bloomQuality: Math.max(
        0,
        Math.min(8, toFiniteNumber(source.bloomQuality, base.bloomQuality)),
      ),
      scale: Math.max(
        0.1,
        Math.min(10, toFiniteNumber(source.scale, base.scale)),
      ),
      scaleX: Math.max(
        0.1,
        Math.min(10, toFiniteNumber(source.scaleX, base.scaleX)),
      ),
      scaleY: Math.max(
        0.1,
        Math.min(10, toFiniteNumber(source.scaleY, base.scaleY)),
      ),
      scaleToToken:
        source.scaleToToken === true ||
        source.scaleToToken === 1 ||
        source.scaleToToken === "1" ||
        source.scaleToToken === "true" ||
        source.scaleToToken === "on",
      tokenScaleMultiplier: Math.max(
        0.01,
        Math.min(
          10,
          toFiniteNumber(source.tokenScaleMultiplier ?? source.shaderTokenScaleMultiplier, base.tokenScaleMultiplier),
        ),
      ),
      scaleWithTokenTexture:
        source.scaleWithTokenTexture === true ||
        source.scaleWithTokenTexture === 1 ||
        source.scaleWithTokenTexture === "1" ||
        source.scaleWithTokenTexture === "true" ||
        source.scaleWithTokenTexture === "on",
      rotateWithToken:
        source.rotateWithToken === true ||
        source.rotateWithToken === 1 ||
        source.rotateWithToken === "1" ||
        source.rotateWithToken === "true" ||
        source.rotateWithToken === "on",
      flipHorizontal:
        source.flipHorizontal === true ||
        source.flipHorizontal === 1 ||
        source.flipHorizontal === "1" ||
        source.flipHorizontal === "true" ||
        source.flipHorizontal === "on",
      flipVertical:
        source.flipVertical === true ||
        source.flipVertical === 1 ||
        source.flipVertical === "1" ||
        source.flipVertical === "true" ||
        source.flipVertical === "on",
      shaderRotationDeg: Math.max(
        -36000,
        Math.min(
          36000,
          toFiniteNumber(source.shaderRotationDeg, base.shaderRotationDeg),
        ),
      ),
      shapeDistanceUnits: Math.max(
        1,
        Math.min(
          500,
          toFiniteNumber(
            source.shapeDistanceUnits ?? source.radiusUnits,
            base.shapeDistanceUnits ?? base.radiusUnits,
          ),
        ),
      ),
      falloffPower: Math.max(
        0.2,
        Math.min(6, toFiniteNumber(source.falloffPower, base.falloffPower)),
      ),
      density: Math.max(
        0.2,
        Math.min(4, toFiniteNumber(source.density, base.density)),
      ),
      flowMode: toFiniteNumber(source.flowMode, base.flowMode) > 0 ? 1 : 0,
      flowSpeed: Math.max(
        0,
        Math.min(5, toFiniteNumber(source.flowSpeed, base.flowSpeed)),
      ),
      flowTurbulence: Math.max(
        0,
        Math.min(2, toFiniteNumber(source.flowTurbulence, base.flowTurbulence)),
      ),
      colorA: normalizeHexColor(source.colorA, base.colorA),
      colorB: normalizeHexColor(source.colorB, base.colorB),
      captureScale: Math.max(
        0.25,
        Math.min(4, toFiniteNumber(source.captureScale, base.captureScale)),
      ),
      captureRotationDeg: Math.max(
        -36000,
        Math.min(
          36000,
          toFiniteNumber(source.captureRotationDeg, base.captureRotationDeg),
        ),
      ),
      captureFlipHorizontal:
        source.captureFlipHorizontal === true ||
        source.captureFlipHorizontal === 1 ||
        source.captureFlipHorizontal === "1" ||
        source.captureFlipHorizontal === "true" ||
        source.captureFlipHorizontal === "on",
      captureFlipVertical:
        source.captureFlipVertical === true ||
        source.captureFlipVertical === 1 ||
        source.captureFlipVertical === "1" ||
        source.captureFlipVertical === "true" ||
        source.captureFlipVertical === "on",
      displayTimeMs: Math.max(
        0,
        Math.min(
          120000,
          toFiniteNumber(source.displayTimeMs, base.displayTimeMs),
        ),
      ),
      easeInMs: Math.max(
        0,
        Math.min(60000, toFiniteNumber(source.easeInMs, base.easeInMs)),
      ),
      easeOutMs: Math.max(
        0,
        Math.min(60000, toFiniteNumber(source.easeOutMs, base.easeOutMs)),
      ),
    preloadShader:
        source.preloadShader === true ||
        source.preloadShader === 1 ||
        source.preloadShader === "1" ||
        source.preloadShader === "true" ||
        source.preloadShader === "on",
    };

    return normalized;
  }
  getRecordShaderDefaults(
    record,
    { runtime = false, defaultsOverride = null } = {},
  ) {
    let storageDefaults = this.normalizeImportedShaderDefaults(
      record?.defaults,
      this.getDefaultImportedShaderDefaults(),
    );
    if (defaultsOverride && typeof defaultsOverride === "object") {
      storageDefaults = this.normalizeImportedShaderDefaults(
        foundry.utils.mergeObject(
          foundry.utils.deepClone(storageDefaults),
          defaultsOverride,
          { inplace: false, recursive: true },
        ),
        this.getDefaultImportedShaderDefaults(),
      );
    }
    if (!runtime) return storageDefaults;
    return {
      ...storageDefaults,
      colorA: hexColorToNumber(storageDefaults.colorA, 0xff4a9a),
      colorB: hexColorToNumber(storageDefaults.colorB, 0xffb14a),
    };
  }

  getImportedShaderDefaults(shaderId, { runtime = false } = {}) {
    const record = this.getImportedRecord(shaderId);
    if (!record) return null;
    return this.getRecordShaderDefaults(record, { runtime });
  }

  _createImportedShaderPreview(
    shaderId,
    {
      size = THUMBNAIL_SIZE,
      defaults = null,
      source = null,
      channels = null,
      autoAssignCapture = null,
      reason = "",
      targetType = null,
      targetId = null,
      useLiveCapturePreview = false,
      captureRotationDeg = null,
      captureFlipHorizontal = null,
      captureFlipVertical = null,
    } = {},
  ) {
    const perfNow = () => {
      try {
        const n = globalThis?.performance?.now?.();
        if (Number.isFinite(n)) return n;
      } catch (_err) {
        // Fallback below.
      }
      return Date.now();
    };
    const tStart = perfNow();
    const phaseMs = {
      deepClone: 0,
      sourceOverride: 0,
      referencedChannels: 0,
      channelResolve: 0,
      defaultsResolve: 0,
      definitionBuild: 0,
      makeShader: 0,
      meshSetup: 0,
      bufferSetup: 0,
    };

    const record = this.getImportedRecord(shaderId);
    if (!record) {
      console.warn(`${this.moduleId} | editor preview failed: missing imported record`, { shaderId });
      return null;
    }

    const tDeepClone0 = perfNow();
    const previewRecord = foundry.utils.deepClone(record);
    phaseMs.deepClone = perfNow() - tDeepClone0;

    const tSource0 = perfNow();
    if (source !== null && source !== undefined) {
      const sourceText = String(source ?? "").trim();
      if (sourceText) {
        try {
          previewRecord.source = validateShaderToySource(sourceText);
        } catch (err) {
          console.warn(`${this.moduleId} | editor preview failed: invalid draft source`, {
            shaderId,
            message: String(err?.message ?? err),
          });
          return null;
        }
      }
    }
    phaseMs.sourceOverride = perfNow() - tSource0;

    const tRefs0 = perfNow();
    try {
      previewRecord.referencedChannels = extractReferencedChannels(
        previewRecord.source,
      );
    } catch (_err) {
      previewRecord.referencedChannels = [];
    }
    phaseMs.referencedChannels = perfNow() - tRefs0;

    const tChannels0 = perfNow();
    if (channels && typeof channels === "object") {
      try {
        previewRecord.channels = this.buildChannelConfig({
          source: previewRecord.source,
          channels,
          autoAssignCapture:
            autoAssignCapture === null || autoAssignCapture === undefined
              ? true
              : autoAssignCapture === true,
        });
      } catch (err) {
        console.warn(`${this.moduleId} | editor preview failed: invalid channel config`, {
          shaderId,
          message: String(err?.message ?? err),
        });
        return null;
      }
    } else {
      previewRecord.channels = this.getRecordChannelConfig(previewRecord);
    }
    phaseMs.channelResolve = perfNow() - tChannels0;

    const tDefaults0 = perfNow();
    const runtimeDefaults = this.getRecordShaderDefaults(previewRecord, {
      runtime: true,
      defaultsOverride: defaults,
    });
    phaseMs.defaultsResolve = perfNow() - tDefaults0;
    debugLog(this.moduleId, "shader preview compile", {
      shaderId: previewRecord.id,
      reason: String(reason || "unspecified"),
      sourceOverrideUsed: source !== null && source !== undefined,
      channelOverrideUsed: !!channels,
      size,
    });

    const tDefinition0 = perfNow();
    const previewDefinition = {
      id: previewRecord.id,
      label: sanitizeName(previewRecord.label ?? previewRecord.name),
      type: "imported",
      requiresResolution: true,
      usesNoiseTexture: true,
      channelConfig: this.getRecordChannelConfig(previewRecord),
      referencedChannels: toArray(previewRecord.referencedChannels)
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v <= 3),
      fragment: adaptShaderToyFragment(previewRecord.source),
    };
    phaseMs.definitionBuild = perfNow() - tDefinition0;

    const previewUseGradientMask = runtimeDefaults.useGradientMask === true;
    const previewAlpha = Math.max(
      0,
      Math.min(1, toFiniteNumber(runtimeDefaults.alpha, 1)),
    );
    const explicitCaptureRotation = toFiniteNumber(captureRotationDeg, Number.NaN);
    const effectiveCaptureRotationDeg = Number.isFinite(explicitCaptureRotation)
      ? explicitCaptureRotation
      : toFiniteNumber(runtimeDefaults?.captureRotationDeg, 0);
    const effectiveCaptureFlipHorizontal =
      captureFlipHorizontal === null || captureFlipHorizontal === undefined
        ? parseBooleanLike(runtimeDefaults?.captureFlipHorizontal)
        : parseBooleanLike(captureFlipHorizontal);
    const effectiveCaptureFlipVertical =
      captureFlipVertical === null || captureFlipVertical === undefined
        ? parseBooleanLike(runtimeDefaults?.captureFlipVertical)
        : parseBooleanLike(captureFlipVertical);
    const enableLiveCapturePreview = useLiveCapturePreview === true;
    const previewTarget = enableLiveCapturePreview
      ? this._resolvePreviewTarget({ targetType, targetId })
      : { targetType: null, targetId: null };
    const needsLiveCapturePreview =
      enableLiveCapturePreview &&
      channelConfigNeedsLivePreview(previewDefinition.channelConfig);
    const previewSceneChannel = needsLiveCapturePreview
      ? this._buildLiveScenePreviewChannel(size)
      : null;
    const previewSceneTexture =
      previewSceneChannel?.texture ?? this._getPreviewSceneCaptureTexturePath();
    const previewPlaceableTexture = this._getPreviewPlaceableCaptureTexturePath();
    const previewHasSceneCapture = channelConfigHasMode(
      previewDefinition.channelConfig,
      "sceneCapture",
    );
    const previewHasTokenTileCapture = channelConfigHasMode(
      previewDefinition.channelConfig,
      "tokenTileImage",
    );
    const previewTokenTileFallback =
      previewHasTokenTileCapture && !previewTarget?.targetId;
    const previewForceOpaqueCaptureAlpha =
      previewUseGradientMask !== true &&
      (previewHasSceneCapture || previewTokenTileFallback);
    const previewCaptureMaskTextureCandidate =
      previewUseGradientMask !== true && previewTokenTileFallback
        ? this._getTransformedPreviewCaptureTexture(previewPlaceableTexture, {
                        captureRotationDeg: effectiveCaptureRotationDeg,
            captureFlipHorizontal: effectiveCaptureFlipHorizontal,
            captureFlipVertical: effectiveCaptureFlipVertical,
            forceOpaqueAlpha: false,
          })
        : null;
    const previewCaptureMaskTexture =
      previewCaptureMaskTextureCandidate?.baseTexture?.valid === true
        ? previewCaptureMaskTextureCandidate
        : null;
    const tMakeShader0 = perfNow();
    const shaderResult = this.makeShader({
            ...runtimeDefaults,
      captureRotationDeg: effectiveCaptureRotationDeg,
      captureFlipHorizontal: effectiveCaptureFlipHorizontal,
      captureFlipVertical: effectiveCaptureFlipVertical,
      shaderId: previewRecord.id,
      definitionOverride: previewDefinition,
      resolution: [size, size],
      // Keep non-gradient previews square; gradient previews still show radial falloff.
      // For token/tile capture fallback previews, use preview placeable alpha as the mask.
      maskTexture: previewUseGradientMask
        ? undefined
        : previewCaptureMaskTexture ?? getSolidTexture([255, 255, 255, 255], 2),
      useGradientMask: previewUseGradientMask,
      gradientMaskFadeStart: toFiniteNumber(
        runtimeDefaults.gradientMaskFadeStart,
        0.8,
      ),
      alpha: previewAlpha,
      previewSceneCaptureTexture: previewSceneTexture,
      previewPlaceableTexture: previewPlaceableTexture,
      previewMode: true,
      previewForceOpaqueCaptureAlpha,
      targetType: previewTarget.targetType,
      targetId: previewTarget.targetId,
      debugMode: 0,
      noiseOffset: [0, 0],
      iMouse: [0, 0, 0, 0],
      iFrame: 0,
      iTimeDelta: 1 / 60,
      iFrameRate: 60,
      iDate: [0, 0, 0, 0],
    });
    phaseMs.makeShader = perfNow() - tMakeShader0;
    const previewMaskSource = !previewUseGradientMask
      ? previewCaptureMaskTexture?.baseTexture?.valid === true
        ? "captureMaskTexture"
        : "solidFallback"
      : "gradientMask";
    const previewChannelDiagnostics = {};
    for (const index of CHANNEL_INDICES) {
      const key = `iChannel${index}`;
      const tex = shaderResult?.shader?.uniforms?.[key] ?? null;
      previewChannelDiagnostics[key] = {
        texture: getTextureDebugInfo(tex, size),
        alphaSample: this._debugSampleTextureAlpha(tex, 16),
      };
    }
    debugLog(this.moduleId, "shader preview alpha policy", {
      shaderId: previewRecord.id,
      previewUseGradientMask,
      previewForceOpaqueCaptureAlpha,
      cpfxPreserveTransparent: shaderResult?.shader?.uniforms?.cpfxPreserveTransparent,
      cpfxForceOpaqueCaptureAlpha: shaderResult?.shader?.uniforms?.cpfxForceOpaqueCaptureAlpha,
      iChannelResolution: shaderResult?.shader?.uniforms?.iChannelResolution ?? [],
      previewSceneTexture: getTextureDebugInfo(previewSceneTexture, size),
      previewPlaceableTexture,
      previewTarget,
      previewHasSceneCapture,
      previewHasTokenTileCapture,
      previewTokenTileFallback,
      previewMaskSource,
      effectiveCaptureRotationDeg,
      effectiveCaptureFlipHorizontal,
      effectiveCaptureFlipVertical,
      previewCaptureMaskTexture: getTextureDebugInfo(previewCaptureMaskTexture, size),
      previewCaptureMaskTextureCandidate: getTextureDebugInfo(
        previewCaptureMaskTextureCandidate,
        size,
      ),
      channelDiagnostics: previewChannelDiagnostics,
      runtimeDefaults: {
        scale: runtimeDefaults?.scale,
        scaleX: runtimeDefaults?.scaleX,
        scaleY: runtimeDefaults?.scaleY,
        alpha: runtimeDefaults?.alpha,
        intensity: runtimeDefaults?.intensity,
      },
      shaderUniforms: {
        globalAlpha: shaderResult?.shader?.uniforms?.globalAlpha,
        intensity: shaderResult?.shader?.uniforms?.intensity,
        shaderScale: shaderResult?.shader?.uniforms?.shaderScale,
        shaderScaleXY: shaderResult?.shader?.uniforms?.shaderScaleXY,
      },
    });

    const shader = shaderResult.shader;
    const previewBloom = parseBooleanLike(
      defaults?.bloom ?? runtimeDefaults?.bloom ?? true,
    );
    const previewBloomStrength = Math.max(
      0,
      toFiniteNumber(
        defaults?.bloomStrength,
        toFiniteNumber(runtimeDefaults?.bloomStrength, 1.0),
      ),
    );
    const previewBloomBlur = Math.max(
      0,
      toFiniteNumber(
        defaults?.bloomBlur,
        toFiniteNumber(runtimeDefaults?.bloomBlur, 7),
      ),
    );
    const previewBloomQuality = Math.max(
      0,
      toFiniteNumber(
        defaults?.bloomQuality,
        toFiniteNumber(runtimeDefaults?.bloomQuality, 2),
      ),
    );

    const tMesh0 = perfNow();
    const container = new PIXI.Container();
    const geometry = createPreviewGeometry(size);
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.alpha = 1.0;
    mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
    if (previewBloom && PIXI.filters?.BloomFilter) {
      const bloom = new PIXI.filters.BloomFilter(
        previewBloomStrength,
        previewBloomBlur,
        previewBloomQuality,
      );
      bloom.padding = size * 0.8 + previewBloomBlur * 30;
      mesh.filters = [bloom];
    }
    container.addChild(mesh);
    phaseMs.meshSetup = perfNow() - tMesh0;

    let frameTicker = 0;
    const speed = toFiniteNumber(runtimeDefaults.speed, 1);
    const tBuffers0 = perfNow();
    const runtimeBuffers = (shaderResult.runtimeBufferChannels ?? [])
      .map((entry) => entry?.runtimeBuffer)
      .filter((buffer) => buffer && typeof buffer.update === "function");
    const runtimeImageChannels = (shaderResult.runtimeImageChannels ?? [])
      .filter((channel) => channel && typeof channel.destroy === "function");
    phaseMs.bufferSetup = perfNow() - tBuffers0;

    let pendingBufferDt = 0;
    let debugRenderSampleLogged = false;
    const totalMs = perfNow() - tStart;
    debugLog(this.moduleId, "shader preview timings", {
      shaderId: previewRecord.id,
      reason: String(reason || "unspecified"),
      size,
      totalMs: Number(totalMs.toFixed(3)),
      phaseMs: {
        deepClone: Number(phaseMs.deepClone.toFixed(3)),
        sourceOverride: Number(phaseMs.sourceOverride.toFixed(3)),
        referencedChannels: Number(phaseMs.referencedChannels.toFixed(3)),
        channelResolve: Number(phaseMs.channelResolve.toFixed(3)),
        defaultsResolve: Number(phaseMs.defaultsResolve.toFixed(3)),
        definitionBuild: Number(phaseMs.definitionBuild.toFixed(3)),
        makeShader: Number(phaseMs.makeShader.toFixed(3)),
        meshSetup: Number(phaseMs.meshSetup.toFixed(3)),
        bufferSetup: Number(phaseMs.bufferSetup.toFixed(3)),
      },
      runtimeBufferCount: runtimeBuffers.length,
      runtimeImageChannelCount: runtimeImageChannels.length,
      hasPreviewTarget: !!previewTarget.targetId,
      previewTargetType: previewTarget.targetType ?? null,
      usedLiveScenePreview: !!previewSceneChannel,
    });

    return {
      size,
      shader,
      container,
      step: (dtSeconds = 1 / 60) => {
        const dt = Math.max(0, Number(dtSeconds) || 0);
        pendingBufferDt += dt;
        frameTicker += dt * 60;
        updatePreviewShaderUniforms(shader, dt, speed, frameTicker);
      },
      render: (renderer, target = null) => {
        if (!renderer) return;
        const bufferDt = pendingBufferDt > 0 ? pendingBufferDt : 1 / 60;
        pendingBufferDt = 0;
        for (const runtimeBuffer of runtimeBuffers) {
          runtimeBuffer.update(bufferDt, renderer);
        }
        if (target) renderer.render(container, { renderTexture: target, clear: true });
        else renderer.render(container, { clear: true });

        if (!debugRenderSampleLogged && isDebugLoggingEnabled(this.moduleId)) {
          const sampleSize = Math.max(32, Math.min(256, Math.round(Number(size) || 128)));
          let sampledTexture = target ?? null;
          let sampledOwnTarget = null;
          if (!sampledTexture) {
            sampledOwnTarget = PIXI.RenderTexture.create({
              width: sampleSize,
              height: sampleSize,
              resolution: 1,
              scaleMode: PIXI.SCALE_MODES.LINEAR,
            });
            renderer.render(container, { renderTexture: sampledOwnTarget, clear: true });
            sampledTexture = sampledOwnTarget;
          }

          const outputAlphaSample = sampledTexture
            ? this._debugSampleTextureAlpha(sampledTexture, 16, renderer)
            : null;

          let baseMaskAlphaSample = null;
          let rawShaderAlphaSample = null;
          let forcedShaderAlphaSample = null;
          let finalAlphaSample = null;
          const hasDebugUniform =
            shader?.uniforms && Object.prototype.hasOwnProperty.call(shader.uniforms, "debugMode");
          const priorDebugMode = hasDebugUniform
            ? Number(shader.uniforms.debugMode ?? 0)
            : 0;
          if (hasDebugUniform) {
            const debugTarget = PIXI.RenderTexture.create({
              width: sampleSize,
              height: sampleSize,
              resolution: 1,
              scaleMode: PIXI.SCALE_MODES.LINEAR,
            });
            try {
              shader.uniforms.debugMode = 2;
              renderer.render(container, { renderTexture: debugTarget, clear: true });
              baseMaskAlphaSample = this._debugSampleTextureAlpha(debugTarget, 16, renderer);

              shader.uniforms.debugMode = 3;
              renderer.render(container, { renderTexture: debugTarget, clear: true });
              rawShaderAlphaSample = this._debugSampleTextureAlpha(debugTarget, 16, renderer);

              shader.uniforms.debugMode = 4;
              renderer.render(container, { renderTexture: debugTarget, clear: true });
              forcedShaderAlphaSample = this._debugSampleTextureAlpha(debugTarget, 16, renderer);

              shader.uniforms.debugMode = 5;
              renderer.render(container, { renderTexture: debugTarget, clear: true });
              finalAlphaSample = this._debugSampleTextureAlpha(debugTarget, 16, renderer);
            } catch (err) {
              debugLog(this.moduleId, "shader preview render sample debug pass failed", {
                shaderId: previewRecord.id,
                message: String(err?.message ?? err),
              });
            } finally {
              shader.uniforms.debugMode = Number.isFinite(priorDebugMode)
                ? priorDebugMode
                : 0;
              debugTarget.destroy(true);
            }
          }

          const renderSampleStats = {
            shaderId: previewRecord.id,
            reason: String(reason || "unspecified"),
            targetProvided: !!target,
            hasDebugUniform,
            priorDebugMode,
            outputAlphaSample,
            baseMaskAlphaSample,
            rawShaderAlphaSample,
            forcedShaderAlphaSample,
            finalAlphaSample,
          };
          debugLog(this.moduleId, "shader preview render sample", {
            ...renderSampleStats,
            outputTexture: getTextureDebugInfo(sampledTexture, size),
          });
          debugLog(this.moduleId, "shader preview render sample stats", renderSampleStats);

          if (sampledOwnTarget) sampledOwnTarget.destroy(true);
          debugRenderSampleLogged = true;
        }
      },
      destroy: () => {
        for (const runtimeBuffer of runtimeBuffers) runtimeBuffer.destroy?.();
        for (const runtimeImageChannel of runtimeImageChannels) runtimeImageChannel.destroy?.();
        previewSceneChannel?.destroy?.();
        container.destroy({ children: true });
        geometry.destroy();
      },
    };
  }

  createImportedShaderPreview(shaderId, options = {}) {
    try {
      return this._createImportedShaderPreview(shaderId, options);
    } catch (err) {
      console.error(
        `${this.moduleId} | Failed to build imported shader preview`,
        err,
      );
      return null;
    }
  }

    queueBackgroundCompile(shaderId, { size = BACKGROUND_COMPILE_SIZE, reason = "" } = {}) {
    const resolvedId = this.resolveShaderId(shaderId);
    if (!resolvedId) return false;
    if (!this.getImportedRecord(resolvedId) && !this.isBuiltinShader(resolvedId)) return false;
    if (
      this._backgroundCompilePending.has(resolvedId) ||
      this._backgroundCompileDone.has(resolvedId)
    ) {
      return true;
    }

    this._backgroundCompilePending.add(resolvedId);
    const run = () => {
      void this._runBackgroundCompile(resolvedId, { size, reason });
    };

    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(run, { timeout: 1200 });
    } else {
      setTimeout(run, 0);
    }
    return true;
  }

  queuePreloadedShaderCompiles({ size = BACKGROUND_COMPILE_SIZE } = {}) {
    let queued = 0;
    for (const record of this.getImportedRecords()) {
      if (record?.defaults?.preloadShader !== true) continue;
      if (this.queueBackgroundCompile(record.id, { size, reason: "preload" })) {
        queued += 1;
      }
    }
    return queued;
  }

  refreshPlaceableImageChannels({ force = true } = {}) {
    PlaceableImageChannel.refreshAllLiveInstances({ force });
  }

  exportImportedShadersPayload() {
    return {
      version: 1,
      moduleId: this.moduleId,
      exportedAt: Date.now(),
      shaders: this.getImportedRecords(),
    };
  }

  async importImportedShadersPayload(payload, { replace = false } = {}) {
    const source = payload && typeof payload === "object" ? payload : {};
    const incoming = Array.isArray(source)
      ? source
      : Array.isArray(source.shaders)
        ? source.shaders
        : Array.isArray(source.records)
          ? source.records
          : [];

    const records = replace ? [] : this.getImportedRecords();
    const existingIndexById = new Map(records.map((entry, index) => [entry.id, index]));
    const used = new Set(records.map((entry) => entry.id));

    let importedCount = 0;
    for (const raw of incoming) {
      if (!raw || typeof raw !== "object") continue;

      const name = sanitizeName(raw.name ?? raw.label ?? "Imported Shader");
      const label = sanitizeName(raw.label ?? name);

      let sourceText = "";
      try {
        sourceText = validateShaderToySource(raw.source);
      } catch (_err) {
        continue;
      }

      const baseIdRaw = String(raw.id ?? "").trim();
      const fallbackBaseId = `custom-${slugify(name)}`;
      const preferredId = baseIdRaw && !this.builtinById.has(baseIdRaw)
        ? baseIdRaw
        : fallbackBaseId;

      let id = preferredId;
      let targetIndex = existingIndexById.get(id);
      if (targetIndex === undefined) {
        let n = 2;
        while (used.has(id) || this.builtinById.has(id)) {
          id = `${fallbackBaseId}-${n++}`;
        }
      }

      const channelConfig = this.buildChannelConfig({
        source: sourceText,
        channels: raw.channels,
        autoAssignCapture: true,
      });

      const normalized = {
        id,
        name,
        label,
        source: sourceText,
        referencedChannels: extractReferencedChannels(sourceText),
        channels: channelConfig,
        defaults: this.normalizeImportedShaderDefaults(
          raw.defaults,
          this.getDefaultImportedShaderDefaults(),
        ),
        thumbnail: typeof raw.thumbnail === "string" ? raw.thumbnail : "",
        createdAt: Number.isFinite(Number(raw.createdAt))
          ? Number(raw.createdAt)
          : Date.now(),
        updatedAt: Date.now(),
      };

      if (targetIndex !== undefined) {
        records[targetIndex] = normalized;
      } else {
        records.push(normalized);
        existingIndexById.set(id, records.length - 1);
        used.add(id);
      }
      importedCount += 1;
    }

    await this.setImportedRecords(records);
    return { importedCount, total: records.length };
  }

  _createWarmCompilePreview(shaderId, size) {
    const imported = this._createImportedShaderPreview(shaderId, {
      size,
      reason: "background-compile",
    });
    if (imported) return imported;

    const resolvedId = this.resolveShaderId(shaderId);
    if (!this.isBuiltinShader(resolvedId)) return null;

    const shaderResult = this.makeShader({
      shaderId: resolvedId,
      resolution: [size, size],
      useGradientMask: false,
      gradientMaskFadeStart: 0.8,
      alpha: 1,
      intensity: 1,
      speed: 1,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      falloffPower: 1.6,
      density: 1,
      flowMode: 0,
      flowSpeed: 0.8,
      flowTurbulence: 0.35,
      colorA: 0xffffff,
      colorB: 0xffffff,
      captureScale: 1,
      previewSceneCaptureTexture: this._getPreviewSceneCaptureTexturePath(),
      previewPlaceableTexture: this._getPreviewPlaceableCaptureTexturePath(),
      previewMode: true,
      debugMode: 0,
      noiseOffset: [0, 0],
      iMouse: [0, 0, 0, 0],
      iFrame: 0,
      iTimeDelta: 1 / 60,
      iFrameRate: 60,
      iDate: [0, 0, 0, 0],
    });
    const shader = shaderResult.shader;
    const container = new PIXI.Container();
    const geometry = createPreviewGeometry(size);
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.alpha = 1.0;
    mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
    container.addChild(mesh);

    const runtimeBuffers = (shaderResult.runtimeBufferChannels ?? [])
      .map((entry) => entry?.runtimeBuffer)
      .filter((buffer) => buffer && typeof buffer.update === "function");

    let pendingBufferDt = 0;
    let frameTicker = 0;

    return {
      size,
      shader,
      container,
      step: (dtSeconds = 1 / 60) => {
        const dt = Math.max(0, Number(dtSeconds) || 0);
        pendingBufferDt += dt;
        frameTicker += dt * 60;
        updatePreviewShaderUniforms(shader, dt, 1, frameTicker);
      },
      render: (renderer, target = null) => {
        if (!renderer) return;
        const bufferDt = pendingBufferDt > 0 ? pendingBufferDt : 1 / 60;
        pendingBufferDt = 0;
        for (const runtimeBuffer of runtimeBuffers) {
          runtimeBuffer.update(bufferDt, renderer);
        }
        if (target) renderer.render(container, { renderTexture: target, clear: true });
        else renderer.render(container, { clear: true });


      },
      destroy: () => {
        for (const runtimeBuffer of runtimeBuffers) runtimeBuffer.destroy?.();
        container.destroy({ children: true });
        geometry.destroy();
      },
    };
  }
  async _runBackgroundCompile(shaderId, { size = BACKGROUND_COMPILE_SIZE, reason = "" } = {}) {
    try {
      const renderer = canvas?.app?.renderer;
      if (!renderer) return;

      const previewSize = Math.max(32, Math.min(512, Math.round(Number(size) || BACKGROUND_COMPILE_SIZE)));
      const preview = this._createWarmCompilePreview(shaderId, previewSize);
      if (!preview) return;

      const target = PIXI.RenderTexture.create({ width: previewSize, height: previewSize });
      try {
        preview.step(1 / 60);
        preview.render(renderer, target);
        this._backgroundCompileDone.add(shaderId);
      } finally {
        preview.destroy();
        target.destroy(true);
      }
    } catch (err) {
      debugLog(this.moduleId, "background compile failed", {
        shaderId,
        reason,
        message: String(err?.message ?? err),
      });
    } finally {
      this._backgroundCompilePending.delete(shaderId);
    }
  }
  async _captureRenderTextureDataUrl(renderer, renderTexture) {
    try {
      const width = Math.max(1, Number(renderTexture?.width) || 0);
      const height = Math.max(1, Number(renderTexture?.height) || 0);
      if (width > 0 && height > 0 && typeof renderer?.extract?.pixels === "function") {
        const pixels = renderer.extract.pixels(renderTexture);
        if (pixels && pixels.length >= width * height * 4) {
          const outCanvas = document.createElement("canvas");
          outCanvas.width = width;
          outCanvas.height = height;
          const outCtx = outCanvas.getContext("2d", { alpha: true });
          if (outCtx) {
            const imageData = outCtx.createImageData(width, height);
            const out = imageData.data;
            for (let i = 0; i < out.length; i += 4) {
              const r = pixels[i];
              const g = pixels[i + 1];
              const b = pixels[i + 2];
              const a = pixels[i + 3];
              if (a > 0 && a < 255 && Math.max(r, g, b) <= a) {
                const scale = 255 / a;
                out[i] = Math.min(255, Math.round(r * scale));
                out[i + 1] = Math.min(255, Math.round(g * scale));
                out[i + 2] = Math.min(255, Math.round(b * scale));
              } else if (a === 0) {
                out[i] = 0;
                out[i + 1] = 0;
                out[i + 2] = 0;
              } else {
                out[i] = r;
                out[i + 1] = g;
                out[i + 2] = b;
              }
              out[i + 3] = a;
            }
            outCtx.putImageData(imageData, 0, 0);
            const value = outCanvas.toDataURL("image/png");
            if (typeof value === "string" && value.trim()) return value;
          }
        }
      }
      if (typeof renderer?.extract?.base64 === "function") {
        const value = await Promise.resolve(
          renderer.extract.base64(renderTexture, "image/png"),
        );
        return typeof value === "string" && value.trim() ? value : null;
      }
      if (typeof renderer?.extract?.canvas === "function") {
        const c = renderer.extract.canvas(renderTexture);
        const value = c?.toDataURL?.("image/png") ?? null;
        return typeof value === "string" && value.trim() ? value : null;
      }
    } catch (_err) {
      return null;
    }
    return null;
  }

  async regenerateImportedShaderThumbnail(
    shaderId,
    { size = THUMBNAIL_SIZE, captureSeconds = THUMBNAIL_CAPTURE_SECONDS } = {},
  ) {
    const renderer = this._ensureThumbnailRenderer(size);
    if (!renderer) return null;

    const captureStartedAt = Date.now();
    const targetSize = Math.max(
      32,
      Math.min(2048, Math.round(Number(size) || THUMBNAIL_SIZE)),
    );

    const preview = this._createImportedShaderPreview(shaderId, {
      size: targetSize,
      reason: "thumbnail-regenerate",
    });
    if (!preview) return null;

    try {
      const frames = Math.max(
        1,
        Math.round(
          Math.max(0.05, Number(captureSeconds) || THUMBNAIL_CAPTURE_SECONDS) *
            60,
        ),
      );
      for (let i = 0; i < frames; i += 1) {
        preview.step(1 / 60);
        preview.render(renderer);
      }

      const renderedCanvas =
        this._thumbnailRendererCanvas instanceof HTMLCanvasElement
          ? this._thumbnailRendererCanvas
          : (renderer?.view instanceof HTMLCanvasElement ? renderer.view : null);
      const thumbnail = String(renderedCanvas?.toDataURL?.("image/png") ?? "").trim();
      if (!thumbnail) return null;

      const current = this.getImportedRecord(shaderId);
      if (Number(current?.thumbnailUpdatedAt ?? 0) > captureStartedAt) {
        debugLog(this.moduleId, "thumbnail regenerate skipped newer thumbnail", {
          shaderId,
          captureStartedAt,
          thumbnailUpdatedAt: Number(current?.thumbnailUpdatedAt ?? 0),
        });
        return current;
      }

      const records = this.getImportedRecords();
      const idx = records.findIndex((entry) => entry.id === shaderId);
      if (idx < 0) return null;
      records[idx] = {
        ...records[idx],
        thumbnail,
        thumbnailUpdatedAt: Date.now(),
      };
      await this.setImportedRecords(records);
      return records[idx];
    } finally {
      preview.destroy();
    }
  }
  _queueImportedShaderThumbnailRegeneration(shaderId, options = {}) {
    const id = String(shaderId ?? "").trim();
    if (!id) return;
    if (this._pendingThumbnailRegenerations.has(id)) return;

    const pending = Promise.resolve()
      .then(() => this.regenerateImportedShaderThumbnail(id, options))
      .catch((err) => {
        console.warn(`${this.moduleId} | Failed to regenerate thumbnail in background`, {
          shaderId: id,
          err,
        });
      })
      .finally(() => {
        this._pendingThumbnailRegenerations.delete(id);
      });

    this._pendingThumbnailRegenerations.set(id, pending);
  }
  getChannelModeChoices() {
    return {
      auto: "Auto",
      sceneCapture: "Scene capture (clipped)",
      tokenTileImage: "Token/Tile image (captured)",
      noiseBw: "Black/White noise",
      noiseRgb: "RGB noise",
      image: "Custom image/video",
      buffer: "ShaderToy buffer code",
      white: "White",
      empty: "Empty (transparent)",
      none: "None (black)",
    };
  }

  getImportedShaderDefaultKeys() {
    return [...IMPORTED_SHADER_DEFAULT_KEYS];
  }

  getBuiltinEntries() {
    return BUILTIN_SHADERS.map((shader) => ({
      id: shader.id,
      label: shader.label,
      source: "builtin",
    }));
  }

  getImportedRecords() {
    const value = game.settings.get(this.moduleId, this.shaderLibrarySetting);
    return toArray(value)
      .filter((entry) => entry && typeof entry === "object")
      .filter(
        (entry) =>
          typeof entry.id === "string" &&
          typeof entry.name === "string" &&
          typeof entry.source === "string",
      )
      .map((entry) => ({
        ...entry,
        label: sanitizeName(entry.label ?? entry.name),
        thumbnail: typeof entry.thumbnail === "string" ? entry.thumbnail : "",
        defaults: this.normalizeImportedShaderDefaults(
          entry.defaults,
          this.getDefaultImportedShaderDefaults(),
        ),
      }));
  }


  async setImportedRecords(records) {
    await game.settings.set(
      this.moduleId,
      this.shaderLibrarySetting,
      toArray(records),
    );
    this._shaderLibraryRevision += 1;
    this._invalidateShaderChoiceCaches();
    Hooks.callAll(`${this.moduleId}.shaderLibraryChanged`);
  }


  getImportedEntries() {
    return this.getImportedRecords().map((record) => ({
      id: record.id,
      name: record.name,
      label: sanitizeName(record.label ?? record.name),
      thumbnail: typeof record.thumbnail === "string" ? record.thumbnail : "",
      source: "imported",
    }));
  }

  getImportedRecord(shaderId) {
    if (typeof shaderId !== "string" || !shaderId) return null;
    return (
      this.getImportedRecords().find((record) => record.id === shaderId) ?? null
    );
  }


  getShaderChoices() {
    this._ensureShaderLibrarySettingHook();

    if (
      this._shaderChoiceCache &&
      this._shaderChoiceCache.revision === this._shaderLibraryRevision &&
      this._shaderChoiceCache.choices &&
      typeof this._shaderChoiceCache.choices === "object"
    ) {
      return this._shaderChoiceCache.choices;
    }

    const entries = [];
    for (const shader of this.getBuiltinEntries()) {
      entries.push({ id: shader.id, label: shader.label });
    }
    for (const shader of this.getImportedEntries()) {
      entries.push({ id: shader.id, label: String(shader.label) + " (Imported)" });
    }

    entries.sort((a, b) => {
      const byLabel = String(a.label ?? "").localeCompare(String(b.label ?? ""), undefined, {
        sensitivity: "base",
      });
      if (byLabel !== 0) return byLabel;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""), undefined, {
        sensitivity: "base",
      });
    });

    const choices = {};
    for (const entry of entries) choices[entry.id] = entry.label;

    const frozen = Object.freeze(choices);
    this._shaderChoiceCache = {
      revision: this._shaderLibraryRevision,
      choices: frozen,
    };
    return frozen;
  }

  _channelConfigHasAnyMode(channelConfig, modesSet) {
    const cfg =
      channelConfig && typeof channelConfig === "object" ? channelConfig : {};
    for (const index of CHANNEL_INDICES) {
      const key = `iChannel${index}`;
      const node = normalizeChannelInput(cfg[key] ?? cfg[index]);
      const mode = normalizeChannelMode(node.mode);
      if (modesSet.has(mode)) return true;
      if (
        mode === "buffer" &&
        node.channels &&
        this._channelConfigHasAnyMode(node.channels, modesSet)
      ) {
        return true;
      }
    }
    return false;
  }

  _rawChannelNodeHasAnyMode(node, modesSet, depth = 0) {
    if (!node || typeof node !== "object") return false;
    if (depth > MAX_BUFFER_CHAIN_DEPTH) return false;

    const mode = normalizeChannelMode(node.mode);
    if (modesSet.has(mode)) return true;
    if (mode !== "buffer") return false;

    const nested = node.channels;
    if (!nested || typeof nested !== "object") return false;
    for (const index of CHANNEL_INDICES) {
      const key = `iChannel${index}`;
      if (
        this._rawChannelNodeHasAnyMode(
          nested[key] ?? nested[index],
          modesSet,
          depth + 1,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  _rawChannelConfigHasAnyMode(channelConfig, modesSet) {
    const cfg =
      channelConfig && typeof channelConfig === "object" ? channelConfig : {};
    for (const index of CHANNEL_INDICES) {
      const key = `iChannel${index}`;
      if (this._rawChannelNodeHasAnyMode(cfg[key] ?? cfg[index], modesSet, 0)) {
        return true;
      }
    }
    return false;
  }


  _getImportedTokenTileUsageMap() {
    this._ensureShaderLibrarySettingHook();

    if (
      this._tokenTileUsageCache &&
      this._tokenTileUsageCache.revision === this._shaderLibraryRevision &&
      this._tokenTileUsageCache.map instanceof Map
    ) {
      return this._tokenTileUsageCache.map;
    }

    const usage = new Map();
    const modes = new Set(["tokenTileImage"]);
    for (const record of this.getImportedRecords()) {
      const id = String(record?.id ?? "").trim();
      if (!id) continue;
      usage.set(id, this._rawChannelConfigHasAnyMode(record?.channels, modes));
    }

    this._tokenTileUsageCache = {
      revision: this._shaderLibraryRevision,
      map: usage,
    };
    return usage;
  }

  importedShaderUsesTokenTileImage(shaderId) {
    const id = String(shaderId ?? "").trim();
    if (!id) return false;
    const usage = this._getImportedTokenTileUsageMap();
    return usage.get(id) === true;
  }

  shaderUsesTokenTileImage(shaderId) {
    const definition = this.resolveShaderDefinition(shaderId);
    if (!definition) return false;
    const channelConfig =
      definition.channelConfig && typeof definition.channelConfig === "object"
        ? definition.channelConfig
        : {};
    return this._channelConfigHasAnyMode(
      channelConfig,
      new Set(["tokenTileImage"]),
    );
  }

  shaderSupportsTarget(shaderId, targetType = "") {
    const resolvedTarget = String(targetType ?? "").trim().toLowerCase();
    if (!["template", "region"].includes(resolvedTarget)) return true;
    const resolvedId = this.resolveShaderId(shaderId);
    if (this.isBuiltinShader(resolvedId)) return true;
    return !this.importedShaderUsesTokenTileImage(resolvedId);
  }


  getShaderChoicesForTarget(targetType = "") {
    this._ensureShaderLibrarySettingHook();

    const resolvedTarget = String(targetType ?? "").trim().toLowerCase();
    if (!["template", "region"].includes(resolvedTarget)) {
      return this.getShaderChoices();
    }

    const cacheKey = resolvedTarget + ":" + this._shaderLibraryRevision;
    const cached = this._shaderChoiceCacheByTarget.get(cacheKey);
    if (cached && typeof cached === "object") return cached;

    const choices = this.getShaderChoices();
    const filtered = {};
    for (const [id, label] of Object.entries(choices)) {
      if (this.shaderSupportsTarget(id, resolvedTarget)) filtered[id] = label;
    }

    const frozen = Object.freeze(filtered);
    this._shaderChoiceCacheByTarget.set(cacheKey, frozen);
    return frozen;
  }
  getCombinedEntries() {
    return [...this.getBuiltinEntries(), ...this.getImportedEntries()];
  }

  hasShader(shaderId) {
    return this.getCombinedEntries().some((entry) => entry.id === shaderId);
  }

  isBuiltinShader(shaderId) {
    const resolvedId = this.resolveShaderId(shaderId);
    return this.builtinById.has(resolvedId);
  }

  resolveShaderId(candidate) {
    if (typeof candidate === "string" && this.hasShader(candidate))
      return candidate;
    return DEFAULT_SHADER_ID;
  }

  getDefaultChannelConfig(source, autoAssignCapture = true) {
    let referencedChannels = [];
    try {
      referencedChannels = extractReferencedChannels(source);
    } catch (_err) {
      referencedChannels = [];
    }
    const referenced = new Set(referencedChannels);
    const defaults = {};

    for (const index of CHANNEL_INDICES) {
      const key = `iChannel${index}`;
      let mode = "none";
      if (referenced.has(index)) {
        if (index === 0) mode = "noiseRgb";
        else mode = autoAssignCapture ? "sceneCapture" : "none";
      }
      defaults[key] = {
        mode,
        path: "",
        source: "",
        channels: {},
        size: DEFAULT_BUFFER_SIZE,
      };
    }

    return defaults;
  }

  buildChannelConfig({ source, channels = {}, autoAssignCapture = true } = {}) {
    const normalizedSource = validateShaderToySource(source);
    const next = this.getDefaultChannelConfig(
      normalizedSource,
      autoAssignCapture,
    );

    for (const index of CHANNEL_INDICES) {
      const key = `iChannel${index}`;
      const candidate = normalizeChannelInput(
        channels?.[key] ?? channels?.[index],
      );
      if (candidate.mode !== "auto") {
        let sourceValue = candidate.source;
        let nestedChannels = {};
        if (candidate.mode === "buffer") {
          if (!sourceValue) {
            throw new Error(
              `${key} is set to ShaderToy buffer code, but no source code was provided.`,
            );
          }
          sourceValue = validateShaderToySource(sourceValue);
          nestedChannels = this.buildChannelConfig({
            source: sourceValue,
            channels: candidate.channels,
            autoAssignCapture: false,
          });
        }
        next[key] = {
          mode: candidate.mode,
          path: candidate.path,
          source: sourceValue,
          channels: nestedChannels,
          size: normalizeBufferSize(candidate.size, DEFAULT_BUFFER_SIZE),
        };
      }
    }

    return next;
  }

  getRecordChannelConfig(record) {
    if (!record?.source || typeof record.source !== "string") {
      return this.getDefaultChannelConfig(
        "void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = vec4(0.0); }",
        true,
      );
    }

    if (!record?.channels || typeof record.channels !== "object") {
      return this.getDefaultChannelConfig(record.source, true);
    }

    const next = this.getDefaultChannelConfig(record.source, true);
    for (const index of CHANNEL_INDICES) {
      const key = `iChannel${index}`;
      const candidate = normalizeChannelInput(
        record.channels[key] ?? record.channels[index],
      );
      if (candidate.mode !== "auto") {
        let sourceValue = candidate.source;
        let nestedChannels = {};
        if (candidate.mode === "buffer" && sourceValue) {
          try {
            sourceValue = validateShaderToySource(sourceValue);
            nestedChannels = this.buildChannelConfig({
              source: sourceValue,
              channels: candidate.channels,
              autoAssignCapture: false,
            });
          } catch (_err) {
            sourceValue = "";
            nestedChannels = {};
          }
        }
        next[key] = {
          mode: candidate.mode,
          path: candidate.path,
          source: sourceValue,
          channels: nestedChannels,
          size: normalizeBufferSize(candidate.size, DEFAULT_BUFFER_SIZE),
        };
      }
    }
    return next;
  }

  resolveShaderDefinition(shaderId) {
    const resolvedId = this.resolveShaderId(shaderId);
    const builtin = this.builtinById.get(resolvedId);
    if (builtin) return builtin;

    const record = this.getImportedRecords().find(
      (entry) => entry.id === resolvedId,
    );
    if (!record) return this.builtinById.get(DEFAULT_SHADER_ID);

    return {
      id: record.id,
      label: sanitizeName(record.label ?? record.name),
      type: "imported",
      requiresResolution: true,
      usesNoiseTexture: true,
      channelConfig: this.getRecordChannelConfig(record),
      referencedChannels: toArray(record.referencedChannels)
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v <= 3),
      fragment: adaptShaderToyFragment(record.source),
    };
  }

  resolveImportedChannelTexture(channelConfig, depth = 0, options = {}) {
    if (depth > MAX_BUFFER_CHAIN_DEPTH) {
      throw new Error(
        `Shader buffer dependency chain exceeds maximum depth (${MAX_BUFFER_CHAIN_DEPTH}).`,
      );
    }

    const mode = normalizeChannelMode(channelConfig?.mode ?? "none");
    const path = String(channelConfig?.path ?? "").trim();
    const source = String(channelConfig?.source ?? "").trim();
    const size = normalizeBufferSize(channelConfig?.size, DEFAULT_BUFFER_SIZE);
    const emptyResult = {
      texture: getSolidTexture([0, 0, 0, 255], 2),
      resolution: [2, 2],
      runtimeCapture: false,
      runtimeCaptureSize: 0,
      runtimeCaptureChannels: [],
      runtimeBuffers: [],
      runtimeImageChannels: [],
    };

    if (mode === "sceneCapture") {
      const captureRotationDeg = toFiniteNumber(options?.captureRotationDeg, 0);
      const captureFlipHorizontal = parseBooleanLike(
        options?.captureFlipHorizontal,
      );
      const captureFlipVertical = parseBooleanLike(options?.captureFlipVertical);
      const previewSceneTextureInput =
        options?.previewSceneCaptureTexture ?? "";
      const previewSceneTexture =
        this._getTransformedPreviewCaptureTexture(previewSceneTextureInput, {
          captureRotationDeg,
          captureFlipHorizontal,
          captureFlipVertical,
          forceOpaqueAlpha: true,
        });
      if (previewSceneTexture) {
        const texture = previewSceneTexture;
        const base = texture?.baseTexture;
        if (base) {
          base.wrapMode = PIXI.WRAP_MODES.CLAMP;
          base.scaleMode = PIXI.SCALE_MODES.LINEAR;
          base.mipmap = PIXI.MIPMAP_MODES.OFF;
          base.update?.();
        }
        const resolution = getTextureSize(texture, 1024);
        debugLog(this.moduleId, "resolve sceneCapture channel: preview texture", {
          mode,
          previewMode: options?.previewMode === true,
          captureRotationDeg,
          captureFlipHorizontal,
          captureFlipVertical,
          previewSceneTextureInput: typeof previewSceneTextureInput === "string" ? previewSceneTextureInput : null,
          texture: getTextureDebugInfo(texture, 1024),
          resolution,
          alphaSample: this._debugSampleTextureAlpha(texture, 16),
        });
        return {
          texture,
          resolution,
          runtimeCapture: false,
          runtimeCaptureSize: 0,
          runtimeCaptureChannels: [],
          runtimeBuffers: [],
          runtimeImageChannels: [],
        };
      }
      const texture = getNoiseTexture(IMPORTED_NOISE_TEXTURE_SIZE, "rgb");
      debugLog(this.moduleId, "resolve sceneCapture channel: runtime fallback", {
        mode,
        previewMode: options?.previewMode === true,
        texture: getTextureDebugInfo(texture, IMPORTED_NOISE_TEXTURE_SIZE),
        alphaSample: this._debugSampleTextureAlpha(texture, 16),
      });
      return {
        texture,
        resolution: [512, 512],
        runtimeCapture: true,
        runtimeCaptureSize: 512,
        runtimeCaptureChannels: [],
        runtimeBuffers: [],
        runtimeImageChannels: [],
      };
    }

    if (mode === "tokenTileImage") {
      const targetType = String(options?.targetType ?? "")
        .trim()
        .toLowerCase();
      const targetId = String(options?.targetId ?? "").trim();
      const isPreview = options?.previewMode === true;
      const previewTextureInput =
        options?.previewPlaceableTexture ??
          options?.previewSceneCaptureTexture ??
          this._getPreviewPlaceableCaptureTexturePath();
      const previewTexturePath =
        typeof previewTextureInput === "string"
          ? String(previewTextureInput).trim()
          : "";
      debugLog(this.moduleId, "resolve tokenTileImage channel", {
        targetType: targetType || null,
        targetId: targetId || null,
        isPreview,
        hasPreviewTexturePath: !!previewTexturePath,
        canAttachToPlaceable:
          (targetType === "token" || targetType === "tile") && !!targetId,
      });

      if ((targetType === "token" || targetType === "tile") && targetId) {
        const captureSize = isPreview
          ? PLACEABLE_IMAGE_PREVIEW_SIZE
          : PLACEABLE_IMAGE_CAPTURE_SIZE;
        const captureRotationDeg = toFiniteNumber(options?.captureRotationDeg, 0);
        const captureFlipHorizontal = parseBooleanLike(
          options?.captureFlipHorizontal,
        );
        const captureFlipVertical = parseBooleanLike(options?.captureFlipVertical);
        debugLog(this.moduleId, "create placeable image channel", {
          targetType,
          targetId,
          captureSize,
          isPreview,
          captureRotationDeg,
          captureFlipHorizontal,
          captureFlipVertical,
        });
        const runtimeImageChannel = new PlaceableImageChannel({
          moduleId: this.moduleId,
          targetType,
          targetId,
          size: captureSize,
          liveUpdates: !isPreview,
          previewTexturePath,
          captureRotationDeg,
          captureFlipHorizontal,
          captureFlipVertical,
        });
        const texture = runtimeImageChannel.texture;
        const resolution = [captureSize, captureSize];
        debugLog(this.moduleId, "resolve tokenTileImage channel: placeable runtime channel", {
          targetType,
          targetId,
          isPreview,
          captureRotationDeg,
          captureFlipHorizontal,
          captureFlipVertical,
          texture: getTextureDebugInfo(texture, captureSize),
          resolution,
          alphaSample: this._debugSampleTextureAlpha(texture, 16),
        });
        return {
          texture,
          resolution,
          runtimeCapture: false,
          runtimeCaptureSize: 0,
          runtimeCaptureChannels: [],
          runtimeBuffers: [],
          runtimeImageChannels: [runtimeImageChannel],
        };
      }

      if (previewTextureInput) {
        debugLog(this.moduleId, "tokenTileImage fallback: preview texture", {
          targetType: targetType || null,
          targetId: targetId || null,
          isPreview,
          previewTexturePath,
        });
        const captureRotationDeg = toFiniteNumber(options?.captureRotationDeg, 0);
        const captureFlipHorizontal = parseBooleanLike(
          options?.captureFlipHorizontal,
        );
        const captureFlipVertical = parseBooleanLike(options?.captureFlipVertical);
        const texture =
          this._getTransformedPreviewCaptureTexture(previewTextureInput, {
            captureRotationDeg,
            captureFlipHorizontal,
            captureFlipVertical,
            forceOpaqueAlpha: false,
          });
        const base = texture?.baseTexture;
        if (base) {
          base.wrapMode = PIXI.WRAP_MODES.CLAMP;
          base.scaleMode = PIXI.SCALE_MODES.LINEAR;
          base.mipmap = PIXI.MIPMAP_MODES.OFF;
          base.update?.();
        }
        if (!texture) {
          debugLog(this.moduleId, "resolve tokenTileImage channel: missing preview texture object", {
            targetType: targetType || null,
            targetId: targetId || null,
            isPreview,
            previewTexturePath,
          });
          return emptyResult;
        }
        const resolution = getTextureSize(texture, PLACEABLE_IMAGE_PREVIEW_SIZE);
        debugLog(this.moduleId, "resolve tokenTileImage channel: preview fallback resolved", {
          targetType: targetType || null,
          targetId: targetId || null,
          isPreview,
          previewTexturePath,
          captureRotationDeg,
          captureFlipHorizontal,
          captureFlipVertical,
          texture: getTextureDebugInfo(texture, PLACEABLE_IMAGE_PREVIEW_SIZE),
          resolution,
          alphaSample: this._debugSampleTextureAlpha(texture, 16),
        });
        return {
          texture,
          resolution,
          runtimeCapture: false,
          runtimeCaptureSize: 0,
          runtimeCaptureChannels: [],
          runtimeBuffers: [],
          runtimeImageChannels: [],
        };
      }

      debugLog(this.moduleId, "tokenTileImage fallback: transparent empty", {
        targetType: targetType || null,
        targetId: targetId || null,
        isPreview,
      });
      return {
        texture: getSolidTexture([0, 0, 0, 0], 2),
        resolution: [2, 2],
        runtimeCapture: false,
        runtimeCaptureSize: 0,
        runtimeCaptureChannels: [],
        runtimeBuffers: [],
        runtimeImageChannels: [],
      };
    }

    if (mode === "buffer" && source) {
      try {
        const runtimeBuffer = new ShaderToyBufferChannel({ source, size });
        const runtimeCaptureChannels = [];
        const runtimeBuffers = [];
        const runtimeImageChannels = [];
        for (const index of CHANNEL_INDICES) {
          const key = `iChannel${index}`;
          const childCfg = channelConfig?.channels?.[key] ??
            channelConfig?.channels?.[index] ?? {
              mode: "none",
              path: "",
              source: "",
              channels: {},
              size,
            };
          const resolved = this.resolveImportedChannelTexture(
            childCfg,
            depth + 1,
            options,
          );
          runtimeBuffer.setChannel(
            index,
            resolved.texture,
            resolved.resolution,
          );
          if (resolved.runtimeCapture) {
            runtimeCaptureChannels.push({
              size: resolved.runtimeCaptureSize ?? 512,
              runtimeBuffer,
              channel: index,
            });
          }
          runtimeCaptureChannels.push(
            ...(resolved.runtimeCaptureChannels ?? []),
          );
          runtimeBuffers.push(...(resolved.runtimeBuffers ?? []));
          runtimeImageChannels.push(...(resolved.runtimeImageChannels ?? []));
        }
        runtimeBuffers.push(runtimeBuffer);
        return {
          texture: runtimeBuffer.texture,
          resolution: [size, size],
          runtimeCapture: false,
          runtimeCaptureSize: 0,
          runtimeCaptureChannels,
          runtimeBuffers,
          runtimeImageChannels,
        };
      } catch (err) {
        console.error(
          `${this.moduleId} | Failed to build imported buffer channel`,
          err,
        );
      }
    }

    if (mode === "noiseBw") {
      const texture = getNoiseTexture(IMPORTED_NOISE_TEXTURE_SIZE, "bw");
      return {
        texture,
        resolution: getTextureSize(texture, IMPORTED_NOISE_TEXTURE_SIZE),
        runtimeCapture: false,
        runtimeCaptureSize: 0,
        runtimeCaptureChannels: [],
        runtimeBuffers: [],
        runtimeImageChannels: [],
      };
    }

    if (mode === "noiseRgb") {
      const texture = getNoiseTexture(IMPORTED_NOISE_TEXTURE_SIZE, "rgb");
      return {
        texture,
        resolution: getTextureSize(texture, IMPORTED_NOISE_TEXTURE_SIZE),
        runtimeCapture: false,
        runtimeCaptureSize: 0,
        runtimeCaptureChannels: [],
        runtimeBuffers: [],
        runtimeImageChannels: [],
      };
    }

    if (mode === "image") {
      if (!path) {
        console.warn(
          `${this.moduleId} | Imported shader channel is set to image mode but has no path. Falling back to RGB noise.`,
        );
        const texture = getNoiseTexture(IMPORTED_NOISE_TEXTURE_SIZE, "rgb");
        return {
          texture,
          resolution: getTextureSize(texture, IMPORTED_NOISE_TEXTURE_SIZE),
          runtimeCapture: false,
          runtimeCaptureSize: 0,
          runtimeCaptureChannels: [],
          runtimeBuffers: [],
          runtimeImageChannels: [],
        };
      }

      const texture = PIXI.Texture.from(path);
      const base = texture?.baseTexture;
      if (base) {
        base.wrapMode = PIXI.WRAP_MODES.REPEAT;
        base.scaleMode = PIXI.SCALE_MODES.LINEAR;
        base.mipmap = PIXI.MIPMAP_MODES.OFF;
        base.update?.();
        base.once?.("error", (err) => {
          console.error(
            `${this.moduleId} | Failed to load imported shader channel image: ${path}`,
            err,
          );
        });
      }

      return {
        texture,
        resolution: getTextureSize(texture, 1024),
        runtimeCapture: false,
        runtimeCaptureSize: 0,
        runtimeCaptureChannels: [],
        runtimeBuffers: [],
        runtimeImageChannels: [],
      };
    }

    if (mode === "empty") {
      const texture = getSolidTexture([0, 0, 0, 0], 2);
      return {
        texture,
        resolution: [2, 2],
        runtimeCapture: false,
        runtimeCaptureSize: 0,
        runtimeCaptureChannels: [],
        runtimeBuffers: [],
        runtimeImageChannels: [],
      };
    }

    if (mode === "white") {
      const texture = getSolidTexture([255, 255, 255, 255], 2);
      return {
        texture,
        resolution: [2, 2],
        runtimeCapture: false,
        runtimeCaptureSize: 0,
        runtimeCaptureChannels: [],
        runtimeBuffers: [],
        runtimeImageChannels: [],
      };
    }

    return emptyResult;
  }
  makeShader(cfg) {
    const def = cfg.definitionOverride ?? this.resolveShaderDefinition(cfg.shaderId);
    const fragment = withGlobalAlpha(def.fragment);
    const uniforms = buildBaseUniforms(cfg);
    uniforms.iMouse = cfg.iMouse ?? [0, 0, 0, 0];
    uniforms.iTimeDelta = cfg.iTimeDelta ?? 1 / 60;
    uniforms.iFrame = cfg.iFrame ?? 0;
    uniforms.iFrameRate = cfg.iFrameRate ?? 60;
    uniforms.iDate = cfg.iDate ?? [0, 0, 0, 0];
    uniforms.iChannelResolution = cfg.iChannelResolution ?? [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ];
    uniforms.globalAlpha = Number.isFinite(cfg.alpha) ? cfg.alpha : 1.0;
    uniforms.cpfxPreserveTransparent = cfg.useGradientMask === true ? 0.0 : 1.0;
    uniforms.cpfxForceOpaqueCaptureAlpha =
      cfg.previewForceOpaqueCaptureAlpha === true ? 1.0 : 0.0;

    if (def.requiresResolution) {
      uniforms.resolution = cfg.resolution ?? [1, 1];
    }
    if (def.usesNoiseTexture && def.type !== "imported") {
      uniforms.iChannel0 = getNoiseTexture(256, "gray");
    }

    const runtimeChannels = [];
    const runtimeBufferChannels = [];
    const runtimeImageChannels = [];
    const seenRuntimeBuffers = new Set();
    if (def.type === "imported") {
      uniforms.uTime = cfg.uTime ?? uniforms.time ?? 0;
      const channelResolution = [];
      const referencedChannels = new Set(
        toArray(def.referencedChannels)
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v) && v >= 0 && v <= 3),
      );
      for (const index of CHANNEL_INDICES) {
        const key = `iChannel${index}`;
        const channelCfg = def.channelConfig?.[key] ?? {
          mode: "none",
          path: "",
          source: "",
          channels: {},
          size: DEFAULT_BUFFER_SIZE,
        };
        // Some imported shaders depend on iChannel0 for base color and render black when unset.
        const effectiveChannelCfg =
          channelCfg?.mode === "none" &&
          index === 0 &&
          referencedChannels.has(0)
            ? { ...channelCfg, mode: "noiseRgb" }
            : channelCfg;
        const resolved = this.resolveImportedChannelTexture(
          effectiveChannelCfg,
          0,
          {
            previewSceneCaptureTexture: cfg.previewSceneCaptureTexture,
            previewPlaceableTexture: cfg.previewPlaceableTexture,
            previewMode: cfg.previewMode === true,
            targetType: cfg.targetType,
            targetId: cfg.targetId,
            captureRotationDeg: cfg.captureRotationDeg,
            captureFlipHorizontal: cfg.captureFlipHorizontal,
            captureFlipVertical: cfg.captureFlipVertical,
          },
        );
        uniforms[key] = resolved.texture;
        const resolvedWidth = Number(resolved?.resolution?.[0] ?? 1);
        const resolvedHeight = Number(resolved?.resolution?.[1] ?? 1);
        channelResolution.push(
          resolvedWidth,
          resolvedHeight,
          1,
        );
        if (isDebugLoggingEnabled(this.moduleId)) {
          debugLog(this.moduleId, "makeShader imported channel bind", {
            shaderId: def.id,
            previewMode: cfg.previewMode === true,
            channel: index,
            uniformKey: key,
            requestedMode: normalizeChannelMode(channelCfg?.mode ?? "none"),
            effectiveMode: normalizeChannelMode(effectiveChannelCfg?.mode ?? "none"),
            targetType: cfg.targetType ?? null,
            targetId: cfg.targetId ?? null,
            resolution: [resolvedWidth, resolvedHeight],
            runtimeCapture: resolved.runtimeCapture === true,
            runtimeCaptureSize: resolved.runtimeCaptureSize ?? 0,
            runtimeCaptureChannelCount: (resolved.runtimeCaptureChannels ?? []).length,
            runtimeBufferCount: (resolved.runtimeBuffers ?? []).length,
            runtimeImageChannelCount: (resolved.runtimeImageChannels ?? []).length,
            texture: getTextureDebugInfo(resolved.texture, resolvedWidth || 256),
            alphaSample: this._debugSampleTextureAlpha(resolved.texture, 16),
          });
        }
        if (resolved.runtimeCapture) {
          runtimeChannels.push({
            channel: index,
            size: resolved.runtimeCaptureSize ?? 512,
          });
        }
        for (const captureChannel of resolved.runtimeCaptureChannels ?? []) {
          if (
            !Number.isInteger(captureChannel?.channel) ||
            captureChannel.channel < 0 ||
            captureChannel.channel > 3
          )
            continue;
          runtimeChannels.push({
            channel: captureChannel.channel,
            size: captureChannel.size ?? 512,
            runtimeBuffer: captureChannel.runtimeBuffer ?? null,
          });
        }
        for (const runtimeImageChannel of resolved.runtimeImageChannels ?? []) {
          if (!runtimeImageChannel) continue;
          runtimeImageChannels.push(runtimeImageChannel);
        }
        for (const runtimeBuffer of resolved.runtimeBuffers ?? []) {
          if (!runtimeBuffer || seenRuntimeBuffers.has(runtimeBuffer)) continue;
          seenRuntimeBuffers.add(runtimeBuffer);
          runtimeBufferChannels.push({ channel: index, runtimeBuffer });
        }
      }
      uniforms.iChannelResolution = channelResolution;
      debugLog(this.moduleId, "makeShader imported channel resolutions", {
        shaderId: def.id,
        previewMode: cfg.previewMode === true,
        iChannelResolution: channelResolution,
      });
    }

    const shader = PIXI.Shader.from(SHADER_VERT, fragment, uniforms);
    shader.uniforms.uSampler = cfg.maskTexture
      ? cfg.maskTexture
      : cfg.useGradientMask === true
        ? getRadialTexture(
            512,
            cfg.gradientMaskFadeStart ?? cfg.shaderGradientFadeStart ?? 0.8,
          )
        : getCircleMaskTexture(512);

    return {
      shader,
      shaderId: def.id,
      shaderLabel: def.label,
      definition: def,
      runtimeChannels,
      runtimeBufferChannels,
      runtimeImageChannels,
    };
  }

  async enforceValidSelection() {
    const current = game.settings.get(this.moduleId, this.selectionSetting);
    const resolved = this.resolveShaderId(current);
    if (current !== resolved) {
      await game.settings.set(this.moduleId, this.selectionSetting, resolved);
    }
    return resolved;
  }

  async importShaderToy({
    name,
    label = null,
    source,
    channels = {},
    autoAssignCapture = true,
    defaults = null,
  } = {}) {
    const normalizedName = sanitizeName(name);
    const normalizedLabel = sanitizeName(label ?? normalizedName);
    const normalizedSource = validateShaderToySource(source);
    adaptShaderToyFragment(normalizedSource);

    const records = this.getImportedRecords();
    const used = new Set(records.map((entry) => entry.id));
    const base = `custom-${slugify(normalizedName)}`;
    let id = base;
    let i = 2;
    while (used.has(id) || this.builtinById.has(id)) {
      id = `${base}-${i++}`;
    }

    const record = {
      id,
      name: normalizedName,
      label: normalizedLabel,
      source: normalizedSource,
      referencedChannels: extractReferencedChannels(normalizedSource),
      channels: this.buildChannelConfig({
        source: normalizedSource,
        channels,
        autoAssignCapture,
      }),
      defaults: this.normalizeImportedShaderDefaults(
        defaults,
        this.getDefaultImportedShaderDefaults(),
      ),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    records.push(record);
    await this.setImportedRecords(records);
    this._queueImportedShaderThumbnailRegeneration(id);
    return this.getImportedRecord(id) ?? record;
  }

  _buildChannelFromShaderToyInput(input, maps, stack = new Set()) {
    const ctype = String(input?.ctype ?? input?.type ?? "").toLowerCase();
    const src = String(
      input?.src ?? input?.filepath ?? input?.previewfilepath ?? "",
    ).trim();

    if (ctype === "buffer") {
      const inputId = String(input?.id ?? "").trim();
      let pass = maps.passByOutputId.get(inputId);
      if (!pass) {
        const match = src.match(/buffer(?:0?([0-3])|([a-d]))/i);
        if (match) {
          const idx = Number(match[1]);
          if (Number.isInteger(idx) && idx >= 0 && idx <= 3) {
            pass = maps.passByOutputChannel.get(idx) ?? null;
          } else if (match[2]) {
            const alphaIdx = match[2].toLowerCase().charCodeAt(0) - 97;
            if (alphaIdx >= 0 && alphaIdx <= 3) {
              pass = maps.passByOutputChannel.get(alphaIdx) ?? null;
            }
          }
        }
      }
      if (!pass) return { mode: "none" };

      const passKey = String(
        pass.__cpfxPassKey ?? pass?.name ?? pass?.code ?? "",
      );
      if (stack.has(passKey)) {
        console.warn(
          `${this.moduleId} | Ignoring recursive ShaderToy buffer dependency: ${passKey}`,
        );
        return { mode: "none" };
      }

      stack.add(passKey);
      let source = "";
      try {
        source = validateShaderToySource(pass.__cpfxCombinedCode ?? pass.code);
      } catch (_err) {
        source = "";
      }
      if (!source) {
        stack.delete(passKey);
        return { mode: "none" };
      }
      const channels = this._buildChannelsFromShaderToyInputs(
        pass.inputs,
        maps,
        stack,
      );
      stack.delete(passKey);
      return {
        mode: "buffer",
        source,
        channels,
        size: DEFAULT_BUFFER_SIZE,
      };
    }

    if (["texture", "cubemap", "volume", "video"].includes(ctype)) {
      const path = toShaderToyMediaUrl(src);
      if (path) return { mode: "image", path };
    }

    if (
      [
        "music",
        "musicstream",
        "musicstreaming",
        "microphone",
        "mic",
        "keyboard",
        "webcam",
      ].includes(ctype)
    ) {
      return { mode: "none" };
    }

    if (!ctype && src) {
      const path = toShaderToyMediaUrl(src);
      if (path) return { mode: "image", path };
    }

    return { mode: "none" };
  }

  _buildChannelsFromShaderToyInputs(inputs, maps, stack = new Set()) {
    const channels = {};
    for (const index of CHANNEL_INDICES) {
      channels[`iChannel${index}`] = { mode: "none" };
    }

    for (const input of toArray(inputs)) {
      const index = Number(input?.channel);
      if (!Number.isInteger(index) || index < 0 || index > 3) continue;
      channels[`iChannel${index}`] = this._buildChannelFromShaderToyInput(
        input,
        maps,
        stack,
      );
    }
    return channels;
  }

  _normalizeShaderToyApiPayload(payload) {
    if (payload?.Error) {
      throw new Error(String(payload.Error));
    }
    const candidates = [];
    if (payload?.Shader && typeof payload.Shader === "object")
      candidates.push(payload.Shader);
    if (payload?.shader && typeof payload.shader === "object")
      candidates.push(payload.shader);
    if (Array.isArray(payload?.Shaders))
      candidates.push(
        ...payload.Shaders.filter((v) => v && typeof v === "object"),
      );
    if (Array.isArray(payload))
      candidates.push(...payload.filter((v) => v && typeof v === "object"));

    const shader =
      candidates.find((entry) => Array.isArray(entry?.renderpass)) ?? null;
    if (!shader) {
      throw new Error("ShaderToy response did not include render passes.");
    }

    const renderpass = toArray(shader.renderpass)
      .filter((pass) => pass && typeof pass === "object")
      .map((pass) => ({
        ...pass,
        inputs: toArray(pass.inputs),
        outputs: toArray(pass.outputs),
      }))
      .filter(
        (pass) => typeof pass.code === "string" && pass.code.trim().length > 0,
      );

    if (!renderpass.length) {
      throw new Error("ShaderToy response has no usable render pass code.");
    }

    return {
      ...shader,
      info: shader.info && typeof shader.info === "object" ? shader.info : {},
      renderpass,
    };
  }

  async _fetchShaderToyWithApiKey(shaderId, apiKey) {
    const endpoint = `https://www.shadertoy.com/api/v1/shaders/${encodeURIComponent(shaderId)}?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`ShaderToy API request failed (${response.status}).`);
    }
    const json = await response.json();
    return this._normalizeShaderToyApiPayload(json);
  }

  async _importFromNormalizedShaderToy(
    shader,
    { shaderId = "", name = "" } = {},
  ) {
    const renderPasses = shader.renderpass;
    const commonCode = renderPasses
      .filter((pass) => String(pass?.type ?? "").toLowerCase() === "common")
      .map((pass) => String(pass?.code ?? "").trim())
      .filter((code) => code.length > 0)
      .join("\n\n");

    for (const pass of renderPasses) {
      const passCode = String(pass?.code ?? "").trim();
      pass.__cpfxCombinedCode = commonCode
        ? `${commonCode}\n\n${passCode}`
        : passCode;
    }

    const passByOutputId = new Map();
    const passByOutputChannel = new Map();
    for (const pass of renderPasses) {
      pass.__cpfxPassKey = `${pass.type ?? "pass"}:${pass.name ?? ""}:${pass.outputs?.[0]?.id ?? ""}`;
      for (const output of toArray(pass.outputs)) {
        const outId = String(output?.id ?? "").trim();
        if (outId) passByOutputId.set(outId, pass);
        const outCh = Number(output?.channel);
        if (Number.isInteger(outCh) && outCh >= 0 && outCh <= 3) {
          passByOutputChannel.set(outCh, pass);
        }
      }
    }

    let imagePass = renderPasses.find(
      (pass) => String(pass.type ?? "").toLowerCase() === "image",
    );
    if (!imagePass) imagePass = renderPasses[0];
    const imageSource = validateShaderToySource(
      imagePass.__cpfxCombinedCode ?? imagePass.code,
    );

    const channels = this._buildChannelsFromShaderToyInputs(
      imagePass.inputs,
      { passByOutputId, passByOutputChannel },
      new Set(),
    );
    const displayName = sanitizeName(
      name || shader?.info?.name || `ShaderToy ${shaderId || "Imported"}`,
    );
    const record = await this.importShaderToy({
      name: displayName,
      source: imageSource,
      channels,
      autoAssignCapture: false,
    });

    return {
      ...record,
      shaderToyId: shaderId || String(shader?.info?.id ?? "").trim() || null,
      shaderToyUrl: shaderId
        ? `https://www.shadertoy.com/view/${shaderId}`
        : null,
    };
  }

  async importShaderToyFromUrl({ url, name = "", apiKey = "" } = {}) {
    const shaderId = extractShaderToyId(url);
    if (!shaderId) {
      throw new Error("Invalid ShaderToy URL or shader ID.");
    }

    const key = String(apiKey ?? "").trim();
    if (!key) {
      throw new Error(
        "ShaderToy URL import requires an API key (browser CORS blocks anonymous fetch). Use Import ShaderToy JSON for no-key import.",
      );
    }

    const shader = await this._fetchShaderToyWithApiKey(shaderId, key);
    return this._importFromNormalizedShaderToy(shader, { shaderId, name });
  }

  async importShaderToyJson({ json, name = "" } = {}) {
    const parsed = parseShaderToyJsonPayload(json);
    const shader = this._normalizeShaderToyApiPayload(parsed);
    const shaderId = String(shader?.info?.id ?? "").trim();
    return this._importFromNormalizedShaderToy(shader, { shaderId, name });
  }

  async updateImportedShader(
    shaderId,
    {
      name = null,
      label = null,
      source = null,
      channels = null,
      defaults = null,
      autoAssignCapture = true,
    } = {},
  ) {
    const records = this.getImportedRecords();
    const idx = records.findIndex((entry) => entry.id === shaderId);
    if (idx < 0) {
      throw new Error("Imported shader not found.");
    }

    const record = records[idx];
    const nextName =
      name == null ? sanitizeName(record.name) : sanitizeName(name);
    const nextLabel =
      label == null
        ? sanitizeName(record.label ?? nextName)
        : sanitizeName(label);
    const nextSource =
      source == null ? record.source : validateShaderToySource(source);
    adaptShaderToyFragment(nextSource);
    debugLog(this.moduleId, "shader text compile", {
      shaderId,
      context: "editor-save",
      sourceChanged: source != null && nextSource !== record.source,
      sourceLength: String(nextSource ?? "").length,
    });

    const channelInput =
      channels == null
        ? foundry.utils.deepClone(record.channels ?? {})
        : channels;
    const nextChannels = this.buildChannelConfig({
      source: nextSource,
      channels: channelInput,
      autoAssignCapture,
    });

    records[idx] = {
      ...record,
      name: nextName,
      label: nextLabel,
      source: nextSource,
      channels: nextChannels,
      defaults: this.normalizeImportedShaderDefaults(
        defaults ?? record.defaults,
        this.getDefaultImportedShaderDefaults(),
      ),
      referencedChannels: extractReferencedChannels(nextSource),
      updatedAt: Date.now(),
    };

    await this.setImportedRecords(records);
    this._queueImportedShaderThumbnailRegeneration(shaderId);
    return this.getImportedRecord(shaderId) ?? records[idx];
  }

  async updateImportedShaderChannels(
    shaderId,
    { channels = {}, autoAssignCapture = true } = {},
  ) {
    const records = this.getImportedRecords();
    const idx = records.findIndex((entry) => entry.id === shaderId);
    if (idx < 0) {
      throw new Error("Imported shader not found.");
    }

    const record = records[idx];
    const mergedChannels = foundry.utils.mergeObject(
      foundry.utils.deepClone(record.channels ?? {}),
      channels ?? {},
      { inplace: false, recursive: true },
    );
    records[idx] = {
      ...record,
      channels: this.buildChannelConfig({
        source: record.source,
        channels: mergedChannels,
        autoAssignCapture,
      }),
      referencedChannels: extractReferencedChannels(record.source),
      updatedAt: Date.now(),
    };

    await this.setImportedRecords(records);
    this._queueImportedShaderThumbnailRegeneration(shaderId);
    return this.getImportedRecord(shaderId) ?? records[idx];
  }

  async duplicateImportedShader(shaderId, { name = null, label = null } = {}) {
    const source = this.getImportedRecord(shaderId);
    if (!source) throw new Error("Imported shader not found.");

    const nextName = sanitizeName(name ?? `${source.name} Copy`);
    const nextLabel = sanitizeName(
      label ?? `${source.label ?? source.name} Copy`,
    );

    const records = this.getImportedRecords();
    const used = new Set(records.map((entry) => entry.id));
    const base = `custom-${slugify(nextName)}`;
    let id = base;
    let i = 2;
    while (used.has(id) || this.builtinById.has(id)) {
      id = `${base}-${i++}`;
    }

    const clone = foundry.utils.deepClone(source);
    clone.id = id;
    clone.name = nextName;
    clone.label = nextLabel;
    clone.createdAt = Date.now();
    clone.updatedAt = Date.now();
    delete clone.thumbnail;
    delete clone.thumbnailUpdatedAt;

    records.push(clone);
    await this.setImportedRecords(records);
    this._queueImportedShaderThumbnailRegeneration(id);
    return this.getImportedRecord(id) ?? clone;
  }

  async setImportedShaderThumbnail(shaderId, thumbnail) {
    const id = String(shaderId ?? "").trim();
    const dataUrl = String(thumbnail ?? "").trim();
    if (!id) throw new Error("Imported shader not found.");
    if (!dataUrl) throw new Error("Thumbnail image data is empty.");

    const records = this.getImportedRecords();
    const idx = records.findIndex((entry) => entry.id === id);
    if (idx < 0) throw new Error("Imported shader not found.");

    const now = Date.now();
    records[idx] = {
      ...records[idx],
      thumbnail: dataUrl,
      thumbnailUpdatedAt: now,
      updatedAt: now,
    };

    await this.setImportedRecords(records);
    debugLog(this.moduleId, "thumbnail manual save", {
      shaderId: id,
      length: dataUrl.length,
      updatedAt: now,
    });
    return this.getImportedRecord(id) ?? records[idx];
  }

  async removeImportedShader(shaderId) {
    const records = this.getImportedRecords();
    const next = records.filter((entry) => entry.id !== shaderId);
    if (next.length === records.length) return false;

    await this.setImportedRecords(next);
    await this.enforceValidSelection();
    return true;
  }
}



















