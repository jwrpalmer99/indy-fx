function parseBooleanLiteral(value) {
  let text = String(value ?? "").trim().toLowerCase();
  const ctor = text.match(/^bool\s*\(\s*(.*?)\s*\)$/);
  if (ctor) text = String(ctor[1] ?? "").trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}

function parseEditableAnnotation(commentText) {
  const text = String(commentText ?? "");
  const m = text.match(/@(?:editable|indyfx)\b\s*(?:=|:)?\s*([^\r\n]*)/i);
  if (!m) return null;
  // Allow chaining annotations in a single comment, e.g.:
  // @editable 0.5 @order 1
  return String(m[1] ?? "")
    .replace(/\s+@\w[\s\S]*$/i, "")
    .trim();
}

function parseOrderAnnotation(commentText) {
  const n = parseNumericAnnotation(commentText, "order");
  return Number.isFinite(n) ? n : null;
}

function parseNumericAnnotation(commentText, name) {
  const text = String(commentText ?? "");
  const escapedName = String(name ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `@${escapedName}\\b\\s*(?:=|:)?\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)`,
    "i",
  );
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseMinAnnotation(commentText) {
  return parseNumericAnnotation(commentText, "min");
}

function parseMaxAnnotation(commentText) {
  return parseNumericAnnotation(commentText, "max");
}

function unescapeAnnotationText(text) {
  return String(text ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\([\\'"`"])/g, "$1");
}

function parseTipAnnotation(commentText) {
  const text = String(commentText ?? "");
  const m = text.match(/@tip\b\s*(?:=|:)?\s*([^\r\n]*)/i);
  if (!m) return null;
  const raw = String(m[1] ?? "").trim();
  if (!raw) return "";

  if (raw.startsWith('"')) {
    const quoted = raw.match(/^"((?:\\.|[^"\\])*)"/);
    if (quoted) return unescapeAnnotationText(quoted[1]);
  } else if (raw.startsWith("'")) {
    const quoted = raw.match(/^'((?:\\.|[^'\\])*)'/);
    if (quoted) return unescapeAnnotationText(quoted[1]);
  }

  return raw.replace(/\s+@\w[\s\S]*$/i, "").trim();
}

function extractInlineCommentText(lineText) {
  const text = String(lineText ?? "");
  const i = text.indexOf("//");
  if (i < 0) return "";
  return text.slice(i + 2);
}

function extractStandaloneCommentText(lineText) {
  const m = String(lineText ?? "").match(/^\s*\/\/(.*)\s*$/);
  if (!m) return "";
  return String(m[1] ?? "");
}

function extractStatementAnnotationMeta(sourceText, statementIndex) {
  const text = String(sourceText ?? "");
  const idx = Math.max(0, Math.min(Number(statementIndex) || 0, text.length));

  const lineStartRaw = text.lastIndexOf("\n", idx);
  const lineStart = lineStartRaw === -1 ? 0 : lineStartRaw + 1;
  const lineEndRaw = text.indexOf("\n", idx);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  const lineText = text.slice(lineStart, lineEnd);
  const inlineCommentText = extractInlineCommentText(lineText);

  let previousCommentText = "";
  if (lineStart > 0) {
    const prevLineEnd = lineStart - 1;
    const prevLineStartRaw = text.lastIndexOf("\n", prevLineEnd - 1);
    const prevLineStart = prevLineStartRaw === -1 ? 0 : prevLineStartRaw + 1;
    const prevLineText = text.slice(prevLineStart, prevLineEnd);
    previousCommentText = extractStandaloneCommentText(prevLineText);
  }

  let order = parseOrderAnnotation(inlineCommentText);
  if (!Number.isFinite(order)) order = parseOrderAnnotation(previousCommentText);
  let tip = parseTipAnnotation(inlineCommentText);
  if (tip === null) tip = parseTipAnnotation(previousCommentText);
  let min = parseMinAnnotation(inlineCommentText);
  if (!Number.isFinite(min)) min = parseMinAnnotation(previousCommentText);
  let max = parseMaxAnnotation(inlineCommentText);
  if (!Number.isFinite(max)) max = parseMaxAnnotation(previousCommentText);

  return { order, tip, min, max };
}

