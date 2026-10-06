import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Lane offers, item 34 — AUTO-APPLY. With the default scope
 * ("operatorFlagged") the bag applies an offer the operator flagged
 * (`autoApplied: true` in the payload) the moment it opens, with zero taps,
 * through the same swap path as a manual SAVE — so the bill is the APPLY FLAT
 * bill of offers.spec.ts. It never adds food (freebie / BOGO mechanics are
 * never picked), never overrides the customer: Remove — or any SAVE, whatever
 * its outcome — latches it off for the whole session (persisted, so a
 * crash-reload keeps the latch), and only the next customer (/start's reset)
 * gets it again. It also applies mid-bag when the cart reaches an offer's
 * minimum, but never under an open rewards list.
 *
 * "No celebration card" is a ONE-SHOT count read in the commit that applied
 * the offer: the card auto-closes after 2.2 s, so a retrying toHaveCount(0)
 * would sit a wrongly opened card out. A mount-time apply cannot prove it in
 * dev (StrictMode's simulated unmount closes any open card), hence E7's
 * mid-bag apply.
 *
 * Same registered-device mocked backend as offers.spec.ts: mockKioskBackend /
 * bootRegisteredToMenu / addCheeseBurgerViaPdp / openBag are copied from it
 * (established precedent), plus the print agent abort. Each test registers
 * its OWN get_cx_valid_offers route after the mocks (newest wins); E5 keeps
 * the stock fixture (every offer `autoApplied: false`).
 *
 * Money (offers.spec.ts / bag.spec.ts headers; VAT 15% exclusive, whole-unit
 * round-off): flat £2 on the £8 burger → Sub £8.00, Discounts −£2.00,
 * Total £7.00; burger alone → £9.00; burger + Greek Salad, no offer →
 * round(25 × 1.15 = 28.75) = £29.00; with the flat £2 → round(23 × 1.15 =
 * 26.45) = £26.00 (E7, E8). After page.reload() the currency symbol
 * is gone until get_data is refetched (bag.spec.ts), so post-reload money is
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

const slimMenu = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)),
    "utf-8"
  )
);

const offersFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/offers.json", import.meta.url)),
    "utf-8"
  )
);

// ---- Slim-menu ids ----
const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8, 3 addon groups (PDP path)
const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // £17, plain (bag rail one-tap)
const CAESAR_DRESSING = "5dd109392b29ee1f2a82a49c"; // £2, plain

/** U+2212 MINUS SIGN — the literal character the bag renders, NOT a hyphen. */
const MINUS = "−";

// ---- Offer payloads ----
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The stock flat £2 (offers.json[1]) as the operator would flag it. */
const AUTO_FLAT = { ...clone(offersFixture[1]), autoApplied: true };

/** The same flagged flat £2 from a £10 bill: the £8 burger alone does not reach it. */
const AUTO_FLAT_MIN10 = {
  ...clone(offersFixture[1]),
  _id: "offer-flat-2-min10",
  autoApplied: true,
  minBillAmount: 10,
};

/** The stock "Free sauce of your choice" (offers.json[3]): SAVE opens the picker. */
const SAUCE_CHOICE = clone(offersFixture[3]);

/** The stock single-"and" free Greek Salad (offers.json[2]), flagged. */
const FLAGGED_FREE_SALAD = {
  ...clone(offersFixture[2]),
  _id: "offer-free-salad-flagged",
  autoApplied: true,
};

/** A flagged plain BOGO the burger already satisfies: buy a burger → Caesar free. */
const FLAGGED_BOGO = {
  ...clone(offersFixture[2]),
  _id: "offer-bogo-burger-flagged",
  name: "Buy a Cheese Burger get a Caesar free",
  getItemOnly: false,
  autoApplied: true,
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [
      { item: { baseItemId: CHEESE_BURGER, name: "Cheese Burger" }, quantity: 1, relation: "and" },
    ],
  },
  getItems: {
    items: [
      {
        _id: "gi-flagged-caesar",
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

/**
 * Boot + menu mocks (copied from offers.spec.ts). Order matters: Playwright
 * matches routes newest-first, so the catch-all is registered FIRST and every
 * specific mock after it. The print agent is cross-origin (the catch-all
 * misses it) and is aborted so nothing can reach real hardware.
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
  await page.route("**/api/cx/get_cx_valid_offers", (r) =>
    r.fulfill({ json: offersFixture })
  );
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

/** This spec's own offers (a raw array), registered after the mocks: newest wins. */
async function routeOffers(page: Page, offers: unknown[]) {
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: offers }));
}

