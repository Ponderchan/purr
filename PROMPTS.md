# purr.si — Antigravity 提示词包

## 怎么用

1. **把仓库拉到 Mac**（终端里跑一次）：
   ```bash
   git clone -b claude/adoring-gauss-cl470y https://github.com/Ponderchan/purr.git ~/purr
   ```
2. **在 Antigravity 里添加项目**：左侧 Projects 旁边的「文件夹+」图标，选 `~/purr`。
3. **每个里程碑开一个新对话**（New Conversation，底部选 purr 项目），把对应提示词整段粘进去。模型保持 Gemini 4 Neon High 就行；权限保持 Auto。
4. Gemini 做完会自己 commit + push。然后回到 Claude 说「review M1」，我拉代码审查；有问题我给你一段「修复提示词」，贴回 Gemini 同一个对话。审过了再开下一个里程碑。
5. 中途需要你手动做的事（注册 Supabase、Cloudflare）在对应里程碑前面用 **你要先做** 标出来了。

---

## M1 — 项目骨架

```text
Read AGENTS.md and SPEC.md in this repo first. Follow AGENTS.md strictly.

Task: Milestone 1 — project scaffold. Nothing else.

Build:
- Vite + Preact + TypeScript (strict) app at the repo root. npm scripts: dev, build, preview, typecheck (tsc --noEmit).
- Add pixi.js v8 and @supabase/supabase-js as dependencies (install only; do not use Supabase yet).
- Client-side router with these routes rendering simple placeholder pages: "/" (Feed), "/new" (Upload), "/me" (Dashboard), "/about", "/privacy", "/terms", and "/:slug" (Cat page). Use preact-iso for routing. Unknown paths go to "/:slug".
- src/styles.css with CSS custom properties for colours, spacing and radius; a light warm palette and a dark palette via prefers-color-scheme. Pick an original palette (do not imitate any existing cat site).
- A minimal app shell: top bar with the wordmark "purr.si" and a "+ Add your cat" link to /new. Mobile-first, safe-area insets respected, no horizontal scroll at 390px wide.
- public/_redirects for Cloudflare Pages SPA fallback: "/* /index.html 200".
- .env.example listing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (names only).
- Update README.md with: requirements, `npm install`, `npm run dev`, `npm run build`, and Cloudflare Pages settings (build command `npm run build`, output `dist`).

Do not build any petting, upload or backend logic yet.

Then follow the "Quality bar" in AGENTS.md (build, typecheck, check in browser at 390x844 and 1280x800, commit "M1: project scaffold", push) and give me the final summary it asks for.
```

---

## M2 — 撸猫手感（最重要）

**你要先做（可选但推荐）**：准备一张你家猫的照片，背景尽量简单。M2 先用 Gemini 画的样例猫，M3 做完上传后再换成真猫。

