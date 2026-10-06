import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * P7a — My Bag (cart) vertical: BagSheet over the Menu on /cart, remove-item
 * confirm, edit-from-bag (MIAM tier-1 edit session), repeat sheet, cancel
 * order (full session reset), Dexie crash recovery, the Complete-Your-Meal
 * rail (source 2, isCartRecommended engine) and the PAY preflight into the
 * /checkout stub. Same registered-device mocked-backend pattern as
 * pack.spec.ts — mockKioskBackend/bootRegisteredToMenu are copied from there
 * (that file does not export them; copy is the established precedent).
 *
 * Fixture facts (tests/e2e/fixtures/slim-menu.json, P7a edits applied):
 * - Cheese Burger (5dd10936712f5b622a66aab7, £8) carries 3 addon groups with
 *   no priced defaults; applyAddonsPrice=false, but top-level "_addons"
 *   selections still price in (SDK pricing.ts — only NESTED "_addons" maps
 *   are suppressed), so Extra Pickles (+£1) commits at £9.00.
 * - isCartRecommended=true on exactly 3 entities: Greek Salad
 *   (5dd1093829754a432f2c32e2, £17, NO modifiers → one-tap rail add),
 *   Cheese Burger and Large Fries (5dd10938eb1ccee31ca352fa, £9). The cart
 *   upsell gate is opt-OUT (enable_cart_upsell_screen absent → shown) and
 *   MIN_CART_UPSELL_ITEMS = 1.
 * - Greek Salad has no recommendedItems, so a plain add opens NO added
 *   modal (resolveAddItemPresentation) — direct cta assertions instead.
 * - get_data mock carries currencySettings.symbol "£" and empty deployment
 *   charges — but every fixture item carries VAT@15% (percentage), which the
 *   bill engine treats as EXCLUSIVE, and getNetAmount() rounds to 0 decimals
 *   (Math.round — no disable_roundoff/round_off_near_5 settings mocked). So
 *   Total = round(SubTotal * 1.15): £8 → £9, £16 → £18, £17 → £20,
 *   £25 → £29 — the bag's Sub Total and Total lines legitimately differ.
 * After page.reload() the SPA re-boots with the token cookie intact:
 * ProtectedRoute keeps the /menu URL (no registration bounce), the menu
 * redux is empty until a re-driven boot refetches it, and AppRoutes'
 * one-shot syncCartOnReLoad() rehydrates the cart from Dexie — but the
 * currency symbol is gone until get_data is refetched, so post-reload money
 * assertions match /d+\.dd/ without "£".
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
const EXTRA_PICKLES = "5dd1093f188e72ce1b3eb36e"; // +£1, group ..._1573980469_addons
const ADD_CHEESE = "5dd1093f188e72ce1b3eb36f"; // +£1, group ..._1686482941_addons

/**
 * Boot + menu mocks (copied from pack.spec.ts). Order matters: Playwright
 * matches routes newest-first, so the catch-all is registered FIRST and
 * every specific mock after it.
 */
async function mockKioskBackend(page: Page, { comboUpsell = false } = {}) {
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
        ...(comboUpsell ? { enable_combo_upsell: true } : {}),
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

/** Register on the on-screen keyboard and land on /menu (copied from pack.spec.ts). */
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
 * Menu card tap → modifiers intent → customization PDP → (optional addon
 * pick) → commit → dismiss the added modal (customized adds always confirm).
 */
async function addCheeseBurgerViaPdp(
  page: Page,
  { addonId, expectedCta }: { addonId?: string; expectedCta: string }
) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  if (addonId) {
    await page.getByTestId(`pdp-option-${addonId}`).click();
  }
  await expect(page.getByTestId("pdp-add-to-bag")).toContainText(expectedCta);
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("product-added-modal")).toBeVisible();
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).not.toBeVisible();
}

/**
 * Plain one-tap add: Greek Salad has no modifiers, no variants and no
 * recommendedItems → lands straight in the cart with no added modal.
 */
async function addGreekSaladOneTap(page: Page, expectedCount: string) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText(expectedCount);
}

/**
 * VIEW MY BAG → /cart renders the Menu page with the bag sheet open.
 *
 * P7d: the pre-cart upsell (/forYou) now sits on this edge — it is the only
 * forward menu→cart transition, and its gate is opt-OUT. It deliberately is
 * NOT switched off here: `enable_cart_upsell_screen: false` is read by
 * useCartUpsell's single `shouldShowUpsell`, which also gates the in-bag
 * Complete-Your-Meal rail that this file asserts visible at
 * :433 — so disabling it
 * would trade one broken assertion for another and stop this suite testing the
 * default configuration. The helper walks through the screen instead.
 *
 * markCartUpsellSeen() fires on the upsell's forward exits, so only the first
 * openBag() of a session meets it; later ones land on /cart directly. Settling
 * on whichever of the two arrived keeps that deterministic with no sleep.
 * Declining mutates no cart state, so every assertion downstream is unchanged
 * — and both original assertions below are kept verbatim. The gate's own
 * behaviour is owned by tests/e2e/forYou.spec.ts.
 */
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

