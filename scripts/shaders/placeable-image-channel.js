function isFinitePositive(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(2, Math.round(n));
}

function pickPlaceable(targetType, targetId) {
  const id = String(targetId ?? "").trim();
  if (!id) return null;
  if (targetType === "token") return canvas?.tokens?.get?.(id) ?? null;
  if (targetType === "tile") return canvas?.tiles?.get?.(id) ?? null;
  return null;
}

function getPlaceableImageSrc(placeable, targetType) {
  if (!placeable) return "";
  if (targetType === "token") {
    return String(
      placeable?.document?.texture?.src ??
        placeable?.document?.img ??
        placeable?.texture?.baseTexture?.resource?.url ??
        "",
    ).trim();
  }
  if (targetType === "tile") {
    return String(
      placeable?.document?.texture?.src ??
        placeable?.document?.img ??
        placeable?.texture?.baseTexture?.resource?.url ??
        "",
    ).trim();
  }
  return "";
}
function usesIndyPlaceableFallbackTexture(path) {
  const src = String(path ?? "").trim();
  if (!src) return false;
  return /(?:^|[\\/])indyfx\.webp(?:$|[?#])/i.test(src);
}

function getPlaceableDrawProps(placeable, targetType, sourceW, sourceH) {
  const srcW = Math.max(1, Number(sourceW) || 1);
  const srcH = Math.max(1, Number(sourceH) || 1);
  const doc = placeable?.document ?? null;
  const textureData = doc?.texture ?? {};

  const displayW =
    targetType === "token"
      ? Number(placeable?.w ?? placeable?.width ?? srcW)
      : targetType === "tile"
        ? Number(
            placeable?.document?.width ??
              placeable?.w ??
              placeable?.width ??
              srcW,
          )
        : srcW;
  const displayH =
    targetType === "token"
      ? Number(placeable?.h ?? placeable?.height ?? srcH)
      : targetType === "tile"
        ? Number(
            placeable?.document?.height ??
              placeable?.h ??
              placeable?.height ??
              srcH,
          )
        : srcH;

  const scaleXRaw = Number(textureData?.scaleX ?? 1);
  const scaleYRaw = Number(textureData?.scaleY ?? 1);
  const scaleX = Number.isFinite(scaleXRaw) && scaleXRaw !== 0 ? scaleXRaw : 1;
  const scaleY = Number.isFinite(scaleYRaw) && scaleYRaw !== 0 ? scaleYRaw : 1;

  const rotationDeg = Number(doc?.rotation ?? placeable?.rotation ?? 0);
  const rotationRad = Number.isFinite(rotationDeg)
    ? (rotationDeg * Math.PI) / 180
    : 0;

  const width = Number.isFinite(displayW) && displayW > 0 ? displayW : srcW;
  const height = Number.isFinite(displayH) && displayH > 0 ? displayH : srcH;

  return {
    width,
    height,
    scaleX,
    scaleY,
    rotationRad,
  };
}

function isRelevantImageChange(changed) {
  if (!changed || typeof changed !== "object") return true;
  if (
    Object.prototype.hasOwnProperty.call(changed, "img") ||
    Object.prototype.hasOwnProperty.call(changed, "src") ||
    Object.prototype.hasOwnProperty.call(changed, "texture")
  ) {
    return true;
  }
  return false;
}

function hasRelevantRefreshFlags(flags) {
  if (!flags || typeof flags !== "object") return false;
  return (
    flags.refreshRotation === true ||
    flags.refreshSize === true ||
    flags.refreshMesh === true ||
    flags.refreshTransform === true ||
    flags.refreshShape === true ||
    flags.refreshState === true
  );
}

function isDebugLoggingEnabled(moduleId = "indy-fx") {
  try {
    return game?.settings?.get?.(String(moduleId ?? "indy-fx"), "shaderDebug") === true;
  } catch (_err) {
    return false;
  }
}

function debugLog(moduleId, message, payload = undefined) {
  if (!isDebugLoggingEnabled(moduleId)) return;
  if (payload === undefined) console.debug(`${moduleId} | ${message}`);
  else console.debug(`${moduleId} | ${message}`, payload);
}

const MISSING_SOURCE_RETRY_DELAY_MS = 250;
const MISSING_SOURCE_MAX_RETRIES = 80;
export class PlaceableImageChannel {
  static _tokenLiveInstances = new Map();
  static _tileLiveInstances = new Map();
  static _tokenPendingCaptureInstances = new Map();
  static _tilePendingCaptureInstances = new Map();
  static _tokenHook = null;
  static _tokenRefreshHook = null;
  static _tileHook = null;
  static _tileRefreshHook = null;
  static _tokenDrawHook = null;
  static _tileDrawHook = null;
  static _canvasReadyHook = null;

  static _refreshLiveMap(map, { force = true } = {}) {
    if (!(map instanceof Map)) return;
    for (const [id, bucket] of map.entries()) {
      if (!(bucket instanceof Set) || !bucket.size) {
        map.delete(id);
        continue;
      }
      for (const channel of Array.from(bucket)) {
        if (!channel || channel._destroyed) {
          bucket.delete(channel);
          continue;
        }
        channel.refresh({ force });
      }
      if (!bucket.size) map.delete(id);
    }
  }

  static refreshAllLiveInstances({ force = true } = {}) {
    this._refreshLiveMap(this._tokenLiveInstances, { force });
    this._refreshLiveMap(this._tileLiveInstances, { force });
  }

  static _refreshBucketForId(map, id, { force = true } = {}) {
    if (!(map instanceof Map)) return;
    const key = String(id ?? "").trim();
    if (!key) return;
    const bucket = map.get(key);
    if (!bucket || !bucket.size) return;
    for (const channel of Array.from(bucket)) {
      if (!channel || channel._destroyed) {
        bucket.delete(channel);
        continue;
      }
      channel.refresh({ force });
    }
    if (!bucket.size) map.delete(key);
  }

  static _mapHasAnyInstances(map) {
    return Array.from(map.values()).some((set) => set && set.size);
  }

  static _refreshDrawCaptureHooks() {
    const hasTokenPending = this._mapHasAnyInstances(
      this._tokenPendingCaptureInstances,
    );
    const hasTilePending = this._mapHasAnyInstances(
      this._tilePendingCaptureInstances,
    );

    if (hasTokenPending && !this._tokenDrawHook) {
      debugLog("indy-fx", "placeable-image-channel", {
        event: "install-drawToken-hook",
      });
      this._tokenDrawHook = Hooks.on("drawToken", (token) => {
        const id = String(token?.document?.id ?? token?.id ?? "").trim();
        if (!id) return;
        this._refreshBucketForId(this._tokenPendingCaptureInstances, id, {
          force: true,
        });
      });
    } else if (!hasTokenPending && this._tokenDrawHook) {
      Hooks.off("drawToken", this._tokenDrawHook);
      this._tokenDrawHook = null;
      debugLog("indy-fx", "placeable-image-channel", {
        event: "remove-drawToken-hook",
      });
    }

    if (hasTilePending && !this._tileDrawHook) {
      debugLog("indy-fx", "placeable-image-channel", {
        event: "install-drawTile-hook",
      });
      this._tileDrawHook = Hooks.on("drawTile", (tile) => {
        const id = String(tile?.document?.id ?? tile?.id ?? "").trim();
        if (!id) return;
        this._refreshBucketForId(this._tilePendingCaptureInstances, id, {
          force: true,
        });
      });
    } else if (!hasTilePending && this._tileDrawHook) {
      Hooks.off("drawTile", this._tileDrawHook);
      this._tileDrawHook = null;
      debugLog("indy-fx", "placeable-image-channel", {
        event: "remove-drawTile-hook",
      });
    }
  }

  static _ensureLiveUpdateHooks() {
    if (!this._tokenHook) {
      this._tokenHook = Hooks.on("updateToken", (doc, changed) => {
        if (!isRelevantImageChange(changed)) return;
        this._refreshBucketForId(this._tokenLiveInstances, doc?.id, { force: true });
      });
    }

    if (!this._tokenRefreshHook) {
      this._tokenRefreshHook = Hooks.on("refreshToken", (token, flags) => {
        if (!hasRelevantRefreshFlags(flags)) return;
        const id = String(token?.document?.id ?? token?.id ?? "").trim();
        if (!id) return;
        this._refreshBucketForId(this._tokenLiveInstances, id, { force: true });
      });
    }

    if (!this._tileHook) {
      this._tileHook = Hooks.on("updateTile", (doc, changed) => {
        if (!isRelevantImageChange(changed)) return;
        this._refreshBucketForId(this._tileLiveInstances, doc?.id, { force: true });
      });
    }

    if (!this._tileRefreshHook) {
      this._tileRefreshHook = Hooks.on("refreshTile", (tile, flags) => {
        if (!hasRelevantRefreshFlags(flags)) return;
        const id = String(tile?.document?.id ?? tile?.id ?? "").trim();
        if (!id) return;
        this._refreshBucketForId(this._tileLiveInstances, id, { force: true });
      });
    }

    this._refreshDrawCaptureHooks();

    if (!this._canvasReadyHook) {
      this._canvasReadyHook = Hooks.on("canvasReady", () => {
        // Rehydrate channels on scene reloads where placeables appear after construction.
        this.refreshAllLiveInstances({ force: true });
        setTimeout(() => this.refreshAllLiveInstances({ force: true }), 120);
        setTimeout(() => this.refreshAllLiveInstances({ force: true }), 500);
        setTimeout(() => this.refreshAllLiveInstances({ force: true }), 1200);
        setTimeout(() => this.refreshAllLiveInstances({ force: true }), 2500);
      });
    }
  }

  static _teardownLiveUpdateHooksIfUnused() {
    const hasTokenLive = Array.from(this._tokenLiveInstances.values()).some(
      (set) => set && set.size,
    );
    const hasTileLive = Array.from(this._tileLiveInstances.values()).some(
      (set) => set && set.size,
    );

    if (!hasTokenLive && this._tokenHook) {
      Hooks.off("updateToken", this._tokenHook);
      this._tokenHook = null;
      this._tokenLiveInstances.clear();
    }
    if (!hasTokenLive && this._tokenRefreshHook) {
      Hooks.off("refreshToken", this._tokenRefreshHook);
      this._tokenRefreshHook = null;
    }

    if (!hasTileLive && this._tileHook) {
      Hooks.off("updateTile", this._tileHook);
      this._tileHook = null;
      this._tileLiveInstances.clear();
    }
    if (!hasTileLive && this._tileRefreshHook) {
      Hooks.off("refreshTile", this._tileRefreshHook);
      this._tileRefreshHook = null;
    }

    this._refreshDrawCaptureHooks();

    if (!hasTokenLive && !hasTileLive && this._canvasReadyHook) {
      Hooks.off("canvasReady", this._canvasReadyHook);
      this._canvasReadyHook = null;
    }
  }

  _registerLiveUpdates() {
    if (!this.liveUpdates || !this.targetId) return;
    if (this.targetType !== "token" && this.targetType !== "tile") return;

    const isToken = this.targetType === "token";
    const map = isToken
      ? PlaceableImageChannel._tokenLiveInstances
      : PlaceableImageChannel._tileLiveInstances;
    const id = this.targetId;
    const bucket = map.get(id) ?? new Set();
    bucket.add(this);
    map.set(id, bucket);
    PlaceableImageChannel._ensureLiveUpdateHooks();
  }

  _unregisterLiveUpdates() {
    if (!this.targetId) return;
    const map =
      this.targetType === "token"
        ? PlaceableImageChannel._tokenLiveInstances
        : this.targetType === "tile"
          ? PlaceableImageChannel._tileLiveInstances
          : null;
    if (!map) return;
    const bucket = map.get(this.targetId);
    if (!bucket) return;
    bucket.delete(this);
    if (!bucket.size) map.delete(this.targetId);
    PlaceableImageChannel._teardownLiveUpdateHooksIfUnused();
  }

  constructor({
    moduleId,
    targetType,
    targetId,
    size = 1024,
    width = null,
    height = null,
    liveUpdates = true,
    previewTexturePath = "",
    captureRotationDeg = 0,
    captureFlipHorizontal = false,
    captureFlipVertical = false,
    includePlaceableRotation = true,
  } = {}) {
    this.moduleId = String(moduleId ?? "indy-fx");
    this.targetType = String(targetType ?? "").trim().toLowerCase();
    this.targetId = String(targetId ?? "").trim();
    this.size = isFinitePositive(size, 1024);
    this.width = isFinitePositive(width, this.size);
    this.height = isFinitePositive(height, this.size);
    this.liveUpdates = liveUpdates === true;
    this.previewTexturePath = String(previewTexturePath ?? "").trim();
    this.captureRotationDeg = Number.isFinite(Number(captureRotationDeg))
      ? Number(captureRotationDeg)
      : 0;
    this.captureFlipHorizontal =
      captureFlipHorizontal === true ||
      captureFlipHorizontal === 1 ||
      captureFlipHorizontal === "1" ||
      captureFlipHorizontal === "true" ||
      captureFlipHorizontal === "on";
    this.captureFlipVertical =
      captureFlipVertical === true ||
      captureFlipVertical === 1 ||
      captureFlipVertical === "1" ||
      captureFlipVertical === "true" ||
      captureFlipVertical === "on";
    this.includePlaceableRotation = includePlaceableRotation !== false;

    this.renderTexture = PIXI.RenderTexture.create({
      width: this.width,
      height: this.height,
    });
    this.texture = this.renderTexture;
    this.resolution = [this.width, this.height];

    this._currentSrc = "";
    this._destroyed = false;
    this._deferredRefreshHandle = null;
    this._missingSourceRetryHandle = null;
    this._missingSourceRetryCount = 0;
    this._pendingInitialCapture = false;
    this._debugLogCount = 0;
    this._debugLogLimit = 80;

    this._clear();
    if (this.previewTexturePath) {
      this._renderPath(this.previewTexturePath, {
        force: true,
        remember: false,
      });
    }

    this._registerLiveUpdates();
    this._setPendingInitialCapture(true);
    this._debugLog("init", {
      size: this.size,
      width: this.width,
      height: this.height,
      liveUpdates: this.liveUpdates,
      previewTexturePath: this.previewTexturePath || null,
      captureRotationDeg: this.captureRotationDeg,
      captureFlipHorizontal: this.captureFlipHorizontal,
      captureFlipVertical: this.captureFlipVertical,
      includePlaceableRotation: this.includePlaceableRotation,
    });

    this.refresh({ force: true });
    this._deferredRefreshHandle = setTimeout(() => {
      if (this._destroyed) return;
      this.refresh({ force: true });
    }, 120);
  }

  _debugLog(event, extra = null) {
    if (!isDebugLoggingEnabled(this.moduleId)) return;
    if (this._debugLogCount >= this._debugLogLimit) return;
    this._debugLogCount += 1;
    const payload = {
      event,
      targetType: this.targetType,
      targetId: this.targetId,
      retryCount: this._missingSourceRetryCount,
      pendingInitialCapture: this._pendingInitialCapture === true,
      currentSrc: this._currentSrc || null,
    };
    if (extra && typeof extra === "object") Object.assign(payload, extra);
    console.debug(`${this.moduleId} | placeable-image-channel`, payload);
  }

  _cancelMissingSourceRetry() {
    if (this._missingSourceRetryHandle) {
      clearTimeout(this._missingSourceRetryHandle);
      this._missingSourceRetryHandle = null;
    }
    this._missingSourceRetryCount = 0;
  }

  _setPendingInitialCapture(pending) {
    const next = pending === true;
    if (this._pendingInitialCapture === next) return;
    this._pendingInitialCapture = next;
    this._debugLog("pending-initial-capture", { pending: next });
    if (!this.liveUpdates || !this.targetId) return;
    if (this.targetType !== "token" && this.targetType !== "tile") return;

    const map =
      this.targetType === "token"
        ? PlaceableImageChannel._tokenPendingCaptureInstances
        : PlaceableImageChannel._tilePendingCaptureInstances;
    const id = this.targetId;

    if (next) {
      const bucket = map.get(id) ?? new Set();
      bucket.add(this);
      map.set(id, bucket);
    } else {
      const bucket = map.get(id);
      if (bucket) {
        bucket.delete(this);
        if (!bucket.size) map.delete(id);
      }
    }

    PlaceableImageChannel._refreshDrawCaptureHooks();
  }

  _scheduleMissingSourceRetry() {
    if (this._destroyed || !this.liveUpdates) return;
    if (this._missingSourceRetryHandle) return;
    if (this._missingSourceRetryCount >= MISSING_SOURCE_MAX_RETRIES) {
      this._debugLog("retry-max-reached", {
        maxRetries: MISSING_SOURCE_MAX_RETRIES,
      });
      return;
    }
    this._debugLog("retry-scheduled", {
      delayMs: MISSING_SOURCE_RETRY_DELAY_MS,
      maxRetries: MISSING_SOURCE_MAX_RETRIES,
    });

    this._missingSourceRetryHandle = setTimeout(() => {
      this._missingSourceRetryHandle = null;
      if (this._destroyed) return;
      this._missingSourceRetryCount += 1;
      this._debugLog("retry-tick");
      this.refresh({ force: true });
    }, MISSING_SOURCE_RETRY_DELAY_MS);
  }

  _clear() {
    if (this._destroyed) return;
    const renderer = canvas?.app?.renderer;
    if (!renderer || !this.renderTexture) return;
    const blank = new PIXI.Container();
    try {
      renderer.render(blank, { renderTexture: this.renderTexture, clear: true });
      this.renderTexture.baseTexture?.update?.();
    } catch (_err) {
      // Ignore clear failures.
    } finally {
      blank.destroy({ children: true });
    }
  }

  _renderTextureHasVisiblePixels() {
    const renderer = canvas?.app?.renderer;
    if (!renderer || !this.renderTexture) return false;
    try {
      if (typeof renderer?.extract?.pixels === "function") {
        const pixels = renderer.extract.pixels(this.renderTexture);
        if (!pixels || !pixels.length) return false;
        const width = Math.max(1, Number(this.width) || 1);
        const height = Math.max(1, Number(this.height) || 1);
        const sampleCols = 7;
        const sampleRows = 7;
        for (let ry = 0; ry < sampleRows; ry += 1) {
          const y = Math.floor((ry / Math.max(1, sampleRows - 1)) * (height - 1));
          for (let rx = 0; rx < sampleCols; rx += 1) {
            const x = Math.floor((rx / Math.max(1, sampleCols - 1)) * (width - 1));
            const i = (y * width + x) * 4;
            const r = pixels[i] ?? 0;
            const g = pixels[i + 1] ?? 0;
            const b = pixels[i + 2] ?? 0;
            const a = pixels[i + 3] ?? 0;
            if (a > 3 || r > 3 || g > 3 || b > 3) return true;
          }
        }
        return false;
      }
      if (typeof renderer?.extract?.canvas === "function") {
        const c = renderer.extract.canvas(this.renderTexture);
        const ctx = c?.getContext?.("2d", { willReadFrequently: true });
        if (!ctx || !c) return false;
        const sampleCols = 7;
        const sampleRows = 7;
        for (let ry = 0; ry < sampleRows; ry += 1) {
          const y = Math.floor((ry / Math.max(1, sampleRows - 1)) * (Math.max(1, c.height) - 1));
          for (let rx = 0; rx < sampleCols; rx += 1) {
            const x = Math.floor((rx / Math.max(1, sampleCols - 1)) * (Math.max(1, c.width) - 1));
            const p = ctx.getImageData(x, y, 1, 1).data;
            if ((p[3] ?? 0) > 3 || (p[0] ?? 0) > 3 || (p[1] ?? 0) > 3 || (p[2] ?? 0) > 3) {
              return true;
            }
          }
        }
      }
    } catch (_err) {
      return false;
    }
    return false;
  }

  _renderTextureToSquare(texture, placeable = null, { verifyContent = false, sourcePath = "" } = {}) {
    if (this._destroyed || !texture) return;
    const renderer = canvas?.app?.renderer;
    if (!renderer || !this.renderTexture) return false;

    const sourceW = Number(
      texture?.baseTexture?.realWidth ?? texture?.width ?? texture?.baseTexture?.width ?? 0,
    );
    const sourceH = Number(
      texture?.baseTexture?.realHeight ?? texture?.height ?? texture?.baseTexture?.height ?? 0,
    );
    if (!Number.isFinite(sourceW) || !Number.isFinite(sourceH) || sourceW <= 0 || sourceH <= 0) {
      this._clear();
      this._debugLog("render-empty-source-size", { sourceW, sourceH });
      return false;
    }

    const draw = getPlaceableDrawProps(
      placeable,
      this.targetType,
      sourceW,
      sourceH,
    );

    const baseW = Math.max(1, draw.width * Math.abs(draw.scaleX));
    const baseH = Math.max(1, draw.height * Math.abs(draw.scaleY));
    // Tokens render inside a fixed token footprint; don't shrink with rotation.
    // Tiles can extend with rotation, so keep rotated-bounds fitting for tiles.
    const fit = this.targetType === "token"
      ? Math.min(
          this.width / Math.max(1, baseW),
          this.height / Math.max(1, baseH),
        )
      : (() => {
          const rotatedW =
            Math.abs(Math.cos(draw.rotationRad)) * baseW +
            Math.abs(Math.sin(draw.rotationRad)) * baseH;
          const rotatedH =
            Math.abs(Math.sin(draw.rotationRad)) * baseW +
            Math.abs(Math.cos(draw.rotationRad)) * baseH;
          return Math.min(
            this.width / Math.max(1, rotatedW),
            this.height / Math.max(1, rotatedH),
          );
        })();

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.x = this.width * 0.5;
    sprite.y = this.height * 0.5;

    const applyIndyFallbackTransform = usesIndyPlaceableFallbackTexture(sourcePath);
    const effectiveCaptureRotationDeg =
      this.captureRotationDeg + (applyIndyFallbackTransform ? 180 : 0);
    const effectiveCaptureFlipHorizontal = applyIndyFallbackTransform
      ? !this.captureFlipHorizontal
      : this.captureFlipHorizontal;
    const effectiveCaptureFlipVertical = applyIndyFallbackTransform
      ? !this.captureFlipVertical
      : this.captureFlipVertical;

    this._debugLog("render-effective-transform", {
      sourcePath: sourcePath || null,
      applyIndyFallbackTransform,
      captureTextureResolution: [this.width, this.height],
      configuredCaptureRotationDeg: this.captureRotationDeg,
      configuredCaptureFlipHorizontal: this.captureFlipHorizontal === true,
      configuredCaptureFlipVertical: this.captureFlipVertical === true,
      effectiveCaptureRotationDeg,
      effectiveCaptureFlipHorizontal,
      effectiveCaptureFlipVertical,
      drawBaseSize: [baseW, baseH],
      drawAspect: baseH > 0 ? (baseW / baseH) : 0,
      fitScale: fit,
      placeableRotationDeg: Number((draw.rotationRad * 180) / Math.PI),
    });

    const appliedPlaceableRotationRad =
      this.includePlaceableRotation === true ? draw.rotationRad : 0;
    const captureFlipX = effectiveCaptureFlipHorizontal ? -1 : 1;
    const captureFlipY = effectiveCaptureFlipVertical ? -1 : 1;
    const captureRotationRad = (effectiveCaptureRotationDeg * Math.PI) / 180;
    sprite.scale.set(
      fit * (draw.width / sourceW) * draw.scaleX * captureFlipX,
      fit * (draw.height / sourceH) * draw.scaleY * captureFlipY,
    );
    sprite.rotation = appliedPlaceableRotationRad + captureRotationRad;

    const stage = new PIXI.Container();
    stage.addChild(sprite);
    try {
      renderer.render(stage, { renderTexture: this.renderTexture, clear: true });
      this.renderTexture.baseTexture?.update?.();
      if (verifyContent) {
        const visible = this._renderTextureHasVisiblePixels();
        if (!visible) {
          this._debugLog("render-empty-content");
          return false;
        }
      }
      return true;
    } catch (_err) {
      // Ignore render failures.
      this._debugLog("render-error");
      return false;
    } finally {
      stage.destroy({ children: true });
    }
  }

  _renderPath(path, { force = false, remember = true, placeable = null } = {}) {
    const src = String(path ?? "").trim();
    this._debugLog("render-path", {
      hasSrc: !!src,
      force: force === true,
      remember: remember === true,
      src: src || null,
      placeableId: String(placeable?.document?.id ?? placeable?.id ?? "") || null,
    });
    if (!src) {
      this._clear();
      if (remember) this._currentSrc = "";
      this._debugLog("render-path-empty-src");
      return;
    }
    if (!force && src === this._currentSrc) return;

    const texture = PIXI.Texture.from(src);
    const base = texture?.baseTexture;
    if (!base) {
      this._clear();
      if (remember) this._currentSrc = "";
      this._setPendingInitialCapture(true);
      this._debugLog("render-path-no-base", { src });
      return;
    }

    base.wrapMode = PIXI.WRAP_MODES.CLAMP;
    base.scaleMode = PIXI.SCALE_MODES.LINEAR;
    base.mipmap = PIXI.MIPMAP_MODES.OFF;
    base.update?.();

    const commit = () => {
      if (this._destroyed) return;
      const rendered = this._renderTextureToSquare(texture, placeable, {
        verifyContent: remember === true,
        sourcePath: src,
      });
      if (remember) {
        if (rendered) {
          this._currentSrc = src;
          this._cancelMissingSourceRetry();
          this._setPendingInitialCapture(false);
          this._debugLog("capture-success", { src });
        } else {
          this._setPendingInitialCapture(true);
          this._scheduleMissingSourceRetry();
          this._debugLog("capture-not-ready", { src });
        }
      }
    };

    if (base.valid) {
      this._debugLog("render-base-valid", { src });
      commit();
      return;
    }

    if (remember) this._setPendingInitialCapture(true);
    this._debugLog("render-await-base-load", { src });
    base.once?.("loaded", commit);
    base.once?.("error", () => {
      if (this._destroyed) return;
      this._clear();
      if (remember) this._currentSrc = "";
      this._setPendingInitialCapture(true);
      this._scheduleMissingSourceRetry();
      this._debugLog("render-base-error", { src });
      console.warn(`${this.moduleId} | Failed to load placeable image channel source`, {
        targetType: this.targetType,
        targetId: this.targetId,
        src,
      });
    });
  }

  refresh({ force = false } = {}) {
    if (this._destroyed) return;
    const placeable = pickPlaceable(this.targetType, this.targetId);
    const src = getPlaceableImageSrc(placeable, this.targetType);
    this._debugLog("refresh", {
      force: force === true,
      hasPlaceable: !!placeable,
      placeableId: String(placeable?.document?.id ?? placeable?.id ?? "") || null,
      hasSrc: !!src,
      src: src || null,
    });
    if (!src) {
      if (this.previewTexturePath && !this._currentSrc) {
        this._renderPath(this.previewTexturePath, { force: true, remember: false });
      } else {
        this._clear();
      }
      this._setPendingInitialCapture(true);
      this._scheduleMissingSourceRetry();
      return;
    }
    this._renderPath(src, {
      force: force === true,
      remember: true,
      placeable,
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._deferredRefreshHandle) {
      clearTimeout(this._deferredRefreshHandle);
      this._deferredRefreshHandle = null;
    }
    if (this._missingSourceRetryHandle) {
      clearTimeout(this._missingSourceRetryHandle);
      this._missingSourceRetryHandle = null;
    }
    this._unregisterLiveUpdates();
    this._setPendingInitialCapture(false);
    if (this.renderTexture) {
      this.renderTexture.destroy(true);
      this.renderTexture = null;
      this.texture = null;
    }
  }
}
