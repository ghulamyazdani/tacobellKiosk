import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Lane offers, item 31 (+31b) — the BOGO BUY STAGE inside the bag: a locked
 * "buy X" reward row's ADD ITEMS opens the stage, its tiles add REAL paid
 * rows, CONTINUE commits through the one apply path, and every way out that
 * does not land the offer (BACK, X) rolls the cart back to its snapshot.
 * The URL stays /cart throughout (nothing in the stage navigates).
 *
 * Same registered-device mocked backend as offers.spec.ts: mockKioskBackend /
 * bootRegisteredToMenu / addCheeseBurgerViaPdp / openBag are copied from it
 * (established precedent — that file does not export them), plus the print
 * agent abort. Each test then registers its OWN get_cx_valid_offers route
 * (newest wins). Offer payloads are production-shaped: getItems entries carry
 * no `type` (the backend never sends one), the buy side is applicable.rawItems,
 * and every id exists in the slim menu (the converter drops unknown ids).
 *
 * Money (bill engine — offers.spec.ts / bag.spec.ts headers): VAT 15%
 * EXCLUSIVE on the paid base, a free row is untaxed, Total =
 * Math.round(roundNumber(Sub Total − Discounts + VAT, 2)) so .50 rounds up:
 * - E1 burger 8 + Tortilla ×2 4 + free Caesar 2: Sub £14.00, −£2.00,
 *   VAT 15% × 12 = 1.80 → 13.80 → £14.00; after Remove, Sub £12.00 and
 *   the same £14.00.
 * - E10 burger 8 + Tortilla 2 + free Caesar 2: as E5.
 * - E2 mid-journey burger 8 + Tortilla 2: 10 + 1.50 → 11.50 → £12.00.
 * - E3 Tortilla 2 + burger 8 + free Greek Salad 17: Sub £27.00, −£17.00,
 *   VAT 1.50 → 11.50 → £12.00.
 * - E4 burger 8 + Tortilla 2 + Caesar 2, the cheaper sauce free: Sub £12.00,
 *   −£2.00, → 11.50 → £12.00 (taxed pre- or post-discount, the same £12).
 * - E5 burger 8 + Tortilla 2 + free Caesar 2: Sub £12.00, −£2.00 → £12.00.
 * - E7 Tortilla 2 + burger 8 + free Greek Salad 17: as E3.
 * - E8 Tortilla 2 + Greek Salad 17 + free Greek Salad 17: Sub £36.00,
 *   −£17.00, VAT 15% × 19 = 2.85 → 21.85 → £22.00; after the paid salad
 *   leaves (offer removed): Tortilla alone 2 + 0.30 → 2.30 → £2.00.
 * - E9 Tortilla ×2: 4 + 0.60 → 4.60 → £5.00; ×1: £2.00.
 * The bag renders U+2212 MINUS SIGN on the Discounts line (MINUS below).
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
const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // £17, plain
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b"; // £2, plain (menu one-tap)
const CAESAR_DRESSING = "5dd109392b29ee1f2a82a49c"; // £2, plain

/** U+2212 MINUS SIGN — the literal character the bag renders, NOT a hyphen. */
const MINUS = "−";

// ---- Offer payloads (production-shaped; see header) ----
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const getEntry = (
  _id: string,
  baseItemId: string,
  name: string,
  relation: "and" | "or"
) => ({ _id, baseItemId, name, relation, discountType: "percent", value: 100, quantity: 1 });
const buyRaw = (baseItemId: string, name: string, quantity: number) => ({
  item: { baseItemId, name },
  quantity,
  relation: "and",
});
const applicableBuy = (rawItems: unknown[]) => ({
  on: "complete",
  categories: [],
  items: [],
  isExclude: false,
  isInclude: false,
  rawItems,
});
/** An item offer on the stock free-salad offer's shape (offers.json[2]). */
const itemOffer = (over: Record<string, unknown>) => ({
  ...clone(offersFixture[2]),
  ...over,
});

