// Vertex shader for OutputVisionCorrectionFilter — identical to Foundry's
// AbstractBaseMaskFilter, which provides both vTextureCoord (for the input
// sprite UV) and vMaskTextureCoord (screen-space UV for vision/darkness textures).
const OUTPUT_VISION_VERT = `
  attribute vec2 aVertexPosition;
  uniform mat3 projectionMatrix;
  uniform vec2 screenDimensions;
  uniform vec4 inputSize;
  uniform vec4 outputFrame;
  varying vec2 vTextureCoord;
  varying vec2 vMaskTextureCoord;

  vec4 filterVertexPosition(void) {
    vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
    return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0., 1.);
  }
  vec2 filterTextureCoord(void) {
    return aVertexPosition * (outputFrame.zw * inputSize.zw);
  }
  // Map filter UV to normalised screen-space UV for screen-sized mask textures.
  vec2 filterMaskTextureCoord(in vec2 textureCoord) {
    return (textureCoord * inputSize.xy + outputFrame.xy) / screenDimensions;
  }
  void main() {
    vTextureCoord = filterTextureCoord();
    vMaskTextureCoord = filterMaskTextureCoord(vTextureCoord);
    gl_Position = filterVertexPosition();
  }
`;

// Fragment shader: post-processes the shader mesh output with vision correction.
// vTextureCoord samples the rendered effect; vMaskTextureCoord samples
// screen-aligned vision/darkness textures.
const OUTPUT_VISION_FRAG = `
  precision mediump float;
  varying vec2 vTextureCoord;
  varying vec2 vMaskTextureCoord;  // screen-space UV
  uniform sampler2D uSampler;          // the rendered shader effect
  uniform sampler2D visionTex;         // vision mask  (R = visibility 0..1)
  uniform sampler2D darknessLevelTex;  // darkness map (R = darkness  0=lit, 1=dark)
  uniform float saturation;            // token darkvision saturation (-1..0)
  uniform float applyVision;           // 1.0 = apply, 0.0 = passthrough

  void main() {
    vec4 color = texture2D(uSampler, vTextureCoord);
    if (applyVision > 0.5) {
      float visibility = texture2D(visionTex, vMaskTextureCoord).r;
      if (saturation < -0.001) {
        // darknessLevel 0=lit (no desaturation), 1=dark (full desaturation)
        float darkness = texture2D(darknessLevelTex, vMaskTextureCoord).r;
        float effectiveSat = saturation * darkness;
        if (effectiveSat < -0.001) {
          float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
          color.rgb = mix(vec3(luma), color.rgb, 1.0 + effectiveSat);
        }
      }
      // Black out areas outside the token's vision
      color.rgb *= visibility;
      color.a *= visibility;
    }
    gl_FragColor = color;
  }
`;

class OutputVisionCorrectionFilter extends PIXI.Filter {
  constructor() {
    super(OUTPUT_VISION_VERT, OUTPUT_VISION_FRAG, {
      screenDimensions: [1, 1],
      visionTex: PIXI.Texture.WHITE,        // fallback: fully visible
      darknessLevelTex: PIXI.Texture.EMPTY, // fallback: R=0 → no desaturation
      saturation: 0.0,
      applyVision: 0.0,
    });
  }

  // Called automatically by PIXI every frame before the filter renders.
  apply(filterManager, input, output, clear, currentState) {
    // Sync screen dimensions (required for vMaskTextureCoord to be correct).
    this.uniforms.screenDimensions = canvas.screenDimensions ?? [
      canvas?.app?.renderer?.width ?? 1,
      canvas?.app?.renderer?.height ?? 1,
    ];

    // Read vision state for the currently controlled token.
    const visionTex = canvas?.masks?.vision?.renderTexture ?? null;
    const darknessLevelTex = canvas?.effects?.illumination?.renderTexture ?? null;
    const sat = _getControlledTokenVisionSaturation();
    const hasVision = sat !== null && visionTex !== null;

    this.uniforms.visionTex = visionTex ?? PIXI.Texture.WHITE;
    this.uniforms.darknessLevelTex = darknessLevelTex ?? PIXI.Texture.EMPTY;
    this.uniforms.saturation = hasVision ? sat : 0.0;
    this.uniforms.applyVision = hasVision ? 1.0 : 0.0;

    filterManager.applyFilter(this, input, output, clear);
  }
}

