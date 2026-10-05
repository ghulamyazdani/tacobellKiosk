# Taco Bell Kiosk — Build Tracker

> **The living status doc for this project.** Updated at the end of every
> work step — if you finish (or descope) anything, update this file in the
> same change. Plan reference: the approved phase plan (P0–P9); UI source of
> truth: Figma `33e5briUYJiBqxv6P0AbqY`; logic source of truth:
> `@cx-sdk/*` (linked from `../posistKiosk-cx-sdk/packages`).
>
> Last updated: **2026-09-30 (P7b)** · Gates at last update:
> **unit 155/155 · e2e 28/28 · tsc/eslint/depcruise 0 · guardrails 0 critical · build+PWA green**

## Phase status

| Phase | Scope | Status |
|---|---|---|
| P0 | Scaffold: Vite 8 / React 19.3 / TS 5.9 / Tailwind 4, cross-repo @cx-sdk link, all gates wired (tsc, strict ESLint, depcruise-in-validate, guardrails, CI, CLAUDE.md) | ✅ done |
| P1 | App shell: createKioskStore + persistence manifest (19 SDK + 6 UI slices + RTKQ), transport + 401/5xx session recovery, analytics port, Dexie, chunkRecovery, hardening, router+guards, PWAUpdateHandler, Figma splash | ✅ done |
| P2 | Design system: folded into per-screen work (tokens `tb-*`, fonts, KioskStage, chrome components built as screens landed) | ✅ absorbed |
| P3 | Auth + boot: Registration (license→authApi), LoadingResources (language→skin→pipelines→theme→settings), stale-token 401 → auto-logout | ✅ done |
| P4 | Order type: pipeline cards + open/closed states, daypart ticker, footer bar, language sheet (EN↔AR RTL live) | ✅ done |
| P5 | Menu: category rail, hero/grid cards, price+cal, UNAVAILABLE, TOTAL/VIEW MY BAG bar; hook vertical ported (~3.2k lines); real fetchMenu→converter e2e over StandardMenu fixture | ✅ done |
| — | Activity Center: hidden 3s top-left hold on splash → operator diagnostics (info rows, passcode-gated fullscreen toggle, logout) | ✅ done |
| P6 | PDP/customization — **P6a ✅** quick-add spine · **P6b ✅** PDP bound to useCustomization Tier1-style (all groups one Figma scroll, defaults seeded, min/max via commit, VARIANT+CUSTOMIZABLE commits, return-path navigation) · **P6c ✅** Order-a-Pack slot cards + SELECT sheets, tier-2 nested customize, BYO via generic group path, MIAM upsell prompt · repeat-sheet → P7 | ✅ done |
| P7 | Cart + Offers + Loyalty + ForYou — **P7a ✅** My Bag sheet over /menu (route-driven /cart): rows w/ addon lines + steppers, remove-confirm + cancel-order modals (session reset), edit-from-bag (PDP edit mode), repeat sheet, Complete-Your-Meal rail (cart-upsell engine), checkout preflight → /checkout stub, Dexie crash-recovery rehydrate · **P7b ✅** Rewards/offers sheet (Figma reward-states adapted to CX mechanics), apply/swap/remove cores, freebie flows (atomic + picker), bill Discounts line + ORDER & PAY, six-check revalidation + removal notice · **P7c 🔲** rewards/loyalty · **P7d 🔲** /forYou pre-cart upsell | 🔄 P7a+b done |
| P8 | Checkout + Payment + Success: phone/name/tent/email-receipt step, PaymentSelection (pay-at-counter/COD rules), Polling settlement machines (9 gateways, terminal WS bridges), order push, OrderSuccess 3-step + print | 🔲 |
| P9 | Close-out: idle-timeout modal ("You have been inactive"), ADA/accessibility view, FCM + auto-update e2e, proximity welcome, full e2e parity suite (happy path, cart mgmt, payment failure, idle, multi-language, error recovery, a11y), bundle/perf budgets, media/banner pipeline for splash poster | 🔲 |

## What exists right now (flow you can walk)

`/` Registration (license code + on-screen keyboard) → `/LoadingResources`
(real boot; 401 ⇒ auto-logout) → `/start` Figma splash (+ hidden 3s top-left
hold ⇒ Activity Center) → tap ⇒ `/second` WHERE ARE YOU EATING (CX pipelines)
→ pick ⇒ real menu fetch+convert ⇒ `/menu` (rail, cards, OOS, totals bar) →
item tap ⇒ `/customization` PDP (single product, variant fast-lane, pack slot
cards + SELECT sheets + tier-2 nested customize) ⇒ ADD TO BAG; upsell-tagged
items ⇒ MIAM prompt (accept ⇒ pack PDP · decline ⇒ item by shape); re-tap of
an in-cart customizable ⇒ repeat sheet → `/cart` MY BAG sheet (rows, edit,
remove-confirm, Complete-Your-Meal rail, Rewards section → REWARDS sheet
(radio + SAVE SELECTION, locked-gap nudges, suggested-items rail, freebie
picker), Discounts line, Sub Total/Total via bill engine) ⇒
PAY preflight ⇒ `/checkout` (P8 stub). Cancel Order ⇒ confirm ⇒ full session
reset ⇒ `/start`. Cart survives a crash/reload via Dexie rehydrate.
Language switch EN↔العربية anywhere via the footer.

## Deferred-in-place (wired later, marked with TODOs in code)

- "Apply to the following burrito" slot-copy toggle (Figma 1:4641) → P7 polish
- EAT IN / TAKE OUT toggle in the bag is READ-ONLY: a mid-session pipeline
  switch needs setSelectedPipeline+setSelectedTabId+charges refetch+setTabType+
  fetchMenu+cart revalidation (fork has NO such path) → P7 later, decide UX
- Edit-quantity numpad modal for multi-qty rows (Figma 1:4460) → P7 polish
- LOG-IN & GET REWARDS button inert ("coming soon" pressed state) → P7c
- Checkout routes (tent/payment/customerName/phone) all land on /checkout stub → P8
- Cart recommendations S3 source (tenant map, useRecommendationHook) → later;
  P7a rail ships the isCartRecommended engine source only
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
- Media/banner conversion + cluster settings + MIAM texts + loyalty partner +
  recommendations prefetch in the boot loader → P4 leftovers noted in
  `hooks/utils/useLoaders.ts` (land with their phases)
- Payment settings fetch + Geidea/NeoLeap socket connects at boot → P8
- ADA toggle dispatches the SDK flag; the scaled accessibility VIEW → P9
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
| Bill math in the bag: billCalculation rounds the TOTAL to whole units unless deployment carries `{name:"disable_roundoff",selected:true}`, and fixture items carry exclusive VAT@15% — so bag/checkout total = round(subtotal×1.15) while the menu CTA shows the plain subtotal (fork-faithful). Maintainer: confirm round-off/VAT deployment settings for TB UK + whether the CTA should show the taxed total | maintainer | ⚠️ open |
| P6c surfaces partly design-language: Figma MCP rate limit (Starter plan) blocked the pack customize-family frames (`1:4895`…), BYO frames (`1:5264`…), completed/warning pack states, and MIAM has no frame — built from the 4 pulled frames' language; needs a visual pass once frames are pullable | client review | ⚠️ open |
| Payment gateways for TB UK deployment (which of the 9 apply) | client | ⚠️ open |

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

## Session log

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
