import {
  test,
  expect,
  type Page,
  type Route,
  REQUEST_BUDGET_MS,
  MENU_BUDGET_MS,
  stepClockUntil,
  persistedSlice,
} from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  holdRequests,
  locale,
  SKIP_CRM,
  GREEK_SALAD,
} from "./fixtures/backend";
import {
  submitLicence,
  registerToStart,
  startToSecond,
  pickPipelineToMenu,
  holdHotspot,
} from "./pages/boot";
import { addOneTap, openBag, loginToRewards, typeDigits } from "./pages/order";
import {
  mockCheckoutBackend,
  PLACE_ORDER_URL,
  orderIdOf,
  type CheckoutMockHandle,
} from "./fixtures/checkout";
import {
  mockXenoLoyalty,
  LOYALTY_OTP,
  LOYALTY_PHONE,
  LOYALTY_POINTS_TOTAL,
  LOYALTY_REWARDS,
  LOYALTY_SETTINGS,
} from "./fixtures/loyalty";

/**
 * P9b — Rule 2 recovery, end to end (rulebook flow 6): a failed or hung
 * backend call always ends on a screen that says so and offers a way on —
 * never a frozen overlay, a blank pane or a silent success.
 *
 * Covers TB's transport budgets (src/redux/app/apiSlice.ts: 10 s per request,
 * getMenu 30 s), the menu-load dialog on /second, boot recovery on
 * /LoadingResources, loyalty degrading at boot (R6), the order push after a
 * timeout (U2: one attempt, the UNCERTAIN copy, Retry reuses the order id)
 * against a clean 5xx (the 4-attempt ladder), the redeem_coupon money fix
 * (D1) and the offline overlay over a dying menu load.
 *
 * ── TIME: page.clock, NEVER REAL WAITS ──────────────────────────────────
 * `page.clock.install()` runs before the first goto (beforeEach). RTK 2.12's
 * request timeout is a page `setTimeout` (timeoutSignal), so the fake clock
 * owns every budget. The installed clock keeps flowing in real time between
 * calls. A timer that already exists (a request budget, the 3 s operator
 * hold) is reached with one `runFor`. A CHAIN whose next timer is armed by
 * the page reacting to the last one (the boot countdown's per-tick React
 * effect, the push ladder's backoff after each failed response) can outrun
 * a single runFor under load — it stops early and the rest would run in real
 * time — so chains are stepped with `stepClockUntil`, which waits on the
 * state they produce.
 * "Not yet" checks keep a wide margin from their deadline because real time
 * trickles in between calls.
 *
 * ── A HUNG BACKEND ──────────────────────────────────────────────────────
 * `holdRequests` parks a request and never answers it. The PAGE settles it
 * when its budget aborts the fetch, so a parked route is never fulfilled
 * afterwards (only `abort`ed, to model a dropped connection) — a retry is a
 * new request, handed on to the older mock. `answerInTurn` scripts the first
 * N answers of an endpoint the same way and passes the rest on.
 *
 * ── MOCK ORDER ──────────────────────────────────────────────────────────
 * The harness house order, NEWEST route wins: the shared mock first
 * (fixtures/backend.ts — its origin-scoped `/api/` catch-all, then every
 * boot endpoint), the fixture layers (checkout, loyalty) next, each test's
 * hold/script LAST. The print agent and the Xeno revoke are other origins:
 * only their fixtures answer them, and the harness (fixtures/kiosk.ts)
 * denies an unrouted call by name. `holdRequests`, `stepClockUntil` and the
 * boot / bag steps are the shared harness's (fixtures/, pages/).
 * Customer-facing copy is read from the EN translation file, so the panel
 * VARIANT is what is asserted, not a paraphrase of it.
 */

const en = locale("en");

const GET_MENU_URL = "**/api/cx/kiosk/getMenu";
const KIOSK_SETTINGS_URL = "**/api/cx/get_kiosk_settings";
const PIPELINES_URL = "**/api/cx/kiosk/getPipelines";
const LOYALTY_PARTNER_URL = "**/api/cx/kiosk/getLoyaltyPartner";
/** All Xeno ops share execute_event; the op is the event_name query param. */
const REDEEM_COUPON_URL = /\/api\/partners\/execute_event\?.*event_name=redeem_coupon/;

interface KioskMockOptions {
  /** Pay-at-counter fan-out (checkout.spec.ts): PAY → /payment. */
  skipCRM?: boolean;
  /** Xeno loyalty enabled in the kiosk settings (loyalty.spec.ts). */
  loyalty?: boolean;
}

