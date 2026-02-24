# Indy FX API Reference

Macro/API reference for module `indy-fx`.

## Access
```js
const fx = game.indyFX;
```

Additional utilities:
- `fx.debugDumpShaderContainers(payload?)`
- `fx.debugDumpShaderContainerParents(payload?)`

## Token FX
- `fx.shaderOn(tokenId, opts?)`
- `fx.shaderOff(tokenId)`
- `fx.shaderToggle(tokenId, opts?)`
- `fx.deleteAllTokenFX()` (broadcast)
- `fx.deleteAllTokenFXLocal()`
- `fx.broadcastDeleteAllTokenFX()`
- `fx.startShaderPlacement(tokenId?, opts?)`
- `fx.cancelShaderPlacement()`

Broadcast wrappers (payload or id overload):
- `fx.broadcastShaderOn({ tokenId, opts? })`
- `fx.broadcastShaderOn(tokenId, opts?)`
- `fx.broadcastShaderOff({ tokenId })`
- `fx.broadcastShaderOff(tokenId)`
- `fx.broadcastShaderToggle({ tokenId, opts? })`
- `fx.broadcastShaderToggle(tokenId, opts?)`

## Tile FX
- `fx.shaderOnTile(tileId?, opts?)`
- `fx.shaderOffTile(tileId?)`
- `fx.shaderToggleTile(tileId?, opts?)`
- `fx.deleteAllTileFX()` (broadcast)
- `fx.deleteAllTileFXLocal()`
- `fx.broadcastDeleteAllTileFX()`

Broadcast wrappers:
- `fx.broadcastShaderOnTile({ tileId?, opts? })`
- `fx.broadcastShaderOnTile(tileId?, opts?)`
- `fx.broadcastShaderOffTile({ tileId? })`
- `fx.broadcastShaderOffTile(tileId?)`
- `fx.broadcastShaderToggleTile({ tileId?, opts? })`
- `fx.broadcastShaderToggleTile(tileId?, opts?)`

If `tileId` is omitted, Indy FX uses the most recently added tile in the current scene.

## Template FX
- `fx.shaderOnTemplate(templateId?, opts?)`
- `fx.shaderOffTemplate(templateId?)`
- `fx.shaderToggleTemplate(templateId?, opts?)`
- `fx.deleteAllTemplateFX()` (broadcast)
- `fx.deleteAllTemplateFXLocal()`
- `fx.broadcastDeleteAllTemplateFX()`

Broadcast wrappers:
- `fx.broadcastShaderOnTemplate({ templateId?, opts? })`
- `fx.broadcastShaderOnTemplate(templateId?, opts?)`
- `fx.broadcastShaderOffTemplate({ templateId? })`
- `fx.broadcastShaderOffTemplate(templateId?)`
- `fx.broadcastShaderToggleTemplate({ templateId?, opts? })`
- `fx.broadcastShaderToggleTemplate(templateId?, opts?)`

If `templateId` is omitted, Indy FX uses the most recently added template in the current scene.

## Region FX
- `fx.shaderOnRegion(regionId?, opts?)`
- `fx.shaderOffRegion(regionId?)`
- `fx.shaderOffRegionBehavior(regionId?, behaviorId, options?)`
- `fx.shaderToggleRegion(regionId?, opts?)`

Broadcast wrappers:
- `fx.broadcastShaderOnRegion({ regionId?, opts? })`
- `fx.broadcastShaderOnRegion(regionId?, opts?)`
- `fx.broadcastShaderOffRegion({ regionId? })`
- `fx.broadcastShaderOffRegion(regionId?)`
- `fx.broadcastShaderOffRegionBehavior({ regionId?, behaviorId })`
- `fx.broadcastShaderOffRegionBehavior(regionId?, behaviorId)`
- `fx.broadcastShaderToggleRegion({ regionId?, opts? })`
- `fx.broadcastShaderToggleRegion(regionId?, opts?)`

If `regionId` is omitted, Indy FX uses the most recently added region in the current scene.

Region notes:
- Multiple effects per region are supported.
- Persistent region FX uses Region Behaviors (`indyFX`) when `displayTimeMs = 0`.

## Shader Library API
- `fx.shaders.list()`
- `fx.shaders.choices()`
- `fx.shaders.importShaderToy(payload)`
- `fx.shaders.importShaderToyUrl(payload)`
- `fx.shaders.importShaderToyJson(payload)`
- `fx.shaders.updateImportedShader(shaderId, payload)`
- `fx.shaders.updateImportedChannels(shaderId, payload)`
- `fx.shaders.duplicateImported(shaderId, payload?)`
- `fx.shaders.regenerateThumbnail(shaderId, payload?)`
- `fx.shaders.removeImported(shaderId)`