function _getControlledTokenVisionSaturation() {
  try {
    const controlled = canvas?.tokens?.controlled ?? [];
    if (!controlled.length) return null;
    const token = controlled[0];
    const visionSource = token?.vision;
    // visionModeOverrides.saturation is the effective value used by lighting shaders
    const sat = visionSource?.visionModeOverrides?.saturation
      ?? visionSource?.data?.saturation
      ?? 0;
    return Math.max(-1, Math.min(0, Number(sat) || 0));
  } catch (_err) {
    return null;
  }
}

/**
 * Create an OutputVisionCorrectionFilter that can be added to a shader mesh's
 * filters array. It post-processes the rendered shader effect to match the
 * controlled token's vision: B&W where darkvision applies, invisible where
 * outside the vision range.
 * @returns {OutputVisionCorrectionFilter}
 */
export function createOutputVisionFilter() {
  return new OutputVisionCorrectionFilter();
}

function formatDebugTimestamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function multiplyMatrices(left, right, out = new PIXI.Matrix()) {
  const la = Number(left?.a ?? 1);
  const lb = Number(left?.b ?? 0);
  const lc = Number(left?.c ?? 0);
  const ld = Number(left?.d ?? 1);
  const ltx = Number(left?.tx ?? 0);
  const lty = Number(left?.ty ?? 0);
  const ra = Number(right?.a ?? 1);
  const rb = Number(right?.b ?? 0);
  const rc = Number(right?.c ?? 0);
  const rd = Number(right?.d ?? 1);
  const rtx = Number(right?.tx ?? 0);
  const rty = Number(right?.ty ?? 0);
  out.set(
    la * ra + lc * rb,
    lb * ra + ld * rb,
    la * rc + lc * rd,
    lb * rc + ld * rd,
    la * rtx + lc * rty + ltx,
    lb * rtx + ld * rty + lty,
  );
  return out;
}

export class SceneAreaChannel {
  constructor(sizeOrWidth = 512, heightOrOptions = null, maybeOptions = null) {
    let options = maybeOptions ?? {};
    let width = sizeOrWidth;
    let height = heightOrOptions;
    if (heightOrOptions && typeof heightOrOptions === "object" && !Array.isArray(heightOrOptions)) {
      options = heightOrOptions;
      height = sizeOrWidth;
    }
    const safeWidth = Math.max(1, Math.round(Number(width) || 512));
    const safeHeight = Math.max(1, Math.round(Number(height) || safeWidth));
    this.width = safeWidth;
    this.height = safeHeight;
    this.size = Math.max(safeWidth, safeHeight);
    this._matrix = new PIXI.Matrix();
    this._renderMatrix = new PIXI.Matrix();
    this._tmpLocal = new PIXI.Point();
    this._tmpGlobal = new PIXI.Point();
    this._lastDebugLogAt = 0;
    this._lastRenderErrorLogAt = 0;
    this._renderErrorCount = 0;
    this._renderRetryAfterMs = 0;
    const captureModeRaw = String(options?.captureMode ?? "sceneCapture").trim();
    this.captureMode = captureModeRaw === "sceneCaptureRaw"
      ? "sceneCaptureRaw"
      : captureModeRaw === "sceneCaptureVision"
        ? "sceneCaptureVision"
        : "sceneCapture";
    this.sourceContainer = options?.sourceContainer ?? null;
    this._rawSourceSprite = null;
    this.texture = PIXI.RenderTexture.create({
      width: safeWidth,
      height: safeHeight,
      resolution: 1,
      scaleMode: PIXI.SCALE_MODES.LINEAR
    });
  }

