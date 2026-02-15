# Indy FX

Macro/API reference for `indy-fx`.

## API access
Use this in macros:

```js
const fx = game.indyFX;
```

## Method list

### Shader effects on token
- `fx.shaderOn(tokenId, opts?)`
- `fx.shaderOff(tokenId)`
- `fx.shaderToggle(tokenId, opts?)`
- `fx.deleteAllTokenFX()` (broadcast)
- `fx.deleteAllTokenFXLocal()`
- `fx.startShaderPlacement(tokenId?, opts?)`
- `fx.cancelShaderPlacement()`
- `fx.broadcastShaderOn({ tokenId, opts? })`
- `fx.broadcastShaderOff({ tokenId })`
- `fx.broadcastShaderToggle({ tokenId, opts? })`

### Shader effects on measured templates
- `fx.shaderOnTemplate(templateId?, opts?)`
- `fx.shaderOffTemplate(templateId?)`
- `fx.shaderToggleTemplate(templateId?, opts?)`
- `fx.deleteAllTemplateFX()` (broadcast)
- `fx.deleteAllTemplateFXLocal()`
- `fx.broadcastShaderOnTemplate({ templateId?, opts? })`
- `fx.broadcastShaderOffTemplate({ templateId? })`
- `fx.broadcastShaderToggleTemplate({ templateId?, opts? })`

If `templateId` is omitted, the most recently added measured template in the current scene is used.

### Shader effects on tiles
- `fx.shaderOnTile(tileId?, opts?)`
- `fx.shaderOffTile(tileId?)`
- `fx.shaderToggleTile(tileId?, opts?)`
- `fx.deleteAllTileFX()` (broadcast)
- `fx.deleteAllTileFXLocal()`
- `fx.broadcastShaderOnTile({ tileId?, opts? })`
- `fx.broadcastShaderOffTile({ tileId? })`
- `fx.broadcastShaderToggleTile({ tileId?, opts? })`

If `tileId` is omitted, the most recently added tile in the current scene is used.

Token/template/tile shader effects persist across reload when `displayTimeMs` is `0` (timed effects are not persisted).

### Shader effects on regions
- `fx.shaderOnRegion(regionId?, opts?)`
- `fx.shaderOffRegion(regionId?)`
- `fx.shaderOffRegionBehavior(regionId?, behaviorId)`
- `fx.shaderToggleRegion(regionId?, opts?)`
- `fx.broadcastShaderOnRegion({ regionId?, opts? })`
- `fx.broadcastShaderOffRegion({ regionId? })`
- `fx.broadcastShaderOffRegionBehavior({ regionId?, behaviorId })`
- `fx.broadcastShaderToggleRegion({ regionId?, opts? })`

If `regionId` is omitted, the most recently added region in the current scene is used.

`shaderOnRegion` can be called multiple times on the same region to layer multiple shader effects.

