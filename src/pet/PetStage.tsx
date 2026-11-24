import { useEffect, useRef, useState } from 'preact/hooks';
import {
  Application,
  Container,
  DisplacementFilter,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
} from 'pixi.js';
import handSvgUrl from '../assets/hand.svg';
import {
  PurrAudio,
  readMutedPreference,
  writeMutedPreference,
} from './purr';

export interface PetStageProps {
  imageUrl: string;
}

type PetMood = 'idle' | 'petting' | 'purring' | 'wiggle' | 'melt' | 'nip';

const DISP_SIZE = 256;
const NEUTRAL_RGBA = [128 / 255, 128 / 255, 128 / 255, 1];
const TOUCH_OFFSET_Y = 40;
const BRUSH_POOL_SIZE = 12;

interface StrokeSample {
  x: number;
  y: number;
  t: number;
}

interface HitMask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
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

function rasterizeImageToCanvas(
  img: HTMLImageElement,
  maxDim: number,
  fallbackW: number,
  fallbackH: number,
): HTMLCanvasElement {
  const natW = img.naturalWidth || fallbackW;
  const natH = img.naturalHeight || fallbackH;
  const scale = Math.min(1, maxDim / Math.max(natW, natH));
  const width = Math.max(1, Math.round(natW * scale));
  const height = Math.max(1, Math.round(natH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0, width, height);
  }
  return canvas;
}

function buildHitMask(
  img: HTMLImageElement,
  fallbackW: number,
  fallbackH: number,
): HitMask | null {
  const natW = img.naturalWidth || fallbackW;
  const natH = img.naturalHeight || fallbackH;
  const scale = Math.min(1, 256 / Math.max(natW, natH));
  const width = Math.max(1, Math.round(natW * scale));
  const height = Math.max(1, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    return { width, height, data: imageData.data };
  } catch {
    return null;
  }
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
    grad.addColorStop(0.32, 'rgba(255, 255, 255, 0.82)');
    grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.28)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

function createShadowCanvas(width = 256, height = 192): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(1, height / width);
    const radius = width / 2;
    const grad = ctx.createRadialGradient(0, 0, radius * 0.15, 0, 0, radius);
    grad.addColorStop(0, 'rgba(42, 24, 12, 0.24)');
    grad.addColorStop(0.55, 'rgba(42, 24, 12, 0.12)');
    grad.addColorStop(1, 'rgba(42, 24, 12, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return canvas;
}

function moodCaption(mood: PetMood): string {
  switch (mood) {
    case 'nip':
      return 'Playful nip! Easy there…';
    case 'melt':
      return 'Blissful melt';
    case 'wiggle':
      return 'Happy wiggle';
    case 'purring':
      return 'Purring softly';
    case 'petting':
      return 'Warming up…';
    default:
      return 'Stroke to pet';
  }
}

