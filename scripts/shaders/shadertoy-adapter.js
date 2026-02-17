const SHADERTOY_UNIFORM_NAMES = [
  "iResolution",
  "iTime",
  "iTimeDelta",
  "iFrame",
  "iFrameRate",
  "iChannel0",
  "iChannel1",
  "iChannel2",
  "iChannel3",
  "iChannelResolution",
  "iMouse",
  "iDate"
];
const SHADERTOY_LEGACY_UNIFORM_NAMES = ["resolution"];

function normalizeShaderSource(source) {
  let next = String(source ?? "").replace(/\r\n/g, "\n").trim();
  next = next.replace(/^\s*#version\s+.+$/gm, "");
  next = next.replace(/^\s*precision\s+\w+\s+float\s*;\s*$/gm, "");
  next = next.replace(/^\s*uniform\s+\w+\s+iChannelResolution\s*\[\s*4\s*\]\s*;\s*$/gm, "");

  for (const name of [...SHADERTOY_UNIFORM_NAMES, ...SHADERTOY_LEGACY_UNIFORM_NAMES]) {
    const re = new RegExp(
      `^\\s*uniform\\s+(?:(?:lowp|mediump|highp)\\s+)?\\w+\\s+${name}\\s*(?:\\[\\s*\\d+\\s*\\])?\\s*;\\s*$`,
      "gm"
    );
    next = next.replace(re, "");
  }

  return next.trim();
}

function injectKnownShaderToyDefines(source) {
  let next = String(source ?? "");

  // Some ShaderToy shaders rely on this platform macro in preprocessor branches.
  // Provide a conservative default when absent so #if expressions remain valid.
  if (
    /\bHW_PERFORMANCE\b/.test(next) &&
    !/^\s*#\s*define\s+HW_PERFORMANCE\b/m.test(next)
  ) {
    next = `#ifndef HW_PERFORMANCE
#define HW_PERFORMANCE 0
#endif
${next}`;
  }

  return next;
}

function coerceMainToMainImage(source) {
  let next = String(source ?? "");
  if (/void\s+mainImage\s*\(/.test(next)) return next;

  if (/void\s+main\s*\(\s*\)/.test(next)) {
    next = next.replace(/void\s+main\s*\(\s*\)/, "void mainImage(out vec4 fragColor, in vec2 fragCoord)");
    next = next.replace(/\bgl_FragColor\b/g, "fragColor");
    next = next.replace(/\bgl_FragCoord\s*\.xy\b/g, "fragCoord");
    next = next.replace(/\bgl_FragCoord\b/g, "vec4(fragCoord, 0.0, 1.0)");
  }
  return next;
}

function rewriteVectorTernaryComparisons(source) {
  const looksVectorLike = (expr) => {
    const value = String(expr ?? "").trim();
    if (!value) return false;
    if (/\b(?:[biu]?vec[234])\s*\(/.test(value)) return true;
    if (/\.[xyzwrgba]{2,4}\b/.test(value)) return true;
    return false;
  };

  const vectorTernaryRe =
    /\(\s*((?:[^()?:;]|\([^()]*\))+?)\s*(==|!=)\s*((?:[^()?:;]|\([^()]*\))+?)\s*\)\s*\?/g;
  return String(source ?? "").replace(
    vectorTernaryRe,
    (full, lhsRaw, op, rhsRaw) => {
      const lhs = String(lhsRaw ?? "").trim();
      const rhs = String(rhsRaw ?? "").trim();
      if (!lhs || !rhs) return full;
      if (!looksVectorLike(lhs) && !looksVectorLike(rhs)) return full;
      const condition =
        op === "=="
          ? `all(equal(${lhs}, ${rhs}))`
          : `any(notEqual(${lhs}, ${rhs}))`;
      return `(${condition}) ?`;
    },
  );
}

function rewriteSelfAssignTernaryToIf(source) {
  // Some ShaderToy ports use:
  //   v = (cond) ? v = expr : v;
  // ANGLE can be finicky around nested assignment in conditional expressions.
  // Rewrite to:
  //   if (cond) v = expr;
  const re =
    /([A-Za-z_]\w*)\s*=\s*\(([^?;]+)\)\s*\?\s*\1\s*=\s*([^:;]+?)\s*:\s*\1\s*;/g;
  return String(source ?? "").replace(re, (_full, varName, condRaw, valueRaw) => {
    const cond = String(condRaw ?? "").trim();
    const value = String(valueRaw ?? "").trim();
    if (!cond || !value) return _full;
    return `if (${cond}) ${varName} = ${value};`;
  });
}

function rewriteFloatStepLoopsToCountedLoops(source) {
  let next = String(source ?? "");

  const evalNumericExpression = (expr, constants) => {
    const raw = String(expr ?? "").trim();
    if (!raw) return NaN;
    if (/[^0-9eE+\-*/().,\sA-Za-z_]/.test(raw)) return NaN;

    const substituted = raw.replace(/\b([A-Za-z_]\w*)\b/g, (_full, name) => {
      if (constants.has(name)) return `(${constants.get(name)})`;
      if (name === "float" || name === "int") return "";
      return "NaN";
    });

    try {
      const value = Function(`"use strict"; return (${substituted});`)();
      return Number(value);
    } catch (_err) {
      return NaN;
    }
  };

  const constants = new Map();
  const declRe = /^\s*(?:const\s+)?(?:float|int)\s+([A-Za-z_]\w*)\s*=\s*([^;]+)\s*;\s*(?:(?:\/\/.*)|(?:\/\*.*\*\/\s*))?$/gm;
  for (let pass = 0; pass < 4; pass += 1) {
    let learned = false;
    declRe.lastIndex = 0;
    let m;
    while ((m = declRe.exec(next)) !== null) {
      const name = m[1];
      if (constants.has(name)) continue;
      const value = evalNumericExpression(m[2], constants);
      if (!Number.isFinite(value)) continue;
      constants.set(name, value);
      learned = true;
    }
    if (!learned) break;
  }

  let rewriteIndex = 0;
  const computeLoopIterations = (init, bound, step, cmpOp) => {
    if (!Number.isFinite(init) || !Number.isFinite(bound) || !Number.isFinite(step) || step === 0) {
      return NaN;
    }

    let iters = NaN;
    if (cmpOp === "<") {
      if (step <= 0) return NaN;
      iters = Math.ceil((bound - init) / step - 1e-8);
    } else if (cmpOp === "<=") {
      if (step <= 0) return NaN;
      iters = Math.floor((bound - init) / step + 1e-8) + 1;
    } else if (cmpOp === ">") {
      if (step >= 0) return NaN;
      iters = Math.ceil((init - bound) / (-step) - 1e-8);
    } else if (cmpOp === ">=") {
      if (step >= 0) return NaN;
      iters = Math.floor((init - bound) / (-step) + 1e-8) + 1;
    } else {
      return NaN;
    }

    if (!Number.isFinite(iters)) return NaN;
    return Math.max(0, iters);
  };

  const floatForRe = /for\s*\(\s*float\s+([A-Za-z_]\w*)\s*=\s*([^;]+)\s*;\s*\1\s*(<=|<)\s*([^;]+)\s*;\s*\1\s*\+=\s*([^)]+)\)\s*\{/g;
  next = next.replace(floatForRe, (full, loopVar, initExpr, cmpOp, boundExpr, stepExpr) => {
    const init = evalNumericExpression(initExpr, constants);
    const bound = evalNumericExpression(boundExpr, constants);
    const step = evalNumericExpression(stepExpr, constants);
    const iters = computeLoopIterations(init, bound, step, cmpOp);
    if (!Number.isFinite(iters) || iters <= 0 || iters > 8192) return full;

    const iterVar = `cpfxForStep${rewriteIndex++}`;
    return `for(int ${iterVar}=0; ${iterVar}<${iters}; ++${iterVar}){\n  float ${loopVar} = (${String(initExpr).trim()}) + float(${iterVar})*(${String(stepExpr).trim()});`;
  });

  const floatIncForRe = /for\s*\(\s*float\s+([A-Za-z_]\w*)\s*=\s*([^;]+)\s*;\s*\1\s*(<=|<|>=|>)\s*([^;]+)\s*;\s*(\+\+\s*\1|\1\s*\+\+|--\s*\1|\1\s*--)\s*\)\s*\{/g;
  next = next.replace(floatIncForRe, (full, loopVar, initExpr, cmpOp, boundExpr, incExpr) => {
    const init = evalNumericExpression(initExpr, constants);
    const bound = evalNumericExpression(boundExpr, constants);
    const step = String(incExpr).includes("--") ? -1 : 1;
    const iters = computeLoopIterations(init, bound, step, cmpOp);
    if (!Number.isFinite(iters) || iters <= 0 || iters > 8192) return full;

    const iterVar = `cpfxForStep${rewriteIndex++}`;
    return `for(int ${iterVar}=0; ${iterVar}<${iters}; ++${iterVar}){\n  float ${loopVar} = (${String(initExpr).trim()}) + float(${iterVar})*(${step}.0);`;
  });

  // Some GLSL ES compilers reject an empty increment expression in a for-loop.
  const floatNoIncForRe = /for\s*\(\s*float\s+([A-Za-z_]\w*)\s*=\s*([^;]+)\s*;\s*\1\s*(<=|<|>=|>)\s*([^;]+)\s*;\s*\)\s*\{/g;
  next = next.replace(
    floatNoIncForRe,
    (_full, loopVar, initExpr, cmpOp, boundExpr) =>
      `for(float ${loopVar} = ${String(initExpr).trim()}; ${loopVar} ${cmpOp} ${String(boundExpr).trim()}; ${loopVar} += 0.0){`,
  );

  return next;
}
function rewriteTopLevelRedeclaredLocals(source) {
  let next = String(source ?? "");

  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const findMatchingBrace = (value, openIndex) => {
    let depth = 0;
    for (let i = openIndex; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  };

  const getBraceDepth = (value, endExclusive) => {
    let depth = 0;
    for (let i = 0; i < endExclusive; i += 1) {
      const ch = value[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    return depth;
  };

  const rewriteFunctionBody = (body) => {
    let result = String(body ?? "");
    // Avoid unsafe renames across preprocessor branches (#if/#else) where only one declaration exists at runtime.
    if (/^\s*#\s*(?:if|ifdef|ifndef|elif|else|endif)\b/m.test(result)) return result;
    let renamedCount = 0;
    const seen = new Set();
    const declRe = /(^|;)\s*((?:const\s+)?(?:(?:lowp|mediump|highp)\s+)?(?:float|int|bool|vec[234]|mat[234])\s+)([A-Za-z_]\w*)(?=\s*(?:[=;,\[]))/gm;

    const buildCodeMask = (value) => {
      const chars = String(value ?? "").split("");
      let inLine = false;
      let inBlock = false;
      let inSingle = false;
      let inDouble = false;

      for (let i = 0; i < chars.length; i += 1) {
        const ch = chars[i];
        const next = chars[i + 1];

        if (inLine) {
          if (ch === "\n") {
            inLine = false;
          } else {
            chars[i] = " ";
          }
          continue;
        }

        if (inBlock) {
          if (ch === "*" && next === "/") {
            chars[i] = " ";
            chars[i + 1] = " ";
            inBlock = false;
            i += 1;
          } else if (ch !== "\n") {
            chars[i] = " ";
          }
          continue;
        }

        if (inSingle) {
          if (ch === "\\") {
            if (ch !== "\n") chars[i] = " ";
            if (i + 1 < chars.length && chars[i + 1] !== "\n") chars[i + 1] = " ";
            i += 1;
            continue;
          }
          if (ch === "'") {
            chars[i] = " ";
            inSingle = false;
            continue;
          }
          if (ch !== "\n") chars[i] = " ";
          continue;
        }

        if (inDouble) {
          if (ch === "\\") {
            if (ch !== "\n") chars[i] = " ";
            if (i + 1 < chars.length && chars[i + 1] !== "\n") chars[i + 1] = " ";
            i += 1;
            continue;
          }
          if (ch === '"') {
            chars[i] = " ";
            inDouble = false;
            continue;
          }
          if (ch !== "\n") chars[i] = " ";
          continue;
        }

        if (ch === "/" && next === "/") {
          chars[i] = " ";
          chars[i + 1] = " ";
          inLine = true;
          i += 1;
          continue;
        }

        if (ch === "/" && next === "*") {
          chars[i] = " ";
          chars[i + 1] = " ";
          inBlock = true;
          i += 1;
          continue;
        }

        if (ch === "'") {
          chars[i] = " ";
          inSingle = true;
          continue;
        }

        if (ch === '"') {
          chars[i] = " ";
          inDouble = true;
          continue;
        }
      }

      return chars.join("");
    };

    const replaceNameInCodeTail = (sourceText, codeMask, fromIndex, fromName, toName) => {
      const tailSource = sourceText.slice(fromIndex);
      const tailMask = codeMask.slice(fromIndex);
      const re = new RegExp(`\\b${escapeRegex(fromName)}\\b`, "g");

      let srcOut = sourceText.slice(0, fromIndex);
      let maskOut = codeMask.slice(0, fromIndex);
      let last = 0;
      let m;
      while ((m = re.exec(tailMask)) !== null) {
        const s = m.index;
        const e = s + fromName.length;
        srcOut += tailSource.slice(last, s) + toName;
        maskOut += tailMask.slice(last, s) + toName;
        last = e;
      }

      srcOut += tailSource.slice(last);
      maskOut += tailMask.slice(last);
      return { source: srcOut, mask: maskOut };
    };

    let scanText = buildCodeMask(result);
    let scanIndex = 0;
    while (true) {
      declRe.lastIndex = scanIndex;
      const match = declRe.exec(scanText);
      if (!match) break;

      const depth = getBraceDepth(scanText, match.index);
      if (depth !== 0) {
        scanIndex = declRe.lastIndex;
        continue;
      }

      const name = match[3];
      if (!seen.has(name)) {
        seen.add(name);
        scanIndex = declRe.lastIndex;
        continue;
      }

      const newName = `${name}_cpfx${renamedCount++}`;
      const nameStart = match.index + String(match[0] ?? "").lastIndexOf(name);
      result = `${result.slice(0, nameStart)}${newName}${result.slice(nameStart + name.length)}`;
      scanText = `${scanText.slice(0, nameStart)}${newName}${scanText.slice(nameStart + name.length)}`;

      const replaceFrom = nameStart + newName.length;
      const replaced = replaceNameInCodeTail(
        result,
        scanText,
        replaceFrom,
        name,
        newName,
      );
      result = replaced.source;
      scanText = replaced.mask;
      scanIndex = replaceFrom;
    }

    return result;
  };

  const functionHeadRe = /\b(?:void|float|int|bool|vec[234]|mat[234])\s+[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{/g;
  const ranges = [];
  let fnMatch;
  while ((fnMatch = functionHeadRe.exec(next)) !== null) {
    const open = next.indexOf("{", fnMatch.index);
    if (open < 0) continue;
    const close = findMatchingBrace(next, open);
    if (close < 0) continue;
    ranges.push({ open, close });
    functionHeadRe.lastIndex = close + 1;
  }

  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    const { open, close } = ranges[i];
    const body = next.slice(open + 1, close);
    const rewrittenBody = rewriteFunctionBody(body);
    if (rewrittenBody !== body) {
      next = `${next.slice(0, open + 1)}${rewrittenBody}${next.slice(close)}`;
    }
  }

  return next;
}
function applyCompatibilityRewrites(source) {
  const commentBlocks = [];
  const maskComments = (value) => {
    const text = String(value ?? "");
    let out = "";
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      const nextCh = text[i + 1];
      if (ch === "/" && nextCh === "/") {
        const start = i;
        i += 2;
        while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i += 1;
        const token = `/*__CPFX_COMMENT_${commentBlocks.length}__*/`;
        commentBlocks.push(text.slice(start, i));
        out += token;
        continue;
      }
      if (ch === "/" && nextCh === "*") {
        const start = i;
        i += 2;
        while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
        if (i + 1 < text.length) i += 2;
        else i = text.length;
        const token = `/*__CPFX_COMMENT_${commentBlocks.length}__*/`;
        commentBlocks.push(text.slice(start, i));
        out += token;
        continue;
      }
      out += ch;
      i += 1;
    }
    return out;
  };
  const unmaskComments = (value) =>
    String(value ?? "").replace(/\/\*__CPFX_COMMENT_(\d+)__\*\//g, (_full, idx) =>
      commentBlocks[Number(idx)] ?? "",
    );

  let next = maskComments(String(source ?? ""));
  next = rewriteFloatStepLoopsToCountedLoops(next);
  next = rewriteTopLevelRedeclaredLocals(next);

  // Common ShaderToy trick in ES3 shaders:
  //   #define ZERO min(iFrame,0)
  //   for (int i=ZERO; i<N; i++) ...
  // GLSL ES 1.00 requires loop init to be compile-time constant.
  next = next.replace(
    /^\s*#\s*define\s+ZERO\s+([^\n]+)$/gm,
    (full, expr) => {
      const rhs = String(expr ?? "").trim();
      if (/^0(?:\.0+)?$/.test(rhs)) return full;
      if (/\biFrame\b|\biTime\b|\biMouse\b|\bmin\s*\(|\bmax\s*\(|\bcpfx_min\s*\(|\bcpfx_max\s*\(/.test(rhs)) {
        return "#define ZERO 0";
      }
      return full;
    },
  );
  next = next.replace(
    /for\s*\(\s*int\s+([A-Za-z_]\w*)\s*=\s*\(?\s*ZERO\s*\)?\s*;/g,
    "for(int $1=0;",
  );

  // Some shaders use alternate macro names like NON_CONST_ZERO in loop init.
  // If such macro resolves from runtime values, clamp it to 0 for GLSL ES 1.00.
  const loopInitMacroNames = new Set();
  next.replace(
    /for\s*\(\s*int\s+[A-Za-z_]\w*\s*=\s*\(?\s*([A-Za-z_]\w*)\s*\)?\s*;/g,
    (_full, macroName) => {
      if (macroName && macroName !== "ZERO") loopInitMacroNames.add(String(macroName));
      return _full;
    },
  );
  for (const macroName of loopInitMacroNames) {
    const defineRe = new RegExp(
      `^\\s*#\\s*define\\s+${macroName}\\s+([^\\n]+)$`,
      "gm",
    );
    next = next.replace(defineRe, (full, expr) => {
      const rhs = String(expr ?? "").trim();
      if (/^[-+]?\d+(?:\.\d+)?$/.test(rhs)) return full;
      if (
        /\biFrame\b|\biTime\b|\biMouse\b|\bmin\s*\(|\bmax\s*\(|\bcpfx_min\s*\(|\bcpfx_max\s*\(/.test(
          rhs,
        )
      ) {
        return `#define ${macroName} 0`;
      }
      return full;
    });
    const loopStartRe = new RegExp(
      `for\\s*\\(\\s*int\\s+([A-Za-z_]\\w*)\\s*=\\s*\\(?\\s*${macroName}\\s*\\)?\\s*;`,
      "g",
    );
    next = next.replace(loopStartRe, "for(int $1=0;");
  }
  // Direct non-constant init expression in integer loops.
  next = next.replace(
    /for\s*\(\s*int\s+([A-Za-z_]\w*)\s*=\s*([^;]*?(?:\biFrame\b|\biTime\b|\biMouse\b)[^;]*?)\s*;/g,
    "for(int $1=0;",
  );

  // Do not transform preprocessor lines/macros. Rewrites that inject
  // multi-line loop bodies break #define function macros (for example,
  // DECL_FBM_FUNC(...) with an inline for-loop body).
  const preprocessorBlocks = [];
  const maskPreprocessorBlocks = (value) => {
    const lines = String(value ?? "").split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*#/.test(line)) {
        const block = [line];
        while (/[\\]\s*$/.test(block[block.length - 1]) && i + 1 < lines.length) {
          i += 1;
          block.push(lines[i]);
        }
        const token = `__CPFX_PP_BLOCK_${preprocessorBlocks.length}__`;
        preprocessorBlocks.push(block.join("\n"));
        out.push(token);
        continue;
      }
      out.push(line);
    }
    return out.join("\n");
  };
  const unmaskPreprocessorBlocks = (value) =>
    String(value ?? "").replace(/__CPFX_PP_BLOCK_(\d+)__/g, (_full, idx) =>
      preprocessorBlocks[Number(idx)] ?? "",
    );

  next = maskPreprocessorBlocks(next);
  next = rewriteVectorTernaryComparisons(next);
  next = rewriteSelfAssignTernaryToIf(next);

  // GLSL ES 1.00 accepts mat2/mat3/mat4 but not mat2x2/mat3x3/mat4x4 aliases.
  next = next.replace(/\bmat([234])x\1\b/g, "mat$1");

  // GLSL ES 1.00 does not support float literal suffixes (for example, 1.0f).
  // Normalize these to plain numeric literals.
  next = next.replace(
    /(\b\d+(?:\.\d*)?|\B\.\d+)([eE][+-]?\d+)?[fF]\b/g,
    "$1$2",
  );

  // GLSL ES 1.00 has no unsigned scalar/vector types or literal suffixes.
  // Normalize common ES3 forms into signed equivalents.
  next = next.replace(/\buvec([234])\b/g, "ivec$1");
  next = next.replace(/\buint\b/g, "int");
  next = next.replace(
    /(\b(?:0x[0-9A-Fa-f]+|\d+))[uU]\b/g,
    "$1",
  );
  // GLSL ES 1.00 has no floatBitsToUint/uint families.
  // Route floatBitsToUint to a deterministic compatibility helper.
  next = next.replace(/\bfloatBitsToUint\s*\(/g, "cpfx_floatBitsToUint(");
  // Common hash normalization literal in ES3 shaders.
  next = next.replace(/\bfloat\s*\(\s*0x[fF]{8}\s*\)/g, "4294967295.0");

  // Common Twigl shorthand in some ShaderToy ports.
  // Rewritten to ANGLE/WebGL-friendly canonical loop form.
  let loopRewriteIndex = 0;
  const twiglLoopRe = /for\s*\(\s*O\s*\*=\s*i\s*;\s*i\s*<\s*([0-9]*\.?[0-9]+|[0-9]+\.)\s*;\s*i\s*\+=\s*([0-9]*\.?[0-9]+|[0-9]+\.)\s*\)\s*\{/g;
  next = next.replace(twiglLoopRe, (_full, maxRaw, stepRaw) => {
    const maxV = Number(maxRaw);
    const stepV = Number(stepRaw);
    if (!Number.isFinite(maxV) || !Number.isFinite(stepV) || stepV <= 0) {
      return "for(i=0.0; i<1.0; i+=0.01){";
    }
    const iters = Math.max(1, Math.ceil(maxV / stepV));
    const iterVar = `cpfxLoop${loopRewriteIndex++}`;
    return `O*=0.0;\nfor(int ${iterVar}=0; ${iterVar}<${iters}; ++${iterVar}){\n  i=float(${iterVar})*${stepV};`;
  });

  // Compact loop style used by some one-liner shaders:
  // for(float a=..., t=..., i; ++i<19.; o+=expr) statement;
  // ANGLE rejects this; rewrite to a canonical counted loop.
  const splitTopLevel = (value, delimiter) => {
    const out = [];
    let chunk = "";
    let depth = 0;
    for (let idx = 0; idx < value.length; idx += 1) {
      const ch = value[idx];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      if (ch === delimiter && depth === 0) {
        out.push(chunk.trim());
        chunk = "";
      } else {
        chunk += ch;
      }
    }
    if (chunk.trim()) out.push(chunk.trim());
    return out;
  };
  const splitTopLevelKeepEmpty = (value, delimiter) => {
    const out = [];
    let chunk = "";
    let depth = 0;
    for (let idx = 0; idx < value.length; idx += 1) {
      const ch = value[idx];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      if (ch === delimiter && depth === 0) {
        out.push(chunk.trim());
        chunk = "";
      } else {
        chunk += ch;
      }
    }
    out.push(chunk.trim());
    return out;
  };

  const stripInlineComments = (value) =>
    String(value ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n\r]*/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const findMatchingParen = (value, openIndex) => {
    let depth = 0;
    for (let idx = openIndex; idx < value.length; idx += 1) {
      const ch = value[idx];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) return idx;
      }
    }
    return -1;
  };

  const findMatchingBrace = (value, openIndex) => {
    let depth = 0;
    for (let idx = openIndex; idx < value.length; idx += 1) {
      const ch = value[idx];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return idx;
      }
    }
    return -1;
  };

  const findStatementEnd = (value, startIndex) => {
    let depth = 0;
    for (let idx = startIndex; idx < value.length; idx += 1) {
      const ch = value[idx];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      if (ch === ";" && depth === 0) return idx;
    }
    return -1;
  };

  let compactLoopRewriteIndex = 0;
  const compactForHeadRe = /for\s*\(\s*float\s+/g;
  while (true) {
    const m = compactForHeadRe.exec(next);
    if (!m) break;

    const forStart = m.index;
    const openParen = next.indexOf("(", forStart);
    if (openParen < 0) break;

    const closeParen = findMatchingParen(next, openParen);
    if (closeParen < 0) {
      compactForHeadRe.lastIndex = forStart + 4;
      continue;
    }

    const headerInside = next.slice(openParen + 1, closeParen).replace(/^\s*float\s+/, "");
    const headerParts = splitTopLevel(headerInside, ";");
    if (headerParts.length !== 3) {
      compactForHeadRe.lastIndex = closeParen + 1;
      continue;
    }

    const conditionMatch = headerParts[1].match(/^\s*\+\+\s*([A-Za-z_]\w*)\s*<\s*([0-9]*\.?[0-9]+|[0-9]+\.)\s*$/);
    if (!conditionMatch) {
      compactForHeadRe.lastIndex = closeParen + 1;
      continue;
    }

    const loopVar = conditionMatch[1];
    const maxV = Number(conditionMatch[2]);
    if (!Number.isFinite(maxV) || maxV <= 0) {
      compactForHeadRe.lastIndex = closeParen + 1;
      continue;
    }

    let stmtStart = closeParen + 1;
    while (stmtStart < next.length && /\s/.test(next[stmtStart])) stmtStart += 1;
    if (stmtStart >= next.length || next[stmtStart] === "{") {
      compactForHeadRe.lastIndex = closeParen + 1;
      continue;
    }

    const stmtEnd = findStatementEnd(next, stmtStart);
    if (stmtEnd < 0) {
      compactForHeadRe.lastIndex = closeParen + 1;
      continue;
    }

    const bodyExpr = next.slice(stmtStart, stmtEnd).trim();
    const stepExpr = headerParts[2].trim();

    const initParts = splitTopLevel(headerParts[0], ",");
    if (!initParts.length) {
      compactForHeadRe.lastIndex = stmtEnd + 1;
      continue;
    }

    const rebuiltParts = [];
    let foundLoopVar = false;
    for (const part of initParts) {
      const trimmed = part.trim();
      const varMatch = trimmed.match(/^([A-Za-z_]\w*)(\s*=\s*.+)?$/);
      if (!varMatch) {
        rebuiltParts.push(trimmed);
        continue;
      }

      const varName = varMatch[1];
      if (varName !== loopVar) {
        rebuiltParts.push(trimmed);
        continue;
      }

      foundLoopVar = true;
      if (varMatch[2]) rebuiltParts.push(trimmed);
      else rebuiltParts.push(`${varName}=0.0`);
    }

    if (!foundLoopVar) rebuiltParts.push(`${loopVar}=0.0`);

    const iterVar = `cpfxCompactLoop${compactLoopRewriteIndex++}`;
    const iters = Math.max(1, Math.ceil(maxV));
    const replacement = `float ${rebuiltParts.join(", ")};\nfor(int ${iterVar}=0; ${iterVar}<${iters}; ++${iterVar}){\n  ${loopVar} += 1.0;\n  ${bodyExpr};\n  ${stepExpr};\n}`;

    next = `${next.slice(0, forStart)}${replacement}${next.slice(stmtEnd + 1)}`;
    compactForHeadRe.lastIndex = forStart + replacement.length;
  }

  // GLSL ES 1.00/ANGLE can reject post-increment index writes in the step clause,
  // for example: for(int i; i<3; O[i++] = expr) body;
  // Normalize to a canonical loop body + ++i step.
  const postIndexedStepRe = /for\s*\(/g;
  while (true) {
    const m = postIndexedStepRe.exec(next);
    if (!m) break;

    const forStart = m.index;
    const openParen = next.indexOf("(", forStart);
    if (openParen < 0) break;
    const closeParen = findMatchingParen(next, openParen);
    if (closeParen < 0) {
      postIndexedStepRe.lastIndex = forStart + 4;
      continue;
    }

    const headerInside = next.slice(openParen + 1, closeParen);
    const headerParts = splitTopLevelKeepEmpty(headerInside, ";");
    if (headerParts.length !== 3) {
      postIndexedStepRe.lastIndex = closeParen + 1;
      continue;
    }

    const initPartRaw = String(headerParts[0] ?? "").trim();
    const condPartRaw = String(headerParts[1] ?? "").trim();
    const stepPartRaw = String(headerParts[2] ?? "").trim();
    const initPart = stripInlineComments(initPartRaw);
    const condPart = stripInlineComments(condPartRaw);
    const stepPart = stripInlineComments(stepPartRaw);

    const initMatch = initPart.match(/^int\s+([A-Za-z_]\w*)(?:\s*=\s*([\s\S]+))?$/);
    if (!initMatch || !condPart || !stepPart) {
      postIndexedStepRe.lastIndex = closeParen + 1;
      continue;
    }
    const loopVar = initMatch[1];
    const initExpr = String(initMatch[2] ?? "0").trim() || "0";

    const stepMatch = stepPart.match(/^([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\+\+\s*\]\s*=\s*([\s\S]+)$/);
    if (!stepMatch || stepMatch[2] !== loopVar) {
      postIndexedStepRe.lastIndex = closeParen + 1;
      continue;
    }
    const assignTarget = stepMatch[1];
    const assignExpr = String(stepMatch[3] ?? "").trim();
    if (!assignExpr) {
      postIndexedStepRe.lastIndex = closeParen + 1;
      continue;
    }

    let stmtStart = closeParen + 1;
    while (stmtStart < next.length && /\s/.test(next[stmtStart])) stmtStart += 1;
    if (stmtStart >= next.length) break;

    let body = "";
    let sliceEnd = stmtStart;
    if (next[stmtStart] === "{") {
      const stmtClose = findMatchingBrace(next, stmtStart);
      if (stmtClose < 0) {
        postIndexedStepRe.lastIndex = closeParen + 1;
        continue;
      }
      body = next.slice(stmtStart + 1, stmtClose).trim();
      sliceEnd = stmtClose + 1;
    } else {
      const stmtEnd = findStatementEnd(next, stmtStart);
      if (stmtEnd < 0) {
        postIndexedStepRe.lastIndex = closeParen + 1;
        continue;
      }
      body = next.slice(stmtStart, stmtEnd + 1).trim();
      sliceEnd = stmtEnd + 1;
    }

    const replacement = `for(int ${loopVar}=${initExpr}; ${condPart}; ++${loopVar}){\n  ${body}\n  ${assignTarget}[${loopVar}] = ${assignExpr};\n}`;
    next = `${next.slice(0, forStart)}${replacement}${next.slice(sliceEnd)}`;
    postIndexedStepRe.lastIndex = forStart + replacement.length;
  }

  // ANGLE/WebGL1 can also reject statement-form indexed post-increment writes:
  //   p[i++] = expr;
  // Rewrite as:
  //   p[i] = expr;
  //   i += 1;
  next = next.replace(
    /([A-Za-z_]\w*(?:\s*\[[^\]]+\])?)\s*\[\s*([A-Za-z_]\w*)\s*\+\+\s*\]\s*=\s*([^;]+);/g,
    (_full, target, idx, expr) =>
      `${String(target).trim()}[${String(idx).trim()}] = ${String(expr).trim()}; ${String(idx).trim()} += 1;`,
  );

  // ANGLE/WebGL1 can reject non-loop-symbol array indexing in writes like:
  //   arr[i] = expr; i += 1;
  // when i is not the active loop index. If the array has a known static size,
  // lower to constant-index branches.
  const staticArraySizes = new Map();
  next.replace(
    /\b(?:const\s+)?(?:(?:lowp|mediump|highp)\s+)?(?:float|int|vec[234]|ivec[234]|uvec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]\s*;/g,
    (_full, name, sizeRaw) => {
      const size = Number(sizeRaw);
      if (Number.isFinite(size) && size > 0 && size <= 64) {
        staticArraySizes.set(String(name), size);
      }
      return _full;
    },
  );
  next = next.replace(
    /\b([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\]\s*=\s*([^;]+);\s*\2\s*\+=\s*1\s*;/g,
    (full, arrNameRaw, idxRaw, exprRaw) => {
      const arrName = String(arrNameRaw ?? "").trim();
      const idx = String(idxRaw ?? "").trim();
      const expr = String(exprRaw ?? "").trim();
      const size = staticArraySizes.get(arrName);
      if (!size || !idx || !expr) return full;
      let out = "";
      for (let n = 0; n < size; n += 1) {
        out += `${n === 0 ? "if" : "else if"} (${idx} == ${n}) ${arrName}[${n}] = ${expr}; `;
      }
      out += `${idx} += 1;`;
      return out;
    },
  );

  // GLSL ES 1.00 is strict about loop form. Shaders sometimes use:
  // for( ; condition ; step ) statement-or-block;
  // for( initExpr ; condition ; ) statement-or-block;
  // Rewrite non-declaration loop headers to bounded canonical loops and
  // evaluate the original condition at the top of each iteration so side
  // effects are preserved.
  let emptyForRewriteIndex = 0;
  const emptyForHeadRe = /for\s*\(/g;
  while (true) {
    const m = emptyForHeadRe.exec(next);
    if (!m) break;

    const forStart = m.index;
    const openParen = next.indexOf("(", forStart);
    if (openParen < 0) break;

    const closeParen = findMatchingParen(next, openParen);
    if (closeParen < 0) {
      emptyForHeadRe.lastIndex = forStart + 4;
      continue;
    }

    const headerInside = next.slice(openParen + 1, closeParen);
    const headerParts = splitTopLevelKeepEmpty(headerInside, ";");
    if (headerParts.length !== 3) {
      emptyForHeadRe.lastIndex = closeParen + 1;
      continue;
    }

    const initPart = String(headerParts[0] ?? "").trim();
    const condPart = String(headerParts[1] ?? "").trim();
    const stepPart = String(headerParts[2] ?? "").trim();
    const initExpr = stripInlineComments(initPart);
    const condExpr = stripInlineComments(condPart);
    const stepExpr = stripInlineComments(stepPart);
    if (condExpr === "") {
      emptyForHeadRe.lastIndex = closeParen + 1;
      continue;
    }
    const initHasDeclaration = /^(?:const\s+)?(?:(?:lowp|mediump|highp)\s+)?(?:int|float|bool|vec[234]|ivec[234]|uvec[234]|mat[234])\b/.test(initExpr);
    if (initHasDeclaration) {
      emptyForHeadRe.lastIndex = closeParen + 1;
      continue;
    }
    // Only target non-declaration headers. Declaration loops are handled by
    // dedicated rewrites later in the pipeline.
    if (initPart === "" && stepPart === "") {
      // handled by same generic replacement below
    }

    let stmtStart = closeParen + 1;
    while (stmtStart < next.length && /\s/.test(next[stmtStart])) stmtStart += 1;
    if (stmtStart >= next.length) break;

    let body = "";
    let sliceEnd = stmtStart;
    if (next[stmtStart] === "{") {
      const stmtClose = findMatchingBrace(next, stmtStart);
      if (stmtClose < 0) {
        emptyForHeadRe.lastIndex = closeParen + 1;
        continue;
      }
      body = next.slice(stmtStart + 1, stmtClose).trim();
      sliceEnd = stmtClose + 1;
    } else {
      const stmtEnd = findStatementEnd(next, stmtStart);
      if (stmtEnd < 0) {
        emptyForHeadRe.lastIndex = closeParen + 1;
        continue;
      }
      body = next.slice(stmtStart, stmtEnd + 1).trim();
      sliceEnd = stmtEnd + 1;
    }

    const iterVar = `cpfxEmptyLoop${emptyForRewriteIndex++}`;
    const initStmt = initExpr ? `${initExpr};\n` : "";
    const stepStmt = stepExpr ? `\n  ${stepExpr};` : "";
    const replacement = `${initStmt}for(int ${iterVar}=0; ${iterVar}<1024; ++${iterVar}){\n  if (!(${condExpr})) break;\n  ${body}${stepStmt}\n}`;
    next = `${next.slice(0, forStart)}${replacement}${next.slice(sliceEnd)}`;
    // Rescan from this location so nested non-declaration for-loops in the
    // rewritten body are normalized too.
    emptyForHeadRe.lastIndex = forStart;
  }

  // GLSL ES 1.00 in this runtime rejects while-loops.
  // Rewrite while(cond) body; into a bounded canonical for-loop.
  let whileRewriteIndex = 0;
  const whileHeadRe = /\bwhile\s*\(/g;
  while (true) {
    const m = whileHeadRe.exec(next);
    if (!m) break;

    const whileStart = m.index;
    const openParen = next.indexOf("(", whileStart);
    if (openParen < 0) break;
    const closeParen = findMatchingParen(next, openParen);
    if (closeParen < 0) {
      whileHeadRe.lastIndex = whileStart + 5;
      continue;
    }

    const condPart = String(next.slice(openParen + 1, closeParen) ?? "").trim();
    const condExpr = stripInlineComments(condPart);
    if (!condExpr) {
      whileHeadRe.lastIndex = closeParen + 1;
      continue;
    }

    let stmtStart = closeParen + 1;
    while (stmtStart < next.length && /\s/.test(next[stmtStart])) stmtStart += 1;
    if (stmtStart >= next.length) break;

    let body = "";
    let sliceEnd = stmtStart;
    if (next[stmtStart] === "{") {
      const stmtClose = findMatchingBrace(next, stmtStart);
      if (stmtClose < 0) {
        whileHeadRe.lastIndex = closeParen + 1;
        continue;
      }
      body = next.slice(stmtStart + 1, stmtClose).trim();
      sliceEnd = stmtClose + 1;
    } else {
      const stmtEnd = findStatementEnd(next, stmtStart);
      if (stmtEnd < 0) {
        whileHeadRe.lastIndex = closeParen + 1;
        continue;
      }
      body = next.slice(stmtStart, stmtEnd + 1).trim();
      sliceEnd = stmtEnd + 1;
    }

    const iterVar = `cpfxWhileLoop${whileRewriteIndex++}`;
    const replacement = `for(int ${iterVar}=0; ${iterVar}<1024; ++${iterVar}){\n  if (!(${condExpr})) break;\n  ${body}\n}`;
    next = `${next.slice(0, whileStart)}${replacement}${next.slice(sliceEnd)}`;
    // Rescan from this location so nested while-loops inside the rewritten
    // body are also normalized in subsequent iterations.
    whileHeadRe.lastIndex = whileStart;
  }

  // Some sources declare a loop index without initializer, which WebGL1 parsers
  // often reject even though desktop GLSL accepts it.
  next = next.replace(
    /for\s*\(\s*int\s+([A-Za-z_]\w*)\s*;\s*/g,
    "for(int $1=0; ",
  );
  next = next.replace(
    /for\s*\(\s*int\s+([A-Za-z_]\w*)\s*(?:(?:\/\/[^\n\r]*[\n\r]\s*)|(?:\/\*[\s\S]*?\*\/\s*))*;\s*/g,
    "for(int $1=0; ",
  );
  next = next.replace(
    /for\s*\(\s*float\s+([A-Za-z_]\w*)\s*;\s*/g,
    "for(float $1=0.0; ",
  );
  next = next.replace(
    /for\s*\(\s*float\s+([A-Za-z_]\w*)\s*(?:(?:\/\/[^\n\r]*[\n\r]\s*)|(?:\/\*[\s\S]*?\*\/\s*))*;\s*/g,
    "for(float $1=0.0; ",
  );

  // GLSL ES 1.00 rejects conditions like:
  // for(int i=0; i<128 && t<tmax; i++)
  // Rewrite to canonical loop with an early break.
  next = next.replace(
    /for\s*\(\s*int\s+([A-Za-z_]\w*)\s*=\s*([^;]+)\s*;\s*\1\s*(<=|<)\s*([^;&)]+?)\s*&&\s*([^;]+?)\s*;\s*(\+\+\s*\1|--\s*\1|\1\s*\+\+|\1\s*--|\1\s*\+=\s*[^)]+|\1\s*-\=\s*[^)]+)\s*\)\s*\{/g,
    (_full, loopVar, initExpr, cmpOp, boundExpr, extraCond, stepExpr) =>
      `for(int ${loopVar}=${String(initExpr).trim()}; ${loopVar}${cmpOp}${String(boundExpr).trim()}; ${String(stepExpr).trim()}){\n  if (!(${String(extraCond).trim()})) break;`,
  );

  // GLSL ES 1.00 also rejects dynamic-bound index loops like:
  // for(int i=0; i<samples; i++) { ... }
  // Rewrite to a constant-count loop and compute i per-iteration.
  const constScalarNames = new Set();
  next.replace(
    /^\s*const\s+(?:(?:lowp|mediump|highp)\s+)?(?:int|float|uint)\s+([A-Za-z_]\w*)\s*=/gm,
    (_full, name) => {
      if (name) constScalarNames.add(String(name));
      return _full;
    },
  );
  const isConstExpr = (value) => {
    const expr = String(value ?? "").trim();
    if (!expr) return false;
    if (/[A-Za-z_]\w*\s*\(/.test(expr)) return false; // function-like call
    const ids = expr.match(/[A-Za-z_]\w*/g) ?? [];
    if (!ids.length) return true;
    return ids.every((id) => constScalarNames.has(id));
  };
  let dynLoopRewriteIndex = 0;
  next = next.replace(
    /for\s*\(\s*int\s+([A-Za-z_]\w*)\s*=\s*([^;]+)\s*;\s*\1\s*(<=|<|>=|>)\s*([^;]+?)\s*;\s*(\+\+\s*\1|--\s*\1|\1\s*\+\+|\1\s*--|\1\s*\+=\s*[^)]+|\1\s*-\=\s*[^)]+)\s*\)\s*\{/g,
    (full, loopVar, initExpr, cmpOp, boundExpr, stepExpr) => {
      const initTrim = String(initExpr ?? "").trim();
      const boundTrim = String(boundExpr ?? "").trim();
      const stepTrim = String(stepExpr ?? "").replace(/\s+/g, "");

      // Preserve truly static loops (numeric bound and numeric init).
      const looksNumeric = (value) => /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value ?? "").trim());
      if (looksNumeric(initTrim) && looksNumeric(boundTrim)) return full;
      // Preserve loops where init/bound are compile-time constants.
      if (isConstExpr(initTrim) && isConstExpr(boundTrim)) return full;

      // Uppercase-only symbols are often compile-time macros/constants; leave them.
      if (!/[a-z]/.test(initTrim) && !/[a-z]/.test(boundTrim)) return full;

      const iterVar = `cpfxDynLoop${dynLoopRewriteIndex++}`;
      const maxIters = 1024;
      let iExpr = `int(${initTrim}) + ${iterVar}`;
      if (stepTrim === `++${loopVar}` || stepTrim === `${loopVar}++`) {
        iExpr = `int(${initTrim}) + ${iterVar}`;
      } else if (stepTrim === `--${loopVar}` || stepTrim === `${loopVar}--`) {
        iExpr = `int(${initTrim}) - ${iterVar}`;
      } else if (stepTrim.startsWith(`${loopVar}+=`)) {
        const stepVal = stepTrim.slice((`${loopVar}+=`).length).trim() || "1";
        iExpr = `int(${initTrim}) + ${iterVar}*int(${stepVal})`;
      } else if (stepTrim.startsWith(`${loopVar}-=`)) {
        const stepVal = stepTrim.slice((`${loopVar}-=`).length).trim() || "1";
        iExpr = `int(${initTrim}) - ${iterVar}*int(${stepVal})`;
      }

      return `for(int ${iterVar}=0; ${iterVar}<${maxIters}; ++${iterVar}){\n  int ${loopVar} = ${iExpr};\n  if (!(${loopVar} ${cmpOp} ${boundTrim})) break;`;
    },
  );

  // GLSL ES 1.00 does not support ES3-style array constructors, for example:
  // const vec2 hp[7] = vec2[7](...);
  // float periods[8] = float[8](...);
  // int ids[8] = int[]( ... );
  // Also, some imported shaders build static lookup tables with:
  // vec3 v[20]; v[0]=...; v[1]=...; ...
  // Rewrite read-only static tables to helper functions and indexed calls.
  let arrayRewriteIndex = 0;
  let arrayHelpers = "";
  const rewrittenArrays = [];
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reservedCaptureNames = new Set([
    "if", "else", "for", "while", "do", "break", "continue", "return", "discard",
    "const", "uniform", "varying", "attribute", "in", "out", "inout",
    "true", "false", "int", "float", "bool", "vec2", "vec3", "vec4",
    "ivec2", "ivec3", "ivec4", "bvec2", "bvec3", "bvec4",
    "mat2", "mat3", "mat4", "sampler2D", "samplerCube",
    "gl_FragCoord", "gl_FragColor", "gl_Position", "gl_PointCoord",
    "iResolution", "iTime", "iTimeDelta", "iFrame", "iFrameRate",
    "iChannel0", "iChannel1", "iChannel2", "iChannel3", "iChannelResolution",
    "iMouse", "iDate", "uTime", "resolution", "intensity",
  ]);
  const inferIdentifierType = (name, sourceText) => {
    const re = new RegExp(
      String.raw`(?:^|[;{}(]\s*)(?:const\s+)?(?:(?:lowp|mediump|highp)\s+)?(float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4)\s+${escapeRegex(name)}\b`,
      "g",
    );
    let out = null;
    let m;
    while ((m = re.exec(String(sourceText ?? ""))) !== null) {
      out = String(m[1] ?? "").trim() || out;
    }
    return out || "float";
  };
  const collectCapturedIdentifiers = (values, sourceText) => {
    const joined = String(values?.join("\n") ?? "");
    const out = [];
    const seen = new Set();
    const idRe = /[A-Za-z_]\w*/g;
    let m;
    while ((m = idRe.exec(joined)) !== null) {
      const name = String(m[0] ?? "").trim();
      if (!name || reservedCaptureNames.has(name) || seen.has(name)) continue;
      let prev = m.index - 1;
      while (prev >= 0 && /\s/.test(joined[prev])) prev -= 1;
      if (prev >= 0 && joined[prev] === ".") continue; // swizzle/member access
      let nextIdx = m.index + name.length;
      while (nextIdx < joined.length && /\s/.test(joined[nextIdx])) nextIdx += 1;
      if (nextIdx < joined.length && joined[nextIdx] === "(") continue; // function call
      seen.add(name);
      out.push({ name, type: inferIdentifierType(name, sourceText) });
    }
    return out;
  };
  const isIndexWriteRange = (idx, ranges) =>
    ranges.some((r) => idx >= r.start && idx < r.end);
  const hasBareArrayUseOutsideRanges = (text, arrayName, ignoreRanges = []) => {
    const sourceText = String(text ?? "");
    const nameRe = new RegExp(`\\b${escapeRegex(arrayName)}\\b`, "g");
    let m;
    while ((m = nameRe.exec(sourceText)) !== null) {
      const idx = m.index;
      if (isIndexWriteRange(idx, ignoreRanges)) continue;
      let nextIdx = idx + String(arrayName).length;
      while (nextIdx < sourceText.length && /\s/.test(sourceText[nextIdx])) nextIdx += 1;
      if (nextIdx < sourceText.length && sourceText[nextIdx] === "[") continue;
      return true;
    }
    return false;
  };
  const hasDynamicWritesOutsideRanges = (text, arrayName, ignoreRanges = []) => {
    const writeRe = new RegExp(
      `\\b${escapeRegex(arrayName)}\\s*\\[\\s*[^\\]]+\\s*\\]\\s*(?:=|\\+=|-=|\\*=|/=|%=|\\+\\+|--)`,
      "g",
    );
    let m;
    while ((m = writeRe.exec(text)) !== null) {
      const idx = m.index;
      if (isIndexWriteRange(idx, ignoreRanges)) continue;
      return true;
    }
    return false;
  };
  const buildArrayHelper = (valueType, values, captures = []) => {
    const helperName = `cpfx_arr_${valueType}_${arrayRewriteIndex++}`;
    const params = [
      "int idx",
      ...captures.map((c) => `${String(c?.type ?? "float")} ${String(c?.name ?? "").trim()}`),
    ]
      .filter((v) => String(v ?? "").trim().length > 0)
      .join(", ");
    let helper = `${valueType} ${helperName}(${params}){\n`;
    for (let i = 0; i < values.length; i += 1) {
      helper += `  if (idx == ${i}) return ${values[i]};\n`;
    }
    helper += `  return ${values[values.length - 1]};\n}\n`;
    return { helperName, helper };
  };
  const arrayCtorRe =
    /\b(?:const\s+)?(?:(?:lowp|mediump|highp)\s+)?(float|int|vec2|vec3|vec4)\s*(?:\[\s*(\d+)\s*\])?\s+([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?\s*=\s*\1\s*\[\s*(\d*)\s*\]\s*\(([\s\S]*?)\)\s*;/g;
  next = next.replace(
    arrayCtorRe,
    (
      full,
      valueTypeRaw,
      typeCountRaw,
      arrayNameRaw,
      nameCountRaw,
      ctorCountRaw,
      initRaw,
      offsetRaw,
    ) => {
      const valueType = String(valueTypeRaw ?? "").trim();
      const arrayName = String(arrayNameRaw ?? "").trim();
      const typeCount = Number(typeCountRaw);
      const nameCount = Number(nameCountRaw);
      const ctorCount = Number(ctorCountRaw);
      const explicitCount =
        Number.isFinite(typeCount) && typeCount > 0
          ? typeCount
          : Number.isFinite(nameCount) && nameCount > 0
            ? nameCount
            : ctorCount;
      if (!arrayName || !valueType) return full;
      const offset = Number(offsetRaw);
      const declStart = Number.isFinite(offset) ? offset : -1;
      const declEnd = declStart >= 0 ? declStart + String(full).length : -1;
      const ignoreRanges = declStart >= 0 && declEnd >= 0 ? [{ start: declStart, end: declEnd }] : [];
      if (hasDynamicWritesOutsideRanges(next, arrayName, ignoreRanges)) return full;
      if (hasBareArrayUseOutsideRanges(next, arrayName, ignoreRanges)) return full;

      const rawValues = splitTopLevel(String(initRaw ?? ""), ",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      let count = Number.isFinite(explicitCount) && explicitCount > 0
        ? explicitCount
        : rawValues.length;
      if (!Number.isFinite(count) || count <= 0) return full;
      const values = rawValues.slice(0, count);
      if (values.length < count) return full;
      const captures = collectCapturedIdentifiers(values, next);

      const built = buildArrayHelper(valueType, values, captures);
      const helperName = built.helperName;
      const helper = built.helper;
      arrayHelpers += helper;
      rewrittenArrays.push({ name: arrayName, helperName, captures });
      return "";
    },
  );

  // Static local table declarations initialized by constant-index writes:
  //   vec3 v[20];
  //   v[0]=...; v[1]=...; ... v[19]=...;
  // Rewrite these read-only tables to helper functions as well.
  const staticDeclRe =
    /\b(?:(?:lowp|mediump|highp)\s+)?(float|int|vec2|vec3|vec4)\s+([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]\s*;/g;
  const rangesToDelete = [];
  let declMatch;
  while ((declMatch = staticDeclRe.exec(next)) !== null) {
    const valueType = String(declMatch[1] ?? "").trim();
    const arrayName = String(declMatch[2] ?? "").trim();
    const size = Number(declMatch[3]);
    const declStart = Number(declMatch.index);
    const declText = String(declMatch[0] ?? "");
    const declEnd = declStart + declText.length;
    if (!arrayName || !valueType || !Number.isFinite(size) || size <= 0 || size > 256) continue;
    if (rewrittenArrays.some((entry) => entry.name === arrayName)) continue;

    const assignRe = new RegExp(
      `\\b${escapeRegex(arrayName)}\\s*\\[\\s*(\\d+)\\s*\\]\\s*=\\s*([^;]+);`,
      "g",
    );
    const values = new Array(size);
    const assignmentRanges = [];
    let assignMatch;
    while ((assignMatch = assignRe.exec(next)) !== null) {
      const idx = Number(assignMatch[1]);
      if (!Number.isFinite(idx) || idx < 0 || idx >= size) continue;
      if (values[idx] !== undefined) continue;
      values[idx] = String(assignMatch[2] ?? "").trim();
      assignmentRanges.push({
        start: assignMatch.index,
        end: assignMatch.index + String(assignMatch[0] ?? "").length,
      });
    }
    if (values.some((v) => typeof v !== "string" || v.length === 0)) continue;
    if (assignmentRanges.length < size) continue;

    const ignoreRanges = [{ start: declStart, end: declEnd }, ...assignmentRanges];
    if (hasDynamicWritesOutsideRanges(next, arrayName, ignoreRanges)) continue;
    if (hasBareArrayUseOutsideRanges(next, arrayName, ignoreRanges)) continue;
    const captures = collectCapturedIdentifiers(values, next);

    const built = buildArrayHelper(valueType, values, captures);
    arrayHelpers += built.helper;
    rewrittenArrays.push({ name: arrayName, helperName: built.helperName, captures });
    rangesToDelete.push({ start: declStart, end: declEnd }, ...assignmentRanges);
  }

  if (rangesToDelete.length > 0) {
    rangesToDelete.sort((a, b) => b.start - a.start);
    for (const range of rangesToDelete) {
      next = `${next.slice(0, range.start)}${next.slice(range.end)}`;
    }
  }

  if (rewrittenArrays.length > 0) {
    for (const entry of rewrittenArrays) {
      const idxRe = new RegExp(`\\b${entry.name}\\s*\\[\\s*([^\\]]+)\\s*\\]`, "g");
      const captureArgs = Array.isArray(entry?.captures)
        ? entry.captures
            .map((c) => String(c?.name ?? "").trim())
            .filter((v) => v.length > 0)
        : [];
      const argTail = captureArgs.length > 0 ? `, ${captureArgs.join(", ")}` : "";
      next = next.replace(idxRe, `${entry.helperName}(int($1)${argTail})`);
    }
    next = `${arrayHelpers}\n${next}`;
  }
  // WebGL1/GLSL ES 1.00 often lacks these vector intrinsics; route through compatibility overloads.
  next = next.replace(/\btanh\s*\(/g, "cpfx_tanh(");
  next = next.replace(/\bsinh\s*\(/g, "cpfx_sinh(");
  next = next.replace(/\bcosh\s*\(/g, "cpfx_cosh(");
  next = next.replace(/\bround\s*\(/g, "cpfx_round(");

  // textureLod is commonly used in ShaderToy WebGL2 shaders.
  next = next.replace(/\btextureLod\s*\(/g, "cpfx_textureLod(");
  // textureGrad is GLSL ES 3.00; map to compatibility wrapper in ES 1.00.
  next = next.replace(/\btextureGrad\s*\(/g, "cpfx_textureGrad(");

  // Route direct iChannelN samples through channel-aware wrappers so vec3 sampling
  // can distinguish cubemap-style lookup vs volume-atlas lookup per channel.
  for (let channelIndex = 0; channelIndex <= 3; channelIndex += 1) {
    const textureCompatRe = new RegExp(
      `\\btextureCompat\\s*\\(\\s*iChannel${channelIndex}\\s*,`,
      "g",
    );
    const textureRe = new RegExp(
      `\\btexture\\s*\\(\\s*iChannel${channelIndex}\\s*,`,
      "g",
    );
    const textureLodRe = new RegExp(
      `\\bcpfx_textureLod\\s*\\(\\s*iChannel${channelIndex}\\s*,`,
      "g",
    );
    const textureGradRe = new RegExp(
      `\\bcpfx_textureGrad\\s*\\(\\s*iChannel${channelIndex}\\s*,`,
      "g",
    );
    next = next.replace(textureCompatRe, `cpfx_textureCh${channelIndex}(`);
    next = next.replace(textureRe, `cpfx_textureCh${channelIndex}(`);
    next = next.replace(textureLodRe, `cpfx_textureLodCh${channelIndex}(`);
    next = next.replace(textureGradRe, `cpfx_textureGradCh${channelIndex}(`);
  }

  // GLSL ES 1.00 lacks transpose(); route through compatibility overloads.
  next = next.replace(/\btranspose\s*\(/g, "cpfx_transpose(");

  // Derivatives are extension-gated in GLSL ES 1.00; route through wrappers.
  next = next.replace(/\bdFdx\s*\(/g, "cpfx_dFdx(");
  next = next.replace(/\bdFdy\s*\(/g, "cpfx_dFdy(");

  // Route min/max through mixed-type-safe wrappers.
  next = next.replace(/\bmin\s*\(/g, "cpfx_min(");
  next = next.replace(/\bmax\s*\(/g, "cpfx_max(");

  // GLSL ES 1.00 is strict about scalar comparison types.
  // iFrame is provided as float; normalize common int-literal comparisons.
  next = next.replace(
    /\biFrame\s*(==|!=|<=|>=|<|>)\s*([+-]?\d+)(?![\d.])/g,
    (_full, op, rhs) => `iFrame ${op} ${rhs}.0`,
  );
  next = next.replace(
    /([+-]?\d+)(?![\d.])\s*(==|!=|<=|>=|<|>)\s*iFrame\b/g,
    (_full, lhs, op) => `${lhs}.0 ${op} iFrame`,
  );

  // GLSL ES 1.00 has no bitwise operators. Rewrite common patterns.
  const foldBinaryOps = (input, regex, replacement) => {
    let out = String(input ?? "");
    while (true) {
      const prev = out;
      out = out.replace(regex, replacement);
      if (out === prev) break;
    }
    return out;
  };
  // Handle nested pattern like (((i+3)>>1)&1) before generic binary rewrites.
  const nestedShiftAndRe =
    /\(\s*\(\s*([A-Za-z0-9_+\-*/\s.]+?)\s*>>\s*([A-Za-z0-9_+\-*/\s.]+?)\s*\)\s*&\s*([A-Za-z0-9_+\-*/\s.]+?)\s*\)/g;
  next = next.replace(
    nestedShiftAndRe,
    "cpfx_bitand(cpfx_shr($1, $2), $3)",
  );

  const identifierAtom = String.raw`[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?(?:\s*\[\s*[^][]+\s*\])?`;
  const parenAtom = String.raw`\((?:[^()]|\([^()]*\))*\)`;
  const atom = String.raw`(?:${identifierAtom}\s*\([^()]*\)|${identifierAtom}|[+-]?\d+(?:\.\d+)?|${parenAtom})`;
  const shrRe = new RegExp(`(${atom})\\s*>>\\s*(${atom})`, "g");
  const andRe = new RegExp(`(${atom})\\s*&\\s*(${atom})`, "g");
  const xorRe = new RegExp(`(${atom})\\s*\\^\\s*(${atom})`, "g");
  const modRe = new RegExp(`(${atom})\\s*%\\s*(${atom})`, "g");
  next = foldBinaryOps(next, shrRe, "cpfx_shr($1, $2)");
  next = foldBinaryOps(next, andRe, "cpfx_bitand($1, $2)");
  next = foldBinaryOps(next, xorRe, "cpfx_bitxor($1, $2)");
  next = foldBinaryOps(next, modRe, "cpfx_mod($1, $2)");
  // Catch residual forms like ((cpfx_shr((i+3),1))&1).
  next = next.replace(
    /\(\s*\(\s*(cpfx_shr\s*\([^;]+?\))\s*\)\s*&\s*([A-Za-z0-9_+\-*/\s.]+?)\s*\)/g,
    "cpfx_bitand($1, $2)",
  );
  next = next.replace(
    /\(\s*(cpfx_shr\s*\([^;]+?\))\s*&\s*([A-Za-z0-9_+\-*/\s.]+?)\s*\)/g,
    "cpfx_bitand($1, $2)",
  );

  // texelFetch is GLSL ES 3.00; remap common ShaderToy channel fetches.
  next = next.replace(
    /\btexelFetch\s*\(\s*iChannel([0-3])\s*,/g,
    "cpfx_texelFetch(iChannel$1, $1,"
  );
  // textureSize is GLSL ES 3.00; remap channel lookups.
  next = next.replace(
    /\btextureSize\s*\(\s*iChannel([0-3])\s*,/g,
    "cpfx_textureSize(iChannel$1, $1,"
  );

  // GLSL ES 1.00 has no mat4x3; rewrite common multiplication form.
  const mat4x3MulRe = /mat4x3\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)\s*\*\s*(\([^;\n]+\)|[A-Za-z_]\w*)/g;
  next = next.replace(mat4x3MulRe, "cpfx_mul_mat4x3_vec4($1, $2, $3, $4, $5)");

  // Targeted fix for OpenSimplex common code pattern that writes vec3 by dynamic index.
  next = next.replace(
    /\bcuboct\s*\[\s*int\s*\(\s*([^)]+)\s*\)\s*\]\s*=\s*([^;]+);/g,
    "cuboct = cpfx_set_vec3_component(cuboct, int($1), $2);"
  );

  next = unmaskPreprocessorBlocks(next);
  next = unmaskComments(next);
  return next;
}

function buildCompatMacroPreamble(source) {
  const text = String(source ?? "");
  const hasDefine = (name) => new RegExp(`^\\s*#\\s*define\\s+${name}\\b`, "m").test(text);
  const blocks = [];
  const addMacro = (name, value) => {
    if (hasDefine(name)) return;
    blocks.push(`#ifndef ${name}\n#define ${name}${value}\n#endif`);
  };

  addMacro("_in", "(T) const T");
  addMacro("_inout", "(T) inout T");
  addMacro("_out", "(T) out T");
  addMacro("_begin", "(type) type(");
  addMacro("_end", " )");
  addMacro("_mutable", "(T) T");
  addMacro("_constant", "(T) const T");
  if (!hasDefine("mul")) {
    blocks.push("#ifndef mul\n#define mul(a, b) ((a) * (b))\n#endif");
  }

  return blocks.length ? `\n${blocks.join("\n")}\n` : "\n";
}

function buildChannelSamplingHelpers() {
  const shared = `
float cpfx_channelType(int idx) {
  return idx == 0 ? cpfxChannelType0 :
    (idx == 1 ? cpfxChannelType1 :
      (idx == 2 ? cpfxChannelType2 : cpfxChannelType3));
}
vec3 cpfx_volumeLayout(int idx) {
  return idx == 0 ? cpfxVolumeLayout0 :
    (idx == 1 ? cpfxVolumeLayout1 :
      (idx == 2 ? cpfxVolumeLayout2 : cpfxVolumeLayout3));
}
vec2 cpfx_channelResolution(int idx) {
  return idx == 0 ? iChannelResolution[0].xy :
    (idx == 1 ? iChannelResolution[1].xy :
      (idx == 2 ? iChannelResolution[2].xy : iChannelResolution[3].xy));
}

vec4 cpfx_sampleVolumeAtlas(sampler2D s, vec3 uvw, int idx) {
  vec3 layout = cpfx_volumeLayout(idx);
  vec2 atlasRes = max(cpfx_channelResolution(idx), vec2(1.0));
  float tilesX = max(1.0, floor(layout.x + 0.5));
  float tilesY = max(1.0, floor(layout.y + 0.5));
  float depth = max(1.0, floor(layout.z + 0.5));

  vec2 tileSize = vec2(1.0 / tilesX, 1.0 / tilesY);
  vec2 inset = 0.5 / atlasRes;
  vec2 inner = max(tileSize - 2.0 * inset, vec2(1e-6));
  vec2 xy = fract(uvw.xy);
  float z = clamp(uvw.z, 0.0, 1.0) * (depth - 1.0);
  float z0 = floor(z);
  float z1 = min(z0 + 1.0, depth - 1.0);
  float f = fract(z);

  vec2 tile0 = vec2(mod(z0, tilesX), floor(z0 / tilesX));
  vec2 tile1 = vec2(mod(z1, tilesX), floor(z1 / tilesX));
  vec2 uv0 = tile0 * tileSize + inset + xy * inner;
  vec2 uv1 = tile1 * tileSize + inset + xy * inner;
  return mix(texture2D(s, uv0), texture2D(s, uv1), f);
}
`;

  const channelFns = [];
  for (let idx = 0; idx <= 3; idx += 1) {
    channelFns.push(`
vec4 cpfx_textureCh${idx}(vec2 uv) { return textureCompat(iChannel${idx}, uv); }
vec4 cpfx_textureCh${idx}(vec2 uv, float bias) { return cpfx_textureCh${idx}(uv); }
vec4 cpfx_textureCh${idx}(vec3 v) {
  float t = cpfx_channelType(${idx});
  if (t > 1.5) return cpfx_sampleVolumeAtlas(iChannel${idx}, v, ${idx});
  if (t > 0.5) return textureCompat(iChannel${idx}, v);
  return textureCompat(iChannel${idx}, v.xy);
}
vec4 cpfx_textureCh${idx}(vec3 v, float bias) { return cpfx_textureCh${idx}(v); }
vec4 cpfx_textureLodCh${idx}(vec2 uv, float lod) { return cpfx_textureCh${idx}(uv); }
vec4 cpfx_textureLodCh${idx}(vec3 v, float lod) { return cpfx_textureCh${idx}(v); }
vec4 cpfx_textureGradCh${idx}(vec2 uv, vec2 dPdx, vec2 dPdy) { return cpfx_textureCh${idx}(uv); }
vec4 cpfx_textureGradCh${idx}(vec3 v, vec3 dPdx, vec3 dPdy) { return cpfx_textureCh${idx}(v); }
`);
  }

  return `${shared}\n${channelFns.join("\n")}`;
}

export function validateShaderToySource(source) {
  const normalized = injectKnownShaderToyDefines(
    coerceMainToMainImage(normalizeShaderSource(source)),
  );
  if (!normalized) {
    throw new Error("Shader source is empty.");
  }
  if (!/void\s+mainImage\s*\(/.test(normalized)) {
    throw new Error("Shader import requires void mainImage(...) or void main().");
  }
  return normalized;
}

export function extractReferencedChannels(source) {
  const normalized = applyCompatibilityRewrites(validateShaderToySource(source));
  const found = new Set();
  const re = /\biChannel([0-3])\b/g;
  let match;
  while ((match = re.exec(normalized)) !== null) {
    found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

export function adaptShaderToyFragment(source) {
  const body = applyCompatibilityRewrites(validateShaderToySource(source));
  const compatMacros = buildCompatMacroPreamble(body);
  return `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec4 iMouse;
uniform float uTime;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrame;
uniform float iFrameRate;
uniform vec4 iDate;
uniform vec3 iChannelResolution[4];
uniform vec3 iResolution;
uniform float cpfxChannelType0;
uniform float cpfxChannelType1;
uniform float cpfxChannelType2;
uniform float cpfxChannelType3;
uniform vec3 cpfxVolumeLayout0;
uniform vec3 cpfxVolumeLayout1;
uniform vec3 cpfxVolumeLayout2;
uniform vec3 cpfxVolumeLayout3;
uniform float debugMode;
uniform float intensity;
uniform float shaderScale;
uniform vec2 shaderScaleXY;
uniform float shaderRotation;
uniform float shaderFlipX;
uniform float shaderFlipY;
uniform float cpfxPreserveTransparent;
uniform float cpfxForceOpaqueCaptureAlpha;
uniform vec2 resolution;
${compatMacros}

vec2 cpfxFragCoord;
#define gl_FragCoord vec4(cpfxFragCoord, 0.0, 1.0)

const float cpfx_PI = 3.14159265359;

vec2 cpfx_rotate(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float cpfx_sinh(float x) {
  return 0.5 * (exp(x) - exp(-x));
}
vec2 cpfx_sinh(vec2 x) {
  return 0.5 * (exp(x) - exp(-x));
}
vec3 cpfx_sinh(vec3 x) {
  return 0.5 * (exp(x) - exp(-x));
}
vec4 cpfx_sinh(vec4 x) {
  return 0.5 * (exp(x) - exp(-x));
}

float cpfx_cosh(float x) {
  return 0.5 * (exp(x) + exp(-x));
}
vec2 cpfx_cosh(vec2 x) {
  return 0.5 * (exp(x) + exp(-x));
}
vec3 cpfx_cosh(vec3 x) {
  return 0.5 * (exp(x) + exp(-x));
}
vec4 cpfx_cosh(vec4 x) {
  return 0.5 * (exp(x) + exp(-x));
}

float cpfx_tanh(float x) {
  float e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
vec2 cpfx_tanh(vec2 x) {
  vec2 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
vec3 cpfx_tanh(vec3 x) {
  vec3 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
vec4 cpfx_tanh(vec4 x) {
  vec4 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

float cpfx_round(float x) {
  return sign(x) * floor(abs(x) + 0.5);
}
vec2 cpfx_round(vec2 x) {
  return sign(x) * floor(abs(x) + 0.5);
}
vec3 cpfx_round(vec3 x) {
  return sign(x) * floor(abs(x) + 0.5);
}
vec4 cpfx_round(vec4 x) {
  return sign(x) * floor(abs(x) + 0.5);
}

vec4 textureCompat(sampler2D s, vec2 uv) {
  return texture2D(s, uv);
}

vec4 textureCompat(sampler2D s, vec3 dir) {
  vec3 n = normalize(dir);
  float u = atan(n.z, n.x) / (2.0 * cpfx_PI) + 0.5;
  float v = asin(clamp(n.y, -1.0, 1.0)) / cpfx_PI + 0.5;
  return texture2D(s, vec2(u, v));
}
vec4 textureCompat(sampler2D s, vec2 uv, float bias) {
  return textureCompat(s, uv);
}
vec4 textureCompat(sampler2D s, vec3 dir, float bias) {
  return textureCompat(s, dir);
}

vec4 cpfx_textureLod(sampler2D s, vec2 uv, float lod) {
  return textureCompat(s, uv);
}

vec4 cpfx_textureLod(sampler2D s, vec3 dir, float lod) {
  return textureCompat(s, dir);
}
vec4 cpfx_textureGrad(sampler2D s, vec2 uv, vec2 dPdx, vec2 dPdy) {
  return textureCompat(s, uv);
}
vec4 cpfx_textureGrad(sampler2D s, vec3 dir, vec3 dPdx, vec3 dPdy) {
  return textureCompat(s, dir);
}

${buildChannelSamplingHelpers()}

vec4 cpfx_texelFetch(sampler2D s, int channelIndex, ivec2 p, int lod) {
  int idx = channelIndex;
  if (idx < 0) idx = 0;
  else if (idx > 3) idx = 3;
  vec2 res = vec2(
    idx == 0 ? iChannelResolution[0].x : (idx == 1 ? iChannelResolution[1].x : (idx == 2 ? iChannelResolution[2].x : iChannelResolution[3].x)),
    idx == 0 ? iChannelResolution[0].y : (idx == 1 ? iChannelResolution[1].y : (idx == 2 ? iChannelResolution[2].y : iChannelResolution[3].y))
  );
  res = max(res, vec2(1.0));
  vec2 uv = (vec2(p) + 0.5) / res;
  return textureCompat(s, uv);
}
ivec2 cpfx_textureSize(sampler2D s, int channelIndex, int lod) {
  int idx = channelIndex;
  if (idx < 0) idx = 0;
  else if (idx > 3) idx = 3;
  vec2 res = vec2(
    idx == 0 ? iChannelResolution[0].x : (idx == 1 ? iChannelResolution[1].x : (idx == 2 ? iChannelResolution[2].x : iChannelResolution[3].x)),
    idx == 0 ? iChannelResolution[0].y : (idx == 1 ? iChannelResolution[1].y : (idx == 2 ? iChannelResolution[2].y : iChannelResolution[3].y))
  );
  res = max(res, vec2(1.0));
  return ivec2(res);
}

vec3 cpfx_mul_mat4x3_vec4(vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec4 v) {
  return c0 * v.x + c1 * v.y + c2 * v.z + c3 * v.w;
}

vec3 cpfx_set_vec3_component(vec3 v, int idx, float value) {
  if (idx == 0) v.x = value;
  else if (idx == 1) v.y = value;
  else v.z = value;
  return v;
}

mat2 cpfx_transpose(mat2 m) {
  return mat2(
    m[0][0], m[1][0],
    m[0][1], m[1][1]
  );
}

mat3 cpfx_transpose(mat3 m) {
  return mat3(
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2]
  );
}

mat4 cpfx_transpose(mat4 m) {
  return mat4(
    m[0][0], m[1][0], m[2][0], m[3][0],
    m[0][1], m[1][1], m[2][1], m[3][1],
    m[0][2], m[1][2], m[2][2], m[3][2],
    m[0][3], m[1][3], m[2][3], m[3][3]
  );
}

float cpfx_min(float a, float b) { return min(a, b); }
vec2 cpfx_min(vec2 a, vec2 b) { return min(a, b); }
vec3 cpfx_min(vec3 a, vec3 b) { return min(a, b); }
vec4 cpfx_min(vec4 a, vec4 b) { return min(a, b); }
vec2 cpfx_min(vec2 a, float b) { return min(a, vec2(b)); }
vec2 cpfx_min(float a, vec2 b) { return min(vec2(a), b); }
vec3 cpfx_min(vec3 a, float b) { return min(a, vec3(b)); }
vec3 cpfx_min(float a, vec3 b) { return min(vec3(a), b); }
vec4 cpfx_min(vec4 a, float b) { return min(a, vec4(b)); }
vec4 cpfx_min(float a, vec4 b) { return min(vec4(a), b); }
ivec2 cpfx_min(ivec2 a, ivec2 b) { return ivec2((a.x < b.x) ? a.x : b.x, (a.y < b.y) ? a.y : b.y); }
ivec3 cpfx_min(ivec3 a, ivec3 b) { return ivec3((a.x < b.x) ? a.x : b.x, (a.y < b.y) ? a.y : b.y, (a.z < b.z) ? a.z : b.z); }
ivec4 cpfx_min(ivec4 a, ivec4 b) { return ivec4((a.x < b.x) ? a.x : b.x, (a.y < b.y) ? a.y : b.y, (a.z < b.z) ? a.z : b.z, (a.w < b.w) ? a.w : b.w); }
ivec2 cpfx_min(ivec2 a, int b) { return cpfx_min(a, ivec2(b)); }
ivec2 cpfx_min(int a, ivec2 b) { return cpfx_min(ivec2(a), b); }
ivec3 cpfx_min(ivec3 a, int b) { return cpfx_min(a, ivec3(b)); }
ivec3 cpfx_min(int a, ivec3 b) { return cpfx_min(ivec3(a), b); }
ivec4 cpfx_min(ivec4 a, int b) { return cpfx_min(a, ivec4(b)); }
ivec4 cpfx_min(int a, ivec4 b) { return cpfx_min(ivec4(a), b); }
int cpfx_min(int a, int b) { return (a < b) ? a : b; }
int cpfx_min(int a, float b) {
  int bi = int(floor(b));
  return (a < bi) ? a : bi;
}
int cpfx_min(float a, int b) {
  int ai = int(floor(a));
  return (ai < b) ? ai : b;
}

float cpfx_max(float a, float b) { return max(a, b); }
vec2 cpfx_max(vec2 a, vec2 b) { return max(a, b); }
vec3 cpfx_max(vec3 a, vec3 b) { return max(a, b); }
vec4 cpfx_max(vec4 a, vec4 b) { return max(a, b); }
vec2 cpfx_max(vec2 a, float b) { return max(a, vec2(b)); }
vec2 cpfx_max(float a, vec2 b) { return max(vec2(a), b); }
vec3 cpfx_max(vec3 a, float b) { return max(a, vec3(b)); }
vec3 cpfx_max(float a, vec3 b) { return max(vec3(a), b); }
vec4 cpfx_max(vec4 a, float b) { return max(a, vec4(b)); }
vec4 cpfx_max(float a, vec4 b) { return max(vec4(a), b); }
ivec2 cpfx_max(ivec2 a, ivec2 b) { return ivec2((a.x > b.x) ? a.x : b.x, (a.y > b.y) ? a.y : b.y); }
ivec3 cpfx_max(ivec3 a, ivec3 b) { return ivec3((a.x > b.x) ? a.x : b.x, (a.y > b.y) ? a.y : b.y, (a.z > b.z) ? a.z : b.z); }
ivec4 cpfx_max(ivec4 a, ivec4 b) { return ivec4((a.x > b.x) ? a.x : b.x, (a.y > b.y) ? a.y : b.y, (a.z > b.z) ? a.z : b.z, (a.w > b.w) ? a.w : b.w); }
ivec2 cpfx_max(ivec2 a, int b) { return cpfx_max(a, ivec2(b)); }
ivec2 cpfx_max(int a, ivec2 b) { return cpfx_max(ivec2(a), b); }
ivec3 cpfx_max(ivec3 a, int b) { return cpfx_max(a, ivec3(b)); }
ivec3 cpfx_max(int a, ivec3 b) { return cpfx_max(ivec3(a), b); }
ivec4 cpfx_max(ivec4 a, int b) { return cpfx_max(a, ivec4(b)); }
ivec4 cpfx_max(int a, ivec4 b) { return cpfx_max(ivec4(a), b); }
int cpfx_max(int a, int b) { return (a > b) ? a : b; }
int cpfx_max(int a, float b) {
  int bi = int(floor(b));
  return (a > bi) ? a : bi;
}
int cpfx_max(float a, int b) {
  int ai = int(floor(a));
  return (ai > b) ? ai : b;
}

int cpfx_shr(int a, int b) {
  int aa = (a < 0) ? 0 : a;
  int bb = (b < 0) ? 0 : b;
  return int(floor(float(aa) / exp2(float(bb))));
}

float cpfx_shr(float a, float b) { return float(cpfx_shr(int(floor(a)), int(floor(b)))); }
float cpfx_shr(float a, int b) { return float(cpfx_shr(int(floor(a)), b)); }
float cpfx_shr(int a, float b) { return float(cpfx_shr(a, int(floor(b)))); }
ivec2 cpfx_shr(ivec2 a, int b) { return ivec2(cpfx_shr(a.x, b), cpfx_shr(a.y, b)); }
ivec3 cpfx_shr(ivec3 a, int b) { return ivec3(cpfx_shr(a.x, b), cpfx_shr(a.y, b), cpfx_shr(a.z, b)); }
ivec4 cpfx_shr(ivec4 a, int b) { return ivec4(cpfx_shr(a.x, b), cpfx_shr(a.y, b), cpfx_shr(a.z, b), cpfx_shr(a.w, b)); }
ivec2 cpfx_shr(ivec2 a, ivec2 b) { return ivec2(cpfx_shr(a.x, b.x), cpfx_shr(a.y, b.y)); }
ivec3 cpfx_shr(ivec3 a, ivec3 b) { return ivec3(cpfx_shr(a.x, b.x), cpfx_shr(a.y, b.y), cpfx_shr(a.z, b.z)); }
ivec4 cpfx_shr(ivec4 a, ivec4 b) { return ivec4(cpfx_shr(a.x, b.x), cpfx_shr(a.y, b.y), cpfx_shr(a.z, b.z), cpfx_shr(a.w, b.w)); }

int cpfx_bitand(int a, int b) {
  int aa = (a < 0) ? 0 : a;
  int bb = (b < 0) ? 0 : b;
  int result = 0;
  int bit = 1;
  for (int k = 0; k < 24; ++k) {
    int abit = int(mod(float(aa), 2.0));
    int bbit = int(mod(float(bb), 2.0));
    if (abit == 1 && bbit == 1) result += bit;
    aa = int(floor(float(aa) * 0.5));
    bb = int(floor(float(bb) * 0.5));
    bit += bit;
  }
  return result;
}

float cpfx_bitand(float a, float b) { return float(cpfx_bitand(int(floor(a)), int(floor(b)))); }
float cpfx_bitand(float a, int b) { return float(cpfx_bitand(int(floor(a)), b)); }
float cpfx_bitand(int a, float b) { return float(cpfx_bitand(a, int(floor(b)))); }
ivec2 cpfx_bitand(ivec2 a, ivec2 b) { return ivec2(cpfx_bitand(a.x, b.x), cpfx_bitand(a.y, b.y)); }
ivec3 cpfx_bitand(ivec3 a, ivec3 b) { return ivec3(cpfx_bitand(a.x, b.x), cpfx_bitand(a.y, b.y), cpfx_bitand(a.z, b.z)); }
ivec4 cpfx_bitand(ivec4 a, ivec4 b) { return ivec4(cpfx_bitand(a.x, b.x), cpfx_bitand(a.y, b.y), cpfx_bitand(a.z, b.z), cpfx_bitand(a.w, b.w)); }
ivec2 cpfx_bitand(ivec2 a, int b) { return cpfx_bitand(a, ivec2(b)); }
ivec3 cpfx_bitand(ivec3 a, int b) { return cpfx_bitand(a, ivec3(b)); }
ivec4 cpfx_bitand(ivec4 a, int b) { return cpfx_bitand(a, ivec4(b)); }

int cpfx_bitxor(int a, int b) {
  return a + b - 2 * cpfx_bitand(a, b);
}
float cpfx_bitxor(float a, float b) { return float(cpfx_bitxor(int(floor(a)), int(floor(b)))); }
float cpfx_bitxor(float a, int b) { return float(cpfx_bitxor(int(floor(a)), b)); }
float cpfx_bitxor(int a, float b) { return float(cpfx_bitxor(a, int(floor(b)))); }
ivec2 cpfx_bitxor(ivec2 a, ivec2 b) { return ivec2(cpfx_bitxor(a.x, b.x), cpfx_bitxor(a.y, b.y)); }
ivec3 cpfx_bitxor(ivec3 a, ivec3 b) { return ivec3(cpfx_bitxor(a.x, b.x), cpfx_bitxor(a.y, b.y), cpfx_bitxor(a.z, b.z)); }
ivec4 cpfx_bitxor(ivec4 a, ivec4 b) { return ivec4(cpfx_bitxor(a.x, b.x), cpfx_bitxor(a.y, b.y), cpfx_bitxor(a.z, b.z), cpfx_bitxor(a.w, b.w)); }
ivec2 cpfx_bitxor(ivec2 a, int b) { return cpfx_bitxor(a, ivec2(b)); }
ivec3 cpfx_bitxor(ivec3 a, int b) { return cpfx_bitxor(a, ivec3(b)); }
ivec4 cpfx_bitxor(ivec4 a, int b) { return cpfx_bitxor(a, ivec4(b)); }

int cpfx_floatBitsToUint(float v) {
  float av = abs(v);
  float signSalt = (v < 0.0) ? 19.19 : 0.0;
  return int(floor(fract(sin(av * 12.9898 + signSalt) * 43758.5453123) * 16777215.0));
}
ivec2 cpfx_floatBitsToUint(vec2 v) { return ivec2(cpfx_floatBitsToUint(v.x), cpfx_floatBitsToUint(v.y)); }
ivec3 cpfx_floatBitsToUint(vec3 v) { return ivec3(cpfx_floatBitsToUint(v.x), cpfx_floatBitsToUint(v.y), cpfx_floatBitsToUint(v.z)); }
ivec4 cpfx_floatBitsToUint(vec4 v) { return ivec4(cpfx_floatBitsToUint(v.x), cpfx_floatBitsToUint(v.y), cpfx_floatBitsToUint(v.z), cpfx_floatBitsToUint(v.w)); }

float cpfx_mod(float a, float b) { return mod(a, b); }
float cpfx_mod(float a, int b) { return mod(a, float(b)); }
float cpfx_mod(int a, float b) { return mod(float(a), b); }
int cpfx_mod(int a, int b) { return int(mod(float(a), float(b))); }

float cpfx_dFdx(float v) {
#ifdef GL_OES_standard_derivatives
  return dFdx(v);
#else
  return 0.0;
#endif
}
vec2 cpfx_dFdx(vec2 v) {
#ifdef GL_OES_standard_derivatives
  return dFdx(v);
#else
  return vec2(0.0);
#endif
}
vec3 cpfx_dFdx(vec3 v) {
#ifdef GL_OES_standard_derivatives
  return dFdx(v);
#else
  return vec3(0.0);
#endif
}
vec4 cpfx_dFdx(vec4 v) {
#ifdef GL_OES_standard_derivatives
  return dFdx(v);
#else
  return vec4(0.0);
#endif
}

float cpfx_dFdy(float v) {
#ifdef GL_OES_standard_derivatives
  return dFdy(v);
#else
  return 0.0;
#endif
}
vec2 cpfx_dFdy(vec2 v) {
#ifdef GL_OES_standard_derivatives
  return dFdy(v);
#else
  return vec2(0.0);
#endif
}
vec3 cpfx_dFdy(vec3 v) {
#ifdef GL_OES_standard_derivatives
  return dFdy(v);
#else
  return vec3(0.0);
#endif
}
vec4 cpfx_dFdy(vec4 v) {
#ifdef GL_OES_standard_derivatives
  return dFdy(v);
#else
  return vec4(0.0);
#endif
}

#define texture textureCompat

${body}

void main() {
  vec2 stUvRaw = vec2(vTextureCoord.x, 1.0 - vTextureCoord.y);
  if (shaderFlipX > 0.5) stUvRaw.x = 1.0 - stUvRaw.x;
  if (shaderFlipY > 0.5) stUvRaw.y = 1.0 - stUvRaw.y;
  vec2 stUv = cpfx_rotate(stUvRaw - 0.5, shaderRotation) / max(shaderScaleXY, vec2(0.0001)) + 0.5;
  vec2 fragCoord = stUv * resolution;
  cpfxFragCoord = fragCoord;
  vec4 base = texture2D(uSampler, vTextureCoord);
  // Imported-shader debug must bypass user mainImage logic (discard/branching)
  // so UV/mask diagnostics are reliable.
  if (debugMode > 0.5 && debugMode < 1.5) {
    gl_FragColor = vec4(stUv, 0.0, 1.0);
    return;
  }
  if (debugMode > 1.5 && debugMode < 2.5) {
    gl_FragColor = vec4(vec3(base.a), base.a);
    return;
  }

  vec4 shaderColor = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(shaderColor, fragCoord);
  float srcAlpha = shaderColor.a;
  if (debugMode > 2.5 && debugMode < 3.5) {
    gl_FragColor = vec4(vec3(srcAlpha), srcAlpha);
    return;
  }
  if (cpfxForceOpaqueCaptureAlpha > 0.5 && srcAlpha <= 0.0001) srcAlpha = 1.0;
  if (cpfxPreserveTransparent < 0.5 && srcAlpha <= 0.0001) srcAlpha = 1.0;
  if (debugMode > 3.5 && debugMode < 4.5) {
    gl_FragColor = vec4(vec3(srcAlpha), srcAlpha);
    return;
  }
  float a = clamp(base.a * srcAlpha, 0.0, 1.0);
  if (debugMode > 4.5 && debugMode < 5.5) {
    gl_FragColor = vec4(vec3(a), a);
    return;
  }
  gl_FragColor = vec4(shaderColor.rgb * a * intensity, a);
}`;
}

export function adaptShaderToyBufferFragment(source) {
  const body = applyCompatibilityRewrites(validateShaderToySource(source));
  const compatMacros = buildCompatMacroPreamble(body);
  return `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vTextureCoord;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec4 iMouse;
uniform float uTime;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrame;
uniform float iFrameRate;
uniform vec4 iDate;
uniform vec3 iChannelResolution[4];
uniform vec3 iResolution;
uniform float cpfxChannelType0;
uniform float cpfxChannelType1;
uniform float cpfxChannelType2;
uniform float cpfxChannelType3;
uniform vec3 cpfxVolumeLayout0;
uniform vec3 cpfxVolumeLayout1;
uniform vec3 cpfxVolumeLayout2;
uniform vec3 cpfxVolumeLayout3;
uniform float intensity;
uniform float shaderScale;
uniform vec2 shaderScaleXY;
uniform float shaderRotation;
uniform float shaderFlipX;
uniform float shaderFlipY;
uniform float cpfxPreserveTransparent;
uniform float cpfxForceOpaqueCaptureAlpha;
uniform vec2 resolution;
${compatMacros}

vec2 cpfxFragCoord;
#define gl_FragCoord vec4(cpfxFragCoord, 0.0, 1.0)

const float cpfx_PI = 3.14159265359;

vec2 cpfx_rotate(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float cpfx_sinh(float x) {
  return 0.5 * (exp(x) - exp(-x));
}
vec2 cpfx_sinh(vec2 x) {
  return 0.5 * (exp(x) - exp(-x));
}
vec3 cpfx_sinh(vec3 x) {
  return 0.5 * (exp(x) - exp(-x));
}
vec4 cpfx_sinh(vec4 x) {
  return 0.5 * (exp(x) - exp(-x));
}

float cpfx_cosh(float x) {
  return 0.5 * (exp(x) + exp(-x));
}
vec2 cpfx_cosh(vec2 x) {
  return 0.5 * (exp(x) + exp(-x));
}
vec3 cpfx_cosh(vec3 x) {
  return 0.5 * (exp(x) + exp(-x));
}
vec4 cpfx_cosh(vec4 x) {
  return 0.5 * (exp(x) + exp(-x));
}

float cpfx_tanh(float x) {
  float e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
vec2 cpfx_tanh(vec2 x) {
  vec2 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
vec3 cpfx_tanh(vec3 x) {
  vec3 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
vec4 cpfx_tanh(vec4 x) {
  vec4 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

float cpfx_round(float x) {
  return sign(x) * floor(abs(x) + 0.5);
}
vec2 cpfx_round(vec2 x) {
  return sign(x) * floor(abs(x) + 0.5);
}
vec3 cpfx_round(vec3 x) {
  return sign(x) * floor(abs(x) + 0.5);
}
vec4 cpfx_round(vec4 x) {
  return sign(x) * floor(abs(x) + 0.5);
}

vec4 textureCompat(sampler2D s, vec2 uv) {
  return texture2D(s, uv);
}

vec4 textureCompat(sampler2D s, vec3 dir) {
  vec3 n = normalize(dir);
  float u = atan(n.z, n.x) / (2.0 * cpfx_PI) + 0.5;
  float v = asin(clamp(n.y, -1.0, 1.0)) / cpfx_PI + 0.5;
  return texture2D(s, vec2(u, v));
}
vec4 textureCompat(sampler2D s, vec2 uv, float bias) {
  return textureCompat(s, uv);
}
vec4 textureCompat(sampler2D s, vec3 dir, float bias) {
  return textureCompat(s, dir);
}

vec4 cpfx_textureLod(sampler2D s, vec2 uv, float lod) {
  return textureCompat(s, uv);
}

vec4 cpfx_textureLod(sampler2D s, vec3 dir, float lod) {
  return textureCompat(s, dir);
}
vec4 cpfx_textureGrad(sampler2D s, vec2 uv, vec2 dPdx, vec2 dPdy) {
  return textureCompat(s, uv);
}
vec4 cpfx_textureGrad(sampler2D s, vec3 dir, vec3 dPdx, vec3 dPdy) {
  return textureCompat(s, dir);
}

${buildChannelSamplingHelpers()}

vec4 cpfx_texelFetch(sampler2D s, int channelIndex, ivec2 p, int lod) {
  int idx = channelIndex;
  if (idx < 0) idx = 0;
  else if (idx > 3) idx = 3;
  vec2 res = vec2(
    idx == 0 ? iChannelResolution[0].x : (idx == 1 ? iChannelResolution[1].x : (idx == 2 ? iChannelResolution[2].x : iChannelResolution[3].x)),
    idx == 0 ? iChannelResolution[0].y : (idx == 1 ? iChannelResolution[1].y : (idx == 2 ? iChannelResolution[2].y : iChannelResolution[3].y))
  );
  res = max(res, vec2(1.0));
  vec2 uv = (vec2(p) + 0.5) / res;
  return textureCompat(s, uv);
}
ivec2 cpfx_textureSize(sampler2D s, int channelIndex, int lod) {
  int idx = channelIndex;
  if (idx < 0) idx = 0;
  else if (idx > 3) idx = 3;
  vec2 res = vec2(
    idx == 0 ? iChannelResolution[0].x : (idx == 1 ? iChannelResolution[1].x : (idx == 2 ? iChannelResolution[2].x : iChannelResolution[3].x)),
    idx == 0 ? iChannelResolution[0].y : (idx == 1 ? iChannelResolution[1].y : (idx == 2 ? iChannelResolution[2].y : iChannelResolution[3].y))
  );
  res = max(res, vec2(1.0));
  return ivec2(res);
}

vec3 cpfx_mul_mat4x3_vec4(vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec4 v) {
  return c0 * v.x + c1 * v.y + c2 * v.z + c3 * v.w;
}

vec3 cpfx_set_vec3_component(vec3 v, int idx, float value) {
  if (idx == 0) v.x = value;
  else if (idx == 1) v.y = value;
  else v.z = value;
  return v;
}

mat2 cpfx_transpose(mat2 m) {
  return mat2(
    m[0][0], m[1][0],
    m[0][1], m[1][1]
  );
}

mat3 cpfx_transpose(mat3 m) {
  return mat3(
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2]
  );
}

mat4 cpfx_transpose(mat4 m) {
  return mat4(
    m[0][0], m[1][0], m[2][0], m[3][0],
    m[0][1], m[1][1], m[2][1], m[3][1],
    m[0][2], m[1][2], m[2][2], m[3][2],
    m[0][3], m[1][3], m[2][3], m[3][3]
  );
}

float cpfx_min(float a, float b) { return min(a, b); }
vec2 cpfx_min(vec2 a, vec2 b) { return min(a, b); }
vec3 cpfx_min(vec3 a, vec3 b) { return min(a, b); }
vec4 cpfx_min(vec4 a, vec4 b) { return min(a, b); }
vec2 cpfx_min(vec2 a, float b) { return min(a, vec2(b)); }
vec2 cpfx_min(float a, vec2 b) { return min(vec2(a), b); }
vec3 cpfx_min(vec3 a, float b) { return min(a, vec3(b)); }
vec3 cpfx_min(float a, vec3 b) { return min(vec3(a), b); }
vec4 cpfx_min(vec4 a, float b) { return min(a, vec4(b)); }
vec4 cpfx_min(float a, vec4 b) { return min(vec4(a), b); }
ivec2 cpfx_min(ivec2 a, ivec2 b) { return ivec2((a.x < b.x) ? a.x : b.x, (a.y < b.y) ? a.y : b.y); }
ivec3 cpfx_min(ivec3 a, ivec3 b) { return ivec3((a.x < b.x) ? a.x : b.x, (a.y < b.y) ? a.y : b.y, (a.z < b.z) ? a.z : b.z); }
ivec4 cpfx_min(ivec4 a, ivec4 b) { return ivec4((a.x < b.x) ? a.x : b.x, (a.y < b.y) ? a.y : b.y, (a.z < b.z) ? a.z : b.z, (a.w < b.w) ? a.w : b.w); }
ivec2 cpfx_min(ivec2 a, int b) { return cpfx_min(a, ivec2(b)); }
ivec2 cpfx_min(int a, ivec2 b) { return cpfx_min(ivec2(a), b); }
ivec3 cpfx_min(ivec3 a, int b) { return cpfx_min(a, ivec3(b)); }
ivec3 cpfx_min(int a, ivec3 b) { return cpfx_min(ivec3(a), b); }
ivec4 cpfx_min(ivec4 a, int b) { return cpfx_min(a, ivec4(b)); }
ivec4 cpfx_min(int a, ivec4 b) { return cpfx_min(ivec4(a), b); }
int cpfx_min(int a, int b) { return (a < b) ? a : b; }
int cpfx_min(int a, float b) {
  int bi = int(floor(b));
  return (a < bi) ? a : bi;
}
int cpfx_min(float a, int b) {
  int ai = int(floor(a));
  return (ai < b) ? ai : b;
}

float cpfx_max(float a, float b) { return max(a, b); }
vec2 cpfx_max(vec2 a, vec2 b) { return max(a, b); }
vec3 cpfx_max(vec3 a, vec3 b) { return max(a, b); }
vec4 cpfx_max(vec4 a, vec4 b) { return max(a, b); }
vec2 cpfx_max(vec2 a, float b) { return max(a, vec2(b)); }
vec2 cpfx_max(float a, vec2 b) { return max(vec2(a), b); }
vec3 cpfx_max(vec3 a, float b) { return max(a, vec3(b)); }
vec3 cpfx_max(float a, vec3 b) { return max(vec3(a), b); }
vec4 cpfx_max(vec4 a, float b) { return max(a, vec4(b)); }
vec4 cpfx_max(float a, vec4 b) { return max(vec4(a), b); }
ivec2 cpfx_max(ivec2 a, ivec2 b) { return ivec2((a.x > b.x) ? a.x : b.x, (a.y > b.y) ? a.y : b.y); }
ivec3 cpfx_max(ivec3 a, ivec3 b) { return ivec3((a.x > b.x) ? a.x : b.x, (a.y > b.y) ? a.y : b.y, (a.z > b.z) ? a.z : b.z); }
ivec4 cpfx_max(ivec4 a, ivec4 b) { return ivec4((a.x > b.x) ? a.x : b.x, (a.y > b.y) ? a.y : b.y, (a.z > b.z) ? a.z : b.z, (a.w > b.w) ? a.w : b.w); }
ivec2 cpfx_max(ivec2 a, int b) { return cpfx_max(a, ivec2(b)); }
ivec2 cpfx_max(int a, ivec2 b) { return cpfx_max(ivec2(a), b); }
ivec3 cpfx_max(ivec3 a, int b) { return cpfx_max(a, ivec3(b)); }
ivec3 cpfx_max(int a, ivec3 b) { return cpfx_max(ivec3(a), b); }
ivec4 cpfx_max(ivec4 a, int b) { return cpfx_max(a, ivec4(b)); }
ivec4 cpfx_max(int a, ivec4 b) { return cpfx_max(ivec4(a), b); }
int cpfx_max(int a, int b) { return (a > b) ? a : b; }
int cpfx_max(int a, float b) {
  int bi = int(floor(b));
  return (a > bi) ? a : bi;
}
int cpfx_max(float a, int b) {
  int ai = int(floor(a));
  return (ai > b) ? ai : b;
}

int cpfx_shr(int a, int b) {
  int aa = (a < 0) ? 0 : a;
  int bb = (b < 0) ? 0 : b;
  return int(floor(float(aa) / exp2(float(bb))));
}

float cpfx_shr(float a, float b) { return float(cpfx_shr(int(floor(a)), int(floor(b)))); }
float cpfx_shr(float a, int b) { return float(cpfx_shr(int(floor(a)), b)); }
float cpfx_shr(int a, float b) { return float(cpfx_shr(a, int(floor(b)))); }
ivec2 cpfx_shr(ivec2 a, int b) { return ivec2(cpfx_shr(a.x, b), cpfx_shr(a.y, b)); }
ivec3 cpfx_shr(ivec3 a, int b) { return ivec3(cpfx_shr(a.x, b), cpfx_shr(a.y, b), cpfx_shr(a.z, b)); }
ivec4 cpfx_shr(ivec4 a, int b) { return ivec4(cpfx_shr(a.x, b), cpfx_shr(a.y, b), cpfx_shr(a.z, b), cpfx_shr(a.w, b)); }
ivec2 cpfx_shr(ivec2 a, ivec2 b) { return ivec2(cpfx_shr(a.x, b.x), cpfx_shr(a.y, b.y)); }
ivec3 cpfx_shr(ivec3 a, ivec3 b) { return ivec3(cpfx_shr(a.x, b.x), cpfx_shr(a.y, b.y), cpfx_shr(a.z, b.z)); }
ivec4 cpfx_shr(ivec4 a, ivec4 b) { return ivec4(cpfx_shr(a.x, b.x), cpfx_shr(a.y, b.y), cpfx_shr(a.z, b.z), cpfx_shr(a.w, b.w)); }

int cpfx_bitand(int a, int b) {
  int aa = (a < 0) ? 0 : a;
  int bb = (b < 0) ? 0 : b;
  int result = 0;
  int bit = 1;
  for (int k = 0; k < 24; ++k) {
    int abit = int(mod(float(aa), 2.0));
    int bbit = int(mod(float(bb), 2.0));
    if (abit == 1 && bbit == 1) result += bit;
    aa = int(floor(float(aa) * 0.5));
    bb = int(floor(float(bb) * 0.5));
    bit += bit;
  }
  return result;
}

float cpfx_bitand(float a, float b) { return float(cpfx_bitand(int(floor(a)), int(floor(b)))); }
float cpfx_bitand(float a, int b) { return float(cpfx_bitand(int(floor(a)), b)); }
float cpfx_bitand(int a, float b) { return float(cpfx_bitand(a, int(floor(b)))); }
ivec2 cpfx_bitand(ivec2 a, ivec2 b) { return ivec2(cpfx_bitand(a.x, b.x), cpfx_bitand(a.y, b.y)); }
ivec3 cpfx_bitand(ivec3 a, ivec3 b) { return ivec3(cpfx_bitand(a.x, b.x), cpfx_bitand(a.y, b.y), cpfx_bitand(a.z, b.z)); }
ivec4 cpfx_bitand(ivec4 a, ivec4 b) { return ivec4(cpfx_bitand(a.x, b.x), cpfx_bitand(a.y, b.y), cpfx_bitand(a.z, b.z), cpfx_bitand(a.w, b.w)); }
ivec2 cpfx_bitand(ivec2 a, int b) { return cpfx_bitand(a, ivec2(b)); }
ivec3 cpfx_bitand(ivec3 a, int b) { return cpfx_bitand(a, ivec3(b)); }
ivec4 cpfx_bitand(ivec4 a, int b) { return cpfx_bitand(a, ivec4(b)); }

int cpfx_bitxor(int a, int b) {
  return a + b - 2 * cpfx_bitand(a, b);
}
float cpfx_bitxor(float a, float b) { return float(cpfx_bitxor(int(floor(a)), int(floor(b)))); }
float cpfx_bitxor(float a, int b) { return float(cpfx_bitxor(int(floor(a)), b)); }
float cpfx_bitxor(int a, float b) { return float(cpfx_bitxor(a, int(floor(b)))); }
ivec2 cpfx_bitxor(ivec2 a, ivec2 b) { return ivec2(cpfx_bitxor(a.x, b.x), cpfx_bitxor(a.y, b.y)); }
ivec3 cpfx_bitxor(ivec3 a, ivec3 b) { return ivec3(cpfx_bitxor(a.x, b.x), cpfx_bitxor(a.y, b.y), cpfx_bitxor(a.z, b.z)); }
ivec4 cpfx_bitxor(ivec4 a, ivec4 b) { return ivec4(cpfx_bitxor(a.x, b.x), cpfx_bitxor(a.y, b.y), cpfx_bitxor(a.z, b.z), cpfx_bitxor(a.w, b.w)); }
ivec2 cpfx_bitxor(ivec2 a, int b) { return cpfx_bitxor(a, ivec2(b)); }
ivec3 cpfx_bitxor(ivec3 a, int b) { return cpfx_bitxor(a, ivec3(b)); }
ivec4 cpfx_bitxor(ivec4 a, int b) { return cpfx_bitxor(a, ivec4(b)); }

int cpfx_floatBitsToUint(float v) {
  float av = abs(v);
  float signSalt = (v < 0.0) ? 19.19 : 0.0;
  return int(floor(fract(sin(av * 12.9898 + signSalt) * 43758.5453123) * 16777215.0));
}
ivec2 cpfx_floatBitsToUint(vec2 v) { return ivec2(cpfx_floatBitsToUint(v.x), cpfx_floatBitsToUint(v.y)); }
ivec3 cpfx_floatBitsToUint(vec3 v) { return ivec3(cpfx_floatBitsToUint(v.x), cpfx_floatBitsToUint(v.y), cpfx_floatBitsToUint(v.z)); }
ivec4 cpfx_floatBitsToUint(vec4 v) { return ivec4(cpfx_floatBitsToUint(v.x), cpfx_floatBitsToUint(v.y), cpfx_floatBitsToUint(v.z), cpfx_floatBitsToUint(v.w)); }

float cpfx_mod(float a, float b) { return mod(a, b); }
float cpfx_mod(float a, int b) { return mod(a, float(b)); }
float cpfx_mod(int a, float b) { return mod(float(a), b); }
int cpfx_mod(int a, int b) { return int(mod(float(a), float(b))); }

float cpfx_dFdx(float v) {
#ifdef GL_OES_standard_derivatives
  return dFdx(v);
#else
  return 0.0;
#endif
}
vec2 cpfx_dFdx(vec2 v) {
#ifdef GL_OES_standard_derivatives
  return dFdx(v);
#else
  return vec2(0.0);
#endif
}
vec3 cpfx_dFdx(vec3 v) {
#ifdef GL_OES_standard_derivatives
  return dFdx(v);
#else
  return vec3(0.0);
#endif
}
vec4 cpfx_dFdx(vec4 v) {
#ifdef GL_OES_standard_derivatives
  return dFdx(v);
#else
  return vec4(0.0);
#endif
}

float cpfx_dFdy(float v) {
#ifdef GL_OES_standard_derivatives
  return dFdy(v);
#else
  return 0.0;
#endif
}
vec2 cpfx_dFdy(vec2 v) {
#ifdef GL_OES_standard_derivatives
  return dFdy(v);
#else
  return vec2(0.0);
#endif
}
vec3 cpfx_dFdy(vec3 v) {
#ifdef GL_OES_standard_derivatives
  return dFdy(v);
#else
  return vec3(0.0);
#endif
}
vec4 cpfx_dFdy(vec4 v) {
#ifdef GL_OES_standard_derivatives
  return dFdy(v);
#else
  return vec4(0.0);
#endif
}

#define texture textureCompat

${body}

void main() {
  vec2 stUvRaw = vec2(vTextureCoord.x, 1.0 - vTextureCoord.y);
  if (shaderFlipX > 0.5) stUvRaw.x = 1.0 - stUvRaw.x;
  if (shaderFlipY > 0.5) stUvRaw.y = 1.0 - stUvRaw.y;
  vec2 stUv = cpfx_rotate(stUvRaw - 0.5, shaderRotation) / max(shaderScaleXY, vec2(0.0001)) + 0.5;
  vec2 fragCoord = stUv * resolution;
  cpfxFragCoord = fragCoord;
  vec4 shaderColor = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(shaderColor, fragCoord);
  gl_FragColor = shaderColor;
}`;
}

const LIGHT_LAYER_TYPES = new Set(["coloration", "illumination", "background"]);

function normalizeLightLayerType(value) {
  const layer = String(value ?? "coloration").trim().toLowerCase();
  return LIGHT_LAYER_TYPES.has(layer) ? layer : "coloration";
}

function getLightLayerColorExpression(layerType) {
  if (layerType === "illumination")
    return "cpfxShaderRgb * max(cpfxIlluminationIntensity, 0.0)";
  if (layerType === "background") {
    return "(mix(baseColor.rgb, shaderColor.rgb, clamp(backgroundAlpha, 0.0, 1.0)) + (shaderColor.rgb * max(backgroundGlow, 0.0))) * max(cpfxBackgroundIntensity, 0.0)";
  }
  return "shaderColor.rgb * color * colorationAlpha * max(cpfxColorationIntensity, 0.0)";
}

export function adaptShaderToyLightFragment(
  source,
  { layerType = "coloration" } = {},
) {
  const resolvedLayer = normalizeLightLayerType(layerType);
  const colorExpression = getLightLayerColorExpression(resolvedLayer);
  const layerOpacityExpression =
    resolvedLayer === "illumination"
      ? "1.0"
      : resolvedLayer === "coloration"
      ? "clamp(srcAlpha, 0.0, 1.0)"
      : "clamp(srcAlpha, 0.0, 1.0)";
  const depthExpression =
    resolvedLayer === "coloration"
      ? `vec4 depthColor = texture2D(depthTexture, cpfxSamplerUv);
  float depth = smoothstep(0.0, 1.0, vDepth)
    * step(depthColor.g, depthElevation)
    * step(depthElevation, (254.5 / 255.0) - depthColor.r);`
      : `float depth = 1.0;`;
  let fragment = adaptShaderToyBufferFragment(source);

  fragment = fragment.replace(
    /varying\s+vec2\s+vTextureCoord\s*;/,
    "varying vec2 vUvs;\nvarying vec2 vSamplerUvs;\nvarying float vDepth;",
  );
  fragment = fragment.replace(/\bvTextureCoord\b/g, "vUvs");
  fragment = fragment.replace(
    /vec2 stUvRaw = vec2\(vUvs\.x, 1\.0 - vUvs\.y\);/,
    `vec2 cpfxSamplerUv = vSamplerUvs;
  vec2 stUvRaw = vec2(vUvs.x, 1.0 - vUvs.y);`,
  );
  fragment = fragment.replace(
    /uniform\s+vec2\s+resolution\s*;/,
    `uniform vec2 resolution;
uniform sampler2D primaryTexture;
uniform sampler2D depthTexture;
uniform float depthElevation;
uniform float attenuation;
uniform float cpfxLightFalloffMode;
uniform float cpfxLightBrightDimRatio;
uniform float cpfxLightExponentialPower;
uniform float colorationAlpha;
uniform float backgroundAlpha;
uniform float backgroundGlow;
uniform float cpfxColorationIntensity;
uniform float cpfxIlluminationIntensity;
uniform float cpfxBackgroundIntensity;
uniform vec3 color;`,
  );

  fragment = fragment.replace(
    /\bgl_FragColor\s*=\s*shaderColor\s*;\s*}/,
    `float srcAlpha = clamp(shaderColor.a, 0.0, 1.0);
  vec3 cpfxShaderRgb = shaderColor.rgb;
  if (srcAlpha > 0.0001) {
    cpfxShaderRgb = clamp(shaderColor.rgb / srcAlpha, vec3(0.0), vec3(8.0));
  }
  vec4 baseColor = texture2D(primaryTexture, cpfxSamplerUv);
  float dist = distance(vUvs, vec2(0.5)) * 2.0;
  ${depthExpression}
  float d = clamp(dist, 0.0, 1.0);
  float falloff = 1.0;
  if (cpfxLightFalloffMode < 0.5) {
    falloff = 1.0;
  } else if (cpfxLightFalloffMode < 1.5) {
    float start = clamp(cpfxLightBrightDimRatio, 0.0, 1.0);
    float t = clamp((d - start) / max(0.0001, 1.0 - start), 0.0, 1.0);
    falloff = 1.0 - t;
  } else if (cpfxLightFalloffMode < 2.5) {
    falloff = clamp(1.0 - d, 0.0, 1.0);
  } else {
    falloff = pow(clamp(1.0 - d, 0.0, 1.0), max(0.0001, cpfxLightExponentialPower));
  }
  depth *= falloff;
  float layerOpacity = ${layerOpacityExpression};
  float finalAlpha = depth * layerOpacity;
  float intensityGain = max(intensity, 0.0);
  vec3 finalColor = ${colorExpression} * intensityGain;
  gl_FragColor = vec4(finalColor * finalAlpha, finalAlpha);
}`,
  );

  return fragment;
}