/** The shared mock with this spec's switches (LOYALTY_SETTINGS last: its skip_crm_page wins). */
const mockKioskBackend = (page: Page, opts: KioskMockOptions = {}) =>
  mockBackend(page, {
    settings: { ...(opts.skipCRM ? SKIP_CRM : {}), ...(opts.loyalty ? LOYALTY_SETTINGS : {}) },
  });

/**
 * Scripts the first answers of an endpoint: request N gets `answers[N]`,
 * everything after the script falls back to the older mock. `count` is every
 * matching request, scripted or not.
 */
async function answerInTurn(
  page: Page,
  url: string | RegExp,
  answers: Array<(route: Route) => Promise<void>>
): Promise<{ readonly count: number }> {
  let seen = 0;
  await page.route(url, (route) => {
    const answer = answers[seen];
    seen += 1;
    return answer ? answer(route) : route.fallback();
  });
  return {
    get count() {
      return seen;
    },
  };
}

/** URLs of matching requests the page saw FAIL (aborted by a budget, dropped…). */
function failedRequests(page: Page, pattern: RegExp): string[] {
  const failed: string[] = [];
  page.on("requestfailed", (request) => {
    if (pattern.test(request.url())) failed.push(request.url());
  });
  return failed;
}

/** Splash → order type → /menu (loyalty on or off: no phone first, user 2026-10-17). */
async function startOrderToMenu(page: Page) {
  await startToSecond(page);
  await pickPipelineToMenu(page);
}

const addGreekSaladOneTap = (page: Page, expectedCount: string) =>
  addOneTap(page, GREEK_SALAD, expectedCount);

/** One Greek Salad, then PAY → /payment → PAY AT COUNTER → /receipt → NO THANKS. */
async function pushOneSaladAtCounter(page: Page) {
  await startOrderToMenu(page);
  await addGreekSaladOneTap(page, "(1)");
  await openBag(page);
  await page.getByTestId("bag-pay").click();
  await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("payment-counter").click();
  // /payment's 3 s cancel window, armed by the tap, ends on /receipt.
  await page.clock.runFor(3_000);
  await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("receipt-none").click();
}

/**
 * The persisted loyalty slice (redux-persist's `persist:root`) — loyalty
 * state has no UI surface on these screens. Read-only.
 */
const persistedLoyalty = (page: Page) =>
  persistedSlice<{ isLoyaltyOn?: boolean; totalLoyaltyPoints?: number }>(page, "loyalty");

/** checkout.spec.ts's standing safety assertion (no gateway, no print agent). */
function expectNothingDangerousWasContacted(handle: CheckoutMockHandle) {
  expect(
    handle.forbiddenUrls,
    "a gateway / terminal / backend-ordering endpoint was contacted"
  ).toEqual([]);
  expect(handle.printAgentUrls, "the local print agent was contacted").toEqual([]);
}

