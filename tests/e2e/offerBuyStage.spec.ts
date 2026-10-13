import { test, expect, type Page, type Route } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  clone,
  routeOffers,
  CHEESE_BURGER,
  GREEK_SALAD,
  TORTILLA_SAUCE,
  CAESAR_DRESSING,
  LARGE_FRIES,
} from "./fixtures/backend";
import { bootRegisteredToMenu } from "./pages/boot";
import { addViaPdp, addOneTap, openBag, bagRows, openRewardsSheet } from "./pages/order";

/**
 * Lane offers, item 31 (+31b) — the BOGO BUY STAGE inside the bag: a locked
 * "buy X" reward row's ADD ITEMS opens the stage, its tiles add REAL paid
 * rows, CONTINUE commits through the one apply path, and every way out that
 * does not land the offer (BACK, X) rolls the cart back to its snapshot.
 * The URL stays /cart throughout (nothing in the stage navigates).
 *
 * Same registered-device boot as offers.spec.ts, on the shared harness
 * (fixtures/backend.ts mock, pages/* steps). Each test then registers its OWN
 * get_cx_valid_offers route (newest wins). Offer payloads are
 * production-shaped: getItems entries carry no `type` (the backend never
 * sends one), the buy side is applicable.rawItems, and every id exists in
 * the slim menu (the converter drops unknown ids).
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

const offersFixture = fixtureJson("offers.json");

/** U+2212 MINUS SIGN — the literal character the bag renders, NOT a hyphen. */
const MINUS = "−";

// ---- Offer payloads (production-shaped; see header) ----
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
 * sameOrLess plain BOGO with an "and" buy side — a Cheese Burger AND Large
 * Fries — granting a Greek Salad: the ceiling is the buy side's SUM
 * (£8 + £9 = £17), so the £17 salad fits, where either alone (£9 at most)
 * would cap it out.
 */
const SOL_SALAD_BUY_AND = itemOffer({
  _id: "offer-sol-salad-buy-and",
  name: "Buy a burger and fries get a salad free",
  getItemOnly: false,
  sameOrLess: true,
  applicable: applicableBuy([
    buyRaw(CHEESE_BURGER, "Cheese Burger", 1),
    buyRaw(LARGE_FRIES, "Large Fries", 1),
  ]),
  getItems: {
    items: [getEntry("gi-sol-buy-and-salad", GREEK_SALAD, "Greek Salad", "and")],
    categories: [],
  },
});

/**
 * The shared boot mock (fixtures/backend.ts) serving the stock P7b offers
 * fixture; each test routes its own list after it (routeOffers, newest wins).
 */
const mockKioskBackend = (page: Page) => mockBackend(page, { offers: fixtureJson("offers.json") });

/** Menu card tap → PDP → commit plain (£8) → dismiss the added modal. */
const addCheeseBurgerViaPdp = (page: Page) =>
  addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });

/** Tortilla Sauce is plain with no recommendedItems: a card tap adds it, no modal. */
const addTortillaSauceOneTap = (page: Page) => addOneTap(page, TORTILLA_SAUCE, "(1)");

const freeChip = '[data-testid^="bag-free-chip-"]';

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
    // UB1: a tile prices in the deployment's symbol (the raw menu price).
    await expect(page.getByTestId(`buy-stage-tile-${TORTILLA_SAUCE}`)).toContainText("£2");
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

  test("E12 sameOrLess over an 'and' buy side: the ceiling is the buy side's SUM — a Cheese Burger AND Large Fries (£8 + £9) carry the free £17 Greek Salad that either alone could not", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [SOL_SALAD_BUY_AND]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    const fries = page.getByTestId(`item-${LARGE_FRIES}`);
    await fries.scrollIntoViewIfNeeded();
    await fries.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    await openBag(page);

    await openRewardsSheet(page);
    await expect(page.getByTestId(`offer-radio-${SOL_SALAD_BUY_AND._id}`)).toBeVisible();
    await page.getByTestId(`offer-row-${SOL_SALAD_BUY_AND._id}`).click();
    await page.getByTestId("rewards-save").click();
    // One "and" entry under the ceiling: applied directly, no picker.
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);

    await expect(bagRows(page)).toHaveCount(3);
    await expectFreeRow(page, "Greek Salad", "£0.00", "£17.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£34.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);
    // VAT on the paid £17 only: round(17 × 1.15) = £20.
    await expect(page.getByTestId("bag-total")).toContainText("£20.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(SOL_SALAD_BUY_AND.name);
  });

  test("E11 a stalled bag chunk never traps the customer: while the rewards sheet's code loads, its scrim is the sheet's own Close — a tap closes it and the bag works; once the code arrives, rewards and the stage work", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [BOGO_SAUCE]);
    // The bag's ONE lazy chunk (rail, rewards sheet, picker, buy stage,
    // celebration) is held until released below. The buy stage opens only
    // from the rewards sheet, so the rewards sheet is where a stall shows.
    let held: Route | undefined;
    await page.route("**/src/components/cart/bagLazyParts.ts*", (route) => {
      held = route;
    });
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);

    await page.getByTestId("bag-rewards-entry").click();
    const loading = page.getByTestId("rewards-loading");
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAccessibleName("Close rewards");
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);

    await loading.click();
    await expect(loading).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");

    await expect.poll(() => held !== undefined).toBe(true);
    await held?.continue();
    await openRewardsSheet(page);
    await page.getByTestId(`offer-row-add-items-${BOGO_SAUCE._id}`).click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("buy-stage-sheet")).toBeVisible();
  });
});

