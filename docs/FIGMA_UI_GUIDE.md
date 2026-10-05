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
   Static promo content (splash poster) stays until its API wiring phase.
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
Fonts committed: `Archivo-Variable.woff2` (upright latin),
`Archivo-Expanded-Black.woff2` (wdth125/wght900), `Archivo-Condensed-Bold.woff2` (wdth62/wght700).

## 4. Frame → screen map (node IDs are canonical)

Legend: ✅ built · 🔄 partial · 🔲 pending. "Impl" = file in this repo.

### Attract / entry
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:2184` (+`1:5604`,`1:5617` singles, `1:2203` carousel) | Splash - Single/Carousel | `pages/StartScreen` | ✅ single (poster static; carousel + media API 🔲 P9) |
| — (no frame) | Registration (operator) | `pages/Registration` | ✅ design-language, flag for sign-off |
| `1:5598` loading, `1:5600` Error, `1:5602` Credit card | illustrations | `pages/LoadingResources` | 🔄 (progress UI built; illustrations unused yet) |

### Order type + chrome
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:2581` v1 / `1:2588` v2 | Dine In / Take Out / Daypart | `pages/SecondLayout` | ✅ v1 (v2 variant 🔲) |
| `1:4488` | Select Language | `components/language/LanguageSheet` | ✅ |
| in `1:2581` | Daypart ticker | `components/chrome/DaypartTicker` | ✅ (server-driven copy 🔲) |
| in `1:2581` | Footer bottom (Cancel/ADA/lang) | `components/chrome/FooterBar` | ✅ |

### Menu
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:2595`, `1:6327` Menu-basic agency · `1:5236` Menu · `1:3956` Menu-Rewards | menu browse | `pages/Menu`, `components/menu/{CategoryRail,MenuItemCard,MenuCtaBar}` | ✅ core (Rewards entry 🔲 P7; banners/search 🔲) |
| `1:4571`, `1:5502`, `1:5521` | Product added | `components/menu/ProductAddedModal` | ✅ |
| `1:5263` | Scroll bar | — | 🔲 (native scroll for now) |

### PDP / customization (P6)
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:5628` incomplete / `1:5683` complete | Select a Size v2 | `components/menu/SelectSizeModal` | ✅ |
| `1:2920` incomplete · `1:2827` completion warning · `1:2786`,`1:5738`,`1:5780` selection sheets · `1:2856`,`1:5353` all complete · `1:2984` customize · `1:3007`,`1:3037` customize-edit · `1:5477` edits complete | PDP - Builder family | `pages/Customization` | 🔄 core built (single-scroll layout; edit-mode + per-constituent selection sheets refine in P7 edit pass) |
| `1:5823` nutrition closed · `1:2614`, `1:2728`, `1:5540` | PDP - Single Product | `pages/Customization` | 🔄 core built (nutrition table accordion 🔲) |
| `1:4590`,`1:4641`,`1:4761`,`1:4692`,`1:4827`,`1:5180` + customize `1:4895`,`1:5051`,`1:5081`,`1:4947`,`1:5115`,`1:5145`,`1:4999` | Order a Pack family | `pages/Customization` + `components/customization/{PackSlotCard,SlotSelectionSheet,Tier2CustomizationSheet}` | 🔄 built from `1:4590`/`1:4641`/`1:4761`/`1:4692`; customize family + completed/warning states NOT pulled (Figma MCP rate limit 2026-09-29) — tier-2 sheet is design-language, needs visual pass |
| `1:5264`,`1:5322`,`1:5293` | Build Your Own Pack | `pages/Customization` (generic group grid for min≠1/max≠1 `_combo`) | 🔄 frames not pulled (rate limit) — design-language, flagged |
| — (no frame) | MIAM upsell prompt | `components/makeItAMeal/MakeItAMealPrompt` | ✅ design-language, flag for sign-off |
| `1:3070` Upsell · `1:3202`/`1:3204` CTA_Sheet_Fixed | pre-cart upsell | — | 🔲 P7 (/forYou) |

