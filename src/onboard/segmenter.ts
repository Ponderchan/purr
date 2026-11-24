import {
  FilesetResolver,
  InteractiveSegmenterLegacy,
} from '@mediapipe/tasks-vision';
import type { InteractiveSegmenterLegacyResult } from '@mediapipe/tasks-vision';

const MEDIAPIPE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MAGIC_TOUCH_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';

export type SegmenterDelegate = 'GPU' | 'CPU';

export interface SegmentationOutput {
  mask: Uint8Array;
  width: number;
  height: number;
  foregroundRatio: number;
  delegate: SegmenterDelegate;
}

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let wasmFilesetPromise: Promise<WasmFileset> | null = null;
let segmenterInstance: InteractiveSegmenterLegacy | null = null;
let activeDelegate: SegmenterDelegate = 'CPU';
let initPromise: Promise<SegmenterDelegate> | null = null;

function canUseWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    return gl !== null;
  } catch {
    return false;
  }
}

async function getWasmFileset(): Promise<WasmFileset> {
  if (!wasmFilesetPromise) {
    wasmFilesetPromise = FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL).catch(
      (err) => {
        wasmFilesetPromise = null;
        throw err;
      },
    );
  }
  return wasmFilesetPromise;
}

async function createWithDelegate(
  delegate: SegmenterDelegate,
): Promise<InteractiveSegmenterLegacy> {
  const vision = await getWasmFileset();
  return InteractiveSegmenterLegacy.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MAGIC_TOUCH_MODEL_URL,
      delegate,
    },
    outputCategoryMask: true,
    outputConfidenceMasks: true,
  });
}

async function initInternal(): Promise<SegmenterDelegate> {
  if (segmenterInstance) {
    return activeDelegate;
  }

  if (canUseWebGL()) {
    try {
      segmenterInstance = await createWithDelegate('GPU');
      activeDelegate = 'GPU';
      return activeDelegate;
    } catch {
      // Fall back to CPU delegate below
    }
  }

  segmenterInstance = await createWithDelegate('CPU');
  activeDelegate = 'CPU';
  return activeDelegate;
}

