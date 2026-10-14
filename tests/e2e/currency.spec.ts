import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  SKIP_CRM,
  GREEK_SALAD,
  CHEESE_BURGER,
  type KioskBackendOptions,
} from "./fixtures/backend";
import { bootRegisteredToMenu, chooseLanguage } from "./pages/boot";
import { mockCheckoutBackend, type CheckoutMockHandle } from "./fixtures/checkout";
import { openRewardsSheet } from "./pages/order";
import { glyphX } from "./fixtures/glyphs";

/**
 * UB1 (user bug 2026-10-08): "there is no currency in anywhere in the ui".
 *
 * Every price site read `currencySettings.symbol` — a key the backend never
 * sends — and the fixtures invented the same key, so the suite stayed green
 * while every price printed bare. This spec answers `cx/kiosk/get_data` with
 * the backend's EXACT Indian body (posistApp kiosk.controller get_data:
 * `currencySettings = {currency, text, uniDec, uniHex}` as Posist admin saves
 * it, `countryCode = {name, dial_code, code}`) and expects ₹ on every money
 * surface of the order flow: a menu card, the menu TOTAL bar, the PDP's
 * ADD TO BAG label, a bag row, the bag Total and PAY, and the /payment TOTAL
 * bar. Case 2 is a deployment that never saved a currency (no
 * `currencySettings` at all): the SDK's getCurrencyText falls back to ₹.
 *
 * Money facts (slim-menu, as bag.spec.ts): Greek Salad ₹17, no modifiers →
 * a one-tap add; VAT@15% exclusive and the total rounds to whole units →
 * Total = round(17 × 1.15) = ₹20.00. Cheese Burger ₹8 opens the PDP.
 *
 * Mock order (the harness house order, newest wins): the shared mock
 * (fixtures/backend.ts) first, this spec's get_data over it, and
 * mockCheckoutBackend (the /payment settings + the LOUD 500 gateway guards)
 * last.
 */

/** The backend's exact get_data `deployment` for TB India. */
const INDIA_DEPLOYMENT = {
  _id: "dep1",
  mobile: "9999999999",
  currencySettings: { currency: "INR", text: "₹", uniDec: "8377", uniHex: "8377" },
  countryCode: { name: "India", dial_code: "+91", code: "IN" },
};

/** A deployment that never saved a currency: the key is absent. */
const NO_CURRENCY_DEPLOYMENT = {
  _id: "dep1",
  mobile: "9999999999",
  countryCode: { name: "India", dial_code: "+91", code: "IN" },
};

/**
 * The shared mock, then THE point of this spec: get_data answers the backend's
 * real body — `_id`, `mobile`, `uniDec`, `uniHex` included, more than the
 * shared mock's typed `deployment` option carries — not a test-shaped one.
 */
async function mockKioskBackend(
  page: Page,
  deployment: Record<string, unknown>,
  options: KioskBackendOptions = {},
) {
  await mockBackend(page, { settings: SKIP_CRM, ...options });
  await page.route("**/api/cx/kiosk/get_data", (r) =>
    r.fulfill({ json: { charges: [], deployment } })
  );
}

/** One-tap add (no modifiers): the card prints the whole-rupee menu price. */
async function addGreekSalad(page: Page) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await expect(salad).toContainText("₹17");
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
  await expect(page.getByTestId("cta-total")).toContainText("₹17.00");
}

/** VIEW MY BAG → /cart. */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/cart$/);
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
}

function expectNoGatewayContacted(checkout: CheckoutMockHandle) {
  expect(checkout.forbiddenUrls, "a gateway / terminal endpoint was contacted").toEqual([]);
  expect(checkout.printAgentUrls, "the local print agent was contacted").toEqual([]);
  expect(checkout.placeOrderCount).toBe(0);
}

test.describe("UB1 — prices carry the deployment's currency symbol", () => {
  test("the backend's exact INR body: ₹ on the menu card, TOTAL bar, PDP, bag row, bag Total, PAY and /payment", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, INDIA_DEPLOYMENT);
    const checkout = await mockCheckoutBackend(page);
    await bootRegisteredToMenu(page);

    // The PDP's ADD TO BAG label — opened and left without committing.
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await expect(burger).toContainText("₹8");
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("₹8.00");
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });

    // A menu card and the menu TOTAL bar.
    await addGreekSalad(page);

    // The bag: the row, Sub Total, Total and PAY.
    await openBag(page);
    const row = page.locator('[data-testid^="bag-row-"]').first();
    await expect(row).toContainText("Greek Salad");
    await expect(row).toContainText("₹17.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("₹17.00");
    await expect(page.getByTestId("bag-total")).toContainText("₹20.00");
    await expect(page.getByTestId("bag-pay")).toContainText("₹20.00");

    // /payment's TOTAL bar (nothing is placed: the spec stops here).
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("payment-total")).toContainText("₹20.00");

    // The device stored the backend's shape verbatim (no `symbol` key exists).
    const stored = await page.evaluate(() => {
      const raw = window.localStorage.getItem("persist:root");
      return raw ? JSON.parse(JSON.parse(raw).appSettings).currencySettings : null;
    });
    expect(stored).toEqual(INDIA_DEPLOYMENT.currencySettings);

    expectNoGatewayContacted(checkout);
  });

  test("a deployment that never saved a currency still shows ₹ (the SDK fallback)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, NO_CURRENCY_DEPLOYMENT);
    const checkout = await mockCheckoutBackend(page);
    await bootRegisteredToMenu(page);

    await addGreekSalad(page);

    await openBag(page);
    await expect(page.locator('[data-testid^="bag-row-"]').first()).toContainText("₹17.00");
    await expect(page.getByTestId("bag-total")).toContainText("₹20.00");
    await expect(page.getByTestId("bag-pay")).toContainText("₹20.00");

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("payment-total")).toContainText("₹20.00");

    expectNoGatewayContacted(checkout);
  });
});

