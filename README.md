# Indy FX

Indy FX adds animated fragment shader effects to Foundry VTT tokens/tiles/templates and regions. Import easilly from [shadertoy](https://shadertoy.com/), edit and configure - then drag/drop the shaders onto tokens/tiles/templates or assign as lights. Extensive API provided.

https://github.com/user-attachments/assets/1e7c158e-9e5c-4d2e-bc8e-319638b709d5

<img width="1024" height="449" alt="Screenshot 2026-02-18 182548" src="https://github.com/user-attachments/assets/3a953f45-840c-4a7a-858f-1230d95b37b1" />

<img width="1351" height="1024" alt="image" src="https://github.com/user-attachments/assets/e174e564-509f-426e-b4b9-65c5b96a4cd6" />

This file is the GM/player usage guide.
- For macro/API details, see [README_API.md](./README_API.md).
- For settings details, see [README_settings.md](./README_settings.md)

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

## Adding a Shader to a Token (or Tile)
- Shaders can be scaled to fit a token - you can either edit an existing shader or right click one and duplicate then edit the copy.

1. Double click the shader to open the editor. 
2. Select "Scale to Token".
3. Select "Rotate with Token" if you want.
4. Usually you will want:
    Capture Scale: 1
    Capture Rotation 0
5. Select a suitable alpha (transparency) value for your effect if it doesn't provide it's own transparency.
6. (Ensure you set the Layer how you want it - normally Inherit from FX layer, unless you want to draw beneath the token).

If you save that and drag/drop on token it will be the same size..
You can then right click it in library and create token macro - this will create a macro in IndyFX folder that will add the effect to selected token(s) with your currently saved settings.

>[!NOTE]  
>To remove/disable/edit the shader on the token you can access it through token hud or via a macro (there is a macro in IndyFX compendium for this "ShaderOffSelectedTiles")

You can go 1 better if you have tokens with transparency you can make the shader only draw on the filled in parts of the token. 
This involves setting a shader channel to capture the token/tile image - and then using the alpha from that capture as the final alpha of the shader; luckily there is a button that will set that up for you..

## Circular Tokens (or Tokens with Transparency)

1. In Shader Editor - click Inject Token Alpha
2. Save the shader
   
Now when you apply to a token only the non-transparent will be filled.

>[!TIP]  
>For a more complex example - applying a shader to multiple targets hit by Scorching Ray with Midi-Qol/Cauldron of Plentiful Resources please see "Flame on Scorching Ray (CPR)" in Compendium 

## Main Workflows
### Shader Library
- Search/filter imported shaders by name or label.
- Hover a card to animate preview.
- Double-click a card to open full shader editor.
- Right-click a card for: `Add to Selected`, `Create Macro (Tokens/Tiles/Templates)`, `Duplicate`, `Delete`.
- Drag/drop a card onto a token/tile/template to apply.
- Import/Export library from the library window.
- If no imported shaders exist, Indy FX can prompt to import bundled examples from `scripts/shaders.json`.
- Additional import-ready example: `scripts/examples/river-heightmap-flow.json`
  (raw GLSL source is in `scripts/examples/river-heightmap-flow.glsl`).

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
- `sceneCaptureRaw`
- `image` (image/video path)
- `buffer` (ShaderToy-style buffer source)
- `tokenTileImage` (placeable image capture)

Notes:
- `tokenTileImage` is placeable-target specific and not suitable for region usage.
- `sceneCapture` captures the composited stage; `sceneCaptureRaw` captures a lower scene container before higher-level stage compositing (it falls back to the primary scene container when the effect lives on an interface layer).
- Preview backgrounds used for scene/placeable capture channels are configurable in module settings.
- `const`/`#define` variables are exposed in Edit Variables.
- Custom `uniform` variables are also exposed when annotated, e.g. `uniform float uFoam; // @editable 0.2`.
- You can prioritize display order with `@order` on `uniform`, `const`, and `#define`, e.g.
  `uniform float uFoam; // @editable 0.2 @order 1` or `const float WAVE = 0.5; // @order 2`.
  In Edit Variables, entries with `@order` are shown first by ascending order value;
  entries without `@order` are listed alphabetically after them.
- You can add per-variable tooltips with `@tip`, e.g.
  `uniform float uFoam; // @editable 0.2 @tip "Shoreline foam density"` or
  `#define WAVE_SPEED 1.2 // @tip "Controls small-wave drift speed"`.
- `iMouse` is opt-in for live mouse input. Add `#define EnableMouse` in shader source if you want
  the real ShaderToy-style mouse uniform injected and updated. Without that define, the adapter still
  provides `iMouse`, but as a constant zero value (`vec4(0.0)`) for compatibility with shaders that
  reference it but do not need live mouse input.
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
- Confirm that shader doesnt have 0 alpha explicitly set on output (try adding "fragColor.a = 1.;" at end) 
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
- API/macros/options: [README_API.md](./README_API.md)
- Shader editor setting guide: [README_settings.md](./README_settings.md)
- Licensing/attributions: [license.md](./license.md)
