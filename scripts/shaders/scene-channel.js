function formatDebugTimestamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
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
    this._tmpLocal = new PIXI.Point();
    this._tmpGlobal = new PIXI.Point();
    this._lastDebugLogAt = 0;
    this._lastRenderErrorLogAt = 0;
    this._renderErrorCount = 0;
    this._renderRetryAfterMs = 0;
    this.sourceContainer = options?.sourceContainer ?? null;
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
    // Render from stage for robust scene capture behavior.
    // Build capture transform in screen-space so camera pan/zoom are respected.
    this._tmpLocal.set(centerWorld.x, centerWorld.y);
    const center = stage.toGlobal(this._tmpLocal, this._tmpGlobal);
    const zoom = Math.max(0.0001, Math.abs(stage.worldTransform?.a ?? 1));
    const radiusScreenX = Math.max(2, radiusX * zoom);
    const radiusScreenY = Math.max(2, radiusY * zoom);
    const scaleXAbs = this.width / (radiusScreenX * 2);
    const scaleYAbs = this.height / (radiusScreenY * 2);
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

    this._logCaptureDebug({
      centerWorld,
      radiusX,
      radiusY,
      zoom,
      radiusScreenX,
      radiusScreenY,
      scaleX,
      scaleY,
      rotationDeg,
      flipX,
      flipY,
    });

    let prevVisible = null;
    if (excludeDisplayObject) {
      prevVisible = excludeDisplayObject.visible;
      excludeDisplayObject.visible = false;
    }

    try {
      canvas.app.renderer.render(stage, {
        renderTexture: this.texture,
        clear: true,
        transform: this._matrix
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
      flipX: payload.flipX === true,
      flipY: payload.flipY === true,
      rotationDeg: Number.isFinite(Number(payload.rotationDeg))
        ? Number(payload.rotationDeg)
        : 0,
    });
  }
}


