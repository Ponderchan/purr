export interface CleanEdgesOptions {
  /** Alpha erosion radius in logical pixels (default: 1.5). */
  erodePx?: number;
  /** Alpha feather radius in logical pixels (default: 1.0). */
  featherPx?: number;
  /**
   * Reference dimension used to scale erode/feather radii proportionally for
   * higher-resolution cut-outs so visual cleanup stays consistent across sizes
   * (default: 768). Set to 0 to use exact pixel radii without scaling.
   */
  referenceSize?: number;
}

interface DiskOffset {
  dx: number;
  dy: number;
}

function buildDiskOffsets(radius: number): DiskOffset[] {
  const r = Math.max(0, Math.floor(radius));
  const rSq = r * r;
  const offsets: DiskOffset[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= rSq) {
        offsets.push({ dx, dy });
      }
    }
  }
  return offsets;
}

/**
 * Fast separable 1D box minimum used as a conservative bound to skip interior
 * opaque pixels before exact circular erosion.
 */
function boxMinAlpha(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return src.slice();
  const tmp = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let minVal = 255;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let ix = x0; ix <= x1; ix++) {
        const v = src[row + ix];
        if (v < minVal) {
          minVal = v;
          if (minVal === 0) break;
        }
      }
      tmp[row + x] = minVal;
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    const outRow = y * width;
    for (let x = 0; x < width; x++) {
      let minVal = 255;
      for (let iy = y0; iy <= y1; iy++) {
        const v = tmp[iy * width + x];
        if (v < minVal) {
          minVal = v;
          if (minVal === 0) break;
        }
      }
      out[outRow + x] = minVal;
    }
  }

  return out;
}

function erodeAlphaCircular(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return src.slice();
  const rFloor = Math.floor(radius);
  const rCeil = Math.ceil(radius);
  const frac = radius - rFloor;

  const conservativeMin = boxMinAlpha(src, width, height, rCeil);
  const floorOffsets = buildDiskOffsets(rFloor);
  const ceilOffsets = rCeil === rFloor ? floorOffsets : buildDiskOffsets(rCeil);

  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      const a = src[idx];
      if (a === 0) {
        out[idx] = 0;
        continue;
      }
      if (conservativeMin[idx] === 255) {
        out[idx] = 255;
        continue;
      }

      let minFloor = 255;
      if (rFloor > 0) {
        for (let k = 0; k < floorOffsets.length; k++) {
          const nx = x + floorOffsets[k].dx;
          const ny = y + floorOffsets[k].dy;
          const v =
            nx < 0 || nx >= width || ny < 0 || ny >= height
              ? 0
              : src[ny * width + nx];
          if (v < minFloor) {
            minFloor = v;
            if (minFloor === 0) break;
          }
        }
      } else {
        minFloor = a;
      }

      if (frac <= 0.001) {
        out[idx] = minFloor;
        continue;
      }

      let minCeil = minFloor;
      for (let k = 0; k < ceilOffsets.length; k++) {
        const nx = x + ceilOffsets[k].dx;
        const ny = y + ceilOffsets[k].dy;
        const v =
          nx < 0 || nx >= width || ny < 0 || ny >= height
            ? 0
            : src[ny * width + nx];
        if (v < minCeil) {
          minCeil = v;
          if (minCeil === 0) break;
        }
      }

      out[idx] = Math.round(minFloor * (1 - frac) + minCeil * frac);
    }
  }

  return out;
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

function featherAlpha(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0.05) return src.slice();
  const n = width * height;
  const rFloor = Math.floor(radius);
  const rCeil = Math.ceil(radius);
  const frac = radius - rFloor;

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
    const v = Math.min(255, Math.max(0, Math.round(blended)));
    out[i] = v < 3 ? 0 : v;
  }
  return out;
}

/**
 * Cleans light matte fringes from a cut-out RGBA pixel buffer in place:
 * 1. Tightens soft outer matte tails and erodes alpha inward by ~1.5 px
 *    (scaled proportionally for high-resolution cut-outs).
 * 2. Feathers the eroded alpha edge by ~1 px for natural anti-aliasing.
 * 3. Decontaminates edge colours via multi-source BFS from the uncontaminated
 *    fully-opaque interior: replaces RGB on all semi-transparent edge pixels
 *    (and outer transparent texels sampled by GPU linear filtering) and removes
 *    bright matte spill trapped along the outermost opaque rim.
 */
