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
  "shaderDisplayTimeMs",
  "shaderEaseInMs",
  "shaderEaseOutMs"
];

export const SPARK_SETTINGS_KEYS = [
  "layer",
  "count",
  "lifeMin",
  "lifeMax",
  "speedMin",
  "speedMax",
  "startAtEdge",
  "edgeFactor",
  "radiusMin",
  "radiusMax",
  "colorA",
  "colorB",
  "useBloom",
  "bloomStrength",
  "bloomBlur",
  "glowScale",
  "glowAlpha",
  "outlineWidth"
];

export const DEBUG_SETTINGS_KEYS = [
  "shaderDebug",
  "shaderDebugMode"
];

export function registerModuleSettings({ moduleId, shaderManager, menus }) {
  const { ShaderSettingsMenu, SparksSettingsMenu, DebugSettingsMenu, ShaderLibraryMenu } = menus;
  shaderManager.registerSettings();

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
      interface: "interface (overlay, not world space)",
      effects: "effects (world space, can be behind some overlays)"
    },
    default: "interfacePrimary"
  });

  game.settings.registerMenu(moduleId, "shaderMenu", {
    name: "Shader Settings",
    label: "Configure",
    hint: "Shader-specific settings.",
    icon: "fas fa-atom",
    type: ShaderSettingsMenu,
    restricted: true
  });

  game.settings.registerMenu(moduleId, "sparksMenu", {
    name: "Sparks Settings",
    label: "Configure",
    hint: "Configure playSparksAtToken defaults.",
    icon: "fas fa-fire",
    type: SparksSettingsMenu,
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
    hint: "Where to render shader effects. Use token to attach to the token itself.",
    scope: "world",
    config: false,
    type: String,
    choices: {
      inherit: "inherit from FX layer",
      token: "token (attached to token)",
      interfacePrimary: "interfacePrimary (above tokens, world space)",
      interface: "interface (overlay, not world space)",
      effects: "effects (world space, can be behind some overlays)"
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
    hint: "Visualize shader UVs or base mask for alignment debugging.",
    scope: "client",
    config: false,
    type: String,
    choices: {
      off: "off",
      uv: "UV gradient",
      mask: "radial mask alpha"
    },
    default: "off"
  });

  game.settings.register(moduleId, "count", {
    name: "Particle count",
    hint: "Base number of particles spawned per burst (before client multiplier).",
    scope: "world",
    config: false,
    type: Number,
    default: 180,
    range: { min: 10, max: 500, step: 10 }
  });

  game.settings.register(moduleId, "lifeMin", {
    name: "Particle lifetime min (s)",
    scope: "world",
    config: false,
    type: Number,
    default: 0.6,
    range: { min: 0.1, max: 5.0, step: 0.1 }
  });

  game.settings.register(moduleId, "lifeMax", {
    name: "Particle lifetime max (s)",
    scope: "world",
    config: false,
    type: Number,
    default: 1.8,
    range: { min: 0.1, max: 6.0, step: 0.1 }
  });

  game.settings.register(moduleId, "speedMin", {
    name: "Particle speed min",
    scope: "world",
    config: false,
    type: Number,
    default: 120,
    range: { min: 0, max: 2000, step: 10 }
  });

  game.settings.register(moduleId, "speedMax", {
    name: "Particle speed max",
    scope: "world",
    config: false,
    type: Number,
    default: 520,
    range: { min: 0, max: 3000, step: 10 }
  });

  game.settings.register(moduleId, "startAtEdge", {
    name: "Start at token edge",
    hint: "If enabled, particles begin near token edge rather than center.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(moduleId, "edgeFactor", {
    name: "Edge factor",
    hint: "Multiplier of token pixel size used to estimate start radius when Start at token edge is enabled.",
    scope: "world",
    config: false,
    type: Number,
    default: 0.40,
    range: { min: 0.05, max: 1.5, step: 0.05 }
  });

  game.settings.register(moduleId, "radiusMin", {
    name: "Core radius min",
    scope: "world",
    config: false,
    type: Number,
    default: 3,
    range: { min: 1, max: 20, step: 1 }
  });

  game.settings.register(moduleId, "radiusMax", {
    name: "Core radius max",
    scope: "world",
    config: false,
    type: Number,
    default: 6,
    range: { min: 1, max: 30, step: 1 }
  });

  game.settings.register(moduleId, "colorA", {
    name: "Color A (hex)",
    hint: "Start color (orange). Example: FF B1 4A",
    scope: "world",
    config: false,
    type: String,
    default: "FFB14A"
  });

  game.settings.register(moduleId, "colorB", {
    name: "Color B (hex)",
    hint: "End color (red). Example: FF 2A 2A",
    scope: "world",
    config: false,
    type: String,
    default: "FF2A2A"
  });

  game.settings.register(moduleId, "useBloom", {
    name: "Use bloom (if available)",
    hint: "Uses PIXI BloomFilter if present. Can look great but may cost FPS on some machines.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(moduleId, "bloomStrength", {
    name: "Bloom strength",
    scope: "world",
    config: false,
    type: Number,
    default: 1.0,
    range: { min: 0, max: 3.0, step: 0.1 }
  });

  game.settings.register(moduleId, "bloomBlur", {
    name: "Bloom blur",
    scope: "world",
    config: false,
    type: Number,
    default: 6,
    range: { min: 0, max: 20, step: 1 }
  });

  game.settings.register(moduleId, "glowScale", {
  name: "Glow scale",
  hint: "Multiplier for the soft glow sprite size (relative to the core radius).",
  scope: "world",
  config: false,
  type: Number,
  default: 3.2,
  range: { min: 0.5, max: 10.0, step: 0.1 }
});

game.settings.register(moduleId, "glowAlpha", {
  name: "Glow alpha",
  hint: "Opacity of the soft glow (0 = off).",
  scope: "world",
  config: false,
  type: Number,
  default: 0.18,
  range: { min: 0.0, max: 1.0, step: 0.01 }
});

game.settings.register(moduleId, "outlineWidth", {
  name: "Outline width",
  hint: "Stroke width for the hot core outline (helps visibility).",
  scope: "world",
  config: false,
  type: Number,
  default: 2,
  range: { min: 0, max: 10, step: 1 }
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

  // Client (each player can reduce load locally)
  game.settings.register(moduleId, "clientMultiplier", {
    name: "Client particle multiplier",
    hint: "Scales particle count locally on this client only. 1.0 = full, 0.5 = half, 0.25 = quarter.",
    scope: "client",
    config: true,
    type: Number,
    default: 1.0,
    range: { min: 0.1, max: 1.0, step: 0.05 }
  });

  game.settings.register(moduleId, "clientDisableBloom", {
    name: "Disable bloom on this client",
    hint: "For low-end GPUs, disable bloom locally even if world setting enables it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
}

export function getWorldCfg(moduleId) {
  const toHex = (s) => {
    const clean = String(s ?? "").replace(/^0x/i, "").replace(/[^0-9a-f]/gi, "");
    return clean.length ? clean : "FFFFFF";
  };

  const colorA = parseInt(toHex(game.settings.get(moduleId, "colorA")), 16);
  const colorB = parseInt(toHex(game.settings.get(moduleId, "colorB")), 16);

  return {
    layer: game.settings.get(moduleId, "layer"),
    count: game.settings.get(moduleId, "count"),
    lifeMin: game.settings.get(moduleId, "lifeMin"),
    lifeMax: game.settings.get(moduleId, "lifeMax"),
    speedMin: game.settings.get(moduleId, "speedMin"),
    speedMax: game.settings.get(moduleId, "speedMax"),
    startAtEdge: game.settings.get(moduleId, "startAtEdge"),
    edgeFactor: game.settings.get(moduleId, "edgeFactor"),
    radiusMin: game.settings.get(moduleId, "radiusMin"),
    radiusMax: game.settings.get(moduleId, "radiusMax"),
    colorA,
    colorB,
    useBloom: game.settings.get(moduleId, "useBloom"),
    bloomStrength: game.settings.get(moduleId, "bloomStrength"),
    bloomBlur: game.settings.get(moduleId, "bloomBlur"),
    glowScale: game.settings.get(moduleId, "glowScale"),
    glowAlpha: game.settings.get(moduleId, "glowAlpha"),
    outlineWidth: game.settings.get(moduleId, "outlineWidth"),
    shaderAlpha: game.settings.get(moduleId, "shaderAlpha"),
    shaderIntensity: game.settings.get(moduleId, "shaderIntensity"),
    shaderSpeed: game.settings.get(moduleId, "shaderSpeed"),
    shaderScale: game.settings.get(moduleId, "shaderScale"),
    shaderScaleX: game.settings.get(moduleId, "shaderScaleX"),
    shaderScaleY: game.settings.get(moduleId, "shaderScaleY"),
    shaderRadiusUnits: game.settings.get(moduleId, "shaderRadiusUnits"),
    shaderPreset: game.settings.get(moduleId, "shaderPreset"),
    shaderGradientFadeStart: game.settings.get(moduleId, "shaderGradientFadeStart"),
    shaderFalloff: game.settings.get(moduleId, "shaderFalloff"),
    shaderDensity: game.settings.get(moduleId, "shaderDensity"),
    shaderFlow: game.settings.get(moduleId, "shaderFlow"),
    shaderFlowSpeed: game.settings.get(moduleId, "shaderFlowSpeed"),
    shaderFlowTurbulence: game.settings.get(moduleId, "shaderFlowTurbulence"),
    shaderColorA: game.settings.get(moduleId, "shaderColorA"),
    shaderColorB: game.settings.get(moduleId, "shaderColorB"),
    shaderDisplayTimeMs: game.settings.get(moduleId, "shaderDisplayTimeMs"),
    shaderEaseInMs: game.settings.get(moduleId, "shaderEaseInMs"),
    shaderEaseOutMs: game.settings.get(moduleId, "shaderEaseOutMs")
    };
}


export function getClientCfg(moduleId) {
  return {
    mult: game.settings.get(moduleId, "clientMultiplier"),
    disableBloom: game.settings.get(moduleId, "clientDisableBloom")
  };
}

