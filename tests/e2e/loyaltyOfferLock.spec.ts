import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mockXenoLoyalty,
  LOYALTY_OTP,
  LOYALTY_PHONE,
  LOYALTY_REWARDS,
  LOYALTY_SETTINGS,
  type XenoMockHandle,
} from "./fixtures/loyalty";

/**
 * Lane loyalty-visual — a XENO reward and a CX offer in the same bag.
 *
 * D3 (fork parity, CartRewardsCard `blockedByLoyalty`): while a redeemed
 * reward row is in the bag and NO offer is applied, offers cannot be applied
 * — the REWARDS sheet shows the pink lock line, every row inert
 * (aria-disabled, no radio / nudge / ADD ITEMS), no suggested rail, SAVE
 * disabled, and an operator-flagged (autoApplied) offer is never applied by
 * the machine. An offer applied BEFORE the reward stays and can still be
 * swapped (the fork's asymmetry); removing it engages the lock.
 *
 * F1 (D12): the applied-offer row ("Save £X" / "−£X") and the celebration
 * card show the offer's OWN saving, and the row's pop is keyed on it (a
 * reward landing never replays it); the Discounts line, Total and ORDER & PAY
 * keep the bill's figures (bill math unchanged). E6a's unlocked control also
 * pins the offers sheet's D2 geometry (1480 / 48 / 24 / 152 / 32).
 *
 * Mocks: the boot mocks of loyalty.spec.ts (copied — no spec exports them)
 * with its empty get_cx_valid_offers overridden per test by `routeOffers`
 * (newest route wins), then `mockXenoLoyalty` LAST (it also answers the
 * cross-origin revoke). The print agent is aborted (cross-origin, outside the
 * catch-all). Every offer id below resolves in the slim menu (the converter
 * drops unknown ids).
 *
 * Money (bill engine — loyalty.spec / offers.spec headers): VAT 15%
 * EXCLUSIVE on the paid base, a free row is untaxed, Total = whole-unit
 * round. The reward (Greek Salad, 100 %) rides at its undiscounted £17 in
 * Sub Total and comes back whole on Discounts:
 * - burger £8 + reward: Sub £25.00, Discounts −£17.00, VAT 1.20 → £9.00;
 * - + flat £2 (pre-tax, on the burger): Discounts −£19.00, VAT 0.90 → 6.90
 *   → £7.00; with flat £3: −£20.00, VAT 0.75 → 5.75 → £6.00.
 * Offer minimums count paid rows only, so the burger + reward bag is £8 to
 * an offer (MIN_25 below is £17.00 short).
 * The bag renders U+2212 MINUS SIGN (MINUS below). After page.reload() the
 * currency symbol waits for get_data (bag.spec), so post-reload money is
 * matched without "£".
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

const readJson = (relative: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8"));

const slimMenu = readJson("./fixtures/slim-menu.json");
const offersFixture = readJson("./fixtures/offers.json");
const en = readJson("../../src/i18n/locales/en/translation.json");

// ---- Slim-menu ids ----
const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8, PDP path
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b"; // £2, plain
const CAESAR_DRESSING = "5dd109392b29ee1f2a82a49c"; // £2, plain

const SALAD_REWARD = LOYALTY_REWARDS.greekSalad; // static6562, £17 → Free, 3000 pts

/** U+2212 MINUS SIGN — the literal character the bag renders, NOT a hyphen. */
const MINUS = "−";

// ---- Offer payloads (offers.json shapes) ----
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** offers.json[1]: £2 off, always eligible. */
const FLAT_2 = clone(offersFixture[1]);
/** The same with £3 off — the swap target. */
const FLAT_3 = {
  ...clone(offersFixture[1]),
  _id: "offer-flat-3",
  name: "£3 off your order",
  type: { name: "amount", value: 3 },
};
/** FLAT_2 as the operator would flag it (offerAutoApply.spec AUTO_FLAT). */
const AUTO_FLAT = { ...clone(offersFixture[1]), autoApplied: true };
/**
 * A locked minBill row: offer minimums count PAID rows only (the reward's £17
 * is not in the basis), so the burger bag is £17.00 short — the suggested
 * rail's trigger while it is the TOP locked row (a locked buy-side row with a
 * free item outranks it, so the two never share a sheet below).
 */