function compareEditableVariableDisplayOrder(a, b) {
  const aRawOrder = a?.order;
  const bRawOrder = b?.order;
  const aOrder =
    aRawOrder === null || aRawOrder === undefined || aRawOrder === ""
      ? NaN
      : Number(aRawOrder);
  const bOrder =
    bRawOrder === null || bRawOrder === undefined || bRawOrder === ""
      ? NaN
      : Number(bRawOrder);
  const aHasOrder = Number.isFinite(aOrder);
  const bHasOrder = Number.isFinite(bOrder);
  if (aHasOrder && bHasOrder) {
    const byOrder = aOrder - bOrder;
    if (byOrder !== 0) return byOrder;
  } else if (aHasOrder !== bHasOrder) {
    return aHasOrder ? -1 : 1;
  }
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), undefined, {
    sensitivity: "base",
  });
}

function parseNumberList(rawValue) {
  let text = String(rawValue ?? "").trim();
  if (!text) return [];
  const ctor = text.match(/^(?:vec[234])\s*\(([\s\S]*)\)\s*$/i);
  if (ctor) text = String(ctor[1] ?? "").trim();
  const arrayMatch = text.match(/^\[\s*([\s\S]*)\s*\]$/);
  if (arrayMatch) text = String(arrayMatch[1] ?? "").trim();
  if (!text) return [];
  return text
    .split(",")
    .map((part) => Number(String(part ?? "").trim()))
    .filter((value) => Number.isFinite(value));
}

function normalizeUniformScalarValue(type, value, fallback = null) {
  if (type === "bool") {
    if (value === true || value === false) return value;
    const parsed = parseBooleanLiteral(value);
    if (parsed !== null) return parsed;
    if (Number.isFinite(Number(value))) return Number(value) !== 0;
    return fallback === null ? false : Boolean(fallback);
  }
  const n = Number(value);
  if (Number.isFinite(n)) return type === "int" ? Math.round(n) : n;
  if (fallback !== null && fallback !== undefined) {
    const fb = Number(fallback);
    if (Number.isFinite(fb)) return type === "int" ? Math.round(fb) : fb;
  }
  return type === "int" ? 0 : 0.0;
}

function normalizeUniformVectorValue(type, value, fallback = null) {
  const expected = type === "vec4" ? 4 : 3;
  let numbers = [];
  if (Array.isArray(value)) {
    numbers = value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  } else if (value && typeof value === "object") {
    const order = type === "vec4" ? ["x", "y", "z", "w"] : ["x", "y", "z"];
    numbers = order
      .map((key) => Number(value?.[key]))
      .filter((entry) => Number.isFinite(entry));
  } else {
    numbers = parseNumberList(value);
  }

  if (numbers.length < expected && fallback !== null && fallback !== undefined) {
    const fallbackNumbers = Array.isArray(fallback)
      ? fallback.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry))
      : parseNumberList(fallback);
    numbers = numbers.concat(fallbackNumbers.slice(numbers.length, expected));
  }
  while (numbers.length < expected) numbers.push(0);
  return numbers.slice(0, expected);
}

