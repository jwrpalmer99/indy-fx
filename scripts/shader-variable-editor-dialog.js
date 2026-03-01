import { applyEditorSettingTooltips } from "./editor-tooltips.js";
import {
  applyEditableShaderVariables,
  compareShaderVariableDisplayOrder,
  extractEditableShaderVariables,
  formatShaderScalarValue,
  formatShaderVectorValue,
  hexToVecRgb,
  vecToHex,
} from "./shader-variable-utils.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveElementRoot(candidate) {
  if (!candidate) return null;
  if (candidate instanceof Element) return candidate;
  if (
    typeof candidate?.querySelector === "function" &&
    typeof candidate?.addEventListener === "function"
  ) {
    return candidate;
  }
  if (candidate?.element) return resolveElementRoot(candidate.element);
  if (Array.isArray(candidate) && candidate[0] instanceof Element) return candidate[0];
  if (typeof candidate?.length === "number" && candidate[0] instanceof Element) {
    return candidate[0];
  }
  if (typeof candidate?.get === "function") {
    const maybe = candidate.get(0);
    if (maybe instanceof Element) return maybe;
  }
  return null;
}

function ensureDialogVerticalScroll(candidate, { viewportHeight = "88vh" } = {}) {
  const root = resolveElementRoot(candidate);
  if (!(root instanceof Element)) return;
  applyEditorSettingTooltips(root);
  const host =
    root.matches?.(".window-app, .application")
      ? root
      : (root.closest?.(".window-app, .application") ??
        root.querySelector?.(".window-app, .application"));
  if (host instanceof HTMLElement) {
    host.style.maxHeight = viewportHeight;
    host.style.height = "auto";
  }
  const windowContent =
    root.matches?.(".window-content")
      ? root
      : (root.closest?.(".window-content") ?? root.querySelector?.(".window-content"));
  if (windowContent instanceof HTMLElement) {
    windowContent.style.maxHeight = `calc(${viewportHeight} - 4.5rem)`;
    windowContent.style.overflowY = "auto";
    windowContent.style.overflowX = "hidden";
    windowContent.style.minHeight = "0";
  }
}

function normalizeSourceEntries(sourceEntries = []) {
  const entries = [];
  const seen = new Set();
  for (let i = 0; i < sourceEntries.length; i += 1) {
    const candidate = sourceEntries[i];
    if (!candidate || typeof candidate !== "object") continue;
    const key = String(candidate.key ?? candidate.label ?? `source_${i}`).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const label = String(candidate.label ?? key).trim() || key;
    const readSource =
      typeof candidate.readSource === "function"
        ? candidate.readSource
        : () => String(candidate.source ?? "");
    const writeSource =
      typeof candidate.writeSource === "function"
        ? candidate.writeSource
        : (typeof candidate.setSource === "function" ? candidate.setSource : null);
    const editable = candidate.editable !== false;
    const writable = typeof writeSource === "function";
    const readUniformValues =
      typeof candidate.readUniformValues === "function"
        ? candidate.readUniformValues
        : (typeof candidate.getUniformValues === "function"
          ? candidate.getUniformValues
          : () => ({}));
    const writeUniformValues =
      typeof candidate.writeUniformValues === "function"
        ? candidate.writeUniformValues
        : (typeof candidate.setUniformValues === "function"
          ? candidate.setUniformValues
          : null);
    const uniformValuesWritable = typeof writeUniformValues === "function";
    entries.push({
      key,
      label,
      editable,
      writable,
      readSource: () => String(readSource() ?? ""),
      writeSource: (nextSource) => {
        if (!editable || !writable) return;
        writeSource(String(nextSource ?? ""));
      },
      readUniformValues: () => {
        const map = readUniformValues?.();
        if (!map || typeof map !== "object" || Array.isArray(map)) return {};
        return foundry.utils.deepClone(map);
      },
      writeUniformValues: (nextUniformValues) => {
        if (!uniformValuesWritable) return;
        const payload =
          nextUniformValues && typeof nextUniformValues === "object" && !Array.isArray(nextUniformValues)
            ? foundry.utils.deepClone(nextUniformValues)
            : {};
        writeUniformValues(payload);
      },
      uniformValuesWritable,
    });
  }
  return entries;
}

