# Rules for coding agents working on purr.si

Read this file and `SPEC.md` before every task. `SPEC.md` is the source of truth for product, stack and data model. If a task conflicts with it, stop and ask instead of guessing.

## Scope
- Do exactly the milestone you were given. Do not start the next one, and do not add features, libraries, abstractions or config the task did not ask for.
- If something in the task is impossible or unclear, say so in your final summary rather than silently doing something else.

## Stack (do not swap)
- Vite + TypeScript (`strict: true`) + Preact. PixiJS v8 for the pet canvas. Supabase for backend. Cloudflare Pages (+ Pages Functions in `functions/`) for hosting.
- Package manager: npm. Commit `package-lock.json`.
- No CSS framework; plain CSS modules or one `src/styles.css` with CSS custom properties.

## Originality
- We only borrow the *idea* of petting a cat on screen. Never copy assets, names, layout, colours, sounds or code from any existing cat-petting site or app.
- All art (hand, background, sample cat, icons) is either drawn by you as SVG/canvas code, or provided by the owner. No stock images, no images fetched from the web.
- Purr sound is synthesised with Web Audio, not an audio file.

## Secrets and privacy
- Never commit keys. Client config uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env.local` (gitignored). Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`) live only in Cloudflare / Supabase secret settings. Keep `.env.example` up to date with names only.
- Never store IP addresses or precise location. Strip EXIF from every uploaded image before it leaves the browser.

## Quality bar (every milestone)
1. `npm run build` passes and `npx tsc --noEmit` reports 0 errors.
2. Open the dev server in the browser and check the feature at 390×844 (phone) and 1280×800 (desktop). Touch and mouse must both work.
3. No console errors or warnings in normal use.
4. Commit with message `M<n>: <short summary>` and push to the current branch.
5. Final reply: what you built, files changed, how you tested, anything you skipped or that deviates from SPEC.md.
