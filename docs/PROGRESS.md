# Taco Bell Kiosk — Build Tracker

> **The living status doc for this project.** Updated at the end of every
> work step — if you finish (or descope) anything, update this file in the
> same change. Plan reference: the approved phase plan (P0–P9); UI source of
> truth: Figma `33e5briUYJiBqxv6P0AbqY`; logic source of truth:
> `@cx-sdk/*` (linked from `../posistKiosk-cx-sdk/packages`).
>
> Last updated: **2026-10-07 (bag-pdp + loyalty-visual merged)** · Gates at last update (Node 22.14):
> **`yarn validate` green (tsc -b type-checks unit tests + e2e specs) · unit 2,506/2,506 · e2e 304/304 · guardrails 0 critical / 164 warnings · build+PWA green · boot path 350.6 KiB gzip-9 / 355 (CI build 351.8) · page JS 1,337.3 KB / 2,000 · fork app `tsc -b` green**

## Phase status

| Phase | Scope | Status |
|---|---|---|
| P0 | Scaffold: Vite 8 / React 19.3 / TS 5.9 / Tailwind 4, cross-repo @cx-sdk link, all gates wired (tsc, strict ESLint, depcruise-in-validate, guardrails, CI, CLAUDE.md) | ✅ done |
| P1 | App shell: createKioskStore + persistence manifest (19 SDK + 6 UI slices + RTKQ), transport + 401/5xx session recovery, analytics port, Dexie, chunkRecovery, hardening, router+guards, PWAUpdateHandler, Figma splash | ✅ done |
| P2 | Design system: folded into per-screen work (tokens `tb-*`, fonts, KioskStage, chrome components built as screens landed) | ✅ absorbed |
| P3 | Auth + boot: Registration (license→authApi), LoadingResources (language→skin→pipelines→theme→settings), stale-token 401 → auto-logout | ✅ done |
| P4 | Order type: pipeline cards + open/closed states, daypart ticker, footer bar, language sheet (EN↔AR text switch — Arabic renders as RTL text runs inside the LTR layout since P9f) | ✅ done |
| P5 | Menu: category rail, hero/grid cards, price+cal, UNAVAILABLE, TOTAL/VIEW MY BAG bar; hook vertical ported (~3.2k lines); real fetchMenu→converter e2e over StandardMenu fixture | ✅ done |
| — | Activity Center: hidden 3s top-left hold on splash → operator diagnostics (info rows, passcode-gated fullscreen toggle, logout) | ✅ done |
| P6 | PDP/customization — **P6a ✅** quick-add spine · **P6b ✅** PDP bound to useCustomization Tier1-style (all groups one Figma scroll, defaults seeded, min/max via commit, VARIANT+CUSTOMIZABLE commits, return-path navigation) · **P6c ✅** Order-a-Pack slot cards + SELECT sheets, tier-2 nested customize, BYO via generic group path, MIAM upsell prompt · repeat-sheet → P7 | ✅ done |
| P7 | Cart + Offers + Loyalty + ForYou — **P7a ✅** My Bag sheet over /menu (route-driven /cart): rows w/ addon lines + steppers, remove-confirm + cancel-order modals (session reset), edit-from-bag (PDP edit mode), repeat sheet, Complete-Your-Meal rail (cart-upsell engine), checkout preflight → /checkout stub, Dexie crash-recovery rehydrate · **P7b ✅** Rewards/offers sheet (Figma reward-states adapted to CX mechanics), apply/swap/remove cores, freebie flows (atomic + picker), bill Discounts line + ORDER & PAY, six-check revalidation + removal notice · **P7c ✅** Xeno loyalty replicated from the fork (boot partner fetch, /phone lookup, rewards sheet + 4-digit OTP redemption chain, loyalty cart rows, revoke-before-reset, auto-reversal, /customerName) · **P7d ✅** MIAM prompt re-skinned to its real frame (1:3070) + `/forYou` pre-cart upsell (capacity-bounded grid, session-seen gate, detour-safe baseline) + overlays hoisted to the routes level | ✅ done |
| P8 | Checkout + Payment + Success — **P8a ✅** real route fan-out (/tent, /payment, /receipt, /orderSuccess) replacing the stub, PAY AT COUNTER end-to-end with a hardened retry ladder, order push, Order Complete + gated print · **P8b ✅** Paytm Dynamic QR + Paytm EDC (user decision 2026-10-05; India / IST / ₹): backend-placed orders, `/paymentPolling` settlement on a pure SDK reducer, reload resume with the SAME ids, `/start` release, Figma 1:3404 / 1:4456 / 1:3427, the DQR QR via `react-qr-code@2.0.15` in a lazy chunk — merged 2026-10-07 from the `p8b-paytm` lane; a live terminal + real UPI run is still owed (P8b-17) | ✅ done |
| P9 | Close-out, mapped 2026-10-01 by an 8-reader workflow (contracts in the session scratchpad, summarised below) — **P9a ✅** idle timeout (Figma 1:4514: IdleGuard + IdleTimeoutModal, holds, ≤120 s) + `/start` owns the session teardown + late-async guards · **P9b ✅** Rule 2 hardening: redeem-failure money fix, host-configured SDK timeout (TB 10 s / menu 30 s), timed-out pushes never auto-retried, menu-load error + Retry, boot auto-retry, ErrorBoundary recovery, loyalty boot degrade, Xeno revoke bounded · **P9c ✅** ADA reach-zone view (1:5392/1:5413/1:5445; stable-tree ReachZone, overlay caps, PDP footer strip, WCAG 2.2.1 timer off in ADA) + design-language re-flows of 7 frameless screens · **P9d ✅** splash media pipeline (getMedia `home_screen` → WELCOME 1:5617 when none / full-bleed 1:5604 / carousel 1:2203, slides that fail or stall are skipped) + the uncertain-order refund skip (S7) · **P9e ✅** updates apply only at the splash (whole-app reload / FCM brand refresh / a SCHEDULED boot refresh when the data is >6 h old, 15 s untouched + a 5 s countdown) + Activity Center Reload resources + an atomic boot commit + the telemetry recovery exemption (D2) + the hardened update hook + FCM (lazy, config- and permission-gated, never prompts) · **P9f 🔄** app half ✅ (Arabic RTL text via FSI/PDI isolates, a11y fixes, lazy PostHog + framer-motion removed, fail-closed boot-path budget, type-checked tests, per-PR CI e2e job — merged 2026-10-06 from the `p9f-app` lane); the shared e2e harness + page objects + the missing rulebook flows + the axe sweep 🔲 (runs last, on main) · proximity welcome ⏸ deferred (see open decisions) | 🔄 |

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
**Paytm (P8b):** `/payment` adds PAY WITH CARD BELOW (EDC) and PAY WITH UPI QR
(DQR) when configured; a tile only arms ⇒ `/receipt` initiates (ids stored and
flushed first) ⇒ `/paymentPolling` settles by status (EDC instructions or the
QR, countdown, CANCEL, not-paid / unknown staff panels) ⇒ paid ⇒ Order Complete.
A reload resumes the SAME ids; `/start` releases an open session; idle is held (≤240 s).
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
Language switch EN↔العربية anywhere via the footer (RTL text, LTR layout — P9f).
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

- "Apply to the following burrito" slot-copy toggle (Figma 1:4641, item 21):
  ⛔ BLOCKED on backend data (bag-pdp, 2026-10-07) — no payload models repeated
  bundles: within a pack no two `_combo` groups share an option set (0 of the
  27 multi-slot reference items), because a product repeated across slots is a
  separate entity ("Pepsi Small" vs "Pepsi Small."), so nothing is built (never
  guessed from names); proposal §10 (`bundleKey` / `bundleIndex` + shared
  constituent ids)
- ~~EAT IN / TAKE OUT toggle in the bag is READ-ONLY~~ ✅ bag-pdp (item 19,
  merged 2026-10-07): the in-bag switch — confirm → in-flight overlay (idle
  held, every request bounded) → failure (TRY AGAIN / BACK, nothing changed) or
  ONE commit. The target tab's charges, menu, out-of-stock, offers and DP are
  fetched with every write staged; the commit applies /second's selection,
  re-prices the bag (a size row's own size list too), removes rows the tab
  can't serve and names them in a notice that survives the empty-cart exit,
  reverses loyalty rewards it can't serve (refund + revoke; kept rewards are
  not re-priced), clears the tent number and re-checks the offer (D1a / D1b /
  D1c). Refused, with nothing written, past the target DP session's
  `maxQtyItem`; disabled with one order type, a closed / deactivated target or
  while PAY runs
- ~~Edit-quantity numpad modal for multi-qty rows~~ ✅ bag-pdp (item 20): the
  Figma 1:4460 SPLIT edit ("Choose how many you want to edit";
  `EditHowManyModal` + KioskNumpad, opened inside the bag) — edit k of a row's
  N units: k = N is the whole-row edit as before and qty-1 rows edit directly;
  the same recipe at PDP qty q ≠ k merges back (`N − k + q`), q = k is a noop,
  any other change splits off a new row after the source; one write (SDK
  `planSplitEditCommit` on the live cart); a DP-cap rejection is silent and
  keeps the PDP open. A size change now sticks, whole-row or split
  (`buildVariantEditCommitPayload`)
- ~~Cart recommendations S3 source~~ ✅ post-P9 29a (menu-data lane) — the tenant
  S3 map behind `VITE_TENANT_RECOMMENDATIONS_URL` (empty = off), Dexie +
  memory only; the bag rail prefers it, falling back to isCartRecommended
- Loyalty deferred set (P7 later / P8): Reelo partner path entirely
  (CartRewardsCard, points-redemption modals, `redeem_points`), SCAN APP tab
  (renders inert — no scanner integration), resend-OTP (no fork endpoint),
  and the fork's dead `/verify` + `/loyalty` pages (the zero-bill
  `shouldPlaceLoyaltyOrderDirectly` push landed in P8a). Reelo is not ported
  (user decision 2026-10-05: Xeno only)
- Loyalty reward states ✅ loyalty-visual (item 39a, merged 2026-10-07): the
  Xeno REWARDS sheet on the 1:3842 / 1:3948 geometry with an out-of-stock
  reward in the 1:3858 "ineligible" look, the offer sheet aligned to it (D2),
  the fork's offer lock while a reward is in the bag (D3), the offer row's own
  saving (F1). ⛔ BLOCKED on backend data (Xeno sends none of it; proposal §12):
  the "Expires …" line, per-reward eligibility (the "Add £X+" nudge + the
  "Suggested £X+ Items" rail) and order-level rewards ("£4 Off Order"). Not
  built by decision: a has-rewards card for Xeno (D1 = A — the reward stays an
  item row). Log only (F4, fork parity): a non-percentage Xeno coupon keeps its
  full price but shows "Free"
- Offers set ✅ post-P9 (offers lane, merged 2026-10-07): the BOGO buy stage,
  customizable freebies (OfferTierHost), exact group-wise picks, the
  celebration, auto-apply (operator-flagged). ⛔ BLOCKED on backend data:
  offer marketing photos + offer T&C / expiry (Figma 1:4009 / 1:4044 — the
  payload has no image, terms or validity; proposal §8 in
  `docs/BACKEND_CONTRACT_PROPOSALS.md`). Not needed: the fork's SavingsLine
  strip (TB uses the bag Rewards entry row). Still open: G4 — group-wise
  CATEGORY candidates are not offered (a get side with only categories opens
  an empty picker that X closes)