```text
Read AGENTS.md and SPEC.md first (especially SPEC section 5 "Petting feel"). Follow AGENTS.md strictly.

Task: Milestone 2 — the petting experience on the Cat page, using a bundled sample cat. This is the core of the product; prioritise feel over features.

Create a reusable component src/pet/PetStage.tsx that takes { imageUrl: string } (a cut-out cat with transparent background) and renders a PixiJS v8 canvas filling its container. Use it on "/:slug" with the sample cat for now.

1. Sample assets (original, drawn by you in code, no downloads):
   - src/assets/sample-cat.svg: a stylised top-down sleeping cat, curled loaf shape, soft fur colour, transparent background, ~1200px wide viewBox.
   - src/assets/hand.svg: a simple stylised open hand + sleeve seen from above, flat style, transparent background.
   - Background: a soft blanket/cushion drawn with CSS gradients or a Pixi Graphics, original.

2. Hand: follows the pointer (mouse and touch via Pointer Events) with smoothing (lerp ~0.25 per frame) and slight rotation toward movement direction. Hidden when the pointer is not over the stage. On touch, place the hand so the finger is not hidden under it (offset upward ~40px). Set touch-action: none on the canvas.

3. Fur ripple (displacement):
   - Keep a RenderTexture "dispMap" (e.g. 256x256 mapped to the cat bounds) filled with neutral grey rgb(128,128,128).
   - On every pointer move over the cat, stamp a soft radial brush into dispMap at the pointer position. Encode stroke direction in red/green channels (128 ± direction * strength), strength proportional to pointer speed, clamped.
   - Every frame, fade dispMap toward neutral by drawing a neutral-grey full rect at low alpha (so ripples decay in ~400 ms).
   - Apply a PIXI DisplacementFilter using a sprite of dispMap to the cat sprite only. Scale ~20-30px, tune until it looks like fur being pushed, not like water.
   - Only count/stamp when the pointer is over a non-transparent pixel of the cat (hit-test the cat image alpha via an offscreen canvas).

4. Purr sound (Web Audio, no audio files): src/pet/purr.ts
   - Brown noise source -> lowpass filter (~250-400 Hz) -> gain node whose gain is amplitude-modulated by a ~22-28 Hz LFO (the purr pulse) -> master gain.
   - Master gain eases in after ~0.5 s of continuous petting, follows stroke speed (with smoothing), eases out ~0.8 s after petting stops.
   - Create/resume the AudioContext only after the first user gesture. Mute button (top-right of stage) remembered in localStorage (wrap in try/catch).
   - navigator.vibrate short pulses while purring if supported; skip silently otherwise. Respect the mute toggle.

5. Purr meter: a bar under the stage that fills with stroke distance on the cat (not off it), slowly drains when idle. At 33% / 66% / 100% trigger small reactions on the cat sprite only via transforms: gentle breathing scale, a squash-and-stretch wiggle, and a happy "melt" (slight scale-x up, scale-y down). If the user keeps rubbing very fast at 100% for >3 s, do a quick "nip" shake and pause input for 1 s.

6. Accessibility and performance:
   - prefers-reduced-motion: disable reactions' bounce, keep ripple subtle.
   - Keyboard: when the stage is focused, arrow keys move a virtual hand and pet.
   - Destroy the Pixi app and AudioContext on unmount. Handle resize and devicePixelRatio (cap resolution at 2).
   - Pet page JS (excluding lazy chunks) must stay under 200 KB gzipped; report the number from the build output.

Then follow the "Quality bar" in AGENTS.md. In the browser, actually stroke the cat with the mouse and with touch emulation, take screenshots mid-stroke at 390x844 and 1280x800, and attach them in your summary. Commit "M2: petting experience", push, and give me the final summary.
```

---

## M3 — 上传 + 抠图

```text
Read AGENTS.md and SPEC.md first. Follow AGENTS.md strictly.

Task: Milestone 3 — the upload flow on "/new", fully client-side. No backend yet: at the end, the cut-out is kept in memory and the user is sent to a preview of the Cat page using PetStage with that image.

Steps in the UI (one screen, step by step, mobile-first):
1. Pick a photo (input type=file accept="image/*", also allow drag-and-drop on desktop). Max 15 MB; reject others with a friendly message.
2. Normalise: decode with createImageBitmap(file, { imageOrientation: "from-image" }), downscale so the long edge is at most 1600 px, draw to a canvas. This also strips EXIF/GPS. Never upload or keep the original file.
3. "Tap your cat": show the image; when the user taps the cat, run MediaPipe Tasks Vision InteractiveSegmenter (package @mediapipe/tasks-vision, model magic_touch.tflite from the official MediaPipe models bucket) with the tap as a keypoint. Show the mask as a tinted overlay. Allow re-tapping to try again, and a second "add this part" tap that unions masks.
   - Lazy-load @mediapipe/tasks-vision and the model only on this page (dynamic import). Show a loading state.
   - Run on GPU delegate if available, fall back to CPU.
4. Refine: feather the mask edge (blur 2-3 px on the alpha), remove small islands, crop to the mask bounding box with 4% padding.
5. Export a PNG with transparency (canvas.toBlob "image/png"; also try "image/webp" and use it only if the browser really returns webp and it is smaller).
6. Name your cat (1-24 chars) and auto-suggest a URL slug (lowercase a-z0-9 and hyphens, 3-30 chars, show "purr.si/<slug>"). Slug availability check is a stub for now.
7. "Preview" -> navigate to a preview Cat page that uses PetStage with the in-memory cut-out (pass it via a small in-memory store, not the URL).

Also: a short line under the picker: "Only cats, please. Photos are checked before going live." and a link to /privacy.

Then follow the "Quality bar" in AGENTS.md. Test with at least two real cat photos (I will put them in a gitignored folder test-photos/ if you ask; do not commit photos). Include screenshots of the mask step and the preview. Commit "M3: upload and cut-out", push, and give me the final summary including the size of the lazy segmenter chunk.
```

