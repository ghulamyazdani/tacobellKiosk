import { test, expect, type Page, stepClockUntil } from "./fixtures/kiosk";
import { mockKioskBackend as mockBackend, CHEESE_BURGER, locale } from "./fixtures/backend";
import { bootRegisteredToMenu } from "./pages/boot";
import { addViaPdp, openBag, bagRows } from "./pages/order";
import {
  mockCheckoutBackend,
  expectNothingDangerousWasContacted,
  type CheckoutMockHandle,
  type CheckoutMockOptions,
} from "./fixtures/checkout";

const en = locale("en");

/**
 * P8a — checkout fan-out → PAY AT COUNTER → order push → Order Complete.
 *
 * Covers the whole pay-at-counter vertical end to end: the bag's PAY
 * preflight landing on its real destination (no more /checkout stub), the
 * /tent table-number step, /payment's method choice and its cancel window,
 * the /receipt preference step, the guarded push, /orderSuccess and its one
 * exit (its 20 s timer) — plus the retry ladder on a failing push.
 *
 * ── ⛔ THE SAFETY SPEC (brief §SAFETY) ──────────────────────────────────
 * This vertical must be incapable of reaching a payment gateway, a terminal
 * socket or a card flow. That is asserted, not assumed. `mockCheckoutBackend`
 * (tests/e2e/fixtures/checkout.ts) fulfils every gateway prefix, the
 * backend-ordering `placeOrder` variant and the Mashreq/terminal origins with
 * a LOUD 500 and flips `handle.forbiddenHit`; it aborts the cross-origin
 * print agent (https://localhost:65505) and flips
 * `handle.printAgentContacted`. Every test in this file ends with
 * `expectNothingDangerousWasContacted` (fixtures/checkout.ts), and the last
 * test exists for nothing else. Without those guards the shared mock's
 * `/api/` catch-all answers a gateway path `{}` with HTTP 200, so a
 * regression that called a gateway would look like a PASS. The print agent
 * is another origin: the old `**\/api/**` glob matched it too (Playwright
 * 1.63's leading `**` spans any origin — the fixture's abort won only by
 * being newer); under the harness (fixtures/kiosk.ts) an unrouted print call
 * is denied and fails the test by name, and the fixture's route is what lets
 * this spec COUNT it.
 *
 * The one and only order-placing call the whole vertical may make is
 * `POST /api/onlineOrders/partner/kiosk/placeOrder`, and it must carry
 * `payments.type: "COD"` — orderBuilder maps that from
 * `payment.paymentType === "PAY_AT_RESTAURANT"` and from nothing else, so the
 * body assertion in scenario 1 is what proves the pay-at-counter string
 * survived the whole flow. A wrong string would silently route the order to a
 * different endpoint (Geidea/NeoLeap/Dojo) or place NO order at all
 * (NI/Paytm) while still showing the customer a success screen.
 *
 * ── MOCK ORDER ──────────────────────────────────────────────────────────
 * The harness house order, NEWEST route wins: the shared mock first
 * (fixtures/backend.ts — its origin-scoped `/api/` catch-all, then every
 * boot endpoint), then the fixture layer (`mockCheckoutBackend`), then any
 * spec override. The checkout fixture MUST come after the shared mock or the
 * catch-all `{}` swallows placeOrder and the settings endpoints.
 * {@link bootToBagWithOneBurger} enforces that ordering.
 *
 * ── BOOT HELPERS ────────────────────────────────────────────────────────
 * The shared harness page functions (pages/boot.ts, pages/order.ts);
 * `mockKioskBackend` and `addCheeseBurgerViaPdp` below are thin adapters
 * over the shared mock and `addViaPdp`, with ONE P8a delta:
 * `get_kiosk_settings` carries `skip_crm_page`. Every scenario here
 * runs with skipCRM ON and loyalty OFF, which is what makes
 * `resolveCheckoutRoute` return "payment" for a dine-in tab and "tent" for a
 * table tab — the two routes this phase builds. The loyalty ("customerName")
 * and no-loyalty-no-skipCRM ("phone") legs of the fan-out belong to
 * loyalty.spec.ts and are deliberately not duplicated here — except
 * audit-fixes A3's CANCEL ORDER case, which needs the "phone" leg (skipCRM
 * off via bootToBagWithOneBurger's third argument). A2's COCKPIT DEFAULT ROW
 * serves Cockpit's unticked COD row through `deploymentSettings`.
 *
 * ── FIXTURE MONEY (same facts as bag.spec.ts's header) ──────────────────
 * Every slim-menu item carries VAT@15%, which the bill engine treats as
 * EXCLUSIVE, and getNetAmount() rounds to 0 decimals — so
 * Total = round(SubTotal * 1.15). One Cheese Burger: £8 subtotal → £9 total.
 * £9.00 is therefore what `bag-pay`, `payment-total` and the pushed order all
 * have to agree on.
 *
 * ── TIMING: page.clock, NEVER A SLEEP ───────────────────────────────────
 * `page.clock.install()` runs before the first goto (beforeEach), so every
 * app timer is fake; it flows at real speed until a test moves it. The two
 * timers this flow owns are driven, never waited out:
 *   - /payment's 3000ms cancel window: once the buffer is up (the commit
 *     that shows it arms its timer), `runFor(3_000)` closes it, and the wait
 *     is `expect(receipt-screen).toBeVisible()`.
 *   - the push retry ladder (ORDER_PUSH_MAX_ATTEMPTS = 4, linear 1s/2s/3s
 *     backoff ≈ 6s) is a timer chain the page re-arms itself, so it is
 *     stepped with `stepClockUntil(() => handle.placeOrderCount === 4)` —
 *     never one big jump. "No fifth attempt" is proven over 15 s of fake time
 *     (`runFor(15_000)`, then the count); a 5 s poll passed on its first
 *     sample and proved nothing.
 * ⚠️ /orderSuccess leaves for /start 20 s after it opens, so every
 * assertion on that screen must be made promptly — do not add waits there.
 */

