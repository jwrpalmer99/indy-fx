import { ShaderManager } from "./shaders/manager.js";
import {
  REGION_SHADER_BEHAVIOR_TYPE,
  buildRegionShaderBehaviorSystemData,
  getRegionShaderBehaviorSystemData,
  isRegionShaderBehaviorType,
  registerRegionShaderBehavior
} from "./region-shader-behavior.js";
import { createMenus } from "./menus.js";
import { createNetworkController } from "./network.js";
import { registerModuleSettings } from "./settings.js";
import {
  parseHexColorLike,
  parseDistanceValue,
  sceneUnitsToPixels,
  scenePixelsToUnits,
  getTokenCenter,
  normalizeShapeType,
  worldPointFromPointerEvent,
  drawPlacementPreview
} from "./effects.js";
import {
  getRegionShapeSignature,
  extractRegionShapes,
  computeRegionBounds,
  groupContiguousRegionShapes,
  createRegionCompositeMaskTexture,
  getRegionSolidComponents,
  getRegionComponentBounds,
  createRegionComponentMaskTexture
} from "./region-utils.js";
import {
  resolveShaderWorldLayer,
  buildDirectionalMaskTexture,
  createQuadGeometry,
  setupShaderRuntimeChannels,
  createFadeAlphaComputer,
  updateShaderTimeUniforms,
  destroyShaderRuntimeEntry,
  destroyRegionClusterRuntime
} from "./shader-runtime-utils.js";
const MODULE_ID = "indy-fx";
const SOCKET = `module.${MODULE_ID}`;
const shaderManager = new ShaderManager(MODULE_ID);
const { ShaderSettingsMenu, DebugSettingsMenu, ShaderLibraryMenu } = createMenus({
  moduleId: MODULE_ID,
  shaderManager
});

console.log(`${MODULE_ID} | script loaded`, { MODULE_ID, SOCKET });

function isDebugLoggingEnabled() {
  try {
    return game?.settings?.get?.(MODULE_ID, "shaderDebug") === true;
  } catch (_err) {
    return false;
  }
}

function debugLog(message, payload = undefined) {
  if (!isDebugLoggingEnabled()) return;
  if (payload === undefined) console.debug(`${MODULE_ID} | ${message}`);
  else console.debug(`${MODULE_ID} | ${message}`, payload);
}

const SHADER_LIBRARY_TOOL_NAME = "indyfx-shader-library";
let _shaderLibraryMenuApp = null;
let _shaderLibraryMenuOpening = null;

async function openShaderLibraryWindow() {
  try {
    const existing = _shaderLibraryMenuApp;
    if (existing) {
      if (existing.rendered) {
        existing.bringToTop?.();
        return existing;
      }
      if (!_shaderLibraryMenuOpening) {
        _shaderLibraryMenuOpening = Promise.resolve(existing.render(true)).finally(() => {
          _shaderLibraryMenuOpening = null;
        });
      }
      await _shaderLibraryMenuOpening;
      existing.bringToTop?.();
      return existing;
    }

    const app = new ShaderLibraryMenu();
    _shaderLibraryMenuApp = app;
    const originalClose = app.close?.bind(app);
    if (typeof originalClose === "function") {
      app.close = async (...args) => {
        const result = await originalClose(...args);
        if (_shaderLibraryMenuApp === app) _shaderLibraryMenuApp = null;
        if (_shaderLibraryMenuOpening) _shaderLibraryMenuOpening = null;
        return result;
      };
    }

    _shaderLibraryMenuOpening = Promise.resolve(app.render(true)).finally(() => {
      _shaderLibraryMenuOpening = null;
    });
    await _shaderLibraryMenuOpening;
    app.bringToTop?.();
    return app;
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to open shader library`, err);
    ui.notifications?.error?.("Failed to open Shader Library.");
    return null;
  }
}
// ------------------------------
const SHADER_CARD_DRAG_MIME = "application/x-indyfx-shader";
let _shaderCardDropView = null;
let _shaderCardDragOverHandler = null;
let _shaderCardDropHandler = null;

function getShaderDefaultOptsForDragDrop(shaderId) {
  const normalizedShaderId = String(shaderId ?? "").trim();
  if (!normalizedShaderId) return null;
  const record = shaderManager.getImportedRecord(normalizedShaderId);
  const defaults = record
    ? shaderManager.getRecordShaderDefaults(record, { runtime: false })
    : (shaderManager.getDefaultImportedShaderDefaults?.() ?? {});
  const opts = {
    shaderId: normalizedShaderId,
    ...foundry.utils.deepClone(defaults ?? {}),
  };
  const rawDisplay = record?.defaults?.displayTimeMs;
  const hasDisplayTime =
    rawDisplay !== undefined &&
    rawDisplay !== null &&
    String(rawDisplay).trim() !== "";
  if (!hasDisplayTime) opts.displayTimeMs = 0;
  return opts;
}

function getCanvasWorldPointFromDomEvent(event) {
  const renderer = canvas?.app?.renderer;
  const clientX = Number(event?.clientX);
  const clientY = Number(event?.clientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

  const worldFromClient = canvas?.canvasCoordinatesFromClient?.({
    x: clientX,
    y: clientY,
  });
  if (worldFromClient) {
    const wx = Number(worldFromClient.x);
    const wy = Number(worldFromClient.y);
    if (Number.isFinite(wx) && Number.isFinite(wy)) {
      return new PIXI.Point(wx, wy);
    }
  }

  if (renderer && canvas?.stage?.toLocal) {
    const mapped = new PIXI.Point();
    const mapFn =
      renderer?.events?.mapPositionToPoint
      ?? renderer?.plugins?.interaction?.mapPositionToPoint;
    if (typeof mapFn === "function") {
      try {
        mapFn.call(
          renderer?.events ?? renderer?.plugins?.interaction,
          mapped,
          clientX,
          clientY,
        );
        const localPoint = canvas.stage.toLocal(mapped);
        if (Number.isFinite(localPoint?.x) && Number.isFinite(localPoint?.y)) {
          return new PIXI.Point(localPoint.x, localPoint.y);
        }
      } catch (_err) {
        // Fallback below.
      }
    }
  }

  const view = canvas?.app?.renderer?.view ?? canvas?.app?.view;
  if (!view || !renderer || !canvas?.stage?.toLocal) return null;
  const rect = view.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const sx = (clientX - rect.left) * (renderer.width / rect.width);
  const sy = (clientY - rect.top) * (renderer.height / rect.height);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;

  const localPoint = canvas.stage.toLocal(new PIXI.Point(sx, sy));
  if (!Number.isFinite(localPoint?.x) || !Number.isFinite(localPoint?.y)) {
    return null;
  }
  return new PIXI.Point(localPoint.x, localPoint.y);
}

function getCanvasGlobalPointFromDomEvent(event) {
  const worldPoint = getCanvasWorldPointFromDomEvent(event);
  if (worldPoint && canvas?.stage?.toGlobal) {
    try {
      const globalPoint = canvas.stage.toGlobal(worldPoint);
      if (Number.isFinite(globalPoint?.x) && Number.isFinite(globalPoint?.y)) {
        return new PIXI.Point(globalPoint.x, globalPoint.y);
      }
    } catch (_err) {
      // Fallback below.
    }
  }

  const renderer = canvas?.app?.renderer;
  const view = renderer?.view ?? canvas?.app?.view;
  const clientX = Number(event?.clientX);
  const clientY = Number(event?.clientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  if (!view || !renderer) return null;
  const rect = view.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) * (renderer.width / rect.width);
  const y = (clientY - rect.top) * (renderer.height / rect.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return new PIXI.Point(x, y);
}

function parseShaderCardDragPayload(event) {
  const dt = event?.dataTransfer;
  if (!dt) return null;

  const readPayload = (type) => {
    try {
      const raw = String(dt.getData(type) ?? "").trim();
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const shaderId = String(parsed?.shaderId ?? "").trim();
      if (!shaderId) return null;
      if (String(parsed?.type ?? "") !== "indyfx-shader") return null;
      return { shaderId };
    } catch (_err) {
      return null;
    }
  };

  return readPayload(SHADER_CARD_DRAG_MIME) ?? readPayload("text/plain");
}
function hasShaderCardDragType(event) {
  const types = event?.dataTransfer?.types;
  if (!types) return false;
  if (typeof types.contains === "function") return types.contains(SHADER_CARD_DRAG_MIME);
  return Array.from(types).some((entry) => String(entry) === SHADER_CARD_DRAG_MIME);
}

function isGlobalPointInsidePlaceable(placeable, globalPoint) {
  if (!placeable || !globalPoint) return false;
  try {
    if (typeof placeable.containsPoint === "function" && placeable.containsPoint(globalPoint)) {
      return true;
    }
  } catch (_err) {
    // Fallback to bounds below.
  }

  try {
    const bounds = placeable.getBounds?.();
    if (bounds?.contains?.(globalPoint.x, globalPoint.y)) return true;
  } catch (_err) {
    return false;
  }
  return false;
}

function findTopPlaceableAtGlobalPoint(placeables, globalPoint) {
  const list = Array.isArray(placeables) ? placeables : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const placeable = list[i];
    if (!placeable || placeable.destroyed || placeable.visible === false) continue;
    if (isGlobalPointInsidePlaceable(placeable, globalPoint)) return placeable;
  }
  return null;
}

function isWorldPointInsideToken(token, worldPoint) {
  if (!token || !worldPoint) return false;
  const x = Number(token.document?.x ?? token.x);
  const y = Number(token.document?.y ?? token.y);
  const w = Number(token.w ?? token.document?.width ?? token.document?.w);
  const h = Number(token.h ?? token.document?.height ?? token.document?.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return false;
  return worldPoint.x >= x && worldPoint.x <= (x + w) && worldPoint.y >= y && worldPoint.y <= (y + h);
}

function isWorldPointInsideTile(tile, worldPoint) {
  if (!tile || !worldPoint) return false;
  const doc = tile.document ?? tile;
  const x = Number(doc?.x ?? tile.x);
  const y = Number(doc?.y ?? tile.y);
  const w = Number(doc?.width ?? tile.width ?? tile.w);
  const h = Number(doc?.height ?? tile.height ?? tile.h);
  const rotDeg = Number(doc?.rotation ?? tile.rotation ?? 0);
  if (![x, y, w, h, rotDeg].every((n) => Number.isFinite(n))) return false;
  if (w <= 0 || h <= 0) return false;

  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const dx = worldPoint.x - cx;
  const dy = worldPoint.y - cy;
  const r = (-rotDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= w * 0.5 && Math.abs(ly) <= h * 0.5;
}

function isWorldPointInsideTemplate(template, worldPoint, globalPoint = null) {
  if (!template || !worldPoint) return false;
  const gp = globalPoint ?? (canvas?.stage ? canvas.stage.toGlobal(new PIXI.Point(worldPoint.x, worldPoint.y)) : null);
  if (!gp) return false;

  try {
    if (typeof template.containsPoint === "function" && template.containsPoint(gp)) {
      return true;
    }
  } catch (_err) {
    // Continue to shape fallbacks.
  }

  try {
    const local = template.worldTransform?.applyInverse?.(gp, new PIXI.Point());
    const shape = template.shape ?? template.hitArea ?? null;
    if (local && shape && typeof shape.contains === "function" && shape.contains(local.x, local.y)) {
      return true;
    }
  } catch (_err) {
    // Continue to bounds fallback.
  }

  return false;
}

function findTopTokenAtDropPoint(globalPoint, worldPoint) {
  const tokens = Array.isArray(canvas?.tokens?.placeables) ? canvas.tokens.placeables : [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (!token || token.destroyed || token.visible === false) continue;
    if (globalPoint && isGlobalPointInsidePlaceable(token, globalPoint)) return token;
    if (isWorldPointInsideToken(token, worldPoint)) return token;
  }
  return null;
}

function findTopTileAtDropPoint(globalPoint, worldPoint) {
  const tiles = Array.isArray(canvas?.tiles?.placeables) ? canvas.tiles.placeables : [];
  for (let i = tiles.length - 1; i >= 0; i -= 1) {
    const tile = tiles[i];
    if (!tile || tile.destroyed || tile.visible === false) continue;
    if (globalPoint && isGlobalPointInsidePlaceable(tile, globalPoint)) return tile;
    if (isWorldPointInsideTile(tile, worldPoint)) return tile;
  }
  return null;
}

function findTopTemplateAtDropPoint(globalPoint, worldPoint) {
  const templates = Array.isArray(canvas?.templates?.placeables) ? canvas.templates.placeables : [];
  for (let i = templates.length - 1; i >= 0; i -= 1) {
    const template = templates[i];
    if (!template || template.destroyed || template.visible === false) continue;
    if (isWorldPointInsideTemplate(template, worldPoint, globalPoint)) return template;
  }
  return null;
}

function resolveDropShaderTarget(globalPoint, worldPoint) {
  const activeLayer = canvas?.activeLayer;
  const tokenTarget = findTopTokenAtDropPoint(globalPoint, worldPoint);
  const tileTarget = findTopTileAtDropPoint(globalPoint, worldPoint);
  const templateTarget = findTopTemplateAtDropPoint(globalPoint, worldPoint);

  const activeName = String(
    activeLayer?.documentName ?? activeLayer?.options?.documentName ?? activeLayer?.name ?? "",
  ).toLowerCase();

  if (activeLayer === canvas?.tokens || activeName.includes("token")) {
    if (tokenTarget) return { targetType: "token", targetId: tokenTarget.id ?? tokenTarget.document?.id ?? null };
  }
  if (activeLayer === canvas?.tiles || activeName.includes("tile")) {
    if (tileTarget) return { targetType: "tile", targetId: tileTarget.id ?? tileTarget.document?.id ?? null };
  }
  if (
    activeLayer === canvas?.templates ||
    activeLayer === canvas?.measure ||
    activeName.includes("template") ||
    activeName.includes("measure")
  ) {
    if (templateTarget) return { targetType: "template", targetId: templateTarget.id ?? templateTarget.document?.id ?? null };
  }

  if (tokenTarget) return { targetType: "token", targetId: tokenTarget.id ?? tokenTarget.document?.id ?? null };
  if (tileTarget) return { targetType: "tile", targetId: tileTarget.id ?? tileTarget.document?.id ?? null };
  if (templateTarget) return { targetType: "template", targetId: templateTarget.id ?? templateTarget.document?.id ?? null };

  return { targetType: null, targetId: null };
}
async function applyDroppedShaderPayload(payload, event) {
  const shaderId = String(payload?.shaderId ?? "").trim();
  if (!shaderId) return;

  let worldPoint = getCanvasWorldPointFromDomEvent(event);
  const globalPoint = getCanvasGlobalPointFromDomEvent(event);
  if (!worldPoint && globalPoint && canvas?.stage?.toLocal) {
    try {
      const local = canvas.stage.toLocal(globalPoint);
      if (Number.isFinite(local?.x) && Number.isFinite(local?.y)) {
        worldPoint = new PIXI.Point(local.x, local.y);
      }
    } catch (_err) {
      // Keep original value.
    }
  }
  if (!globalPoint && !worldPoint) return;

  const { targetType, targetId } = resolveDropShaderTarget(globalPoint, worldPoint);
  if (!targetType || !targetId) {
    ui.notifications?.warn?.("Drop onto a token, tile, or template to apply shader.");
    return;
  }

  if (targetType === "template" && !shaderManager.shaderSupportsTarget(shaderId, "template")) {
    ui.notifications?.warn?.("This shader uses token/tile image channels and cannot be applied to templates.");
    return;
  }

  const opts = getShaderDefaultOptsForDragDrop(shaderId);
  if (!opts) return;

  const fx = game.indyFX;
  if (!fx) {
    ui.notifications?.error?.("indyFX API is unavailable.");
    return;
  }

  try {
    if (targetType === "token") {
      await fx.broadcastShaderOff({ tokenId: targetId });
      await fx.broadcastShaderOn({ tokenId: targetId, opts: { ...opts } });
    } else if (targetType === "tile") {
      await fx.broadcastShaderOffTile({ tileId: targetId });
      await fx.broadcastShaderOnTile({ tileId: targetId, opts: { ...opts } });
    } else if (targetType === "template") {
      await fx.broadcastShaderOffTemplate({ templateId: targetId });
      await fx.broadcastShaderOnTemplate({ templateId: targetId, opts: { ...opts } });
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Failed applying dragged shader`, {
      shaderId,
      targetType,
      targetId,
      err,
    });
  }
}

function unbindShaderLibraryDragDropHandlers() {
  if (_shaderCardDropView) {
    if (_shaderCardDragOverHandler) {
      _shaderCardDropView.removeEventListener("dragover", _shaderCardDragOverHandler, true);
    }
    if (_shaderCardDropHandler) {
      _shaderCardDropView.removeEventListener("drop", _shaderCardDropHandler, true);
    }
  }
  _shaderCardDropView = null;
  _shaderCardDragOverHandler = null;
  _shaderCardDropHandler = null;
}

