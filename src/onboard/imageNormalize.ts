export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_LONG_EDGE_PX = 1600;

export type ImageNormalizeErrorCode =
  | 'file-too-large'
  | 'unsupported-format'
  | 'decode-failed';

export class ImageNormalizeError extends Error {
  readonly code: ImageNormalizeErrorCode;

  constructor(code: ImageNormalizeErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ImageNormalizeError';
    this.code = code;
  }
}

export interface NormalizedPhoto {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

const HEIC_BRANDS = new Set(['mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx']);

async function isHeicLikeFile(file: File): Promise<boolean> {
  const lowerName = file.name.toLowerCase();
  const lowerType = file.type.toLowerCase();
  if (
    lowerType === 'image/heic' ||
    lowerType === 'image/heif' ||
    lowerName.endsWith('.heic') ||
    lowerName.endsWith('.heif')
  ) {
    return true;
  }

  try {
    const header = await file.slice(4, 12).arrayBuffer();
    const bytes = new Uint8Array(header);
    if (bytes.length < 8) return false;
    const boxType = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (boxType !== 'ftyp') return false;
    const brand = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]).trim();
    return HEIC_BRANDS.has(brand);
  } catch {
    return false;
  }
}

export interface NormalizePhotoOptions {
  onHeicConverting?: () => void;
}

async function decodeToImageBitmap(
  file: File,
  options?: NormalizePhotoOptions,
): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (nativeErr) {
    if (await isHeicLikeFile(file)) {
      options?.onHeicConverting?.();
      try {
        const { heicTo } = await import('heic-to');
        return await heicTo({
          blob: file,
          type: 'bitmap',
          options: { imageOrientation: 'from-image' },
        });
      } catch (heicErr) {
        throw new ImageNormalizeError(
          'decode-failed',
          heicErr instanceof Error ? heicErr.message : String(heicErr),
        );
      }
    }

    // Fallback check: non-image files fail clearly
    if (file.type && !file.type.startsWith('image/')) {
      throw new ImageNormalizeError('unsupported-format');
    }

    throw new ImageNormalizeError(
      'decode-failed',
      nativeErr instanceof Error ? nativeErr.message : String(nativeErr),
    );
  }
}

/**
 * Validates size, normalises orientation via createImageBitmap({ imageOrientation: "from-image" }),
 * downscales so long edge <= 1600 px, and draws into a fresh canvas to strip all EXIF/GPS metadata.
 * The original File is never retained or uploaded.
 */
export async function normalizeUploadedPhoto(
  file: File,
  options?: NormalizePhotoOptions,
): Promise<NormalizedPhoto> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageNormalizeError('file-too-large');
  }

  if (
    file.type &&
    !file.type.startsWith('image/') &&
    !(await isHeicLikeFile(file))
  ) {
    throw new ImageNormalizeError('unsupported-format');
  }

  const bitmap = await decodeToImageBitmap(file, options);
  try {
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    if (srcW <= 0 || srcH <= 0) {
      throw new ImageNormalizeError('decode-failed');
    }

    const longEdge = Math.max(srcW, srcH);
    const scale = longEdge > MAX_LONG_EDGE_PX ? MAX_LONG_EDGE_PX / longEdge : 1;
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new ImageNormalizeError('decode-failed');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    return { canvas, width, height };
  } finally {
    bitmap.close();
  }
}