---

## M4 — Supabase 后端

**你要先做**：
1. 去 supabase.com 新建项目（区域选离用户近的，比如 Tokyo / Singapore）。
2. 在 Authentication → Sign In / Providers 打开 **Anonymous sign-ins** 和 **Email**。
3. 把 Project URL 和 anon key 填进 `~/purr/.env.local`（这个文件不会被提交）。service_role key 先别给 Gemini，M4 只需要你在 SQL Editor 里手动跑它生成的迁移文件。

```text
Read AGENTS.md and SPEC.md first (section 3 "Data model"). Follow AGENTS.md strictly.

Task: Milestone 4 — Supabase schema, storage, and wiring the upload + cat page to real data. The pet counting endpoint is NOT part of this milestone.

1. SQL migration at supabase/migrations/0001_init.sql (I will run it in the Supabase SQL editor myself):
   - Tables exactly as SPEC section 3: cats, pets_daily, reports, blocks. Add indexes on cats(slug), cats(status, created_at desc), pets_daily(cat_id, day).
   - Slug constraint: ^[a-z0-9-]{3,30}$ plus a reserved list (new, me, about, privacy, terms, api, admin, assets, login).
   - Enable RLS on all tables. Policies:
     - cats: anyone can select rows with status='live'; owners can select all their own rows; authenticated non-anonymous users can insert rows with owner_id = auth.uid() and status forced to 'pending' (use a trigger to force it); owners can update only name; nobody except service_role can change status or pet_count.
     - pets_daily: select allowed for the cat owner only; no client writes.
     - reports: any authenticated user (including anonymous) can insert with reporter_id = auth.uid(); no client select.
     - blocks: users manage only their own rows.
   - RPC add_pets(p_cat_id uuid, p_n int, p_country text) SECURITY DEFINER: clamps p_n to 1..200, only for live cats, increments cats.pet_count and upserts pets_daily for current UTC day. REVOKE EXECUTE from anon and authenticated; GRANT to service_role only.
   - Storage bucket "cats": public read; insert allowed only to path "<auth.uid()>/<anything>.png|webp" by authenticated non-anonymous users; max 3 MB; no update/delete from clients except own files.
2. Client: src/lib/supabase.ts (createClient from env vars). Visitors get an anonymous session automatically. Owners sign in with email magic link on /new before publishing (a simple inline form).
3. Publish flow on /new: upload the cut-out to cats/<uid>/<uuid>.png, insert the cat row (status pending), show "Your cat is being checked. Share link: purr.si/<slug>". Real slug availability check against the cats table.
4. "/:slug" loads the cat by slug (live, or pending if the viewer is the owner with a "Pending review" badge) and renders PetStage with the storage public URL. Not found -> friendly 404 with a link to "/".
5. "/me": list the signed-in owner's cats with status and pet_count.

Then follow the "Quality bar" in AGENTS.md. Tell me exactly which SQL to run and in what order. Commit "M4: supabase backend", push, and give me the final summary.
```

---

## M5 — 计数 + 审核 + 部署

**你要先做**：
1. Cloudflare → Workers & Pages → Create → Pages → 连 GitHub 选 `Ponderchan/purr`，构建命令 `npm run build`，输出目录 `dist`。环境变量填 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；**Secrets** 填 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。
2. Custom domains 里绑 `purr.si`。
3. Supabase → Edge Functions → Secrets 加 `GEMINI_API_KEY`（AI Studio 生成）。