Persistent region shaders now use a custom **Region Behavior** type (`indyFX`) instead of module flags.
When `displayTimeMs` is `0`, each `shaderOnRegion` call adds a persistent `indyFX` Region Behavior on that Region (allowing multiple concurrent effects).
`shaderOffRegion(regionId)` removes all shader effects on that Region and clears its `indyFX` behaviors.
`shaderOffRegionBehavior(regionId, behaviorId)` removes one specific persistent behavior/effect.
`behaviorId` is the Region Behavior document id (from the Region's Behaviors list).

### Shader library helpers
- `fx.shaders.list()`
- `fx.shaders.choices()`
- `fx.shaders.importShaderToy(payload)`
- `fx.shaders.importShaderToyUrl(payload)`
- `fx.shaders.importShaderToyJson(payload)`
- `fx.shaders.updateImportedShader(shaderId, payload)`
- `fx.shaders.updateImportedChannels(shaderId, payload)`
- `fx.shaders.removeImported(shaderId)`

## Shader options (`opts`)
Used by `shaderOn`, `shaderToggle`, `startShaderPlacement`, and broadcast shader methods.

| Option | Type | Notes |
|---|---|---|
| `layer` | `"inherit" \| "token" \| "interfacePrimary" \| "interface" \| "effects"` | Render layer override. |
| `shaderId` | string | Shader ID (builtin or imported). |
| `shape` | `"circle" \| "cone" \| "line" \| "rectangle"` | Effect clip shape. |
| `shapeDirectionDeg` | number | Direction in degrees (used by `cone`, `line`, `rectangle`). |
| `shapeDistanceUnits` | number/string | Scene units. Circle radius, cone/line/rectangle length. Alias: `distance`. |
| `coneAngleDeg` | number | Cone angle in degrees. |
| `lineWidthUnits` | number/string | Line width in scene units. |
| `scale` | number | Base shader sampling/pattern scale multiplier (does not change covered area). |
| `scaleX` | number | Extra horizontal multiplier applied on top of `scale` (`1.0` = unchanged). |
| `scaleY` | number | Extra vertical multiplier applied on top of `scale` (`1.0` = unchanged). |
| `shaderRotationDeg` | number | Optional shader UV rotation in degrees. Defaults to `shapeDirectionDeg` for `cone`/`line`. |
| `shaderRotationRad` | number | Optional shader UV rotation in radians (overrides degrees). |
| `radiusUnits` | number/string | Base radius in scene units fallback. |
| `radiusFactor` | number | Fallback when `radiusUnits` not set. |
| `alpha` | number | Base opacity (0..1). |
| `intensity` | number | Shader output intensity multiplier. |
| `falloffPower` | number | Radial falloff. |
| `density` | number | Noise/detail density. |
| `flowMode` | number/boolean | `1`/`true` to enable flow. |
| `flowSpeed` | number | Flow speed. |
| `flowTurbulence` | number | Flow turbulence. |
| `captureScale` | number | Scene capture area scale for `sceneCapture` channels. |
| `displayTimeMs` | number | Total lifetime. `0` = persistent until off/toggle. |
| `easeInMs` | number | Fade-in duration in ms. |
| `easeOutMs` | number | Fade-out duration in ms. |
| `useGradientMask` | boolean | `true` soft radial mask, `false` hard clip at shape boundary. |
| `debugMode` | `0 \| 1 \| 2` | `0` off, `1` UV debug, `2` mask debug. |
| `speed` | number | Time scale passed to shaders. |
| `noiseOffset` | `[number, number]` | Optional noise offset vector. |
| `bloom` | boolean | Enable bloom filter (if available). |
| `bloomStrength` | number | Bloom strength. |
| `bloomBlur` | number | Bloom blur. |
| `bloomQuality` | number | Bloom quality. |

### Shader setting-style keys
These are accepted and mapped automatically:

- `shaderLayer -> layer`
- `shaderPreset -> shaderId`
- `shaderGradientMask -> useGradientMask`
- `shaderScale -> scale`
- `shaderScaleX -> scaleX`
- `shaderScaleY -> scaleY`
- `shaderRadiusUnits -> radiusUnits`
- `shaderFalloff -> falloffPower`
- `shaderDensity -> density`
- `shaderFlow -> flowMode`
- `shaderFlowSpeed -> flowSpeed`
- `shaderFlowTurbulence -> flowTurbulence`
- `shaderCaptureScale -> captureScale`
- `shaderDisplayTimeMs -> displayTimeMs`
- `shaderEaseInMs -> easeInMs`
- `shaderEaseOutMs -> easeOutMs`
- `shaderDebugMode -> debugMode` (`"off" | "uv" | "mask"` also supported)
- `shaderShape -> shape`
- `shaderShapeDirectionDeg -> shapeDirectionDeg`
- `shaderShapeDistanceUnits -> shapeDistanceUnits`
- `distance -> shapeDistanceUnits`
- `rotationDeg -> shaderRotationDeg`
- `shaderConeAngleDeg -> coneAngleDeg`
- `shaderLineWidthUnits -> lineWidthUnits`

## Shader import/update payloads

### `fx.shaders.importShaderToy(payload)`
`payload`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Display name. |
| `source` | string | yes | ShaderToy fragment source. |
| `autoAssignCapture` | boolean | no | Defaults referenced channels to scene capture. |
| `channels` | object | no | Per-channel overrides. |

`channels` supports keys `iChannel0..iChannel3` (or numeric `0..3`) with:

| Field | Type | Notes |
|---|---|---|
| `mode` | `"auto" \| "none" \| "empty" \| "white" \| "noiseBw" \| "noiseRgb" \| "sceneCapture" \| "image" \| "buffer"` | `noise` is accepted and treated as `noiseRgb`. |
| `path` | string | Used when `mode: "image"`. |
| `source` | string | Used when `mode: "buffer"` (ShaderToy Buffer code with `mainImage`). |
| `channels` | object | Optional nested `iChannel0..iChannel3` config for buffer inputs (enables buffer chains). |
| `size` | number | Optional buffer render size (clamped 64..2048, default 512). |

### `fx.shaders.importShaderToyUrl(payload)`
Imports from ShaderToy API by URL or shader ID, including multipass buffer dependencies.

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | yes | `https://www.shadertoy.com/view/<id>` or just `<id>`. |
| `apiKey` | string | yes | ShaderToy API key. |
| `name` | string | no | Optional display name override. |

Notes:
- URL import without key is blocked by browser CORS against ShaderToy.
- Recursive/self-referential buffer loops are skipped to avoid invalid dependency cycles.

### `fx.shaders.updateImportedShader(shaderId, payload)`
Updates imported shader metadata/source.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | no | New display name. |
| `source` | string | no | New ShaderToy fragment source (`mainImage`/`main`). |
| `autoAssignCapture` | boolean | no | Applied when source is updated and channels are rebuilt. |
| `channels` | object | no | Optional full channel overrides for rebuild. |

### `fx.shaders.updateImportedChannels(shaderId, payload)`
Updates only the channel configuration for an existing imported shader.

### `fx.shaders.removeImported(shaderId)`
Deletes imported shader by ID.

Example URL import:

```js
await game.indyFX.shaders.importShaderToyUrl({
  url: "https://www.shadertoy.com/view/llK3Dy",
  apiKey: "YOUR_SHADERTOY_API_KEY"
});
```

### `fx.shaders.importShaderToyJson(payload)`
No-key import by pasting ShaderToy JSON payload.

| Field | Type | Required | Notes |
|---|---|---|---|
| `json` | string \| object | yes | JSON containing `Shader`/`shader` and `renderpass` data. |
| `name` | string | no | Optional display name override. |

Notes:
- ShaderToy `Common` pass code is automatically prepended to imported `Image`/`Buffer` passes.

Example JSON import:

```js
await game.indyFX.shaders.importShaderToyJson({
  json: `{"Shader":{...}}`
});
```

#### How to get ShaderToy JSON

With API key (recommended):
1. Create/get a ShaderToy API key in your ShaderToy profile.
2. Fetch JSON for a shader ID:

```powershell
Invoke-RestMethod "https://www.shadertoy.com/api/v1/shaders/llK3Dy?key=YOUR_KEY" |
  ConvertTo-Json -Depth 100
```

No key (manual, from browser on shadertoy.com):
1. Open the shader page on `shadertoy.com`.
2. Open DevTools Console and run:

```js
copy(JSON.stringify(await fetch("/shadertoy", {
  method: "POST",
  headers: {"content-type": "application/x-www-form-urlencoded; charset=UTF-8"},
  body: (() => {
    const shaderId = location.pathname.match(/\/(?:view|embed)\/([A-Za-z0-9_-]+)/)?.[1];
    if (!shaderId) throw new Error("Could not detect shader id from URL.");
    return `s=${encodeURIComponent(JSON.stringify({ shaders: [shaderId] }))}&nt=1&nl=1&np=1`;
  })()
}).then(r => r.json())))
```

Then paste the clipboard contents into the module's **Import ShaderToy JSON (No Key)** field.

## Getting the correct imported shader ID
Imported labels in UI include `(Imported)`, but macros must use the actual ID.

```js
const shader = game.indyFX.shaders.list().find((s) => s.label === "flies");
game.indyFX.shaderOn(token.id, { shaderId: shader?.id });
```

IDs are usually like `custom-flies` or `custom-flies-2`.

## Macro examples

### Shader circle
```js
const t = canvas.tokens.controlled[0];
if (t) game.indyFX.shaderOn(t.id, {
  shape: "circle",
  shapeDistanceUnits: 20,
  shaderId: "noise"
});
```

### Shader rectangle
```js
const t = canvas.tokens.controlled[0];
if (t) game.indyFX.shaderOn(t.id, {
  shape: "rectangle",
  shapeDistanceUnits: 15,
  lineWidthUnits: 10,
  shapeDirectionDeg: 30
});
```

### Place a cone interactively
```js
const t = canvas.tokens.controlled[0];
if (t) game.indyFX.startShaderPlacement(t.id, {
  shape: "cone",
  coneAngleDeg: 60
});
```

### Toggle shader for selected token
```js
const t = canvas.tokens.controlled[0];
if (t) game.indyFX.shaderToggle(t.id);
```

### Attach shader to selected template
```js
const tpl = canvas.templates.controlled[0];
if (tpl) game.indyFX.shaderOnTemplate(tpl.id, { shaderId: "noise" });
```

### Attach shader to selected tile
```js
const tile = canvas.tiles?.controlled?.[0];
if (tile) game.indyFX.shaderOnTile(tile.id, { shaderId: "noise" });
```

### Attach shader to selected region
```js
const region = canvas.regions?.controlled?.[0];
if (region) game.indyFX.shaderOnRegion(region.id, { shaderId: "noise" });
```

### Broadcast template shader (GM)
```js
const tpl = canvas.templates.controlled[0];
if (tpl) game.indyFX.broadcastShaderOnTemplate({ templateId: tpl.id, opts: { shaderId: "noise" } });
```

### Broadcast tile shader (GM)
```js
const tile = canvas.tiles?.controlled?.[0];
if (tile) game.indyFX.broadcastShaderOnTile({ tileId: tile.id, opts: { shaderId: "noise" } });
```

### Broadcast region shader (GM)
```js
const region = canvas.regions?.controlled?.[0];
if (region) game.indyFX.broadcastShaderOnRegion({ regionId: region.id, opts: { shaderId: "noise" } });
```

### Remove shader from selected tokens (broadcast)
```js
for (const t of (canvas.tokens?.controlled ?? [])) {
  await game.indyFX.broadcastShaderOff({ tokenId: t.id });
}
```

### Remove shader from selected tiles (broadcast)
```js
for (const tile of (canvas.tiles?.controlled ?? [])) {
  await game.indyFX.broadcastShaderOffTile({ tileId: tile.id });
}
```

### Remove shader from selected templates (broadcast)
```js
for (const tpl of (canvas.templates?.controlled ?? [])) {
  await game.indyFX.broadcastShaderOffTemplate({ templateId: tpl.id });
}
```

### Remove shader from selected tokens (local only)
```js
for (const t of (canvas.tokens?.controlled ?? [])) {
  game.indyFX.shaderOff(t.id);
}
```

### Remove shader from selected tiles (local only)
```js
for (const tile of (canvas.tiles?.controlled ?? [])) {
  game.indyFX.shaderOffTile(tile.id);
}
```

### Remove shader from selected templates (local only)
```js
for (const tpl of (canvas.templates?.controlled ?? [])) {
  game.indyFX.shaderOffTemplate(tpl.id);
}
```

### Template shape mapping
- `circle` template -> `circle` shader mask
- `cone` template -> `cone` shader mask
- `ray` template -> `line` shader mask
- `rect` template -> `rectangle` shader mask

### Region shape support
- Region shaders currently support region shapes that resolve as `rectangle`, `ellipse/circle`, and `polygon`.
- Region shapes are grouped by contiguity using Foundry's region polygon tree when available (with bounds-based fallback).
- Each contiguous group gets one shader mesh from that group's bounding box.
- A composite clipping mask is built per contiguous group, matching that group's silhouette.
- Region hole shapes are subtracted from the mask, so shader does not render inside holes.
- Non-contiguous "islands" in the same Region render independently (separate scaling/capture areas).
- By default, `regionUniformScale: true` applies X/Y aspect compensation from each contiguous group's bounds so non-square groups do not stretch shader sampling.
- Region shader persistence is behavior-driven: add/edit one or more **indyFX** Region Behaviors (or call `shaderOnRegion` with `displayTimeMs: 0` to add one). It restores for GM and players on reload/scene view.
- Timed region effects (`displayTimeMs > 0`) are not persisted as Region Behaviors.
