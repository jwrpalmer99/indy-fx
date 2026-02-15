const REGION_SHADER_BEHAVIOR_SUBTYPE = "indyFX";
const REGION_SHADER_BEHAVIOR_TYPE = "indy-fx.indyFX";
const REGION_SHADER_LAYER_CHOICES = {
  inherit: "inherit from FX layer",
  interfacePrimary: "interfacePrimary (above tokens, world space)",
  belowTokens: "Below Tokens (interface, under token z-order)",
  drawings: "DrawingsLayer (above tokens, world space)",
};

const REGION_SHADER_BEHAVIOR_SYSTEM_KEYS = [
  "shaderLayer",
  "shaderPreset",
  "shaderGradientMask",
  "shaderGradientFadeStart",
  "shaderAlpha",
  "shaderIntensity",
  "shaderSpeed",
  "shaderBloom",
  "shaderBloomStrength",
  "shaderBloomBlur",
  "shaderBloomQuality",
  "shaderScale",
  "shaderScaleX",
  "shaderScaleY",
  "shaderFlipHorizontal",
  "shaderFlipVertical",
  "shaderRotationDeg",
  "shaderRadiusUnits",
  "shaderFalloff",
  "shaderDensity",
  "shaderFlow",
  "shaderFlowSpeed",
  "shaderFlowTurbulence",
  "shaderColorA",
  "shaderColorB",
  "shaderCaptureScale",
  "shaderDisplayTimeMs",
  "shaderEaseInMs",
  "shaderEaseOutMs",
];

const REGION_SHADER_BUILTIN_SYSTEM_KEYS = [
  "shaderFalloff",
  "shaderDensity",
  "shaderFlow",
  "shaderFlowSpeed",
  "shaderFlowTurbulence",
  "shaderColorA",
  "shaderColorB",
];

const BUILTIN_SHADER_IDS = new Set(["noise", "torus", "globe"]);

function _getSetting(moduleId, key, fallback) {
  try {
    const value = game?.settings?.get?.(moduleId, key);
    return value ?? fallback;
  } catch (_err) {
    return fallback;
  }
}

function _toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _toBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || value === "true" || value === "on")
    return true;
  if (value === 0 || value === "0" || value === "false" || value === "off")
    return false;
  return fallback;
}