export function PetStage({ imageUrl }: PetStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const meterFillRef = useRef<HTMLDivElement | null>(null);
  const purrRef = useRef<PurrAudio | null>(null);

  const [muted, setMuted] = useState<boolean>(() => readMutedPreference());
  const mutedRef = useRef<boolean>(muted);
  const [meterPct, setMeterPct] = useState<number>(0);
  const [mood, setMood] = useState<PetMood>('idle');
  const [handOverStage, setHandOverStage] = useState<boolean>(false);

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
    let catTexture: Texture | null = null;
    let handTexture: Texture | null = null;
    let brushTexture: Texture | null = null;
    let shadowTexture: Texture | null = null;
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
        catTexture?.destroy(true);
        handTexture?.destroy(true);
        brushTexture?.destroy(true);
        shadowTexture?.destroy(true);

        dispMap = null;
        catTexture = null;
        handTexture = null;
        brushTexture = null;
        shadowTexture = null;

        app.destroy({ removeView: true }, { children: true });
      }
    };

    const start = async () => {
      const initialW = Math.max(1, stageEl.clientWidth || 360);
      const initialH = Math.max(1, stageEl.clientHeight || 360);

      await app.init({
        width: initialW,
        height: initialH,
        resolution: getResolution(),
        autoDensity: true,
        backgroundAlpha: 0,
        antialias: true,
        preference: 'webgl',
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

      // Load cut-out cat and original hand SVGs in parallel
      const [catImg, handImg] = await Promise.all([
        loadImage(imageUrl),
        loadImage(handSvgUrl),
      ]);

      if (cancelled) {
        safeDestroy();
        return;
      }

      const catCanvas = rasterizeImageToCanvas(catImg, 1400, 1200, 920);
      const handCanvas = rasterizeImageToCanvas(handImg, 440, 220, 260);
      const hitMask = buildHitMask(catImg, 1200, 920);

      catTexture = Texture.from(catCanvas, true);
      handTexture = Texture.from(handCanvas, true);
      brushTexture = Texture.from(createSoftBrushCanvas(64), true);
      shadowTexture = Texture.from(createShadowCanvas(256, 192), true);

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

      // Neutral grey fade rect rendered each active frame (~400 ms decay)
      dispFadeContainer = new Container();
      const dispFadeRect = new Graphics()
        .rect(0, 0, DISP_SIZE, DISP_SIZE)
        .fill(0x808080);
      dispFadeContainer.addChild(dispFadeRect);

      // Pooled soft radial brush sprites for smooth continuous stroke stamping
      stampContainer = new Container();
      const brushPool: Sprite[] = [];
      for (let i = 0; i < BRUSH_POOL_SIZE; i++) {
        const s = new Sprite(brushTexture);
        s.anchor.set(0.5);
        s.visible = false;
        stampContainer.addChild(s);
        brushPool.push(s);
      }

      // Scene hierarchy: soft cushion contact shadow -> catContainer -> handSprite
      const shadowSprite = new Sprite(shadowTexture);
      shadowSprite.anchor.set(0.5);
      app.stage.addChild(shadowSprite);

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
        scale: reducedMotion ? 8 : 25,
        padding: 36,
      });
      catSprite.filters = [displacementFilter];

      const handSprite = new Sprite(handTexture);
      // Anchor near center of palm/fingers so the hand pets directly at pointer position
      handSprite.anchor.set(0.5, 0.44);
      handSprite.visible = false;
      handSprite.alpha = 0;
      app.stage.addChild(handSprite);

      // Layout state updated on init and resize
      let stageW = initialW;
      let stageH = initialH;
      let catBaseScale = 1;
      let catDisplayW = 300;
      let catCenterX = stageW / 2;
      let catCenterY = stageH / 2;
      let handBaseScale = 0.5;

      const updateFilterScale = () => {
        if (!displacementFilter) return;
        const scale = reducedMotion
          ? 8
          : clamp(catDisplayW * 0.056, 20, 28);
        displacementFilter.scale.set(scale, scale);
      };

      const layout = (w: number, h: number) => {
        stageW = Math.max(1, w);
        stageH = Math.max(1, h);

        const padX = stageW * 0.86;
        const padY = stageH * 0.82;
        catBaseScale = Math.min(
          padX / catTexture!.width,
          padY / catTexture!.height,
        );
        catDisplayW = catTexture!.width * catBaseScale;
        const catDisplayH = catTexture!.height * catBaseScale;

        catCenterX = stageW / 2;
        catCenterY = stageH / 2;

        catContainer.position.set(catCenterX, catCenterY);
        catContainer.scale.set(catBaseScale);

        shadowSprite.position.set(catCenterX, catCenterY + catDisplayH * 0.08);
        shadowSprite.width = catDisplayW * 0.94;
        shadowSprite.height = catDisplayH * 0.82;

        const targetHandH = clamp(catDisplayW * 0.34, 96, 152);
        handBaseScale = targetHandH / handTexture!.height;
        handSprite.scale.set(handBaseScale);

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

      // Interaction & simulation state
      let pointerMode: 'none' | 'mouse' | 'touch' | 'keyboard' = 'none';
      let activeTouchId: number | null = null;
      let handWanted = false;
      let handX = catCenterX;
      let handY = catCenterY;
      let targetX = catCenterX;
      let targetY = catCenterY;
      let handVelX = 0;
      let handVelY = 0;
      let handRot = 0;
      let handAlpha = 0;
      let handPress = 0;
      let isOverCat = false;

      let prevPetPoint: StrokeSample | null = null;
      const pendingSamples: StrokeSample[] = [];
      const keysDown = new Set<string>();

      // Displacement decay tracking
      let dispActive = false;
      let dispIdleTime = 0;

      // Purr meter & reaction state
      let meter = 0;
      let idleSincePet = 0;
      let smoothedStrokeSpeed = 0;
      let breathTime = 0;

      let crossed33 = false;
      let crossed66 = false;
      let crossed100 = false;

      let sighTimer = 0;
      let wiggleTimer = 0;
      let meltAmount = 0;
      let overpetTimer = 0;
      let nipCooldown = 0;
      let nipShakeTimer = 0;

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

        const x0 = prevU * DISP_SIZE;
        const y0 = prevV * DISP_SIZE;
        const x1 = currU * DISP_SIZE;
        const y1 = currV * DISP_SIZE;

        const segDist = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(
          1,
          Math.min(BRUSH_POOL_SIZE, Math.ceil(segDist / 7)),
        );

        // Encode stroke direction into R/G channels (128 - dir * strength pushes fur along stroke)
        const amp = clamp(strength, 0.18, 1) * 116;
        const r = clamp(Math.round(128 - dirX * amp), 10, 246);
        const g = clamp(Math.round(128 - dirY * amp), 10, 246);
        const tint = (r << 16) | (g << 8) | 128;

        // Compensate brush aspect so displacement stays circular on non-square cat textures
        const aspect = catTexture!.width / catTexture!.height;
        const brushRadius = 28;
        const scaleX = (brushRadius * 2) / 64;
        const scaleY = scaleX * aspect;
        const alphaPerStep =
          (0.36 + strength * 0.3) / Math.pow(steps, 0.38);

        for (let i = 0; i < BRUSH_POOL_SIZE; i++) {
          const sprite = brushPool[i];
          if (i < steps) {
            const frac = steps === 1 ? 1 : (i + 1) / steps;
            sprite.position.set(
              x0 + (x1 - x0) * frac,
              y0 + (y1 - y0) * frac,
            );
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
          handRot = 0;
          prevPetPoint = null;
        }
        pointerMode = 'mouse';
        handWanted = true;
        targetX = pos.x;
        targetY = pos.y;
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
          handRot = 0;
          targetX = petX;
          targetY = petY;
          prevPetPoint = { x: petX, y: petY, t: performance.now() };
          isOverCat = stageToCat(petX, petY).hit;
          setHandCursorState(false);
        } else {
          if (!handWanted) {
            handX = pos.x;
            handY = pos.y;
            handRot = 0;
          }
          pointerMode = 'mouse';
          handWanted = true;
          targetX = pos.x;
          targetY = pos.y;
          prevPetPoint = { x: pos.x, y: pos.y, t: performance.now() };
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
            handRot = 0;
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
          handRot = 0;
        }
        pointerMode = 'mouse';
        handWanted = true;
        targetX = pos.x;
        targetY = pos.y;
        setHandCursorState(true);
        pendingSamples.push({ x: pos.x, y: pos.y, t: now });
      };

      const endTouch = (e: PointerEvent) => {
        if (e.pointerType !== 'touch' || e.pointerId !== activeTouchId) return;
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
        pendingSamples.length = 0;
        purr.stopPetting();
      };

      const onPointerLeave = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        if (pointerMode === 'mouse') {
          handWanted = false;
          isOverCat = false;
          pointerMode = 'none';
          prevPetPoint = null;
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
              handRot = 0;
            }
            pointerMode = 'keyboard';
            handWanted = true;
            prevPetPoint = { x: targetX, y: targetY, t: performance.now() };
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
        if (pointerMode === 'keyboard') {
          handWanted = false;
          isOverCat = false;
          pointerMode = 'none';
          prevPetPoint = null;
          purr.stopPetting();
        }
      };

      canvas.addEventListener('pointerenter', onPointerEnter);
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', endTouch);
      canvas.addEventListener('pointercancel', endTouch);
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
        canvas.removeEventListener('pointerup', endTouch);
        canvas.removeEventListener('pointercancel', endTouch);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        stageEl.removeEventListener('keydown', onKeyDown);
        stageEl.removeEventListener('keyup', onKeyUp);
        stageEl.removeEventListener('blur', onStageBlur);
      };

      // Main animation & petting simulation tick
      app.ticker.add((ticker) => {
        const dt = clamp(ticker.deltaMS / 1000, 0.001, 0.06);
        const now = performance.now();

        if (nipCooldown > 0) {
          nipCooldown = Math.max(0, nipCooldown - dt);
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

        // Fade displacement map toward neutral grey (~400 ms decay)
        if (dispActive && dispMap && dispFadeContainer) {
          dispIdleTime += dt;
          if (dispIdleTime >= 0.68) {
            clearDispMap();
            dispActive = false;
          } else {
            let fadeAlpha = 1 - Math.exp(-dt / 0.14);
            if (dispIdleTime > 0.42) {
              const settleT = clamp((dispIdleTime - 0.42) / 0.24, 0, 1);
              fadeAlpha = fadeAlpha + (1 - fadeAlpha) * settleT * 0.45;
            }
            dispFadeRect.alpha = clamp(fadeAlpha, 0.04, 1);
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
                  instSpeed / (catDisplayW * 1.65),
                  0.24,
                  1,
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

        // Update stroke speed & purr meter
        const speedLerp = 1 - Math.exp(-dt / 0.12);
        if (pettedThisFrame) {
          smoothedStrokeSpeed +=
            (frameMaxSpeed - smoothedStrokeSpeed) * speedLerp;
          idleSincePet = 0;
          // ~4.4 cat widths of stroking fills 0 -> 100%
          meter = clamp(meter + frameDistance / (catDisplayW * 4.4), 0, 1);
        } else {
          smoothedStrokeSpeed += (0 - smoothedStrokeSpeed) * speedLerp;
          idleSincePet += dt;
          if (idleSincePet > 0.9) {
            meter = Math.max(0, meter - dt * 0.055);
          }
        }

        // Threshold triggers (33%, 66%, 100%)
        if (meter >= 0.33 && !crossed33) {
          crossed33 = true;
          sighTimer = 0.55;
        } else if (meter < 0.25) {
          crossed33 = false;
        }

        if (meter >= 0.66 && !crossed66) {
          crossed66 = true;
          wiggleTimer = 0.72;
        } else if (meter < 0.56) {
          crossed66 = false;
        }

        if (meter >= 0.995 && !crossed100) {
          crossed100 = true;
        } else if (meter < 0.9) {
          crossed100 = false;
        }

        // Over-petting check: very fast rubbing at 100% for > 3 s -> playful nip + 1 s cooldown
        // Use idleSincePet grace window so 120Hz/240Hz frames between pointer events count reliably.
        const veryFastThreshold = catDisplayW * 1.55;
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
            nipShakeTimer = 0.42;
            meter = 0.72;
            crossed100 = false;
            purr.stopPetting();
            purr.triggerNipHaptic();
          }
        } else {
          overpetTimer = Math.max(0, overpetTimer - dt * 1.1);
        }

        // Update purr audio & haptics
        const normalizedAudioSpeed = clamp(
          smoothedStrokeSpeed / (catDisplayW * 1.4),
          0,
          1,
        );
        purr.update(
          dt,
          pettedThisFrame && nipCooldown <= 0,
          normalizedAudioSpeed,
        );

        // Cat reaction transforms (transforms on catContainer only; disabled bounce under reduced motion)
        if (sighTimer > 0) sighTimer = Math.max(0, sighTimer - dt);
        if (wiggleTimer > 0) wiggleTimer = Math.max(0, wiggleTimer - dt);
        if (nipShakeTimer > 0) nipShakeTimer = Math.max(0, nipShakeTimer - dt);

        const targetMelt = meter >= 0.94 && nipCooldown <= 0 ? 1 : 0;
        const meltLerp = 1 - Math.exp(-dt / 0.35);
        meltAmount += (targetMelt - meltAmount) * meltLerp;

        let reactScaleX = 1;
        let reactScaleY = 1;
        let reactRot = 0;
        let shakeOffsetX = 0;

        if (!reducedMotion) {
          // 33%+: gentle rhythmic breathing scale
          if (meter >= 0.33) {
            breathTime += dt * (2.1 + meter * 0.7);
            const depth = clamp((meter - 0.3) / 0.4, 0.35, 1);
            const wave = Math.sin(breathTime);
            reactScaleX *= 1 + wave * 0.018 * depth;
            reactScaleY *= 1 - wave * 0.014 * depth;
          }

          // Gentle welcoming breath on crossing 33%
          if (sighTimer > 0) {
            const p = 1 - sighTimer / 0.55;
            const pulse = Math.sin(p * Math.PI);
            reactScaleX *= 1 + pulse * 0.026;
            reactScaleY *= 1 - pulse * 0.02;
          }

          // 66%: squash-and-stretch wiggle
          if (wiggleTimer > 0) {
            const p = 1 - wiggleTimer / 0.72;
            const decay = Math.pow(1 - p, 1.35);
            const wobble = Math.sin(p * Math.PI * 3.5);
            reactScaleX *= 1 + wobble * 0.062 * decay;
            reactScaleY *= 1 - wobble * 0.054 * decay;
            reactRot += Math.sin(p * Math.PI * 3) * 0.048 * decay;
          }

          // 100%: happy melt (wider X, flatter Y)
          if (meltAmount > 0.002) {
            reactScaleX *= 1 + meltAmount * 0.072;
            reactScaleY *= 1 - meltAmount * 0.058;
          }

          // Over-petting nip shake
          if (nipShakeTimer > 0) {
            const p = 1 - nipShakeTimer / 0.42;
            const decay = Math.pow(1 - p, 1.25);
            const jolt = Math.sin(p * Math.PI * 6);
            shakeOffsetX = jolt * 14 * decay;
            reactRot += jolt * 0.085 * decay;
            reactScaleX *= 1 - 0.038 * decay;
            reactScaleY *= 1 + 0.05 * decay;
          }
        }

        catContainer.position.set(catCenterX + shakeOffsetX, catCenterY);
        catContainer.scale.set(
          catBaseScale * reactScaleX,
          catBaseScale * reactScaleY,
        );
        catContainer.rotation = reactRot;

        // Cushion shadow breathes softly with cat scale
        shadowSprite.scale.set(
          (catDisplayW * 0.94 * reactScaleX) / shadowTexture!.width,
          (catTexture!.height * catBaseScale * 0.82 * reactScaleY) /
            shadowTexture!.height,
        );

        // Hand smoothing (lerp ~0.25 per 60fps frame) & subtle directional tilt
        const handLerp = 1 - Math.pow(1 - 0.25, dt * 60);
        const prevHandX = handX;
        const prevHandY = handY;
        handX += (targetX - handX) * handLerp;
        handY += (targetY - handY) * handLerp;

        const frameVx = (handX - prevHandX) / dt;
        const frameVy = (handY - prevHandY) / dt;
        const velLerp = 1 - Math.exp(-dt / 0.08);
        handVelX += (frameVx - handVelX) * velLerp;
        handVelY += (frameVy - handVelY) * velLerp;

        // Tilt gently toward movement direction
        const targetRot = clamp(
          (handVelX * 0.00055) + (handVelY * 0.00012 * Math.sign(handVelX || 1)),
          -0.34,
          0.34,
        );
        const rotLerp = 1 - Math.exp(-dt / 0.09);
        handRot += (targetRot - handRot) * rotLerp;

        // Pull back slightly during nip cooldown; press gently while petting cat
        const desiredPress =
          handWanted && isOverCat && nipCooldown <= 0 ? 1 : 0;
        const pressLerp = 1 - Math.exp(-dt / 0.1);
        handPress += (desiredPress - handPress) * pressLerp;

        const targetAlpha = handWanted ? (nipCooldown > 0 ? 0.55 : 1) : 0;
        const alphaLerp = 1 - Math.exp(-dt / (handWanted ? 0.06 : 0.1));
        handAlpha += (targetAlpha - handAlpha) * alphaLerp;

        if (handAlpha < 0.01 && !handWanted) {
          handSprite.visible = false;
          handSprite.alpha = 0;
        } else {
          handSprite.visible = true;
          handSprite.alpha = handAlpha;
          const liftScale =
            nipCooldown > 0 ? 1.07 : 1 - handPress * 0.055;
          handSprite.position.set(
            handX,
            handY - (nipCooldown > 0 ? 10 : 0),
          );
          handSprite.rotation = handRot;
          handSprite.scale.set(handBaseScale * liftScale);
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
        } else if (meter >= 0.94) {
          nextMood = 'melt';
        } else if (wiggleTimer > 0 || meter >= 0.66) {
          nextMood = 'wiggle';
        } else if (meter >= 0.33) {
          nextMood = 'purring';
        } else if (meter > 0.02 || pettedThisFrame) {
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
        console.error('PetStage initialization failed:', err);
      }
    });

    return () => {
      cancelled = true;
      safeDestroy();
    };
  }, [imageUrl]);

  return (
    <div class="pet-stage-container">
      <div
        ref={stageRef}
        class={`pet-stage${handOverStage ? ' pet-stage--hand-active' : ''}${
          mood === 'nip' ? ' pet-stage--nip' : ''
        }`}
        tabIndex={0}
        role="application"
        aria-label="Interactive cat petting stage. Stroke with mouse or finger, or focus and use arrow keys to move the hand and pet."
      >
        <div ref={canvasHostRef} class="pet-canvas-host" />

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
              width="20"
              height="20"
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
              width="20"
              height="20"
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
      </div>

      <div class="purr-meter">
        <div class="purr-meter-header">
          <span class="purr-meter-label">Purr meter</span>
          <span
            class={`purr-meter-status${
              mood === 'nip' ? ' purr-meter-status--nip' : ''
            }`}
            aria-live="polite"
          >
            {moodCaption(mood)}
          </span>
          <span class="purr-meter-pct">{meterPct}%</span>
        </div>
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
          <span class="purr-meter-tick purr-meter-tick--33" aria-hidden="true" />
          <span class="purr-meter-tick purr-meter-tick--66" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
