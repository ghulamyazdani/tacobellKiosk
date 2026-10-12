import { test, expect, freezeClock, stepClockUntil, type Page, type Route } from "../fixtures/kiosk";
import {
  mockKioskBackend,
  fixtureJson,
  SKIP_CRM,
  DINE_IN,
  CHEESE_BURGER,
  GREEK_SALAD,
  CAESAR_DRESSING,
  DREAM_BOX,
} from "../fixtures/backend";
import { mockCheckoutBackend } from "../fixtures/checkout";
import { mockPaytmBackend, paytmStatus, PAYTM_EDC_ENTITY, PAYTM_DQR_ENTITY } from "../fixtures/paytm";
import { mockXenoLoyalty, LOYALTY_SETTINGS, LOYALTY_PHONE, LOYALTY_REWARDS } from "../fixtures/loyalty";
import { axeSweep, targetProblems, type KnownViolation } from "../fixtures/a11y";
import { settle } from "../fixtures/capture";
import {
  registerToStart,
  startToSecond,
  pickPipelineToMenu,
  startOrderTo,
  bootRegisteredToMenu,
  chooseLanguage,
} from "../pages/boot";
import { addViaPdp, addOneTap, openBag, bagRows, openRewardsSheet, typeDigits } from "../pages/order";

/**
 * Rulebook flow 7 — accessibility (P9f §4.5): every screen and overlay a guest can meet, swept for
 * WCAG A/AA (axe), 44×44 design-px touch targets and pointer regions that are not controls, plus its
 * Rule-1 exit. Findings are SOFT: one run lists every state that fails.
 * - An attribute-only finding (name, role, aria-*, dir) is PENDING_APP_FIX: handed to an app lane.
 *   A visual / contrast one is KNOWN, citing its PROGRESS sign-off row. Never a whole rule off.
 * - TIME: the clock is installed and RUNNING (the idle prompt is fast-forwarded). axe never runs under
 *   a paused clock (it resolves rules with setTimeout 0): the two short windows — the tent range error
 *   (4 s) and the payment cancel window (3 s) — are held with freezeClock and checked for targets and
 *   their exit only; axe covers their stable neighbours (/tent, /payment).
 */
test.use({ strictConsole: true });

/** Signed-off visual / contrast items (none today). */
const KNOWN: KnownViolation[] = [];
/** Attribute-only items handed to an app lane (none today). */
const PENDING_APP_FIX: KnownViolation[] = [];

const sweep = expect.configure({ soft: true });

/** A stable state: axe clean, every target ≥ 44 px and a control, its exits on screen. */
async function expectA11y(page: Page, label: string, ...exits: string[]) {
  await settle(page);
  sweep(await axeSweep(page, label, [...KNOWN, ...PENDING_APP_FIX]), `${label}: axe`).toEqual([]);
  await sweep.poll(() => targetProblems(page), { message: `${label}: touch targets` }).toEqual([]);
  for (const exit of exits) await sweep(page.getByTestId(exit), `${label}: exit ${exit}`).toBeVisible();
}

/** A window that closes on its own timer: held still, targets and exits only (never axe), released. */
async function expectShortWindow(page: Page, label: string, ...exits: string[]) {
  await freezeClock(page);
  await settle(page);
  sweep(await targetProblems(page), `${label}: touch targets`).toEqual([]);
  for (const exit of exits) await sweep(page.getByTestId(exit), `${label}: exit ${exit}`).toBeVisible();
  await page.clock.resume();
}