  update({
    centerWorld,
    radiusWorld,
    radiusWorldX,
    radiusWorldY,
    flipX = false,
    flipY = false,
    rotationDeg = 0,
    excludeDisplayObject = null,
    sourceContainer = null,
  } = {}) {
    if (!this.texture || !canvas?.app?.renderer || !canvas?.stage) return;
    if (!centerWorld) return;
    const nowMs = Date.now();
    if (nowMs < this._renderRetryAfterMs) return;

    const radiusX = Number.isFinite(radiusWorldX) ? radiusWorldX : radiusWorld;
    const radiusY = Number.isFinite(radiusWorldY) ? radiusWorldY : radiusWorld;
    if (!Number.isFinite(radiusX) || !Number.isFinite(radiusY) || radiusX <= 0 || radiusY <= 0) return;

    const stage = canvas.stage;
    let renderTarget = stage;
    let renderTransform = this._matrix;
    let rawSource = null;
    // Standard scene capture renders the composited stage in screen-space so
    // the current camera pan/zoom are reflected in the sampled area.
    this._tmpLocal.set(centerWorld.x, centerWorld.y);
    const center = stage.toGlobal(this._tmpLocal, this._tmpGlobal);
    const zoom = Math.max(0.0001, Math.abs(stage.worldTransform?.a ?? 1));
    const radiusRenderX = Math.max(2, radiusX * zoom);
    const radiusRenderY = Math.max(2, radiusY * zoom);
    const scaleXAbs = this.width / (radiusRenderX * 2);
    const scaleYAbs = this.height / (radiusRenderY * 2);
    const scaleX = (flipX ? -1 : 1) * scaleXAbs;
    const scaleY = (flipY ? -1 : 1) * scaleYAbs;
    const rotation = Number.isFinite(Number(rotationDeg))
      ? (Number(rotationDeg) * Math.PI) / 180
      : 0;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const a = cosR * scaleX;
    const b = sinR * scaleX;
    const c = -sinR * scaleY;
    const d = cosR * scaleY;
    const halfW = this.width * 0.5;
    const halfH = this.height * 0.5;
    const tx = halfW - (a * center.x + c * center.y);
    const ty = halfH - (b * center.x + d * center.y);

    this._matrix.set(
      a, b,
      c, d,
      tx,
      ty
    );

    // sceneCaptureRaw and sceneCaptureVision both capture from the primary render
    // texture in full colour. The vision-correction post-process for sceneCaptureVision
    // is applied to the shader mesh output via OutputVisionCorrectionFilter — not here.
    if (this.captureMode === "sceneCaptureRaw" || this.captureMode === "sceneCaptureVision") {
      const primaryTexture = canvas?.primary?.renderTexture ?? null;
      const primarySprite = canvas?.primary?.sprite ?? null;
      const primaryBase = primaryTexture?.baseTexture ?? null;
      const primaryValid =
        !!primaryTexture &&
        !!primarySprite &&
        (primaryBase?.valid !== false);
      if (primaryValid) {
        if (!this._rawSourceSprite) {
          this._rawSourceSprite = new PIXI.Sprite(primaryTexture);
        } else if (this._rawSourceSprite.texture !== primaryTexture) {
          this._rawSourceSprite.texture = primaryTexture;
        }
        const rawSprite = this._rawSourceSprite;
        rawSprite.position.copyFrom?.(primarySprite.position) ?? rawSprite.position.set(primarySprite.x ?? 0, primarySprite.y ?? 0);
        rawSprite.scale.copyFrom?.(primarySprite.scale) ?? rawSprite.scale.set(primarySprite.scale?.x ?? 1, primarySprite.scale?.y ?? 1);
        rawSprite.pivot.copyFrom?.(primarySprite.pivot) ?? rawSprite.pivot.set(primarySprite.pivot?.x ?? 0, primarySprite.pivot?.y ?? 0);
        rawSprite.skew.copyFrom?.(primarySprite.skew) ?? rawSprite.skew.set(primarySprite.skew?.x ?? 0, primarySprite.skew?.y ?? 0);
        if (rawSprite.anchor && primarySprite.anchor) {
          rawSprite.anchor.copyFrom?.(primarySprite.anchor) ?? rawSprite.anchor.set(primarySprite.anchor.x ?? 0, primarySprite.anchor.y ?? 0);
        }
        rawSprite.rotation = Number(primarySprite.rotation ?? 0);
        rawSprite.alpha = Number(primarySprite.alpha ?? 1);
        rawSprite.visible = true;
        rawSprite.renderable = true;
        rawSprite.blendMode = primarySprite.blendMode ?? PIXI.BLEND_MODES.NORMAL;
        const parentWorld = primarySprite.parent?.worldTransform ?? PIXI.Matrix.IDENTITY;
        renderTransform = multiplyMatrices(this._matrix, parentWorld, this._renderMatrix);
        renderTarget = rawSprite;
        rawSource = "primaryRenderTextureClone";
      }
    }

    this._logCaptureDebug({
      centerWorld,
      radiusX,
      radiusY,
      zoom,
      radiusScreenX: radiusRenderX,
      radiusScreenY: radiusRenderY,
      scaleX,
      scaleY,
      rotationDeg,
      flipX,
      flipY,
      captureMode: this.captureMode,
      renderTarget: renderTarget?.constructor?.name ?? null,
      rawSource,
    });

    let prevVisible = null;
    if (excludeDisplayObject) {
      prevVisible = excludeDisplayObject.visible;
      excludeDisplayObject.visible = false;
    }

    try {
      canvas.app.renderer.render(renderTarget, {
        renderTexture: this.texture,
        clear: true,
        transform: renderTransform
      });
      this._renderErrorCount = 0;
      this._renderRetryAfterMs = 0;
    } catch (err) {
      this._renderErrorCount = Math.min(this._renderErrorCount + 1, 8);
      const backoffMs = Math.min(5000, 250 * (2 ** (this._renderErrorCount - 1)));
      this._renderRetryAfterMs = Date.now() + backoffMs;
      if ((nowMs - this._lastRenderErrorLogAt) > 1000) {
        this._lastRenderErrorLogAt = nowMs;
        console.warn(
          `[${formatDebugTimestamp()}] indy-fx | scene capture render failed; retrying in ${backoffMs}ms`,
          {
            message: String(err?.message ?? err ?? "Unknown scene capture error"),
            width: this.width,
            height: this.height,
            renderErrorCount: this._renderErrorCount,
          },
        );
      }
    } finally {
      if (excludeDisplayObject) {
        excludeDisplayObject.visible = prevVisible;
      }
    }
  }

