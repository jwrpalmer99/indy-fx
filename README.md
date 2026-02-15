# Indy FX

Indy FX adds shader effects for Foundry.

This README is for GM/player usage. For macro/API details, see `README_API.md`.

## Quick Start
1. Enable the module.
2. Open **Game Settings -> Module Settings -> Indy FX**.
3. Open **Shader Library** (from settings or scene controls).
4. Import/select a shader.
5. Apply it to a token, tile, template, or region.

## Main UI Areas
- **Shader Library**:
  - Browse imported shaders (sorted/searchable).
  - Hover cards to preview animation.
  - Double-click to edit shader source/options/channels.
  - Right-click for actions like duplicate/delete.
  - Drag-drop a shader card onto canvas placeables.
- **Module Settings**:
  - Global defaults for shader behavior.
  - Debug options (if needed).
- **Per-document config** (Token/Tile/Template):
  - Open the document config and use the **indyFX** section/menu.
  - Enable/disable, apply, save, remove, and edit effect settings.
- **Region Behavior**:
  - Add Region Behavior type **indyFX**.
  - Select shader and configure behavior settings.

## Applying Effects
### Tokens
- Use shader library drag-drop onto a token.
- Or open token config -> **indyFX** to edit/enable.

### Tiles
- Use shader library drag-drop onto a tile.
- Or open tile config -> **indyFX**.

### Measured Templates
- Use shader library drag-drop onto a template.
- Or open template config -> **indyFX**.

### Regions
- Add a Region Behavior of type **indyFX**.
- Configure shader and options there.

## Shader Channels (Practical)
In shader editor, each `iChannel` can be assigned to sources such as:
- none / black
- white
- RGB noise / B&W noise
- scene capture
- custom image/video
- buffer code
- token/tile image capture (for placeable-attached use cases)

Notes:
- Some channel modes are placeable-only (not valid for region/template usage).
- Scene capture and placeable capture behavior is affected by capture settings like scale/rotation/flip.

## Persistence
- Token/Tile/Template shaders with `displayTimeMs = 0` persist across reload.
- Timed effects (`displayTimeMs > 0`) do not persist.
- Region persistence is behavior-based through **indyFX** Region Behaviors.

## Broadcast Behavior
- GM can broadcast effects to all clients.
- If GM-only broadcasting is enabled, non-GM users cannot broadcast.

## Shader Import
You can import shaders via:
- ShaderToy API key flow
- ShaderToy JSON paste flow
- Manual shader source import

Use `README_API.md` for the detailed no-key JSON/devtools commands.

## Troubleshooting
- **Effect not visible**:
  - Verify shader is enabled and assigned to the right target.
  - Check layer setting (`inherit`, `token`, `interface`, etc.).
  - Check alpha/intensity and mask settings.
- **Wrong channel output**:
  - Verify each `iChannel` mode/path/source.
  - For buffers, verify dependencies and GLSL compatibility.
- **Performance spikes**:
  - Reduce heavy shaders, bloom, large capture sizes, and debug logging.
- **Compile errors**:
  - Some ShaderToy GLSL features require adaptation for Foundry/PIXI GLSL profile.

## Versioning Notes
- If you previously relied on older naming/docs, use current module name/API namespace:
  - Module: `indy-fx`
  - API: `game.indyFX`
