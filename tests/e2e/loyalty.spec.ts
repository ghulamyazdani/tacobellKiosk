import { test, expect, type Page, persistedLoyaltyPoints } from "./fixtures/kiosk";
import { mockKioskBackend as mockBackend } from "./fixtures/backend";
import {
  mockXenoLoyalty,
  CHEESE_BURGER_ID,
  LOYALTY_OTP,
  LOYALTY_PHONE,
  LOYALTY_POINTS_TOTAL,
  LOYALTY_REWARDS,
  LOYALTY_SETTINGS,
  type XenoMockOptions,
} from "./fixtures/loyalty";
import { registerToStart, startOrderTo } from "./pages/boot";
import { addViaPdp, openBag, loyaltyRows, typeDigits } from "./pages/order";

/**
 * P7c — XENO loyalty vertical, end to end: the pre-menu identity lookup
 * (`/phone` → `check_loyalty_balance`), the rewards sheet and its dispatch-
 * exact redemption chain (`validate_coupon` → `authenticate_redemption` →
 * 4-digit OTP → `redeem_coupon`), the reward cart row, both entry guards, the
 * cancel-order revoke, the auto-reversal and the loyalty checkout route.
 *
 * Mock surface: `tests/e2e/fixtures/loyalty.ts` over the shared harness
 * (fixtures/backend.ts mock, pages/* steps), with two P7c deltas:
 *   - `get_kiosk_settings` spreads LOYALTY_SETTINGS (`enable_loyalty: true`,
 *     `crm_phone_mandatory: true`, `crm_name_mandatory: false`,
 *     `skip_crm_page: false`). The other suites omit these, so loyalty stays
 *     OFF for them and nothing here can regress them (contract trap 10).
 *   - `mockXenoLoyalty(page)` is layered AFTER `mockKioskBackend(page)`:
 *     Playwright matches routes newest-first, so the loyalty routes must
 *     come last or the shared mock's `/api/` catch-all `{}` swallows them.
 *
 * Two loyalty facts drive nearly every assertion:
 *   - Loyalty is "on" only when `kiosk_settings.enable_loyalty` AND a partner
 *     resolved at boot (`getLoyaltyPartner` → `setLoyaltyPartner` flips
 *     `state.loyalty.isLoyaltyOn`). Both mocks are therefore mandatory, and
 *     the partner must NOT be "reelo" or the whole flow takes the other
 *     branch.
 *   - The revoke is a raw cross-origin `fetch` to `https://xeno.in:2223/...`
 *     (a 10 s AbortSignal budget): the fixture routes that origin explicitly
 *     and counts the hits (trap 6); the harness denies it unrouted.
 *
 * Fixture money facts (same as bag.spec.ts's header): every slim-menu item
 * carries VAT@15% which the bill engine treats as EXCLUSIVE, and
 * getNetAmount() rounds to 0 decimals — so Total = round(SubTotal * 1.15):
 * £8 → £9. Reward rows are priced by `redeemItem` BEFORE tax: Greek Salad
 * £17 at a 100% coupon lands as `undiscounted_total_price` 17 /
 * `total_price` 0 — the struck £17.00 over a live £0.00 on the ROW. The BILL
 * still totals the reward at its undiscounted price and books the redemption
 * as a Discounts line, so a fully-redeemed bag reads Sub Total £17.00 /
 * Discounts −£17.00 / Total £0.00 (verified against the running app, not
 * assumed).
 *
 * POINTS BALANCE. The balance is rendered only inside the rewards sheet
 * (`loyalty-points-balance`), and the entry guard closes that sheet off while
 * a reward sits in the cart — so the post-redemption balance has no UI
 * surface to assert on. Where the sheet is reachable the test reads the
 * rendered string; where it is not (scenarios 2/3/4) it polls the persisted
 * redux state instead, which is the same `state.loyalty.totalLoyaltyPoints`
 * the sheet renders. Read-only, and never used as a substitute for a UI
 * assertion that exists.
 */

const GREEK_SALAD_REWARD = LOYALTY_REWARDS.greekSalad;

/** The shared boot mock with LOYALTY_SETTINGS folded into get_kiosk_settings. */
const mockKioskBackend = (page: Page) => mockBackend(page, { settings: LOYALTY_SETTINGS });

