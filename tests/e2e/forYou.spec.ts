import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * P7d — /forYou, the pre-cart upsell.
 *
 * The screen hangs off the ONE forward Menu→Cart edge (Menu's `handleViewBag`
 * behind `cta-view-bag`). Every other `navigate("/cart")` in the app is a
 * BACKWARD return and is never upsold, so this suite only ever enters through
 * that one control.
 *
 * mockKioskBackend / bootRegisteredToMenu / addCheeseBurgerViaPdp /
 * addGreekSaladOneTap are copied from bag.spec.ts (which copied them from
 * pack.spec.ts — neither file exports them; the copy is the established
 * precedent in this suite).
 *
 * Fixture facts (tests/e2e/fixtures/slim-menu.json — verified, not assumed):
 * - isCartRecommended=true on exactly 3 entities, which is the whole /forYou
 *   grid: Greek Salad (£17, modifiers:[] → one-tap "add"), Large Fries (£9,
 *   ONE addon group → "modifiers" → /customization detour) and Cheese Burger
 *   (£8, three addon groups). All three carry calorieCount 0, which is falsy,
 *   so the card's price line is the bare "£17"/"£9"/"£8" with no "| n Cal".
 * - MIN_CART_UPSELL_ITEMS = 1 and the gate is opt-OUT
 *   (`enable_cart_upsell_screen !== false`), so the settings mock OMITS the
 *   flag for the five ON cases and sets it to boolean `false` for case 6.
 * - /forYou does NOT filter in-cart items out of the grid the way the bag rail
 *   does — an in-cart suggestion keeps its slot and gains a count pill.
 *
 * MONEY: the card price is the RAW menu price, symbol-free and UNTAXED. Every
 * fixture item carries exclusive VAT@15% and getNetAmount() rounds to 0dp, so
 * the bag shows £17→£20, £9→£10, £8→£9 (see bag.spec.ts's header). Each card
 * assertion therefore also asserts the ABSENCE of its own taxed figure — the
 * whole point is that a suggestion never quotes a bill total.
 *
 * COPY: `upsell.anythingElse` / `upsell.notToday` / `upsell.proceedToOrder`
 * were REPORTED by the screen build and have now been merged into en + ar by
 * the i18n gate, so the matchers below are pinned to the real English strings.
 * (They previously also accepted the bare key, which is what i18next renders
 * for a missing key — that tolerance is dropped deliberately: it would have
 * let a dropped locale key pass silently.) The button's STATE stays pinned
 * independently by its fill class, which no translation can move — that is
 * still the load-bearing assertion.
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

// ---- Fixture ids (see header) ----
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
const GREEK_SALAD = "5dd1093829754a432f2c32e2";
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa";

/** See the COPY note in the header — either spelling, exact match on both. */
const NOT_TODAY = /^Not Today$/;
const PROCEED_TO_ORDER = /^Proceed to Order$/;

/**
 * The primary button's two states, asserted on the fill rather than the label
 * so the flip is proven independently of i18n. The classes are disjoint:
 * declining is `border border-tb-purple bg-tb-surface text-tb-purple`,
 * proceeding is `bg-tb-purple text-tb-surface shadow-[…]`.
 */
const DECLINE_FILL = /border-tb-purple/;
const PROCEED_FILL = /bg-tb-purple/;

/**
 * Boot + menu mocks (copied from bag.spec.ts). Order matters: Playwright
 * matches routes newest-first, so the catch-all is registered FIRST and every
 * specific mock after it.
 *
 * `cartUpsellScreen` is deliberately tri-state. Leaving it undefined OMITS
 * `enable_cart_upsell_screen` entirely, which is what the real settings API
 * sends today and what the opt-out gate must treat as ON; passing `false`
 * writes the boolean, which is the only value that closes the gate.
 */
async function mockKioskBackend(
  page: Page,
  { cartUpsellScreen }: { cartUpsellScreen?: boolean } = {}
) {
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
        ...(cartUpsellScreen === undefined
          ? {}
          : { enable_cart_upsell_screen: cartUpsellScreen }),
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
 * Menu card tap → modifiers intent → customization PDP → commit → dismiss the
 * added modal (customized adds always confirm). Copied from bag.spec.ts.
 * Lands ONE unit in the cart, which is the baseline every case below starts on.
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
 * Plain one-tap add from the MENU: Greek Salad has no modifiers, no variants
 * and no recommendedItems → lands straight in the cart with no added modal.
 * Copied from bag.spec.ts.
 */
async function addGreekSaladOneTapFromMenu(page: Page, expectedCount: string) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText(expectedCount);
}

/** The ONE forward edge. Every case enters the upsell through this control. */
async function tapViewBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
}

