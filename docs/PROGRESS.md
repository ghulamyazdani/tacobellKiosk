# Taco Bell Kiosk — Build Tracker

> **The living status doc for this project.** Updated at the end of every
> work step — if you finish (or descope) anything, update this file in the
> same change. Plan reference: the approved phase plan (P0–P9); UI source of
> truth: Figma `33e5briUYJiBqxv6P0AbqY`; logic source of truth:
> `@cx-sdk/*` (linked from `../posistKiosk-cx-sdk/packages`).
>
> Last updated: **2026-10-06 (P9e)** · Gates at last update (Node 22.14):
> **`yarn validate` green · unit 1,216/1,216 · e2e 121/121 · guardrails 0 critical / 197 warnings · build+PWA green · JS 1,663.6 KB / 2,000 budget · fork app `tsc -b` green**

## Phase status

| Phase | Scope | Status |
|---|---|---|
| P0 | Scaffold: Vite 8 / React 19.3 / TS 5.9 / Tailwind 4, cross-repo @cx-sdk link, all gates wired (tsc, strict ESLint, depcruise-in-validate, guardrails, CI, CLAUDE.md) | ✅ done |
| P1 | App shell: createKioskStore + persistence manifest (19 SDK + 6 UI slices + RTKQ), transport + 401/5xx session recovery, analytics port, Dexie, chunkRecovery, hardening, router+guards, PWAUpdateHandler, Figma splash | ✅ done |
| P2 | Design system: folded into per-screen work (tokens `tb-*`, fonts, KioskStage, chrome components built as screens landed) | ✅ absorbed |
| P3 | Auth + boot: Registration (license→authApi), LoadingResources (language→skin→pipelines→theme→settings), stale-token 401 → auto-logout | ✅ done |
| P4 | Order type: pipeline cards + open/closed states, daypart ticker, footer bar, language sheet (EN↔AR text switch — **correction 2026-10-01:** the `dir` is stored in redux but was never applied to the DOM, so Arabic is NOT RTL yet; RTL text lands in P9f) | ✅ done |
| P5 | Menu: category rail, hero/grid cards, price+cal, UNAVAILABLE, TOTAL/VIEW MY BAG bar; hook vertical ported (~3.2k lines); real fetchMenu→converter e2e over StandardMenu fixture | ✅ done |
| — | Activity Center: hidden 3s top-left hold on splash → operator diagnostics (info rows, passcode-gated fullscreen toggle, logout) | ✅ done |
| P6 | PDP/customization — **P6a ✅** quick-add spine · **P6b ✅** PDP bound to useCustomization Tier1-style (all groups one Figma scroll, defaults seeded, min/max via commit, VARIANT+CUSTOMIZABLE commits, return-path navigation) · **P6c ✅** Order-a-Pack slot cards + SELECT sheets, tier-2 nested customize, BYO via generic group path, MIAM upsell prompt · repeat-sheet → P7 | ✅ done |
| P7 | Cart + Offers + Loyalty + ForYou — **P7a ✅** My Bag sheet over /menu (route-driven /cart): rows w/ addon lines + steppers, remove-confirm + cancel-order modals (session reset), edit-from-bag (PDP edit mode), repeat sheet, Complete-Your-Meal rail (cart-upsell engine), checkout preflight → /checkout stub, Dexie crash-recovery rehydrate · **P7b ✅** Rewards/offers sheet (Figma reward-states adapted to CX mechanics), apply/swap/remove cores, freebie flows (atomic + picker), bill Discounts line + ORDER & PAY, six-check revalidation + removal notice · **P7c ✅** Xeno loyalty replicated from the fork (boot partner fetch, /phone lookup, rewards sheet + 4-digit OTP redemption chain, loyalty cart rows, revoke-before-reset, auto-reversal, /customerName) · **P7d ✅** MIAM prompt re-skinned to its real frame (1:3070) + `/forYou` pre-cart upsell (capacity-bounded grid, session-seen gate, detour-safe baseline) + overlays hoisted to the routes level | ✅ done |
| P8 | Checkout + Payment + Success — **P8a ✅** real route fan-out (/tent, /payment, /receipt, /orderSuccess) replacing the stub, PAY AT COUNTER end-to-end with a hardened retry ladder, order push, Order Complete + gated print · **P8b 🔄** Paytm Dynamic QR + Paytm EDC (user decision 2026-10-05; India deployment) — building in the `p8b-paytm` worktree lane | 🔄 P8a done |
| P9 | Close-out, mapped 2026-10-01 by an 8-reader workflow (contracts in the session scratchpad, summarised below) — **P9a ✅** idle timeout (Figma 1:4514: IdleGuard + IdleTimeoutModal, holds, ≤120 s) + `/start` owns the session teardown + late-async guards · **P9b ✅** Rule 2 hardening: redeem-failure money fix, host-configured SDK timeout (TB 10 s / menu 30 s), timed-out pushes never auto-retried, menu-load error + Retry, boot auto-retry, ErrorBoundary recovery, loyalty boot degrade, Xeno revoke bounded · **P9c ✅** ADA reach-zone view (1:5392/1:5413/1:5445; stable-tree ReachZone, overlay caps, PDP footer strip, WCAG 2.2.1 timer off in ADA) + design-language re-flows of 7 frameless screens · **P9d ✅** splash media pipeline (getMedia `home_screen` → WELCOME 1:5617 when none / full-bleed 1:5604 / carousel 1:2203, slides that fail or stall are skipped) + the uncertain-order refund skip (S7) · **P9e ✅** updates apply only at the splash (whole-app reload / FCM brand refresh / a SCHEDULED boot refresh when the data is >6 h old, 15 s untouched + a 5 s countdown) + Activity Center Reload resources + an atomic boot commit + the telemetry recovery exemption (D2) + the hardened update hook + FCM (lazy, config- and permission-gated, never prompts) · **P9f 🔲** e2e parity suite (the 7 rulebook flows, page objects, axe-core a11y) + bundle budgets + Arabic RTL text · proximity welcome ⏸ deferred (see open decisions) | 🔄 |

## What exists right now (flow you can walk)

`/` Registration (license code + on-screen keyboard) → `/LoadingResources`
(real boot incl. the Xeno loyalty partner; 401 ⇒ auto-logout) → `/start` Figma
splash (+ hidden 3s top-left hold ⇒ Activity Center) → tap ⇒ `/second` WHERE
ARE YOU EATING (CX pipelines) → with loyalty on ⇒ `/phone` (numpad lookup,
skippable) ⇒ rewards auto-open
→ pick ⇒ real menu fetch+convert ⇒ `/menu` (rail, cards, OOS, totals bar) →
item tap ⇒ `/customization` PDP (single product, variant fast-lane, pack slot
cards + SELECT sheets + tier-2 nested customize) ⇒ ADD TO BAG; upsell-tagged
items ⇒ MIAM prompt (accept ⇒ pack PDP · decline ⇒ item by shape); re-tap of
an in-cart customizable ⇒ repeat sheet → `/cart` MY BAG sheet (rows, edit,
remove-confirm, Complete-Your-Meal rail, Rewards section → REWARDS sheet
(radio + SAVE SELECTION, locked-gap nudges, suggested-items rail, freebie
picker), Discounts line, Sub Total/Total via bill engine) ⇒
PAY preflight ⇒ `/tent` (table tabs) / `/phone` / `/customerName` ⇒ `/payment`
⇒ PAY AT COUNTER ⇒ receipt choice ⇒ order pushed ⇒ `/orderSuccess` (#order
number, Start Over ⇒ /start · Place New Order ⇒ /second).
VIEW MY BAG ⇒ `/forYou` "Complete Your Meal" upsell (once per session, when
eligible) ⇒ `/cart`. MY REWARDS (n) on the menu ⇒ rewards sheet ⇒ redeem
(validate → OTP → claim) ⇒ free/discounted reward row in the bag. Cancel Order ⇒ confirm ⇒ Xeno revoke
⇒ full session reset ⇒ `/start`. Cart survives a crash/reload via Dexie
rehydrate.
**Splash (P9d):** the boot stores the operator's getMedia `home_screen` list
(this deployment's entries only); the splash shows WELCOME (Figma 1:5617)
with no media, the media full-bleed (1:5604) for one slide, and the 1:2203
peek carousel for two or more (images dwell `iteration_time` s, ≥3 s, else
8 s; videos play `iteration_time` times). A slide that errors, stalls 15 s or
has no decodable video is skipped for the visit, so the splash degrades
carousel → full-bleed → WELCOME and is never blank. A media failure at boot
keeps the last-known media and never blocks the boot.
**Updates (P9e):** a new build (service worker), an FCM brand push, or boot
data older than 6 h only ever applies on the splash: after 15 s untouched a
5 s countdown shows, then the kiosk reloads (new build) or re-runs the boot in
REFRESH mode (push / schedule / the Activity Center's "Reload resources");
a guest tap defers it, the Activity Center pauses it, offline skips it. The
boot commits atomically, so a failed refresh returns to the splash on the old
data and retries after 30 min. The Activity Center shows when the data last
loaded. The FCM token, version report and update ack can no longer log out or
de-register the kiosk. FCM stays inert until Firebase keys exist AND
notification permission is pre-granted (it never prompts).
Language switch EN↔العربية anywhere via the footer (text only — RTL lands in P9f).
**Idle (P9a):** on every screen from `/second` on, 100 s without a touch opens
"You have been inactive" (START AGAIN fills over 20 s · CONTINUE ORDERING or a
backdrop tap re-arms); at 120 s (or `ideal_time` if shorter, floor 60 s) the
kiosk returns to `/start`. `/start`'s mount ends EVERY session (Xeno revoke →
full reset), so idle, footer cancels, NotFound and reloads all land clean, and
the next customer starts in English. Idle is held while an order push or a
loyalty call is in flight (capped at 120 s) and on `/orderSuccess` (its own
20 s countdown owns that exit).
**ADA (P9c):** when the tenant enables `accessibility_mode`, FOOTER "ADA
DISPLAY" (aria-pressed) lowers the whole session into the bottom 1122 px — a
brand zone (texture + logo lockup) fills the top 798 px and taps there exit —
with nothing scaled, every control inside reach, sheets/modals capped to the
zone, the bag at 765 px, and the loyalty rewards auto-dismiss off (WCAG 2.2.1).
Toggling never remounts a screen; the splash, boot and registration are always
full-stage, and every return to the splash ends ADA for the next guest.

## Deferred-in-place (wired later, marked with TODOs in code)

- "Apply to the following burrito" slot-copy toggle (Figma 1:4641) → P7 polish
- EAT IN / TAKE OUT toggle in the bag is READ-ONLY: a mid-session pipeline
  switch needs setSelectedPipeline+setSelectedTabId+charges refetch+setTabType+
  fetchMenu+cart revalidation (fork has NO such path) → P7 later, decide UX
- Edit-quantity numpad modal for multi-qty rows (Figma 1:4460) → P7 polish
- LOG-IN & GET REWARDS on loyalty-OFF deployments still shows and answers
  "coming soon" (live since P7c when loyalty is on) → user decision 2026-10-05: hide
- Cart recommendations S3 source (tenant map, useRecommendationHook) → later;
  P7a rail ships the isCartRecommended engine source only
- Loyalty deferred set (P7 later / P8): Reelo partner path entirely
  (CartRewardsCard, points-redemption modals, `redeem_points`), SCAN APP tab
  (renders inert — no scanner integration), resend-OTP (no fork endpoint),
  and the fork's dead `/verify` + `/loyalty` pages (the zero-bill
  `shouldPlaceLoyaltyOrderDirectly` push landed in P8a). Reelo is not ported
  (user decision 2026-10-05: Xeno only)
