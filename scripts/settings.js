// Settings and config helpers extracted from main.js

export const SHADER_SETTINGS_KEYS = [
  "shaderLayer",
  "shaderPreset",
  "shaderGradientMask",
  "shaderGradientFadeStart",
  "shaderAlpha",
  "shaderIntensity",
  "shaderSpeed",
  "shaderScale",
  "shaderScaleX",
  "shaderScaleY",
  "shaderRadiusUnits",
  "shaderFalloff",
  "shaderDensity",
  "shaderFlow",
  "shaderFlowSpeed",
  "shaderFlowTurbulence",
  "shaderColorA",
  "shaderColorB",
  "shaderCaptureScale",
  "previewSceneCaptureBackground",
  "previewPlaceableCaptureBackground",
  "shaderDisplayTimeMs",
  "shaderEaseInMs",
  "shaderEaseOutMs"
];


export const DEBUG_SETTINGS_KEYS = [
  "shaderDebug",
  "shaderDebugMode",
  "shaderSanitizeColor",
];

export function registerModuleSettings({ moduleId, shaderManager, menus }) {
  const { ShaderSettingsMenu, DebugSettingsMenu, ShaderLibraryMenu } = menus;
  shaderManager.registerSettings();
  const notifyClientPerformanceSettingChanged = (key, value) => {
    try {
      Hooks.callAll(`${moduleId}.clientPerformanceSettingsChanged`, { key, value });
    } catch (_err) {
      // Non-fatal.
    }
  };

  // World (GM config, shared defaults)
  game.settings.register(moduleId, "gmOnlyBroadcast", {
    name: "GM-only broadcasting",
    hint: "If enabled, only GMs can broadcast FX to all clients.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(moduleId, "layer", {
    name: "FX layer",
    hint: "Where to render FX. interfacePrimary = above tokens in world space (recommended).",
    scope: "world",
    config: false,
    type: String,
    choices: {
      interfacePrimary: "interfacePrimary (above tokens, world space)",
      belowTokens: "Below Tokens (interface, under token z-order)",
      drawings: "DrawingsLayer (above tokens, world space)"
    },
    default: "interfacePrimary"
  });

  game.settings.registerMenu(moduleId, "shaderMenu", {
    name: "Default Shader Settings",
    label: "Configure",
    hint: "Settings applied to new shaders by default.",
    icon: "fas fa-atom",
    type: ShaderSettingsMenu,
    restricted: true
  });

  game.settings.registerMenu(moduleId, "debugMenu", {
    name: "Debug Settings",
    label: "Configure",
    hint: "Debug overlays and shader diagnostics.",
    icon: "fas fa-bug",
    type: DebugSettingsMenu,
    restricted: false
  });

  game.settings.registerMenu(moduleId, "shaderLibraryMenu", {
    name: "Shader Library",
    label: "Manage",
    hint: "Import ShaderToy shaders and manage custom shader presets.",
    icon: "fas fa-file-import",
    type: ShaderLibraryMenu,
    restricted: true
  });

  game.settings.register(moduleId, "shaderLayer", {
    name: "Shader layer",
    hint: "Where to render shader effects.",
    scope: "world",
    config: false,
    type: String,
    choices: {
      inherit: "inherit from FX layer",
      interfacePrimary: "interfacePrimary (above tokens, world space)",
      belowTokens: "Below Tokens (interface, under token z-order)",
      drawings: "DrawingsLayer (above tokens, world space)"
    },
    default: "inherit"
  });

  game.settings.register(moduleId, "shaderPreset", {
    name: "Shader preset",
    hint: "Choose a built-in or imported shader.",
    scope: "world",
    config: false,
    type: String,
    default: "noise"
  });


  game.settings.register(moduleId, "shaderGradientMask", {
    name: "Gradient mask",
    hint: "If enabled, use a soft radial gradient mask. Disable for a hard-edged circular mask.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(moduleId, "shaderGradientFadeStart", {
    name: "Gradient fade start",
    hint: "Normalized radius where gradient masking starts fading (0.8 = fade from 80% radius to edge).",
    scope: "world",
    config: false,
    type: Number,
    default: 0.8,
    range: { min: 0.0, max: 1.0, step: 0.01 }
  });

  game.settings.register(moduleId, "shaderAlpha", {
    name: "Shader alpha",
    hint: "Final opacity multiplier for shader effects.",
    scope: "world",
    config: false,
    type: Number,
    default: 1.0,
    range: { min: 0.0, max: 1.0, step: 0.01 }
  });

  game.settings.register(moduleId, "shaderIntensity", {
    name: "Shader intensity",
    hint: "Brightness/intensity multiplier passed to shader uniforms.",
    scope: "world",
    config: false,
    type: Number,
    default: 1.0,
    range: { min: 0.0, max: 50.0, step: 0.05 }
  });

  game.settings.register(moduleId, "shaderSpeed", {
    name: "Shader speed",
    hint: "Global time speed multiplier for shader animation.",
    scope: "world",
    config: false,
    type: Number,
    default: 1.0,
    range: { min: 0.0, max: 10.0, step: 0.05 }
  });

  game.settings.register(moduleId, "shaderDebug", {
    name: "Shader debug",
    hint: "Draw a debug circle at the computed shader center/radius.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(moduleId, "shaderDebugMode", {
    name: "Shader preset debug",
    hint: "Visualize shader UVs, base mask, or token rotation uniform for debugging.",
    scope: "client",
    config: false,
    type: String,
    choices: {
      off: "off",
      uv: "UV gradient",
      mask: "radial mask alpha",
      tokenRotation: "token rotation (cpfxTokenRotation)"
    },
    default: "off"
  });

  game.settings.register(moduleId, "shaderSanitizeColor", {
    name: "Sanitize shader output color",
    hint: "Client preference. Clamps/repairs NaN or infinite imported-shader color output before final compositing.",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(moduleId, "shaderLibraryViewMode", {
    name: "Shader library view mode",
    hint: "Preferred shader library card layout.",
    scope: "client",
    config: false,
    type: String,
    choices: {
      standard: "standard",
      compact: "compact"
    },
    default: "standard"
  });

  game.settings.register(moduleId, "shaderLibraryCompactTooltipDelayMs", {
    name: "Compact tooltip delay (ms)",
    hint: "Delay before showing compact-view shader tooltip preview.",
    scope: "client",
    config: true,
    type: Number,
    default: 300,
    range: { min: 0, max: 2000, step: 25 }
  });

  game.settings.register(moduleId, "shaderCaptureResolutionScale", {
    name: "Capture resolution scale",
    hint: "Client performance setting. Scales shader capture resolution (scene capture textures) to reduce GPU load.",
    scope: "client",
    config: true,
    type: Number,
    default: 1.0,
    range: { min: 0.25, max: 1.0, step: 0.05 },
    onChange: (value) => notifyClientPerformanceSettingChanged("shaderCaptureResolutionScale", value),
  });

  game.settings.register(moduleId, "shaderCaptureMaxFps", {
    name: "Capture update max FPS",
    hint: "Client performance setting. Caps how often runtime shader captures and shader buffers update.",
    scope: "client",
    config: true,
    type: Number,
    default: 240,
    range: { min: 10, max: 240, step: 1 },
    onChange: (value) => notifyClientPerformanceSettingChanged("shaderCaptureMaxFps", value),
  });

  game.settings.register(moduleId, "shaderDrawMaxFps", {
    name: "Shader draw update max FPS",
    hint: "Client performance setting. Caps how often shader time uniforms update. Uses compensated delta-time so animation speed remains correct.",
    scope: "client",
    config: true,
    type: Number,
    default: 240,
    range: { min: 10, max: 240, step: 1 },
    onChange: (value) => notifyClientPerformanceSettingChanged("shaderDrawMaxFps", value),
  });

game.settings.register(moduleId, "shaderRadiusUnits", {
  name: "Shader radius (scene units)",
  hint: "Radius for shader effect in the scene's distance units (for example, 20 ft).",
  scope: "world",
  config: false,
  type: Number,
  default: 20,
  range: { min: 1, max: 500, step: 1 }
});

  game.settings.register(moduleId, "shaderScale", {
    name: "Shader scale",
    hint: "Scales shader sampling/pattern (1.0 = normal) without changing covered area.",
    scope: "world",
    config: false,
    type: Number,
    default: 1.0,
    range: { min: 0.1, max: 10.0, step: 0.05 }
  });

  game.settings.register(moduleId, "shaderScaleX", {
    name: "Shader scale X",
    hint: "Horizontal shader sampling scale (1.0 = normal).",
    scope: "world",
    config: false,
    type: Number,
    default: 1.0,
    range: { min: 0.1, max: 10.0, step: 0.05 }
  });

  game.settings.register(moduleId, "shaderScaleY", {
    name: "Shader scale Y",
    hint: "Vertical shader sampling scale (1.0 = normal).",
    scope: "world",
    config: false,
    type: Number,
    default: 1.0,
    range: { min: 0.1, max: 10.0, step: 0.05 }
  });

  game.settings.register(moduleId, "shaderFalloff", {
    name: "Shader radial falloff",
    hint: "Higher values concentrate intensity toward the center.",
    scope: "world",
    config: false,
    type: Number,
    default: 1.6,
    range: { min: 0.2, max: 6, step: 0.1 }
  });

  game.settings.register(moduleId, "shaderDensity", {
    name: "Shader density",
    hint: "Scales the noise frequency (higher = more detailed turbulence).",
    scope: "world",
    config: false,
    type: Number,
    default: 1.0,
    range: { min: 0.2, max: 4.0, step: 0.1 }
  });

  game.settings.register(moduleId, "shaderFlow", {
    name: "Shader outward flow",
    hint: "If enabled, the shader pattern drifts outward from the center.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(moduleId, "shaderFlowSpeed", {
    name: "Outward flow speed",
    hint: "How fast the shader pattern moves outward.",
    scope: "world",
    config: false,
    type: Number,
    default: 0.8,
    range: { min: 0.0, max: 5.0, step: 0.1 }
  });

  game.settings.register(moduleId, "shaderFlowTurbulence", {
    name: "Flow turbulence",
    hint: "Adds jitter to the outward flow to avoid straight spokes.",
    scope: "world",
    config: false,
    type: Number,
    default: 0.35,
    range: { min: 0.0, max: 2.0, step: 0.05 }
  });

  game.settings.register(moduleId, "shaderColorA", {
    name: "Shader color A (hex)",
    hint: "Built-in shader primary color. Example: FF4A9A",
    scope: "world",
    config: false,
    type: String,
    default: "FF4A9A"
  });

  game.settings.register(moduleId, "shaderColorB", {
    name: "Shader color B (hex)",
    hint: "Built-in shader secondary color. Example: FFB14A",
    scope: "world",
    config: false,
    type: String,
    default: "FFB14A"
  });

  game.settings.register(moduleId, "shaderCaptureScale", {
    name: "Scene capture scale",
    hint: "Multiplier for imported shader scene-capture channels. 1.0 = match effect radius, 2.0 = capture twice the radius.",
    scope: "world",
    config: false,
    type: Number,
    default: 1.0,
    range: { min: 0.25, max: 4.0, step: 0.05 }
  });

  game.settings.register(moduleId, "previewSceneCaptureBackground", {
    name: "Preview scene background",
    hint: "Image/video path used for scene-capture channels in shader previews.",
    scope: "world",
    config: false,
    type: String,
    default: "modules/indy-fx/images/indyFX_solid.webp"
  });

  game.settings.register(moduleId, "previewPlaceableCaptureBackground", {
    name: "Preview token/tile capture background",
    hint: "Image/video path used for token/tile capture channels in shader previews.",
    scope: "world",
    config: false,
    type: String,
    default: "modules/indy-fx/images/indyFX.webp"
  });

  game.settings.register(moduleId, "shaderDisplayTimeMs", {
    name: "Shader display time (ms)",
    hint: "Total lifetime in milliseconds. Set to 0 to keep effect running until manually toggled off.",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    range: { min: 0, max: 120000, step: 50 }
  });

  game.settings.register(moduleId, "shaderEaseInMs", {
    name: "Shader ease-in (ms)",
    hint: "Fade-in duration from alpha 0 to full alpha.",
    scope: "world",
    config: false,
    type: Number,
    default: 250,
    range: { min: 0, max: 60000, step: 50 }
  });

  game.settings.register(moduleId, "shaderEaseOutMs", {
    name: "Shader ease-out (ms)",
    hint: "Fade-out duration to alpha 0 at the end of display time.",
    scope: "world",
    config: false,
    type: Number,
    default: 250,
    range: { min: 0, max: 60000, step: 50 }
  });
}




