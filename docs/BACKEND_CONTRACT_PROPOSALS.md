# Backend contract proposals — Taco Bell kiosk

> **Status: PROPOSAL, 2026-10-06** · **For:** the CX backend team · **From:** the Taco Bell kiosk (`tacobell-kiosk`)
>
> User decision 2026-10-05: write one concrete contract for each kiosk feature that is blocked on missing backend data or endpoints. The gaps come from `docs/PROGRESS.md` (*Open decisions* and *Deferred*). Every name below is only a proposal, so rename freely, but please answer each **Open question**.
>
> **How to reply:** for each item, answer ACCEPT, CHANGE (and what) or REJECT (and why), then answer its open questions. Section **C** needs answers only. It adds no new API.
>
> Code refs: `src/…` is this repo. `sdk/…` is `../posistKiosk-cx-sdk/packages/…` (the shared `@cx-sdk/*` packages). Figma refs are nodes in file `33e5briUYJiBqxv6P0AbqY`.

## At a glance

| # | Feature (Figma) | Blocked on | Proposed contract | Kiosk today |
|---|---|---|---|---|
| 1 | Email receipt (1:3377, 1:3383) | No field for an address, and nothing sends receipts | `enable_email_receipt` setting + a `receipt` block on placeOrder | EMAIL tile is inert |
| 2 | Order Complete QR codes (1:5932 guest, 1:3437 promo) | No source for the URL or the points | placeOrder response `order_complete.earn` + getMedia slot `order_complete` | Panel ships without a QR |
| 3 | Make-it-a-meal (MIAM) "SAVE £X" badge (1:3070) | No was-price in the menu | getMenu `comparePrice` on meal entities | Badge built but hidden |
| 4 | Bag rail vs `/forYou` | One flag controls both | get_kiosk_settings `enable_cart_upsell_rail` | One flag for both |
| 5 | Activity Center passcode | A static passcode in the JS bundle | `POST /api/cx/kiosk/verify_operator_passcode` | Hardcoded |
| 6 | Xeno SCAN APP login (1:5881) | No QR format and no lookup | `TBR1.` app token + `check_loyalty_balance_by_token` event | Tab inert, no scanner |
| 7 | Resend OTP (reward redemption) | No endpoint | `resend_redemption_otp` event | No resend button |
| 8 | Offer photos + terms & conditions + expiry (1:3924, 1:4009, 1:4044) | The offer payload has no image, terms or validity | `imageUrl`, `terms`, `validTill` on `get_cx_valid_offers` | Bell placeholder; no T&C rows |
| 9 | Nutrition values + allergens (1:5823) | Every nutrient value is 0, the units are wrong, allergens are dropped | Real values with fixed units per item and size; `allergens` as codes | Calories only, when above 0 |
| 10 | "Apply to the following burrito" (1:4641) | No payload models repeated bundles | `bundleKey` + `bundleIndex` on `_combo` groups; shared constituent ids | One flat slot grid, no copy toggle |
| 11 | Ingredient portion levels NONE / REGULAR / EXTRA (1:3007, 1:3037, 1:5477) | No level or per-level price in the menu | A `levels` list (code + price) per default ingredient | Add / remove picks only |
| 12 | Xeno reward expiry, minimum order, order-level rewards (1:3824, 1:3858, 1:3924, 1:3137) | `check_loyalty_balance` coupons carry no validity, no minimum and no bill-level path | `valid_till`, `min_bill_amount_for_redemption`, `discount_on: "bill"` + `amount` per coupon | "{n} points" line; out-of-stock state only |
| C | Idempotency, 504/505 (now also the in-bag order-type switch), MENU_ID, update ack and version, FCM, ids across tab menus | Answers only | — | See §C |

## Ground rules (apply to every item)

1. **Changes are additive.** Every new field is optional. If a field is absent, `null` or the wrong JSON type, the kiosk behaves exactly as it does today. §5 is the one deliberate exception. Flags must be JSON booleans; the string `"true"` is treated as absent.
2. **Status codes.** Report business failures in the response body, with HTTP 200 or any 4xx except 401. **Never return 401, 504 or 505** unless the device session really is invalid. On a 401 the kiosk wipes its storage and goes back to registration. On a 504 or 505 it logs out and goes back to registration (`sdk/core/src/transport/kioskApi.ts:128-141`).
3. **Time limits.** Every kiosk request aborts after 10 s; getMenu gets 30 s (`src/redux/app/apiSlice.ts:31-39`). Queue slow side effects (email, SMS, points) on the server instead of doing them inside the request.
4. **Auth.** Every request already carries the device token in `authorization`, `x-access-token` and `login_code` (`kioskApi.ts:103-109`). New endpoints identify the device from that token. Secrets cannot live in the app bundle, because `VITE_*` values are inlined into the shipped JS.
5. **Loyalty.** New loyalty events use the existing `POST /api/partners/execute_event?deployment_id=…&event_name=…` call and its `{ status_code, response }` envelope. A failure is `status_code ≠ 200`, or `response.success: false` with a `message` (parser: `sdk/ordering/src/loyalty/loyaltyRedemption.ts:29-49`).
6. **PII.** Email addresses, phone numbers, passcodes and tokens must be redacted in server logs. The kiosk never sends them to analytics or the console.

---

## 1. Email receipt

**Problem.** `/receipt` (1:3377) offers PRINT, EMAIL and NO THANKS. The EMAIL tile is inert because placeOrder has no field for an address and nothing sends a receipt. If the kiosk collected an address anyway, it would make a promise it cannot keep and hold PII it cannot use. A `customerInfo.email` field exists but is never written, and that slice is persisted to localStorage, so it would be the wrong place for an address anyway.

**Plugs into**
- `src/pages/ReceiptPreference/index.tsx:26-33, :151-164`: the inert tile. `:63-77`: the choice goes to `confirmAndPush(choice)`, and analytics records only the choice (`:70-73`).
- `src/hooks/paymentsHooks/usePayAtCounter.ts:111`: the `"print" | "email" | "none"` type. `:323`: the push. `:330-333`: the choice is passed on to `/orderSuccess`.
- `sdk/ordering/src/order/orderBuilder.ts:660`: `buildPushOrderPayload`. The `customer` block is at `:752-760`. The top-level `toPush.loyalty` block at `:1151-1153` is the pattern to copy.
- `sdk/core/src/customer/customerInfo.slice.ts:44`: the unused `email` field. `src/redux/app/store.ts:114-116` persists it.
- Figma 1:3383 (Email Receipt): the on-screen keyboard for it is already built (`src/components/keyboard/KioskKeyboard.tsx`).

**Contract**

| Where | Field | Type | Notes |
|---|---|---|---|
| `POST /api/cx/get_kiosk_settings` response | `enable_email_receipt` | boolean | Only `true` enables the tile. It also tells the kiosk that this backend supports email receipts. |
| `POST /api/onlineOrders/partner/kiosk/placeOrder` request | `receipt` | object, optional | Sent only when the guest chose email. It sits at the top level, **not** inside `customer`, because `customer` reaches the POS, the KDS and the printed ticket. |
| | `receipt.channel` | `"email"` | Leaves room for `"sms"` later. |
| | `receipt.email` | string, ≤ 254 | Trimmed. The kiosk checks the `local@domain.tld` shape before sending. |
| | `receipt.language` | `"en"` or `"ar"` | The kiosk language at order time. |
| placeOrder 2xx response | `receipt.status` | `"queued"` or `"rejected"`, optional | `rejected` means the address failed server validation. **The order still succeeds.** |

```jsonc
// placeOrder request: only the new block is shown; everything else is unchanged
{ "source": { "id": "Kiosk", "order_id": "17912448001234821" },
  "receipt": { "channel": "email", "email": "jo@example.com", "language": "en" } }
// placeOrder 2xx response: only the new block
{ "receipt": { "status": "queued" } }
```