function bindShaderLibraryDragDropHandlers() {
  const view = canvas?.app?.renderer?.view ?? canvas?.app?.view;
  if (!view) return;
  if (_shaderCardDropView === view && _shaderCardDragOverHandler && _shaderCardDropHandler) return;

  unbindShaderLibraryDragDropHandlers();

  _shaderCardDragOverHandler = (event) => {
    if (!hasShaderCardDragType(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  _shaderCardDropHandler = (event) => {
    const payload = parseShaderCardDragPayload(event);
    if (!payload) return;
    event.preventDefault();
    event.stopPropagation();
    void applyDroppedShaderPayload(payload, event);
  };

  view.addEventListener("dragover", _shaderCardDragOverHandler, true);
  view.addEventListener("drop", _shaderCardDropHandler, true);
  _shaderCardDropView = view;
}

// Math / color helpers
// ------------------------------
const rand = (a, b) => a + Math.random() * (b - a);

const unitDir = () => {
  // Uniform direction on circle (no angular bias)
  let x = 0, y = 0;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
  } while (x * x + y * y < 0.0001);
  const inv = 1 / Math.hypot(x, y);
  return { x: x * inv, y: y * inv };
};

const lerpColor = (c1, c2, t) => {
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
  const r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  const r = (r1 + (r2 - r1) * t) | 0;
  const g = (g1 + (g2 - g1) * t) | 0;
  const b = (b1 + (b2 - b1) * t) | 0;
  return (r << 16) | (g << 8) | b;
};

const darken = (c, f) => {
  const r = ((c >> 16) & 255) * f;
  const g = ((c >> 8) & 255) * f;
  const b = (c & 255) * f;
  return (((r | 0) << 16) | ((g | 0) << 8) | (b | 0));
};

const _activeShader = new Map();
const _activeTemplateShader = new Map();
const _activeRegionShader = new Map();
const _activeRegionShaderByRegion = new Map();
const _activeTileShader = new Map();
const _muteRegionBehaviorSync = new Set();
let _persistentRestoreGeneration = 0;
const _tmpPoint = new PIXI.Point();
let _shaderPlacementCleanup = null;
const TOKEN_SHADER_FLAG = "tokenShader";
const TEMPLATE_SHADER_FLAG = "templateShader";
const TILE_SHADER_FLAG = "tileShader";

function shouldPersistDocumentShader(cfg) {
  const ms = Number(cfg?.displayTimeMs ?? 0);
  return !(Number.isFinite(ms) && ms > 0);
}

function sanitizeShaderPersistOpts(opts = {}) {
  const clean = foundry.utils.mergeObject({}, opts && typeof opts === "object" ? opts : {}, { inplace: false });
  for (const key of Object.keys(clean)) {
    if (key.startsWith("_") && key !== "_disabled") delete clean[key];
  }
  const normalizedShaderId = String(
    clean.shaderId ?? clean.shaderPreset ?? clean.shaderMode ?? "",
  ).trim();
  if (normalizedShaderId) clean.shaderId = normalizedShaderId;
  delete clean.shaderPreset;
  delete clean.shaderMode;
  return clean;
}

function getTokenShaderDocument(tokenId) {
  const resolvedTokenId = resolveTokenId(tokenId);
  if (!resolvedTokenId) return null;
  return canvas.tokens?.get?.(resolvedTokenId)?.document
    ?? canvas.scene?.tokens?.get?.(resolvedTokenId)
    ?? null;
}

function getTemplateShaderDocument(templateId) {
  const resolvedTemplateId = resolveTemplateId(templateId);
  if (!resolvedTemplateId) return null;
  return canvas.templates?.get?.(resolvedTemplateId)?.document
    ?? canvas.scene?.templates?.get?.(resolvedTemplateId)
    ?? null;
}

function getTileShaderDocument(tileId) {
  const resolvedTileId = resolveTileId(tileId);
  if (!resolvedTileId) return null;
  return getTilePlaceable(resolvedTileId)?.document
    ?? canvas.scene?.tiles?.get?.(resolvedTileId)
    ?? null;
}

function readShaderFlag(doc, flagKey) {
  const value = doc?.getFlag?.(MODULE_ID, flagKey);
  if (!value || typeof value !== "object") return null;
  return foundry.utils.deepClone(value);
}

async function writeShaderFlag(doc, flagKey, opts) {
  if (!game.user?.isGM) return;
  if (!doc?.setFlag) return;

  const sanitized = sanitizeShaderPersistOpts(opts);
  const current = doc?.getFlag?.(MODULE_ID, flagKey);
  try {
    if (current && typeof current === "object") {
      const prev = JSON.stringify(current);
      const next = JSON.stringify(sanitized);
      if (prev === next) return;
    }
  } catch (_err) {
    // If serialization fails, fall through and write.
  }

  debugLog("write shader flag", {
    docId: doc?.id ?? null,
    docType: doc?.documentName ?? doc?.constructor?.name ?? null,
    flagKey,
    shaderId: sanitized?.shaderId ?? null,
    disabled: parsePersistDisabled(sanitized?._disabled),
    displayTimeMs: sanitized?.displayTimeMs ?? null,
  });
  await doc.setFlag(MODULE_ID, flagKey, sanitized);
}

async function clearShaderFlag(doc, flagKey) {
  if (!game.user?.isGM) return;
  if (!doc?.unsetFlag) return;

  const current = doc?.getFlag?.(MODULE_ID, flagKey);
  if (current === undefined || current === null) return;
  debugLog("clear shader flag", {
    docId: doc?.id ?? null,
    docType: doc?.documentName ?? doc?.constructor?.name ?? null,
    flagKey,
  });
  await doc.unsetFlag(MODULE_ID, flagKey);
}
function parsePersistDisabled(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true" ||
    value === "on"
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SHADER_LAYER_CHOICES = {
  inherit: "inherit from FX layer",
  interfacePrimary: "interfacePrimary",
  belowTokens: "Below Tokens (interface, under token z-order)",
  drawings: "DrawingsLayer (above tokens)"
};

function normalizeShaderLayerName(value, fallback = "interfacePrimary") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (raw === "token") return "interfacePrimary";
  if (raw === "belowTiles") return "belowTokens";
  if (raw === "baseEffects") return "belowTokens";
  if (raw === "effects") return "belowTokens";
  if (raw === "interface") return "interfacePrimary";
  if (raw === "drawingsLayer") return "drawings";
  return raw;
}

function resolveConfiguredShaderLayerName(cfg) {
  const shaderLayerSetting = cfg?.layer ?? game.settings.get(MODULE_ID, "shaderLayer") ?? "inherit";
  const layerNameRaw = shaderLayerSetting === "inherit"
    ? (game.settings.get(MODULE_ID, "layer") ?? "interfacePrimary")
    : shaderLayerSetting;
  return normalizeShaderLayerName(layerNameRaw, "interfacePrimary");
}

function resolveShaderExplicitZIndex(cfg) {
  const candidates = [cfg?.zIndex, cfg?.zOrder, cfg?.shaderZIndex, cfg?.shaderZOrder];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function resolveShaderContainerZIndex(cfg) {
  const explicitZ = resolveShaderExplicitZIndex(cfg);
  if (Number.isFinite(explicitZ)) return explicitZ;

  const layerName = resolveConfiguredShaderLayerName(cfg);
  const tokensZ = Number(canvas?.tokens?.zIndex);

  // Legacy "effects" maps to belowTokens via normalizeShaderLayerName.
  if (layerName === "belowTokens") {
    if (Number.isFinite(tokensZ)) return tokensZ - 1;
    return 199;
  }

  return 999999;
}

function addShaderContainerToWorldLayer(worldLayer, container, cfg) {
  if (!worldLayer || !container) return;

  const layerName = resolveConfiguredShaderLayerName(cfg);
  const explicitZ = resolveShaderExplicitZIndex(cfg);
  const isBelowLayer = !Number.isFinite(explicitZ) && layerName === "belowTokens";

  if (isBelowLayer) {
    const anchorLayer = canvas?.tokens ?? canvas?.tiles;

    debugLog("addShaderContainerToWorldLayer: anchor check", {
      layerName,
      worldLayer: worldLayer?.constructor?.name ?? null,
      anchorLayer: anchorLayer?.constructor?.name ?? null,
      anchorParent: anchorLayer?.parent?.constructor?.name ?? null,
      worldLayerChildCount: Array.isArray(worldLayer?.children) ? worldLayer.children.length : null,
    });

    if (
      anchorLayer?.parent === worldLayer &&
      typeof worldLayer.addChildAt === "function" &&
      typeof worldLayer.getChildIndex === "function"
    ) {
      try {
        const anchorIndex = worldLayer.getChildIndex(anchorLayer);
        if (Number.isInteger(anchorIndex) && anchorIndex >= 0) {
          // Keep insertion order relative to the anchor layer; do not re-sort.
          worldLayer.addChildAt(container, anchorIndex);
          debugLog("addShaderContainerToWorldLayer: inserted before anchor", {
            layerName,
            anchorLayer: anchorLayer?.constructor?.name ?? null,
            anchorIndex,
            worldLayer: worldLayer?.constructor?.name ?? null,
          });
          return;
        }
      } catch (_err) {
        // Fall through to default addChild path.
      }
    }
  }

  worldLayer.addChild(container);
  worldLayer.sortChildren?.();

  if (isBelowLayer) {
    debugLog("addShaderContainerToWorldLayer: fallback addChild", {
      layerName,
      worldLayer: worldLayer?.constructor?.name ?? null,
      childIndex: worldLayer?.children?.indexOf?.(container) ?? null,
    });
  }
}

function resolveDocumentShaderTargetFromApp(app) {
  if (!app) return null;
  const doc = app.document ?? app.object?.document ?? app.object ?? null;
  const documentName = String(doc?.documentName ?? "");
  if (!doc?.id) return null;

  if (documentName === "Token") {
    return {
      targetType: "token",
      id: String(doc.id),
      doc,
      flagKey: TOKEN_SHADER_FLAG
    };
  }
  if (documentName === "Tile") {
    return {
      targetType: "tile",
      id: String(doc.id),
      doc,
      flagKey: TILE_SHADER_FLAG
    };
  }
  if (documentName === "MeasuredTemplate") {
    return {
      targetType: "template",
      id: String(doc.id),
      doc,
      flagKey: TEMPLATE_SHADER_FLAG
    };
  }
  return null;
}

function isDocumentShaderRuntimeActive(target) {
  if (!target?.id) return false;
  if (target.targetType === "token") return _activeShader.has(target.id);
  if (target.targetType === "tile") return _activeTileShader.has(target.id);
  if (target.targetType === "template") return _activeTemplateShader.has(target.id);
  return false;
}

function resolveRuntimeMapForTargetType(targetType) {
  if (targetType === "token") return _activeShader;
  if (targetType === "tile") return _activeTileShader;
  if (targetType === "template") return _activeTemplateShader;
  return null;
}

function describeRuntimeEntry(targetType, id, entry) {
  const container = entry?.container ?? null;
  const parent = container?.parent ?? null;
  const pos = container?.position ?? null;
  const scale = container?.scale ?? null;
  const pivot = container?.pivot ?? null;
  const bounds = typeof container?.getBounds === "function"
    ? (() => {
        try {
          const b = container.getBounds(false);
          return {
            x: Number.isFinite(Number(b?.x)) ? Number(b.x) : null,
            y: Number.isFinite(Number(b?.y)) ? Number(b.y) : null,
            width: Number.isFinite(Number(b?.width)) ? Number(b.width) : null,
            height: Number.isFinite(Number(b?.height)) ? Number(b.height) : null,
          };
        } catch (_err) {
          return null;
        }
      })()
    : null;

  return {
    kind: targetType,
    id: String(id ?? ""),
    hasEntry: !!entry,
    containerClass: container?.constructor?.name ?? null,
    parentClass: parent?.constructor?.name ?? null,
    parentName: parent?.name ?? null,
    zIndex: Number.isFinite(Number(container?.zIndex)) ? Number(container.zIndex) : null,
    childIndex: parent && Array.isArray(parent.children) ? parent.children.indexOf(container) : null,
    layer: normalizeShaderLayerName(entry?.sourceOpts?.layer ?? "", "inherit"),
    shaderId: String(entry?.sourceOpts?.shaderId ?? "").trim() || null,
    visible: container?.visible ?? null,
    renderable: container?.renderable ?? null,
    alpha: Number.isFinite(Number(container?.alpha)) ? Number(container.alpha) : null,
    worldAlpha: Number.isFinite(Number(container?.worldAlpha)) ? Number(container.worldAlpha) : null,
    x: Number.isFinite(Number(pos?.x)) ? Number(pos.x) : null,
    y: Number.isFinite(Number(pos?.y)) ? Number(pos.y) : null,
    scaleX: Number.isFinite(Number(scale?.x)) ? Number(scale.x) : null,
    scaleY: Number.isFinite(Number(scale?.y)) ? Number(scale.y) : null,
    pivotX: Number.isFinite(Number(pivot?.x)) ? Number(pivot.x) : null,
    pivotY: Number.isFinite(Number(pivot?.y)) ? Number(pivot.y) : null,
    bounds,
  };
}

function debugDumpShaderContainers({ kind = null, id = null } = {}) {
  const normalizedKind = kind ? String(kind).trim().toLowerCase() : null;
  const kinds = normalizedKind
    ? [normalizedKind]
    : ["token", "tile", "template"];

  const rows = [];
  for (const targetType of kinds) {
    const runtimeMap = resolveRuntimeMapForTargetType(targetType);
    if (!runtimeMap) continue;

    if (id !== null && id !== undefined && String(id).trim()) {
      const targetId = String(id).trim();
      rows.push(describeRuntimeEntry(targetType, targetId, runtimeMap.get(targetId) ?? null));
      continue;
    }

    for (const [targetId, entry] of runtimeMap.entries()) {
      rows.push(describeRuntimeEntry(targetType, targetId, entry));
    }
  }

  return rows;
}

function getDocumentShaderRuntimeSourceOpts(target) {
  if (!target?.id) return null;
  if (target.targetType === "token") {
    const active = _activeShader.get(target.id);
    if (active?.sourceOpts && typeof active.sourceOpts === "object") {
      return foundry.utils.deepClone(active.sourceOpts);
    }
    return null;
  }
  if (target.targetType === "tile") {
    const active = _activeTileShader.get(target.id);
    if (active?.sourceOpts && typeof active.sourceOpts === "object") {
      return foundry.utils.deepClone(active.sourceOpts);
    }
    return null;
  }
  if (target.targetType === "template") {
    const active = _activeTemplateShader.get(target.id);
    if (active?.sourceOpts && typeof active.sourceOpts === "object") {
      return foundry.utils.deepClone(active.sourceOpts);
    }
    return null;
  }
  return null;
}

function documentHasAnyShader(target) {
  if (!target) return false;
  if (isDocumentShaderRuntimeActive(target)) return true;
  return !!readShaderFlag(target.doc, target.flagKey);
}

function getDocumentShaderEditableOptions(target) {
  const persisted = readShaderFlag(target?.doc, target?.flagKey) ?? {};
  const runtime = getDocumentShaderRuntimeSourceOpts(target) ?? {};
  const defaults = shaderManager.getDefaultImportedShaderDefaults?.() ?? {};
  const seed = foundry.utils.mergeObject(
    {
      shaderId: game.settings.get(MODULE_ID, "shaderPreset"),
      layer: String(defaults.layer ?? game.settings.get(MODULE_ID, "shaderLayer") ?? "inherit"),
      useGradientMask: defaults.useGradientMask ?? game.settings.get(MODULE_ID, "shaderGradientMask"),
      gradientMaskFadeStart: defaults.gradientMaskFadeStart ?? game.settings.get(MODULE_ID, "shaderGradientFadeStart"),
      alpha: defaults.alpha ?? game.settings.get(MODULE_ID, "shaderAlpha"),
      intensity: defaults.intensity ?? game.settings.get(MODULE_ID, "shaderIntensity"),
      speed: defaults.speed ?? game.settings.get(MODULE_ID, "shaderSpeed"),
      bloom: defaults.bloom ?? true,
      bloomStrength: defaults.bloomStrength ?? 1,
      bloomBlur: defaults.bloomBlur ?? 7,
      bloomQuality: defaults.bloomQuality ?? 2,
      scale: defaults.scale ?? game.settings.get(MODULE_ID, "shaderScale"),
      scaleX: defaults.scaleX ?? game.settings.get(MODULE_ID, "shaderScaleX"),
      scaleY: defaults.scaleY ?? game.settings.get(MODULE_ID, "shaderScaleY"),
      shaderRotationDeg: defaults.shaderRotationDeg ?? game.settings.get(MODULE_ID, "shaderRotationDeg"),
      shapeDistanceUnits: defaults.shapeDistanceUnits ?? game.settings.get(MODULE_ID, "shaderRadiusUnits"),
      scaleToToken: defaults.scaleToToken ?? false,
      tokenScaleMultiplier: defaults.tokenScaleMultiplier ?? 1,
      captureScale: defaults.captureScale ?? game.settings.get(MODULE_ID, "shaderCaptureScale"),
      captureRotationDeg: defaults.captureRotationDeg ?? 0,
      captureFlipHorizontal: defaults.captureFlipHorizontal ?? false,
      captureFlipVertical: defaults.captureFlipVertical ?? false,
      displayTimeMs: defaults.displayTimeMs ?? game.settings.get(MODULE_ID, "shaderDisplayTimeMs"),
      easeInMs: defaults.easeInMs ?? game.settings.get(MODULE_ID, "shaderEaseInMs"),
      easeOutMs: defaults.easeOutMs ?? game.settings.get(MODULE_ID, "shaderEaseOutMs")
    },
    foundry.utils.mergeObject(persisted, runtime, { inplace: false }),
    { inplace: false }
  );

  const opts = normalizeShaderMacroOpts(seed);
  if (!opts.shaderId) opts.shaderId = String(seed.shaderId ?? "");
  if (!opts.layer) opts.layer = "inherit";
  opts._disabled = parsePersistDisabled(persisted?._disabled);
  return opts;
}

function parseDocumentShaderForm(root, currentOpts) {
  const next = foundry.utils.mergeObject({}, currentOpts ?? {}, { inplace: false });
  const boolVal = (name, fallback = false) => {
    const input = root?.querySelector?.(`[name="${name}"]`);
    if (input instanceof HTMLInputElement) return input.checked === true;
    return fallback;
  };
  const strVal = (name, fallback = "") => {
    const value = String(root?.querySelector?.(`[name="${name}"]`)?.value ?? "").trim();
    return value || fallback;
  };
  const numVal = (name, fallback = 0) => {
    const n = Number(root?.querySelector?.(`[name="${name}"]`)?.value);
    return Number.isFinite(n) ? n : fallback;
  };

  next.shaderId = strVal("shaderId", String(next.shaderId ?? game.settings.get(MODULE_ID, "shaderPreset") ?? "noise"));
  next.layer = strVal("layer", String(next.layer ?? "inherit"));
  next.useGradientMask = boolVal("useGradientMask", next.useGradientMask === true);
  next.gradientMaskFadeStart = numVal("gradientMaskFadeStart", Number(next.gradientMaskFadeStart ?? 0.8));
  next.alpha = numVal("alpha", Number(next.alpha ?? 1));
  next.intensity = numVal("intensity", Number(next.intensity ?? 1));
  next.speed = numVal("speed", Number(next.speed ?? 1));
  next.scale = numVal("scale", Number(next.scale ?? 1));
  next.scaleX = numVal("scaleX", Number(next.scaleX ?? 1));
  next.scaleY = numVal("scaleY", Number(next.scaleY ?? 1));
  next.shaderRotationDeg = numVal("shaderRotationDeg", Number(next.shaderRotationDeg ?? 0));
  next.shapeDistanceUnits = numVal("shapeDistanceUnits", Number(next.shapeDistanceUnits ?? game.settings.get(MODULE_ID, "shaderRadiusUnits") ?? 20));
  next.scaleToToken = boolVal("scaleToToken", next.scaleToToken === true);
  next.tokenScaleMultiplier = numVal("tokenScaleMultiplier", Number(next.tokenScaleMultiplier ?? 1));
  next.captureScale = numVal("captureScale", Number(next.captureScale ?? 1));
  next.captureRotationDeg = numVal("captureRotationDeg", Number(next.captureRotationDeg ?? 0));
  next.captureFlipHorizontal = boolVal("captureFlipHorizontal", next.captureFlipHorizontal === true);
  next.captureFlipVertical = boolVal("captureFlipVertical", next.captureFlipVertical === true);
  next.displayTimeMs = Math.max(0, numVal("displayTimeMs", Number(next.displayTimeMs ?? 0)));
  next.easeInMs = Math.max(0, numVal("easeInMs", Number(next.easeInMs ?? 250)));
  next.easeOutMs = Math.max(0, numVal("easeOutMs", Number(next.easeOutMs ?? 250)));
  next.bloom = boolVal("bloom", next.bloom === true);
  next.bloomStrength = numVal("bloomStrength", Number(next.bloomStrength ?? 1));
  next.bloomBlur = numVal("bloomBlur", Number(next.bloomBlur ?? 7));
  next.bloomQuality = numVal("bloomQuality", Number(next.bloomQuality ?? 2));

  const enabledInput = root?.querySelector?.('[name="enabled"]');
  const enabled = enabledInput instanceof HTMLInputElement
    ? enabledInput.checked === true
    : !parsePersistDisabled(next?._disabled);

  return { next, enabled };
}

function runShaderOnTarget(target, opts) {
  if (!target?.id) return;
  if (target.targetType === "token") shaderOn(target.id, opts);
  else if (target.targetType === "tile") shaderOnTile(target.id, opts);
  else if (target.targetType === "template") shaderOnTemplate(target.id, opts);
}

function runShaderOffTarget(target, { skipPersist = false } = {}) {
  if (!target?.id) return;
  if (target.targetType === "token") shaderOff(target.id, { skipPersist });
  else if (target.targetType === "tile") shaderOffTile(target.id, { skipPersist });
  else if (target.targetType === "template") shaderOffTemplate(target.id, { skipPersist });
}

function broadcastShaderOnTarget(target, opts, { force = false } = {}) {
  if (!target?.id) return;
  if (force) broadcastShaderOffTarget(target);
  if (target.targetType === "token") broadcastShaderOn({ tokenId: target.id, opts });
  else if (target.targetType === "tile") broadcastShaderOnTile({ tileId: target.id, opts });
  else if (target.targetType === "template") broadcastShaderOnTemplate({ templateId: target.id, opts });
  else runShaderOnTarget(target, opts);
}

function broadcastShaderOffTarget(target) {
  if (!target?.id) return;
  if (target.targetType === "token") broadcastShaderOff({ tokenId: target.id });
  else if (target.targetType === "tile") broadcastShaderOffTile({ tileId: target.id });
  else if (target.targetType === "template") broadcastShaderOffTemplate({ templateId: target.id });
  else runShaderOffTarget(target);
}

async function openDocumentShaderConfigDialog(app) {
  const target = resolveDocumentShaderTargetFromApp(app);
  if (!target) return;

  const current = getDocumentShaderEditableOptions(target);
  const baselineFlagRaw = readShaderFlag(target.doc, target.flagKey);
  const baselineFlag = baselineFlagRaw ? foundry.utils.deepClone(baselineFlagRaw) : null;
  const getActiveEntry = () => {
    if (target.targetType === "token") return _activeShader.get(target.id) ?? null;
    if (target.targetType === "tile") return _activeTileShader.get(target.id) ?? null;
    if (target.targetType === "template") return _activeTemplateShader.get(target.id) ?? null;
    return null;
  };
  const baselineActiveEntry = getActiveEntry();
  const baselineWasActive = !!baselineActiveEntry;
  const baselineRuntimeOpts = baselineActiveEntry?.sourceOpts
    ? foundry.utils.deepClone(baselineActiveEntry.sourceOpts)
    : null;

  const shaderChoices = target.targetType === "template"
    ? shaderManager.getShaderChoicesForTarget("template")
    : shaderManager.getShaderChoices();
  const shaderOptions = Object.entries(shaderChoices)
    .map(([id, label]) => `<option value="${escapeHtml(id)}" ${id === String(current.shaderId ?? "") ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  const layerOptions = Object.entries(SHADER_LAYER_CHOICES)
    .map(([id, label]) => `<option value="${escapeHtml(id)}" ${id === String(current.layer ?? "inherit") ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  const enabled = !parsePersistDisabled(current?._disabled);

  const checkbox = (name, checked) =>
    `<input type="checkbox" name="${name}" ${checked ? "checked" : ""}>`;
  const number = (name, value, attrs = "") =>
    `<input type="number" name="${name}" value="${escapeHtml(value)}" ${attrs}>`;

  const content = `
<form class="indy-fx-doc-shader-config" style="max-height:min(74vh, calc(100vh - 240px));overflow-y:auto;overflow-x:hidden;padding-right:0.35rem;">
  <div class="form-group"><label>Enabled</label><div class="form-fields">${checkbox("enabled", enabled)}</div></div>
  <div class="form-group"><label>Shader</label><div class="form-fields"><select name="shaderId">${shaderOptions}</select></div></div>
  <div class="form-group"><label>Layer</label><div class="form-fields"><select name="layer">${layerOptions}</select></div></div>
  <div class="form-group"><label>Gradient Mask</label><div class="form-fields">${checkbox("useGradientMask", current.useGradientMask === true)}</div></div>
  <div class="form-group"><label>Gradient Fade Start</label><div class="form-fields">${number("gradientMaskFadeStart", current.gradientMaskFadeStart ?? 0.8, 'step="0.01" min="0" max="1"')}</div></div>
  <div class="form-group"><label>Alpha</label><div class="form-fields">${number("alpha", current.alpha ?? 1, 'step="0.01" min="0" max="1"')}</div></div>
  <div class="form-group"><label>Intensity</label><div class="form-fields">${number("intensity", current.intensity ?? 1, 'step="0.1" min="0" max="50"')}</div></div>
  <div class="form-group"><label>Speed</label><div class="form-fields">${number("speed", current.speed ?? 1, 'step="0.05" min="0"')}</div></div>
  <div class="form-group"><label>Scale</label><div class="form-fields">${number("scale", current.scale ?? 1, 'step="0.05" min="0"')}</div></div>
  <details>
    <summary style="cursor:pointer;user-select:none;">Scale options</summary>
    <div class="form-group" style="margin-top:0.35rem;"><label>Scale X</label><div class="form-fields">${number("scaleX", current.scaleX ?? 1, 'step="0.05" min="0"')}</div></div>
    <div class="form-group"><label>Scale Y</label><div class="form-fields">${number("scaleY", current.scaleY ?? 1, 'step="0.05" min="0"')}</div></div>
  </details>
  <div class="form-group"><label>Shader Rotation (deg)</label><div class="form-fields">${number("shaderRotationDeg", current.shaderRotationDeg ?? 0, 'step="1"')}</div></div>
  <div class="form-group"><label>Distance (units)</label><div class="form-fields">${number("shapeDistanceUnits", current.shapeDistanceUnits ?? game.settings.get(MODULE_ID, "shaderRadiusUnits") ?? 20, 'step="0.1" min="0"')}</div></div>
  <div class="form-group"><label>Scale To Token</label><div class="form-fields">${checkbox("scaleToToken", current.scaleToToken === true)}</div></div>
  <div class="form-group"><label>Token Scale Multiplier</label><div class="form-fields">${number("tokenScaleMultiplier", current.tokenScaleMultiplier ?? 1, 'step="0.01" min="0.01" max="10"')}</div></div>
  <div class="form-group"><label>Capture Scale</label><div class="form-fields">${number("captureScale", current.captureScale ?? 1, 'step="0.1" min="0.01"')}</div></div>
  <details>
    <summary style="cursor:pointer;user-select:none;">Capture options</summary>
    <div class="form-group" style="margin-top:0.35rem;"><label>Capture Rotation (deg)</label><div class="form-fields">${number("captureRotationDeg", current.captureRotationDeg ?? 0, 'step="0.1"')}</div></div>
    <div class="form-group"><label>Capture Flip Horizontal</label><div class="form-fields">${checkbox("captureFlipHorizontal", current.captureFlipHorizontal === true)}</div></div>
    <div class="form-group"><label>Capture Flip Vertical</label><div class="form-fields">${checkbox("captureFlipVertical", current.captureFlipVertical === true)}</div></div>
  </details>
  <div class="form-group"><label>Display Time (ms)</label><div class="form-fields">${number("displayTimeMs", current.displayTimeMs ?? 0, 'step="1" min="0"')}</div></div>
  <details>
    <summary style="cursor:pointer;user-select:none;">Display timing options</summary>
    <div class="form-group" style="margin-top:0.35rem;"><label>Ease In (ms)</label><div class="form-fields">${number("easeInMs", current.easeInMs ?? 250, 'step="1" min="0"')}</div></div>
    <div class="form-group"><label>Ease Out (ms)</label><div class="form-fields">${number("easeOutMs", current.easeOutMs ?? 250, 'step="1" min="0"')}</div></div>
  </details>
  <div class="form-group"><label>Bloom</label><div class="form-fields">${checkbox("bloom", current.bloom === true)}</div></div>
  <details>
    <summary style="cursor:pointer;user-select:none;">Bloom options</summary>
    <div class="form-group" style="margin-top:0.35rem;"><label>Bloom Strength</label><div class="form-fields">${number("bloomStrength", current.bloomStrength ?? 1, 'step="0.05" min="0"')}</div></div>
    <div class="form-group"><label>Bloom Blur</label><div class="form-fields">${number("bloomBlur", current.bloomBlur ?? 7, 'step="0.1" min="0"')}</div></div>
    <div class="form-group"><label>Bloom Quality</label><div class="form-fields">${number("bloomQuality", current.bloomQuality ?? 2, 'step="0.1" min="0"')}</div></div>
  </details>
</form>`;

  const resolveDialogRoot = (dialog) => (
    dialog?.element?.[0] ??
    dialog?.element ??
    dialog
  );

  const restoreOriginalState = async () => {
    const baselineDisabled = parsePersistDisabled(baselineFlag?._disabled);

    if (baselineWasActive) {
      const restoreOpts = foundry.utils.mergeObject(
        {},
        baselineRuntimeOpts ?? baselineFlag ?? {},
        { inplace: false },
      );
      delete restoreOpts._disabled;
      delete restoreOpts._skipPersist;
      broadcastShaderOnTarget(target, restoreOpts);
    } else {
      broadcastShaderOffTarget(target);
    }

    if (baselineFlag) {
      await writeShaderFlag(target.doc, target.flagKey, foundry.utils.deepClone(baselineFlag));
      if (baselineDisabled) {
        broadcastShaderOffTarget(target);
      }
    } else {
      await clearShaderFlag(target.doc, target.flagKey);
    }
  };

  const applyAction = async (dialog, action) => {
    const root = resolveDialogRoot(dialog);
    const form = root?.querySelector?.("form.indy-fx-doc-shader-config") ?? root;
    const enabledInput = form?.querySelector?.('[name="enabled"]');

    if (action === "remove") {
      broadcastShaderOffTarget(target);
      await clearShaderFlag(target.doc, target.flagKey);
      if (enabledInput instanceof HTMLInputElement) enabledInput.checked = false;
      ui.notifications.info("indyFX effect removed.");
      return;
    }

    if (action === "toggle" && enabledInput instanceof HTMLInputElement) {
      enabledInput.checked = !enabledInput.checked;
    }

    const { next, enabled: checkedEnabled } = parseDocumentShaderForm(form, current);
    const enabledState = checkedEnabled;

    if (!enabledState) {
      broadcastShaderOffTarget(target);
      await writeShaderFlag(target.doc, target.flagKey, {
        ...next,
        _disabled: true
      });
      debugLog("document shader dialog persisted disabled", {
        targetType: target?.targetType ?? null,
        targetId: target?.id ?? null,
        flagKey: target?.flagKey ?? null,
        shaderId: next?.shaderId ?? null,
      });
      ui.notifications.info("indyFX effect disabled.");
      return;
    }

    const runOpts = foundry.utils.mergeObject({}, next, { inplace: false });
    delete runOpts._disabled;

    // Force redraw for active effects; shaderOn short-circuits when an entry already exists.
    broadcastShaderOnTarget(target, runOpts, { force: true });
    debugLog("document shader dialog persisted enabled", {
      targetType: target?.targetType ?? null,
      targetId: target?.id ?? null,
      flagKey: target?.flagKey ?? null,
      shaderId: runOpts?.shaderId ?? null,
      persisted: shouldPersistDocumentShader(next),
      displayTimeMs: next?.displayTimeMs ?? null,
    });
    ui.notifications.info(action === "save" ? "indyFX effect saved." : "indyFX effect applied.");
  };

  const dlg = new foundry.applications.api.DialogV2({
    window: {
      title: `indyFX: ${target.targetType} ${target.id}`,
      resizable: true
    },
    content,
    buttons: [
      {
        action: "save",
        label: "Save",
        icon: "fas fa-save",
        default: true,
        close: false,
        callback: (_event, _button, dialog) => {
          void applyAction(dialog, "save");
          return false;
        }
      },
      {
        action: "apply",
        label: "Apply",
        icon: "fas fa-check",
        close: false,
        callback: (_event, _button, dialog) => {
          void applyAction(dialog, "apply");
          return false;
        }
      },
      {
        action: "toggle",
        label: "Toggle Visibility",
        icon: "fas fa-eye",
        close: false,
        callback: (_event, _button, dialog) => {
          void applyAction(dialog, "toggle");
          return false;
        }
      },
      {
        action: "remove",
        label: "Remove",
        icon: "fas fa-trash",
        close: false,
        callback: async (_event, _button, dialog) => {
          await applyAction(dialog, "remove");
          return false;
        }
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fas fa-times",
        callback: async () => {
          await restoreOriginalState();
        }
      }
    ]
  });

  const bindPersistentActionButtons = () => {
    const root = resolveDialogRoot(dlg);
    if (!(root instanceof Element)) return;
    if (root.dataset.indyFxPersistButtonsBound === "1") return;
    root.dataset.indyFxPersistButtonsBound = "1";
    root.addEventListener("click", (event) => {
      const targetEl = event.target instanceof Element ? event.target : null;
      const actionButton = targetEl?.closest?.("[data-action]");
      if (!(actionButton instanceof Element)) return;
      const action = String(actionButton.getAttribute("data-action") ?? "").trim().toLowerCase();
      if (!["save", "apply", "toggle", "remove"].includes(action)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      void applyAction(dlg, action);
    }, true);
  };

  await dlg.render(true);
  bindPersistentActionButtons();
  setTimeout(() => bindPersistentActionButtons(), 0);
}

function addIndyFxDocumentConfigButton(app, buttons) {
  if (!Array.isArray(buttons)) return;
  const target = resolveDocumentShaderTargetFromApp(app);
  if (!target) return;

  if (!documentHasAnyShader(target)) return;

  const already = buttons.some((btn) => {
    const cls = String(btn?.class ?? "").toLowerCase();
    const action = String(btn?.action ?? "").toLowerCase();
    const label = String(btn?.label ?? "").toLowerCase();
    return cls === "indyfx-config" || action === "indyfx-config" || label === "indyfx";
  });
  if (already) return;

  const onClick = () => {
    void openDocumentShaderConfigDialog(app);
  };

  buttons.unshift({
    label: "indyFX",
    class: "indyfx-config",
    action: "indyfx-config",
    icon: "fa-jelly fa-regular fa-sparkles",
    onclick: onClick,
    onClick,
  });
}

function documentHasEnabledShader(target) {
  if (!target) return false;
  if (isDocumentShaderRuntimeActive(target)) return true;
  const persisted = readShaderFlag(target.doc, target.flagKey);
  if (!persisted || typeof persisted !== "object") return false;
  return !parsePersistDisabled(persisted._disabled);
}

function resolveHudRoot(targetType, app, html) {
  const preferClass = targetType === "tile"
    ? "tile-hud"
    : (targetType === "template" ? "template-hud" : "token-hud");
  const coerceElement = (value) => {
    const direct = value?.[0] ?? value;
    if (direct instanceof HTMLElement) return direct;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry instanceof HTMLElement) return entry;
      }
    }
    if (value instanceof NodeList || value instanceof HTMLCollection) {
      for (const entry of value) {
        if (entry instanceof HTMLElement) return entry;
      }
    }
    return null;
  };

  const candidates = [
    coerceElement(html),
    coerceElement(app?.element),
    coerceElement(app?.html),
  ].filter((entry) => entry instanceof HTMLElement);

  for (const candidate of candidates) {
    const hudFromSelf =
      candidate.matches?.(`.placeable-hud.${preferClass}`) ||
      candidate.matches?.(".placeable-hud")
        ? candidate
        : null;
    const hudFromClosest =
      candidate.closest?.(`.placeable-hud.${preferClass}`) ??
      candidate.closest?.(".placeable-hud");
    const hudFromChildren = candidate.querySelector?.(
      `.placeable-hud.${preferClass}, .placeable-hud`,
    );
    const resolved = hudFromSelf ?? hudFromClosest ?? hudFromChildren;
    if (resolved instanceof HTMLElement) return resolved;
  }

  const fallback = document.querySelector(
    targetType === "tile"
      ? ".placeable-hud.tile-hud, #hud .tile-hud, #tile-hud"
      : (targetType === "template"
        ? ".placeable-hud.template-hud, #hud .template-hud, #template-hud"
        : ".placeable-hud.token-hud, #hud .token-hud, #token-hud"),
  );
  if (fallback instanceof HTMLElement) return fallback;

  return null;
}

function resolveHudPlaceableId(targetType, app, data) {
  const fromObject =
    app?.object?.id ??
    app?.object?.document?.id ??
    app?.token?.id ??
    app?.tile?.id ??
    app?.template?.id ??
    data?._id ??
    data?.id ??
    null;
  if (!fromObject) return null;
  const id = String(fromObject).trim();
  if (!id) return null;
  if (targetType === "token") return resolveTokenId(id);
  if (targetType === "tile") return resolveTileId(id);
  if (targetType === "template") return resolveTemplateId(id);
  return id;
}

function addIndyFxHudEditButton({ targetType, app, html, data } = {}) {
  if (targetType !== "token" && targetType !== "tile" && targetType !== "template") return;

  const id = resolveHudPlaceableId(targetType, app, data);
  if (!id) {
    debugLog("hud edit button skipped: no placeable id", {
      targetType,
      appClass: app?.constructor?.name ?? null,
      dataId: data?._id ?? data?.id ?? null,
    });
    return;
  }

  const doc =
    targetType === "token"
      ? getTokenShaderDocument(id)
      : (targetType === "tile"
        ? getTileShaderDocument(id)
        : getTemplateShaderDocument(id));
  if (!doc) {
    debugLog("hud edit button skipped: no document", {
      targetType,
      id,
      appClass: app?.constructor?.name ?? null,
    });
    return;
  }

  const target = {
    targetType,
    id,
    doc,
    flagKey:
      targetType === "token"
        ? TOKEN_SHADER_FLAG
        : (targetType === "tile" ? TILE_SHADER_FLAG : TEMPLATE_SHADER_FLAG),
  };

  const root = resolveHudRoot(targetType, app, html);
  if (!(root instanceof HTMLElement)) {
    debugLog("hud edit button skipped: no root element", {
      targetType,
      id,
      appClass: app?.constructor?.name ?? null,
    });
    return;
  }

  const actionName = "indyfx-edit-shader";
  const existing = root.querySelector(`[data-action="${actionName}"]`);

  const runtimeActive = isDocumentShaderRuntimeActive(target);
  const persisted = readShaderFlag(target.doc, target.flagKey);
  const persistedDisabled = parsePersistDisabled(persisted?._disabled);

  if (!documentHasAnyShader(target)) {
    existing?.remove?.();
    debugLog("hud edit button skipped: no shader", {
      targetType,
      id,
      runtimeActive,
      hasPersisted: !!persisted,
      persistedDisabled,
    });
    return;
  }

  if (existing instanceof HTMLElement) {
    debugLog("hud edit button already present", {
      targetType,
      id,
      runtimeActive,
      hasPersisted: !!persisted,
      persistedDisabled,
    });
    return;
  }

  const host =
    root.querySelector(".col.right") ??
    root.querySelector(".col.left") ??
    root.querySelector(".control-icons") ??
    root;
  if (!(host instanceof HTMLElement)) {
    debugLog("hud edit button skipped: no host", {
      targetType,
      id,
      rootTag: root?.tagName ?? null,
    });
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon indyfx-hud-edit-shader";
  button.dataset.action = actionName;
  button.title = "Edit indyFX";
  button.setAttribute("data-tooltip", "Edit indyFX");
  button.innerHTML = '<i class="fa-solid fa-pen-to-square" inert></i>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openDocumentShaderConfigDialog({ document: doc, object: app?.object ?? null });
  });

  host.appendChild(button);
  debugLog("hud edit button inserted", {
    targetType,
    id,
    runtimeActive,
    hasPersisted: !!persisted,
    persistedDisabled,
    rootTag: root?.tagName ?? null,
    hostClass: host?.className ?? null,
  });
}

function createRegionEffectKey(regionId, behaviorId = null) {
  if (behaviorId) return `behavior:${regionId}:${behaviorId}`;
  return `runtime:${regionId}:${foundry.utils.randomID()}`;
}

function registerActiveRegionShaderEntry(effectKey, entry) {
  if (!effectKey || !entry) return;
  _activeRegionShader.set(effectKey, entry);
  const regionId = entry.regionId;
  if (!regionId) return;
  let keys = _activeRegionShaderByRegion.get(regionId);
  if (!keys) {
    keys = new Set();
    _activeRegionShaderByRegion.set(regionId, keys);
  }
  keys.add(effectKey);
}

function unregisterActiveRegionShaderEntry(effectKey) {
  const entry = _activeRegionShader.get(effectKey);
  if (!entry) return null;
  _activeRegionShader.delete(effectKey);

  const regionId = entry.regionId;
  if (!regionId) return entry;
  const keys = _activeRegionShaderByRegion.get(regionId);
  if (!keys) return entry;
  keys.delete(effectKey);
  if (!keys.size) _activeRegionShaderByRegion.delete(regionId);
  return entry;
}

function getActiveRegionShaderEntries(regionId, { fromBehavior = null } = {}) {
  const resolvedRegionId = resolveRegionId(regionId);
  if (!resolvedRegionId) return [];
  const keys = _activeRegionShaderByRegion.get(resolvedRegionId);
  if (!keys?.size) return [];

  const entries = [];
  for (const key of keys) {
    const entry = _activeRegionShader.get(key);
    if (!entry) continue;
    if (fromBehavior === null || entry.fromBehavior === fromBehavior) {
      entries.push(entry);
    }
  }
  return entries;
}

function hasActiveRegionShader(regionId, { fromBehavior = null } = {}) {
  return getActiveRegionShaderEntries(regionId, { fromBehavior }).length > 0;
}

function getActiveRegionShaderEntryByBehavior(regionId, behaviorId) {
  const resolvedBehaviorId = String(behaviorId ?? "");
  if (!resolvedBehaviorId) return null;
  const activeEntries = getActiveRegionShaderEntries(regionId, { fromBehavior: true });
  return activeEntries.find((entry) => String(entry.behaviorId ?? "") === resolvedBehaviorId) ?? null;
}

function setCenterFromWorld(container, center, worldLayer) {
  if (worldLayer?.toLocal && canvas.stage) {
    _tmpPoint.set(center.x, center.y);
    const p = worldLayer.toLocal(_tmpPoint, canvas.stage, _tmpPoint);
    container.position.set(p.x, p.y);
    return;
  }
  container.position.set(center.x, center.y);
}

function setCenter(container, tok, worldLayer) {
  if (worldLayer === tok?.mesh) {
    container.position.set(0, 0);
    return;
  }
  if (worldLayer === tok) {
    const w = Number(tok?.w ?? tok?.width ?? 0);
    const h = Number(tok?.h ?? tok?.height ?? 0);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      container.position.set(w * 0.5, h * 0.5);
      return;
    }
  }
  setCenterFromWorld(container, getTokenCenter(tok), worldLayer);
}

function updateDebugGfxAtWorld(gfx, center, worldLayer, radius) {
  if (!gfx) return;
  let x = center.x;
  let y = center.y;
  if (worldLayer?.toLocal && canvas.stage) {
    _tmpPoint.set(center.x, center.y);
    const p = worldLayer.toLocal(_tmpPoint, canvas.stage, _tmpPoint);
    x = p.x;
    y = p.y;
  }
  gfx.clear();
  gfx.lineStyle(2, 0x00FF00, 0.9);
  gfx.drawCircle(x, y, radius);
  gfx.lineStyle(1, 0xFF00FF, 0.9);
  gfx.drawCircle(x, y, 6);
}

function updateDebugGfx(gfx, tok, worldLayer, radius) {
  updateDebugGfxAtWorld(gfx, getTokenCenter(tok), worldLayer, radius);
}

function updateSpriteDebugGfx(gfx, radius) {
  if (!gfx) return;
  gfx.clear();
  gfx.lineStyle(2, 0x00FFFF, 0.9);
  gfx.drawCircle(0, 0, radius);
  gfx.lineStyle(1, 0xFFFFFF, 0.9);
  gfx.moveTo(-radius, 0);
  gfx.lineTo(radius, 0);
  gfx.moveTo(0, -radius);
  gfx.lineTo(0, radius);
}

let networkController = null;

function getLastSceneTokenId() {
  const sceneTokens = canvas.scene?.tokens?.contents;
  if (Array.isArray(sceneTokens) && sceneTokens.length) {
    const last = sceneTokens[sceneTokens.length - 1];
    return last?.id ?? null;
  }
  const placeables = canvas.tokens?.placeables;
  if (Array.isArray(placeables) && placeables.length) {
    const last = placeables[placeables.length - 1];
    return last?.id ?? last?.document?.id ?? null;
  }
  return null;
}

function resolveTokenId(tokenId) {
  return tokenId ?? getLastSceneTokenId();
}
function getLastSceneTemplateId() {
  const sceneTemplates = canvas.scene?.templates?.contents;
  if (Array.isArray(sceneTemplates) && sceneTemplates.length) {
    const last = sceneTemplates[sceneTemplates.length - 1];
    return last?.id ?? null;
  }
  const placeables = canvas.templates?.placeables;
  if (Array.isArray(placeables) && placeables.length) {
    const last = placeables[placeables.length - 1];
    return last?.id ?? last?.document?.id ?? null;
  }
  return null;
}

function resolveTemplateId(templateId) {
  return templateId ?? getLastSceneTemplateId();
}

function getTemplateOrigin(template) {
  const preview = template?._preview ?? template?.preview;
  const live = (preview && preview.destroyed !== true) ? preview : template;
  const doc = live?.document ?? live;
  return {
    x: Number(doc?.x ?? live?.x ?? 0),
    y: Number(doc?.y ?? live?.y ?? 0)
  };
}

function getTemplateShapeSignature(template) {
  const doc = template?.document ?? template;
  const num = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(4) : "nan";
  return [
    String(doc?.t ?? ""),
    num(doc?.distance),
    num(doc?.width),
    num(doc?.angle),
    num(doc?.direction)
  ].join("|");
}

function getShaderGeometryFromTemplate(template, fallbackRadiusUnits) {
  const doc = template?.document ?? template;
  const type = String(doc?.t ?? "circle").toLowerCase();
  const distanceUnits = Math.max(0.01, parseDistanceValue(doc?.distance, fallbackRadiusUnits));
  const directionDeg = Number.isFinite(Number(doc?.direction)) ? Number(doc.direction) : 0;
  const coneAngleDeg = Math.max(1, Math.min(179, Number(doc?.angle ?? 60)));
  const widthUnits = Math.max(0.01, parseDistanceValue(doc?.width, 5));

  if (type === "cone") {
    return {
      shape: "cone",
      shapeDirectionDeg: directionDeg,
      shapeDistanceUnits: distanceUnits,
      coneAngleDeg
    };
  }

  if (type === "ray") {
    return {
      shape: "line",
      shapeDirectionDeg: directionDeg,
      shapeDistanceUnits: distanceUnits,
      lineWidthUnits: widthUnits
    };
  }

  if (type === "rect") {
    return {
      shape: "rectangle",
      shapeDirectionDeg: directionDeg,
      shapeDistanceUnits: distanceUnits,
      lineWidthUnits: widthUnits
    };
  }

  return {
    shape: "circle",
    shapeDirectionDeg: directionDeg,
    shapeDistanceUnits: distanceUnits,
    radiusUnits: distanceUnits
  };
}

function getLastSceneRegionId() {
  const sceneRegions = canvas.scene?.regions?.contents;
  if (Array.isArray(sceneRegions) && sceneRegions.length) {
    const last = sceneRegions[sceneRegions.length - 1];
    return last?.id ?? null;
  }
  const placeables = canvas.regions?.placeables;
  if (Array.isArray(placeables) && placeables.length) {
    const last = placeables[placeables.length - 1];
    return last?.id ?? last?.document?.id ?? null;
  }
  return null;
}

function resolveRegionId(regionId) {
  return regionId ?? getLastSceneRegionId();
}

function getLastSceneTileId() {
  const sceneTiles = canvas.scene?.tiles?.contents;
  if (Array.isArray(sceneTiles) && sceneTiles.length) {
    const last = sceneTiles[sceneTiles.length - 1];
    return last?.id ?? null;
  }
  const placeables = canvas.tiles?.placeables;
  if (Array.isArray(placeables) && placeables.length) {
    const last = placeables[placeables.length - 1];
    return last?.id ?? last?.document?.id ?? null;
  }
  return null;
}

function resolveTileId(tileId) {
  return tileId ?? getLastSceneTileId();
}

function getTilePlaceable(tileId) {
  if (!tileId) return null;
  return canvas.tiles?.get?.(tileId)
    ?? canvas.tiles?.placeables?.find((t) => (t?.id === tileId || t?.document?.id === tileId))
    ?? null;
}

function getTileMetrics(tile) {
  const preview = tile?._preview ?? tile?.preview;
  const live = (preview && preview.destroyed !== true) ? preview : tile;
  const doc = live?.document ?? live;
  const x = Number(doc?.x ?? live?.x ?? 0);
  const y = Number(doc?.y ?? live?.y ?? 0);
  const width = Math.max(1, Number(doc?.width ?? live?.width ?? live?.w ?? 1));
  const height = Math.max(1, Number(doc?.height ?? live?.height ?? live?.h ?? 1));
  const rotationDeg = Number(doc?.rotation ?? live?.rotation ?? 0);
  const rotationRad = (Number.isFinite(rotationDeg) ? rotationDeg : 0) * (Math.PI / 180);
  return {
    x,
    y,
    width,
    height,
    rotationDeg: Number.isFinite(rotationDeg) ? rotationDeg : 0,
    rotationRad,
    center: {
      x: x + (width * 0.5),
      y: y + (height * 0.5)
    }
  };
}

function getTileShapeSignature(tile) {
  const m = getTileMetrics(tile);
  const num = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(4) : "nan";
  return [num(m.x), num(m.y), num(m.width), num(m.height), num(m.rotationDeg)].join("|");
}
function shouldPersistRegionShader(cfg) {
  const ms = Number(cfg?.displayTimeMs ?? 0);
  return !(Number.isFinite(ms) && ms > 0);
}

function getRegionPlaceable(regionId) {
  if (!regionId) return null;
  return canvas.regions?.get?.(regionId)
    ?? canvas.regions?.placeables?.find((r) => (r?.id === regionId || r?.document?.id === regionId))
    ?? null;
}

function getRegionDocument(regionOrId) {
  if (!regionOrId) return null;
  if (typeof regionOrId === "string") {
    const region = getRegionPlaceable(regionOrId);
    return region?.document ?? canvas.scene?.regions?.get?.(regionOrId) ?? null;
  }
  if (regionOrId?.document) return regionOrId.document;
  if (regionOrId?.behaviors) return regionOrId;
  return null;
}

function getRegionBehaviorDocuments(regionOrId) {
  const doc = getRegionDocument(regionOrId);
  const collection = doc?.behaviors;
  if (!collection) return [];
  if (Array.isArray(collection.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function getRegionShaderBehaviorDocuments(regionOrId, { includeDisabled = false } = {}) {
  return getRegionBehaviorDocuments(regionOrId).filter((behavior) => {
    if (!isRegionShaderBehaviorType(behavior?.type)) return false;
    if (!includeDisabled && behavior?.disabled) return false;
    return true;
  });
}

function getPrimaryRegionShaderBehavior(regionOrId) {
  const behaviors = getRegionShaderBehaviorDocuments(regionOrId);
  if (!behaviors.length) return null;
  const modern = behaviors.filter((b) => b?.type === REGION_SHADER_BEHAVIOR_TYPE);
  const source = modern.length ? modern : behaviors;
  return source[source.length - 1];
}

function getRegionShaderBehaviorEntries(regionOrId) {
  const behaviors = getRegionShaderBehaviorDocuments(regionOrId);
  return behaviors
    .map((behavior) => {
      const behaviorId = behavior?.id ?? null;
      if (!behaviorId) return null;
      return {
        behavior,
        behaviorId,
        opts: getRegionShaderBehaviorSystemData(MODULE_ID, behavior)
      };
    })
    .filter((entry) => !!entry);
}

async function upsertRegionShaderBehavior(regionOrId, opts = {}, { muteSync = false, behaviorId = null } = {}) {
  if (!game.user?.isGM) return null;
  const doc = getRegionDocument(regionOrId);
  if (!doc?.createEmbeddedDocuments || !doc?.updateEmbeddedDocuments || !doc?.deleteEmbeddedDocuments) return null;
  const regionId = doc?.id ?? null;
  if (muteSync && regionId) _muteRegionBehaviorSync.add(regionId);

  try {
    const behaviors = getRegionShaderBehaviorDocuments(doc, { includeDisabled: true });
    const requestedBehaviorId = String(behaviorId ?? opts?._behaviorId ?? "");
    const target = requestedBehaviorId
      ? (behaviors.find((b) => String(b?.id ?? "") === requestedBehaviorId) ?? null)
      : null;

    const systemData = buildRegionShaderBehaviorSystemData(MODULE_ID, opts, { getShaderChoices: () => shaderManager.getShaderChoicesForTarget("region") });
    if (target) {
      const current = getRegionShaderBehaviorSystemData(MODULE_ID, target);
      const hasSystemDiff = !foundry.utils.isEmpty(foundry.utils.diffObject(current, systemData));
      if (hasSystemDiff || target.disabled === true) {
        await doc.updateEmbeddedDocuments("RegionBehavior", [{
          _id: target.id,
          type: REGION_SHADER_BEHAVIOR_TYPE,
          disabled: false,
          system: systemData
        }]);
      }
      return target.id;
    }

    const created = await doc.createEmbeddedDocuments("RegionBehavior", [{
      type: REGION_SHADER_BEHAVIOR_TYPE,
      name: "indyFX",
      disabled: false,
      system: systemData
    }]);
    return created?.[0]?.id ?? null;
  } finally {
    if (muteSync && regionId) _muteRegionBehaviorSync.delete(regionId);
  }
}

async function clearRegionShaderBehaviors(regionOrId, { muteSync = false } = {}) {
  if (!game.user?.isGM) return;
  const doc = getRegionDocument(regionOrId);
  if (!doc?.deleteEmbeddedDocuments) return;
  const regionId = doc?.id ?? null;
  if (muteSync && regionId) _muteRegionBehaviorSync.add(regionId);
  try {
    const ids = getRegionShaderBehaviorDocuments(doc, { includeDisabled: true }).map((b) => b?.id).filter((id) => !!id);
    if (!ids.length) return;
    await doc.deleteEmbeddedDocuments("RegionBehavior", ids);
  } finally {
    if (muteSync && regionId) _muteRegionBehaviorSync.delete(regionId);
  }
}

async function clearRegionShaderBehaviorById(regionOrId, behaviorId, { muteSync = false } = {}) {
  if (!game.user?.isGM) return false;
  const doc = getRegionDocument(regionOrId);
  if (!doc?.deleteEmbeddedDocuments) return false;
  const regionId = doc?.id ?? null;
  const targetId = String(behaviorId ?? "");
  if (!targetId) return false;
  if (muteSync && regionId) _muteRegionBehaviorSync.add(regionId);
  try {
    const ids = getRegionShaderBehaviorDocuments(doc, { includeDisabled: true })
      .filter((b) => String(b?.id ?? "") === targetId)
      .map((b) => b?.id)
      .filter((id) => !!id);
    if (!ids.length) return false;
    await doc.deleteEmbeddedDocuments("RegionBehavior", ids);
    return true;
  } finally {
    if (muteSync && regionId) _muteRegionBehaviorSync.delete(regionId);
  }
}

function syncRegionShaderFromBehavior(regionId, { rebuild = true } = {}) {
  const resolvedRegionId = resolveRegionId(regionId);
  if (!resolvedRegionId) return false;
  const region = getRegionPlaceable(resolvedRegionId);
  if (!region) return false;

  const behaviorEntries = getRegionShaderBehaviorEntries(region);
  if (!behaviorEntries.length) {
    const activeFromBehavior = getActiveRegionShaderEntries(resolvedRegionId, { fromBehavior: true });
    for (const active of activeFromBehavior) {
      shaderOffRegion(resolvedRegionId, { skipPersist: true, fromBehavior: true, effectKey: active.effectKey });
    }
    return false;
  }

  const behaviorIds = new Set(behaviorEntries.map((entry) => String(entry.behaviorId)));
  const existingFromBehavior = getActiveRegionShaderEntries(resolvedRegionId, { fromBehavior: true });
  if (rebuild) {
    for (const active of existingFromBehavior) {
      shaderOffRegion(resolvedRegionId, { skipPersist: true, fromBehavior: true, effectKey: active.effectKey });
    }
  }

  for (const entry of behaviorEntries) {
    if (!rebuild && getActiveRegionShaderEntryByBehavior(resolvedRegionId, entry.behaviorId)) continue;
    const shaderOpts = foundry.utils.mergeObject({}, entry.opts ?? {}, { inplace: false });
    shaderOpts._fromBehavior = true;
    shaderOpts._behaviorId = entry.behaviorId;
    shaderOpts._skipPersist = true;
    shaderOnRegion(resolvedRegionId, shaderOpts);
  }

  const activeAfterSync = getActiveRegionShaderEntries(resolvedRegionId, { fromBehavior: true });
  for (const active of activeAfterSync) {
    const activeBehaviorId = String(active.behaviorId ?? "");
    if (!behaviorIds.has(activeBehaviorId)) {
      shaderOffRegion(resolvedRegionId, { skipPersist: true, fromBehavior: true, effectKey: active.effectKey });
    }
  }

  return true;
}

function restoreRegionShaderBehaviors() {
  const regions = canvas.regions?.placeables ?? [];
  const regionIds = new Set();
  for (const region of regions) {
    const regionId = region?.document?.id ?? region?.id;
    if (!regionId) continue;
    regionIds.add(regionId);
    syncRegionShaderFromBehavior(regionId, { rebuild: true });
  }

  for (const entry of Array.from(_activeRegionShader.values())) {
    if (!entry?.fromBehavior) continue;
    if (!regionIds.has(entry.regionId)) {
      shaderOffRegion(entry.regionId, { skipPersist: true, fromBehavior: true, effectKey: entry.effectKey });
    }
  }
}

function getPersistedShaderId(opts) {
  if (!opts || typeof opts !== "object") return "";
  const candidates = [
    opts.shaderId,
    opts.shaderPreset,
    opts.shaderMode,
    opts?.defaults?.shaderId,
    opts?.defaults?.shaderPreset,
    opts?.defaults?.shaderMode,
  ];
  for (const candidate of candidates) {
    const id = String(candidate ?? "").trim();
    if (id) return id;
  }
  return "";
}

function _isActiveEntryUsable(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.container?.destroyed) return false;
  if (typeof entry.tickerFn !== "function") return false;
  return true;
}

function hasAnyPersistedDocumentShaderFlags() {
  const scene = canvas.scene;
  if (!scene) return false;
  const hasFlag = (docs, flagKey) => {
    const list = Array.isArray(docs) ? docs : [];
    for (const doc of list) {
      const value = doc?.getFlag?.(MODULE_ID, flagKey);
      if (value && typeof value === "object") return true;
    }
    return false;
  };
  return (
    hasFlag(scene.tokens?.contents, TOKEN_SHADER_FLAG) ||
    hasFlag(scene.templates?.contents, TEMPLATE_SHADER_FLAG) ||
    hasFlag(scene.tiles?.contents, TILE_SHADER_FLAG)
  );
}

function hasAnyActivePersistentShaderEntries() {
  return (
    _activeShader.size > 0 ||
    _activeTemplateShader.size > 0 ||
    _activeTileShader.size > 0
  );
}

function restorePersistentTokenTemplateTileShaders() {
  const summary = {
    token: { applied: 0, pending: 0, skipped: 0 },
    template: { applied: 0, pending: 0, skipped: 0 },
    tile: { applied: 0, pending: 0, skipped: 0 },
  };
  const hasPersistedFlags = hasAnyPersistedDocumentShaderFlags();
  const hasActiveEntries = hasAnyActivePersistentShaderEntries();
  if (!hasPersistedFlags && !hasActiveEntries) {
    return summary;
  }

  const tokenDocs = Array.isArray(canvas.scene?.tokens?.contents)
    ? canvas.scene.tokens.contents
    : [];
  for (const tokenDoc of tokenDocs) {
    const tokenId = tokenDoc?.id;
    if (!tokenId) continue;
    const opts = readShaderFlag(tokenDoc, TOKEN_SHADER_FLAG);
    if (!opts || parsePersistDisabled(opts?._disabled)) {
      if (_activeShader.has(tokenId)) shaderOff(tokenId, { skipPersist: true });
      summary.token.skipped += 1;
      continue;
    }
    if (_activeShader.has(tokenId)) {
      const existing = _activeShader.get(tokenId);
      if (_isActiveEntryUsable(existing)) {
        summary.token.skipped += 1;
        continue;
      }
      _activeShader.delete(tokenId);
    }
    const persistedShaderId = getPersistedShaderId(opts);
    if (!persistedShaderId) {
      summary.token.skipped += 1;
      continue;
    }
    if (!canvas.tokens?.get?.(tokenId)) {
      summary.token.pending += 1;
      continue;
    }
    shaderOn(tokenId, sanitizeShaderPersistOpts({
      ...opts,
      shaderId: persistedShaderId,
      _skipPersist: true,
      _fromPersist: true,
    }));
    summary.token.applied += 1;
  }

  const templateDocs = Array.isArray(canvas.scene?.templates?.contents)
    ? canvas.scene.templates.contents
    : [];
  for (const templateDoc of templateDocs) {
    const templateId = templateDoc?.id;
    if (!templateId) continue;
    const opts = readShaderFlag(templateDoc, TEMPLATE_SHADER_FLAG);
    if (!opts || parsePersistDisabled(opts?._disabled)) {
      if (_activeTemplateShader.has(templateId)) shaderOffTemplate(templateId, { skipPersist: true });
      summary.template.skipped += 1;
      continue;
    }
    if (_activeTemplateShader.has(templateId)) {
      const existing = _activeTemplateShader.get(templateId);
      if (_isActiveEntryUsable(existing)) {
        summary.template.skipped += 1;
        continue;
      }
      _activeTemplateShader.delete(templateId);
    }
    const persistedShaderId = getPersistedShaderId(opts);
    if (!persistedShaderId) {
      summary.template.skipped += 1;
      continue;
    }
    if (!canvas.templates?.get?.(templateId)) {
      summary.template.pending += 1;
      continue;
    }
    shaderOnTemplate(templateId, sanitizeShaderPersistOpts({
      ...opts,
      shaderId: persistedShaderId,
      _skipPersist: true,
      _fromPersist: true,
    }));
    summary.template.applied += 1;
  }

  const tileDocs = Array.isArray(canvas.scene?.tiles?.contents)
    ? canvas.scene.tiles.contents
    : [];
  for (const tileDoc of tileDocs) {
    const tileId = tileDoc?.id;
    if (!tileId) continue;
    const opts = readShaderFlag(tileDoc, TILE_SHADER_FLAG);
    if (!opts || parsePersistDisabled(opts?._disabled)) {
      if (_activeTileShader.has(tileId)) shaderOffTile(tileId, { skipPersist: true });
      summary.tile.skipped += 1;
      continue;
    }
    if (_activeTileShader.has(tileId)) {
      const existing = _activeTileShader.get(tileId);
      if (_isActiveEntryUsable(existing)) {
        summary.tile.skipped += 1;
        continue;
      }
      _activeTileShader.delete(tileId);
    }
    const persistedShaderId = getPersistedShaderId(opts);
    if (!persistedShaderId) {
      summary.tile.skipped += 1;
      continue;
    }
    if (!getTilePlaceable(tileId)) {
      summary.tile.pending += 1;
      continue;
    }
    shaderOnTile(tileId, sanitizeShaderPersistOpts({
      ...opts,
      shaderId: persistedShaderId,
      _skipPersist: true,
      _fromPersist: true,
    }));
    summary.tile.applied += 1;
  }
  const appliedTotal =
    summary.token.applied +
    summary.template.applied +
    summary.tile.applied;
  const pendingTotal =
    summary.token.pending +
    summary.template.pending +
    summary.tile.pending;
  if (appliedTotal > 0 || pendingTotal > 0) {
    debugLog("persistent shader restore summary", {
      summary,
      hasPersistedFlags,
      hasActiveEntries,
    });
    shaderManager.refreshPlaceableImageChannels?.({ force: true });
    setTimeout(() => shaderManager.refreshPlaceableImageChannels?.({ force: true }), 120);
    setTimeout(() => shaderManager.refreshPlaceableImageChannels?.({ force: true }), 500);
  }
  return summary;
}

function scheduleDeferredPersistentShaderRestore() {
  if (!hasAnyPersistedDocumentShaderFlags() && !hasAnyActivePersistentShaderEntries()) return;
  const generation = ++_persistentRestoreGeneration;
  const delays = [60, 180, 420, 900, 1600, 2800, 4500];
  for (const delay of delays) {
    setTimeout(() => {
      if (generation !== _persistentRestoreGeneration) return;
      if (!hasAnyPersistedDocumentShaderFlags() && !hasAnyActivePersistentShaderEntries()) {
        _persistentRestoreGeneration += 1;
        return;
      }
      try {
        const summary = restorePersistentTokenTemplateTileShaders();
        const pendingTotal =
          Number(summary?.token?.pending ?? 0) +
          Number(summary?.template?.pending ?? 0) +
          Number(summary?.tile?.pending ?? 0);
        if (pendingTotal <= 0) {
          _persistentRestoreGeneration += 1;
          return;
        }
        if (pendingTotal > 0) {
          debugLog("deferred persistent shader restore pending", {
            delay,
            summary,
          });
        }
      } catch (_err) {
        // ignore deferred restore failures
      }
    }, delay);
  }
}

function getTileAxisAlignedSize(metrics) {
  const width = Math.max(1, Number(metrics?.width ?? 1));
  const height = Math.max(1, Number(metrics?.height ?? 1));
  const theta = Number(metrics?.rotationRad ?? 0);
  if (!Number.isFinite(theta) || theta === 0) {
    return { width, height };
  }
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  return {
    width: Math.max(1, width * c + height * s),
    height: Math.max(1, width * s + height * c),
  };
}

function cancelShaderPlacement(notify = false) {
  if (!_shaderPlacementCleanup) return;
  _shaderPlacementCleanup();
  _shaderPlacementCleanup = null;
  if (notify) ui.notifications.info("Shader placement cancelled.");
}

function startShaderPlacement(tokenId, opts = {}) {
  cancelShaderPlacement(false);
  const placementOpts = normalizeShaderMacroOpts(opts);

  const tok = canvas.tokens?.get(tokenId) ?? canvas.tokens?.controlled?.[0];
  if (!tok) {
    return ui.notifications.warn("Select a token first, or pass tokenId.");
  }

  const origin = getTokenCenter(tok);
  const shape = normalizeShapeType(placementOpts.shape ?? "circle");
  const previewLayer = canvas.interface?.primary ?? canvas.interface ?? canvas.stage;
  const preview = new PIXI.Graphics();
  preview.zIndex = 999999;
  preview.eventMode = "none";
  previewLayer.addChild(preview);
  previewLayer.sortChildren?.();

  const defaultDistanceUnits = parseDistanceValue(placementOpts.shapeDistanceUnits, game.settings.get(MODULE_ID, "shaderRadiusUnits"));
  const defaultDistancePx = sceneUnitsToPixels(defaultDistanceUnits);
  const startTarget = { x: origin.x + defaultDistancePx, y: origin.y };
  const coneAngleDeg = Number.isFinite(Number(placementOpts.coneAngleDeg)) ? Number(placementOpts.coneAngleDeg) : 60;
  const lineWidthUnits = parseDistanceValue(placementOpts.lineWidthUnits, 5);
  const lineWidthPx = sceneUnitsToPixels(lineWidthUnits);

  drawPlacementPreview(preview, {
    origin,
    target: startTarget,
    shape,
    coneAngleDeg,
    lineWidthPx
  });

  const onMove = (event) => {
    const p = worldPointFromPointerEvent(event);
    if (!p) return;
    drawPlacementPreview(preview, {
      origin,
      target: p,
      shape,
      coneAngleDeg,
      lineWidthPx
    });
  };

  const finish = (target) => {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const distPx = Math.max(1, Math.hypot(dx, dy));
    const directionDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    const distanceUnits = scenePixelsToUnits(distPx);

    cancelShaderPlacement(false);
    if (_activeShader.has(tok.id)) shaderOff(tok.id);
    shaderOn(tok.id, foundry.utils.mergeObject({
      shape,
      shapeDirectionDeg: directionDeg,
      shapeDistanceUnits: distanceUnits,
      coneAngleDeg,
      lineWidthUnits
    }, placementOpts, { inplace: false }));
  };

  const onDown = (event) => {
    const button = event?.data?.button ?? event?.button ?? 0;
    if (button !== 0) return;
    const p = worldPointFromPointerEvent(event);
    if (!p) return;
    event.stopPropagation?.();
    finish(p);
  };

  const onRightDown = (event) => {
    event.stopPropagation?.();
    cancelShaderPlacement(true);
  };

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelShaderPlacement(true);
    }
  };

  canvas.stage.on("pointermove", onMove);
  canvas.stage.on("pointerdown", onDown);
  canvas.stage.on("rightdown", onRightDown);
  window.addEventListener("keydown", onKey, true);

  _shaderPlacementCleanup = () => {
    canvas.stage.off("pointermove", onMove);
    canvas.stage.off("pointerdown", onDown);
    canvas.stage.off("rightdown", onRightDown);
    window.removeEventListener("keydown", onKey, true);
    preview.destroy({ children: true });
  };

  ui.notifications.info("Move mouse to aim and left-click to place shader shape. Right-click or Esc to cancel.");
}

function normalizeShaderMacroOpts(opts = {}) {
  const src = (opts && typeof opts === "object") ? opts : {};
  const next = foundry.utils.mergeObject({}, src, { inplace: false });

  if (next.layer === undefined && next.shaderLayer !== undefined) next.layer = next.shaderLayer;
  if (next.layer !== undefined) next.layer = normalizeShaderLayerName(next.layer, "inherit");
  if (next.shaderId === undefined && next.shaderPreset !== undefined) next.shaderId = next.shaderPreset;
  if (next.useGradientMask === undefined && next.shaderGradientMask !== undefined) next.useGradientMask = next.shaderGradientMask;
  if (next.gradientMaskFadeStart === undefined && next.shaderGradientFadeStart !== undefined) next.gradientMaskFadeStart = next.shaderGradientFadeStart;
  if (next.alpha === undefined && next.shaderAlpha !== undefined) next.alpha = next.shaderAlpha;
  if (next.intensity === undefined && next.shaderIntensity !== undefined) next.intensity = next.shaderIntensity;
  if (next.speed === undefined && next.shaderSpeed !== undefined) next.speed = next.shaderSpeed;
  if (next.bloom === undefined && next.shaderBloom !== undefined) next.bloom = next.shaderBloom;
  if (next.bloomStrength === undefined && next.shaderBloomStrength !== undefined) next.bloomStrength = next.shaderBloomStrength;
  if (next.bloomBlur === undefined && next.shaderBloomBlur !== undefined) next.bloomBlur = next.shaderBloomBlur;
  if (next.bloomQuality === undefined && next.shaderBloomQuality !== undefined) next.bloomQuality = next.shaderBloomQuality;
  if (next.scale === undefined && next.shaderScale !== undefined) next.scale = next.shaderScale;
  if (next.scaleX === undefined && next.shaderScaleX !== undefined) next.scaleX = next.shaderScaleX;
  if (next.scaleY === undefined && next.shaderScaleY !== undefined) next.scaleY = next.shaderScaleY;
  if (next.scaleToToken === undefined && next.shaderScaleToToken !== undefined) next.scaleToToken = next.shaderScaleToToken;
  if (next.shaderScaleToToken === undefined && next.scaleToToken !== undefined) next.shaderScaleToToken = next.scaleToToken;
  if (next.tokenScaleMultiplier === undefined && next.shaderTokenScaleMultiplier !== undefined) next.tokenScaleMultiplier = next.shaderTokenScaleMultiplier;
  if (next.shaderTokenScaleMultiplier === undefined && next.tokenScaleMultiplier !== undefined) next.shaderTokenScaleMultiplier = next.tokenScaleMultiplier;
  if (next.scaleWithTokenTexture === undefined && next.shaderScaleWithTokenTexture !== undefined) next.scaleWithTokenTexture = next.shaderScaleWithTokenTexture;
  if (next.shaderScaleWithTokenTexture === undefined && next.scaleWithTokenTexture !== undefined) next.shaderScaleWithTokenTexture = next.scaleWithTokenTexture;
  if (next.rotateWithToken === undefined && next.shaderRotateWithToken !== undefined) next.rotateWithToken = next.shaderRotateWithToken;
  if (next.shaderRotateWithToken === undefined && next.rotateWithToken !== undefined) next.shaderRotateWithToken = next.rotateWithToken;
  if (next.flipHorizontal === undefined && next.shaderFlipHorizontal !== undefined) next.flipHorizontal = next.shaderFlipHorizontal;
  if (next.flipVertical === undefined && next.shaderFlipVertical !== undefined) next.flipVertical = next.shaderFlipVertical;
  if (next.flipHorizontal === undefined && next.flipX !== undefined) next.flipHorizontal = next.flipX;
  if (next.flipVertical === undefined && next.flipY !== undefined) next.flipVertical = next.flipY;
  if (next.shaderFlipHorizontal === undefined && next.flipHorizontal !== undefined) next.shaderFlipHorizontal = next.flipHorizontal;
  if (next.shaderFlipVertical === undefined && next.flipVertical !== undefined) next.shaderFlipVertical = next.flipVertical;
  if (next.shaderRotationDeg === undefined && next.rotationDeg !== undefined) next.shaderRotationDeg = next.rotationDeg;
  if (next.shaderRotationRad === undefined && next.shaderRotation !== undefined) next.shaderRotationRad = next.shaderRotation;
  if (next.radiusUnits === undefined && next.shaderRadiusUnits !== undefined) next.radiusUnits = next.shaderRadiusUnits;
  if (next.falloffPower === undefined && next.shaderFalloff !== undefined) next.falloffPower = next.shaderFalloff;
  if (next.density === undefined && next.shaderDensity !== undefined) next.density = next.shaderDensity;
  if (next.flowMode === undefined && next.shaderFlow !== undefined) next.flowMode = next.shaderFlow ? 1 : 0;
  if (next.flowSpeed === undefined && next.shaderFlowSpeed !== undefined) next.flowSpeed = next.shaderFlowSpeed;
  if (next.flowTurbulence === undefined && next.shaderFlowTurbulence !== undefined) next.flowTurbulence = next.shaderFlowTurbulence;
  if (next.colorA === undefined && next.shaderColorA !== undefined) next.colorA = next.shaderColorA;
  if (next.colorB === undefined && next.shaderColorB !== undefined) next.colorB = next.shaderColorB;
  if (next.captureScale === undefined && next.shaderCaptureScale !== undefined) next.captureScale = next.shaderCaptureScale;
  if (next.captureRotationDeg === undefined && next.shaderCaptureRotationDeg !== undefined) next.captureRotationDeg = next.shaderCaptureRotationDeg;
  if (next.shaderCaptureRotationDeg === undefined && next.captureRotationDeg !== undefined) next.shaderCaptureRotationDeg = next.captureRotationDeg;
  if (next.captureFlipHorizontal === undefined && next.shaderCaptureFlipHorizontal !== undefined) next.captureFlipHorizontal = next.shaderCaptureFlipHorizontal;
  if (next.shaderCaptureFlipHorizontal === undefined && next.captureFlipHorizontal !== undefined) next.shaderCaptureFlipHorizontal = next.captureFlipHorizontal;
  if (next.captureFlipVertical === undefined && next.shaderCaptureFlipVertical !== undefined) next.captureFlipVertical = next.shaderCaptureFlipVertical;
  if (next.shaderCaptureFlipVertical === undefined && next.captureFlipVertical !== undefined) next.shaderCaptureFlipVertical = next.captureFlipVertical;
  if (next.displayTimeMs === undefined && next.shaderDisplayTimeMs !== undefined) next.displayTimeMs = next.shaderDisplayTimeMs;
  if (next.easeInMs === undefined && next.shaderEaseInMs !== undefined) next.easeInMs = next.shaderEaseInMs;
  if (next.easeOutMs === undefined && next.shaderEaseOutMs !== undefined) next.easeOutMs = next.shaderEaseOutMs;
  if (next.shape === undefined && next.shaderShape !== undefined) next.shape = next.shaderShape;
  if (next.shapeDirectionDeg === undefined && next.shaderShapeDirectionDeg !== undefined) next.shapeDirectionDeg = next.shaderShapeDirectionDeg;
  if (next.shapeDistanceUnits === undefined && next.distance !== undefined) next.shapeDistanceUnits = next.distance;
  if (next.shapeDistanceUnits === undefined && next.shaderShapeDistanceUnits !== undefined) next.shapeDistanceUnits = next.shaderShapeDistanceUnits;
  if (next.coneAngleDeg === undefined && next.shaderConeAngleDeg !== undefined) next.coneAngleDeg = next.shaderConeAngleDeg;
  if (next.lineWidthUnits === undefined && next.shaderLineWidthUnits !== undefined) next.lineWidthUnits = next.shaderLineWidthUnits;
  if (next.zIndex === undefined && next.zOrder !== undefined) next.zIndex = next.zOrder;
  if (next.zOrder === undefined && next.zIndex !== undefined) next.zOrder = next.zIndex;
  if (next.zIndex === undefined && next.shaderZIndex !== undefined) next.zIndex = next.shaderZIndex;
  if (next.shaderZIndex === undefined && next.zIndex !== undefined) next.shaderZIndex = next.zIndex;

  if (next.debugMode === undefined && next.shaderDebugMode !== undefined) {
    if (typeof next.shaderDebugMode === "number") next.debugMode = next.shaderDebugMode;
    else if (next.shaderDebugMode === "uv") next.debugMode = 1;
    else if (next.shaderDebugMode === "mask") next.debugMode = 2;
    else next.debugMode = 0;
  }

  if (next.colorA !== undefined) next.colorA = parseHexColorLike(next.colorA, 0xFF4A9A);
  if (next.colorB !== undefined) next.colorB = parseHexColorLike(next.colorB, 0xFFB14A);

  return next;
}

function parseBooleanLike(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "on", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "off", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function getImportedShaderDefaultsForSelection(macroOpts = {}) {
  const shaderId = macroOpts?.shaderId ?? macroOpts?.shaderMode ?? game.settings.get(MODULE_ID, "shaderPreset");
  return shaderManager.getImportedShaderDefaults(shaderId, { runtime: true }) ?? {};
}

function resolveShaderRotationRad(cfg, shape, shapeDirectionDeg) {
  const isDirectionalShape =
    shape === "cone" || shape === "line" || shape === "rectangle";
  const baseRad = isDirectionalShape
    ? Number(shapeDirectionDeg || 0) * (Math.PI / 180)
    : 0;

  const explicitRad = Number(cfg?.shaderRotationRad);
  if (Number.isFinite(explicitRad)) {
    return isDirectionalShape ? baseRad + explicitRad : explicitRad;
  }

  const explicitDeg = Number(cfg?.shaderRotationDeg);
  if (Number.isFinite(explicitDeg)) {
    const explicitOffset = explicitDeg * (Math.PI / 180);
    return isDirectionalShape ? baseRad + explicitOffset : explicitOffset;
  }

  return baseRad;
}

function getTokenTextureScaleFactor(token) {
  const doc = token?.document ?? token ?? null;
  const sxRaw = Number(
    doc?.texture?.scaleX ??
      token?.texture?.scale?.x ??
      1,
  );
  const syRaw = Number(
    doc?.texture?.scaleY ??
      token?.texture?.scale?.y ??
      1,
  );
  const sx = Number.isFinite(sxRaw) && sxRaw !== 0 ? Math.abs(sxRaw) : 1;
  const sy = Number.isFinite(syRaw) && syRaw !== 0 ? Math.abs(syRaw) : 1;
  const factor = Math.max(1, sx, sy);
  debugLog("token scale read", {
    tokenId: String(doc?.id ?? token?.id ?? ""),
    textureScaleXRaw: doc?.texture?.scaleX,
    textureScaleYRaw: doc?.texture?.scaleY,
    textureScaleXNumber: sxRaw,
    textureScaleYNumber: syRaw,
    resolvedScaleX: sx,
    resolvedScaleY: sy,
    resolvedFactor: factor,
  });
  return factor;
}

function getTokenRotationRad(token) {
  const deg = Number(token?.document?.rotation ?? token?.rotation ?? 0);
  if (!Number.isFinite(deg)) return 0;
  return (deg * Math.PI) / 180;
}

function isTokenTextureLikelySquare(token) {
  try {
    const texture = token?.texture;
    const base = texture?.baseTexture;
    const source = base?.resource?.source;
    const srcW = Number(source?.width ?? 0);
    const srcH = Number(source?.height ?? 0);
    if (!source || !Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
      return null;
    }

    const frame = texture?.frame ?? { x: 0, y: 0, width: srcW, height: srcH };
    const fw = Math.max(1, Math.floor(Number(frame?.width ?? srcW)));
    const fh = Math.max(1, Math.floor(Number(frame?.height ?? srcH)));
    const fx = Math.max(0, Math.floor(Number(frame?.x ?? 0)));
    const fy = Math.max(0, Math.floor(Number(frame?.y ?? 0)));

    const sampleSize = 32;
    const canvasEl = document.createElement("canvas");
    canvasEl.width = sampleSize;
    canvasEl.height = sampleSize;
    const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.clearRect(0, 0, sampleSize, sampleSize);
    ctx.drawImage(source, fx, fy, fw, fh, 0, 0, sampleSize, sampleSize);

    const img = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
    const alphaAt = (x, y) => {
      const ix = Math.max(0, Math.min(sampleSize - 1, Math.round(x)));
      const iy = Math.max(0, Math.min(sampleSize - 1, Math.round(y)));
      return img[(iy * sampleSize + ix) * 4 + 3] / 255;
    };

    const cornerPts = [
      [2, 2],
      [sampleSize - 3, 2],
      [2, sampleSize - 3],
      [sampleSize - 3, sampleSize - 3],
    ];
    let opaqueCorners = 0;
    for (const [x, y] of cornerPts) {
      if (alphaAt(x, y) >= 0.45) opaqueCorners += 1;
    }

    if (opaqueCorners >= 3) return true;
    if (opaqueCorners <= 1) return false;
    return null;
  } catch (_err) {
    return null;
  }
}

function getTokenShaderStateSnapshot(
  token,
  { useTokenTextureScale = false, rotateWithToken = false } = {},
) {
  const doc = token?.document ?? token ?? null;
  const width = Number(doc?.width ?? token?.w ?? token?.width ?? 0);
  const height = Number(doc?.height ?? token?.h ?? token?.height ?? 0);
  const scaleX = useTokenTextureScale
    ? Number(doc?.texture?.scaleX ?? 1)
    : 1;
  const scaleY = useTokenTextureScale
    ? Number(doc?.texture?.scaleY ?? 1)
    : 1;
  const rotation = rotateWithToken
    ? Number(doc?.rotation ?? token?.rotation ?? 0)
    : 0;
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
    scaleX: Number.isFinite(scaleX) ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) ? scaleY : 1,
    rotation: Number.isFinite(rotation) ? rotation : 0,
  };
}