/**
 * The shared mock (fixtures/backend.ts) with this spec's P8a delta,
 * `skip_crm_page`: with it ON and `enable_loyalty` absent,
 * `resolveCheckoutRoute` returns "payment" (dine-in) or "tent" (table) — the
 * two destinations this phase owns — and /payment's back CTA returns to
 * /cart rather than /customerName. `pay_at_counter` is the COD tile's label
 * only: the dispatched type is PAY_AT_RESTAURANT either way
 * (settingsEngine.getIsPayAtCounter), so no assertion depends on it.
 */
const mockKioskBackend = (page: Page, { skipCRM = true } = {}) =>
  mockBackend(page, {
    settings: { skip_crm_page: skipCRM, pay_at_counter: "pay_at_counter" },
  });

/** No addon is picked, so the row commits at the Cheese Burger's own £8.00. */
const addCheeseBurgerViaPdp = (page: Page) =>
  addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });

/**
 * Cockpit's DEFAULT "Disable COD for Kiosk" row (posistApp app.js:19418-19437,
 * the projected fields the kiosk endpoint returns): present, every tab
 * UNTICKED. Under the pre-A2 SDK rule (tabLabel match, `selected` ignored) a
 * table or delivery session lost COD to it.
 */
const COCKPIT_DEFAULT_COD_ROW = {
  _id: "disable_cod_kiosk_default",
  name: "disable_cod_kiosk",
  label: "Disable COD for Kiosk",
  selected: false,
  tabs: [
    { tabLabel: "Table", tabType: "table", selected: false },
    { tabLabel: "Take Out", tabType: "takeout", selected: false },
    { tabLabel: "Delivery", tabType: "delivery", selected: false },
  ],
};

/**
 * The shared opening of every scenario: mocks (in the mandatory order), boot,
 * one £8.00 Cheese Burger, bag open on £9.00. Returns the live mock handle.
 */
async function bootToBagWithOneBurger(
  page: Page,
  opts: CheckoutMockOptions = {},
  { skipCRM = true } = {}
): Promise<CheckoutMockHandle> {
  await mockKioskBackend(page, { skipCRM });
  // MUST come second — see the MOCK ORDER note in the header.
  const checkout = await mockCheckoutBackend(page, opts);
  await bootRegisteredToMenu(page);
  await addCheeseBurgerViaPdp(page);
  await openBag(page);
  // PAY carries the taxed net: round(8 * 1.15) = £9.
  await expect(page.getByTestId("bag-pay")).toContainText("£9.00");
  return checkout;
}

