# Figma UI Reference & Pull Process

> **The UI source of truth** for this kiosk. Every visual surface is built
> from these frames — no invented UI. When a screen has no frame, it is built
> in the same design language and flagged in PROGRESS.md for client sign-off.

## 1. Source of truth

- **File**: `Taco Bell kiosk design` — file key **`33e5briUYJiBqxv6P0AbqY`**
- **Page**: `Page 1` (node `0:1`) → section **`FINAL`** (node `1:2181`)
- **Deep link format**: `https://www.figma.com/design/33e5briUYJiBqxv6P0AbqY/Untitled?node-id=<X-Y>`
  (node id `1:2184` ⇒ `node-id=1-2184`)
- **Canvas**: every screen frame is **1080×1920 portrait** — identical to the
  kiosk hardware and to our `KioskStage` design grid (layout in absolute
  design px; NO vh/vw anywhere).
- Access: Figma MCP (OAuth). ~100 screen frames + notes/asset frames.

## 2. How UI is pulled (the process — follow it exactly)

1. **Load the `figma-design-to-code` skill**, then call `get_design_context`
   with `nodeId` + `fileKey` (pass `skillNames=figma-design-to-code`).
   The response = reference React/Tailwind + a screenshot + style tokens.
   Treat the code as REFERENCE ONLY — re-express it in this repo's stack
   (Tailwind 4 tokens below, KioskStage px grid, our component conventions).
2. **Screenshots for orientation**: `get_metadata` (frame inventory) and
   `get_screenshot` on a node when you only need the visual.
3. **Assets**: every `figma.com/api/mcp/asset/...` URL **expires in ~7 days**
   → download IMMEDIATELY and commit under `src/assets/`:
   - `assets/brand/` (bell logo) · `assets/splash/` · `assets/icons/` ·
     `assets/flags/` · `assets/fonts/`
   - **Never hand-draw an icon that exists in the design** — export it.
     (Exception used once: the GB flag — Figma ships it as mask fragments;
     replaced with the canonical public-domain Union Jack construction.)
   - Compress heavy bitmaps (sips → jpeg; the raw plastic overlay was 11MB →
     66KB). PWA manifest icon must be EXCLUDED from any image optimizer
     (see the corbi.png trap in CLAUDE.md).
4. **Colors/typography**: map to the `@theme` tokens (§3) — never hardcode a
   hex that already has a token; new design colors become new `tb-*` tokens.
5. **Motion**: critical/operator UI = **pure CSS animations only**
   (`tb-modal-enter` pattern) — rAF/framer freezes in occluded windows.
   Never combine Tailwind `translate-*` classes with keyframe `transform`
   (they stack — one owner per element).
6. **Data**: screens render from SDK state (converted menu tree, pipelines,
   cart) — Figma's literal content (product names, prices) is placeholder.
   Splash content is the operator's getMedia `home_screen` media (P9d); the
   static 1:2184 poster was retired — its price claim is unsafe as a
   permanent fallback (the no-media frame is the neutral 1:5617 WELCOME).
7. **Every pulled screen ships with**: unit tests, an e2e touch if it joins
   the flow, gates green, and a PROGRESS.md entry.

## 3. Design tokens extracted so far (`src/index.css` `@theme`)

| Token | Value | Figma name |
|---|---|---|
| `tb-purple` | `#501098` | Primary/TB Purple, "Textured Taco Bell Purple" |
| `tb-purple-vibrant` | `#9A23F8` | Secondary/Vibrant Purple, "Light Purple" |
| `tb-pink` | `#F07ADE` | Pink |
| `tb-pink-dark` | `#CA16AF` | Dark Pink (daypart ticker) |
| `tb-yellow` | `#FADB3C` | Yellow (NEW/BEST VALUE tags) |
| `tb-cream` | `#F4F2F0` | poster off-white |
| `tb-ink-purple` | `#1B0726` | Black Purple (body text) |
| `tb-grey-6` / `tb-grey-4` | `#F9F9F9` / `#EBEBEB` | Grey 6 (card bg) / Grey 4 (borders) |
| `tb-violet` | `#6301D2` | full-bleed splash bottom gradient @16% (1:5604/1:5617, P9d) — unbound in Figma, name ours |
| `tb-lilac` | `#F3D9FF` | CTA_Sheet_Fixed Secondary/"Loading" fill (idle START AGAIN, 1:4514) — unbound in Figma, name ours; 1.3:1 on white (decorative fill, flagged for client sign-off) |
| `--brand-primary/-secondary`, `--brand-1..31` | runtime | theme-API contract (useFetchColors), fallbacks mandatory |