function tokenShaderStateChanged(prev, next) {
  if (!prev || !next) return true;
  const keys = ["width", "height", "scaleX", "scaleY", "rotation"];
  for (const key of keys) {
    const a = Number(prev[key]);
    const b = Number(next[key]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    if (Math.abs(a - b) > 0.000001) return true;
  }
  return false;
}

function tokenShaderNeedsRebuildFromUpdate(changed) {
  if (!changed || typeof changed !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(changed, "width")) return true;
  if (Object.prototype.hasOwnProperty.call(changed, "height")) return true;
  const texture = changed.texture;
  if (!texture || typeof texture !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(texture, "scaleX")) return true;
  if (Object.prototype.hasOwnProperty.call(texture, "scaleY")) return true;
  return false;
}

function tokenShaderNeedsRebuildFromRefresh(flags) {
  if (!flags || typeof flags !== "object") return false;
  if (flags.refreshSize === true) return true;
  if (flags.refreshMesh === true) return true;
  if (flags.refreshShape === true) return true;
  if (flags.refreshTransform === true) return true;
  return false;
}


function shaderOn(tokenId, opts = {}) {
  const tok = canvas.tokens?.get(tokenId);
  if (!tok || _activeShader.has(tokenId)) return;

  const macroOpts = normalizeShaderMacroOpts(opts);
  const skipPersist = macroOpts._skipPersist === true;
  const importedDefaults = getImportedShaderDefaultsForSelection(macroOpts);
  const cfg = foundry.utils.mergeObject(foundry.utils.mergeObject({
    shape: "circle",
    shapeDirectionDeg: 0,
    shapeDistanceUnits: game.settings.get(MODULE_ID, "shaderRadiusUnits"),
    coneAngleDeg: 60,
    lineWidthUnits: 5,
    scale: game.settings.get(MODULE_ID, "shaderScale"),
    scaleX: game.settings.get(MODULE_ID, "shaderScaleX"),
    scaleY: game.settings.get(MODULE_ID, "shaderScaleY"),
    scaleToToken: false,
    tokenScaleMultiplier: 1,
    scaleWithTokenTexture: false,
    rotateWithToken: false,
    radiusUnits: game.settings.get(MODULE_ID, "shaderRadiusUnits"),
    radiusFactor: 1.8,
    alpha: game.settings.get(MODULE_ID, "shaderAlpha"),
    intensity: game.settings.get(MODULE_ID, "shaderIntensity"),
    falloffPower: game.settings.get(MODULE_ID, "shaderFalloff"),
    density: game.settings.get(MODULE_ID, "shaderDensity"),
    flowMode: game.settings.get(MODULE_ID, "shaderFlow") ? 1 : 0,
    flowSpeed: game.settings.get(MODULE_ID, "shaderFlowSpeed"),
    flowTurbulence: game.settings.get(MODULE_ID, "shaderFlowTurbulence"),
    captureScale: game.settings.get(MODULE_ID, "shaderCaptureScale"),
    displayTimeMs: game.settings.get(MODULE_ID, "shaderDisplayTimeMs"),
    easeInMs: game.settings.get(MODULE_ID, "shaderEaseInMs"),
    easeOutMs: game.settings.get(MODULE_ID, "shaderEaseOutMs"),
    noiseOffset: [Math.random() * 1000, Math.random() * 1000],
    shaderId: game.settings.get(MODULE_ID, "shaderPreset"),
    useGradientMask: game.settings.get(MODULE_ID, "shaderGradientMask"),
    gradientMaskFadeStart: game.settings.get(MODULE_ID, "shaderGradientFadeStart"),
    debugMode: (() => {
      const mode = game.settings.get(MODULE_ID, "shaderDebugMode");
      if (mode === "uv") return 1;
      if (mode === "mask") return 2;
      return 0;
    })(),
    speed: game.settings.get(MODULE_ID, "shaderSpeed"),
    colorA: parseHexColorLike(game.settings.get(MODULE_ID, "shaderColorA"), 0xFF4A9A),
    colorB: parseHexColorLike(game.settings.get(MODULE_ID, "shaderColorB"), 0xFFB14A),
    bloom: true,
    bloomStrength: 1.0,
    bloomBlur: 7,
    bloomQuality: 2
  }, importedDefaults, { inplace: false }), macroOpts, { inplace: false });



  const worldLayer = resolveShaderWorldLayer(MODULE_ID, cfg, { allowTokenLayer: true, tokenTarget: tok });
  const selectedShaderId = cfg.shaderId ?? cfg.shaderMode ?? game.settings.get(MODULE_ID, "shaderPreset");
  const usesTokenTileImage = shaderManager.shaderUsesTokenTileImage?.(selectedShaderId) === true;
  const useTokenTextureScale = usesTokenTileImage || cfg.scaleWithTokenTexture === true;
  const tokenTextureScaleFactor = useTokenTextureScale ? getTokenTextureScaleFactor(tok) : 1;
  const tokenScaleMultiplier = Math.max(0.01, Number(cfg.tokenScaleMultiplier ?? 1));
  const tokenEffectScaleFactor = (useTokenTextureScale ? tokenTextureScaleFactor : 1) * tokenScaleMultiplier;

  const container = new PIXI.Container();
  container.zIndex = resolveShaderContainerZIndex(cfg);
  container.eventMode = "none";
  addShaderContainerToWorldLayer(worldLayer, container, cfg);
  const baseSizePx = Math.max(tok.document.width, tok.document.height) * canvas.grid.size;
  const sizePx = baseSizePx * tokenEffectScaleFactor;
  const radiusUnits = parseDistanceValue(cfg.radiusUnits, NaN);
  const unscaledRadius = (Number.isFinite(radiusUnits) && radiusUnits > 0)
    ? sceneUnitsToPixels(radiusUnits)
    : baseSizePx * cfg.radiusFactor;
  const radius = unscaledRadius * tokenEffectScaleFactor;
  const shape = normalizeShapeType(cfg.shape);
  const shapeDirectionDeg = Number.isFinite(Number(cfg.shapeDirectionDeg)) ? Number(cfg.shapeDirectionDeg) : 0;
  const coneAngleDeg = Math.max(1, Math.min(179, Number(cfg.coneAngleDeg ?? 60)));
  const tokenHalfSizeUnits = Math.max(0.1, scenePixelsToUnits(sizePx) * 0.5);
  const shapeDistanceUnits = cfg.scaleToToken === true
    ? tokenHalfSizeUnits
    : parseDistanceValue(cfg.shapeDistanceUnits, radiusUnits);
  const unscaledShapeDistancePx = (Number.isFinite(shapeDistanceUnits) && shapeDistanceUnits > 0)
    ? sceneUnitsToPixels(shapeDistanceUnits)
    : unscaledRadius;
  const shapeDistancePx = unscaledShapeDistancePx * tokenEffectScaleFactor;
  const lineWidthUnits = parseDistanceValue(cfg.lineWidthUnits, 5);
  const lineWidthPx = Math.max(1, sceneUnitsToPixels(lineWidthUnits));
  const shaderRotationRad = resolveShaderRotationRad(cfg, shape, shapeDirectionDeg);

  let { effectExtent, customMaskTexture } = buildDirectionalMaskTexture({
    shape,
    radiusPx: radius,
    shapeDistancePx,
    lineWidthPx,
    shapeDirectionDeg,
    coneAngleDeg
  });
  if (shape === "circle" && cfg.useGradientMask !== true && usesTokenTileImage) {
    const likelySquare = isTokenTextureLikelySquare(tok);
    if (likelySquare === true) {
      customMaskTexture = PIXI.Texture.WHITE;
    }
    debugLog("token texture shape detect", {
      tokenId,
      shaderId: selectedShaderId,
      likelySquare,
      appliedMask: customMaskTexture === PIXI.Texture.WHITE ? "square" : "circle",
    });
  }
  debugLog("token shader scale inputs", {
    tokenId,
    shaderId: selectedShaderId,
    usesTokenTileImage,
    useTokenTextureScale,
    scaleWithTokenTexture: cfg.scaleWithTokenTexture === true,
    tokenScaleMultiplier,
    rotateWithToken: cfg.rotateWithToken === true,
    tokenDocTextureScaleX: tok?.document?.texture?.scaleX,
    tokenDocTextureScaleY: tok?.document?.texture?.scaleY,
    tokenScaleFactor: tokenTextureScaleFactor,
    tokenEffectScaleFactor,
    tokenDocWidth: tok?.document?.width,
    tokenDocHeight: tok?.document?.height,
    gridSize: canvas?.grid?.size,
    baseSizePx,
    sizePx,
    radiusUnits,
    unscaledRadius,
    radius,
    shapeDistanceUnits,
    unscaledShapeDistancePx,
    shapeDistancePx,
    effectExtent,
  });

  setCenter(container, tok, worldLayer);
  container.rotation = cfg.rotateWithToken === true ? getTokenRotationRad(tok) : 0;

  const geom = createQuadGeometry(effectExtent, effectExtent);
  shaderManager.queueBackgroundCompile?.(selectedShaderId, { reason: "canvas-apply" });
  if (!skipPersist) {
    const tokenDoc = tok.document ?? getTokenShaderDocument(tokenId);
    if (shouldPersistDocumentShader(cfg)) {
      const persistOpts = foundry.utils.mergeObject({}, cfg, { inplace: false });
      persistOpts.shaderId = selectedShaderId;
      void writeShaderFlag(tokenDoc, TOKEN_SHADER_FLAG, persistOpts);
    } else {
      void clearShaderFlag(tokenDoc, TOKEN_SHADER_FLAG);
    }
  }
  const shaderResult = shaderManager.makeShader({
    ...cfg,
    shape,
    shaderRotation: shaderRotationRad,
    maskTexture: customMaskTexture,
    shaderId: selectedShaderId,
    targetType: "token",
    targetId: tokenId,
    resolution: [effectExtent * 2, effectExtent * 2]
  });
  const shader = shaderResult.shader;

  const captureSourceContainer = worldLayer === tok
    ? (tok.parent ?? canvas.tokens)
    : worldLayer;
  const { sceneAreaChannels, runtimeBufferChannels, runtimeImageChannels } = setupShaderRuntimeChannels(shaderResult, shader, {
    captureSourceContainer
  });
  const mesh = new PIXI.Mesh(geom, shader);
  mesh.alpha = 1.0;
  mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
  container.addChild(mesh);

  if (cfg.bloom && PIXI.filters?.BloomFilter) {
    const bloom = new PIXI.filters.BloomFilter(cfg.bloomStrength, cfg.bloomBlur, cfg.bloomQuality);
    bloom.padding = effectExtent * 2.5;
    mesh.filters = [bloom];
  }
  const debugEnabled = game.settings.get(MODULE_ID, "shaderDebug");
  let debugGfx = null;
  let spriteDebugGfx = null;
  if (debugEnabled) {
    debugGfx = new PIXI.Graphics();
    worldLayer.addChild(debugGfx);
    updateDebugGfx(debugGfx, tok, worldLayer, effectExtent);
    spriteDebugGfx = new PIXI.Graphics();
    container.addChild(spriteDebugGfx);
    updateSpriteDebugGfx(spriteDebugGfx, effectExtent);
  }
    let t = 0;
  let elapsedMs = 0;
  const { displayTimeMs, computeFadeAlpha } = createFadeAlphaComputer(cfg);
  if ("globalAlpha" in shader.uniforms) {
    shader.uniforms.globalAlpha = computeFadeAlpha(0);
  }
  const tickerFn = (delta) => {
    const liveTok = canvas.tokens?.get(tokenId);
    if (!liveTok) return shaderOff(tokenId, { skipPersist: true });
    const dt = Number.isFinite(canvas.app.ticker.deltaMS) ? (canvas.app.ticker.deltaMS / 1000) : (delta / 60);
    elapsedMs += dt * 1000;
    if (displayTimeMs > 0 && elapsedMs >= displayTimeMs) {
      return shaderOff(tokenId, { skipPersist: true });
    }
    if ("globalAlpha" in shader.uniforms) {
      shader.uniforms.globalAlpha = computeFadeAlpha(elapsedMs);
    }

    setCenter(container, liveTok, worldLayer);
    container.rotation = cfg.rotateWithToken === true ? getTokenRotationRad(liveTok) : 0;
    if (mesh.filters?.length) {
      // filterArea is world-space; recompute after movement to avoid clipping/offset.
      const pad = effectExtent * 0.8 + cfg.bloomBlur * 30;
      const bounds = mesh.getBounds(false);
      mesh.filterArea = new PIXI.Rectangle(
        bounds.x - pad,
        bounds.y - pad,
        bounds.width + pad * 2,
        bounds.height + pad * 2
      );
    }
    if (debugGfx) updateDebugGfx(debugGfx, liveTok, worldLayer, effectExtent);
    if (spriteDebugGfx) updateSpriteDebugGfx(spriteDebugGfx, effectExtent);
    if (runtimeBufferChannels.length) {
      for (const runtimeBuffer of runtimeBufferChannels) {
        runtimeBuffer.update(dt);
      }
    }
    if (sceneAreaChannels.length) {
      const liveCenter = getTokenCenter(liveTok);
      const captureScale = Math.max(0.01, Number(cfg.captureScale ?? 1.0));
      const captureRadius = effectExtent * captureScale;
      const captureRotationDeg = Number.isFinite(Number(cfg.captureRotationDeg))
        ? Number(cfg.captureRotationDeg)
        : 0;
      const captureFlipHorizontal = parseBooleanLike(cfg.captureFlipHorizontal, false);
      const captureFlipVerticalUser = parseBooleanLike(cfg.captureFlipVertical, false);
      const captureFlipVertical = !captureFlipVerticalUser;
      for (const capture of sceneAreaChannels) {
        capture.update({
          centerWorld: liveCenter,
          radiusWorldX: captureRadius,
          radiusWorldY: captureRadius * 0.5,
          flipX: captureFlipHorizontal,
          flipY: captureFlipVertical,
          rotationDeg: captureRotationDeg,
          excludeDisplayObject: container
        });
      }
    }
    t += delta;
    updateShaderTimeUniforms(shader, dt, cfg.speed, t);
  };

  canvas.app.ticker.add(tickerFn);
  _activeShader.set(tokenId, {
    container,
    tickerFn,
    debugGfx,
    spriteDebugGfx,
    sceneAreaChannels,
    runtimeBufferChannels,
    runtimeImageChannels,
    customMaskTexture,
    sourceOpts: foundry.utils.mergeObject(
      foundry.utils.mergeObject({}, macroOpts, { inplace: false }),
      { shaderId: selectedShaderId },
      { inplace: false },
    ),
    shaderId: selectedShaderId,
    usesTokenTileImage,
    useTokenTextureScale,
    rotateWithToken: cfg.rotateWithToken === true,
    tokenStateSnapshot: getTokenShaderStateSnapshot(tok, {
      useTokenTextureScale,
      rotateWithToken: cfg.rotateWithToken === true,
    }),
  });
}

function shaderOff(tokenId, { skipPersist = false } = {}) {
  const tokenDoc = getTokenShaderDocument(tokenId);
  if (!skipPersist) {
    void clearShaderFlag(tokenDoc, TOKEN_SHADER_FLAG);
  }

  const e = _activeShader.get(tokenId);
  if (!e) return;
  canvas.app.ticker.remove(e.tickerFn);
  destroyShaderRuntimeEntry(e);
  _activeShader.delete(tokenId);
}

function shaderToggle(tokenId, opts = {}) {
  if (_activeShader.has(tokenId)) shaderOff(tokenId);
  else shaderOn(tokenId, opts);
}

function shaderOnTemplate(templateId, opts = {}) {
  const resolvedTemplateId = resolveTemplateId(templateId);
  const template = canvas.templates?.get(resolvedTemplateId);
  if (!template) {
    ui.notifications.warn("No measured template found. Create one first or pass templateId.");
    return;
  }
  if (_activeTemplateShader.has(resolvedTemplateId)) return;

  const macroOpts = normalizeShaderMacroOpts(opts);
  const skipPersist = macroOpts._skipPersist === true;
  const importedDefaults = getImportedShaderDefaultsForSelection(macroOpts);
  const fallbackRadiusUnits = game.settings.get(MODULE_ID, "shaderRadiusUnits");
  const templateGeometry = getShaderGeometryFromTemplate(template, fallbackRadiusUnits);
  const cfg = foundry.utils.mergeObject(foundry.utils.mergeObject(foundry.utils.mergeObject({
    shape: "circle",
    shapeDirectionDeg: 0,
    shapeDistanceUnits: fallbackRadiusUnits,
    coneAngleDeg: 60,
    lineWidthUnits: 5,
    scale: game.settings.get(MODULE_ID, "shaderScale"),
    scaleX: game.settings.get(MODULE_ID, "shaderScaleX"),
    scaleY: game.settings.get(MODULE_ID, "shaderScaleY"),
    scaleToToken: false,
    radiusUnits: fallbackRadiusUnits,
    radiusFactor: 1.8,
    alpha: game.settings.get(MODULE_ID, "shaderAlpha"),
    intensity: game.settings.get(MODULE_ID, "shaderIntensity"),
    falloffPower: game.settings.get(MODULE_ID, "shaderFalloff"),
    density: game.settings.get(MODULE_ID, "shaderDensity"),
    flowMode: game.settings.get(MODULE_ID, "shaderFlow") ? 1 : 0,
    flowSpeed: game.settings.get(MODULE_ID, "shaderFlowSpeed"),
    flowTurbulence: game.settings.get(MODULE_ID, "shaderFlowTurbulence"),
    captureScale: game.settings.get(MODULE_ID, "shaderCaptureScale"),
    displayTimeMs: game.settings.get(MODULE_ID, "shaderDisplayTimeMs"),
    easeInMs: game.settings.get(MODULE_ID, "shaderEaseInMs"),
    easeOutMs: game.settings.get(MODULE_ID, "shaderEaseOutMs"),
    noiseOffset: [Math.random() * 1000, Math.random() * 1000],
    shaderId: game.settings.get(MODULE_ID, "shaderPreset"),
    useGradientMask: game.settings.get(MODULE_ID, "shaderGradientMask"),
    gradientMaskFadeStart: game.settings.get(MODULE_ID, "shaderGradientFadeStart"),
    debugMode: (() => {
      const mode = game.settings.get(MODULE_ID, "shaderDebugMode");
      if (mode === "uv") return 1;
      if (mode === "mask") return 2;
      return 0;
    })(),
    speed: game.settings.get(MODULE_ID, "shaderSpeed"),
    colorA: parseHexColorLike(game.settings.get(MODULE_ID, "shaderColorA"), 0xFF4A9A),
    colorB: parseHexColorLike(game.settings.get(MODULE_ID, "shaderColorB"), 0xFFB14A),
    bloom: true,
    bloomStrength: 1.0,
    bloomBlur: 7,
    bloomQuality: 2
  }, importedDefaults, { inplace: false }), macroOpts, { inplace: false }), templateGeometry, { inplace: false });

  const worldLayer = resolveShaderWorldLayer(MODULE_ID, cfg);

  const container = new PIXI.Container();
  container.zIndex = resolveShaderContainerZIndex(cfg);
  container.eventMode = "none";
  addShaderContainerToWorldLayer(worldLayer, container, cfg);

  const radiusUnits = parseDistanceValue(cfg.radiusUnits, cfg.shapeDistanceUnits);
  const radius = (Number.isFinite(radiusUnits) && radiusUnits > 0)
    ? sceneUnitsToPixels(radiusUnits)
    : sceneUnitsToPixels(parseDistanceValue(cfg.shapeDistanceUnits, fallbackRadiusUnits));
  const shape = normalizeShapeType(cfg.shape);
  const shapeDirectionDeg = Number.isFinite(Number(cfg.shapeDirectionDeg)) ? Number(cfg.shapeDirectionDeg) : 0;
  const coneAngleDeg = Math.max(1, Math.min(179, Number(cfg.coneAngleDeg ?? 60)));
  const templateHalfSizeUnits = Math.max(
    0.1,
    parseDistanceValue(templateGeometry?.shapeDistanceUnits, radiusUnits)
  );
  const shapeDistanceUnits = cfg.scaleToToken === true
    ? templateHalfSizeUnits
    : parseDistanceValue(cfg.shapeDistanceUnits, radiusUnits);
  const shapeDistancePx = (Number.isFinite(shapeDistanceUnits) && shapeDistanceUnits > 0)
    ? sceneUnitsToPixels(shapeDistanceUnits)
    : radius;
  const lineWidthUnits = parseDistanceValue(cfg.lineWidthUnits, 5);
  const lineWidthPx = Math.max(1, sceneUnitsToPixels(lineWidthUnits));
  const shaderRotationRad = resolveShaderRotationRad(cfg, shape, shapeDirectionDeg);

  const { effectExtent, customMaskTexture } = buildDirectionalMaskTexture({
    shape,
    radiusPx: radius,
    shapeDistancePx,
    lineWidthPx,
    shapeDirectionDeg,
    coneAngleDeg
  });

  setCenterFromWorld(container, getTemplateOrigin(template), worldLayer);

  const geom = createQuadGeometry(effectExtent, effectExtent);
  const selectedShaderId = cfg.shaderId ?? cfg.shaderMode ?? game.settings.get(MODULE_ID, "shaderPreset");
  shaderManager.queueBackgroundCompile?.(selectedShaderId, { reason: "canvas-apply" });
  if (!shaderManager.shaderSupportsTarget(selectedShaderId, "template")) {
    container.destroy({ children: true });
    ui.notifications.warn("This shader uses token/tile image channels and cannot be applied to templates.");
    return;
  }
  if (!skipPersist) {
    const templateDoc = template.document ?? getTemplateShaderDocument(resolvedTemplateId);
    if (shouldPersistDocumentShader(cfg)) {
      const persistOpts = foundry.utils.mergeObject({}, cfg, { inplace: false });
      persistOpts.shaderId = selectedShaderId;
      void writeShaderFlag(templateDoc, TEMPLATE_SHADER_FLAG, persistOpts);
    } else {
      void clearShaderFlag(templateDoc, TEMPLATE_SHADER_FLAG);
    }
  }
  const shaderResult = shaderManager.makeShader({
    ...cfg,
    shape,
    shaderRotation: shaderRotationRad,
    maskTexture: customMaskTexture,
    shaderId: selectedShaderId,
    targetType: "template",
    targetId: resolvedTemplateId,
    resolution: [effectExtent * 2, effectExtent * 2]
  });
  const shader = shaderResult.shader;

  const { sceneAreaChannels, runtimeBufferChannels, runtimeImageChannels } = setupShaderRuntimeChannels(shaderResult, shader, { captureSourceContainer: worldLayer });
  const mesh = new PIXI.Mesh(geom, shader);
  mesh.alpha = 1.0;
  mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
  container.addChild(mesh);

  if (cfg.bloom && PIXI.filters?.BloomFilter) {
    const bloom = new PIXI.filters.BloomFilter(cfg.bloomStrength, cfg.bloomBlur, cfg.bloomQuality);
    bloom.padding = effectExtent * 2.5;
    mesh.filters = [bloom];
  }

  const debugEnabled = game.settings.get(MODULE_ID, "shaderDebug");
  let debugGfx = null;
  let spriteDebugGfx = null;
  if (debugEnabled) {
    debugGfx = new PIXI.Graphics();
    worldLayer.addChild(debugGfx);
    updateDebugGfxAtWorld(debugGfx, getTemplateOrigin(template), worldLayer, effectExtent);
    spriteDebugGfx = new PIXI.Graphics();
    container.addChild(spriteDebugGfx);
    updateSpriteDebugGfx(spriteDebugGfx, effectExtent);
  }

  let t = 0;
  let elapsedMs = 0;
  let templateShapeSignature = getTemplateShapeSignature(template);
  const { displayTimeMs, computeFadeAlpha } = createFadeAlphaComputer(cfg);
  if ("globalAlpha" in shader.uniforms) {
    shader.uniforms.globalAlpha = computeFadeAlpha(0);
  }

  const tickerFn = (delta) => {
    const liveTemplate = canvas.templates?.get(resolvedTemplateId);
    if (!liveTemplate) return shaderOffTemplate(resolvedTemplateId, { skipPersist: true });

    const liveShapeSig = getTemplateShapeSignature(liveTemplate);
    if (liveShapeSig !== templateShapeSignature) {
      templateShapeSignature = liveShapeSig;
      const liveEntry = _activeTemplateShader.get(resolvedTemplateId);
      const sourceOpts = foundry.utils.mergeObject({}, liveEntry?.sourceOpts ?? macroOpts, { inplace: false });
      shaderOffTemplate(resolvedTemplateId, { skipPersist: true });
      shaderOnTemplate(resolvedTemplateId, sourceOpts);
      return;
    }

    const dt = Number.isFinite(canvas.app.ticker.deltaMS) ? (canvas.app.ticker.deltaMS / 1000) : (delta / 60);
    elapsedMs += dt * 1000;
    if (displayTimeMs > 0 && elapsedMs >= displayTimeMs) {
      return shaderOffTemplate(resolvedTemplateId, { skipPersist: true });
    }
    if ("globalAlpha" in shader.uniforms) {
      shader.uniforms.globalAlpha = computeFadeAlpha(elapsedMs);
    }

    const liveCenter = getTemplateOrigin(liveTemplate);
    setCenterFromWorld(container, liveCenter, worldLayer);
    if (mesh.filters?.length) {
      const pad = effectExtent * 0.8 + cfg.bloomBlur * 30;
      const bounds = mesh.getBounds(false);
      mesh.filterArea = new PIXI.Rectangle(
        bounds.x - pad,
        bounds.y - pad,
        bounds.width + pad * 2,
        bounds.height + pad * 2
      );
    }
    if (debugGfx) updateDebugGfxAtWorld(debugGfx, liveCenter, worldLayer, effectExtent);
    if (spriteDebugGfx) updateSpriteDebugGfx(spriteDebugGfx, effectExtent);
    if (runtimeBufferChannels.length) {
      for (const runtimeBuffer of runtimeBufferChannels) {
        runtimeBuffer.update(dt);
      }
    }
    if (sceneAreaChannels.length) {
      const captureScale = Math.max(0.01, Number(cfg.captureScale ?? 1.0));
      const captureRadius = effectExtent * captureScale;
      const captureRotationDeg = Number.isFinite(Number(cfg.captureRotationDeg))
        ? Number(cfg.captureRotationDeg)
        : 0;
      const captureFlipHorizontal = parseBooleanLike(cfg.captureFlipHorizontal, false);
      const captureFlipVerticalUser = parseBooleanLike(cfg.captureFlipVertical, false);
      const captureFlipVertical = !captureFlipVerticalUser;
      for (const capture of sceneAreaChannels) {
        capture.update({
          centerWorld: liveCenter,
          radiusWorldX: captureRadius,
          radiusWorldY: captureRadius * 0.5,
          flipX: captureFlipHorizontal,
          flipY: captureFlipVertical,
          rotationDeg: captureRotationDeg,
          excludeDisplayObject: container
        });
      }
    }

    t += delta;
    updateShaderTimeUniforms(shader, dt, cfg.speed, t);
  };

  canvas.app.ticker.add(tickerFn);
  _activeTemplateShader.set(resolvedTemplateId, {
    container,
    tickerFn,
    debugGfx,
    spriteDebugGfx,
    sceneAreaChannels,
    runtimeBufferChannels,
    runtimeImageChannels,
    customMaskTexture,
    sourceOpts: foundry.utils.mergeObject(
      foundry.utils.mergeObject({}, macroOpts, { inplace: false }),
      { shaderId: selectedShaderId },
      { inplace: false },
    )
  });
}

function shaderOffTemplate(templateId, { skipPersist = false } = {}) {
  const resolvedTemplateId = resolveTemplateId(templateId);
  const templateDoc = getTemplateShaderDocument(resolvedTemplateId);
  if (!skipPersist) {
    void clearShaderFlag(templateDoc, TEMPLATE_SHADER_FLAG);
  }

  const e = _activeTemplateShader.get(resolvedTemplateId);
  if (!e) return;
  canvas.app.ticker.remove(e.tickerFn);
  destroyShaderRuntimeEntry(e);
  _activeTemplateShader.delete(resolvedTemplateId);
}

function shaderToggleTemplate(templateId, opts = {}) {
  const resolvedTemplateId = resolveTemplateId(templateId);
  if (!resolvedTemplateId) {
    ui.notifications.warn("No measured template found. Create one first or pass templateId.");
    return;
  }
  if (_activeTemplateShader.has(resolvedTemplateId)) shaderOffTemplate(resolvedTemplateId);
  else shaderOnTemplate(resolvedTemplateId, opts);
}

function shaderOnTile(tileId, opts = {}) {
  const resolvedTileId = resolveTileId(tileId);
  const tile = getTilePlaceable(resolvedTileId);
  if (!tile) {
    ui.notifications.warn("No tile found. Create one first or pass tileId.");
    return;
  }
  if (_activeTileShader.has(resolvedTileId)) return;

  const macroOpts = normalizeShaderMacroOpts(opts);
  const skipPersist = macroOpts._skipPersist === true;
  const importedDefaults = getImportedShaderDefaultsForSelection(macroOpts);
  const fallbackRadiusUnits = game.settings.get(MODULE_ID, "shaderRadiusUnits");
  const cfg = foundry.utils.mergeObject(foundry.utils.mergeObject({
    shape: "rectangle",
    shapeDirectionDeg: 0,
    shapeDistanceUnits: fallbackRadiusUnits,
    coneAngleDeg: 60,
    lineWidthUnits: 5,
    scale: game.settings.get(MODULE_ID, "shaderScale"),
    scaleX: game.settings.get(MODULE_ID, "shaderScaleX"),
    scaleY: game.settings.get(MODULE_ID, "shaderScaleY"),
    scaleToToken: false,
    radiusUnits: fallbackRadiusUnits,
    radiusFactor: 1.8,
    alpha: game.settings.get(MODULE_ID, "shaderAlpha"),
    intensity: game.settings.get(MODULE_ID, "shaderIntensity"),
    falloffPower: game.settings.get(MODULE_ID, "shaderFalloff"),
    density: game.settings.get(MODULE_ID, "shaderDensity"),
    flowMode: game.settings.get(MODULE_ID, "shaderFlow") ? 1 : 0,
    flowSpeed: game.settings.get(MODULE_ID, "shaderFlowSpeed"),
    flowTurbulence: game.settings.get(MODULE_ID, "shaderFlowTurbulence"),
    captureScale: game.settings.get(MODULE_ID, "shaderCaptureScale"),
    displayTimeMs: game.settings.get(MODULE_ID, "shaderDisplayTimeMs"),
    easeInMs: game.settings.get(MODULE_ID, "shaderEaseInMs"),
    easeOutMs: game.settings.get(MODULE_ID, "shaderEaseOutMs"),
    noiseOffset: [Math.random() * 1000, Math.random() * 1000],
    shaderId: game.settings.get(MODULE_ID, "shaderPreset"),
    useGradientMask: game.settings.get(MODULE_ID, "shaderGradientMask"),
    gradientMaskFadeStart: game.settings.get(MODULE_ID, "shaderGradientFadeStart"),
    debugMode: (() => {
      const mode = game.settings.get(MODULE_ID, "shaderDebugMode");
      if (mode === "uv") return 1;
      if (mode === "mask") return 2;
      return 0;
    })(),
    speed: game.settings.get(MODULE_ID, "shaderSpeed"),
    colorA: parseHexColorLike(game.settings.get(MODULE_ID, "shaderColorA"), 0xFF4A9A),
    colorB: parseHexColorLike(game.settings.get(MODULE_ID, "shaderColorB"), 0xFFB14A),
    bloom: true,
    bloomStrength: 1.0,
    bloomBlur: 7,
    bloomQuality: 2
  }, importedDefaults, { inplace: false }), macroOpts, { inplace: false });

  const worldLayer = resolveShaderWorldLayer(MODULE_ID, cfg);

  const metrics = getTileMetrics(tile);
  if (!Number.isFinite(metrics.width) || !Number.isFinite(metrics.height) || metrics.width <= 0 || metrics.height <= 0) {
    return ui.notifications.warn("Tile has invalid dimensions.");
  }

  const container = new PIXI.Container();
  container.zIndex = resolveShaderContainerZIndex(cfg);
  container.eventMode = "none";
  addShaderContainerToWorldLayer(worldLayer, container, cfg);

  setCenterFromWorld(container, metrics.center, worldLayer);
  container.rotation = 0;

  const shaderSize = getTileAxisAlignedSize(metrics);
  const halfW = Math.max(1, shaderSize.width * 0.5);
  const halfH = Math.max(1, shaderSize.height * 0.5);
  const effectExtent = Math.max(halfW, halfH);

  const geom = createQuadGeometry(halfW, halfH);

  const selectedShaderId = cfg.shaderId ?? cfg.shaderMode ?? game.settings.get(MODULE_ID, "shaderPreset");
  shaderManager.queueBackgroundCompile?.(selectedShaderId, { reason: "canvas-apply" });
  if (!skipPersist) {
    const tileDoc = tile.document ?? getTileShaderDocument(resolvedTileId);
    if (shouldPersistDocumentShader(cfg)) {
      const persistOpts = foundry.utils.mergeObject({}, cfg, { inplace: false });
      persistOpts.shaderId = selectedShaderId;
      void writeShaderFlag(tileDoc, TILE_SHADER_FLAG, persistOpts);
    } else {
      void clearShaderFlag(tileDoc, TILE_SHADER_FLAG);
    }
  }
  const customMaskTexture = PIXI.Texture.WHITE;
  const shaderResult = shaderManager.makeShader({
    ...cfg,
    shape: "rectangle",
    maskTexture: customMaskTexture,
    shaderId: selectedShaderId,
    targetType: "tile",
    targetId: resolvedTileId,
    resolution: [Math.max(2, shaderSize.width), Math.max(2, shaderSize.height)]
  });
  const shader = shaderResult.shader;

  const { sceneAreaChannels, runtimeBufferChannels, runtimeImageChannels } = setupShaderRuntimeChannels(shaderResult, shader, { captureSourceContainer: worldLayer });

  const mesh = new PIXI.Mesh(geom, shader);
  mesh.alpha = 1.0;
  mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
  container.addChild(mesh);

  if (cfg.bloom && PIXI.filters?.BloomFilter) {
    const bloom = new PIXI.filters.BloomFilter(cfg.bloomStrength, cfg.bloomBlur, cfg.bloomQuality);
    bloom.padding = Math.max(halfW, halfH) * 2.0;
    mesh.filters = [bloom];
  }

  const debugEnabled = game.settings.get(MODULE_ID, "shaderDebug");
  let debugGfx = null;
  let spriteDebugGfx = null;
  if (debugEnabled) {
    debugGfx = new PIXI.Graphics();
    worldLayer.addChild(debugGfx);
    updateDebugGfxAtWorld(debugGfx, metrics.center, worldLayer, Math.max(shaderSize.width, shaderSize.height) * 0.5);
    spriteDebugGfx = new PIXI.Graphics();
    container.addChild(spriteDebugGfx);
    updateSpriteDebugGfx(spriteDebugGfx, Math.max(shaderSize.width, shaderSize.height) * 0.5);
  }

  let t = 0;
  let elapsedMs = 0;
  let tileShapeSignature = getTileShapeSignature(tile);
  const { displayTimeMs, computeFadeAlpha } = createFadeAlphaComputer(cfg);
  if ("globalAlpha" in shader.uniforms) {
    shader.uniforms.globalAlpha = computeFadeAlpha(0);
  }

  const tickerFn = (delta) => {
    const liveTile = getTilePlaceable(resolvedTileId);
    if (!liveTile) return shaderOffTile(resolvedTileId, { skipPersist: true });

    const liveShapeSig = getTileShapeSignature(liveTile);
    if (liveShapeSig !== tileShapeSignature) {
      tileShapeSignature = liveShapeSig;
      const liveEntry = _activeTileShader.get(resolvedTileId);
      const sourceOpts = foundry.utils.mergeObject({}, liveEntry?.sourceOpts ?? macroOpts, { inplace: false });
      shaderOffTile(resolvedTileId, { skipPersist: true });
      shaderOnTile(resolvedTileId, sourceOpts);
      return;
    }

    const dt = Number.isFinite(canvas.app.ticker.deltaMS) ? (canvas.app.ticker.deltaMS / 1000) : (delta / 60);
    elapsedMs += dt * 1000;
    if (displayTimeMs > 0 && elapsedMs >= displayTimeMs) {
      return shaderOffTile(resolvedTileId, { skipPersist: true });
    }
    if ("globalAlpha" in shader.uniforms) {
      shader.uniforms.globalAlpha = computeFadeAlpha(elapsedMs);
    }

    const liveMetrics = getTileMetrics(liveTile);
    const liveShaderSize = getTileAxisAlignedSize(liveMetrics);
    setCenterFromWorld(container, liveMetrics.center, worldLayer);
    container.rotation = 0;

    if (mesh.filters?.length) {
      const pad = Math.max(liveShaderSize.width, liveShaderSize.height) * 0.4 + cfg.bloomBlur * 30;
      const bounds = mesh.getBounds(false);
      mesh.filterArea = new PIXI.Rectangle(
        bounds.x - pad,
        bounds.y - pad,
        bounds.width + pad * 2,
        bounds.height + pad * 2
      );
    }

    if (debugGfx) updateDebugGfxAtWorld(debugGfx, liveMetrics.center, worldLayer, Math.max(liveShaderSize.width, liveShaderSize.height) * 0.5);
    if (spriteDebugGfx) updateSpriteDebugGfx(spriteDebugGfx, Math.max(liveShaderSize.width, liveShaderSize.height) * 0.5);

    for (const runtimeBuffer of runtimeBufferChannels) {
      runtimeBuffer.update(dt);
    }

    if (sceneAreaChannels.length) {
      const captureScale = Math.max(0.01, Number(cfg.captureScale ?? 1.0));
      const captureRadiusX = liveShaderSize.width * 0.5 * captureScale;
      const captureRadiusY = liveShaderSize.height * 0.5 * captureScale;
      const captureRotationDeg = Number.isFinite(Number(cfg.captureRotationDeg))
        ? Number(cfg.captureRotationDeg)
        : 0;
      const captureFlipHorizontal = parseBooleanLike(cfg.captureFlipHorizontal, false);
      const captureFlipVerticalUser = parseBooleanLike(cfg.captureFlipVertical, false);
      const captureFlipVertical = !captureFlipVerticalUser;
      for (const capture of sceneAreaChannels) {
        capture.update({
          centerWorld: liveMetrics.center,
          radiusWorldX: captureRadiusX,
          radiusWorldY: captureRadiusY,
          flipX: captureFlipHorizontal,
          flipY: captureFlipVertical,
          rotationDeg: captureRotationDeg,
          excludeDisplayObject: container
        });
      }
    }

    t += delta;
    updateShaderTimeUniforms(shader, dt, cfg.speed, t);
  };

  canvas.app.ticker.add(tickerFn);
  _activeTileShader.set(resolvedTileId, {
    container,
    tickerFn,
    debugGfx,
    spriteDebugGfx,
    sceneAreaChannels,
    runtimeBufferChannels,
    runtimeImageChannels,
    customMaskTexture,
    sourceOpts: foundry.utils.mergeObject(
      foundry.utils.mergeObject({}, macroOpts, { inplace: false }),
      { shaderId: selectedShaderId },
      { inplace: false },
    )
  });
}

function shaderOffTile(tileId, { skipPersist = false } = {}) {
  const resolvedTileId = resolveTileId(tileId);
  const tileDoc = getTileShaderDocument(resolvedTileId);
  if (!skipPersist) {
    void clearShaderFlag(tileDoc, TILE_SHADER_FLAG);
  }

  const entry = _activeTileShader.get(resolvedTileId);
  if (!entry) return;
  canvas.app.ticker.remove(entry.tickerFn);
  destroyShaderRuntimeEntry(entry, { preserveWhiteMask: true });
  _activeTileShader.delete(resolvedTileId);
}

function shaderToggleTile(tileId, opts = {}) {
  const resolvedTileId = resolveTileId(tileId);
  if (!resolvedTileId) {
    ui.notifications.warn("No tile found. Create one first or pass tileId.");
    return;
  }
  if (_activeTileShader.has(resolvedTileId)) shaderOffTile(resolvedTileId);
  else shaderOnTile(resolvedTileId, opts);
}


async function deleteAllTokenFX() {
  const activeIds = Array.from(_activeShader.keys());
  for (const tokenId of activeIds) {
    shaderOff(tokenId, { skipPersist: true });
  }

  const tokenDocs = Array.isArray(canvas.scene?.tokens?.contents)
    ? canvas.scene.tokens.contents
    : [];
  await Promise.all(tokenDocs.map((doc) => clearShaderFlag(doc, TOKEN_SHADER_FLAG)));

  return {
    removedActive: activeIds.length,
    clearedFlags: tokenDocs.length,
  };
}

async function deleteAllTemplateFX() {
  const activeIds = Array.from(_activeTemplateShader.keys());
  for (const templateId of activeIds) {
    shaderOffTemplate(templateId, { skipPersist: true });
  }

  const templateDocs = Array.isArray(canvas.scene?.templates?.contents)
    ? canvas.scene.templates.contents
    : [];
  await Promise.all(templateDocs.map((doc) => clearShaderFlag(doc, TEMPLATE_SHADER_FLAG)));

  return {
    removedActive: activeIds.length,
    clearedFlags: templateDocs.length,
  };
}

async function deleteAllTileFX() {
  const activeIds = Array.from(_activeTileShader.keys());
  for (const tileId of activeIds) {
    shaderOffTile(tileId, { skipPersist: true });
  }

  const tileDocs = Array.isArray(canvas.scene?.tiles?.contents)
    ? canvas.scene.tiles.contents
    : [];
  await Promise.all(tileDocs.map((doc) => clearShaderFlag(doc, TILE_SHADER_FLAG)));

  return {
    removedActive: activeIds.length,
    clearedFlags: tileDocs.length,
  };
}

function refreshActivePlaceableImageChannels() {
  const refreshEntry = (entry) => {
    if (!entry || !Array.isArray(entry.runtimeImageChannels)) return 0;
    let count = 0;
    for (const channel of entry.runtimeImageChannels) {
      if (!channel || typeof channel.refresh !== "function") continue;
      try {
        channel.refresh({ force: true });
        count += 1;
      } catch (_err) {
        // ignore per-channel failures
      }
    }
    return count;
  };

  let refreshed = 0;
  for (const entry of _activeShader.values()) refreshed += refreshEntry(entry);
  for (const entry of _activeTileShader.values()) refreshed += refreshEntry(entry);
  for (const entry of _activeTemplateShader.values()) refreshed += refreshEntry(entry);
  for (const entry of _activeRegionShader.values()) {
    if (!entry || !Array.isArray(entry.clusterStates)) continue;
    for (const cluster of entry.clusterStates) refreshed += refreshEntry(cluster);
  }

  if (refreshed > 0) {
    debugLog("forced runtime image channel refresh", {
      refreshed,
    });
  }
}

function refreshActiveSceneCaptureChannels() {
  const forceEntryTick = (entry) => {
    if (!entry || typeof entry.tickerFn !== "function") return 0;
    const captures = Array.isArray(entry.sceneAreaChannels)
      ? entry.sceneAreaChannels.length
      : 0;
    if (captures <= 0) return 0;
    try {
      entry.tickerFn(0);
      return captures;
    } catch (_err) {
      return 0;
    }
  };

  let refreshed = 0;
  for (const entry of _activeShader.values()) refreshed += forceEntryTick(entry);
  for (const entry of _activeTileShader.values()) refreshed += forceEntryTick(entry);
  for (const entry of _activeTemplateShader.values()) refreshed += forceEntryTick(entry);
  for (const entry of _activeRegionShader.values()) {
    if (!entry || typeof entry.tickerFn !== "function") continue;
    const clusters = Array.isArray(entry.clusterStates) ? entry.clusterStates : [];
    const captureCount = clusters.reduce((sum, cluster) => (
      sum + (Array.isArray(cluster?.sceneAreaChannels) ? cluster.sceneAreaChannels.length : 0)
    ), 0);
    if (captureCount <= 0) continue;
    try {
      entry.tickerFn(0);
      refreshed += captureCount;
    } catch (_err) {
      // ignore per-entry failures
    }
  }

  if (refreshed > 0) {
    debugLog("forced scene capture channel refresh", {
      refreshed,
    });
  }
}

function schedulePostRestoreImageChannelRefreshes() {
  const delays = [50, 180, 500, 1200, 2500];
  for (const delay of delays) {
    setTimeout(() => {
      try {
        refreshActivePlaceableImageChannels();
        refreshActiveSceneCaptureChannels();
      } catch (_err) {
        // ignore scheduled refresh failures
      }
    }, delay);
  }
}

function shaderOnRegion(regionId, opts = {}) {
  const macroOpts = normalizeShaderMacroOpts(opts);
  const fromBehavior = macroOpts._fromBehavior === true;
  const skipBehaviorSync = macroOpts._skipPersist === true;
  const behaviorId = macroOpts._behaviorId ?? null;
  const resolvedRegionId = resolveRegionId(regionId);
  const region = getRegionPlaceable(resolvedRegionId);
  if (!region) {
    ui.notifications.warn("No region found. Create one first or pass regionId.");
    return;
  }
  if (fromBehavior && behaviorId && getActiveRegionShaderEntryByBehavior(resolvedRegionId, behaviorId)) return;

  const importedDefaults = getImportedShaderDefaultsForSelection(macroOpts);

  const fallbackRadiusUnits = game.settings.get(MODULE_ID, "shaderRadiusUnits");
  const cfg = foundry.utils.mergeObject(foundry.utils.mergeObject({
    shape: "circle",
    shapeDirectionDeg: 0,
    shapeDistanceUnits: fallbackRadiusUnits,
    coneAngleDeg: 60,
    lineWidthUnits: 5,
    scale: game.settings.get(MODULE_ID, "shaderScale"),
    scaleX: game.settings.get(MODULE_ID, "shaderScaleX"),
    scaleY: game.settings.get(MODULE_ID, "shaderScaleY"),
    scaleToToken: false,
    radiusUnits: fallbackRadiusUnits,
    radiusFactor: 1.8,
    alpha: game.settings.get(MODULE_ID, "shaderAlpha"),
    intensity: game.settings.get(MODULE_ID, "shaderIntensity"),
    falloffPower: game.settings.get(MODULE_ID, "shaderFalloff"),
    density: game.settings.get(MODULE_ID, "shaderDensity"),
    flowMode: game.settings.get(MODULE_ID, "shaderFlow") ? 1 : 0,
    flowSpeed: game.settings.get(MODULE_ID, "shaderFlowSpeed"),
    flowTurbulence: game.settings.get(MODULE_ID, "shaderFlowTurbulence"),
    captureScale: game.settings.get(MODULE_ID, "shaderCaptureScale"),
    displayTimeMs: game.settings.get(MODULE_ID, "shaderDisplayTimeMs"),
    easeInMs: game.settings.get(MODULE_ID, "shaderEaseInMs"),
    easeOutMs: game.settings.get(MODULE_ID, "shaderEaseOutMs"),
    noiseOffset: [Math.random() * 1000, Math.random() * 1000],
    shaderId: game.settings.get(MODULE_ID, "shaderPreset"),
    useGradientMask: game.settings.get(MODULE_ID, "shaderGradientMask"),
    gradientMaskFadeStart: game.settings.get(MODULE_ID, "shaderGradientFadeStart"),
    regionUniformScale: true,
    debugMode: (() => {
      const mode = game.settings.get(MODULE_ID, "shaderDebugMode");
      if (mode === "uv") return 1;
      if (mode === "mask") return 2;
      return 0;
    })(),
    speed: game.settings.get(MODULE_ID, "shaderSpeed"),
    colorA: parseHexColorLike(game.settings.get(MODULE_ID, "shaderColorA"), 0xFF4A9A),
    colorB: parseHexColorLike(game.settings.get(MODULE_ID, "shaderColorB"), 0xFFB14A),
    bloom: true,
    bloomStrength: 1.0,
    bloomBlur: 7,
    bloomQuality: 2
  }, importedDefaults, { inplace: false }), macroOpts, { inplace: false });

  const worldLayer = resolveShaderWorldLayer(MODULE_ID, cfg);

  const rootContainer = new PIXI.Container();
  rootContainer.zIndex = resolveShaderContainerZIndex(cfg);
  rootContainer.eventMode = "none";
  addShaderContainerToWorldLayer(worldLayer, rootContainer, cfg);

  const regionShapes = extractRegionShapes(region);
  const regionBounds = computeRegionBounds(regionShapes);
  if (!regionShapes.length || !regionBounds) {
    rootContainer.destroy({ children: true });
    return ui.notifications.warn("Region has no supported shapes. Supported: rectangle, ellipse/circle, polygon.");
  }

  const selectedShaderId = cfg.shaderId ?? cfg.shaderMode ?? game.settings.get(MODULE_ID, "shaderPreset");
  shaderManager.queueBackgroundCompile?.(selectedShaderId, { reason: "canvas-apply" });
  if (!shaderManager.shaderSupportsTarget(selectedShaderId, "region")) {
    rootContainer.destroy({ children: true });
    ui.notifications.warn("This shader uses token/tile image channels and cannot be applied to regions.");
    return;
  }
  if (!fromBehavior && !skipBehaviorSync && shouldPersistRegionShader(cfg)) {
    const persistOpts = foundry.utils.mergeObject({}, cfg, { inplace: false });
    persistOpts.shaderId = selectedShaderId;
    void (async () => {
      const behaviorIdCreated = await upsertRegionShaderBehavior(region, persistOpts, { muteSync: true });
      if (!behaviorIdCreated) return;
      const alreadyActive = getActiveRegionShaderEntryByBehavior(resolvedRegionId, behaviorIdCreated);
      if (alreadyActive) return;
      const behaviorShaderOpts = foundry.utils.mergeObject({}, persistOpts, { inplace: false });
      behaviorShaderOpts._fromBehavior = true;
      behaviorShaderOpts._behaviorId = behaviorIdCreated;
      behaviorShaderOpts._skipPersist = true;
      shaderOnRegion(resolvedRegionId, behaviorShaderOpts);
    })();
    return;
  }
  const logScaleDebug = game.settings.get(MODULE_ID, "shaderDebug") === true;
  const aspectCorrectionEnabled = false;
  const localScaleX = Number(cfg.scaleX ?? 1);
  const localScaleY = Number(cfg.scaleY ?? 1);
  const scalarScale = Math.max(0.01, Number(cfg.scale ?? cfg.shaderScale ?? 1.0));
  const regionUseGradientMask = cfg.useGradientMask === true;
  const regionRadiusUnits = parseDistanceValue(cfg.radiusUnits ?? cfg.shaderRadiusUnits, fallbackRadiusUnits);
  const regionRadiusPx = (Number.isFinite(regionRadiusUnits) && regionRadiusUnits > 0)
    ? sceneUnitsToPixels(regionRadiusUnits)
    : null;
  const contiguousGroups = groupContiguousRegionShapes(regionShapes, 0.5, region);
  const treeComponents = getRegionSolidComponents(region);
  const useTreeComponents = treeComponents.length > 0;
  const clusterCount = useTreeComponents ? treeComponents.length : contiguousGroups.length;
  if (!clusterCount) {
    rootContainer.destroy({ children: true });
    return ui.notifications.warn("Region has no contiguous shape groups to render.");
  }

  const clusterStates = [];
  for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
    const clusterShapes = contiguousGroups[clusterIndex] ?? [];
    const componentNode = useTreeComponents ? treeComponents[clusterIndex] : null;
    const clusterBounds = componentNode
      ? (getRegionComponentBounds(componentNode) ?? computeRegionBounds(clusterShapes))
      : computeRegionBounds(clusterShapes);
    if (!clusterBounds) continue;

    const clusterContainer = new PIXI.Container();
    clusterContainer.eventMode = "none";
    rootContainer.addChild(clusterContainer);
    setCenterFromWorld(clusterContainer, clusterBounds.center, worldLayer);

    const halfW = Math.max(1, clusterBounds.width * 0.5);
    const halfH = Math.max(1, clusterBounds.height * 0.5);
    const geom = createQuadGeometry(halfW, halfH);

    const aspectScaled = { scaleX: localScaleX, scaleY: localScaleY };
    const maskOptions = {
      useGradientMask: regionUseGradientMask,
      radiusPx: regionRadiusPx,
      gradientMaskFadeStart: Number(cfg.gradientMaskFadeStart ?? cfg.shaderGradientFadeStart ?? game.settings.get(MODULE_ID, "shaderGradientFadeStart") ?? 0.8)
    };
    const customMaskTexture = componentNode
      ? createRegionComponentMaskTexture(componentNode, clusterBounds, maskOptions)
      : createRegionCompositeMaskTexture(clusterShapes, clusterBounds, maskOptions);
    const shaderResult = shaderManager.makeShader({
      ...cfg,
      scaleX: aspectScaled.scaleX,
      scaleY: aspectScaled.scaleY,
      shaderId: selectedShaderId,
      targetType: "region",
      targetId: resolvedRegionId,
      maskTexture: customMaskTexture,
      resolution: [Math.max(2, clusterBounds.width), Math.max(2, clusterBounds.height)]
    });
    const shader = shaderResult.shader;
    const appliedScale = {
      scaleX: Math.max(0.01, scalarScale * aspectScaled.scaleX),
      scaleY: Math.max(0.01, scalarScale * aspectScaled.scaleY)
    };
    if ("shaderScaleXY" in shader.uniforms) {
      shader.uniforms.shaderScaleXY = [appliedScale.scaleX, appliedScale.scaleY];
    }
    if ("shaderScale" in shader.uniforms) {
      shader.uniforms.shaderScale = scalarScale;
    }
    if (logScaleDebug) {
      console.debug(`${MODULE_ID} | region scale adjust`, {
        regionId: resolvedRegionId,
        clusterIndex,
        clusterSize: {
          width: clusterBounds.width,
          height: clusterBounds.height
        },
        groupShapeCount: clusterShapes.length,
        aspectCorrectionEnabled,
        inputScale: {
          scaleX: localScaleX,
          scaleY: localScaleY
        },
        aspectCorrectedScale: {
          scaleX: aspectScaled.scaleX,
          scaleY: aspectScaled.scaleY
        },
        scalarScale,
        appliedUniformScale: appliedScale,
        uniformScaleXY: shader.uniforms.shaderScaleXY
      });
    }

    const { sceneAreaChannels, runtimeBufferChannels, runtimeImageChannels } = setupShaderRuntimeChannels(shaderResult, shader, { captureSourceContainer: worldLayer });

    const mesh = new PIXI.Mesh(geom, shader);
    mesh.alpha = 1.0;
    mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
    clusterContainer.addChild(mesh);

    if (cfg.bloom && PIXI.filters?.BloomFilter) {
      const bloom = new PIXI.filters.BloomFilter(cfg.bloomStrength, cfg.bloomBlur, cfg.bloomQuality);
      bloom.padding = Math.max(halfW, halfH) * 2.0;
      mesh.filters = [bloom];
    }

    clusterStates.push({
      clusterContainer,
      mesh,
      shader,
      sceneAreaChannels,
      runtimeBufferChannels,
      runtimeImageChannels,
      customMaskTexture,
      halfW,
      halfH,
      clusterShapeCount: clusterShapes.length,
      useTreeComponentMask: !!componentNode
    });
  }
  if (!clusterStates.length) {
    rootContainer.destroy({ children: true });
    return ui.notifications.warn("Region clusters could not be rendered.");
  }

  const effectKey = createRegionEffectKey(resolvedRegionId, fromBehavior ? behaviorId : null);
  let t = 0;
  let elapsedMs = 0;
  let regionShapeSignature = getRegionShapeSignature(region);
  const { displayTimeMs, computeFadeAlpha } = createFadeAlphaComputer(cfg);
  for (const cluster of clusterStates) {
    if ("globalAlpha" in cluster.shader.uniforms) {
      cluster.shader.uniforms.globalAlpha = computeFadeAlpha(0);
    }
  }

  const tickerFn = (delta) => {
    const liveRegion = getRegionPlaceable(resolvedRegionId);
    if (!liveRegion) return shaderOffRegion(resolvedRegionId, { skipPersist: true, fromBehavior, effectKey });

    const liveSig = getRegionShapeSignature(liveRegion);
    if (liveSig !== regionShapeSignature) {
      regionShapeSignature = liveSig;
      if (fromBehavior) {
        syncRegionShaderFromBehavior(resolvedRegionId, { rebuild: true });
      } else {
        const liveEntry = _activeRegionShader.get(effectKey);
        const sourceOpts = foundry.utils.mergeObject({}, liveEntry?.sourceOpts ?? macroOpts, { inplace: false });
        sourceOpts._skipPersist = true;
        shaderOffRegion(resolvedRegionId, { skipPersist: true, fromBehavior: false, effectKey });
        shaderOnRegion(resolvedRegionId, sourceOpts);
      }
      return;
    }

    const dt = Number.isFinite(canvas.app.ticker.deltaMS) ? (canvas.app.ticker.deltaMS / 1000) : (delta / 60);
    elapsedMs += dt * 1000;
    if (displayTimeMs > 0 && elapsedMs >= displayTimeMs) {
      return shaderOffRegion(resolvedRegionId, { skipPersist: true, fromBehavior, effectKey });
    }

    let liveGroups = null;
    let liveComponents = null;
    if (useTreeComponents) {
      liveComponents = getRegionSolidComponents(liveRegion);
      if (liveComponents.length !== clusterStates.length) {
        if (fromBehavior) {
          syncRegionShaderFromBehavior(resolvedRegionId, { rebuild: true });
        } else {
          const liveEntry = _activeRegionShader.get(effectKey);
          const sourceOpts = foundry.utils.mergeObject({}, liveEntry?.sourceOpts ?? macroOpts, { inplace: false });
          sourceOpts._skipPersist = true;
          shaderOffRegion(resolvedRegionId, { skipPersist: true, fromBehavior: false, effectKey });
          shaderOnRegion(resolvedRegionId, sourceOpts);
        }
        return;
      }
    } else {
      const liveShapes = extractRegionShapes(liveRegion);
      liveGroups = groupContiguousRegionShapes(liveShapes, 0.5, liveRegion);
      if (liveGroups.length !== clusterStates.length) {
        if (fromBehavior) {
          syncRegionShaderFromBehavior(resolvedRegionId, { rebuild: true });
        } else {
          const liveEntry = _activeRegionShader.get(effectKey);
          const sourceOpts = foundry.utils.mergeObject({}, liveEntry?.sourceOpts ?? macroOpts, { inplace: false });
          sourceOpts._skipPersist = true;
          shaderOffRegion(resolvedRegionId, { skipPersist: true, fromBehavior: false, effectKey });
          shaderOnRegion(resolvedRegionId, sourceOpts);
        }
        return;
      }
    }

    for (let i = 0; i < clusterStates.length; i += 1) {
      const cluster = clusterStates[i];
      const clusterBounds = useTreeComponents
        ? getRegionComponentBounds(liveComponents[i])
        : computeRegionBounds(liveGroups[i]);
      if (!clusterBounds) continue;

      setCenterFromWorld(cluster.clusterContainer, clusterBounds.center, worldLayer);

      if ("globalAlpha" in cluster.shader.uniforms) {
        cluster.shader.uniforms.globalAlpha = computeFadeAlpha(elapsedMs);
      }

      if (cluster.mesh.filters?.length) {
        const pad = Math.max(cluster.halfW, cluster.halfH) * 0.8 + cfg.bloomBlur * 30;
        const bounds = cluster.mesh.getBounds(false);
        cluster.mesh.filterArea = new PIXI.Rectangle(
          bounds.x - pad,
          bounds.y - pad,
          bounds.width + pad * 2,
          bounds.height + pad * 2
        );
      }

      for (const runtimeBuffer of cluster.runtimeBufferChannels) {
        runtimeBuffer.update(dt);
      }

      if (cluster.sceneAreaChannels.length) {
        const captureScale = Math.max(0.01, Number(cfg.captureScale ?? 1.0));
        const captureRadiusX = cluster.halfW * captureScale;
        const captureRadiusY = cluster.halfH * captureScale;
        const captureRotationDeg = Number.isFinite(Number(cfg.captureRotationDeg))
          ? Number(cfg.captureRotationDeg)
          : 0;
        const captureFlipHorizontal = parseBooleanLike(cfg.captureFlipHorizontal, false);
        const captureFlipVerticalUser = parseBooleanLike(cfg.captureFlipVertical, false);
        const captureFlipVertical = !captureFlipVerticalUser;
        for (const capture of cluster.sceneAreaChannels) {
          capture.update({
            centerWorld: clusterBounds.center,
            radiusWorldX: captureRadiusX,
            radiusWorldY: captureRadiusY,
            flipX: captureFlipHorizontal,
            flipY: captureFlipVertical,
            rotationDeg: captureRotationDeg,
            excludeDisplayObject: rootContainer
          });
        }
      }

      updateShaderTimeUniforms(cluster.shader, dt, cfg.speed, t);
    }

    t += delta;
  };

  canvas.app.ticker.add(tickerFn);
  registerActiveRegionShaderEntry(effectKey, {
    effectKey,
    regionId: resolvedRegionId,
    container: rootContainer,
    tickerFn,
    clusterStates,
    sourceOpts: foundry.utils.mergeObject(
      foundry.utils.mergeObject({}, macroOpts, { inplace: false }),
      { shaderId: selectedShaderId },
      { inplace: false },
    ),
    fromBehavior,
    behaviorId
  });
}

