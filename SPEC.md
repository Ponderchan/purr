# purr.si — Web MVP Spec

> 让全世界撸你的猫。Upload your cat, share a link, the whole world pets it.

## 1. Product

### Owner loop
1. Upload a photo of their cat.
2. Tap the cat → in-browser segmentation cuts it out (no background).
3. Give it a name → gets `purr.si/<slug>` (e.g. `purr.si/mochi`).
4. Share the link. Dashboard shows total pets, pets today, countries pets came from.

### Visitor loop
1. Open a link (no install, no login) → the cat is on screen, pettable immediately.
2. Stroke with finger/mouse → fur ripples under the hand, purr sound rises with speed.
3. A purr meter fills; at thresholds the cat reacts (tail sway → ear twitch → belly flip). Over-petting → a playful "nip" and a cooldown.
4. Swipe up/down for the next cat (feed). "Cat of the day" on the home page.

### Non-goals (MVP)
- No native app (iOS comes later, reusing the backend).
- No payments.
- No comments or DMs.

### Originality rule
We borrow only the *mechanic* of petting a cat on screen. No assets, names, layout, colours or code from any existing product. All art, hand, sounds and UI are our own.

## 2. Stack

| Layer | Choice |
|---|---|
| Build | Vite + TypeScript (strict) + Preact |
| Rendering | WebGL via PixiJS v8 (displacement filter for fur ripple) |
| Audio | Web Audio API (looped purr, gain/playbackRate tied to stroke speed) |
| Haptics | `navigator.vibrate` where supported (Android); silently skipped elsewhere |
| Segmentation | MediaPipe Tasks Vision — Interactive Segmenter (Apache-2.0), runs in browser |
| Backend | Supabase: Auth (anonymous for visitors, email/OAuth for owners), Postgres, Storage, Realtime |
| Moderation | Supabase Edge Function → Gemini vision: "is this a cat? any human face / unsafe content?" |
| Hosting | Cloudflare Pages on `purr.si`; a Pages Function renders OG tags for `/<slug>` share previews |

Performance budget: the pet page must be interactive in < 2.5 s on a mid-range phone over 4G. Initial JS ≤ 200 KB gzipped (segmenter and editor are lazy-loaded only on the upload page).

## 3. Data model (Supabase)

```sql
cats (
  id uuid pk, owner_id uuid -> auth.users, slug text unique, name text,
  image_path text,          -- cut-out PNG/WebP in storage bucket `cats`
  status text check (status in ('pending','live','rejected','hidden')),
  pet_count bigint default 0, created_at timestamptz
)
pets_daily (cat_id uuid, day date, country text, count int, pk(cat_id, day, country))
reports (id uuid pk, cat_id uuid, reporter_id uuid, reason text, created_at timestamptz)
blocks  (user_id uuid, cat_id uuid, pk(user_id, cat_id))
```

- Pets are batched client-side (send every 5 s or on page hide) to a Cloudflare Pages Function `POST /api/pets`. It reads the country from `request.cf.country`, rate-limits, and calls the Supabase RPC `add_pets(cat_id, n, country)` with the service-role key. The RPC caps n per call and is not callable by anon/authenticated roles.
- Never store IP addresses or precise location; country code only.
- Strip EXIF (incl. GPS) from uploads client-side before upload.
- RLS on every table.

## 4. Pages

| Route | Purpose |
|---|---|
| `/` | Feed: vertical swipe through live cats, each pettable; cat of the day first |
| `/<slug>` | Single cat pet page (the share target) + live "N people petting now" |
| `/new` | Upload → tap-to-segment → name → publish (pending until moderation passes) |
| `/me` | Owner dashboard: my cats, totals, today, country list |
| `/about`, `/privacy`, `/terms` | Required pages; report/contact info |

Every cat view has a **Report** and **Hide this cat** action.

## 5. Petting feel (the core — get this right first)

- Cut-out cat sprite on a soft, original background (our own art).
- A stylised hand follows the pointer with slight lag and tilt; hidden when the pointer leaves.
- Fur ripple: displacement map stamped along the stroke path, decaying over ~400 ms; strength ∝ stroke speed, clamped.
- Purr: starts after ~0.5 s of continuous petting, volume eases in/out; first sound only after a user gesture (autoplay rules). Mute toggle, remembered in localStorage.
- Purr meter: fills with stroke distance on the cat mask only (strokes off the cat don't count).
- Reactions are small sprite/transform animations, not new art per cat (squash, tail-region wobble, slight rotation).

## 6. Milestones (each = one Gemini task, reviewed by Claude)

1. Scaffold: Vite + Preact + TS + PixiJS, lint, `npm run build` green, deploy-ready for Cloudflare Pages.
2. Pet page with a bundled sample cat: hand, fur ripple, purr, meter, mute. **Playable demo checkpoint.**
3. Upload flow: file → EXIF strip → Interactive Segmenter → preview → export cut-out.
4. Supabase schema + RLS + storage + `add_pets` RPC; wire pet page to real data.
5. Moderation edge function (Gemini vision) + status flow.
6. Feed, share OG previews, owner dashboard, report/hide.
7. Polish: loading, empty states, accessibility (keyboard petting, reduced motion), performance budget check.

## 7. Definition of done (per milestone)
- `npm run build` and type-check pass with no errors.
- Works in Chrome desktop, Safari iOS, Chrome Android (checked via screenshots at 390×844 and 1280×800).
- No secrets in the repo; config via env vars.