**Type** (design uses **GT America Trial** — commercial; we ship pinned
Archivo stand-ins until the client licenses it — FLAGGED):
| Figma style | Spec | Our face/class |
|---|---|---|
| Title/H1 | Exp Bl 116/98, -3.27 | `.tb-display` |
| Title/H2 | Exp Bl 64/0.85, -3 | `.tb-display` |
| Title/H5 | Exp Bl 32/32, -1 | `.tb-display` |
| CTA/Expanded Medium | Exp Bl 24/32 | `.tb-display` |
| CTA/Expanded small | Exp Md 16/16 | `.tb-display` + font-medium |
| CTA/Compressed Large / Medium | Cm Bd 48/44 · 30/24 | `.tb-compressed` |
| Title/H6 / H7 | Md 32/36 · 20/24 | `font-medium` (Archivo) |
| Text/Small | Rg 18/20 | base Archivo |
| CTA/Bold Medium | Exp Bl 18/16 | `.tb-display text-[18px] leading-[16px]` |
| Text/Title large | Rg 28/32 | base Archivo `text-[28px] leading-[32px]` |
Arabic: no brand face — Archivo has no Arabic glyphs, so Arabic renders in the OS fallback font (sign-off S1). ⚠️ The committed files are MISLABELLED (found 2026-10-06; fix queued — see PROGRESS): `Archivo-Variable.woff2` is a static ExtraCondensed Thin cut and `Archivo-Condensed-Bold.woff2` is width-variable (62–125, default 100).
Fonts committed: `Archivo-Variable.woff2` (upright latin),
`Archivo-Expanded-Black.woff2` (wdth125/wght900), `Archivo-Condensed-Bold.woff2` (wdth62/wght700).

## 4. Frame → screen map (node IDs are canonical)

Legend: ✅ built · 🔄 partial · 🔲 pending. "Impl" = file in this repo.

### Attract / entry
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:5617` WELCOME (no media) · `1:5604` full-bleed (1 slide) · `1:2203` carousel (≥2) · `1:2184` poster (retired P9d) | Splash - Single/Carousel | `pages/StartScreen` + `pages/StartScreen/SplashMedia` (SDK engine `@cx-sdk/catalog/media/splashMedia`, boot step `useLoaders` → `loadSplashMedia`) | ✅ P9d — layout by PLAYABLE slide count; a slide that errors/stalls is skipped (carousel → full-bleed → WELCOME, never blank); 1:5604's promo words + stars live IN the operator media; sign-off items in PROGRESS |
| — (no frame) | Registration (operator) | `pages/Registration` | ✅ design-language, flag for sign-off · P9f: ACTIVATE label ink-purple (7.73:1, was white 2.46:1), placeholder 55 % black, error-banner slide / shake / press are pure CSS — sign-off |
| `1:5598` loading, `1:5600` Error, `1:5602` Credit card | illustrations | `pages/LoadingResources` | 🔄 progress UI built. **These boards hold 1000×1000 VIDEO fills** — the MCP exports posters only (Error = solid black, loading = the REWARDS seal on black), so they are unusable until design supplies source media (MP4/WebM/Lottie). P9b's boot error uses `ErrorModal` instead |

### Order type + chrome
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:2581` v1 / `1:2588` v2 | Dine In / Take Out / Daypart | `pages/SecondLayout` | ✅ v1 (v2 variant 🔲) |
| `1:4488` | Select Language | `components/language/LanguageSheet` | ✅ · P9f: CSS entrance only, no exit slide |
| in `1:2581` | Daypart ticker | `components/chrome/DaypartTicker` | ✅ (server-driven copy 🔲) |
| in `1:2581` | Footer bottom (Cancel/ADA/lang) | `components/chrome/FooterBar` | ✅ |