function shaderOffRegion(regionId, { skipPersist = false, fromBehavior = false, effectKey = null, behaviorId = null } = {}) {
  const resolvedRegionId = resolveRegionId(regionId);
  if (!resolvedRegionId) return;

  const regionDoc = getRegionDocument(resolvedRegionId);
  if (!skipPersist && !fromBehavior && !effectKey && !behaviorId && regionDoc) {
    void clearRegionShaderBehaviors(regionDoc, { muteSync: true });
  }

  const entries = [];
  if (effectKey) {
    const match = _activeRegionShader.get(effectKey);
    if (match && match.regionId === resolvedRegionId) entries.push(match);
  } else if (behaviorId) {
    const match = getActiveRegionShaderEntryByBehavior(resolvedRegionId, behaviorId);
    if (match) entries.push(match);
  } else {
    entries.push(...getActiveRegionShaderEntries(resolvedRegionId));
  }

  for (const entry of entries) {
    canvas.app.ticker.remove(entry.tickerFn);
    for (const cluster of (entry.clusterStates ?? [])) {
      destroyRegionClusterRuntime(cluster);
    }
    entry.container?.destroy({ children: true });
    unregisterActiveRegionShaderEntry(entry.effectKey);
  }
}

function shaderOffRegionBehavior(regionId, behaviorId, { skipPersist = false } = {}) {
  const resolvedRegionId = resolveRegionId(regionId);
  if (!resolvedRegionId) {
    ui.notifications.warn("No region found. Create one first or pass regionId.");
    return;
  }

  const targetBehaviorId = String(behaviorId ?? "");
  if (!targetBehaviorId) {
    ui.notifications.warn("Missing behaviorId for region effect removal.");
    return;
  }

  const regionDoc = getRegionDocument(resolvedRegionId);
  if (!skipPersist && regionDoc) {
    void clearRegionShaderBehaviorById(regionDoc, targetBehaviorId, { muteSync: true });
  }

  shaderOffRegion(resolvedRegionId, {
    skipPersist: true,
    fromBehavior: true,
    behaviorId: targetBehaviorId
  });
}

