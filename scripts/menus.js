import {
  SHADER_SETTINGS_KEYS,
  SPARK_SETTINGS_KEYS,
  DEBUG_SETTINGS_KEYS,
} from "./settings.js";
export function createMenus({ moduleId, shaderManager }) {
  const MODULE_ID = moduleId;
  const isDebugLoggingEnabled = () => {
    try {
      return game?.settings?.get?.(MODULE_ID, "shaderDebug") === true;
    } catch (_err) {
      return false;
    }
  };
  const debugLog = (message, payload = undefined) => {
    if (!isDebugLoggingEnabled()) return;
    if (payload === undefined) console.debug(`${MODULE_ID} | ${message}`);
    else console.debug(`${MODULE_ID} | ${message}`, payload);
  };
  const ApplicationV2Base = foundry.applications.api.ApplicationV2;
  const HandlebarsV2Mixin =
    foundry.applications.api.HandlebarsApplicationMixin ??
    HandlebarsApplicationMixin;
  const FormDataExtended = foundry.applications.ux.FormDataExtended;
  function openImagePicker({ current = "", callback } = {}) {
    try {
      const Picker =
        globalThis.FilePicker ??
        foundry?.applications?.apps?.FilePicker?.implementation;
      if (!Picker) {
        ui.notifications.warn(
          "FilePicker is unavailable in this Foundry version.",
        );
        return;
      }
      const picker = new Picker({
        type: "imagevideo",
        current: String(current ?? ""),
        callback: (path) => callback?.(path),
      });
      if (typeof picker.render === "function") {
        picker.render(true);
        return;
      }
      if (typeof picker.browse === "function") {
        picker.browse();
        return;
      }
      ui.notifications.warn(
        "Could not open FilePicker in this Foundry version.",
      );
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to open image picker`, err);
      ui.notifications.error("Failed to open image picker.");
    }
  }
  const SHADERTOY_JSON_DEVTOOLS_SNIPPET = [
    'copy(JSON.stringify(await fetch("/shadertoy", {',
    '  method: "POST",',
    '  headers: {"content-type": "application/x-www-form-urlencoded; charset=UTF-8"},',
    "  body: (() => {",
    "    const shaderId = location.pathname.match(/\\/(?:view|embed)\\/([A-Za-z0-9_-]+)/)?.[1];",
    '    if (!shaderId) throw new Error("Could not detect shader id from URL.");',
    "    return `s=${encodeURIComponent(JSON.stringify({ shaders: [shaderId] }))}&nt=1&nl=1&np=1`;",
    "  })()",
    "}).then(r => r.json())))",
  ].join("\n");
  async function copyTextToClipboard(text) {
    const value = String(text ?? "");
    if (!value) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_err) {
      /* Fallback below. */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_err) {
      return false;
    }
  }
  function resolveElementRoot(candidate) {
    if (!candidate) return null;
    if (candidate instanceof Element) return candidate;
    if (
      typeof candidate?.querySelector === "function" &&
      typeof candidate?.addEventListener === "function"
    )
      return candidate;
    if (candidate?.element) return resolveElementRoot(candidate.element);
    if (Array.isArray(candidate) && candidate[0] instanceof Element)
      return candidate[0];
    if (
      typeof candidate?.length === "number" &&
      candidate[0] instanceof Element
    )
      return candidate[0];
    if (typeof candidate?.get === "function") {
      const maybe = candidate.get(0);
      if (maybe instanceof Element) return maybe;
    }
    return null;
  }
  function collectSearchRoots(start) {
    const roots = [];
    const seen = new Set();
    const add = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      roots.push(node);
      if (node instanceof HTMLElement && node.shadowRoot) add(node.shadowRoot);
    };
    add(start);
    if (start instanceof Element) {
      let parent = start.parentElement;
      while (parent) {
        add(parent);
        parent = parent.parentElement;
      }
    }
    return roots;
  }
  function findFirstInRoots(start, selector) {
    for (const root of collectSearchRoots(start)) {
      if (typeof root?.querySelector !== "function") continue;
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  function formatScalarNumber(value, kind = "float") {
    const n = Number(value);
    if (!Number.isFinite(n)) return kind === "int" ? "0" : "0.0";
    if (kind === "int") return String(Math.round(n));
    const rounded = Math.round(n * 1000000) / 1000000;
    const asText = String(rounded);
    return asText.includes(".") ? asText : `${asText}.0`;
  }

  function formatVectorNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0.0";
    const rounded = Math.round(n * 1000000) / 1000000;
    const asText = String(rounded);
    return asText.includes(".") ? asText : `${asText}.0`;
  }

  function escapeRegExp(value) {
    return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function vecToHex(values) {
    const rgb = [0, 1, 2].map((idx) => {
      const v = Number(values?.[idx] ?? 0);
      const clamped = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
      return Math.round(clamped * 255);
    });
    return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }

  function hexToVecRgb(hex) {
    const clean = String(hex ?? "")
      .trim()
      .replace(/^#/, "")
      .replace(/[^0-9a-f]/gi, "")
      .padEnd(6, "0")
      .slice(0, 6);
    if (!clean) return [0, 0, 0];
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return [r, g, b].map((v) => (Number.isFinite(v) ? v : 0));
  }

  function extractEditableShaderVariables(source) {
    const text = String(source ?? "");
    const result = [];
    const seen = new Set();

    const scalarRe = /const\s+(float|int)\s+([A-Za-z_]\w*)\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[-+]?\d+)\s*;/g;
    let m;
    while ((m = scalarRe.exec(text))) {
      const type = String(m[1]);
      const name = String(m[2]);
      const key = `${type}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        kind: "scalar",
        declaration: "const",
        type,
        name,
        value: Number(m[3]),
      });
    }

    const vecRe = /const\s+(vec3|vec4)\s+([A-Za-z_]\w*)\s*=\s*(vec3|vec4)\s*\(([\s\S]*?)\)\s*;/g;
    while ((m = vecRe.exec(text))) {
      const type = String(m[1]);
      const ctor = String(m[3]);
      if (type !== ctor) continue;
      const name = String(m[2]);
      const key = `${type}:${name}`;
      if (seen.has(key)) continue;

      const rawParts = String(m[4])
        .split(",")
        .map((part) => String(part ?? "").trim())
        .filter((part) => part.length > 0);
      const expected = type === "vec4" ? 4 : 3;
      if (rawParts.length !== expected) continue;
      const values = rawParts.map((part) => Number(part));
      if (!values.every((v) => Number.isFinite(v))) continue;

      seen.add(key);
      result.push({
        kind: "vector",
        declaration: "const",
        type,
        name,
        values,
      });
    }

    const defineRe = /^[ \t]*#define[ \t]+([A-Za-z_]\w*)[ \t]+([^\r\n]+)/gm;
    while ((m = defineRe.exec(text))) {
      const name = String(m[1] ?? "").trim();
      const rawExpr = String(m[2] ?? "").replace(/\/\/.*$/, "").trim();
      if (!name || !rawExpr) continue;

      const vecMatch = rawExpr.match(/^(vec3|vec4)\s*\(([\s\S]*?)\)\s*$/);
      if (vecMatch) {
        const type = String(vecMatch[1]);
        const parts = String(vecMatch[2])
          .split(",")
          .map((part) => String(part ?? "").trim())
          .filter((part) => part.length > 0);
        const expected = type === "vec4" ? 4 : 3;
        if (parts.length !== expected) continue;
        const values = parts.map((part) => Number(part));
        if (!values.every((v) => Number.isFinite(v))) continue;

        const key = `define:${type}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          kind: "vector",
          declaration: "define",
          type,
          name,
          values,
        });
        continue;
      }

      const typedScalar = rawExpr.match(
        /^(float|int)\s*\(\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[-+]?\d+)\s*\)\s*$/,
      );
      if (typedScalar) {
        const type = String(typedScalar[1]);
        const value = Number(typedScalar[2]);
        if (!Number.isFinite(value)) continue;
        const key = `define:${type}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          kind: "scalar",
          declaration: "define",
          type,
          name,
          value,
        });
        continue;
      }

      const plainScalar = rawExpr.match(
        /^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[-+]?\d+)\s*$/,
      );
      if (plainScalar) {
        const rawNum = String(plainScalar[1]);
        const value = Number(rawNum);
        if (!Number.isFinite(value)) continue;
        const type = /[.eE]/.test(rawNum) ? "float" : "int";
        const key = `define:${type}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          kind: "scalar",
          declaration: "define",
          type,
          name,
          value,
        });
      }
    }

    result.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
    return result;
  }

  function applyEditableShaderVariables(source, variables) {
    let next = String(source ?? "");
    for (const variable of Array.isArray(variables) ? variables : []) {
      const type = String(variable?.type ?? "").trim();
      const name = String(variable?.name ?? "").trim();
      const declaration = String(variable?.declaration ?? "const").trim();
      if (!type || !name) continue;
      const escapedName = escapeRegExp(name);

      if (variable?.kind === "scalar") {
        const valueText = formatScalarNumber(variable?.value, type);
        if (declaration === "define") {
          const re = new RegExp(
            `(^[ \\t]*#define[ \\t]+${escapedName}[ \\t]+)([^\\r\\n]*)(\\r?\\n|$)`,
            "m",
          );
          next = next.replace(re, `$1${valueText}$3`);
        } else {
          const re = new RegExp(`(const\\s+${type}\\s+${escapedName}\\s*=\\s*)([^;]+)(;)`);
          next = next.replace(re, `$1${valueText}$3`);
        }
        continue;
      }

      if (variable?.kind === "vector") {
        const values = Array.isArray(variable?.values) ? variable.values : [];
        const expected = type === "vec4" ? 4 : 3;
        const clipped = values.slice(0, expected);
        while (clipped.length < expected) clipped.push(0);
        const valueText = `${type}(${clipped.map((v) => formatVectorNumber(v)).join(", ")})`;
        if (declaration === "define") {
          const re = new RegExp(
            `(^[ \\t]*#define[ \\t]+${escapedName}[ \\t]+)([^\\r\\n]*)(\\r?\\n|$)`,
            "m",
          );
          next = next.replace(re, `$1${valueText}$3`);
        } else {
          const re = new RegExp(`(const\\s+${type}\\s+${escapedName}\\s*=\\s*${type}\\s*\\()([\\s\\S]*?)(\\)\\s*;)`);
          next = next.replace(re, `$1${clipped.map((v) => formatVectorNumber(v)).join(", ")}$3`);
        }
      }
    }
    return next;
  }
  function parseHexColorLike(value, fallback = 0xffffff) {
    if (Number.isFinite(Number(value))) {
      const n = Math.round(Number(value));
      return Math.max(0, Math.min(0xffffff, n));
    }
    const clean = String(value ?? "")
      .trim()
      .replace(/^#|^0x/i, "")
      .replace(/[^0-9a-f]/gi, "");
    if (!clean) return fallback;
    const n = parseInt(clean.slice(0, 6), 16);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(0xffffff, n));
  }
  const channelPreviewCache = new Map();
  function seededRand(seed) {
    let x = seed >>> 0;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return ((x >>> 0) % 10000) / 10000;
    };
  }
  function makeChannelPreviewDataUrl(mode, index = 0) {
    const key = String(mode ?? "auto") + ":" + (Number(index) || 0);
    const cached = channelPreviewCache.get(key);
    if (cached) return cached;
    const canvasEl = document.createElement("canvas");
    canvasEl.width = 256;
    canvasEl.height = 256;
    const ctx = canvasEl.getContext("2d", { alpha: true });
    if (!ctx) return "";
    const gradient = ctx.createLinearGradient(0, 0, 256, 256);
    const drawGrid = (alpha = 0.25, step = 32) => {
      ctx.strokeStyle = "rgba(255,255,255," + alpha + ")";
      ctx.lineWidth = 1;
      for (let x = 0; x <= 256; x += step) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, 256);
        ctx.stroke();
      }
      for (let y = 0; y <= 256; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(256, y + 0.5);
        ctx.stroke();
      }
    };
    switch (mode) {
      case "sceneCapture":
        gradient.addColorStop(0, "#283a56");
        gradient.addColorStop(1, "#17212f");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);
        drawGrid(0.24, 32);
        break;
      case "noiseBw": {
        const rand = seededRand(0x91a5 + index * 101);
        const img = ctx.createImageData(64, 64);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.floor(rand() * 255);
          img.data[i + 0] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        const tmp = document.createElement("canvas");
        tmp.width = 64;
        tmp.height = 64;
        const tmpCtx = tmp.getContext("2d");
        tmpCtx?.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, 256, 256);
        break;
      }
      case "noiseRgb": {
        const rand = seededRand(0xc0de + index * 137);
        const img = ctx.createImageData(64, 64);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i + 0] = Math.floor(rand() * 255);
          img.data[i + 1] = Math.floor(rand() * 255);
          img.data[i + 2] = Math.floor(rand() * 255);
          img.data[i + 3] = 255;
        }
        const tmp = document.createElement("canvas");
        tmp.width = 64;
        tmp.height = 64;
        const tmpCtx = tmp.getContext("2d");
        tmpCtx?.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, 256, 256);
        break;
      }
      case "buffer":
        gradient.addColorStop(0, "#6b3e1f");
        gradient.addColorStop(1, "#2d1b11");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.font = "600 48px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("{ }", 128, 128);
        break;
      case "white":
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 256, 256);
        break;
      case "empty":
      case "none":
        ctx.fillStyle = "#101010";
        ctx.fillRect(0, 0, 256, 256);
        break;
      case "auto":
      default:
        gradient.addColorStop(0, "#303030");
        gradient.addColorStop(1, "#1b1b1b");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);
        drawGrid(0.2, 32);
        break;
    }
    const dataUrl = canvasEl.toDataURL("image/png");
    channelPreviewCache.set(key, dataUrl);
    return dataUrl;
  }
  function buildSettingsData(keys, overrides = {}) {
    return keys.map((key) => {
      const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
      const override = overrides[key] ?? {};
      const value = game.settings.get(MODULE_ID, key);
      const isBoolean = setting.type === Boolean;
      const isNumber = setting.type === Number;
      const choiceSource = override.choices ?? setting.choices;
      const choices = choiceSource
        ? Object.entries(choiceSource).map(([valueKey, label]) => ({
            value: valueKey,
            label,
            selected: String(valueKey) === String(value),
          }))
        : null;
      return {
        key,
        name: setting.name,
        hint: setting.hint,
        value,
        isBoolean,
        isNumber,
        inputType: isNumber ? "number" : "text",
        min: setting.range?.min,
        max: setting.range?.max,
        step: setting.range?.step,
        choices,
      };
    });
  }
  async function saveSettings(keys, formData) {
    for (const key of keys) {
      const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
      let value = formData[key];
      if (setting.type === Boolean) {
        value = value === true || value === "on";
      } else if (setting.type === Number) {
        value = Number(value);
      }
      await game.settings.set(MODULE_ID, key, value);
    }
  }
  class SettingsMenuV2 extends HandlebarsV2Mixin(ApplicationV2Base) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
      super.DEFAULT_OPTIONS,
      {
        tag: "div",
        position: { width: 520 },
        window: { contentClasses: ["standard-form"] },
      },
      { inplace: false },
    );
    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/settings-menu.html` },
    };
    get settingsKeys() {
      return [];
    }
    get settingsOverrides() {
      return {};
    }
    async _prepareContext() {
      return {
        fields: buildSettingsData(this.settingsKeys, this.settingsOverrides),
      };
    }
    _onRender(context, options) {
      super._onRender?.(context, options);
      const root =
        resolveElementRoot(this.element) ??
        resolveElementRoot(context?.element) ??
        resolveElementRoot(context);
      const windowApp = root?.matches?.(".window-app, .application")
        ? root
        : (root?.closest?.(".window-app, .application") ??
          root?.querySelector?.(".window-app, .application"));
      if (windowApp instanceof HTMLElement) {
        windowApp.style.maxHeight = "85vh";
        windowApp.style.height = "auto";
      }
      const windowContent = root?.matches?.(".window-content")
        ? root
        : (root?.closest?.(".window-content") ??
          root?.querySelector?.(".window-content"));
      if (windowContent instanceof HTMLElement) {
        windowContent.style.maxHeight = "calc(85vh - 4.5rem)";
        windowContent.style.overflowY = "auto";
        windowContent.style.minHeight = "0";
      }
      const form = root?.querySelector?.("form");
      if (!(form instanceof HTMLFormElement)) return;
      form.style.maxHeight = "none";
      form.style.overflowY = "visible";
      if (form.dataset.indyFxSettingsSubmitBound === "1") return;
      form.dataset.indyFxSettingsSubmitBound = "1";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void this._onSubmitForm(form);
      });
    }
    async _onSubmitForm(form) {
      const formData = new FormDataExtended(form, {}).object;
      await saveSettings(this.settingsKeys, formData);
      this.close();
    }
  }
  class SparksSettingsMenu extends SettingsMenuV2 {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
      super.DEFAULT_OPTIONS,
      {
        id: `${MODULE_ID}-sparks-settings`,
        window: { title: "Sparks Settings" },
      },
      { inplace: false },
    );
    get settingsKeys() {
      return SPARK_SETTINGS_KEYS;
    }
  }
  class ShaderSettingsMenu extends SettingsMenuV2 {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
      super.DEFAULT_OPTIONS,
      {
        id: `${MODULE_ID}-shader-settings`,
        window: { title: "Shader Settings" },
      },
      { inplace: false },
    );
    get settingsKeys() {
      return SHADER_SETTINGS_KEYS;
    }
    get settingsOverrides() {
      return { shaderPreset: { choices: shaderManager.getShaderChoices() } };
    }
  }
  class DebugSettingsMenu extends SettingsMenuV2 {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
      super.DEFAULT_OPTIONS,
      {
        id: `${MODULE_ID}-debug-settings`,
        window: { title: "Debug Settings" },
      },
      { inplace: false },
    );
    get settingsKeys() {
      return DEBUG_SETTINGS_KEYS;
    }
  }
  let _sharedEditorPreviewRenderer = null;
  let _sharedEditorPreviewCanvas = null;
  let _sharedEditorPreviewSize = 0;
  let _activeShaderEditorDialog = null;

  function _ensureSharedEditorPreviewRenderer(size = 320) {
    const nextSize = Math.max(64, Math.round(Number(size) || 320));
    const needsCreate =
      !_sharedEditorPreviewRenderer ||
      _sharedEditorPreviewRenderer.destroyed === true ||
      !(_sharedEditorPreviewCanvas instanceof HTMLCanvasElement);

    if (needsCreate) {
      try {
        _sharedEditorPreviewRenderer?.destroy?.(false);
      } catch (_err) {
        /* ignore */
      }
      _sharedEditorPreviewCanvas = document.createElement("canvas");
      _sharedEditorPreviewCanvas.width = nextSize;
      _sharedEditorPreviewCanvas.height = nextSize;
      _sharedEditorPreviewCanvas.style.position = "absolute";
      _sharedEditorPreviewCanvas.style.inset = "0";
      _sharedEditorPreviewCanvas.style.width = "100%";
      _sharedEditorPreviewCanvas.style.height = "100%";
      _sharedEditorPreviewCanvas.dataset.editorPreviewCanvas = "";

      let renderer = null;
      try {
        renderer = new PIXI.Renderer({
          canvas: _sharedEditorPreviewCanvas,
          width: nextSize,
          height: nextSize,
          antialias: true,
          autoDensity: false,
          backgroundAlpha: 0,
          clearBeforeRender: true,
          powerPreference: "high-performance",
        });
      } catch (_errCanvas) {
        renderer = new PIXI.Renderer({
          view: _sharedEditorPreviewCanvas,
          width: nextSize,
          height: nextSize,
          antialias: true,
          autoDensity: false,
          backgroundAlpha: 0,
          clearBeforeRender: true,
          powerPreference: "high-performance",
        });
      }
      _sharedEditorPreviewRenderer = renderer;
      const rendererCanvas = renderer?.view ?? renderer?.canvas ?? null;
      if (rendererCanvas instanceof HTMLCanvasElement) {
        _sharedEditorPreviewCanvas = rendererCanvas;
        _sharedEditorPreviewCanvas.dataset.editorPreviewCanvas = "";
        _sharedEditorPreviewCanvas.style.position = "absolute";
        _sharedEditorPreviewCanvas.style.inset = "0";
        _sharedEditorPreviewCanvas.style.width = "100%";
        _sharedEditorPreviewCanvas.style.height = "100%";
      }
      _sharedEditorPreviewSize = nextSize;
      debugLog("editor preview shared renderer created", {
        size: nextSize,
        viewMatchesShared: rendererCanvas === _sharedEditorPreviewCanvas,
      });
      return {
        renderer: _sharedEditorPreviewRenderer,
        canvas: _sharedEditorPreviewCanvas,
        size: _sharedEditorPreviewSize,
      };
    }

    if (_sharedEditorPreviewSize !== nextSize) {
      try {
        _sharedEditorPreviewRenderer.resize(nextSize, nextSize);
      } catch (_err) {
        /* ignore */
      }
      const rendererCanvas =
        _sharedEditorPreviewRenderer?.view ??
        _sharedEditorPreviewRenderer?.canvas ??
        _sharedEditorPreviewCanvas;
      if (rendererCanvas instanceof HTMLCanvasElement) {
        _sharedEditorPreviewCanvas = rendererCanvas;
      }
      _sharedEditorPreviewCanvas.width = nextSize;
      _sharedEditorPreviewCanvas.height = nextSize;
      _sharedEditorPreviewSize = nextSize;
      debugLog("editor preview shared renderer resized", {
        size: nextSize,
      });
    }

    return {
      renderer: _sharedEditorPreviewRenderer,
      canvas: _sharedEditorPreviewCanvas,
      size: _sharedEditorPreviewSize,
    };
  }
  class ShaderLibraryMenu extends HandlebarsV2Mixin(ApplicationV2Base) {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
      super.DEFAULT_OPTIONS,
      {
        id: `${MODULE_ID}-shader-library`,
        tag: "div",
        position: { width: 888, height: "auto" },
        window: { title: "Shader Library", contentClasses: ["standard-form"] },
      },
      { inplace: false },
    );
    static PARTS = {
      main: {
        template: `modules/${MODULE_ID}/templates/shader-library-menu.html`,
      },
    };
    async close(options) {
      this._stopHoverPreview({ destroy: true });
      this._destroyHoverPreviewCache();
      this._hideShaderContextMenu();
      return super.close(options);
    }
    async _prepareContext() {
      const modeChoices = shaderManager.getChannelModeChoices();
      const modeOptions = Object.entries(modeChoices).map(([value, label]) => ({
        value,
        label,
      }));
      const selectedShaderId = game.settings.get(MODULE_ID, "shaderPreset");
      const importedEntries = shaderManager.getImportedEntries().slice().sort((a, b) => {
        const aName = String(a?.label ?? a?.name ?? "").trim().toLocaleLowerCase();
        const bName = String(b?.label ?? b?.name ?? "").trim().toLocaleLowerCase();
        const byName = aName.localeCompare(bName);
        if (byName !== 0) return byName;
        return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
      });
      return {
        searchTerm: String(this._shaderLibrarySearchTerm ?? ""),
        imported: importedEntries.map((entry) => ({
          ...entry,
          selected: entry.id === selectedShaderId,
          thumbnail: typeof entry.thumbnail === "string" ? entry.thumbnail : "",
        })),
        channelFields: [0, 1, 2, 3].map((index) => ({
          index,
          modeName: `channel${index}Mode`,
          pathName: `channel${index}Path`,
          sourceName: `channel${index}Source`,
          modeOptions: modeOptions.map((option) => ({
            value: option.value,
            label: option.label,
            selected: option.value === "auto",
          })),
        })),
      };
    }
    _inferAutoAssignCapture(channelConfig) {
      if (!channelConfig || typeof channelConfig !== "object") return true;
      const rows = Object.values(channelConfig);
      if (!rows.length) return true;
      return rows.some(
        (channel) => String(channel?.mode ?? "") === "sceneCapture",
      );
    }
    _collectChannelsFromElement(element) {
      const root =
        element instanceof HTMLElement
          ? element
          : document.createElement("div");
      const channels = {};
      for (const index of [0, 1, 2, 3]) {
        channels[`iChannel${index}`] = {
          mode: String(
            root.querySelector(`[name="channel${index}Mode"]`)?.value ?? "auto",
          ),
          path: String(
            root.querySelector(`[name="channel${index}Path"]`)?.value ?? "",
          ).trim(),
          source: String(
            root.querySelector(`[name="channel${index}Source"]`)?.value ?? "",
          ).trim(),
        };
      }
      const autoAssignCapture =
        root.querySelector(`[name="autoAssignCapture"]`)?.checked === true;
      return { channels, autoAssignCapture };
    }
    _collectDefaultsFromElement(root) {
      const defaults = {};
      const booleanKeys = new Set([
        "useGradientMask",
        "bloom",
        "flipHorizontal",
        "flipVertical",
        "scaleToToken",
        "scaleWithTokenTexture",
        "rotateWithToken",
        "captureFlipHorizontal",
        "captureFlipVertical",
        "preloadShader",
      ]);
      for (const key of shaderManager.getImportedShaderDefaultKeys()) {
        const input = root.querySelector(`[name="default_${key}"]`);
        if (!input) continue;
        if (key === "layer") defaults[key] = String(input.value ?? "inherit");
        else if (booleanKeys.has(key)) defaults[key] = input.checked === true;
        else defaults[key] = String(input.value ?? "").trim();
      }
      return defaults;
    }
    _updateChannelUi(root) {
      for (const row of root.querySelectorAll("[data-channel-row]")) {
        const mode = String(
          row.querySelector("[data-channel-mode]")?.value ?? "auto",
        );
        const isImage = mode === "image";
        const isBuffer = mode === "buffer";
        const pathInput = row.querySelector("[data-channel-path]");
        const sourceInput = row.querySelector("[data-channel-source]");
        if (pathInput) pathInput.disabled = !isImage;
        if (sourceInput) sourceInput.disabled = !isBuffer;
      }
    }
    _bindPickImageButtons(root, updateUi = null) {
      for (const browseBtn of root.querySelectorAll(
        "[data-action='pick-image']",
      )) {
        if (browseBtn.dataset.indyFxBrowseBound === "1") continue;
        browseBtn.dataset.indyFxBrowseBound = "1";
        browseBtn.addEventListener("click", (event) => {
          event.preventDefault();
          const targetName = String(event.currentTarget?.dataset?.target ?? "");
          if (!targetName) return;
          const row = event.currentTarget.closest("[data-channel-row]");
          const modeSelect = row?.querySelector("[data-channel-mode]");
          if (modeSelect && modeSelect.value !== "image") {
            modeSelect.value = "image";
            if (typeof updateUi === "function") updateUi();
            else this._updateChannelUi(root);
          }
          const targetInput = root.querySelector(`[name="${targetName}"]`);
          const current = String(targetInput?.value ?? "");
          openImagePicker({
            current,
            callback: (path) => {
              if (targetInput) targetInput.value = path;
            },
          });
        });
      }
    }
    async _openBuiltinDefaultsDialog(root) {
      const fields = [
        {
          key: "falloffPower",
          label: "Shader radial falloff",
          type: "number",
          min: 0.2,
          max: 6.0,
          step: 0.1,
        },
        {
          key: "density",
          label: "Shader density",
          type: "number",
          min: 0.2,
          max: 4.0,
          step: 0.1,
        },
        { key: "flowMode", label: "Shader outward flow", type: "boolean" },
        {
          key: "flowSpeed",
          label: "Outward flow speed",
          type: "number",
          min: 0.0,
          max: 5.0,
          step: 0.1,
        },
        {
          key: "flowTurbulence",
          label: "Flow turbulence",
          type: "number",
          min: 0.0,
          max: 2.0,
          step: 0.05,
        },
        { key: "colorA", label: "Color A (hex)", type: "text" },
        { key: "colorB", label: "Color B (hex)", type: "text" },
      ];
      const rowsHtml = fields
        .map((field) => {
          const source = root.querySelector(`[name="default_${field.key}"]`);
          if (field.type === "boolean") {
            const checked =
              source?.value === "1" ||
              source?.value === "true" ||
              source?.checked === true;
            return `<div class="form-group"><label>${field.label}</label><div class="form-fields"><input type="checkbox" name="builtin_${field.key}" ${checked ? "checked" : ""}></div></div>`;
          }
          const attrs = [
            `name="builtin_${field.key}"`,
            `type="${field.type === "number" ? "number" : "text"}"`,
            `value="${String(source?.value ?? "").replace(/"/g, "&quot;")}"`,
          ];
          if (field.min !== undefined) attrs.push(`min="${field.min}"`);
          if (field.max !== undefined) attrs.push(`max="${field.max}"`);
          if (field.step !== undefined) attrs.push(`step="${field.step}"`);
          return `<div class="form-group"><label>${field.label}</label><div class="form-fields"><input ${attrs.join(" ")}></div></div>`;
        })
        .join("");
      const dlg = new foundry.applications.api.DialogV2({
        window: { title: "Built-in Shader Options" },
        content: `<form class="indy-fx-builtin-defaults">${rowsHtml}</form>`,
        buttons: [
          {
            action: "save",
            label: "Save",
            icon: "fas fa-save",
            default: true,
            callback: (_event, _button, dialog) => {
              const dialogRoot =
                resolveElementRoot(dialog?.element) ??
                resolveElementRoot(dialog);
              if (!(dialogRoot instanceof Element)) return;
              for (const field of fields) {
                const target = root.querySelector(
                  `[name="default_${field.key}"]`,
                );
                const input = dialogRoot.querySelector(
                  `[name="builtin_${field.key}"]`,
                );
                if (!target || !input) continue;
                if (field.type === "boolean") {
                  target.value = input.checked ? "1" : "0";
                } else {
                  target.value = String(input.value ?? "");
                }
                target.dispatchEvent(new Event("change", { bubbles: true }));
              }
            },
          },
          { action: "cancel", label: "Cancel", icon: "fas fa-times" },
        ],
      });
      await dlg.render(true);
    }
    async _renderShaderEditorContent(shader) {
      const channelConfig = shaderManager.getRecordChannelConfig(shader);
      const defaults = shaderManager.getRecordShaderDefaults(shader, {
        runtime: false,
      });
      const layerChoices = {
        inherit: "inherit from FX layer",
        token: "token (attached to token)",
        interfacePrimary: "interfacePrimary",
        interface: "interface",
        effects: "effects",
      };
      return renderTemplate(
        `modules/${MODULE_ID}/templates/shader-edit-full.html`,
        {
          shader: {
            id: shader?.id ?? "",
            name: String(shader?.name ?? ""),
            label: String(shader?.label ?? shader?.name ?? ""),
            source: String(shader?.source ?? ""),
            thumbnail: String(shader?.thumbnail ?? ""),
            defaults,
            autoAssignCapture: this._inferAutoAssignCapture(channelConfig),
          },
          layerOptions: Object.entries(layerChoices).map(([value, label]) => ({
            value,
            label,
            selected: String(defaults.layer ?? "inherit") === value,
          })),
          channelRows: [0, 1, 2, 3].map((index) => {
            const key = `iChannel${index}`;
            const channel = channelConfig[key] ?? {
              mode: "auto",
              path: "",
              source: "",
            };
            return {
              index,
              key,
              mode: String(channel.mode ?? "auto"),
              modeName: `channel${index}Mode`,
              pathName: `channel${index}Path`,
              sourceName: `channel${index}Source`,
              path: String(channel.path ?? ""),
              source: String(channel.source ?? ""),
            };
          }),
        },
      );
    }
    _getChannelModeLabel(modeChoices, mode) {
      const choices = modeChoices ?? shaderManager.getChannelModeChoices();
      return choices?.[mode] ?? String(mode ?? "auto");
    }
    _refreshEditorChannelCards(root, modeChoices = null) {
      const choices = modeChoices ?? shaderManager.getChannelModeChoices();
      for (const card of root.querySelectorAll(
        "[data-channel-card][data-channel-index]",
      )) {
        const index = Number(card.dataset.channelIndex ?? -1);
        if (!Number.isInteger(index) || index < 0 || index > 3) continue;
        const mode = String(
          root.querySelector(`[name="channel${index}Mode"]`)?.value ?? "auto",
        );
        const path = String(
          root.querySelector(`[name="channel${index}Path"]`)?.value ?? "",
        ).trim();
        const source = String(
          root.querySelector(`[name="channel${index}Source"]`)?.value ?? "",
        ).trim();
        const modeLabel = this._getChannelModeLabel(choices, mode);
        const modeLabelEl = card.querySelector("[data-channel-mode-label]");
        const pathLabelEl = card.querySelector("[data-channel-path-label]");
        const thumbEl = card.querySelector("[data-channel-thumb]");
        const videoEl = card.querySelector("[data-channel-thumb-video]");
        const fallbackEl = card.querySelector("[data-channel-fallback]");

        if (modeLabelEl instanceof HTMLElement) {
          modeLabelEl.textContent = modeLabel;
        }

        let detail = "";
        if (mode === "image") detail = path || "No image/video selected";
        else if (mode === "buffer") {
          detail = source ? `${source.length} chars` : "No buffer code";
        } else if (mode === "sceneCapture") detail = "Scene clipped capture";
        else if (mode === "auto") detail = "Auto assignment";

        if (pathLabelEl instanceof HTMLElement) {
          pathLabelEl.textContent = detail;
        }

        const isVideoPath =
          mode === "image" &&
          !!path &&
          /\.(webm|mp4|m4v|mov|ogv|ogg)(\?.*)?$/i.test(path);

        if (videoEl instanceof HTMLVideoElement) {
          if (isVideoPath) {
            videoEl.src = path;
            videoEl.style.display = "";
            videoEl.muted = true;
            videoEl.loop = true;
            videoEl.playsInline = true;
            void videoEl.play?.().catch(() => {});
          } else {
            try {
              videoEl.pause?.();
              videoEl.removeAttribute("src");
              videoEl.load?.();
            } catch (_err) {
              // Ignore media reset errors.
            }
            videoEl.style.display = "none";
          }
        }

        if (!(thumbEl instanceof HTMLImageElement)) continue;
        const previewSrc =
          mode === "image" && path && !isVideoPath
            ? path
            : makeChannelPreviewDataUrl(mode, index);

        if (previewSrc) {
          thumbEl.src = previewSrc;
          thumbEl.style.display = isVideoPath ? "none" : "";
          if (fallbackEl instanceof HTMLElement) {
            fallbackEl.style.display = "none";
          }
        } else {
          thumbEl.removeAttribute("src");
          thumbEl.style.display = "none";
          if (fallbackEl instanceof HTMLElement) {
            fallbackEl.textContent = modeLabel;
            fallbackEl.style.display = "";
          }
        }
      }
    }    async _openEditorChannelDialog(
      root,
      channelIndex,
      modeChoices = null,
      onChanged = null,
    ) {
      const choices = modeChoices ?? shaderManager.getChannelModeChoices();
      const modeName = `channel${channelIndex}Mode`;
      const pathName = `channel${channelIndex}Path`;
      const sourceName = `channel${channelIndex}Source`;
      const currentMode = String(
        root.querySelector(`[name="${modeName}"]`)?.value ?? "auto",
      );
      const currentPath = String(
        root.querySelector(`[name="${pathName}"]`)?.value ?? "",
      );
      const currentSource = String(
        root.querySelector(`[name="${sourceName}"]`)?.value ?? "",
      );
      const optionsHtml = Object.entries(choices)
        .map(
          ([value, label]) =>
            `<option value="${value}" ${value === currentMode ? "selected" : ""}>${label}</option>`,
        )
        .join("");
      const content = `      <form class="indy-fx-channel-edit">        <div class="form-group">          <label>Type</label>          <div class="form-fields">            <select name="editChannelMode">${optionsHtml}</select>          </div>        </div>        <div class="form-group" data-channel-path-row>          <label>Image/Video Path</label>          <div class="form-fields">            <input type="text" name="editChannelPath" value="${String(currentPath).replace(/"/g, "&quot;")}" />            <button type="button" data-action="edit-channel-pick-image"><i class="fas fa-file-import"></i> Browse</button>          </div>        </div>        <div class="form-group" data-channel-source-row>          <label>Buffer Source</label>          <div class="form-fields">            <textarea name="editChannelSource" rows="10">${String(currentSource).replace(/</g, "&lt;")}</textarea>          </div>        </div>      </form>    `;
      const bindUi = (candidate) => {
        const dialogRoot =
          resolveElementRoot(candidate?.element) ??
          resolveElementRoot(candidate);
        if (!(dialogRoot instanceof Element)) return;
        if (dialogRoot.dataset.indyFxChannelEditBound === "1") return;
        dialogRoot.dataset.indyFxChannelEditBound = "1";
        const modeInput = dialogRoot.querySelector('[name="editChannelMode"]');
        const pathRow = dialogRoot.querySelector("[data-channel-path-row]");
        const sourceRow = dialogRoot.querySelector("[data-channel-source-row]");
        const syncUi = () => {
          const mode = String(modeInput?.value ?? "auto");
          if (pathRow instanceof HTMLElement)
            pathRow.style.display = mode === "image" ? "" : "none";
          if (sourceRow instanceof HTMLElement)
            sourceRow.style.display = mode === "buffer" ? "" : "none";
        };
        modeInput?.addEventListener("change", syncUi);
        dialogRoot
          .querySelector("[data-action='edit-channel-pick-image']")
          ?.addEventListener("click", () => {
            const pathInput = dialogRoot.querySelector(
              '[name="editChannelPath"]',
            );
            const current = String(pathInput?.value ?? "");
            openImagePicker({
              current,
              callback: (path) => {
                if (pathInput) pathInput.value = path;
                if (modeInput && modeInput.value !== "image") {
                  modeInput.value = "image";
                  syncUi();
                }
              },
            });
          });
        syncUi();
      };
      const dlg = new foundry.applications.api.DialogV2({
        window: { title: `Edit iChannel${channelIndex}` },
        content,
        buttons: [
          {
            action: "save",
            label: "Save",
            icon: "fas fa-save",
            default: true,
            callback: (_event, _button, dialog) => {
              const dialogRoot =
                resolveElementRoot(dialog?.element) ??
                resolveElementRoot(dialog);
              if (!(dialogRoot instanceof Element)) return;
              const nextMode = String(
                dialogRoot.querySelector('[name="editChannelMode"]')?.value ??
                  "auto",
              );
              const nextPath = String(
                dialogRoot.querySelector('[name="editChannelPath"]')?.value ??
                  "",
              ).trim();
              const nextSource = String(
                dialogRoot.querySelector('[name="editChannelSource"]')?.value ??
                  "",
              ).trim();
              const modeInput = root.querySelector(`[name="${modeName}"]`);
              const pathInput = root.querySelector(`[name="${pathName}"]`);
              const sourceInput = root.querySelector(`[name="${sourceName}"]`);
              if (modeInput) modeInput.value = nextMode;
              if (pathInput) pathInput.value = nextPath;
              if (sourceInput) sourceInput.value = nextSource;
              if (typeof onChanged === "function") onChanged();
            },
          },
          { action: "cancel", label: "Cancel", icon: "fas fa-times" },
        ],
        render: (app) => bindUi(app),
      });
      await dlg.render(true);
      bindUi(dlg);
      setTimeout(() => bindUi(dlg), 0);
    }
    async _openShaderVariableEditor(root, refreshPreview) {
      const sourceInput = root?.querySelector?.('[name="editSource"]');
      if (!(sourceInput instanceof HTMLTextAreaElement)) {
        ui.notifications.warn("Shader source editor not found.");
        return;
      }

      const variables = extractEditableShaderVariables(sourceInput.value);
      if (!variables.length) {
        ui.notifications.info("No editable const/#define float/int/vec3/vec4 variables detected.");
        return;
      }

      const rows = variables
        .map((variable, index) => {
          const name = String(variable.name ?? "");
          const type = String(variable.type ?? "");
          if (variable.kind === "scalar") {
            return `
              <div class="form-group" data-var-index="${index}" data-var-kind="scalar">
                <label>${name} <small style="opacity:.8;">(${type})</small></label>
                <div class="form-fields">
                  <input type="number" name="var_${index}_value" value="${formatScalarNumber(variable.value, type)}" step="${type === "int" ? "1" : "0.001"}" />
                </div>
              </div>
            `;
          }

          const expected = type === "vec4" ? 4 : 3;
          const values = Array.isArray(variable.values) ? variable.values.slice(0, expected) : [];
          while (values.length < expected) values.push(0);
          const colorHex = vecToHex(values);
          const componentInputs = values
            .map(
              (value, componentIndex) =>
                `<input type="number" name="var_${index}_c${componentIndex}" value="${formatVectorNumber(value)}" step="0.001" />`,
            )
            .join("");

          return `
            <div class="form-group" data-var-index="${index}" data-var-kind="vector" data-var-type="${type}">
              <label>${name} <small style="opacity:.8;">(${type})</small></label>
              <div class="form-fields" style="gap:0.35rem;align-items:center;flex-wrap:wrap;">
                <input type="color" name="var_${index}_color" value="${colorHex}" />
                ${componentInputs}
              </div>
            </div>
          `;
        })
        .join("");

      const content = `<form class="indy-fx-variable-editor" style="max-height:70vh;overflow-y:auto;padding-right:.25rem;">${rows}</form>`;

      const readDialogVariables = (dialogRoot) => {
        return variables.map((variable, index) => {
          if (variable.kind === "scalar") {
            const raw = Number(dialogRoot?.querySelector?.(`[name="var_${index}_value"]`)?.value);
            return {
              ...variable,
              value: Number.isFinite(raw) ? raw : Number(variable.value ?? 0),
            };
          }

          const type = String(variable.type ?? "vec3");
          const expected = type === "vec4" ? 4 : 3;
          const values = [];
          for (let componentIndex = 0; componentIndex < expected; componentIndex += 1) {
            const raw = Number(dialogRoot?.querySelector?.(`[name="var_${index}_c${componentIndex}"]`)?.value);
            values.push(Number.isFinite(raw) ? raw : Number(variable.values?.[componentIndex] ?? 0));
          }

          return {
            ...variable,
            values,
          };
        });
      };

      const applyFromDialog = (dialogRoot) => {
        const nextVariables = readDialogVariables(dialogRoot);
        sourceInput.value = applyEditableShaderVariables(sourceInput.value, nextVariables);
        sourceInput.dispatchEvent(new Event("change", { bubbles: true }));
        if (typeof refreshPreview === "function") refreshPreview();
      };

      const bindUi = (candidate) => {
        const dialogRoot =
          resolveElementRoot(candidate?.element) ?? resolveElementRoot(candidate);
        if (!(dialogRoot instanceof Element)) return;
        if (dialogRoot.dataset.indyFxVariablesBound === "1") return;
        dialogRoot.dataset.indyFxVariablesBound = "1";

        for (const group of dialogRoot.querySelectorAll('[data-var-kind="vector"][data-var-index]')) {
          const idx = Number(group.getAttribute("data-var-index") ?? -1);
          if (!Number.isInteger(idx) || idx < 0) continue;
          const colorInput = group.querySelector(`[name="var_${idx}_color"]`);
          if (!(colorInput instanceof HTMLInputElement)) continue;
          colorInput.addEventListener("input", () => {
            const rgb = hexToVecRgb(colorInput.value);
            for (let c = 0; c < 3; c += 1) {
              const componentInput = group.querySelector(`[name="var_${idx}_c${c}"]`);
              if (componentInput instanceof HTMLInputElement) {
                componentInput.value = formatVectorNumber(rgb[c]);
              }
            }
          });
        }
      };

      const dialog = new foundry.applications.api.DialogV2({
        window: { title: "Edit Shader Variables", resizable: true },
        content,
        buttons: [
          {
            action: "apply",
            label: "Apply",
            icon: "fas fa-play",
            close: false,
            callback: (_event, _button, app) => {
              const dialogRoot =
                resolveElementRoot(app?.element) ?? resolveElementRoot(app);
              if (!(dialogRoot instanceof Element)) return false;
              applyFromDialog(dialogRoot);
              return false;
            },
          },
          {
            action: "save",
            label: "Save",
            icon: "fas fa-save",
            default: true,
            callback: (_event, _button, app) => {
              const dialogRoot =
                resolveElementRoot(app?.element) ?? resolveElementRoot(app);
              if (!(dialogRoot instanceof Element)) return;
              applyFromDialog(dialogRoot);
            },
          },
          { action: "cancel", label: "Cancel", icon: "fas fa-times" },
        ],
        render: (app) => bindUi(app),
      });
      await dialog.render(true);
      bindUi(dialog);
    }

    async _exportShaderLibraryToFile() {
      try {
        const payload = shaderManager.exportImportedShadersPayload();
        const text = JSON.stringify(payload, null, 2);
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const date = new Date();
        const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
        a.href = url;
        a.download = `indyfx-shaders-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        console.error(`${MODULE_ID} | Shader library export failed`, err);
        ui.notifications.error(err?.message ?? "Shader library export failed.");
      }
    }

    async _importShaderLibraryFromFile(file) {
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(String(text ?? "{}"));
        const result = await shaderManager.importImportedShadersPayload(payload, {
          replace: false,
        });
        await shaderManager.enforceValidSelection();
        ui.notifications.info(`Imported ${result.importedCount} shader(s).`);
        this.render();
      } catch (err) {
        console.error(`${MODULE_ID} | Shader library import failed`, err);
        ui.notifications.error(err?.message ?? "Shader library import failed.");
      }
    }    _startEditorShaderPreview(root, shaderId) {
      const previewImage = root.querySelector("[data-editor-preview-image]");
      const previewEmpty = root.querySelector("[data-editor-preview-empty]");
      const previewStage = root.querySelector("[data-editor-preview-stage]");
      if (!(previewStage instanceof HTMLElement)) {
        return { refresh: () => {}, destroy: () => {}, capture: () => "" };
      }

      const stageCanvas = root.querySelector("[data-editor-preview-canvas]");
      const size = Math.max(
        64,
        Math.round(
          Number(stageCanvas?.getAttribute?.("width")) ||
            Number(stageCanvas?.width) ||
            320,
        ),
      );

      let shared = null;
      try {
        shared = _ensureSharedEditorPreviewRenderer(size);
      } catch (err) {
        console.warn(`${MODULE_ID} | editor preview renderer init failed`, {
          shaderId,
          message: String(err?.message ?? err),
        });
        if (previewEmpty instanceof HTMLElement) previewEmpty.style.display = "";
        return { refresh: () => {}, destroy: () => {}, capture: () => "" };
      }

      const { renderer, canvas } = shared;
      debugLog("editor preview using shared canvas", {
        shaderId,
        canvasConnected: canvas instanceof HTMLCanvasElement ? canvas.isConnected === true : false,
        canvasTag: canvas?.tagName ?? null,
      });
      canvas.width = size;
      canvas.height = size;
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.dataset.editorPreviewCanvas = "";

      const existingCanvas = previewStage.querySelector("[data-editor-preview-canvas]");
      if (existingCanvas !== canvas) {
        try {
          if (existingCanvas && existingCanvas.parentElement === previewStage) {
            previewStage.replaceChild(canvas, existingCanvas);
          } else {
            previewStage.appendChild(canvas);
          }
        } catch (_err) {
          previewStage.appendChild(canvas);
        }
      }

      let preview = null;
      let raf = 0;
      let refreshTimer = 0;
      let lastMs = performance.now();
      let destroyed = false;

      const destroyPreview = () => {
        preview?.destroy?.();
        preview = null;
        if (previewImage instanceof HTMLElement) {
          previewImage.style.opacity = "1";
          previewImage.style.display = "";
        }
      };

      const buildPreview = () => {
        destroyPreview();
        if (previewEmpty instanceof HTMLElement) previewEmpty.style.display = "none";
        const defaults = this._collectDefaultsFromElement(root);
        preview = shaderManager.createImportedShaderPreview(shaderId, {
          size,
          defaults,
          reason: "editor-preview"
        });
        if (!preview) {
          if (previewEmpty instanceof HTMLElement) previewEmpty.style.display = "";
          return;
        }
        if (previewImage instanceof HTMLElement) {
          previewImage.style.opacity = "0";
          previewImage.style.display = "none";
        }
        lastMs = performance.now();
      };

      const tick = () => {
        if (destroyed) return;
        const nowMs = performance.now();
        const dt = Math.min(0.1, Math.max(0, (nowMs - lastMs) / 1000));
        lastMs = nowMs;
        if (preview && renderer) {
          try {
            preview.step(dt);
            preview.render(renderer);
          } catch (err) {
            console.error(`${MODULE_ID} | editor preview tick failed`, {
              shaderId,
              message: String(err?.message ?? err),
            });
          }
        }
        raf = requestAnimationFrame(tick);
      };

      const refresh = () => {
        if (destroyed) return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          if (!destroyed) buildPreview();
        }, 120);
      };

      const capture = () => {
        try {
          if (preview && renderer?.extract?.canvas) {
            const rt = PIXI.RenderTexture.create({ width: size, height: size });
            try {
              preview.render(renderer, rt);
              const extracted = renderer.extract.canvas(rt);
              const data = extracted?.toDataURL?.("image/png");
              if (typeof data === "string" && data.trim()) return data.trim();
            } finally {
              rt.destroy(true);
            }
          }
          return String(canvas.toDataURL("image/png") ?? "").trim();
        } catch (_err) {
          return "";
        }
      };

      const destroy = () => {
        destroyed = true;
        clearTimeout(refreshTimer);
        if (raf) cancelAnimationFrame(raf);
        destroyPreview();
      };

      buildPreview();
      raf = requestAnimationFrame(tick);
      return { refresh, destroy, capture };
    }
    async _openShaderEditor(shaderId) {
      if (_activeShaderEditorDialog) {
        try {
          await _activeShaderEditorDialog.close();
        } catch (_err) {
          /* ignore */
        }
        _activeShaderEditorDialog = null;
      }
      const shader = shaderManager.getImportedRecord(shaderId);
      if (!shader) return ui.notifications.warn("Imported shader not found.");
      const content = await this._renderShaderEditorContent(shader);
      const modeChoices = shaderManager.getChannelModeChoices();
      const cleanupDialog = (dialogOrRoot) => {
        const root =
          resolveElementRoot(dialogOrRoot?.element) ??
          resolveElementRoot(dialogOrRoot);
        root?._indyFxPreviewCtl?.destroy?.();
        if (root?._indyFxPreviewCtl) delete root._indyFxPreviewCtl;
      };
      const bindDialogUi = (candidate) => {
        const hostRoot =
          resolveElementRoot(candidate?.element) ??
          resolveElementRoot(candidate);
        if (!(hostRoot instanceof Element)) {
          debugLog("editor bind skipped: hostRoot missing element", { shaderId: shader.id });
          return;
        }
        debugLog("editor bind host", { shaderId: shader.id, tagName: hostRoot.tagName });

        const formEl =
          hostRoot instanceof HTMLFormElement
            ? hostRoot
            : (findFirstInRoots(hostRoot, "form.indy-fx-shader-edit-full") ??
              findFirstInRoots(hostRoot, "form"));
        if (!(formEl instanceof HTMLElement)) {
          debugLog("editor bind skipped: form not found", { shaderId: shader.id });
          return;
        }
        if (formEl.dataset.indyFxShaderEditorBound === "1") {
          debugLog("editor bind skipped: already bound", { shaderId: shader.id });
          return;
        }
        formEl.dataset.indyFxShaderEditorBound = "1";

        const root = formEl;

        for (const ff of root.querySelectorAll(".form-fields")) {
          if (ff instanceof HTMLElement) ff.style.marginTop = "2px";
        }
        for (const detailsEl of root.querySelectorAll("details[data-parent-toggle]")) {
          if (!(detailsEl instanceof HTMLDetailsElement)) continue;
          const parentName = String(
            detailsEl.getAttribute("data-parent-toggle") ?? "",
          ).trim();
          if (!parentName) continue;
          const parentInput = root.querySelector(`[name="${parentName}"]`);
          if (!(parentInput instanceof HTMLInputElement)) continue;
          const syncOpen = () => {
            if (parentInput.type === "checkbox") {
              detailsEl.open = parentInput.checked === true;
            }
          };
          syncOpen();
          if (parentInput.dataset.indyFxDependentDetailsBound !== "1") {
            parentInput.dataset.indyFxDependentDetailsBound = "1";
            parentInput.addEventListener("change", syncOpen);
            parentInput.addEventListener("input", syncOpen);
          }
        }
        const windowApp = root?.matches?.(".window-app, .application")
          ? root
          : (root.closest?.(".window-app, .application") ??
            root.querySelector?.(".window-app, .application"));
        if (windowApp instanceof HTMLElement) {
          windowApp.style.maxHeight = "85vh";
          windowApp.style.height = "auto";
        }
        const windowContent = root?.matches?.(".window-content")
          ? root
          : (root.closest?.(".window-content") ??
            root.querySelector?.(".window-content"));
        if (windowContent instanceof HTMLElement) {
          windowContent.style.maxHeight = "calc(85vh - 4.5rem)";
          windowContent.style.overflowY = "auto";
          windowContent.style.minHeight = "0";
        }
        if (formEl instanceof HTMLElement) {
          formEl.style.maxHeight = "none";
          formEl.style.overflowY = "visible";
        }
        const previewCtl = this._startEditorShaderPreview(root, shader.id);
        debugLog("editor preview controller created", {
          shaderId: shader.id,
          hasRefresh: typeof previewCtl?.refresh === "function",
          hasDestroy: typeof previewCtl?.destroy === "function",
          hasCapture: typeof previewCtl?.capture === "function",
        });
        root._indyFxPreviewCtl = previewCtl;
        hostRoot._indyFxPreviewCtl = previewCtl;
        const refreshPreview = () => previewCtl.refresh?.();
        const refreshCards = () =>
          this._refreshEditorChannelCards(root, modeChoices);
        const onChannelChanged = () => {
          refreshCards();
          refreshPreview();
        };
        root
          .querySelector("[data-action='open-builtin-defaults']")
          ?.addEventListener("click", async () => {
            await this._openBuiltinDefaultsDialog(root);
            refreshPreview();
          });
        const updatePreviewBtn = root.querySelector(
          "[data-action='update-editor-preview']",
        );
        if (updatePreviewBtn instanceof HTMLElement) {
          if (updatePreviewBtn.dataset.indyFxUpdatePreviewBound !== "1") {
            updatePreviewBtn.dataset.indyFxUpdatePreviewBound = "1";
            updatePreviewBtn.addEventListener("click", () => refreshPreview());
          }
        }

        const editVariablesBtn = root.querySelector(
          "[data-action='edit-shader-variables']",
        );
        if (editVariablesBtn instanceof HTMLElement) {
          if (editVariablesBtn.dataset.indyFxEditVarsBound !== "1") {
            editVariablesBtn.dataset.indyFxEditVarsBound = "1";
            editVariablesBtn.addEventListener("click", () => {
              void this._openShaderVariableEditor(root, refreshPreview);
            });
          }
        }

        const captureThumbnailBtn = root.querySelector(
          "[data-action='capture-editor-thumbnail']",
        );
        if (captureThumbnailBtn instanceof HTMLElement) {
          if (captureThumbnailBtn.dataset.indyFxCaptureThumbBound !== "1") {
            captureThumbnailBtn.dataset.indyFxCaptureThumbBound = "1";
            captureThumbnailBtn.addEventListener("click", async () => {
              try {
                const thumbnail = String(
                  (await Promise.resolve(previewCtl.capture?.())) ?? "",
                ).trim();
                if (!thumbnail) {
                  ui.notifications.warn("Unable to capture shader thumbnail.");
                  return;
                }
                const updated = await shaderManager.setImportedShaderThumbnail(
                  shader.id,
                  thumbnail,
                );
                if (!updated) {
                  ui.notifications.warn("Unable to save shader thumbnail.");
                  return;
                }

                const savedThumbnail = String(updated?.thumbnail ?? thumbnail).trim();
                if (savedThumbnail) {
                  const editorThumb = root.querySelector("[data-editor-preview-image]");
                  if (editorThumb instanceof HTMLImageElement) {
                    editorThumb.src = savedThumbnail;
                  }
                  this._applyGeneratedThumbnail(shader.id, savedThumbnail);
                  this.render();
                }

                this._thumbnailGenerationFailed?.delete?.(shader.id);
                ui.notifications.info("Shader thumbnail captured.");
              } catch (err) {
                console.error(`${MODULE_ID} | Failed to capture editor thumbnail`, err);
                ui.notifications.error(err?.message ?? "Failed to capture thumbnail.");
              }
            });
          }
        }

        for (const input of root.querySelectorAll('[name^="default_"]')) {
          if (!(input instanceof HTMLElement)) continue;
          if (input.dataset.indyFxPreviewInputBound === "1") continue;
          input.dataset.indyFxPreviewInputBound = "1";
          input.addEventListener("change", refreshPreview);
          input.addEventListener("input", refreshPreview);
        }
        for (const editBtn of root.querySelectorAll(
          "[data-action='edit-channel'][data-channel-index]",
        )) {
          if (editBtn.dataset.indyFxChannelEditBound === "1") continue;
          editBtn.dataset.indyFxChannelEditBound = "1";
          editBtn.addEventListener("click", () => {
            const index = Number(editBtn.dataset.channelIndex ?? -1);
            if (!Number.isInteger(index) || index < 0 || index > 3) return;
            void this._openEditorChannelDialog(
              root,
              index,
              modeChoices,
              onChannelChanged,
            );
          });
        }
        refreshCards();
      };
      const dlg = new foundry.applications.api.DialogV2({
        window: {
          title: `Edit Shader: ${shader.label ?? shader.name}`,
          resizable: true,
        },
        position: {
          width: 1180,
          height: Math.floor(window.innerHeight * 0.85),
        },
        content,
        buttons: [
          {
            action: "save",
            label: "Save",
            icon: "fas fa-save",
            default: true,
            callback: async (_event, _button, dialog) => {
              try {
                const root =
                  resolveElementRoot(dialog?.element) ??
                  resolveElementRoot(dialog);
                const nextName = String(
                  root?.querySelector('[name="editName"]')?.value ?? "",
                ).trim();
                const nextLabel = String(
                  root?.querySelector('[name="editLabel"]')?.value ?? "",
                ).trim();
                const nextSource = String(
                  root?.querySelector('[name="editSource"]')?.value ?? "",
                ).trim();
                if (!nextName || !nextSource)
                  return ui.notifications.warn(
                    "Enter both shader name and source.",
                  );
                const { channels, autoAssignCapture } =
                  this._collectChannelsFromElement(root);
                const defaults = this._collectDefaultsFromElement(root);
                await shaderManager.updateImportedShader(shader.id, {
                  name: nextName,
                  label: nextLabel || null,
                  source: nextSource,
                  channels,
                  defaults,
                  autoAssignCapture,
                });
                cleanupDialog(dialog);
                ui.notifications.info(
                  `Updated shader: ${nextLabel || nextName}`,
                );
                this.render();
              } catch (err) {
                console.error(
                  `${MODULE_ID} | Update imported shader failed`,
                  err,
                );
                ui.notifications.error(
                  err?.message ?? "Failed to update imported shader.",
                );
              }
            },
          },
          {
            action: "cancel",
            label: "Cancel",
            icon: "fas fa-times",
            callback: (_event, _button, dialog) => cleanupDialog(dialog),
          },
        ],
        render: (app) => bindDialogUi(app),
      });
      _activeShaderEditorDialog = dlg;
      const originalClose = dlg.close.bind(dlg);
      dlg.close = async (...args) => {
        cleanupDialog(dlg);
        if (_activeShaderEditorDialog === dlg) {
          _activeShaderEditorDialog = null;
        }
        return originalClose(...args);
      };
      await dlg.render(true);
      bindDialogUi(dlg);
      setTimeout(() => bindDialogUi(dlg), 0);
    }
    _ensureHoverPreviewCache() {
      if (!(this._hoverPreviewCache instanceof Map)) this._hoverPreviewCache = new Map();
      return this._hoverPreviewCache;
    }

    _destroyHoverPreviewEntry(shaderId, entry = null) {
      const cache = this._ensureHoverPreviewCache();
      const id = String(shaderId ?? "");
      const resolved = entry ?? cache.get(id);
      if (!resolved) return;
      try {
        resolved.preview?.destroy?.();
      } catch (_err) {
        // no-op
      }
      try {
        resolved.renderTexture?.destroy?.(true);
      } catch (_err) {
        // no-op
      }
      cache.delete(id);
    }

    _trimHoverPreviewCache(maxEntries = 8) {
      const cache = this._ensureHoverPreviewCache();
      if (cache.size <= maxEntries) return;
      const entries = Array.from(cache.entries()).sort(
        (a, b) => Number(a?.[1]?.lastUsed ?? 0) - Number(b?.[1]?.lastUsed ?? 0),
      );
      const toRemove = Math.max(0, entries.length - maxEntries);
      for (let i = 0; i < toRemove; i += 1) {
        this._destroyHoverPreviewEntry(entries[i][0], entries[i][1]);
      }
    }

    _destroyHoverPreviewCache() {
      const cache = this._ensureHoverPreviewCache();
      for (const [shaderId, entry] of Array.from(cache.entries())) {
        this._destroyHoverPreviewEntry(shaderId, entry);
      }
    }

    _stopHoverPreview({ destroy = false } = {}) {
      const active = this._hoverPreview;
      if (!active) return;
      if (active.raf) cancelAnimationFrame(active.raf);
      if (active.thumbImage && active.thumbImage.getAttribute("src")) {
        active.thumbImage.style.opacity = "1";
      }
      if (destroy || !active.shaderId) {
        active.preview?.destroy?.();
        active.renderTexture?.destroy?.(true);
      } else {
        const cache = this._ensureHoverPreviewCache();
        cache.set(String(active.shaderId), {
          preview: active.preview,
          renderTexture: active.renderTexture,
          lastUsed: Date.now(),
        });
        this._trimHoverPreviewCache(8);
      }
      this._hoverPreview = null;
    }
    _startHoverPreview(shaderId, card) {
      this._stopHoverPreview();
      const renderer = canvas?.app?.renderer;
      if (!renderer || typeof renderer?.extract?.canvas !== "function") return;
      const perfNow = () => {
        try {
          const n = globalThis?.performance?.now?.();
          if (Number.isFinite(n)) return n;
        } catch (_err) {
          // Fallback below.
        }
        return Date.now();
      };
      const targetCanvas = card.querySelector("[data-thumb-canvas]");
      if (!(targetCanvas instanceof HTMLCanvasElement)) return;
      const ctx = targetCanvas.getContext("2d", { alpha: true });
      if (!ctx) return;
      const cache = this._ensureHoverPreviewCache();
      let preview = null;
      let renderTexture = null;
      const cached = cache.get(String(shaderId));
      let fromCache = false;
      if (cached && cached.preview && cached.renderTexture && cached.renderTexture.destroyed !== true) {
        preview = cached.preview;
        renderTexture = cached.renderTexture;
        cache.delete(String(shaderId));
        fromCache = true;
      } else {
        if (cached) this._destroyHoverPreviewEntry(shaderId, cached);
        preview = shaderManager.createImportedShaderPreview(shaderId, {
          size: 256,
          reason: "library-hover",
        });
        if (!preview) return;
        renderTexture = PIXI.RenderTexture.create({
          width: 256,
          height: 256,
        });
      }
      const thumbImage = card.querySelector("[data-thumb-image]");
      if (thumbImage instanceof HTMLElement) thumbImage.style.opacity = "0";
      let lastMs = performance.now();
      let perfLogFrames = 0;
      const tick = () => {
        if (!this._hoverPreview || this._hoverPreview.card !== card) return;
        const nowMs = performance.now();
        const dt = Math.min(0.1, Math.max(0, (nowMs - lastMs) / 1000));
        lastMs = nowMs;
        const tStep0 = perfNow();
        preview.step(dt);
        const stepMs = perfNow() - tStep0;
        const tRender0 = perfNow();
        preview.render(renderer, renderTexture);
        const renderMs = perfNow() - tRender0;
        const tExtract0 = perfNow();
        const extracted = renderer?.extract?.canvas?.(renderTexture);
        const extractMs = perfNow() - tExtract0;
        let drawMs = 0;
        if (extracted) {
          const tDraw0 = perfNow();
          ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
          ctx.drawImage(
            extracted,
            0,
            0,
            targetCanvas.width,
            targetCanvas.height,
          );
          drawMs = perfNow() - tDraw0;
        }
        if (perfLogFrames < 3) {
          perfLogFrames += 1;
          debugLog("library hover frame timings", {
            shaderId: String(shaderId),
            fromCache,
            frame: perfLogFrames,
            dt: Number(dt.toFixed(4)),
            stepMs: Number(stepMs.toFixed(3)),
            renderMs: Number(renderMs.toFixed(3)),
            extractMs: Number(extractMs.toFixed(3)),
            drawMs: Number(drawMs.toFixed(3)),
            totalMs: Number((stepMs + renderMs + extractMs + drawMs).toFixed(3)),
          });
        }
        this._hoverPreview.raf = requestAnimationFrame(tick);
      };
      this._hoverPreview = {
        card,
        shaderId: String(shaderId),
        preview,
        renderTexture,
        thumbImage,
        raf: requestAnimationFrame(tick),
      };
    }
    _ensureThumbnailQueueState() {
      if (!(this._thumbnailGenerationPending instanceof Set))
        this._thumbnailGenerationPending = new Set();
      if (!Array.isArray(this._thumbnailGenerationQueue))
        this._thumbnailGenerationQueue = [];
      if (typeof this._thumbnailGenerationActive !== "boolean")
        this._thumbnailGenerationActive = false;
      if (!(this._thumbnailGenerationFailed instanceof Set))
        this._thumbnailGenerationFailed = new Set();
    }
    _applyGeneratedThumbnail(shaderId, thumbnail) {
      if (typeof thumbnail !== "string") return;
      const dataUrl = thumbnail.trim();
      if (!dataUrl) return;
      const root = resolveElementRoot(this.element);
      if (!(root instanceof Element)) return;
      for (const card of root.querySelectorAll(
        ".indy-fx-shader-card[data-shader-id]",
      )) {
        if (String(card.dataset.shaderId ?? "") !== shaderId) continue;
        const thumbImage = card.querySelector("[data-thumb-image]");
        if (thumbImage instanceof HTMLImageElement) {
          thumbImage.src = dataUrl;
          thumbImage.style.display = "";
          thumbImage.style.opacity = "1";
        }
        const noThumb = card.querySelector("[data-no-thumb]");
        if (noThumb instanceof HTMLElement) noThumb.style.display = "none";
      }
    }
    _queueShaderThumbnailGeneration(shaderId) {
      const id = String(shaderId ?? "").trim();
      if (!id) return;
      this._ensureThumbnailQueueState();
      if (this._thumbnailGenerationPending.has(id)) return;
      if (this._thumbnailGenerationFailed.has(id)) return;
      this._thumbnailGenerationPending.add(id);
      this._thumbnailGenerationQueue.push(id);
      void this._processThumbnailGenerationQueue();
    }
    async _processThumbnailGenerationQueue() {
      this._ensureThumbnailQueueState();
      if (this._thumbnailGenerationActive) return;
      this._thumbnailGenerationActive = true;
      try {
        while (this._thumbnailGenerationQueue.length) {
          const shaderId = this._thumbnailGenerationQueue.shift();
          try {
            const updated =
              await shaderManager.regenerateImportedShaderThumbnail(shaderId);
            const thumbnail = updated?.thumbnail;
            if (thumbnail) {
              this._thumbnailGenerationFailed.delete(shaderId);
              this._applyGeneratedThumbnail(shaderId, thumbnail);
            } else {
              this._thumbnailGenerationFailed.add(shaderId);
            }
          } catch (err) {
            this._thumbnailGenerationFailed.add(shaderId);
            console.warn(
              `${MODULE_ID} | Failed to generate thumbnail for ${shaderId}`,
              err,
            );
          } finally {
            this._thumbnailGenerationPending.delete(shaderId);
          }
        }
      } finally {
        this._thumbnailGenerationActive = false;
      }
    }
    _queueMissingShaderThumbnails(root) {
      if (!(root instanceof Element)) return;
      for (const card of root.querySelectorAll(
        ".indy-fx-shader-card[data-shader-id]",
      )) {
        const shaderId = String(card.dataset.shaderId ?? "").trim();
        if (!shaderId) continue;
        const thumbImage = card.querySelector("[data-thumb-image]");
        const currentThumbnail = String(
          thumbImage?.getAttribute("src") ?? "",
        ).trim();
        const hasValidThumb =
          currentThumbnail &&
          !currentThumbnail.includes("[object") &&
          !/^https?:\/\/[^/]+\/\[object%20/i.test(currentThumbnail);
        if (hasValidThumb) continue;
        this._queueShaderThumbnailGeneration(shaderId);
      }
    }
    _getShaderDefaultOpts(shaderId) {
      const record = shaderManager.getImportedRecord(shaderId);
      const defaults = record
        ? shaderManager.getRecordShaderDefaults(record, { runtime: false })
        : (shaderManager.getDefaultImportedShaderDefaults?.() ?? {});
      const opts = {
        shaderId,
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
    _resolveActiveSelection() {
      const activeLayer = canvas?.activeLayer;
      const tokenDocs = canvas?.tokens?.controlled ?? [];
      const tileDocs = canvas?.tiles?.controlled ?? [];
      const templateDocs = canvas?.templates?.controlled ?? [];
      const sameLayer = (a, b) => Boolean(a && b && a === b);

      if (sameLayer(activeLayer, canvas?.tokens)) {
        return { targetType: "token", docs: tokenDocs };
      }
      if (sameLayer(activeLayer, canvas?.tiles)) {
        return { targetType: "tile", docs: tileDocs };
      }
      if (sameLayer(activeLayer, canvas?.templates)) {
        return { targetType: "template", docs: templateDocs };
      }

      const layerName = String(
        activeLayer?.documentName ??
          activeLayer?.options?.documentName ??
          activeLayer?.name ??
          "",
      ).toLowerCase();
      if (layerName.includes("token")) {
        return { targetType: "token", docs: tokenDocs };
      }
      if (layerName.includes("tile")) {
        return { targetType: "tile", docs: tileDocs };
      }
      if (layerName.includes("template") || layerName.includes("measured")) {
        return { targetType: "template", docs: templateDocs };
      }

      if (tokenDocs.length) return { targetType: "token", docs: tokenDocs };
      if (tileDocs.length) return { targetType: "tile", docs: tileDocs };
      if (templateDocs.length) {
        return { targetType: "template", docs: templateDocs };
      }
      return { targetType: null, docs: [] };
    }
    async _applyShaderToSelection(shaderId) {
      const fx = game.indyFX;
      if (!fx) {
        ui.notifications.error("indyFX API is unavailable.");
        return;
      }
      const { targetType, docs } = this._resolveActiveSelection();
      if (!targetType) {
        ui.notifications.warn(
          "Select one or more tokens, tiles, or templates on the active layer.",
        );
        return;
      }
      if (!docs.length) {
        ui.notifications.warn(
          `No ${targetType}s selected on the active layer.`,
        );
        return;
      }

      const opts = this._getShaderDefaultOpts(shaderId);
      let applied = 0;
      for (const doc of docs) {
        const id = String(doc?.id ?? "").trim();
        if (!id) continue;
        try {
          if (targetType === "token") await fx.broadcastShaderOn({ tokenId: id, opts: { ...opts } });
          else if (targetType === "tile")
            await fx.broadcastShaderOnTile({ tileId: id, opts: { ...opts } });
          else if (targetType === "template") {
            await fx.broadcastShaderOnTemplate({ templateId: id, opts: { ...opts } });
          }
          applied += 1;
        } catch (err) {
          console.error(
            `${MODULE_ID} | Failed to apply shader to ${targetType} ${id}`,
            err,
          );
        }
      }

      if (applied > 0) {
        ui.notifications.info(
          `Applied shader to ${applied} selected ${targetType}${applied === 1 ? "" : "s"}.`,
        );
      } else {
        ui.notifications.warn("No selected placeables could be updated.");
      }
    }
    async _ensureIndyFxMacroFolder() {
      const existing = game.folders?.find(
        (f) => f.type === "Macro" && f.name === "indyFX",
      );
      if (existing) return existing;
      return Folder.create({
        name: "indyFX",
        type: "Macro",
        color: "#4a6ca8",
      });
    }
    async _promptMacroName(defaultName) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
          if (done) return;
          done = true;
          resolve(value ?? null);
        };

        const dlg = new foundry.applications.api.DialogV2({
          window: { title: "Create Macro" },
          content: `<form><div class="form-group"><label>Macro Name</label><div class="form-fields"><input type="text" name="macroName" value="${String(defaultName ?? "").replace(/"/g, "&quot;")}" /></div></div></form>`,
          buttons: [
            {
              action: "create",
              label: "Create",
              icon: "fas fa-scroll",
              default: true,
              callback: (_event, _button, dialog) => {
                const root =
                  resolveElementRoot(dialog?.element) ??
                  resolveElementRoot(dialog);
                const name = String(
                  root?.querySelector('[name="macroName"]')?.value ?? "",
                ).trim();
                if (!name) {
                  ui.notifications.warn("Enter a macro name.");
                  return;
                }
                finish(name);
              },
            },
            {
              action: "cancel",
              label: "Cancel",
              icon: "fas fa-times",
              callback: () => finish(null),
            },
          ],
        });

        const close = dlg.close.bind(dlg);
        dlg.close = async (...args) => {
          finish(null);
          return close(...args);
        };
        void dlg.render(true);
      });
    }
    _buildShaderMacroCommand(targetType, opts) {
      const optsJson = JSON.stringify(opts, null, 2);
      let selectedExpr = "canvas.tokens?.controlled ?? []";
      let offMethod = "broadcastShaderOff";
      let onMethod = "broadcastShaderOn";
      let label = "token";
      if (targetType === "tile") {
        selectedExpr = "canvas.tiles?.controlled ?? []";
        offMethod = "broadcastShaderOffTile";
        onMethod = "broadcastShaderOnTile";
        label = "tile";
      } else if (targetType === "template") {
        selectedExpr = "canvas.templates?.controlled ?? []";
        offMethod = "broadcastShaderOffTemplate";
        onMethod = "broadcastShaderOnTemplate";
        label = "template";
      }

      return `const fx = game.indyFX;
if (!fx) {
  ui.notifications.error("indyFX API is unavailable.");
  return;
}
const selected = ${selectedExpr};
if (!selected.length) {
  ui.notifications.warn("Select one or more ${label}s.");
  return;
}
const opts = ${optsJson};
for (const placeable of selected) {
  const id = placeable?.id;
  if (!id) continue;
  try {
    await fx.${offMethod}(id);
    await fx.${onMethod}(id, { ...opts });
  } catch (err) {
    console.error("indyFX macro apply failed", id, err);
  }
}
ui.notifications.info(\`indyFX: applied shader to \${selected.length} ${label}\${selected.length === 1 ? "" : "s"}.\`);
`;
    }
    async _createSelectionMacro(shaderId, targetType) {
      const record = shaderManager.getImportedRecord(shaderId);
      if (!record) {
        ui.notifications.warn("Imported shader not found.");
        return;
      }
      const opts = this._getShaderDefaultOpts(shaderId);
      const suffix =
        targetType === "token"
          ? "Tokens"
          : targetType === "tile"
            ? "Tiles"
            : "Templates";
      const defaultName = `${record.label ?? record.name} (${suffix})`;
      const macroName = await this._promptMacroName(defaultName);
      if (!macroName) return;

      try {
        const folder = await this._ensureIndyFxMacroFolder();
        const command = this._buildShaderMacroCommand(targetType, opts);
        const macro = await Macro.create({
          name: macroName,
          type: "script",
          scope: "global",
          folder: folder?.id ?? null,
          command,
        });
        if (macro) {
          ui.notifications.info(`Created macro: ${macroName}`);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | Failed to create macro`, err);
        ui.notifications.error(err?.message ?? "Failed to create macro.");
      }
    }
    _hideShaderContextMenu() {
      if (!this._shaderContextMenu) return;
      this._shaderContextMenu.remove();
      this._shaderContextMenu = null;
      document.removeEventListener(
        "click",
        this._boundContextMenuDismiss,
        true,
      );
      this._boundContextMenuDismiss = null;
    }
    _showShaderContextMenu(event, shaderId) {
      this._hideShaderContextMenu();
      const menu = document.createElement("div");
      menu.className = "indy-fx-shader-context";
      menu.style.position = "fixed";
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      menu.style.zIndex = "10000";
      menu.style.background = "var(--color-bg, #222)";
      menu.style.border = "1px solid var(--color-border-light-primary, #666)";
      menu.style.borderRadius = "6px";
      menu.style.boxShadow = "0 8px 16px rgba(0,0,0,0.35)";
      menu.style.padding = "0.2rem";
      menu.innerHTML = `
        <button type="button" data-action="add-selected" style="display:block;width:100%;text-align:left;padding:0.35rem 0.55rem;border:none;background:transparent;color:inherit;cursor:pointer;">Add to Selected</button>
        <div style="height:1px;background:rgba(255,255,255,0.15);margin:0.2rem 0;"></div>
        <button type="button" data-action="macro-tokens" style="display:block;width:100%;text-align:left;padding:0.35rem 0.55rem;border:none;background:transparent;color:inherit;cursor:pointer;">Create Macro (Tokens)</button>
        <button type="button" data-action="macro-tiles" style="display:block;width:100%;text-align:left;padding:0.35rem 0.55rem;border:none;background:transparent;color:inherit;cursor:pointer;">Create Macro (Tiles)</button>
        <button type="button" data-action="macro-templates" style="display:block;width:100%;text-align:left;padding:0.35rem 0.55rem;border:none;background:transparent;color:inherit;cursor:pointer;">Create Macro (Templates)</button>
        <div style="height:1px;background:rgba(255,255,255,0.15);margin:0.2rem 0;"></div>
        <button type="button" data-action="duplicate" style="display:block;width:100%;text-align:left;padding:0.35rem 0.55rem;border:none;background:transparent;color:inherit;cursor:pointer;">Duplicate</button>
        <button type="button" data-action="delete" style="display:block;width:100%;text-align:left;padding:0.35rem 0.55rem;border:none;background:transparent;color:inherit;cursor:pointer;">Delete</button>
      `;
      const onDelete = async () => {
        this._hideShaderContextMenu();
        const removed = await shaderManager.removeImportedShader(shaderId);
        if (removed) {
          ui.notifications.info("Imported shader removed.");
          this.render();
        }
      };
      const onDuplicate = async () => {
        this._hideShaderContextMenu();
        const source = shaderManager.getImportedRecord(shaderId);
        if (!source) return;
        const dlg = new foundry.applications.api.DialogV2({
          window: { title: "Duplicate Shader" },
          content: `<form><div class="form-group"><label>New Name</label><div class="form-fields"><input type="text" name="duplicateName" value="${String(source.name ?? "").replace(/"/g, "&quot;")} Copy" /></div></div></form>`,
          buttons: [
            {
              action: "create",
              label: "Create",
              icon: "fas fa-copy",
              default: true,
              callback: async (_event, _button, dialog) => {
                const root =
                  resolveElementRoot(dialog?.element) ??
                  resolveElementRoot(dialog);
                const name = String(
                  root?.querySelector('[name="duplicateName"]')?.value ?? "",
                ).trim();
                if (!name) return ui.notifications.warn("Enter a name.");
                await shaderManager.duplicateImportedShader(shaderId, {
                  name,
                  label: `${name}`,
                });
                ui.notifications.info(`Duplicated shader: ${name}`);
                this.render();
              },
            },
            { action: "cancel", label: "Cancel", icon: "fas fa-times" },
          ],
        });
        await dlg.render(true);
      };

      menu
        .querySelector("[data-action='add-selected']")
        ?.addEventListener("click", () => {
          this._hideShaderContextMenu();
          void this._applyShaderToSelection(shaderId);
        });
      menu
        .querySelector("[data-action='macro-tokens']")
        ?.addEventListener("click", () => {
          this._hideShaderContextMenu();
          void this._createSelectionMacro(shaderId, "token");
        });
      menu
        .querySelector("[data-action='macro-tiles']")
        ?.addEventListener("click", () => {
          this._hideShaderContextMenu();
          void this._createSelectionMacro(shaderId, "tile");
        });
      menu
        .querySelector("[data-action='macro-templates']")
        ?.addEventListener("click", () => {
          this._hideShaderContextMenu();
          void this._createSelectionMacro(shaderId, "template");
        });
      menu
        .querySelector("[data-action='delete']")
        ?.addEventListener("click", () => void onDelete());
      menu
        .querySelector("[data-action='duplicate']")
        ?.addEventListener("click", () => void onDuplicate());
      document.body.appendChild(menu);
      this._shaderContextMenu = menu;
      this._boundContextMenuDismiss = () => this._hideShaderContextMenu();
      setTimeout(
        () =>
          document.addEventListener(
            "click",
            this._boundContextMenuDismiss,
            true,
          ),
        0,
      );
    }
    _bindShaderGrid(root) {
      for (const card of root.querySelectorAll(
        ".indy-fx-shader-card[data-shader-id]",
      )) {
        if (card.dataset.indyFxCardBound === "1") continue;
        card.dataset.indyFxCardBound = "1";
        const shaderId = String(card.dataset.shaderId ?? "");
        if (!shaderId) continue;
        if (card instanceof HTMLElement) card.draggable = true;
        for (const dragChild of card.querySelectorAll(
          "[data-thumb-stage], [data-thumb-image], [data-thumb-canvas], [data-no-thumb]",
        )) {
          if (dragChild instanceof HTMLElement) {
            dragChild.draggable = false;
            dragChild.style.pointerEvents = "none";
            dragChild.style.userSelect = "none";
          }
        }
        card.addEventListener("dragstart", (event) => {
          const payload = JSON.stringify({
            type: "indyfx-shader",
            shaderId,
          });
          event.dataTransfer?.setData("application/x-indyfx-shader", payload);
          event.dataTransfer?.setData("text/plain", payload);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
          card.classList.add("indy-fx-dragging");
        });
        card.addEventListener("dragend", () => {
          card.classList.remove("indy-fx-dragging");
        });
        card.addEventListener("click", async () => {
          const scrollHost = root?.matches?.("form.indy-fx-shader-library")
            ? root
            : (root?.querySelector?.("form.indy-fx-shader-library") ??
              card.closest("form.indy-fx-shader-library"));
          if (scrollHost instanceof HTMLElement) {
            this._shaderLibraryScrollTop = scrollHost.scrollTop;
          }
          await game.settings.set(MODULE_ID, "shaderPreset", shaderId);

          const grid =
            card.closest?.("[data-shader-grid]") ??
            root?.querySelector?.("[data-shader-grid]");
          if (grid instanceof Element) {
            for (const c of grid.querySelectorAll(".indy-fx-shader-card")) {
              c.classList.remove("is-selected");
              if (c instanceof HTMLElement) c.style.boxShadow = "";
            }
          }
          card.classList.add("is-selected");
          if (card instanceof HTMLElement) {
            card.style.boxShadow = "0 0 0 2px rgba(80,160,255,0.75) inset";
          }
        });
        card.addEventListener("dblclick", (event) => {
          event.preventDefault();
          void this._openShaderEditor(shaderId);
        });
        card.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this._showShaderContextMenu(event, shaderId);
        });
        card.addEventListener("mouseenter", () =>
          this._startHoverPreview(shaderId, card),
        );
        card.addEventListener("mouseleave", () => this._stopHoverPreview());
      }
    }

    _applyShaderSearchFilter(root) {
      if (!(root instanceof Element)) return;
      const term = String(this._shaderLibrarySearchTerm ?? "")
        .trim()
        .toLocaleLowerCase();
      let visibleCount = 0;
      for (const card of root.querySelectorAll(
        ".indy-fx-shader-card[data-shader-id]",
      )) {
        const name = String(card.dataset.shaderName ?? "").toLocaleLowerCase();
        const label = String(card.dataset.shaderLabel ?? "").toLocaleLowerCase();
        const matches = !term || name.includes(term) || label.includes(term);
        if (card instanceof HTMLElement) card.style.display = matches ? "" : "none";
        if (matches) visibleCount += 1;
      }
      for (const emptyEl of root.querySelectorAll("[data-search-empty]")) {
        if (!(emptyEl instanceof HTMLElement)) continue;
        emptyEl.style.display = visibleCount > 0 ? "none" : "";
      }
    }

    _bindShaderSearch(root) {
      for (const input of root.querySelectorAll("[data-action='shader-search']")) {
        if (!(input instanceof HTMLInputElement)) continue;
        if (input.dataset.indyFxSearchBound === "1") continue;
        input.dataset.indyFxSearchBound = "1";
        input.addEventListener("input", () => {
          this._shaderLibrarySearchTerm = String(input.value ?? "");
          this._applyShaderSearchFilter(root);
        });
      }
    }
    _onRender(context, options) {
      super._onRender?.(context, options);
      this._stopHoverPreview({ destroy: true });
      this._destroyHoverPreviewCache();
      this._hideShaderContextMenu();
      const root =
        resolveElementRoot(this.element) ??
        resolveElementRoot(context?.element) ??
        resolveElementRoot(context);
      if (!(root instanceof Element)) return;
      const form = root.matches("form") ? root : root.querySelector("form");
      if (!(form instanceof HTMLFormElement)) return;
      if (Number.isFinite(this._shaderLibraryScrollTop)) {
        const targetTop = Number(this._shaderLibraryScrollTop);
        form.scrollTop = targetTop;
        requestAnimationFrame(() => {
          if (form.isConnected) form.scrollTop = targetTop;
        });
      }
      for (const modeSelect of root.querySelectorAll("[data-channel-mode]")) {
        if (!(modeSelect instanceof HTMLElement)) continue;
        if (modeSelect.dataset.indyFxModeBound === "1") continue;
        modeSelect.dataset.indyFxModeBound = "1";
        modeSelect.addEventListener("change", () =>
          this._updateChannelUi(root),
        );
      }
      this._bindPickImageButtons(root);
      this._bindShaderGrid(root);
      this._bindShaderSearch(root);
      this._applyShaderSearchFilter(root);
      this._queueMissingShaderThumbnails(root);

      for (const exportBtn of root.querySelectorAll("[data-action='export-shader-library']")) {
        if (!(exportBtn instanceof HTMLElement)) continue;
        if (exportBtn.dataset.indyFxExportBound === "1") continue;
        exportBtn.dataset.indyFxExportBound = "1";
        exportBtn.addEventListener("click", (event) => {
          event.preventDefault();
          void this._exportShaderLibraryToFile();
        });
      }

      for (const importBtn of root.querySelectorAll("[data-action='import-shader-library']")) {
        if (!(importBtn instanceof HTMLElement)) continue;
        if (importBtn.dataset.indyFxImportBound === "1") continue;
        importBtn.dataset.indyFxImportBound = "1";
        importBtn.addEventListener("click", (event) => {
          event.preventDefault();
          const input = root.querySelector('[name="importShaderLibraryFile"]');
          if (input instanceof HTMLInputElement) input.click();
        });
      }

      for (const fileInput of root.querySelectorAll('[name="importShaderLibraryFile"]')) {
        if (!(fileInput instanceof HTMLInputElement)) continue;
        if (fileInput.dataset.indyFxFileBound === "1") continue;
        fileInput.dataset.indyFxFileBound = "1";
        fileInput.addEventListener("change", (event) => {
          const target = event.currentTarget;
          const file = target instanceof HTMLInputElement ? target.files?.[0] : null;
          if (target instanceof HTMLInputElement) target.value = "";
          void this._importShaderLibraryFromFile(file ?? null);
        });
      }

      for (const copyBtn of root.querySelectorAll(
        "[data-action='copy-shadertoy-json-script']",
      )) {
        if (!(copyBtn instanceof HTMLElement)) continue;
        if (copyBtn.dataset.indyFxCopyBound === "1") continue;
        copyBtn.dataset.indyFxCopyBound = "1";
        copyBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          const ok = await copyTextToClipboard(SHADERTOY_JSON_DEVTOOLS_SNIPPET);
          if (ok)
            ui.notifications.info(
              "ShaderToy devtools command copied to clipboard.",
            );
          else ui.notifications.error("Failed to copy command to clipboard.");
        });
      }
      for (const importBtn of root.querySelectorAll(
        "[data-action='import-url-shader']",
      )) {
        if (!(importBtn instanceof HTMLElement)) continue;
        if (importBtn.dataset.indyFxImportUrlBound === "1") continue;
        importBtn.dataset.indyFxImportUrlBound = "1";
        importBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          const importUrl = String(
            root.querySelector('[name="importUrl"]')?.value ?? "",
          ).trim();
          const apiKey = String(
            root.querySelector('[name="importApiKey"]')?.value ?? "",
          ).trim();
          const importName = String(
            root.querySelector('[name="importName"]')?.value ?? "",
          ).trim();
          if (!importUrl)
            return ui.notifications.warn("Enter a ShaderToy URL or ID.");
          if (!apiKey)
            return ui.notifications.warn(
              "Enter a ShaderToy API key for URL import.",
            );
          try {
            const record = await shaderManager.importShaderToyFromUrl({
              url: importUrl,
              name: importName,
              apiKey,
            });
            ui.notifications.info(
              `Imported shader: ${record.label ?? record.name}`,
            );
            await shaderManager.enforceValidSelection();
            this.render();
          } catch (err) {
            console.error(`${MODULE_ID} | Shader URL import failed`, err);
            ui.notifications.error(err?.message ?? "Shader URL import failed.");
          }
        });
      }
      for (const importBtn of root.querySelectorAll(
        "[data-action='import-json-shader']",
      )) {
        if (!(importBtn instanceof HTMLElement)) continue;
        if (importBtn.dataset.indyFxImportJsonBound === "1") continue;
        importBtn.dataset.indyFxImportJsonBound = "1";
        importBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          const importJson = String(
            root.querySelector('[name="importShaderToyJson"]')?.value ?? "",
          ).trim();
          const importName = String(
            root.querySelector('[name="importName"]')?.value ?? "",
          ).trim();
          if (!importJson)
            return ui.notifications.warn("Paste ShaderToy JSON first.");
          try {
            const record = await shaderManager.importShaderToyJson({
              json: importJson,
              name: importName,
            });
            ui.notifications.info(
              `Imported shader: ${record.label ?? record.name}`,
            );
            await shaderManager.enforceValidSelection();
            this.render();
          } catch (err) {
            console.error(`${MODULE_ID} | Shader JSON import failed`, err);
            ui.notifications.error(
              err?.message ?? "Shader JSON import failed.",
            );
          }
        });
      }
      if (form.dataset.indyFxSubmitBound !== "1") {
        form.dataset.indyFxSubmitBound = "1";
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          void this._onSubmitForm(form);
        });
      }
      this._updateChannelUi(root);
    }    async _onSubmitForm(form) {
      const formData = new FormDataExtended(form, {}).object;
      const name = String(formData.importName ?? "").trim();
      const label = String(formData.importLabel ?? "").trim() || null;
      const source = String(formData.importSource ?? "").trim();
      if (!name || !source) {
        return ui.notifications.warn(
          "Enter both shader name and ShaderToy source.",
        );
      }
      const channels = {};
      for (const index of [0, 1, 2, 3]) {
        channels[`iChannel${index}`] = {
          mode: String(formData[`channel${index}Mode`] ?? "auto"),
          path: String(formData[`channel${index}Path`] ?? "").trim(),
          source: String(formData[`channel${index}Source`] ?? "").trim(),
        };
      }
      const autoAssignCapture =
        formData.autoAssignCapture === true ||
        formData.autoAssignCapture === "on";
      try {
        const record = await shaderManager.importShaderToy({
          name,
          label,
          source,
          channels,
          autoAssignCapture,
        });
        ui.notifications.info(
          `Imported shader: ${record.label ?? record.name}`,
        );
        await shaderManager.enforceValidSelection();
        this.render();
      } catch (err) {
        console.error(`${MODULE_ID} | Shader import failed`, err);
        ui.notifications.error(
          err?.message ?? "Shader import failed. Check ShaderToy source.",
        );
      }
    }
  }
  return {
    ShaderSettingsMenu,
    SparksSettingsMenu,
    DebugSettingsMenu,
    ShaderLibraryMenu,
  };
}






















