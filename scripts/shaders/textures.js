const radialTextureCache = new Map();
const noiseTextureCache = new Map();
const solidTextureCache = new Map();
const circleMaskTextureCache = new Map();

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
