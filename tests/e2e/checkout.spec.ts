import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mockCheckoutBackend,
  type CheckoutMockHandle,
  type CheckoutMockOptions,
} from "./fixtures/checkout";

/**
 * P8a — checkout fan-out → PAY AT COUNTER → order push → Order Complete.
 *
 * Covers the whole pay-at-counter vertical end to end: the bag's PAY
 * preflight landing on its real destination (no more /checkout stub), the
 * /tent table-number step, /payment's method choice and its cancel window,
 * the /receipt preference step, the guarded push, /orderSuccess and both of
 * its exits — plus the retry ladder on a failing push.
 *
 * ── ⛔ THE SAFETY SPEC (brief §SAFETY) ──────────────────────────────────
 * This vertical must be incapable of reaching a payment gateway, a terminal
 * socket or a card flow. That is asserted, not assumed. `mockCheckoutBackend`
 * (tests/e2e/fixtures/checkout.ts) fulfils every gateway prefix, the
 * backend-ordering `placeOrder` variant and the Mashreq/terminal origins with
 * a LOUD 500 and flips `handle.forbiddenHit`; it aborts the cross-origin
 * print agent (https://localhost:65505 — the `**\/api/**` catch-all does NOT
 * cover it) and flips `handle.printAgentContacted`. Every test in this file
 * ends with {@link expectNothingDangerousWasContacted}, and the last test
 * exists for nothing else. Without those guards the house `**\/api/**`
 * catch-all answers `{}` with HTTP 200, so a regression that called a gateway
 * would look like a PASS.
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
 * Playwright matches routes NEWEST-FIRST and the house style registers the
 * `**\/api/**` catch-all FIRST, so `mockCheckoutBackend` MUST be layered
 * AFTER `mockKioskBackend` or the catch-all `{}` swallows placeOrder and the
 * settings endpoints. {@link bootToBagWithOneBurger} enforces that ordering.
 *
 * ── BOOT HELPERS ────────────────────────────────────────────────────────
 * `mockKioskBackend` / `bootRegisteredToMenu` / `addCheeseBurgerViaPdp` /
 * `openBag` are copied from bag.spec.ts (neither it nor pack.spec.ts exports
 * them — copying is the established precedent in this suite), with ONE P8a
 * delta: `get_kiosk_settings` carries `skip_crm_page`. Every scenario here
 * runs with skipCRM ON and loyalty OFF, which is what makes
 * `resolveCheckoutRoute` return "payment" for a dine-in tab and "tent" for a
 * table tab — the two routes this phase builds. The loyalty ("customerName")
 * and no-loyalty-no-skipCRM ("phone") legs of the fan-out belong to
 * loyalty.spec.ts and are deliberately not duplicated here.
 *
 * ── FIXTURE MONEY (same facts as bag.spec.ts's header) ──────────────────
 * Every slim-menu item carries VAT@15%, which the bill engine treats as
 * EXCLUSIVE, and getNetAmount() rounds to 0 decimals — so
 * Total = round(SubTotal * 1.15). One Cheese Burger: £8 subtotal → £9 total.
 * £9.00 is therefore what `bag-pay`, `payment-total` and the pushed order all
 * have to agree on.
 *
 * ── TIMING: EXPLICIT WAITS ONLY, NEVER A SLEEP ──────────────────────────
 * Two real timers sit in this flow and both are waited on by asserting the
 * state they produce, not by sleeping:
 *   - /payment's 3000ms cancel window ends by navigating to /receipt, so the
 *     wait is `expect(receipt-screen).toBeVisible()`.
 *   - the push retry ladder (ORDER_PUSH_MAX_ATTEMPTS = 4, linear 1s/2s/3s
 *     backoff ≈ 6s) is waited on with `expect.poll(() => handle.placeOrderCount)`.
 * ⚠️ /orderSuccess runs a 20s countdown that auto-resets to /start, so every
 * assertion on that screen must be made promptly — do not add waits there.
 */

const LOGIN_OK = {
  licenseDetails: {
    login_code: "mock-device-token",
    expiry_date: "2099-01-01T00:00:00.000Z",
  },
  deploymentDetails: {
    _id: "dep1",
    brand_id: "brand1",
    tenant_id: "tenant1",
    cluster_id: "cluster1",
  },
};

const slimMenu = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)),
    "utf-8"
  )
);

/** £8, 3 addon groups with no priced defaults — a plain add commits at £8.00. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";

/**
 * Boot + menu mocks (copied from bag.spec.ts). Order matters: Playwright
 * matches routes newest-first, so the catch-all is registered FIRST and every
 * specific mock after it.
 *
 * P8a delta: `skip_crm_page`. With it ON and `enable_loyalty` absent,
 * `resolveCheckoutRoute` returns "payment" (dine-in) or "tent" (table) — the
 * two destinations this phase owns.
 */