export function cleanCutoutImageData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: CleanEdgesOptions = {},
): void {
  if (width <= 0 || height <= 0) return;

  const n = width * height;
  const origAlpha = new Uint8Array(n);
  const chokedAlpha = new Uint8Array(n);

  // Pull back ultra-faint soft matte skirts before morphological erosion so
  // wide semi-transparent white-matte borders collapse cleanly to the subject edge.
  const chokeLow = 104;
  const chokeHigh = 250;
  const chokeSpan = chokeHigh - chokeLow;
  for (let i = 0; i < n; i++) {
    const a = pixels[i * 4 + 3];
    origAlpha[i] = a;
    if (a <= chokeLow) {
      chokedAlpha[i] = 0;
    } else if (a >= chokeHigh) {
      chokedAlpha[i] = 255;
    } else {
      chokedAlpha[i] = Math.round(((a - chokeLow) * 255) / chokeSpan);
    }
  }

  const erodeBase = options.erodePx ?? 1.5;
  const featherBase = options.featherPx ?? 1.0;
  const referenceSize = options.referenceSize ?? 768;
  const scale =
    referenceSize > 0 ? Math.max(1, Math.max(width, height) / referenceSize) : 1;

  const erodeR = erodeBase * scale;
  const featherR = featherBase * scale;

  // Step 1: Erode alpha inward by ~1.5 logical px
  const erodedAlpha = erodeAlphaCircular(chokedAlpha, width, height, erodeR);

  // Step 2: Feather the eroded alpha edge by ~1 logical px
  const finalAlpha = featherAlpha(erodedAlpha, width, height, featherR);

  // Step 3: Identify deep uncontaminated fully-opaque interior colour sources
  // Inset slightly further than erodeR so white light-wrap trapped along the
  // outermost opaque rim (and narrow fur-tuft notches) never seeds propagation.
  const colorInsetR = Math.max(2, Math.ceil(erodeR + 5.5 * scale));
  const opaqueCoreMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    opaqueCoreMask[i] = origAlpha[i] === 255 && erodedAlpha[i] === 255 ? 255 : 0;
  }
  const deepCoreMin = boxMinAlpha(opaqueCoreMask, width, height, colorInsetR);

  const isCleanInterior = new Uint8Array(n);
  let cleanCount = 0;
  for (let i = 0; i < n; i++) {
    if (deepCoreMin[i] === 255) {
      isCleanInterior[i] = 1;
      cleanCount++;
    }
  }

  // Fallback for very thin subjects or cut-outs whose interior alpha never hits 255
  if (cleanCount === 0) {
    for (let i = 0; i < n; i++) {
      if (erodedAlpha[i] >= 240) {
        isCleanInterior[i] = 1;
        cleanCount++;
      }
    }
  }

  if (cleanCount > 0) {
    const dist = new Int16Array(n);
    dist.fill(-1);
    const propR = new Uint8Array(n);
    const propG = new Uint8Array(n);
    const propB = new Uint8Array(n);

    const maxReach = Math.ceil(colorInsetR + erodeR + featherR + 18);
    const queue = new Int32Array(n);
    let qHead = 0;
    let qTail = 0;

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const idx = row + x;
        if (!isCleanInterior[idx]) continue;

        dist[idx] = 0;
        const pIdx = idx * 4;
        propR[idx] = pixels[pIdx];
        propG[idx] = pixels[pIdx + 1];
        propB[idx] = pixels[pIdx + 2];

        const onBorder =
          x === 0 ||
          x === width - 1 ||
          y === 0 ||
          y === height - 1 ||
          !isCleanInterior[idx - 1] ||
          !isCleanInterior[idx + 1] ||
          !isCleanInterior[idx - width] ||
          !isCleanInterior[idx + width];

        if (onBorder) {
          // Gently smooth the border seed across immediate clean-interior neighbors
          // to prevent single bright/dark specks from streaking outward.
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let cnt = 0;
          for (let dy = -2; dy <= 2; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            const nrow = ny * width;
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= width) continue;
              const nIdx = nrow + nx;
              if (isCleanInterior[nIdx]) {
                const np = nIdx * 4;
                sr += pixels[np];
                sg += pixels[np + 1];
                sb += pixels[np + 2];
                cnt++;
              }
            }
          }
          if (cnt > 0) {
            propR[idx] = Math.round(sr / cnt);
            propG[idx] = Math.round(sg / cnt);
            propB[idx] = Math.round(sb / cnt);
          }
          queue[qTail++] = idx;
        }
      }
    }

    // 8-connected multi-source wave BFS outward across the rim and transparent border
    const dirs = [
      -1, 0, 1, 0, 0, -1, 0, 1, -1, -1, 1, -1, -1, 1, 1, 1,
    ];

    while (qHead < qTail) {
      const waveEnd = qTail;
      const nextWaveStart = qTail;
      const curD = dist[queue[qHead]];
      if (curD >= maxReach) break;
      const nextD = curD + 1;

      for (let q = qHead; q < waveEnd; q++) {
        const idx = queue[q];
        const x = idx % width;
        const y = (idx - x) / width;

        for (let k = 0; k < dirs.length; k += 2) {
          const nx = x + dirs[k];
          const ny = y + dirs[k + 1];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (dist[nIdx] === -1) {
            dist[nIdx] = nextD;
            queue[qTail++] = nIdx;
          }
        }
      }

      for (let q = nextWaveStart; q < qTail; q++) {
        const idx = queue[q];
        const x = idx % width;
        const y = (idx - x) / width;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let cnt = 0;
        for (let k = 0; k < dirs.length; k += 2) {
          const nx = x + dirs[k];
          const ny = y + dirs[k + 1];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (dist[nIdx] === curD) {
            sr += propR[nIdx];
            sg += propG[nIdx];
            sb += propB[nIdx];
            cnt++;
          }
        }
        if (cnt > 0) {
          propR[idx] = Math.round(sr / cnt);
          propG[idx] = Math.round(sg / cnt);
          propB[idx] = Math.round(sb / cnt);
        }
      }

      qHead = waveEnd;
    }

    // Write decontaminated RGB and eroded+feathered alpha
    const insetNorm = Math.max(1, colorInsetR * 0.85);
    for (let i = 0; i < n; i++) {
      const pIdx = i * 4;
      const a = finalAlpha[i];
      if (!isCleanInterior[i] && dist[i] > 0) {
        if (a < 252) {
          // Semi-transparent edge & outer transparent border texels: full replacement
          pixels[pIdx] = propR[i];
          pixels[pIdx + 1] = propG[i];
          pixels[pIdx + 2] = propB[i];
        } else {
          // Outermost opaque rim: suppress white-matte spill/beads brighter than
          // the adjacent interior fur without altering naturally matching fur tones
          const r = pixels[pIdx];
          const g = pixels[pIdx + 1];
          const b = pixels[pIdx + 2];
          const pr = propR[i];
          const pg = propG[i];
          const pb = propB[i];
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          const propLuma = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          const excess = luma - propLuma - 8;
          if (excess > 0) {
            const haloStrength = Math.min(1, excess / 34);
            const edgeFactor = Math.min(1, dist[i] / insetNorm);
            const blend = Math.min(1, haloStrength * (0.65 + 0.35 * edgeFactor));
            pixels[pIdx] = Math.round(r + (pr - r) * blend);
            pixels[pIdx + 1] = Math.round(g + (pg - g) * blend);
            pixels[pIdx + 2] = Math.round(b + (pb - b) * blend);
          }
        }
      }
      pixels[pIdx + 3] = a;
    }
  } else {
    for (let i = 0; i < n; i++) {
      pixels[i * 4 + 3] = finalAlpha[i];
    }
  }
}

/**
 * Cleans light matte fringes from a cut-out image with alpha.
 * Used once at onboarding time (and offline to pre-bake bundled sample assets).
 */
export function cleanCutoutEdges(
  source: HTMLImageElement | HTMLCanvasElement,
  options: CleanEdgesOptions = {},
): HTMLCanvasElement {
  const width =
    source instanceof HTMLImageElement
      ? source.naturalWidth || source.width
      : source.width;
  const height =
    source instanceof HTMLImageElement
      ? source.naturalHeight || source.height
      : source.height;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || width <= 0 || height <= 0) {
    return canvas;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    return canvas;
  }

  cleanCutoutImageData(imageData.data, width, height, options);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