const TAKE_AWAY = { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take Away" };
/** Dream box's six-option Drinks slot (pack.spec G_DRINKS). */
const G_DRINKS = `${DREAM_BOX}_3_combo`;

test.describe("Flow 7 — accessibility sweep", () => {
  test.describe.configure({ timeout: 120_000 });
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("A ENTRY + BROWSE: registration, splash, order type, language, menu (with an unavailable card), MIAM, PDP, added, repeat, pack + slot sheet, bag + rail, remove, order-type confirm, global error, cancel order", async ({
    page,
  }) => {
    await mockKioskBackend(page, {
      settings: { enable_combo_upsell: true },
      outOfStock: [{ item_id: CAESAR_DRESSING, type: "item", partners: { inStock: false } }],
      // Two order types, so the bag's TAKE OUT segment asks first.
      pipelines: [DINE_IN, TAKE_AWAY],
    });

    await page.goto("/");
    await expect(page.getByTestId("registration-screen")).toBeVisible();
    await expectA11y(page, "a-01-registration");
    await registerToStart(page);
    await expectA11y(page, "a-02-splash");
    await startToSecond(page);
    await expectA11y(page, "a-03-second", "footer-cancel");
    await page.getByTestId("footer-language").click();
    await expect(page.getByTestId("language-sheet")).toBeVisible();
    await expectA11y(page, "a-04-language-sheet", "language-en");
    await page.getByTestId("language-en").click();
    await expect(page.getByTestId("language-sheet")).toHaveCount(0);

    await pickPipelineToMenu(page);
    await expect(page.getByTestId(`item-${CAESAR_DRESSING}`)).toHaveAttribute("aria-disabled", "true");
    await expectA11y(page, "a-05-menu", "footer-cancel");

    // Cheese Burger's upsell: the Make-it-a-Meal prompt first.
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("miam-prompt")).toBeVisible();
    await expectA11y(page, "a-06-miam", "miam-close");
    await page.getByTestId("miam-decline").click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expectA11y(page, "a-07-pdp", "pdp-back");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await expectA11y(page, "a-08-added", "added-continue");
    await page.getByTestId("added-continue").click();
    await expect(page.getByTestId("product-added-modal")).toHaveCount(0);

    // In the bag already: a second tap is the repeat sheet.
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("repeat-sheet")).toBeVisible();
    await expectA11y(page, "a-09-repeat-sheet", "repeat-sheet-close");
    await page.getByTestId("repeat-sheet-close").click();
    await expect(page.getByTestId("repeat-sheet")).toHaveCount(0);

    // A pack PDP and one slot's SELECT sheet; nothing committed.
    const box = page.getByTestId(`item-${DREAM_BOX}`);
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
    await expectA11y(page, "a-10-pack-pdp", "pdp-back");
    await page.getByTestId(`pack-slot-open-${G_DRINKS}`).click();
    await expect(page.getByTestId("slot-sheet")).toBeVisible();
    await expectA11y(page, "a-11-slot-sheet", "slot-sheet-close");
    await page.getByTestId("slot-sheet-close").click();
    await expect(page.getByTestId("slot-sheet")).toHaveCount(0);
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();

    // VIEW MY BAG: the bag with its Complete-your-meal rail.
    await page.getByTestId("cta-view-bag").click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await expectA11y(page, "a-13-bag", "bag-close");

    const id = ((await bagRows(page).first().getAttribute("data-testid")) ?? "").replace("bag-row-", "");
    await page.getByTestId(`bag-dec-${id}`).click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();
    await expectA11y(page, "a-14-remove-item", "remove-item-cancel");
    await page.getByTestId("remove-item-cancel").click();
    await expect(page.getByTestId("remove-item-modal")).toHaveCount(0);

    await page.getByTestId("bag-ordertype-takeout").click();
    await expect(page.getByTestId("bag-ordertype-confirm")).toBeVisible();
    await expectA11y(page, "a-15-order-type-confirm", "bag-ordertype-confirm-no");
    await page.getByTestId("bag-ordertype-confirm-no").click();
    await expect(page.getByTestId("bag-ordertype-confirm")).toHaveCount(0);

    // A real global error: PAY's preflight fails (idle.spec GLOBAL ERROR).
    const SERVER_TIME = "**/api/tenants/getServerTime";
    const serverTimeDown = (route: Route) => route.fulfill({ status: 500, json: {} });
    await page.route(SERVER_TIME, serverTimeDown);
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("global-error")).toBeVisible();
    await expectA11y(page, "a-16-global-error", "global-error-ok");
    // With its handler: the URL alone also drops the shared mock's 200 (same glob).
    await page.unroute(SERVER_TIME, serverTimeDown);
    await page.getByTestId("global-error-ok").click();
    await expect(page.getByTestId("global-error")).toHaveCount(0);

    await page.getByTestId("bag-close").click();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await expectA11y(page, "a-17-cancel-order", "cancel-order-cancel");
    await page.getByTestId("cancel-order-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toHaveCount(0);
  });

  test("B OFFERS: the rewards sheet, an applied offer in the bag, the freebie picker", async ({ page }) => {
    await mockKioskBackend(page, { offers: fixtureJson("offers.json") });
    await bootRegisteredToMenu(page);
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await openBag(page);

    await openRewardsSheet(page);
    await expectA11y(page, "b-01-rewards-sheet", "rewards-close");
    await page.getByTestId("offer-row-offer-flat-2").click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toBeVisible();
    await expect(page.getByTestId("offer-applied-celebration")).toHaveCount(0, { timeout: 15_000 });
    await expectA11y(page, "b-02-bag-offer-applied", "bag-close", "bag-rewards-remove");

    // The applied row reopens the sheet (the swap path); the OR-choice freebie's SAVE hands over to the picker.
    await page.getByTestId("bag-rewards-applied").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId("offer-row-offer-free-sauce-choice").click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expectA11y(page, "b-03-freebie-picker", "freebie-close");
    await page.getByTestId("freebie-close").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
  });

  test("C CHECKOUT: /tent and its range error, /payment and its cancel window, /receipt, the order-error panel, Order Complete", async ({
    page,
  }) => {
    await mockKioskBackend(page, { settings: SKIP_CRM });
    const checkout = await mockCheckoutBackend(page, { tabType: "table", failPlaceOrderTimes: 4 });
    await bootRegisteredToMenu(page);
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await openBag(page);

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("tent-screen")).toBeVisible();
    await expectA11y(page, "c-01-tent", "tent-back");
    await page.getByTestId("numpad-key-0").click();
    await page.getByTestId("tent-confirm").click();
    await expect(page.getByTestId("tent-error")).toBeVisible();
    await expectShortWindow(page, "c-02-tent-error", "tent-back");
    await page.getByTestId("numpad-clear").click();
    await typeDigits(page, "12");
    await page.getByTestId("tent-confirm").click();

    await expect(page.getByTestId("payment-screen")).toBeVisible();
    await expectA11y(page, "c-03-payment", "payment-back");
    await page.getByTestId("payment-counter").click();
    await expect(page.getByTestId("payment-buffer")).toBeVisible();
    await expectShortWindow(page, "c-04-payment-buffer", "payment-buffer-cancel");
    await page.clock.runFor(3_000);
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    await expectA11y(page, "c-05-receipt", "receipt-back");

    await page.getByTestId("receipt-none").click();
    await stepClockUntil(page, () => checkout.placeOrderCount === 4);
    await expect(page.getByTestId("order-error")).toBeVisible();
    await expectA11y(page, "c-06-order-error", "order-error-back", "order-error-retry");
    await page.getByTestId("order-error-retry").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    await expectA11y(page, "c-07-order-success", "order-success-startover");
  });

  test("D PAYTM: the card-machine screen, its cancel confirm, the not-paid panel", async ({ page }) => {
    await mockKioskBackend(page, { settings: SKIP_CRM });
    await mockCheckoutBackend(page, { extraDeviceSettings: [PAYTM_EDC_ENTITY, PAYTM_DQR_ENTITY] });
    // LAST: its routes beat the checkout fixture's FORBIDDEN_PATH_RE. Pending until told otherwise.
    const paytm = await mockPaytmBackend(page);
    await bootRegisteredToMenu(page);
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await openBag(page);
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible();
    await page.getByTestId("payment-card").click();
    await expect(page.getByTestId("payment-buffer")).toBeVisible();
    await page.clock.runFor(3_000);
    await expect(page.getByTestId("receipt-screen")).toBeVisible();
    await page.getByTestId("receipt-none").click();

    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });
    await expectA11y(page, "d-01-paytm-edc", "paytm-cancel");
    await page.getByTestId("paytm-cancel").click();
    await expect(page.getByTestId("paytm-cancel-confirm")).toBeVisible();
    await expectA11y(page, "d-02-cancel-confirm", "paytm-cancel-keep", "paytm-cancel-yes");
    await page.getByTestId("paytm-cancel-keep").click();
    await expect(page.getByTestId("paytm-cancel-confirm")).toHaveCount(0);

    // The terminal reports the payment cancelled (not from this screen): the not-paid panel.
    paytm.script.edcStatus = () => paytmStatus("cancelled");
    await expect(page.getByTestId("paytm-failed")).toBeVisible({ timeout: 15_000 });
    await expectA11y(page, "d-03-paytm-failed", "paytm-failed-bag", "paytm-failed-retry");
    await page.getByTestId("paytm-failed-bag").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
  });

  test("E LOYALTY + SYSTEM: /phone and the country picker, the Xeno rewards sheet + OTP + its error, /customerName, the idle prompt, the ADA view, offline, the menu error", async ({
    page,
    context,
  }) => {
    await mockKioskBackend(page, { settings: LOYALTY_SETTINGS });
    await mockXenoLoyalty(page, { failRedeem: true });
    await registerToStart(page);
    await startOrderTo(page, "phone-screen");
    await expectA11y(page, "e-01-phone", "phone-back");
    await page.getByTestId("phone-country-code").click();
    await expect(page.getByTestId("country-sheet")).toBeVisible();
    await expectA11y(page, "e-02-country-sheet", "country-sheet-close");
    await page.getByTestId("country-sheet-close").click();
    await expect(page.getByTestId("country-sheet")).toHaveCount(0);

    await typeDigits(page, LOYALTY_PHONE);
    await page.getByTestId("phone-continue").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
    await expectA11y(page, "e-03-xeno-rewards", "loyalty-rewards-close");
    await page.getByTestId(`loyalty-reward-${LOYALTY_REWARDS.greekSalad.couponCode}`).click();
    await page.getByTestId("loyalty-redeem").click();
    await expect(page.getByTestId("loyalty-otp-display")).toBeVisible();
    await expectA11y(page, "e-04-xeno-otp", "loyalty-rewards-close");
    await typeDigits(page, "9999");
    await page.getByTestId("loyalty-otp-submit").click();
    await expect(page.getByTestId("loyalty-error")).toBeVisible();
    await expectA11y(page, "e-05-loyalty-error", "loyalty-error-retry");
    await page.getByTestId("loyalty-error-retry").click();
    await expect(page.getByTestId("loyalty-error")).toHaveCount(0);
    await page.getByTestId("loyalty-rewards-close").click();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);

    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("customer-name-screen")).toBeVisible();
    await expectA11y(page, "e-06-customer-name", "customer-name-back");
    await page.getByTestId("customer-name-back").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await page.getByTestId("bag-close").click();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);

    await page.clock.fastForward(100_000);
    await expect(page.getByTestId("idle-modal")).toBeVisible();
    await expectA11y(page, "e-07-idle-prompt", "idle-continue");
    await page.getByTestId("idle-continue").click();
    await expect(page.getByTestId("idle-modal")).toHaveCount(0);

    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await expectA11y(page, "e-08-menu-ada", "footer-ada");
    await openBag(page);
    await expectA11y(page, "e-09-bag-ada", "bag-close");
    await page.getByTestId("bag-close").click();
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.getByTestId("network-offline")).toBeVisible();
    await expectA11y(page, "e-10-offline");
    await context.setOffline(false);
    await expect(page.getByTestId("network-offline")).toHaveCount(0);

    // The next guest's menu fails to load: menu-error over /second.
    await page.getByTestId("footer-cancel").click();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible();
    await page.route("**/api/cx/kiosk/getMenu", (route) => route.fulfill({ status: 500, json: {} }));
    await startToSecond(page);
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-error")).toBeVisible({ timeout: 15_000 });
    await expectA11y(page, "e-11-menu-error", "menu-error-back");
  });

  test("F ARABIC: /second, /menu, the PDP, the bag and /payment in Arabic", async ({ page }) => {
    await mockKioskBackend(page, { arabic: true, settings: SKIP_CRM });
    await mockCheckoutBackend(page);
    await registerToStart(page);
    await startToSecond(page);
    await chooseLanguage(page, "ar");
    await expectA11y(page, "f-01-second", "footer-cancel");
    await pickPipelineToMenu(page);
    await expectA11y(page, "f-02-menu", "footer-cancel");
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expectA11y(page, "f-03-pdp", "pdp-back");
    await page.getByTestId("pdp-add-to-bag").click();
    await page.getByTestId("added-continue").click();
    await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
    await openBag(page);
    await expectA11y(page, "f-04-bag", "bag-close");
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible();
    await expectA11y(page, "f-05-payment", "payment-back");
  });
});