function shaderToggleRegion(regionId, opts = {}) {
  const resolvedRegionId = resolveRegionId(regionId);
  if (!resolvedRegionId) {
    ui.notifications.warn("No region found. Create one first or pass regionId.");
    return;
  }

  const macroOpts = normalizeShaderMacroOpts(opts);
  const behaviorId = macroOpts._behaviorId ?? null;
  if (behaviorId) {
    const activeBehaviorEntry = getActiveRegionShaderEntryByBehavior(resolvedRegionId, behaviorId);
    if (activeBehaviorEntry) {
      shaderOffRegion(resolvedRegionId, { skipPersist: true, fromBehavior: true, effectKey: activeBehaviorEntry.effectKey });
    } else {
      shaderOnRegion(resolvedRegionId, macroOpts);
    }
    return;
  }

  if (hasActiveRegionShader(resolvedRegionId)) shaderOffRegion(resolvedRegionId);
  else shaderOnRegion(resolvedRegionId, macroOpts);
}

// ------------------------------
// Networking
// ------------------------------
networkController = createNetworkController({
  moduleId: MODULE_ID,
  socket: SOCKET,
  resolveTemplateId,
  resolveTileId,
  resolveRegionId,
  shaderOn,
  shaderOff,
  shaderToggle,
  shaderOnTemplate,
  shaderOffTemplate,
  shaderToggleTemplate,
  shaderOnTile,
  shaderOffTile,
  shaderToggleTile,
  shaderOnRegion,
  shaderOffRegion,
  shaderToggleRegion,
  shaderOffRegionBehavior,
  deleteAllTokenFX,
  deleteAllTemplateFX,
  deleteAllTileFX
});

