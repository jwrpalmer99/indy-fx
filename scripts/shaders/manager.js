import { SHADER_VERT, buildBaseUniforms } from "./common.js";
import {
  getCircleMaskTexture,
  getNoiseTexture,
  getRadialTexture,
  getSolidTexture,
  getVolumeNoiseAtlasTexture,
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
  "cubemap",
  "volume",
  "buffer",
  "bufferSelf",
]);
const MAX_BUFFER_CHAIN_DEPTH = 10;
const DEFAULT_BUFFER_SIZE = 512;
const IMPORTED_NOISE_TEXTURE_SIZE = 1024;
const PLACEABLE_IMAGE_CAPTURE_SIZE = 1024;
const PLACEABLE_IMAGE_PREVIEW_SIZE = 512;
const SHADERTOY_MEDIA_ORIGIN = "https://www.shadertoy.com";
const SHADERTOY_MEDIA_REPLACEMENTS = new Map([
  [
    "https://www.shadertoy.com/media/a/cb49c003b454385aa9975733aff4571c62182ccdda480aaba9a8d250014f00ec.png",
    "modules/indy-fx/images/rgbnoise.webp",
  ],
  [
    "https://www.shadertoy.com/media/a/3871e838723dd6b166e490664eead8ec60aedd6b8d95bc8e2fe3f882f0fd90f0.jpg",
    "modules/indy-fx/images/terrain1.webp",
  ],
  [
    "https://www.shadertoy.com/media/a/fb918796edc3d2221218db0811e240e72e340350008338b0c07a52bd353666a6.jpg",
    "modules/indy-fx/images/rocklichen.webp",
  ],
  [
    "https://www.shadertoy.com/media/a/94284d43be78f00eb6b298e6d78656a1b34e2b91b34940d02f1ca8b22310e8a0.png",
    "modules/indy-fx/images/smallout.webp",
  ],
  [
    "https://www.shadertoy.com/media/a/cd4c518bc6ef165c39d4405b347b51ba40f8d7a065ab0e8d2e4f422cbc1e8a43.jpg",
    "modules/indy-fx/images/bark.webp",
  ],
  [
    "https://www.shadertoy.com/media/a/0c7bf5fe9462d5bffbd11126e82908e39be3ce56220d900f633d58fb432e56f5.png",
    "modules/indy-fx/images/bwnoisesmall.webp",
  ],
  [
    "https://www.shadertoy.com/media/a/f735bee5b64ef98879dc618b016ecf7939a5756040c2cde21ccb15e69a6e1cfb.png",
    "modules/indy-fx/images/rgbnoisesmall.webp",
  ],
  [
    "https://www.shadertoy.com/media/a/1f7dca9c22f324751f2a5a59c9b181dfe3b5564a04b724c657732d0bf09c99db.jpg",
    "modules/indy-fx/images/desk.webp",
  ],
  [
    "https://www.shadertoy.com/media/a/08b42b43ae9d3c0605da11d0eac86618ea888e62cdd9518ee8b9097488b31560.png",
    "modules/indy-fx/images/white_rgb_noise.png",
  ],
  [
    "https://www.shadertoy.com/media/a/3083c722c0c738cad0f468383167a0d246f91af2bfa373e9c5c094fb8c8413e0.png",
    "modules/indy-fx/images/rgbsmall.png",
  ],
  [
    "https://www.shadertoy.com/media/a/0681c014f6c88c356cf9c0394ffe015acc94ec1474924855f45d22c3e70b5785.png",
    "modules/indy-fx/images/0681c015.png",
  ],
  [
    "https://www.shadertoy.com/media/a/0a40562379b63dfb89227e6d172f39fdce9022cba76623f1054a2c83d6c0ba5d.png",
    "modules/indy-fx/images/0a4056d.png",
  ],
  [
    "https://www.shadertoy.com/media/a/e6e5631ce1237ae4c05b3563eda686400a401df4548d0f9fad40ecac1659c46c.jpg",
    "modules/indy-fx/images/brownstar.jpg",
  ],
  [
    "https://www.shadertoy.com/media/a/793a105653fbdadabdc1325ca08675e1ce48ae5f12e37973829c87bea4be3232.png",
    "modules/indy-fx/images/793a105653fbdadabdc1325ca08675e1ce48ae5f12e37973829c87bea4be3232.png",
  ],
  [
    "https://www.shadertoy.com/media/a/79520a3d3a0f4d3caa440802ef4362e99d54e12b1392973e4ea321840970a88a.jpg",
    "modules/indy-fx/images/79520a3d3a0f4d3caa440802ef4362e99d54e12b1392973e4ea321840970a88a.jpg",
  ]
]);
const THUMBNAIL_SIZE = 256;
const THUMBNAIL_CAPTURE_SECONDS = 1.0;
const THUMBNAIL_WEBP_QUALITY = 0.78;
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
  "convertToLightSource",
  "lightUseIlluminationShader",
  "lightUseBackgroundShader",
  "lightFalloffMode",
  "lightColorationIntensity",
  "lightIlluminationIntensity",
  "lightBackgroundIntensity",
  "backgroundGlow",
  "preloadShader",
  "customUniforms",
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

function nowMs() {
  try {
    if (typeof globalThis?.performance?.now === "function") return globalThis.performance.now();
  } catch (_err) {
    // Fall through.
  }
  return Date.now();
}

function roundMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isValidCustomUniformName(name) {
  const key = String(name ?? "").trim();
  return /^[A-Za-z_]\w*$/.test(key);
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

function normalizeCustomUniformMap(value, fallback = null) {
  let source = value;
  if (typeof source === "string" && source.trim()) {
    try {
      source = JSON.parse(source);
    } catch (_err) {
      source = null;
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    source = fallback;
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }
  const normalized = {};
  for (const [name, rawValue] of Object.entries(source)) {
    if (!isValidCustomUniformName(name)) continue;
    const valueNormalized = normalizeCustomUniformValue(rawValue);
    if (valueNormalized === null) continue;
    normalized[name] = valueNormalized;
  }
  return normalized;
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

function encodeThumbnailDataUrlFromCanvas(
  canvas,
  { webpQuality = THUMBNAIL_WEBP_QUALITY } = {},
) {
  const fallback = "";
  if (!(canvas instanceof HTMLCanvasElement)) return fallback;
  try {
    const webp = String(
      canvas.toDataURL("image/webp", Number(webpQuality) || THUMBNAIL_WEBP_QUALITY) ?? "",
    ).trim();
    if (webp.startsWith("data:image/webp") && webp.length > 24) return webp;
  } catch (_err) {
    // Fall through to PNG.
  }
  try {
    return String(canvas.toDataURL("image/png") ?? "").trim();
  } catch (_err) {
    return fallback;
  }
}

function safeJsonLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch (_err) {
    return 0;
  }
}

function collectChannelConfigStats(channelConfig) {
  const stats = {
    channelEntryCount: 0,
    bufferChannelCount: 0,
    maxBufferDepth: 0,
    channelSourceBytes: 0,
    channelPathBytes: 0,
  };
  const walkChannel = (entry, depth = 1) => {
    if (!entry || typeof entry !== "object") return;
    stats.channelEntryCount += 1;
    stats.maxBufferDepth = Math.max(stats.maxBufferDepth, depth);
    if (typeof entry.source === "string") {
      stats.channelSourceBytes += entry.source.length;
    }
    if (typeof entry.path === "string") {
      stats.channelPathBytes += entry.path.length;
    }
    const mode = normalizeChannelMode(entry.mode ?? "auto");
    if (mode === "buffer") stats.bufferChannelCount += 1;
    const nested = entry.channels;
    if (!nested || typeof nested !== "object") return;
    for (const index of CHANNEL_INDICES) {
      const child = nested[`iChannel${index}`] ?? nested[index];
      if (child && typeof child === "object") walkChannel(child, depth + 1);
    }
  };

  if (channelConfig && typeof channelConfig === "object") {
    for (const index of CHANNEL_INDICES) {
      const entry = channelConfig[`iChannel${index}`] ?? channelConfig[index];
      if (entry && typeof entry === "object") walkChannel(entry, 1);
    }
  }
  return stats;
}

function buildShaderLibraryPayloadDiagnostics(records) {
  const list = toArray(records);
  const summary = {
    totalSourceBytes: 0,
    totalCommonSourceBytes: 0,
    totalThumbnailBytes: 0,
    totalDefaultsBytes: 0,
    totalChannelConfigBytes: 0,
    totalChannelSourceBytes: 0,
    totalChannelPathBytes: 0,
    totalChannelEntries: 0,
    totalBufferChannels: 0,
    maxBufferDepth: 0,
    thumbnailCount: 0,
    thumbnailWebpCount: 0,
    thumbnailPngCount: 0,
    thumbnailOtherCount: 0,
    topRecordsByBytes: [],
  };

  const recordsBySize = [];
  for (const record of list) {
    if (!record || typeof record !== "object") continue;
    const id = String(record.id ?? "");
    const sourceBytes = typeof record.source === "string" ? record.source.length : 0;
    const commonSourceBytes =
      typeof record.commonSource === "string" ? record.commonSource.length : 0;
    const thumbnail = typeof record.thumbnail === "string" ? record.thumbnail : "";
    const thumbnailBytes = thumbnail.length;
    const defaultsBytes = safeJsonLength(record.defaults ?? {});
    const channelConfigBytes = safeJsonLength(record.channels ?? {});
    const channelStats = collectChannelConfigStats(record.channels ?? {});
    const totalBytes = safeJsonLength(record);

    summary.totalSourceBytes += sourceBytes;
    summary.totalCommonSourceBytes += commonSourceBytes;
    summary.totalThumbnailBytes += thumbnailBytes;
    summary.totalDefaultsBytes += defaultsBytes;
    summary.totalChannelConfigBytes += channelConfigBytes;
    summary.totalChannelSourceBytes += channelStats.channelSourceBytes;
    summary.totalChannelPathBytes += channelStats.channelPathBytes;
    summary.totalChannelEntries += channelStats.channelEntryCount;
    summary.totalBufferChannels += channelStats.bufferChannelCount;
    summary.maxBufferDepth = Math.max(summary.maxBufferDepth, channelStats.maxBufferDepth);

    if (thumbnailBytes > 0) {
      summary.thumbnailCount += 1;
      if (thumbnail.startsWith("data:image/webp")) summary.thumbnailWebpCount += 1;
      else if (thumbnail.startsWith("data:image/png")) summary.thumbnailPngCount += 1;
      else summary.thumbnailOtherCount += 1;
    }

    recordsBySize.push({
      id,
      totalBytes,
      sourceBytes,
      commonSourceBytes,
      thumbnailBytes,
      defaultsBytes,
      channelConfigBytes,
      channelSourceBytes: channelStats.channelSourceBytes,
      bufferChannelCount: channelStats.bufferChannelCount,
    });
  }

  recordsBySize.sort((a, b) => Number(b.totalBytes || 0) - Number(a.totalBytes || 0));
  summary.topRecordsByBytes = recordsBySize.slice(0, 5);
  return summary;
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
  const resolveBufferSizeCap = () => {
    try {
      const renderer = canvas?.app?.renderer ?? null;
      const gl = renderer?.gl ?? renderer?.context?.gl ?? null;
      const maxTex = Number(gl?.getParameter?.(gl?.MAX_TEXTURE_SIZE));
      if (Number.isFinite(maxTex) && maxTex > 0) return Math.round(maxTex);
    } catch (_err) {
      // Fall through to conservative default cap.
    }
    return 2048;
  };
  const maxSize = Math.max(64, resolveBufferSizeCap());
  const fallbackSize = Number(fallback);
  const normalizedFallback =
    Number.isFinite(fallbackSize) && fallbackSize > 0
      ? Math.max(64, Math.min(maxSize, Math.round(fallbackSize)))
      : Math.max(64, Math.min(maxSize, DEFAULT_BUFFER_SIZE));
  const size = Number(value);
  if (!Number.isFinite(size)) return normalizedFallback;
  return Math.max(64, Math.min(maxSize, Math.round(size)));
}

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

function getChannelSamplerDefaults(mode) {
  const normalized = normalizeChannelMode(mode);
  if (normalized === "cubemap") return { filter: "linear", wrap: "clamp" };
  if (normalized === "buffer" || normalized === "bufferSelf") {
    return { filter: "nearest", wrap: "clamp" };
  }
  if (
    normalized === "sceneCapture" ||
    normalized === "tokenTileImage" ||
    normalized === "tokenImage" ||
    normalized === "tileImage" ||
    normalized === "empty" ||
    normalized === "white" ||
    normalized === "none"
  ) {
    return { filter: "linear", wrap: "clamp" };
  }
  return { filter: "linear", wrap: "repeat" };
}

function applyChannelSamplerToTexture(texture, channelCfg, mode) {
  const base = texture?.baseTexture;
  if (!base) return;
  const defaults = getChannelSamplerDefaults(mode);
  const filter = normalizeSamplerFilter(channelCfg?.samplerFilter, defaults.filter);
  const wrap = normalizeSamplerWrap(channelCfg?.samplerWrap, defaults.wrap);

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

function isLikelyVideoPath(path) {
  const raw = String(path ?? "").trim().toLowerCase();
  if (!raw) return false;
  return /\.(webm|mp4|m4v|mov|ogv|ogg)(?:[?#].*)?$/.test(raw);
}

function createImportedChannelTexture(path) {
  const normalized = String(path ?? "").trim();
  if (!normalized) return PIXI.Texture.WHITE;

  if (!isLikelyVideoPath(normalized)) return PIXI.Texture.from(normalized);
  try {
    return PIXI.Texture.from(normalized, {
      resourceOptions: {
        autoPlay: false,
        autoLoad: true,
      },
    });
  } catch (_err) {
    return PIXI.Texture.from(normalized);
  }
}

const VIDEO_PLAY_REQUESTED = new WeakSet();

function ensureVideoTexturePlayback(texture, sourcePath = "") {
  const base = texture?.baseTexture;
  if (!base) return false;
  if (!isLikelyVideoPath(sourcePath)) return false;

  const resource = base?.resource ?? null;
  const media =
    resource?.source ??
    resource?.media ??
    resource?.video ??
    null;
  const isVideoElement =
    typeof HTMLVideoElement !== "undefined" &&
    media instanceof HTMLVideoElement;
  if (!isVideoElement) return false;

  try {
    media.muted = true;
    media.loop = true;
    media.autoplay = false;
    media.playsInline = true;
    media.preload = "auto";
  } catch (_err) {
    // Ignore media property failures.
  }

  try {
    if (resource && typeof resource === "object") {
      // Avoid Pixi autoplay recursion on some browsers/video codecs.
      if ("autoPlay" in resource) resource.autoPlay = false;
      if ("_autoPlay" in resource) resource._autoPlay = false;
      if ("autoUpdate" in resource) resource.autoUpdate = true;
    }
    if ("autoUpdate" in base) base.autoUpdate = true;
  } catch (_err) {
    // Ignore resource property failures.
  }

  try {
    if (!VIDEO_PLAY_REQUESTED.has(media)) {
      VIDEO_PLAY_REQUESTED.add(media);
      const tryPlay = () => {
        try {
          const playPromise = media.play?.();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {
              VIDEO_PLAY_REQUESTED.delete(media);
            });
          }
        } catch (_err) {
          VIDEO_PLAY_REQUESTED.delete(media);
        }
      };
      if (Number(media.readyState ?? 0) >= 2) tryPlay();
      else media.addEventListener?.("loadeddata", tryPlay, { once: true });
    }
  } catch (_err) {
    // Ignore playback failures.
  }

  base.update?.();
  return true;
}

function getSamplerWrapUniformCode(wrap) {
  if (wrap === "clamp") return 0;
  if (wrap === "mirror") return 2;
  return 1; // repeat
}

function normalizePositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function inferVolumeLayoutFromResolution(width, height) {
  const w = normalizePositiveInt(width, 0);
  const h = normalizePositiveInt(height, 0);
  if (w <= 0 || h <= 0) return [1, 1, 1];

  const gcd = (a, b) => {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y !== 0) {
      const t = x % y;
      x = y;
      y = t;
    }
    return x || 1;
  };
  const g = gcd(w, h);
  const divisors = [];
  for (let d = 1; d * d <= g; d += 1) {
    if (g % d !== 0) continue;
    divisors.push(d);
    const other = g / d;
    if (other !== d) divisors.push(other);
  }

  let best = { score: Number.POSITIVE_INFINITY, s: 1, tx: 1, ty: 1, depth: 1 };
  for (const s of divisors) {
    const tilesX = Math.max(1, Math.floor(w / s));
    const tilesY = Math.max(1, Math.floor(h / s));
    const depth = Math.max(1, tilesX * tilesY);
    const ratio = depth / Math.max(1, s);
    const score = Math.abs(Math.log(ratio));
    const tieBreak = -depth;
    const better =
      score < best.score - 1e-6 ||
      (Math.abs(score - best.score) <= 1e-6 && tieBreak < -best.depth);
    if (better) best = { score, s, tx: tilesX, ty: tilesY, depth };
  }
  return [best.tx, best.ty, best.depth];
}

function getChannelTypeFromMode(mode) {
  const normalized = normalizeChannelMode(mode);
  if (normalized === "cubemap") return 1;
  if (normalized === "volume") return 2;
  return 0;
}

function resolveVolumeLayoutForChannel(channelCfg, resolution = [1, 1]) {
  const width = Number(resolution?.[0] ?? 1);
  const height = Number(resolution?.[1] ?? 1);
  const deriveFromVoxelSize = (vx, vy, vz) => {
    const voxelW = normalizePositiveInt(vx, 0);
    const voxelH = normalizePositiveInt(vy, 0);
    const depth = Math.max(1, normalizePositiveInt(vz, 0));
    if (voxelW <= 0 || voxelH <= 0) return null;
    const atlasW = Math.max(1, Math.floor(width));
    const atlasH = Math.max(1, Math.floor(height));
    if (atlasW % voxelW !== 0 || atlasH % voxelH !== 0) return null;
    const tilesX = Math.max(1, Math.floor(atlasW / voxelW));
    const tilesY = Math.max(1, Math.floor(atlasH / voxelH));
    if (tilesX * tilesY < depth) return null;
    return [tilesX, tilesY, depth];
  };

  const tx = normalizePositiveInt(channelCfg?.volumeTilesX, 0);
  const ty = normalizePositiveInt(channelCfg?.volumeTilesY, 0);
  const dz = normalizePositiveInt(channelCfg?.volumeDepth, 0);
  if (tx > 0 && ty > 0) {
    const depth = dz > 0 ? dz : tx * ty;
    // Back-compat safety: older imports could store voxel dimensions into
    // volumeTilesX/Y/Depth (for example 32x32x32) which causes seams/artifacts.
    const candidateTileW = width / tx;
    const candidateTileH = height / ty;
    const looksLikeVoxelDims =
      depth > 0 &&
      tx * ty > depth * 8 &&
      (candidateTileW <= 8 || candidateTileH <= 8);
    if (looksLikeVoxelDims) {
      const recovered = deriveFromVoxelSize(tx, ty, depth);
      if (recovered) return recovered;
    }
    return [tx, ty, depth];
  }

  const volumeSizeX = normalizePositiveInt(channelCfg?.volumeSizeX, 0);
  const volumeSizeY = normalizePositiveInt(channelCfg?.volumeSizeY, 0);
  const volumeSizeZ = normalizePositiveInt(channelCfg?.volumeSizeZ, 0);
  if (volumeSizeX > 0 && volumeSizeY > 0 && volumeSizeZ > 0) {
    const derived = deriveFromVoxelSize(volumeSizeX, volumeSizeY, volumeSizeZ);
    if (derived) return derived;
  }

  return inferVolumeLayoutFromResolution(width, height);
}

function computeVolumeAtlasSampleUniforms(layout, resolution = [1, 1]) {
  const tilesX = Math.max(1, normalizePositiveInt(layout?.[0], 1));
  const tilesY = Math.max(1, normalizePositiveInt(layout?.[1], 1));
  const defaultDepth = tilesX * tilesY;
  const depth = Math.max(1, normalizePositiveInt(layout?.[2], defaultDepth));
  const atlasW = Math.max(1, Number(resolution?.[0] ?? 1));
  const atlasH = Math.max(1, Number(resolution?.[1] ?? 1));

  const tileSizeX = 1 / tilesX;
  const tileSizeY = 1 / tilesY;
  const insetX = 0.5 / atlasW;
  const insetY = 0.5 / atlasH;
  const innerX = Math.max(tileSizeX - 2 * insetX, 1e-6);
  const innerY = Math.max(tileSizeY - 2 * insetY, 1e-6);

  return {
    sampleParams: [tilesX, Math.max(0, depth - 1), 0, 0],
    uvParams: [insetX, insetY, innerX, innerY],
  };
}

function normalizeChannelInput(raw, depth = 0) {
  if (!raw || typeof raw !== "object")
    return {
      mode: "auto",
      path: "",
      source: "",
      channels: {},
      size: DEFAULT_BUFFER_SIZE,
      samplerInternal: "",
    };
  const nested = {};
  const nestedRaw = raw.channels;
  const normalizedMode = normalizeChannelMode(raw.mode);
  const samplerInternal = normalizeSamplerInternal(raw.samplerInternal, "");
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
    mode: normalizedMode,
    path: applyKnownShaderToyMediaReplacement(String(raw.path ?? "").trim()),
    source: String(raw.source ?? "").trim(),
    channels: nested,
    size: normalizeBufferSize(raw.size, DEFAULT_BUFFER_SIZE),
    volumeTilesX: normalizePositiveInt(raw.volumeTilesX, 0),
    volumeTilesY: normalizePositiveInt(raw.volumeTilesY, 0),
    volumeDepth: normalizePositiveInt(raw.volumeDepth, 0),
    volumeSizeX: normalizePositiveInt(raw.volumeSizeX, 0),
    volumeSizeY: normalizePositiveInt(raw.volumeSizeY, 0),
    volumeSizeZ: normalizePositiveInt(raw.volumeSizeZ, 0),
    samplerFilter: normalizeSamplerFilter(raw.samplerFilter, ""),
    samplerWrap: normalizeSamplerWrap(raw.samplerWrap, ""),
    samplerVflip:
      raw.samplerVflip === undefined || raw.samplerVflip === null
        ? null
        : parseBooleanLike(raw.samplerVflip),
    samplerInternal,
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

function normalizeShaderToyMediaLookupKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  let candidate = raw;
  if (/^\/?media\//i.test(raw)) {
    candidate = raw.startsWith("/")
      ? `${SHADERTOY_MEDIA_ORIGIN}${raw}`
      : `${SHADERTOY_MEDIA_ORIGIN}/${raw}`;
  }

  try {
    const url = new URL(candidate);
    const origin = `${url.protocol}//${url.host}`.toLowerCase();
    return `${origin}${url.pathname}`.toLowerCase();
  } catch (_err) {
    return raw.replace(/[?#].*$/, "").toLowerCase();
  }
}

function applyKnownShaderToyMediaReplacement(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = normalizeShaderToyMediaLookupKey(raw);
  return SHADERTOY_MEDIA_REPLACEMENTS.get(key) ?? raw;
}

function toShaderToyMediaUrl(src) {
  const value = String(src ?? "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return applyKnownShaderToyMediaReplacement(value);
  if (value.startsWith("/")) {
    return applyKnownShaderToyMediaReplacement(`${SHADERTOY_MEDIA_ORIGIN}${value}`);
  }
  return applyKnownShaderToyMediaReplacement(
    `${SHADERTOY_MEDIA_ORIGIN}/${value.replace(/^\/+/, "")}`,
  );
}

function inferShaderToyVolumeNoiseMode(input, src = "") {
  const hints = [
    String(input?.id ?? ""),
    String(input?.name ?? ""),
    String(input?.filepath ?? ""),
    String(input?.previewfilepath ?? ""),
    String(src ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  const looksGray =
    /\b(gray|grey|grayscale|greyscale|bw|mono|luma|single)\b/.test(hints);
  const looksColor =
    /\b(rgba|rgb|color|colour|colou?rful|multi)\b/.test(hints);

  if (looksGray && !looksColor) return "noiseBw";
  return "noiseRgb";
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

function updatePreviewShaderUniforms(shader, dtSeconds, speed, timeSeconds) {
  const safeDt = Math.max(0, Number(dtSeconds) || 0);
  const safeSpeed = Math.max(0, Number(speed) || 0);
  const safeTime = Math.max(0, Number(timeSeconds) || 0);
  const shaderDt = safeDt * safeSpeed;
  shader.uniforms.time = safeTime * safeSpeed;
  if ("uTime" in shader.uniforms) shader.uniforms.uTime = shader.uniforms.time;
  if ("iTime" in shader.uniforms) shader.uniforms.iTime = shader.uniforms.time;
  if ("iTimeDelta" in shader.uniforms) shader.uniforms.iTimeDelta = shaderDt;
  if ("iFrame" in shader.uniforms)
    shader.uniforms.iFrame = (shader.uniforms.iFrame ?? 0) + 1;
  if ("iFrameRate" in shader.uniforms)
    shader.uniforms.iFrameRate = shaderDt > 0 ? 1 / shaderDt : 60;
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
    this.shaderLibraryIndexSetting = "shaderLibraryIndex";
    this.shaderLibraryRecordSettingPrefix = "shaderRecord_";
    this.selectionSetting = "shaderPreset";
    this.builtinById = new Map(BUILTIN_SHADERS.map((s) => [s.id, s]));

    this._shaderLibraryRevision = 0;
    this._shaderLibrarySettingHookId = null;
    this._shaderLibrarySettingSyncTimer = null;
    this._shaderLibrarySettingSyncChangedIds = new Set();
    this._isPersistingImportedRecords = false;
    this._shaderChoiceCache = null;
    this._shaderChoiceCacheByTarget = new Map();
    this._tokenTileUsageCache = null;
    this._backgroundCompilePending = new Set();
    this._backgroundCompileDone = new Set();
    this._previewCaptureTextureCache = new Map();
    this._pendingPreviewTextureLoads = new Set();
    this._pendingThumbnailRegenerations = new Map();
    this._pendingThumbnailRegenerationRerun = new Set();
    this._pendingThumbnailRegenerationNextOptions = new Map();
    this._thumbnailRenderer = null;
    this._thumbnailRendererCanvas = null;
    this._thumbnailRendererSize = 0;
    this._lastSetImportedRecordsMetrics = null;
    this._registeredShaderRecordSettings = new Set();
    this._channelTextureLoadErrorNotified = new Set();
  
    this._ensurePreviewReferenceTexturesLoaded();
  }


  registerSettings() {
    game.settings.register(this.moduleId, this.shaderLibraryIndexSetting, {
      name: "Imported shader presets index",
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

  _getConfiguredPreviewTexturePath(settingKey, relativePath, fallbackPath) {
    const configured = String(
      game?.settings?.get?.(this.moduleId, settingKey) ?? "",
    ).trim();
    if (configured) return configured;
    return this._getModuleAssetPath(relativePath, fallbackPath);
  }

  _getPreviewSceneCaptureTexturePath() {
    return this._getConfiguredPreviewTexturePath(
      "previewSceneCaptureBackground",
      "images/indyFX_solid.webp",
      PREVIEW_SCENE_CAPTURE_TEXTURE,
    );
  }

  _getPreviewPlaceableCaptureTexturePath() {
    return this._getConfiguredPreviewTexturePath(
      "previewPlaceableCaptureBackground",
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

    const texture = createImportedChannelTexture(normalized);
    const base = texture?.baseTexture;
    if (!base) return null;
    ensureVideoTexturePlayback(texture, normalized);

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

  _notifyImportedChannelTextureLoadError({
    shaderId = "",
    shaderLabel = "",
    channelKey = "",
    path = "",
  } = {}) {
    const normalizedPath = String(path ?? "").trim();
    if (!normalizedPath) return;

    const displayShader =
      String(shaderLabel ?? "").trim() ||
      String(shaderId ?? "").trim() ||
      "Imported Shader";
    const displayChannel = String(channelKey ?? "").trim() || "iChannel?";
    const dedupeKey = `${displayShader}|${displayChannel}|${normalizedPath}`;
    if (this._channelTextureLoadErrorNotified.has(dedupeKey)) return;
    this._channelTextureLoadErrorNotified.add(dedupeKey);

    globalThis.ui?.notifications?.error?.(
      `Failed to load shader channel image for "${displayShader}" ` +
        `(${displayChannel}): ${normalizedPath}`,
    );
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

  _isShaderLibraryRelatedSettingKey(settingKey) {
    const key = String(settingKey ?? "").trim();
    if (!key) return false;
    const prefix = `${this.moduleId}.`;
    if (!key.startsWith(prefix)) return false;
    const localKey = key.slice(prefix.length);
    if (localKey === this.shaderLibraryIndexSetting) {
      return true;
    }
    return localKey.startsWith(this.shaderLibraryRecordSettingPrefix);
  }

  _ensureShaderLibrarySettingHook() {
    if (this._shaderLibrarySettingHookId !== null) return;
    if (!globalThis?.Hooks?.on) return;

    this._shaderLibrarySettingHookId = Hooks.on("updateSetting", (setting) => {
      const key = String(setting?.key ?? setting?.id ?? "").trim();
      if (!this._isShaderLibraryRelatedSettingKey(key)) return;
      this._shaderLibraryRevision += 1;
      this._invalidateShaderChoiceCaches();
      if (this._isPersistingImportedRecords) return;

      const localKey = key.startsWith(`${this.moduleId}.`)
        ? key.slice(`${this.moduleId}.`.length)
        : "";
      const changedIds = this._shaderLibrarySettingSyncChangedIds;
      if (localKey === this.shaderLibraryIndexSetting) {
        const indexEntries = Array.isArray(setting?.value) ? setting.value : [];
        for (const entry of indexEntries) {
          const id = String(entry?.id ?? "").trim();
          if (id) changedIds.add(id);
        }
      } else {
        const id = String(setting?.value?.id ?? "").trim();
        if (id) changedIds.add(id);
      }

      if (this._shaderLibrarySettingSyncTimer !== null) {
        clearTimeout(this._shaderLibrarySettingSyncTimer);
      }
      this._shaderLibrarySettingSyncTimer = setTimeout(() => {
        this._shaderLibrarySettingSyncTimer = null;
        const changedShaderIds = Array.from(changedIds);
        changedIds.clear();
        Hooks.callAll(`${this.moduleId}.shaderLibraryChanged`, {
          context: "update-setting-sync",
          operation: "setting-sync",
          changedShaderIds,
          addedShaderIds: [],
          updatedShaderIds: changedShaderIds,
          removedShaderIds: [],
          choicesMayHaveChanged: true,
          recordCount: this._getImportedLibraryIndexEntries().length,
        });
      }, 120);
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

    const sourcePath =
      typeof textureInput === "string" ? String(textureInput ?? "").trim() : "";
    const rotationDeg = toFiniteNumber(captureRotationDeg, 0);
    const flipH = parseBooleanLike(captureFlipHorizontal);
    const flipV = parseBooleanLike(captureFlipVertical);
    const forceOpaque = parseBooleanLike(forceOpaqueAlpha);

    debugLog(this.moduleId, "preview capture texture: effective transform", {
      sourcePath: sourcePath || null,
      forceOpaque,
      effective: {
        captureRotationDeg: rotationDeg,
        captureFlipHorizontal: flipH,
        captureFlipVertical: flipV,
      },
    });

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
        "v3",
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
          // Match PIXI sprite transform order used by live token/tile capture: R then S.
          ctx.rotate((rotationDeg * Math.PI) / 180);
          ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
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
      convertToLightSource: false,
      lightUseIlluminationShader: true,
      lightUseBackgroundShader: false,
      lightFalloffMode: "brightDim",
      lightColorationIntensity: 1.0,
      lightIlluminationIntensity: 1.0,
      lightBackgroundIntensity: 1.0,
      backgroundGlow: 0.0,
      preloadShader: false,
      customUniforms: {},
    };
  }

  normalizeImportedShaderDefaults(defaults = {}, fallback = null) {
    const source = defaults && typeof defaults === "object" ? defaults : {};
    const base =
      fallback && typeof fallback === "object"
        ? foundry.utils.mergeObject({}, fallback, { inplace: false })
        : this.getDefaultImportedShaderDefaults();

    const layerRaw = String(source.layer ?? base.layer ?? "inherit").trim();
    const layerNormalized = layerRaw === "drawingsLayer"
      ? "drawings"
      : (layerRaw === "effects" || layerRaw === "effectsLayer")
        ? "belowTokens"
      : layerRaw === "interface"
          ? "interfacePrimary"
          : layerRaw === "token"
            ? "interfacePrimary"
                    : layerRaw === "belowTiles"
            ? "belowTiles"
            : layerRaw === "baseEffects"
              ? "belowTokens"
            : layerRaw;
    const layer = [
      "inherit",
      "interfacePrimary",
      "belowTiles",
      "belowTokens",
      "drawings",
    ].includes(layerNormalized)
      ? layerNormalized
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
      convertToLightSource:
        source.convertToLightSource === true ||
        source.convertToLightSource === 1 ||
        source.convertToLightSource === "1" ||
        source.convertToLightSource === "true" ||
        source.convertToLightSource === "on",
      lightUseIlluminationShader:
        source.lightUseIlluminationShader === true ||
        source.lightUseIlluminationShader === 1 ||
        source.lightUseIlluminationShader === "1" ||
        source.lightUseIlluminationShader === "true" ||
        source.lightUseIlluminationShader === "on",
      lightUseBackgroundShader:
        source.lightUseBackgroundShader === true ||
        source.lightUseBackgroundShader === 1 ||
        source.lightUseBackgroundShader === "1" ||
        source.lightUseBackgroundShader === "true" ||
        source.lightUseBackgroundShader === "on",
      lightFalloffMode: (() => {
        const raw = String(source.lightFalloffMode ?? base.lightFalloffMode ?? "brightDim")
          .trim()
          .toLowerCase();
        if (raw === "none") return "none";
        if (raw === "linear") return "linear";
        if (raw === "exponential") return "exponential";
        if (raw === "brightdim" || raw === "usebrightdim" || raw === "use-bright-dim")
          return "brightDim";
        return "brightDim";
      })(),
      lightColorationIntensity: Math.max(
        0,
        Math.min(
          5,
          toFiniteNumber(
            source.lightColorationIntensity,
            toFiniteNumber(base.lightColorationIntensity, 1),
          ),
        ),
      ),
      lightIlluminationIntensity: Math.max(
        0,
        Math.min(
          20,
          toFiniteNumber(
            source.lightIlluminationIntensity,
            toFiniteNumber(base.lightIlluminationIntensity, 1),
          ),
        ),
      ),
      lightBackgroundIntensity: Math.max(
        0,
        Math.min(
          20,
          toFiniteNumber(
            source.lightBackgroundIntensity,
            toFiniteNumber(base.lightBackgroundIntensity, 1),
          ),
        ),
      ),
      backgroundGlow: Math.max(
        0,
        Math.min(
          5,
          toFiniteNumber(source.backgroundGlow, toFiniteNumber(base.backgroundGlow, 0)),
        ),
      ),
      preloadShader:
        source.preloadShader === true ||
        source.preloadShader === 1 ||
        source.preloadShader === "1" ||
        source.preloadShader === "true" ||
        source.preloadShader === "on",
      customUniforms: normalizeCustomUniformMap(
        source.customUniforms,
        base.customUniforms,
      ),
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
      commonSource = null,
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
    if (commonSource !== null && commonSource !== undefined) {
      previewRecord.commonSource = this._normalizeCommonSource(commonSource);
    } else {
      previewRecord.commonSource = this._normalizeCommonSource(
        previewRecord.commonSource,
      );
    }
    const previewComposedSource = this._composeShaderSourceWithCommon(
      previewRecord.source,
      previewRecord.commonSource,
    );
    phaseMs.sourceOverride = perfNow() - tSource0;

    const tRefs0 = perfNow();
    try {
      previewRecord.referencedChannels = extractReferencedChannels(
        previewComposedSource,
      );
    } catch (_err) {
      previewRecord.referencedChannels = [];
    }
    phaseMs.referencedChannels = perfNow() - tRefs0;

    const tChannels0 = perfNow();
    if (channels && typeof channels === "object") {
      try {
        // Editor/HUD channel payloads are often flat (top-level only).
        // Preserve existing nested buffer graphs (for example bufferSelf feedback)
        // so preview/thumbnail match runtime behavior.
        const baseChannels = this.getRecordChannelConfig(previewRecord);
        const mergedChannels = this._mergeChannelsPreservingNested(
          baseChannels,
          channels,
        );
        previewRecord.channels = this.buildChannelConfig({
          source: previewComposedSource,
          commonSource: previewRecord.commonSource,
          channels: mergedChannels,
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
    const previewChannelConfig = this.getRecordChannelConfig(previewRecord);
    const previewHasBufferPass =
      channelConfigHasMode(previewChannelConfig, "buffer") ||
      channelConfigHasMode(previewChannelConfig, "bufferSelf");
    const previewDefinition = {
      id: previewRecord.id,
      label: sanitizeName(previewRecord.label ?? previewRecord.name),
      type: "imported",
      commonSource: previewRecord.commonSource,
      requiresResolution: true,
      usesNoiseTexture: true,
      channelConfig: previewChannelConfig,
      referencedChannels: toArray(previewRecord.referencedChannels)
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v <= 3),
      fragment: adaptShaderToyFragment(previewComposedSource, {
        sanitizeColor: previewHasBufferPass ? false : undefined,
      }),
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

    let timeSeconds = 0;
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
        timeSeconds += dt;
        updatePreviewShaderUniforms(shader, dt, speed, timeSeconds);
      },
      render: (renderer, target = null) => {
        if (!renderer) return;
        const bufferDt = pendingBufferDt > 0 ? pendingBufferDt : 1 / 60;
        pendingBufferDt = 0;
        for (const runtimeBuffer of runtimeBuffers) {
          runtimeBuffer.update(bufferDt * Math.max(0, Number(speed) || 0), renderer);
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
    const changedShaderIds = [];
    for (const raw of incoming) {
      if (!raw || typeof raw !== "object") continue;

      const name = sanitizeName(raw.name ?? raw.label ?? "Imported Shader");
      const label = sanitizeName(raw.label ?? name);
      const commonSource = this._normalizeCommonSource(raw.commonSource);

      let sourceText = "";
      try {
        sourceText = validateShaderToySource(raw.source);
      } catch (_err) {
        continue;
      }
      const composedSource = this._composeShaderSourceWithCommon(
        sourceText,
        commonSource,
      );

      const baseIdRaw = String(raw.id ?? "").trim();
      const fallbackBaseId = slugify(name);
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
        source: composedSource,
        commonSource,
        channels: raw.channels,
        autoAssignCapture: true,
      });

      const normalized = {
        id,
        name,
        label,
        source: sourceText,
        commonSource,
        referencedChannels: extractReferencedChannels(composedSource),
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
      changedShaderIds.push(id);
    }

    if (changedShaderIds.length > 0 || replace === true) {
      await this.setImportedRecords(records, {
        context: "importImportedShadersPayload",
        changedShaderIds,
        operation: replace ? "import-replace" : "import-merge",
      });
    }
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
    let timeSeconds = 0;

    return {
      size,
      shader,
      container,
      step: (dtSeconds = 1 / 60) => {
        const dt = Math.max(0, Number(dtSeconds) || 0);
        pendingBufferDt += dt;
        timeSeconds += dt;
        updatePreviewShaderUniforms(shader, dt, 1, timeSeconds);
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
    {
      size = THUMBNAIL_SIZE,
      captureSeconds = THUMBNAIL_CAPTURE_SECONDS,
      source = null,
      commonSource = null,
      channels = null,
      defaults = null,
      autoAssignCapture = null,
    } = {},
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
      source,
      commonSource,
      channels,
      defaults,
      autoAssignCapture,
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
      const thumbnail = encodeThumbnailDataUrlFromCanvas(renderedCanvas, {
        webpQuality: THUMBNAIL_WEBP_QUALITY,
      });
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
      debugLog(this.moduleId, "thumbnail regenerate encoded", {
        shaderId,
        format: thumbnail.startsWith("data:image/webp")
          ? "webp"
          : (thumbnail.startsWith("data:image/png") ? "png" : "other"),
        bytes: thumbnail.length,
      });
      await this.setImportedRecords(records, {
        context: "regenerateImportedShaderThumbnail",
        changedShaderIds: [shaderId],
        operation: "thumbnail-regenerate",
      });
      return records[idx];
    } finally {
      preview.destroy();
    }
  }
  _queueImportedShaderThumbnailRegeneration(shaderId, options = {}) {
    const id = String(shaderId ?? "").trim();
    if (!id) return;
    if (this._pendingThumbnailRegenerations.has(id)) {
      const existingNextOptions =
        this._pendingThumbnailRegenerationNextOptions.get(id) ?? {};
      this._pendingThumbnailRegenerationNextOptions.set(id, {
        ...existingNextOptions,
        ...(options && typeof options === "object" ? options : {}),
      });
      this._pendingThumbnailRegenerationRerun.add(id);
      debugLog(this.moduleId, "thumbnail regenerate deferred (pending in-flight)", {
        shaderId: id,
      });
      return;
    }

    this._pendingThumbnailRegenerationNextOptions.delete(id);
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
        const shouldRerun = this._pendingThumbnailRegenerationRerun.delete(id);
        if (shouldRerun) {
          const nextOptions =
            this._pendingThumbnailRegenerationNextOptions.get(id) ?? {};
          this._pendingThumbnailRegenerationNextOptions.delete(id);
          this._queueImportedShaderThumbnailRegeneration(id, nextOptions);
        }
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
      cubemap: "Cubemap (2D atlas)",
      volume: "Volume 3D (2D atlas)",
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

  _encodeShaderRecordSettingToken(shaderId) {
    const raw = String(shaderId ?? "").trim();
    if (!raw) return "";
    try {
      const utf8 = encodeURIComponent(raw).replace(
        /%([0-9A-F]{2})/g,
        (_match, hex) => String.fromCharCode(parseInt(hex, 16)),
      );
      const encoded = String(globalThis?.btoa?.(utf8) ?? "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
      if (encoded) return encoded;
    } catch (_err) {
      // Fall through to deterministic hash token.
    }

    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
      hash = ((hash * 31) + raw.charCodeAt(i)) >>> 0;
    }
    return `${slugify(raw)}-${hash.toString(36)}`;
  }

  _buildShaderRecordSettingKey(shaderId) {
    const token = this._encodeShaderRecordSettingToken(shaderId);
    return `${this.shaderLibraryRecordSettingPrefix}${token || "shader"}`;
  }

  _registerShaderRecordSetting(settingKey) {
    const key = String(settingKey ?? "").trim();
    if (!key) return;
    if (this._registeredShaderRecordSettings.has(key)) return;
    const fullKey = `${this.moduleId}.${key}`;
    if (game?.settings?.settings?.has?.(fullKey)) {
      this._registeredShaderRecordSettings.add(key);
      return;
    }
    game.settings.register(this.moduleId, key, {
      name: `Imported shader record ${key}`,
      scope: "world",
      config: false,
      type: Object,
      default: null,
    });
    this._registeredShaderRecordSettings.add(key);
  }

  _normalizeCommonSource(value) {
    if (typeof value !== "string") return "";
    return value.trim();
  }

  _composeShaderSourceWithCommon(source, commonSource) {
    const mainSource = String(source ?? "").trim();
    const sharedCommonSource = this._normalizeCommonSource(commonSource);
    if (!sharedCommonSource) return mainSource;
    if (!mainSource) return sharedCommonSource;
    return `${sharedCommonSource}\n\n${mainSource}`;
  }

  _normalizeImportedRecord(rawRecord, { fallbackId = "", fallbackName = "" } = {}) {
    const entry = rawRecord && typeof rawRecord === "object" ? rawRecord : null;
    if (!entry) return null;

    const id = String(entry.id ?? fallbackId ?? "").trim();
    if (!id) return null;

    const source = entry.source;
    if (typeof source !== "string") return null;

    const nextName = sanitizeName(entry.name ?? fallbackName ?? id);
    return {
      ...entry,
      id,
      name: nextName,
      label: sanitizeName(entry.label ?? nextName),
      commonSource: this._normalizeCommonSource(entry.commonSource),
      thumbnail: typeof entry.thumbnail === "string" ? entry.thumbnail : "",
      defaults: this.normalizeImportedShaderDefaults(
        entry.defaults,
        this.getDefaultImportedShaderDefaults(),
      ),
    };
  }

  _coerceRecordCollectionToArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];

    // Single-record object shape.
    if (
      typeof value.source === "string" &&
      (typeof value.id === "string" || typeof value.name === "string")
    ) {
      return [value];
    }

    if (Array.isArray(value.shaders)) return value.shaders;
    if (Array.isArray(value.records)) return value.records;

    return Object.values(value);
  }

  _normalizeImportedRecordArray(records) {
    return this._coerceRecordCollectionToArray(records)
      .map((entry) => this._normalizeImportedRecord(entry))
      .filter((entry) => !!entry);
  }

  _getImportedLibraryIndexEntries() {
    const raw = game.settings.get(this.moduleId, this.shaderLibraryIndexSetting);
    const list = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === "object")
        ? Object.entries(raw).map(([id, value]) => {
            if (typeof value === "string") return { id, settingKey: value };
            if (value && typeof value === "object") {
              return {
                id: String(value.id ?? id),
                settingKey: String(
                  value.settingKey ?? value.key ?? value.path ?? "",
                ),
              };
            }
            return null;
          })
        : [];
    const seen = new Set();
    const normalized = [];

    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const id = String(entry.id ?? "").trim();
      const settingKey = String(entry.settingKey ?? "").trim();
      if (!id || !settingKey) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      normalized.push({
        id,
        settingKey,
      });
    }
    return normalized;
  }

  _getImportedRecordsFromIndex(indexEntries) {
    const records = [];
    for (const indexEntry of toArray(indexEntries)) {
      const id = String(indexEntry?.id ?? "").trim();
      const settingKey = String(indexEntry?.settingKey ?? "").trim();
      if (!id || !settingKey) continue;
      this._registerShaderRecordSetting(settingKey);
      const record = this._normalizeImportedRecord(
        game.settings.get(this.moduleId, settingKey),
        { fallbackId: id, fallbackName: id },
      );
      if (!record) continue;
      if (record.id !== id) record.id = id;
      records.push(record);
    }
    return records;
  }

  getImportedRecords() {
    const indexEntries = this._getImportedLibraryIndexEntries();
    return this._getImportedRecordsFromIndex(indexEntries);
  }


  async setImportedRecords(
    records,
    { context = "unspecified", changedShaderIds = null, operation = "unspecified" } = {},
  ) {
    this._isPersistingImportedRecords = true;
    try {
    let payload = this._normalizeImportedRecordArray(records);
    let payloadBytes = 0;
    try {
      payloadBytes = JSON.stringify(payload).length;
    } catch (_err) {
      payloadBytes = -1;
    }
    const debugEnabled = isDebugLoggingEnabled(this.moduleId);
    let payloadDiagnostics = null;
    let payloadDiagnosticsMs = 0;
    if (debugEnabled) {
      const diagnosticsStart = nowMs();
      payloadDiagnostics = buildShaderLibraryPayloadDiagnostics(payload);
      payloadDiagnosticsMs = roundMs(nowMs() - diagnosticsStart);
    }

    const totalStart = nowMs();
    let phaseStart = nowMs();
    const previousIndex = this._getImportedLibraryIndexEntries();
    const previousIndexById = new Map(previousIndex.map((entry) => [entry.id, entry]));
    const previousIds = new Set(previousIndex.map((entry) => entry.id));
    const nextIds = new Set(payload.map((entry) => entry.id));
    const addedShaderIds = [];
    const removedShaderIds = [];

    for (const id of nextIds) {
      if (!previousIds.has(id)) addedShaderIds.push(id);
    }
    for (const id of previousIds) {
      if (!nextIds.has(id)) removedShaderIds.push(id);
    }

    const changedIdsSet = new Set();
    for (const id of toArray(changedShaderIds)) {
      const normalizedId = String(id ?? "").trim();
      if (normalizedId) changedIdsSet.add(normalizedId);
    }
    // Always include newly indexed ids so first migration writes every record.
    for (const id of addedShaderIds) changedIdsSet.add(id);

    const normalizedOperation = String(operation ?? "").trim().toLowerCase();
    const shouldTrackRemovals =
      changedIdsSet.size === 0 ||
      normalizedOperation === "remove" ||
      normalizedOperation === "import-replace" ||
      normalizedOperation.startsWith("rebuild-");
    if (shouldTrackRemovals) {
      for (const id of removedShaderIds) changedIdsSet.add(id);
    }

    const nextIndex = payload.map((entry) => {
      const id = String(entry.id ?? "").trim();
      const previous = previousIndexById.get(id);
      const settingKey =
        String(previous?.settingKey ?? "").trim() || this._buildShaderRecordSettingKey(id);
      this._registerShaderRecordSetting(settingKey);
      return { id, settingKey };
    });
    const indexUnchanged =
      JSON.stringify(nextIndex ?? []) === JSON.stringify(previousIndex ?? []);
    const nextIndexById = new Map(nextIndex.map((entry) => [entry.id, entry]));
    const previousRecordsById = new Map();
    if (changedIdsSet.size > 0) {
      // Fast path: for targeted updates (thumbnail regen/editor save), only read
      // records that were actually declared as changed.
      for (const id of changedIdsSet) {
        const previousRecord = this.getImportedRecord(id);
        if (previousRecord) previousRecordsById.set(id, previousRecord);
      }
    } else {
      for (const entry of this.getImportedRecords()) {
        const id = String(entry?.id ?? "").trim();
        if (!id) continue;
        previousRecordsById.set(id, entry);
      }
    }
    let choicesMayHaveChanged = addedShaderIds.length > 0 || removedShaderIds.length > 0;
    const prepMs = roundMs(nowMs() - phaseStart);

    phaseStart = nowMs();
    let recordWriteCount = 0;
    let removedRecordWriteCount = 0;
    let recordSettingsSetMs = 0;
    let removedRecordSettingsSetMs = 0;
    for (const entry of payload) {
      const id = String(entry.id ?? "").trim();
      if (!id) continue;
      const indexEntry = nextIndexById.get(id);
      if (!indexEntry) continue;
      const shouldInspectForDiff =
        changedIdsSet.size === 0 || changedIdsSet.has(id);
      if (!shouldInspectForDiff) continue;
      const previousRecord = previousRecordsById.get(id);
      const hasActualRecordChange =
        JSON.stringify(entry ?? {}) !== JSON.stringify(previousRecord ?? {});
      if (!choicesMayHaveChanged && previousRecord) {
        const previousName = String(previousRecord.name ?? "");
        const previousLabel = String(previousRecord.label ?? previousName);
        const nextName = String(entry.name ?? "");
        const nextLabel = String(entry.label ?? nextName);
        if (previousName !== nextName || previousLabel !== nextLabel) {
          choicesMayHaveChanged = true;
        }
      }
      if (!hasActualRecordChange && !changedIdsSet.has(id)) continue;
      const writeStart = nowMs();
      await game.settings.set(this.moduleId, indexEntry.settingKey, entry);
      recordSettingsSetMs += nowMs() - writeStart;
      recordWriteCount += 1;
    }

    for (const id of removedShaderIds) {
      if (!changedIdsSet.has(id)) continue;
      const previousEntry = previousIndexById.get(id);
      const settingKey = String(previousEntry?.settingKey ?? "").trim();
      if (!settingKey) continue;
      this._registerShaderRecordSetting(settingKey);
      const writeStart = nowMs();
      await game.settings.set(this.moduleId, settingKey, {});
      removedRecordSettingsSetMs += nowMs() - writeStart;
      removedRecordWriteCount += 1;
    }

    let indexWriteCount = 0;
    let indexSettingsSetMs = 0;
    if (!indexUnchanged) {
      const writeStart = nowMs();
      await game.settings.set(
        this.moduleId,
        this.shaderLibraryIndexSetting,
        nextIndex,
      );
      indexSettingsSetMs += nowMs() - writeStart;
      indexWriteCount = 1;
    }
    const settingsSetMs = roundMs(nowMs() - phaseStart);

    phaseStart = nowMs();
    this._shaderLibraryRevision += 1;
    this._invalidateShaderChoiceCaches();
    const cacheInvalidateMs = roundMs(nowMs() - phaseStart);

    phaseStart = nowMs();
    const changedShaderIdsList = Array.from(changedIdsSet);
    const updatedShaderIds = changedShaderIdsList.filter(
      (id) => !addedShaderIds.includes(id) && !removedShaderIds.includes(id),
    );
    Hooks.callAll(`${this.moduleId}.shaderLibraryChanged`, {
      context: String(context ?? "unspecified"),
      operation: String(operation ?? "unspecified"),
      changedShaderIds: changedShaderIdsList,
      addedShaderIds,
      updatedShaderIds,
      removedShaderIds,
      choicesMayHaveChanged,
      recordCount: payload.length,
    });
    const hooksMs = roundMs(nowMs() - phaseStart);

    const metrics = {
      context: String(context ?? "unspecified"),
      operation: String(operation ?? "unspecified"),
      recordCount: payload.length,
      payloadBytes,
      changedShaderCount: changedShaderIdsList.length,
      changedShaderIds: changedShaderIdsList,
      addedShaderIds,
      updatedShaderIds,
      removedShaderIds,
      choicesMayHaveChanged,
      settingsSetMs,
      prepMs,
      recordSettingsSetMs: roundMs(recordSettingsSetMs),
      removedRecordSettingsSetMs: roundMs(removedRecordSettingsSetMs),
      indexSettingsSetMs: roundMs(indexSettingsSetMs),
      recordWriteCount,
      removedRecordWriteCount,
      indexWriteCount,
      cacheInvalidateMs,
      hooksMs,
      totalMs: roundMs(nowMs() - totalStart),
      payloadDiagnosticsMs,
      ...(payloadDiagnostics ?? {}),
    };
    this._lastSetImportedRecordsMetrics = metrics;
    debugLog(this.moduleId, "setImportedRecords timing", metrics);
    return metrics;
    } finally {
      this._isPersistingImportedRecords = false;
    }
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
    const id = String(shaderId ?? "").trim();
    if (!id) return null;

    const indexEntry = this._getImportedLibraryIndexEntries().find(
      (entry) => entry.id === id,
    );
    if (indexEntry) {
      this._registerShaderRecordSetting(indexEntry.settingKey);
      return this._normalizeImportedRecord(
        game.settings.get(this.moduleId, indexEntry.settingKey),
        { fallbackId: id, fallbackName: id },
      );
    }
    return null;
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
      entries.push({ id: shader.id, label: String(shader.label) });
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
    const id = String(shaderId ?? "").trim();
    if (!id) return false;
    if (this.builtinById.has(id)) return true;
    return this.getImportedRecord(id) !== null;
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
        volumeTilesX: 0,
        volumeTilesY: 0,
        volumeDepth: 0,
        volumeSizeX: 0,
        volumeSizeY: 0,
        volumeSizeZ: 0,
        samplerFilter: "",
        samplerWrap: "",
        samplerVflip: null,
        samplerInternal: "",
      };
    }

    return defaults;
  }

  buildChannelConfig({
    source,
    commonSource = "",
    channels = {},
    autoAssignCapture = true,
  } = {}) {
    const normalizedSource = validateShaderToySource(source);
    const combinedSource = this._composeShaderSourceWithCommon(
      normalizedSource,
      commonSource,
    );
    const next = this.getDefaultChannelConfig(
      combinedSource,
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
            commonSource,
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
          volumeTilesX: candidate.volumeTilesX,
          volumeTilesY: candidate.volumeTilesY,
          volumeDepth: candidate.volumeDepth,
          volumeSizeX: candidate.volumeSizeX,
          volumeSizeY: candidate.volumeSizeY,
          volumeSizeZ: candidate.volumeSizeZ,
          samplerFilter: candidate.samplerFilter,
          samplerWrap: candidate.samplerWrap,
          samplerVflip: candidate.samplerVflip,
          samplerInternal: candidate.samplerInternal,
        };
      }
    }

    return next;
  }

  getRecordChannelConfig(record) {
    const commonSource = this._normalizeCommonSource(record?.commonSource);
    if (!record?.source || typeof record.source !== "string") {
      return this.getDefaultChannelConfig(
        "void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = vec4(0.0); }",
        true,
      );
    }
    const composedRecordSource = this._composeShaderSourceWithCommon(
      record.source,
      commonSource,
    );

    if (!record?.channels || typeof record.channels !== "object") {
      return this.getDefaultChannelConfig(composedRecordSource, true);
    }

    const next = this.getDefaultChannelConfig(composedRecordSource, true);
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
              commonSource,
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
          volumeTilesX: candidate.volumeTilesX,
          volumeTilesY: candidate.volumeTilesY,
          volumeDepth: candidate.volumeDepth,
          volumeSizeX: candidate.volumeSizeX,
          volumeSizeY: candidate.volumeSizeY,
          volumeSizeZ: candidate.volumeSizeZ,
          samplerFilter: candidate.samplerFilter,
          samplerWrap: candidate.samplerWrap,
          samplerVflip: candidate.samplerVflip,
          samplerInternal: candidate.samplerInternal,
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
    const commonSource = this._normalizeCommonSource(record.commonSource);
    const composedSource = this._composeShaderSourceWithCommon(
      record.source,
      commonSource,
    );
    let referencedChannels = [];
    try {
      referencedChannels = extractReferencedChannels(composedSource);
    } catch (_err) {
      referencedChannels = toArray(record.referencedChannels);
    }

    const channelConfig = this.getRecordChannelConfig(record);
    const hasBufferPass =
      channelConfigHasMode(channelConfig, "buffer") ||
      channelConfigHasMode(channelConfig, "bufferSelf");

    return {
      id: record.id,
      label: sanitizeName(record.label ?? record.name),
      type: "imported",
      commonSource,
      requiresResolution: true,
      usesNoiseTexture: true,
      channelConfig,
      referencedChannels: toArray(referencedChannels)
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v <= 3),
      fragment: adaptShaderToyFragment(composedSource, {
        sanitizeColor: hasBufferPass ? false : undefined,
      }),
    };
  }

  buildImportedDefinitionOverride(
    shaderId,
    sourceOverride,
    { referencedChannels = null, commonSource = null, channels = null } = {},
  ) {
    const record = this.getImportedRecord(shaderId);
    if (!record) return null;

    const sourceText = String(sourceOverride ?? "");
    const validatedSource = sourceText.trim()
      ? validateShaderToySource(sourceText)
      : String(record.source ?? "");
    const overrideCommonSource =
      commonSource == null
        ? this._normalizeCommonSource(record.commonSource)
        : this._normalizeCommonSource(commonSource);
    const composedSource = this._composeShaderSourceWithCommon(
      validatedSource,
      overrideCommonSource,
    );
    const refs = Array.isArray(referencedChannels)
      ? referencedChannels
      : extractReferencedChannels(composedSource);

    const channelInput =
      channels == null
        ? foundry.utils.deepClone(record.channels ?? {})
        : this._mergeChannelsPreservingNested(record.channels ?? {}, channels ?? {});
    const channelConfig = this.buildChannelConfig({
      source: composedSource,
      commonSource: overrideCommonSource,
      channels: channelInput,
      autoAssignCapture: Boolean(record?.autoAssignCapture),
    });
    const hasBufferPass =
      channelConfigHasMode(channelConfig, "buffer") ||
      channelConfigHasMode(channelConfig, "bufferSelf");

    return {
      id: record.id,
      label: sanitizeName(record.label ?? record.name),
      type: "imported",
      commonSource: overrideCommonSource,
      requiresResolution: true,
      usesNoiseTexture: true,
      channelConfig,
      referencedChannels: toArray(refs)
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v <= 3),
      fragment: adaptShaderToyFragment(composedSource, {
        sanitizeColor: hasBufferPass ? false : undefined,
      }),
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
    const resolvedPath = applyKnownShaderToyMediaReplacement(path);
    const source = String(channelConfig?.source ?? "").trim();
    const configuredSizeRaw = Number(channelConfig?.size);
    const configuredSize = normalizeBufferSize(
      configuredSizeRaw,
      DEFAULT_BUFFER_SIZE,
    );
    // ShaderToy buffers are usually viewport-sized unless explicitly overridden.
    // If channel size is missing/default, follow width/height hints from the active shader.
    const hintSizeRaw = Number(options?.bufferSizeHint);
    const hintSize = Number.isFinite(hintSizeRaw) && hintSizeRaw > 0
      ? normalizeBufferSize(hintSizeRaw, configuredSize)
      : configuredSize;
    const hintWidthRaw = Number(
      options?.bufferWidthHint ?? options?.bufferResolutionHint?.[0] ?? hintSize,
    );
    const hintHeightRaw = Number(
      options?.bufferHeightHint ?? options?.bufferResolutionHint?.[1] ?? hintSize,
    );
    const hintedWidth = Number.isFinite(hintWidthRaw) && hintWidthRaw > 0
      ? normalizeBufferSize(hintWidthRaw, configuredSize)
      : configuredSize;
    const hintedHeight = Number.isFinite(hintHeightRaw) && hintHeightRaw > 0
      ? normalizeBufferSize(hintHeightRaw, configuredSize)
      : configuredSize;
    const useHintedSize =
      !Number.isFinite(configuredSizeRaw) ||
      configuredSizeRaw <= 0 ||
      Math.round(configuredSizeRaw) === DEFAULT_BUFFER_SIZE;
    const bufferWidth = useHintedSize ? hintedWidth : configuredSize;
    const bufferHeight = useHintedSize ? hintedHeight : configuredSize;
    const resolveCache = options?.resolveCache instanceof Map
      ? options.resolveCache
      : null;
    const cacheShaderId = String(options?.shaderId ?? "").trim();
    const cachePreviewMode = options?.previewMode === true ? "1" : "0";
    const cacheTargetType = String(options?.targetType ?? "").trim().toLowerCase();
    const cacheTargetId = String(options?.targetId ?? "").trim();
    const commonSource = this._normalizeCommonSource(options?.commonSource);
    const composedBufferSource =
      mode === "buffer"
        ? this._composeShaderSourceWithCommon(source, commonSource)
        : "";
    const cacheKey = mode === "buffer" && composedBufferSource
      ? [
        "buffer",
        composedBufferSource,
        String(bufferWidth),
        String(bufferHeight),
        cacheShaderId,
        cachePreviewMode,
        cacheTargetType,
        cacheTargetId,
      ].join("::")
      : "";
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
      const captureFlipVerticalUser = parseBooleanLike(options?.captureFlipVertical);
      const captureFlipVertical = !captureFlipVerticalUser;
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
      const captureWidth = Math.max(16, hintedWidth);
      const captureHeight = Math.max(16, hintedHeight);
      const texture = getNoiseTexture(IMPORTED_NOISE_TEXTURE_SIZE, "rgb");
      debugLog(this.moduleId, "resolve sceneCapture channel: runtime fallback", {
        mode,
        previewMode: options?.previewMode === true,
        captureResolution: [captureWidth, captureHeight],
        texture: getTextureDebugInfo(texture, IMPORTED_NOISE_TEXTURE_SIZE),
        alphaSample: this._debugSampleTextureAlpha(texture, 16),
      });
      return {
        texture,
        resolution: [captureWidth, captureHeight],
        runtimeCapture: true,
        runtimeCaptureSize: Math.max(captureWidth, captureHeight),
        runtimeCaptureResolution: [captureWidth, captureHeight],
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

      if ((targetType === "token" || targetType === "tile") && targetId && !isPreview) {
        const captureWidth = Math.max(16, hintedWidth);
        const captureHeight = Math.max(16, hintedHeight);
        const captureSize = Math.max(captureWidth, captureHeight);
        const captureRotationDeg = toFiniteNumber(options?.captureRotationDeg, 0);
        const captureFlipHorizontal = parseBooleanLike(
          options?.captureFlipHorizontal,
        );
        const captureFlipVerticalUser = parseBooleanLike(options?.captureFlipVertical);
        const captureFlipVertical = !captureFlipVerticalUser;
        const includePlaceableRotation = false;
        debugLog(this.moduleId, "create placeable image channel", {
          targetType,
          targetId,
          captureSize,
          captureResolution: [captureWidth, captureHeight],
          isPreview,
          captureRotationDeg,
          captureFlipHorizontal,
          captureFlipVertical,
          includePlaceableRotation,
        });
        const runtimeImageChannel = new PlaceableImageChannel({
          moduleId: this.moduleId,
          targetType,
          targetId,
          size: captureSize,
          width: captureWidth,
          height: captureHeight,
          liveUpdates: !isPreview,
          previewTexturePath: "",
          captureRotationDeg,
          captureFlipHorizontal,
          captureFlipVertical,
          includePlaceableRotation,
        });
        const texture = runtimeImageChannel.texture;
        const resolution = [captureWidth, captureHeight];
        debugLog(this.moduleId, "resolve tokenTileImage channel: placeable runtime channel", {
          targetType,
          targetId,
          isPreview,
          captureRotationDeg,
          captureFlipHorizontal,
          captureFlipVertical,
          includePlaceableRotation,
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
        const captureFlipVerticalUser = parseBooleanLike(options?.captureFlipVertical);
        const captureFlipVertical = !captureFlipVerticalUser;
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

    if (mode === "buffer" && composedBufferSource) {
      if (resolveCache && cacheKey && resolveCache.has(cacheKey)) {
        return resolveCache.get(cacheKey);
      }
      try {
        const runtimeBuffer = new ShaderToyBufferChannel({
          source: composedBufferSource,
          width: bufferWidth,
          height: bufferHeight,
          size: Math.max(bufferWidth, bufferHeight),
        });
        {
          const orderRaw = Number(channelConfig?.bufferOrder);
          runtimeBuffer.__cpfxBufferOrder =
            Number.isInteger(orderRaw) && orderRaw >= 0 ? orderRaw : null;
        }
        const result = {
          texture: runtimeBuffer.texture,
          resolution: [bufferWidth, bufferHeight],
          runtimeCapture: false,
          runtimeCaptureSize: 0,
          runtimeCaptureChannels: [],
          runtimeBuffers: [runtimeBuffer],
          runtimeImageChannels: [],
        };
        if (resolveCache && cacheKey) {
          resolveCache.set(cacheKey, result);
        }
        for (const index of CHANNEL_INDICES) {
          const key = `iChannel${index}`;
          const childCfg = channelConfig?.channels?.[key] ??
            channelConfig?.channels?.[index] ?? {
              mode: "none",
              path: "",
              source: "",
              channels: {},
              size: Math.max(bufferWidth, bufferHeight),
            };
          const childMode = normalizeChannelMode(childCfg?.mode ?? "none");
          if (childMode === "bufferSelf") {
            const samplerVflip = parseBooleanLike(childCfg?.samplerVflip);
            debugLog(this.moduleId, "binding buffer self-feedback channel", {
              channel: index,
              size: [bufferWidth, bufferHeight],
              samplerVflip,
            });
            runtimeBuffer.setChannelSelf(
              index,
              [bufferWidth, bufferHeight],
              {
                samplerVflip,
                samplerFilter: childCfg?.samplerFilter,
                samplerWrap: childCfg?.samplerWrap,
              },
            );
            continue;
          }
          const resolved = this.resolveImportedChannelTexture(
            childCfg,
            depth + 1,
            {
              ...options,
              channelKey: key,
              bufferSizeHint: Math.max(bufferWidth, bufferHeight),
              bufferWidthHint: bufferWidth,
              bufferHeightHint: bufferHeight,
              bufferResolutionHint: [bufferWidth, bufferHeight],
            },
          );
          applyChannelSamplerToTexture(resolved.texture, childCfg, childMode);
          runtimeBuffer.setChannel(
            index,
            resolved.texture,
            resolved.resolution,
            {
              channelType: getChannelTypeFromMode(childMode),
              volumeLayout:
                childMode === "volume"
                  ? resolveVolumeLayoutForChannel(childCfg, resolved.resolution)
                  : [1, 1, 1],
              samplerVflip: parseBooleanLike(childCfg?.samplerVflip),
              samplerFilter: childCfg?.samplerFilter,
              samplerWrap: childCfg?.samplerWrap,
            },
          );
          if (resolved.runtimeCapture) {
            result.runtimeCaptureChannels.push({
              size: resolved.runtimeCaptureSize ?? 512,
              resolution: resolved.runtimeCaptureResolution ?? resolved.resolution ?? null,
              runtimeBuffer,
              channel: index,
            });
          }
          if (resolved !== result) {
            result.runtimeCaptureChannels.push(
              ...(resolved.runtimeCaptureChannels ?? []),
            );
            result.runtimeBuffers.push(...(resolved.runtimeBuffers ?? []));
            result.runtimeImageChannels.push(...(resolved.runtimeImageChannels ?? []));
          }
        }
        return result;
      } catch (err) {
        if (resolveCache && cacheKey) {
          resolveCache.delete(cacheKey);
        }
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

    if (mode === "volume") {
      const isLikelyBinaryVolume = /\.bin(?:[?#].*)?$/i.test(path);
      if (!path || isLikelyBinaryVolume) {
        const tx = normalizePositiveInt(channelConfig?.volumeTilesX, 0);
        const ty = normalizePositiveInt(channelConfig?.volumeTilesY, 0);
        const dz = normalizePositiveInt(channelConfig?.volumeDepth, 0);
        const fallbackTilesX = tx > 0 ? tx : 8;
        const fallbackTilesY = ty > 0 ? ty : 4;
        const fallbackDepth = dz > 0 ? dz : (fallbackTilesX * fallbackTilesY);
        const generated = getVolumeNoiseAtlasTexture({
          tileSize: 32,
          tilesX: fallbackTilesX,
          tilesY: fallbackTilesY,
          depth: fallbackDepth,
          mode: "rgb",
          seed: 0,
        });
        debugLog(this.moduleId, "volume channel using generated atlas fallback", {
          path,
          reason: !path ? "missing-path" : "binary-volume-input",
          resolution: generated.resolution,
          layout: generated.layout,
        });
        return {
          texture: generated.texture,
          resolution: generated.resolution,
          runtimeCapture: false,
          runtimeCaptureSize: 0,
          runtimeCaptureChannels: [],
          runtimeBuffers: [],
          runtimeImageChannels: [],
        };
      }
    }

    if (mode === "image" || mode === "cubemap" || mode === "volume") {
      if (!resolvedPath) {
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

      const texture = createImportedChannelTexture(resolvedPath);
      const base = texture?.baseTexture;
      if (base) {
        ensureVideoTexturePlayback(texture, resolvedPath);
        applyChannelSamplerToTexture(texture, channelConfig, mode);
        base.once?.("error", (err) => {
          this._notifyImportedChannelTextureLoadError({
            shaderId: options?.shaderId,
            shaderLabel: options?.shaderLabel,
            channelKey: options?.channelKey,
            path: resolvedPath,
          });
          console.error(
            `${this.moduleId} | Failed to load imported shader channel image ` +
              `(${String(options?.shaderLabel ?? options?.shaderId ?? "Imported Shader")} ` +
              `${String(options?.channelKey ?? "iChannel?")}): ${resolvedPath}`,
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
    // Preserve shader alpha by default. Some workflows (like gradient masks)
    // intentionally override alpha handling.
    uniforms.cpfxPreserveTransparent =
      cfg.useGradientMask === true ? 0.0 : 1.0;
    uniforms.cpfxForceOpaqueCaptureAlpha =
      cfg.previewForceOpaqueCaptureAlpha === true ? 1.0 : 0.0;

    if (def.requiresResolution) {
      uniforms.resolution = cfg.resolution ?? [1, 1];
    }
    const resolvedWidth = Number(uniforms?.resolution?.[0] ?? cfg?.resolution?.[0] ?? 1);
    const resolvedHeight = Number(uniforms?.resolution?.[1] ?? cfg?.resolution?.[1] ?? 1);
    const importedBufferResolutionHint = [
      Math.max(2, normalizeBufferSize(resolvedWidth, DEFAULT_BUFFER_SIZE)),
      Math.max(2, normalizeBufferSize(resolvedHeight, DEFAULT_BUFFER_SIZE)),
    ];
    const importedBufferSizeHint = Math.max(
      importedBufferResolutionHint[0],
      importedBufferResolutionHint[1],
    );
    uniforms.iResolution = [resolvedWidth, resolvedHeight, 1];
    if (def.usesNoiseTexture && def.type !== "imported") {
      uniforms.iChannel0 = getNoiseTexture(256, "gray");
    }

    const runtimeChannels = [];
    const runtimeBufferChannels = [];
    const runtimeImageChannels = [];
    const seenRuntimeBuffers = new Set();
    let runtimeBufferSeq = 0;
    const importedResolveCache = new Map();
    if (def.type === "imported") {
      uniforms.uTime = cfg.uTime ?? uniforms.time ?? 0;
      uniforms.iTime = uniforms.uTime;
      const channelResolution = [];
      const channelTypes = [0, 0, 0, 0];
      const channelVflips = [0, 0, 0, 0];
      const channelWraps = [0, 0, 0, 0];
      const volumeSampleParams = [
        [1, 0, 0, 0],
        [1, 0, 0, 0],
        [1, 0, 0, 0],
        [1, 0, 0, 0],
      ];
      const volumeUvParams = [
        [0, 0, 1, 1],
        [0, 0, 1, 1],
        [0, 0, 1, 1],
        [0, 0, 1, 1],
      ];
      const volumeLayouts = [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ];
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
          volumeTilesX: 0,
          volumeTilesY: 0,
          volumeDepth: 0,
          volumeSizeX: 0,
          volumeSizeY: 0,
          volumeSizeZ: 0,
        };
        // Some imported shaders depend on iChannel0 for base color and render black when unset.
        const effectiveChannelCfg =
          (channelCfg?.mode === "none" || channelCfg?.mode === "empty") &&
          index === 0 &&
          referencedChannels.has(0)
            ? { ...channelCfg, mode: "noiseRgb" }
            : channelCfg;
        const resolved = this.resolveImportedChannelTexture(
          effectiveChannelCfg,
          0,
          {
            shaderId: def.id,
            shaderLabel: def.label,
            channelKey: key,
            previewSceneCaptureTexture: cfg.previewSceneCaptureTexture,
            previewPlaceableTexture: cfg.previewPlaceableTexture,
            previewMode: cfg.previewMode === true,
            targetType: cfg.targetType,
            targetId: cfg.targetId,
            captureRotationDeg: cfg.captureRotationDeg,
            captureFlipHorizontal: cfg.captureFlipHorizontal,
            captureFlipVertical: cfg.captureFlipVertical,
            commonSource: def.commonSource,
            bufferSizeHint: importedBufferSizeHint,
            bufferWidthHint: importedBufferResolutionHint[0],
            bufferHeightHint: importedBufferResolutionHint[1],
            bufferResolutionHint: importedBufferResolutionHint,
            resolveCache: importedResolveCache,
          },
        );
        applyChannelSamplerToTexture(
          resolved.texture,
          effectiveChannelCfg,
          normalizeChannelMode(effectiveChannelCfg?.mode ?? channelCfg?.mode ?? "none"),
        );
        uniforms[key] = resolved.texture;
        const resolvedWidth = Number(resolved?.resolution?.[0] ?? 1);
        const resolvedHeight = Number(resolved?.resolution?.[1] ?? 1);
        channelResolution.push(
          resolvedWidth,
          resolvedHeight,
          1,
        );
        const resolvedMode = normalizeChannelMode(
          effectiveChannelCfg?.mode ?? channelCfg?.mode ?? "none",
        );
        const samplerDefaults = getChannelSamplerDefaults(resolvedMode);
        const resolvedSamplerWrap = normalizeSamplerWrap(
          effectiveChannelCfg?.samplerWrap,
          samplerDefaults.wrap,
        );
        channelTypes[index] = getChannelTypeFromMode(resolvedMode);
        channelVflips[index] = parseBooleanLike(effectiveChannelCfg?.samplerVflip)
          ? 1
          : 0;
        channelWraps[index] = getSamplerWrapUniformCode(resolvedSamplerWrap);
        if (channelTypes[index] === 2) {
          volumeLayouts[index] = resolveVolumeLayoutForChannel(
            effectiveChannelCfg,
            [resolvedWidth, resolvedHeight],
          );
        }
        {
          const params = computeVolumeAtlasSampleUniforms(
            volumeLayouts[index],
            [resolvedWidth, resolvedHeight],
          );
          volumeSampleParams[index] = params.sampleParams;
          volumeUvParams[index] = params.uvParams;
        }
        if (isDebugLoggingEnabled(this.moduleId)) {
          debugLog(this.moduleId, "makeShader imported channel bind", {
            shaderId: def.id,
            previewMode: cfg.previewMode === true,
            channel: index,
            uniformKey: key,
            requestedMode: normalizeChannelMode(channelCfg?.mode ?? "none"),
            effectiveMode: normalizeChannelMode(effectiveChannelCfg?.mode ?? "none"),
            channelType: channelTypes[index],
            volumeLayout: volumeLayouts[index],
            volumeSampleParams: volumeSampleParams[index],
            volumeUvParams: volumeUvParams[index],
            samplerFilter: normalizeSamplerFilter(effectiveChannelCfg?.samplerFilter, ""),
            samplerWrap: normalizeSamplerWrap(effectiveChannelCfg?.samplerWrap, ""),
            samplerInternal: normalizeSamplerInternal(effectiveChannelCfg?.samplerInternal, ""),
            samplerWrapResolved: resolvedSamplerWrap,
            samplerWrapUniform: channelWraps[index],
            samplerVflip: channelVflips[index] === 1,
            targetType: cfg.targetType ?? null,
            targetId: cfg.targetId ?? null,
            resolution: [resolvedWidth, resolvedHeight],
            runtimeCapture: resolved.runtimeCapture === true,
            runtimeCaptureSize: resolved.runtimeCaptureSize ?? 0,
            runtimeCaptureResolution:
              resolved.runtimeCaptureResolution ?? resolved.resolution ?? [0, 0],
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
            resolution: resolved.runtimeCaptureResolution ?? resolved.resolution ?? null,
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
          runtimeBufferChannels.push({
            channel: index,
            runtimeBuffer,
            order:
              Number.isInteger(Number(runtimeBuffer?.__cpfxBufferOrder))
                ? Number(runtimeBuffer.__cpfxBufferOrder)
                : Number.MAX_SAFE_INTEGER,
            seq: runtimeBufferSeq++,
          });
        }
      }
      runtimeBufferChannels.sort((a, b) => {
        const orderA = Number(a?.order ?? Number.MAX_SAFE_INTEGER);
        const orderB = Number(b?.order ?? Number.MAX_SAFE_INTEGER);
        if (orderA !== orderB) return orderA - orderB;
        return Number(a?.seq ?? 0) - Number(b?.seq ?? 0);
      });
      uniforms.iChannelResolution = channelResolution;
      uniforms.cpfxChannelType0 = Number(channelTypes[0] ?? 0);
      uniforms.cpfxChannelType1 = Number(channelTypes[1] ?? 0);
      uniforms.cpfxChannelType2 = Number(channelTypes[2] ?? 0);
      uniforms.cpfxChannelType3 = Number(channelTypes[3] ?? 0);
      uniforms.cpfxSamplerVflip0 = Number(channelVflips[0] ?? 0);
      uniforms.cpfxSamplerVflip1 = Number(channelVflips[1] ?? 0);
      uniforms.cpfxSamplerVflip2 = Number(channelVflips[2] ?? 0);
      uniforms.cpfxSamplerVflip3 = Number(channelVflips[3] ?? 0);
      uniforms.cpfxSamplerWrap0 = Number(channelWraps[0] ?? 0);
      uniforms.cpfxSamplerWrap1 = Number(channelWraps[1] ?? 0);
      uniforms.cpfxSamplerWrap2 = Number(channelWraps[2] ?? 0);
      uniforms.cpfxSamplerWrap3 = Number(channelWraps[3] ?? 0);
      uniforms.cpfxVolumeLayout0 = volumeLayouts[0];
      uniforms.cpfxVolumeLayout1 = volumeLayouts[1];
      uniforms.cpfxVolumeLayout2 = volumeLayouts[2];
      uniforms.cpfxVolumeLayout3 = volumeLayouts[3];
      uniforms.cpfxVolumeSampleParams0 = volumeSampleParams[0];
      uniforms.cpfxVolumeSampleParams1 = volumeSampleParams[1];
      uniforms.cpfxVolumeSampleParams2 = volumeSampleParams[2];
      uniforms.cpfxVolumeSampleParams3 = volumeSampleParams[3];
      uniforms.cpfxVolumeUvParams0 = volumeUvParams[0];
      uniforms.cpfxVolumeUvParams1 = volumeUvParams[1];
      uniforms.cpfxVolumeUvParams2 = volumeUvParams[2];
      uniforms.cpfxVolumeUvParams3 = volumeUvParams[3];
      debugLog(this.moduleId, "makeShader imported channel resolutions", {
        shaderId: def.id,
        previewMode: cfg.previewMode === true,
        iChannelResolution: channelResolution,
        cpfxChannelType: channelTypes,
        cpfxSamplerVflip: channelVflips,
        cpfxSamplerWrap: channelWraps,
        cpfxVolumeLayout: volumeLayouts,
        cpfxVolumeSampleParams: volumeSampleParams,
        cpfxVolumeUvParams: volumeUvParams,
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
        : (def.type === "imported"
          ? getSolidTexture([255, 255, 255, 255], 2)
          : getCircleMaskTexture(512));

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
    commonSource = "",
    channels = {},
    autoAssignCapture = true,
    defaults = null,
  } = {}) {
    const normalizedName = sanitizeName(name);
    const normalizedLabel = sanitizeName(label ?? normalizedName);
    const normalizedSource = validateShaderToySource(source);
    const normalizedCommonSource = this._normalizeCommonSource(commonSource);
    const composedSource = this._composeShaderSourceWithCommon(
      normalizedSource,
      normalizedCommonSource,
    );
    adaptShaderToyFragment(composedSource);

    const records = this.getImportedRecords();
    const used = new Set(records.map((entry) => entry.id));
    const base = slugify(normalizedName);
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
      commonSource: normalizedCommonSource,
      referencedChannels: extractReferencedChannels(composedSource),
      channels: this.buildChannelConfig({
        source: composedSource,
        commonSource: normalizedCommonSource,
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
    await this.setImportedRecords(records, {
      context: "importShaderToy",
      changedShaderIds: [id],
      operation: "create",
    });
    this._queueImportedShaderThumbnailRegeneration(id);
    return this.getImportedRecord(id) ?? record;
  }

  _parseShaderToySamplerConfig(value) {
    if (!value || typeof value !== "object") return {};
    const samplerFilter = normalizeSamplerFilter(value.filter, "");
    const samplerWrap = normalizeSamplerWrap(value.wrap, "");
    const samplerInternal = normalizeSamplerInternal(value.internal, "");
    const hasVflip = Object.prototype.hasOwnProperty.call(value, "vflip");
    const samplerVflip = hasVflip ? parseBooleanLike(value.vflip) : null;
    const next = {};
    if (samplerFilter) next.samplerFilter = samplerFilter;
    if (samplerWrap) next.samplerWrap = samplerWrap;
    if (samplerInternal) next.samplerInternal = samplerInternal;
    if (hasVflip) next.samplerVflip = samplerVflip;
    return next;
  }

  _parseShaderToySizePair(value, depth = 0) {
    if (depth > 3 || value == null) return null;

    if (Array.isArray(value) && value.length >= 2) {
      const w = Number(value[0]);
      const h = Number(value[1]);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return [w, h];
      }
    }

    if (typeof value === "number") {
      if (Number.isFinite(value) && value > 0) return [value, value];
      return null;
    }

    if (typeof value === "string") {
      const raw = value.trim();
      if (!raw) return null;

      const pairMatch = raw.match(
        /([0-9]+(?:\.[0-9]+)?)\s*(?:x|,|\s+)\s*([0-9]+(?:\.[0-9]+)?)/i,
      );
      if (pairMatch) {
        const w = Number(pairMatch[1]);
        const h = Number(pairMatch[2]);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          return [w, h];
        }
      }

      const single = Number(raw);
      if (Number.isFinite(single) && single > 0) return [single, single];
      return null;
    }

    if (typeof value === "object") {
      const directWidth = Number(value.width ?? value.w ?? value.x ?? Number.NaN);
      const directHeight = Number(value.height ?? value.h ?? value.y ?? Number.NaN);
      if (
        Number.isFinite(directWidth) &&
        Number.isFinite(directHeight) &&
        directWidth > 0 &&
        directHeight > 0
      ) {
        return [directWidth, directHeight];
      }

      const nestedKeys = [
        "size",
        "resolution",
        "res",
        "bufferSize",
        "target",
        "fbo",
      ];
      for (const key of nestedKeys) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        const nested = this._parseShaderToySizePair(value[key], depth + 1);
        if (nested) return nested;
      }
    }

    return null;
  }

  _parseShaderToyVolumeLayout(value, depth = 0) {
    if (depth > 6 || value == null) return null;

    if (Array.isArray(value)) {
      if (value.length >= 3) {
        const tx = normalizePositiveInt(value[0], 0);
        const ty = normalizePositiveInt(value[1], 0);
        const dz = normalizePositiveInt(value[2], 0);
        if (tx > 0 && ty > 0 && dz > 0) return [tx, ty, dz];
      }
      if (value.length === 1) return this._parseShaderToyVolumeLayout(value[0], depth + 1);
      return null;
    }

    if (typeof value === "string") {
      const parts = value
        .split(/[x, ]+/i)
        .map((p) => normalizePositiveInt(p, 0))
        .filter((v) => v > 0);
      if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
      return null;
    }

    if (typeof value === "object") {
      const keys = [
        ["tilesX", "tilesY", "depth"],
        ["x", "y", "z"],
        ["width", "height", "depth"],
        ["w", "h", "d"],
      ];
      for (const [kx, ky, kz] of keys) {
        if (
          Object.prototype.hasOwnProperty.call(value, kx) &&
          Object.prototype.hasOwnProperty.call(value, ky) &&
          Object.prototype.hasOwnProperty.call(value, kz)
        ) {
          const tx = normalizePositiveInt(value[kx], 0);
          const ty = normalizePositiveInt(value[ky], 0);
          const dz = normalizePositiveInt(value[kz], 0);
          if (tx > 0 && ty > 0 && dz > 0) return [tx, ty, dz];
        }
      }
      for (const nestedKey of ["size", "resolution", "res", "volume", "layout"]) {
        if (!Object.prototype.hasOwnProperty.call(value, nestedKey)) continue;
        const nested = this._parseShaderToyVolumeLayout(value[nestedKey], depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }

  _resolveShaderToyBufferSizeFromCandidates(candidates, fallback = DEFAULT_BUFFER_SIZE) {
    for (const candidate of candidates) {
      const pair = this._parseShaderToySizePair(candidate);
      if (!pair) continue;
      const [w, h] = pair;
      const size = Math.max(w, h);
      if (Number.isFinite(size) && size > 0) {
        return normalizeBufferSize(size, fallback);
      }
    }
    return normalizeBufferSize(fallback, DEFAULT_BUFFER_SIZE);
  }

  _resolveShaderToyPassBufferSize(pass, fallback = DEFAULT_BUFFER_SIZE) {
    const outputs = toArray(pass?.outputs);
    const candidates = [
      pass?.size,
      pass?.resolution,
      pass?.res,
      pass?.bufferSize,
      pass?.target,
      pass?.fbo,
    ];
    for (const output of outputs) {
      candidates.push(
        output?.size,
        output?.resolution,
        output?.res,
        output?.bufferSize,
      );
    }
    return this._resolveShaderToyBufferSizeFromCandidates(candidates, fallback);
  }

  _resolveShaderToyInputBufferSize(
    input,
    pass,
    maps,
    passKey,
    currentPassKey = null,
  ) {
    const inputId = String(input?.id ?? "").trim();
    const inputChannel = Number(input?.channel);
    return this._resolveShaderToyBufferSizeFromCandidates(
      [
        input?.size,
        input?.resolution,
        input?.res,
        input?.sampler?.size,
        input?.sampler?.resolution,
        inputId ? maps.passBufferSizeByOutputId?.get(inputId) : null,
        Number.isInteger(inputChannel) && inputChannel >= 0 && inputChannel <= 3
          ? maps.passBufferSizeByOutputChannel?.get(inputChannel)
          : null,
        pass?.__cpfxBufferSize,
        passKey ? maps.passBufferSizeByPassKey?.get(passKey) : null,
        currentPassKey ? maps.passBufferSizeByPassKey?.get(currentPassKey) : null,
      ],
      DEFAULT_BUFFER_SIZE,
    );
  }

  _buildChannelFromShaderToyInput(
    input,
    maps,
    stack = new Set(),
    currentPassKey = null,
  ) {
    const ctype = String(input?.ctype ?? input?.type ?? "").toLowerCase();
    const samplerCfg = this._parseShaderToySamplerConfig(input?.sampler);
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
      const bufferSize = this._resolveShaderToyInputBufferSize(
        input,
        pass,
        maps,
        passKey,
        currentPassKey,
      );
      const bufferOrderRaw = Number(pass?.__cpfxBufferOrder);
      const bufferOrder =
        Number.isInteger(bufferOrderRaw) && bufferOrderRaw >= 0
          ? bufferOrderRaw
          : null;
      if (currentPassKey && passKey === currentPassKey) {
        debugLog(this.moduleId, "detected buffer self-reference", {
          passKey,
          currentPassKey,
          size: bufferSize,
        });
        return {
          mode: "bufferSelf",
          size: bufferSize,
          ...(bufferOrder === null ? {} : { bufferOrder }),
          ...samplerCfg,
        };
      }
      if (stack.has(passKey)) {
        console.warn(
          `${this.moduleId} | Ignoring recursive ShaderToy buffer dependency: ${passKey}`,
        );
        return { mode: "none" };
      }

      stack.add(passKey);
      let source = "";
      try {
        source = validateShaderToySource(pass.__cpfxPassCode ?? pass.code);
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
        passKey,
      );
      stack.delete(passKey);
      return {
        mode: "buffer",
        source,
        channels,
        size: bufferSize,
        ...(bufferOrder === null ? {} : { bufferOrder }),
        ...samplerCfg,
      };
    }

    if (
      ctype === "volume" ||
      ctype === "3d" ||
      ctype === "volume3d" ||
      ctype === "texture3d"
    ) {
      const path = toShaderToyMediaUrl(src);
      if (!path) {
        // Graceful fallback for malformed/missing volume media.
        const mode = inferShaderToyVolumeNoiseMode(input, src);
        debugLog(this.moduleId, "shaderToy volume input fallback to procedural noise", {
          inputId: String(input?.id ?? ""),
          channel: Number(input?.channel),
          requestedType: ctype,
          mode,
          src,
        });
        return { mode, ...samplerCfg };
      }
      const volumeLayout =
        this._parseShaderToyVolumeLayout(input?.sampler?.layout) ??
        this._parseShaderToyVolumeLayout(input?.layout) ??
        this._parseShaderToyVolumeLayout(input?.volume?.layout) ??
        null;
      const volumeSize =
        this._parseShaderToyVolumeLayout(input?.sampler?.size) ??
        this._parseShaderToyVolumeLayout(input?.sampler?.resolution) ??
        this._parseShaderToyVolumeLayout(input?.size) ??
        this._parseShaderToyVolumeLayout(input?.resolution) ??
        null;
      const [volumeTilesX, volumeTilesY, volumeDepth] = volumeLayout ?? [0, 0, 0];
      const [volumeSizeX, volumeSizeY, volumeSizeZ] = volumeSize ?? [0, 0, 0];
      return {
        mode: "volume",
        path,
        volumeTilesX,
        volumeTilesY,
        volumeDepth,
        volumeSizeX,
        volumeSizeY,
        volumeSizeZ,
        ...samplerCfg,
      };
    }

    if (ctype === "cubemap") {
      const path = toShaderToyMediaUrl(src);
      if (path) return { mode: "cubemap", path, ...samplerCfg };
    }

    if (["texture", "video"].includes(ctype)) {
      const path = toShaderToyMediaUrl(src);
      if (path) return { mode: "image", path, ...samplerCfg };
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
      if (path) return { mode: "image", path, ...samplerCfg };
    }

    return { mode: "none" };
  }

  _buildChannelsFromShaderToyInputs(
    inputs,
    maps,
    stack = new Set(),
    currentPassKey = null,
  ) {
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
        currentPassKey,
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
      pass.__cpfxPassCode = passCode;
    }


    const passByOutputId = new Map();
    const passByOutputChannel = new Map();
    const passBufferSizeByPassKey = new Map();
    const passBufferSizeByOutputId = new Map();
    const passBufferSizeByOutputChannel = new Map();
    for (const pass of renderPasses) {
      pass.__cpfxPassKey = `${pass.type ?? "pass"}:${pass.name ?? ""}:${pass.outputs?.[0]?.id ?? ""}`;
      pass.__cpfxBufferSize = this._resolveShaderToyPassBufferSize(
        pass,
        DEFAULT_BUFFER_SIZE,
      );
      pass.__cpfxBufferOrder = null;
      passBufferSizeByPassKey.set(pass.__cpfxPassKey, pass.__cpfxBufferSize);
      for (const output of toArray(pass.outputs)) {
        const outId = String(output?.id ?? "").trim();
        const outputSize = this._resolveShaderToyBufferSizeFromCandidates(
          [
            output?.size,
            output?.resolution,
            output?.res,
            output?.bufferSize,
            pass.__cpfxBufferSize,
          ],
          pass.__cpfxBufferSize,
        );
        if (outId) {
          passByOutputId.set(outId, pass);
          passBufferSizeByOutputId.set(outId, outputSize);
        }
        const outCh = Number(output?.channel);
        if (Number.isInteger(outCh) && outCh >= 0 && outCh <= 3) {
          passByOutputChannel.set(outCh, pass);
          passBufferSizeByOutputChannel.set(outCh, outputSize);
          if (
            !Number.isInteger(Number(pass.__cpfxBufferOrder)) ||
            Number(pass.__cpfxBufferOrder) < 0
          ) {
            pass.__cpfxBufferOrder = outCh;
          }
        }
      }
    }
    let imagePass = renderPasses.find(
      (pass) => String(pass.type ?? "").toLowerCase() === "image",
    );
    if (!imagePass) imagePass = renderPasses[0];
    const imageSource = validateShaderToySource(
      imagePass.__cpfxPassCode ?? imagePass.code,
    );

    const channels = this._buildChannelsFromShaderToyInputs(
      imagePass.inputs,
      {
        passByOutputId,
        passByOutputChannel,
        passBufferSizeByPassKey,
        passBufferSizeByOutputId,
        passBufferSizeByOutputChannel,
      },
      new Set(),
    );
    const displayName = sanitizeName(
      name || shader?.info?.name || `ShaderToy ${shaderId || "Imported"}`,
    );
    const record = await this.importShaderToy({
      name: displayName,
      source: imageSource,
      commonSource: commonCode,
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
    try {
      const parsed = parseShaderToyJsonPayload(json);
      const shader = this._normalizeShaderToyApiPayload(parsed);
      const shaderId = String(shader?.info?.id ?? "").trim();
      return this._importFromNormalizedShaderToy(shader, { shaderId, name });
    } catch (jsonErr) {
      // Fallback: allow this import path to accept plain ShaderToy source text
      // when users paste GLSL instead of API JSON.
      if (typeof json === "string") {
        try {
          const source = validateShaderToySource(json);
          const displayName = sanitizeName(name || "Imported Shader");
          const record = await this.importShaderToy({
            name: displayName,
            source,
            autoAssignCapture: false,
          });
          return {
            ...record,
            shaderToyId: null,
            shaderToyUrl: null,
          };
        } catch (_sourceErr) {
          // Fall through to original JSON-path error for backwards-compatible messaging.
        }
      }
      throw jsonErr;
    }
  }

  _mergeChannelsPreservingNested(existingChannels = {}, incomingChannels = {}) {
    const base =
      existingChannels && typeof existingChannels === "object"
        ? existingChannels
        : {};
    const incoming =
      incomingChannels && typeof incomingChannels === "object"
        ? incomingChannels
        : {};

    const merged = foundry.utils.mergeObject(foundry.utils.deepClone(base), incoming, {
      inplace: false,
      recursive: true,
    });

    for (const index of CHANNEL_INDICES) {
      const key = `iChannel${index}`;
      const incomingEntry = incoming[key] ?? incoming[index];
      if (!incomingEntry || typeof incomingEntry !== "object") continue;

      const incomingMode = normalizeChannelMode(incomingEntry.mode ?? "auto");
      if (incomingMode !== "buffer") continue;

      const hasNestedInIncoming = Object.prototype.hasOwnProperty.call(
        incomingEntry,
        "channels",
      );
      if (hasNestedInIncoming) continue;

      const existingEntry = base[key] ?? base[index];
      const existingNested = existingEntry?.channels;
      if (!existingNested || typeof existingNested !== "object") continue;

      const mergedEntry = merged[key] ?? merged[index];
      if (!mergedEntry || typeof mergedEntry !== "object") continue;
      mergedEntry.channels = foundry.utils.deepClone(existingNested);
    }

    return merged;
  }

  async updateImportedShader(
    shaderId,
    {
      name = null,
      label = null,
      source = null,
      commonSource = null,
      channels = null,
      defaults = null,
      autoAssignCapture = true,
    } = {},
  ) {
    const saveStart = nowMs();
    const timings = {};
    const sourceProvided = source != null;
    const commonSourceProvided = commonSource != null;

    let phaseStart = nowMs();
    const records = this.getImportedRecords();
    timings.readRecordsMs = roundMs(nowMs() - phaseStart);

    phaseStart = nowMs();
    const idx = records.findIndex((entry) => entry.id === shaderId);
    if (idx < 0) {
      throw new Error("Imported shader not found.");
    }
    timings.findRecordMs = roundMs(nowMs() - phaseStart);

    phaseStart = nowMs();
    const record = records[idx];
    const nextName =
      name == null ? sanitizeName(record.name) : sanitizeName(name);
    const nextLabel =
      label == null
        ? sanitizeName(record.label ?? nextName)
        : sanitizeName(label);
    const nextCommonSource =
      commonSource == null
        ? this._normalizeCommonSource(record.commonSource)
        : this._normalizeCommonSource(commonSource);
    timings.normalizeNamesMs = roundMs(nowMs() - phaseStart);
    const nameChanged = nextName !== String(record.name ?? "");
    const labelChanged = nextLabel !== String(record.label ?? nextName);
    const commonSourceChanged =
      nextCommonSource !== this._normalizeCommonSource(record.commonSource);

    phaseStart = nowMs();
    const nextSource =
      source == null ? record.source : validateShaderToySource(source);
    const nextComposedSource = this._composeShaderSourceWithCommon(
      nextSource,
      nextCommonSource,
    );
    timings.validateSourceMs = roundMs(nowMs() - phaseStart);
    const sourceChanged = nextSource !== record.source;

    phaseStart = nowMs();
    adaptShaderToyFragment(nextComposedSource);
    timings.adapterCompileCheckMs = roundMs(nowMs() - phaseStart);
    debugLog(this.moduleId, "shader text compile", {
      shaderId,
      context: "editor-save",
      sourceChanged:
        source != null && nextSource !== record.source,
      commonSourceChanged,
      sourceLength: String(nextSource ?? "").length,
      commonSourceLength: String(nextCommonSource ?? "").length,
      composedSourceLength: String(nextComposedSource ?? "").length,
    });

    phaseStart = nowMs();
    const channelInput =
      channels == null
        ? foundry.utils.deepClone(record.channels ?? {})
        : this._mergeChannelsPreservingNested(record.channels ?? {}, channels ?? {});
    timings.collectChannelInputMs = roundMs(nowMs() - phaseStart);

    phaseStart = nowMs();
    const nextChannels = this.buildChannelConfig({
      source: nextComposedSource,
      commonSource: nextCommonSource,
      channels: channelInput,
      autoAssignCapture,
    });
    timings.buildChannelConfigMs = roundMs(nowMs() - phaseStart);
    const channelsChanged =
      JSON.stringify(nextChannels ?? {}) !==
      JSON.stringify(record.channels ?? {});

    phaseStart = nowMs();
    const defaultsSource = (() => {
      if (defaults === null || defaults === undefined) return record.defaults;
      if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
        return defaults;
      }
      const mergedDefaults = foundry.utils.deepClone(defaults);
      if (!Object.prototype.hasOwnProperty.call(mergedDefaults, "customUniforms")) {
        mergedDefaults.customUniforms = foundry.utils.deepClone(
          record?.defaults?.customUniforms ?? {},
        );
      }
      return mergedDefaults;
    })();
    const normalizedDefaults = this.normalizeImportedShaderDefaults(
      defaultsSource,
      this.getDefaultImportedShaderDefaults(),
    );
    timings.normalizeDefaultsMs = roundMs(nowMs() - phaseStart);
    const defaultsChanged =
      JSON.stringify(normalizedDefaults ?? {}) !==
      JSON.stringify(record.defaults ?? {});

    phaseStart = nowMs();
    const referencedChannels = extractReferencedChannels(nextComposedSource);
    timings.extractReferencedChannelsMs = roundMs(nowMs() - phaseStart);
    const previousReferencedChannels = Array.isArray(record.referencedChannels)
      ? record.referencedChannels
      : extractReferencedChannels(
          this._composeShaderSourceWithCommon(
            String(record.source ?? ""),
            this._normalizeCommonSource(record.commonSource),
          ),
        );
    const referencedChannelsChanged =
      JSON.stringify(referencedChannels ?? []) !==
      JSON.stringify(previousReferencedChannels ?? []);
    const shouldPersist =
      nameChanged ||
      labelChanged ||
      commonSourceChanged ||
      sourceChanged ||
      channelsChanged ||
      defaultsChanged ||
      referencedChannelsChanged;
    const thumbnailRegenerateReasons = [];
    if (sourceChanged) thumbnailRegenerateReasons.push("source");
    if (commonSourceChanged) thumbnailRegenerateReasons.push("commonSource");
    if (channelsChanged) thumbnailRegenerateReasons.push("channels");
    if (defaultsChanged) thumbnailRegenerateReasons.push("defaults");
    if (referencedChannelsChanged) thumbnailRegenerateReasons.push("referencedChannels");
    const shouldRegenerateThumbnail = thumbnailRegenerateReasons.length > 0;

    if (shouldPersist) {
      phaseStart = nowMs();
      records[idx] = {
        ...record,
        name: nextName,
        label: nextLabel,
        source: nextSource,
        commonSource: nextCommonSource,
        channels: nextChannels,
        defaults: normalizedDefaults,
        referencedChannels,
        updatedAt: Date.now(),
      };
      timings.buildRecordMs = roundMs(nowMs() - phaseStart);

      phaseStart = nowMs();
      const persistMetrics = await this.setImportedRecords(records, {
        context: "updateImportedShader",
        changedShaderIds: [shaderId],
        operation: "update",
      });
      timings.persistSettingsMs = roundMs(nowMs() - phaseStart);
      timings.persistGameSettingsSetMs = roundMs(
        Number(persistMetrics?.settingsSetMs ?? 0),
      );
      timings.persistCacheInvalidateMs = roundMs(
        Number(persistMetrics?.cacheInvalidateMs ?? 0),
      );
      timings.persistHooksMs = roundMs(
        Number(persistMetrics?.hooksMs ?? 0),
      );
      timings.persistPayloadBytes = Number(
        persistMetrics?.payloadBytes ?? 0,
      );
      timings.persistRecordCount = Number(
        persistMetrics?.recordCount ?? 0,
      );
    } else {
      timings.buildRecordMs = 0;
      timings.persistSettingsMs = 0;
      timings.persistGameSettingsSetMs = 0;
      timings.persistCacheInvalidateMs = 0;
      timings.persistHooksMs = 0;
      timings.persistPayloadBytes = 0;
      timings.persistRecordCount = Number(records.length ?? 0);
      timings.persistSkipped = true;
    }

    phaseStart = nowMs();
    if (shouldPersist && shouldRegenerateThumbnail) {
      this._queueImportedShaderThumbnailRegeneration(shaderId, {
        source: nextSource,
        commonSource: nextCommonSource,
        channels: nextChannels,
        defaults: normalizedDefaults,
        autoAssignCapture,
      });
      timings.queueThumbnailMs = roundMs(nowMs() - phaseStart);
    } else {
      timings.queueThumbnailMs = 0;
      timings.queueThumbnailSkipped = true;
    }
    timings.totalMs = roundMs(nowMs() - saveStart);

    debugLog(this.moduleId, "shader save timing", {
      shaderId,
      sourceProvided,
      commonSourceProvided,
      sourceChanged: sourceProvided && sourceChanged,
      commonSourceChanged,
      sourceLength: String(nextSource ?? "").length,
      commonSourceLength: String(nextCommonSource ?? "").length,
      composedSourceLength: String(nextComposedSource ?? "").length,
      channelInputKeys: Object.keys(channelInput ?? {}).length,
      referencedChannelsCount: Array.isArray(referencedChannels)
        ? referencedChannels.length
        : 0,
      nameChanged,
      labelChanged,
      channelsChanged,
      defaultsChanged,
      referencedChannelsChanged,
      shouldPersist,
      shouldRegenerateThumbnail,
      thumbnailRegenerateReasons,
      ...timings,
    });

    if (!shouldPersist) return record;
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
    const commonSource = this._normalizeCommonSource(record.commonSource);
    const composedSource = this._composeShaderSourceWithCommon(
      record.source,
      commonSource,
    );
    const mergedChannels = this._mergeChannelsPreservingNested(
      record.channels ?? {},
      channels ?? {},
    );
    records[idx] = {
      ...record,
      channels: this.buildChannelConfig({
        source: composedSource,
        commonSource,
        channels: mergedChannels,
        autoAssignCapture,
      }),
      referencedChannels: extractReferencedChannels(composedSource),
      updatedAt: Date.now(),
    };

    await this.setImportedRecords(records, {
      context: "updateImportedShaderChannels",
      changedShaderIds: [shaderId],
      operation: "update-channels",
    });
    this._queueImportedShaderThumbnailRegeneration(shaderId, {
      source: record.source,
      commonSource,
      channels: records[idx]?.channels ?? mergedChannels,
      defaults: records[idx]?.defaults ?? record.defaults,
      autoAssignCapture,
    });
    return this.getImportedRecord(shaderId) ?? records[idx];
  }

  async duplicateImportedShader(shaderId, { name = null, label = null } = {}) {
    const duplicateStart = nowMs();
    const source = this.getImportedRecord(shaderId);
    if (!source) throw new Error("Imported shader not found.");

    const nextName = sanitizeName(name ?? `${source.name} Copy`);
    const nextLabel = sanitizeName(
      label ?? `${source.label ?? source.name} Copy`,
    );

    const indexEntries = this._getImportedLibraryIndexEntries();
    const used = new Set(indexEntries.map((entry) => String(entry?.id ?? "").trim()));
    const base = slugify(nextName);
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
    const settingKey = this._buildShaderRecordSettingKey(id);
    this._registerShaderRecordSetting(settingKey);
    await game.settings.set(this.moduleId, settingKey, clone);
    const nextIndex = [...indexEntries, { id, settingKey }];
    await game.settings.set(this.moduleId, this.shaderLibraryIndexSetting, nextIndex);

    this._shaderLibraryRevision += 1;
    this._invalidateShaderChoiceCaches();
    Hooks.callAll(`${this.moduleId}.shaderLibraryChanged`, {
      context: "duplicateImportedShader",
      operation: "duplicate",
      changedShaderIds: [id],
      addedShaderIds: [id],
      updatedShaderIds: [],
      removedShaderIds: [],
      choicesMayHaveChanged: true,
      recordCount: nextIndex.length,
    });

    debugLog(this.moduleId, "duplicateImportedShader timing", {
      sourceShaderId: String(shaderId ?? ""),
      shaderId: id,
      path: "indexed-fast",
      indexBeforeCount: indexEntries.length,
      indexAfterCount: nextIndex.length,
      totalMs: roundMs(nowMs() - duplicateStart),
    });
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

    await this.setImportedRecords(records, {
      context: "setImportedShaderThumbnail",
      changedShaderIds: [id],
      operation: "thumbnail-manual",
    });
    debugLog(this.moduleId, "thumbnail manual save", {
      shaderId: id,
      length: dataUrl.length,
      format: dataUrl.startsWith("data:image/webp")
        ? "webp"
        : (dataUrl.startsWith("data:image/png") ? "png" : "other"),
      updatedAt: now,
    });
    return this.getImportedRecord(id) ?? records[idx];
  }

  async removeImportedShader(shaderId) {
    const removeStart = nowMs();
    const id = String(shaderId ?? "").trim();
    if (!id) return false;

    const indexEntries = this._getImportedLibraryIndexEntries();
    const removedEntry = indexEntries.find((entry) => String(entry?.id ?? "").trim() === id);
    if (!removedEntry) return false;

    const nextIndex = indexEntries.filter(
      (entry) => String(entry?.id ?? "").trim() !== id,
    );
    const removedSettingKey = String(removedEntry?.settingKey ?? "").trim();
    if (removedSettingKey) {
      this._registerShaderRecordSetting(removedSettingKey);
      await game.settings.set(this.moduleId, removedSettingKey, {});
    }
    await game.settings.set(this.moduleId, this.shaderLibraryIndexSetting, nextIndex);

    this._pendingThumbnailRegenerationRerun?.delete?.(id);
    this._pendingThumbnailRegenerationNextOptions?.delete?.(id);

    this._shaderLibraryRevision += 1;
    this._invalidateShaderChoiceCaches();
    Hooks.callAll(`${this.moduleId}.shaderLibraryChanged`, {
      context: "removeImportedShader",
      operation: "remove",
      changedShaderIds: [id],
      addedShaderIds: [],
      updatedShaderIds: [],
      removedShaderIds: [id],
      choicesMayHaveChanged: true,
      recordCount: nextIndex.length,
    });

    await this.enforceValidSelection();
    debugLog(this.moduleId, "removeImportedShader timing", {
      shaderId: id,
      path: "indexed-fast",
      indexBeforeCount: indexEntries.length,
      indexAfterCount: nextIndex.length,
      totalMs: roundMs(nowMs() - removeStart),
    });
    return true;
  }
}








