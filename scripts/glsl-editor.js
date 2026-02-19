const MONACO_CDN_BASE = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min";
const MONACO_LOADER_URL = `${MONACO_CDN_BASE}/vs/loader.min.js`;
const MONACO_LOADER_SCRIPT_ID = "indy-fx-monaco-loader";
const MONACO_LOAD_TIMEOUT_MS = 15000;

const GLSL_KEYWORDS = [
  "attribute", "bool", "break", "const", "continue", "discard", "do", "else",
  "false", "float", "for", "highp", "if", "in", "inout", "int", "invariant",
  "ivec2", "ivec3", "ivec4", "lowp", "mat2", "mat3", "mat4", "mediump",
  "out", "precision", "return", "sampler2D", "samplerCube", "struct", "true",
  "uniform", "varying", "vec2", "vec3", "vec4", "void", "while",
];

const GLSL_BUILTINS = [
  "abs", "acos", "all", "any", "asin", "atan", "ceil", "clamp", "cos",
  "cross", "degrees", "distance", "dot", "dFdx", "dFdy", "equal", "exp",
  "exp2", "faceforward", "floor", "fract", "inversesqrt", "length", "log",
  "log2", "max", "min", "mix", "mod", "normalize", "not", "notEqual", "pow",
  "radians", "reflect", "refract", "sign", "sin", "smoothstep", "sqrt", "step",
  "tan", "texture", "texture2D", "textureCube", "textureLod",
];

const SHADERTOY_SYMBOLS = [
  "mainImage", "fragCoord", "fragColor", "iResolution", "iTime", "iTimeDelta",
  "iFrame", "iFrameRate", "iMouse", "iDate", "iChannel0", "iChannel1",
  "iChannel2", "iChannel3", "iChannelResolution", "uTime",
  "cpfxTokenRotation", "cpfxPreserveTransparent", "cpfxForceOpaqueCaptureAlpha",
];

const COMPLETION_WORDS = Array.from(
  new Set([...GLSL_KEYWORDS, ...GLSL_BUILTINS, ...SHADERTOY_SYMBOLS]),
).sort((a, b) => a.localeCompare(b));

const _activeMonacoEditors = new Set();
let _monacoLoadPromise = null;
let _monacoConfigured = false;

const FALLBACK_POPUP_STYLE = Object.freeze({
  position: "absolute",
  left: "0.4rem",
  top: "0.4rem",
  zIndex: "40",
  maxHeight: "12rem",
  minWidth: "14rem",
  overflowY: "auto",
  overflowX: "hidden",
  border: "1px solid var(--color-border-light-primary, #666)",
  borderRadius: "6px",
  background: "var(--color-bg-option, rgba(18,18,18,0.96))",
  color: "var(--color-text-primary, #ddd)",
  boxShadow: "0 10px 20px rgba(0,0,0,0.38)",
  fontFamily: "monospace",
  fontSize: "0.78rem",
  lineHeight: "1.25",
  padding: "0.15rem",
  display: "none",
});

function applyInlineStyle(el, styleObj) {
  if (!(el instanceof HTMLElement)) return;
  for (const [k, v] of Object.entries(styleObj)) {
    el.style[k] = String(v);
  }
}

function filterCompletions(prefix) {
  const p = String(prefix ?? "").trim().toLowerCase();
  if (!p) return COMPLETION_WORDS.slice(0, 80);
  const starts = [];
  const contains = [];
  for (const word of COMPLETION_WORDS) {
    const lw = word.toLowerCase();
    if (lw.startsWith(p)) starts.push(word);
    else if (lw.includes(p)) contains.push(word);
    if (starts.length >= 80) break;
  }
  if (starts.length >= 80) return starts;
  return [...starts, ...contains].slice(0, 80);
}

function getTokenSpan(value, caret) {
  const text = String(value ?? "");
  const pos = Math.max(0, Math.min(text.length, Number(caret) || 0));
  let start = pos;
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) start -= 1;
  let end = pos;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end += 1;
  const token = text.slice(start, pos);
  return { start, end, token };
}

