import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import bgPhotoUrl from './assets/photo/bg.webp';
import sampleCatUrl from './assets/photo/sample-cat.webp';
import { t } from './i18n';
import { getPreviewCat } from './onboard/previewStore';
import type { PetStageProps } from './pet/PetStage';
import { SAMPLE_CAT_RIG } from './pet/rigs/sample';

const STATIC_ROUTES = new Set([
  '/',
  '/new',
  '/new/preview',
  '/me',
  '/about',
  '/privacy',
  '/terms',
]);

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function isPreviewRoute(path: string): boolean {
  return normalizePath(path) === '/new/preview';
}

function isOnboardRoute(path: string): boolean {
  return normalizePath(path) === '/new';
}

function isCatRoute(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized === '/new/preview') return true;
  if (STATIC_ROUTES.has(normalized)) return false;
  const segments = normalized.split('/').filter(Boolean);
  return segments.length === 1;
}

function formatCatName(slug?: string): string {
  if (!slug) return '';
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

let cachedPetStage: ComponentType<PetStageProps> | null = null;
let hasLoggedChunkFailure = false;
let cachedOnboardPage: ComponentType | null = null;

interface PlaceholderProps {
  eyebrow: string;
  title: string;
  description: string;
}

function PlaceholderPage({ eyebrow, title, description }: PlaceholderProps) {
  return (
    <section class="page-card">
      <p class="page-eyebrow">{eyebrow}</p>
      <h1 class="page-title">{title}</h1>
      <p class="page-body">{description}</p>
    </section>
  );
}

function FeedPage() {
  return (
    <PlaceholderPage
      eyebrow={t('page.lobby.eyebrow')}
      title={t('page.lobby.title')}
      description={t('page.lobby.body')}
    />
  );
}

function UploadPage() {
  const [PageComponent, setPageComponent] = useState<ComponentType | null>(
    () => cachedOnboardPage,
  );
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (cachedOnboardPage) {
      setPageComponent(() => cachedOnboardPage);
      return;
    }

    let cancelled = false;
    import('./onboard/OnboardPage')
      .then((mod) => {
        cachedOnboardPage = mod.OnboardPage;
        if (!cancelled) {
          setPageComponent(() => mod.OnboardPage);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loadFailed) {
    return (
      <section class="page-card">
        <p class="page-eyebrow">{t('brand.frontDesk')}</p>
        <h1 class="page-title">{t('onboard.mobileTitle')}</h1>
        <p class="page-body">{t('onboard.errLoadSegmenter')}</p>
        <div class="page-card-actions">
          <a href="/" class="btn-primary">
            {t('page.notFound.backHome')}
          </a>
        </div>
      </section>
    );
  }

  if (PageComponent) {
    return <PageComponent />;
  }

  return (
    <div class="onboard-loading-shell" role="status" aria-busy="true">
      <p class="onboard-loading-text">{t('onboard.preparing')}</p>
    </div>
  );
}

function DashboardPage() {
  return (
    <PlaceholderPage
      eyebrow={t('page.staffRoom.eyebrow')}
      title={t('page.staffRoom.title')}
      description={t('page.staffRoom.body')}
    />
  );
}

function AboutPage() {
  return (
    <PlaceholderPage
      eyebrow={t('page.about.eyebrow')}
      title={t('page.about.title')}
      description={t('page.about.body')}
    />
  );
}

function PrivacyPage() {
  return (
    <PlaceholderPage
      eyebrow={t('page.privacy.eyebrow')}
      title={t('page.privacy.title')}
      description={t('page.privacy.body')}
    />
  );
}

function TermsPage() {
  return (
    <PlaceholderPage
      eyebrow={t('page.terms.eyebrow')}
      title={t('page.terms.title')}
      description={t('page.terms.body')}
    />
  );
}

function NotFoundPage() {
  return (
    <section class="page-card">
      <p class="page-eyebrow">
        <span class="num">404</span>
      </p>
      <h1 class="page-title">{t('page.notFound.title')}</h1>
      <p class="page-body">{t('page.notFound.body')}</p>
      <div class="page-card-actions">
        <a href="/" class="btn-primary">
          {t('page.notFound.backHome')}
        </a>
      </div>
    </section>
  );
}

function StageStaticTopOverlays({
  displayName,
  avatarUrl = sampleCatUrl,
  backHref = '/',
  isPreview = false,
}: {
  displayName: string;
  avatarUrl?: string;
  backHref?: string;
  isPreview?: boolean;
}) {
  return (
    <>
      <div class="stage-mobile-bar">
        <a
          href={backHref}
          class="overlay-icon-btn"
          aria-label={isPreview ? t('preview.backToEdit') : t('cat.backToLobby')}
        >
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
        </a>

        <div class="mobile-badge-chip">
          <span
            class={`mobile-badge-avatar${
              isPreview ? ' mobile-badge-avatar--cutout' : ''
            }`}
          >
            <img
              src={avatarUrl}
              alt=""
              class={
                isPreview
                  ? 'cat-avatar-img cat-avatar-img--cutout'
                  : 'cat-avatar-img'
              }
            />
          </span>
          <span class="mobile-badge-text">
            <span class="mobile-badge-name">{displayName}</span>
            <span class="mobile-badge-status">
              <span class="status-dot" aria-hidden="true" />
              {isPreview ? t('preview.mobileStatus') : t('cat.mobileStatus')}
            </span>
          </span>
        </div>

        {isPreview ? null : (
          <button
            type="button"
            class="overlay-icon-btn"
            aria-label={t('cat.moreActions')}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        )}
      </div>

      <div class="stage-web-top">
        <span class="overlay-chip">
          <span class="status-dot" aria-hidden="true" />
          <span>
            {isPreview ? (
              t('preview.webStatus', { name: displayName })
            ) : (
              <>
                {t('cat.webStatusBeforeTime', { name: displayName })}
                <span class="num">{t('cat.webStatusTime')}</span>
                {t('cat.webStatusAfterTime')}
              </>
            )}
          </span>
        </span>
      </div>
    </>
  );
}

interface CatPageProps {
  slug?: string;
}

function usePetStageChunk() {
  const [StageComponent, setStageComponent] =
    useState<ComponentType<PetStageProps> | null>(() => cachedPetStage);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (cachedPetStage) {
      setStageComponent(() => cachedPetStage);
      return;
    }

    let cancelled = false;
    import('./pet/PetStage')
      .then((mod) => {
        cachedPetStage = mod.PetStage;
        if (!cancelled) {
          setStageComponent(() => mod.PetStage);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (!hasLoggedChunkFailure) {
            hasLoggedChunkFailure = true;
            console.warn('Failed to load PetStage chunk:', err);
          }
          setLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { StageComponent, loadFailed };
}

function PreviewCatPage() {
  const preview = getPreviewCat();
  const { StageComponent, loadFailed } = usePetStageChunk();

  if (!preview) {
    return (
      <div class="preview-empty-wrap">
        <section class="page-card">
          <p class="page-eyebrow">{t('brand.frontDesk')}</p>
          <h1 class="page-title">{t('preview.emptyTitle')}</h1>
          <p class="page-body">{t('preview.emptyBody')}</p>
          <div class="page-card-actions">
            <a href="/new" class="btn-primary">
              {t('preview.goOnboard')}
            </a>
          </div>
        </section>
      </div>
    );
  }

  const displayName = preview.name || t('cat.defaultName');
  const cutoutUrl = preview.cutout.url;

  let stageContent;
  if (loadFailed) {
    stageContent = (
      <div
        class="pet-stage pet-stage--fallback"
        style={{ backgroundImage: `url(${bgPhotoUrl})` }}
      >
        <img
          src={cutoutUrl}
          alt={t('pet.fallbackAlt', { name: displayName })}
          class="pet-fallback-cat"
        />
        <div class="pet-fallback-light" aria-hidden="true" />
        <StageStaticTopOverlays
          displayName={displayName}
          avatarUrl={cutoutUrl}
          backHref="/new"
          isPreview
        />
        <p class="pet-stage-notice" role="status">
          {t('pet.fallbackMessage', { name: displayName })}
        </p>
      </div>
    );
  } else if (StageComponent) {
    stageContent = (
      <StageComponent
        imageUrl={cutoutUrl}
        bgUrl={bgPhotoUrl}
        catName={displayName}
        backHref="/new"
        isPreview
      />
    );
  } else {
    stageContent = (
      <div
        class="pet-stage pet-stage--loading"
        style={{ backgroundImage: `url(${bgPhotoUrl})` }}
        aria-busy="true"
        aria-label={t('pet.loadingAria')}
      >
        <StageStaticTopOverlays
          displayName={displayName}
          avatarUrl={cutoutUrl}
          backHref="/new"
          isPreview
        />
        <p class="pet-stage-notice" role="status">
          {t('pet.loading', { name: displayName })}
        </p>
      </div>
    );
  }

  return (
    <div class="preview-cat-shell">
      <div class="preview-banner" role="status">
        <span class="preview-banner-text">
          <span class="status-dot" aria-hidden="true" />
          {t('preview.banner')}
        </span>
        <a href="/new" class="preview-banner-back">
          {t('preview.backToEdit')}
        </a>
      </div>

      <div class="cat-room-layout cat-room-layout--preview">
        <section
          class="cat-room-stage cat-room-stage--preview"
          aria-label={t('cat.stageSectionLabel', { name: displayName })}
        >
          {stageContent}
        </section>

        <aside class="cat-room-panel">
          <div class="employee-badge">
            <span class="employee-badge-avatar employee-badge-avatar--cutout">
              <img
                src={cutoutUrl}
                alt={t('cat.avatarAlt', { name: displayName })}
                class="cat-avatar-img cat-avatar-img--cutout"
              />
            </span>
            <div class="employee-badge-info">
              <div class="employee-badge-heading">
                <h1 class="employee-badge-name">{displayName}</h1>
                <span class="employee-badge-role">
                  {t('onboard.badgeRole')}
                </span>
              </div>
              <span class="employee-badge-meta">
                <span class="num">purr.si/{preview.slug}</span>
              </span>
              <span class="employee-badge-meta">{t('preview.badgeMeta')}</span>
              <span class="employee-badge-tags">
                <span class="personality-tag">{t('onboard.badgeTagNew')}</span>
                <span class="personality-tag">
                  {t('onboard.badgeTagPreview')}
                </span>
              </span>
            </div>
          </div>

          <div class="panel-footer-actions">
            <a href="/new" class="btn-outline">
              {t('preview.backToEdit')}
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CatPage({ slug }: CatPageProps) {
  const catName = formatCatName(slug);
  const displayName = catName || t('cat.defaultName');
  const { StageComponent, loadFailed } = usePetStageChunk();

  let stageContent;
  if (loadFailed) {
    stageContent = (
      <div
        class="pet-stage pet-stage--fallback"
        style={{ backgroundImage: `url(${bgPhotoUrl})` }}
      >
        <img
          src={sampleCatUrl}
          alt={
            catName
              ? t('pet.fallbackAlt', { name: catName })
              : t('pet.fallbackAltGeneric')
          }
          class="pet-fallback-cat"
        />
        <div class="pet-fallback-light" aria-hidden="true" />
        <StageStaticTopOverlays displayName={displayName} />
        <p class="pet-stage-notice" role="status">
          {t('pet.fallbackMessage', { name: displayName })}
        </p>
      </div>
    );
  } else if (StageComponent) {
    stageContent = (
      <StageComponent
        imageUrl={sampleCatUrl}
        bgUrl={bgPhotoUrl}
        catName={catName}
        rig={SAMPLE_CAT_RIG}
      />
    );
  } else {
    stageContent = (
      <div
        class="pet-stage pet-stage--loading"
        style={{ backgroundImage: `url(${bgPhotoUrl})` }}
        aria-busy="true"
        aria-label={t('pet.loadingAria')}
      >
        <StageStaticTopOverlays displayName={displayName} />
        <p class="pet-stage-notice" role="status">
          {t('pet.loading', { name: displayName })}
        </p>
      </div>
    );
  }

  return (
    <div class="cat-room-layout">
      <section
        class="cat-room-stage"
        aria-label={t('cat.stageSectionLabel', { name: displayName })}
      >
        {stageContent}
      </section>

      <aside class="cat-room-panel">
        <div class="employee-badge">
          <span class="employee-badge-avatar">
            <img
              src={sampleCatUrl}
              alt={t('cat.avatarAlt', { name: displayName })}
              class="cat-avatar-img"
            />
          </span>
          <div class="employee-badge-info">
            <div class="employee-badge-heading">
              <h1 class="employee-badge-name">{displayName}</h1>
              <span class="employee-badge-role">{t('cat.officialBadge')}</span>
            </div>
            <span class="employee-badge-meta">
              {t('cat.badgeLocation')} · {t('cat.badgeDaysBefore')}
              <span class="num">128</span>
              {t('cat.badgeDaysAfter')} · <span class="num">12,480</span>
              {t('cat.badgeGuestsAfter')}
            </span>
            <span class="employee-badge-tags">
              <span class="personality-tag">{t('cat.tagClingy')}</span>
              <span class="personality-tag">{t('cat.tagFoodie')}</span>
            </span>
          </div>
        </div>

        <div class="panel-footer-actions">
          <button type="button" class="btn-outline">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 3v12M8 7l4-4 4 4M5 13v6h14v-6" />
            </svg>
            {t('cat.shareCat', { name: displayName })}
          </button>
          <a
            href="#report"
            class="panel-report-link"
            onClick={(e) => e.preventDefault()}
          >
            {t('cat.reportHide')}
          </a>
        </div>
      </aside>
    </div>
  );
}

function WebHeader({
  isCat,
  isOnboard,
  currentPath,
}: {
  isCat: boolean;
  isOnboard: boolean;
  currentPath: string;
}) {
  if (isOnboard) {
    return (
      <header class="web-header web-header--onboard">
        <a href="/" class="web-wordmark web-wordmark--grow">
          <span class="web-wordmark-brand">purr.si</span>
          <span class="web-wordmark-sub">{t('brand.frontDesk')}</span>
        </a>
        <a href="/" class="web-header-text-link">
          {t('onboard.backToLobby')}
        </a>
      </header>
    );
  }

  if (isCat) {
    return (
      <header class="web-header web-header--cat">
        <a href="/" class="web-wordmark web-wordmark--grow">
          <span class="web-wordmark-brand">purr.si</span>
          <span class="web-wordmark-sub">{t('brand.subtitle')}</span>
        </a>
        <a href="/" class="web-header-text-link">
          {t('nav.browseLobby')}
        </a>
        <a href="/new" class="btn-outline btn-outline--ink">
          {t('nav.sendCatToWork')}
        </a>
      </header>
    );
  }

  return (
    <header class="web-header web-header--shell">
      <a href="/" class="web-wordmark">
        <span class="web-wordmark-brand">purr.si</span>
        <span class="web-wordmark-sub">{t('brand.subtitle')}</span>
      </a>

      <nav class="web-nav" aria-label={t('nav.mainLabel')}>
        <a
          href="/"
          class="web-nav-pill"
          aria-current={currentPath === '/' ? 'page' : undefined}
        >
          {t('nav.lobby')}
        </a>
        <a
          href="#honor"
          class="web-nav-pill web-nav-pill--placeholder"
          aria-disabled="true"
          onClick={(e) => e.preventDefault()}
        >
          {t('nav.honor')}
        </a>
        <a
          href="#guest"
          class="web-nav-pill web-nav-pill--placeholder"
          aria-disabled="true"
          onClick={(e) => e.preventDefault()}
        >
          {t('nav.guestCard')}
        </a>
        <a
          href="/me"
          class="web-nav-pill"
          aria-current={currentPath === '/me' ? 'page' : undefined}
        >
          {t('nav.staffRoom')}
        </a>
      </nav>

      <div class="web-header-actions">
        <a href="/new" class="btn-primary btn-primary--compact">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t('nav.sendCatToWork')}
        </a>
      </div>
    </header>
  );
}

function MobileTabBar({ currentPath }: { currentPath: string }) {
  return (
    <nav class="mobile-tab-bar" aria-label={t('nav.mainLabel')}>
      <a
        href="/"
        class="mobile-tab-item"
        aria-current={currentPath === '/' ? 'page' : undefined}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
          <path d="M10 20v-5h4v5" />
        </svg>
        {t('nav.lobby')}
      </a>

      <a
        href="#honor"
        class="mobile-tab-item"
        aria-disabled="true"
        onClick={(e) => e.preventDefault()}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
          <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6" />
        </svg>
        {t('nav.honor')}
      </a>

      <a
        href="#guest"
        class="mobile-tab-item"
        aria-disabled="true"
        onClick={(e) => e.preventDefault()}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18M7 15h4" />
        </svg>
        {t('nav.guestCard')}
      </a>

      <a
        href="/me"
        class="mobile-tab-item"
        aria-current={currentPath === '/me' ? 'page' : undefined}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="4" y="7" width="16" height="13" rx="2" />
          <path d="M9 7V5h6v2M4 12h16" />
        </svg>
        {t('nav.staffRoom')}
      </a>
    </nav>
  );
}

function AppShell() {
  const { path } = useLocation();
  const currentPath = normalizePath(path);
  const isCat = isCatRoute(path);
  const isOnboard = isOnboardRoute(path);
  const isPreview = isPreviewRoute(path);

  return (
    <div
      class={`app-shell${isCat ? ' app-shell--cat' : ''}${
        isOnboard ? ' app-shell--onboard' : ''
      }`}
    >
      <WebHeader
        isCat={isCat}
        isOnboard={isOnboard}
        currentPath={currentPath}
      />

      <main
        class={`main-content${isCat ? ' main-content--cat' : ''}${
          isOnboard ? ' main-content--onboard' : ''
        }${isPreview ? ' main-content--preview' : ''}`}
      >
        <Router>
          <Route path="/" component={FeedPage} />
          <Route path="/new" component={UploadPage} />
          <Route path="/new/preview" component={PreviewCatPage} />
          <Route path="/me" component={DashboardPage} />
          <Route path="/about" component={AboutPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/:slug" component={CatPage} />
          <Route default component={NotFoundPage} />
        </Router>
      </main>

      {isCat || isOnboard ? null : <MobileTabBar currentPath={currentPath} />}
    </div>
  );
}

export function App() {
  return (
    <LocationProvider>
      <AppShell />
    </LocationProvider>
  );
}