**Kiosk behaviour**
- If `enable_email_receipt` is not `true`, the tile stays inert, as today.
- Tapping EMAIL opens the email step (1:3383): an on-screen keyboard and a local format check. BACK throws the address away. CONFIRM runs the normal push with `receipt` attached. There is no extra request, so there is no new way to fail.
- Push failures work as they do today. On a network error or a 5xx (other than 504/505, see C2), the push is tried up to 4 times with the same `order_id` and the same `receipt`. A timeout is never retried automatically: the kiosk shows its "uncertain" panel, and the customer's own Retry reuses the same id. **The backend must send one email per `order_id`** (see C1).
- If `receipt.status` is `"rejected"`, Order Complete shows "We couldn't email your receipt — please ask at the counter". If it is `"queued"` or absent, it shows "Your receipt is on its way".
- If the idle timeout fires on the email step, the session ends and the address is discarded with the screen.

**Privacy / security**
- Purpose: this one receipt only. No marketing use (the kiosk collects no consent), no CRM enrichment, and no forwarding to the POS, the KDS or the ticket.
- On the kiosk, the address exists only in the screen's state and in the request payload. It never goes into redux or localStorage. It never goes into `pushOrderData` either, which is written to IndexedDB (`src/hooks/menuHooks/useOrderHook.ts:183-193, :259-262`). It never reaches analytics or the console.
- On the backend: redact `receipt.email` in request logs, and keep it only as long as delivery and bounce handling need it. Use a fixed template with no guest-written content, and cap sends per device, because an anonymous terminal must not become a mail relay.

**Backward compatibility.** Without `enable_email_receipt`, the kiosk never sends a `receipt` block. A backend that ignores unknown fields is unaffected.

**Open questions**
1. Should the email go out at push time (an order confirmation) or at POS settlement (a VAT receipt)? Pay-at-counter orders are pushed unpaid and may never be paid.
2. Which sender domain should be used, who owns the template (the TB brand?), and is an Arabic template needed?
3. Do you agree that a bad address still gets a 2xx with `receipt.status: "rejected"`? A 4xx would fail the whole order.
4. For Paytm orders (P8b), the backend places the order from the parked order. Please confirm `receipt` is honoured there too. It travels in `order_details`, like `loyalty` (`orderBuilder.ts:1142-1145`).

**Kiosk-side status: not started.** Only the inert tile and the keyboard exist. The plan is an optional `receiptEmail` parameter on `buildPushOrderPayload` that becomes a top-level `toPush.receipt`. It must never go into `customer`: `toPush.customer` is the same object as `pushOrderData.customer` (a shallow spread, `orderBuilder.ts:831-832`), and that object is stored in IndexedDB.

---

## 2. Order Complete QR codes

**Problem.** Both Order Complete frames have a QR code:
- **Guest frame (1:5932):** "SCAN TO EARN 110 POINTS", for claiming points on this order.
- **Logged-in frame (1:3437):** a campaign panel with a photo, the headline "CHECKOUT NEXT TUESDAY DROPS" and a QR.

Nothing in the kiosk state, the order response or the loyalty data provides a URL, a points figure or a photo. The panel therefore ships without a QR and without the number, and shows the brand mark where the photo should be.

**Plugs into**
- `src/pages/OrderSuccess/index.tsx`:
  - `:51-62`: the note on the missing data.
  - `:117`: the guest vs logged-in check.
  - `:269-288`: the panel.
  - `:76`: the 20 s auto-reset.
  - `:27-29`: the screen makes no network call of its own.
- `src/hooks/menuHooks/useOrderHook.ts:177-180`: the placeOrder response body is thrown away today.
- `src/hooks/paymentsHooks/usePayAtCounter.ts:330-333`: the push hands over to `/orderSuccess` through router state.
- `src/hooks/utils/useLoaders.ts:186-199` and `sdk/catalog/src/media/splashMedia.ts:23-35`: getMedia is already fetched at boot, but only `home_screen` is kept.

**Contract A: guest "scan to earn" (one per order).** New fields in the placeOrder 2xx response:

| Field | Type | Notes |
|---|---|---|
| `order_complete.earn.url` | https URL, ≤ 512 chars | The claim link. It holds an opaque, single-use token and no phone number, name or amount. |
| `order_complete.earn.points` | integer ≥ 0, optional | Points this order earns. If absent, the copy omits the number. |
| `order_complete.earn.expires_at` | ISO-8601 UTC | The claim deadline. |

```json
{ "order_complete": { "earn": {
    "url": "https://claim.example.com/c/7Hq2kR9xP4mZ1vB8wN3sT",
    "points": 110,
    "expires_at": "2026-10-13T23:59:59Z" } } }
```

**Contract B: campaign panel.** A new entry in getMedia (`POST /api/cx/kiosk/getMedia`), next to `home_screen` and scoped the same way:

| Field | Type | Notes |
|---|---|---|
| `key` | `"order_complete"` | New slot. |
| `url` | image URL | The panel photo. The design panel is 406×700. |
| `text` / `subtext` | string ≤ 40 / ≤ 60 | Headline and sub-line. |
| `qr_url` | https URL | The campaign link the QR encodes. |
| `audience` | `"loyalty"`, `"guest"` or `"all"`, optional | Defaults to `"loyalty"`, as in frame 1:3437. |
| `ends_at` | ISO-8601 UTC, optional | The kiosk hides the entry after this time. Without it, a removed entry can stay up for hours, because boot data refreshes only every 6 h at most. |
| `deployments` | string[], optional | Same as `home_screen`: absent or empty means all stores. |

```json
{ "media": [ { "key": "order_complete",
    "url": "https://cdn.example.com/promo/tuesday-drops.jpg",
    "text": "CHECKOUT NEXT TUESDAY DROPS", "subtext": "EXCLUSIVE DECADES MERCH",
    "qr_url": "https://example.com/drops", "audience": "loyalty",
    "ends_at": "2026-10-14T23:59:59Z", "deployments": [] } ] }
```

**Kiosk behaviour**
- **Which panel shows:**
  - A guest with loyalty on and a valid `earn.url` sees the QR and "SCAN TO EARN {points} POINTS", which restores the frame's wording.
  - Otherwise, a live campaign entry for that audience shows, if there is one.
  - Otherwise, today's brand-mark panel shows.