/** Register on the on-screen keyboard and land on /menu (copied from offers.spec.ts). */
async function bootRegisteredToMenu(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await startToMenu(page);
}

/** Splash → order type → /menu (the second half of bootRegisteredToMenu). */
async function startToMenu(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

/** Menu card tap → PDP → commit plain (£8) → dismiss the added modal (copied from offers.spec.ts). */
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

/** VIEW MY BAG → /cart, walking through the first-open /forYou upsell (copied from offers.spec.ts). */
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

/** Applied by the machine: the caption, the APPLY FLAT bill, no celebration card. */
async function expectFlatAutoApplied(page: Page) {
  await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveText("Applied for you");
  // ONE-SHOT, in the commit that applied it: the machine never opens the
  // celebration card. A retrying toHaveCount(0) would sit out the card's own
  // 2.2 s auto-close and pass.
  expect(await page.getByTestId("offer-applied-celebration").count()).toBe(0);
  await expect(page.getByTestId("bag-rewards-applied")).toContainText("£2 off your order");
  await expect(page.getByTestId("bag-rewards-applied")).toContainText(`${MINUS}£2.00`);
  await expect(page.getByTestId("bag-rewards-entry")).toHaveCount(0);
  await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
  await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
  await expect(page.getByTestId("bag-total")).toContainText("£7.00");
  await expect(page.getByTestId("bag-pay")).toContainText("Order & Pay");
  await expect(page.getByTestId("bag-pay")).toContainText("£7.00");
  await expect(page.getByTestId("offer-applied-celebration")).toHaveCount(0);
}

/** Nothing applied: the entry row offers rewards, no Discounts line. */
async function expectNothingApplied(page: Page) {
  await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
  await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
  await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
}

/**
 * Open the rewards list and close it with X (no SAVE — not a customer offer
 * action): the round trip re-runs the auto-apply effect as the list unblocks
 * it, so a "nothing applied" check after it is not just early.
 */
async function rewardsRoundTrip(page: Page) {
  await page.getByTestId("bag-rewards-entry").click();
  await expect(page.getByTestId("rewards-sheet")).toBeVisible();
  await page.getByTestId("rewards-close").click();
  await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
}

test.describe("Lane offers — auto-apply (item 34)", () => {
  test("E1 a flagged flat offer applies itself when the bag opens: zero taps, 'Applied for you', Discounts −£2.00, Total £7.00 (the APPLY FLAT bill), no celebration card; the customer's own re-apply after Remove is uncaptioned and celebrates", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    // The menu never auto-applies: its bar keeps the plain subtotal.
    await expect(page.getByTestId("cta-total")).toContainText("£8.00");
    await openBag(page);

    await expectFlatAutoApplied(page);
    await expect(bagRows(page)).toHaveCount(1);
    // The row still pops once (legible), without the customer's card.
    await expect(
      page.getByTestId("bag-rewards-applied").locator(".tb-chip-pop")
    ).toHaveCount(1);
    await expect(page).toHaveURL(/\/cart$/);

    // Remove, then the customer applies the SAME offer themselves: it is
    // theirs now — no "Applied for you", and it celebrates. Same bill.
    await page.getByTestId("bag-rewards-remove").click();
    await expectNothingApplied(page);
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId(`offer-row-${AUTO_FLAT._id}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("offer-applied-celebration")).toBeVisible();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText("£2 off your order");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");
  });

  test("E2 Remove latches it off: adding an item does not re-apply it, nor does a crash-reload on /cart (the latch is persisted)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectFlatAutoApplied(page);

    await page.getByTestId("bag-rewards-remove").click();
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");

    // A cart change re-ranks the offers while the bag is open: still off.
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).click();
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");
    await rewardsRoundTrip(page);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");

    // Crash-reload on /cart: the Dexie cart and the persisted latch return,
    // and the bag stays open (it waits for the rehydrated rows — E9).
    await page.reload();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(2);
    // The entry row renders only with ranked offers: the flagged offer IS a
    // candidate again, and only the latch keeps it off.
    await expectNothingApplied(page);
    await rewardsRoundTrip(page);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("29.00");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
  });

  test("E3 Cancel Order → /start resets the latch: the next session with the same payload is auto-applied again", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectFlatAutoApplied(page);
    await page.getByTestId("bag-rewards-remove").click();
    await expectNothingApplied(page);

    await page.getByTestId("bag-close").click();
    await expect(page).toHaveURL(/\/menu$/);
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    await startToMenu(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectFlatAutoApplied(page);
  });

  test("E4 flagged freebie and BOGO offers are never auto-applied (the machine never adds food), though both are eligible", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [FLAGGED_FREE_SALAD, FLAGGED_BOGO]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingApplied(page);

    // Both are eligible (radios), so only the mechanic filter keeps them off.
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${FLAGGED_FREE_SALAD._id}`)).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${FLAGGED_BOGO._id}`)).toBeVisible();
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);

    await expectNothingApplied(page);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
  });

  test("E5 the stock fixture (every offer autoApplied:false) is never auto-applied", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingApplied(page);
    await rewardsRoundTrip(page);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(bagRows(page)).toHaveCount(1);
  });

  test("E6 a customer SAVE latches it too: SAVE a picker offer and dismiss the picker, then the bill reaches the flagged offer's £10 minimum — it is not auto-applied", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT_MIN10, SAUCE_CHOICE]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    // £8 < £10: the flagged offer is not eligible yet, so nothing applies.
    await expectNothingApplied(page);

    // The customer acts on offers: SAVE the sauce choice, then X its picker.
    // Nothing lands, but the action latches auto-apply off (decision 4).
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId(`offer-row-${SAUCE_CHOICE._id}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await page.getByTestId("freebie-close").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expectNothingApplied(page);

    // The rail add lifts the bill to £25: the flagged offer is eligible now
    // (its radio shows), and only the SAVE's latch keeps the machine off.
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).click();
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expectNothingApplied(page);
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${AUTO_FLAT_MIN10._id}`)).toBeVisible();
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
  });

  test("E7 the flagged offer becomes eligible while the bag is open (a rail add reaches its £10 minimum): it applies itself then — 'Applied for you', no celebration card, Discounts −£2.00, Total £26.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT_MIN10]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");

    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).click();
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveText("Applied for you");
    // One-shot, in the commit that applied it. This apply runs AFTER the bag
    // mounted, so dev StrictMode's simulated unmount (which closes any open
    // card) cannot hide a wrongly opened one, as it can for a mount-time apply.
    expect(await page.getByTestId("offer-applied-celebration").count()).toBe(0);
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£26.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£26.00");
    await expect(page.getByTestId("offer-applied-celebration")).toHaveCount(0);
  });

  test("E8 never under an open rewards list: a suggested add that reaches the flagged offer's £10 minimum leaves it unapplied while the list is open; closing the list (no SAVE) lets it apply — 'Applied for you', Total £26.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT_MIN10]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingApplied(page);

    // The flagged offer is the top locked row (£2 short), so the list offers
    // its Suggested rail; a rail add changes the cart UNDER the open list.
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${AUTO_FLAT_MIN10._id}`)).toHaveCount(0);
    await page.getByTestId(`offer-suggested-item-${GREEK_SALAD}`).click();
    await expect(page.getByTestId(`offer-radio-${AUTO_FLAT_MIN10._id}`)).toBeVisible();
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    // A radio pick is not a customer offer action (only SAVE is); it also
    // gives every effect of the cart change time to have run.
    await page.getByTestId(`offer-row-${AUTO_FLAT_MIN10._id}`).click();
    await expect(page.getByTestId(`offer-row-${AUTO_FLAT_MIN10._id}`)).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(page.getByTestId(`offer-row-${AUTO_FLAT_MIN10._id}`)).not.toContainText(
      "Applied"
    );
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);

    // X (no SAVE, so no latch): the list unblocks the machine, which applies it.
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveText("Applied for you");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£26.00");
  });

  test("E9 a crash-reload on /cart keeps the bag, its rows and the customer's SAVED reward: no 'Reward Removed', no /menu bounce, the same bill (the SAVE's latch keeps the machine out)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectFlatAutoApplied(page);

    // The customer takes the reward over: Remove, then their own SAVE —
    // which latches auto-apply off, so nothing would ever re-apply it.
    await page.getByTestId("bag-rewards-remove").click();
    await expectNothingApplied(page);
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId(`offer-row-${AUTO_FLAT._id}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText("£2 off your order");
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");

    // The first render after the reload has the persisted reward but not yet
    // the Dexie rows (AppRoutes' rehydrate lands them a moment later): the
    // bag must wait for them instead of empty-exiting.
    await page.reload();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText("£2 off your order");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
    await expect(page.getByTestId("offer-removal-notice")).toHaveCount(0);
    // Post-reload money without "£" (the currency symbol waits for get_data).
    await expect(page.getByTestId("bag-discounts")).toContainText("2.00");
    await expect(page.getByTestId("bag-total")).toContainText("7.00");
    await expect(page).toHaveURL(/\/cart$/);
  });
});
