import { cleanCutoutEdges } from '../pet/cleanEdges';
import type { CutoutResult, TapPoint } from './previewStore';

const MASK_THRESHOLD = 128;
const PRE_FEATHER_PX = 2.5;
const CROP_PADDING_RATIO = 0.04;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Removes disconnected small foreground islands from the binary mask.
 * Keeps components containing any user tap point (or the largest component if none match).
 */
function removeSmallIslands(
  mask: Uint8Array,
  width: number,
  height: number,
  tapPoints: readonly TapPoint[],
): Uint8Array {
  const n = width * height;
  const labels = new Int32Array(n);
  const queue = new Int32Array(n);
  const areas: number[] = [0]; // 1-indexed component areas
  let nextLabel = 1;

  const dirs = [-1, 0, 1, 0, 0, -1, 0, 1, -1, -1, 1, -1, -1, 1, 1, 1];

  for (let start = 0; start < n; start++) {
    if (mask[start] < MASK_THRESHOLD || labels[start] !== 0) continue;

    const label = nextLabel++;
    let qHead = 0;
    let qTail = 0;
    labels[start] = label;
    queue[qTail++] = start;

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const x = idx % width;
      const y = (idx - x) / width;

      for (let k = 0; k < dirs.length; k += 2) {
        const nx = x + dirs[k];
        const ny = y + dirs[k + 1];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (labels[nIdx] === 0 && mask[nIdx] >= MASK_THRESHOLD) {
          labels[nIdx] = label;
          queue[qTail++] = nIdx;
        }
      }
    }

    areas.push(qTail);
  }

  if (nextLabel === 1) {
    return new Uint8Array(n);
  }

  let largestLabel = 1;
  let largestArea = areas[1];
  for (let l = 2; l < areas.length; l++) {
    if (areas[l] > largestArea) {
      largestArea = areas[l];
      largestLabel = l;
    }
  }

  const keepLabels = new Set<number>([largestLabel]);
  const minTappedArea = Math.max(64, Math.floor(largestArea * 0.005));

  for (const pt of tapPoints) {
    const cx = clamp(Math.round(pt.x * (width - 1)), 0, width - 1);
    const cy = clamp(Math.round(pt.y * (height - 1)), 0, height - 1);
    // Search a small radius around the tap in case the exact tap pixel was on a seam
    for (let r = 0; r <= 8; r++) {
      let found = false;
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= height) continue;
        const row = y * width;
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= width) continue;
          const lbl = labels[row + x];
          if (lbl > 0 && areas[lbl] >= minTappedArea) {
            keepLabels.add(lbl);
            found = true;
          }
        }
      }
      if (found) break;
    }
  }

  const cleaned = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (keepLabels.has(labels[i])) {
      cleaned[i] = 255;
    }
  }
  return cleaned;
}

