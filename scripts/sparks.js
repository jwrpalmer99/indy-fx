import { getRadialTexture } from "./shaders/textures.js";

export function createSparksController({
  moduleId,
  getWorldCfg,
  getClientCfg,
  getTokenCenter,
  worldPointFromPointerEvent,
  broadcastPlayAtPoint,
  unitDir,
  rand,
  lerpColor,
  darken
}) {
  let sparksPlacementCleanup = null;

async function playSparksAtOrigin(origin, opts = {}, edgeSourceSizePx = null) {
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return;

  // Load GSAP from Foundry bundle
  const mod = await import("/scripts/greensock/esm/all.js");
  const { gsap, PixiPlugin } = mod;
  gsap.registerPlugin(PixiPlugin);
  PixiPlugin.registerPIXI(PIXI);

  const w = getWorldCfg(moduleId);
  const c = getClientCfg(moduleId);

  // Allow per-call overrides (optional)
  const cfg = foundry.utils.mergeObject(
    { ...w },
    opts,
    { inplace: false }
  );

  const layer =
    cfg.layer === "effects" ? canvas.effects :
    cfg.layer === "interface" ? canvas.interface :
    (canvas.interface.primary ?? canvas.interface);

  const edgeSize = Number.isFinite(edgeSourceSizePx) && edgeSourceSizePx > 0
    ? edgeSourceSizePx
    : (canvas.grid?.size ?? 100);
  const tokenEdgeR = edgeSize * cfg.edgeFactor;

  const COUNT = Math.max(1, Math.floor(cfg.count * c.mult));

  // FX container (so bloom applies once)
  const fx = new PIXI.Container();
  fx.zIndex = 9000;
  layer.addChild(fx);

  const shouldBloom = cfg.useBloom && !c.disableBloom && !!PIXI.filters?.BloomFilter;
  if (shouldBloom) {
    fx.filters = [new PIXI.filters.BloomFilter(cfg.bloomStrength, cfg.bloomBlur, 2)];
  }

  const sparks = [];
  const tweens = [];

  const radialTex = getRadialTexture();

  for (let i = 0; i < COUNT; i++) {
    const dir = unitDir();

    const life = rand(cfg.lifeMin, cfg.lifeMax);
    const speed = rand(cfg.speedMin, cfg.speedMax);
    const dist = speed * life;

    const startR = cfg.startAtEdge ? rand(tokenEdgeR * 0.7, tokenEdgeR * 1.2) : rand(0, 6);
    const sx = origin.x + dir.x * startR;
    const sy = origin.y + dir.y * startR;

    const dx = dir.x * dist;
    const dy = dir.y * dist;

    const t = Math.random();
    const fill = lerpColor(cfg.colorA, cfg.colorB, t);
    const stroke = darken(fill, 0.65);
    const radius = rand(cfg.radiusMin, cfg.radiusMax);

    // One particle = container with soft glow sprite + core circle
    const p = new PIXI.Container();
    p.position.set(sx, sy);
    p.alpha = 1;

    // Soft-edge glow (sprite with radial gradient texture)
    const glow = new PIXI.Sprite(radialTex);
    glow.anchor.set(0.5);
    glow.width = glow.height = radius * cfg.glowScale * 2;
    glow.tint = fill;
    glow.alpha = cfg.glowAlpha;
    glow.blendMode = PIXI.BLEND_MODES.ADD;

    // Hot core (Graphics)
    const core = new PIXI.Graphics();
    core.beginFill(fill, 1);
    core.drawCircle(0, 0, radius);
    core.endFill();

    core.lineStyle(cfg.outlineWidth, stroke, 1);
    core.drawCircle(0, 0, radius);

    core.blendMode = PIXI.BLEND_MODES.ADD;

    p.addChild(glow, core);
    fx.addChild(p);

    sparks.push(p);

    const dly = Math.random() * 0.04;

    // Pure radial launch (no gravity)
    tweens.push(gsap.to(p, {
      duration: life,
      delay: dly,
      x: sx + dx,
      y: sy + dy,
      ease: "power3.out"
    }));

    tweens.push(gsap.to(p, {
      duration: life,
      delay: dly,
      pixi: { scale: 0.15 },
      ease: "power2.out"
    }));

    tweens.push(gsap.to(p, {
      duration: life * 0.55,
      delay: dly + life * 0.25,
      alpha: 0,
      ease: "power2.in"
    }));
  }

  const CLEANUP_MS = Math.ceil((cfg.lifeMax + 0.6) * 1000);
  setTimeout(() => {
    for (const t of tweens) t.kill();
    for (const s of sparks) s.destroy({ children: true });
    fx.destroy({ children: true });
  }, CLEANUP_MS);
}

async function playSparksAtPoint(point, opts = {}) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  await playSparksAtOrigin({ x, y }, opts, Number(opts?.edgeSourceSizePx));
}