const {
  normalizeTokenBroadcastPayload,
  normalizeTemplateBroadcastPayload,
  normalizeTileBroadcastPayload,
  normalizeRegionBroadcastPayload,
  normalizeRegionBehaviorBroadcastPayload,
  broadcastShaderOn,
  broadcastShaderOff,
  broadcastShaderToggle,
  broadcastShaderOnTemplate,
  broadcastShaderOffTemplate,
  broadcastShaderToggleTemplate,
  broadcastShaderOnTile,
  broadcastShaderOffTile,
  broadcastShaderToggleTile,
  broadcastShaderOnRegion,
  broadcastShaderOffRegion,
  broadcastShaderOffRegionBehavior,
  broadcastShaderToggleRegion,
  broadcastDeleteAllTokenFX,
  broadcastDeleteAllTemplateFX,
  broadcastDeleteAllTileFX,
  registerSocketReceiver
} = networkController;
// ------------------------------
// Init
// ------------------------------
Hooks.once("init", () => {
  registerModuleSettings({
    moduleId: MODULE_ID,
    shaderManager,
    menus: { ShaderSettingsMenu, DebugSettingsMenu, ShaderLibraryMenu }
  });
  registerRegionShaderBehavior({
    moduleId: MODULE_ID,
    getShaderChoices: () => shaderManager.getShaderChoicesForTarget("region"),
    isBuiltinShader: (shaderId) => shaderManager.isBuiltinShader(shaderId)
  });
});