/** Plain-and BOGO: buy 2 Tortilla Sauce → a Caesar Dressing free. */
const BOGO_SAUCE = itemOffer({
  _id: "offer-bogo-sauce",
  name: "Buy 2 Tortilla Sauce get a Caesar free",
  getItemOnly: false,
  applicable: applicableBuy([buyRaw(TORTILLA_SAUCE, "Tortilla Sauce", 2)]),
  getItems: {
    items: [getEntry("gi-bogo-caesar", CAESAR_DRESSING, "Caesar Dressing", "and")],
    categories: [],
  },
});

/** A CUSTOMIZABLE buy item: buy a Cheese Burger → a Greek Salad free. */
const BOGO_BURGER_SALAD = itemOffer({
  _id: "offer-bogo-burger-salad",
  name: "Buy a Cheese Burger get a Greek Salad free",
  getItemOnly: false,
  applicable: applicableBuy([buyRaw(CHEESE_BURGER, "Cheese Burger", 1)]),
  getItems: {
    items: [getEntry("gi-bogo-salad", GREEK_SALAD, "Greek Salad", "and")],
    categories: [],
  },
});

/** Least-value: buy any 2 sauces, the cheapest is free (empty get side). */
const LEAST_SAUCES = itemOffer({
  _id: "offer-least-sauces",
  name: "Any 2 sauces, cheapest free",
  getItemOnly: false,
  getLeastValueItem: true,
  leastItemValueCount: { buyQuantity: 2, getQuantity: 1 },
  applicable: applicableBuy([
    { item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" } },
    { item: { baseItemId: CAESAR_DRESSING, name: "Caesar Dressing" } },
  ]),
  getItems: { items: [], categories: [] },
});

/**
 * Group-wise "any 2 sauces → a Caesar free": a locked bogoBuySide row that a
 * buy stage can NOT finish (canOfferBuyStage: group mode, G3), so it never
 * offers ADD ITEMS.
 */
const GROUP_SAUCES = itemOffer({
  _id: "offer-group-sauces",
  name: "Any 2 sauces, a Caesar free",
  getItemOnly: false,
  buygetGroupWiseOffer: true,
  buygetGroupWiseOfferValues: {
    discountType: "percent",
    value: 100,
    getQuantity: 1,
    buyQuantity: 2,
  },
  applicable: applicableBuy([
    { item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" } },
    { item: { baseItemId: CAESAR_DRESSING, name: "Caesar Dressing" } },
  ]),
  getItems: {
    items: [getEntry("gi-group-caesar", CAESAR_DRESSING, "Caesar Dressing", "or")],
    categories: [],
  },
});

/**
 * sameOrLess plain BOGO with an "or" buy side (a Greek Salad OR a Tortilla
 * Sauce) granting a Greek Salad: the £17 grant holds while a paid salad is
 * the ceiling, and breaks (revalidation check 7) once only the £2 sauce is
 * left — the buy side itself is still met, so check 6 keeps quiet.
 */
const SOL_SALAD_BUY_OR = itemOffer({
  _id: "offer-sol-salad-buy-or",
  name: "Buy a salad or a sauce get a salad free",
  getItemOnly: false,
  sameOrLess: true,
  applicable: applicableBuy([
    { ...buyRaw(GREEK_SALAD, "Greek Salad", 1), relation: "or" },
    { ...buyRaw(TORTILLA_SAUCE, "Tortilla Sauce", 1), relation: "or" },
  ]),
  getItems: {
    items: [getEntry("gi-sol-buy-or-salad", GREEK_SALAD, "Greek Salad", "and")],
    categories: [],
  },
});

/** sameOrLess plain BOGO over a £2 Tortilla Sauce: Greek Salad (£17) OR Caesar (£2). */
const SOL_SAUCE_OR = itemOffer({
  _id: "offer-sol-sauce-or",
  name: "Buy a Tortilla Sauce get a side free",
  getItemOnly: false,
  sameOrLess: true,
  applicable: applicableBuy([buyRaw(TORTILLA_SAUCE, "Tortilla Sauce", 1)]),
  getItems: {
    items: [
      getEntry("gi-sol-or-salad", GREEK_SALAD, "Greek Salad", "or"),
      getEntry("gi-sol-or-caesar", CAESAR_DRESSING, "Caesar Dressing", "or"),
    ],
    categories: [],
  },
});

/** The same grant as "and": the £17 salad is over the ceiling, so it is refused. */
const SOL_SAUCE_AND = itemOffer({
  _id: "offer-sol-sauce-and",
  name: "Buy a Tortilla Sauce get two sides free",
  getItemOnly: false,
  sameOrLess: true,
  applicable: applicableBuy([buyRaw(TORTILLA_SAUCE, "Tortilla Sauce", 1)]),
  getItems: {
    items: [
      getEntry("gi-sol-and-salad", GREEK_SALAD, "Greek Salad", "and"),
      getEntry("gi-sol-and-caesar", CAESAR_DRESSING, "Caesar Dressing", "and"),
    ],
    categories: [],
  },
});

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

/** Tortilla Sauce is plain with no recommendedItems: a card tap adds it, no modal. */
async function addTortillaSauceOneTap(page: Page) {
  const sauce = page.getByTestId(`item-${TORTILLA_SAUCE}`);
  await sauce.scrollIntoViewIfNeeded();
  await sauce.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
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
const freeChip = '[data-testid^="bag-free-chip-"]';

async function openRewardsSheet(page: Page) {
  await page.getByTestId("bag-rewards-entry").click();
  await expect(page.getByTestId("rewards-sheet")).toBeVisible();
}

/** Rewards list → a locked buy-side row's ADD ITEMS → the stage (the list closes). */
async function openBuyStage(page: Page, offerId: string) {
  await openRewardsSheet(page);
  await expect(page.getByTestId(`offer-radio-${offerId}`)).toHaveCount(0);
  await page.getByTestId(`offer-row-add-items-${offerId}`).click();
  await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
  await expect(page.getByTestId("buy-stage-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

/** A free row: Free chip, live £0.00-style price, the undiscounted one struck. */
async function expectFreeRow(page: Page, name: string, live: string, struck: string) {
  const row = bagRows(page).filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.locator(freeChip)).toHaveText("Free");
  await expect(row.locator(".line-through")).toHaveText(struck);
  await expect(row).toContainText(live);
  await expect(row.locator('[data-testid^="bag-dec-"]')).toHaveCount(0);
}

test.describe("Lane offers — BOGO buy stage (item 31)", () => {
  test("E1 ADD ITEMS on 'Buy 2 Tortilla Sauce → Caesar free': 0 of 2 → ADD, + → Reward unlocked! → CONTINUE applies directly; sauce ×2 paid + free Caesar, Discounts −£2.00, Total £14.00; Remove + bag close keeps the paid sauces", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [BOGO_SAUCE]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openBuyStage(page, BOGO_SAUCE._id);

    // Locked: nothing added yet, CONTINUE inert (aria-disabled). A tap names
    // the gap inline and commits nothing (force: Playwright refuses the
    // aria-disabled control, which is itself the guarantee).
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("0 of 2 added");
    await expect(page.getByTestId("buy-stage-unlocked")).toHaveCount(0);
    await expect(page.getByTestId("buy-stage-continue")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await page.getByTestId("buy-stage-continue").click({ force: true });
    await expect(page.getByTestId("buy-stage-hint")).toHaveText(
      "Add 2 more qualifying items to unlock"
    );
    await expect(page.getByTestId("buy-stage-sheet")).toBeVisible();
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);

    // ADD lands ONE paid row; + raises the SAME row (dedupe add, no repeat sheet).
    await page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("1 of 2 added");
    await expect(bagRows(page)).toHaveCount(2);
    await page.getByTestId(`buy-stage-inc-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId(`buy-stage-qty-${TORTILLA_SAUCE}`)).toHaveText("2");
    await expect(page.getByTestId("buy-stage-unlocked")).toHaveText("Reward unlocked!");
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("2 of 2 added");
    await expect(page.getByTestId("buy-stage-hint")).toHaveText("");
    await expect(page.getByTestId("buy-stage-continue")).toHaveAttribute(
      "aria-disabled",
      "false"
    );
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page).toHaveURL(/\/cart$/);

    // CONTINUE: a fixed single "and" grant applies directly — no picker. A
    // customer apply celebrates (item 33), checked first: the card is 2.2 s.
    await page.getByTestId("buy-stage-continue").click();
    await expect(page.getByTestId("offer-applied-celebration")).toBeVisible();
    await expect(page.getByTestId("offer-applied-celebration")).toContainText(
      "You save £2.00"
    );
    await expect(page.getByTestId("buy-stage-sheet")).toHaveCount(0);
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);

    // Burger + ONE Tortilla row at qty 2 (paid £4.00) + the free Caesar.
    await expect(bagRows(page)).toHaveCount(3);
    const sauceRow = bagRows(page).filter({ hasText: "Tortilla Sauce" });
    await expect(sauceRow.locator('[data-testid^="bag-dec-"] + p')).toHaveText("2");
    await expect(sauceRow).toContainText("£4.00");
    await expect(sauceRow.locator(freeChip)).toHaveCount(0);
    await expectFreeRow(page, "Caesar Dressing", "£0.00", "£2.00");

    await expect(page.getByTestId("bag-subtotal")).toContainText("£14.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£14.00");
    await expect(page.getByTestId("bag-pay")).toContainText("Order & Pay");
    await expect(page.getByTestId("bag-pay")).toContainText("£14.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(BOGO_SAUCE.name);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(`${MINUS}£2.00`);
    await expect(page).toHaveURL(/\/cart$/);

    // The landed offer completed the journey: the paid sauces are the
    // customer's now. Removing the reward and closing the bag must NOT roll
    // them back (the snapshot was released when the offer took the slot).
    await page.getByTestId("bag-rewards-remove").click();
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(2);
    await page.getByTestId("bag-close").click();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(2)");
    await openBag(page);
    await expect(bagRows(page)).toHaveCount(2);
    await expect(sauceRow.locator('[data-testid^="bag-dec-"] + p')).toHaveText("2");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£12.00");
    await expect(page.getByTestId("bag-total")).toContainText("£14.00");
  });

  test("E2 BACK mid-journey rolls the cart back: + once (Total £12.00), BACK → burger only, Total £9.00, the rewards list is back with the offer still locked", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [BOGO_SAUCE]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await openBuyStage(page, BOGO_SAUCE._id);

    // The stage's add is a REAL paid row: the bill under the sheet moves.
    await page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("1 of 2 added");
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£10.00");
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");

    await page.getByTestId("buy-stage-back").click();
    await expect(page.getByTestId("buy-stage-sheet")).toHaveCount(0);
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId(`offer-row-add-items-${BOGO_SAUCE._id}`)).toBeVisible();
    await expect(page).toHaveURL(/\/cart$/);

    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).filter({ hasText: "Tortilla Sauce" })).toHaveCount(0);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
  });

  test("E3 a customizable buy tile opens the PDP INSIDE the bag (embedded, stepper + priced CTA, no CANCEL ORDER); ADD TO BAG → 1 of 1 → CONTINUE → the Greek Salad lands free, Total £12.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [BOGO_BURGER_SALAD]);
    await bootRegisteredToMenu(page);
    await addTortillaSauceOneTap(page);
    await openBag(page);
    await openBuyStage(page, BOGO_BURGER_SALAD._id);
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("0 of 1 added");

    await page.getByTestId(`buy-stage-add-${CHEESE_BURGER}`).click();
    const host = page.getByTestId("offer-tier-host");
    await expect(host).toBeVisible();
    await expect(host.getByTestId("customization-screen")).toHaveAttribute(
      "data-embedded",
      "true"
    );
    await expect(page).toHaveURL(/\/cart$/);
    // A PAID pick keeps the stepper and the priced CTA; the bag owns the
    // footer, so the embedded PDP renders no CANCEL ORDER (hazard H1).
    await expect(host.getByTestId("pdp-qty")).toHaveText("1");
    await expect(host.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
    await expect(host.getByTestId("footer-cancel")).toHaveCount(0);

    await host.getByTestId("pdp-add-to-bag").click();
    await expect(host).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("buy-stage-sheet")).toBeVisible();
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("1 of 1 added");
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
    await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(2);

    await page.getByTestId("buy-stage-continue").click();
    await expect(page.getByTestId("buy-stage-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(3);
    await expectFreeRow(page, "Greek Salad", "£0.00", "£17.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£27.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      BOGO_BURGER_SALAD.name
    );
  });

  test("E4 least-value 'any 2 sauces, cheapest free': the least note and APPLY REWARD; two sauces → apply → Discounts −£2.00, Total £12.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [LEAST_SAUCES]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openBuyStage(page, LEAST_SAUCES._id);

    await expect(page.getByTestId("buy-stage-least-note")).toHaveText(
      "Your lowest-priced qualifying item becomes free"
    );
    await expect(page.getByTestId("buy-stage-continue")).toHaveText("APPLY REWARD");
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("0 of 2 added");
    await page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("1 of 2 added");
    await page.getByTestId(`buy-stage-add-${CAESAR_DRESSING}`).click();
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();

    await page.getByTestId("buy-stage-continue").click();
    await expect(page.getByTestId("buy-stage-sheet")).toHaveCount(0);
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(3);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(LEAST_SAUCES.name);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£12.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
  });

  test("E5 sameOrLess over a £2 Tortilla Sauce: the 'and' grant is refused inline with nothing written (X rolls back); the 'or' grant's picker offers only Caesar → free, Total £12.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [SOL_SAUCE_OR, SOL_SAUCE_AND]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);

    // "and": the £17 salad entry is over the £2 ceiling → the whole grant is
    // refused; the stage stays open with the inline line, nothing applied.
    await openBuyStage(page, SOL_SAUCE_AND._id);
    await page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
    await page.getByTestId("buy-stage-continue").click();
    await expect(page.getByTestId("buy-stage-guard")).toHaveText(
      "This reward can't be applied to your current order"
    );
    await expect(page.getByTestId("buy-stage-sheet")).toBeVisible();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(2);
    await expect(bagRows(page).locator(freeChip)).toHaveCount(0);
    await page.getByTestId("buy-stage-close").click();
    await expect(page.getByTestId("buy-stage-sheet")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(1);

    // "or", dismissed: X on the picker abandons the journey, so the stage's
    // paid sauce rolls back (the snapshot stayed armed through the hand-off).
    await openBuyStage(page, SOL_SAUCE_OR._id);
    await page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
    await page.getByTestId("buy-stage-continue").click();
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(bagRows(page)).toHaveCount(2);
    await page.getByTestId("freebie-close").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).filter({ hasText: "Tortilla Sauce" })).toHaveCount(0);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);

    // "or": CONTINUE hands the picker the CEILING-FILTERED offer.
    await openBuyStage(page, SOL_SAUCE_OR._id);
    await page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
    await page.getByTestId("buy-stage-continue").click();
    await expect(page.getByTestId("buy-stage-sheet")).toHaveCount(0);
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId(`freebie-option-${GREEK_SALAD}`)).toHaveCount(0);
    await expect(page.locator('[data-testid^="freebie-option-"]')).toHaveCount(1);
    await page.getByTestId(`freebie-option-${CAESAR_DRESSING}`).click();
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);

    await expect(bagRows(page)).toHaveCount(3);
    await expect(bagRows(page).filter({ hasText: "Greek Salad" })).toHaveCount(0);
    await expectFreeRow(page, "Caesar Dressing", "£0.00", "£2.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£12.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(SOL_SAUCE_OR.name);
  });

  test("E6 X mid-journey (unlocked, not continued) rolls back: no stage, no list, burger only at £9.00, nothing applied; the offer is still locked, and a locked group-wise row never offers ADD ITEMS", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [BOGO_SAUCE, GROUP_SAUCES]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openBuyStage(page, BOGO_SAUCE._id);

    await page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`).click();
    await page.getByTestId(`buy-stage-inc-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
    await expect(page.getByTestId("bag-subtotal")).toContainText("£12.00");

    await page.getByTestId("buy-stage-close").click();
    await expect(page.getByTestId("buy-stage-sheet")).toHaveCount(0);
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);

    await openRewardsSheet(page);
    await expect(page.getByTestId(`offer-row-add-items-${BOGO_SAUCE._id}`)).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${BOGO_SAUCE._id}`)).toHaveCount(0);
    // Group-wise is locked on the same "buy" gap, but no stage can finish it
    // (canOfferBuyStage, G3): the row stays informational.
    await expect(page.getByTestId(`offer-row-${GROUP_SAUCES._id}`)).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${GROUP_SAUCES._id}`)).toHaveCount(0);
    await expect(page.getByTestId(`offer-row-add-items-${GROUP_SAUCES._id}`)).toHaveCount(0);
  });

  test("E7 double taps: the embedded PDP's ADD TO BAG never ghost-taps the stage's CONTINUE beneath, and CONTINUE never ghost-taps PAY (500 ms tap guards)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [BOGO_BURGER_SALAD]);
    await bootRegisteredToMenu(page);
    await addTortillaSauceOneTap(page);
    await openBag(page);
    await openBuyStage(page, BOGO_BURGER_SALAD._id);
    await page.getByTestId(`buy-stage-add-${CHEESE_BURGER}`).click();
    const host = page.getByTestId("offer-tier-host");
    await expect(host).toBeVisible();

    // The first tap lands the burger and closes the PDP; the second must hit
    // the host's tap guard, not the now-unlocked CONTINUE under it.
    await host.getByTestId("pdp-add-to-bag").dblclick();
    await expect(host).toHaveCount(0);
    await expect(page.getByTestId("offer-tier-tap-guard")).toHaveCount(0);
    await expect(page.getByTestId("buy-stage-sheet")).toBeVisible();
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);

    // A point inside BOTH CONTINUE and the bag's PAY beneath the stage (both
    // settled; PAY keeps its box while covered): the first tap commits, the
    // second must hit the CTA bar's guard, not PAY.
    const pay = await page.getByTestId("bag-pay").boundingBox();
    const cont = await page.getByTestId("buy-stage-continue").boundingBox();
    if (!pay || !cont) throw new Error("PAY / CONTINUE are not laid out");
    const left = Math.max(pay.x, cont.x);
    const right = Math.min(pay.x + pay.width, cont.x + cont.width);
    const top = Math.max(pay.y, cont.y);
    const bottom = Math.min(pay.y + pay.height, cont.y + cont.height);
    expect(right - left).toBeGreaterThan(0);
    expect(bottom - top).toBeGreaterThan(0);
    await page.mouse.dblclick((left + right) / 2, (top + bottom) / 2);
    await expect(page.getByTestId("buy-stage-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);
    await expect(page.getByTestId("bag-cta-tap-guard")).toHaveCount(0);
    // A ghost PAY navigates only after its async preflight: two more round
    // trips in the bag give it the time to surface before the URL check
    // (bounded, so a bag that navigated away fails fast, not at the test cap).
    await page.getByTestId("bag-rewards-applied").click({ timeout: 10_000 });
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId("rewards-close").click({ timeout: 10_000 });
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
  });

  test("E8 revalidation check 7 (sameOrLess): a free £17 salad earned against a paid salad is withdrawn, with the notice, once only the £2 sauce is left to back it — though the 'or' buy side is still met", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [SOL_SALAD_BUY_OR]);
    await bootRegisteredToMenu(page);
    await addTortillaSauceOneTap(page);
    const saladCard = page.getByTestId(`item-${GREEK_SALAD}`);
    await saladCard.scrollIntoViewIfNeeded();
    await saladCard.click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(2)");
    await openBag(page);

    // The paid £17 salad is the ceiling, so the £17 grant passes it and
    // lands directly (a single "and" plain entry).
    await openRewardsSheet(page);
    await page.getByTestId(`offer-row-${SOL_SALAD_BUY_OR._id}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(3);
    const freeRow = bagRows(page).filter({ has: page.locator(freeChip) });
    await expect(freeRow).toHaveCount(1);
    await expect(freeRow).toContainText("Greek Salad");
    await expect(freeRow.locator(".line-through")).toHaveText("£17.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£36.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£22.00");

    // Remove the PAID salad (qty 1 → the confirm modal). The sauce still
    // meets the "or" buy side, but caps the grant at £2 < £17.
    const paidSalad = bagRows(page)
      .filter({ hasText: "Greek Salad" })
      .filter({ hasNot: page.locator(freeChip) });
    await expect(paidSalad).toHaveCount(1);
    await paidSalad.locator('[data-testid^="bag-dec-"]').click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();
    await page.getByTestId("remove-item-confirm").click();

    await expect(page.getByTestId("offer-removal-notice")).toBeVisible();
    await expect(page.getByTestId("offer-removal-notice")).toContainText("Reward Removed");
    await expect(page.getByTestId("offer-removal-notice")).toContainText(
      SOL_SALAD_BUY_OR.name
    );
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).locator(freeChip)).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId("bag-total")).toContainText("£2.00");
    await page.getByTestId("offer-removal-gotit").click();
    await expect(page.getByTestId("offer-removal-notice")).toHaveCount(0);
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
  });

  test("E9 a stage tile's − never takes the cart's last paid unit (inline guard — the bag's empty-cart exit would fire mid-stage); above it, − is a plain decrease", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [BOGO_SAUCE]);
    await bootRegisteredToMenu(page);
    await addTortillaSauceOneTap(page);
    await openBag(page);
    await openBuyStage(page, BOGO_SAUCE._id);
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("1 of 2 added");
    await expect(page.getByTestId(`buy-stage-qty-${TORTILLA_SAUCE}`)).toHaveText("1");

    // The cart's ONLY paid unit: refused inline, nothing removed, still /cart.
    await page.getByTestId(`buy-stage-dec-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId("buy-stage-guard")).toHaveText(
      "Keep at least one item in your order"
    );
    await expect(page.getByTestId(`buy-stage-qty-${TORTILLA_SAUCE}`)).toHaveText("1");
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("buy-stage-sheet")).toBeVisible();
    await expect(page).toHaveURL(/\/cart$/);

    // + then −: a plain decrease above the last unit; the guard line clears.
    await page.getByTestId(`buy-stage-inc-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
    await expect(page.getByTestId("buy-stage-guard")).toHaveText("");
    await expect(page.getByTestId("bag-total")).toContainText("£5.00");
    await page.getByTestId(`buy-stage-dec-${TORTILLA_SAUCE}`).click();
    await expect(page.getByTestId(`buy-stage-qty-${TORTILLA_SAUCE}`)).toHaveText("1");
    await expect(page.getByTestId("buy-stage-counter")).toHaveText("1 of 2 added");
    await expect(page.getByTestId("buy-stage-unlocked")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-total")).toContainText("£2.00");
    await expect(page).toHaveURL(/\/cart$/);
  });

  test("E10 a sameOrLess 'or' offer SAVEd straight from the list (its buy side already met) hands the picker the CEILING-FILTERED offer: only Caesar → free, Total £12.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [SOL_SAUCE_OR]);
    await bootRegisteredToMenu(page);
    await addTortillaSauceOneTap(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);

    await openRewardsSheet(page);
    await expect(page.getByTestId(`offer-radio-${SOL_SAUCE_OR._id}`)).toBeVisible();
    await page.getByTestId(`offer-row-${SOL_SAUCE_OR._id}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(page).toHaveURL(/\/cart$/);
    // The £2 sauce caps the grant: the £17 salad is not on offer.
    await expect(page.getByTestId(`freebie-option-${GREEK_SALAD}`)).toHaveCount(0);
    await expect(page.locator('[data-testid^="freebie-option-"]')).toHaveCount(1);
    await page.getByTestId(`freebie-option-${CAESAR_DRESSING}`).click();
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);

    await expect(bagRows(page)).toHaveCount(3);
    await expectFreeRow(page, "Caesar Dressing", "£0.00", "£2.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£12.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(SOL_SAUCE_OR.name);
  });
});