async function mockKioskBackend(page: Page, { skipCRM = true } = {}) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: {},
      },
    })
  );
  await page.route("**/api/cx/getCxSkinData", (r) =>
    r.fulfill({ json: { skin_id: "skin_1" } })
  );
  await page.route("**/api/cx/kiosk/get_theme", (r) =>
    r.fulfill({
      json: {
        theme_color: [
          { key: "button_text_border_icon", color_hex: "#501098" },
          { key: "button_background", color_hex: "#ffffff" },
        ],
        primary_color_shades: [],
      },
    })
  );
  await page.route("**/api/cx/get_kiosk_settings", (r) =>
    r.fulfill({
      json: {
        start_order_text_primary: "START ORDER",
        ideal_time: "180",
        // skipCRM keeps the fan-out on the two P8a routes and makes
        // /payment's back CTA return to /cart rather than /customerName.
        skip_crm_page: skipCRM,
        // Label only — the dispatched type is PAY_AT_RESTAURANT either way
        // (settingsEngine.getIsPayAtCounter), so no assertion depends on it.
        pay_at_counter: "pay_at_counter",
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [
        { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" },
      ],
    })
  );
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/cx/kiosk/get_data", (r) =>
    r.fulfill({
      json: {
        charges: [],
        deployment: { countryCode: "GB", currencySettings: { symbol: "£" } },
      },
    })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
}

/** Register on the on-screen keyboard and land on /menu (copied from bag.spec.ts). */
async function bootRegisteredToMenu(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

/**
 * Menu card tap → customization PDP → commit → dismiss the added modal
 * (customized adds always confirm). No addon is picked, so the row commits at
 * the item's own £8.00.
 */
async function addCheeseBurgerViaPdp(page: Page) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("product-added-modal")).toBeVisible();
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).not.toBeVisible();
}

/**
 * VIEW MY BAG → /cart (Menu with the bag sheet open). The P7d pre-cart upsell
 * sits on this edge and its gate is opt-OUT, so the first openBag() of a
 * session may land on /forYou — settle on whichever arrived (declining
 * mutates no cart state). Owned by forYou.spec.ts.
 */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

const bagRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');

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

/**
 * ⛔ The standing safety assertion — every test ends with it.
 *
 * `forbiddenUrls` / `printAgentUrls` are folded into the assertion so a
 * failure names the exact URL that was reached instead of just "expected
 * false, got true".
 */
function expectNothingDangerousWasContacted(handle: CheckoutMockHandle) {
  expect(
    handle.forbiddenUrls,
    "a gateway / terminal / backend-ordering endpoint was contacted"
  ).toEqual([]);
  expect(handle.forbiddenHit).toBe(false);
  expect(
    handle.printAgentUrls,
    "the local print agent was contacted"
  ).toEqual([]);
  expect(handle.printAgentContacted).toBe(false);
}

/** /payment's cancel window ends by navigating; never slept through. */
async function payAtCounterThroughBuffer(page: Page) {
  await page.getByTestId("payment-counter").click();
  await expect(page.getByTestId("payment-buffer")).toBeVisible();
  await expect(page.getByTestId("payment-buffer-cancel")).toBeVisible();
  // The 3000ms window closes by routing to the receipt step.
  await expect(page.getByTestId("receipt-screen")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("P8a checkout → PAY AT COUNTER → order push → Order Complete", () => {
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
    // The card tile exists but is inert — P8a can reach no gateway at all.
    await expect(page.getByTestId("payment-card")).toHaveAttribute(
      "aria-disabled",
      "true"
    );

    // Nothing may have been placed before the customer chose a method.
    expect(checkout.placeOrderCount).toBe(0);

    await payAtCounterThroughBuffer(page);
    // EMAIL has no data contract and must collect nothing (brief §receipt).
    await expect(page.getByTestId("receipt-email")).toHaveAttribute(
      "aria-disabled",
      "true"
    );

    // NO THANKS → the push runs, then /orderSuccess.
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
    // The fixture writes BOTH key spellings of the disable-COD entity, so the
    // screen behaves the same under the SDK check and the page-local one.
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

    // Waited on by the state the ladder produces, not by sleeping.
    await expect
      .poll(() => checkout.placeOrderCount, { timeout: 30_000 })
      .toBe(4);
    // And it stops there — no fifth attempt, ever.
    await expect.poll(() => checkout.placeOrderCount, { timeout: 5_000 }).toBe(4);
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

    await expect
      .poll(() => checkout.placeOrderCount, { timeout: 30_000 })
      .toBe(4);

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

  test("ORDER COMPLETE: Place New Order resets to /second with an empty bag", async ({
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

    // ⚠️ The screen auto-resets after 20s — act promptly, never wait here.
    await page.getByTestId("order-success-neworder").click();
    await expect(page).toHaveURL(/\/second$/, { timeout: 10_000 });

    // "nextCustomer" keeps the menu loaded, so /second is instant — but every
    // customer-scoped datum, the cart included, has to be gone.
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

  test("ORDER COMPLETE: Start Over resets the session all the way back to /start", async ({
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

    await page.getByTestId("order-success-startover").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/start$/);

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