/** Both mock layers in the one order that works (catch-all first). */
async function mockAll(page: Page, opts: XenoMockOptions = {}) {
  await mockKioskBackend(page);
  return mockXenoLoyalty(page, opts);
}

/**
 * Register on the on-screen keyboard, start an order, pick the pipeline —
 * and land on /phone, NOT /menu: with loyalty on, SecondLayout routes the
 * identity lookup ahead of the menu (contract step 2).
 */
async function bootRegisteredToPhone(page: Page) {
  await registerToStart(page);
  await startOrderTo(page, "phone-screen");
  await expect(page).toHaveURL(/\/phone$/);
}

/**
 * The pre-menu lookup: enter the mock number, continue, land on /menu.
 * `check_loyalty_balance` is a PURE lookup — no OTP is involved here.
 */
async function identifyOnPhoneScreen(page: Page) {
  await typeDigits(page, LOYALTY_PHONE);
  // Masked-but-last display: the placeholder is gone once digits exist.
  await expect(page.getByTestId("phone-number-display")).not.toContainText(
    "Mobile number"
  );
  await page.getByTestId("phone-continue").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/menu$/);
}

/** Boot → register → order type → phone lookup → /menu as an identified guest. */
async function bootIdentifiedToMenu(page: Page) {
  await bootRegisteredToPhone(page);
  await identifyOnPhoneScreen(page);
}

/** The post-lookup auto-open (isTimerOn) — dismiss it to browse the menu. */
async function closeRewardsSheet(page: Page) {
  await page.getByTestId("loyalty-rewards-close").click();
  await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
}

/** Menu CTA-bar entry (locked decision 5a). */
async function openRewardsFromMenu(page: Page) {
  await page.getByTestId("menu-rewards-link").click();
  await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
}

/**
 * The redemption chain, up to and including the OTP submit. Selecting a tile
 * also cancels the sheet's auto-dismiss countdown (any interaction does).
 */
async function redeemReward(
  page: Page,
  couponCode: string,
  otp: string = LOYALTY_OTP
) {
  await page.getByTestId(`loyalty-reward-${couponCode}`).click();
  await page.getByTestId("loyalty-redeem").click();
  // authenticate_redemption is what "sends" the OTP — the step only appears
  // once validate_coupon AND authenticate_redemption have both come back 200.
  await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({
    timeout: 10_000,
  });
  await typeDigits(page, otp);
  await page.getByTestId("loyalty-otp-submit").click();
}

/** Menu card tap → PDP → commit → dismiss the added modal. */
const addCheeseBurgerViaPdp = (page: Page, expectedCta: string) =>
  addViaPdp(page, CHEESE_BURGER_ID, { expectedCta });

/** Cart row ids (itemId) are runtime-generated — read them off the testid. */
async function loyaltyRowItemId(page: Page): Promise<string> {
  const row = loyaltyRows(page).first();
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  return (testId ?? "").replace("bag-loyalty-row-", "");
}

async function paidRowItemId(page: Page): Promise<string> {
  const row = page.locator('[data-testid^="bag-row-"]').first();
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  return (testId ?? "").replace("bag-row-", "");
}