### Bag / rewards (P7)
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:3171` single · `1:3236`,`1:3270` multi · `1:3137`,`1:3973` has-rewards · `1:3205` · `1:4460` order-summary edit | My Bag | `components/cart/{BagSheet,BagItemRow,RemoveItemModal,CompleteYourMealRail,RepeatItemSheet}` + `/cart` route | ✅ P7a from `1:3171`/`1:3236`/`1:3270` (has-rewards states 🔲 P7c; `1:4460` numpad 🔲 polish) |
| `1:5881`,`1:5904` scan · `1:4406`/`1:4174` code default · `1:4425`/`1:4193` partial · `1:4368`/`1:4136` full · `1:4311`/`1:4079` success · `1:4330`,`1:4098` scan-error · `1:4387`,`1:4155` code-error · `1:4349`,`1:4117` scan-failure · `1:3786`,`1:3805`,`1:4278` rewards-scan states · `1:5927` Modal Rewards | Rewards (scan/code) | — | 🔲 P7 — **mapping decision: adapt to CX loyalty mechanics** (see PROGRESS.md) |
| `1:3824` default · `1:3858` ineligible · `1:3892` all-available · `1:3924` active | Reward states | `components/offer/{RewardsSheet,OfferRow,FreebiePickerSheet,OfferRemovalNotice}` | ✅ P7b — adapted to CX offer mechanics (mapping decision); loyalty-reward variants 🔲 P7c |
| `1:4009`,`1:4044` | T&C option 1 | — | 🔲 P7 |

### Checkout / payment / success (P8)
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:3364`,`1:4212` | Payment Location | — | 🔲 P8 |
| `1:3377`,`1:4225` | Payment Preference | — | 🔲 P8 |
| `1:3392`,`1:3404`,`1:4240`,`1:6288` | Payment Instructions | — | 🔲 P8 |
| `1:3427` | Payment Failure | — | 🔲 P8 |
| `1:3383`,`1:4231` | Email Receipt | keyboard+input pulled → `components/keyboard/KioskKeyboard`, Registration input | 🔄 (keyboard/input ✅ 2026-09-29; email screen itself 🔲 P8) |
| `1:5932` no-loyalty · `1:3437` has-loyalty | Order Complete | — | 🔲 P8 |
| `1:4447` Served at table · `1:4456`,`1:6301` Please wait | wait states | — | 🔲 P8 |

### Modals / system (P7–P9)
| Node(s) | Frame | Impl | Status |
|---|---|---|---|
| `1:4514` | You have been inactive | — | 🔲 P9 (idle) |
| `1:4533` | Remove item | `components/cart/RemoveItemModal` | ✅ P7a |
| `1:4552` | Cancel Order | `components/common/CancelOrderModal` (+ `hooks/utils/useSessionReset`) | ✅ P7a |
| `1:5392`,`1:5413`,`1:5445` | ADA Home/Customization/Recap | — | 🔲 P9 |
| — (no frames) | Activity Center, Tent, Phone/OTP, CountryCode | `components/activity/ActivityModal` (✅) / — | design-language builds, flagged |

## 5. Assets committed (source node → path)

- Splash `1:2184`: `splash/bg-texture.png`, `splash/plastic-overlay.jpg` (compressed), `splash/poster-taco.jpg`, `splash/star-1..6.svg`; bell → `brand/tb-bell.svg`
- Order type `1:2581`: `icons/dine-in.svg`, `icons/take-out.svg`, `icons/ticker-bag(-2).svg`, `icons/ada.svg`, `icons/chevron-up.svg`
- Language `1:4488`: `icons/close.svg`; menu frames: `icons/plus.svg`, `icons/bag.svg`
- Email Receipt `1:3383`: `icons/key-shift.svg`, `icons/key-backspace.svg`, `icons/input-clear.svg`
- `flags/gb.svg` (canonical Union Jack — see §2.3)
- Fonts: three Archivo cuts (see §3)