async function playSparksAtToken(tokenId, opts = {}) {
  const tok = canvas.tokens?.get(tokenId);
  if (!tok) return;
  const origin = getTokenCenter(tok);
  const edgeSourceSizePx = Math.max(tok.w ?? 1, tok.h ?? 1);
  await playSparksAtOrigin(origin, opts, edgeSourceSizePx);
}

function drawSparksPlacementPreview(gfx, point) {
  if (!gfx || !point) return;
  gfx.clear();
  gfx.lineStyle(2, 0xffaa00, 0.95);
  gfx.beginFill(0xffaa00, 0.12);
  gfx.drawCircle(point.x, point.y, 18);
  gfx.endFill();
  gfx.moveTo(point.x - 12, point.y);
  gfx.lineTo(point.x + 12, point.y);
  gfx.moveTo(point.x, point.y - 12);
  gfx.lineTo(point.x, point.y + 12);
}

function cancelSparksPlacement(notify = false) {
  if (!sparksPlacementCleanup) return;
  sparksPlacementCleanup();
  sparksPlacementCleanup = null;
  if (notify) ui.notifications.info("Sparks placement cancelled.");
}

function startSparksPlacement(opts = {}) {
  cancelSparksPlacement(false);
  const previewLayer = canvas.interface?.primary ?? canvas.interface ?? canvas.stage;
  const preview = new PIXI.Graphics();
  preview.zIndex = 999999;
  preview.eventMode = "none";
  previewLayer.addChild(preview);
  previewLayer.sortChildren?.();

  const effectOpts = foundry.utils.mergeObject({}, opts, { inplace: false });
  const broadcast = effectOpts.broadcast === true;
  delete effectOpts.broadcast;

  const onMove = (event) => {
    const p = worldPointFromPointerEvent(event);
    if (!p) return;
    drawSparksPlacementPreview(preview, p);
  };

  const finish = (point) => {
    cancelSparksPlacement(false);
    if (broadcast) broadcastPlayAtPoint({ point, opts: effectOpts });
    else playSparksAtPoint(point, effectOpts);
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
    cancelSparksPlacement(true);
  };

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelSparksPlacement(true);
    }
  };

  canvas.stage.on("pointermove", onMove);
  canvas.stage.on("pointerdown", onDown);
  canvas.stage.on("rightdown", onRightDown);
  window.addEventListener("keydown", onKey, true);

  sparksPlacementCleanup = () => {
    canvas.stage.off("pointermove", onMove);
    canvas.stage.off("pointerdown", onDown);
    canvas.stage.off("rightdown", onRightDown);
    window.removeEventListener("keydown", onKey, true);
    preview.destroy({ children: true });
  };

  ui.notifications.info("Move mouse and left-click to place sparks. Right-click or Esc to cancel.");
}

  return {
    playSparksAtOrigin,
    playSparksAtPoint,
    playSparksAtToken,
    drawSparksPlacementPreview,
    startSparksPlacement,
    cancelSparksPlacement
  };
}