Hooks.on("getApplicationHeaderButtons", (app, buttons) => {
  addIndyFxDocumentConfigButton(app, buttons);
});
Hooks.on("getHeaderControlsApplicationV2", (app, buttons) => {
  addIndyFxDocumentConfigButton(app, buttons);
});

Hooks.on("renderTokenHUD", (app, html, data) => {
  debugLog("renderTokenHUD fired", {
    appClass: app?.constructor?.name ?? null,
    dataId: data?._id ?? data?.id ?? null,
    objectId: app?.object?.id ?? app?.object?.document?.id ?? null,
  });
  addIndyFxHudEditButton({ targetType: "token", app, html, data });
});
Hooks.on("renderTileHUD", (app, html, data) => {
  debugLog("renderTileHUD fired", {
    appClass: app?.constructor?.name ?? null,
    dataId: data?._id ?? data?.id ?? null,
    objectId: app?.object?.id ?? app?.object?.document?.id ?? null,
  });
  addIndyFxHudEditButton({ targetType: "tile", app, html, data });
});
// Foundry/system variants may emit one of these for measured template HUD rendering.
Hooks.on("renderMeasuredTemplateHUD", (app, html, data) => {
  debugLog("renderMeasuredTemplateHUD fired", {
    appClass: app?.constructor?.name ?? null,
    dataId: data?._id ?? data?.id ?? null,
    objectId: app?.object?.id ?? app?.object?.document?.id ?? null,
  });
  addIndyFxHudEditButton({ targetType: "template", app, html, data });
});
Hooks.on("renderTemplateHUD", (app, html, data) => {
  debugLog("renderTemplateHUD fired", {
    appClass: app?.constructor?.name ?? null,
    dataId: data?._id ?? data?.id ?? null,
    objectId: app?.object?.id ?? app?.object?.document?.id ?? null,
  });
  addIndyFxHudEditButton({ targetType: "template", app, html, data });
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!controls) return;

  const targetControlNames = new Set([
    "token",
    "tokens",
    "tile",
    "tiles",
    "template",
    "templates",
    "measure",
  ]);

  const addTool = (control, tool) => {
    if (!control || typeof control !== "object") return;
    if (Array.isArray(control.tools)) {
      const existingIndex = control.tools.findIndex(
        (entry) => entry?.name === tool.name,
      );
      if (existingIndex >= 0) {
        control.tools[existingIndex] = {
          ...control.tools[existingIndex],
          ...tool,
        };
      } else {
        control.tools.push(tool);
      }
      return;
    }
    control.tools ??= {};
    control.tools[tool.name] = {
      ...(control.tools[tool.name] ?? {}),
      ...tool,
    };
  };

  if (Array.isArray(controls)) {
    for (const control of controls) {
      const name = String(control?.name ?? "").toLowerCase();
      if (!targetControlNames.has(name)) continue;
      addTool(control, {
        name: SHADER_LIBRARY_TOOL_NAME,
        title: "Shader Library",
        icon: "fa-jelly fa-regular fa-sparkles",
        button: true,
        visible: true,
        onClick: () => openShaderLibraryWindow(),
      });
    }
    return;
  }

  for (const [key, control] of Object.entries(controls)) {
    const name = String(control?.name ?? key ?? "").toLowerCase();
    if (!targetControlNames.has(name)) continue;
    addTool(control, {
      name: SHADER_LIBRARY_TOOL_NAME,
      title: "Shader Library",
      icon: "fa-jelly fa-regular fa-sparkles",
      button: true,
      visible: true,
      onClick: () => openShaderLibraryWindow(),
    });
  }
});

