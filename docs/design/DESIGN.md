# purr.si 撸猫馆 — Design system

This is the visual source of truth. Every page must match the mockups in this folder.

- `screens/*.webp` — screenshots of every mockup. Look at them before building a page.
- `mockups/*.html` — the mockup source. Open in Chrome (they load photos from `src/assets/photo/`) and copy exact values from the inline styles.
- Numbers in the mockups (pet counts, countries, cans) are sample data, not real.

## 1. Principles

1. **The photo is the hero.** Lobby and cat room are full-bleed photos. UI on top of a photo is small, sits near the edges and always uses the dark overlay (§3). Never put text directly on a photo.
2. **Real cat-café objects.** Employee badge (工牌) = cat profile; receipt (工资条) = weekly stats; ink stamps (印章) = collection; membership card (入馆卡) = guest identity.
3. **Café staff voice.** Warm, short, a little playful. Money is always shown as 罐罐 (cans) except on the withdraw screen.

## 2. Tokens

Put these in `src/styles.css` as CSS custom properties and use only these.

| Token | Value | Use |
|---|---|---|
| `--c-foam` | `#F7F3EE` | page background (奶泡) |
| `--c-card` | `#FFFFFF` | cards, sheets |
| `--c-ink` | `#231C17` | text, dark cards (咖啡) |
| `--c-muted` | `#6E6259` | secondary text (拿铁) |
| `--c-line` | `#E6DED5` | borders, dividers (杯线) |
| `--c-line-strong` | `#CFC4B8` | outline buttons, receipt dashes |
| `--c-accent` | `#B04A17` | primary buttons, feed, active tab (罐罐橙) |
| `--c-accent-hover` | `#8E3A10` | hover/pressed, accent text on light tint |
| `--c-accent-tint` | `#F6E3D6` | selected options, personality tags |
| `--c-accent-bright` | `#E8833A` | purr meter fill and streak dots on dark backgrounds only |
| `--c-mint` | `#2E6F62` | stamps, success, cut-out mask (薄荷) |
| `--c-mint-tint` | `#DCEDE8` | stamp fill, success chips |
| `--c-mint-bright` | `#7FD1B9` | "在岗" dot on dark overlays |
| `--c-gold` | `#C9962E` | 店长猫 / 正式馆猫 decoration only (avatar ring, dot) — never text |
| `--c-overlay` | `rgba(28,22,18,0.62)` + `backdrop-filter: blur(12px)` | every UI element on a photo |
| `--c-scrim` | `rgba(20,16,13,0.55)` | behind bottom sheets / modals |

Contrast: all text pairs above pass WCAG AA. Do not use `--c-accent-bright`, `--c-gold` or `--c-mint-bright` for text on light backgrounds.

### Type

Load from Google Fonts: `Bricolage Grotesque` (700, 800), `Noto Sans SC` (400, 500, 700, 900), `IBM Plex Mono` (400, 600).

| Role | Font | Size / weight |
|---|---|---|
| Wordmark `purr.si` | Bricolage Grotesque | 18–24 / 800, letter-spacing −0.01em |
| Page title | Noto Sans SC | mobile 22–26 / 900, web 36 / 900 |
| Section title | Noto Sans SC | 17–20 / 900 |
| Body | Noto Sans SC | 15 / 400, line-height 1.6 |
| Small / caption | Noto Sans SC | 12–13 / 500 |
| **All numbers** (counts, cans, prices, dates, IDs) | IBM Plex Mono | 600 |

### Shape and spacing

- Radius: cards 16–18, bottom sheets 28 (top corners), buttons and chips 999, small tiles 10–14.
- Spacing on a 4 px grid; common gaps 8 / 12 / 16 / 24; page side padding 16 (mobile), 24–32 (web).
- Touch targets ≥ 44 × 44. Primary buttons 48–54 tall.
- No drop shadows except the receipt's 1 px bottom line; no gradients except the photo realism layers.

## 3. Components