/* ------------------------------------------------------------------ *
 * Lane offers-parity (E-C1, E-C2): the buy stage now opens for get-category
 * BOGOs (F1 — the picker lists the category's items). Category ids are the slim menu's
 * sub-categories (items carry subCategoryId null; the converter stamps it).
 * Money (header rules): E-C1 Tortilla 2 + Greek Salad 17 + free Tortilla 2:
 * Sub £21.00, −£2.00, VAT 15% × 19 = 2.85 → 21.85 → £22.00. E-C2 burger 8 +
 * 2 free Tortilla 4: Sub £12.00, −£4.00, VAT 1.20 → £9.00.
 * ------------------------------------------------------------------ */
const SAUCES_SUB = "5dd1092fbec752021df55e1c"; // Tortilla £2, Caesar £2, BBQ Sauce. £1 (PDP)
const SIDE_ORDERS_SUB = "5dd1092e29754a432f2c32d7"; // Greek Salad £17, Cheese Burger £8 (PDP), Large Fries £9 (PDP)

const buyCategory = (_id: string, categoryName: string, relation: "and" | "or") => ({
  category: { _id, categoryName },
  quantity: 1,
  relation,
});
const getCategory = (_id: string, name: string, quantity: number, relation: "and" | "or") => ({
  _id,
  name,
  quantity,
  relation,
  value: 100,
  discountType: "percent",
});

/** "Order any pizza…"-shaped: buy any side ("and"), get any sauce free. */
const CAT_BOGO = itemOffer({
  _id: "offer-cat-bogo",
  name: "Buy any side, get any sauce free",
  getItemOnly: false,
  applicable: applicableBuy([buyCategory(SIDE_ORDERS_SUB, "Side Orders", "and")]),
  getItems: { items: [], categories: [getCategory(SAUCES_SUB, "Sauces", 1, "and")] },
});

/** "BOGO OR"-shaped: buy a burger, get a Caesar OR any 2 sauces. */
const CAT_OR_BOGO = itemOffer({
  _id: "offer-cat-or-bogo",
  name: "Buy a burger, get a Caesar or any 2 sauces",
  getItemOnly: false,
  isAndOffer: false,
  applicable: applicableBuy([{ ...buyRaw(CHEESE_BURGER, "Cheese Burger", 1), relation: "or" }]),
  getItems: {
    items: [getEntry("gi-cat-or-caesar", CAESAR_DRESSING, "Caesar Dressing", "or")],
    categories: [getCategory(SAUCES_SUB, "Sauces", 2, "or")],
  },
});

const catOption = (page: Page, groupId: string, entityId: string) =>
  page.getByTestId(`freebie-cat-option-${groupId}-${entityId}`);

test.describe("Lane offers-parity — the buy stage for category offers", () => {
  test("E-C1 a get-category BOGO: ADD ITEMS → + Greek Salad → CONTINUE → the picker's Sauces section; X rolls the cart back; then Tortilla → CONFIRM → −£2.00, Total £22.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [CAT_BOGO]);
    await bootRegisteredToMenu(page);
    await addTortillaSauceOneTap(page);
    await openBag(page);

    // Dismissed: picker X abandons the journey — the stage's salad rolls back.
    await openBuyStage(page, CAT_BOGO._id);
    await expect(page.getByTestId(`buy-stage-tile-${GREEK_SALAD}`)).toBeVisible();
    await page.getByTestId(`buy-stage-add-${GREEK_SALAD}`).click();
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
    await page.getByTestId("buy-stage-continue").click();
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(page.getByTestId(`freebie-cat-${SAUCES_SUB}`)).toContainText("Any 1 from Sauces");
    await expect(bagRows(page)).toHaveCount(2);
    await page.getByTestId("freebie-close").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-total")).toContainText("£2.00");
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);

    // Completed.
    await openBuyStage(page, CAT_BOGO._id);
    await page.getByTestId(`buy-stage-add-${GREEK_SALAD}`).click();
    await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
    await page.getByTestId("buy-stage-continue").click();
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(page).toHaveURL(/\/cart$/);
    const confirm = page.getByTestId("freebie-confirm");
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await catOption(page, SAUCES_SUB, TORTILLA_SAUCE).click();
    await expect(page.getByTestId(`freebie-cat-count-${SAUCES_SUB}`)).toHaveText("1 of 1 added");
    await expect(confirm).toHaveAttribute("aria-disabled", "false");
    await confirm.click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);

    await expect(bagRows(page)).toHaveCount(3);
    await expect(bagRows(page).locator(freeChip)).toHaveCount(1);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£21.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£22.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(CAT_BOGO.name);
  });

  test("E-C2 'BOGO OR'-shaped: the picker offers the Caesar item OR 'Any 2 from Sauces' — switching clears the other; Tortilla ×2 → CONFIRM → −£4.00, Total £9.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [CAT_OR_BOGO]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);
    await page.getByTestId(`offer-row-${CAT_OR_BOGO._id}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("freebie-picker")).toBeVisible();

    const caesar = page.getByTestId(`freebie-option-${CAESAR_DRESSING}`);
    const tortilla = catOption(page, SAUCES_SUB, TORTILLA_SAUCE);
    const count = page.getByTestId(`freebie-cat-count-${SAUCES_SUB}`);
    await expect(page.getByTestId(`freebie-cat-${SAUCES_SUB}`)).toContainText("Any 2 from Sauces");

    await caesar.click();
    await expect(caesar).toHaveAttribute("aria-pressed", "true");
    await tortilla.click();
    await expect(caesar).toHaveAttribute("aria-pressed", "false");
    await expect(count).toHaveText("1 of 2 added");
    await caesar.click();
    await expect(count).toHaveText("0 of 2 added");
    await tortilla.click();
    await tortilla.click();
    await expect(count).toHaveText("2 of 2 added");
    await expect(caesar).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);

    await expect(bagRows(page).filter({ has: page.locator(freeChip) })).toContainText("Tortilla Sauce");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£12.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£4.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });
});