function extractEditableUniformVariables(source, uniformValues = null) {
  const text = String(source ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const values =
    uniformValues && typeof uniformValues === "object" && !Array.isArray(uniformValues)
      ? uniformValues
      : {};
  const extracted = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = String(lines[lineIndex] ?? "");
    const m = line.match(
      /^\s*uniform\s+(float|int|bool|vec3|vec4)\s+([A-Za-z_]\w*)\s*;\s*(?:\/\/(.*))?\s*$/i,
    );
    if (!m) continue;
    const type = String(m[1] ?? "").toLowerCase();
    const name = String(m[2] ?? "").trim();
    if (!type || !name) continue;

    const inlineComment = String(m[3] ?? "");
    const previousLine = lineIndex > 0 ? String(lines[lineIndex - 1] ?? "") : "";
    const previousCommentText = extractStandaloneCommentText(previousLine);
    let annotation = parseEditableAnnotation(inlineComment);
    let order = parseOrderAnnotation(inlineComment);
    let tip = parseTipAnnotation(inlineComment);
    let min = parseMinAnnotation(inlineComment);
    let max = parseMaxAnnotation(inlineComment);
    if (annotation === null) annotation = parseEditableAnnotation(previousCommentText);
    if (!Number.isFinite(order)) order = parseOrderAnnotation(previousCommentText);
    if (tip === null) tip = parseTipAnnotation(previousCommentText);
    if (!Number.isFinite(min)) min = parseMinAnnotation(previousCommentText);
    if (!Number.isFinite(max)) max = parseMaxAnnotation(previousCommentText);
    if (annotation === null) continue;

    const currentRaw = values[name];
    if (type === "vec3" || type === "vec4") {
      const defaultValue = parseNumberList(annotation);
      const normalized = normalizeUniformVectorValue(
        type,
        currentRaw,
        defaultValue.length ? defaultValue : null,
      );
      extracted.push({
        kind: "vector",
        declaration: "uniform",
        type,
        name,
        values: normalized,
        order,
        tip,
        min,
        max,
      });
      continue;
    }

    const defaultValue =
      type === "bool"
        ? parseBooleanLiteral(annotation)
        : (annotation ? Number(annotation) : null);
    extracted.push({
      kind: "scalar",
      declaration: "uniform",
      type,
      name,
      value: normalizeUniformScalarValue(type, currentRaw, defaultValue),
      order,
      tip,
      min,
      max,
    });
  }

  return extracted;
}

function formatBooleanLiteral(value) {
  return value ? "true" : "false";
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function isDefineUsedInPreprocessor(sourceText, defineName) {
  const escapedName = escapeRegExp(defineName);
  const re = new RegExp(
    `^[ \\t]*#\\s*(?:if|elif|ifdef|ifndef)\\b[^\\r\\n]*\\b${escapedName}\\b`,
    "m",
  );
  return re.test(String(sourceText ?? ""));
}

function buildEditableAnnotationValue(variable) {
  if (variable?.kind === "vector") {
    return (Array.isArray(variable?.values) ? variable.values : [])
      .map((value) => formatShaderVectorValue(value))
      .join(", ");
  }
  return formatShaderScalarValue(variable?.value, variable?.type);
}

function normalizeInjectableCandidate(input, index = 0) {
  if (!input || typeof input !== "object") return null;
  const declaration = String(input.declaration ?? "").trim().toLowerCase();
  const kind = String(input.kind ?? "").trim().toLowerCase();
  const type = String(input.type ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const start = Number(input.start);
  const end = Number(input.end);
  if (!name || !declaration || !kind || !type) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;

  const normalized = {
    id: String(input.id ?? `${declaration}:${type}:${name}:${start}:${index}`),
    declaration,
    kind,
    type,
    name,
    start,
    end,
  };

  if (kind === "vector") {
    const expected = type === "vec4" ? 4 : 3;
    const values = Array.isArray(input.values) ? input.values : [];
    normalized.values = values
      .slice(0, expected)
      .map((entry) => Number(entry))
      .map((entry) => (Number.isFinite(entry) ? entry : 0));
    while (normalized.values.length < expected) normalized.values.push(0);
  } else if (type === "bool") {
    normalized.value = Boolean(input.value);
  } else {
    const n = Number(input.value);
    normalized.value = Number.isFinite(n) ? n : 0;
  }
  return normalized;
}

function parseInjectableDefineExpression(rawExpr) {
  const text = String(rawExpr ?? "").trim();
  if (!text) return null;

  const vecMatch = text.match(/^(vec3|vec4)\s*\(([\s\S]*?)\)\s*$/);
  if (vecMatch) {
    const type = String(vecMatch[1]);
    const parts = String(vecMatch[2])
      .split(",")
      .map((part) => String(part ?? "").trim())
      .filter((part) => part.length > 0);
    const expected = type === "vec4" ? 4 : 3;
    if (parts.length !== expected) return null;
    const values = parts.map((part) => Number(part));
    if (!values.every((value) => Number.isFinite(value))) return null;
    return { kind: "vector", type, values };
  }

  const typedScalar = text.match(
    /^(float|int)\s*\(\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[-+]?\d+)\s*\)\s*$/,
  );
  if (typedScalar) {
    const type = String(typedScalar[1]);
    const value = Number(typedScalar[2]);
    if (!Number.isFinite(value)) return null;
    return { kind: "scalar", type, value };
  }

  const typedBool = text.match(/^bool\s*\(\s*(true|false|1|0)\s*\)\s*$/i);
  if (typedBool) {
    const value = parseBooleanLiteral(typedBool[1]);
    if (value === null) return null;
    return { kind: "scalar", type: "bool", value };
  }

  const plainBool = parseBooleanLiteral(text);
  if (plainBool !== null && /^(true|false)$/i.test(text)) {
    return { kind: "scalar", type: "bool", value: plainBool };
  }

  const plainScalar = text.match(/^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[-+]?\d+)\s*$/);
  if (plainScalar) {
    const rawNum = String(plainScalar[1]);
    const value = Number(rawNum);
    if (!Number.isFinite(value)) return null;
    const type = /[.eE]/.test(rawNum) ? "float" : "int";
    return { kind: "scalar", type, value };
  }

  return null;
}