/** Cart row ids (itemId) are runtime-generated — read them off the testid. */
async function firstBagRowItemId(page: Page): Promise<string> {
  const row = bagRows(page).first();
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  return (testId ?? "").replace("bag-row-", "");
}

test.describe("P7a My Bag (bag sheet on /cart)", () => {
  test("BAG BASICS: PDP add lands a £8.00 row; stepper doubles to £16.00 (cta-total agrees) and back", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await openBag(page);

    // MY BAG (1) + the single row.
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (1)");
    await expect(bagRows(page)).toHaveCount(1);
    const row = bagRows(page).first();
    await expect(row).toContainText("Cheese Burger");
    await expect(row).toContainText("£8.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    // Total = round(8 * 1.15) — exclusive VAT@15%, see header.
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");

    // P9f (user decision 2026-10-05): loyalty is off here, so LOG-IN & GET
    // REWARDS is not rendered and PAY takes the whole CTA row.
    await expect(page.getByTestId("bag-login-rewards")).toHaveCount(0);
    const payShortfall = await page.getByTestId("bag-pay").evaluate((pay) => {
      const row = pay.parentElement as HTMLElement;
      const style = getComputedStyle(row);
      const rowContent =
        row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return rowContent - (pay as HTMLElement).offsetWidth;
    });
    expect(Math.abs(payShortfall)).toBeLessThanOrEqual(1);

    // Increase: every money surface agrees (cta-total sits under the sheet —
    // toContainText reads the covered bar's text, which is the point; the
    // cta bar shows the SUBTOTAL, the bag total the taxed net).
    const itemId = await firstBagRowItemId(page);
    await page.getByTestId(`bag-inc-${itemId}`).click();
    await expect(page.getByTestId("bag-subtotal")).toContainText("£16.00");
    await expect(page.getByTestId("bag-total")).toContainText("£18.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£18.00");
    await expect(page.getByTestId("cta-total")).toContainText("£16.00");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (2)");

    // Decrease from qty 2 is a plain decrease — no confirm modal.
    await page.getByTestId(`bag-dec-${itemId}`).click();
    await expect(page.getByTestId("remove-item-modal")).toHaveCount(0);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("cta-total")).toContainText("£8.00");
  });

  test("REMOVE CONFIRM: decrease at qty 1 asks first; cancel keeps the row, confirm removes and the empty bag exits to /menu", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await openBag(page);
    const itemId = await firstBagRowItemId(page);

    // qty 1 decrease → REMOVE ITEM confirm, not a silent delete.
    await page.getByTestId(`bag-dec-${itemId}`).click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();

    // Cancel: modal gone, row untouched.
    await page.getByTestId("remove-item-cancel").click();
    await expect(page.getByTestId("remove-item-modal")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");

    // Confirm: row deleted → empty-cart auto-exit back to /menu.
    await page.getByTestId(`bag-dec-${itemId}`).click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();
    await page.getByTestId("remove-item-confirm").click();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toContainText("£0.00");
  });

  test("EDIT FROM BAG: PDP reopens seeded with the row's addon, UPDATE rewrites the same row (no duplicate) at the new total", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    // Commit customized: Extra Pickles +£1 → £9.00 (top-level "_addons"
    // selections price in even with applyAddonsPrice=false — see header).
    await addCheeseBurgerViaPdp(page, {
      addonId: EXTRA_PICKLES,
      expectedCta: "£9.00",
    });
    await openBag(page);

    const row = bagRows(page).first();
    await expect(row).toContainText("Extra Pickles");
    await expect(row).toContainText("+£1.00");
    // round(9 * 1.15) = £10 — exclusive VAT, see header.
    await expect(page.getByTestId("bag-total")).toContainText("£10.00");
    const itemId = await firstBagRowItemId(page);

    // Edit → PDP opens in edit mode: addon pre-selected, CTA reads UPDATE
    // at the row's committed price.
    await page.getByTestId(`bag-edit-${itemId}`).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("Update");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    await expect(page.getByTestId(`pdp-option-${EXTRA_PICKLES}`)).toHaveClass(
      /border-tb-purple/
    );

    // Change the selection: Add Cheese +£1 → £10.00, then UPDATE.
    await page.getByTestId(`pdp-option-${ADD_CHEESE}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£10.00");
    await page.getByTestId("pdp-add-to-bag").click();

    // direction:"cart" return path reopens the bag on /cart; the update
    // matched on itemId, so still exactly ONE row carrying both addon lines.
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    const updatedRow = bagRows(page).first();
    await expect(updatedRow).toContainText("Extra Pickles");
    await expect(updatedRow).toContainText("Add Cheese");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£10.00");
    // round(10 * 1.15) = round(11.5) = £12 (Math.round half-up).
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (1)");
  });

  test("REPEAT: tapping an in-cart item opens the repeat sheet; inc bumps the row, NEW CUSTOMIZATIONS opens a fresh PDP, backing out leaves the bag intact", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });

    // Second tap: repeat intent wins (item in cart, repeat-customization
    // setting defaults on) → the repeat sheet, not the PDP.
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("repeat-sheet")).toBeVisible();
    const repeatRow = page.locator('[data-testid^="repeat-row-"]').first();
    await expect(repeatRow).toBeVisible();
    await expect(repeatRow).toContainText("Cheese Burger");
    const repeatTestId = await repeatRow.getAttribute("data-testid");
    const itemId = (repeatTestId ?? "").replace("repeat-row-", "");

    // Stepper: qty 2 → £16.00 on the row AND in redux (cta bar under the
    // sheet agrees).
    await page.getByTestId(`repeat-inc-${itemId}`).click();
    await expect(repeatRow).toContainText("£16.00");
    await expect(page.getByTestId("cta-total")).toContainText("£16.00");

    // + NEW CUSTOMIZATIONS → fresh customization session (ADD, not UPDATE).
    await page.getByTestId("repeat-new-customizations").click();
    await expect(page.getByTestId("repeat-sheet")).toHaveCount(0);
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
    await expect(page.getByTestId("pdp-add-to-bag")).not.toContainText("Update");

    // Back out: nothing committed, the bumped bag is untouched (regression
    // anchor: same assertions pack.spec leans on).
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£16.00");
  });

  test("CANCEL ORDER: footer cancel confirms before tearing down; confirm resets to /start and Dexie stays empty across a reload", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£17.00");

    // Cancel path 1: dismiss keeps the order (no teardown without confirm).
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toHaveCount(0);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");

    // Cancel path 2: confirm → full session reset → attract screen.
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    // New session: menu comes back empty-carted.
    await page.getByTestId("start-screen").click();
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toContainText("£0.00");

    // Reload: the Dexie rehydrate must find NOTHING (clearIndexedDbCart ran
    // in the reset) — the bag stays empty. Post-reload the currency symbol
    // is gone until get_data refetches, so match the bare amount.
    await page.reload();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toContainText("0.00");
  });

  test("CRASH RECOVERY: a reload rehydrates the cart from Dexie — count/total restored on /menu and the bag renders the row", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£17.00");

    // Crash/reload. The token cookie persists, so ProtectedRoute keeps the
    // /menu URL (no registration bounce — this IS how the app re-boots);
    // the menu tree is gone from redux but AppRoutes' one-shot
    // syncCartOnReLoad() restores the cart, which is what must survive.
    await page.reload();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    // Currency symbol lives in redux (get_data) and is not refetched on this
    // path — assert the restored amount, not the "£".
    await expect(page.getByTestId("cta-total")).toContainText("17.00");

    // The bag renders the restored row.
    await openBag(page);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toContainText("Greek Salad");
    // round(17 * 1.15) = £20 — exclusive VAT survives the rehydrate too.
    await expect(page.getByTestId("bag-total")).toContainText("20.00");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (1)");
  });

  test("RAIL: Complete-Your-Meal shows the flagged items minus in-cart ones; a plain rail tap adds the row and updates every total", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await openBag(page);

    // Flagged trio minus the in-cart Cheese Burger = Greek Salad + Large
    // Fries (rail is lazy-loaded — toBeVisible waits the chunk in).
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await expect(page.getByTestId(`bag-rail-item-${GREEK_SALAD}`)).toBeVisible();
    await expect(page.getByTestId(`bag-rail-item-${LARGE_FRIES}`)).toBeVisible();
    await expect(page.getByTestId(`bag-rail-item-${CHEESE_BURGER}`)).toHaveCount(0);

    // Greek Salad is one-tap addable (no modifiers): the row appearing IS
    // the confirmation (added modal suppressed), totals move 8 → 25.
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).click();
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-sheet")).toContainText("Greek Salad");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    // round(25 * 1.15) = £29.
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (2)");
    // …and the freshly-carted salad drops out of the rail.
    await expect(page.getByTestId(`bag-rail-item-${GREEK_SALAD}`)).toHaveCount(0);
  });

  test("PAY: preflight lands on the resolved checkout screen; its back CTA returns to an intact bag", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await openBag(page);
    // PAY carries the taxed net: round(8 * 1.15) = £9 (see header).
    await expect(page.getByTestId("bag-pay")).toContainText("£9.00");

    // PAY → entry guards + menu/scheduler revalidation (mocked network) →
    // route decision → the real screen it resolved to. P8a replaced the
    // single /checkout stub with the four destinations; on THIS fixture
    // (no table tab, skip_crm_page off, loyalty off) resolveCheckoutRoute
    // returns "phone", which is /phone in checkout mode.
    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    await expect(page.getByTestId("phone-screen")).toBeVisible();

    // The screen's own back CTA (browser back is deliberately neutralised on
    // a kiosk) → /cart with the bag exactly as left. In checkout mode /phone
    // returns to the bag, not to /second.
    await page.getByTestId("phone-back").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toContainText("Cheese Burger");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });
});