- ~~`confirmTier1CustomizationRemoval` has no consumer~~ ✅ bag-pdp (item 24):
  in a tier-2 EDIT, '−' at qty 1 asks first (an alertdialog reusing the
  `pdp.discard*` copy) and YES removes the pick via SDK `removeTier1Selection`
  — it was a dead tap. The fork's consumer would crash TB's pricing (it reads
  `group.id`; groups carry `_id`): TB takes the group from `tier2MIAMGroupID`
  and matches the pick by itemId
- ~~Variant-shaped upsell items in the MIAM decline path~~ closed (bag-pdp item
  30, nothing ported): the fork's `isVariantUpsell` branch never ran (its
  `isTier2` early return fires first; the flag is read, never written), so TB's
  decline already is the fork's reachable path — pinned by 3 synthetic-variant
  tests in `MakeItAMealPrompt.test.tsx`
- ⛔ PDP nutrition (Figma 1:5823, item 22): BLOCKED on backend data, never faked
  — every `nutritionalInfo` value is 0 (122/122 reference entities; top-level
  `calorieCount` too), the units are wrong (calories "grams", sodium "g",
  `servingSize` "mg"), `allergens` is empty and dropped by the SDK whitelist,
  and no open-state frame exists; proposal §9. The PDP keeps "£x | N Cal" when
  calories are above 0
- ⛔ NONE / REGULAR / EXTRA ingredient levels with "EXTRA +£1.50" (Figma 1:3007
  / 1:3037 / 1:5477): BLOCKED on backend data — no level or per-level price
  exists (no reference group sets `differentialPrice` or `priceChange`, and
  both are dynamic-pricing flags anyway); proposal §11. The rest of the builder
  / customize family is item 42 (figma-polish lane)
