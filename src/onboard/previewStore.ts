export interface CutoutResult {
  blob: Blob;
  mimeType: 'image/webp' | 'image/png';
  pngBlob: Blob;
  webpBlob: Blob | null;
  url: string;
  width: number;
  height: number;
}

export interface PreviewCat {
  name: string;
  slug: string;
  cutout: CutoutResult;
}

export interface TapPoint {
  x: number;
  y: number;
}

export interface OnboardDraft {
  step: 1 | 2 | 3;
  sourceCanvas: HTMLCanvasElement;
  photoWidth: number;
  photoHeight: number;
  mask: Uint8Array | null;
  tapPoints: TapPoint[];
  cutout: CutoutResult | null;
  name: string;
  slug: string;
  slugTouched: boolean;
  fallbackId: string;
}

let currentPreview: PreviewCat | null = null;
let currentDraft: OnboardDraft | null = null;

function revokeIfUnused(url: string | undefined): void {
  if (!url) return;
  if (currentPreview?.cutout.url === url) return;
  if (currentDraft?.cutout?.url === url) return;
  URL.revokeObjectURL(url);
}

export function getPreviewCat(): PreviewCat | null {
  return currentPreview;
}

export function setPreviewCat(next: PreviewCat | null): void {
  const prevUrl = currentPreview?.cutout.url;
  currentPreview = next;
  if (prevUrl && prevUrl !== next?.cutout.url) {
    revokeIfUnused(prevUrl);
  }
}

export function getOnboardDraft(): OnboardDraft | null {
  return currentDraft;
}

export function setOnboardDraft(next: OnboardDraft | null): void {
  const prevUrl = currentDraft?.cutout?.url;
  currentDraft = next;
  if (prevUrl && prevUrl !== next?.cutout?.url) {
    revokeIfUnused(prevUrl);
  }
}

export function clearOnboardState(): void {
  const previewUrl = currentPreview?.cutout.url;
  const draftUrl = currentDraft?.cutout?.url;
  currentPreview = null;
  currentDraft = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (draftUrl && draftUrl !== previewUrl) URL.revokeObjectURL(draftUrl);
}