/** The Saudi tenant's get_data deployment: "﷼" is U+FDFC RIAL SIGN — bidi class AL. */
const SAUDI_DEPLOYMENT = {
  _id: "dep1",
  mobile: "9999999999",
  currencySettings: { currency: "SAR", text: "﷼", uniDec: "65020", uniHex: "FDFC" },
  countryCode: { name: "Saudi Arabia", dial_code: "+966", code: "SA" },
};

/** slim-menu with calories on Greek Salad (254) and the Cheese Burger (740): a "price | Cal" line. */
function menuWithCalories() {
  const menu = fixtureJson("slim-menu.json");
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities) {
        if (entity.id === GREEK_SALAD) entity.calorieCount = 254;
        if (entity.id === CHEESE_BURGER) entity.calorieCount = 740;
      }
  return menu;
}

/** a's glyph paints left of b's (the RENDERED order, which only the BiDi algorithm decides). */
async function expectLeftOf(found: Promise<{ a: number; b: number }>, what: string) {
  const { a, b } = await found;
  expect(a < b, `${what}: ${a} < ${b}`).toBe(true);
}

/**
 * Walk 2026-10-14 (the Saudi tenant): U+FDFC is an Arabic letter to the BiDi
 * algorithm, so "﷼100 | 254 Cal" painted as "254 | 100﷼ Cal" (the calories
 * where the price belongs), and an OfferRow dir="auto" leaf starting with a
 * price resolved RTL: "off your order 200.00﷼". The DOM text was right — only
 * the rendered order shows it, so these read glyph positions. The symbol now
 * rides between LRMs (useCurrencySymbol): EN reads left to right; in AR every
 * price stays one LTR unit inside the Arabic copy.
 */
test.describe("Walk 2026-10-14 — a ﷼ price reads left to right", () => {
  const boot = async (page: Page) => {
    await mockKioskBackend(page, SAUDI_DEPLOYMENT, {
      menu: menuWithCalories(),
      offers: fixtureJson("offers.json"),
      arabic: true,
    });
    await bootRegisteredToMenu(page);
  };
  const cardLine = (page: Page) => page.getByTestId(`item-${GREEK_SALAD}`).locator("p").nth(1);
  /** Greek Salad (one tap, ﷼17) → the bag → the rewards sheet. */
  const toRewards = async (page: Page) => {
    const salad = page.getByTestId(`item-${GREEK_SALAD}`);
    await salad.scrollIntoViewIfNeeded();
    await salad.click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await openBag(page);
    await openRewardsSheet(page);
  };

  test("EN: the card and the PDP lead with the price, the rewards row's '﷼2.00 off your order' leaf is LTR", async ({
    page,
  }) => {
    test.slow();
    await boot(page);

    // The menu card: "﷼17 | 254 Cal", price before calories.
    const line = cardLine(page);
    await expect(line).toContainText("17 | 254 Cal");
    await expectLeftOf(glyphX(line, "﷼", "17"), "card: the symbol leads its price");
    await expectLeftOf(glyphX(line, "17", "254"), "card: the price precedes the calories");

    // The PDP price line: "﷼8.00 | 740 Cal".
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    const price = page.getByTestId("pdp-price");
    await expect(price).toContainText("8.00 | 740 Cal");
    await expectLeftOf(glyphX(price, "﷼", "8.00"), "PDP: the symbol leads its price");
    await expectLeftOf(glyphX(price, "8.00", "740"), "PDP: the price precedes the calories");
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });

    // The rewards row: the dir="auto" description leaf and the pink nudge.
    await toRewards(page);
    const desc = page.getByTestId("offer-row-desc-offer-flat-2");
    await expect(desc).toContainText("2.00 off your order");
    await expect(desc).toHaveCSS("direction", "ltr");
    await expectLeftOf(glyphX(desc, "﷼", "2.00"), "rewards row: the symbol leads its amount");
    await expectLeftOf(glyphX(desc, "2.00", "off"), "rewards row: the amount precedes 'off your order'");
    const nudge = page.getByTestId("offer-row-nudge-offer-percent-25");
    await expect(nudge).toHaveCSS("direction", "ltr");
    await expectLeftOf(glyphX(nudge, "Add", "﷼"), "nudge: 'Add' first");
    await expectLeftOf(glyphX(nudge, "﷼", "8.00"), "nudge: the symbol leads its amount");
  });

  test("AR: the price stays one LTR unit (﷼ before its digits) — on the card and inside the RTL rewards line", async ({
    page,
  }) => {
    test.slow();
    await boot(page);
    await chooseLanguage(page, "ar");

    const line = cardLine(page);
    await expect(line).toContainText("254");
    await expectLeftOf(glyphX(line, "﷼", "17"), "AR card: the symbol leads its price");
    await expectLeftOf(glyphX(line, "17", "254"), "AR card: the price precedes the calories (LTR layout)");

    await toRewards(page);
    const desc = page.getByTestId("offer-row-desc-offer-flat-2");
    // "خصم ﷼2.00 على طلبك": Arabic copy, so the leaf resolves RTL — the
    // first word reads first, at the right; the amount inside stays LTR.
    await expect(desc).toHaveCSS("direction", "rtl");
    await expectLeftOf(glyphX(desc, "﷼", "2.00"), "AR rewards row: the symbol leads its amount");
    await expectLeftOf(glyphX(desc, "2.00", "خصم"), "AR rewards row: 'خصم' reads first (right of the amount)");
  });
});