export async function ensureSegmenter(): Promise<SegmenterDelegate> {
  if (segmenterInstance) {
    return activeDelegate;
  }
  if (!initPromise) {
    initPromise = initInternal().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function fallbackToCpu(): Promise<void> {
  if (segmenterInstance) {
    try {
      segmenterInstance.close();
    } catch {
      // Ignore close error on broken GPU instance
    }
    segmenterInstance = null;
  }
  initPromise = null;
  segmenterInstance = await createWithDelegate('CPU');
  activeDelegate = 'CPU';
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function meanAroundPoint(
  data: Float32Array,
  width: number,
  height: number,
  normX: number,
  normY: number,
): number {
  const cx = clamp(Math.round(normX * (width - 1)), 0, width - 1);
  const cy = clamp(Math.round(normY * (height - 1)), 0, height - 1);
  let sum = 0;
  let count = 0;
  for (let dy = -2; dy <= 2; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= height) continue;
    const row = y * width;
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= width) continue;
      sum += data[row + x];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function resampleFloatMaskToUint8(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  invert: boolean,
): { mask: Uint8Array; foregroundRatio: number } {
  const out = new Uint8Array(dstW * dstH);
  let fgCount = 0;

  if (srcW === dstW && srcH === dstH) {
    for (let i = 0; i < out.length; i++) {
      const raw = clamp(src[i], 0, 1);
      const prob = invert ? 1 - raw : raw;
      const v = Math.round(prob * 255);
      out[i] = v;
      if (v >= 128) fgCount++;
    }
  } else {
    const scaleX = srcW / dstW;
    const scaleY = srcH / dstH;
    for (let y = 0; y < dstH; y++) {
      const sy = clamp((y + 0.5) * scaleY - 0.5, 0, srcH - 1);
      const y0 = Math.floor(sy);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const fy = sy - y0;
      const row0 = y0 * srcW;
      const row1 = y1 * srcW;
      const outRow = y * dstW;
      for (let x = 0; x < dstW; x++) {
        const sx = clamp((x + 0.5) * scaleX - 0.5, 0, srcW - 1);
        const x0 = Math.floor(sx);
        const x1 = Math.min(srcW - 1, x0 + 1);
        const fx = sx - x0;

        const top = src[row0 + x0] * (1 - fx) + src[row0 + x1] * fx;
        const bot = src[row1 + x0] * (1 - fx) + src[row1 + x1] * fx;
        const raw = clamp(top * (1 - fy) + bot * fy, 0, 1);
        const prob = invert ? 1 - raw : raw;
        const v = Math.round(prob * 255);
        out[outRow + x] = v;
        if (v >= 128) fgCount++;
      }
    }
  }

  return {
    mask: out,
    foregroundRatio: out.length > 0 ? fgCount / out.length : 0,
  };
}

function extractMaskFromResult(
  result: InteractiveSegmenterLegacyResult,
  targetW: number,
  targetH: number,
  normX: number,
  normY: number,
): { mask: Uint8Array; foregroundRatio: number } {
  const confMasks = result.confidenceMasks;
  if (confMasks && confMasks.length > 0) {
    let chosenMask = confMasks[0];
    let chosenData = chosenMask.getAsFloat32Array();
    let invert = false;

    if (confMasks.length >= 2) {
      // Pick the channel with higher confidence at the tapped cat point
      // (magic_touch outputs [background, foreground] or [foreground, background]).
      let bestScore = -1;
      for (let i = 0; i < confMasks.length; i++) {
        const candidate = confMasks[i];
        const data = candidate.getAsFloat32Array();
        const score = meanAroundPoint(
          data,
          candidate.width,
          candidate.height,
          normX,
          normY,
        );
        if (score > bestScore) {
          bestScore = score;
          chosenMask = candidate;
          chosenData = data;
        }
      }
    } else {
      const tapScore = meanAroundPoint(
        chosenData,
        chosenMask.width,
        chosenMask.height,
        normX,
        normY,
      );
      if (tapScore < 0.35) {
        let sum = 0;
        const step = Math.max(1, Math.floor(chosenData.length / 2048));
        let samples = 0;
        for (let i = 0; i < chosenData.length; i += step) {
          sum += chosenData[i];
          samples++;
        }
        const avg = samples > 0 ? sum / samples : 0;
        if (avg > 0.5) {
          invert = true;
        }
      }
    }

    return resampleFloatMaskToUint8(
      chosenData,
      chosenMask.width,
      chosenMask.height,
      targetW,
      targetH,
      invert,
    );
  }

  const catMask = result.categoryMask;
  if (catMask) {
    const raw = catMask.getAsUint8Array();
    const mw = catMask.width;
    const mh = catMask.height;
    const tx = clamp(Math.round(normX * (mw - 1)), 0, mw - 1);
    const ty = clamp(Math.round(normY * (mh - 1)), 0, mh - 1);
    const tapCategory = raw[ty * mw + tx];
    const floatMask = new Float32Array(mw * mh);
    for (let i = 0; i < floatMask.length; i++) {
      floatMask[i] = raw[i] === tapCategory ? 1 : 0;
    }
    return resampleFloatMaskToUint8(floatMask, mw, mh, targetW, targetH, false);
  }

  throw new Error('Segmenter returned no masks');
}

function runSegmentSync(
  instance: InteractiveSegmenterLegacy,
  canvas: HTMLCanvasElement,
  normX: number,
  normY: number,
): { mask: Uint8Array; foregroundRatio: number } {
  let extracted: { mask: Uint8Array; foregroundRatio: number } | null = null;
  let callbackErr: unknown = null;

  instance.segment(
    canvas,
    { keypoint: { x: normX, y: normY } },
    (result: InteractiveSegmenterLegacyResult) => {
      try {
        extracted = extractMaskFromResult(
          result,
          canvas.width,
          canvas.height,
          normX,
          normY,
        );
      } catch (err) {
        callbackErr = err;
      }
    },
  );

  if (callbackErr) {
    throw callbackErr;
  }
  if (!extracted) {
    throw new Error('Segmentation callback produced no mask');
  }
  return extracted;
}

export async function segmentAtPoint(
  canvas: HTMLCanvasElement,
  normX: number,
  normY: number,
): Promise<SegmentationOutput> {
  await ensureSegmenter();
  if (!segmenterInstance) {
    throw new Error('Segmenter not initialized');
  }

  const x = clamp(normX, 0, 1);
  const y = clamp(normY, 0, 1);

  try {
    const { mask, foregroundRatio } = runSegmentSync(
      segmenterInstance,
      canvas,
      x,
      y,
    );
    return {
      mask,
      width: canvas.width,
      height: canvas.height,
      foregroundRatio,
      delegate: activeDelegate,
    };
  } catch (err) {
    if (activeDelegate === 'GPU') {
      await fallbackToCpu();
      if (!segmenterInstance) {
        throw err;
      }
      const { mask, foregroundRatio } = runSegmentSync(
        segmenterInstance,
        canvas,
        x,
        y,
      );
      return {
        mask,
        width: canvas.width,
        height: canvas.height,
        foregroundRatio,
        delegate: activeDelegate,
      };
    }
    throw err;
  }
}

export function disposeSegmenter(): void {
  if (segmenterInstance) {
    try {
      segmenterInstance.close();
    } catch {
      // Ignore close error
    }
    segmenterInstance = null;
  }
  initPromise = null;
}
