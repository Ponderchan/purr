import { useEffect, useRef, useState } from 'preact/hooks';
import {
  Application,
  Container,
  DisplacementFilter,
  Graphics,
  ImageSource,
  RenderTexture,
  Sprite,
  Texture,
} from 'pixi.js';
import armPhotoUrl from '../assets/photo/arm.webp';
import { cleanCutoutEdges } from './cleanEdges';
import {
  PurrAudio,
  readMutedPreference,
  writeMutedPreference,
} from './purr';

export interface PetStageProps {
  imageUrl: string;
  bgUrl: string;
  catName?: string;
}

type PetMood = 'idle' | 'petting' | 'purring' | 'melt' | 'nip';

const DISP_SIZE = 256;
const NEUTRAL_RGBA = [128 / 255, 128 / 255, 128 / 255, 1];
const TOUCH_OFFSET_Y = 44;
const BRUSH_POOL_SIZE = 12;

// Measured once from src/assets/photo/arm.png (1440 x 2912):
// - Index/middle/ring fingertip pads (petting contact center): (0.525, 0.148)
// - Palm + thumb span at y = 0.25: 557 / 1440 = 0.387
// - Bottom sleeve spans x = [0.259 .. 0.725] at y = 1.000 (max half-width from centerline = 0.245)
const ARM_FINGERTIP_U = 0.525;
const ARM_FINGERTIP_V = 0.148;
const ARM_PALM_WIDTH_RATIO = 0.387;
const ARM_SLEEVE_HALF_WIDTH_RATIO = 0.245;

// Off-screen arm pivot (bottom-right)
const ARM_PIVOT_X_RATIO = 0.75;
const ARM_PIVOT_Y_RATIO = 1.2;

// Warm arm colour grading: #fff0de multiply tint with ~5% lower brightness (0xf2e4d3)
const ARM_WARM_TINT = 0xf2e4d3;

// Shadow tuning (light comes from the left -> shadows fall to the right and slightly down)
const CAT_AO_SHADOW_OFFSET = 2;
const CAT_AO_SHADOW_OPACITY = 0.45;
const CAT_SOFT_SHADOW_OFFSET = 10;
const CAT_SOFT_SHADOW_OPACITY = 0.3;
const ARM_SHADOW_TIGHT_OFFSET_X = 14;
const ARM_SHADOW_TIGHT_OFFSET_Y = 6;
const ARM_SHADOW_TIGHT_OPACITY = 0.4;
const ARM_SHADOW_LIFTED_OFFSET_X = 30;
const ARM_SHADOW_LIFTED_OFFSET_Y = 14;
const ARM_SHADOW_LIFTED_OPACITY = 0.28;
const ARM_LIFT_TRANSITION_SEC = 0.15;

// Purr meter pacing: steady petting ~25-30 s to 100%, idle drain 1%/s after 2 s idle
const METER_CAT_WIDTHS_TO_FULL = 20;
const METER_MAX_FILL_PER_SEC = 0.0385; // caps sustained fill at ~26 s regardless of refresh rate
const METER_RATE_BUCKET_MAX = 0.02;
const METER_IDLE_DELAY_SEC = 2.0;
const METER_IDLE_DRAIN_PER_SEC = 0.01;

let hasLoggedPixiFailure = false;

interface StrokeSample {
  x: number;
  y: number;
  t: number;
}

interface HitMask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  visibleWidthFrac: number;
  visibleHeightFrac: number;
}

interface ShadowTextureInfo {
  texture: Texture;
  contentW: number;
  contentH: number;
  padPx: number;
  canvasW: number;
  canvasH: number;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img
          .decode()
          .catch(() => undefined)
          .finally(() => resolve(img));
      } else {
        resolve(img);
      }
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

function createOwnedTexture(
  resource: HTMLImageElement | HTMLCanvasElement,
): Texture {
  return new Texture({
    source: new ImageSource({ resource }),
  });
}

function getImageSourceDimensions(
  src: HTMLImageElement | HTMLCanvasElement,
  fallbackW: number,
  fallbackH: number,
): { width: number; height: number } {
  if (src instanceof HTMLImageElement) {
    return {
      width: src.naturalWidth || fallbackW,
      height: src.naturalHeight || fallbackH,
    };
  }
  return {
    width: src.width || fallbackW,
    height: src.height || fallbackH,
  };
}

function buildHitMask(
  src: HTMLImageElement | HTMLCanvasElement,
  fallbackW: number,
  fallbackH: number,
): HitMask | null {
  const { width: natW, height: natH } = getImageSourceDimensions(
    src,
    fallbackW,
    fallbackH,
  );
  const scale = Math.min(1, 256 / Math.max(natW, natH));
  const width = Math.max(1, Math.round(natW * scale));
  const height = Math.max(1, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(src, 0, 0, width, height);
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (data[(row + x) * 4 + 3] > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const visibleWidthFrac =
      maxX >= minX ? clamp((maxX - minX + 1) / width, 0.25, 1) : 1;
    const visibleHeightFrac =
      maxY >= minY ? clamp((maxY - minY + 1) / height, 0.25, 1) : 1;

    return { width, height, data, visibleWidthFrac, visibleHeightFrac };
  } catch {
    return null;
  }
}

function blurAlphaBuffer(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  passes = 3,
): Float32Array {
  if (radius <= 0) return src;
  const r = Math.max(1, Math.round(radius));
  const win = 2 * r + 1;
  const invWin = 1 / win;
  const a = src;
  const b = new Float32Array(width * height);

  for (let pass = 0; pass < passes; pass++) {
    // Horizontal running-sum pass: a -> b
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = a[row] * (r + 1);
      for (let i = 1; i <= r; i++) {
        sum += a[row + Math.min(i, width - 1)];
      }
      for (let x = 0; x < width; x++) {
        b[row + x] = sum * invWin;
        const addIdx = Math.min(x + r + 1, width - 1);
        const subIdx = Math.max(x - r, 0);
        sum += a[row + addIdx] - a[row + subIdx];
      }
    }

    // Vertical running-sum pass: b -> a
    for (let x = 0; x < width; x++) {
      let sum = b[x] * (r + 1);
      for (let i = 1; i <= r; i++) {
        sum += b[Math.min(i, height - 1) * width + x];
      }
      for (let y = 0; y < height; y++) {
        a[y * width + x] = sum * invWin;
        const addRow = Math.min(y + r + 1, height - 1);
        const subRow = Math.max(y - r, 0);
        sum += b[addRow * width + x] - b[subRow * width + x];
      }
    }
  }

  return a;
}

/**
 * Builds a blurred warm-dark silhouette texture from an image's alpha channel.
 * Using a separable 3-pass box blur ensures identical soft Gaussian edges across
 * Chrome, Safari iOS and Firefox without per-frame BlurFilter overhead.
 */
