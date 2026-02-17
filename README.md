# Indy FX

Indy FX adds animated fragment shader effects to Foundry VTT tokens/tiles/templates and regions. Import easilly from [shadertoy](https://shadertoy.com/), edit and configure - then drag/drop the shaders onto tokens/tiles/templates or assign as lights. Extensive API provided.

<img width="1351" height="1024" alt="image" src="https://github.com/user-attachments/assets/e174e564-509f-426e-b4b9-65c5b96a4cd6" />

This file is the GM/player usage guide.
For macro/API details, see `README_API.md`.

## Requirements
- Foundry VTT v13+
- Module id: `indy-fx`

## Quick Start
1. Enable the module.
3. Open **Shader Library** - from Scene Controls (token/tile/template view).
4. Import a shader (or bundled examples) from shadertoy - click on Import Shadertoy JSON and follow instruction.
5. Apply the shader to tokens, tiles, templates, or regions.
6. Edit shaders from button on token/tile/template.
7. You can also apply shaders to region via indyFX region behaviour.

## Main Workflows
### Shader Library
- Search/filter imported shaders by name or label.
- Hover a card to animate preview.
- Double-click a card to open full shader editor.
- Right-click a card for: `Add to Selected`, `Create Macro (Tokens/Tiles/Templates)`, `Duplicate`, `Delete`.
- Drag/drop a card onto a token/tile/template to apply.
- Import/Export library from the library window.
- If no imported shaders exist, Indy FX can prompt to import bundled examples from `scripts/shaders.json`.

### Apply to Tokens/Tiles/Templates
- Drag/drop from Shader Library.
- Or open placeable config and use the **indyFX** section/menu.
- Or use macros/API (`game.indyFX...`).

Token/Tile convenience:
- If a token/tile/template has Indy FX, its HUD includes an **Edit** button that opens the shader editor for that instance.

### Apply to Regions
- Add Region Behavior type **indyFX**.
- Configure shader/options in behavior config.
- Multiple region effects are supported on the same region.

### Use Imported Shaders as Light Animations
1. Open an imported shader in the full editor.
2. Enable **Convert to Light Source**.
3. Configure light options:
- **Use Illumination Shader**
- **Use Background Shader**
- **Light Falloff**: `None`, `Use Bright/Dim`, `Linear`, `Exponential`
- **Light Coloration Intensity** (default `1`)
- **Light Illumination Intensity** (default `1`)
- **Background Glow** (default `0`)
4. Save the shader.
5. In Ambient Light config, choose the animation `Indy FX: <Shader Label>`.

Notes:
- Light animation registrations are synced at startup and when the shader library changes.
- For light usage, placeable capture channel modes are remapped to scene capture where needed.

## Channel Modes
Imported shader channels (`iChannel0..iChannel3`) support:
- `none` (black)
- `white`
- `noiseRgb`
- `noiseBw`
- `sceneCapture`
- `image` (image/video path)
- `buffer` (ShaderToy-style buffer source)
- `tokenTileImage` (placeable image capture)

Notes:
- `tokenTileImage` is placeable-target specific and not suitable for region usage.
- Preview backgrounds used for scene/placeable capture channels are configurable in module settings.
- Const/#Define variables in the shader will be exposed in Edit Variables dialog
- Look at how the example shaders are set up with regard to filling in tokens/tiles and respecting alpha/rotation etc.
- The majority of shadertoy shaders should import and compile OK - check console log for shader compile issues.

## Persistence
- Token/Tile/Template effects persist when `displayTimeMs = 0`.
- Timed effects (`displayTimeMs > 0`) do not persist.
- Persistent region effects are behavior-based (`indyFX` Region Behaviors).

## Broadcast vs Local
- Most UI actions and generated macros use broadcast methods.
- GM-only broadcasting can be enabled in settings.
- Local API methods are still available for client-side use.

## Performance Tips
- Prefer lighter shaders when many effects are active.
- Reduce/disable bloom if needed.
- Keep capture scale modest.
- Disable debug logging unless troubleshooting.

## Troubleshooting
### Effect not visible
- Confirm shader is enabled for that target.
- Check `alpha`, `intensity`, `layer`, and mask settings.
- Confirm selected channel modes are valid for that target type.
- Confirm that shader doesnt have 0 alpha explicitly set on output. 
- If using light conversion, confirm **Convert to Light Source** is enabled and the light animation is selected on the light.
- For converted lights, verify `Light Coloration Intensity` / `Light Illumination Intensity` are non-zero.

### Wrong preview output
- Verify channel mode/path/source assignments.
- For capture channels, verify preview background settings.
- Thumbnail updates are asynchronous; if debug logging is enabled, check `shader save timing` and `thumbnail regenerate encoded` logs.
- For light background behavior, Foundry coloration technique can affect apparent output. If background contribution looks missing, compare **Legacy Coloration** vs **Adaptive Luminance**.

### Shader compiles in ShaderToy but fails in Foundry
- Some ShaderToy code needs adaptation for Foundry/PIXI GLSL.
- Common issues include dynamic loop bounds, GLSL ES 3-only features, and symbol collisions (`PI`, `resolution`, etc.).

### Reload/restore issues
- Persistent effects require `displayTimeMs = 0`.
- Region persistence requires the `indyFX` behavior to be present.

## Related Docs
- API/macros/options: `README_API.md`