```text
Read AGENTS.md and SPEC.md first. Follow AGENTS.md strictly.

Task: Milestone 5 — pet counting, live presence, and moderation.

1. Cloudflare Pages Function functions/api/pets.ts (POST, JSON { catId: string, n: number }):
   - Validate input (uuid, 1..200). Country from request.cf?.country (2-letter or "XX").
   - Rate limit: max 600 pets per minute per client. Use a simple per-isolate in-memory map keyed by a hash of the CF-Connecting-IP + minute (hash only, never store or log the raw IP). Note in the summary that this is best-effort.
   - Call the Supabase RPC add_pets with the service-role key from env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) via fetch. Return 204.
2. Client batching in PetStage: count pets (one pet = each 120 px of stroke distance on the cat), send every 5 s and on visibilitychange "hidden" with navigator.sendBeacon (fallback fetch keepalive). Never send 0.
3. Live presence on "/:slug": Supabase Realtime Presence channel "cat:<id>"; show "N petting now" (N includes yourself, hide when 1). Show total pet_count, optimistic local increment.
4. Moderation: Supabase Edge Function supabase/functions/moderate-cat/index.ts, triggered by a Database Webhook on cats INSERT (document the webhook setup steps for me).
   - Download the image from storage, call the Gemini API (model: the current Gemini Flash model; read GEMINI_API_KEY from env) with structured JSON output schema { is_cat: boolean, contains_human_face: boolean, unsafe: boolean, reason: string }.
   - live if is_cat && !contains_human_face && !unsafe, otherwise rejected. Update with the service role. Log reason, never log the image.
5. Report and hide: on every cat view a "..." menu with "Report" (reason picker: not a cat / inappropriate / spam / other) inserting into reports, and "Hide this cat" inserting into blocks. Hidden cats never show again for that user.
6. Add og meta for share previews: functions/[slug].ts that, for a live cat, fetches index.html from ASSETS and uses HTMLRewriter to set og:title "Pet <name> on purr.si", og:image = the cat image, twitter:card summary_large_image. Fall through for unknown slugs and for static files.

Then follow the "Quality bar" in AGENTS.md (use `npx wrangler pages dev dist` to test functions locally). Commit "M5: counting, presence, moderation", push, and give me the final summary with the setup steps I must do in Supabase.
```

---

## M6 — 首页信息流 + 主人看板

```text
Read AGENTS.md and SPEC.md first. Follow AGENTS.md strictly.

Task: Milestone 6 — feed and owner dashboard.

1. Feed on "/": vertical full-height cards with CSS scroll-snap (one cat per screen on mobile; centred column max 480px on desktop). First card is "Cat of the day" (the live cat with the most pets yesterday from pets_daily via a SQL view or RPC that only exposes cat_id and total — add a migration 0002). Then newest live cats, paginated 10 at a time with infinite scroll. Exclude cats the user has hidden.
   - Only ONE PixiJS app exists at a time: mount PetStage on the card that is >60% visible (IntersectionObserver), show a static image on the others. Preload the next card's image.
   - Each card: name, total pets, share button (navigator.share, fallback copy link), and the "..." menu from M5.
2. Dashboard "/me": for each of my cats — image, status badge, total pets, pets today, a 14-day sparkline (inline SVG, no chart library), and top 10 countries with flag emoji and counts. A "Copy share link" button and a "Delete cat" button (deletes row + storage file, with confirm).
3. Empty states: no cats yet on "/" (invite to add the first), no cats on "/me".

Then follow the "Quality bar" in AGENTS.md. Scroll through at least 15 cats in the browser and confirm memory/GPU does not grow (one canvas only). Commit "M6: feed and dashboard", push, and give me the final summary.
```

---

## M7 — 打磨上线

```text
Read AGENTS.md and SPEC.md first. Follow AGENTS.md strictly.

Task: Milestone 7 — polish for launch. No new features.

1. Loading and error states everywhere (skeletons on feed, retry on network error, offline message).
2. /about, /privacy, /terms with real content: what we collect (cat photos, pet counts, country code only, email for owners), what we don't (no IP storage, no precise location, EXIF stripped), moderation and how to report, contact email placeholder CONTACT_EMAIL for me to fill in.
3. Accessibility pass: focus styles, labels on all icon buttons, colour contrast AA, reduced motion respected, keyboard petting works.
4. Performance: run Lighthouse (mobile) on "/" and "/:slug"; target Performance ≥ 90, report scores. Initial JS on "/:slug" ≤ 200 KB gzipped.
5. Favicon, app icons and a web app manifest (name "purr.si"), drawn originally as SVG.
6. Remove dead code, console logs, unused dependencies.

Then follow the "Quality bar" in AGENTS.md. Commit "M7: launch polish", push, and give me the final summary with Lighthouse scores.
```

---

## 修复提示词（模板）

Claude 审查后会给你具体内容，格式是：

```text
Review feedback for M<n>. Fix exactly these, nothing else:
1. ...
2. ...
Then follow the Quality bar in AGENTS.md, commit "M<n>: review fixes", push, and summarise each fix.
```
