import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { t } from '../i18n';
import { buildCutoutFromMask } from './cutoutExport';
import {
  ImageNormalizeError,
  normalizeUploadedPhoto,
} from './imageNormalize';
import {
  type CutoutResult,
  getOnboardDraft,
  setOnboardDraft,
  setPreviewCat,
  type TapPoint,
} from './previewStore';
import {
  checkSlugAvailability,
  createSessionFallbackId,
  MAX_NAME_LEN,
  MAX_SLUG_LEN,
  sanitizeSlugInput,
  suggestSlugFromName,
  validateCatName,
  validateSlug,
} from './slug';

type Step = 1 | 2 | 3;
type SegmenterStatus = 'idle' | 'loading' | 'ready' | 'error';
type SegmenterModule = typeof import('./segmenter');

const MINT_RGB: readonly [number, number, number] = [46, 111, 98]; // --c-mint (#2E6F62)
const MASK_PREVIEW_ALPHA = 0.45;

let segmenterModulePromise: Promise<SegmenterModule> | null = null;

function loadSegmenterModule(): Promise<SegmenterModule> {
  if (!segmenterModulePromise) {
    segmenterModulePromise = import('./segmenter').catch((err) => {
      segmenterModulePromise = null;
      throw err;
    });
  }
  return segmenterModulePromise;
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

function BackChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function UploadPhotoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      <path d="M12 4v11" />
      <path d="M8 8l4-4 4 4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function EmployeeBadgePreview({
  cutoutUrl,
  name,
  slug,
  compact = false,
}: {
  cutoutUrl: string;
  name: string;
  slug: string;
  compact?: boolean;
}) {
  const displayName = name.trim() || t('onboard.badgeDefaultName');
  const displaySlug = slug || 'mochi';

  if (compact) {
    return (
      <div class="employee-badge onboard-badge-mobile">
        <span class="employee-badge-avatar employee-badge-avatar--cutout">
          <img
            src={cutoutUrl}
            alt={t('cat.avatarAlt', { name: displayName })}
            class="cat-avatar-img cat-avatar-img--cutout"
          />
        </span>
        <div class="employee-badge-info">
          <div class="employee-badge-heading">
            <span class="employee-badge-name onboard-badge-name-mobile">
              {displayName}
            </span>
            <span class="employee-badge-role">{t('onboard.badgeRole')}</span>
          </div>
          <span class="employee-badge-meta">
            <span class="num">purr.si/{displaySlug}</span>
          </span>
          <span class="employee-badge-tags">
            <span class="personality-tag">{t('onboard.badgeTagNew')}</span>
            <span class="personality-tag">{t('onboard.badgeTagPreview')}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div class="onboard-badge-card">
      <div class="onboard-badge-slot" aria-hidden="true" />
      <div class="onboard-badge-avatar">
        <img
          src={cutoutUrl}
          alt={t('cat.avatarAlt', { name: displayName })}
          class="cat-avatar-img cat-avatar-img--cutout"
        />
      </div>
      <div class="onboard-badge-title-group">
        <div class="onboard-badge-name">{displayName}</div>
        <div class="onboard-badge-sub">{t('onboard.badgeStatus')}</div>
      </div>
      <div class="onboard-badge-tags">
        <span class="personality-tag">{t('onboard.badgeTagNew')}</span>
        <span class="personality-tag">{t('onboard.badgeTagPreview')}</span>
      </div>
      <div class="onboard-badge-divider" />
      <div class="onboard-badge-footer">
        <span>{t('onboard.badgeFooterDay')}</span>
        <span class="num">purr.si/{displaySlug}</span>
      </div>
    </div>
  );
}

export function OnboardPage() {
  const { route } = useLocation();
  const initialDraft = getOnboardDraft();

  const [step, setStep] = useState<Step>(() => initialDraft?.step ?? 1);
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(
    () => initialDraft?.sourceCanvas ?? null,
  );
  const [photoSize, setPhotoSize] = useState<{ w: number; h: number }>(() =>
    initialDraft
      ? { w: initialDraft.photoWidth, h: initialDraft.photoHeight }
      : { w: 0, h: 0 },
  );
  const [mask, setMask] = useState<Uint8Array | null>(
    () => initialDraft?.mask ?? null,
  );
  const [tapPoints, setTapPoints] = useState<TapPoint[]>(
    () => initialDraft?.tapPoints ?? [],
  );
  const [cutout, setCutout] = useState<CutoutResult | null>(
    () => initialDraft?.cutout ?? null,
  );
  const [name, setName] = useState<string>(() => initialDraft?.name ?? '');
  const [fallbackId] = useState<string>(
    () => initialDraft?.fallbackId ?? createSessionFallbackId(),
  );
  const [slug, setSlug] = useState<string>(
    () => initialDraft?.slug ?? suggestSlugFromName('', fallbackId),
  );
  const [slugTouched, setSlugTouched] = useState<boolean>(
    () => initialDraft?.slugTouched ?? false,
  );
  const [slugAvailable, setSlugAvailable] = useState<boolean>(true);

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isConvertingHeic, setIsConvertingHeic] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [segmenterStatus, setSegmenterStatus] =
    useState<SegmenterStatus>('idle');
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const pendingTapRef = useRef<TapPoint | null>(null);
  const dragDepthRef = useRef(0);
  const [fitBox, setFitBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep draft synchronized in memory so returning from /new/preview preserves work
  useEffect(() => {
    if (!sourceCanvas) return;
    setOnboardDraft({
      step,
      sourceCanvas,
      photoWidth: photoSize.w,
      photoHeight: photoSize.h,
      mask,
      tapPoints,
      cutout,
      name,
      slug,
      slugTouched,
      fallbackId,
    });
  }, [
    step,
    sourceCanvas,
    photoSize.w,
    photoSize.h,
    mask,
    tapPoints,
    cutout,
    name,
    slug,
    slugTouched,
    fallbackId,
  ]);

  // Lazy-load MediaPipe InteractiveSegmenter only when needed on Step 2
  const initSegmenter = useCallback(async (): Promise<boolean> => {
    setSegmenterStatus('loading');
    setSegmentError(null);
    try {
      const mod = await loadSegmenterModule();
      await mod.ensureSegmenter();
      if (!mountedRef.current) return false;
      setSegmenterStatus('ready');
      return true;
    } catch {
      if (!mountedRef.current) return false;
      setSegmenterStatus('error');
      setSegmentError(t('onboard.errLoadSegmenter'));
      return false;
    }
  }, []);

  useEffect(() => {
    if (step === 2 && segmenterStatus === 'idle') {
      void initSegmenter();
    }
  }, [step, segmenterStatus, initSegmenter]);

  // Compute exact contained display rectangle for the Step 2 photo stage
  useEffect(() => {
    if (step !== 2 || photoSize.w <= 0 || photoSize.h <= 0) return;
    const box = stageBoxRef.current;
    if (!box) return;

    const updateFit = () => {
      const rect = box.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scale = Math.min(rect.width / photoSize.w, rect.height / photoSize.h);
      setFitBox({
        w: Math.max(1, Math.round(photoSize.w * scale)),
        h: Math.max(1, Math.round(photoSize.h * scale)),
      });
    };

    updateFit();
    const ro = new ResizeObserver(updateFit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [step, photoSize.w, photoSize.h]);

  // Draw normalized photo into the visible Step 2 canvas
  useEffect(() => {
    if (step !== 2 || !sourceCanvas) return;
    const canvas = photoCanvasRef.current;
    if (!canvas) return;
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceCanvas, 0, 0);
  }, [step, sourceCanvas, fitBox.w, fitBox.h]);

  // Draw mint (--c-mint, ~45% opacity) mask overlay onto the mask canvas
  useEffect(() => {
    if (step !== 2 || photoSize.w <= 0 || photoSize.h <= 0) return;
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    if (canvas.width !== photoSize.w || canvas.height !== photoSize.h) {
      canvas.width = photoSize.w;
      canvas.height = photoSize.h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!mask) return;

    const imgData = ctx.createImageData(photoSize.w, photoSize.h);
    const out = imgData.data;
    const [r, g, b] = MINT_RGB;
    for (let i = 0; i < mask.length; i++) {
      const m = mask[i];
      if (m < 128) continue;
      const p = i * 4;
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = Math.round(m * MASK_PREVIEW_ALPHA);
    }
    ctx.putImageData(imgData, 0, 0);
  }, [step, mask, photoSize.w, photoSize.h]);

  const runSegmentation = useCallback(
    async (normX: number, normY: number) => {
      if (!sourceCanvas || isSegmenting || isExporting) return;

      if (segmenterStatus === 'loading' || segmenterStatus === 'idle') {
        pendingTapRef.current = { x: normX, y: normY };
        return;
      }

      if (segmenterStatus === 'error') {
        const ok = await initSegmenter();
        if (!ok) return;
      }

      setIsSegmenting(true);
      setSegmentError(null);

      // Yield a frame so loading state paints before synchronous WASM inference
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      try {
        const mod = await loadSegmenterModule();
        const result = await mod.segmentAtPoint(sourceCanvas, normX, normY);
        if (!mountedRef.current) return;

        if (result.foregroundRatio < 0.002 || result.foregroundRatio > 0.96) {
          setSegmentError(t('onboard.errNoCatFound'));
          return;
        }

        if (addMode && mask && mask.length === result.mask.length) {
          const merged = new Uint8Array(mask.length);
          for (let i = 0; i < mask.length; i++) {
            merged[i] = mask[i] >= result.mask[i] ? mask[i] : result.mask[i];
          }
          setMask(merged);
          setTapPoints((prev) => [...prev, { x: normX, y: normY }]);
          setAddMode(false);
        } else {
          setMask(result.mask);
          setTapPoints([{ x: normX, y: normY }]);
        }
        setCutout(null);
      } catch {
        if (!mountedRef.current) return;
        setSegmentError(t('onboard.errSegmentFailed'));
      } finally {
        if (mountedRef.current) {
          setIsSegmenting(false);
        }
      }
    },
    [
      sourceCanvas,
      isSegmenting,
      isExporting,
      segmenterStatus,
      initSegmenter,
      addMode,
      mask,
    ],
  );

  // If user tapped while segmenter was warming up, run queued tap automatically
  useEffect(() => {
    if (segmenterStatus === 'ready' && pendingTapRef.current && !isSegmenting) {
      const queued = pendingTapRef.current;
      pendingTapRef.current = null;
      void runSegmentation(queued.x, queued.y);
    }
  }, [segmenterStatus, isSegmenting, runSegmentation]);

  // Availability check stub for slug
  const slugValidation = validateSlug(slug);
  useEffect(() => {
    if (slugValidation !== 'valid') {
      setSlugAvailable(false);
      return;
    }
    let cancelled = false;
    void checkSlugAvailability(slug).then((ok) => {
      if (!cancelled) setSlugAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, slugValidation]);

  const handleFileSelected = useCallback(
    async (file: File) => {
      setUploadError(null);
      setIsProcessingFile(true);
      setIsConvertingHeic(false);

      // Start lazy-loading segmenter in parallel as soon as a photo is chosen
      if (segmenterStatus === 'idle') {
        void initSegmenter();
      }

      try {
        const normalized = await normalizeUploadedPhoto(file, {
          onHeicConverting: () => {
            if (mountedRef.current) {
              setIsConvertingHeic(true);
            }
          },
        });
        if (!mountedRef.current) return;
        setSourceCanvas(normalized.canvas);
        setPhotoSize({ w: normalized.width, h: normalized.height });
        setMask(null);
        setTapPoints([]);
        setAddMode(false);
        setCutout(null);
        setSegmentError(null);
        pendingTapRef.current = null;
        setStep(2);
      } catch (err) {
        if (!mountedRef.current) return;
        if (err instanceof ImageNormalizeError) {
          if (err.code === 'file-too-large') {
            setUploadError(t('onboard.errTooLarge'));
          } else if (err.code === 'unsupported-format') {
            setUploadError(t('onboard.errUnsupported'));
          } else {
            setUploadError(t('onboard.errDecode'));
          }
        } else {
          setUploadError(t('onboard.errDecode'));
        }
      } finally {
        if (mountedRef.current) {
          setIsProcessingFile(false);
          setIsConvertingHeic(false);
        }
      }
    },
    [segmenterStatus, initSegmenter],
  );

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const onFileInputChange = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    // Reset input immediately so the same file can be re-selected and File isn't retained
    e.currentTarget.value = '';
    if (file) {
      void handleFileSelected(file);
    }
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      void handleFileSelected(file);
    }
  };

  const onPhotoPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  };

  const onPhotoPointerUp = (e: PointerEvent) => {
    const start = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) return;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;
    if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return;

    void runSegmentation(normX, normY);
  };

  const onPhotoKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void runSegmentation(0.5, 0.5);
    }
  };

  const handleResetMask = () => {
    setMask(null);
    setTapPoints([]);
    setAddMode(false);
    setCutout(null);
    setSegmentError(null);
    pendingTapRef.current = null;
  };

  const handleChangePhoto = () => {
    setSourceCanvas(null);
    setPhotoSize({ w: 0, h: 0 });
    setMask(null);
    setTapPoints([]);
    setAddMode(false);
    setCutout(null);
    setSegmentError(null);
    setUploadError(null);
    pendingTapRef.current = null;
    setOnboardDraft(null);
    setStep(1);
  };

  const handleConfirmCutout = async () => {
    if (!sourceCanvas || !mask || isExporting || isSegmenting) return;
    setIsExporting(true);
    setSegmentError(null);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      const result = await buildCutoutFromMask(sourceCanvas, mask, tapPoints);
      if (!mountedRef.current) return;
      setCutout(result);
      setStep(3);
    } catch {
      if (!mountedRef.current) return;
      setSegmentError(t('onboard.errExportFailed'));
    } finally {
      if (mountedRef.current) {
        setIsExporting(false);
      }
    }
  };

  const handleNameChange = (nextName: string) => {
    const trimmedMax = nextName.slice(0, MAX_NAME_LEN);
    setName(trimmedMax);
    if (!slugTouched) {
      setSlug(suggestSlugFromName(trimmedMax, fallbackId));
    }
  };

  const handleSlugChange = (rawSlug: string) => {
    setSlugTouched(true);
    setSlug(sanitizeSlugInput(rawSlug));
  };

  const canPreview =
    cutout !== null &&
    validateCatName(name) &&
    slugValidation === 'valid' &&
    slugAvailable;

  const handleOpenPreview = () => {
    if (!canPreview || !cutout) return;
    const trimmedName = name.trim();
    setPreviewCat({
      name: trimmedName,
      slug,
      cutout,
    });
    route('/new/preview');
  };

  const getSlugErrorText = (): string | null => {
    switch (slugValidation) {
      case 'too-short':
        return t('onboard.slugErrShort');
      case 'too-long':
        return t('onboard.slugErrLong');
      case 'invalid-chars':
        return t('onboard.slugErrChars');
      case 'invalid-edge':
        return t('onboard.slugErrEdge');
      default:
        return null;
    }
  };

  const slugErrorText = getSlugErrorText();

  const webHeading =
    step === 1
      ? t('onboard.webTitle1')
      : step === 2
        ? t('onboard.webTitle2')
        : t('onboard.webTitle3');

  const getStageStatusChip = (): { text: string; active: boolean } => {
    if (isExporting) return { text: t('onboard.exporting'), active: true };
    if (segmenterStatus === 'loading') {
      return { text: t('onboard.preparing'), active: true };
    }
    if (isSegmenting) return { text: t('onboard.segmenting'), active: true };
    if (addMode) return { text: t('onboard.addPiecePrompt'), active: true };
    if (mask) return { text: t('onboard.maskReady'), active: true };
    return { text: t('onboard.tapPrompt'), active: false };
  };

  const statusChip = getStageStatusChip();
  const hasMask = mask !== null;

  const renderStep2Stage = () => (
    <div
      ref={stageBoxRef}
      class={`onboard-stage onboard-stage--photo${
        isSegmenting || isExporting ? ' onboard-stage--busy' : ''
      }`}
    >
      {sourceCanvas ? (
        <div
          class="onboard-photo-fit"
          style={
            fitBox.w > 0 && fitBox.h > 0
              ? { width: `${fitBox.w}px`, height: `${fitBox.h}px` }
              : undefined
          }
          role="button"
          tabIndex={0}
          aria-label={t('onboard.photoAria')}
          onPointerDown={onPhotoPointerDown}
          onPointerUp={onPhotoPointerUp}
          onKeyDown={onPhotoKeyDown}
        >
          <canvas ref={photoCanvasRef} class="onboard-photo-canvas" />
          <canvas
            ref={maskCanvasRef}
            class="onboard-mask-canvas"
            aria-hidden="true"
          />
          {tapPoints.map((pt, idx) => (
            <span
              key={`${idx}-${pt.x.toFixed(3)}-${pt.y.toFixed(3)}`}
              class="onboard-tap-marker"
              aria-hidden="true"
              style={{
                left: `${pt.x * 100}%`,
                top: `${pt.y * 100}%`,
              }}
            >
              <span class="onboard-tap-marker-dot" />
            </span>
          ))}
        </div>
      ) : null}

      <span class="onboard-stage-chip onboard-stage-chip--left" role="status">
        <span
          class={`onboard-stage-dot${
            statusChip.active ? ' onboard-stage-dot--active' : ''
          }`}
          aria-hidden="true"
        />
        {statusChip.text}
      </span>

      <span class="onboard-stage-chip onboard-stage-chip--right">
        {t('onboard.privacyLine')}
      </span>
    </div>
  );

  const renderStep1Stage = () => (
    <div
      class={`onboard-stage onboard-stage--drop${
        isDragging ? ' onboard-stage--dragging' : ''
      }`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        class="onboard-drop-surface"
        onClick={openFilePicker}
        disabled={isProcessingFile}
      >
        <span class="onboard-drop-icon" aria-hidden="true">
          <UploadPhotoIcon />
        </span>
        <span class="onboard-drop-title" role={isProcessingFile ? 'status' : undefined}>
          {isConvertingHeic
            ? t('onboard.convertingHeic')
            : isProcessingFile
              ? t('onboard.processingPhoto')
              : isDragging
                ? t('onboard.dropActive')
                : t('onboard.dropTitle')}
        </span>
        <span class="onboard-drop-hint">{t('onboard.step1Hint')}</span>
        <span class="onboard-drop-sub">{t('onboard.dropHintDesktop')}</span>
      </button>

      {uploadError ? (
        <p class="onboard-inline-error onboard-inline-error--stage" role="alert">
          {uploadError}
        </p>
      ) : null}

      <span class="onboard-privacy-pill">
        <ShieldIcon />
        {t('onboard.privacyLine')}
      </span>
    </div>
  );

  const renderStep3Stage = () => (
    <div class="onboard-stage onboard-stage--badge">
      {cutout ? (
        <>
          <EmployeeBadgePreview
            cutoutUrl={cutout.url}
            name={name}
            slug={slug}
          />
          <span class="onboard-badge-meta-chip">
            <span class="onboard-badge-meta-dot" aria-hidden="true" />
            {t('onboard.cutoutReadyChip')} ·{' '}
            <span class="num">
              {cutout.mimeType === 'image/webp' ? 'WebP' : 'PNG'}{' '}
              {formatByteSize(cutout.blob.size)}
            </span>
          </span>
        </>
      ) : null}
    </div>
  );

  const renderNameSlugFields = (idPrefix: string) => (
    <div class="onboard-form">
      <div class="onboard-field">
        <div class="onboard-field-top">
          <label class="onboard-label" for={`${idPrefix}-cat-name`}>
            {t('onboard.nameLabel')}
          </label>
          <span class="onboard-char-count num">
            {name.trim().length}/{MAX_NAME_LEN}
          </span>
        </div>
        <input
          id={`${idPrefix}-cat-name`}
          type="text"
          class="onboard-input"
          value={name}
          maxLength={MAX_NAME_LEN}
          placeholder={t('onboard.namePlaceholder')}
          autoComplete="off"
          onInput={(e) => handleNameChange(e.currentTarget.value)}
        />
      </div>

      <div class="onboard-field">
        <label class="onboard-label" for={`${idPrefix}-cat-slug`}>
          {t('onboard.slugLabel')}
        </label>
        <div
          class={`onboard-slug-box${
            slugErrorText ? ' onboard-slug-box--error' : ''
          }`}
        >
          <span class="onboard-slug-prefix num">purr.si/</span>
          <input
            id={`${idPrefix}-cat-slug`}
            type="text"
            class="onboard-slug-input num"
            value={slug}
            maxLength={MAX_SLUG_LEN}
            spellcheck={false}
            autoCapitalize="none"
            autoComplete="off"
            onInput={(e) => handleSlugChange(e.currentTarget.value)}
          />
        </div>
        <div class="onboard-slug-status">
          {slugErrorText ? (
            <span class="onboard-slug-error" role="alert">
              {slugErrorText}
            </span>
          ) : (
            <>
              <span class="onboard-slug-preview num">purr.si/{slug}</span>
              <span class="onboard-slug-ok">{t('onboard.slugAvailable')}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div class="onboard-page">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        class="sr-only"
        onChange={onFileInputChange}
      />

      {/* Mobile header (< 768px, matches Onboard.webp) */}
      <header class="onboard-mobile-header">
        <a
          href="/"
          class="onboard-mobile-back"
          aria-label={t('onboard.mobileBackAria')}
        >
          <BackChevronIcon />
        </a>
        <div class="onboard-mobile-heading">
          <span class="onboard-eyebrow">{t('brand.frontDesk')}</span>
          <h1 class="onboard-mobile-title">{t('onboard.mobileTitle')}</h1>
        </div>
      </header>

      {/* Mobile horizontal 3-step indicator (< 768px) */}
      <ol class="onboard-mobile-steps" aria-label={t('onboard.progressAria')}>
        <li
          class={`onboard-step-pill${
            step > 1
              ? ' onboard-step-pill--done'
              : step === 1
                ? ' onboard-step-pill--active'
                : ''
          }`}
          aria-current={step === 1 ? 'step' : undefined}
        >
          {step > 1 ? (
            <button
              type="button"
              class="onboard-step-pill-btn"
              onClick={handleChangePhoto}
            >
              <span class="onboard-step-circle onboard-step-circle--done">
                <CheckIcon size={12} />
              </span>
              {t('onboard.shortStep1')}
            </button>
          ) : (
            <>
              <span
                class={`onboard-step-circle${
                  step === 1 ? ' onboard-step-circle--active' : ''
                } num`}
              >
                1
              </span>
              {t('onboard.shortStep1')}
            </>
          )}
        </li>

        <li
          class={`onboard-step-pill${
            step > 2
              ? ' onboard-step-pill--done'
              : step === 2
                ? ' onboard-step-pill--active'
                : ''
          }`}
          aria-current={step === 2 ? 'step' : undefined}
        >
          {step > 2 ? (
            <button
              type="button"
              class="onboard-step-pill-btn"
              onClick={() => setStep(2)}
            >
              <span class="onboard-step-circle onboard-step-circle--done">
                <CheckIcon size={12} />
              </span>
              {t('onboard.shortStep2')}
            </button>
          ) : (
            <>
              <span
                class={`onboard-step-circle${
                  step === 2 ? ' onboard-step-circle--active' : ''
                } num`}
              >
                2
              </span>
              {t('onboard.shortStep2')}
            </>
          )}
        </li>

        <li
          class={`onboard-step-pill${
            step === 3 ? ' onboard-step-pill--active' : ''
          }`}
          aria-current={step === 3 ? 'step' : undefined}
        >
          <span
            class={`onboard-step-circle${
              step === 3 ? ' onboard-step-circle--active' : ''
            } num`}
          >
            3
          </span>
          {t('onboard.shortStep3')}
        </li>
      </ol>

      {/* Web heading (>= 768px, matches WebOnboard.webp) */}
      <div class="onboard-web-heading">
        <span class="onboard-web-eyebrow">
          {t('onboard.stepCountBefore')}
          <span class="num">{step}</span>
          {t('onboard.stepCountMiddle')}
          <span class="num">3</span>
          {t('onboard.stepCountAfter')}
        </span>
        <h1 class="onboard-web-title">{webHeading}</h1>
      </div>

      {/* Main two-column workspace */}
      <div class="onboard-body">
        {/* Left column: primary visual stage */}
        <div class="onboard-stage-col">
          {step === 1 ? renderStep1Stage() : null}
          {step === 2 ? renderStep2Stage() : null}
          {step === 3 ? renderStep3Stage() : null}

          {/* Mobile step 1 bottom action */}
          {step === 1 ? (
            <div class="onboard-mobile-footer">
              <button
                type="button"
                class="btn-primary onboard-btn-full"
                onClick={openFilePicker}
                disabled={isProcessingFile}
              >
                {isConvertingHeic
                  ? t('onboard.convertingHeic')
                  : isProcessingFile
                    ? t('onboard.processingPhoto')
                    : t('onboard.choosePhoto')}
              </button>
            </div>
          ) : null}

          {/* Mobile step 2 description & actions (matches Onboard.webp) */}
          {step === 2 ? (
            <div class="onboard-mobile-step2">
              <div class="onboard-mobile-copy">
                <p class="onboard-mobile-copy-title">
                  {t('onboard.step2MobileHeading')}
                </p>
                <p class="onboard-mobile-copy-sub">{t('onboard.step2Hint')}</p>
                <p class="onboard-mobile-privacy">
                  <ShieldIcon />
                  {t('onboard.privacyLine')}
                </p>
              </div>

              {segmentError ? (
                <div class="onboard-inline-error" role="alert">
                  <span>{segmentError}</span>
                  {segmenterStatus === 'error' ? (
                    <button
                      type="button"
                      class="onboard-retry-link"
                      onClick={() => void initSegmenter()}
                    >
                      {t('onboard.btnRetry')}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div class="onboard-mobile-footer">
                <button
                  type="button"
                  class="btn-primary onboard-btn-full"
                  disabled={!hasMask || isSegmenting || isExporting}
                  onClick={() => void handleConfirmCutout()}
                >
                  {isExporting ? t('onboard.exporting') : t('onboard.btnNext')}
                </button>
                <div class="onboard-mobile-btn-row">
                  <button
                    type="button"
                    class={`btn-outline onboard-btn-secondary${
                      addMode ? ' onboard-btn-secondary--active' : ''
                    }`}
                    aria-pressed={addMode}
                    disabled={!hasMask || isSegmenting || isExporting}
                    onClick={() => setAddMode((prev) => !prev)}
                  >
                    {addMode
                      ? t('onboard.btnAddPieceActive')
                      : t('onboard.btnAddPiece')}
                  </button>
                  <button
                    type="button"
                    class="btn-outline onboard-btn-compact"
                    disabled={!hasMask || isSegmenting || isExporting}
                    onClick={handleResetMask}
                  >
                    {t('onboard.btnReset')}
                  </button>
                  <button
                    type="button"
                    class="btn-outline onboard-btn-compact"
                    disabled={isSegmenting || isExporting}
                    onClick={handleChangePhoto}
                  >
                    {t('onboard.btnChangePhoto')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Mobile step 3 badge + form + actions */}
          {step === 3 && cutout ? (
            <div class="onboard-mobile-step3">
              <EmployeeBadgePreview
                cutoutUrl={cutout.url}
                name={name}
                slug={slug}
                compact
              />
              {renderNameSlugFields('mobile')}
              <p class="onboard-footnote">{t('onboard.footnote')}</p>
              <div class="onboard-mobile-footer">
                <button
                  type="button"
                  class="btn-primary onboard-btn-full"
                  disabled={!canPreview}
                  onClick={handleOpenPreview}
                >
                  {t('onboard.btnPreviewRoom')}
                </button>
                <button
                  type="button"
                  class="btn-outline onboard-btn-full-outline"
                  onClick={() => setStep(2)}
                >
                  {t('onboard.btnBackToMask')}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right column: desktop 3-step vertical cards (>= 768px, matches WebOnboard.webp) */}
        <aside class="onboard-side-col">
          <ol class="onboard-web-steps" aria-label={t('onboard.progressAria')}>
            {/* Step 1 card */}
            <li
              class={`onboard-web-card${
                step > 1
                  ? ' onboard-web-card--done'
                  : step === 1
                    ? ' onboard-web-card--active'
                    : ''
              }`}
              aria-current={step === 1 ? 'step' : undefined}
            >
              {step > 1 ? (
                <div class="onboard-web-card-done-row">
                  <span class="onboard-web-circle onboard-web-circle--done">
                    <CheckIcon size={14} />
                  </span>
                  <div class="onboard-web-card-done-text">
                    <span class="onboard-web-card-title">
                      {t('onboard.step1Title')}
                    </span>
                    <span class="onboard-web-card-sub">
                      {t('onboard.step1Hint')}
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div class="onboard-web-card-header">
                    <span class="onboard-web-circle onboard-web-circle--active num">
                      1
                    </span>
                    <span class="onboard-web-card-title">
                      {t('onboard.step1Title')}
                    </span>
                  </div>
                  <p class="onboard-web-card-desc">
                    {t('onboard.step1Hint')}
                  </p>
                  {uploadError ? (
                    <p class="onboard-inline-error" role="alert">
                      {uploadError}
                    </p>
                  ) : null}
                  <div class="onboard-web-card-actions">
                    <button
                      type="button"
                      class="btn-primary"
                      onClick={openFilePicker}
                      disabled={isProcessingFile}
                    >
                      {isConvertingHeic
                        ? t('onboard.convertingHeic')
                        : isProcessingFile
                          ? t('onboard.processingPhoto')
                          : t('onboard.choosePhoto')}
                    </button>
                  </div>
                </>
              )}
            </li>

            {/* Step 2 card */}
            <li
              class={`onboard-web-card${
                step > 2
                  ? ' onboard-web-card--done'
                  : step === 2
                    ? ' onboard-web-card--active'
                    : ' onboard-web-card--future'
              }`}
              aria-current={step === 2 ? 'step' : undefined}
            >
              {step > 2 ? (
                <button
                  type="button"
                  class="onboard-web-card-done-btn"
                  onClick={() => setStep(2)}
                >
                  <span class="onboard-web-circle onboard-web-circle--done">
                    <CheckIcon size={14} />
                  </span>
                  <span class="onboard-web-card-done-text">
                    <span class="onboard-web-card-title">
                      {t('onboard.step2Title')}
                    </span>
                    <span class="onboard-web-card-sub">
                      {t('onboard.btnBackToMask')}
                    </span>
                  </span>
                </button>
              ) : (
                <>
                  <div class="onboard-web-card-header">
                    <span
                      class={`onboard-web-circle${
                        step === 2 ? ' onboard-web-circle--active' : ''
                      } num`}
                    >
                      2
                    </span>
                    <span class="onboard-web-card-title">
                      {t('onboard.step2Title')}
                    </span>
                  </div>
                  {step === 2 ? (
                    <>
                      <p class="onboard-web-card-desc">
                        {t('onboard.step2Hint')}
                      </p>
                      {segmentError ? (
                        <div class="onboard-inline-error" role="alert">
                          <span>{segmentError}</span>
                          {segmenterStatus === 'error' ? (
                            <button
                              type="button"
                              class="onboard-retry-link"
                              onClick={() => void initSegmenter()}
                            >
                              {t('onboard.btnRetry')}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <div class="onboard-web-card-actions">
                        <button
                          type="button"
                          class="btn-primary"
                          disabled={!hasMask || isSegmenting || isExporting}
                          onClick={() => void handleConfirmCutout()}
                        >
                          {isExporting
                            ? t('onboard.exporting')
                            : t('onboard.btnNext')}
                        </button>
                        <button
                          type="button"
                          class={`btn-outline onboard-web-btn${
                            addMode ? ' onboard-btn-secondary--active' : ''
                          }`}
                          aria-pressed={addMode}
                          disabled={!hasMask || isSegmenting || isExporting}
                          onClick={() => setAddMode((prev) => !prev)}
                        >
                          {addMode
                            ? t('onboard.btnAddPieceActive')
                            : t('onboard.btnAddPiece')}
                        </button>
                        <button
                          type="button"
                          class="btn-outline onboard-web-btn"
                          disabled={!hasMask || isSegmenting || isExporting}
                          onClick={handleResetMask}
                        >
                          {t('onboard.btnReset')}
                        </button>
                        <button
                          type="button"
                          class="btn-outline onboard-web-btn"
                          disabled={isSegmenting || isExporting}
                          onClick={handleChangePhoto}
                        >
                          {t('onboard.btnChangePhoto')}
                        </button>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </li>

            {/* Step 3 card */}
            <li
              class={`onboard-web-card${
                step === 3
                  ? ' onboard-web-card--active'
                  : ' onboard-web-card--future'
              }`}
              aria-current={step === 3 ? 'step' : undefined}
            >
              <div class="onboard-web-card-header">
                <span
                  class={`onboard-web-circle${
                    step === 3 ? ' onboard-web-circle--active' : ''
                  } num`}
                >
                  3
                </span>
                <span class="onboard-web-card-title">
                  {t('onboard.step3Title')}
                </span>
              </div>

              {step === 3 ? (
                <>
                  {renderNameSlugFields('web')}
                  <div class="onboard-web-card-actions">
                    <button
                      type="button"
                      class="btn-primary"
                      disabled={!canPreview}
                      onClick={handleOpenPreview}
                    >
                      {t('onboard.btnPreviewRoom')}
                    </button>
                    <button
                      type="button"
                      class="btn-outline onboard-web-btn"
                      onClick={() => setStep(2)}
                    >
                      {t('onboard.btnBackToMask')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label class="onboard-future-label">
                    {t('onboard.nameLabel')}
                    <input
                      type="text"
                      value={name || 'mochi'}
                      disabled
                      class="onboard-future-input"
                    />
                  </label>
                  <span class="onboard-future-slug">
                    <span class="num onboard-future-slug-url">
                      purr.si/{name.trim() ? slug : 'mochi'}
                    </span>
                    <span class="onboard-slug-ok">
                      {t('onboard.slugAvailable')}
                    </span>
                  </span>
                </>
              )}
            </li>
          </ol>

          <p class="onboard-footnote">{t('onboard.footnote')}</p>
        </aside>
      </div>
    </div>
  );
}

export default OnboardPage;