- Menu banner media: DECLINED (user D1 2026-10-06 — not in the Figma); the SDK
  banner walk is guarded (post-P9 25a). Menu search: DESCOPED (user D2
  2026-10-06 — the fork's search is dead code, no Figma). MIAM texts at boot ✅
  29c (staged with the kiosk settings; '' when unset → the translated
  headline) and the recommendations prefetch ✅ 29b (post-commit background
  refresh). Cluster settings are dead in the fork, so not ported.
- Payment-terminal socket connects at boot (Geidea/NeoLeap) are deliberately NOT ported
  (the payment-settings fetch landed in P8a). P8b ✅ ported only Paytm DQR + EDC
  (EDC is backend HTTP: no socket, no localhost); the fork's other 7 gateways stay
  unported. Owed before production: a live Paytm EDC terminal + real UPI run
  (P8b-17 — tests never drive a real gateway; it must also answer backend Q1–Q5)
  and source media for the 1:3392 terminal photo / 1:3427 backdrop (video fills;
  EDC ships from the vector 1:3404)
- ~~Per-language pipeline/menu names~~ ✅ post-P9 28 — resolved at render (useLocalized); offer/coupon names and the MIAM buttonText1/2 stay English (no data)
- Select-a-Size fast lane, a variant WITH modifier groups (pre-existing since 1bfd95e, found by the fonts-lane fixer 2026-10-07): CONTINUE navigates to `/customization` without opening a session (`Menu/index.tsx` `handleSizeContinue`), so the PDP's no-session guard bounces to `/menu` and nothing is added (VIEW MY BAG stays 0) → open the variant session the way a card tap does (`openDoubleTierModal`)
- SelectSizeModal vs Figma 1:5683 (pre-existing, not font-caused): 560 px wide vs 680, small-tile radios bottom-right vs top-right, a wrapped name centred vs left-aligned → visual polish
- Boot loading / error / card illustrations (Figma 1:5598 / 1:5600 / 1:5602,
  item 43): re-checked 2026-10-07 (loyalty-visual, three `download_assets`
  probes) — loading and error hold posters only (still PNG fills): BLOCKED on
  the designer (MP4 / WebM with alpha or Lottie, plus placement frames). The
  card board also holds an animated 3.12 s tilt GIF (2.34 MB), not built — a
  placement / format call; the still card stays P8b's `credit-card.svg`
- Loyalty REWARDS auto-dismiss bar (pre-existing since P7c, cosmetic; found by
  the loyalty-visual e2e author): after the guest's first touch the 6 px
  countdown bar stays painted at its frozen width, OTP step included
  (`cancelTimer` only clears the interval) → figma-polish lane (G3)
- A failed `bagLazyParts` chunk (residual, wider now that the chunk loads at
  /menu entry): in production the page reloads (chunkRecovery — the cart
  survives, a PDP customisation in progress is lost); within 60 s of a reload
  (its loop guard) the bag lands on the crash screen (its always-mounted lazy
  parts have no local boundary) while the menu's loyalty sheet degrades to a
  closable scrim. Only `loadActivityModal` / `loadPaytmScreen` schedule the
  healing reload — nothing heals the bag parts or the loyalty sheet between
  guests → figma-polish lane (G2)

## Open decisions / user-gated items

| Item | Owner | Status |
|---|---|---|
| Commits: tacobell-kiosk has NO commits; SDK interop fixes sit uncommitted in posistKiosk-cx-sdk | user says when | ⚠️ open |
| GT America font license (Archivo variable stand-in shipped — one OFL family at wdth 62 / 100 / 125 since the fonts lane, 2026-10-07; width, x-height and letterform deltas vs the frames remain until it is licensed) | client | ⚠️ open |
| Activity-Center fullscreen passcode is hardcoded (inherited `Pos@123`) — needs server-issued secret pre-production | maintainer | ⚠️ open |
| Real license code registration (unlocks building P6+ against live data) | user | ⚠️ open |
| Env keys for TB deployment (Firebase project, PostHog) — `.env.example` scaffolded | user | ⚠️ open |
| Rewards scan/code Figma UX ↔ loyalty mechanics: **user decision 2026-09-30 — replicate the ORIG kiosk's XENO integration/flow exactly** (same endpoints, session lifecycle, redeem/revoke), skinned with the Figma rewards surfaces (numpad login 1:4174 as phone→OTP steps, REWARDS INCOMING 1:4079, error 1:3786, MY REWARDS (n) CTA entry 1:3956); SCAN APP tab deferred (no scanner) | user | 📌 decided |
| Bill math in the bag: billCalculation rounds the TOTAL to whole units unless deployment carries `{name:"disable_roundoff",selected:true}`, and fixture items carry exclusive VAT@15% — so bag/checkout total = round(subtotal×1.15) while the menu CTA shows the plain subtotal (fork-faithful). Maintainer: confirm round-off / GST settings for the India deployment (fixtures carry 15% exclusive tax as test data) + whether the CTA should show the taxed total | maintainer | ⚠️ open |
| P6c surfaces partly design-language: Figma MCP rate limit (Starter plan) blocked the pack customize-family frames (`1:4895`…), BYO frames (`1:5264`…), completed/warning pack states, and MIAM has no frame — built from the 4 pulled frames' language; needs a visual pass once frames are pullable | client review | ⚠️ open |
| **Payment gateways — user decision 2026-10-05: PAYTM DYNAMIC QR + PAYTM EDC.** Of the fork's 9 (Dojo; Geidea, NeoLeap; Network International, Mashreq; Paytm QR, Paytm EDC, Pine Labs Plutus, Razorpay), P8b ports exactly `PaytmDynamicQr` and `PaytmEdc` (+ their polling settlement and the Figma payment-instructions / please-wait / card-failure screens). Every other gateway stays unported; pay-at-counter remains | user | ✅ P8b (merged 2026-10-07) — exactly these two; EDC is backend HTTP (no socket, no localhost); live-terminal sign-off owed (P8b-17) |
| **Deployment country — user decision 2026-10-06: INDIA (IST, ₹).** "TB UK" and "£" in older notes, comments and e2e fixtures were placeholders. Prices already render with the deployment's currency symbol from settings (`selectCurrency`; no hardcoded £ in rendering); the SDK's Paytm QR expiry is computed in kiosk-local time, which is correct in IST | user | 📌 decided |
| **Paytm DQR rendering — user decision 2026-10-06: ADD `react-qr-code@2.0.15`.** The backend sends only Paytm's raw UPI `qrData` (it drops Paytm's base64 image), so the kiosk draws the QR itself with the fork's library — the one new dependency of P8b (~13 KB). P8b lane defaults (contract D2–D9, D11): payment idle-hold cap 240 s; the five Paytm kiosk endpoints exempt from 401/504/505 recovery (host-configured, like D2); an unknown outcome goes to a staff panel (CHECK AGAIN / FINISH, never a re-pay); a DQR still pending 30 s past expiry = not received + TRY AGAIN; DQR cancel has no backend endpoint (fork parity + warning copy — ask the backend for one); an EDC initiate FETCH_ERROR/5xx is outcome-unknown (settle by status, never re-initiate); a static hourglass frame; three payment tiles in one row (sign-off); `paytm_dqr_secret_key` stays persisted (fork parity — flag) | user / orchestrator | ✅ P8b — as decided (`react-qr-code` pinned to exactly 2.0.15, the named import, inside the lazy `paytmRuntime` chunk); refined in the build: busy is retryable (TRY AGAIN + BACK TO BAG), the tile labels are the frame's Cm Bd 48/44 at every tile count with 16 px side padding at n = 3, Arabic wrapping to 2–3 lines (fonts lane 2026-10-07 — the build's 24 px n=3 labels are gone), D5's "not received" needs a successful pending read (an error-only window ends on the staff panel), and a D6 re-check that errors keeps polling to the window's end |
| **P8b sign-off list (design language — no frame, or beyond the frame):** (1) the `/payment` row (D9): COD-only = one centred 412×412 tile (P8a's inert card tile is gone), n=2 the Figma 412 tiles, n=3 266.67 px tiles with 16 px side padding; the labels are the frame's Cm Bd 48/44 at every tile count (fonts lane 2026-10-07: "RESTAURANT" is 222.4 px in the 234.67 px label box), Arabic labels wrap to 2–3 lines; the "PAY WITH UPI QR" tile; (2) the Paytm buffer "Getting your payment ready…" and the /receipt PleaseWait "Setting up your payment"; (3) the initiate-failure modal on the 1:6288 layout (TRY AGAIN or PAY ANOTHER WAY + BACK TO MY BAG), whose copy and actions disagree: busy says "…or pay another way" but offers TRY AGAIN, and `failed.start` says "try again" on the variant that offers PAY ANOTHER WAY; (4) the DQR screen: the 1:3404 skeleton with a 446 px QR in the 616 card (the contract asked ≥480), the one-line title lifting the column ~54 px; (5) /paymentPolling additions: the hint line, "Time left m:ss", CANCEL PAYMENT (bottom-left 480×92), the terminal-prompt line, now YES-only ("Press YES on the card machine to cancel the payment"; the fork also offered NO); (6) the actions and copy of the cancel-confirm, not-paid, unknown and chunk-failure panels (1:3427 has none), incl. the staff panel's CHECK AGAIN / FINISH and the order's last 5 digits; (7) ADA variants: /paymentPolling (bell dropped, column at 40, gaps 40, slot 360, CANCEL 1012–1104) and PleaseWait (bell dropped, card at 161); (8) the decorative purple bell (`alt=""`); (9) the sheen, rotated −90° at 50 % soft-light, is lighter than Figma because `plastic-overlay.jpg` is alpha-flattened (a transparent plastic_2 WebP would match); (10) the static hourglass (D8); (11) Order Complete still says "Proceed to front counter" after a card / UPI payment; (12) browser Back/Forward is now swallowed app-wide, on every screen including the first (the documented "never respond to browser back" intent, never enforced before): confirm this is the intended kiosk policy | client | ⚠️ sign-off |
| **P8b backend questions (contract §7 — they sharpen, never block; the cx kiosk Paytm handlers are on no local posistApp branch, so the P8b-17 live run must answer them):** (Q1) cx createQR returning Paytm's `image` — moot since D1 (it would only let TB drop `react-qr-code`); (Q2) the checkStatus vocabulary (expired / declined / not-found?) and whether placement is idempotent when the webhook AND a status read both see "paid" — every read is a placement trigger, and `/start`'s release reads any session still open (FINISH, idle on a panel, crash, relaunch); (Q3) what `paytmEDC/cancel` does to an already-paid or already-voided transaction (the kiosk voids only after a fresh "pending", but a reload mid-settle can void again, once per mount); (Q4) whether an EDC initiate with the SAME posBillNo / posBillTime is idempotent (TB never re-sends one); (Q5) whether a DQR paid AFTER the kiosk left (cancel / expiry) is placed or refunded; (D6 ask) a DQR close / reject-and-refund endpoint — today a guest who cancels a DQR, pays at the counter, then approves the QR in their UPI app creates two orders (fork parity; the cancel-confirm copy warns) | backend | ⚠️ open |
| **P8b residuals (2026-10-07):** (R1) an EDC void from `/start`'s release or a settle leaves a YES/NO prompt on an unattended terminal, and what the terminal does then is unknown (extends Q3): could the next guest get "busy" or see the previous amount? (R2) the prompt is YES-only now, but a guest who presses NO anyway and pays later lands on the unknown panel, because polling stops `PAYTM_SETTLE_WINDOW_MS` (30 s, no countdown) after the void; CHECK AGAIN or `/start`'s read picks the payment up; (R3) a reload mid-EDC-initiate on /receipt now resumes the SAME ids (`PaytmResumeGuard` + the persist flush). Accepted trade-off: an initiate that never left shows the EDC screen to `posBillTime` + 180 s, then the 30 s settle (worst case ≈ deadline + 60 s after a void), then the staff panel, and the receipt choice resumes as "none"; a power cut can still lose the newest localStorage writes; (R4) Rule 3: `paytmQrCode` IS persisted (contract §5, for DQR resume; the money-review lens said never) and is cleared at every session end, on disk too; `paytm_dqr_secret_key` stays persisted in `appSettings.paymentSettings` (D11, fork parity); the QR card is `ph-no-capture`, so confirm whether PostHog session replay is on for TB; (R5) Paytm analytics carry `order_id` (= posBillNo) and `payment_type` — the lane contract's default, flagged for confirmation; they never carry posBillTime, the QR, the mid, the secret, the device id, `order_details` or the phone; (R6) the 34 Arabic `paytm.*` strings are drafts awaiting native review (the YES word vs the terminal's likely-English buttons); (R7) the DQR countdown is 135 s (fork parity) while Paytm expires the QR at 120 s: a scan in that gap fails inside the UPI app and no money moves; (R8) if "paid" arrives before the Dexie cart rehydrates after a reload, the local order record is empty (Order Complete and the ticket may list no items; the backend order is correct); (R9) a failed `paytmRuntime` chunk refuses every Paytm checkout until the next splash dwell reloads the page (the tiles stay visible; analytics show `paytm_chunk`, then `UpdateTriggered whole_app`), and the no-reload exemption relies on Chromium naming the chunk URL; (R10) calibration knobs `PAYTM_SETTLE_WINDOW_MS` 30 s and `PAYMENT_IDLE_HOLD_MAX_MS` 240 s (worst-case EDC time in flight ≈ 225–241 s; grow the cap with the windows); ops: the kiosk OS timezone must be Asia/Kolkata, because the DQR expiry is kiosk-local | maintainer / ops | ⚠️ open |
| Order Complete QR codes (frames 1:5932 guest "scan to earn points" / 1:3437 promo) have NO CX data source — the panel ships without a QR rather than a placeholder that scans to nothing | client/backend | ⚠️ open |
| Email receipt: the Figma receipt screen offers EMAIL but **the original kiosk has no email-receipt anything** — `customerInfo.email` exists in the slice, is never written and never reaches the order payload. Tile ships inert; needs a payload contract before it can collect an address | client/backend | ⚠️ open |
| MIAM "SAVE £X" badge (Figma 1:3070) has NO data source: a full key census of the reference menu (100 distinct keys) found only `price`/`applyAddonsPrice`/`differentialPrice`/`priceChange` — the last two are modifier deltas, not a was-price — and `makeItMeal` carries only subText/buttonText1/buttonText2. Badge is implemented + gated on a real figure and stays hidden; needs a backend data contract to ever appear | client/backend | ⚠️ open |
| ONE flag gates TWO surfaces: `enable_cart_upsell_screen: false` disables BOTH the `/forYou` interstitial AND the in-bag Complete-Your-Meal rail (both read `shouldShowUpsell`). Fork-faithful, but a tenant wanting the rail without the interstitial needs a second flag — post-P9: it now gates THREE (the in-bag tenant recommendations too, D7) | client | ⚠️ open |
| `/forYou` is a design-language screen — the TB Figma has no frame for it (node 1:3070, previously mapped as "pre-cart upsell", is actually the MIAM prompt). The design instead puts Complete-Your-Meal inside the bag. Screen is settings-gated, so dropping it is a config decision | client review | ⚠️ open |
| Loyalty boot hardness: the `getLoyaltyPartner` call now sits inside the boot try/catch, so on `enable_loyalty` deployments a dead/slow loyalty proxy blocks boot with the retry screen (fork booted loyalty-off silently). Rule 2 says never freeze; the alternative is degrade-over-block via an inner try/catch — one line either way. **User decision 2026-10-01: DEGRADE** — inner try/catch, boot and sell loyalty-off, analytics event + "loyalty unavailable" in the Activity Center; the splash retries the partner once per visit (applied only while the splash is still showing, so loyalty never switches on mid-order) | user | ✅ P9b |
| Loyalty screens `/phone` + `/customerName` have no idle-timeout coverage — TB still has no mounted idle timer at all (P9 item); a guest abandoning mid-phone-entry does not reset to /start | maintainer | ✅ P9a (IdleGuard covers every route from /second on) |
| **Node pin vs dependency-cruiser** — `.nvmrc` + CI pin Node **20.19** (EOL 2026-04-30), but dependency-cruiser 18.4 refuses to run below Node 22 (`^22‖^24‖>=26`), so `yarn validate` and CI fail at the depcruise step on the pinned runtime (pre-existing, not P9a; gates were run with depcruise on Node 22.14). **User decision 2026-10-01: bump to Node 22 LTS** — done: `.nvmrc` 22, ci.yml `node-version: 22` ×2, `engines` `>=22.12`, README. Any deploy-image Node pin outside the repo needs the same bump | user | ✅ done |
| Idle START AGAIN fill `tb-lilac` (#F3D9FF) is 1.3:1 against white — decorative per the design (the label carries 8.7:1), but below WCAG 1.4.11's 3:1 for a meaningful graphic; the menu/PDP scroll-indicator track (Figma 1:5263) uses the same fill — decorative and non-interactive, the purple thumb is ~8:1 on it | client | ⚠️ sign-off |
| **SDK transport timeout (Rule 2)** — the shared base query (`packages/core/src/transport/kioskApi.ts`) has no timeout, so a hung getMenu/placeOrder freezes the UI forever. **User decision 2026-10-01:** 10 s default request timeout, multi-MB menu download 30 s, retries stay per call — **refined the same day to HOST-CONFIGURED**: `configureKioskTransport()` gains the timeout setting (+ per-endpoint overrides), TB turns it on, the fork app stays byte-for-byte as today until its payments owner opts in. Reason: the P9b mapping found a blanket SDK default would abort the fork's card-gateway initiate/park/cancel calls mid-arming and let its post-payment ladder auto-retry timed-out pushes for customers who already paid by card | user | ✅ P9b |
| `MENU_DOWNLOAD_TIMEOUT_MS` (30 s) is a calibration knob: it needs ~2 Mbps effective for the 7.5 MB reference menu if `getMenu` is not gzip-encoded. Confirm gzip + store bandwidth | backend / ops | ⚠️ open |
| **Uncertain order + claimed loyalty reward (P9b review M4):** after a timed-out (outcome-unknown) push, the claim is kept and the `/start` teardown refunds it. If the order DID land, the guest got the free item AND the points back; clearing the claim instead strands the points if it did NOT land. Today = refund (fork parity). **User decision 2026-10-01: SKIP the automatic refund when the claim's order push is outcome-unknown** — keep the claim un-refunded, emit the reconciliation event (reward id, claim time, points), staff reconcile | user | ✅ P9d (also requires the reward row in the pushed cart; the `order_push` event carries the reward ids at mark time) |
| **Splash fallback (no media configured)** — the P1 poster (1:2184) promises "Half moon half price, happy hour 2-4pm", unsafe as a PERMANENT fallback. **User decision 2026-10-01:** the no-media fallback becomes the neutral Figma **1:5617** (full-bleed photo, WELCOME + "touch anywhere to start", no price claim); configured media renders per Figma (1 item full-bleed 1:5604-style, ≥2 the 1:2203 carousel). Figma only holds a 1810×1099 photo (×1.75 upscale at 1080×1920) — client to supply a hi-res original | user / client | ✅ P9d (hi-res original still owed) |
| **ADA sign-off list (P9c, design-language):** (1) tapping the brand zone exits ADA — fork parity, but Figma draws no affordance (it is a labelled button for screen readers); (2) the PDP now shows the Figma Footer-bottom strip (CANCEL ORDER / ADA / language) in NORMAL mode too — it is in 1:2614/1:2920/1:5413, TB lacked it — and the PDP scroll area is 56 px shorter; (3) ADA variants of the 7 frameless screens (`/second` >2 pipelines become a swipe row, bells dropped, Tent's error banner pinned from the top); (4) backdrop seams where the brand-zone texture meets `/tent`, `/payment`, `/receipt` (540 px tile), `/orderSuccess` (gradient), `/phone`, `/customerName` (plain purple) — `/second` aligned; (5) "Place New Order" keeps ADA on for the next guest (fork parity; every path via the splash clears it); (6) Arabic `ada.exit` copy | client | ⚠️ sign-off |
| ADA reach calibration: the 798/1122 split is Figma's; whether it keeps every control under the ADA 2010 §308 high-reach limit (48 in / 1220 mm) depends on the cabinet's panel size and mounting height. `ADA_BRAND_ZONE_HEIGHT` is the single knob (lowering it is always safe; unit tests guard ≤ 816) | hardware | ⚠️ open |
| Back-to-bag after a timed-out push then re-PAY mints a NEW order id — if the timed-out push actually landed, that is a duplicate order even if the backend dedupes on order id (Retry on the error panel keeps the id). Needs the backend idempotency answer | backend | ⚠️ open |
| Any 504/505 (incl. on `placeOrder`) still de-registers the kiosk via `recoverFromServerError` when the gateway answers inside the 10 s budget. Intended "session invalid" signal or gateway timeouts? P9e: the scheduled refresh re-runs ~10 boot calls about 4×/day per kiosk, multiplying this exposure; D2 exempts the three telemetry endpoints and P8b's D3 the five cx kiosk Paytm calls (createQR, both checkStatus, EDC initiate / cancel — a 401 / 504 / 505 mid-payment no longer logs the kiosk out); `placeOrder` and the boot calls stay exposed | maintainer / backend | ⚠️ open |
| `/LoadingResources` auto-retry keeps counting while the operator has the Activity Center open; a successful background boot navigates to `/start` and closes the diagnostics mid-use | client | ⚠️ sign-off |
| Fork follow-ups surfaced by the P9b mapping (NOT TB work): the fork's Polling ladder would duplicate paid orders if it ever opts into timeouts; its gateway initiators need an explicit ambiguous-timeout UX; RTK 2.7 in the fork bounds only time-to-headers (TB's deduped 2.12 bounds the whole request — a mid-body timeout surfaces as `PARSING_ERROR` "TimeoutError", so classify timeouts with a shared predicate, never `status === "TIMEOUT_ERROR"` alone) | fork payments owner | ⚠️ open |
| **Order push after a TIMEOUT** — placeOrder idempotency on the client orderId is unknown. **User decision 2026-10-01:** no auto-retry after a timeout (show the Retry / Back-to-bag panel); clean errors (network down, 5xx) keep the existing 4-attempt ladder. Backend still to confirm idempotency | user / backend | ✅ P9b (also covers a 2xx whose body was lost) |
| `@axe-core/playwright` devDependency for the a11y e2e (contrast, names, roles) — **approved 2026-10-01** (devDependency, 0 bytes shipped) | user | ✅ installed P9f (`@axe-core/playwright` ^4.13.0, same change that removed framer-motion); the sweep itself lands with the harness |
| **Arabic layout** — **user decision 2026-10-01:** RTL text, LTR layout (the Figma has no RTL frames); Arabic text blocks get `dir="rtl"`. Client sign-off still wanted | user / client | 📌 decided → P9f |
| **Idle timing (P9a, orchestrator default)** — Rule 1's 120 s is a CEILING: total = clamp(server `ideal_time`, 60, 120) s, fallback 120; the "You have been inactive" prompt covers the last 20 s (WCAG 2.2.1 minimum). The fork reset at (ideal−10)/2+10 s (65 s for 120) — fixed, not ported. Boot no longer throws on a missing `ideal_time` | maintainer | 📌 decided |
| **Proximity welcome — deferred.** The fork's feature is always-on camera motion detection on the splash (getUserMedia, no enable key; the delay setting only tunes it). Needs an explicit backend enable key, data-protection (India DPDP Act) assessment + signage sign-off, a front camera with pre-granted permission, and on-site calibration — and it depends on the idle timer (P9a). Not built | client / legal / hardware | ⏸ deferred |
| **Boot-data refresh — user decision 2026-10-05: SCHEDULED.** A registered kiosk only re-fetched its boot data (kiosk settings, theme, pipelines, splash media, loyalty partner) on an FCM brand update (fork parity — the fork's splash-mount `StartOverResourceLoading` fetches nothing), and FCM stays off until TB has Firebase keys AND pre-granted notification permission, so Cockpit changes reached a kiosk only by re-registering it. P9e: FCM brand updates + an Activity Center "Reload resources" button + the splash re-runs the boot when the last SUCCESSFUL boot is older than 6 h (one knob) and the splash has been untouched for 15 s — the brand-update path, never mid-order; a failed refresh returns to the splash on the old data | user | ✅ P9e |
| **Background telemetry vs session recovery — user decision 2026-10-05: OPT-IN EXEMPTION.** `configureKioskTransport()` gains a host-configured list of background endpoints (`update_cx_fcm_key`, `update_cx_software`, `update_device_status`) that skip the 401 / 504 / 505 recovery, so a gateway hiccup on telemetry can no longer log out or de-register a healthy kiosk; TB opts in, the fork configures nothing and stays byte-identical (the P9b timeout pattern) | user | ✅ P9e (488-row A/B on RTK 2.7 + 2.12: fork identical) |
| **P9e sign-off list (design-language, no Figma frames):** (1) the update countdown modal (invisible 0–10 s, "Starting in Ns" 10–15 s, then "Updating…"; z-80); (2) a guest tap in the final 5 s is swallowed — non-dismissable, ≤5 s, fork parity (OV8); (3) the Activity Center's "Reload resources" button and "Data loaded" row; (4) the Arabic update strings are drafts. Calibration knobs: `BOOT_DATA_MAX_AGE_MS` 6 h, `BOOT_REFRESH_RETRY_MS` 30 min (no jitter yet — `withJitter` is the upgrade if a fleet power-cycled together refreshes together) | client / ops | ⚠️ sign-off |
| **Visual regression — user decision 2026-10-05: CAPTURE ONLY.** P9f's flow specs attach screenshots at the key steps (splash, order type, menu, bag, payment, complete) to the e2e report for human review; no pixel assertions until the GT America font is licensed and a CI rendering image is fixed | user | 📌 decided → P9f |
| **CI e2e — user decision 2026-10-05: PER-PR JOB, 2 SHARDS.** P9f adds an e2e job to every PR. The first estimate (~3–4 min) was wrong: the suite needs ~12–18 min on one CI worker, so the job runs as 2 parallel shards (~8–10 min wall per PR; user decision the same day). The job waits for lint + type-check, and its build sets `VITE_POST_HOG_TYPE=production` so the bundle budget measures the production layout (lazy PostHog chunk included). Default SDK checkout: the local SDK clone's origin `PosistGit/posistKiosk` at branch `cx-sdk/extraction` (workflow-level `SDK_REPO` / `SDK_REF`) — change it if the SDK moves to its own repo. It needs the SDK checked out beside this repo, so it stays red until the real SDK repo slug and an `SDK_REPO_TOKEN` secret are filled in (`.github/workflows/ci.yml` placeholders) | user / devops | ✅ job landed P9f (`.github/workflows/ci.yml` e2e: needs lint-typecheck, 2 shards, fail-fast false, 30 min, playwright-report-1/2 always uploaded; the build sets VITE_POST_HOG_TYPE=production) — STILL OWED before a green run: confirm SDK_REPO / SDK_REF, create the SDK_REPO_TOKEN secret, push the SDK branch |
| **Bundle budget — user decision 2026-10-05: ENTRY + TOTAL.** P9f fixes `scripts/check-bundle-size.mjs` (fail closed on a malformed budget, exclude the service worker), keeps the 2,000 KB total-JS budget, and adds an entry-chunk gzip budget set just above the post-P9f size (after lazy PostHog and dropping framer-motion), so boot-path regressions fail the gate | user | ✅ P9f — boot path (the module script + every modulepreload chunk, gzip-9, summed) 344.4 KiB on a production build (was 478.2; raw 1,590 → 1,179 KiB) ⇒ ENTRY budget ceil5(M+10) = 355 KiB; TOTAL 2,000 KB kept (SW scripts excluded); the gate fails closed on bad args, a missing dist, an ambiguous entry or an internal error |
| **Arabic mechanism — user decision 2026-10-05: ISOLATES + `dir="auto"`.** P9f gets "RTL text, LTR layout" through the i18n layer: every translated Arabic string (and every interpolated value) is wrapped in Unicode direction isolates (FSI…PDI) by an i18next post-processor, `<html lang>` follows the language, and multi-line Arabic paragraphs get `dir="auto"` so they right-align — one file for the runs, zero component rewrites, English byte-identical. `dir="rtl"` on elements was rejected: it mirrors any flex row it lands on (~125 rows in 48 files). Client still signs off the look | user / client | 📌 decided → P9f |
| **PostHog identify payload — user decision 2026-10-05: KEEP AS IS.** `posthog.identify` keeps sending `license_key` and `login_code` with the tenant/deployment ids (fork parity), also after P9f's lazy analytics loader | user | ✅ kept (identifyKiosk sends the same six fields) |
| **CLAUDE.md rule 8 — user approval 2026-10-05:** P9f adds "startAnalytics() right after setAnalyticsPort(); never import posthog-js statically" to the boot-order rule when the lazy PostHog loader lands | user | ✅ P9f (line added) |
| **P9f orchestrator defaults (2026-10-05):** the Registration ACTIVATE button's white-on-pink (2.46:1) is fixed in code (ink-purple text, 7.73:1 — Registration has no Figma frame); Playwright `expect.timeout` 10 s and an ESLint ban on `page.waitForTimeout` under `tests/e2e`; the back-to-bag re-PAY order id stays an annotation, not an assertion, until the backend confirms placeOrder idempotency; P9e's specs are written in today's per-spec style and P9f's harness migration absorbs them; the optional idle sweep over 5 more screens and the boot-config parity cases go to the backlog (CI time) | orchestrator | 📌 decided |
| **Loyalty partner — user decision 2026-10-05: XENO ONLY.** The fork's Reelo path (6-digit OTP, points redemption, `redeem_points`) is NOT ported; a Reelo-configured store would have no working rewards in TB | user | 📌 decided |
| **Bag rewards button on loyalty-off deployments — user decision 2026-10-05: HIDE.** LOG-IN & GET REWARDS renders only when loyalty is on (today it shows and answers "coming soon") | user | ✅ P9f — LOG-IN & GET REWARDS renders only when loyalty is on; PAY takes the full row (frameless → sign-off) |
| **Backend contract proposals — user decision 2026-10-05: WRITE THEM.** One proposed contract each (fields, endpoints, payloads, kiosk behaviour) for: email receipt, Order Complete QR codes, the MIAM "SAVE £X" badge, a separate in-bag meal-rail flag, a server-issued Activity Center passcode, SCAN APP login, resend OTP — in `docs/BACKEND_CONTRACT_PROPOSALS.md` for the backend team | user | ✅ written 2026-10-06 (7 proposals + 5 confirm-only questions; notable: a wrong operator passcode must never answer 401 — the transport logs out on any 401) |
| **Menu cache across boots (P9e review F2):** the boot no longer wipes the Dexie menu cache (the fork wiped it on every boot, incl. brand refreshes), so menu freshness between boots relies only on the server's `MENU_ID` / 304 — which TB already trusts within a session. Backend: confirm that every Cockpit change affecting the menu payload bumps `MENU_ID` (if a brand push must force a full download, it is one line: clear `db.menus` on trigger `brand`) | maintainer / backend | ⚠️ open |
| **Arabic / a11y sign-off list (P9f mapping):** (S1) an Arabic typeface — Archivo has no Arabic glyphs, so Arabic renders in the OS fallback; (S2) wrapped Arabic paragraphs right-align via `dir="auto"`, single lines keep the layout's alignment; (S3) the kiosk blocks pinch-zoom / text resize (`user-scalable=no`, WCAG 1.4.4) — the axe sweep documents a `meta-viewport` exclusion; (S4) placeholder grey darkened 35 % → 55 % black for contrast; (S6) the 🇬🇧 flag next to "العربية" in the footer; (S7) the pink phone-field border is 2.46:1 non-text contrast | client / compliance | ⚠️ sign-off |
| **P9f app sign-off list (design-language details):** PAY spans the full bag row on loyalty-off deployments; the PDP "Show more / Show less" is a 44 px toggle below the 2-line-clamped description (it was inline and got clipped); placeholder grey 35 % → 55 % black (Registration, /phone, /customerName); the pack-slot imageless placeholder ink-purple /40 → /60; `dir="auto"` + `text-start` on the offer row's second line only; the language sheet has a CSS entrance and no exit slide; Registration's error banner slide, shake and press are CSS approximations of framer-motion | client | ⚠️ sign-off |
| **lodash in the boot chunk (95.7 KiB) is SDK-owned** — `billCalculation.js` imports the whole of lodash for four `_.chain` sites, plus redux-persist-transform-filter; rewriting them behind the golden-master gate saves ~23 KiB gzip | SDK maintainer | ⚠️ open |
| **Offers lane defaults + sign-off list (2026-10-06/07):** auto-apply scope = `operatorFlagged` (only payload `autoApplied:true` offers; one knob `OFFER_AUTO_APPLY_SCOPE`; any customer offer action latches it off for the session; no celebration for auto-applies — an "Applied for you" caption); the celebration is a NON-blocking 2.2 s status card + CSS confetti + row pop (customer applies only, reduced motion honoured); copy "ADD TO REWARD", "Customize" / "Customized — tap to change", the size line on fixed-size freebie rows, the staged-row price pair; group-mode picker controls ("−", "2 ×", the hint) and BuyStageSheet / ADD ITEMS / the in-bag PDP are design-language (no frames); 500 ms ghost-tap guards after a sheet closes (also on the P7b SAVE→PAY and CONFIRM→PAY paths); Arabic drafts need native review | client | ⚠️ sign-off |
| **Offers money residuals (2026-10-07):** (F4) a crash / reload mid buy-stage keeps the stage's paid rows (fork parity); (R3) the group-wise "Save up to" headline ignores repeat picks (display only, fork parity — the fix touches the ranking shared with the fork); a reward a crash left with none of its free rows reads −£0.00 until removed (auto-removing it is new behaviour → sign-off); item offers with nothing to grant (auto-applied ITEM offers arrive with `getItems: {}`) rank as eligible £0 rows and answer "can't be applied" on SAVE (hiding them needs a non-additive SDK ranking change); variant-id freebies are fixed grants with no add-ons (fork parity); a reload on /tent, /payment or /forYou still bounces to /menu (cart + reward survive) — the new CartRehydrated signal can fix it later | maintainer | ⚠️ open |
| **Zero-value group offers (orchestrator hardening 2026-10-07, diverges from the fork):** a group-wise offer whose shared value is null / ≤ 0 is refused ("can't be applied") instead of adding the picks at FULL price under "REWARD APPLIED −£0.00" | client | ⚠️ sign-off |
| **Orphaned free rows after a crash (orchestrator decision 2026-10-07):** on the Dexie restore, offer-stamped free rows that the applied reward does not own (matched like the converter: `baseItemId \|\| _id`, plus the entry's discount) are DROPPED silently (they never render; the saved reward is untouched) — re-pricing them would charge for items nobody ordered | client | ⚠️ confirm |
| **Menu/data lane defaults (orchestrator 2026-10-06, sign-off):** (D3) the Figma 1:5263 scroll bar ships as a non-interactive INDICATOR (aria-hidden, pointer-events-none; a draggable bar = port the fork's ScrollRail, M); (D4) the order type stays v1 (1:2581; v2 1:2588 not built — nothing selects it); (D5) the ticker shows `pipeline_text_<slot>` when set (secondary slot in a secondary-language session, no cross-language fallback) at the designed speed, else "It's lunch time!" — a real daypart field needs a backend proposal; (D6) `VITE_TENANT_RECOMMENDATIONS_URL` per deployment, never committed — ops to confirm TB's tenant id `5c122fc146aefe2828401642` and that the S3 bucket denies anonymous PUT (its CORS advertises GET, PUT); (D7) `enable_cart_upsell_screen: false` also hides the tenant recommendations (the fork shows them regardless); (D8) the operator's `make_it_meal_*` texts override the Figma MIAM headline (fork parity) | client / ops | ⚠️ sign-off |
| **Emptied tenant recommendations feed:** an empty or junk 200 body keeps the last good map and reports ErrorOccurred `empty_body` on each boot (the fork clears on `data:[]`), so an emptied S3 file cannot withdraw suggestions — ops must repoint or unset `VITE_TENANT_RECOMMENDATIONS_URL` | client / ops | ⚠️ confirm |
| **Order payload echoes the pipeline row (pre-existing, fork parity):** `extras.pipeline` carries the selected pipeline row verbatim, so an Arabic session pushes `secondary_name` (Arabic) and `primaryCode: "ar"` (the guest's language in a field named primaryCode); item names, add-ons and source.name stay English. Trim `extras.pipeline` / fix `primaryCode`? | backend | ⚠️ open |
| Native scrollbar hidden on /menu and the PDP (post-P9 26): on a classic-scrollbar OS this returns ~15 px to the content (the Figma widths); headless e2e cannot see native bars — a physical-kiosk check is owed | hardware | ⚠️ open |
| **Font assets (mislabelled since P1, found 2026-10-06):** `Archivo-Variable.woff2` was a STATIC "Archivo ExtraCondensed Thin" (every body string extra-condensed and thin, faux bold) and `Archivo-Condensed-Bold.woff2` a wdth-only variable font (the compressed CTAs at NORMAL width) | orchestrator | ✅ fonts lane (merged 2026-10-07) — ONE OFL Archivo variable family (Google Fonts CSS2 v25, wght 100–900 × wdth 62–125: `Archivo-wdth-wght-latin.woff2` 90,096 B + `-latin-ext.woff2` 85,856 B, which carries ₹) at three widths: body 100 %, `.tb-compressed` 62 %/700, `.tb-display` 125 %/900; the three P1 files deleted; licence `public/fonts/OFL.txt` (ships in dist, not precached); precache +110,152 B, JS budgets unchanged; `font-display: swap`, no preload (a cold load before the service worker installs paints system-ui, then swaps — accepted); pinned by `src/__tests__/fonts.test.ts` (decodes fvar/cmap) + `tests/e2e/fonts.spec.ts` |
| **Splash sign-off list (P9d, design-language details):** (1) carousel cards crop 1080×1920 art with `object-cover` — ≈6.9 % lost top and bottom on the 680×1043 cards (author carousel art at 680×1043, or accept); (2) the card colour behind a loading slide or a peeking video, and the 0.5 s centre fade, have no Figma spec; (3) the carousel sheen uses the app-wide recipe (40 % soft-light, unrotated), not Figma's 50 % normal rotated −90°; (4) the full-bleed CTA has no scrim over operator media, so its contrast depends on the asset (keep the bottom band dark in the asset spec); (5) WELCOME says "touch anywhere to start" but a short tap in the hidden 180×180 operator corner does nothing; (6) the Arabic splash copy is a draft needing native review; (7) the bell is now decorative (`alt=""`) — the start button's accessible name is the visible copy | client | ⚠️ sign-off |
| **Splash media known limits (P9d):** a slide that errors or stalls stays skipped until the next splash visit (no in-visit retry — `ponytail:` in SplashMedia); video play count is uncapped (image dwell is capped at 1 h); `SPLASH_VIDEO_STALL_MS` (15 s) is a hardware calibration knob and a multi-day soak on the physical kiosk is owed; videos are not service-worker cached (range responses), so there is no offline video; the SW image route now covers ALL images (`request.destination === "image"`, StaleWhileRevalidate, 250 entries / 30 days, `purgeOnQuotaError`) and each opaque S3 entry counts several MB of quota | hardware / ops | ⚠️ open — UPDATE post-P9 44: non-codec failures (load_error / stalled) are retried 10 min after the LAST failure (`SPLASH_RETRY_MS`, ops knob, D9; fixed interval, no backoff); no_video is never retried within the visit; with Workbox SWR a cached error can take two retry periods to clear |
| **S7 residue (P9d):** after an outcome-unknown push, "Back to bag" then removing the reward row shows the marked claim's points as returned (BagSheet adds them on screen before the skipped revoke) — display-only, session-scoped; the reconciliation record (`order_push` reward ids + `xeno_revoke_skipped`) is analytics-only, so the `VITE_POST_HOG_TYPE` kill switch drops it outside production | maintainer | ⚠️ open |
| **Fonts lane sign-off list (2026-10-07, design language / Figma deltas):** (1) PDP title → the frame's Exp Bl 48/44, −1 px, ink purple (1:2614 / 1:4641 / 1:5823; was compressed 56/52, black); (2) the footer labels now render Exp Md as 1:2581 specifies (weight 900 → 500, visible); (3) the REWARDS INCOMING seal ring → Exp Md (125 %/500) per 1:4079, its two copies at 0 % / 50 % (one EN copy is 426 of the 440 px half ring — a longer `sealText` needs less letter-spacing or one copy); the Arabic seal text falls back to the OS font at regular weight; (4) menu-card names keep their full text (up to 4 lines) and the photo shrinks (to ~70 px) — Figma only shows 1–2-line names (alternative: clamp at 2 lines); (5) 2-line clamps with an ellipsis on the suggestion cards (/forYou, the bag rail, the rewards Suggested rail) and the buy-stage tiles; the product-added suggestions strip (no frame) stays unclamped, 3–4 lines; (6) the /forYou count pill sits at the photo strip's bottom-left (top-left, it covered the name; no frame draws it); (7) option tiles without a photo (PDP + tier-2) get `px-[44px]`, so names of ~25+ characters wrap to 2 lines instead of running under the radio (no frame has an imageless tile); pack slot cards fill their grid row so every CTA lines up; (8) the offer nudge — superseded by loyalty-visual D2 (2026-10-07): a 206 px start-aligned column, 4 lines as 1:3858; (9) the /payment and /receipt card labels and the /payment TOTAL bar → the frames' Cm Bd 48/44 at every tile count (bar 124 px as 1:3371; 16 px side padding at n = 3; Arabic labels wrap to 2–3 lines); Order Complete's PROCEED line → Title/H4 Cm Bd 34/38; (10) /second with 3–4 order types: two card rows anchored at the 2-card top (573 px) — the title 157 px below the bell, the last row 77 px above the footer; 5+ take the swipe row with the next card peeking (the fork wraps: 5–6 cards covered the bell, 7+ ran off screen); (11) the product-added "Total" is the menu bar's pre-tax subtotal while the bag's Total includes tax (1:4571 does not say which); (12) Activity Center pills px-10 → px-8 so the three labels share one line (frameless); (13) Arabic: the macOS fallback (Geeza Pro) is unaffected by `font-stretch`, but a width-variable Arabic face on the kiosk OS could condense `.tb-compressed` Arabic (on-hardware check owed, S1); the AR `pack.cal` copy wraps the price line on 189 / 152 px cards (native-review copy call); Arabic rail labels wrap to two cramped lines in the 30/24 compressed style; (14) CRAVINGS MENU wraps in the rail because of box width, not the font: a 167 px text box vs the frame's ~170 px label, so it would wrap with GT America too (a one-line fit needs a padding cut, e.g. `pl-[24px] pr-[12px]`); (15) Figma deltas NOT caused by the fonts, left as they are: the 1:3364 / 1:3377 headlines 58/56, −1.5 vs Exp Bl 64/0.85, −3; payment tiles / row 412 / 848 vs 416 / 856; the Order Complete heading 76 px vs Title/H3 48/44; the order number 112 vs Title/H1 116/98; the CancelOrderModal CTAs body bold 20 vs Exp Bl ~18 and its title 40 vs ~32 (1:4552); the LoyaltyLogin segment labels body bold vs Expanded (1:4174); (16) weight/style mismatches the real font made visible, each a one-class follow-up (`tb-display font-bold normal-case` works since the @layer move): the PDP group header (body bold 24 vs Md 20/24, −0.5, 1:5823), PDP "Show more" (body bold 18 ink/80 vs Exp Bd 16/24 #501098, −0.08, 1:1688), the bag "Edit" link (body bold 16, reportedly Exp Bd — verify on the next 1:3193 pull) | client | ⚠️ sign-off |
| **bag-pdp sign-off list (2026-10-07, design language — no frame, or beyond 1:3205 / 1:4460 / 1:2855 / 1:2814):** (1) D1, the switch screens: the confirm, the in-flight overlay (no card; scrim at 90 %, /second's precedent — at 80 % the bag rows read through), the failure dialog (TRY AGAIN / BACK; the EN body leaves one word on its last line — `text-pretty` on ErrorModal's message would fix every caller) and the removal notice; (2) D1a: a switch drops an applied offer that has free rows in the bag or that the target tab doesn't offer (the standard removal notice), bill-level and least-value offers stay and are re-checked; D1b: an offers-fetch failure aborts the switch (stricter than /second, which keeps stale offers); D1c: a DP-fetch failure is tolerated at regular prices; (3) a switch past the target DP session's cap is refused with the generic failure copy and TRY AGAIN repeats the refusal (alternative: regular prices for the over-cap units; dedicated copy would cost 0 boot bytes in `lazy.json`); (4) with 3+ order types the switch takes the first open pipeline of the other kind in list order — maybe not the one the guest picked on /second (dine_in vs table); (5) after a switch the edit PDP hides a size the new tab doesn't sell, and every committed switch clears the tent number (a guest who switches back to a table types it again); (6) kept loyalty rewards are never re-priced on a switch (a partial-percentage reward keeps the old tab's undiscounted price and taxes) — re-price or re-redeem? (client / maintainer); (7) the split edit: Figma 1:4460 read as "edit k of N" (the brief read a quantity setter), opened inside the bag (Figma draws it over the menu), titled "You have N name", EDIT dimmed at 0, the card capped at the zone − 96 px; the reused KioskNumpad draws CLEAR at 28 px with 20 px gaps (Figma 24 / 16), ~11 px either side of the label; in ADA a 4-line name puts the CLEAR / 0 / ⌫ row under the scroll fold; (8) the completion warning's non-box title "Let's finish your choices first"; (9) item 24 reuses the PDP discard dialog — sentence-case "Keep editing / Discard", and focus lands on the destructive button (the ErrorModal precedent; the APG prefers the least destructive action); (10) the 14 Arabic drafts in `lazy.json` need native review | client | ⚠️ sign-off |
| **bag-pdp residuals (2026-10-07):** (R1) the useOfferHook dead-member trim (21 members, −2,236 B gzip measured) is NOT applied — the orchestrator applies it only above 354.0 KiB CI and the merge measured 353.2; (R2) the lazy-only copy pattern (`lazy.json` + `i18n/lazyCopy`, −460 B boot) vs the 14 keys back in translation.json; item 24's logic stays on the boot path (208 B); (R3) a throw inside the switch's commit burst (plain reducer dispatches — very unlikely) shows "Your order hasn't changed" over a partly applied state (TRY AGAIN converges, BACK keeps it); a crash between the burst and the Dexie replace restores old-priced rows under the new pipeline (the window every cart mutation has); nested tier-2 pick taxes stay from the tab the item was added under; (R4) C6 is assumed — a tab menu that renames an entity, size or pick id makes the switch remove and name the row instead of re-pricing it — and a 504/505 on any switch fetch still de-registers a kiosk with a full bag (proposals C2 / C6); (R5) a DP-capped or source-missing split edit leaves the guest on the PDP with no message (like every DP rejection: TB renders no global error); PAY failures on /cart are still silent (`setShowErrorModalGlobal` has no renderer); /second neither hides device-deactivated pipelines nor passes the fresh tab type to menu charges → figma-polish (G1, S3); (R6) the fork has the same two money bugs, untouched: `Cart.tsx:1548` stores the bill's charge objects then calls `getNetAmount()` in render, and `CartItem.tsx:141-157` seeds an edit with the whole row (a size change is probably dropped); `billCalculation.js:5` logs to the console on every call (SDK, fork parity) | maintainer / user | ⚠️ open |
| **loyalty-visual sign-off list (2026-10-07, design language beyond 1:3842 / 1:3948 / 1:3858):** (1) D1 = A: a Xeno reward stays an item row in the bag (P7c locked decision 6) — no has-rewards card; (2) D2: the offer sheet and rows on the same geometry (1480 panel, 48/44 header, 152 plates, 32/36 titles, 200 px row pitch, a 206 px start-aligned nudge in ONE weight — Figma's bold "Add £X+" would need markup inside `offers.addNudge`; locked rows without a nudge stay top-aligned); (3) D3, PORTED for fork parity: while a Xeno reward is in the bag and no offer is applied, every apply path refuses (sheet SAVE, buy-stage CONTINUE, picker CONFIRM, auto-apply); the offer sheet shows the pink line "Offers can't be combined with a redeemed reward" over inert rows (no radio, nudge, ADD ITEMS or rail; SAVE disabled; every row centred) — never a "remove the reward" instruction (Xeno rows are removable only when out of stock); the asymmetry: an offer applied BEFORE the reward stays, stacks and can be swapped, and removing it then locks re-apply; the bag's Rewards entry still names the best-ranked offer while locked; (4) D4: the row title = the localized menu name + the Free / % chip; (5) D5: the second line "{n} points" ("Expires …" is blocked, proposal §12); (6) D6: the balance line "You have {n} points", on the OTP step too; (7) D6b: the operator's `reward_title_*` / `reward_subtitle_*` replace the header and `loyalty_point_alias_*` the word "points", per language slot with NO cross-language fallback (the fork falls back secondary → primary; blank = today's copy); the H3 style uppercases an operator title, a wrapped one leaves the bell at the box's start edge (UI-4; the option is an inline bell that moves with line 1), and the OTP step clamps it to 2 lines (UI-1: a 3+-line title pushed the ADA keypad under the action bar); (8) D7: REDEEM kept (it sends an OTP; Figma says SAVE SELECTION); D8: the radio kept (Figma draws no selection state); (9) the out-of-stock look (only the art at 50 %, "Unavailable", no radio) and the loading scrim while the lazy sheet's code arrives; (10) UI-5: wrapped Arabic reward names keep the left alignment (names take no `dir="auto"`; the fix would be `dir="auto"` + `text-start` on the name leaf only); (11) the Arabic drafts `loyalty.pointsBalanceLine` / `pointsBalanceLineAlias` / `pointsCostAlias` / `offersLocked` need native review | client | ⚠️ sign-off |
| **loyalty-visual residuals (2026-10-07):** (R1) the D3 guards in `selectOfferAndCommit` / `commitPickedFreebies` are unreachable from the UI (every row inert, SAVE disabled) — unit tests only; a picker CONFIRM refused in a race leaves staged rows in `cart.getItems` (never billed; the next CONFIRM, X or reset clears them); `useOfferAutoApply` still runs its bill probes under the lock before `autoApplyOffer` refuses (no write, no loop); (R2) F1 finds the reward's share ONLY by orderBuilder's "Loyalty Item" discount comment (pinned against the real engine); a fixed-type reward could drift the offer-only figure by 1p (Xeno coupons are percentage-only today); (R3) offer minimums count paid rows only — a reward's undiscounted price is in Sub Total but not in an offer's basis (a £25-minimum offer says "Add £17.00+" under a £25.00 Sub Total); (R4) the lane's four keys are boot keys in translation.json although only lazy components render them (a `lazy.json` candidate); `loyalty.pointsBalance` is now unused; `loyaltyOfferRules.ts` is the codebase's first `Object.hasOwn` (ES2022; the fork never imports it) | maintainer | ⚠️ open |

## Engineering notes (learned the hard way — don't relearn)

- **Vite 8/Rolldown CJS interop**: default-import of CJS yields the namespace →
  fixed in SDK (`createFilter`, `autoMergeLevel2`); use named imports or `es/` builds.
- **framer-motion is gone (P9f)**: every animation is CSS (rAF froze in
  occluded windows anyway) — one transform owner per element; Tailwind 4
  translate/scale/rotate are separate properties that compose.
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
- **Two money paths since P8b.** Pay-at-counter = `pushOrder` with
  `payment.paymentType` exactly `"PAY_AT_RESTAURANT"` (or `""` on the zero-bill
  loyalty path): its three-way switch places NO order for NI/Paytm values, so a
  stale type is a success screen for an order that does not exist (directOrder
  clears a leftover Paytm type). Paytm = the BACKEND places the order from the
  `order_details` frozen at initiate, on its webhook or on ANY status read; the
  paid tail is `recordOrderLocally` (bookkeeping, no RTK call), never
  `pushOrder`. The gateway seam `resolveKioskGatewayKind` is still unused in TB.
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
  The same spread re-committed a VARIANT row's OLD size on edit: edits build
  with the SDK's `buildVariantEditCommitPayload` (session fields back on top).
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
  SDK banner walk, the media merge and `clearMediaDataConvertedItems` are
  guarded (post-P9 25a); banners are still not stored (D1, user 2026-10-06). The e2e `**/api/**` catch-all answers getMedia with
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
- **Tests are type-checked (P9f).** `tsc -b` (yarn type-check, yarn build, CI)
  covers unit tests through `tsconfig.test.json` and e2e through
  `tsconfig.e2e.json` — a test or spec type error fails the build. Include
  globs need `/**/*` (TS5010 rejects a trailing `**`), `exclude: []` must be
  explicit (or the inherited app exclude drops every test), and each project
  owns its tsbuildinfo under node_modules/.tmp.
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

- **Arabic runs are FSI…PDI-isolated (P9f)** by the i18n post-processor
  (`bidiIsolate`) plus the interpolation `escape` hook in `src/i18n/index.ts`:
  in an RTL language every translated string and every interpolated value is
  a first-strong isolate, so numbers, prices and Latin names inside Arabic
  stay LTR; English is byte-identical. Assert Arabic via `i18n.t()` (exact
  matchers compare the wrapped value) or substrings — never literal Arabic in
  an exact matcher, never a substring that spans a {{placeholder}}.
  An all-placeholder Arabic template resolves LTR (no strong character) and an
  Arabic value then reads backwards: open it with U+200F as the JSON escape
  `\u200f`, never a literal bidi character (`loyalty.pointsCostAlias`).
- **Never `dir` on a flex/grid container** (rows, grids, `justify-between`,
  `start-*` and scroll origins mirror). `dir="auto"` goes only on wrapping
  leaf text (+ `text-start` under a physical `text-left`); today the offer
  row's second line and nudge, and the PDP description. Caveat: HTML
  `dir="auto"` takes the first strong character ANYWHERE in the leaf,
  including inside value isolates, so Arabic
  copy that starts with a Latin {{value}} (offers.removedBody) resolves LTR.
- **PostHog loads lazily (P9f):** `startAnalytics()` right after
  `setAnalyticsPort()`; the kill switch is compile-time (off = not shipped,
  never fetched); pre-load calls queue (cap 100) and replay in order; any
  failure = analytics off for the page load. `posthogRuntime.ts` is the only
  importer and chunkRecovery exempts `/fcmRuntime|posthogRuntime|paytmRuntime/` (renaming
  any of them restores the reload). Load optional lazy chunks with
  `await import()`, NEVER `import().then(handler)`: Vite moves a chained
  `.then` into `__vitePreload`, so a failed chunk skips the handler and a
  handler throw becomes `vite:preloadError` → reload.
- **The bundle gate budgets the BOOT PATH** (`scripts/check-bundle-size.mjs`):
  the module script in `dist/index.html` plus every `<link rel="modulepreload">`
  chunk, gzip level 9, KiB = 1024 B; TOTAL = page JS incl. lazy chunks, SW
  scripts excluded and listed. The ENTRY budget (355 KiB) = ceil5(measured +
  10) and is raised only with user approval; every bad input fails closed.
- **e2e: `page.waitForTimeout` is lint-banned under tests/e2e.** Wait on state
  (expect / expect.poll / waitForResponse) or drive time with `page.clock`;
  expect.timeout is 10 s. To prove a negative over a window, sample with
  `expect.poll` until the window closes (fcm.spec E10). Long-press: keep the
  mouse down until the result is visible. After an RTK request, poll the
  store's `api.mutations` until the entries are `rejected` (fcm.spec E12).
- **Overlay-button pattern (P9f)** for a clickable card with a nested control:
  the container keeps the testid and `relative`, no onClick; a named
  `<button type="button" class="absolute inset-0">` opens it and goes LAST in
  the DOM (a later stacking-context sibling would paint above it and leave a
  dead tap zone); the nested control is `relative z-10`. jsdom tests click the
  overlay by role; e2e clicks the container centre or `getByRole("button",
  {name})`. Playwright refuses to click under `aria-disabled="true"`.

- **Names are resolved at RENDER** (`src/hooks/utils/useLocalized.ts`: name /
  description / pipelineName / text) — never write a result into cart/order
  state, dispatch payloads, addEntity args, analytics, React keys or Dexie;
  the push stays primary-language. In RTL they are FSI…PDI-isolated like i18n
  values; descriptions are a shrink-to-fit (`w-fit`) `dir="auto"` leaf.
- **The tenant recommendation map lives in Dexie + memory, never
  redux-persist** (the store is ONE `persist:root` re-serialised on every
  change), and its S3 fetch never uses the RTK transport (it would send the
  device auth headers): bounded, bound to its source URL, last good map kept.

- **ONE lazy bag chunk (offers lane):** the bag's lazy surfaces (the Complete-
  Your-Meal rail, BuyStageSheet, the celebration) share
  `src/components/cart/bagLazyParts.ts`. A separate `React.lazy` import makes
  Rolldown hoist their shared code into an extra chunk that loads at startup
  (measured +3.7 KiB on the boot path) — new lazy bag parts go into
  bagLazyParts (since P8b it holds all lazy UI — see "ONE lazy UI chunk").
- **Offer get entries: the item id is `baseItemId || _id`.** Non-cluster
  offers arrive with `baseItemId: null` and the item id in `_id` (only
  cluster-synced offers fill baseItemId); match rows exactly like the
  converter (`matchesGetItemEntry` in the SDK's offerCommitRules). Live
  group-wise get entries are "or"-only with `quantity: null` and no per-item
  value — the commit must carry the picked units or it grants £0.
- **BagSheet's empty-cart exit** fires only after the bag has held rows while
  open, or once AppRoutes' Dexie sync has settled (`CartRehydratedContext`);
  revalidation skips an empty cart — so a reload on /cart keeps the bag,
  rows and the applied reward.

- **Paytm ids are stored and `await persistor.flush()`ed BEFORE the initiate**
  (redux-persist writes on a timer — the request left ~11 ms before its ids hit
  disk) and re-flushed when a refusal clears them. A reload (`PaytmResumeGuard`:
  decided once, navigate-only — loop-free only while every /paymentPolling →
  /payment exit empties the slice) and an outcome-unknown initiate (timeout,
  lost body, FETCH_ERROR, ≥500) both settle by status with the SAME ids.
- **A Paytm status read answers for the phase it was SENT in:** entering
  cancelling / settling clears the reducer's `lastPoll` and bumps the hook's read
  epoch (the deadline inside the 1 Hz tick task, not a passive effect); stale
  answers drop unless "paid" (paid always wins; a paid read stops all reads).
  The one EDC void needs a FRESH "pending" — `classifyPaytmKioskPoll` makes
  `{ error }` and non-envelopes "error", never "pending".
- **`/start` order:** Xeno revoke → `releasePaytmSession()` (bodies built first;
  one status read; EDC void only on a fresh "pending"; fire-and-forget) →
  `resetSession("full")`, which clears every Paytm field, on disk too.
- **D3:** `RECOVERY_EXEMPT_ENDPOINTS` = telemetry + `PAYMENT_GATEWAY_ENDPOINTS`
  (service typed `any` → transportTimeout.test guards the names); status-less EDC
  errors stay unreachable only while those endpoints have no `transformResponse`.
- **The Paytm screen is the lazy `paytmRuntime` chunk** (stable name; chunkRecovery
  exempts it). A failed `import()` stays failed for the page's life, so the
  checkout awaits `loadPaytmScreen()` BEFORE any id and refuses without it (the
  next splash reloads the page). No React.lazy + Suspense: its 300 ms reveal timer
  never fires under a frozen Playwright clock. Lazy code imports SDK subpaths,
  never the `@cx-sdk/core` barrel (Rolldown hoists a vendor chunk onto the boot
  path). `react-qr-code` is CJS: the NAMED `{ QRCode }` + its d.ts, static.
- **Browser Back trap (AppRoutes):** React 19 renders a popstate transition
  synchronously and `window` runs popstate listeners in registration order, so
  the trap is a `useLayoutEffect` below BrowserRouter (ahead of its listener): a
  TRUSTED pop is `stopImmediatePropagation()`ed and the entry re-pushed; script
  pops pass. The old trap never worked (Back reopened /receipt: a second initiate
  or placeOrder). Never `navigate(-1)`; checkout.spec BROWSER BACK guards it.
- **`overflow-clip`, never `overflow-hidden`, on a root that can be 1122 px
  (ADA) with larger transformed children:** a hidden root is a scroll container
  that focus / `locator.click` scrolls (399 px) and never scrolls back.
- **Test seams:** `window.__kioskStore` is DEV-only (production-build e2e asserts
  network counts + DOM); dev StrictMode aborts the print fetch before
  `page.route` sees it — observe it with `page.on('request')`; step vitest fake
  timers in ≤1 s acts (React runs no effects inside one act).
- **ONE lazy UI chunk, operator UI included (P8b merge 2):** `bagLazyParts.ts`
  also carries RewardsSheet, FreebiePickerSheet and the Activity Center's
  ActivityModal (merging offers + P8b put the CI boot path at 359.5 KiB; these
  cuts made it 352.7). ANY extra lazy chunk, even a tiny one, makes Rolldown
  split the boot path into preloaded chunks (+~5 KiB measured) — new lazy UI
  joins bagLazyParts. Until its code arrives a lazy surface shows its own named
  scrim that closes on tap (plain state + `await import()`, no Suspense).
  Since bag-pdp + loyalty-visual: 12 exports, loaded by BagSheet, the Activity
  Center, the PDP and the menu (its always-mounted Xeno rewards sheet, so the
  chunk loads at /menu entry; the scrim fallback reads the open flag itself —
  Menu must not); still ONE chunk.
- **A failed lazy load sticks for the page's life, so it schedules the healing
  reload:** `loadPaytmScreen` / `loadActivityModal` dispatch
  `initiateWholeAppUpdate()` on a null load and the splash reloads at its next
  dwell. Residual: a guest who reaches the bag before that dwell, on a page
  under 60 s old, meets the failed chunk (crash screen at /cart).
- **No reload cuts the splash's Paytm release:** `holdReloadsUntil`
  (chunkRecovery) makes chunk recovery and `reloadTo` (whole-app update, crash
  recovery) wait for it, capped at 20 s (Rule 2). The hold is module state — a
  test that hangs a release gets its own file. Logout and lost-login redirects
  are not held.
- **Testing Library `findBy*` hangs under vitest fake timers:** await the loader
  inside `act()` instead.

- **Fonts: ONE OFL `Archivo` variable family (wght 100–900 × wdth 62–125),
  widths by `font-stretch`** — body 100 %, `.tb-compressed` 62 %/700,
  `.tb-display` 125 %/900, both classes in `@layer components` so a
  same-element utility wins. Keep each `@font-face`'s `font-stretch: 62% 125%`
  (Chromium infers it; other engines may pin 100 %). The `font` shorthand
  takes stretch KEYWORDS only (`"extra-condensed 700 30px Archivo"`; a `62%`
  throws); `document.fonts.check()` passes a family with no faces. Verify
  font files by decoding fvar/cmap (`fonts.test.ts`), never by name.
- **Quote assets in a CSS `url()`:** Vite inlines small SVGs as data URIs
  carrying `'` `(` `)`; `url(${asset})` is then invalid (a mask paints a solid
  square). Write `url("${asset}")`.
- **Typography/layout regression net:** the capture-only walks visual-entry,
  -order, -offers, -payment (EN / AR / ADA) run `fixtures/clippedText.ts` soft
  after every shot; rerun them for any font, size or layout change (an intended
  crop = line-clamp / ellipsis or a positioned badge). CI: visual-order's
  photo-shrink checks need the S3 photos, and two kills are Arabic-only (the
  Linux OS Arabic font differs).
- **A missing `public/` file answers 200 with index.html** (SPA fallback):
  assert the content, never the status.
- **One Playwright run per dev-server port at a time:** the run that started
  the server stops it on exit and kills the rest (ERR_CONNECTION_REFUSED).

- **Order-type switch = stage, then ONE burst (bag-pdp).** The charges and menu
  fetchers route every dispatch / localStorage write through `{apply, mirror}`
  (default dispatch; byte-identical without, pinned); `useOrderTypeSwitch`
  commits after the last await in one synchronous burst (selection, staged
  charges + menu, the final `pushCharges`, `setCartItems`, `setTent("")`) and a
  failure writes nothing. Never call those fetchers un-staged mid-order; a size
  row's own `variants` is money, re-priced too.
- **A split edit is ONE write:** planned on `store.getState()` at commit time
  (`planSplitEditCommit`), committed as one `setCartItems` + one Dexie replace.
- **Lazy-only copy lives in `src/i18n/locales/{en,ar}/lazy.json`**, registered
  by `src/i18n/lazyCopy.ts` from lazy modules only (never shadow a boot key).
- **Never dispatch a live bill or engine object into redux:** Immer freezes
  what the store holds and the memoised bill writes its own rows on the next
  render (PAY threw on any deployment with a charge — now `structuredClone`).
- **D3 + F1 live in the new SDK file `ordering/src/loyalty/loyaltyOfferRules.ts`**
  (by subpath): `isOfferLockedByLoyaltyReward`, `getBillLoyaltyDiscount` — the
  Xeno share of a bill is found ONLY by orderBuilder's "Loyalty Item" comment.

## Session log

- **2026-10-07 (loyalty-visual merged)** · Lane `loyalty-visual` (11-agent lane
  workflow on a read-only mapper's contract): the Xeno REWARDS sheet reskinned
  to Figma 1:3842 / 1:3948 (item 39a: 1480 sheet, 152 plates, the subtitle and
  a balance line, an out-of-stock reward in the 1:3858 look) and lazy-loaded
  from bagLazyParts behind a named scrim (D9: CI boot path 352.9 → 351.5 KiB);
  the offer sheet on the same geometry (D2); the fork's offer lock while a Xeno
  reward is in the bag, with its offer-first asymmetry (D3); the applied-offer
  row and the celebration show the offer's own saving, no longer the reward's
  (F1 / D12 — the total never changed); the operator's reward title, subtitle
  and point alias per language slot (D6b). One additive SDK file
  (`loyalty/loyaltyOfferRules`); the fork's `src/` byte-identical. Item 43
  re-checked (three `download_assets` probes: loading and error posters only,
  an animated card GIF not built); expiry, per-reward minimum and order-level
  rewards documented as BLOCKED (proposal §12). Reviewers found no money or
  flow defect; they caught Menu re-rendering its whole card grid on every sheet
  open / close, a 3+-line operator title pushing the ADA OTP keypad under the
  action bar, D3-blocked rows top-aligned and a 201 px row pitch — all fixed;
  the integrator moved one e2e waiter before /menu (the shared chunk now loads
  there). The e2e author found that a failed lazy chunk reaches the boundary
  only on React's retry (~300 ms after the fallback), so a one-shot "no crash
  screen" check passed with the boundary deleted (E2b now samples 1.5 s), and
  the pre-existing frozen auto-dismiss bar (→ figma-polish). Tests: +114 unit,
  +14 e2e (`loyaltyOfferLock` 5, `loyaltyRewardsSheet` 6, `visual-loyalty` 3);
  main after both merges: unit 2,506, e2e 304. Mutation checks: unit 60/61 (author, 1
  equivalent) and 33 (verifier: 26 + 4 after strengthening + 2 reverse checks,
  1 equivalent); e2e 6/6 (author) and 57 (verifier: 44 + 10 after
  strengthening, 1 equivalent, 2 unreachable from the UI and killed by unit
  tests).

- **2026-10-07 (bag-pdp merged)** · Lane `bag-pdp` (13-agent lane workflow + a
  5-agent integration with main: merge, visual, money fixes, review, fixer):
  the in-bag EAT IN / TAKE OUT switch (item 19: staged fetchers, re-price,
  removal notice, offer re-check, one commit), the 1:4460 split edit (item 20),
  the PDP completion warning (1:2855) and SlotSelectionSheet on 1:2814 (item
  23), the tier-2 removal confirm (item 24), item 30 closed by tests, items 21
  / 22 and the portion levels BLOCKED on data (proposals §9–§11). SDK: five
  additive files (`cart/orderTypeTarget`, `cart/orderTypeSwitch`,
  `cart/splitEdit`, `customization/incompleteGroups`,
  `customization/variantEditCommitPayload`) + `removeTier1Selection` appended
  to `tier2Logic`; the fork's `src/` byte-identical. Reviewers caught a switch
  that bypassed the DP session cap and one that kept a Xeno reward the new tab
  can't serve (money — now refused / reversed and named), item-30 pins claimed
  but missing, the tier-2 confirm and the numpad without dialog semantics or
  focus, and the boot path over budget (355.3 KiB: the completion warning, the
  split planner and the 14 strings moved into the lazy chunk) — all fixed. Two
  money bugs already on main, found by the lane and fixed at integration: PAY
  threw during render on any deployment with a charge (the store froze the
  memoised bill's charge rows — `structuredClone`), and a bag edit of a size
  row re-committed the old size (SDK `buildVariantEditCommitPayload`). The
  integration review caught a size change after a switch charging the old tab's
  price (the row's size list is now re-priced) and a table number typed before
  a switch riding the take-out order (the commit clears it), and corrected the
  lazy-chunk comments; the visual pass raised the in-flight scrim to 90 % (bag
  rows read through it with the real font). CI boot path 352.9 → 353.2 KiB.
  Tests: unit 2,195 → 2,392, e2e 257 → 290 (+197 / +33; `orderTypeSwitch` 17,
  `visual-bagpdp` 6, bag 4, pack 5, ada 1). Mutation checks: unit 27/27
  (author) and 113 (verifier: 96 + 16 after strengthening, 1 equivalent); e2e
  11/11 (author) and 61 (verifier: 49 + 10 after strengthening, 2 equivalent);
  every integration fix fails its unit and e2e check when reverted.

- **2026-10-07 (fonts merged)** · Lane `fonts` (12-agent lane workflow + a
  5-agent integration with main: merge, two visual builders, review, fixer).
  The font files had been mislabelled since P1 (the body rendered
  ExtraCondensed Thin with faux bold, `.tb-compressed` at normal width): now
  ONE OFL Archivo variable family (Google Fonts v25, latin + latin-ext for ₹;
  licence `public/fonts/OFL.txt`, shipped in dist; precache +110,152 B) at
  three widths by `font-stretch`, the two classes in `@layer components` (the
  footer now renders Figma's Exp Md). Visual pass on BEFORE/AFTER capture
  walks against the frames: Activity Center pills px-8, menu-card photos yield
  to long names, suggestion names clamp, PDP title → Exp Bl 48/44. Reviewers
  caught: pack slot CTAs 18 px out of line when one slot's name wraps above
  a price line, imageless option-tile names under the radio, the PDP title's
  tracking and colour, the seal ring (now Exp Md), the OFL text missing from
  dist, `font-display` unpinned — all fixed. Integration (main's menu-data,
  offers and P8b merged at 38baefa; one conflict, the PDP h1): the payment
  labels, TOTAL bar, PRINT/EMAIL and PROCEED back to Figma's Cm Bd
  (superseding P8b's 24 px n=3 labels), buy-stage names clamped, the /forYou
  count pill off the name, six bell masks quoted (the inlined SVG made the
  unquoted `url()` invalid — they painted as squares), /second with 3–4 order
  types kept under the bell and 5+ on the swipe row; and two bugs already on
  main: the Select-a-Size row billed NaN in the bag (no `variantPrice`, since
  1bfd95e) and the product-added Total read £0.00 (the bag-only `netAmount`)
  — both fixed and pinned by bag.spec SIZE FAST LANE. Deferred: a size with
  modifier groups adds nothing. Tests: unit 2,183 → 2,195, e2e 203 → 257 (+12 unit:
  `fonts.test.ts`; +54 e2e:
  fonts 2, visual-entry 9, visual-order 6, visual-offers 22, visual-payment
  14, bag 1); no existing e2e assertion moved (Archivo's vertical metrics are
  identical at every width), two unit tests follow the new payment label
  classes and the /second layout. Mutation checks: unit 39/39 (author) and
  22/22 + 1 equivalent (verifier, 6 after strengthening); e2e 38/38 (15 after
  strengthening, e.g. the OFL check asserts the text, the hero carries a
  4-line name); every integration fix fails its check when reverted. The
  main gate also exposed a load-dependent P8b unit test (the idle-hold
  release runs in a passive-effect cleanup after findBy sees the panel) —
  it now waits for the release (f4f4cf0, mutation-checked).

- **2026-10-07 (P8b merged)** · Lane `p8b-paytm` (14-agent lane workflow + a
  5-agent money follow-up + two merge integrations with main): Paytm Dynamic
  QR + Paytm EDC — two additive SDK modules (`gateways/paytmKiosk`, the pure
  `settlement/paytmKioskSettlement` reducer; fork byte-identical), the
  `/payment` tiles, the `/receipt` initiate, `/paymentPolling` (Figma 1:3404,
  PleaseWait 1:4456, ErrorModal panels), the UPI QR via `react-qr-code`, the
  `/start` release, D3, a 240 s payment idle hold, S7 parity, reload resume
  with the SAME ids, and the screen as a lazy chunk (merge 1 had put the boot
  path at 362.8 KiB vs 355). Reviewers caught: browser Back never blocked
  (HIGH — a reopened /receipt allowed a second initiate, and the same hole let
  P8a COD place a second order from Order Complete), an EDC void licensed by a
  read sent before the deadline, a read after "paid", ADA roots scrolling
  399 px, a reload mid-initiate orphaning an armed terminal, ids reaching disk
  after the request, the QR visible to PostHog replay, one failed chunk load
  breaking every later checkout, no idle hold while it loaded — all fixed.
  Merge 2 with offers: three union-resolved conflicts; the boot path cut
  from 359.5 to 352.7 KiB (CI) by moving RewardsSheet, FreebiePickerSheet and
  the Activity Center into the one lazy chunk; its review caught a failed
  Activity load poisoning the next guest's bag chunk and a /start reload
  able to cut the Paytm release — fixed (healing reload at the next splash
  dwell; reloads wait for the release, capped at 20 s), 8/8 mutants killed.
  Unit 1,789 → 2,183, e2e 169 → 203 (+394 / +34); mutation
  checks 36/36 SDK, 63/63 + 63/64 unit, 13/13 + 30/31 e2e (lane), 49 unit +
  12 e2e runs all killed after strengthening (follow-up), every merge-1 fix
  mutation-checked.

- **2026-10-07 (offers merged)** · Lane `offers` (14-agent lane workflow + a money
  follow-up + a merge integration with main): the BOGO buy stage with the
  sameOrLess ceiling TB never enforced, customizable freebies via an in-bag
  PDP (OfferTierHost), EXACT group-wise picks (it fixed a pre-existing
  over-grant — "pick 2 of 4" gave all 4 — and a £0 under-grant on live "or"
  offers), the non-blocking celebration, operator-flagged auto-apply, a
  reload on /cart that keeps the reward, orphaned free rows dropped after a
  crash, zero-value group offers refused. Reviewers caught: a size-specific
  freebie charging the difference (HIGH), a £0 item offer showing "Reward
  applied!", a picker over-grant widening, the 4a fix dropping legitimately
  applied free rows when the backend sends `baseItemId: null` (the normal
  case) — all fixed. Offer photos + T&C stay blocked on backend data
  (proposal §8 added). Unit 1,539 → 1,789, e2e 134 → 169; mutation checks
  43/48 + 55/56 (lane), 28/28 (follow-up), 10/10 + 2/2 + 6/6 (merge).

- **2026-10-07 (menu-data merged)** · Lane `menu-data` (13 agents; its fix stage
  resumed after the laptop slept on battery): Arabic menu + pipeline names at
  render, tenant cart recommendations (env URL, Dexie + memory, outside the
  transport) + boot prefetch, MIAM texts at boot, the Figma 1:5263 scroll
  indicator, the splash in-visit retry (10 min knob), operator ticker copy at
  the designed speed, and the SDK banner-walk / merge / reducer guards (a
  stored banner key can no longer blank /menu). Reviewers found 5 issues
  (short Arabic PDP descriptions floating right, a silent empty feed, a stale
  Dexie copy from another URL, ticker speed) — all fixed. The orchestrator
  added: per-item names on the tier-2 sheet's steppers (a11y) and isolates not
  counted in the ticker speed — and caught + fixed literal bidi characters
  the edit tool had written into source (escape sequences only). Unit 1,318 →
  1,539, e2e 121 → 134; lane mutation checks 67/67 unit, 25/26 e2e (the
  survivor is unit-covered). P8b, offers (money follow-ups) and the font lane
  are in flight.

- **2026-10-06 (P9f app half + lanes)** · Development moved to **parallel git
  worktree lanes** (user choice 2026-10-05: commit + worktrees, one workflow
  per phase): `../tb-<lane>` siblings with their own installs and ports
  (`TB_E2E_PORT`, 5374+), at most 3 at once; the orchestrator gates, commits
  and merges each lane into main (never pushes). The first night's lanes
  stalled because the laptop slept on battery (a `caffeinate -s` assertion now
  keeps it awake on AC). **Lane `p9f-app` merged** (13-agent lane workflow):
  Arabic as FSI/PDI-isolated RTL runs in the LTR layout; a11y fixes (overlay
  buttons for menu cards and the applied-reward row, named dialogs, read-only
  textboxes, 44 px PDP toggle, contrast, aria-disabled dimmed rows, " Cal" and
  PDP labels through i18n, the bag hides LOG-IN & GET REWARDS on loyalty-off);
  lazy PostHog + framer-motion removed (boot path 478.2 → 344.4 KiB gzip-9) and
  a fail-closed boot-path budget (reviewers found it first ignored
  modulepreload chunks — fixed); tsc -b type-checks tests and specs;
  `page.waitForTimeout` banned; the per-PR CI e2e job (2 shards). The
  orchestrator also fixed a pre-existing Registration timer leak (one dismiss
  timer, cleared on unmount — new test, both halves mutation-checked). Unit
  1,216 → 1,318, e2e 119 → 121 (P9e e2e strengthening); lane mutation checks
  41/44 unit + 34/36 e2e caught (rest equivalent or caught by unit). Merge fix:
  fcm.spec E10's 1 s settle became an `expect.poll` window (re-verified 3/3
  against a notification-showing worker). Also today: the P9e e2e mutation
  pass (57/58), `docs/BACKEND_CONTRACT_PROPOSALS.md`, user decisions (India
  deployment; Paytm DQR + EDC with `react-qr-code@2.0.15`; Xeno only; banners =
  guard only; search descoped), and the mislabelled-font finding (queued).

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