### Menu
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:2595`, `1:6327` Menu-basic agency · `1:5236` Menu · `1:3956` Menu-Rewards | menu browse | `pages/Menu`, `components/menu/{CategoryRail,MenuItemCard,MenuCtaBar}` | ✅ core (search descoped D2; banners declined D1; names follow the menu's `ar` aliases) |
| `1:4571`, `1:5502`, `1:5521` | Product added | `components/menu/ProductAddedModal` | ✅ |
| `1:5263` | Scroll bar | `components/chrome/ScrollIndicator` (mounted by `pages/Menu` + `pages/Customization`) | ✅ post-P9 — menu 1:2613 top 505 / h 790 (ADA 1:5412 170 / 578), PDP 1:2920 703 / 790 (ADA PDP 1:5442 488 / 394); `right-[12px]`, 11 px, track tb-lilac r2, thumb tb-purple r2; indicator only (D3, aria-hidden, pointer-events-none — sign-off); native bar hidden |

### PDP / customization (P6)
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:5628` incomplete / `1:5683` complete | Select a Size v2 | `components/menu/SelectSizeModal` | ✅ |
| `1:2920` incomplete · `1:2827` completion warning · `1:2786`,`1:5738`,`1:5780` selection sheets · `1:2856`,`1:5353` all complete · `1:2984` customize · `1:3007`,`1:3037` customize-edit · `1:5477` edits complete | PDP - Builder family | `pages/Customization` | 🔄 core built (single-scroll layout; edit-mode + per-constituent selection sheets refine in P7 edit pass) |
| `1:5823` nutrition closed · `1:2614`, `1:2728`, `1:5540` | PDP - Single Product | `pages/Customization` | 🔄 core built (nutrition table accordion 🔲) |
| `1:4590`,`1:4641`,`1:4761`,`1:4692`,`1:4827`,`1:5180` + customize `1:4895`,`1:5051`,`1:5081`,`1:4947`,`1:5115`,`1:5145`,`1:4999` | Order a Pack family | `pages/Customization` + `components/customization/{PackSlotCard,SlotSelectionSheet,Tier2CustomizationSheet}` | 🔄 built from `1:4590`/`1:4641`/`1:4761`/`1:4692`; customize family + completed/warning states NOT pulled (Figma MCP rate limit 2026-09-29) — tier-2 sheet is design-language, needs visual pass |
| `1:5264`,`1:5322`,`1:5293` | Build Your Own Pack | `pages/Customization` (generic group grid for min≠1/max≠1 `_combo`) | 🔄 frames not pulled (rate limit) — design-language, flagged |
| — (no frame) | MIAM upsell prompt | `components/makeItAMeal/MakeItAMealPrompt` | ✅ design-language, flag for sign-off |
| `1:3070` "Upsell" | **Make It A Meal prompt** (NOT a pre-cart screen — the map previously misread this) | `components/makeItAMeal/MakeItAMealPrompt` | ✅ P7d re-skinned to frame (SAVE badge implemented but dataless — see PROGRESS open decisions) |
| `1:3202`/`1:3204` CTA_Sheet_Fixed | the LOG-IN & GET REWARDS button component | `components/cart/BagSheet` | ✅ P7a |
| — (no frame) | `/forYou` pre-cart upsell | `pages/ForYou` + `components/cart/ForYouCard` | ✅ P7d design-language, flag for sign-off — the design puts Complete-Your-Meal in the bag (1:3171) instead |

### Bag / rewards (P7)
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:3171` single · `1:3236`,`1:3270` multi · `1:3137`,`1:3973` has-rewards · `1:3205` · `1:4460` order-summary edit | My Bag | `components/cart/{BagSheet,BagItemRow,RemoveItemModal,CompleteYourMealRail,RepeatItemSheet}` + `/cart` route | ✅ P7a from `1:3171`/`1:3236`/`1:3270` (has-rewards states 🔲 P7c; `1:4460` numpad 🔲 polish) |
| `1:5881`,`1:5904` scan · `1:4406`/`1:4174` code default · `1:4425`/`1:4193` partial · `1:4368`/`1:4136` full · `1:4311`/`1:4079` success · `1:4330`,`1:4098` scan-error · `1:4387`,`1:4155` code-error · `1:4349`,`1:4117` scan-failure · `1:3786`,`1:3805`,`1:4278` rewards-scan states · `1:5927` Modal Rewards | Rewards (scan/code) | `components/loyalty/{LoyaltyLoginModal,LoyaltyRewardsSheet,LoyaltySuccessModal,LoyaltyErrorModal}`, `components/keyboard/KioskNumpad`, `pages/CustomerPhone` | 🔄 P7c — built as the **Xeno** flow (user directive): `1:4174` numpad → phone lookup, `1:4079` success, `1:3786` error, `1:3956` MY REWARDS entry. SCAN APP tab inert (no scanner); `1:5927` LOGIN + scan-state frames 🔲 |
| `1:3824` default · `1:3858` ineligible · `1:3892` all-available · `1:3924` active | Reward states | `components/offer/{RewardsSheet,OfferRow,FreebiePickerSheet,OfferRemovalNotice}` | ✅ P7b — adapted to CX offer mechanics (mapping decision); loyalty-reward variants 🔲 P7c |
| `1:4009`,`1:4044` | T&C option 1 | — | 🔲 P7/P8 |

### Checkout / payment / success (P8)
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:3364`,`1:4212` | Payment Location ("How would you like to pay?") | `pages/PaymentSelection` | ✅ P8a (card tile disabled until P8b) |
| `1:3377`,`1:4225` | Payment Preference ("Do you need the receipt?") | `pages/ReceiptPreference` | ✅ P8a (EMAIL inert — no payload contract) |
| `1:3392`,`1:3404`,`1:4240`,`1:6288` | Payment Instructions | — | 🔲 P8 |
| `1:3427` | Payment Failure | its Icon Modal `1:988` + Icon L `1:990` → `components/common/ErrorModal` (boot / menu-load / crash surfaces, P9b) | 🔄 the modal shell ✅ P9b; the card-payment failure screen itself is P8b |
| `1:3383`,`1:4231` | Email Receipt | keyboard+input pulled → `components/keyboard/KioskKeyboard`, Registration input | 🔄 (keyboard/input ✅ 2026-09-29; email screen itself 🔲 P8) |
| `1:5932` no-loyalty · `1:3437` has-loyalty | Order Complete | `pages/OrderSuccess` | ✅ P8a (QR omitted — no data source) |
| `1:4447` | **Tent screen** ("Do you want to be served at your table?" — NOT a wait state; the map misread this) | `pages/Tent` | ✅ P8a |
| `1:4456`,`1:6301` | Please wait | — | 🔲 P8b |