const MIN_25 = {
  ...clone(offersFixture[1]),
  _id: "offer-flat-5-min25",
  name: "£5 off orders over £25",
  type: { name: "amount", value: 5 },
  minBillAmount: 25,
};
/** offerBuyStage.spec BOGO_SAUCE: a locked buy-side row that carries ADD ITEMS. */
const BOGO_SAUCE = {
  ...clone(offersFixture[2]),
  _id: "offer-bogo-sauce",
  name: "Buy 2 Tortilla Sauce get a Caesar free",
  getItemOnly: false,
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [
      { item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" }, quantity: 2, relation: "and" },
    ],
  },
  getItems: {
    items: [
      {
        _id: "gi-bogo-caesar",
        baseItemId: CAESAR_DRESSING,
        name: "Caesar Dressing",
        relation: "and",
        discountType: "percent",
        value: 100,
        quantity: 1,
      },
    ],
    categories: [],
  },
};

/** E6a: an eligible row (radio) and the minBill row (nudge + rail). */
const RAIL_OFFERS = [FLAT_2, MIN_25];
/** E6c: two eligible rows to swap between and the buy-side row (ADD ITEMS). */
const SWAP_OFFERS = [FLAT_2, FLAT_3, BOGO_SAUCE];
const ids = (offers: Array<{ _id: string }>) => offers.map((offer) => offer._id);

/**
 * Boot + menu mocks (loyalty.spec.ts) with the print agent aborted. Order
 * matters: Playwright matches routes newest-first, so the catch-all goes
 * FIRST and every specific mock after it.
 */
async function mockKioskBackend(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
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
        ...LOYALTY_SETTINGS,
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

/** Base mocks, this test's offers (a raw array, newest wins), then Xeno LAST. */
async function mockAll(page: Page, offers: unknown[]): Promise<XenoMockHandle> {
  await mockKioskBackend(page);
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: offers }));
  return mockXenoLoyalty(page);
}

/** KioskNumpad is the only numeric keypad mounted at a time (phone, then OTP). */
async function typeDigits(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByTestId(`numpad-key-${digit}`).click();
  }
}

/** Splash → order type → /phone (loyalty on routes the lookup ahead of the menu). */
async function startOrderToPhone(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
}

/** The pre-menu lookup: /menu as an identified guest, the rewards sheet auto-opened. */
async function identify(page: Page) {
  await typeDigits(page, LOYALTY_PHONE);
  await page.getByTestId("phone-continue").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
}

/** Register on the on-screen keyboard → /phone → lookup → /menu (loyalty.spec). */
async function bootIdentifiedToMenu(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await startOrderToPhone(page);
  await identify(page);
}

async function closeLoyaltySheet(page: Page) {
  await page.getByTestId("loyalty-rewards-close").click();
  await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
}

/**
 * The redemption chain in an OPEN rewards sheet (loyalty.spec redeemReward),
 * through the celebration's ~3 s auto-close.
 */