test.describe("P9b Rule 2 recovery", () => {
  // Before ANY page script runs: RTK arms its budget timers with the page's
  // setTimeout, so a clock installed after goto would never own them.
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("MENU 500: a failed menu fetch keeps the guest on /second behind menu-error; TRY AGAIN re-runs only the fetches and enters /menu", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    let chargesCalls = 0;
    await page.route("**/api/cx/kiosk/get_data", (route) => {
      chargesCalls += 1;
      return route.fallback();
    });
    const menu = await answerInTurn(page, GET_MENU_URL, [
      (route) => route.fulfill({ status: 500, json: { message: "menu down" } }),
    ]);
    await registerToStart(page);
    await startToSecond(page);

    await page.getByTestId("pipeline-p1").click();
    // An alertdialog named by its title and described by its message.
    const dialog = page.getByRole("alertdialog", { name: en.menuError.title });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toHaveAccessibleDescription(en.menuError.message);
    await expect(page).toHaveURL(/\/second$/);
    await expect(page.getByTestId("menu-screen")).toHaveCount(0);
    expect(menu.count).toBe(1);
    expect(chargesCalls).toBe(1);

    await page.getByTestId("menu-error-retry").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("category-rail")).toContainText("Side Orders");
    expect(menu.count).toBe(2);
    // Fix M2: the retry re-requests the pipeline's charges with the menu, so
    // the bill never runs on the last good pipeline's.
    expect(chargesCalls).toBe(2);
  });

  test("MENU HANG: a getMenu that never answers is still loading past 10 s (its budget is 30 s, not the default) and fails onto menu-error at 30 s; TRY AGAIN recovers", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    const menu = await holdRequests(page, GET_MENU_URL);
    const failed = failedRequests(page, /\/api\/cx\/kiosk\/getMenu/);
    await registerToStart(page);
    await startToSecond(page);

    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-fetching")).toBeVisible();
    await expect.poll(() => menu.count).toBe(1);

    // Past the 10 s default with ~20 s to spare. The extra beat lets a
    // render the jump caused land before the absence checks.
    await page.clock.runFor(REQUEST_BUDGET_MS + 500);
    await page.clock.runFor(500);
    await expect(page.getByTestId("menu-fetching")).toBeVisible();
    await expect(page.getByTestId("menu-error")).toHaveCount(0);
    expect(failed).toEqual([]);

    // Past 30 s: the transport aborts the download and the screen says so.
    await page.clock.runFor(MENU_BUDGET_MS - REQUEST_BUDGET_MS);
    await expect(page.getByTestId("menu-error")).toBeVisible();
    await expect(page.getByTestId("menu-fetching")).toHaveCount(0);
    await expect(page).toHaveURL(/\/second$/);
    await expect.poll(() => failed.length).toBe(1);

    menu.disarm();
    await page.getByTestId("menu-error-retry").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("category-rail")).toContainText("Side Orders");
  });

  test("BOOT: a failing settings call shows the categorised error with a countdown and no Back-to-registration, retries itself 10 s then 30 s later, and boots to /start", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    // Boots are counted on the pipelines call (every boot makes it; the
    // settings call comes after it).
    const pipelines = await answerInTurn(page, PIPELINES_URL, [
      // 1st boot: pipelines answer; the settings call after them fails.
      (route) => route.fallback(),
      // 2nd boot: reachable but misconfigured (no pipeline) → config error.
      // (audit-fixes B6: a missing splash text no longer stops a boot.)
      (route) => route.fulfill({ json: [] }),
    ]);
    const settings = await answerInTurn(page, KIOSK_SETTINGS_URL, [
      // 1st boot: the backend is down → "unavailable".
      (route) => route.fulfill({ status: 500, json: {} }),
    ]);
    const retryNote = (seconds: string) =>
      new RegExp(`^${en.loading.retryIn.replace("{{seconds}}", seconds)}$`);
    await submitLicence(page);

    const dialog = page.getByTestId("loading-error");
    const note = page.getByTestId("loading-error-note");
    await expect(
      page.getByRole("alertdialog", { name: en.loading.unavailableTitle })
    ).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(en.loading.unavailableBody);
    // First wait 10 s (one tick may already have passed in real time).
    await expect(note).toHaveText(retryNote("(10|9)"));
    // No way back to an un-booted splash: TRY AGAIN NOW is the only button.
    await expect(dialog.getByRole("button")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /back to registration/i })
    ).toHaveCount(0);
    await expect(page).toHaveURL(/\/LoadingResources$/);
    expect(pipelines.count).toBe(1);
    expect(settings.count).toBe(1);

    // The countdown retries by itself; the next stop is a CONFIG error with
    // its own reason, and the cadence steps up to 30 s.
    await stepClockUntil(page, () => pipelines.count === 2);
    await expect(
      page.getByRole("alertdialog", { name: en.loading.errorTitle })
    ).toBeVisible();
    await expect(dialog).toContainText(en.loading.configNoPipelines);
    await expect(note).toHaveText(retryNote("(30|29)"));
    expect(pipelines.count).toBe(2);
    // The config stop came before the settings step.
    expect(settings.count).toBe(1);

    // Operator escape (replaces "Back to registration"): the splash's hidden
    // 3 s top-left hold opens the Activity Center over the dialog.
    await holdHotspot(page, "loading-activity-hotspot");
    await expect(page.getByTestId("activity-modal")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await page.getByTestId("activity-close").click();
    await expect(page.getByTestId("activity-modal")).toHaveCount(0);
    await expect(dialog).toBeVisible();

    // The rest of the 30 s: the third boot succeeds.
    await stepClockUntil(page, () => pipelines.count === 3, { timeout: 30_000 });
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/start$/);
    expect(pipelines.count).toBe(3);
    expect(settings.count).toBe(2);
  });

  test("LOYALTY DOWN AT BOOT: the kiosk boots and sells loyalty-off (the Activity Center says Unavailable, the menu has no REWARDS link); the next splash visit retries and brings REWARDS back", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { loyalty: true });
    const xeno = await mockXenoLoyalty(page);
    let partnerDown = true;
    let partnerCalls = 0;
    await page.route(LOYALTY_PARTNER_URL, (route) => {
      partnerCalls += 1;
      return partnerDown
        ? route.fulfill({ status: 500, json: { message: "proxy down" } })
        : route.fallback();
    });

    // R6: the dead proxy does not block boot.
    await registerToStart(page);
    // Boot asked once and degraded; the splash's own retry asked once more.
    await expect.poll(() => partnerCalls).toBe(2);
    expect(xeno.partnerCount).toBe(0);

    await holdHotspot(page, "activity-hotspot");
    const activity = page.getByTestId("activity-modal");
    await expect(activity).toBeVisible();
    await expect(activity).toContainText(en.activity.loyaltyUnavailable);
    await page.getByTestId("activity-close").click();
    await expect(activity).toHaveCount(0);

    // Loyalty-off: the menu offers no rewards login (MenuCtaBar hides the
    // link unless getIsLoyaltyOn).
    await startOrderToMenu(page);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-view-bag")).toBeVisible();
    await expect(page.getByTestId("menu-rewards-link")).toHaveCount(0);
    expect(xeno.events.check_loyalty_balance).toBe(0);

    // The proxy recovers. Ending the session lands on a NEW splash visit,
    // whose retry resolves the partner (fix M1).
    partnerDown = false;
    await page.getByTestId("footer-cancel").click();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => xeno.partnerCount).toBe(1);
    // Applied only while the splash is up — wait for it before tapping on.
    await expect
      .poll(async () => (await persistedLoyalty(page)).isLoyaltyOn)
      .toBe(true);
    await startOrderToMenu(page);
    await expect(page.getByTestId("menu-rewards-link")).toBeVisible();
  });

  test("PUSH TIMEOUT (U2): a placeOrder that never answers ends at its 10 s budget on the UNCERTAIN panel after ONE request — no ladder, no logout; Retry reuses the order id and lands on /orderSuccess", async ({
    page,
    context,
  }) => {
    test.slow();
    await mockKioskBackend(page, { skipCRM: true });
    const checkout = await mockCheckoutBackend(page);
    // Only the first push hangs; Retry's push reaches the fixture (200).
    const push = await holdRequests(page, PLACE_ORDER_URL, { times: 1 });
    const failedPushes = failedRequests(
      page,
      /\/onlineOrders\/partner\/kiosk\/placeOrder/
    );
    await registerToStart(page);
    await pushOneSaladAtCounter(page);
    await expect.poll(() => push.count).toBe(1);
    await expect(page.getByTestId("payment-buffer")).toBeVisible();

    await page.clock.runFor(REQUEST_BUDGET_MS);
    const panel = page.getByTestId("order-error");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(en.orderError.uncertainTitle);
    await expect(panel).toContainText(en.orderError.uncertainMessage);
    // "Didn't reach the restaurant" would be false after a timeout.
    await expect(panel).not.toContainText(en.orderError.message);
    await expect.poll(() => failedPushes.length).toBe(1);

    // No auto-retry: a whole 1+2+3 s ladder later, still the one request.
    await page.clock.runFor(15_000);
    expect(push.count).toBe(1);
    expect(checkout.placeOrderCount).toBe(0);
    await expect(panel).toBeVisible();
    // A timeout is not an auth or server failure: still registered, still here.
    expect((await context.cookies()).some((c) => c.name === "token")).toBe(true);
    await expect(page).toHaveURL(/\/receipt$/);

    // Only the customer's own Retry resends — under the SAME order id.
    await page.getByTestId("order-error-retry").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 15_000 });
    const orderId = orderIdOf(push.requests[0].postDataJSON());
    expect(orderId).not.toBe("");
    expect(orderIdOf(checkout.lastPlaceOrderBody)).toBe(orderId);
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${orderId.slice(-5)}`
    );
    expect(push.count + checkout.placeOrderCount).toBe(2);
    expect(checkout.lastPlaceOrderBody).toMatchObject({ payments: { type: "COD" } });
    expectNothingDangerousWasContacted(checkout);
  });

  test("PUSH 5xx: clean failures keep the 4-attempt ladder and the plain 'didn't reach the restaurant' copy; Retry reuses the order id", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { skipCRM: true });
    // Four 500s exhaust the ladder; the fifth push (Retry's) succeeds.
    const checkout = await mockCheckoutBackend(page, { failPlaceOrderTimes: 4 });
    await registerToStart(page);
    await pushOneSaladAtCounter(page);

    // The 1/2/3 s backoffs are a page-armed chain: step fake time until the
    // ladder has made all four attempts.
    await stepClockUntil(page, () => checkout.placeOrderCount === 4);
    const panel = page.getByTestId("order-error");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(en.orderError.title);
    await expect(panel).toContainText(en.orderError.message);
    await expect(panel).not.toContainText(en.orderError.uncertainTitle);
    // …and it stops there.
    await page.clock.runFor(15_000);
    expect(checkout.placeOrderCount).toBe(4);

    await page.getByTestId("order-error-retry").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 15_000 });
    expect(checkout.placeOrderCount).toBe(5);
    const ids = new Set(checkout.placeOrderBodies.map(orderIdOf));
    expect(ids.size).toBe(1);
    const [orderId] = [...ids];
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${orderId.slice(-5)}`
    );
    expectNothingDangerousWasContacted(checkout);
  });

  test("REDEEM TIMEOUT (D1): a redeem_coupon that never answers shows the redemption error — no reward row, no points burned, no claim left to revoke", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { loyalty: true });
    const xeno = await mockXenoLoyalty(page);
    const redeem = await holdRequests(page, REDEEM_COUPON_URL);
    await registerToStart(page);
    await startOrderToMenu(page);
    await loginToRewards(page, LOYALTY_PHONE);

    // The redemption chain up to the OTP submit (loyalty.spec.ts redeemReward).
    const reward = LOYALTY_REWARDS.greekSalad;
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
    await page.getByTestId(`loyalty-reward-${reward.couponCode}`).click();
    await page.getByTestId("loyalty-redeem").click();
    await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({
      timeout: 10_000,
    });
    await typeDigits(page, LOYALTY_OTP);
    await page.getByTestId("loyalty-otp-submit").click();
    await expect.poll(() => redeem.count).toBe(1);

    // The budget ends the call with no body — which used to read as SUCCESS.
    await page.clock.runFor(REQUEST_BUDGET_MS);
    const error = page.getByTestId("loyalty-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(en.loyalty.redeemError);
    await expect(page.getByTestId("loyalty-success")).toHaveCount(0);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    expect((await persistedLoyalty(page)).totalLoyaltyPoints).toBe(
      LOYALTY_POINTS_TOTAL
    );

    // …and no claim was recorded: ending the session has nothing to revoke.
    await page.getByTestId("loyalty-error-retry").click();
    await expect(error).toHaveCount(0);
    await page.getByTestId("loyalty-rewards-close").click();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
    await page.getByTestId("footer-cancel").click();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    // A revoke would be sent by /start's mount; give it a beat to show up.
    await page.clock.runFor(2_000);
    expect(xeno.revokeCount).toBe(0);
    expect(redeem.count).toBe(1);
  });

  test("OFFLINE: losing the network mid menu-load raises the offline overlay; the dropped fetch lands on menu-error underneath, and back online TRY AGAIN enters /menu", async ({
    page,
    context,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    const menu = await holdRequests(page, GET_MENU_URL);
    await registerToStart(page);
    await startToSecond(page);

    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-fetching")).toBeVisible();
    await expect.poll(() => menu.count).toBe(1);

    await context.setOffline(true);
    const offline = page.getByTestId("network-offline");
    await expect(offline).toBeVisible();
    await expect(offline).toContainText(en.network.title);
    // P9f: the CSS fade is opacity-only — once it has run, the fixed overlay
    // is opaque AND still covers the whole kiosk (a translating entrance,
    // e.g. tb-modal-enter, would shift it half off the screen).
    await expect(offline).toHaveCSS("opacity", "1");
    const viewport = page.viewportSize()!;
    expect(await offline.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
    // The dropped connection kills the in-flight download.
    await menu.routes[0].abort("internetdisconnected");
    await expect(page.getByTestId("menu-error")).toBeVisible();
    await expect(page).toHaveURL(/\/second$/);

    // Back online: the overlay lifts onto the dialog — nothing auto-retries
    // on /second (the guest is right there), TRY AGAIN does.
    await context.setOffline(false);
    await expect(offline).toHaveCount(0);
    await expect(page.getByTestId("menu-error")).toBeVisible();
    menu.disarm();
    await page.getByTestId("menu-error-retry").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("category-rail")).toContainText("Side Orders");
  });
});