const foryouCard = (page: Page, id: string) =>
  page.getByTestId(`foryou-card-${id}`);

/**
 * The in-cart count pill. It carries no testid of its own (the card is shared
 * with the bag rail, whose testid is the consumer's), so it is addressed by the
 * only filled-purple span on the card — the decorative ⊕ beside it is
 * `bg-tb-surface`, so the selector cannot collide.
 */
const quantityPill = (card: Locator) => card.locator("span.bg-tb-purple");

/** The screen is up, on its own route, with nothing from the Menu tree behind it. */
async function expectUpsellScreen(page: Page) {
  await expect(page.getByTestId("foryou-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/forYou$/);
}

const bagRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');

test.describe("P7d pre-cart upsell (/forYou)", () => {
  test("ENTRY: VIEW MY BAG opens the upsell — its own route, no bag sheet behind it, all three flagged items at RAW prices", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);

    await tapViewBag(page);
    await expectUpsellScreen(page);
    await expect(page.getByTestId("foryou-heading")).toBeVisible();

    // TRAP 2 — /cart is `<Menu bagOpen />`, so if this screen were a Menu skin
    // the bag sheet and the purple CTA bar would bleed through it. It is a
    // genuine standalone route and owns its own chrome.
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await expect(page.getByTestId("cta-view-bag")).toHaveCount(0);
    await expect(page.getByTestId("menu-screen")).toHaveCount(0);

    // The whole flagged trio — /forYou does NOT drop in-cart items the way the
    // bag rail does, so the already-carted Cheese Burger keeps its slot.
    const salad = foryouCard(page, GREEK_SALAD);
    const fries = foryouCard(page, LARGE_FRIES);
    const burger = foryouCard(page, CHEESE_BURGER);
    await expect(salad).toBeVisible();
    await expect(fries).toBeVisible();
    await expect(burger).toBeVisible();
    await expect(page.locator('[data-testid^="foryou-card-"]')).toHaveCount(3);

    // RAW menu prices, and NOT the bag's exclusive-VAT totals (17→20, 9→10,
    // 8→9). A suggestion must never quote a bill figure.
    await expect(salad).toContainText("Greek Salad");
    await expect(salad).toContainText("£17");
    await expect(salad).not.toContainText("£20");
    await expect(fries).toContainText("Large Fries");
    await expect(fries).toContainText("£9");
    await expect(fries).not.toContainText("£10");
    await expect(burger).toContainText("Cheese Burger");
    await expect(burger).toContainText("£8");
    await expect(burger).not.toContainText("£9");

    // In-cart Cheese Burger carries its count pill; the untouched two do not.
    await expect(quantityPill(burger)).toHaveText("1");
    await expect(quantityPill(salad)).toHaveCount(0);
    await expect(quantityPill(fries)).toHaveCount(0);

    // Nothing taken here yet → the single exit is still a plain decline, and
    // the quiet back link is the only other control.
    const primary = page.getByTestId("foryou-primary");
    await expect(primary).toHaveText(NOT_TODAY);
    await expect(primary).toHaveClass(DECLINE_FILL);
    await expect(page.getByTestId("foryou-back")).toBeVisible();
  });

  test("ONE-TAP ADD: Greek Salad lands in the bag without leaving the screen, the button flips to Proceed, and Proceed carries both rows into /cart", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await tapViewBag(page);
    await expectUpsellScreen(page);

    const salad = foryouCard(page, GREEK_SALAD);
    const primary = page.getByTestId("foryou-primary");
    await expect(quantityPill(salad)).toHaveCount(0);
    await expect(primary).toHaveText(NOT_TODAY);
    await expect(primary).toHaveClass(DECLINE_FILL);

    // Greek Salad has no modifiers → intent "add" → straight into the cart
    // with the added modal suppressed. The pill IS the confirmation, and the
    // customer never leaves the grid.
    await salad.click();
    await expect(quantityPill(salad)).toHaveText("1");
    await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
    await expect(page).toHaveURL(/\/forYou$/);

    // addedHere = cartQuantity(2) − entryQuantity(1) = 1 → both the label AND
    // the fill become the way forward.
    await expect(primary).toHaveText(PROCEED_TO_ORDER);
    await expect(primary).toHaveClass(PROCEED_FILL);

    await primary.click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-sheet")).toContainText("Cheese Burger");
    await expect(page.getByTestId("bag-sheet")).toContainText("Greek Salad");
    // 8 + 17 = £25 subtotal; round(25 * 1.15) = £29 taxed (bag.spec header).
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");
  });

  test("NOT TODAY: declining goes to /cart and marks the session seen — the next VIEW MY BAG skips the upsell entirely", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await tapViewBag(page);
    await expectUpsellScreen(page);

    // Decline with nothing taken here.
    const primary = page.getByTestId("foryou-primary");
    await expect(primary).toHaveText(NOT_TODAY);
    await primary.click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("foryou-screen")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(1);

    // Back out of the bag and keep ordering.
    await page.getByTestId("bag-close").click();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await addGreekSaladOneTapFromMenu(page, "(2)");

    // A FORWARD exit marked the screen seen, so the gate's third factor is now
    // false: the same control goes straight to the cart, upsell skipped.
    await tapViewBag(page);
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("foryou-screen")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(2);
  });

  test("BACK TO MENU is not a dismissal: the upsell is offered again on the next trip to the bag", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await tapViewBag(page);
    await expectUpsellScreen(page);

    // Going back to browse is not declining the offer — this exit deliberately
    // does NOT mark the screen seen.
    await page.getByTestId("foryou-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("foryou-screen")).toHaveCount(0);

    // Same forward edge, same session → the offer comes back.
    await tapViewBag(page);
    await expectUpsellScreen(page);
    await expect(page.locator('[data-testid^="foryou-card-"]')).toHaveCount(3);

    // …and the baseline was not disturbed by the round trip: nothing was taken
    // here, so the exit is still a plain decline.
    const primary = page.getByTestId("foryou-primary");
    await expect(primary).toHaveText(NOT_TODAY);
    await expect(primary).toHaveClass(DECLINE_FILL);
  });

  test("DETOUR: a modifiers card opens /customization, the commit returns HERE (returnPath), and the visit baseline survives the unmount", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await tapViewBag(page);
    await expectUpsellScreen(page);
    await expect(page.getByTestId("foryou-primary")).toHaveText(NOT_TODAY);

    // Large Fries carries one addon group → intent "modifiers" → the PDP.
    // This UNMOUNTS /forYou, which is exactly why the baseline lives in redux.
    await foryouCard(page, LARGE_FRIES).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/customization$/);
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    await page.getByTestId("pdp-add-to-bag").click();

    // returnPath:"/forYou" wins over the legacy direction flag, so the commit
    // comes back HERE — not forward to a cart the customer never asked for,
    // and not back to /menu (the default when no return state is carried).
    await expectUpsellScreen(page);
    await expect(quantityPill(foryouCard(page, LARGE_FRIES))).toHaveText("1");

    // THE REGRESSION CORE: the screen was torn down and rebuilt with the item
    // already in the cart. entryQuantity(1) survived in redux and was NOT
    // re-seeded on the way back, so addedHere = 2 − 1 = 1 and the button reads
    // Proceed. A useState/useRef baseline would re-seed from the post-add cart
    // and this would still say "Not Today".
    const primary = page.getByTestId("foryou-primary");
    await expect(primary).toHaveText(PROCEED_TO_ORDER);
    await expect(primary).toHaveClass(PROCEED_FILL);

    await primary.click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-sheet")).toContainText("Large Fries");
    // 8 + 9 = £17 subtotal; round(17 * 1.15) = £20 taxed.
    await expect(page.getByTestId("bag-subtotal")).toContainText("£17.00");
    await expect(page.getByTestId("bag-total")).toContainText("£20.00");
  });

  test("GATE OFF: enable_cart_upsell_screen:false sends VIEW MY BAG straight to /cart, and a hand-typed /forYou bounces there too", async ({
    page,
  }) => {
    test.slow();
    // The ONLY value that closes an opt-out gate is the boolean false.
    await mockKioskBackend(page, { cartUpsellScreen: false });
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);

    await tapViewBag(page);
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("foryou-screen")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(1);

    // Hand-typed URL. Pushed through the History API rather than page.goto()
    // on purpose: a real navigation would reload the SPA, and the cart would
    // then be empty at mount (the Dexie rehydrate is async), so the EMPTY-CART
    // guard would fire and mask the gate guard under test. This keeps the live
    // store intact and exercises the guard that actually matters — a customer
    // with a full cart reaching the screen while the gate is shut.
    await page.evaluate(() => {
      window.history.pushState({}, "", "/forYou");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/cart$/, { timeout: 10_000 });
    await expect(page.getByTestId("foryou-screen")).toHaveCount(0);
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await expect(bagRows(page)).toHaveCount(1);
  });
});