  destroy() {
    this._rawSourceSprite?.destroy?.({ texture: false, baseTexture: false });
    this._rawSourceSprite = null;
    this.texture?.destroy(true);
    this.texture = null;
  }

  _isDebugEnabled() {
    try {
      return game?.settings?.get?.("indy-fx", "shaderDebug") === true;
    } catch (_err) {
      return false;
    }
  }

  _logCaptureDebug(payload = {}) {
    if (!this._isDebugEnabled()) return;
    const now = Date.now();
    if (now - this._lastDebugLogAt < 1000) return;
    this._lastDebugLogAt = now;
    const worldAspect = payload.radiusY > 0 ? (payload.radiusX / payload.radiusY) : 0;
    const textureAspect = this.height > 0 ? (this.width / this.height) : 0;
    console.debug(`[${formatDebugTimestamp()}] indy-fx | scene capture update`, {
      textureResolution: [this.width, this.height],
      textureAspect,
      worldRadius: [payload.radiusX, payload.radiusY],
      worldAspect,
      centerWorld: payload.centerWorld ?? null,
      zoom: payload.zoom,
      screenRadius: [payload.radiusScreenX, payload.radiusScreenY],
      scale: [payload.scaleX, payload.scaleY],
      captureMode: payload.captureMode ?? this.captureMode,
      renderTarget: payload.renderTarget ?? null,
      rawSource: payload.rawSource ?? null,
      flipX: payload.flipX === true,
      flipY: payload.flipY === true,
      rotationDeg: Number.isFinite(Number(payload.rotationDeg))
        ? Number(payload.rotationDeg)
        : 0,
    });
  }
}
