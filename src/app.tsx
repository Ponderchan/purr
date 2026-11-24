import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import bgPhotoUrl from './assets/photo/bg.webp';
import sampleCatUrl from './assets/photo/sample-cat.webp';
import type { PetStageProps } from './pet/PetStage';

const STATIC_ROUTES = new Set([
  '/',
  '/new',
  '/me',
  '/about',
  '/privacy',
  '/terms',
]);

function isCatRoute(path: string): boolean {
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
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

interface PlaceholderProps {
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
}

function PlaceholderPage({
  eyebrow,
  title,
  description,
  badge,
}: PlaceholderProps) {
  return (
    <section class="page-card">
      <p class="page-eyebrow">{eyebrow}</p>
      <h1 class="page-title">{title}</h1>
      <p class="page-body">{description}</p>
      {badge ? <p class="slug-badge">{badge}</p> : null}
    </section>
  );
}

function FeedPage() {
  return (
    <PlaceholderPage
      eyebrow="Feed"
      title="Cats ready for pets"
      description="The live cat feed and Cat of the Day will appear here."
    />
  );
}

function UploadPage() {
  return (
    <PlaceholderPage
      eyebrow="Upload"
      title="Add your cat"
      description="Upload a photo, cut out your cat, and publish a shareable purr.si link."
    />
  );
}

function DashboardPage() {
  return (
    <PlaceholderPage
      eyebrow="Dashboard"
      title="Your cats"
      description="Track total pets, pets today, and countries petting your cats."
    />
  );
}

function AboutPage() {
  return (
    <PlaceholderPage
      eyebrow="About"
      title="About purr.si"
      description="Upload your cat, share a link, and let the whole world pet them."
    />
  );
}

function PrivacyPage() {
  return (
    <PlaceholderPage
      eyebrow="Privacy"
      title="Privacy policy"
      description="Privacy details and data handling information will be published here."
    />
  );
}

function TermsPage() {
  return (
    <PlaceholderPage
      eyebrow="Terms"
      title="Terms of service"
      description="Terms of use and reporting guidelines will be published here."
    />
  );
}

function NotFoundPage() {
  return (
    <section class="page-card">
      <p class="page-eyebrow">404</p>
      <h1 class="page-title">Page not found</h1>
      <p class="page-body">
        There is no cat curled up at this address.
      </p>
      <a href="/" class="page-action-link">
        Back to feed
      </a>
    </section>
  );
}

interface CatPageProps {
  slug?: string;
}

function CatPage({ slug }: CatPageProps) {
  const catName = formatCatName(slug);
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

  if (loadFailed) {
    return (
      <section class="cat-page">
        <div
          class="pet-stage pet-stage--fallback"
          style={{ backgroundImage: `url(${bgPhotoUrl})` }}
        >
          <img
            src={sampleCatUrl}
            alt={catName ? `${catName} curled up on a blanket` : 'Cat on a blanket'}
            class="pet-fallback-cat"
          />
          <div class="pet-fallback-light" aria-hidden="true" />
          {catName ? <h1 class="pet-cat-label">{catName}</h1> : null}
          <p class="pet-fallback-message" role="status">
            Your browser can&apos;t show petting here, but the cat still loves you.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section class="cat-page">
      {StageComponent ? (
        <StageComponent
          imageUrl={sampleCatUrl}
          bgUrl={bgPhotoUrl}
          catName={catName}
        />
      ) : (
        <div
          class="pet-stage pet-stage--loading"
          style={{ backgroundImage: `url(${bgPhotoUrl})` }}
          aria-busy="true"
          aria-label="Loading cat petting stage"
        >
          {catName ? <h1 class="pet-cat-label">{catName}</h1> : null}
        </div>
      )}
    </section>
  );
}

function AppShell() {
  const { path } = useLocation();
  const immersive = isCatRoute(path);

  return (
    <div class={`app-shell${immersive ? ' app-shell--immersive' : ''}`}>
      <header class={`top-bar${immersive ? ' top-bar--overlay' : ''}`}>
        <div class="top-bar-inner">
          <a href="/" class="wordmark">
            purr.si
          </a>
          <a href="/new" class="add-cat-link">
            + Add your cat
          </a>
        </div>
      </header>

      <main class={`main-content${immersive ? ' main-content--immersive' : ''}`}>
        <Router>
          <Route path="/" component={FeedPage} />
          <Route path="/new" component={UploadPage} />
          <Route path="/me" component={DashboardPage} />
          <Route path="/about" component={AboutPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/terms" component={TermsPage} />
          <Route path="/:slug" component={CatPage} />
          <Route default component={NotFoundPage} />
        </Router>
      </main>
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