### Modals / system (P7–P9)
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:4514` | You have been inactive | `components/common/IdleTimeoutModal` + `routes/IdleGuard` (+ `hooks/utils/useIdleTimeout`) | ✅ P9a — START AGAIN "Loading" fill = the countdown (frame has no digits); backdrop = CONTINUE ORDERING |
| `1:4533` | Remove item | `components/cart/RemoveItemModal` | ✅ P7a |
| `1:4552` | Cancel Order | `components/common/CancelOrderModal` (+ `hooks/utils/useSessionReset`) | ✅ P7a |
| `1:5392`,`1:5413`,`1:5445` | ADA Home/Customization/Recap | `components/stage/ReachZone` (+ `hooks/utils/useAdaActive`, `ADA_*` in `KioskStage`) | ✅ P9c — reach-zone view: brand zone 0–798 (`ADA_BRAND_ZONE_HEIGHT`, the cabinet calibration knob), content zone 798–1920, nothing scaled; bag sheet 765 (top 1155); PDP gained the Footer-bottom strip in BOTH modes (it is in 1:2614/1:2920/1:5413) |
| — (no frames) | ADA variants of `/second`, `/phone`, `/customerName`, `/tent`, `/payment`, `/receipt`, `/orderSuccess` + overlay caps | the pages + sheets/modals | ✅ P9c design-language, flag for sign-off (incl. brand-zone tap-to-exit, which Figma does not draw) |
| — (no frame) | Update countdown (splash) | `components/autoUpdate/UpdateCountdownModal` (+ `pages/StartScreen` apply machine) | ✅ P9e design-language, flag for sign-off (non-dismissable ≤5 s) |
| — (no frames) | Activity Center, Tent, Phone/OTP, CountryCode | `components/activity/ActivityModal` (✅; P9e adds Reload resources + Data loaded — design-language) / — | design-language builds, flagged |

## 5. Assets committed (source node → path)

- Splash `1:2184`: `splash/bg-texture.png`, `splash/plastic-overlay.jpg` (compressed), `splash/star-1..6.svg`; bell → `brand/tb-bell.svg` (`splash/poster-taco.jpg` deleted in P9d with the poster)
- WELCOME `1:5617` / full-bleed `1:5604` BG (`1:5618`/`1:5605`): `splash/fullbleed-halfmoon.jpg` — the 618×1099 crop (source x 458.7–1076.9) of the only bitmap Figma holds (1810×1099, md5 `ef6c519d…`), rendered `object-cover` at 1080×1920 = ×1.75 upscale (soft). Client to supply a hi-res original (P9d)
- Order type `1:2581`: `icons/dine-in.svg`, `icons/take-out.svg`, `icons/ticker-bag(-2).svg`, `icons/ada.svg`, `icons/chevron-up.svg`
- Language `1:4488`: `icons/close.svg`; menu frames: `icons/plus.svg`, `icons/bag.svg`
- Email Receipt `1:3383`: `icons/key-shift.svg`, `icons/key-backspace.svg`, `icons/input-clear.svg`
- Payment Failure `1:3427` → Icon L `1:990`: `icons/warning.svg` (P9b ErrorModal)
- ADA brand zone `1:5394` (logo lockup assembled from 4 exported parts): `brand/tb-logo-lockup.svg` (P9c)
- `flags/gb.svg` (canonical Union Jack — see §2.3)
- Fonts: three Archivo cuts (see §3)