test.describe("P7c XENO loyalty", () => {
  test("BOOT + PHONE: loyalty routes /second to the lookup; the balance opens the rewards sheet and badges the CTA link", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page);

    // enable_loyalty made the boot resolve a (non-reelo) partner…
    await bootRegisteredToPhone(page);
    expect(xeno.partnerCount).toBe(1);
    // …and NO loyalty event has fired yet — the phone screen is the lookup.
    expect(xeno.events.check_loyalty_balance).toBe(0);

    await identifyOnPhoneScreen(page);
    expect(xeno.events.check_loyalty_balance).toBe(1);

    // Xeno branch of the partner table: coupons + points ⇒ the items modal
    // auto-opens with its dismiss timer, and the CTA link switches label.
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
    await expect(page.getByTestId("menu-rewards-link")).toContainText(
      "My Rewards (3)"
    );
    await expect(page.getByTestId("loyalty-points-balance")).toContainText(
      String(LOYALTY_POINTS_TOTAL)
    );

    // All three coupons joined onto real priced menu entities, so all three
    // survived getAllLoyaltyItemsFromMenu's silent drop.
    await expect(
      page.getByTestId(`loyalty-reward-${LOYALTY_REWARDS.greekSalad.couponCode}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`loyalty-reward-${LOYALTY_REWARDS.largeFries.couponCode}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`loyalty-reward-${LOYALTY_REWARDS.cheeseBurger.couponCode}`)
    ).toBeVisible();
    await expect(
      page.getByTestId(`loyalty-reward-${GREEK_SALAD_REWARD.couponCode}`)
    ).toContainText(GREEK_SALAD_REWARD.name);
    await expect(
      page.getByTestId(`loyalty-reward-${GREEK_SALAD_REWARD.couponCode}`)
    ).toContainText(String(GREEK_SALAD_REWARD.points));

    // Closing the sheet leaves an ordinary, empty-carted menu.
    await closeRewardsSheet(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
  });

  test("REDEEM HAPPY PATH: validate → authenticate → OTP → redeem lands a Free reward row (struck £17.00 → £0.00, no stepper) and burns 3000 points", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page);
    await bootIdentifiedToMenu(page);

    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
    await expect(page.getByTestId("loyalty-points-balance")).toContainText(
      String(LOYALTY_POINTS_TOTAL)
    );

    await redeemReward(page, GREEK_SALAD_REWARD.couponCode);

    // Celebration interstitial, then its ~3s auto-close (fork parity).
    await expect(page.getByTestId("loyalty-success")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("loyalty-success")).toHaveCount(0, {
      timeout: 10_000,
    });
    // The sheet closed as part of the success sequence.
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);

    // The chain ran exactly once, in order, and stopped there.
    expect(xeno.events.validate_coupon).toBe(1);
    expect(xeno.events.authenticate_redemption).toBe(1);
    expect(xeno.events.redeem_coupon).toBe(1);
    expect(
      xeno.eventCalls.map((call) => call.eventName).slice(-3)
    ).toEqual(["validate_coupon", "authenticate_redemption", "redeem_coupon"]);
    // Nothing is revoked on a successful redemption.
    expect(xeno.revokeCount).toBe(0);

    // decreaseLoyaltyPoints(3000) — 6000 → 3000.
    await expect
      .poll(() => persistedLoyaltyPoints(page), { timeout: 10_000 })
      .toBe(LOYALTY_POINTS_TOTAL - GREEK_SALAD_REWARD.points);

    // The reward is an ORDINARY cart row (locked decision 6).
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await openBag(page);
    await expect(loyaltyRows(page)).toHaveCount(1);
    const itemId = await loyaltyRowItemId(page);
    const row = page.getByTestId(`bag-loyalty-row-${itemId}`);
    await expect(row).toContainText(GREEK_SALAD_REWARD.name);
    // "Free" chip at a 100% coupon.
    await expect(page.getByTestId(`bag-loyalty-chip-${itemId}`)).toHaveText("Free");
    // Struck undiscounted_total_price over the live total_price.
    await expect(row.locator(".line-through")).toHaveText("£17.00");
    await expect(row).toContainText("£0.00");
    // No stepper, no Edit, no Remove (the reward is in stock).
    await expect(page.getByTestId(`bag-inc-${itemId}`)).toHaveCount(0);
    await expect(page.getByTestId(`bag-dec-${itemId}`)).toHaveCount(0);
    await expect(page.getByTestId(`bag-edit-${itemId}`)).toHaveCount(0);
    await expect(page.getByTestId(`bag-loyalty-remove-${itemId}`)).toHaveCount(0);
    // Bill treatment of a redeemed reward (what the engine actually
    // computes): the row rides in at its UNDISCOUNTED price, so Sub Total is
    // £17.00 and the redemption lands as a Discounts line, taking Total — and
    // the ORDER & PAY CTA — to £0.00. Tax is a percentage of a zero net, so
    // the usual round(sub * 1.15) does not apply to a fully-redeemed bag.
    await expect(page.getByTestId("bag-subtotal")).toContainText("£17.00");
    await expect(page.getByTestId("bag-discounts")).toContainText("£17.00");
    await expect(page.getByTestId("bag-total")).toContainText("£0.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£0.00");
  });

  test("OTP FAILURE: a rejected redeem_coupon surfaces the partner message and TRY AGAIN returns to the OTP step — no row, no points spent", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page, { failRedeem: true });
    await bootIdentifiedToMenu(page);
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();

    await redeemReward(page, GREEK_SALAD_REWARD.couponCode, "9999");

    // The proxy wraps the rejection in an HTTP 200 body, so the partner's own
    // copy reaches the dialog (not the generic fallback).
    const errorDialog = page.getByTestId("loyalty-error");
    await expect(errorDialog).toBeVisible({ timeout: 10_000 });
    await expect(errorDialog).toContainText("Invalid OTP. Please try again.");
    expect(xeno.events.redeem_coupon).toBe(1);

    // TRY AGAIN returns to the step that failed — the OTP entry, not the list.
    await page.getByTestId("loyalty-error-retry").click();
    await expect(errorDialog).toHaveCount(0);
    await expect(page.getByTestId("loyalty-otp-display")).toBeVisible();

    // Nothing was committed: no celebration, no cart row, no points burned.
    await expect(page.getByTestId("loyalty-success")).toHaveCount(0);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect
      .poll(() => persistedLoyaltyPoints(page), { timeout: 10_000 })
      .toBe(LOYALTY_POINTS_TOTAL);
    expect(xeno.revokeCount).toBe(0);
  });

  test("VALIDATE FAILURE: a rejected validate_coupon stops the chain before authenticate_redemption", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page, { failValidate: true });
    await bootIdentifiedToMenu(page);
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();

    await page
      .getByTestId(`loyalty-reward-${GREEK_SALAD_REWARD.couponCode}`)
      .click();
    await page.getByTestId("loyalty-redeem").click();

    const errorDialog = page.getByTestId("loyalty-error");
    await expect(errorDialog).toBeVisible({ timeout: 10_000 });
    await expect(errorDialog).toContainText("Error in validating coupon");

    // THE assertion of this scenario: the OTP was never requested.
    expect(xeno.events.validate_coupon).toBe(1);
    expect(xeno.events.authenticate_redemption).toBe(0);
    expect(xeno.events.redeem_coupon).toBe(0);
    await expect(page.getByTestId("loyalty-otp-display")).toHaveCount(0);

    // TRY AGAIN drops back to the reward list, still redeemable.
    await page.getByTestId("loyalty-error-retry").click();
    await expect(errorDialog).toHaveCount(0);
    await expect(page.getByTestId("loyalty-redeem")).toBeVisible();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect
      .poll(() => persistedLoyaltyPoints(page), { timeout: 10_000 })
      .toBe(LOYALTY_POINTS_TOTAL);
  });

  test("ENTRY GUARD (already availed): with a reward in the cart the rewards link refuses a second one", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page);
    await bootIdentifiedToMenu(page);
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();

    await redeemReward(page, GREEK_SALAD_REWARD.couponCode);
    await expect(page.getByTestId("loyalty-success")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("loyalty-success")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");

    // One reward per order (contract branch table).
    await page.getByTestId("menu-rewards-link").click();
    const errorDialog = page.getByTestId("global-error"); // G1: the app-wide GlobalErrorHost
    await expect(errorDialog).toBeVisible();
    await expect(errorDialog).toContainText("Loyalty Item already availed");
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);

    await page.getByTestId("global-error-ok").click();
    await expect(errorDialog).toHaveCount(0);
    // Refused, not reverted: the redeemed row is untouched.
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    expect(xeno.revokeCount).toBe(0);
  });

  test("ENTRY GUARD (no coupons): an empty balance keeps the pre-lookup label and refuses the sheet", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page, { emptyCoupons: true });
    await bootIdentifiedToMenu(page);
    expect(xeno.events.check_loyalty_balance).toBe(1);

    // No coupons and no points ⇒ no auto-open, and the link keeps its
    // pre-lookup copy (the count only appears with a coupon list).
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("menu-rewards-link")).toHaveText("Rewards");

    await page.getByTestId("menu-rewards-link").click();
    const errorDialog = page.getByTestId("global-error"); // G1: the app-wide GlobalErrorHost
    await expect(errorDialog).toBeVisible();
    await expect(errorDialog).toContainText(
      "No coupons available for you at the moment"
    );
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);

    await page.getByTestId("global-error-ok").click();
    await expect(errorDialog).toHaveCount(0);
  });

  test("REVOKE ON CANCEL: cancel-order revokes the claimed reward before the reset, and the next customer starts clean", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page);
    await bootIdentifiedToMenu(page);
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();

    await redeemReward(page, GREEK_SALAD_REWARD.couponCode);
    await expect(page.getByTestId("loyalty-success")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("loyalty-success")).toHaveCount(0, {
      timeout: 10_000,
    });
    expect(xeno.revokeCount).toBe(0);

    // Dismissing the confirm must NOT revoke anything.
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toHaveCount(0);
    expect(xeno.revokeCount).toBe(0);

    // Confirm: the revoke is fired synchronously BEFORE resetSession("full")
    // wipes the claimed-coupon ledger it reads from (contract step 9/trap 1).
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    await expect.poll(() => xeno.revokeCount, { timeout: 20_000 }).toBe(1);
    expect(xeno.revokeUrls[0]).toContain("undoRewardRedemption");
    expect(xeno.revokeUrls[0]).toContain(
      `pointsToBeReturned=${GREEK_SALAD_REWARD.points}`
    );
    expect(xeno.revokeUrls[0]).toContain(
      `rewardId=${GREEK_SALAD_REWARD.couponCode}`
    );
    expect(xeno.revokeUrls[0]).toContain(`phone=${LOYALTY_PHONE}`);

    // New customer: the identity was cleared too, so the lookup runs again.
    await page.getByTestId("start-screen").click();
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
    await identifyOnPhoneScreen(page);
    expect(xeno.events.check_loyalty_balance).toBe(2);

    await closeRewardsSheet(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £0$/);
  });

  test("AUTO-REVERSAL: losing the last paid row removes the reward, refunds its points and revokes the claim", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page);
    await bootIdentifiedToMenu(page);
    await closeRewardsSheet(page);

    // A paid row first — a reward redeemed into an already-empty cart is NOT
    // reversed (the effect's "cart once held paid rows" guard).
    await addCheeseBurgerViaPdp(page, "£8.00");
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");

    await openRewardsFromMenu(page);
    await redeemReward(page, GREEK_SALAD_REWARD.couponCode);
    await expect(page.getByTestId("loyalty-success")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("loyalty-success")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(2)");

    await openBag(page);
    await expect(loyaltyRows(page)).toHaveCount(1);
    const paidId = await paidRowItemId(page);

    // Drop the paid row: qty 1 ⇒ the REMOVE ITEM confirm.
    await page.getByTestId(`bag-dec-${paidId}`).click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();
    await page.getByTestId("remove-item-confirm").click();

    // The reward cannot outlive the order it rode in on: it is removed too,
    // which empties the bag and bounces back to /menu.
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/menu$/);
    await expect(loyaltyRows(page)).toHaveCount(0);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");

    // Points refunded and the claim revoked exactly once.
    await expect.poll(() => xeno.revokeCount, { timeout: 20_000 }).toBe(1);
    await expect
      .poll(() => persistedLoyaltyPoints(page), { timeout: 10_000 })
      .toBe(LOYALTY_POINTS_TOTAL);

    // …and the balance is back on the sheet, which is reachable again now
    // that no reward sits in the cart.
    await openRewardsFromMenu(page);
    await expect(page.getByTestId("loyalty-points-balance")).toContainText(
      String(LOYALTY_POINTS_TOTAL)
    );
  });

  test("CHECKOUT ROUTE: with loyalty on, PAY resolves to the customerName step", async ({
    page,
  }) => {
    test.slow();
    await mockAll(page);
    await bootIdentifiedToMenu(page);
    await closeRewardsSheet(page);

    await addCheeseBurgerViaPdp(page, "£8.00");
    await openBag(page);
    // P9f: loyalty on keeps LOG-IN & GET REWARDS beside PAY (it is hidden
    // only on loyalty-off deployments — bag.spec BAG BASICS).
    await expect(page.getByTestId("bag-login-rewards")).toBeVisible();
    // round(8 * 1.15) = £9 — exclusive VAT, see header.
    await expect(page.getByTestId("bag-pay")).toContainText("£9.00");

    await page.getByTestId("bag-pay").click();
    // resolveCheckoutRoute: not a table tab, skip_crm_page false, loyalty on
    // ⇒ "customerName" (the phone was already collected pre-menu). P8a
    // replaced the /checkout stub with the real screen, so the decision is
    // asserted by the destination it actually lands on.
    await expect(page).toHaveURL(/\/customerName$/, { timeout: 10_000 });
    await expect(page.getByTestId("customer-name-screen")).toBeVisible();
    // Nothing is pushed by arriving here: the name step is still pre-order.
    await expect(page.getByTestId("order-error")).toHaveCount(0);
  });
});