- Offers deferred set (P7 later / P8 polish): BOGO buy-stage UI (locked
  bogoBuySide rows fall back to /menu — documented fork fallback),
  customizable freebies (tier session inside the picker; rows render disabled
  "coming soon"), apply-celebration modal + confetti + applied-bar animation
  (useSessionReset TODO sites :102/:104 await those modules), auto-apply
  (pickAutoApplyOffer), offer marketing photos, fork's SavingsLine hysteresis
  strip (TB uses the bag Rewards entry row instead)
- `confirmTier1CustomizationRemoval` (tier-2 qty→0 in edit) is dispatched but has
  no consumer yet (fork's ConfirmFirstTierDeleteCustomization equivalent) → P7
- Variant-shaped upsell items in the MIAM decline path (fork's isVariantUpsell
  branch) → wire when variant upsells enter the TB catalog
- Menu banner media (`banner_image_*`) + MIAM texts + recommendations
  prefetch in the boot loader → P4 leftovers noted in
  `hooks/utils/useLoaders.ts` (splash media landed in P9d; the loyalty
  partner in P7c; cluster settings are dead in the fork — `useLoaders.ts:649-657`
  commented out — so they are not ported)
- Payment-terminal socket connects at boot (Geidea/NeoLeap) are deliberately NOT ported
  (the payment-settings fetch landed in P8a; P8b ports only Paytm DQR + EDC)
- Per-language pipeline/menu names (`secondary_name`) → P6/P7 polish

## Open decisions / user-gated items

| Item | Owner | Status |
|---|---|---|
| Commits: tacobell-kiosk has NO commits; SDK interop fixes sit uncommitted in posistKiosk-cx-sdk | user says when | ⚠️ open |
| GT America font license (Archivo Expanded/Condensed stand-ins shipped) | client | ⚠️ open |
| Activity-Center fullscreen passcode is hardcoded (inherited `Pos@123`) — needs server-issued secret pre-production | maintainer | ⚠️ open |
| Real license code registration (unlocks building P6+ against live data) | user | ⚠️ open |
| Env keys for TB deployment (Firebase project, PostHog) — `.env.example` scaffolded | user | ⚠️ open |
| Rewards scan/code Figma UX ↔ loyalty mechanics: **user decision 2026-09-30 — replicate the ORIG kiosk's XENO integration/flow exactly** (same endpoints, session lifecycle, redeem/revoke), skinned with the Figma rewards surfaces (numpad login 1:4174 as phone→OTP steps, REWARDS INCOMING 1:4079, error 1:3786, MY REWARDS (n) CTA entry 1:3956); SCAN APP tab deferred (no scanner) | user | 📌 decided |
| Bill math in the bag: billCalculation rounds the TOTAL to whole units unless deployment carries `{name:"disable_roundoff",selected:true}`, and fixture items carry exclusive VAT@15% — so bag/checkout total = round(subtotal×1.15) while the menu CTA shows the plain subtotal (fork-faithful). Maintainer: confirm round-off / GST settings for the India deployment (fixtures carry 15% exclusive tax as test data) + whether the CTA should show the taxed total | maintainer | ⚠️ open |
| P6c surfaces partly design-language: Figma MCP rate limit (Starter plan) blocked the pack customize-family frames (`1:4895`…), BYO frames (`1:5264`…), completed/warning pack states, and MIAM has no frame — built from the 4 pulled frames' language; needs a visual pass once frames are pullable | client review | ⚠️ open |
| **Payment gateways — user decision 2026-10-05: PAYTM DYNAMIC QR + PAYTM EDC.** Of the fork's 9 (Dojo; Geidea, NeoLeap; Network International, Mashreq; Paytm QR, Paytm EDC, Pine Labs Plutus, Razorpay), P8b ports exactly `PaytmDynamicQr` and `PaytmEdc` (+ their polling settlement and the Figma payment-instructions / please-wait / card-failure screens). Every other gateway stays unported; pay-at-counter remains | user | 📌 decided → P8b |
| **Deployment country — user decision 2026-10-06: INDIA (IST, ₹).** "TB UK" and "£" in older notes, comments and e2e fixtures were placeholders. Prices already render with the deployment's currency symbol from settings (`selectCurrency`; no hardcoded £ in rendering); the SDK's Paytm QR expiry is computed in kiosk-local time, which is correct in IST | user | 📌 decided |
| **Paytm DQR rendering — user decision 2026-10-06: ADD `react-qr-code@2.0.15`.** The backend sends only Paytm's raw UPI `qrData` (it drops Paytm's base64 image), so the kiosk draws the QR itself with the fork's library — the one new dependency of P8b (~13 KB). P8b lane defaults (contract D2–D9, D11): payment idle-hold cap 240 s; the five Paytm kiosk endpoints exempt from 401/504/505 recovery (host-configured, like D2); an unknown outcome goes to a staff panel (CHECK AGAIN / FINISH, never a re-pay); a DQR still pending 30 s past expiry = not received + TRY AGAIN; DQR cancel has no backend endpoint (fork parity + warning copy — ask the backend for one); an EDC initiate FETCH_ERROR/5xx is outcome-unknown (settle by status, never re-initiate); a static hourglass frame; three payment tiles in one row (sign-off); `paytm_dqr_secret_key` stays persisted (fork parity — flag) | user / orchestrator | 📌 decided → P8b |
| Order Complete QR codes (frames 1:5932 guest "scan to earn points" / 1:3437 promo) have NO CX data source — the panel ships without a QR rather than a placeholder that scans to nothing | client/backend | ⚠️ open |
| Email receipt: the Figma receipt screen offers EMAIL but **the original kiosk has no email-receipt anything** — `customerInfo.email` exists in the slice, is never written and never reaches the order payload. Tile ships inert; needs a payload contract before it can collect an address | client/backend | ⚠️ open |
| MIAM "SAVE £X" badge (Figma 1:3070) has NO data source: a full key census of the reference menu (100 distinct keys) found only `price`/`applyAddonsPrice`/`differentialPrice`/`priceChange` — the last two are modifier deltas, not a was-price — and `makeItMeal` carries only subText/buttonText1/buttonText2. Badge is implemented + gated on a real figure and stays hidden; needs a backend data contract to ever appear | client/backend | ⚠️ open |
| ONE flag gates TWO surfaces: `enable_cart_upsell_screen: false` disables BOTH the `/forYou` interstitial AND the in-bag Complete-Your-Meal rail (both read `shouldShowUpsell`). Fork-faithful, but a tenant wanting the rail without the interstitial needs a second flag | client | ⚠️ open |
| `/forYou` is a design-language screen — the TB Figma has no frame for it (node 1:3070, previously mapped as "pre-cart upsell", is actually the MIAM prompt). The design instead puts Complete-Your-Meal inside the bag. Screen is settings-gated, so dropping it is a config decision | client review | ⚠️ open |
| Loyalty boot hardness: the `getLoyaltyPartner` call now sits inside the boot try/catch, so on `enable_loyalty` deployments a dead/slow loyalty proxy blocks boot with the retry screen (fork booted loyalty-off silently). Rule 2 says never freeze; the alternative is degrade-over-block via an inner try/catch — one line either way. **User decision 2026-10-01: DEGRADE** — inner try/catch, boot and sell loyalty-off, analytics event + "loyalty unavailable" in the Activity Center; the splash retries the partner once per visit (applied only while the splash is still showing, so loyalty never switches on mid-order) | user | ✅ P9b |
| Loyalty screens `/phone` + `/customerName` have no idle-timeout coverage — TB still has no mounted idle timer at all (P9 item); a guest abandoning mid-phone-entry does not reset to /start | maintainer | ✅ P9a (IdleGuard covers every route from /second on) |
| **Node pin vs dependency-cruiser** — `.nvmrc` + CI pin Node **20.19** (EOL 2026-04-30), but dependency-cruiser 18.4 refuses to run below Node 22 (`^22‖^24‖>=26`), so `yarn validate` and CI fail at the depcruise step on the pinned runtime (pre-existing, not P9a; gates were run with depcruise on Node 22.14). **User decision 2026-10-01: bump to Node 22 LTS** — done: `.nvmrc` 22, ci.yml `node-version: 22` ×2, `engines` `>=22.12`, README. Any deploy-image Node pin outside the repo needs the same bump | user | ✅ done |
| Idle START AGAIN fill `tb-lilac` (#F3D9FF) is 1.3:1 against white — decorative per the design (the label carries 8.7:1), but below WCAG 1.4.11's 3:1 for a meaningful graphic | client | ⚠️ sign-off |
| **SDK transport timeout (Rule 2)** — the shared base query (`packages/core/src/transport/kioskApi.ts`) has no timeout, so a hung getMenu/placeOrder freezes the UI forever. **User decision 2026-10-01:** 10 s default request timeout, multi-MB menu download 30 s, retries stay per call — **refined the same day to HOST-CONFIGURED**: `configureKioskTransport()` gains the timeout setting (+ per-endpoint overrides), TB turns it on, the fork app stays byte-for-byte as today until its payments owner opts in. Reason: the P9b mapping found a blanket SDK default would abort the fork's card-gateway initiate/park/cancel calls mid-arming and let its post-payment ladder auto-retry timed-out pushes for customers who already paid by card | user | ✅ P9b |
| `MENU_DOWNLOAD_TIMEOUT_MS` (30 s) is a calibration knob: it needs ~2 Mbps effective for the 7.5 MB reference menu if `getMenu` is not gzip-encoded. Confirm gzip + store bandwidth | backend / ops | ⚠️ open |
| **Uncertain order + claimed loyalty reward (P9b review M4):** after a timed-out (outcome-unknown) push, the claim is kept and the `/start` teardown refunds it. If the order DID land, the guest got the free item AND the points back; clearing the claim instead strands the points if it did NOT land. Today = refund (fork parity). **User decision 2026-10-01: SKIP the automatic refund when the claim's order push is outcome-unknown** — keep the claim un-refunded, emit the reconciliation event (reward id, claim time, points), staff reconcile | user | ✅ P9d (also requires the reward row in the pushed cart; the `order_push` event carries the reward ids at mark time) |
| **Splash fallback (no media configured)** — the P1 poster (1:2184) promises "Half moon half price, happy hour 2-4pm", unsafe as a PERMANENT fallback. **User decision 2026-10-01:** the no-media fallback becomes the neutral Figma **1:5617** (full-bleed photo, WELCOME + "touch anywhere to start", no price claim); configured media renders per Figma (1 item full-bleed 1:5604-style, ≥2 the 1:2203 carousel). Figma only holds a 1810×1099 photo (×1.75 upscale at 1080×1920) — client to supply a hi-res original | user / client | ✅ P9d (hi-res original still owed) |
| **ADA sign-off list (P9c, design-language):** (1) tapping the brand zone exits ADA — fork parity, but Figma draws no affordance (it is a labelled button for screen readers); (2) the PDP now shows the Figma Footer-bottom strip (CANCEL ORDER / ADA / language) in NORMAL mode too — it is in 1:2614/1:2920/1:5413, TB lacked it — and the PDP scroll area is 56 px shorter; (3) ADA variants of the 7 frameless screens (`/second` >2 pipelines become a swipe row, bells dropped, Tent's error banner pinned from the top); (4) backdrop seams where the brand-zone texture meets `/tent`, `/payment`, `/receipt` (540 px tile), `/orderSuccess` (gradient), `/phone`, `/customerName` (plain purple) — `/second` aligned; (5) "Place New Order" keeps ADA on for the next guest (fork parity; every path via the splash clears it); (6) Arabic `ada.exit` copy | client | ⚠️ sign-off |
| ADA reach calibration: the 798/1122 split is Figma's; whether it keeps every control under the ADA 2010 §308 high-reach limit (48 in / 1220 mm) depends on the cabinet's panel size and mounting height. `ADA_BRAND_ZONE_HEIGHT` is the single knob (lowering it is always safe; unit tests guard ≤ 816) | hardware | ⚠️ open |
| Back-to-bag after a timed-out push then re-PAY mints a NEW order id — if the timed-out push actually landed, that is a duplicate order even if the backend dedupes on order id (Retry on the error panel keeps the id). Needs the backend idempotency answer | backend | ⚠️ open |
| Any 504/505 (incl. on `placeOrder`) still de-registers the kiosk via `recoverFromServerError` when the gateway answers inside the 10 s budget. Intended "session invalid" signal or gateway timeouts? P9e: the scheduled refresh re-runs ~10 boot calls about 4×/day per kiosk, multiplying this exposure; D2 exempts only the three telemetry endpoints | maintainer / backend | ⚠️ open |
| `/LoadingResources` auto-retry keeps counting while the operator has the Activity Center open; a successful background boot navigates to `/start` and closes the diagnostics mid-use | client | ⚠️ sign-off |
| Fork follow-ups surfaced by the P9b mapping (NOT TB work): the fork's Polling ladder would duplicate paid orders if it ever opts into timeouts; its gateway initiators need an explicit ambiguous-timeout UX; RTK 2.7 in the fork bounds only time-to-headers (TB's deduped 2.12 bounds the whole request — a mid-body timeout surfaces as `PARSING_ERROR` "TimeoutError", so classify timeouts with a shared predicate, never `status === "TIMEOUT_ERROR"` alone) | fork payments owner | ⚠️ open |
| **Order push after a TIMEOUT** — placeOrder idempotency on the client orderId is unknown. **User decision 2026-10-01:** no auto-retry after a timeout (show the Retry / Back-to-bag panel); clean errors (network down, 5xx) keep the existing 4-attempt ladder. Backend still to confirm idempotency | user / backend | ✅ P9b (also covers a 2xx whose body was lost) |
| `@axe-core/playwright` devDependency for the a11y e2e (contrast, names, roles) — **approved 2026-10-01** (devDependency, 0 bytes shipped) | user | 📌 decided → P9f |
| **Arabic layout** — **user decision 2026-10-01:** RTL text, LTR layout (the Figma has no RTL frames); Arabic text blocks get `dir="rtl"`. Client sign-off still wanted | user / client | 📌 decided → P9f |
| **Idle timing (P9a, orchestrator default)** — Rule 1's 120 s is a CEILING: total = clamp(server `ideal_time`, 60, 120) s, fallback 120; the "You have been inactive" prompt covers the last 20 s (WCAG 2.2.1 minimum). The fork reset at (ideal−10)/2+10 s (65 s for 120) — fixed, not ported. Boot no longer throws on a missing `ideal_time` | maintainer | 📌 decided |
| **Proximity welcome — deferred.** The fork's feature is always-on camera motion detection on the splash (getUserMedia, no enable key; the delay setting only tunes it). Needs an explicit backend enable key, data-protection (India DPDP Act) assessment + signage sign-off, a front camera with pre-granted permission, and on-site calibration — and it depends on the idle timer (P9a). Not built | client / legal / hardware | ⏸ deferred |
| **Boot-data refresh — user decision 2026-10-05: SCHEDULED.** A registered kiosk only re-fetched its boot data (kiosk settings, theme, pipelines, splash media, loyalty partner) on an FCM brand update (fork parity — the fork's splash-mount `StartOverResourceLoading` fetches nothing), and FCM stays off until TB has Firebase keys AND pre-granted notification permission, so Cockpit changes reached a kiosk only by re-registering it. P9e: FCM brand updates + an Activity Center "Reload resources" button + the splash re-runs the boot when the last SUCCESSFUL boot is older than 6 h (one knob) and the splash has been untouched for 15 s — the brand-update path, never mid-order; a failed refresh returns to the splash on the old data | user | ✅ P9e |
| **Background telemetry vs session recovery — user decision 2026-10-05: OPT-IN EXEMPTION.** `configureKioskTransport()` gains a host-configured list of background endpoints (`update_cx_fcm_key`, `update_cx_software`, `update_device_status`) that skip the 401 / 504 / 505 recovery, so a gateway hiccup on telemetry can no longer log out or de-register a healthy kiosk; TB opts in, the fork configures nothing and stays byte-identical (the P9b timeout pattern) | user | ✅ P9e (488-row A/B on RTK 2.7 + 2.12: fork identical) |
| **P9e sign-off list (design-language, no Figma frames):** (1) the update countdown modal (invisible 0–10 s, "Starting in Ns" 10–15 s, then "Updating…"; z-80); (2) a guest tap in the final 5 s is swallowed — non-dismissable, ≤5 s, fork parity (OV8); (3) the Activity Center's "Reload resources" button and "Data loaded" row; (4) the Arabic update strings are drafts. Calibration knobs: `BOOT_DATA_MAX_AGE_MS` 6 h, `BOOT_REFRESH_RETRY_MS` 30 min (no jitter yet — `withJitter` is the upgrade if a fleet power-cycled together refreshes together) | client / ops | ⚠️ sign-off |
| **Visual regression — user decision 2026-10-05: CAPTURE ONLY.** P9f's flow specs attach screenshots at the key steps (splash, order type, menu, bag, payment, complete) to the e2e report for human review; no pixel assertions until the GT America font is licensed and a CI rendering image is fixed | user | 📌 decided → P9f |
| **CI e2e — user decision 2026-10-05: PER-PR JOB, 2 SHARDS.** P9f adds an e2e job to every PR. The first estimate (~3–4 min) was wrong: the suite needs ~12–18 min on one CI worker, so the job runs as 2 parallel shards (~8–10 min wall per PR; user decision the same day). The job waits for lint + type-check, and its build sets `VITE_POST_HOG_TYPE=production` so the bundle budget measures the production layout (lazy PostHog chunk included). Default SDK checkout: the local SDK clone's origin `PosistGit/posistKiosk` at branch `cx-sdk/extraction` (workflow-level `SDK_REPO` / `SDK_REF`) — change it if the SDK moves to its own repo. It needs the SDK checked out beside this repo, so it stays red until the real SDK repo slug and an `SDK_REPO_TOKEN` secret are filled in (`.github/workflows/ci.yml` placeholders) | user / devops | 📌 decided → P9f (slug + secret owed) |
| **Bundle budget — user decision 2026-10-05: ENTRY + TOTAL.** P9f fixes `scripts/check-bundle-size.mjs` (fail closed on a malformed budget, exclude the service worker), keeps the 2,000 KB total-JS budget, and adds an entry-chunk gzip budget set just above the post-P9f size (after lazy PostHog and dropping framer-motion), so boot-path regressions fail the gate | user | 📌 decided → P9f |
| **Arabic mechanism — user decision 2026-10-05: ISOLATES + `dir="auto"`.** P9f gets "RTL text, LTR layout" through the i18n layer: every translated Arabic string (and every interpolated value) is wrapped in Unicode direction isolates (FSI…PDI) by an i18next post-processor, `<html lang>` follows the language, and multi-line Arabic paragraphs get `dir="auto"` so they right-align — one file for the runs, zero component rewrites, English byte-identical. `dir="rtl"` on elements was rejected: it mirrors any flex row it lands on (~125 rows in 48 files). Client still signs off the look | user / client | 📌 decided → P9f |
| **PostHog identify payload — user decision 2026-10-05: KEEP AS IS.** `posthog.identify` keeps sending `license_key` and `login_code` with the tenant/deployment ids (fork parity), also after P9f's lazy analytics loader | user | 📌 decided |
| **CLAUDE.md rule 8 — user approval 2026-10-05:** P9f adds "startAnalytics() right after setAnalyticsPort(); never import posthog-js statically" to the boot-order rule when the lazy PostHog loader lands | user | 📌 decided → P9f |
| **P9f orchestrator defaults (2026-10-05):** the Registration ACTIVATE button's white-on-pink (2.46:1) is fixed in code (ink-purple text, 7.73:1 — Registration has no Figma frame); Playwright `expect.timeout` 10 s and an ESLint ban on `page.waitForTimeout` under `tests/e2e`; the back-to-bag re-PAY order id stays an annotation, not an assertion, until the backend confirms placeOrder idempotency; P9e's specs are written in today's per-spec style and P9f's harness migration absorbs them; the optional idle sweep over 5 more screens and the boot-config parity cases go to the backlog (CI time) | orchestrator | 📌 decided |
| **Loyalty partner — user decision 2026-10-05: XENO ONLY.** The fork's Reelo path (6-digit OTP, points redemption, `redeem_points`) is NOT ported; a Reelo-configured store would have no working rewards in TB | user | 📌 decided |
| **Bag rewards button on loyalty-off deployments — user decision 2026-10-05: HIDE.** LOG-IN & GET REWARDS renders only when loyalty is on (today it shows and answers "coming soon") | user | 📌 decided → backlog build |
| **Backend contract proposals — user decision 2026-10-05: WRITE THEM.** One proposed contract each (fields, endpoints, payloads, kiosk behaviour) for: email receipt, Order Complete QR codes, the MIAM "SAVE £X" badge, a separate in-bag meal-rail flag, a server-issued Activity Center passcode, SCAN APP login, resend OTP — in `docs/BACKEND_CONTRACT_PROPOSALS.md` for the backend team | user | ✅ written 2026-10-06 (7 proposals + 5 confirm-only questions; notable: a wrong operator passcode must never answer 401 — the transport logs out on any 401) |
| **Menu cache across boots (P9e review F2):** the boot no longer wipes the Dexie menu cache (the fork wiped it on every boot, incl. brand refreshes), so menu freshness between boots relies only on the server's `MENU_ID` / 304 — which TB already trusts within a session. Backend: confirm that every Cockpit change affecting the menu payload bumps `MENU_ID` (if a brand push must force a full download, it is one line: clear `db.menus` on trigger `brand`) | maintainer / backend | ⚠️ open |
| **Arabic / a11y sign-off list (P9f mapping):** (S1) an Arabic typeface — Archivo has no Arabic glyphs, so Arabic renders in the OS fallback; (S2) wrapped Arabic paragraphs right-align via `dir="auto"`, single lines keep the layout's alignment; (S3) the kiosk blocks pinch-zoom / text resize (`user-scalable=no`, WCAG 1.4.4) — the axe sweep documents a `meta-viewport` exclusion; (S4) placeholder grey darkened 35 % → 55 % black for contrast; (S6) the 🇬🇧 flag next to "العربية" in the footer; (S7) the pink phone-field border is 2.46:1 non-text contrast | client / compliance | ⚠️ sign-off |
| **Splash sign-off list (P9d, design-language details):** (1) carousel cards crop 1080×1920 art with `object-cover` — ≈6.9 % lost top and bottom on the 680×1043 cards (author carousel art at 680×1043, or accept); (2) the card colour behind a loading slide or a peeking video, and the 0.5 s centre fade, have no Figma spec; (3) the carousel sheen uses the app-wide recipe (40 % soft-light, unrotated), not Figma's 50 % normal rotated −90°; (4) the full-bleed CTA has no scrim over operator media, so its contrast depends on the asset (keep the bottom band dark in the asset spec); (5) WELCOME says "touch anywhere to start" but a short tap in the hidden 180×180 operator corner does nothing; (6) the Arabic splash copy is a draft needing native review; (7) the bell is now decorative (`alt=""`) — the start button's accessible name is the visible copy | client | ⚠️ sign-off |
| **Splash media known limits (P9d):** a slide that errors or stalls stays skipped until the next splash visit (no in-visit retry — `ponytail:` in SplashMedia); video play count is uncapped (image dwell is capped at 1 h); `SPLASH_VIDEO_STALL_MS` (15 s) is a hardware calibration knob and a multi-day soak on the physical kiosk is owed; videos are not service-worker cached (range responses), so there is no offline video; the SW image route now covers ALL images (`request.destination === "image"`, StaleWhileRevalidate, 250 entries / 30 days, `purgeOnQuotaError`) and each opaque S3 entry counts several MB of quota | hardware / ops | ⚠️ open |
| **S7 residue (P9d):** after an outcome-unknown push, "Back to bag" then removing the reward row shows the marked claim's points as returned (BagSheet adds them on screen before the skipped revoke) — display-only, session-scoped; the reconciliation record (`order_push` reward ids + `xeno_revoke_skipped`) is analytics-only, so the `VITE_POST_HOG_TYPE` kill switch drops it outside production | maintainer | ⚠️ open |

## Engineering notes (learned the hard way — don't relearn)

- **Vite 8/Rolldown CJS interop**: default-import of CJS yields the namespace →
  fixed in SDK (`createFilter`, `autoMergeLevel2`); use named imports or `es/` builds.
- **No framer-motion for critical/operator UI**: rAF freezes in occluded
  windows → pure-CSS entrances (`tb-modal-enter` pattern).
- **Tailwind 4 translate classes use the CSS `translate` property** — they STACK
  with keyframe/inline `transform`. One owner per element.
- **Playwright route mocks**: newest-registered wins; always catch-all
  `**/api/**` first or background calls (PWA version report) 401 the session.
- The offers boot call is **`get_cx_valid_offers`** (not `get_cx_offers`).
- **`tb-modal-enter` is ONLY for `left-1/2 top-1/2` centered modals** — its
  keyframe ends at `translate(-50%,-50%)`, so on flex-centered or bottom-anchored
  elements it permanently shifts them half off-screen. Sheets/dialogs use scoped
  position-neutral keyframes (see Tier2CustomizationSheet/SlotSelectionSheet).
- `setSelectedTabId` writes `auth.tab_id` (`selectedTabId` is a dead field, SDK-documented).
- `mandatoryFullscreen` defaults **true**; `selectedLanguage.code` inits to `""` (use `||` not `??`).
- Ports: tacobell dev+e2e = **5373** (strictPort); 5173/5273 belong to posistKiosk.
- Dev backend: `https://test.restroworks.biz` (qrmenu.posist.co is dead — 404s).
- **`appSettings.deploymentInfoSettings` must ALWAYS hold an array.** The SDK's
  `hasSetting(name, settingsArray)` (ordering/order/orderBuilder) does an
  unguarded `.filter` and is reached from `convertOrderItems` → `convertCart` →
  `getCalculatedBill` — i.e. on EVERY bill recompute while the bag is open. When
  P8a joined `getDeploymentInfoApi()` to the boot sequence, storing a degraded
  body (`{}` from an error envelope) made the bag throw on every cart change.
  Normalise at the dispatch, not at the consumers.
- **Pay-at-counter is the ONLY money path in the app today.** `payment.paymentType`
  must be exactly `"PAY_AT_RESTAURANT"` (or `""` on the zero-bill loyalty path):
  `pushOrder`'s three-way switch makes NI/Paytm values place NO order at all
  (the backend already did) and routes Geidea/NeoLeap/Dojo to a different
  endpoint — a wrong string means a success screen for an order that does not
  exist. The gateway seam is `resolveKioskGatewayKind`; nothing in TB imports it.
- **The boot loader deliberately does NOT port `connectTOGeideaSocket` /
  `connectWithNeoLeapSocket`.** Their absence is what keeps the kiosk
  peripheral-free by construction rather than by fixture discipline; the
  payment-settings fetch also filters out the synthetic Mashreq row so the
  terminal bridge can never be probed. Every e2e must additionally abort
  `https://localhost:65505/**` (the print agent is a different origin, so the
  `**/api/**` catch-all misses it) and 500-guard the gateway endpoints so a
  regression fails loudly instead of passing against an empty mock.
- **App-wide overlays mount at the ROUTES level, not inside a page.** MIAM and
  the repeat sheet are opened by `useAddEntityToCart` dispatching redux modal
  state from ANY screen, so a page-local mount makes the tap dead elsewhere and
  leaves the state to surface later on an unrelated screen. They live in
  `AppRoutes`' pathless `InSessionOverlays` layout route (inside ProtectedRoute,
  so never on Registration) — the fork does the same thing in IdleChecksRoutes.
- **Overlay z-stack (KioskStage is the stacking context; BagSheet z-40 traps its
  own children):** page overlays 40 · MIAM wrapper **45** · CancelOrder /
  LoyaltyRewards 50 · Repeat wrapper **55** · LoyaltyLogin 60 · LoyaltySuccess
  70 · LoyaltyError 80 · NetworkStatus 99999 (outside the stage). The hoisted
  pair carries explicit wrapper z-indexes because equal-z ties were previously
  resolved by DOM order — 45 lets MIAM clear the bag, 55 preserves every
  ordering the repeat sheet had at its intrinsic z-60. Full-stage wrappers MUST
  be `pointer-events-none` with an inner `pointer-events-auto`, or they swallow
  every tap on the page beneath.
- **Item images come from `aggregator_image[kiosk]`, NEVER `entity.image_url`.**
  `image_url` is the master/HD image and on a real deployment the backend fills
  it with a generic S3 placeholder for most items (85 of 122 in the reference
  menu) — rendering it is why every card showed a grey photo glyph. The kiosk's
  own image lives in `aggregator_image[]` under the entry whose
  `aggreagtorName` (payload typo, sic) is "kiosk"; posistKiosk renders it
  everywhere via `getImageUrlFromAggregator(entity, true)`. Use
  `src/utils/entityImage.ts → resolveEntityImage(entity)` (kiosk png → kiosk
  jpg → non-placeholder `image_url` → null) at EVERY render site and keep the
  `{url && <img/>}` guard so imageless items render nothing, not a placeholder.
  Order-payload code (`useOrderHook`) correctly keeps the raw SDK resolver — it
  must return a string, so the placeholder fallback is right there.
- **Xeno is the DEFAULT loyalty branch** — the only partner discriminator in the
  tree is `partner_name.toLowerCase() === "reelo"`; `"xeno"` is never compared.
  Anything not-reelo (including a missing partner) takes the Xeno path.
- **There is NO OTP at loyalty login.** `/phone` runs `check_loyalty_balance`,
  a pure lookup returning points + redeemables in one body. The 4-digit OTP is
  per-redemption, sent by `authenticate_redemption` and verified by
  `redeem_coupon`. (Reelo's OTP is 6 digits — different flow, not built.)
- **Revoke must run BEFORE any session reset** — `checkAndRevokeLoyaltyReward`
  reads the claimed coupon from its render-time closure, which the reset wipes.
  It is a cross-origin GET to `xeno.in:2223`, so Playwright's `**/api/**`
  catch-all does NOT intercept it — route it explicitly or the fetch hangs
  (no timeout, no AbortController in the fork).
- Loyalty rewards join the menu by **top-level entity `id`** (`coupons[].products[]._id`);
  a reward whose entity lacks a price or image is dropped silently.
- `state.loyalty.claimedCoupon` is deliberately NOT persisted — a reboot mid
  redemption strands the points (fork parity, preserved).
- Gate loyalty on `getIsLoyaltyOn()` (settings AND redux), never the raw
  `isLoyaltyOn` selector — `setLoyaltyPartner` flips the redux flag by itself.
- **PDP no-session guard must navigate via `resolveCustomizationReturnPath(location.state)`**,
  never a hardcoded `/menu`: on edit commits the redux session-close flushes
  before the router transition, the guard re-fires, and a hardcoded target
  stomps the `direction:"cart"` return path (found+fixed in P7a e2e).
- VARIANT cart rows must carry `variantPrice` (billCalculation's
  calculatePriceNew reads it, not `price`) or the bill computes NaN — real
  rows from buildVariantCommitPayload always have it; hand-built test rows must too.
- Edit-from-bag preserves qty>1 (commit builders spread `...selectedEntity`
  AFTER `quantity`, so the redux entity's stepper value wins) — pinned by a
  dedicated unit test; the hook's local quantity state staying 1 is not a bug.
- **`swapCartOffer` stamps NO cart row** — item-offer discounts exist only via
  `redeemGetItem` row stamps. A fixed single-"and" freebie has
  `requiresChoice:false`, so routing it down the atomic swap realises £0;
  the choice-path gate must be the fork's literal `type:"item"+getItems`
  test, not `requiresChoice` (caught by the P7b integrator tracing the bill).
- **`emptyCart` resets `offerRemovalModal`** (session-reset hygiene in the
  reducer) — any flow that triggers the removal notice and then empties the
  cart must snapshot the modal and re-dispatch `openOfferRemovalModal` after.
- Offer UI consumes `selectFilteredOffers` ONLY (converter-resolved); offers
  whose `baseItemId`s miss the menu entityMap silently vanish — e2e mock ids
  must exist in the mocked menu.
- **`/start`'s mount owns the session teardown — never reset-then-navigate
  from a screen with guard effects (hazard H1).** RR7's `BrowserRouter` runs
  `navigate` inside `startTransition`, while redux updates render on a sync
  lane: `resetSession(); navigate("/start")` from `/cart`, `/tent`,
  `/payment`, `/forYou` or `/customization` renders the EMPTY store on the OLD
  route first, and their empty-cart / closed-session effects re-navigate to
  `/menu` — the kiosk parks on an empty menu. Exits to the splash only
  navigate; StartScreen's ref-latched mount effect revokes (Xeno) THEN runs
  `resetSession("full")`. Proven by e2e mutation (reset-before-navigate
  reproduced the empty `/menu`).
- **Every await-then-navigate/dispatch continuation needs a mounted-ref guard,
  and long async work holds idle at the SHARED hook** (`useIdleHold(active)`
  in usePayAtCounter / useLoyalty). RTK does not abort a mutation on unmount —
  a late `{data}` still arrives and, unguarded, writes the previous customer's
  points/menu/checkout into the next session (found by the P9a reviewers in
  useLoyalty, useMenuConverters, BagSheet.handlePay, SecondLayout, /phone).
  Holds are React state, never redux (a persisted hold would disable idle
  after a crash-reload) and are capped at 120 s while the transport has no
  timeout.
- **react-idle-timer ignores activity while prompted** — CONTINUE (and the
  backdrop) must call `activate()`; `disabled: true` pauses and re-enabling
  starts a FULL fresh period. Under vitest fake timers it captured the real
  timers at import: call its `createMocks()` after every `vi.useFakeTimers()`.
- **Playwright fake clock** (`page.clock.install()` BEFORE `goto`): never jump
  past the whole idle period in one `fastForward` — that skips the prompt and
  lands straight on the timeout; step 100 s then 20 s, and use `runFor` for
  1 Hz countdowns. Hold a request open by registering a parking route AFTER
  the fixture's and releasing it with `route.fallback()`.
- React 19 StrictMode in unit tests: wrapping the tree in `<StrictMode>` does
  NOT double-run mount effects — use RTL's `reactStrictMode: true` option.
- **The e2e suite is load-sensitive.** This machine is shared (load average
  often 7–8): under contention the suite runs 2–3× slower (101–119 s vs the
  normal ~40 s) and wall-clock expectations fail — P9a: `checkout.spec` 15 s
  buffer→`/receipt`; P9b: `offers.spec` locators and two `loyalty.spec`
  revoke polls (a 10 s `expect.poll` racing the revoke's own 10 s abort while
  Playwright's route dispatch is starved). Every quiet rerun is green. P9f
  harness work: wait on state, widen polls past in-app budgets, and run the
  gate with fewer workers on a busy box.
- **Classify timeouts with `isTimeoutError` (`@cx-sdk/core`), never by
  `status === "TIMEOUT_ERROR"` alone.** RTK 2.12 (TB) bounds the WHOLE request:
  a budget that expires mid-body surfaces as `PARSING_ERROR` with
  "TimeoutError: signal timed out"; RTK 2.7 (fork) bounds time-to-headers
  only. TB rethrows RTK errors as `Error(…, { cause })`, so classifiers walk
  `.cause`. A timeout status is a string — never map it to a number (504/505
  de-register the kiosk).
- **A push whose outcome is unknown is never auto-retried**
  (`isOrderPushOutcomeUnknown`: a timeout, or a 2xx whose body was lost — the
  order may exist). Only the customer's Retry resends, with the SAME order id.
- **Programmatic focus counts as idle activity** — react-idle-timer listens to
  `focus`, so an `autoFocus` dialog opening over an abandoned session restarted
  the 120 s clock. IdleGuard passes `DEFAULT_EVENTS` minus `focus` (real
  touches still fire touchstart/mousedown/keydown).
- **Playwright: chained in-app timers need stepping.** A countdown that
  re-arms its 1 s timer from a React effect after each tick (boot retry, push
  backoff) is not reliably driven by one `runFor(N)` under load — step the
  clock in small increments until the expected state appears
  (`stepClockUntil` in recovery.spec.ts).
- **ReachZone must never remount the routes.** It renders
  `{active && <brandZone/>}` then ONE container element at a fixed child
  index; only the container's inline height changes (1920 ↔ 1122). Never a
  conditional wrapper, never `key` on the mode — a remount kills the PDP
  tier-1 session, ForYou's frozen snapshot, the OrderSuccess countdown and
  scroll positions. The container uses `contain: layout paint` (the containing
  block for absolute AND fixed descendants, a stacking context, a clip) and
  deliberately NOT `overflow-hidden`: an overflow box is programmatically
  scrollable, so a `scrollIntoView` could slide the whole app inside the zone.
- **Overlay caps are mode-agnostic CSS**: `max-h-[min(<current>,calc(100%_-_96px))]`
  never binds on the 1920 stage and fits the 1122 zone in ADA, so normal mode
  stays pixel-identical and the caps follow the calibration knob.
- **Mutation testing must run in a scratch copy of `src`, never the shared
  tree** — the dev server hot-reloads every edit into running e2e pages (P9c:
  a unit agent's temporary breakages made an e2e run hang 90 s).

- **Splash media (P9d): only `{ media: { home_screen } }` is ever stored.** The
  live menu converter walks `media.banner_image_*` unguarded, so a stored banner
  key can blank `/menu`. The e2e `**/api/**` catch-all answers getMedia with
  `{}` — not a getMedia body — so nothing is stored and every spec lands on the
  WELCOME frame unless it routes getMedia AFTER the catch-all. A made-up
  cross-origin host (`https://splash-media.e2e.test`) fulfilled by `page.route`
  stands in for S3 (no DNS needed).
- **Video in tests:** Playwright's Chromium has NO H.264 — e2e video uses the
  593-byte VP8 `tests/e2e/fixtures/splash.webm` (ffmpeg command in the
  splash.spec header). jsdom has no `play/pause/load` (stub the prototype) and
  its `DOMException` is another realm (`instanceof Error` is false there, not
  in Chromium). An undecodable video track beside decodable audio (HEVC/ProRes
  + AAC) plays audio-only with no error, so the splash checks `videoWidth` at
  `loadedmetadata`; a hidden page pauses video, so the stall watchdog never
  counts hidden time.
- **Module-level rate limiters leak across tests in one file** (SplashMedia's
  report map, safeVideoPlay's budget): use distinct URLs or `vi.resetModules()`
  + a dynamic import. Vitest 5 fakes `performance.now` by default.
- **`tsc -b` type-checks NEITHER unit test files nor e2e specs**
  (`tsconfig.app.json` excludes `__tests__` / `*.test.*`; `tests/` is in no
  project). Agents type-checked them with scratch tsconfigs — wiring a real
  project is P9f.
- **Workbox regex routes match a cross-origin URL only at index 0**, so the old
  same-origin regex never cached S3 media. The image route matches
  `({ request }) => request.destination === "image"` (StaleWhileRevalidate:
  it stores opaque responses and repairs a cached error on the next load).
- **e2e mutation sandbox recipe:** rsync the repo (no node_modules/dist/.git),
  symlink `node_modules`, symlink `posistKiosk-cx-sdk` BESIDE the copy (the
  tsconfig references are relative), give the copy its own Vite `cacheDir`,
  serve it on 5399 and point a scratch Playwright config's `baseURL` there.

- **The boot commits atomically (P9e).** `LoadResourcesInitially` stages every
  write and commits them in one synchronous burst after the last await, then
  stamps `autoUpdate.lastBootAt`; a failed boot (normal or refresh) writes
  NOTHING. Any new boot step must stage-and-commit too — an inline dispatch
  reopens the mixed-state bug (empty pipelines, `deploymentInfoSettings = []`
  or payment settings wiped by a blip during a successful boot). The theme is
  the one accepted non-atomic write. The boot no longer wipes the Dexie menu
  cache (freshness = the server's `MENU_ID` / 304).
- **`lastBootAt` is the only boot-age source; a relaunch never boots.** A token
  relaunch lands on `/start`, so both stamps (`lastBootAt`,
  `lastRefreshFailedAt`) are persisted. A never-stamped store counts as STALE:
  any test that idles on `/start` ≥15 s must seed `autoUpdate/setLastBootAt`
  (via `window.__kioskStore` after rehydration) or it will refresh. Refresh
  mode never retries — a failure returns straight to `/start`.
- **Firebase only through the lazy `src/hooks/firebase/fcmRuntime.ts` chunk.**
  `chunkRecovery` skips failures matching `/fcmRuntime/` (a failed FCM chunk
  must never reload the kiosk mid-order); renaming the file silently restores
  the reload. FCM never calls `Notification.requestPermission`.
- **D2 is keyed by RTK endpoint name** (`BACKGROUND_TELEMETRY_ENDPOINTS`, with a
  `satisfies keyof autoUpdateApi.endpoints` guard); the fork passes nothing.
- **Workflow agents all stalling at once = an API/network outage, not the
  code** (2026-10-05 20:40 → after 23:37: every retry produced only its
  opening setup). Recover from the workflow journal and the agent transcripts;
  completed agents' work is already in the tree.
- **Parallel worktree lanes:** a lane is a `git worktree` created BESIDE this
  repo (`../tb-<lane>`) so `link:../posistKiosk-cx-sdk/packages/*` resolves;
  it needs its own `yarn install` and runs e2e with `TB_E2E_PORT=537x`
  (`tests/e2e/fixtures/origin.ts`; never 5173/5273). All lanes share ONE SDK
  checkout: SDK edits happen only in a lane's build stage, additive, in files
  no other lane touches — every lane's dev server hot-reloads them.

## Session log

- **2026-10-06 (P9e)** · **Updates apply only at the splash.** Re-baselined
  2026-10-05 by a 3-reader workflow against the post-P9a–d code, then a 9-agent
  build workflow (foundation → 4 builders → integrate → adversarial review ×2 →
  fix). **SDK (additive, fork byte-identical — 594-file checksum and a 488-row
  recovery A/B on RTK 2.7 + 2.12):** `updatePolicy` gains the splash/boot-age
  helpers (`resolveSplashUpdateAction`, `isBootDataStale`,
  `msUntilScheduledRefresh`, `extractBrandUpdateId`) and the autoUpdate slice
  `lastBootAt` / `lastRefreshFailedAt`; `configureKioskTransport()` gains the
  opt-in `recoveryExemptEndpoints` (D2). **TB:** the stage→commit boot,
  `LoadingResources` refresh mode (failure → straight back to `/start`), the
  splash apply machine + `UpdateCountdownModal`, Activity Center "Reload
  resources" + "Data loaded", the hardened `useAutoUpdate` (retries, analytics
  instead of `console.error`, synchronous flag drop, success-only version
  record), the token-gated version report, FCM (`useFcmRegistration` + the lazy
  `fcmRuntime` chunk + the dependency-free relay SW `public/firebase-messaging-sw.js`).
  **Found and fixed:** a failed brand refresh dropped the push for ~6 h after
  acking it; every refresh wiped the menu cache; `discountOnAddon` was not
  persisted (pre-existing — reset by every reload); every VITE_* value was
  inlined into the entry chunk by the FCM env fallback; a slow first FCM token
  was thrown away; a failed FCM chunk would have reloaded the kiosk mid-order
  (chunkRecovery exemption); the refresh-failure stamp is now persisted so a
  reload cannot drop the 30 min retry. **Tests:** unit 911→1,216 (+305; the
  two unit authors ran 102 deliberate breakages, 100 caught, 1 equivalent,
  1 over-specified assertion dropped), e2e 90→119 (`autoUpdate.spec.ts` 22,
  `fcm.spec.ts` 5 incl. a real-Firebase `onMessage` path via the DEV-only
  `__TB_FCM_ENV__` seam). The test stage's e2e author and mutation verifiers
  were cut off by an API outage (2026-10-05 ~20:40 → 23:37); the e2e specs
  that landed pass; the e2e mutation check ran afterwards on main: 58 mutations, 57 killed, 1 equivalent — 6 killed only after strengthening (new tests: a brand push never applies mid-order; a failed operator reload returns on the old data), e2e 119→121. Bundle 1,608→1,663.6
  KB (firebase is a separate 47.8 KB lazy chunk). Lanes prepared: the e2e
  port is parameterised (`TB_E2E_PORT`) for parallel worktrees.

- **2026-10-05 (P9d)** · **Splash media pipeline + the uncertain-order refund
  skip.** Built 2026-10-01 by a 9-agent workflow (build ×3: media pipeline /
  splash UI / S7 → integrate → adversarial review ×2 → fix); its TEST stage
  died (agents stalled for days, then the API became unreachable) and the
  tracker was never updated, so this session recovered the run from the
  workflow journal and the agent transcripts (the old session scratchpad,
  holding the P9 contracts, had been wiped — all 23 files were rebuilt from
  the transcripts' Write calls) and re-ran the test stage as a 6-agent
  workflow (authors ×3 → mutation verifiers ×3). **SDK:**
  `@cx-sdk/catalog/media/splashMedia` (pure, total: `pickHomeScreenMedia` —
  deployment scope fails CLOSED on a malformed `deployments`, the last root
  wins; `toSplashSlides` — dwell ≥3 s else 8 s capped at 1 h, video by
  media_type or URL path). **TB:** `loadSplashMedia` boot step (never
  throws, keeps last-known media, stores ONLY `{ media: { home_screen } }`),
  `StartScreen/SplashMedia` (layout by playable count, ≤3 media elements and
  1 video, 15 s stall watchdog that ignores hidden time, `no_video` for
  audio-only codecs, failure events rate-limited per url|kind per hour),
  the `ErrorBoundary` `fallback` prop (a decorative crash shows WELCOME in
  place), `safeVideoPlay` (fork verbatim), the Workbox image route by request
  destination, and S7: an outcome-unknown push marks the claimed reward (only
  when its row rode in the push) and every revoke path skips the refund and
  hands the ids to staff. The 1:2184 poster and `poster-taco.jpg` are gone.
  **Reviewers' fixes (2026-10-01):** a claim marked although its row had left
  the cart (refund withheld for nothing), no reconciliation record if the
  kiosk crashed before /start, audio-only video showing a blank card forever,
  a string `deployments` showing a store-scoped promo fleet-wide, unbounded
  splash failure events, and a display sleeping overnight failing every video.
  **Tests:** unit 769→911 (+142, incl. the 66-test SDK-engine file the first
  test agent wrote before it stalled: SplashMedia, safeVideoPlay, the SDK engine,
  ErrorBoundary fallback, StartScreen, the boot media step incl. the getMedia
  network leak in useLoaders.test, S7 across usePayAtCounter / useLoyalty /
  the real pushOrder), e2e 81→90 (`splash.spec.ts`: no media, full-bleed +
  relaunch from the persisted list, carousel rotation, 404 degrade, deployment
  scope, WebM video; S7 end to end: a timed-out push sends NO undo, a clean
  5xx sends exactly one). Mutation-verified in scratch copies: unit 174/176
  killed (2 equivalent), e2e 19/19 — 13 killed only after strengthening.
  P9e was re-baselined against the post-P9a–d code by a 3-reader workflow
  (contracts in the session scratchpad) and two user decisions taken (boot-data
  refresh: scheduled; telemetry: opt-in exemption — see open decisions).

- **2026-10-01 (P9c)** · **ADA reach-zone view.** 9-agent workflow (build ×3:
  shell / overlays / frameless pages → integrate → adversarial review ×2 →
  fix → unit + e2e authors; gates run directly). Figma 1:5392/1:5413/1:5445
  turned out to be a REACH-ZONE design, not a scaled view: the same components
  at the same size inside a 1080×1122 panel under a 798 px brand zone. Built
  `components/stage/ReachZone` (stable tree, exempt routes `/`,
  `/LoadingResources`, `/start`, brand-zone exit with a 500 ms double-tap
  guard, Selected/Deselected analytics per flip), `useAdaActive`, the `ADA_*`
  constants, the tenant gate + `aria-pressed` on the footer toggle, a
  `typeof === "boolean"` guard on `accessibility_mode`, the bag at 765 px,
  mode-agnostic caps on ~10 sheets/modals, the loyalty rewards auto-dismiss off
  in ADA (WCAG 2.2.1, latched at open), ForYou capacity from stage constants
  (16 / 8), and the PDP Footer-bottom strip (in Figma, missing in TB; its
  CANCEL ORDER only navigates — hazard H1). 7 frameless screens got
  design-language ADA re-flows (sign-off list in open decisions). Reviewers
  found: Tent's ADA error banner only aligned at the 798 calibration, a
  texture seam on `/second`, and a double tap on the brand zone also tapping
  the page beneath — all fixed. Unit 703→769 (+66, 33 deliberate breakages
  caught), e2e 73→81 (`ada.spec.ts`: reachability sweep on every in-session
  screen and overlay, bag geometry, exit guard, no remount on toggle, cancel /
  idle end ADA, tenant gate, WCAG timer).

- **2026-10-01 (P9b)** · **Rule 2 hardening — every request is now bounded.**
  9-agent workflow (build ×3 → integrate → adversarial review ×2 → fix →
  unit + e2e authors; gates run directly). **Money bug fixed first (P7c
  regression):** a transport failure on `redeem_coupon` was read as SUCCESS
  — `finalLoyaltyRedemption` wrapped `infoForClaim` around an empty body, so
  the customer got the free reward row, the claim, and the points deduction
  without Xeno confirming; the sheet now also requires `status_code === 200`
  (fork parity). **SDK:** `configureKioskTransport()` gained opt-in
  `requestTimeoutMs` / `endpointTimeoutsMs` (TB: 10 s, `getMenu` 30 s; the
  fork configures nothing and was A/B-proven byte-identical on both RTK
  versions), `isTimeoutError` (TIMEOUT_ERROR, RTK 2.12's mid-body
  PARSING_ERROR, `.cause` chains), `isOrderPushOutcomeUnknown` +
  `shouldRetryOrderPush` (a timed-out push, or a 2xx whose body was lost, is
  NEVER auto-retried — uncertain-copy order-error panel, Retry reuses the same
  order id; clean 5xx keep the 4-attempt ladder), auth copy for timeouts.
  **Recovery surfaces** on one Figma-backed `ErrorModal` (1:3427 → Icon Modal
  1:988 + warning icon 1:990): menu-load failure keeps the guest on `/second`
  with TRY AGAIN (was a permanent "Menu is loading…"); `/menu` refetches on a
  reload with no menu; `/LoadingResources` shows categorised translated errors
  and auto-retries 10 → 30 → 60 s then every 60 s, on reconnect, or TRY AGAIN
  NOW ("Back to registration" removed — it landed on an un-booted splash);
  `ErrorBoundary` is translated, recovers to `/start` after 10 s (to a fresh
  boot after 60 s when the crash is within a minute of load — no storage) and
  START OVER works offline. **Loyalty boot degrades** (user decision): a dead
  partner no longer blocks boot; the splash retries it once per visit; the
  Activity Center shows "Unavailable". Xeno revoke bounded at 10 s, never
  retried, one in flight per claim, ids in its analytics. **Found by the e2e
  author and fixed:** the new modal's `autoFocus` restarted the idle timer
  (IdleGuard now ignores `focus` events). Node pin bumped to 22 LTS (user
  decision) — `yarn validate` is green end-to-end for the first time.
  Unit 504→703 (+199, 34 deliberate breakages each caught), e2e 65→73
  (`recovery.spec.ts`: menu 500 / menu hang / boot retry / loyalty down /
  push timeout = exactly one request / push 5xx ladder / redeem timeout grants
  nothing / offline).

- **2026-10-01 (P9a)** · **Idle timeout + session integrity.** P9 was first
  mapped by an 8-reader read-only workflow (fork contracts, TB gaps, Figma
  pulls for idle/splash/ADA, test + bundle gap analysis), then P9a ran as a
  9-agent workflow (build ×2 → integrate → adversarial review ×2 → fix →
  unit + e2e authors; the gate agent stalled 6× again on long suite commands,
  so the gates ran directly). Built: `routes/IdleGuard` (pathless layout
  route around every in-session screen — one react-idle-timer, the library is
  the only clock), `components/common/IdleTimeoutModal` (Figma 1:4514; the
  START AGAIN "Loading" fill IS the countdown), `hooks/utils/useIdleTimeout`
  (`resolveIdleSeconds` — Rule 1 as a ceiling, `useIdleHold` with a 120 s
  cap). **Found by the trace and fixed:** TB's `/start` never reset the
  session (the fork's does), so the `/second` and `/phone` footer cancels
  leaked language, ADA, loyalty identity and — from `/phone` at checkout — the
  whole cart into the next session; the language never returned to English
  after a reset; the global error flag survived resets; boot threw on a
  missing `ideal_time`. **Found by the reviewers and fixed:** late loyalty
  lookups, menu fetches and PAY preflights writing into the NEXT customer's
  session after an idle exit, and the hold cap leaving `/orderSuccess`
  exposed to a stale idle period. Fork idle defects not ported: prompt at
  half time (reset at 65 s for `ideal_time` 120), three clocks, a 10 s
  warning (WCAG needs 20 s), teardown from an untracked `setTimeout`.
  Unit 422→504 (+82 incl. 20 deliberate breakages each caught), e2e 53→65
  (idle timeout, CONTINUE, H1 regression from `/cart`, START AGAIN, splash
  never prompts, push hold + hold cap, Arabic→English, exactly-one revoke,
  three late-result guards). Correction: guardrails reports 197 warnings
  (0 critical), not the "single warning" the P7c entry recorded.

- **2026-10-01 (P8a)** · **Checkout → PAY AT COUNTER → order push → Order
  Complete.** The `/checkout` stub is gone; the four preflight routes now land
  on real screens: `/tent` (frame 1:4447 — the map had it as "Served at table"
  and as frameless; reuses the P7c numpad), `/payment` (1:3364, COD tile gated
  by `checkIfCODAvailable`, card tile visibly disabled), `/receipt` (1:3377,
  EMAIL inert — no payload contract), `/orderSuccess` (1:5932 guest / 1:3437
  logged-in, last-5 order number, Start Over → full reset → /start · Place New
  Order → nextCustomer reset → /second). One push path serves both
  pay-at-counter and the zero-bill loyalty `directOrder` case.
  **Three ORIG defects fixed rather than reproduced**, each a kiosk-rule
  violation: the tent screen trapped the customer forever when
  `tent_number_range` was unconfigured; the push failure path only
  `console.error`d and stranded them on a dead modal (now the SDK retry ladder
  + an explicit Retry / Back-to-bag terminal state); the print once-guard was
  broken and the fetch had neither timeout nor catch.
  **Found during gating** (see engineering notes): joining the deployment-info
  fetch to boot made the bag throw on every cart change via the SDK's unguarded
  `hasSetting` — fixed by normalising the stored value to an array.
  The workflow's gate agent stalled after applying its fixes, so the gates and
  the safety audit were run directly: no ws://, no terminal ports, no gateway
  imports — every such string in `src/` is a comment recording what is
  deliberately absent. Unit 311→422, e2e 43→53.

- **2026-09-30 (P7d)** · **P7 COMPLETE.** Three pieces. (1) **MIAM re-skin** —
  discovered Figma node 1:3070 (mapped in our docs as the pre-cart upsell) is
  actually the Make It A Meal prompt, which P6c had built design-language and
  flagged. Re-skinned to the frame: 680px card, grey meal panel (yellow SAVE
  badge, 285px image, name, `£x | N Cal`) over a white panel with the purple
  headline and two stacked CTAs; per-card CTA strip and description removed;
  `miam.decline` copy → "Not today". Behaviour untouched. (2) **`/forYou`** —
  ported the fork screen (design-language, no frame exists): capacity-bounded
  grid (16 at 1080×1920, 8 in a11y) frozen on mount, flip button, back link
  that does NOT mark seen, redux baseline that survives a customization detour,
  `addEntity(..., {returnPath:"/forYou"})`. The suggestion card was EXTRACTED
  from the bag rail into `components/cart/ForYouCard.tsx` so both surfaces
  share one component. Menu's VIEW MY BAG now runs the three-factor gate
  (units, not rows) and emits CartUpsellViewed/Suppressed/Skipped. (3) **Overlay
  hoist** — MIAM + repeat sheet moved out of the Menu page to an
  `InSessionOverlays` layout route, fixing dead taps on /forYou (see
  engineering notes). Gate agents earned their keep twice: one rejected a
  proposed e2e fix that would have disabled the in-bag rail along with the
  interstitial (fixed the shared `openBag` helper instead), the other
  re-derived the whole z-stack from source before accepting the hoist.
  Unit 239→311, e2e 37→43.

- **2026-09-30 (fix: kiosk images)** · User reported placeholder glyphs instead
  of item images on a real (Taco Bell) deployment. Root cause: every TB surface
  bound `entity.image_url`, which the backend sets to a generic S3 placeholder
  for most items, while the kiosk's real image lives in
  `aggregator_image[kiosk]` (what the fork renders). Added
  `src/utils/entityImage.ts` and swapped **21 render sites across 13
  components** (menu hero/grid cards, PDP hero + option + stepper + variant
  tiles, size modal, added modal, pack slot + slot sheet, tier-2 sheet, MIAM
  prompt, bag rows, Complete-Your-Meal rail, offers suggested rail, freebie
  picker, loyalty reward tiles). Items with no kiosk image now fall to their
  existing grey spacer instead of a broken-looking glyph. Unit 218→239 (16
  resolver contract tests + 5 render pins incl. the exact reported case);
  e2e 37/37 unchanged; build green; gates passed first attempt.

- **2026-09-30 (P7c)** · **Xeno loyalty LIVE** — 9-agent workflow (build ×5 →
  integrate → tests ×2 → gate), replicating the fork's Xeno integration per
  user directive. Boot: `getLoyaltyPartner` step (placed INSIDE the boot
  try/catch — divergence: a dead loyalty proxy now shows the error screen
  instead of silently booting loyalty-off; see open decisions). `/phone`
  lookup screen + new `KioskNumpad` (Figma 1:4174 key treatment) + skip rules;
  `/customerName` with prefill. Rewards surface: login modal (SCAN APP inert),
  `LoyaltyRewardsSheet` (tiles joined from `selectCoupons`, points header, the
  `validate_coupon` → `authenticate_redemption` → 4-digit OTP → `redeem_coupon`
  chain with the fork's exact success dispatch sequence, auto-dismiss timer),
  REWARDS INCOMING interstitial (1:4079), error modal (1:3786), MY REWARDS (n)
  CTA (1:3956). Cart: Free/`{v}% off` chip + struck price + no stepper +
  out-of-stock-only Remove (refund + revoke), auto-reversal when the last paid
  row leaves. Revoke wired before `resetSession("full")` at cancel-order.
  Fixed two fork bugs deliberately: the dropped `redeemItem` return (a
  customizable reward was priced then thrown away) and a customization group
  keyed `"undefined"` (read `.id` on objects carrying `_id`) — both pinned by
  tests. Failure detection upgraded to `getLoyaltyRedemptionError`. Unit
  155→218, e2e 28→37. Gate needed zero fixes. NOTE: guardrails now reports 1
  non-critical warning — the fork-verbatim direct `fetch()` in the Xeno revoke
  (hard-coded `xeno.in:2223`, no timeout/AbortController); it is the one call
  that cannot ride the RTK transport. Wrapping it in `withTimeoutRetry` from
  `@cx-sdk/core` would clear the warning and satisfy Rule 2 — deliberately not
  done in P7c to keep the Xeno flow byte-faithful; flagged for sign-off.

- **2026-09-30 (P7b)** · **Offers vertical LIVE** — 8-agent workflow (build ×4 →
  integrate → tests ×2; the gate agent stalled 6× on the runner so the gates
  ran inline afterwards — all green). Ports: useOfferSavings (bill-probe
  ranking; candidate priced via getCalculatedBill({...cart, cartOffer:
  candidate})) + offerScopeCopy, verbatim. RewardsSheet + OfferRow per Figma
  reward-states 1:3824/1:3858/1:3924 adapted to CX mechanics (radio + SAVE
  SELECTION; sections via sectionRankedOffers; pink minBill/minItems nudges
  via lockedGapPresentation; suggested-items rail from the cart-upsell pool
  when the top locked offer is minBill-gapped). useOfferApply implements the
  fork's Cart.tsx recipes (atomic swapCartOffer w/ freebie sweep, direct
  apply, picker commit via redeemGetItem→addGetItemToCart, cart-driven
  removal + notice). FreebiePickerSheet (plain entities; customizable rows
  disabled "coming soon") + OfferRemovalNotice. BagSheet: Rewards entry/
  applied rows (1:3137), signed Discounts line, ORDER & PAY flip, six-check
  revalidation + reconcileFreebieAllocation. Fixture: 4 mock offers
  (percent-w/-minBill, flat £2, atomic freebie, OR-picker freebie) with
  verified fixture ids + VAT/round-off math. Integrator caught two real
  hazards (see engineering notes: swap-stamps-no-row £0 freebie; emptyCart
  wipes the removal notice); e2e agent fixed the inert applied-row (sheet was
  unreachable while an offer was applied). Unit 115→155, e2e 21→28.

- **2026-09-29 (P7a)** · **My Bag vertical LIVE** — 9-agent workflow (build ×5 →
  integrate → tests ×2 → gate) over an audited fork contract
  (cart.slice/useCartHook/bill/checkoutPreflight/useSessionReset/Dexie).
  Bag = sheet over the menu, route-driven `/cart` (Figma 1:3171/1:3236/1:3270):
  BagSheet+BagItemRow (consolidateGetItemsForDisplay rows, getAllCustomizationList
  addon lines w/ +£, steppers via IncreaseItemQuantityById/decreaseItemQuantityById,
  contract-B1 edit recipe, bill via getCalculatedBill → getSubtotal/getNetAmount +
  setAmount mirror, empty-cart auto-exit, PAY preflight → /checkout stub);
  RemoveItemModal (1:4533) intercepts qty-1 deletes; CancelOrderModal (1:4552) →
  useSessionReset("full") port; Dexie crash-recovery rehydrate in AppRoutes
  (syncCartOnReLoad — reset landed FIRST so no cross-customer leak);
  RepeatItemSheet on the repeat intent; CompleteYourMealRail
  (cartUpsellEngine + ported px-capacity layer, isCartRecommended source);
  PDP edit mode (openType "edit" seeds, UPDATE CTA, no default reseed);
  ProductAddedModal gains VIEW MY BAG + a real total (setAmount fix); tb-red
  token. E2e agent found+fixed the guard race (see engineering note) and the
  gate updated pack.spec's now-stale second-tap block (repeat sheet wins over
  MIAM re-prompt — intended). Flagged bug "edit collapses qty>1 to 1" was
  DISPROVEN by a repro test (spread order rescues it) — test kept as a pin.
  Unit 67→115, e2e 13→21 (bag basics, remove-confirm, edit, repeat,
  cancel-order teardown incl. Dexie, crash recovery via reload, rail, PAY).

- **2026-09-29 (P6c)** · **P6 COMPLETE** — Order-a-Pack/BYO + MIAM shipped via
  8-agent workflow (build ×4 → integrate → tests ×2 → gate): pack `_combo`
  min1/max1 groups render as PackSlotCard grid (Figma 1:4590/1:4641) with one
  SlotSelectionSheet (1:4761/1:4692 — Included/Upgrades, radio, per-item
  Customize link when `findAppropriateVariantForSelectedItem` non-empty);
  Customize → Tier2CustomizationSheet (fork CustomizationTier2 contract:
  `setTeir2SelectedEntity`/`openTier2EditModal` in, `appendTier2SelectionToTier1`
  / `replaceTier2SelectionInTier1` → `addTier2CustomizationsToTier1` out,
  `scrollCustomizableItem2` autoscroll, discard-confirm via
  `shouldPromptTier2CloseConfirmation`); required-nested picks auto-open tier-2
  on slot SAVE; BYO-shaped `_combo` (min≠1/max≠1) stays on the classic
  grid/stepper path. MIAM: menu `upsell` intent now routes through
  `addEntity` → `openMakeItAMealModal`; MakeItAMealPrompt (design-language, no
  frame) accepts into `openDoubleTierModal` and declines by original-item shape
  + blacklist. Fixture: Dream box Sides→Large Fries (tier-2 capable), BYO
  Snacks group, Cheese Burger upsellItems; e2e mocks need top-level
  `enable_combo_upsell` in get_kiosk_settings (grid flag not needed — classifier
  ignores it). i18n: 17 keys (pack/miam/pdp discard+limits) EN+AR. Caught by
  e2e agent: tb-modal-enter displaced the tier-2 sheet (fixed with scoped
  keyframes; engineering note added). Unit 35→67, e2e 9→13 (pack flow £25
  commit incl. tier-2 Without Salt, empty-slot validation ring, MIAM
  decline £8 + repeat-intent re-tap, MIAM accept into pack).

- **2026-09-29 (P6b)** · PDP/customization LIVE: consumption contract mapped
  by Explore agent (key: CustomizationTier1 is the real binding — Redux-owned
  selections via setTier1SelectedCustomization action, tier-1 session gates
  min/max counting, scroll-container id contract, commit = no-arg
  addCustomizationToCart → closeModalStates → location.state return path).
  pages/Customization rebuilt per Figma PDP frames (hero/qty/desc, all groups
  in one scroll: single-select & toggle cards, multiPunch steppers, variant
  picker inline, Required + errored ring, ADD TO BAG w/ live
  getTotalValueWithApplyAddonPrice total). Menu detours now open the real
  tier-1 session (openDoubleTierModal); variant card-tap → PDP, quick-add "+"
  → Select-a-Size fast lane. E2E: Cheese Burger 3 real groups → +Extra
  Pickles £8→£9 → qty 2 £18 → commit → added-modal → bag(1) £9.00. Gates:
  35/35 unit · 9/9 e2e.

- **2026-09-29** · Keyboard redesigned per user report to the Figma Email
  Receipt spec (1:3383): chunky purple/grey keys (black 2px/5px borders),
  40px bold glyphs, QWERTY + single-shot shift + 123 symbol layer + GO;
  Registration input restyled to the design field (white, vibrant border,
  clear-X). All specs updated (digits behind the 123 layer). Docs:
  FIGMA_UI_GUIDE.md created (full node map + pull process) and linked from
  CLAUDE.md/PROGRESS. Dev server detached via nohup on port **5473**
  (session-kill-proof; 5373 stays the configured/Playwright port).

- **2026-09-25** · P0 scaffold green · P1 shell + Figma splash + fonts/tokens ·
  P3 registration/boot/auto-logout (mocked + live 401 demo) · P4 order-type +
  ticker + footer + language sheet · P5 menu UI + hook-vertical port (workflow
  agent) + real-converter e2e · SDK interop fixes verified against the fork.
- **2026-09-28** · Activity Center (3s top-left hold) built per user spec +
  framer/translate bugfixes · this tracker created.
- **2026-09-28 (later)** · **P6a DONE**: customization vertical ported by
  workflow (12 files: useCustomization 2,059 + useMakeItAMeal + useAddEntityToCart
  + transitive useLoyalty/useOrderHook/useOrderIndexDb — P7/P8 head start;
  tsconfig gained allowJs/checkJs:false for SDK billCalculation.js). Menu cards
  wired through classifyAddIntent: add→cart (re-add increments via explicit
  IncreaseItemQuantityById — the reducer's itemType/type merge quirk), variant→
  SelectSizeModal→ VARIANT row w/ total_price, modifiers/repeat/upsell→
  /customization placeholder (P6b). ProductAddedModal + SelectSizeModal +
  CTA bar live off cart.cartItems/subTotal. E2E proves add→£17→increment→£34→
  modifier-item→customization. Fixed en route: CTA read wrong slice fields
  (cartItems not cart; subTotal not netAmount); react-hooks/static-components
  on inline Radio. Gates: 34/34 unit · 8/8 e2e · build green.