function loadScriptOnce(src, id) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "1";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

function cleanupOrphanMonacoEditors() {
  for (const entry of Array.from(_activeMonacoEditors)) {
    const textarea = entry?.textarea;
    if (textarea instanceof HTMLTextAreaElement && textarea.isConnected) continue;
    try {
      entry?.resizeObserver?.disconnect?.();
      entry?.editor?.dispose?.();
    } catch (_err) {
      // Non-fatal.
    }
    _activeMonacoEditors.delete(entry);
  }
}

function getMonacoWorkerUrl() {
  const workerSource = [
    `self.MonacoEnvironment = { baseUrl: '${MONACO_CDN_BASE}/' };`,
    `importScripts('${MONACO_CDN_BASE}/vs/base/worker/workerMain.js');`,
  ].join("\n");
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(workerSource)}`;
}

function configureMonaco(monaco) {
  if (_monacoConfigured || !monaco?.editor || !monaco?.languages) return;
  _monacoConfigured = true;

  try {
    monaco.editor.defineTheme("indyfx-glsl-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#151515",
      },
    });
  } catch (_err) {
    // Theme likely already defined.
  }

  monaco.languages.register({ id: "glsl" });
  monaco.languages.setLanguageConfiguration("glsl", {
    comments: {
      lineComment: "//",
      blockComment: ["/*", "*/"],
    },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
  monaco.languages.setMonarchTokensProvider("glsl", {
    keywords: GLSL_KEYWORDS,
    tokenizer: {
      root: [
        [/[a-zA-Z_]\w*/, {
          cases: {
            "@keywords": "keyword",
            "@default": "identifier",
          },
        }],
        [/[{}()\[\]]/, "@brackets"],
        [/\d+\.\d*([eE][\-+]?\d+)?/, "number.float"],
        [/\d+/, "number"],
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      string: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider("glsl", {
    triggerCharacters: [".", "_"],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      const prefix = String(word.word ?? "").toLowerCase();
      const matches = COMPLETION_WORDS.filter((w) =>
        !prefix ? true : w.toLowerCase().includes(prefix),
      ).slice(0, 120);
      const suggestions = matches.map((label) => {
        const kind = GLSL_KEYWORDS.includes(label)
          ? monaco.languages.CompletionItemKind.Keyword
          : GLSL_BUILTINS.includes(label)
            ? monaco.languages.CompletionItemKind.Function
            : monaco.languages.CompletionItemKind.Variable;
        return {
          label,
          kind,
          insertText: label,
          range,
        };
      });
      return { suggestions };
    },
  });
}

function ensureMonacoLoaded() {
  if (globalThis.monaco?.editor) return Promise.resolve(globalThis.monaco);
  if (_monacoLoadPromise) return _monacoLoadPromise;

  _monacoLoadPromise = new Promise((resolve) => {
    const done = (value) => resolve(value ?? null);
    const timeout = setTimeout(() => done(null), MONACO_LOAD_TIMEOUT_MS);

    loadScriptOnce(MONACO_LOADER_URL, MONACO_LOADER_SCRIPT_ID)
      .then(() => {
        const amdRequire = globalThis.require;
        if (
          typeof amdRequire !== "function" ||
          typeof amdRequire.config !== "function"
        ) {
          clearTimeout(timeout);
          done(null);
          return;
        }

        globalThis.MonacoEnvironment = globalThis.MonacoEnvironment ?? {};
        globalThis.MonacoEnvironment.getWorkerUrl = () => getMonacoWorkerUrl();

        amdRequire.config({
          paths: { vs: `${MONACO_CDN_BASE}/vs` },
        });
        amdRequire(
          ["vs/editor/editor.main"],
          () => {
            clearTimeout(timeout);
            const monaco = globalThis.monaco ?? null;
            if (monaco) configureMonaco(monaco);
            done(monaco);
          },
          () => {
            clearTimeout(timeout);
            done(null);
          },
        );
      })
      .catch(() => {
        clearTimeout(timeout);
        done(null);
      });
  });

  return _monacoLoadPromise;
}

function guessEditorHeightPx(textarea) {
  const styleHeight = Number.parseFloat(String(textarea.style.minHeight ?? "").replace("px", ""));
  if (Number.isFinite(styleHeight) && styleHeight >= 120) return styleHeight;
  const rows = Math.max(10, Number.parseInt(String(textarea.getAttribute("rows") ?? "16"), 10) || 16);
  return Math.max(200, rows * 18);
}

function enhanceSingleTextareaMonaco(textarea, monaco) {
  if (!(textarea instanceof HTMLTextAreaElement) || !monaco?.editor) return false;
  if (textarea.dataset.indyFxCodeEditorBound === "1") return true;
  if (textarea.closest("[data-indy-fx-code-editor-wrapper]")) return true;

  const parent = textarea.parentElement;
  if (!(parent instanceof HTMLElement)) return false;

  textarea.dataset.indyFxCodeEditorBound = "1";
  textarea.dataset.indyFxCodeEditorKind = "monaco";
  textarea.spellcheck = false;

  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-indy-fx-code-editor-wrapper", "1");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "0.25rem";
  wrapper.style.width = "100%";
  wrapper.style.maxWidth = "100%";
  wrapper.style.minWidth = "0";
  wrapper.style.flex = "1 1 auto";
  wrapper.style.width = "100%";
  wrapper.style.maxWidth = "100%";
  wrapper.style.minWidth = "0";
  wrapper.style.flex = "1 1 auto";

  const hint = document.createElement("div");
  hint.style.fontSize = "0.72rem";
  hint.style.opacity = "0.78";
  hint.style.fontFamily = "monospace";
  hint.textContent = "Monaco GLSL editor (Ctrl+Space autocomplete)";

  const host = document.createElement("div");
  host.setAttribute("data-indy-fx-monaco-host", "1");
  host.style.width = "100%";
  host.style.maxWidth = "100%";
  host.style.minWidth = "0";
  host.style.height = "100%";
  host.style.border = "none";
  host.style.borderRadius = "0";
  host.style.overflow = "hidden";

  const resizeHost = document.createElement("div");
  resizeHost.setAttribute("data-indy-fx-monaco-resize-host", "1");
  resizeHost.style.width = "100%";
  resizeHost.style.maxWidth = "100%";
  resizeHost.style.height = `${guessEditorHeightPx(textarea)}px`;
  resizeHost.style.minHeight = "180px";
  resizeHost.style.minWidth = "0";
  resizeHost.style.resize = "vertical";
  resizeHost.style.overflow = "auto";
  resizeHost.style.border = "1px solid var(--color-border-light-primary, rgba(255,255,255,0.16))";
  resizeHost.style.borderRadius = "6px";
  resizeHost.style.background = "var(--color-bg-option, #151515)";
  resizeHost.appendChild(host);

  parent.insertBefore(wrapper, textarea);
  wrapper.appendChild(hint);
  wrapper.appendChild(resizeHost);
  wrapper.appendChild(textarea);

  textarea.style.display = "none";
  textarea.style.width = "100%";

  const editor = monaco.editor.create(host, {
    value: String(textarea.value ?? ""),
    language: "glsl",
    theme: "indyfx-glsl-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "on",
    tabSize: 2,
    insertSpaces: true,
    lineNumbersMinChars: 3,
    suggest: { showWords: true },
  });

  let syncingFromEditor = false;
  let syncingFromTextarea = false;

  const syncTextareaFromEditor = () => {
    if (syncingFromTextarea) return;
    syncingFromEditor = true;
    textarea.value = editor.getValue();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    syncingFromEditor = false;
  };
  const syncEditorFromTextarea = () => {
    if (syncingFromEditor) return;
    syncingFromTextarea = true;
    const nextValue = String(textarea.value ?? "");
    if (editor.getValue() !== nextValue) {
      editor.setValue(nextValue);
    }
    syncingFromTextarea = false;
  };

  editor.onDidChangeModelContent(syncTextareaFromEditor);
  textarea.addEventListener("input", syncEditorFromTextarea);
  textarea.addEventListener("change", syncEditorFromTextarea);
  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => editor.layout())
      : null;
  resizeObserver?.observe(resizeHost);
  resizeObserver?.observe(wrapper);
  if (parent instanceof HTMLElement) {
    parent.style.minWidth = "0";
    parent.style.maxWidth = "100%";
    resizeObserver?.observe(parent);
  }
  // One extra layout pass after DOM settles to pick up dialog width changes.
  requestAnimationFrame(() => editor.layout());
  requestAnimationFrame(() => editor.layout());

  _activeMonacoEditors.add({ textarea, editor, resizeObserver });
  return true;
}

function enhanceSingleTextareaFallback(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) return false;
  if (textarea.dataset.indyFxCodeEditorBound === "1") return true;
  if (textarea.closest("[data-indy-fx-code-editor-wrapper]")) return true;

  const parent = textarea.parentElement;
  if (!(parent instanceof HTMLElement)) return false;

  textarea.dataset.indyFxCodeEditorBound = "1";
  textarea.dataset.indyFxCodeEditorKind = "fallback";
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.autocorrect = "off";
  textarea.style.fontFamily = "Consolas, Menlo, Monaco, monospace";
  textarea.style.lineHeight = "1.35";
  textarea.style.tabSize = "2";
  textarea.style.whiteSpace = "pre";
  textarea.style.overflowX = "auto";
  textarea.style.resize = "vertical";

  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-indy-fx-code-editor-wrapper", "1");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "0.25rem";

  const hint = document.createElement("div");
  hint.style.fontSize = "0.72rem";
  hint.style.opacity = "0.78";
  hint.style.fontFamily = "monospace";
  hint.textContent = "GLSL assist (fallback): Ctrl+Space autocomplete";

  const host = document.createElement("div");
  host.style.position = "relative";
  host.style.display = "block";
  host.style.width = "100%";
  host.style.maxWidth = "100%";
  host.style.minWidth = "0";

  const popup = document.createElement("div");
  popup.setAttribute("data-indy-fx-code-complete", "1");
  applyInlineStyle(popup, FALLBACK_POPUP_STYLE);

  parent.insertBefore(wrapper, textarea);
  wrapper.appendChild(hint);
  wrapper.appendChild(host);
  host.appendChild(textarea);
  host.appendChild(popup);

  let completionOpen = false;
  let completionItems = [];
  let completionIndex = 0;
  let replaceStart = 0;
  let replaceEnd = 0;

  const closePopup = () => {
    completionOpen = false;
    completionItems = [];
    completionIndex = 0;
    popup.style.display = "none";
    popup.innerHTML = "";
  };

  const applyCompletion = (word) => {
    const value = String(textarea.value ?? "");
    const next = `${value.slice(0, replaceStart)}${word}${value.slice(replaceEnd)}`;
    const nextPos = replaceStart + word.length;
    textarea.value = next;
    textarea.setSelectionRange(nextPos, nextPos);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    closePopup();
  };

  const renderPopup = () => {
    popup.innerHTML = "";
    for (let i = 0; i < completionItems.length; i += 1) {
      const word = completionItems[i];
      const row = document.createElement("div");
      row.style.padding = "0.2rem 0.38rem";
      row.style.borderRadius = "4px";
      row.style.cursor = "pointer";
      row.style.whiteSpace = "nowrap";
      row.style.overflow = "hidden";
      row.style.textOverflow = "ellipsis";
      row.textContent = word;
      if (i === completionIndex) {
        row.style.background =
          "var(--color-border-highlight-alt, rgba(80,160,255,0.28))";
      }
      row.addEventListener("mouseenter", () => {
        completionIndex = i;
        renderPopup();
      });
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        applyCompletion(word);
      });
      popup.appendChild(row);
    }
    popup.style.display = completionItems.length ? "block" : "none";
  };

  const openCompletions = ({ force = false } = {}) => {
    const caret = Number(textarea.selectionStart ?? 0);
    const span = getTokenSpan(textarea.value, caret);
    if (!force && span.token.length < 1) {
      closePopup();
      return;
    }
    completionItems = filterCompletions(span.token);
    if (!completionItems.length) {
      closePopup();
      return;
    }
    replaceStart = span.start;
    replaceEnd = span.end;
    completionIndex = 0;
    completionOpen = true;
    renderPopup();
  };

  textarea.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === " ") {
      event.preventDefault();
      openCompletions({ force: true });
      return;
    }

    if (completionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        completionIndex =
          (completionIndex + 1 + completionItems.length) % completionItems.length;
        renderPopup();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        completionIndex =
          (completionIndex - 1 + completionItems.length) % completionItems.length;
        renderPopup();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = completionItems[completionIndex];
        if (selected) applyCompletion(selected);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closePopup();
        return;
      }
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const start = Number(textarea.selectionStart ?? 0);
      const end = Number(textarea.selectionEnd ?? start);
      const value = String(textarea.value ?? "");
      textarea.value = `${value.slice(0, start)}  ${value.slice(end)}`;
      textarea.setSelectionRange(start + 2, start + 2);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  textarea.addEventListener("input", () => {
    if (completionOpen) openCompletions({ force: true });
  });
  textarea.addEventListener("keyup", (event) => {
    if (event.key === ".") openCompletions({ force: true });
  });
  textarea.addEventListener("blur", () => {
    setTimeout(() => closePopup(), 80);
  });
  return true;
}

function getTargetTextareas(root, selectors) {
  const out = [];
  const seen = new Set();
  for (const selector of selectors) {
    for (const el of root.querySelectorAll(selector)) {
      if (!(el instanceof HTMLTextAreaElement)) continue;
      if (seen.has(el)) continue;
      if (el.style.display === "none" || el.closest("[hidden]")) continue;
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

export function disposeShaderCodeEditors(root) {
  if (!(root instanceof Element)) return;
  for (const entry of Array.from(_activeMonacoEditors)) {
    const textarea = entry?.textarea;
    if (!(textarea instanceof HTMLTextAreaElement)) continue;
    if (!root.contains(textarea)) continue;
    try {
      entry?.resizeObserver?.disconnect?.();
      entry?.editor?.dispose?.();
    } catch (_err) {
      // Non-fatal.
    }
    _activeMonacoEditors.delete(entry);
    textarea.dataset.indyFxCodeEditorBound = "";
  }
}

export function enhanceShaderCodeEditors(
  root,
  {
    selectors = [
      'textarea[name="editSource"]',
      'textarea[name="editChannelSource"]',
      'textarea[name="importSource"]',
      "textarea[data-channel-source]",
    ],
  } = {},
) {
  if (!(root instanceof Element)) return;
  cleanupOrphanMonacoEditors();

  const targets = getTargetTextareas(root, selectors);
  if (!targets.length) return;

  for (const textarea of targets) {
    if (textarea.dataset.indyFxCodeEditorBound === "1") continue;
    if (textarea.dataset.indyFxCodeEditorPending === "1") continue;
    textarea.dataset.indyFxCodeEditorPending = "1";
    ensureMonacoLoaded().then((monaco) => {
      if (!textarea.isConnected) return;
      let done = false;
      if (monaco?.editor) done = enhanceSingleTextareaMonaco(textarea, monaco);
      if (!done) enhanceSingleTextareaFallback(textarea);
      textarea.dataset.indyFxCodeEditorPending = "";
    });
  }
}