export function formatShaderScalarValue(value, type) {
  if (type === "bool") return formatBooleanLiteral(Boolean(value));
  return formatScalarNumber(value, type);
}

export function formatShaderVectorValue(value) {
  return formatVectorNumber(value);
}

export function vecToHex(values) {
  const rgb = [0, 1, 2].map((idx) => {
    const v = Number(values?.[idx] ?? 0);
    const clamped = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    return Math.round(clamped * 255);
  });
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToVecRgb(hex) {
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

export function extractEditableShaderVariables(source, { uniformValues = null } = {}) {
  const text = String(source ?? "").replace(/\r\n/g, "\n");
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
    const { order, tip, min, max } = extractStatementAnnotationMeta(text, m.index);
    result.push({
      kind: "scalar",
      declaration: "const",
      type,
      name,
      value: Number(m[3]),
      order,
      tip,
      min,
      max,
    });
  }

  const boolConstRe =
    /const\s+bool\s+([A-Za-z_]\w*)\s*=\s*(true|false|1|0|bool\s*\(\s*(?:true|false|1|0)\s*\))\s*;/gi;
  while ((m = boolConstRe.exec(text))) {
    const name = String(m[1]);
    const parsed = parseBooleanLiteral(m[2]);
    if (parsed === null) continue;
    const key = `bool:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { order, tip, min, max } = extractStatementAnnotationMeta(text, m.index);
    result.push({
      kind: "scalar",
      declaration: "const",
      type: "bool",
      name,
      value: parsed,
      order,
      tip,
      min,
      max,
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
    const { order, tip, min, max } = extractStatementAnnotationMeta(text, m.index);
    result.push({
      kind: "vector",
      declaration: "const",
      type,
      name,
      values,
      order,
      tip,
      min,
      max,
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
      const { order, tip, min, max } = extractStatementAnnotationMeta(text, m.index);
      result.push({
        kind: "vector",
        declaration: "define",
        type,
        name,
        values,
        order,
        tip,
        min,
        max,
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
      const { order, tip, min, max } = extractStatementAnnotationMeta(text, m.index);
      result.push({
        kind: "scalar",
        declaration: "define",
        type,
        name,
        value,
        order,
        tip,
        min,
        max,
      });
      continue;
    }

    const typedBool = rawExpr.match(/^bool\s*\(\s*(true|false|1|0)\s*\)\s*$/i);
    if (typedBool) {
      const value = parseBooleanLiteral(typedBool[1]);
      if (value === null) continue;
      const key = `define:bool:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { order, tip, min, max } = extractStatementAnnotationMeta(text, m.index);
      result.push({
        kind: "scalar",
        declaration: "define",
        type: "bool",
        name,
        value,
        order,
        tip,
        min,
        max,
      });
      continue;
    }

    const plainBool = parseBooleanLiteral(rawExpr);
    if (plainBool !== null && /^(true|false)$/i.test(rawExpr)) {
      const key = `define:bool:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { order, tip, min, max } = extractStatementAnnotationMeta(text, m.index);
      result.push({
        kind: "scalar",
        declaration: "define",
        type: "bool",
        name,
        value: plainBool,
        order,
        tip,
        min,
        max,
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
      const { order, tip, min, max } = extractStatementAnnotationMeta(text, m.index);
      result.push({
        kind: "scalar",
        declaration: "define",
        type,
        name,
        value,
        order,
        tip,
        min,
        max,
      });
    }
  }

  for (const uniformVariable of extractEditableUniformVariables(text, uniformValues)) {
    const key = `uniform:${uniformVariable.type}:${uniformVariable.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(uniformVariable);
  }

  result.sort(compareEditableVariableDisplayOrder);
  return result;
}

export function compareShaderVariableDisplayOrder(a, b) {
  return compareEditableVariableDisplayOrder(a, b);
}

export function extractInjectableUniformCandidates(source) {
  const text = String(source ?? "");
  const candidates = [];

  const scalarConstRe =
    /^[ \t]*const[ \t]+(float|int)[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[-+]?\d+)[ \t]*;[ \t]*(?:\/\/[^\r\n]*)?/gm;
  let m;
  while ((m = scalarConstRe.exec(text))) {
    const value = Number(m[3]);
    if (!Number.isFinite(value)) continue;
    candidates.push({
      id: `const:${m[1]}:${m[2]}:${m.index}`,
      declaration: "const",
      kind: "scalar",
      type: String(m[1]),
      name: String(m[2]),
      value,
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  const boolConstRe =
    /^[ \t]*const[ \t]+bool[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*(true|false|1|0|bool\s*\(\s*(?:true|false|1|0)\s*\))[ \t]*;[ \t]*(?:\/\/[^\r\n]*)?/gim;
  while ((m = boolConstRe.exec(text))) {
    const parsed = parseBooleanLiteral(m[2]);
    if (parsed === null) continue;
    candidates.push({
      id: `const:bool:${m[1]}:${m.index}`,
      declaration: "const",
      kind: "scalar",
      type: "bool",
      name: String(m[1]),
      value: parsed,
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  const vecConstRe =
    /^[ \t]*const[ \t]+(vec3|vec4)[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*(vec3|vec4)[ \t]*\(\s*([^\)\r\n]+?)\s*\)[ \t]*;[ \t]*(?:\/\/[^\r\n]*)?/gm;
  while ((m = vecConstRe.exec(text))) {
    const type = String(m[1]);
    if (String(m[3]) !== type) continue;
    const expected = type === "vec4" ? 4 : 3;
    const values = String(m[4])
      .split(",")
      .map((part) => Number(String(part ?? "").trim()));
    if (values.length !== expected || !values.every((value) => Number.isFinite(value))) continue;
    candidates.push({
      id: `const:${type}:${m[2]}:${m.index}`,
      declaration: "const",
      kind: "vector",
      type,
      name: String(m[2]),
      values,
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  const defineRe = /^[ \t]*#define[ \t]+([A-Za-z_]\w*)[ \t]+([^\r\n]+)/gm;
  while ((m = defineRe.exec(text))) {
    const name = String(m[1] ?? "").trim();
    const rawExpr = String(m[2] ?? "").replace(/\/\/.*$/, "").trim();
    if (!name || !rawExpr) continue;

    const parsed = parseInjectableDefineExpression(rawExpr);
    if (!parsed) continue;

    const candidate = {
      id: `define:${parsed.type}:${name}:${m.index}`,
      declaration: "define",
      kind: parsed.kind,
      type: parsed.type,
      name,
      start: m.index,
      end: m.index + m[0].length,
    };

    if (parsed.kind === "vector") candidate.values = parsed.values;
    else candidate.value = parsed.value;

    if (isDefineUsedInPreprocessor(text, name)) {
      candidate.lockedReason =
        "Used in preprocessor condition (#if/#ifdef); cannot become a uniform.";
    }

    candidates.push(candidate);
  }

  candidates.sort((a, b) => {
    const byStart = Number(a.start ?? 0) - Number(b.start ?? 0);
    if (byStart !== 0) return byStart;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
      sensitivity: "base",
    });
  });

  return candidates;
}

export function injectSelectedVariablesAsUniforms(source, selectedCandidates = []) {
  const text = String(source ?? "");
  const normalized = (Array.isArray(selectedCandidates) ? selectedCandidates : [])
    .map((candidate, index) => normalizeInjectableCandidate(candidate, index))
    .filter((candidate) => candidate !== null)
    .sort((a, b) => Number(a.start) - Number(b.start));
  if (!normalized.length) {
    return { source: text, changed: false, converted: [] };
  }

  const replacements = [];
  let cursor = 0;
  let changed = false;
  const converted = [];

  for (const candidate of normalized) {
    if (candidate.start < cursor || candidate.end > text.length) continue;
    const original = text.slice(candidate.start, candidate.end);
    const indentMatch = original.match(/^[ \t]*/);
    const indent = indentMatch?.[0] ?? "";
    const editableValue = buildEditableAnnotationValue(candidate);
    const replacement = `${indent}uniform ${candidate.type} ${candidate.name}; // @editable ${editableValue}`;
    replacements.push(text.slice(cursor, candidate.start));
    replacements.push(replacement);
    cursor = candidate.end;
    changed = changed || replacement !== original;
    converted.push({
      ...candidate,
      editableValue,
    });
  }

  replacements.push(text.slice(cursor));
  const nextSource = replacements.join("");
  return {
    source: nextSource,
    changed: changed && nextSource !== text,
    converted,
  };
}

export function applyEditableShaderVariables(source, variables) {
  let next = String(source ?? "");
  for (const variable of Array.isArray(variables) ? variables : []) {
    const type = String(variable?.type ?? "").trim();
    const name = String(variable?.name ?? "").trim();
    const declaration = String(variable?.declaration ?? "const").trim();
    if (!type || !name) continue;
    if (declaration === "uniform") continue;
    const escapedName = escapeRegExp(name);

    if (variable?.kind === "scalar") {
      const valueText = formatShaderScalarValue(variable?.value, type);
      if (declaration === "define") {
        const re = new RegExp(
          `(^[ \\t]*#define[ \\t]+${escapedName}[ \\t]+)([^\\r\\n]*)(\\r?\\n|$)`,
          "m",
        );
        next = next.replace(re, `$1${valueText}$3`);
      } else {
        const re = new RegExp(
          `(const\\s+${type}\\s+${escapedName}\\s*=\\s*)([^;]+)(;)`,
        );
        next = next.replace(re, `$1${valueText}$3`);
      }
      continue;
    }

    if (variable?.kind === "vector") {
      const values = Array.isArray(variable?.values) ? variable.values : [];
      const expected = type === "vec4" ? 4 : 3;
      const clipped = values.slice(0, expected);
      while (clipped.length < expected) clipped.push(0);
      const valueText = `${type}(${clipped.map((v) => formatShaderVectorValue(v)).join(", ")})`;
      if (declaration === "define") {
        const re = new RegExp(
          `(^[ \\t]*#define[ \\t]+${escapedName}[ \\t]+)([^\\r\\n]*)(\\r?\\n|$)`,
          "m",
        );
        next = next.replace(re, `$1${valueText}$3`);
      } else {
        const re = new RegExp(
          `(const\\s+${type}\\s+${escapedName}\\s*=\\s*${type}\\s*\\()([\\s\\S]*?)(\\)\\s*;)`,
        );
        next = next.replace(
          re,
          `$1${clipped.map((v) => formatShaderVectorValue(v)).join(", ")}$3`,
        );
      }
    }
  }
  return next;
}