function createSilhouetteShadowTexture(
  src: HTMLImageElement | HTMLCanvasElement,
  maxContentDim: number,
  blurRadiusPx: number,
  padPx: number,
  rgb: readonly [number, number, number],
  extendBottomEdge = false,
  blurPasses = 3,
): ShadowTextureInfo {
  const { width: natW, height: natH } = getImageSourceDimensions(src, 512, 512);
  const scale = Math.min(1, maxContentDim / Math.max(natW, natH));
  const contentW = Math.max(1, Math.round(natW * scale));
  const contentH = Math.max(1, Math.round(natH * scale));
  const canvasW = contentW + padPx * 2;
  const canvasH = contentH + padPx * 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (ctx) {
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(src, padPx, padPx, contentW, contentH);
    const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
    const pixels = imageData.data;
    const alphaBuf = new Float32Array(canvasW * canvasH);

    for (let i = 0; i < alphaBuf.length; i++) {
      alphaBuf[i] = pixels[i * 4 + 3];
    }

    if (extendBottomEdge) {
      const lastContentRow = padPx + contentH - 1;
      for (let y = lastContentRow + 1; y < canvasH; y++) {
        const dstRow = y * canvasW;
        const srcRow = lastContentRow * canvasW;
        for (let x = 0; x < canvasW; x++) {
          alphaBuf[dstRow + x] = alphaBuf[srcRow + x];
        }
      }
    }

    const blurred = blurAlphaBuffer(
      alphaBuf,
      canvasW,
      canvasH,
      blurRadiusPx,
      blurPasses,
    );
    const [r, g, b] = rgb;
    for (let i = 0; i < blurred.length; i++) {
      const a = Math.min(255, Math.max(0, Math.round(blurred[i])));
      const idx = i * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = a;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return {
    texture: createOwnedTexture(canvas),
    contentW,
    contentH,
    padPx,
    canvasW,
    canvasH,
  };
}

function createSoftBrushCanvas(size = 64): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.78)');
    grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.24)');
    grad.addColorStop(0.85, 'rgba(255, 255, 255, 0.05)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

function createVignetteCanvas(
  size: number,
  centerX: number,
  centerY: number,
  edgeAlpha: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cx = size * centerX;
    const cy = size * centerY;
    const grad = ctx.createRadialGradient(
      cx,
      cy,
      size * 0.34,
      cx,
      cy,
      size * 0.78,
    );
    grad.addColorStop(0, 'rgba(20, 13, 8, 0)');
    grad.addColorStop(0.58, `rgba(20, 13, 8, ${(edgeAlpha * 0.25).toFixed(3)})`);
    grad.addColorStop(0.84, `rgba(18, 11, 7, ${(edgeAlpha * 0.65).toFixed(3)})`);
    grad.addColorStop(1, `rgba(16, 10, 6, ${edgeAlpha.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

function createSharedWarmLightCanvas(size = 512): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Directional warm afternoon sunlight entering from the left window
    const linear = ctx.createLinearGradient(0, size * 0.22, size * 0.86, size * 0.68);
    linear.addColorStop(0, 'rgba(255, 224, 174, 0.22)');
    linear.addColorStop(0.32, 'rgba(255, 214, 158, 0.11)');
    linear.addColorStop(0.68, 'rgba(255, 206, 146, 0.03)');
    linear.addColorStop(1, 'rgba(255, 200, 140, 0)');
    ctx.fillStyle = linear;
    ctx.fillRect(0, 0, size, size);

    // Subtle soft sunlit glow concentrated along the upper-left edge
    const radial = ctx.createRadialGradient(
      0,
      size * 0.24,
      0,
      0,
      size * 0.24,
      size * 0.72,
    );
    radial.addColorStop(0, 'rgba(255, 232, 190, 0.10)');
    radial.addColorStop(0.55, 'rgba(255, 220, 168, 0.04)');
    radial.addColorStop(1, 'rgba(255, 210, 152, 0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

function moodCaption(mood: PetMood): string {
  switch (mood) {
    case 'nip':
      return 'Easy there…';
    case 'melt':
      return 'Pure bliss';
    case 'purring':
      return 'Purring';
    case 'petting':
      return 'Warming up…';
    default:
      return 'Stroke to pet';
  }
}

export function PetStage({ imageUrl, bgUrl, catName }: PetStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const meterFillRef = useRef<HTMLDivElement | null>(null);
  const purrRef = useRef<PurrAudio | null>(null);

  const [muted, setMuted] = useState<boolean>(() => readMutedPreference());
  const mutedRef = useRef<boolean>(muted);
  const [meterPct, setMeterPct] = useState<number>(0);
  const [mood, setMood] = useState<PetMood>('idle');
  const [handOverStage, setHandOverStage] = useState<boolean>(false);
  const [initFailed, setInitFailed] = useState<boolean>(false);

  const toggleMute = () => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      writeMutedPreference(next);
      const audio = purrRef.current;
      if (audio) {
        if (!next) {
          audio.unlock();
        }
        audio.setMuted(next);
      }
      return next;
    });
  };

  useEffect(() => {
    const stageEl = stageRef.current;
    const canvasHost = canvasHostRef.current;
    if (!stageEl || !canvasHost) return;

    let cancelled = false;
    setInitFailed(false);

    const purr = new PurrAudio(mutedRef.current);
    purrRef.current = purr;

    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let reducedMotion = motionQuery?.matches ?? false;

    const app = new Application();
    let appInitialized = false;
    let resizeObserver: ResizeObserver | null = null;
    let cleanupEvents: (() => void) | null = null;

    // Owned textures & filters to destroy cleanly on unmount
    let dispMap: RenderTexture | null = null;
    let bgTexture: Texture | null = null;
    let bgVignetteTexture: Texture | null = null;
    let catTexture: Texture | null = null;
    let catAoShadowTexture: Texture | null = null;
    let catSoftShadowTexture: Texture | null = null;
    let armTexture: Texture | null = null;
    let armShadowTightTexture: Texture | null = null;
    let armShadowLiftedTexture: Texture | null = null;
    let warmLightTexture: Texture | null = null;
    let sceneVignetteTexture: Texture | null = null;
    let brushTexture: Texture | null = null;
    let displacementFilter: DisplacementFilter | null = null;
    let dispClearContainer: Container | null = null;
    let dispFadeContainer: Container | null = null;
    let stampContainer: Container | null = null;

    const getResolution = () => Math.min(window.devicePixelRatio || 1, 2);

    const safeDestroy = () => {
      cleanupEvents?.();
      cleanupEvents = null;
      resizeObserver?.disconnect();
      resizeObserver = null;

      purr.destroy();
      if (purrRef.current === purr) {
        purrRef.current = null;
      }

      if (appInitialized) {
        try {
          app.ticker.stop();
        } catch {
          // Ignore if already stopped
        }

        dispClearContainer?.destroy({ children: true });
        dispFadeContainer?.destroy({ children: true });
        stampContainer?.destroy({ children: true });
        dispClearContainer = null;
        dispFadeContainer = null;
        stampContainer = null;

        // Detach stage children before freeing filters and textures while GL context is live
        app.stage.removeChildren().forEach((child) => {
          child.filters = null;
          child.destroy({ children: true });
        });

        displacementFilter?.destroy();
        displacementFilter = null;

        dispMap?.destroy(true);
        bgTexture?.destroy(true);
        bgVignetteTexture?.destroy(true);
        catTexture?.destroy(true);
        catAoShadowTexture?.destroy(true);
        catSoftShadowTexture?.destroy(true);
        armTexture?.destroy(true);
        armShadowTightTexture?.destroy(true);
        armShadowLiftedTexture?.destroy(true);
        warmLightTexture?.destroy(true);
        sceneVignetteTexture?.destroy(true);
        brushTexture?.destroy(true);

        dispMap = null;
        bgTexture = null;
        bgVignetteTexture = null;
        catTexture = null;
        catAoShadowTexture = null;
        catSoftShadowTexture = null;
        armTexture = null;
        armShadowTightTexture = null;
        armShadowLiftedTexture = null;
        warmLightTexture = null;
        sceneVignetteTexture = null;
        brushTexture = null;

        app.destroy({ removeView: true }, { children: true });
      }
    };

    const start = async () => {
      const initialW = Math.max(1, stageEl.clientWidth || window.innerWidth || 360);
      const initialH = Math.max(1, stageEl.clientHeight || window.innerHeight || 640);

      // Require WebGL explicitly (array preference blocks silent CanvasRenderer fallback)
      await app.init({
        width: initialW,
        height: initialH,
        resolution: getResolution(),
        autoDensity: true,
        backgroundAlpha: 1,
        backgroundColor: 0x241c15,
        antialias: true,
        preference: ['webgl'],
      });
      appInitialized = true;

      if (cancelled) {
        safeDestroy();
        return;
      }

      const canvas = app.canvas;
      canvas.className = 'pet-canvas';
      canvas.style.touchAction = 'none';
      canvasHost.appendChild(canvas);

      // Load real photo assets in parallel
      const [bgImg, catImg, armImg] = await Promise.all([
        loadImage(bgUrl),
        loadImage(imageUrl),
        loadImage(armPhotoUrl),
      ]);

      if (cancelled) {
        safeDestroy();
        return;
      }

      // Clean light cut-out fringes at runtime (erode ~1.5 px, feather ~1 px, decontaminate edge RGB)
      const cleanedCatCanvas = cleanCutoutEdges(catImg, {
        erodePx: 1.5,
        featherPx: 1.0,
      });

      const hitMask = buildHitMask(cleanedCatCanvas, 1536, 1536);

      bgTexture = createOwnedTexture(bgImg);
      bgVignetteTexture = createOwnedTexture(
        createVignetteCanvas(512, 0.5, 0.5, 0.14),
      );
      catTexture = createOwnedTexture(cleanedCatCanvas);
      armTexture = createOwnedTexture(armImg);
      brushTexture = createOwnedTexture(createSoftBrushCanvas(64));
      warmLightTexture = createOwnedTexture(createSharedWarmLightCanvas(512));
      sceneVignetteTexture = createOwnedTexture(
        createVignetteCanvas(512, 0.46, 0.47, 0.24),
      );

      // Build two-layer cat contact shadows from cleaned cat alpha (falling down-right)
      // 1) Wide soft cast shadow: blur ~26 px, offset ~10 px down-right, ~30% opacity
      const catSoftShadowInfo = createSilhouetteShadowTexture(
        cleanedCatCanvas,
        440,
        10,
        56,
        [16, 10, 6],
        false,
        3,
      );
      catSoftShadowTexture = catSoftShadowInfo.texture;

      // 2) Tight ambient-occlusion contact shadow: blur ~4 px, offset ~2 px down-right, ~45% darkness
      const catAoShadowInfo = createSilhouetteShadowTexture(
        cleanedCatCanvas,
        512,
        2,
        16,
        [16, 10, 6],
        false,
        2,
      );
      catAoShadowTexture = catAoShadowInfo.texture;

      // Arm tight shadow (pressing on cat): offset (+14, +6) px, blur ~10 px, ~40%
      const armTightShadowInfo = createSilhouetteShadowTexture(
        armImg,
        512,
        2,
        20,
        [14, 9, 5],
        true,
        3,
      );
      armShadowTightTexture = armTightShadowInfo.texture;

      // Arm lifted shadow (hovering off cat): offset (+30, +14) px, blur ~24 px, ~28%
      const armLiftedShadowInfo = createSilhouetteShadowTexture(
        armImg,
        512,
        5,
        36,
        [14, 9, 5],
        true,
        3,
      );
      armShadowLiftedTexture = armLiftedShadowInfo.texture;

      // RenderTexture displacement map (256x256 mapped to cat bounds)
      dispMap = RenderTexture.create({
        width: DISP_SIZE,
        height: DISP_SIZE,
        resolution: 1,
      });
      dispMap.source.style.addressMode = 'clamp-to-edge';

      dispClearContainer = new Container();
      const clearDispMap = () => {
        if (!dispMap || !dispClearContainer) return;
        app.renderer.render({
          container: dispClearContainer,
          target: dispMap,
          clear: true,
          clearColor: NEUTRAL_RGBA,
        });
      };
      clearDispMap();

      // Neutral grey fade rect rendered each active frame (~500 ms decay)
      dispFadeContainer = new Container();
      const dispFadeRect = new Graphics()
        .rect(0, 0, DISP_SIZE, DISP_SIZE)
        .fill(0x808080);
      dispFadeContainer.addChild(dispFadeRect);

      // Pooled soft brush sprites stretched along stroke direction
      stampContainer = new Container();
      const brushPool: Sprite[] = [];
      for (let i = 0; i < BRUSH_POOL_SIZE; i++) {
        const s = new Sprite(brushTexture);
        s.anchor.set(0.5);
        s.visible = false;
        stampContainer.addChild(s);
        brushPool.push(s);
      }

      // === Layer (a): Background photo (cover-fit) + very subtle vignette ===
      const bgSprite = new Sprite(bgTexture);
      bgSprite.anchor.set(0.5);
      app.stage.addChild(bgSprite);

      const bgVignetteSprite = new Sprite(bgVignetteTexture);
      bgVignetteSprite.blendMode = 'multiply';
      app.stage.addChild(bgVignetteSprite);

      // === Layer (b): Two-layer cat contact shadow (wide soft cast + tight AO) ===
      const catSoftShadowSprite = new Sprite(catSoftShadowTexture);
      catSoftShadowSprite.anchor.set(0.5);
      catSoftShadowSprite.blendMode = 'multiply';
      catSoftShadowSprite.alpha = CAT_SOFT_SHADOW_OPACITY;
      app.stage.addChild(catSoftShadowSprite);

      const catAoShadowSprite = new Sprite(catAoShadowTexture);
      catAoShadowSprite.anchor.set(0.5);
      catAoShadowSprite.blendMode = 'multiply';
      catAoShadowSprite.alpha = CAT_AO_SHADOW_OPACITY;
      app.stage.addChild(catAoShadowSprite);

      // === Layer (c): Cat photo with fur displacement ===
      const catContainer = new Container();
      app.stage.addChild(catContainer);

      const catSprite = new Sprite(catTexture);
      catSprite.anchor.set(0.5);
      catContainer.addChild(catSprite);

      const dispSprite = new Sprite(dispMap);
      dispSprite.anchor.set(0.5);
      dispSprite.width = catTexture.width;
      dispSprite.height = catTexture.height;
      catContainer.addChild(dispSprite);

      displacementFilter = new DisplacementFilter({
        sprite: dispSprite,
        scale: reducedMotion ? 5 : 11,
        padding: 24,
      });
      catSprite.filters = [displacementFilter];

      // === Layer (d): Arm shadows (tight when pressing on cat, lifted when hovering off) ===
      const armTightAnchorX =
        (armTightShadowInfo.padPx + ARM_FINGERTIP_U * armTightShadowInfo.contentW) /
        armTightShadowInfo.canvasW;
      const armTightAnchorY =
        (armTightShadowInfo.padPx + ARM_FINGERTIP_V * armTightShadowInfo.contentH) /
        armTightShadowInfo.canvasH;
      const armTightScaleRatioX = armTexture.width / armTightShadowInfo.contentW;
      const armTightScaleRatioY = armTexture.height / armTightShadowInfo.contentH;

      const armLiftedAnchorX =
        (armLiftedShadowInfo.padPx + ARM_FINGERTIP_U * armLiftedShadowInfo.contentW) /
        armLiftedShadowInfo.canvasW;
      const armLiftedAnchorY =
        (armLiftedShadowInfo.padPx + ARM_FINGERTIP_V * armLiftedShadowInfo.contentH) /
        armLiftedShadowInfo.canvasH;
      const armLiftedScaleRatioX = armTexture.width / armLiftedShadowInfo.contentW;
      const armLiftedScaleRatioY = armTexture.height / armLiftedShadowInfo.contentH;

      const armShadowLiftedSprite = new Sprite(armShadowLiftedTexture);
      armShadowLiftedSprite.anchor.set(armLiftedAnchorX, armLiftedAnchorY);
      armShadowLiftedSprite.blendMode = 'multiply';
      armShadowLiftedSprite.visible = false;
      armShadowLiftedSprite.alpha = 0;
      app.stage.addChild(armShadowLiftedSprite);

      const armShadowTightSprite = new Sprite(armShadowTightTexture);
      armShadowTightSprite.anchor.set(armTightAnchorX, armTightAnchorY);
      armShadowTightSprite.blendMode = 'multiply';
      armShadowTightSprite.visible = false;
      armShadowTightSprite.alpha = 0;
      app.stage.addChild(armShadowTightSprite);

      // === Layer (e): Arm photo anchored at fingertip contact point (warm-graded to match sunny scene) ===
      const armSprite = new Sprite(armTexture);
      armSprite.anchor.set(ARM_FINGERTIP_U, ARM_FINGERTIP_V);
      armSprite.tint = ARM_WARM_TINT;
      armSprite.visible = false;
      armSprite.alpha = 0;
      app.stage.addChild(armSprite);

      // === Layer (f): Shared light (warm left sunlight + gentle darker vignette) ===
      const sharedLightContainer = new Container();
      const warmLightSprite = new Sprite(warmLightTexture);
      warmLightSprite.blendMode = 'screen';
      warmLightSprite.alpha = 0.85;
      sharedLightContainer.addChild(warmLightSprite);

      const sceneVignetteSprite = new Sprite(sceneVignetteTexture);
      sceneVignetteSprite.blendMode = 'multiply';
      sharedLightContainer.addChild(sceneVignetteSprite);
      app.stage.addChild(sharedLightContainer);

      // Layout state updated on init and resize
      let stageW = initialW;
      let stageH = initialH;
      let catBaseScale = 1;
      let catVisibleW = 320;
      let catCenterX = stageW / 2;
      let catCenterY = stageH / 2;
      let armBaseScale = 0.3;
      const catSoftScaleRatioX = catTexture.width / catSoftShadowInfo.contentW;
      const catSoftScaleRatioY = catTexture.height / catSoftShadowInfo.contentH;
      const catAoScaleRatioX = catTexture.width / catAoShadowInfo.contentW;
      const catAoScaleRatioY = catTexture.height / catAoShadowInfo.contentH;
      const visWFrac = hitMask?.visibleWidthFrac ?? 0.76;
      const visHFrac = hitMask?.visibleHeightFrac ?? 0.76;

      const updateFilterScale = () => {
        if (!displacementFilter) return;
        const scale = reducedMotion ? 5 : clamp(catVisibleW * 0.028, 8, 14);
        displacementFilter.scale.set(scale, scale);
      };

      const layout = (w: number, h: number) => {
        stageW = Math.max(1, w);
        stageH = Math.max(1, h);

        // Cover-fit background photo
        const bgScale = Math.max(
          stageW / bgTexture!.width,
          stageH / bgTexture!.height,
        );
        bgSprite.scale.set(bgScale);
        bgSprite.position.set(stageW / 2, stageH / 2);

        bgVignetteSprite.width = stageW;
        bgVignetteSprite.height = stageH;

        warmLightSprite.width = stageW;
        warmLightSprite.height = stageH;

        sceneVignetteSprite.width = stageW;
        sceneVignetteSprite.height = stageH;

        // Size cat: longest visible side ~62% of shorter stage dim on wide screens,
        // and ~88% of width on phones (clamped vertically so tall cats stay clear of HUD)
        const visTexW = catTexture!.width * visWFrac;
        const visTexH = catTexture!.height * visHFrac;
        const visTexLongest = Math.max(visTexW, visTexH);
        if (stageW >= stageH) {
          const targetLongest = Math.min(stageW, stageH) * 0.62;
          catBaseScale = targetLongest / visTexLongest;
        } else {
          const scaleByW = (stageW * 0.88) / visTexW;
          const scaleByH = (stageH * 0.62) / visTexH;
          catBaseScale = Math.min(scaleByW, scaleByH);
        }
        catVisibleW = visTexW * catBaseScale;
        const catVisibleLongest = visTexLongest * catBaseScale;

        catCenterX = stageW / 2;
        catCenterY = stageH * 0.5;

        catContainer.position.set(catCenterX, catCenterY);
        catContainer.scale.set(catBaseScale);

        catSoftShadowSprite.position.set(
          catCenterX + CAT_SOFT_SHADOW_OFFSET,
          catCenterY + CAT_SOFT_SHADOW_OFFSET,
        );
        catSoftShadowSprite.scale.set(
          catBaseScale * catSoftScaleRatioX,
          catBaseScale * catSoftScaleRatioY,
        );

        catAoShadowSprite.position.set(
          catCenterX + CAT_AO_SHADOW_OFFSET,
          catCenterY + CAT_AO_SHADOW_OFFSET,
        );
        catAoShadowSprite.scale.set(
          catBaseScale * catAoScaleRatioX,
          catBaseScale * catAoScaleRatioY,
        );

        // Scale arm proportionally to the cat (~43% of cat longest side across palm+thumb)
        const desiredPalmW = catVisibleLongest * 0.43;
        armBaseScale =
          desiredPalmW / (armTexture!.width * ARM_PALM_WIDTH_RATIO);

        updateFilterScale();
      };

      layout(initialW, initialH);

      const handleResize = () => {
        if (cancelled) return;
        const w = stageEl.clientWidth;
        const h = stageEl.clientHeight;
        if (w <= 0 || h <= 0) return;
        app.renderer.resize(w, h, getResolution());
        layout(w, h);
      };

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(stageEl);
      }
      window.addEventListener('resize', handleResize);

      const onMotionChange = (e: MediaQueryListEvent) => {
        reducedMotion = e.matches;
        updateFilterScale();
      };
      motionQuery?.addEventListener('change', onMotionChange);

      // Helper: compute ideal arm angle pointing from fingertips toward bottom-right pivot
      const computeTargetArmRot = (fx: number, fy: number): number => {
        const pivotX = stageW * ARM_PIVOT_X_RATIO;
        const pivotY = stageH * ARM_PIVOT_Y_RATIO;
        return Math.atan2(pivotY - fy, pivotX - fx) - Math.PI / 2;
      };

      // Interaction & simulation state
      let pointerMode: 'none' | 'mouse' | 'touch' | 'keyboard' = 'none';
      let activeTouchId: number | null = null;
      let isMouseDown = false;
      let handWanted = false;
      let handX = catCenterX;
      let handY = catCenterY;
      let targetX = catCenterX;
      let targetY = catCenterY;
      let armRot = computeTargetArmRot(handX, handY);
      let handAlpha = 0;
      let liftAmount = 1; // 0 = pressing on cat, 1 = lifted hovering off cat
      let pressAmount = 0; // 1 = active stroking press (scaleY -3%)
      let isOverCat = false;

      let prevPetPoint: StrokeSample | null = null;
      let smoothedDirX = 0;
      let smoothedDirY = 0;
      let hasSmoothedDir = false;
      const pendingSamples: StrokeSample[] = [];
      const keysDown = new Set<string>();

      // Displacement decay tracking (~500 ms decay)
      let dispActive = false;
      let dispIdleTime = 0;

      // Purr meter & realistic cat life state
      let meter = 0;
      let meterRateBudget = 0;
      let lastTickMs = performance.now();
      let lastPetTimeMs = lastTickMs;
      let idleSincePet = 0;
      let strokeGraceTimer = 0;
      let smoothedStrokeSpeed = 0;
      let breathPhase = 0;

      let meltProgress = 0;
      let overpetTimer = 0;
      let nipCooldown = 0;
      let nipFlinchTimer = 0;

      let lastReportedPct = 0;
      let lastReportedMood: PetMood = 'idle';
      let lastHandOverState = false;

      const setHandCursorState = (active: boolean) => {
        if (active !== lastHandOverState) {
          lastHandOverState = active;
          setHandOverStage(active);
        }
      };

      // Convert stage coordinates to normalized cat UV and hit-test alpha mask
      const stageToCat = (sx: number, sy: number) => {
        const local = catContainer.toLocal({ x: sx, y: sy });
        const u = local.x / catTexture!.width + 0.5;
        const v = local.y / catTexture!.height + 0.5;
        let hit = false;
        if (u >= 0 && u < 1 && v >= 0 && v < 1) {
          if (hitMask) {
            const px = Math.min(
              hitMask.width - 1,
              Math.floor(u * hitMask.width),
            );
            const py = Math.min(
              hitMask.height - 1,
              Math.floor(v * hitMask.height),
            );
            const alpha = hitMask.data[(py * hitMask.width + px) * 4 + 3];
            hit = alpha > 24;
          } else {
            hit = true;
          }
        }
        return { localX: local.x, localY: local.y, u, v, hit };
      };

      const stampDisplacement = (
        prevU: number,
        prevV: number,
        currU: number,
        currV: number,
        dirX: number,
        dirY: number,
        strength: number,
      ) => {
        if (!dispMap || !stampContainer) return;

        // Smooth stroke direction slightly so micro-jitter never causes watery ripples
        if (!hasSmoothedDir) {
          smoothedDirX = dirX;
          smoothedDirY = dirY;
          hasSmoothedDir = true;
        } else {
          smoothedDirX = smoothedDirX * 0.45 + dirX * 0.55;
          smoothedDirY = smoothedDirY * 0.45 + dirY * 0.55;
          const sLen = Math.hypot(smoothedDirX, smoothedDirY);
          if (sLen > 0.001) {
            smoothedDirX /= sLen;
            smoothedDirY /= sLen;
          } else {
            smoothedDirX = dirX;
            smoothedDirY = dirY;
          }
        }

        const x0 = prevU * DISP_SIZE;
        const y0 = prevV * DISP_SIZE;
        const x1 = currU * DISP_SIZE;
        const y1 = currV * DISP_SIZE;

        const segDist = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(
          1,
          Math.min(BRUSH_POOL_SIZE, Math.ceil(segDist / 6)),
        );

        // Encode push direction into R/G channels (128 - dir * amp pushes fur forward with hand)
        const amp = clamp(strength, 0.22, 0.95) * 112;
        const r = clamp(Math.round(128 - smoothedDirX * amp), 14, 242);
        const g = clamp(Math.round(128 - smoothedDirY * amp), 14, 242);
        const tint = (r << 16) | (g << 8) | 128;

        // Stretch brush along stroke direction in dispMap UV space (like fingers combing fur)
        const uvDirX = smoothedDirX / catTexture!.width;
        const uvDirY = smoothedDirY / catTexture!.height;
        const dispAngle = Math.atan2(uvDirY, uvDirX);
        const majorRadius = 32;
        const minorRadius = 15;
        const scaleX = (majorRadius * 2) / 64;
        const scaleY = (minorRadius * 2) / 64;

        const alphaPerStep =
          (0.3 + strength * 0.28) / Math.pow(steps, 0.4);

        for (let i = 0; i < BRUSH_POOL_SIZE; i++) {
          const sprite = brushPool[i];
          if (i < steps) {
            const frac = steps === 1 ? 1 : (i + 1) / steps;
            sprite.position.set(
              x0 + (x1 - x0) * frac,
              y0 + (y1 - y0) * frac,
            );
            sprite.rotation = dispAngle;
            sprite.scale.set(scaleX, scaleY);
            sprite.tint = tint;
            sprite.alpha = alphaPerStep;
            sprite.visible = true;
          } else {
            sprite.visible = false;
          }
        }

        app.renderer.render({
          container: stampContainer,
          target: dispMap,
          clear: false,
        });

        dispActive = true;
        dispIdleTime = 0;
      };

      const getStagePos = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      };

      const onPointerEnter = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        const pos = getStagePos(e);
        if (!handWanted || pointerMode !== 'mouse') {
          handX = pos.x;
          handY = pos.y;
          armRot = computeTargetArmRot(handX, handY);
          prevPetPoint = null;
          hasSmoothedDir = false;
        }
        pointerMode = 'mouse';
        handWanted = true;
        targetX = pos.x;
        targetY = pos.y;
        isOverCat = stageToCat(pos.x, pos.y).hit;
        setHandCursorState(true);
      };

      const onPointerDown = (e: PointerEvent) => {
        purr.unlock();
        const pos = getStagePos(e);

        if (e.pointerType === 'touch') {
          if (activeTouchId !== null) return;
          activeTouchId = e.pointerId;
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            // Ignore capture errors on synthetic events
          }
          const petX = pos.x;
          const petY = pos.y - TOUCH_OFFSET_Y;
          pointerMode = 'touch';
          handWanted = true;
          handX = petX;
          handY = petY;
          armRot = computeTargetArmRot(petX, petY);
          targetX = petX;
          targetY = petY;
          prevPetPoint = { x: petX, y: petY, t: performance.now() };
          hasSmoothedDir = false;
          isOverCat = stageToCat(petX, petY).hit;
          setHandCursorState(false);
        } else {
          isMouseDown = true;
          if (!handWanted) {
            handX = pos.x;
            handY = pos.y;
            armRot = computeTargetArmRot(handX, handY);
          }
          pointerMode = 'mouse';
          handWanted = true;
          targetX = pos.x;
          targetY = pos.y;
          prevPetPoint = { x: pos.x, y: pos.y, t: performance.now() };
          hasSmoothedDir = false;
          isOverCat = stageToCat(pos.x, pos.y).hit;
          setHandCursorState(true);
        }
      };

      const onPointerMove = (e: PointerEvent) => {
        const now = performance.now();
        const pos = getStagePos(e);

        if (e.pointerType === 'touch') {
          if (activeTouchId !== null && e.pointerId !== activeTouchId) return;
          if (activeTouchId === null) {
            activeTouchId = e.pointerId;
          }
          const petX = pos.x;
          const petY = pos.y - TOUCH_OFFSET_Y;
          if (!handWanted) {
            handX = petX;
            handY = petY;
            armRot = computeTargetArmRot(petX, petY);
          }
          pointerMode = 'touch';
          handWanted = true;
          targetX = petX;
          targetY = petY;
          pendingSamples.push({ x: petX, y: petY, t: now });
          return;
        }

        if (pointerMode === 'touch') return;
        if (!handWanted) {
          handX = pos.x;
          handY = pos.y;
          armRot = computeTargetArmRot(handX, handY);
        }
        pointerMode = 'mouse';
        handWanted = true;
        targetX = pos.x;
        targetY = pos.y;
        setHandCursorState(true);
        pendingSamples.push({ x: pos.x, y: pos.y, t: now });
      };

      const onPointerUp = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') {
          isMouseDown = false;
          return;
        }
        if (e.pointerId !== activeTouchId) return;
        purr.unlock();
        try {
          if (canvas.hasPointerCapture(e.pointerId)) {
            canvas.releasePointerCapture(e.pointerId);
          }
        } catch {
          // Ignore release errors
        }
        activeTouchId = null;
        handWanted = false;
        isOverCat = false;
        pointerMode = 'none';
        prevPetPoint = null;
        hasSmoothedDir = false;
        pendingSamples.length = 0;
        purr.stopPetting();
      };

      const onPointerLeave = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        isMouseDown = false;
        if (pointerMode === 'mouse') {
          handWanted = false;
          isOverCat = false;
          pointerMode = 'none';
          prevPetPoint = null;
          hasSmoothedDir = false;
          pendingSamples.length = 0;
          purr.stopPetting();
          setHandCursorState(false);
        }
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight'
        ) {
          e.preventDefault();
          purr.unlock();
          keysDown.add(e.key);
          if (pointerMode !== 'keyboard') {
            if (!handWanted) {
              targetX = catCenterX;
              targetY = catCenterY;
              handX = targetX;
              handY = targetY;
              armRot = computeTargetArmRot(handX, handY);
            }
            pointerMode = 'keyboard';
            handWanted = true;
            prevPetPoint = { x: targetX, y: targetY, t: performance.now() };
            hasSmoothedDir = false;
          }
        } else if (e.key === 'm' || e.key === 'M') {
          if (
            document.activeElement === stageEl ||
            stageEl.contains(document.activeElement)
          ) {
            e.preventDefault();
            toggleMute();
          }
        }
      };

      const onKeyUp = (e: KeyboardEvent) => {
        keysDown.delete(e.key);
      };

      const onStageBlur = () => {
        keysDown.clear();
        isMouseDown = false;
        if (pointerMode === 'keyboard') {
          handWanted = false;
          isOverCat = false;
          pointerMode = 'none';
          prevPetPoint = null;
          hasSmoothedDir = false;
          purr.stopPetting();
        }
      };

      canvas.addEventListener('pointerenter', onPointerEnter);
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('pointerleave', onPointerLeave);
      stageEl.addEventListener('keydown', onKeyDown);
      stageEl.addEventListener('keyup', onKeyUp);
      stageEl.addEventListener('blur', onStageBlur);

      cleanupEvents = () => {
        window.removeEventListener('resize', handleResize);
        motionQuery?.removeEventListener('change', onMotionChange);
        canvas.removeEventListener('pointerenter', onPointerEnter);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        stageEl.removeEventListener('keydown', onKeyDown);
        stageEl.removeEventListener('keyup', onKeyUp);
        stageEl.removeEventListener('blur', onStageBlur);
      };

      // Main animation & petting simulation tick
      app.ticker.add((ticker) => {
        const now = performance.now();
        const wallDt = clamp((now - lastTickMs) / 1000, 0.001, 0.25);
        lastTickMs = now;
        const dt = clamp(ticker.deltaMS / 1000, 0.001, 0.06);

        if (nipCooldown > 0) {
          nipCooldown = Math.max(0, nipCooldown - wallDt);
        }

        // Virtual hand keyboard navigation when stage is focused
        if (pointerMode === 'keyboard' && keysDown.size > 0) {
          let kx = 0;
          let ky = 0;
          if (keysDown.has('ArrowLeft')) kx -= 1;
          if (keysDown.has('ArrowRight')) kx += 1;
          if (keysDown.has('ArrowUp')) ky -= 1;
          if (keysDown.has('ArrowDown')) ky += 1;

          if (kx !== 0 || ky !== 0) {
            const len = Math.hypot(kx, ky);
            const speedPx = 300;
            targetX = clamp(
              targetX + (kx / len) * speedPx * dt,
              24,
              stageW - 24,
            );
            targetY = clamp(
              targetY + (ky / len) * speedPx * dt,
              24,
              stageH - 24,
            );
            pendingSamples.push({ x: targetX, y: targetY, t: now });
          }
        }

        // Fade displacement map toward neutral grey (~500 ms decay)
        if (dispActive && dispMap && dispFadeContainer) {
          dispIdleTime += dt;
          if (dispIdleTime >= 0.78) {
            clearDispMap();
            dispActive = false;
          } else {
            let fadeAlpha = 1 - Math.exp(-dt / 0.165);
            if (dispIdleTime > 0.48) {
              const settleT = clamp((dispIdleTime - 0.48) / 0.3, 0, 1);
              fadeAlpha = fadeAlpha + (1 - fadeAlpha) * settleT * 0.45;
            }
            dispFadeRect.alpha = clamp(fadeAlpha, 0.045, 1);
            app.renderer.render({
              container: dispFadeContainer,
              target: dispMap,
              clear: false,
            });
          }
        }

        // Process queued pointer/keyboard stroke samples
        let pettedThisFrame = false;
        let frameDistance = 0;
        let frameMaxSpeed = 0;

        if (pendingSamples.length > 0) {
          for (let i = 0; i < pendingSamples.length; i++) {
            const sample = pendingSamples[i];
            const currHit = stageToCat(sample.x, sample.y);
            isOverCat = currHit.hit;

            if (nipCooldown > 0) {
              prevPetPoint = sample;
              continue;
            }

            if (!prevPetPoint) {
              prevPetPoint = sample;
              continue;
            }

            const dx = sample.x - prevPetPoint.x;
            const dy = sample.y - prevPetPoint.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 0.75) {
              continue;
            }

            if (currHit.hit) {
              const prevHit = stageToCat(prevPetPoint.x, prevPetPoint.y);
              const segDt = clamp((sample.t - prevPetPoint.t) / 1000, 0.008, 0.1);
              const instSpeed = dist / segDt;
              frameMaxSpeed = Math.max(frameMaxSpeed, instSpeed);
              frameDistance += dist;
              pettedThisFrame = true;

              const localDx = currHit.localX - prevHit.localX;
              const localDy = currHit.localY - prevHit.localY;
              const localLen = Math.hypot(localDx, localDy);
              if (localLen > 0.01) {
                const dirX = localDx / localLen;
                const dirY = localDy / localLen;
                const strength = clamp(
                  instSpeed / (catVisibleW * 1.45),
                  0.24,
                  0.95,
                );
                const startU = prevHit.hit ? prevHit.u : currHit.u;
                const startV = prevHit.hit ? prevHit.v : currHit.v;
                stampDisplacement(
                  startU,
                  startV,
                  currHit.u,
                  currHit.v,
                  dirX,
                  dirY,
                  strength,
                );
              }
            }

            prevPetPoint = sample;
          }
          pendingSamples.length = 0;
        }

        // Update stroke speed & purr meter (~25-30 s steady petting; 1%/s drain after 2 s idle)
        meterRateBudget = Math.min(
          METER_RATE_BUCKET_MAX,
          meterRateBudget + METER_MAX_FILL_PER_SEC * wallDt,
        );
        const speedLerp = 1 - Math.exp(-dt / 0.12);
        if (pettedThisFrame) {
          smoothedStrokeSpeed +=
            (frameMaxSpeed - smoothedStrokeSpeed) * speedLerp;
          lastPetTimeMs = now;
          idleSincePet = 0;
          strokeGraceTimer = 0.18;
          const rawGain = frameDistance / (catVisibleW * METER_CAT_WIDTHS_TO_FULL);
          const credit = Math.min(rawGain, meterRateBudget);
          meterRateBudget -= credit;
          meter = clamp(meter + credit, 0, 1);
        } else {
          smoothedStrokeSpeed += (0 - smoothedStrokeSpeed) * speedLerp;
          idleSincePet = (now - lastPetTimeMs) / 1000;
          strokeGraceTimer = Math.max(0, strokeGraceTimer - dt);
          if (idleSincePet > METER_IDLE_DELAY_SEC) {
            const drainSec = Math.min(wallDt, idleSincePet - METER_IDLE_DELAY_SEC);
            meter = Math.max(0, meter - drainSec * METER_IDLE_DRAIN_PER_SEC);
          }
        }

        // Over-petting check: very fast rubbing at ~100% for > 3 s -> quick flinch + 1 s cooldown
        const veryFastThreshold = catVisibleW * 1.75;
        if (
          nipCooldown <= 0 &&
          meter >= 0.99 &&
          idleSincePet < 0.14 &&
          smoothedStrokeSpeed > veryFastThreshold
        ) {
          overpetTimer += dt;
          if (overpetTimer >= 3.0) {
            overpetTimer = 0;
            nipCooldown = 1.0;
            nipFlinchTimer = 0.2;
            meter = 0.82;
            purr.stopPetting();
            purr.triggerNipHaptic();
          }
        } else {
          overpetTimer = Math.max(0, overpetTimer - dt * 1.1);
        }

        // Update purr audio & haptics
        const normalizedAudioSpeed = clamp(
          smoothedStrokeSpeed / (catVisibleW * 1.45),
          0,
          1,
        );
        purr.update(
          dt,
          pettedThisFrame && nipCooldown <= 0,
          normalizedAudioSpeed,
        );

        // === Realistic cat life (breathing, subtle melt at 100%, small 2-3 px nip flinch) ===
        if (nipFlinchTimer > 0) {
          nipFlinchTimer = Math.max(0, nipFlinchTimer - dt);
        }

        const targetMelt = meter >= 0.995 && nipCooldown <= 0 ? 1 : 0;
        const meltStep = dt / 1.5; // 1.5 s ease
        if (targetMelt > meltProgress) {
          meltProgress = Math.min(1, meltProgress + meltStep);
        } else if (targetMelt < meltProgress) {
          meltProgress = Math.max(0, meltProgress - meltStep);
        }
        const meltEased =
          meltProgress * meltProgress * (3 - 2 * meltProgress);

        let reactScaleX = 1;
        let reactScaleY = 1;
        let flinchX = 0;
        let flinchY = 0;

        if (!reducedMotion) {
          // Slow breathing: 1.000-1.012 at ~0.4 Hz, slowing & deepening as purr meter rises
          const breathFreqHz = 0.4 - meter * 0.14; // 0.40 Hz -> 0.26 Hz
          const breathDepth = 0.012 + meter * 0.008; // 1.2% -> 2.0%
          breathPhase += dt * breathFreqHz * Math.PI * 2;
          const breathWave = 0.5 * (1 - Math.cos(breathPhase)); // [0, 1]
          const breathScale = 1 + breathDepth * breathWave;
          reactScaleX *= breathScale;
          reactScaleY *= breathScale;

          // Subtle melt at 100%: scale-x +1.5%, scale-y -1% eased over 1.5 s
          if (meltEased > 0.0005) {
            reactScaleX *= 1 + 0.015 * meltEased;
            reactScaleY *= 1 - 0.01 * meltEased;
          }

          // Nip flinch: 2-3 px quick jitter over 200 ms
          if (nipFlinchTimer > 0) {
            const p = 1 - nipFlinchTimer / 0.2;
            const env = Math.sin(p * Math.PI) * (1 - p * 0.35);
            flinchX = Math.sin(p * Math.PI * 5) * 2.6 * env;
            flinchY = Math.cos(p * Math.PI * 4) * 1.8 * env;
          }
        }

        catContainer.position.set(catCenterX + flinchX, catCenterY + flinchY);
        catContainer.scale.set(
          catBaseScale * reactScaleX,
          catBaseScale * reactScaleY,
        );
        catContainer.rotation = 0;

        // Two-layer cat shadows share breathing, melt, and flinch with the cat
        catSoftShadowSprite.position.set(
          catCenterX + CAT_SOFT_SHADOW_OFFSET + flinchX,
          catCenterY + CAT_SOFT_SHADOW_OFFSET + flinchY,
        );
        catSoftShadowSprite.scale.set(
          catBaseScale * catSoftScaleRatioX * reactScaleX,
          catBaseScale * catSoftScaleRatioY * reactScaleY,
        );

        catAoShadowSprite.position.set(
          catCenterX + CAT_AO_SHADOW_OFFSET + flinchX,
          catCenterY + CAT_AO_SHADOW_OFFSET + flinchY,
        );
        catAoShadowSprite.scale.set(
          catBaseScale * catAoScaleRatioX * reactScaleX,
          catBaseScale * catAoScaleRatioY * reactScaleY,
        );

        // === Arm position, bottom-right edge anchoring, lift/press & shadow ===
        const handLerp = 1 - Math.exp(-dt / 0.055);
        handX += (targetX - handX) * handLerp;
        handY += (targetY - handY) * handLerp;

        const targetArmRot = computeTargetArmRot(handX, handY);
        const rotLerp = 1 - Math.exp(-dt / 0.11); // slight natural rotational lag while stroking
        armRot += (targetArmRot - armRot) * rotLerp;

        // Animate lift/press shadow & arm height cleanly over ~150 ms
        const onCatReady = handWanted && isOverCat && nipCooldown <= 0;
        const desiredLift = onCatReady ? 0 : 1;
        const liftStep = wallDt / ARM_LIFT_TRANSITION_SEC;
        if (desiredLift > liftAmount) {
          liftAmount = Math.min(1, liftAmount + liftStep);
        } else if (desiredLift < liftAmount) {
          liftAmount = Math.max(0, liftAmount - liftStep);
        }
        const liftEased = liftAmount * liftAmount * (3 - 2 * liftAmount);

        // Subtle press (scaleY -3%) while actively stroking on the cat
        const activelyStroking =
          onCatReady &&
          (strokeGraceTimer > 0 || pointerMode === 'touch' || isMouseDown);
        const desiredPress = activelyStroking ? 1 : 0;
        const pressLerp = 1 - Math.exp(-dt / 0.09);
        pressAmount += (desiredPress - pressAmount) * pressLerp;

        const targetAlpha = handWanted ? 1 : 0;
        const alphaLerp = 1 - Math.exp(-dt / (handWanted ? 0.07 : 0.12));
        handAlpha += (targetAlpha - handAlpha) * alphaLerp;

        if (handAlpha < 0.01 && !handWanted) {
          armSprite.visible = false;
          armSprite.alpha = 0;
          armShadowTightSprite.visible = false;
          armShadowTightSprite.alpha = 0;
          armShadowLiftedSprite.visible = false;
          armShadowLiftedSprite.alpha = 0;
        } else {
          // Ensure the bottom sleeve edge ALWAYS extends past the screen bottom edge
          const cosR = Math.cos(armRot);
          const sinAbs = Math.abs(Math.sin(armRot));
          const sleeveLenTex = (1 - ARM_FINGERTIP_V) * armTexture!.height;
          const sleeveHalfWTex = ARM_SLEEVE_HALF_WIDTH_RATIO * armTexture!.width;
          const pressScaleY = 1 - 0.03 * pressAmount;
          const liftScale = 1 + 0.03 * liftEased;
          const minDropPerUnitScale =
            sleeveLenTex * pressScaleY * cosR - sleeveHalfWTex * sinAbs;
          const minScaleForEdge =
            (stageH + 28 - handY) / Math.max(160, minDropPerUnitScale);

          const effectiveBaseScale = Math.max(armBaseScale, minScaleForEdge);
          const armScaleX = effectiveBaseScale * liftScale;
          const armScaleY = effectiveBaseScale * liftScale * pressScaleY;

          armSprite.visible = true;
          armSprite.alpha = handAlpha;
          armSprite.position.set(handX, handY);
          armSprite.rotation = armRot;
          armSprite.scale.set(armScaleX, armScaleY);

          const shadowOffsetX =
            ARM_SHADOW_TIGHT_OFFSET_X +
            liftEased * (ARM_SHADOW_LIFTED_OFFSET_X - ARM_SHADOW_TIGHT_OFFSET_X);
          const shadowOffsetY =
            ARM_SHADOW_TIGHT_OFFSET_Y +
            liftEased * (ARM_SHADOW_LIFTED_OFFSET_Y - ARM_SHADOW_TIGHT_OFFSET_Y);
          const shadowX = handX + shadowOffsetX;
          const shadowY = handY + shadowOffsetY;

          const tightAlpha =
            handAlpha * ARM_SHADOW_TIGHT_OPACITY * (1 - liftEased);
          const liftedAlpha =
            handAlpha * ARM_SHADOW_LIFTED_OPACITY * liftEased;

          armShadowTightSprite.visible = tightAlpha > 0.005;
          armShadowTightSprite.alpha = tightAlpha;
          armShadowTightSprite.position.set(shadowX, shadowY);
          armShadowTightSprite.rotation = armRot;
          armShadowTightSprite.scale.set(
            armScaleX * armTightScaleRatioX,
            armScaleY * armTightScaleRatioY,
          );

          armShadowLiftedSprite.visible = liftedAlpha > 0.005;
          armShadowLiftedSprite.alpha = liftedAlpha;
          armShadowLiftedSprite.position.set(shadowX, shadowY);
          armShadowLiftedSprite.rotation = armRot;
          armShadowLiftedSprite.scale.set(
            armScaleX * armLiftedScaleRatioX,
            armScaleY * armLiftedScaleRatioY,
          );
        }

        // Sync meter bar directly via DOM ref for smooth 60fps updates without re-renders
        const fillEl = meterFillRef.current;
        if (fillEl) {
          fillEl.style.transform = `scaleX(${meter.toFixed(4)})`;
        }

        // Only update Preact state when rounded percentage or mood label changes
        const pct = Math.round(meter * 100);
        if (pct !== lastReportedPct) {
          lastReportedPct = pct;
          setMeterPct(pct);
        }

        let nextMood: PetMood = 'idle';
        if (nipCooldown > 0) {
          nextMood = 'nip';
        } else if (meter >= 0.995) {
          nextMood = 'melt';
        } else if (meter >= 0.25) {
          nextMood = 'purring';
        } else if (meter > 0.01 || pettedThisFrame) {
          nextMood = 'petting';
        }

        if (nextMood !== lastReportedMood) {
          lastReportedMood = nextMood;
          setMood(nextMood);
        }
      });
    };

    void start().catch((err) => {
      if (!cancelled) {
        if (!hasLoggedPixiFailure) {
          hasLoggedPixiFailure = true;
          console.warn('PetStage initialization failed:', err);
        }
        safeDestroy();
        setInitFailed(true);
      }
    });

    return () => {
      cancelled = true;
      safeDestroy();
    };
  }, [imageUrl, bgUrl]);

  if (initFailed) {
    return (
      <div
        class="pet-stage pet-stage--fallback"
        style={{ backgroundImage: `url(${bgUrl})` }}
      >
        <img
          src={imageUrl}
          alt={catName ? `${catName} curled up on a blanket` : 'Cat on a blanket'}
          class="pet-fallback-cat"
        />
        <div class="pet-fallback-light" aria-hidden="true" />
        {catName ? <h1 class="pet-cat-label">{catName}</h1> : null}
        <p class="pet-fallback-message" role="status">
          Your browser can&apos;t show petting here, but the cat still loves you.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      class={`pet-stage${handOverStage ? ' pet-stage--hand-active' : ''}`}
      style={{ backgroundImage: `url(${bgUrl})` }}
      tabIndex={0}
      role="application"
      aria-label="Interactive cat petting stage. Stroke with mouse or finger, or focus and use arrow keys to move the hand and pet."
    >
      <div ref={canvasHostRef} class="pet-canvas-host" />

      {catName ? <h1 class="pet-cat-label">{catName}</h1> : null}

      <button
        type="button"
        class="pet-mute-btn"
        aria-pressed={muted}
        aria-label={muted ? 'Unmute purr sound' : 'Mute purr sound'}
        title={muted ? 'Unmute purr (M)' : 'Mute purr (M)'}
        onClick={toggleMute}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerEnter={(e) => e.stopPropagation()}
      >
        {muted ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M11 5L6 9H3v6h3l5 4V5z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <line
              x1="21"
              y1="9"
              x2="15"
              y2="15"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
            <line
              x1="15"
              y1="9"
              x2="21"
              y2="15"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M11 5L6 9H3v6h3l5 4V5z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M15.5 8.5a5 5 0 0 1 0 7"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
            <path
              d="M18.8 5.8a9 9 0 0 1 0 12.4"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        )}
      </button>

      <div class="purr-meter">
        <span
          class={`purr-meter-status${
            mood === 'nip' ? ' purr-meter-status--nip' : ''
          }`}
          aria-live="polite"
        >
          {moodCaption(mood)}
        </span>
        <div
          class="purr-meter-track"
          role="progressbar"
          aria-label="Purr meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meterPct}
        >
          <div
            ref={meterFillRef}
            class={`purr-meter-fill${
              mood === 'melt' ? ' purr-meter-fill--melt' : ''
            }${mood === 'nip' ? ' purr-meter-fill--nip' : ''}`}
          />
        </div>
        <span class="purr-meter-pct">{meterPct}%</span>
      </div>
    </div>
  );
}

export default PetStage;