Hooks.on("canvasReady", () => {
  bindShaderLibraryDragDropHandlers();
  shaderManager.queuePreloadedShaderCompiles?.({ reason: "module-init" });
  restoreRegionShaderBehaviors();
  restorePersistentTokenTemplateTileShaders();
  schedulePostRestoreImageChannelRefreshes();
  scheduleDeferredPersistentShaderRestore();
});

Hooks.on("canvasTearDown", () => {
  unbindShaderLibraryDragDropHandlers();
});

Hooks.once("ready", async () => {
  await shaderManager.enforceValidSelection();
  bindShaderLibraryDragDropHandlers();
  console.log(`${MODULE_ID} | ready hook fired`, { user: game.user?.name, isGM: game.user?.isGM });

  registerSocketReceiver();
  Hooks.on("updateMeasuredTemplate", (doc, changed) => {
    if (!_activeTemplateShader.has(doc.id)) return;
    const shapeKeys = ["t", "distance", "width", "angle", "direction"];
    const needsRebuild = shapeKeys.some((k) => Object.prototype.hasOwnProperty.call(changed ?? {}, k));
    if (!needsRebuild) return;
    const active = _activeTemplateShader.get(doc.id);
    const sourceOpts = foundry.utils.mergeObject({}, active?.sourceOpts ?? {}, { inplace: false });
    shaderOffTemplate(doc.id, { skipPersist: true });
    shaderOnTemplate(doc.id, sourceOpts);
  });

  Hooks.on("deleteMeasuredTemplate", (doc) => {
    shaderOffTemplate(doc.id, { skipPersist: true });
  });

  Hooks.on("updateToken", (doc, changed) => {
    if (!_activeShader.has(doc.id)) return;
    const needsRebuild = tokenShaderNeedsRebuildFromUpdate(changed);
    debugLog("token update for active shader", {
      tokenId: doc?.id,
      changed,
      needsRebuild,
      textureScaleX: doc?.texture?.scaleX,
      textureScaleY: doc?.texture?.scaleY,
    });
    if (!needsRebuild) return;
    const active = _activeShader.get(doc.id);
    const sourceOpts = foundry.utils.mergeObject({}, active?.sourceOpts ?? {}, { inplace: false });
    shaderOff(doc.id, { skipPersist: true });
    shaderOn(doc.id, sourceOpts);
  });

  Hooks.on("refreshToken", (token, flags) => {
    const tokenId = String(token?.document?.id ?? token?.id ?? "").trim();
    if (!tokenId || !_activeShader.has(tokenId)) return;
    const needsRebuild = tokenShaderNeedsRebuildFromRefresh(flags);
    if (!needsRebuild) return;
    const active = _activeShader.get(tokenId);
    const shouldUseTokenScale =
      active?.usesTokenTileImage === true ||
      active?.useTokenTextureScale === true;
    if (!shouldUseTokenScale) return;
    const nextSnapshot = getTokenShaderStateSnapshot(token, {
      useTokenTextureScale: shouldUseTokenScale,
      rotateWithToken: active?.rotateWithToken === true,
    });
    if (!tokenShaderStateChanged(active?.tokenStateSnapshot, nextSnapshot)) {
      return;
    }
    debugLog("token refresh for active shader", {
      tokenId,
      flags,
      needsRebuild,
      usesTokenTileImage: active?.usesTokenTileImage === true,
      useTokenTextureScale: active?.useTokenTextureScale === true,
      previousSnapshot: active?.tokenStateSnapshot ?? null,
      nextSnapshot,
      textureScaleX: token?.document?.texture?.scaleX,
      textureScaleY: token?.document?.texture?.scaleY,
    });
    const sourceOpts = foundry.utils.mergeObject({}, active?.sourceOpts ?? {}, { inplace: false });
    shaderOff(tokenId, { skipPersist: true });
    shaderOn(tokenId, sourceOpts);
  });

  Hooks.on("updateTile", (doc, changed) => {
    if (!_activeTileShader.has(doc.id)) return;
    const shapeKeys = ["x", "y", "width", "height", "rotation"];
    const needsRebuild = shapeKeys.some((k) => Object.prototype.hasOwnProperty.call(changed ?? {}, k));
    if (!needsRebuild) return;
    const active = _activeTileShader.get(doc.id);
    const sourceOpts = foundry.utils.mergeObject({}, active?.sourceOpts ?? {}, { inplace: false });
    shaderOffTile(doc.id, { skipPersist: true });
    shaderOnTile(doc.id, sourceOpts);
  });

  Hooks.on("deleteTile", (doc) => {
    shaderOffTile(doc.id, { skipPersist: true });
  });

  Hooks.on("updateRegion", (doc, changed) => {
    const hasActive = hasActiveRegionShader(doc.id);
    const hasBehavior = getRegionShaderBehaviorDocuments(doc).length > 0;
    if (!hasActive && !hasBehavior) return;
    if (!changed || !Object.keys(changed).length) return;

    if (hasBehavior) {
      syncRegionShaderFromBehavior(doc.id, { rebuild: true });
    }

    const activeEntries = getActiveRegionShaderEntries(doc.id, { fromBehavior: false });
    for (const active of activeEntries) {
      const sourceOpts = foundry.utils.mergeObject({}, active?.sourceOpts ?? {}, { inplace: false });
      sourceOpts._skipPersist = true;
      shaderOffRegion(doc.id, { skipPersist: true, fromBehavior: false, effectKey: active.effectKey });
      shaderOnRegion(doc.id, sourceOpts);
    }
  });

  Hooks.on("deleteRegion", (doc) => {
    shaderOffRegion(doc.id, { skipPersist: true, fromBehavior: true });
  });

  Hooks.on("createRegionBehavior", (doc) => {
    if (doc?.type !== REGION_SHADER_BEHAVIOR_TYPE) return;
    const regionId = doc?.parent?.id ?? doc?.region?.id;
    if (!regionId) return;
    if (_muteRegionBehaviorSync.has(regionId)) return;
    syncRegionShaderFromBehavior(regionId, { rebuild: true });
  });

  Hooks.on("updateRegionBehavior", (doc) => {
    if (doc?.type !== REGION_SHADER_BEHAVIOR_TYPE) return;
    const regionId = doc?.parent?.id ?? doc?.region?.id;
    if (!regionId) return;
    if (_muteRegionBehaviorSync.has(regionId)) return;
    syncRegionShaderFromBehavior(regionId, { rebuild: true });
  });

  Hooks.on("deleteRegionBehavior", (doc) => {
    if (doc?.type !== REGION_SHADER_BEHAVIOR_TYPE) return;
    const regionId = doc?.parent?.id ?? doc?.region?.id;
    if (!regionId) return;
    if (_muteRegionBehaviorSync.has(regionId)) return;
    syncRegionShaderFromBehavior(regionId, { rebuild: true });
  });

  // API
  game.indyFX = {
    shaderOn: (tokenId, opts) => shaderOn(tokenId, opts),
    shaderOff: (tokenId) => shaderOff(tokenId),
    shaderToggle: (tokenId, opts) => shaderToggle(tokenId, opts),
    deleteAllTokenFX: () => broadcastDeleteAllTokenFX(),
    deleteAllTokenFXLocal: () => deleteAllTokenFX(),
    shaderOnTemplate: (templateId, opts) => shaderOnTemplate(templateId, opts),
    shaderOffTemplate: (templateId) => shaderOffTemplate(templateId),
    shaderToggleTemplate: (templateId, opts) => shaderToggleTemplate(templateId, opts),
    deleteAllTemplateFX: () => broadcastDeleteAllTemplateFX(),
    deleteAllTemplateFXLocal: () => deleteAllTemplateFX(),
    shaderOnTile: (tileId, opts) => shaderOnTile(tileId, opts),
    shaderOffTile: (tileId) => shaderOffTile(tileId),
    shaderToggleTile: (tileId, opts) => shaderToggleTile(tileId, opts),
    deleteAllTileFX: () => broadcastDeleteAllTileFX(),
    deleteAllTileFXLocal: () => deleteAllTileFX(),
    broadcastDeleteAllTokenFX: () => broadcastDeleteAllTokenFX(),
    broadcastDeleteAllTemplateFX: () => broadcastDeleteAllTemplateFX(),
    broadcastDeleteAllTileFX: () => broadcastDeleteAllTileFX(),
    shaderOnRegion: (regionId, opts) => shaderOnRegion(regionId, opts),
    shaderOffRegion: (regionId) => shaderOffRegion(regionId),
    shaderOffRegionBehavior: (regionId, behaviorId, options) => shaderOffRegionBehavior(regionId, behaviorId, options),
    shaderToggleRegion: (regionId, opts) => shaderToggleRegion(regionId, opts),
    broadcastShaderOn: (payloadOrTokenId, maybeOpts) => broadcastShaderOn(normalizeTokenBroadcastPayload(payloadOrTokenId, maybeOpts)),
    broadcastShaderOff: (payloadOrTokenId) => broadcastShaderOff(normalizeTokenBroadcastPayload(payloadOrTokenId)),
    broadcastShaderToggle: (payloadOrTokenId, maybeOpts) => broadcastShaderToggle(normalizeTokenBroadcastPayload(payloadOrTokenId, maybeOpts)),
    broadcastShaderOnTemplate: (payloadOrTemplateId, maybeOpts) => broadcastShaderOnTemplate(normalizeTemplateBroadcastPayload(payloadOrTemplateId, maybeOpts)),
    broadcastShaderOffTemplate: (payloadOrTemplateId) => broadcastShaderOffTemplate(normalizeTemplateBroadcastPayload(payloadOrTemplateId)),
    broadcastShaderToggleTemplate: (payloadOrTemplateId, maybeOpts) => broadcastShaderToggleTemplate(normalizeTemplateBroadcastPayload(payloadOrTemplateId, maybeOpts)),
    broadcastShaderOnTile: (payloadOrTileId, maybeOpts) => broadcastShaderOnTile(normalizeTileBroadcastPayload(payloadOrTileId, maybeOpts)),
    broadcastShaderOffTile: (payloadOrTileId) => broadcastShaderOffTile(normalizeTileBroadcastPayload(payloadOrTileId)),
    broadcastShaderToggleTile: (payloadOrTileId, maybeOpts) => broadcastShaderToggleTile(normalizeTileBroadcastPayload(payloadOrTileId, maybeOpts)),
    broadcastShaderOnRegion: (payloadOrRegionId, maybeOpts) => broadcastShaderOnRegion(normalizeRegionBroadcastPayload(payloadOrRegionId, maybeOpts)),
    broadcastShaderOffRegion: (payloadOrRegionId) => broadcastShaderOffRegion(normalizeRegionBroadcastPayload(payloadOrRegionId)),
    broadcastShaderOffRegionBehavior: (payloadOrRegionId, maybeBehaviorId) => broadcastShaderOffRegionBehavior(normalizeRegionBehaviorBroadcastPayload(payloadOrRegionId, maybeBehaviorId)),
    broadcastShaderToggleRegion: (payloadOrRegionId, maybeOpts) => broadcastShaderToggleRegion(normalizeRegionBroadcastPayload(payloadOrRegionId, maybeOpts)),
    startShaderPlacement: (tokenId, opts) => startShaderPlacement(tokenId, opts),
    cancelShaderPlacement: () => cancelShaderPlacement(false),
    debugDumpShaderContainers: (payload = {}) => debugDumpShaderContainers(payload),
    debugDumpShaderContainerParents: (payload = {}) => debugDumpShaderContainers(payload),
    shaders: {
      list: () => shaderManager.getCombinedEntries(),
      choices: () => shaderManager.getShaderChoices(),
      importShaderToy: (payload = {}) => shaderManager.importShaderToy(payload),
      importShaderToyUrl: (payload = {}) => shaderManager.importShaderToyFromUrl(payload),
      importShaderToyJson: (payload = {}) => shaderManager.importShaderToyJson(payload),
      updateImportedShader: (shaderId, payload = {}) => shaderManager.updateImportedShader(shaderId, payload),
      updateImportedChannels: (shaderId, payload = {}) => shaderManager.updateImportedShaderChannels(shaderId, payload),
      duplicateImported: (shaderId, payload = {}) => shaderManager.duplicateImportedShader(shaderId, payload),
      regenerateThumbnail: (shaderId, payload = {}) => shaderManager.regenerateImportedShaderThumbnail(shaderId, payload),
      removeImported: (shaderId) => shaderManager.removeImportedShader(shaderId)
    }
  };
});

