## Shader Options (`opts`)
| Option | Type | Notes |
|---|---|---|
| `shaderId` | string | Built-in or imported shader id. |
| `layer` | `inherit \| interfacePrimary \| belowTiles \| belowTokens \| drawings` | Render layer override. |
| `elevation` | number | Optional draw elevation override. `belowTiles` defaults to `-1`. Alias: `shaderElevation`. |
| `shape` | `circle \| cone \| line \| rectangle` | Mask shape. |
| `shapeDirectionDeg` | number | Direction for cone/line/rectangle. |
| `shapeDistanceUnits` | number/string | Shape distance in scene units. Alias: `distance`. |
| `coneAngleDeg` | number | Cone angle in degrees. |
| `lineWidthUnits` | number/string | Line width in scene units. |
| `useGradientMask` | boolean | Soft gradient mask; false = hard edge clip. |
| `gradientMaskFadeStart` | number | Fade start (0..1). |
| `alpha` | number | Global alpha multiplier. |
| `intensity` | number | Shader intensity multiplier. |
| `speed` | number | Time scale multiplier. |
| `scale` | number | Base shader scale. |
| `scaleX` | number | Extra horizontal multiplier. |
| `scaleY` | number | Extra vertical multiplier. |
| `shaderRotationDeg` | number | Shader UV rotation in degrees. |
| `flipHorizontal` | boolean | Horizontal UV flip. |
| `flipVertical` | boolean | Vertical UV flip. |
| `radiusUnits` | number/string | Backward-compat fallback key. |
| `scaleToToken` | boolean | Scale effect area to token logic. |
| `tokenScaleMultiplier` | number | Multiplier when token scaling logic is used. |
| `scaleWithTokenTexture` | boolean | Include token texture scale in size logic. |
| `rotateWithToken` | boolean | Rotate shader with token rotation logic. |
| `captureScale` | number | Capture region scale for capture channels. |
| `captureRotationDeg` | number | Rotation applied to capture texture. |
| `captureFlipHorizontal` | boolean | Flip capture horizontally. |
| `captureFlipVertical` | boolean | Flip capture vertically. |
| `displayTimeMs` | number | `0` = persistent, `>0` = timed effect. |
| `easeInMs` | number | Fade-in duration. |
| `easeOutMs` | number | Fade-out duration. |
| `bloom` | boolean | Enable bloom filter. |
| `bloomStrength` | number | Bloom strength. |
| `bloomBlur` | number | Bloom blur radius. |
| `bloomQuality` | number | Bloom quality. |
| `falloffPower` | number | Built-in shader radial falloff. |
| `density` | number | Built-in shader density. |
| `flowMode` | number/boolean | Built-in shader outward flow enable. |
| `flowSpeed` | number | Built-in flow speed. |
| `flowTurbulence` | number | Built-in flow turbulence. |
| `colorA` | string | Built-in color A (hex). |
| `colorB` | string | Built-in color B (hex). |
| `debugMode` | number | `0` off. Imported shaders: `1` UV, `2` base alpha, `3` source alpha, `4` post-policy alpha, `5` final alpha. |

## Option Aliases
- `distance -> shapeDistanceUnits`
- `shaderPreset -> shaderId`
- `shaderLayer -> layer`
- `shaderElevation -> elevation`
- `shaderGradientMask -> useGradientMask`
- `shaderScale -> scale`
- `shaderScaleX -> scaleX`
- `shaderScaleY -> scaleY`
- `shaderRadiusUnits -> radiusUnits`
- `rotationDeg -> shaderRotationDeg`
- `shaderDisplayTimeMs -> displayTimeMs`
- `shaderEaseInMs -> easeInMs`
- `shaderEaseOutMs -> easeOutMs`

Layer compatibility aliases are also accepted and normalized:
- `token -> interfacePrimary`
- `interface -> interfacePrimary`
- `effects -> belowTokens`
- `baseEffects -> belowTokens`
- `belowTiles -> belowTiles`
- `drawingsLayer -> drawings`

## Import Payloads
### `fx.shaders.importShaderToy(payload)`
| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Display name (also id base). |
| `label` | string | no | UI label override. |
| `source` | string | yes | Fragment shader source. |
| `channels` | object | no | `iChannel0..iChannel3` config. |
| `autoAssignCapture` | boolean | no | Auto channel defaults. |
| `defaults` | object | no | Imported shader default options. |

Channel node fields:
- `mode`: `auto | none | empty | white | noiseBw | noiseRgb | sceneCapture | tokenTileImage | image | buffer | bufferSelf`
- `path`: for `image`
- `source`: for `buffer`
- `channels`: nested config for buffer dependencies
- `size`: buffer render size (`64..2048`, default `512`)

### `fx.shaders.importShaderToyUrl(payload)`
| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | yes | ShaderToy URL or shader id. |
| `apiKey` | string | yes | ShaderToy API key. |
| `name` | string | no | Name override. |

### `fx.shaders.importShaderToyJson(payload)`
| Field | Type | Required | Notes |
|---|---|---|---|
| `json` | string/object | yes | ShaderToy JSON payload. |
| `name` | string | no | Name override. |

No-key helper (run on shadertoy.com dev console):
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

## Macro Snippets
### Apply shader to selected tokens (broadcast)
```js
const fx = game.indyFX;
const shaderId = "noise";
for (const t of (canvas.tokens?.controlled ?? [])) {
  await fx.broadcastShaderOff(t.id);
  await fx.broadcastShaderOn(t.id, { shaderId, displayTimeMs: 0 });
}
```

### Remove selected token/tile/template FX
```js
for (const t of (canvas.tokens?.controlled ?? [])) await game.indyFX.broadcastShaderOff(t.id);
for (const tile of (canvas.tiles?.controlled ?? [])) await game.indyFX.broadcastShaderOffTile(tile.id);
for (const tpl of (canvas.templates?.controlled ?? [])) await game.indyFX.broadcastShaderOffTemplate(tpl.id);
```

### Delete all active FX by target type
```js
await game.indyFX.deleteAllTokenFX();
await game.indyFX.deleteAllTileFX();
await game.indyFX.deleteAllTemplateFX();
```

### Delete all imported shaders
```js
const fx = game.indyFX;
const imported = fx.shaders.list().filter((s) => s?.type === "imported");
for (const shader of imported) await fx.shaders.removeImported(shader.id);
ui.notifications.info(`Removed ${imported.length} imported shader(s).`);
```

## Notes
- Imported shader ids are slugified from names (for example `fire`, `fire-2`), not `custom-*` prefixed.
- Broadcast behavior can be restricted by setting `gmOnlyBroadcast`.
- Persistent placeable effects require `displayTimeMs: 0`.
- Shader library persistence uses per-shader settings + index internally; import/export JSON format is unchanged.
