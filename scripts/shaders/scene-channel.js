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
    this.captureMode = String(options?.captureMode ?? "sceneCapture").trim() === "sceneCaptureRaw"
      ? "sceneCaptureRaw"
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

    if (this.captureMode === "sceneCaptureRaw") {
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


