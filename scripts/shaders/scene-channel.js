export class SceneAreaChannel {
  constructor(size = 512, { sourceContainer = null } = {}) {
    this.size = size;
    this._matrix = new PIXI.Matrix();
    this._tmpLocal = new PIXI.Point();
    this._tmpGlobal = new PIXI.Point();
    this.sourceContainer = sourceContainer;
    this.texture = PIXI.RenderTexture.create({
      width: size,
      height: size,
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
    const scaleXAbs = this.size / (radiusScreenX * 2);
    const scaleYAbs = this.size / (radiusScreenY * 2);
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
    const half = this.size * 0.5;
    const tx = half - (a * center.x + c * center.y);
    const ty = half - (b * center.x + d * center.y);

    this._matrix.set(
      a, b,
      c, d,
      tx,
      ty
    );

    let prevVisible = null;
    if (excludeDisplayObject) {
      prevVisible = excludeDisplayObject.visible;
      excludeDisplayObject.visible = false;
    }

    canvas.app.renderer.render(stage, {
      renderTexture: this.texture,
      clear: true,
      transform: this._matrix
    });

    if (excludeDisplayObject) {
      excludeDisplayObject.visible = prevVisible;
    }
  }

  destroy() {
    this.texture?.destroy(true);
    this.texture = null;
  }
}


