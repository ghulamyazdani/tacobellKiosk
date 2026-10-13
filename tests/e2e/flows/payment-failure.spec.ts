import { test, expect, stepClockUntil, freezeClock, type Page } from "../fixtures/kiosk";
import { mockKioskBackend, locale, SKIP_CRM, CHEESE_BURGER } from "../fixtures/backend";
import { mockCheckoutBackend, expectNothingDangerousWasContacted, orderIdOf } from "../fixtures/checkout";
import { mockPaytmBackend, paytmStatus, PAYTM_DQR_ENTITY } from "../fixtures/paytm";
import { bootRegisteredToMenu } from "../pages/boot";
import { addViaPdp, openBag, bagRows } from "../pages/order";
import { payAtCounter } from "../pages/checkout";

/**
 * Rulebook flow 3 — payment failure (P9f §4.3): a failed payment always hands the guest back an
 * intact bag, and the second attempt places exactly ONE order. checkout.spec owns the ladder and
 * Retry; paytm.spec owns every Paytm outcome. These walk the two exits nothing else clicks:
 * order-error's BACK TO BAG, and a declined Paytm QR in the full view paid another way.
 * TIME: page.clock installed before the first goto; chained in-app timers (the 1/2/3 s push
 * backoff, Paytm polls) are stepped, never slept.
 */
test.use({ strictConsole: true });

const en = locale("en");

/** One Cheese Burger in the bag (£8.00 + 15 % VAT → £9.00) → PAY → /payment. */
async function burgerToPayment(page: Page) {
  await bootRegisteredToMenu(page);
  await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
  await openBag(page);
  await expect(page.getByTestId("bag-pay")).toContainText("£9.00");
  await page.getByTestId("bag-pay").click();
  await expect(page.getByTestId("payment-screen")).toBeVisible();
}

/** Back on /cart with the one burger, its money intact. */
async function expectIntactBag(page: Page) {
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(bagRows(page)).toHaveCount(1);
  await expect(bagRows(page)).toContainText("Cheese Burger");
  await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  await expect(page.getByTestId("bag-pay")).toContainText("£9.00");
}

test.describe("Flow 3 — payment failure", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("PUSH FAILURE → BACK TO BAG → PAY AGAIN (COD): the exhausted ladder's BACK TO BAG keeps the bag, sends nothing more, and the next PAY places one order", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { settings: SKIP_CRM });
    // The ladder's 4 attempts fail; the next push succeeds.
    const checkout = await mockCheckoutBackend(page, { failPlaceOrderTimes: 4 });
    await burgerToPayment(page);
    await payAtCounter(page);
    await page.getByTestId("receipt-none").click();

    await stepClockUntil(page, () => checkout.placeOrderCount === 4);
    const error = page.getByTestId("order-error");
    await expect(error).toContainText(en.orderError.title);
    await expect(error).toContainText(en.orderError.message);
    await expect(error).not.toContainText(en.orderError.uncertainTitle);
    await expect(page.getByTestId("order-error-retry")).toBeVisible();

    await page.getByTestId("order-error-back").click();
    await expectIntactBag(page);
    // Leaving the panel ended the ladder: no fifth attempt over 15 s of fake time.
    await page.clock.runFor(15_000);
    expect(checkout.placeOrderCount).toBe(4);
    await expect(page.getByTestId("order-success")).toHaveCount(0);

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible();
    await payAtCounter(page);
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    expect(checkout.placeOrderCount).toBe(5);
    expect(checkout.lastPlaceOrderBody).toMatchObject({ payments: { type: "COD" } });

    // The ladder's attempts are ONE order.
    const ids = checkout.placeOrderBodies.map(orderIdOf);
    expect(ids[0]).not.toBe("");
    expect(new Set(ids.slice(0, 4)).size).toBe(1);
    // Backend idempotency after a failed push is open (PROGRESS "Order push after a TIMEOUT"): record, never assert.
    test.info().annotations.push({
      type: "open-decision",
      description: ids[4] === ids[0] ? "re-PAY reused the ladder's order id" : "re-PAY minted a new order id",
    });
    expectNothingDangerousWasContacted(checkout);
  });

  test("PAYTM DECLINED → BACK TO BAG → PAY AT COUNTER: a declined UPI QR in the full view returns the guest to an intact bag, and the counter places exactly one COD order", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { settings: SKIP_CRM });
    const checkout = await mockCheckoutBackend(page, { extraDeviceSettings: [PAYTM_DQR_ENTITY] });
    // LAST: its routes beat the checkout fixture's FORBIDDEN_PATH_RE. Every status read: cancelled.
    const paytm = await mockPaytmBackend(page, { dqrStatus: () => paytmStatus("cancelled") });
    await burgerToPayment(page);

    // Frozen BEFORE the tile: the window's end is the initiate, and from here
    // only the spec moves time — a Paytm budget never expires mid-request.
    await freezeClock(page);
    await page.getByTestId("payment-qr").click();
    await expect(page.getByTestId("payment-buffer")).toBeVisible();
    await page.clock.runFor(3_000);
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });

    const failed = page.getByTestId("paytm-failed");
    await stepClockUntil(page, async () => (await failed.count()) > 0, {
      stepMs: 1_000,
      timeout: 60_000,
      gate: async () => (await paytm.inFlight()) === 0,
    });
    await expect(failed).toContainText(en.paytm.failed.title);
    await expect(failed).toContainText(en.paytm.failed.cancelled);

    await page.getByTestId("paytm-failed-bag").click();
    await expectIntactBag(page);

    await page.clock.resume();
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible();
    await payAtCounter(page);
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });

    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.lastPlaceOrderBody).toMatchObject({ payments: { type: "COD" } });
    expect(paytm.counts.dqrInit).toBe(1);
    expect(paytm.counts.edcInit).toBe(0);
    expectNothingDangerousWasContacted(checkout);
  });
});
