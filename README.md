# purr.si

让全世界撸你的猫 — upload your cat, share a link, the whole world pets it.

Web MVP. See [SPEC.md](SPEC.md) for product, stack, data model and milestones.

## Requirements

- Node.js 20+ and npm 10+

## Local development

```bash
npm install
npm run dev
```

## Build and type-check

```bash
npm run typecheck
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in values when backend features are configured (never commit `.env.local`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Cloudflare Pages settings

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **SPA fallback:** `public/_redirects` (`/* /index.html 200`)
