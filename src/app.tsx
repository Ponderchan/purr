import { LocationProvider, Route, Router, useLocation } from 'preact-iso';

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

interface CatPageProps {
  slug?: string;
}

function CatPage({ slug }: CatPageProps) {
  const { path } = useLocation();
  let displaySlug = slug ?? '';

  if (!displaySlug) {
    const rawPath = path.replace(/^\/+/, '');
    try {
      displaySlug = decodeURIComponent(rawPath);
    } catch {
      displaySlug = rawPath;
    }
  }

  return (
    <PlaceholderPage
      eyebrow="Cat page"
      title={displaySlug ? `Pet ${displaySlug}` : 'Cat page'}
      description="The interactive petting canvas for this cat will live here."
      badge={displaySlug ? `purr.si/${displaySlug}` : undefined}
    />
  );
}

export function App() {
  return (
    <LocationProvider>
      <div class="app-shell">
        <header class="top-bar">
          <div class="top-bar-inner">
            <a href="/" class="wordmark">
              purr.si
            </a>
            <a href="/new" class="add-cat-link">
              + Add your cat
            </a>
          </div>
        </header>

        <main class="main-content">
          <Router>
            <Route path="/" component={FeedPage} />
            <Route path="/new" component={UploadPage} />
            <Route path="/me" component={DashboardPage} />
            <Route path="/about" component={AboutPage} />
            <Route path="/privacy" component={PrivacyPage} />
            <Route path="/terms" component={TermsPage} />
            <Route path="/:slug" component={CatPage} />
            <Route default component={CatPage} />
          </Router>
        </main>
      </div>
    </LocationProvider>
  );
}