/** /payment's cancel window ends by navigating; stepped in fake time, never slept through. */
async function payAtCounterThroughBuffer(page: Page) {
  await page.getByTestId("payment-counter").click();
  await expect(page.getByTestId("payment-buffer")).toBeVisible();
  await expect(page.getByTestId("payment-buffer-cancel")).toBeVisible();
  // The 3000ms window closes by routing to the receipt step.
  await page.clock.runFor(3_000);
  await expect(page.getByTestId("receipt-screen")).toBeVisible();
}

test.describe("P8a checkout → PAY AT COUNTER → order push → Order Complete", () => {
  // Before ANY page script: the app's timers must be fake from the start.
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("HAPPY PATH: dine-in + skipCRM → PAY → /payment → PAY AT COUNTER → receipt → /orderSuccess, with exactly one COD placeOrder", async ({
    page,
  }) => {
    test.slow();
    const checkout = await bootToBagWithOneBurger(page);

    // PAY → preflight → resolveCheckoutRoute("dine_in", skipCRM) = "payment".
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/payment$/);
    // The TOTAL bar shows the same net the bag checked out with.
    await expect(page.getByTestId("payment-total")).toContainText("£9.00");
    // No Paytm gateway is configured in this fixture, so there is no card
    // tile at all (P8b renders one only for a usable PaytmEdc option).
    await expect(page.getByTestId("payment-card")).toHaveCount(0);

    // Nothing may have been placed before the customer chose a method.
    expect(checkout.placeOrderCount).toBe(0);

    await payAtCounterThroughBuffer(page);
    // Print only (user request 2026-10-12): one question, YES / NO — no EMAIL.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.receipt.title);
    await expect(page.getByTestId("receipt-print")).toHaveText(en.receipt.yes);
    await expect(page.getByTestId("receipt-none")).toHaveText(en.receipt.no);
    await expect(page.getByTestId("receipt-email")).toHaveCount(0);

    // NO → the push runs, then /orderSuccess.
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/orderSuccess$/);
    // Order number = the last 5 characters of order.orderId (all digits).
    await expect(page.getByTestId("order-number")).toHaveText(/^#\d{5}$/);

    // ── THE CONTRACT ASSERTION ────────────────────────────────────────────
    // Exactly one push, on the ONLY allowed endpoint, carrying COD — which
    // orderBuilder derives from paymentType === "PAY_AT_RESTAURANT" and from
    // nothing else.
    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.lastPlaceOrderBody).toMatchObject({
      payments: { type: "COD" },
    });

    expectNothingDangerousWasContacted(checkout);
  });

  test("BACK FROM /payment: returns to an intact bag and places nothing", async ({
    page,
  }) => {
    test.slow();
    const checkout = await bootToBagWithOneBurger(page);

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });

    // skipCRM is ON, so the back CTA returns to the bag (with it off it would
    // step back to /customerName — that leg belongs to loyalty.spec.ts).
    await page.getByTestId("payment-back").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toContainText("Cheese Burger");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£9.00");

    expect(checkout.placeOrderCount).toBe(0);
    expectNothingDangerousWasContacted(checkout);
  });

  test("COD DISABLED: /payment renders payment-unavailable with no counter tile and a working back", async ({
    page,
  }) => {
    test.slow();
    // The fixture's disable-COD row ticks the session's tab (selected: true),
    // which is what turns COD off under the fork's live rule (A2).
    const checkout = await bootToBagWithOneBurger(page, { codDisabled: true });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-unavailable")).toBeVisible({
      timeout: 15_000,
    });
    // P8a has zero gateway tiles by construction, so with COD off there is no
    // payment method at all — and no way to start one.
    await expect(page.getByTestId("payment-screen")).toHaveCount(0);
    await expect(page.getByTestId("payment-counter")).toHaveCount(0);

    // Rule 2: the dead end still has a live exit.
    await page.getByTestId("payment-back").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(bagRows(page)).toHaveCount(1);

    expect(checkout.placeOrderCount).toBe(0);
    expectNothingDangerousWasContacted(checkout);
  });

  test("COCKPIT DEFAULT ROW: an unticked 'Disable COD for Kiosk' row keeps PAY AT COUNTER on a table tab (A2 — the fork's live rule)", async ({
    page,
  }) => {
    test.slow();
    const checkout = await bootToBagWithOneBurger(page, {
      tabType: "table",
      deploymentSettings: [COCKPIT_DEFAULT_COD_ROW],
    });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("tent-screen")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("tent-skip").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });
    // Only a ticked tab (selected: true) turns COD off.
    await expect(page.getByTestId("payment-counter")).toBeVisible();
    await expect(page.getByTestId("payment-unavailable")).toHaveCount(0);

    // The row really was served to this boot.
    expect(checkout.deploymentSettingsCount).toBeGreaterThan(0);
    expect(checkout.placeOrderCount).toBe(0);
    expectNothingDangerousWasContacted(checkout);
  });

  test("TAKE-OUT TICK: the Cockpit row with Take Out ticked turns COD off for a take_away session — the take-out spellings are one family, matched on tabType, never tabLabel (A2)", async ({
    page,
  }) => {
    test.slow();
    // The Cockpit row's take-out tab is `takeout` ("Take Out"); this session's
    // pipeline says `take_away`.
    const checkout = await bootToBagWithOneBurger(page, {
      tabType: "take_away",
      deploymentSettings: [
        {
          ...COCKPIT_DEFAULT_COD_ROW,
          tabs: COCKPIT_DEFAULT_COD_ROW.tabs.map((tab) =>
            tab.tabType === "takeout" ? { ...tab, selected: true } : tab
          ),
        },
      ],
    });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-unavailable")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("payment-counter")).toHaveCount(0);

    expect(checkout.deploymentSettingsCount).toBeGreaterThan(0);
    expect(checkout.placeOrderCount).toBe(0);
    expectNothingDangerousWasContacted(checkout);
  });

  test("LABEL-ONLY ROW: a 'Disable COD for Kiosk' row that carries only its label (the pre-A2 SDK's key) still turns COD off for its ticked tab (A2: name OR label)", async ({
    page,
  }) => {
    test.slow();
    const checkout = await bootToBagWithOneBurger(page, {
      deploymentSettings: [
        {
          _id: "disable_cod_kiosk_label_only",
          label: "Disable COD for Kiosk",
          tabs: [{ tabLabel: "Dine In", tabType: "dine_in", selected: true }],
        },
      ],
    });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-unavailable")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("payment-counter")).toHaveCount(0);
    expect(checkout.placeOrderCount).toBe(0);
    expectNothingDangerousWasContacted(checkout);
  });

  test("CHECKOUT /phone CANCEL ORDER asks first: NO keeps the bag; YES ends on /start and the next guest's bag is empty (A3)", async ({
    page,
  }) => {
    test.slow();
    // skipCRM OFF, loyalty off, dine-in: resolveCheckoutRoute → "phone", so
    // PAY opens /phone in CHECKOUT mode (the guest has a bag).
    const checkout = await bootToBagWithOneBurger(page, {}, { skipCRM: false });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("phone-screen")).toBeVisible({
      timeout: 15_000,
    });

    // NO: the confirm closes and nothing else moves — Back still finds the bag.
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toHaveCount(0);
    await expect(page).toHaveURL(/\/phone$/);
    await page.getByTestId("phone-back").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-pay")).toContainText("£9.00");

    // YES: only a navigation to /start, whose mount ends the session (H1).
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("phone-screen")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("footer-cancel").click();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/start$/);

    // The next guest starts with an empty bag.
    await page.getByTestId("start-screen").click();
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");

    expect(checkout.placeOrderCount).toBe(0);
    expectNothingDangerousWasContacted(checkout);
  });

  test("TABLE TAB: PAY lands on /tent; out-of-range entries are refused; a valid number continues to /payment", async ({
    page,
  }) => {
    test.slow();
    // tab_type "table" is the first branch of resolveCheckoutRoute, ahead of
    // skipCRM. Range is the fixture default, 1..99.
    const checkout = await bootToBagWithOneBurger(page, { tabType: "table" });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("tent-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/tent$/);

    // Below the floor: accepted by the per-keypress ceiling check (0 < 99),
    // refused by the Continue-time range check.
    await page.getByTestId("numpad-key-0").click();
    await expect(page.getByTestId("tent-display")).toHaveText("0");
    await page.getByTestId("tent-confirm").click();
    await expect(page.getByTestId("tent-error")).toBeVisible();
    await expect(page.getByTestId("tent-screen")).toBeVisible();
    await expect(page).toHaveURL(/\/tent$/);

    // Above the ceiling: refused per keypress — the third 9 never lands, and
    // an accepted keypress clears the previous error first (handleChange).
    await page.getByTestId("numpad-clear").click();
    await page.getByTestId("numpad-key-9").click();
    await page.getByTestId("numpad-key-9").click();
    await expect(page.getByTestId("tent-display")).toHaveText("99");
    await expect(page.getByTestId("tent-error")).toHaveCount(0);
    await page.getByTestId("numpad-key-9").click();
    await expect(page.getByTestId("tent-error")).toBeVisible();
    await expect(page.getByTestId("tent-display")).toHaveText("99");

    // In range: continues down the same fan-out — skipCRM → /payment.
    await page.getByTestId("numpad-clear").click();
    await page.getByTestId("numpad-key-1").click();
    await page.getByTestId("numpad-key-2").click();
    await expect(page.getByTestId("tent-display")).toHaveText("12");
    await page.getByTestId("tent-confirm").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("payment-total")).toContainText("£9.00");

    expect(checkout.placeOrderCount).toBe(0);
    expectNothingDangerousWasContacted(checkout);
  });

  test("TABLE TAB: NO THANKS skips the tent and continues to /payment, and the order still pushes as COD", async ({
    page,
  }) => {
    test.slow();
    const checkout = await bootToBagWithOneBurger(page, { tabType: "table" });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("tent-screen")).toBeVisible({
      timeout: 15_000,
    });

    // Tent stays empty → `tableNumber: ""` in the payload.
    await page.getByTestId("tent-skip").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });

    await payAtCounterThroughBuffer(page);
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({
      timeout: 20_000,
    });

    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.lastPlaceOrderBody).toMatchObject({
      payments: { type: "COD" },
      tabType: "table",
      tableNumber: "",
    });

    expectNothingDangerousWasContacted(checkout);
  });

  test("PUSH FAILURE: the retry ladder runs ORDER_PUSH_MAX_ATTEMPTS times and never reaches /orderSuccess", async ({
    page,
  }) => {
    test.slow();
    // Every push answered 500 → 4 attempts with 1s/2s/3s linear backoff.
    const checkout = await bootToBagWithOneBurger(page, {
      failPlaceOrderTimes: 10,
    });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });
    await payAtCounterThroughBuffer(page);
    await page.getByTestId("receipt-none").click();

    // Stepped through the ladder's own backoff, checked by the state it produces.
    await stepClockUntil(page, () => checkout.placeOrderCount === 4);
    // And it stops there — no fifth attempt, ever: 15 s of fake time pass,
    // well past the next backoff (4 s), and the count has not moved.
    await page.clock.runFor(15_000);
    expect(checkout.placeOrderCount).toBe(4);
    expect(checkout.placeOrderFailures).toBe(4);

    // A customer whose order never landed must NOT be shown a success screen.
    await expect(page).not.toHaveURL(/\/orderSuccess$/);
    await expect(page.getByTestId("order-success")).toHaveCount(0);

    expectNothingDangerousWasContacted(checkout);
  });

  test("PUSH FAILURE: exhaustion surfaces order-error, and Retry succeeding lands on /orderSuccess", async ({
    page,
  }) => {
    test.slow();
    // The first 4 pushes fail (the ladder exhausts); the 5th — the one
    // Retry fires — succeeds.
    const checkout = await bootToBagWithOneBurger(page, {
      failPlaceOrderTimes: 4,
    });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });
    await payAtCounterThroughBuffer(page);
    await page.getByTestId("receipt-none").click();

    await stepClockUntil(page, () => checkout.placeOrderCount === 4);

    // Rule 2: an exhausted ladder must be an explicit terminal state with two
    // live exits — never a dead modal and never a stranded customer.
    await expect(page.getByTestId("order-error")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("order-error-back")).toBeVisible();
    await expect(page.getByTestId("order-error-retry")).toBeVisible();

    // Retry reuses the SAME order id, so one customer can never end up with
    // two orders — and this time the endpoint answers 200.
    await page.getByTestId("order-error-retry").click();
    await expect(page.getByTestId("order-success")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("order-number")).toHaveText(/^#\d{5}$/);

    expect(checkout.placeOrderCount).toBe(5);
    expect(checkout.lastPlaceOrderBody).toMatchObject({
      payments: { type: "COD" },
    });

    expectNothingDangerousWasContacted(checkout);
  });

  test("ORDER COMPLETE: 20 s after it opens it goes to /start, whose mount resets; the next guest's bag is empty", async ({
    page,
  }) => {
    test.slow();
    const checkout = await bootToBagWithOneBurger(page);

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });
    await payAtCounterThroughBuffer(page);
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({
      timeout: 20_000,
    });

    // No control (Figma 1:5932): its own 20 s timer takes the kiosk to the
    // splash, whose mount runs the FULL reset.
    await page.clock.runFor(20_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/start$/);

    // The next guest starts with an empty bag.
    await page.getByTestId("start-screen").click();
    await expect(page).toHaveURL(/\/second$/, { timeout: 10_000 });
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toContainText("0.00");

    // The reset must not have re-sent anything.
    expect(checkout.placeOrderCount).toBe(1);
    expectNothingDangerousWasContacted(checkout);
  });

  test("BROWSER BACK is a no-op: on /payment and on Order Complete the screen stays and nothing is placed again", async ({
    page,
  }) => {
    test.slow();
    const checkout = await bootToBagWithOneBurger(page);

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });
    // A trusted Back (key / gesture) never reaches the router: no bag.
    await page.goBack();
    await expect(page).toHaveURL(/\/payment$/);
    await expect(page.getByTestId("payment-screen")).toBeVisible();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);

    await payAtCounterThroughBuffer(page);
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({
      timeout: 20_000,
    });

    // Back on Order Complete used to reopen /receipt, whose NO THANKS placed
    // a SECOND order. Twice: the trap keeps the history depth.
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/orderSuccess$/);
    await expect(page.getByTestId("order-success")).toBeVisible();
    await expect(page.getByTestId("receipt-screen")).toHaveCount(0);

    expect(checkout.placeOrderCount).toBe(1);
    expectNothingDangerousWasContacted(checkout);
  });

  test("⛔ SAFETY: a full pay-at-counter order — even one that asks to PRINT — contacts no print agent and no gateway", async ({
    page,
  }) => {
    test.slow();
    // The most dangerous configuration this phase can be driven into: the
    // customer explicitly asks for a printed receipt, while `print_bill` is
    // OFF. The choice alone must not be enough to reach the local agent.
    const checkout = await bootToBagWithOneBurger(page, {
      printBill: false,
      printViaPos: false,
    });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({
      timeout: 15_000,
    });
    await payAtCounterThroughBuffer(page);
    await page.getByTestId("receipt-print").click();
    await expect(page.getByTestId("order-success")).toBeVisible({
      timeout: 20_000,
    });

    // Proof the guards were actually LIVE for this run: the boot settings
    // fetches went through the same mock surface that holds them. Without
    // this, an all-green safety assertion could just mean nothing ran.
    expect(checkout.deviceDataCount).toBeGreaterThan(0);
    expect(checkout.paymentPartnersCount).toBeGreaterThan(0);

    // One order, on the one allowed endpoint, as COD.
    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.lastPlaceOrderBody).toMatchObject({
      payments: { type: "COD" },
    });

    // ⛔ THE ASSERTION THIS WHOLE PHASE EXISTS TO KEEP TRUE: no gateway
    // prefix, no backend-ordering placeOrder, no Mashreq/terminal origin, and
    // no https://localhost:65505 print agent was ever requested.
    expectNothingDangerousWasContacted(checkout);
  });
});