function getSourceSection(entry) {
  const key = String(entry?.key ?? "").toLowerCase();
  const label = String(entry?.label ?? "").toLowerCase();
  if (key.includes("common") || label.includes("common")) return "common";
  if (
    key === "instancesource" ||
    key === "editsource" ||
    label.includes("shader source")
  ) {
    return "shader";
  }
  if (key.includes("buffer") || /ichannel\s*\d+\s*buffer/.test(label)) {
    return "buffer";
  }
  return "other";
}

function getSectionOrder(section) {
  if (section === "common") return 0;
  if (section === "shader") return 1;
  if (section === "buffer") return 2;
  return 3;
}

function getBufferChannelIndex(entry) {
  const label = String(entry?.label ?? "");
  const key = String(entry?.key ?? "");
  const labelMatch = label.match(/iChannel\s*([0-3])\s*Buffer/i);
  if (labelMatch) return Number(labelMatch[1]);
  const keyMatch = key.match(/buffer(?:source)?[_-]?([0-3])/i);
  if (keyMatch) return Number(keyMatch[1]);
  return 99;
}

function getScalarSliderSpec(variable) {
  if (!variable || variable.kind !== "scalar") return null;
  const type = String(variable.type ?? "").trim().toLowerCase();
  if (type === "bool") return null;
  const min = Number(variable.min);
  const max = Number(variable.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const span = Math.abs(max - min);
  const step = type === "int" ? 1 : Math.max(0.001, span / 1000);
  const rawValue = Number(variable.value);
  const clampedValue = Math.min(max, Math.max(min, Number.isFinite(rawValue) ? rawValue : min));
  return { min, max, step, clampedValue };
}

export async function openShaderVariableEditorDialog({
  title = "Edit Shader Variables",
  sourceEntries = [],
  onApply = null,
} = {}) {
  const normalizedEntries = normalizeSourceEntries(sourceEntries);
  if (!normalizedEntries.length) {
    ui.notifications.warn("Shader source editor not found.");
    return null;
  }

  const sourceGroups = [];
  for (const sourceEntry of normalizedEntries) {
    const sourceText = sourceEntry.readSource();
    const extracted = extractEditableShaderVariables(sourceText, {
      uniformValues: sourceEntry.readUniformValues(),
    });
    if (!extracted.length) continue;
    const sourceSection = getSourceSection(sourceEntry);
    extracted.sort(compareShaderVariableDisplayOrder);
    sourceGroups.push({
      sourceEntry,
      section: sourceSection,
      variables: extracted.map((variable) => ({
        ...variable,
        sourceKey: sourceEntry.key,
        sourceLabel: sourceEntry.label,
        sourceEditable: sourceEntry.editable,
        sourceWritable: sourceEntry.writable,
        sourceUniformWritable: sourceEntry.uniformValuesWritable,
      })),
    });
  }

  sourceGroups.sort((a, b) => {
    const bySection = getSectionOrder(a.section) - getSectionOrder(b.section);
    if (bySection !== 0) return bySection;
    if (a.section === "buffer" && b.section === "buffer") {
      const byChannel =
        getBufferChannelIndex(a.sourceEntry) - getBufferChannelIndex(b.sourceEntry);
      if (byChannel !== 0) return byChannel;
    }
    return String(a?.sourceEntry?.label ?? "").localeCompare(
      String(b?.sourceEntry?.label ?? ""),
      undefined,
      { sensitivity: "base" },
    );
  });

  if (!sourceGroups.length) {
    ui.notifications.info("No editable const/#define/uniform variables detected.");
    return null;
  }

  const variables = [];
  const sectionTitle = {
    common: "Common Variables",
    shader: "Shader Variables",
    buffer: "Buffer Variables",
    other: "Other Variables",
  };

  let rows = "";
  let currentSection = "";
  for (const group of sourceGroups) {
    if (group.section !== currentSection) {
      currentSection = group.section;
      rows += `
        <div class="form-group" style="margin-top:0.75rem;">
          <label style="font-size:1rem;">${escapeHtml(sectionTitle[currentSection] ?? "Variables")}</label>
          <hr style="margin:0.25rem 0 0.5rem 0;opacity:0.5;" />
        </div>
      `;
    }

    if (group.section === "buffer") {
      rows += `
        <div class="form-group" style="margin:0.2rem 0 0.35rem 0;">
          <p class="notes" style="margin:0;opacity:.9;font-weight:600;">${escapeHtml(group.sourceEntry.label)}</p>
        </div>
      `;
    }

    for (const variable of group.variables) {
      const index = variables.length;
      variables.push(variable);
      const name = String(variable.name ?? "");
      const type = String(variable.type ?? "");
      const tip = String(variable.tip ?? "").trim();
      const tipAttr = tip ? ` title="${escapeHtml(tip)}"` : "";
      const editable =
        variable.declaration === "uniform"
          ? variable.sourceUniformWritable === true
          : variable.sourceEditable !== false;
      const disabledAttr = editable ? "" : " disabled";

      if (variable.kind === "scalar") {
        if (type === "bool") {
          const isChecked = Boolean(variable.value);
          rows += `
            <div class="form-group" data-var-index="${index}" data-var-kind="scalar">
              <label${tipAttr}>${escapeHtml(name)} <small style="opacity:.8;">(${escapeHtml(type)})</small></label>
              <div class="form-fields">
                <label class="checkbox" style="gap:.35rem;"${tipAttr}>
                  <input type="checkbox" name="var_${index}_value"${isChecked ? " checked" : ""}${disabledAttr}${tipAttr} />
                  Enabled
                </label>
              </div>
            </div>
          `;
        } else {
          const sliderSpec = getScalarSliderSpec(variable);
          if (sliderSpec) {
            const displayValue = formatShaderScalarValue(sliderSpec.clampedValue, type);
            rows += `
              <div class="form-group" data-var-index="${index}" data-var-kind="scalar">
                <label${tipAttr}>${escapeHtml(name)} <small style="opacity:.8;">(${escapeHtml(type)})</small></label>
                <div class="form-fields" style="gap:0.5rem;align-items:center;flex-wrap:nowrap;width:100%;">
                  <input type="range" name="var_${index}_slider" value="${escapeHtml(displayValue)}" min="${escapeHtml(String(sliderSpec.min))}" max="${escapeHtml(String(sliderSpec.max))}" step="${escapeHtml(String(sliderSpec.step))}" data-slider-number="var_${index}_value" style="flex:1 1 auto;min-width:0;"${disabledAttr}${tipAttr} />
                  <input type="number" name="var_${index}_value" value="${escapeHtml(displayValue)}" step="${escapeHtml(String(sliderSpec.step))}" style="width:6.5rem;flex:0 0 auto;"${disabledAttr}${tipAttr} />
                </div>
              </div>
            `;
          } else {
            rows += `
              <div class="form-group" data-var-index="${index}" data-var-kind="scalar">
                <label${tipAttr}>${escapeHtml(name)} <small style="opacity:.8;">(${escapeHtml(type)})</small></label>
                <div class="form-fields">
                  <input type="number" name="var_${index}_value" value="${escapeHtml(formatShaderScalarValue(variable.value, type))}" step="${type === "int" ? "1" : "0.001"}"${disabledAttr}${tipAttr} />
                </div>
              </div>
            `;
          }
        }
        continue;
      }

      const expected = type === "vec4" ? 4 : 3;
      const values = Array.isArray(variable.values) ? variable.values.slice(0, expected) : [];
      while (values.length < expected) values.push(0);
      const colorHex = vecToHex(values);
      const componentInputs = values
        .map(
          (value, componentIndex) =>
            `<input type="number" name="var_${index}_c${componentIndex}" value="${escapeHtml(formatShaderVectorValue(value))}" step="0.001"${disabledAttr}${tipAttr} />`,
        )
        .join("");

      rows += `
        <div class="form-group" data-var-index="${index}" data-var-kind="vector" data-var-type="${escapeHtml(type)}">
          <label${tipAttr}>${escapeHtml(name)} <small style="opacity:.8;">(${escapeHtml(type)})</small></label>
          <div class="form-fields" style="gap:0.35rem;align-items:center;flex-wrap:wrap;">
            <input type="color" name="var_${index}_color" value="${escapeHtml(colorHex)}"${disabledAttr}${tipAttr} />
            ${componentInputs}
          </div>
        </div>
      `;
    }
  }

  const content = `<form class="indy-fx-variable-editor" style="max-height:min(72vh, calc(100vh - 220px));overflow-y:auto;overflow-x:hidden;padding-right:.35rem;">${rows}</form>`;

  const readDialogVariables = (dialogRoot) => {
    return variables.map((variable, index) => {
      if (variable.kind === "scalar") {
        if (String(variable.type ?? "") === "bool") {
          const el = dialogRoot?.querySelector?.(`[name="var_${index}_value"]`);
          const checked = el instanceof HTMLInputElement ? el.checked : Boolean(variable.value);
          return {
            ...variable,
            value: checked,
          };
        }
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

  const buildVariablesBySourceKey = (nextVariables) => {
    const varsBySourceKey = new Map();
    for (const variable of nextVariables) {
      const sourceKey = String(variable?.sourceKey ?? "").trim();
      if (!sourceKey) continue;
      if (!varsBySourceKey.has(sourceKey)) varsBySourceKey.set(sourceKey, []);
      varsBySourceKey.get(sourceKey).push(variable);
    }
    return varsBySourceKey;
  };

  const applyUniformVariablesBySource = (varsBySourceKey, updatedSourceKeys) => {
    for (const sourceEntry of normalizedEntries) {
      const scopedVariables = varsBySourceKey.get(sourceEntry.key) ?? [];
      if (!scopedVariables.length) continue;
      const uniformScopedVariables = scopedVariables.filter(
        (variable) => String(variable?.declaration ?? "").trim().toLowerCase() === "uniform",
      );
      if (!uniformScopedVariables.length || !sourceEntry.uniformValuesWritable) continue;
      const currentUniformValues = sourceEntry.readUniformValues();
      const nextUniformValues = foundry.utils.deepClone(currentUniformValues);
      for (const variable of uniformScopedVariables) {
        const uniformName = String(variable?.name ?? "").trim();
        if (!uniformName) continue;
        if (variable?.kind === "vector") {
          nextUniformValues[uniformName] = Array.isArray(variable?.values)
            ? variable.values.map((value) => Number(value))
            : [];
        } else if (String(variable?.type ?? "").trim().toLowerCase() === "bool") {
          nextUniformValues[uniformName] = Boolean(variable?.value);
        } else {
          const n = Number(variable?.value);
          nextUniformValues[uniformName] = Number.isFinite(n) ? n : 0;
        }
      }
      if (JSON.stringify(nextUniformValues) !== JSON.stringify(currentUniformValues)) {
        sourceEntry.writeUniformValues(nextUniformValues);
        updatedSourceKeys.push(`${sourceEntry.key}:uniforms`);
      }
    }
  };

  const notifyApply = async (action, updatedSourceKeys) => {
    if (typeof onApply !== "function") return;
    await onApply({
      action,
      changed: updatedSourceKeys.length > 0,
      updatedSourceKeys,
    });
  };

  const applyUniformsFromDialog = async (dialogRoot, action = "live") => {
    const nextVariables = readDialogVariables(dialogRoot);
    const varsBySourceKey = buildVariablesBySourceKey(nextVariables);
    const updatedSourceKeys = [];
    applyUniformVariablesBySource(varsBySourceKey, updatedSourceKeys);
    await notifyApply(action, updatedSourceKeys);
    return {
      nextVariables,
      varsBySourceKey,
      updatedSourceKeys,
    };
  };

  const applyFromDialog = async (dialogRoot, action = "apply") => {
    const nextVariables = readDialogVariables(dialogRoot);
    const varsBySourceKey = buildVariablesBySourceKey(nextVariables);

    const updatedSourceKeys = [];
    for (const sourceEntry of normalizedEntries) {
      const scopedVariables = varsBySourceKey.get(sourceEntry.key) ?? [];
      if (!scopedVariables.length) continue;
      const sourceScopedVariables = scopedVariables.filter(
        (variable) => String(variable?.declaration ?? "").trim().toLowerCase() !== "uniform",
      );
      if (sourceScopedVariables.length && sourceEntry.editable && sourceEntry.writable) {
        const sourceText = sourceEntry.readSource();
        const nextSource = applyEditableShaderVariables(sourceText, sourceScopedVariables);
        if (nextSource !== sourceText) {
          sourceEntry.writeSource(nextSource);
          updatedSourceKeys.push(sourceEntry.key);
        }
      }
    }
    applyUniformVariablesBySource(varsBySourceKey, updatedSourceKeys);
    await notifyApply(action, updatedSourceKeys);
  };

  const variableDialog = new foundry.applications.api.DialogV2({
    window: {
      title,
      resizable: true,
    },
    content,
    buttons: [
      {
        action: "save",
        label: "Save",
        icon: "fas fa-save",
        default: true,
        close: true,
        callback: async (_event, _button, dialog) => {
          const dialogRoot = resolveElementRoot(dialog?.element) ?? resolveElementRoot(dialog);
          await applyFromDialog(dialogRoot, "save");
          return true;
        },
      },
      {
        action: "apply",
        label: "Apply",
        icon: "fas fa-check",
        close: false,
        callback: async (_event, _button, dialog) => {
          const dialogRoot = resolveElementRoot(dialog?.element) ?? resolveElementRoot(dialog);
          await applyFromDialog(dialogRoot, "apply");
          return false;
        },
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fas fa-times",
        close: true,
      },
    ],
  });

  await variableDialog.render(true);
  const variableRoot = resolveElementRoot(variableDialog?.element) ?? resolveElementRoot(variableDialog);
  ensureDialogVerticalScroll(variableRoot);

  const getVariableIndexFromControlName = (name) => {
    const match = String(name ?? "").match(/^var_(\d+)_(?:value|slider|color|c\d+)$/);
    if (!match) return -1;
    const idx = Number(match[1]);
    return Number.isInteger(idx) && idx >= 0 ? idx : -1;
  };

  const isLiveUniformControl = (target) => {
    if (!(target instanceof HTMLInputElement)) return false;
    const idx = getVariableIndexFromControlName(target.name);
    if (idx < 0) return false;
    const variable = variables[idx];
    return (
      variable &&
      String(variable?.declaration ?? "").trim().toLowerCase() === "uniform" &&
      variable?.sourceUniformWritable === true
    );
  };

  let liveUniformApplyScheduled = false;
  let liveUniformApplyPending = false;
  const scheduleLiveUniformApply = () => {
    if (liveUniformApplyScheduled) {
      liveUniformApplyPending = true;
      return;
    }
    liveUniformApplyScheduled = true;
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback) => globalThis.setTimeout(callback, 0);
    schedule(async () => {
      const dialogRoot =
        resolveElementRoot(variableDialog?.element) ?? resolveElementRoot(variableDialog);
      try {
        await applyUniformsFromDialog(dialogRoot, "live");
      } finally {
        if (liveUniformApplyPending) {
          liveUniformApplyPending = false;
          liveUniformApplyScheduled = false;
          scheduleLiveUniformApply();
        } else {
          liveUniformApplyScheduled = false;
        }
      }
    });
  };

  if (variableRoot instanceof Element) {
    const liveListener = (event) => {
      if (!isLiveUniformControl(event.target)) return;
      scheduleLiveUniformApply();
    };
    variableRoot.addEventListener("input", liveListener);
    variableRoot.addEventListener("change", liveListener);
  }

  const applyButton = variableRoot?.querySelector?.('[data-action="apply"]');
  if (applyButton instanceof HTMLElement) {
    if (applyButton.dataset.indyFxNoCloseApplyBound !== "1") {
      applyButton.dataset.indyFxNoCloseApplyBound = "1";
      applyButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          const dialogRoot =
            resolveElementRoot(variableDialog?.element) ?? resolveElementRoot(variableDialog);
          void applyFromDialog(dialogRoot, "apply");
        },
        { capture: true },
      );
    }
  }

  for (const group of variableRoot?.querySelectorAll?.('[data-var-kind="vector"][data-var-index]') ?? []) {
    const idx = Number(group.getAttribute("data-var-index") ?? -1);
    if (!Number.isInteger(idx) || idx < 0) continue;
    const colorInput = group.querySelector(`[name="var_${idx}_color"]`);
    if (!(colorInput instanceof HTMLInputElement)) continue;
    if (colorInput.disabled) continue;
    colorInput.addEventListener("input", () => {
      const rgb = hexToVecRgb(colorInput.value);
      for (let c = 0; c < 3; c += 1) {
        const componentInput = group.querySelector(`[name="var_${idx}_c${c}"]`);
        if (componentInput instanceof HTMLInputElement) {
          componentInput.value = formatShaderVectorValue(rgb[c]);
        }
      }
    });
  }

  for (const sliderInput of variableRoot?.querySelectorAll?.('input[type="range"][data-slider-number]') ?? []) {
    if (!(sliderInput instanceof HTMLInputElement)) continue;
    const numberInputName = String(sliderInput.dataset.sliderNumber ?? "").trim();
    if (!numberInputName) continue;
    const numberSelector =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? `[name="${CSS.escape(numberInputName)}"]`
        : `[name="${numberInputName.replace(/"/g, '\\"')}"]`;
    const numberInput = variableRoot?.querySelector?.(numberSelector);
    const match = String(sliderInput.name ?? "").match(/^var_(\d+)_slider$/);
    const idx = match ? Number(match[1]) : -1;
    const variable = Number.isInteger(idx) && idx >= 0 ? variables[idx] : null;
    const type = String(variable?.type ?? "float");
    const clampToSliderRange = (raw) => {
      const min = Number(sliderInput.min);
      const max = Number(sliderInput.max);
      return Math.min(
        Number.isFinite(max) ? max : raw,
        Math.max(Number.isFinite(min) ? min : raw, raw),
      );
    };
    const syncSliderToNumber = () => {
      if (!(numberInput instanceof HTMLInputElement)) return;
      const raw = Number(sliderInput.value);
      numberInput.value = formatShaderScalarValue(
        Number.isFinite(raw) ? raw : Number(variable?.value ?? 0),
        type,
      );
    };
    const syncNumberToSlider = ({ commit = false } = {}) => {
      if (!(numberInput instanceof HTMLInputElement)) return;
      const raw = Number(numberInput.value);
      if (!Number.isFinite(raw)) return;
      const clamped = clampToSliderRange(raw);
      sliderInput.value = String(clamped);
      if (commit && clamped === raw) {
        numberInput.value = formatShaderScalarValue(clamped, type);
      }
    };
    syncSliderToNumber();
    if (!sliderInput.disabled) {
      sliderInput.addEventListener("input", syncSliderToNumber);
      sliderInput.addEventListener("change", syncSliderToNumber);
      sliderInput.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          const scrollTarget =
            sliderInput.closest(".indy-fx-variable-editor") ??
            sliderInput.closest(".window-content");
          if (scrollTarget instanceof HTMLElement) {
            scrollTarget.scrollTop += event.deltaY;
          }
        },
        { passive: false },
      );
    }
    if (numberInput instanceof HTMLInputElement && !numberInput.disabled) {
      numberInput.addEventListener("input", () => syncNumberToSlider());
      numberInput.addEventListener("change", () => syncNumberToSlider({ commit: true }));
    }
  }

  return variableDialog;
}
