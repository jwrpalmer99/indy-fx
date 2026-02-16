const radialTextureCache = new Map();
const noiseTextureCache = new Map();
const solidTextureCache = new Map();
const circleMaskTextureCache = new Map();
const volumeNoiseAtlasCache = new Map();

export function getRadialTexture(size = 128, fadeStart = 0.8) {
  const safeFadeStart = Math.max(0, Math.min(0.999, Number(fadeStart) || 0.8));
  const key = `${size}:${safeFadeStart.toFixed(3)}`;
  const cached = radialTextureCache.get(key);
  if (cached) return cached;

  const canvasEl = document.createElement("canvas");
  canvasEl.width = canvasEl.height = size;
  const ctx = canvasEl.getContext("2d");

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.00, "rgba(255,255,255,1)");
  g.addColorStop(safeFadeStart, "rgba(255,255,255,1)");
  g.addColorStop(1.00, "rgba(255,255,255,0)");

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const texture = PIXI.Texture.from(canvasEl);
  radialTextureCache.set(key, texture);
  return texture;
}

export function getNoiseTexture(size = 256, mode = "gray") {
  const key = `${size}:${mode}`;
  const cached = noiseTextureCache.get(key);
  if (cached) return cached;

  const canvasEl = document.createElement("canvas");
  canvasEl.width = canvasEl.height = size;
  const ctx = canvasEl.getContext("2d");
  const img = ctx.createImageData(size, size);

  for (let i = 0; i < img.data.length; i += 4) {
    if (mode === "rgb") {
      img.data[i] = (Math.random() * 255) | 0;
      img.data[i + 1] = (Math.random() * 255) | 0;
      img.data[i + 2] = (Math.random() * 255) | 0;
    } else if (mode === "bw") {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
    } else {
      const v = (Math.random() * 255) | 0;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
    }
    img.data[i + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  const texture = PIXI.Texture.from(canvasEl);

  if (texture.baseTexture) {
    texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    texture.baseTexture.update();
  }

  noiseTextureCache.set(key, texture);
  return texture;
}

export function getSolidTexture(color = [0, 0, 0, 255], size = 2) {
  const key = `${size}:${color.join(",")}`;
  const cached = solidTextureCache.get(key);
  if (cached) return cached;

  const canvasEl = document.createElement("canvas");
  canvasEl.width = canvasEl.height = size;
  const ctx = canvasEl.getContext("2d");
  const img = ctx.createImageData(size, size);

  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = color[0];
    img.data[i + 1] = color[1];
    img.data[i + 2] = color[2];
    img.data[i + 3] = color[3];
  }

  ctx.putImageData(img, 0, 0);
  const texture = PIXI.Texture.from(canvasEl);
  solidTextureCache.set(key, texture);
  return texture;
}

export function getCircleMaskTexture(size = 128) {
  const cached = circleMaskTextureCache.get(size);
  if (cached) return cached;

  const canvasEl = document.createElement("canvas");
  canvasEl.width = canvasEl.height = size;
  const ctx = canvasEl.getContext("2d");
  const r = size * 0.5;

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(r, r, Math.max(0, r - 1), 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fill();

  const texture = PIXI.Texture.from(canvasEl);
  circleMaskTextureCache.set(size, texture);
  return texture;
}

function fract(value) {
  return value - Math.floor(value);
}

function smoothstep01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hash3(x, y, z, seed = 0) {
  const n =
    Math.sin(
      x * 127.1 +
      y * 311.7 +
      z * 74.7 +
      seed * 19.19,
    ) * 43758.5453123;
  return fract(n);
}

function valueNoise3(x, y, z, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = smoothstep01(x - xi);
  const ty = smoothstep01(y - yi);
  const tz = smoothstep01(z - zi);

  const c000 = hash3(xi + 0, yi + 0, zi + 0, seed);
  const c100 = hash3(xi + 1, yi + 0, zi + 0, seed);
  const c010 = hash3(xi + 0, yi + 1, zi + 0, seed);
  const c110 = hash3(xi + 1, yi + 1, zi + 0, seed);
  const c001 = hash3(xi + 0, yi + 0, zi + 1, seed);
  const c101 = hash3(xi + 1, yi + 0, zi + 1, seed);
  const c011 = hash3(xi + 0, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);

  const x00 = lerp(c000, c100, tx);
  const x10 = lerp(c010, c110, tx);
  const x01 = lerp(c001, c101, tx);
  const x11 = lerp(c011, c111, tx);

  const y0 = lerp(x00, x10, ty);
  const y1 = lerp(x01, x11, ty);
  return lerp(y0, y1, tz);
}

export function getVolumeNoiseAtlasTexture({
  tileSize = 32,
  tilesX = 8,
  tilesY = 4,
  depth = 32,
  mode = "rgb",
  seed = 0,
} = {}) {
  const safeTileSize = Math.max(4, Math.round(Number(tileSize) || 32));
  const safeTilesX = Math.max(1, Math.round(Number(tilesX) || 8));
  const safeTilesY = Math.max(1, Math.round(Number(tilesY) || 4));
  const maxDepth = safeTilesX * safeTilesY;
  const safeDepth = Math.max(1, Math.min(maxDepth, Math.round(Number(depth) || 32)));
  const safeMode = String(mode ?? "rgb").toLowerCase() === "bw" ? "bw" : "rgb";
  const safeSeed = Math.round(Number(seed) || 0);
  const key = [
    safeTileSize,
    safeTilesX,
    safeTilesY,
    safeDepth,
    safeMode,
    safeSeed,
  ].join(":");
  const cached = volumeNoiseAtlasCache.get(key);
  if (cached) return cached;

  const width = safeTileSize * safeTilesX;
  const height = safeTileSize * safeTilesY;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext("2d");
  const img = ctx.createImageData(width, height);

  const spatialScale = 0.18;
  const depthScale = 0.24;
  for (let z = 0; z < safeDepth; z += 1) {
    const tileX = z % safeTilesX;
    const tileY = Math.floor(z / safeTilesX);
    const ox = tileX * safeTileSize;
    const oy = tileY * safeTileSize;

    for (let y = 0; y < safeTileSize; y += 1) {
      for (let x = 0; x < safeTileSize; x += 1) {
        const px = ox + x;
        const py = oy + y;
        const idx = (py * width + px) * 4;

        const nx = x * spatialScale;
        const ny = y * spatialScale;
        const nz = z * depthScale;

        let r = valueNoise3(nx, ny, nz, safeSeed + 11);
        let g = safeMode === "bw"
          ? r
          : valueNoise3(nx + 17.2, ny + 5.1, nz + 9.7, safeSeed + 23);
        let b = safeMode === "bw"
          ? r
          : valueNoise3(nx + 3.4, ny + 19.8, nz + 14.3, safeSeed + 41);

        // Gentle contrast boost so the field has useful structure for fbm.
        r = Math.pow(r, 0.8);
        g = Math.pow(g, 0.8);
        b = Math.pow(b, 0.8);

        img.data[idx] = Math.max(0, Math.min(255, Math.floor(r * 255)));
        img.data[idx + 1] = Math.max(0, Math.min(255, Math.floor(g * 255)));
        img.data[idx + 2] = Math.max(0, Math.min(255, Math.floor(b * 255)));
        img.data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  const texture = PIXI.Texture.from(canvasEl);
  if (texture.baseTexture) {
    texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    texture.baseTexture.update();
  }

  const result = {
    texture,
    resolution: [width, height],
    layout: [safeTilesX, safeTilesY, safeDepth],
  };
  volumeNoiseAtlasCache.set(key, result);
  return result;
}