- The QR is drawn on the device from the URL string, using `react-qr-code` (the fork's QR component, which arrives with the P8b Paytm QR work). The success screen downloads no images for it.
- **The `earn` data:**
  - The kiosk reads `earn` from the placeOrder 2xx body and passes it to the success screen with the receipt choice, in router state only (not redux, not storage).
  - There is no extra request, so there is no new timeout case.
  - If the push outcome is unknown (a timeout or a lost response body), there is no QR.
  - Paytm orders make no placeOrder call, so they get no QR unless the settlement poll returns the same block.
- **The campaign entry:**
  - If the campaign photo fails to load, the panel shows the text and QR without it. It is never blank.
  - The entry is stored as part of the boot's single atomic commit. If getMedia fails, the last known entry is kept.
- Two decisions belong to the client, not the backend:
  - The ADA view drops the panel today (P9c).
  - The 20 s auto-reset is short for a guest to scan with a phone camera.

**Privacy / security**
- Whoever holds the claim URL can claim the points, so the token must be single-use, short-lived and bound to the order on the server, served over https on a brand domain. Points should be credited only after the order is settled at the POS, because pay-at-counter orders are pushed unpaid.
- The kiosk never logs the URL and never sends it to analytics; analytics gets only `has_earn_qr: true`.
- Guests will scan `qr_url`, and operators write it, so Cockpit should accept only https brand or campaign links.

**Backward compatibility.** If the response has no `order_complete` and getMedia has no `order_complete` entry, the kiosk shows today's panel. The boot keeps storing only media keys it knows (`src/hooks/utils/useLoaders.ts:182-185`), because an unknown banner key can blank `/menu`.

**Open questions**
1. Who issues claim tokens: this backend or Xeno? Can Xeno credit an order after the fact?
2. If per-order claims are out of scope for now, an `order_complete` entry with `audience: "guest"` (an app-join link, no points number) could fill the guest panel today. Is that acceptable?
3. Can `points` be computed at push time from the earn rules?
4. Should the printed ticket carry the same claim QR?

**Kiosk-side status: not started**, apart from the panel without a QR (P8a). Still to build: reading the response, drawing the QR, and the getMedia slot.

---

## 3. MIAM "SAVE £X" was-price

**Problem.** Figma 1:3070 shows a yellow "SAVE £2.99" badge on the meal card in the Make-It-A-Meal prompt, but the menu has no figure to back it. A census of every key in the reference menu found only `price`, `applyAddonsPrice`, `differentialPrice` and `priceChange`; the last two are modifier deltas. The `makeItMeal` object carries only `subText`, `buttonText1` and `buttonText2`. The meal price minus the item price is an upsell delta, not a saving, so the badge stays hidden.

**Plugs into**
- `src/components/makeItAMeal/MakeItAMealPrompt.tsx`:
  - `:71-79`: the fields it probes.
  - `:96-118`: `savingsFor`, which shows the badge only for a real positive saving.
  - `:169-172`: the meals shown are the host item's `upsellItems`.
  - `:309-315`: the badge.
  - `:291`: the price line.
- A new raw field reaches the prompt with no converter change. Upsell meals are spread copies (`sdk/catalog/src/menu/menuUtils.ts:381`) of the `menuWithChecks` entities, which spread the raw entity (`sdk/catalog/src/menu/legacyMenuConverters.ts:457-458`). The whitelist at `:1062` drops unknown fields, but the prompt does not read through it.
- `originalPrice` is already used by dynamic pricing (`legacyMenuConverters.ts:504-512`), so this feature cannot reuse it.

**Contract.** In getMenu (`POST /api/cx/kiosk/getMenu`), add one field to each meal entity, and to each variant entry, that can be a MIAM upsell target:

| Field | Type | Meaning |
|---|---|---|
| `comparePrice` | number, optional | What the meal's **default** contents cost when bought separately at this store. Same currency and same tax basis as `price`. |

```json
{ "id": "665a0575b5871c3e7448cd5a", "name": "Crunchwrap Supreme Meal",
  "price": 7.99, "comparePrice": 10.98,
  "makeItMeal": { "subText": "…", "buttonText1": "…", "buttonText2": "…" } }
```

The kiosk computes the saving as `comparePrice − price`, so this example shows "SAVE £2.99".

**Kiosk behaviour.**
- The badge shows only when `comparePrice − price ≥ 0.01`. The kiosk uses the live price after dynamic pricing, so the figure stays honest when dynamic pricing changes `price`.
- The saving is rounded to 2 decimal places and shown with the deployment's currency symbol.
- If `comparePrice` is absent, non-numeric or not above `price`, there is no badge.
- There is no new request: the field arrives with getMenu, so it appears after the next `MENU_ID` bump (C3).

**Privacy / security.** No PII is involved. Compliance: UK reference-pricing rules require a genuine comparison. Derive `comparePrice` from the live à-la-carte prices of the meal's default contents, never from a hand-typed figure, and recompute it (bumping `MENU_ID`) whenever one of those prices changes.

**Backward compatibility.** If the field is absent, there is no badge, as today.

**Open questions**
1. Tax basis: are `price` values on TB UK menus VAT-inclusive or exclusive? The fixture items are exclusive, and bill math is an open decision. The badge must use the same basis as the price on the card.
2. Would you rather send an explicit `savings` figure? We prefer `comparePrice`, because a stored saving goes stale when dynamic pricing or a price edit changes `price`.
3. Can the saving differ by host item, given that Cockpit links meals per host item? `comparePrice` assumes it cannot.

**Kiosk-side status: built and gated** (P7d). Once the field name is agreed, the probe should read only that field. Today it also reads `originalPrice` (`MakeItAMealPrompt.tsx:107`), so on a dynamic-pricing deployment it would show a dynamic-pricing markdown as "SAVE".

---

## 4. Separate flag for the in-bag Complete-Your-Meal rail

**Problem.** `enable_cart_upsell_screen` controls two surfaces through a single `shouldShowUpsell` value:
- the full-screen `/forYou` "Complete Your Meal" step after VIEW MY BAG, which has no Figma frame (design-language);
- the in-bag Complete-Your-Meal rail, which is the design's own surface (1:3171).

So a tenant cannot keep the rail and drop the interstitial.

**Plugs into**
- `src/hooks/menuHooks/useCartUpsell.ts:92-102`: `shouldShowUpsell = enable_cart_upsell_screen !== false && items ≥ 1`.
- Where it is read:
  - the rail: `src/components/cart/CompleteYourMealRail.tsx:52, :70`;
  - the interstitial: `src/pages/Menu/index.tsx:354` and `src/pages/ForYou/index.tsx:141`.
- `src/hooks/utils/useLoaders.ts:386-390, :406`: get_kiosk_settings is fetched at boot and stored whole. It is persisted (`src/redux/app/store.ts:68-72`).

**Contract.** One new optional boolean in the get_kiosk_settings response:

| Field | Type | Meaning |
|---|---|---|
| `enable_cart_upsell_rail` | boolean, optional | Turns the in-bag rail on or off. If absent, it follows `enable_cart_upsell_screen`, as today. |
| `enable_cart_upsell_screen` | boolean (existing) | Narrowed to control `/forYou` only. |

```json
{ "enable_cart_upsell_screen": false, "enable_cart_upsell_rail": true }
```

| `…_screen` | `…_rail` | `/forYou` | Bag rail |
|---|---|---|---|
| absent | absent | on | on (today) |
| `false` | absent | off | off (today) |
| `false` | `true` | off | **on** |
| absent or `true` | `false` | on | **off** |

Both surfaces still need at least one in-stock `isCartRecommended` item.

**Kiosk behaviour.** This is pure config, with no request. A change applies at the next boot-data load and never mid-order. That load happens on the scheduled refresh (at most 6 h), on an FCM brand push, or on the Activity Center's "Reload resources". A non-boolean value counts as absent.

**Privacy / security.** None.

**Backward compatibility.** If the field is absent, the kiosk behaves exactly as today.

**Open questions**
1. Does Cockpit expose `enable_cart_upsell_screen` today? A kiosk code comment says the API does not send it (`useCartUpsell.ts:92-96`), so both toggles may need Cockpit UI.
2. The request sends `brand_id` and `tenant_id`, so these settings are brand-wide. Is a per-store override needed?

**Kiosk-side status: not started.** It is a small change: split `shouldShowUpsell` into one value per surface, plus tests.

---

## 5. Server-issued Activity Center operator passcode

**Problem.** Turning off mandatory fullscreen (the step that exposes the browser and the OS) is gated by a static passcode (src/components/activity/ActivityModal.tsx — deliberately not repeated here). It is a constant compiled into the JS bundle: anyone with the build can read it, it is the same on every kiosk of every tenant, and it can never be rotated. The Activity Center opens from a hidden 3 s hold on the splash screen. Logout, which wipes the device back to registration (`src/hooks/utils/useAuthHook.ts:95-99`), is not gated at all.

**Plugs into**
- `src/components/activity/ActivityModal.tsx`:
  - `:36-40`: the constant.
  - `:90-112`: the fullscreen toggle and the comparison.
  - `:114-120`: logout, which asks only for confirmation.
  - `:224-234`: a native password input, which needs a hardware keyboard that the kiosk does not have.
- `src/pages/StartScreen/index.tsx:202-206`: the 3 s hold.
- `sdk/core/src/transport/kioskApi.ts:103-109`: every request already carries the device token.

**Contract.** `POST /api/cx/kiosk/verify_operator_passcode`. The device is identified from its token, so the body has no device id.

```json
{ "action": "disable_fullscreen", "passcode": "48151623" }
```

| Field | Type | Notes |
|---|---|---|
| `action` | `"disable_fullscreen"` or `"logout"` | Used for the audit log and for per-action policy. |
| `passcode` | string, 6–8 digits | Digits only, so the kiosk's numpad can enter it. |

The response always uses HTTP 200 for a verdict:

```jsonc
{ "valid": true }
{ "valid": false, "attempts_left": 2 }
{ "valid": false, "locked_until": "2026-10-06T14:30:00Z" }
```

On the server:
- Cockpit sets and rotates the passcode per store, with an optional per-device override.
- It is stored as a slow hash (bcrypt or argon2) and never returned to any client.
- After 5 failures from one device, that device is locked for 15 minutes.
- An audit log records the device, the action, the verdict and the time, never the passcode.

**Kiosk behaviour**
- Submit sends one POST with the 10 s limit and no automatic retry, because a retry would use up an attempt. The operator taps again instead.
- `valid: true`: the kiosk performs the action.
- `valid: false`: it shows an error with the attempts left. If the device is locked, it shows "Locked until HH:MM".
- A timeout, offline state, 5xx or malformed body shows "Can't verify — check the connection", and the action does not happen. The check fails closed.
- The input is cleared after every attempt. The kiosk never stores or logs the passcode and never sends it to analytics; the analytics event carries only the action and the verdict.

**Privacy / security**
- No secret may live in the bundle, in a cache, or in get_kiosk_settings. get_kiosk_settings is brand-wide and every kiosk persists it to localStorage (`store.ts:68-72`).
- That includes a hash: a 6–8 digit passcode can be brute-forced offline, so only an online, rate-limited check protects it.
- A wrong passcode must **never** return HTTP 401, because the transport logs the kiosk out on any 401 (`kioskApi.ts:128-135`). It must not return 504 or 505 either.
- Redact `passcode` in request logs.

**Backward compatibility: deliberately not "absent means today".** Today's behaviour is the vulnerability. The kiosk will switch only once the endpoint is live in every environment, and will then delete the constant. If the server does not answer, the toggle cannot be turned off from the Activity Center (fail closed).

**Open questions**
1. Should Logout (which de-registers the kiosk) require the same check? We recommend yes: a guest who finds the 3 s hold can take the kiosk out of service.
2. When the network is down, the check fails closed. Is the OS or MDM exit enough for that case, or do you want an offline fallback, such as a per-device TOTP seed issued at registration?
3. Should passcodes be scoped per store, per device, or both?

**Kiosk-side status: hardcoded today** (an open decision in PROGRESS). Not started: the endpoint call, numpad entry (reusing `src/components/keyboard/KioskNumpad.tsx`), and the logout gate.

---

## 6. Xeno SCAN APP login

**Problem.** The rewards login has a SCAN APP tab. The relevant frames are:
- 1:4174: the code-entry numpad;
- 1:5881 and 1:5904: scan;
- 1:4330 and 1:4098: scan error;
- 1:4349 and 1:4117: scan failure.

The tab is inert ("coming soon") because three things are missing:
- a definition of what the TB app's QR encodes;
- an endpoint to resolve it;
- a scanner on the kiosk.

Guests have to type their phone number instead.

**Plugs into**
- `src/components/loyalty/LoyaltyLoginModal.tsx:93-106`: the inert handler. `:255-273`: the tab.
- The phone lookup (`check_loyalty_balance`):
  - `src/hooks/loyalty/useLoyalty.ts:104-138`: the call.
  - `sdk/ordering/src/loyalty/loyaltyEngine.ts:264`: its payload, which uses `customer_loyalty_id: "!"` as a placeholder value.
  - `sdk/ordering/src/services/loyaltyApi.ts:42-54`: `execute_event`, the single transport for all loyalty calls.
- After the lookup, everything is keyed on the phone number:
  - the `validate_coupon`, `authenticate_redemption` and `redeem_coupon` payloads (`loyaltyEngine.ts:291, :347, :427`);
  - the order's `customer.mobile` (`src/hooks/menuHooks/useOrderHook.ts:110` → `orderBuilder.ts:755`).

**Contract (a): what the app QR encodes.** An opaque, rotating, single-use token, and nothing else:

| Property | Value |
|---|---|
| Format | `TBR1.<token>`. The prefix carries the scheme and version. |
| Characters and length | `[A-Za-z0-9_-]`, with a token of 22–43 chars (128–256 bits). A keyboard-wedge scanner (one that types the code as keystrokes) types these characters the same way on UK and US layouts. |
| Lifetime | The app rotates it every 30 s. Valid for 120 s at most, and only once. |
| Content | A random handle that the server looks up. **No** phone number, name or points in the QR. |

**Contract (b): the lookup.** A new event on the existing transport:
`POST /api/partners/execute_event?deployment_id=<id>&event_name=check_loyalty_balance_by_token`

```json
{ "partners": [ { "customer_key": "…", "client_id": "…" } ],
  "data": { "customer_key": "…", "merchant_id": "…",
            "scan_token": "TBR1.Q2h1cnJvcy1hbmQtdGFjb3MtZm9yZXZlcg" } }
```

The response is the `check_loyalty_balance` body plus the identity the rest of the flow needs:

```jsonc
{ "status_code": 200,
  "response": { "customer_mobile": "7700900123", "country_code": "44",
                "loyalty_points": 6000, "coupons": [ /* same as check_loyalty_balance */ ] } }
// failure (HTTP 200, see ground rule 2)
{ "status_code": 410,
  "response": { "success": false, "reason": "expired", "message": "Code expired" } }
```

`reason` is one of `"unknown"`, `"expired"` or `"used"`. If the same device sends the same token again within 60 s, it gets the same answer. That way, a kiosk retry after a lost response does not come back as `"used"`.

The feature is turned on when the getLoyaltyPartner response includes `partnerDetails.scan_login_enabled: true`.

**Kiosk behaviour**
- The SCAN tab is live only when `scan_login_enabled` is true, loyalty is on, and a scanner is configured (a hardware decision).
- **The scan:**
  - The scanner is a USB HID keyboard-wedge, so there is no driver and no serial port to conflict with the printer or card reader.
  - While the SCAN tab is open, the kiosk collects one burst of keystrokes ending in Enter.
  - It checks the result against `^TBR1\.[A-Za-z0-9_-]{22,43}$` locally, so junk never reaches the network.
  - It then sends the event with the 10 s limit and at most 1 retry, which the 60 s replay window makes safe.
- **The result:**
  - On success, the flow is the same as a typed login: the kiosk stores the phone number and opens rewards (REWARDS INCOMING, 1:4079).
  - On `unknown`, `expired` or `used`, the kiosk shows the scan-error frame (1:4330): "Refresh the code in your app and scan again".
  - On a timeout or 5xx, it shows the scan-failure frame (1:4349), with ENTER CODE as the fallback.
  - The scan never blocks ordering; skip and close always work.
- While the call is in flight, the idle timer is held, and a late answer after an idle reset is dropped. Both mechanisms already exist in `useLoyalty`.

**Privacy / security**
- The QR carries no PII. A photo of it is useless after 120 s or one use.
- The response returns the phone number only because every later loyalty call, and the order itself, need it. A typed login gives the kiosk exactly the same data. The kiosk never shows the number unmasked and never logs it.
- The new event sends its data in a POST body, never as a GET with identity in the query string. The inherited Xeno revoke does use that pattern (`src/hooks/loyalty/useLoyalty.ts:304`).
- Rate-limit lookups per device, so tokens cannot be guessed.

**Backward compatibility.** If the flag is absent or no scanner is configured, the tab stays inert as today, and phone entry is unchanged.

**Open questions**
1. Who mints app tokens: the TB app through Xeno, or this backend? If Xeno already has a member QR format, should the kiosk accept that instead?
2. Would you rather return an opaque `customer_ref` that is accepted in place of `customer_mobile` on every later event and on placeOrder? That minimises PII better, but means more backend work.
3. Hardware: will the TB cabinet have an HID QR scanner, or should scanning use the camera? Camera scanning raises the GDPR/DPIA questions of the deferred proximity feature.

**Kiosk-side status: inert tab** (P7c, awaiting client sign-off). Not started. Blocked on the token format, this event and a scanner.

---

## 7. Resend OTP for reward redemption

**Problem.** Redeeming a reward sends a 4-digit OTP (`authenticate_redemption`), which the guest types to confirm (`redeem_coupon`). If the SMS is late or lost, there is no "Resend code". The guest must back out and start the redemption again, which re-runs `validate_coupon` and `authenticate_redemption` with a new transaction id. No resend endpoint exists, and the fork has none either.

**Plugs into**
- `src/components/loyalty/LoyaltyRewardsSheet.tsx`:
  - `:48`: `OTP_LENGTH = 4`.
  - `:255-300`: validate, then authenticate (which sends the OTP), then the OTP step.
  - `:308-342`: OTP submit (`redeem_coupon`).
- `src/hooks/loyalty/useLoyalty.ts:174-207`: `authenticate_redemption`, which creates a new `transaction.id` (a uuid) on every call (`:175`). Its payload is built in `sdk/ordering/src/loyalty/loyaltyEngine.ts:347`.

**Contract.** A new event on the same transport:
`POST /api/partners/execute_event?deployment_id=<id>&event_name=resend_redemption_otp`

```json
{ "partners": [ { "customer_key": "…", "client_id": "…" } ],
  "data": { "customer_key": "…", "merchant_id": "…", "merchant_username": "…",
            "customer_mobile": "7700900123", "country_code": "44",
            "coupon_code": "static6562",
            "transaction": { "id": "6f1d2c9e-0b7a-4c1e-9a52-3e8f7d6c5b4a" } } }
```

`transaction.id` is the id from the `authenticate_redemption` call that sent the first OTP.

```jsonc
{ "status_code": 200, "response": { "otp_sent": true, "resend_after_s": 30, "resends_left": 2 } }
// rate-limited (HTTP 200, see ground rule 2)
{ "status_code": 429, "response": { "success": false, "message": "Too many requests",
                                    "resend_after_s": 45, "resends_left": 0 } }
```

| Field | Type | Notes |
|---|---|---|
| `resend_after_s` | integer | Seconds before the next resend can be requested. The kiosk uses 30 if it is absent. |
| `resends_left` | integer | At 0, the kiosk hides the button. |

**Semantics.**
- The server re-sends the **same** code while it is still valid, so a late first SMS still works.
- A resend never extends the code's expiry.
- `redeem_coupon` remains the only thing that verifies the code.

The feature is turned on when the getLoyaltyPartner response includes `partnerDetails.otp_resend_enabled: true`.

**Kiosk behaviour**
- The OTP step shows "Resend code" once `resend_after_s` has passed, counting down 30 s when the value is unknown.
- Only one call is in flight at a time, with the 10 s limit and no automatic retry, because each call may cost an SMS.
- **On success:** the kiosk shows "New code sent", clears the OTP cells and restarts the countdown.
- **When rate-limited** (a 429 or `resends_left: 0`):
  - the button is hidden;
  - the copy reads "Didn't get it? Choose another reward or skip";
  - BACK stays available.
- **On a timeout or 5xx:** the kiosk shows "Couldn't resend — try again" once the countdown ends.
- The OTP step never locks up.
- The kiosk keeps the `transaction.id` from the original `authenticate_redemption`; today it is thrown away.

**Privacy / security.**
- To prevent SMS pumping (abuse that triggers paid SMS sends), the server caps resends per coupon, per phone number and per device. For example: 2 per redemption, and 5 per phone number per hour.
- The phone number travels only in the POST body.
- Never return the OTP, or the full phone number it was sent to, in the response.

**Backward compatibility.** If the flag is absent, there is no button, as today.

**Open questions**
1. Should a resend send the same code, or a new one that invalidates the first? We propose the same code while it is still valid.
2. Can `authenticate_redemption` itself be called again safely with the same `transaction.id` as a resend? If so, no new event is needed; just confirm that and give us the rate limits.
3. How long is an OTP valid, and how many wrong attempts does `redeem_coupon` allow? The kiosk keeps no count of its own.

**Kiosk-side status: not started.** It is part of the loyalty deferred set in PROGRESS.

---

## 8. Offer photos, terms & conditions and expiry

**Problem.** The Figma reward rows (1:3924, My Bag 1:3137) show a product photo per offer, and the T&C frames (1:4009, 1:4044) show an "Expires …" line plus terms text clamped to two lines with Show more / Show less (several rows can be open at once; the design notes 1:3782 sort by descending expiry). The kiosk can build none of it: `get_cx_valid_offers` builds each offer explicitly (`posistApp/server/api/cx/cx.controller.js:2795`, `getOffersHelper2` → `tempObj`) with no image, description, terms or validity. The Offer schema has no image or terms field; `valid.date.endDate` exists but is only checked server-side (`api/Utils/utils.js:263`) and never shipped. Today the rows show the bell placeholder and no T&C.

**What the kiosk would read** (additive fields on each offer in the `get_cx_valid_offers` response):

```json
{
  "_id": "offer-123",
  "name": "Free fries with any burrito",
  "imageUrl": "https://<cdn>/offerImage/<tenant>/offer-123.png",
  "terms": "One per order. Not valid with other offers.",
  "termsSecondary": "واحد لكل طلب. لا يجمع مع العروض الأخرى.",
  "validTill": "2026-12-31T23:59:59+05:30"
}
```

| Field | Type | Source | Notes |
|---|---|---|---|
| `imageUrl` | https URL or null | `offer._extras.imageUrl` (Cockpit upload to S3 `offerImage/<tenant>/…`) | Square-ish product photo; the kiosk shows it on a grey plate, `object-contain` |
| `terms` / `termsSecondary` | plain text or null | Cockpit authoring | No HTML; the kiosk clamps to two lines with Show more |
| `validTill` | ISO 8601 with offset, or null | `valid.date.endDate` | Shown as "Expires 31 Dec"; also lets the kiosk sort by expiry like the Figma notes |

**Kiosk behaviour once it exists.** Built in the offers contract (TB `scratchpad/lanes/offers/contract.md` §6–§7, ready to implement): an `OfferThumb` component (84 / 152 px plates; a failed URL falls back to the bell) and a T&C accordion per row with the expiry line. The Workbox image route already caches offer images (`request.destination === "image"`). Absent or null fields ⇒ exactly today's rows.

**Privacy / security.** Images are public CDN assets (no signed URLs that expire mid-session). Terms are display text only.

**Backward compatibility.** All three fields are optional; the kiosk renders today's rows when they are absent.

**Open questions for the backend.**
1. Should `validTill` honour `valid.time` / `valid.days` too (an offer valid only 2–4 pm)? If so, send the next window's end, or the full rule.
2. Per-language terms: one `termsSecondary`, or a map keyed by language code?
3. Expiry sort (Figma notes) vs today's saving rank (P7b): which should the kiosk use when both apply?

**Kiosk-side status.** Not built (blocked on data); the contract and component designs are ready.

---

## 9. Nutrition values and allergens

**Problem.** The PDP frame 1:5823 ends with two closed accordion rows, "Description" and "Nutrition". All five "Nutrition" nodes in the file are this closed header; no open state is drawn. The menu cannot fill a nutrition panel today:
- Every entity ships `nutritionalInfo` with 14 `{ value, unit }` keys (`calorieCount`, `proteinCount`, `fatCount`, `saturatedFatsCount`, `transFatCount`, `carbohydrateCount`, `totalSugarsCount`, `addedSugarsCount`, `fiberCount`, `saltCount`, `sodiumCount`, `cholesterolCount`, `caffeineInGrams`, `stepCount`), but every value is 0 on all 122 reference entities, and the top-level `calorieCount` is 0 too.
- The units cannot be used as labels: `calorieCount.unit` is "grams", sodium, cholesterol and caffeine are "g", and `servingSize` is `{ "value": 0, "unit": "mg" }` everywhere.
- `allergens` is `[]` (115 entities) or `null` (7), and the SDK's entity whitelist drops it anyway.

The kiosk never shows invented figures, so the panel is not built.

**Plugs into**
- `src/pages/Customization/index.tsx:242-246`: the PDP's "£x | N Cal" line reads the top-level `calorieCount` and hides at 0.
- `sdk/catalog/src/menu/legacyMenuConverters.ts:1062`: the entity whitelist passes `calorieCount`, `nutritionalInfo`, `servingInfo` and `servingSize`, but not `allergens`. One added key passes it through.
- The fork app shows `{calorieCount} kcal` plus every other nutrient above 0 (the fork's `src/components/menu/ItemInfo.tsx:217-247`). The kiosk would use the same filter.

**Contract.** In getMenu, on each entity and on each variant (size) entry:

| Field | Type | Notes |
|---|---|---|
| `calorieCount` (top level) | number | Energy per serving, in kcal. |
| `nutritionalInfo.<key>.value` | number ≥ 0 | Real values for the existing keys. |
| `nutritionalInfo.<key>.unit` | string, fixed per key | "kcal" for energy; "g" for fat, saturated fat, trans fat, carbohydrate, total sugars, added sugars, fibre, protein and salt; "mg" for sodium, cholesterol and caffeine. |
| `servingSize` | `{ value, unit }` | A real unit: "g" or "ml". |
| `allergens` | string[] | Codes from an agreed list (open question 2), e.g. `["gluten", "milk"]`. |

```json
{ "id": "665a0575b5871c3e7448cd5a", "calorieCount": 510,
  "nutritionalInfo": { "proteinCount": { "value": 21, "unit": "g" },
                       "sodiumCount": { "value": 1120, "unit": "mg" } },
  "servingSize": { "value": 240, "unit": "g" },
  "allergens": ["gluten", "milk"] }
```

**Kiosk behaviour**
- A "Nutrition" row joins the description on the PDP. Opened, it lists energy in kcal, then every nutrient above 0 with its unit, then the allergens. The open state has no frame, so it is design language and goes to client sign-off.
- Once a size is picked, the size's values replace the item's.
- All values 0 or absent: no row, as today. There is no new request: the data arrives with getMenu after the next `MENU_ID` bump (C3).

**Privacy / security.** None: menu data only. Labelling rules for the deployment are the brand's; the kiosk shows only what the menu sends.

**Backward compatibility.** Absent, zero or malformed values mean no panel, exactly today's PDP.

**Open questions**
1. Do sizes carry their own figures, or only the item?
2. Which allergen code list should be used, and is "may contain" needed?
3. Can figures differ between a deployment's tab menus (dine-in and take-out portions)?

**Kiosk-side status: not built (blocked on data).** Size S once the data exists: the row, the above-0 filter and one SDK whitelist line (bag-pdp item 22).

---

## 10. Repeated pack bundles ("Apply to the following burrito")

**Problem.** Figma 1:4641 ("Order a Pack (Partial Selections)") splits a pack into four bundles, "Burrito 1/4 … 4/4", each with burrito, side / drink and dessert slots. Under bundles 1–3, an "Apply to the following burrito" toggle copies that bundle's picks onto the next one. Nothing in the menu says which `_combo` groups form one bundle, or that two slots are the same slot of different bundles:
- Within a pack, no two `_combo` groups share an option set (0 of the 27 reference items with two or more slots).
- A product repeated across slots is a separate entity in each group, usually the same name with a trailing ".". For example, "10 pcs Strips & Chips" has "Drinks 1" = {Pepsi Small, 7 Up Small, Mirinda Small, Diet Pepsi Small} and "Drinks 2" = {"Pepsi Small.", "7 Up Small.", "Mirinda Small.", "Diet Pepsi Small."}, all with different ids.
- Groups carry no bundle or sequence field (774 of 774 have `isLeadingGrp: false` and `leadingItems: []`).

So the kiosk shows one flat grid of slot cards. Guessing bundles from names is not safe.

**Plugs into**
- `src/pages/Customization/index.tsx:281-287`: `_combo` groups with min 1 and max 1 become pack slots; `:607`: the `PackSlotCard` grid, with no section headers.
- `src/components/customization/SlotSelectionSheet.tsx` and `Tier2CustomizationSheet.tsx`: the picks a copy would carry (the constituent id plus its tier-2 `customizations`).
- `sdk/ordering/src/customization/pricing.ts` (`getTotalValueWithApplyAddonPrice`): pack totals.

**Contract.** On each `_combo` modifier group in getMenu:

| Field | Type | Notes |
|---|---|---|
| `bundleKey` | string, optional | Shared by the groups of one repeated bundle type, e.g. every "Burrito" slot group of the pack. |
| `bundleIndex` | integer 1…N, optional | The bundle the group belongs to ("Burrito 2/4" = 2). |
| constituent ids | — | The SAME entity id for the same product in every repeated group. |

```json
{ "_id": "665b…_6_combo", "name": "Burrito", "min": 1, "max": 1,
  "bundleKey": "burrito", "bundleIndex": 2,
  "constituentItems": [ { "id": "665a0575b5871c3e7448cd5a", "price": 0 } ] }
```

**Kiosk behaviour**
- Groups sharing a `bundleKey` render as sections "Name i/N", in `bundleIndex` order, as in 1:4641.
- Under bundle i, when bundle i+1 offers the same item ids, the toggle shows. ON copies bundle i's pick for each slot, with its tier-2 customizations, onto bundle i+1, and keeps following later changes to bundle i. A direct edit of bundle i+1 turns its toggle off.
- Copied picks are priced from the TARGET group's constituent, never by copying price numbers. Totals use the normal pack pricing.
- Without the fields: today's flat grid.

**Privacy / security.** None.

**Backward compatibility.** Both fields are optional; absent means today's flat grid. Sharing constituent ids changes nothing for a kiosk that ignores the fields.

**Open questions**
1. Can the same product cost a different amount in different bundles of one pack?
2. Should the operator be able to turn copying off per pack?
3. Can bundles differ in slot count, for example a pack with 4 burritos but 3 sides?

**Kiosk-side status: not built (blocked on data).** Size S–M once the fields exist: an SDK `copyBundleSelections` helper, the section headers and the toggle (bag-pdp item 21).

---

## 11. Ingredient portion levels (NONE / REGULAR / EXTRA)

**Problem.** The customize frames (1:3007 and 1:3037, customize-edit; 1:5477, edits complete) give each default ingredient a NONE / REGULAR / EXTRA control, with a price on EXTRA ("EXTRA +£1.50"). The menu has no field for a level or a per-level price. Modifier groups only carry picks that are added or removed, and the two price flags on groups, `differentialPrice` and `priceChange`, are dynamic-pricing switches for combo groups that no reference group sets. So TB builds only today's add / remove picks.

**Plugs into**
- `src/pages/Customization/index.tsx` and `src/components/customization/Tier2CustomizationSheet.tsx`: the group grids the control would join.
- `sdk/ordering/src/customization/pricing.ts` (`getTotalValueWithApplyAddonPrice`): add-on prices, which a level price would feed.
- `sdk/catalog/src/menu/legacyMenuConverters.ts:556-557`: what `differentialPrice` / `priceChange` mean today (dynamic pricing on combo picks).

**Contract.** On each default ingredient (a constituent item that is in the recipe by default):

| Field | Type | Notes |
|---|---|---|
| `levels` | array, optional | `[{ "code": "none", "price": 0 }, { "code": "regular", "price": 0 }, { "code": "extra", "price": 1.5 }]`. Codes come from a fixed list; `price` is in the deployment currency, on the same tax basis as `price`. |
| `defaultLevel` | string, optional | The level the recipe starts at; `"regular"` when absent. |

Alternative: an `extraItemId` link from the ingredient to a priced "Extra …" item, which the kiosk adds as a normal add-on line.

```json
{ "id": "6650c4f2a1b2c3d4e5f60718", "name": "Lettuce", "isDefault": true,
  "levels": [ { "code": "none", "price": 0 }, { "code": "regular", "price": 0 },
              { "code": "extra", "price": 1.5 } ] }
```

**Kiosk behaviour**
- An ingredient with `levels` shows the three-way control from the frames. The chosen level's price is added like an add-on and shown on the bag row's add-on line ("Extra Lettuce +₹X").
- NONE and EXTRA travel to the POS as agreed in open question 1; REGULAR sends nothing extra.
- Without `levels`: today's add / remove picks.

**Privacy / security.** None.

**Backward compatibility.** The field is optional; absent means today's picks.

**Open questions**
1. How do the POS and the KDS receive a level: an add-on line per level, a modifier comment, or the `extraItemId` item?
2. Are levels set per ingredient, or once per group?
3. Do levels apply inside packs (tier-2 picks) and under dynamic pricing?

**Kiosk-side status: not built (blocked on data).** The rest of the customize family is item 42 (figma-polish lane).

---

## 12. Xeno reward expiry, per-reward minimum order, order-level coupons

**Problem.** The Figma reward states show three things the kiosk cannot build today:
- An "Expires Today / in 7 Days / 01/12/24" line on every reward: 1:3824 default, 1:3858 ineligible, 1:3892 / 1:3924 all available, and My Bag has-rewards 1:3137 / 1:3973.
- A lock on any reward the order is too small for: "Add £4.29+ to your order to be eligible to redeem this reward", with the art at 50 % and a "Suggested £4.29+ Items" rail.
- Order-level rewards ("£4 Off Order", "£4 Off £25+ Orders").

The kiosk's Xeno rewards come only from `check_loyalty_balance`, and its body carries none of this:
- **Per coupon**, the body has only `coupon_name, coupon_code, discount_on ("item"), discounted_category_id, discount_type ("percentage"), discount_value, comment, special_offer, offer_instruction ("points redeemed against this coupon: 3000 points"), item_options, products[{_id, quantity}], extra_fields[{Points Value}, {Reward Type}]`. Source: `sdk/ordering/src/loyalty/loyaltyEngine.ts:46-221`, `xenoExpectedSuccessResponse`, kept verbatim from the fork's hook.
- **At body level**, there is only `loyalty_points`. `total_redeemable_points` and `min_bill_for_redemption` appear only in TB's own fixture (`tests/e2e/fixtures/loyalty.ts:178-186`, Reelo-era fields).
- **Absent everywhere** (the SDK sample, the TB fixture coupons at `tests/e2e/fixtures/loyalty.ts:57-136`, the fork's types and fixtures):
  - any validity field (`valid_till` / `valid_until` / `expiry_date` / `expires_at` / `end_date`);
  - a per-coupon minimum order;
  - a reward state (`status` / `is_active` / `eligible`);
  - a coupon image.
- **The minimum is enforced only at redeem time.** `authenticate_redemption` answers "Minimum purchase amount is not met for this reward." (`tests/e2e/fixtures/loyalty.ts:214-221`), after the guest has already picked the reward.
- **Rewards join the menu by `coupons[].products[]._id`** (`loyaltyEngine.ts:541-589`). A bill-level coupon has no product, so it never renders, in the fork or in TB. `redeemItem` (`:598-631`) discounts only item rows with `discount_type: "percentage"`.

**What the kiosk would read.** Additive fields on each `check_loyalty_balance` coupon:

```json
{ "coupon_code": "static6562", "coupon_name": "Free Taco", "discount_on": "item",
  "discount_type": "percentage", "discount_value": 100,
  "products": [{ "_id": "665a0575b5871c3e7448cd5a", "quantity": 1 }],
  "extra_fields": [{ "name": "Points Value", "value": 3000 }],
  "valid_till": "2026-12-31T23:59:59+05:30",
  "min_bill_amount_for_redemption": 200 }
```

An order-level reward:

```json
{ "coupon_code": "static9001", "coupon_name": "₹100 off orders over ₹500", "discount_on": "bill",
  "discount_type": "fixed", "amount": 100, "products": [],
  "extra_fields": [{ "name": "Points Value", "value": 2000 }],
  "valid_till": "2026-12-31T23:59:59+05:30", "min_bill_amount_for_redemption": 500 }
```

| Field | Type | Notes |
|---|---|---|
| `valid_till` | ISO 8601 with offset, or null | The last moment the coupon can be redeemed. The kiosk shows "Expires today", "Expires in N days" or the date (kiosk-local time, IST), and hides an expired coupon. |
| `min_bill_amount_for_redemption` | number in the deployment currency, or null | The order amount the reward needs (the same name as the Reelo field). Below it, the row is locked with "Add ₹X+ to your order to be eligible" and the suggested-items rail. |
| `discount_on` | `"item"` (today) or `"bill"` | `"bill"` means an order-level reward with no product. |
| `amount` | number | For `discount_on: "bill"` with `discount_type: "fixed"`: the money off the order. `percentage` keeps `discount_value`. |

**Kiosk behaviour once the fields exist.**
- **Expiry.** The REWARDS sheet's second line becomes the expiry. It keeps "{n} points" when `valid_till` is absent. Expired coupons are hidden; the server must still refuse them, because the kiosk clock is not authoritative.
- **Minimum order.** Locked rows reuse the offers sheet's existing locked state: art at 50 %, the pink "Add ₹X+" nudge and the 1:3824 suggested rail. The gap is `min_bill_amount_for_redemption` minus the agreed basis (open question 1). The reward unlocks live as the bag grows; `authenticate_redemption` stays the authority.
- **Order-level rewards.** A `discount_on: "bill"` reward gets a row with the bell placeholder plate. Once redeemed, the bag shows its "Rewards" card (1:3164 / 1:3137) with "−₹X" instead of an item row. The order push carries the discount as an order-level loyalty discount (open question 4).
- **Fields absent or null:** exactly today's sheet.

**Privacy / security.** No personal data is added; the fields describe the coupon, not the guest. Phone numbers stay in POST bodies only (ground rule 6).

**Backward compatibility.** All fields are optional, and today's item coupons are unchanged. A kiosk that does not know `discount_on: "bill"` keeps dropping such coupons, which is what happens today.

**Open questions for the backend.**
1. Is `min_bill_amount_for_redemption` compared with the subtotal before or after tax, CX offers and other discounts? The kiosk will compute the gap the same way.
2. Does Xeno expose validity and minimums to the CX proxy at all, or enforce them only inside `authenticate_redemption`? If only there, can the proxy map them from the partner's coupon configuration?
3. Can one order hold both an order-level reward and an item reward, and can an order-level reward combine with a CX offer? Today the kiosk locks offers while a Xeno reward is in the bag (fork parity, D3).
4. For `discount_on: "bill"`, what shape does `placeOrder` expect for the discount, and what does the revoke ledger need?
5. Is `valid_till` always an end date, or can a reward have a time-of-day window?

**Kiosk-side status.** Not built (BLOCKED, data). The sheet shows "{n} points" and the out-of-stock state only. The offers sheet's locked-row and suggested-rail components already exist and can be reused.

---

## C. Confirm — no new API needed

**C1. Is placeOrder idempotent on `source.order_id`?**
- **Today:**
  - The id is `Date.now()` plus a random 0–9999 (`sdk/ordering/src/order/orderBuilder.ts:54-62`), created once per `/receipt` visit (`src/hooks/paymentsHooks/usePayAtCounter.ts:302-305`).
  - The 4-attempt retry sequence and the customer's Retry both reuse that id.
  - A timeout, or a 2xx whose body was lost, is never retried automatically (`usePayAtCounter.ts:78-90`).
  - Going back to the bag and pressing PAY again creates a new id (`src/pages/ReceiptPreference/index.tsx:85-94`).
- **Please confirm:**
  - (a) Does placeOrder deduplicate on `source.order_id`, and if so, per deployment or per tenant, and for how long?
  - (b) Does a duplicate return a 2xx with the original order, rather than an error or a second order?
  - (c) Does the deduplication also cover the side effects proposed in §1 and §2 (one email, one claim)?
- **Why it matters:** if the answer is yes, the kiosk can keep the same id when the guest goes back to the bag after an uncertain push. That closes the duplicate-order risk recorded in PROGRESS.

**C2. Do 504 and 505 mean "session invalid"?**
- **Today:**
  - Any 504 or 505, on any endpoint except the three telemetry calls, logs the kiosk out and sends it back to registration (`sdk/core/src/transport/kioskApi.ts:136-141` → `src/redux/app/sessionRecovery.ts:50-71`).
  - A 401 wipes the device completely (`sessionRecovery.ts:33-48`).
  - Client-side timeouts never map to 504.
  - Since 2026-10-07 the bag's EAT IN / TAKE OUT switch calls getMenu, `get_data` and the out-of-stock, offers and dynamic-pricing endpoints mid-order: a 504 or 505 on any of them de-registers a kiosk with a full bag.
- **Please confirm:** does the CX API send 504 or 505 deliberately to mean "this device's session is invalid"? Or can they come from a gateway or load balancer, for example on a slow placeOrder?
- **Why it matters:** today, a gateway 504 on placeOrder de-registers the kiosk mid-order, and the order may already exist. If 504 and 505 are not deliberate signals, the kiosk will stop treating them as session-invalid; 401 keeps that meaning.

**C3. Does every menu-affecting Cockpit change bump `MENU_ID`?**
- **Today:**
  - The kiosk sends its stored `MENU_ID` in the getMenu body.
  - If the response body carries `status` or `statusCode` 304, the kiosk reuses its IndexedDB copy. Otherwise it stores the new body under the new `MENU_ID` (`src/hooks/menuHooks/useMenuConverters.ts:264-312`).
  - Since P9e, boots no longer clear that cache.
- **Please confirm:**
  - **Bump on every change:** any change to the getMenu payload for a tab bumps that tab's `MENU_ID`. That covers items, prices, modifiers, images, schedules and dayparts, upsell links, tags, `makeItMeal`, taxes and `menu.settings`, plus `comparePrice` if §3 lands.
  - **Empty id:** an empty `MENU_ID` always gets a full body.
  - **Where "304" lives:** it is a field in the body of an HTTP 200. A real HTTP 304 would make the fetch fail.
  - Stock and dynamic prices come from separate calls, so they do not need to bump the id.
  - **Compression:** is getMenu gzip- or br-encoded? The 30 s limit for a menu of about 7.5 MB assumes it is.
- **Why it matters:** otherwise a kiosk can keep selling from a stale menu, at wrong prices, until something else forces a download.

**C4. What does `update_device_status` mean, and how are app and version namespaced?**
- **Today (the update ack):**
  - `{ "app": "kiosk", "device_update_id": "…" }` is sent when the splash **starts** the brand refresh, before the refresh has succeeded (`src/pages/StartScreen/index.tsx:186-194`, `src/hooks/autoUpdates/useAutoUpdate.ts:94-110`).
  - A failed refresh is retried 30 min later, with no second ack.
- **Today (the version report):**
  - `{ "app": "kiosk", "version": "…" }` is sent by `useAutoUpdate.ts:116-135`.
  - TB sends `0.1.0` (`package.json`) and posistKiosk sends `2.2.1`, both under `app: "kiosk"`.
  - `app: "kiosk"` also tags the offers, dynamic-pricing and open-status calls (for example `src/hooks/offerHooks/useOfferHook.ts:178`).
- **Please confirm:**
  - Does the backend read the ack as "received" or as "applied"? Does it re-send the push until it gets an ack?
  - Is `version` only stored per device, or is it compared against a fleet-wide "latest" for `app: "kiosk"`? If it is compared, how should TB identify itself? We would add an optional `"client": "tacobell"` field rather than change `app`.

**C5. What is the FCM data-only push payload?**
- **Today:**
  - The kiosk acts only on a data message whose `data.device_update_id` is a non-empty string (`sdk/devices/src/updates/updatePolicy.ts:394-402`, `src/hooks/firebase/useFcmRegistration.ts:153-169`). Other messages are ignored and logged.
  - The relay service worker never shows a notification (`public/firebase-messaging-sw.js:11, :18-39`).
  - On every page load, the kiosk sends its token in `update_cx_fcm_key` as `{ "app": "kiosk", "fcm_token": "…" }` (`useAutoUpdate.ts:78-83`).
- **Please confirm:**
  - The payload is data-only, as shown below: string values and no `notification` block.
  - The same id is expected back in `update_device_status`.
  - Pushes are sent from the TB Firebase project, the one named in `VITE_FIREBASE_PROJECT_ID`, which is not provisioned yet.
  - The token is upserted per device, with the latest token winning.

```json
{ "message": { "token": "<fcm_token>",
               "data": { "device_update_id": "66f1c0de9a1b2c3d4e5f6789" } } }
```

**C6. Are entity, size and pick ids the same in every tab menu of a deployment?**
- **Today:**
  - Since 2026-10-07 the bag's EAT IN / TAKE OUT switch fetches the other tab's menu (getMenu by `tab_id`), charges (`get_data`), offers (by `tab_type`), stock and dynamic prices, then re-prices every bag row against that menu by id: the entity id, the size (VARIANT) id (a Make-it-a-meal row is keyed by its meal size's id), and the modifier group and pick ids (`sdk/ordering/src/cart/orderTypeSwitch.ts`). Loyalty rewards are checked the same way.
  - A row whose id is missing from the target tab, or unavailable there, is removed and named to the guest; a reward is reversed (points refunded, claim revoked).
  - Taxes come from the target menu, except for a tier-2 pick nested in a pack, which keeps the taxes of the tab it was added under.
- **Please confirm:**
  - Is an item's entity id, each size id, and each modifier group and pick id identical in every tab menu of one deployment?
  - Do tab menus differ only in price, availability and taxes?
  - Are taxes ever tab-specific? If so, can they differ for nested picks?
- **Why it matters:** if ids differ between tabs, the switch removes items the guest can still buy instead of re-pricing them.