| Component | Spec | Mockup |
|---|---|---|
| Overlay chip | height 32–36, padding 0 12–14, radius 999, `--c-overlay`, white 12–13 px text; optional 8 px status dot | CatRoom, Lobby |
| Overlay icon button | 44 × 44 circle, `--c-overlay`, white 20 px stroke icon, `aria-label` required | CatRoom |
| Primary button | `--c-accent` bg, white 16–17 / 700 text, radius 999, height 48–54 | all |
| Outline button | white bg, 1.5 px `--c-line-strong` (or `--c-ink`) border, ink text | Onboard |
| Purr meter (on photo) | 48 tall overlay pill: label · 8 px track `rgba(255,255,255,.22)` with `--c-accent-bright` fill · mono % | CatRoom |
| Employee badge (工牌) | white card; avatar circle with 2–3 px `--c-gold` ring for 正式馆猫; name 900; "JP · 东京 · 在岗" line; personality tags in `--c-accent-tint` | Main, WebCatRoom |
| Receipt (工资条) | white, radius 6, 7 px dotted `--c-foam` top/bottom edge, IBM Plex Mono rows, dashed `--c-line-strong` dividers, cans total in `--c-accent`; rotated mint "已发放" stamp | Payslip |
| Stamp (印章) | circle, 2 px `--c-mint` border on `--c-mint-tint`, 900 weight label, rotated −9°…+9°; empty = dashed `--c-line-strong` with "?" | GuestCard |
| Membership card (入馆卡) | `--c-ink` card, ratio ≈ 1.586, `--c-accent` ring cut off at the top-right corner, Bricolage wordmark, mono number | GuestCard, LoginSheet |
| Bottom sheet | `--c-foam`, top radius 28, 40 × 5 handle, over `--c-scrim` | LoginSheet, FeedSheet |
| Toast (sweet spot found) | white, radius 14, mint check circle, 13–14 / 700 | CatRoom |
| Tab bar (mobile) | 84 tall, 4 tabs 大厅 / 荣誉墙 / 入馆卡 / 员工室; on photos `rgba(28,22,18,.72)`, on pages white with top border; active = white (photo) or `--c-accent` (page) | Lobby, Payslip |
| Web header | 64 tall, wordmark + pill nav + right actions; active nav = white pill with border | Web* |

Icons: inline SVG, 24 × 24 viewBox, 2 px stroke, round caps. No emoji, no icon fonts.

## 4. Layout

- **Mobile (< 768 px)**: Lobby and Cat room are full-screen photo stages; the Cat room has no tab bar (immersive). Other pages use the foam background with the white tab bar.
- **Web (≥ 768 px)**: a `flex-wrap` row — photo stage `flex: 999 1 640px; height: calc(100dvh - 64px)` + side panel `flex: 1 1 360–380px`. On narrow screens the panel wraps below the stage. Content pages use `max-width: 1240px` centred.
- Sheets on mobile (feed, login) become inline panel sections or centred modals on web.

## 5. Copy

All UI strings go through `src/i18n.ts` with `zh-CN` and `en` dictionaries; pick by `navigator.language`, Chinese copy below is canonical.

| Use | Write | Not |
|---|---|---|
| Upload entry | 送你家猫来上班 | 上传图片 / Add your cat |
| Login prompt | 办张入馆卡，就能给 mochi 喂小鱼干了 | 请先登录 |
| Loading the cat | mochi 刚醒，稍等一下 | 加载中… |
| Moderation pending | 前台正在确认新同事的身份 | 审核中 |
| Earnings | mochi 本月赚了 37 罐罐 | 本月收益 $12.30 |
| Over-petting | 轻一点，mochi 有点小脆弱 | 操作过快 |

## 6. Access rules

Anyone can browse, pet, listen, share and report without logging in. Login (Apple / Google / email code) is required only to: add a cat, feed, become a fan, and keep affection / stamps / streaks (kept locally first, merged after login). After login, continue the action the user started. Full matrix: product plan, section 关键页面、登录规则与文案.

## 7. Page index

| Page | Route | Mobile mockup | Web mockup | Milestone |
|---|---|---|---|---|
| 大厅 Lobby | `/` | Lobby | WebLobby | M6 |
| 猫房 Cat room | `/:slug` | CatRoom | WebCatRoom | M2.6 (restyle), M5 |
| 登录层 Login | sheet | LoginSheet | — | M4 |
| 投喂 Feed | sheet / panel | FeedSheet | WebCatRoom panel | later (phase 4) |
| 前台入职 Onboard | `/new` | Onboard | WebOnboard | M3 |
| 员工室 Owner room | `/me` | Payslip | WebPayslip | M6 |
| 客人卡 Guest card | `/guest` | GuestCard | — | phase 2 |
