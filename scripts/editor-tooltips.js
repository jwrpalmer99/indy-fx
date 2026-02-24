const TOOLTIP_BY_KEY = Object.freeze({
  enabled: "Enable or disable this effect instance without deleting its settings.",
  shaderId: "Choose which shader preset runs for this effect.",
  editId: "Internal shader identifier used by indyFX.",
  editName: "Library name for this imported shader.",
  editLabel: "Display label shown in the shader library and menus.",
  layer: "Select which canvas layer this effect renders on.",
  useGradientMask: "Use a soft radial mask. Disable for a harder edge.",
  gradientMaskFadeStart: "Normalized radius (0..1) where gradient fading begins.",
  alpha: "Overall opacity multiplier for the shader output.",
  intensity: "Overall brightness multiplier for shader output.",
  speed: "Animation speed multiplier for time-based shaders.",
  scale: "Uniform shader UV/pattern scale.",
  scaleX: "Horizontal shader UV/pattern scale.",
  scaleY: "Vertical shader UV/pattern scale.",
  flipHorizontal: "Mirror shader output horizontally.",
  flipVertical: "Mirror shader output vertically.",
  shaderRotationDeg: "Rotate shader UV/pattern in degrees.",
  shapeDistanceUnits: "Effect size/range in scene distance units.",
  scaleToToken: "Scale the effect footprint relative to token/tile size.",
  tokenScaleMultiplier: "Extra multiplier applied when scaling to token/tile size.",
  scaleWithTokenTexture:
    "Include token/tile source texture dimensions when computing effect scale.",
  rotateWithToken: "Rotate the effect with token/tile rotation.",
  captureScale:
    "Scale of capture channels relative to effect area (scene/token captures).",
  captureRotationDeg: "Rotate captured channel textures in degrees.",
  captureFlipHorizontal: "Mirror captured channel textures horizontally.",
  captureFlipVertical: "Mirror captured channel textures vertically.",
  displayTimeMs: "Effect duration in milliseconds. 0 keeps it running until removed.",
  easeInMs: "Fade-in duration in milliseconds.",
  easeOutMs: "Fade-out duration in milliseconds.",
  bloom: "Enable bloom post-processing.",
  bloomStrength: "Bloom intensity multiplier.",
  bloomBlur: "Bloom blur radius.",
  bloomQuality: "Bloom quality/performance tradeoff.",
  preloadShader: "Compile and warm this shader early to reduce first-use hitching.",
  convertToLightSource:
    "Expose this imported shader as a Foundry light animation.",
  lightUseIlluminationShader: "Apply shader to light illumination pass.",
  lightUseBackgroundShader: "Apply shader to light background/coloration pass.",
  lightFalloffMode: "Controls how bright/dim light radii influence shader intensity.",
  lightBackgroundIntensity: "Intensity multiplier for converted light background pass.",
  backgroundGlow: "Additional background glow for converted light shaders.",
  lightColorationIntensity: "Intensity multiplier for light coloration pass.",
  lightIlluminationIntensity: "Intensity multiplier for light illumination pass.",
  channelMode: "Defines what this iChannel input receives.",
  channelPath: "Image/video path used by image-like channel modes.",
  channelSource: "Shader code used by buffer channel mode.",
  channelSamplerFilter: "Texture sampling filter for this channel.",
  channelSamplerWrap: "Texture wrap mode when UVs sample outside 0..1.",
  channelSamplerVflip: "Flip this channel vertically before sampling.",
  editChannelMode: "Defines what this iChannel input receives.",
  editChannelPath: "Image/video path used by image-like channel modes.",
  editChannelSource: "Shader code used by buffer channel mode.",
  editChannelSamplerFilter: "Texture sampling filter for this channel.",
  editChannelSamplerWrap: "Texture wrap mode when UVs sample outside 0..1.",
  editChannelSamplerVflip: "Flip this channel vertically before sampling.",
  autoAssignCapture:
    "Automatically assign capture channels for common imported shader patterns.",
  importUrl: "ShaderToy URL or shader ID for API import.",
  importApiKey: "ShaderToy API key used for URL import.",
  importName: "Name to store for this imported shader.",
  importLabel: "Optional display label for this imported shader.",
  importSource: "Paste raw shader source for manual import.",
  importShaderToyJson: "Paste full ShaderToy JSON payload to import.",
  editSource: "Editable GLSL source code for this imported shader.",
  instanceSource:
    "Per-instance source override used when editing shader variables locally.",
});

const TOOLTIP_BY_ACTION = Object.freeze({
  "inject-uniforms":
    "Convert selected const/#define values to editable uniform declarations.",
  "inject-token-alpha":
    "Inject helper code so shader output alpha follows captured token/tile alpha.",
  "edit-shader-variables":
    "Open editable constants/defines detected in the shader source.",
  "edit-instance-shader-variables":
    "Open editable constants for this specific shader instance.",
  "update-editor-preview": "Rebuild and refresh the live shader preview.",
  "capture-editor-thumbnail":
    "Capture the current preview frame as this shader's thumbnail.",
  "edit-channel": "Edit this channel's source/mode/sampler settings.",
  "pick-image": "Choose an image/video file for this channel.",
  "edit-channel-pick-image":
    "Choose an image/video file for this channel.",
});

function canonicalizeFieldName(rawName) {
  let name = String(rawName ?? "").trim();
  if (!name) return "";
  name = name.replace(/^(default_|builtin_)/, "");

  let match = name.match(
    /^channel[0-3](Mode|Path|Source|SamplerFilter|SamplerWrap|SamplerVflip)$/,
  );
  if (match) return `channel${match[1]}`;

  match = name.match(
    /^editChannel(Mode|Path|Source|SamplerFilter|SamplerWrap|SamplerVflip)$/,
  );
  if (match) return `editChannel${match[1]}`;

  return name;
}

function findTooltipByName(fieldName) {
  const direct = TOOLTIP_BY_KEY[fieldName];
  if (direct) return direct;
  const canonical = canonicalizeFieldName(fieldName);
  return TOOLTIP_BY_KEY[canonical] ?? "";
}

export function applyEditorSettingTooltips(root) {
  if (!(root instanceof Element)) return;
  for (const field of root.querySelectorAll("input[name], select[name], textarea[name]")) {
    if (!(field instanceof Element)) continue;
    if (
      field instanceof HTMLInputElement &&
      (field.type === "hidden" || field.type === "submit" || field.type === "button")
    ) {
      continue;
    }
    const fieldName = field.getAttribute("name");
    const tip = findTooltipByName(fieldName);
    if (!tip) continue;
    if (!field.getAttribute("title")) field.setAttribute("title", tip);
    const formGroup = field.closest(".form-group");
    const label = formGroup?.querySelector("label");
    if (label instanceof HTMLElement && !label.getAttribute("title")) {
      label.setAttribute("title", tip);
    }
  }

  for (const actionEl of root.querySelectorAll("[data-action]")) {
    if (!(actionEl instanceof HTMLElement)) continue;
    const action = String(actionEl.dataset.action ?? "").trim();
    if (!action) continue;
    const tip = TOOLTIP_BY_ACTION[action];
    if (!tip) continue;
    if (!actionEl.getAttribute("title")) actionEl.setAttribute("title", tip);
  }
}
