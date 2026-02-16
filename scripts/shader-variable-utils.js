function parseBooleanLiteral(value) {
  let text = String(value ?? "").trim().toLowerCase();
  const ctor = text.match(/^bool\s*\(\s*(.*?)\s*\)$/);
  if (ctor) text = String(ctor[1] ?? "").trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
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

export function extractEditableShaderVariables(source) {
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

  const boolConstRe =
    /const\s+bool\s+([A-Za-z_]\w*)\s*=\s*(true|false|1|0|bool\s*\(\s*(?:true|false|1|0)\s*\))\s*;/gi;
  while ((m = boolConstRe.exec(text))) {
    const name = String(m[1]);
    const parsed = parseBooleanLiteral(m[2]);
    if (parsed === null) continue;
    const key = `bool:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      kind: "scalar",
      declaration: "const",
      type: "bool",
      name,
      value: parsed,
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

    const typedBool = rawExpr.match(/^bool\s*\(\s*(true|false|1|0)\s*\)\s*$/i);
    if (typedBool) {
      const value = parseBooleanLiteral(typedBool[1]);
      if (value === null) continue;
      const key = `define:bool:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        kind: "scalar",
        declaration: "define",
        type: "bool",
        name,
        value,
      });
      continue;
    }

    const plainBool = parseBooleanLiteral(rawExpr);
    if (plainBool !== null && /^(true|false)$/i.test(rawExpr)) {
      const key = `define:bool:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        kind: "scalar",
        declaration: "define",
        type: "bool",
        name,
        value: plainBool,
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

  result.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, {
      sensitivity: "base",
    }),
  );
  return result;
}

export function applyEditableShaderVariables(source, variables) {
  let next = String(source ?? "");
  for (const variable of Array.isArray(variables) ? variables : []) {
    const type = String(variable?.type ?? "").trim();
    const name = String(variable?.name ?? "").trim();
    const declaration = String(variable?.declaration ?? "const").trim();
    if (!type || !name) continue;
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