function _normalizeShaderLayerChoice(value, fallback = "inherit") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (raw === "token") return "interfacePrimary";
  if (raw === "effects" || raw === "effectsLayer") return "belowTokens";
  if (raw === "interface") return "interfacePrimary";
  if (raw === "drawingsLayer") return "drawings";
  if (raw === "baseEffects") return "belowTokens";
  if (raw === "belowTiles") return "belowTokens";
  if (
    raw === "inherit" ||
    raw === "interfacePrimary" ||
    raw === "belowTokens" ||
    raw === "drawings"
  ) {
    return raw;
  }
  return fallback;
}
function _normalizeHexColor(value, fallback = "FFFFFF") {
  const fallbackClean = String(fallback ?? "FFFFFF")
    .replace(/^#|^0x/i, "")
    .replace(/[^0-9a-f]/gi, "");
  const fallback6 = (fallbackClean || "FFFFFF")
    .slice(0, 6)
    .padStart(6, "0")
    .toUpperCase();
  if (value === null || value === undefined) return fallback6;
  if (Number.isFinite(Number(value))) {
    const n = Math.max(0, Math.min(0xffffff, Math.round(Number(value))));
    return n.toString(16).padStart(6, "0").toUpperCase();
  }
  const clean = String(value)
    .trim()
    .replace(/^#|^0x/i, "")
    .replace(/[^0-9a-f]/gi, "");
  if (!clean) return fallback6;
  return clean.slice(0, 6).padStart(6, "0").toUpperCase();
}

function _escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _resolveElementRoot(candidate) {
  if (!candidate) return null;
  if (candidate instanceof Element) return candidate;
  if (candidate?.element) return _resolveElementRoot(candidate.element);
  if (Array.isArray(candidate) && candidate[0] instanceof Element)
    return candidate[0];
  if (typeof candidate?.length === "number" && candidate[0] instanceof Element)
    return candidate[0];
  if (typeof candidate?.get === "function") {
    const maybe = candidate.get(0);
    if (maybe instanceof Element) return maybe;
  }
  return null;
}

const _shaderChoicesSnapshotByModule = new Map();
const _shaderChoicesSettingsHookByModule = new Map();

function _getShaderChoices(getShaderChoices, moduleId) {
  let choices = {};
  try {
    choices = getShaderChoices?.() ?? {};
  } catch (_err) {
    choices = {};
  }

  if (
    choices &&
    typeof choices === "object" &&
    !Array.isArray(choices) &&
    Object.keys(choices).length
  ) {
    const ordered = Object.entries(choices)
      .sort((a, b) => {
        const byLabel = String(a?.[1] ?? "").localeCompare(String(b?.[1] ?? ""), undefined, {
          sensitivity: "base",
        });
        if (byLabel !== 0) return byLabel;
        return String(a?.[0] ?? "").localeCompare(String(b?.[0] ?? ""), undefined, {
          sensitivity: "base",
        });
      });

    return Object.freeze(Object.fromEntries(ordered));
  }

  const fallbackId = String(_getSetting(moduleId, "shaderPreset", "noise"));
  return Object.freeze({ [fallbackId]: fallbackId });
}
function _refreshShaderChoicesSnapshot(moduleId, getShaderChoices) {
  const key = String(moduleId ?? "");
  const snapshot = _getShaderChoices(getShaderChoices, moduleId);
  _shaderChoicesSnapshotByModule.set(key, {
    provider: getShaderChoices,
    choices: snapshot,
  });
  return snapshot;
}

function _getShaderChoicesSnapshot(moduleId, getShaderChoices) {
  const key = String(moduleId ?? "");
  const cached = _shaderChoicesSnapshotByModule.get(key);
  if (
    cached &&
    cached.provider === getShaderChoices &&
    cached.choices &&
    typeof cached.choices === "object"
  ) {
    return cached.choices;
  }
  return _refreshShaderChoicesSnapshot(moduleId, getShaderChoices);
}
function _resolveValidShaderPreset(moduleId, getShaderChoices, candidate, fallback = "noise") {
  const choices = _getShaderChoicesSnapshot(moduleId, getShaderChoices);
  const requested = String(candidate ?? "").trim();
  if (requested && Object.prototype.hasOwnProperty.call(choices, requested)) {
    return requested;
  }

  const fallbackId = String(fallback ?? "").trim();
  if (fallbackId && Object.prototype.hasOwnProperty.call(choices, fallbackId)) {
    return fallbackId;
  }

  const first = Object.keys(choices)[0] ?? "";
  return String(first);
}


function _ensureShaderChoicesSettingsHook(moduleId, getShaderChoices) {
  const key = String(moduleId ?? "");
  if (_shaderChoicesSettingsHookByModule.has(key)) return;

  const hookId = Hooks.on("updateSetting", (setting) => {
    const settingKey = String(setting?.key ?? setting?.id ?? "").trim();
    if (!settingKey) return;
    if (settingKey !== `${key}.shaderLibrary` && settingKey !== `${key}.shaderPreset`) {
      return;
    }
    _refreshShaderChoicesSnapshot(moduleId, getShaderChoices);
  });

  // Explicit signal used by the shader library/editor when imported records change.
  Hooks.on(`${key}.shaderLibraryChanged`, () => {
    _refreshShaderChoicesSnapshot(moduleId, getShaderChoices);
  });

  _shaderChoicesSettingsHookByModule.set(key, hookId);
}

function getDefaultRegionShaderBehaviorSystem(moduleId) {
  return {
    shaderLayer: _normalizeShaderLayerChoice(_getSetting(moduleId, "shaderLayer", "inherit"), "inherit"),
    shaderPreset: String(_getSetting(moduleId, "shaderPreset", "noise")),
    shaderGradientMask: _toBoolean(
      _getSetting(moduleId, "shaderGradientMask", false),
      false,
    ),
    shaderGradientFadeStart: _toFiniteNumber(
      _getSetting(moduleId, "shaderGradientFadeStart", 0.8),
      0.8,
    ),
    shaderAlpha: _toFiniteNumber(
      _getSetting(moduleId, "shaderAlpha", 1.0),
      1.0,
    ),
    shaderIntensity: _toFiniteNumber(
      _getSetting(moduleId, "shaderIntensity", 1.0),
      1.0,
    ),
    shaderSpeed: _toFiniteNumber(
      _getSetting(moduleId, "shaderSpeed", 1.0),
      1.0,
    ),
    shaderBloom: true,
    shaderBloomStrength: 1.0,
    shaderBloomBlur: 7.0,
    shaderBloomQuality: 2.0,
    shaderScale: _toFiniteNumber(
      _getSetting(moduleId, "shaderScale", 1.0),
      1.0,
    ),
    shaderScaleX: _toFiniteNumber(
      _getSetting(moduleId, "shaderScaleX", 1.0),
      1.0,
    ),
    shaderScaleY: _toFiniteNumber(
      _getSetting(moduleId, "shaderScaleY", 1.0),
      1.0,
    ),
    shaderFlipHorizontal: _toBoolean(
      _getSetting(moduleId, "shaderFlipHorizontal", false),
      false,
    ),
    shaderFlipVertical: _toBoolean(
      _getSetting(moduleId, "shaderFlipVertical", false),
      false,
    ),
    shaderRotationDeg: _toFiniteNumber(
      _getSetting(moduleId, "shaderRotationDeg", 0),
      0,
    ),
    shaderRadiusUnits: _toFiniteNumber(
      _getSetting(moduleId, "shaderRadiusUnits", 20),
      20,
    ),
    shaderFalloff: _toFiniteNumber(
      _getSetting(moduleId, "shaderFalloff", 1.6),
      1.6,
    ),
    shaderDensity: _toFiniteNumber(
      _getSetting(moduleId, "shaderDensity", 1.0),
      1.0,
    ),
    shaderFlow: _toBoolean(_getSetting(moduleId, "shaderFlow", true), true),
    shaderFlowSpeed: _toFiniteNumber(
      _getSetting(moduleId, "shaderFlowSpeed", 0.8),
      0.8,
    ),
    shaderFlowTurbulence: _toFiniteNumber(
      _getSetting(moduleId, "shaderFlowTurbulence", 0.35),
      0.35,
    ),
    shaderColorA: _normalizeHexColor(
      _getSetting(moduleId, "shaderColorA", "FF4A9A"),
      "FF4A9A",
    ),
    shaderColorB: _normalizeHexColor(
      _getSetting(moduleId, "shaderColorB", "FFB14A"),
      "FFB14A",
    ),
    shaderCaptureScale: _toFiniteNumber(
      _getSetting(moduleId, "shaderCaptureScale", 1.0),
      2.0,
    ),
    shaderDisplayTimeMs: _toFiniteNumber(
      _getSetting(moduleId, "shaderDisplayTimeMs", 0),
      0,
    ),
    shaderEaseInMs: _toFiniteNumber(
      _getSetting(moduleId, "shaderEaseInMs", 250),
      250,
    ),
    shaderEaseOutMs: _toFiniteNumber(
      _getSetting(moduleId, "shaderEaseOutMs", 250),
      250,
    ),
  };
}

function buildRegionShaderBehaviorSystemData(moduleId, opts = {}, { getShaderChoices = null } = {}) {
  const source = opts && typeof opts === "object" ? opts : {};
  const defaults = getDefaultRegionShaderBehaviorSystem(moduleId);
  const flowFromMode = source.flowMode;
  const flowModeBool = Number.isFinite(Number(flowFromMode))
    ? Number(flowFromMode) > 0
    : _toBoolean(flowFromMode, defaults.shaderFlow);

  return {
    shaderLayer: _normalizeShaderLayerChoice(
      source.shaderLayer ?? source.layer ?? defaults.shaderLayer,
      defaults.shaderLayer,
    ),
    shaderPreset: String(
      typeof getShaderChoices === "function"
        ? _resolveValidShaderPreset(
            moduleId,
            getShaderChoices,
            source.shaderPreset ?? source.shaderId ?? source.shaderMode,
            defaults.shaderPreset,
          )
        : source.shaderPreset ??
            source.shaderId ??
            source.shaderMode ??
            defaults.shaderPreset,
    ),
    shaderGradientMask: _toBoolean(
      source.shaderGradientMask ?? source.useGradientMask,
      defaults.shaderGradientMask,
    ),
    shaderGradientFadeStart: _toFiniteNumber(
      source.shaderGradientFadeStart ?? source.gradientMaskFadeStart,
      defaults.shaderGradientFadeStart,
    ),
    shaderAlpha: _toFiniteNumber(
      source.shaderAlpha ?? source.alpha,
      defaults.shaderAlpha,
    ),
    shaderIntensity: _toFiniteNumber(
      source.shaderIntensity ?? source.intensity,
      defaults.shaderIntensity,
    ),
    shaderSpeed: _toFiniteNumber(
      source.shaderSpeed ?? source.speed,
      defaults.shaderSpeed,
    ),
    shaderBloom: _toBoolean(
      source.shaderBloom ?? source.bloom,
      defaults.shaderBloom,
    ),
    shaderBloomStrength: _toFiniteNumber(
      source.shaderBloomStrength ?? source.bloomStrength,
      defaults.shaderBloomStrength,
    ),
    shaderBloomBlur: _toFiniteNumber(
      source.shaderBloomBlur ?? source.bloomBlur,
      defaults.shaderBloomBlur,
    ),
    shaderBloomQuality: _toFiniteNumber(
      source.shaderBloomQuality ?? source.bloomQuality,
      defaults.shaderBloomQuality,
    ),
    shaderScale: _toFiniteNumber(
      source.shaderScale ?? source.scale,
      defaults.shaderScale,
    ),
    shaderScaleX: _toFiniteNumber(
      source.shaderScaleX ?? source.scaleX,
      defaults.shaderScaleX,
    ),
    shaderScaleY: _toFiniteNumber(
      source.shaderScaleY ?? source.scaleY,
      defaults.shaderScaleY,
    ),
    shaderFlipHorizontal: _toBoolean(
      source.shaderFlipHorizontal ?? source.flipHorizontal,
      defaults.shaderFlipHorizontal,
    ),
    shaderFlipVertical: _toBoolean(
      source.shaderFlipVertical ?? source.flipVertical,
      defaults.shaderFlipVertical,
    ),
    shaderRotationDeg: _toFiniteNumber(
      source.shaderRotationDeg ?? source.rotationDeg,
      defaults.shaderRotationDeg,
    ),
    shaderRadiusUnits: _toFiniteNumber(
      source.shaderRadiusUnits ?? source.radiusUnits,
      defaults.shaderRadiusUnits,
    ),
    shaderFalloff: _toFiniteNumber(
      source.shaderFalloff ?? source.falloffPower,
      defaults.shaderFalloff,
    ),
    shaderDensity: _toFiniteNumber(
      source.shaderDensity ?? source.density,
      defaults.shaderDensity,
    ),
    shaderFlow: _toBoolean(source.shaderFlow, flowModeBool),
    shaderFlowSpeed: _toFiniteNumber(
      source.shaderFlowSpeed ?? source.flowSpeed,
      defaults.shaderFlowSpeed,
    ),
    shaderFlowTurbulence: _toFiniteNumber(
      source.shaderFlowTurbulence ?? source.flowTurbulence,
      defaults.shaderFlowTurbulence,
    ),
    shaderColorA: _normalizeHexColor(
      source.shaderColorA ?? source.colorA,
      defaults.shaderColorA,
    ),
    shaderColorB: _normalizeHexColor(
      source.shaderColorB ?? source.colorB,
      defaults.shaderColorB,
    ),
    shaderCaptureScale: _toFiniteNumber(
      source.shaderCaptureScale ?? source.captureScale,
      defaults.shaderCaptureScale,
    ),
    shaderDisplayTimeMs: _toFiniteNumber(
      source.shaderDisplayTimeMs ?? source.displayTimeMs,
      defaults.shaderDisplayTimeMs,
    ),
    shaderEaseInMs: _toFiniteNumber(
      source.shaderEaseInMs ?? source.easeInMs,
      defaults.shaderEaseInMs,
    ),
    shaderEaseOutMs: _toFiniteNumber(
      source.shaderEaseOutMs ?? source.easeOutMs,
      defaults.shaderEaseOutMs,
    ),
  };
}

function getRegionShaderBehaviorSystemData(moduleId, behavior) {
  const defaults = getDefaultRegionShaderBehaviorSystem(moduleId);
  const source =
    behavior?.system?.toObject?.() ??
    foundry.utils.deepClone(behavior?.system ?? {});
  if (!source || typeof source !== "object") return defaults;
  return foundry.utils.mergeObject(defaults, source, { inplace: false });
}

function isRegionShaderBehaviorType(type) {
  const value = String(type ?? "");
  return value === REGION_SHADER_BEHAVIOR_TYPE;
}
function registerRegionShaderBehavior({
  moduleId,
  getShaderChoices,
  isBuiltinShader,
} = {}) {
  const cfg = CONFIG?.RegionBehavior;
  const RegionBehaviorTypeBase =
    foundry?.data?.regionBehaviors?.RegionBehaviorType;
  const RegionBehaviorConfigBase =
    foundry?.applications?.sheets?.RegionBehaviorConfig;
  const DocumentSheetConfig = foundry?.applications?.apps?.DocumentSheetConfig;
  const F = foundry?.data?.fields;
  if (
    !cfg ||
    !RegionBehaviorTypeBase ||
    !RegionBehaviorConfigBase ||
    !DocumentSheetConfig ||
    !F
  )
    return null;

  try {
    const modelTypes = game?.model?.RegionBehavior;
    if (
      modelTypes &&
      !Object.prototype.hasOwnProperty.call(
        modelTypes,
        REGION_SHADER_BEHAVIOR_TYPE,
      )
    ) {
      modelTypes[REGION_SHADER_BEHAVIOR_TYPE] = {};
    }
    const docTypes = game?.documentTypes?.RegionBehavior;
    if (
      Array.isArray(docTypes) &&
      !docTypes.includes(REGION_SHADER_BEHAVIOR_TYPE)
    ) {
      docTypes.push(REGION_SHADER_BEHAVIOR_TYPE);
    }
  } catch (_err) {
    // Non-fatal.
  }

  const shaderChoiceFn = () =>
    _getShaderChoicesSnapshot(moduleId, getShaderChoices);
  _ensureShaderChoicesSettingsHook(moduleId, getShaderChoices);

  if (!cfg.dataModels[REGION_SHADER_BEHAVIOR_TYPE]) {
    const isBuiltinShaderFn = (shaderId) => {
      if (typeof isBuiltinShader === "function") {
        try {
          return isBuiltinShader(shaderId) === true;
        } catch (_err) {
          // Fall through.
        }
      }
      return BUILTIN_SHADER_IDS.has(String(shaderId ?? "").trim());
    };

    class IndyFXRegionBehaviorType extends RegionBehaviorTypeBase {
      static defineSchema() {
        return {
          shaderLayer: new F.StringField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderLayer", "inherit"),
            choices: REGION_SHADER_LAYER_CHOICES,
            label: "Shader layer",
            hint: "Where to render shader effects.",
          }),
          shaderPreset: new F.StringField({
            required: true,
            initial: () => _resolveValidShaderPreset(moduleId, getShaderChoices, _getSetting(moduleId, "shaderPreset", "noise"), "noise"),
            choices: shaderChoiceFn,
            label: "Shader preset",
            hint: "Choose a built-in or imported shader.",
          }),
          shaderGradientMask: new F.BooleanField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderGradientMask", false),
            label: "Gradient mask",
            hint: "Use soft radial mask when enabled, hard-edge clip when disabled.",
          }),
          shaderGradientFadeStart: new F.NumberField({
            required: true,
            initial: () =>
              _getSetting(moduleId, "shaderGradientFadeStart", 0.8),
            min: 0.0,
            max: 1.0,
            step: 0.01,
            label: "Gradient fade start",
            hint: "Normalized radius where mask fade starts (0.8 = fade from 80% to edge).",
          }),
          shaderAlpha: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderAlpha", 1.0),
            min: 0.0,
            max: 1.0,
            step: 0.01,
            label: "Shader alpha",
            hint: "Final opacity multiplier.",
          }),
          shaderIntensity: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderIntensity", 1.0),
            min: 0.0,
            max: 50.0,
            step: 0.05,
            label: "Shader intensity",
            hint: "Brightness/intensity multiplier passed to shader uniforms.",
          }),
          shaderSpeed: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderSpeed", 1.0),
            min: 0.0,
            max: 10.0,
            step: 0.05,
            label: "Shader speed",
            hint: "Global time speed multiplier.",
          }),
          shaderBloom: new F.BooleanField({
            required: true,
            initial: () => true,
            label: "Use bloom",
            hint: "Apply bloom filter if available.",
          }),
          shaderBloomStrength: new F.NumberField({
            required: true,
            initial: () => 1.0,
            min: 0.0,
            max: 3.0,
            step: 0.05,
            label: "Bloom strength",
            hint: "Bloom intensity.",
          }),
          shaderBloomBlur: new F.NumberField({
            required: true,
            initial: () => 7.0,
            min: 0.0,
            max: 20.0,
            step: 0.1,
            label: "Bloom blur",
            hint: "Bloom blur radius.",
          }),
          shaderBloomQuality: new F.NumberField({
            required: true,
            initial: () => 2.0,
            min: 0.0,
            max: 8.0,
            step: 1.0,
            label: "Bloom quality",
            hint: "Bloom quality/samples.",
          }),
          shaderScale: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderScale", 1.0),
            min: 0.1,
            max: 10.0,
            step: 0.05,
            label: "Shader scale",
            hint: "Scales shader sampling/pattern without changing covered area.",
          }),
          shaderScaleX: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderScaleX", 1.0),
            min: 0.1,
            max: 10.0,
            step: 0.05,
            label: "Shader scale X",
            hint: "Horizontal shader sampling scale.",
          }),
          shaderScaleY: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderScaleY", 1.0),
            min: 0.1,
            max: 10.0,
            step: 0.05,
            label: "Shader scale Y",
            hint: "Vertical shader sampling scale.",
          }),
          shaderFlipHorizontal: new F.BooleanField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderFlipHorizontal", false),
            label: "Flip horizontal",
            hint: "Mirror shader sampling horizontally.",
          }),
          shaderFlipVertical: new F.BooleanField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderFlipVertical", false),
            label: "Flip vertical",
            hint: "Mirror shader sampling vertically.",
          }),
          shaderRotationDeg: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderRotationDeg", 0),
            min: -36000,
            max: 36000,
            step: 0.1,
            label: "Shader rotation (deg)",
            hint: "UV rotation in degrees.",
          }),
          shaderRadiusUnits: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderRadiusUnits", 20),
            min: 1,
            max: 500,
            step: 1,
            label: "Shader radius (scene units)",
            hint: "Radius for shader effect in scene distance units.",
          }),
          shaderFalloff: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderFalloff", 1.6),
            min: 0.2,
            max: 6.0,
            step: 0.1,
            label: "Shader radial falloff",
            hint: "Higher values concentrate intensity toward center.",
          }),
          shaderDensity: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderDensity", 1.0),
            min: 0.2,
            max: 4.0,
            step: 0.1,
            label: "Shader density",
            hint: "Scales shader detail frequency.",
          }),
          shaderFlow: new F.BooleanField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderFlow", true),
            label: "Shader outward flow",
            hint: "Whether pattern drifts outward.",
          }),
          shaderFlowSpeed: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderFlowSpeed", 0.8),
            min: 0.0,
            max: 5.0,
            step: 0.1,
            label: "Outward flow speed",
            hint: "How fast the shader pattern moves outward.",
          }),
          shaderFlowTurbulence: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderFlowTurbulence", 0.35),
            min: 0.0,
            max: 2.0,
            step: 0.05,
            label: "Flow turbulence",
            hint: "Adds jitter to outward flow.",
          }),
          shaderColorA: new F.StringField({
            required: true,
            initial: () =>
              _normalizeHexColor(
                _getSetting(moduleId, "shaderColorA", "FF4A9A"),
                "FF4A9A",
              ),
            clean: (value) => _normalizeHexColor(value, "FF4A9A"),
            label: "Color A (hex)",
            hint: "Built-in shader color A. Example: FF4A9A",
          }),
          shaderColorB: new F.StringField({
            required: true,
            initial: () =>
              _normalizeHexColor(
                _getSetting(moduleId, "shaderColorB", "FFB14A"),
                "FFB14A",
              ),
            clean: (value) => _normalizeHexColor(value, "FFB14A"),
            label: "Color B (hex)",
            hint: "Built-in shader color B. Example: FFB14A",
          }),
          shaderCaptureScale: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderCaptureScale", 1.0),
            min: 0.25,
            max: 4.0,
            step: 0.05,
            label: "Scene capture scale",
            hint: "Multiplier for scene-capture channel area.",
          }),
          shaderDisplayTimeMs: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderDisplayTimeMs", 0),
            min: 0,
            max: 120000,
            step: 50,
            label: "Shader display time (ms)",
            hint: "0 means persistent until toggled off.",
          }),
          shaderEaseInMs: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderEaseInMs", 250),
            min: 0,
            max: 60000,
            step: 50,
            label: "Shader ease-in (ms)",
            hint: "Fade-in duration.",
          }),
          shaderEaseOutMs: new F.NumberField({
            required: true,
            initial: () => _getSetting(moduleId, "shaderEaseOutMs", 250),
            min: 0,
            max: 60000,
            step: 50,
            label: "Shader ease-out (ms)",
            hint: "Fade-out duration.",
          }),
        };
      }
    }

    class IndyFXRegionBehaviorConfig extends RegionBehaviorConfigBase {
      static BUILTIN_FIELDS = [
        {
          key: "shaderFalloff",
          label: "Shader radial falloff",
          type: "number",
          min: 0.2,
          max: 6.0,
          step: 0.1,
          hint: "Higher values concentrate intensity toward center.",
        },
        {
          key: "shaderDensity",
          label: "Shader density",
          type: "number",
          min: 0.2,
          max: 4.0,
          step: 0.1,
          hint: "Scales shader detail frequency.",
        },
        {
          key: "shaderFlow",
          label: "Shader outward flow",
          type: "boolean",
          hint: "Whether pattern drifts outward.",
        },
        {
          key: "shaderFlowSpeed",
          label: "Outward flow speed",
          type: "number",
          min: 0.0,
          max: 5.0,
          step: 0.1,
          hint: "How fast the shader pattern moves outward.",
        },
        {
          key: "shaderFlowTurbulence",
          label: "Flow turbulence",
          type: "number",
          min: 0.0,
          max: 2.0,
          step: 0.05,
          hint: "Adds jitter to outward flow.",
        },
        {
          key: "shaderColorA",
          label: "Color A (hex)",
          type: "text",
          hint: "Built-in shader color A. Example: FF4A9A",
        },
        {
          key: "shaderColorB",
          label: "Color B (hex)",
          type: "text",
          hint: "Built-in shader color B. Example: FFB14A",
        },
      ];

      static DEFAULT_OPTIONS = foundry.utils.mergeObject(
        super.DEFAULT_OPTIONS,
        {
          id: `${moduleId}-region-shader-behavior-config`,
          window: {
            title: "Region indyFX Behavior",
            icon: "fas fa-wand-magic",
          },
        },
        { inplace: false },
      );

      _getFormRoot() {
        const root = _resolveElementRoot(this.element);
        if (!root) return null;
        return root.querySelector("form") ?? root;
      }

      _findFieldInput(form, key) {
        if (!form) return null;
        return form.querySelector(
          `[name="system.${key}"], [name="system[${key}]"], [name="${key}"]`,
        );
      }

      _findFieldGroup(form, key) {
        const input = this._findFieldInput(form, key);
        if (!input) return null;
        return input.closest(
          ".form-group, .form-group-stacked, .field, fieldset",
        );
      }

      _isSelectedShaderBuiltin(form) {
        const presetInput = this._findFieldInput(form, "shaderPreset");
        const shaderId = String(presetInput?.value ?? "").trim();
        return isBuiltinShaderFn(shaderId);
      }

      _syncBuiltinButtonState(form, button, notes) {
        const isBuiltin = this._isSelectedShaderBuiltin(form);
        button.disabled = !isBuiltin;
        if (notes) {
          notes.textContent = isBuiltin
            ? "These options primarily affect built-in shaders (especially Noise)."
            : "Current shader is imported. Built-in options are usually ignored.";
        }
      }

      async _openBuiltinDialog(form) {
        const fields = IndyFXRegionBehaviorConfig.BUILTIN_FIELDS;
        const content = `
          <form class="indy-fx-region-builtin-dialog">
            <p class="notes">Configure options that mainly affect built-in shaders.</p>
            ${fields
              .map((field) => {
                const input = this._findFieldInput(form, field.key);
                const isChecked = input?.checked === true;
                const value =
                  field.type === "boolean"
                    ? ""
                    : _escapeHtml(input?.value ?? "");
                if (field.type === "boolean") {
                  return `
                  <div class="form-group">
                    <label>${_escapeHtml(field.label)}</label>
                    <div class="form-fields">
                      <input type="checkbox" name="${_escapeHtml(field.key)}" ${isChecked ? "checked" : ""} />
                    </div>
                    <p class="notes">${_escapeHtml(field.hint ?? "")}</p>
                  </div>
                `;
                }
                const attrs = [
                  `name="${_escapeHtml(field.key)}"`,
                  `value="${value}"`,
                  `type="${field.type === "number" ? "number" : "text"}"`,
                ];
                if (field.min !== undefined) attrs.push(`min="${field.min}"`);
                if (field.max !== undefined) attrs.push(`max="${field.max}"`);
                if (field.step !== undefined)
                  attrs.push(`step="${field.step}"`);
                return `
                <div class="form-group">
                  <label>${_escapeHtml(field.label)}</label>
                  <div class="form-fields">
                    <input ${attrs.join(" ")} />
                  </div>
                  <p class="notes">${_escapeHtml(field.hint ?? "")}</p>
                </div>
              `;
              })
              .join("")}
          </form>
        `;

        const dialog = new foundry.applications.api.DialogV2({
          window: { title: "Built-in Shader Options" },
          content,
          buttons: [
            {
              action: "save",
              label: "Save",
              icon: "fas fa-save",
              default: true,
              callback: (_event, _button, app) => {
                const root =
                  _resolveElementRoot(app?.element) ?? _resolveElementRoot(app);
                if (!(root instanceof Element)) return;
                for (const field of fields) {
                  const sourceInput = this._findFieldInput(form, field.key);
                  const dialogInput = root.querySelector(
                    `[name="${field.key}"]`,
                  );
                  if (!sourceInput || !dialogInput) continue;
                  if (field.type === "boolean")
                    sourceInput.checked = dialogInput.checked === true;
                  else sourceInput.value = String(dialogInput.value ?? "");
                  sourceInput.dispatchEvent(
                    new Event("change", { bubbles: true }),
                  );
                }
              },
            },
            { action: "cancel", label: "Cancel", icon: "fas fa-times" },
          ],
        });
        await dialog.render(true);
        const dialogRoot =
          _resolveElementRoot(dialog?.element) ?? _resolveElementRoot(dialog);
        if (dialogRoot instanceof Element) {
          for (const ff of dialogRoot.querySelectorAll(".form-fields")) {
            if (ff instanceof HTMLElement) ff.style.marginTop = "2px";
          }
        }
      }

      _onRender(context, options) {
        super._onRender?.(context, options);
        const form = this._getFormRoot();
        if (!(form instanceof Element)) return;

        for (const ff of form.querySelectorAll(".form-fields")) {
          if (ff instanceof HTMLElement) ff.style.marginTop = "2px";
        }
        for (const key of REGION_SHADER_BUILTIN_SYSTEM_KEYS) {
          const group = this._findFieldGroup(form, key);
          if (group) group.style.display = "none";
        }
      }
    }

    cfg.dataModels[REGION_SHADER_BEHAVIOR_TYPE] = IndyFXRegionBehaviorType;
    cfg.typeLabels[REGION_SHADER_BEHAVIOR_TYPE] = "INDYFX.RegionBehaviorLabel";
    cfg.typeIcons[REGION_SHADER_BEHAVIOR_TYPE] =
      "fas fa-wand-magic";

    DocumentSheetConfig.registerSheet(
      cfg.documentClass,
      moduleId,
      IndyFXRegionBehaviorConfig,
      {
        types: [REGION_SHADER_BEHAVIOR_TYPE],
        makeDefault: true,
        canBeDefault: false,
        label: "indyFX",
      },
    );
  }

  return {
    type: REGION_SHADER_BEHAVIOR_TYPE,
  };
}

export {
  REGION_SHADER_BEHAVIOR_SUBTYPE,
  REGION_SHADER_BEHAVIOR_SYSTEM_KEYS,
  REGION_SHADER_BEHAVIOR_TYPE,
  buildRegionShaderBehaviorSystemData,
  getDefaultRegionShaderBehaviorSystem,
  getRegionShaderBehaviorSystemData,
  isRegionShaderBehaviorType,
  registerRegionShaderBehavior,
};