function boxBlurPass(
  src: Float32Array,
  dst: Float32Array,
  tmp: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(1, Math.round(radius));
  const invWin = 1 / (2 * r + 1);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = src[row] * (r + 1);
    for (let i = 1; i <= r; i++) {
      sum += src[row + Math.min(i, width - 1)];
    }
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum * invWin;
      const addIdx = Math.min(x + r + 1, width - 1);
      const subIdx = Math.max(x - r, 0);
      sum += src[row + addIdx] - src[row + subIdx];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = tmp[x] * (r + 1);
    for (let i = 1; i <= r; i++) {
      sum += tmp[Math.min(i, height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum * invWin;
      const addRow = Math.min(y + r + 1, height - 1);
      const subRow = Math.max(y - r, 0);
      sum += tmp[addRow * width + x] - tmp[subRow * width + x];
    }
  }
}

function featherAlphaBuffer(
  src: Uint8Array,
  width: number,
  height: number,
  radiusPx: number,
): Uint8Array {
  if (radiusPx <= 0.1) return src.slice();
  const n = width * height;
  const rFloor = Math.floor(radiusPx);
  const rCeil = Math.ceil(radiusPx);
  const frac = radiusPx - rFloor;

  const base = new Float32Array(n);
  for (let i = 0; i < n; i++) base[i] = src[i];
  const tmp = new Float32Array(n);

  let floorBuf: Float32Array;
  if (rFloor === 0) {
    floorBuf = base;
  } else {
    const p1 = new Float32Array(n);
    const p2 = new Float32Array(n);
    boxBlurPass(base, p1, tmp, width, height, rFloor);
    boxBlurPass(p1, p2, tmp, width, height, rFloor);
    floorBuf = p2;
  }

  let ceilBuf = floorBuf;
  if (frac > 0.001 && rCeil > rFloor) {
    const p1 = new Float32Array(n);
    const p2 = new Float32Array(n);
    boxBlurPass(base, p1, tmp, width, height, rCeil);
    boxBlurPass(p1, p2, tmp, width, height, rCeil);
    ceilBuf = p2;
  }

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const blended =
      frac > 0.001
        ? floorBuf[i] * (1 - frac) + ceilBuf[i] * frac
        : floorBuf[i];
    out[i] = clamp(Math.round(blended), 0, 255);
  }
  return out;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

async function isRealWebP(blob: Blob): Promise<boolean> {
  if (blob.type !== 'image/webp' || blob.size < 12) return false;
  try {
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    return (
      header[0] === 0x52 && // R
      header[1] === 0x49 && // I
      header[2] === 0x46 && // F
      header[3] === 0x46 && // F
      header[8] === 0x57 && // W
      header[9] === 0x45 && // E
      header[10] === 0x42 && // B
      header[11] === 0x50 // P
    );
  } catch {
    return false;
  }
}

/**
 * Produces the final cut-out once at onboarding time:
 * 1. Removes small disconnected islands from the final mask.
 * 2. Feathers alpha by ~2.5 px.
 * 3. Crops to the mask bounding box + 4% padding.
 * 4. Runs cleanCutoutEdges() ONCE to decontaminate fringes.
 * 5. Exports PNG, plus WebP if the browser truly encodes WebP and it is smaller.
 */
export async function buildCutoutFromMask(
  sourceCanvas: HTMLCanvasElement,
  mask: Uint8Array,
  tapPoints: readonly TapPoint[],
): Promise<CutoutResult> {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) {
    throw new Error('Unable to read source canvas');
  }

  const cleanedMask = removeSmallIslands(mask, width, height, tapPoints);

  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (cleanedMask[row + x] >= MASK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('Mask contains no foreground pixels');
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const pad = Math.max(8, Math.round(Math.max(boxW, boxH) * CROP_PADDING_RATIO));
  const outW = boxW + pad * 2;
  const outH = boxH + pad * 2;
  const originX = minX - pad;
  const originY = minY - pad;

  // Build cropped binary mask (with guaranteed transparent padding even if cat touches photo border)
  const croppedMask = new Uint8Array(outW * outH);
  for (let oy = 0; oy < outH; oy++) {
    const sy = originY + oy;
    if (sy < 0 || sy >= height) continue;
    const srcRow = sy * width;
    const dstRow = oy * outW;
    for (let ox = 0; ox < outW; ox++) {
      const sx = originX + ox;
      if (sx < 0 || sx >= width) continue;
      croppedMask[dstRow + ox] = cleanedMask[srcRow + sx];
    }
  }

  // Feather mask alpha by 2.5 px
  const featheredAlpha = featherAlphaBuffer(
    croppedMask,
    outW,
    outH,
    PRE_FEATHER_PX,
  );

  // Copy source RGB into cropped canvas and apply feathered alpha
  const srcPixels = srcCtx.getImageData(0, 0, width, height).data;
  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = outW;
  croppedCanvas.height = outH;
  const cropCtx = croppedCanvas.getContext('2d', { willReadFrequently: true });
  if (!cropCtx) {
    throw new Error('Unable to create cutout canvas');
  }

  const outImage = cropCtx.createImageData(outW, outH);
  const outPixels = outImage.data;
  for (let oy = 0; oy < outH; oy++) {
    const sy = clamp(originY + oy, 0, height - 1);
    const inBoundsY = originY + oy >= 0 && originY + oy < height;
    const srcRow = sy * width;
    const dstRow = oy * outW;
    for (let ox = 0; ox < outW; ox++) {
      const idx = dstRow + ox;
      const alpha = featheredAlpha[idx];
      const dstP = idx * 4;
      if (alpha === 0 || !inBoundsY) {
        outPixels[dstP + 3] = 0;
        continue;
      }
      const rawSx = originX + ox;
      if (rawSx < 0 || rawSx >= width) {
        outPixels[dstP + 3] = 0;
        continue;
      }
      const srcP = (srcRow + rawSx) * 4;
      outPixels[dstP] = srcPixels[srcP];
      outPixels[dstP + 1] = srcPixels[srcP + 1];
      outPixels[dstP + 2] = srcPixels[srcP + 2];
      outPixels[dstP + 3] = alpha;
    }
  }
  cropCtx.putImageData(outImage, 0, 0);

  // Run cleanCutoutEdges() ONCE on the cropped result (exact px radii keep thin paws/ears crisp)
  const cleanedCanvas = cleanCutoutEdges(croppedCanvas, {
    erodePx: 1.0,
    featherPx: 1.5,
    referenceSize: 0,
  });

  const pngBlob = await canvasToBlob(cleanedCanvas, 'image/png');
  if (!pngBlob) {
    throw new Error('Failed to encode cutout PNG');
  }

  let webpBlob: Blob | null = null;
  const candidateWebp = await canvasToBlob(cleanedCanvas, 'image/webp', 0.9);
  if (
    candidateWebp &&
    (await isRealWebP(candidateWebp)) &&
    candidateWebp.size < pngBlob.size
  ) {
    webpBlob = candidateWebp;
  }

  const primaryBlob = webpBlob ?? pngBlob;
  const mimeType: 'image/webp' | 'image/png' = webpBlob
    ? 'image/webp'
    : 'image/png';
  const url = URL.createObjectURL(primaryBlob);

  return {
    blob: primaryBlob,
    mimeType,
    pngBlob,
    webpBlob,
    url,
    width: cleanedCanvas.width,
    height: cleanedCanvas.height,
  };
}