async function redeemSalad(page: Page) {
  await page.getByTestId(`loyalty-reward-${SALAD_REWARD.couponCode}`).click();
  await page.getByTestId("loyalty-redeem").click();
  await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({ timeout: 10_000 });
  await typeDigits(page, LOYALTY_OTP);
  await page.getByTestId("loyalty-otp-submit").click();
  await expect(page.getByTestId("loyalty-success")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("loyalty-success")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
}

/** From inside the bag: LOG-IN & GET REWARDS opens the Xeno sheet over it. */
async function redeemSaladFromBag(page: Page) {
  await page.getByTestId("bag-login-rewards").click();
  await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
  await redeemSalad(page);
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

/** Menu card tap → PDP → commit plain (£8) → dismiss the added modal. */
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

/** VIEW MY BAG → /cart, through the once-per-session /forYou upsell. */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

/** Rounded box of a locator (sizes only — the entrance slide moves y, not h). */
const boxSize = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return { width: Math.round(box.width), height: Math.round(box.height) };
};

const paidRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');
const loyaltyRows = (page: Page) => page.locator('[data-testid^="bag-loyalty-row-"]');

/** Unapplied entry row → the offers REWARDS sheet. */
async function openOffersFromEntry(page: Page) {
  await page.getByTestId("bag-rewards-entry").click();
  await expect(page.getByTestId("rewards-sheet")).toBeVisible();
}

async function pickAndSave(page: Page, offerId: string) {
  await page.getByTestId(`offer-row-${offerId}`).click();
  await expect(page.getByTestId(`offer-row-${offerId}`)).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("rewards-save").click();
  await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
}

/**
 * The D3 lock on the open offers sheet. Rows are asserted by attribute —
 * Playwright refuses to click under aria-disabled, so a click proves nothing.
 */
async function expectOffersLocked(page: Page, offerIds: string[]) {
  const sheet = page.getByTestId("rewards-sheet");
  await expect(page.getByTestId("rewards-loyalty-lock")).toHaveText(en.loyalty.offersLocked);
  await expect(sheet.getByRole("dialog")).toHaveAttribute(
    "aria-describedby",
    "rewards-loyalty-lock"
  );
  for (const id of offerIds) {
    await expect(page.getByTestId(`offer-row-${id}`)).toHaveAttribute("aria-disabled", "true");
  }
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  await expect(sheet.getByRole("radiogroup")).toHaveCount(0);
  await expect(sheet.locator('[data-testid^="offer-radio-"]')).toHaveCount(0);
  await expect(sheet.locator('[data-testid^="offer-row-nudge-"]')).toHaveCount(0);
  await expect(sheet.locator('[data-testid^="offer-row-add-items-"]')).toHaveCount(0);
  await expect(page.getByTestId("offer-suggested-rail")).toHaveCount(0);
  await expect(page.getByTestId("rewards-save")).toBeDisabled();
}

/**
 * Nothing applied, sampled over a 2 s window (lint bans fixed sleeps — the
 * fcm.spec E10 pattern): an applied row at ANY sample fails with its text;
 * only a window that closes empty passes. The auto-apply lands in the commit
 * after the bag opens (offerAutoApply.spec E1), well inside the window.
 */
async function expectNothingAppliedOverWindow(page: Page) {
  const applied = page.getByTestId("bag-rewards-applied");
  const windowEnds = Date.now() + 2_000;
  await expect
    .poll(
      async () => {
        if ((await applied.count()) > 0) return `applied: ${await applied.innerText()}`;
        return Date.now() >= windowEnds ? "none" : "waiting";
      },
      { timeout: 8_000, intervals: [100] }
    )
    .toBe("none");
  await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
  await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
}

test.describe("lane loyalty-visual — a Xeno reward beside a CX offer (D3 lock, F1)", () => {
  test("E5 F1: an offer applied BEFORE the reward keeps its own saving on the applied row (Save £2.00 / −£2.00) while Discounts carries offer + reward (−£19.00); Total and ORDER & PAY stay the bill's £7.00", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page, [FLAT_2]);
    await bootIdentifiedToMenu(page);
    await closeLoyaltySheet(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openOffersFromEntry(page);
    await pickAndSave(page, FLAT_2._id);
    const applied = page.getByTestId("bag-rewards-applied");
    await expect(applied).toContainText("Save £2.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");
    // The row pops once per applied VALUE (AppliedRowPop): a bag reopen
    // renders it quiet — and the reward landing below must not replay it,
    // the offer's own saving being unchanged (F1 keys the pop on it).
    const pop = applied.locator(".tb-success-pulse, .tb-chip-pop");
    await page.getByTestId("bag-close").click();
    await expect(page).toHaveURL(/\/menu$/);
    await openBag(page);
    await expect(applied).toContainText("Save £2.00");
    await expect(pop).toHaveCount(0);

    await redeemSaladFromBag(page);
    expect(xeno.events.redeem_coupon).toBe(1);
    await expect(loyaltyRows(page)).toHaveCount(1);
    await expect(paidRows(page)).toHaveCount(1);

    // The applied row is the OFFER's: £2, never the bill's £19.
    await expect(applied).toContainText("£2 off your order");
    await expect(applied).toContainText("Save £2.00");
    await expect(applied).toContainText(`${MINUS}£2.00`);
    await expect(applied).not.toContainText("19.00");
    await expect(pop).toHaveCount(0);
    // The bill keeps both: the reward's £17 rides in Sub Total and returns
    // on Discounts beside the offer's £2 (header money).
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£19.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");
    await expect(page.getByTestId("bag-pay")).toContainText("Order & Pay");
    await expect(page.getByTestId("bag-pay")).toContainText("£7.00");
  });

  test("E6a D3: a reward redeemed before any offer locks the bag's offers — the lock line, every row aria-disabled with no radio or nudge, the suggested rail gone, SAVE disabled; X leaves the bill as it was", async ({
    page,
  }) => {
    test.slow();
    await mockAll(page, RAIL_OFFERS);
    await bootIdentifiedToMenu(page);
    await closeLoyaltySheet(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    // Control, same paid basis (£8): unlocked, the sheet has a radio, the
    // £17.00 nudge and the rail — everything the lock must take away.
    await openOffersFromEntry(page);
    // D2 (Figma 1:3842, the geometry the Xeno sheet shares): a 1480 panel, a
    // 48 px title over the 24 px subtitle, 152 plates, 32 px row names.
    const offersSheet = page.getByTestId("rewards-sheet");
    expect((await boxSize(offersSheet.getByRole("dialog"))).height).toBe(1480);
    await expect(page.locator("#rewards-sheet-title")).toHaveCSS("font-size", "48px");
    await expect(offersSheet.getByText(en.offers.subtitle, { exact: true })).toHaveCSS(
      "font-size",
      "24px"
    );
    const flatRow = page.getByTestId(`offer-row-${FLAT_2._id}`);
    expect(await boxSize(flatRow.locator(":scope > span").first())).toEqual({
      width: 152,
      height: 152,
    });
    await expect(flatRow.getByText(FLAT_2.name, { exact: true })).toHaveCSS("font-size", "32px");
    await expect(page.getByTestId("rewards-loyalty-lock")).toHaveCount(0);
    await expect(page.getByTestId(`offer-radio-${FLAT_2._id}`)).toBeVisible();
    await expect(page.getByTestId(`offer-row-nudge-${MIN_25._id}`)).toContainText("£17.00");
    await expect(page.getByTestId("offer-suggested-rail")).toBeVisible();
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);

    // The reward goes in first — no offer is applied.
    await redeemSaladFromBag(page);
    await expect(loyaltyRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);
    await openOffersFromEntry(page);
    await expectOffersLocked(page, ids(RAIL_OFFERS));

    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });

  test("E6b D3: an operator-flagged (autoApplied) offer is NOT auto-applied while the reward is in the bag; Cancel Order revokes the reward and the next session is unlocked — the same offer auto-applies", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockAll(page, [AUTO_FLAT]);
    await bootIdentifiedToMenu(page);
    await redeemSalad(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingAppliedOverWindow(page);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);
    // A list round trip (X, no SAVE) re-runs the auto-apply effect: still off.
    await openOffersFromEntry(page);
    await expect(page.getByTestId("rewards-loyalty-lock")).toBeVisible();
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expectNothingAppliedOverWindow(page);

    await page.getByTestId("bag-close").click();
    await expect(page).toHaveURL(/\/menu$/);
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => xeno.revokeCount, { timeout: 10_000 }).toBe(1);
    expect(xeno.revokeUrls[0]).toContain(`rewardId=${SALAD_REWARD.couponCode}`);

    // Next customer: no reward, no lock — the machine applies the flagged offer.
    await startOrderToPhone(page);
    await identify(page);
    await closeLoyaltySheet(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expect(loyaltyRows(page)).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveText(
      en.offers.auto.appliedForYou
    );
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");
    await page.getByTestId("bag-rewards-applied").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId("rewards-loyalty-lock")).toHaveCount(0);
    await expect(page.getByTestId(`offer-row-${AUTO_FLAT._id}`)).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  test("E6c D3 asymmetry (fork parity): an offer applied BEFORE the reward stays and can still be swapped — the swap's celebration and row show the new offer's own saving (F1); Remove then engages the lock on the same bag (ADD ITEMS gone)", async ({
    page,
  }) => {
    test.slow();
    await mockAll(page, SWAP_OFFERS);
    await bootIdentifiedToMenu(page);
    await closeLoyaltySheet(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openOffersFromEntry(page);
    await pickAndSave(page, FLAT_2._id);
    const applied = page.getByTestId("bag-rewards-applied");
    await expect(applied).toContainText("£2 off your order");

    await redeemSaladFromBag(page);
    // Both stay: the reward row AND the offer.
    await expect(loyaltyRows(page)).toHaveCount(1);
    await expect(applied).toContainText("£2 off your order");
    await expect(applied).toContainText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£19.00`);

    // Reopened from the applied row the sheet is NOT locked — and on this
    // very bag it carries the ADD ITEMS the lock must hide below.
    await applied.click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId("rewards-loyalty-lock")).toHaveCount(0);
    await expect(page.getByTestId(`offer-row-${FLAT_2._id}`)).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(page.getByTestId(`offer-radio-${FLAT_3._id}`)).toBeVisible();
    await expect(page.getByTestId(`offer-row-add-items-${BOGO_SAUCE._id}`)).toBeVisible();
    await expect(page.getByTestId("rewards-save")).toBeEnabled();

    // The swap still works; its celebration shows £3, not the bill's £20.
    await pickAndSave(page, FLAT_3._id);
    await expect(page.getByTestId("offer-applied-celebration")).toContainText(
      "You save £3.00"
    );
    await expect(applied).toContainText("£3 off your order");
    await expect(applied).toContainText("Save £3.00");
    await expect(applied).toContainText(`${MINUS}£3.00`);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£20.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£6.00");
    await expect(loyaltyRows(page)).toHaveCount(1);

    // Remove the offer: the reward stays, and now it locks the offers.
    await page.getByTestId("bag-rewards-remove").click();
    await expect(applied).toHaveCount(0);
    await expect(loyaltyRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);
    await openOffersFromEntry(page);
    await expectOffersLocked(page, ids(SWAP_OFFERS));
  });

  test("E7 crash-reload on /cart with a reward and no offer: after the Dexie rehydrate the offers are still locked and the flagged offer was never auto-applied", async ({
    page,
  }) => {
    test.slow();
    await mockAll(page, [AUTO_FLAT, BOGO_SAUCE]);
    await bootIdentifiedToMenu(page);
    await redeemSalad(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingAppliedOverWindow(page);

    await page.reload();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/cart$/);
    // The rehydrated rows are back (both), so the checks below are not early.
    await expect(paidRows(page)).toHaveCount(1);
    await expect(loyaltyRows(page)).toHaveCount(1);
    await expectNothingAppliedOverWindow(page);

    await openOffersFromEntry(page);
    await expectOffersLocked(page, [AUTO_FLAT._id, BOGO_SAUCE._id]);
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expectNothingAppliedOverWindow(page);
    await expect(page.getByTestId("bag-discounts")).toContainText("17.00");
    await expect(page.getByTestId("bag-total")).toContainText("9.00");
  });
});
