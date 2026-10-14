import { test, expect, type Page, type Route, dexieRows, freezeClock } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  locale,
  SKIP_CRM,
  CHEESE_BURGER,
  GREEK_SALAD,
  LARGE_FRIES,
  EXTRA_PICKLES,
} from "./fixtures/backend";
import { mockCheckoutBackend } from "./fixtures/checkout";
import { bootRegisteredToMenu, startToSecond } from "./pages/boot";
import { addOneTap, addViaPdp, openBag, bagRows } from "./pages/order";

/**
 * P7a — My Bag (cart) vertical: BagSheet over the Menu on /cart, remove-item
 * confirm, edit-from-bag (MIAM tier-1 edit session), repeat sheet, cancel
 * order (full session reset), Dexie crash recovery, the Complete-Your-Meal
 * rail (source 2, isCartRecommended engine) and the PAY preflight into the
 * /checkout stub. Same registered-device mocked-backend pattern as
 * pack.spec.ts, on the P9f harness: the shared mock (fixtures/backend.ts)
 * and the shared boot / bag steps (pages/boot.ts, pages/order.ts);
 * mockKioskBackend, addCheeseBurgerViaPdp, addGreekSaladOneTap and
 * dexieCartQuantities keep their names as thin adapters over them.
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
 * - Greek Salad has no recommendedItems: a plain menu add confirms with the
 *   added modal's title, Total and GOT IT (user 2026-10-14), which addOneTap
 *   closes before its cta assertion.
 * - get_data mock carries currencySettings {currency: "GBP", text: "£"} and
 *   empty deployment charges — but every fixture item carries VAT@15% (percentage), which the
 *   bill engine treats as EXCLUSIVE, and getNetAmount() rounds to 0 decimals
 *   (Math.round — no disable_roundoff/round_off_near_5 settings mocked). So
 *   Total = round(SubTotal * 1.15): £8 → £9, £16 → £18, £17 → £20,
 *   £25 → £29 — the bag's Sub Total and Total lines legitimately differ;
 *   since audit-fixes U4 the bag shows why: "Taxes & charges" (+£1.20 on
 *   £8) and "Round off" (−£0.20), so the column adds up to the Total.
 * After page.reload() the SPA re-boots with the token cookie intact:
 * ProtectedRoute keeps the /menu URL (no registration bounce), the menu
 * redux is empty until a re-driven boot refetches it, and AppRoutes'
 * one-shot syncCartOnReLoad() rehydrates the cart from Dexie. The currency
 * survives too: currencySettings is persisted (store.ts, the appSettings
 * whitelist) and a reload never refetches get_data (only /second and the
 * order-type switch call it), so post-reload money keeps its "£" — ₹ there
 * would be the UB1 fallback, i.e. a lost currency.
 */

const slimMenu = fixtureJson("slim-menu.json");
const en = locale("en");
/** The bag-pdp lane's copy (rendered only by lazy chunks — src/i18n/lazyCopy.ts). */
const enLazy = locale("en", "lazy");

// ---- Fixture ids (see header; CHEESE_BURGER, GREEK_SALAD, LARGE_FRIES, EXTRA_PICKLES: fixtures/backend.ts) ----
const ADD_CHEESE = "5dd1093f188e72ce1b3eb36f"; // +£1, group ..._1686482941_addons
/** Kiddie Meal Beef Burger, re-shaped by sizedMenu() into a sized item. */
const SIZED_ITEM = "5dd1093a188e72ce1b3eb358";
const SIZE_REGULAR = "e2e-size-regular"; // £5
const SIZE_LARGE = "e2e-size-large"; // £7: neither the parent's price nor the other size's

/** The Cheese Burger's Extra Pickles addon group (its +£1 EXTRA_PICKLES). */
const PICKLES_GROUP = `${CHEESE_BURGER}_1573980469_addons`;

/**
 * The slim menu with SIZED_ITEM given two active sizes and no modifier
 * groups, so its quick-add "+" opens Select a Size (the fast lane that
 * builds its own VARIANT row — the PDP path is covered above).
 * `largeGroups` (figma-polish S1): SIZE_LARGE carries the Extra Pickles
 * group, so CONTINUE on Large opens the PDP on that size instead;
 * `requiredGroup` makes that group required (min 1).
 */
function sizedMenu({ largeGroups = false, requiredGroup = false } = {}) {
  const menu = JSON.parse(JSON.stringify(slimMenu));
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities)
        if (entity.id === SIZED_ITEM) {
          entity.hasVariant = true;
          entity.modifiers = [];
          entity.variants = [
            [SIZE_REGULAR, "Regular", 5],
            [SIZE_LARGE, "Large", 7],
          ].map(([id, name, price]) => ({
            id,
            name,
            price,
            isActive: true,
            subCategoryId: sub.id,
            ...(largeGroups && id === SIZE_LARGE ? { modifiers: [PICKLES_GROUP] } : {}),
          }));
        }
  if (requiredGroup)
    for (const group of menu.modifiers) if (group._id === PICKLES_GROUP) group.min = 1;
  return menu;
}

/**
 * The shared mock (fixtures/backend.ts) with this spec's switches: the MIAM
 * gate, the sized menu (`sizeGroups`: Large carries Extra Pickles;
 * "required" makes that group min 1) and the pay-at-counter fan-out.
 */
const mockKioskBackend = (
  page: Page,
  {
    comboUpsell = false,
    sized = false,
    sizeGroups = false,
    skipCRM = false,
  }: {
    comboUpsell?: boolean;
    sized?: boolean;
    sizeGroups?: boolean | "required";
    /** PAY → /payment (checkout.spec's pay-at-counter walk) instead of /phone. */
    skipCRM?: boolean;
  } = {}
) =>
  mockBackend(page, {
    settings: { ...(comboUpsell ? { enable_combo_upsell: true } : {}), ...(skipCRM ? SKIP_CRM : {}) },
    menu: sized
      ? sizedMenu({ largeGroups: sizeGroups !== false, requiredGroup: sizeGroups === "required" })
      : undefined,
  });

/**
 * Menu card tap → modifiers intent → customization PDP → (optional addon
 * pick) → commit → dismiss the added modal (customized adds always confirm).
 */
const addCheeseBurgerViaPdp = (
  page: Page,
  { addonId, expectedCta }: { addonId?: string; expectedCta: string }
) => addViaPdp(page, CHEESE_BURGER, { addonId, expectedCta });

/**
 * Plain one-tap add: Greek Salad has no modifiers, no variants and no
 * recommendedItems → lands straight in the cart; the added modal confirms it
 * (user 2026-10-14) and addOneTap closes it.
 */
const addGreekSaladOneTap = (page: Page, expectedCount: string) =>
  addOneTap(page, GREEK_SALAD, expectedCount);

/** Cart row ids (itemId) are runtime-generated — read them off the testid. */
async function firstBagRowItemId(page: Page): Promise<string> {
  const row = bagRows(page).first();
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  return (testId ?? "").replace("bag-row-", "");
}

/**
 * bag-pdp item 20: Cheese Burger + Extra Pickles (£9) bumped to ×3 in the
 * bag (Sub £27.00), then Edit → the "edit how many" numpad (Figma 1:4460).
 */
async function openEditHowManyOnBurgerTimesThree(page: Page): Promise<string> {
  await addCheeseBurgerViaPdp(page, { addonId: EXTRA_PICKLES, expectedCta: "£9.00" });
  await openBag(page);
  const itemId = await firstBagRowItemId(page);
  await page.getByTestId(`bag-inc-${itemId}`).click();
  await page.getByTestId(`bag-inc-${itemId}`).click();
  await expect(page.getByTestId("bag-subtotal")).toContainText("£27.00");
  await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (3)");
  await page.getByTestId(`bag-edit-${itemId}`).click();
  await expect(page.getByTestId("edit-how-many")).toBeVisible();
  return itemId;
}

/** The Dexie cart mirror's row quantities (KioskDB.cartItems) — what a reload restores. */
const dexieCartQuantities = async (page: Page): Promise<number[]> =>
  (await dexieRows(page)).map((row) => Number(row.quantity)).sort((a, b) => a - b);

test.describe("P7a My Bag (bag sheet on /cart)", () => {
  test("BAG BASICS: PDP add lands a £8.00 row; stepper doubles to £16.00 (the cta TOTAL is the bag's) and back", async ({
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
    // U1: the Cheese Burger is tagged "veg" — its row leads with the mark.
    await expect(row.getByTestId("veg-mark-veg")).toBeVisible();
    await expect(row.getByTestId("veg-mark-non-veg")).toHaveCount(0);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    // Total = round(8 * 1.15) — exclusive VAT@15%, see header; U4 shows the
    // tax and what the rounding took: 8.00 + 1.20 − 0.20 = 9.00.
    await expect(page.getByTestId("bag-taxes-charges")).toHaveText("+£1.20");
    await expect(page.getByTestId("bag-round-off")).toHaveText("−£0.20");
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
    // toHaveText reads the covered bar's text, which is the point). The cta
    // bar shows the bag's own Total (user decision 2026-10-14; it was the
    // subtotal), as posistKiosk's menu footer prints it: whole, "£18".
    const itemId = await firstBagRowItemId(page);
    await page.getByTestId(`bag-inc-${itemId}`).click();
    await expect(page.getByTestId("bag-subtotal")).toContainText("£16.00");
    await expect(page.getByTestId("bag-taxes-charges")).toHaveText("+£2.40");
    await expect(page.getByTestId("bag-round-off")).toHaveText("−£0.40");
    await expect(page.getByTestId("bag-total")).toContainText("£18.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£18.00");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £18$/);
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (2)");

    // ×5: £40 × 1.15 is a whole £46 — nothing to round, so the Round off
    // line is not drawn (U4 hides each extra line at zero); then back to ×2.
    for (let tap = 0; tap < 3; tap++) await page.getByTestId(`bag-inc-${itemId}`).click();
    await expect(page.getByTestId("bag-subtotal")).toContainText("£40.00");
    await expect(page.getByTestId("bag-taxes-charges")).toHaveText("+£6.00");
    await expect(page.getByTestId("bag-total")).toContainText("£46.00");
    await expect(page.getByTestId("bag-round-off")).toHaveCount(0);
    for (let tap = 0; tap < 3; tap++) await page.getByTestId(`bag-dec-${itemId}`).click();
    await expect(page.getByTestId("bag-subtotal")).toContainText("£16.00");
    await expect(page.getByTestId("bag-round-off")).toHaveText("−£0.40");

    // Decrease from qty 2 is a plain decrease — no confirm modal.
    await page.getByTestId(`bag-dec-${itemId}`).click();
    await expect(page.getByTestId("remove-item-modal")).toHaveCount(0);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £9$/);
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

    // qty 1 decrease → REMOVE ITEM confirm, not a silent delete. Focus on
    // NO, BACK TO CART: a keypad Enter keeps the row (walk 2026-10-14).
    await page.getByTestId(`bag-dec-${itemId}`).click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();
    await expect(page.getByTestId("remove-item-cancel")).toBeFocused();

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
    await expect(page.getByTestId("cta-total")).toHaveText(/: £0$/);
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
    // at the row's committed price. A qty-1 row edits straight away — the
    // bag-pdp "edit how many" numpad is for multi-unit rows only.
    await page.getByTestId(`bag-edit-${itemId}`).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("edit-how-many")).toHaveCount(0);
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("Update");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    // Item 42: the option card is ONE button; its radio state is aria-pressed.
    await expect(page.getByTestId(`pdp-option-${EXTRA_PICKLES}`)).toHaveAttribute(
      "aria-pressed",
      "true"
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
    // round(10 * 1.15) = round(11.5) = £12 (Math.round half-up): U4 shows
    // 10.00 + 1.50 + 0.50 = 12.00.
    await expect(page.getByTestId("bag-taxes-charges")).toHaveText("+£1.50");
    await expect(page.getByTestId("bag-round-off")).toHaveText("+£0.50");
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (1)");
  });

  test("SPLIT EDIT: Edit on a ×3 row asks how many first (EDIT inert at 0, keys past 3 disabled, dimmed and inert); editing 2 adds Add Cheese to a new ×2 row beside the ×1 — £29.00 — and a reload keeps both rows", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    const itemId = await openEditHowManyOnBurgerTimesThree(page);

    // Figma 1:4460: a dialog named for the row, described by the prompt.
    const modal = page.getByRole("dialog", {
      name: enLazy.bag.editHowMany.title
        .replace("{{qty}}", "3")
        .replace("{{name}}", "Cheese Burger"),
    });
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAccessibleDescription(enLazy.bag.editHowMany.body);
    const value = page.getByTestId("edit-how-many-value");
    const editCta = page.getByTestId("edit-how-many-confirm");
    await expect(value).toHaveText("0");
    await expect(editCta).toHaveAttribute("aria-disabled", "true");
    // EDIT at 0 does nothing (forced past Playwright's aria-disabled refusal).
    await editCta.click({ force: true });
    await expect(page.getByTestId("customization-screen")).toHaveCount(0);
    await expect(modal).toBeVisible();

    // A key past N is disabled and dimmed (walk 2026-10-14) — and inert,
    // forced past Playwright's aria-disabled refusal. N = 3 has one digit,
    // so once a digit is in, every digit is.
    const key = (digit: string) => page.getByTestId(`numpad-key-${digit}`);
    for (const digit of ["4", "9"]) {
      await expect(key(digit)).toBeDisabled();
      await expect(key(digit)).toHaveCSS("opacity", "0.4");
    }
    for (const digit of ["0", "1", "2", "3"]) {
      await expect(key(digit)).toBeEnabled();
      await expect(key(digit)).toHaveCSS("opacity", "1");
    }
    await key("4").click({ force: true });
    await expect(value).toHaveText("0");
    await key("2").click();
    await expect(value).toHaveText("2");
    await expect(key("1")).toBeDisabled();
    await key("1").click({ force: true });
    await expect(value).toHaveText("2");
    await expect(editCta).toHaveAttribute("aria-disabled", "false");
    await test.info().attach("edit-how-many", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await editCta.click();

    // The PDP edits 2 units: seeded with the row's pickles, CTA UPDATE at 2 × £9.
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("edit-how-many")).toHaveCount(0);
    await expect(page.getByTestId("pdp-qty")).toHaveText("2");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("Update");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£18.00");
    // Item 42: the option card is ONE button; its radio state is aria-pressed.
    await expect(page.getByTestId(`pdp-option-${EXTRA_PICKLES}`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.getByTestId(`pdp-option-${ADD_CHEESE}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£20.00");
    await page.getByTestId("pdp-add-to-bag").click();

    // Back in the bag: the source row keeps 1 unit as it was, the 2 edited
    // units are a new row right after it. Sub = 1 × 9 + 2 × 10.
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(2);
    const kept = bagRows(page).nth(0);
    const edited = bagRows(page).nth(1);
    await expect(kept).toHaveAttribute("data-testid", `bag-row-${itemId}`);
    await expect(kept).toContainText("Extra Pickles");
    await expect(kept).not.toContainText("Add Cheese");
    await expect(kept).toContainText("£9.00");
    await expect(edited).toContainText("Extra Pickles");
    await expect(edited).toContainText("Add Cheese");
    await expect(edited).toContainText("£20.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£29.00");
    // round(29 × 1.15 = 33.35) = £33: U4 shows 29.00 + 4.35 − 0.35 = 33.00.
    await expect(page.getByTestId("bag-taxes-charges")).toHaveText("+£4.35");
    await expect(page.getByTestId("bag-round-off")).toHaveText("−£0.35");
    await expect(page.getByTestId("bag-total")).toContainText("£33.00");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (3)");

    // Crash-reload: both rows come back from Dexie, in the persisted "£" (header).
    await expect.poll(() => dexieCartQuantities(page)).toEqual([1, 2]);
    await page.reload();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(bagRows(page)).toHaveCount(2);
    await expect(bagRows(page).nth(0)).not.toContainText("Add Cheese");
    await expect(bagRows(page).nth(0)).toContainText("£9.00");
    await expect(bagRows(page).nth(1)).toContainText("Add Cheese");
    await expect(bagRows(page).nth(1)).toContainText("£20.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£29.00");
  });

  test("SPLIT EDIT, BACK: leaving the split PDP with BACK writes nothing — the single ×3 row stays; X on the numpad cancels too", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    const itemId = await openEditHowManyOnBurgerTimesThree(page);

    // X cancels the numpad: still the bag, nothing opened.
    await page.getByTestId("edit-how-many-close").click();
    await expect(page.getByTestId("edit-how-many")).toHaveCount(0);
    await expect(page.getByTestId("customization-screen")).toHaveCount(0);

    await page.getByTestId(`bag-edit-${itemId}`).click();
    // The − / + pill (Figma 1:4460) is clamped to 0…N: three taps on + reach
    // 3, where + is disabled and dimmed (walk 2026-10-14) — a forced fourth
    // tap stays at 3.
    const value = page.getByTestId("edit-how-many-value");
    const plus = page.getByTestId("edit-how-many-increase");
    for (let tap = 0; tap < 3; tap++) {
      await plus.click();
    }
    await expect(value).toHaveText("3");
    await expect(plus).toBeDisabled();
    await expect(plus).toHaveCSS("opacity", "0.4");
    await plus.click({ force: true });
    await expect(value).toHaveText("3");
    await page.getByTestId("edit-how-many-decrease").click();
    await expect(value).toHaveText("2");
    await page.getByTestId("edit-how-many-confirm").click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-qty")).toHaveText("2");
    await page.getByTestId(`pdp-option-${ADD_CHEESE}`).click();
    await page.getByTestId("pdp-back").click();

    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toHaveAttribute("data-testid", `bag-row-${itemId}`);
    await expect(bagRows(page).first()).toContainText("Extra Pickles");
    await expect(bagRows(page).first()).not.toContainText("Add Cheese");
    await expect(bagRows(page).first()).toContainText("£27.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£27.00");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (3)");
    await expect.poll(() => dexieCartQuantities(page)).toEqual([3]);
  });

  test("SPLIT EDIT, MERGE: editing 2 of 3 without changing the recipe but raising the PDP quantity to 3 merges back into one ×4 row — £36.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    const itemId = await openEditHowManyOnBurgerTimesThree(page);

    await page.getByTestId("numpad-key-2").click();
    await page.getByTestId("edit-how-many-confirm").click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-qty")).toHaveText("2");
    await page.getByTestId("pdp-qty-increase").click();
    await expect(page.getByTestId("pdp-qty")).toHaveText("3");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("Update");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£27.00");
    await page.getByTestId("pdp-add-to-bag").click();

    // Same recipe → no second row: the source holds N − k + q = 3 − 2 + 3.
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toHaveAttribute("data-testid", `bag-row-${itemId}`);
    await expect(bagRows(page).first()).toContainText("Extra Pickles");
    await expect(bagRows(page).first()).toContainText("£36.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£36.00");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (4)");
    await expect.poll(() => dexieCartQuantities(page)).toEqual([4]);
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

    // Stepper: qty 2 → £16 on the row (posistKiosk's RepeatItem format) AND
    // in redux (the cta bar under the sheet shows the bag's Total: £18.40,
    // rounded).
    await page.getByTestId(`repeat-inc-${itemId}`).click();
    await expect(repeatRow.getByText("£16", { exact: true })).toBeVisible();
    await expect(page.getByTestId("cta-total")).toHaveText(/: £18$/);

    // + NEW CUSTOMIZATIONS → fresh customization session (ADD, not UPDATE).
    await page.getByTestId("repeat-new-customizations").click();
    await expect(page.getByTestId("repeat-sheet")).toHaveCount(0);
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
    await expect(page.getByTestId("pdp-add-to-bag")).not.toContainText("Update");

    // Back out: nothing committed, the bumped bag is untouched (regression
    // anchor: same assertions pack.spec leans on) — the one burger row ×2:
    // the CTA counts units, as MY BAG (n) does (walk 2026-10-14).
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(2)");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £18$/);
  });

  test("CANCEL ORDER: footer cancel confirms before tearing down; confirm resets to /start and Dexie stays empty across a reload", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    // The bag's Total, round(17 * 1.15) = £20 (user decision 2026-10-14).
    await expect(page.getByTestId("cta-total")).toHaveText(/: £20$/);

    // Cancel path 1: dismiss keeps the order (no teardown without confirm).
    // Focus moves in on NO, BACK TO MENU (walk 2026-10-14).
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await expect(page.getByTestId("cancel-order-cancel")).toBeFocused();
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
    await expect(page.getByTestId("cta-total")).toHaveText(/: £0$/);

    // Reload: the Dexie rehydrate must find NOTHING (clearIndexedDbCart ran
    // in the reset) — the bag stays empty; the persisted "£" stays (header).
    await page.reload();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £0$/);
  });

  test("CRASH RECOVERY: a reload rehydrates the cart from Dexie — count/total restored on /menu and the bag renders the row", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    // The bag's Total, round(17 * 1.15) = £20, before the bag ever opened.
    await expect(page.getByTestId("cta-total")).toHaveText(/: £20$/);

    // Crash/reload. The token cookie persists, so ProtectedRoute keeps the
    // /menu URL (no registration bounce — this IS how the app re-boots);
    // the menu tree is gone from redux but AppRoutes' one-shot
    // syncCartOnReLoad() restores the cart, which is what must survive.
    await page.reload();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    // The currency survives with the cart: currencySettings is persisted and
    // this path never refetches get_data (header) — ₹ here = a lost currency.
    await expect(page.getByTestId("cta-total")).toHaveText(/: £20$/);

    // The bag renders the restored row.
    await openBag(page);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toContainText("Greek Salad");
    // round(17 * 1.15) = £20 — exclusive VAT survives the rehydrate too.
    await expect(page.getByTestId("bag-total")).toContainText("£20.00");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (1)");
  });

  test("NO /forYou (dropped 2026-10-11): VIEW MY BAG opens the bag directly; a stale /forYou URL lands on the bag (or /menu when it is empty), a full load of it too", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    /** The router follows a script pop (AppRoutes' Back trap passes untrusted pops). */
    const pushPath = (path: string) =>
      page.evaluate((to) => {
        window.history.pushState({}, "", to);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, path);

    // Empty bag: /forYou → /cart → the empty bag closes itself to /menu.
    await pushPath("/forYou");
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);

    // The flagged trio is on the default mock: the old gate would open here.
    await addGreekSaladOneTap(page, "(1)");
    await page.getByTestId("cta-view-bag").click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await expect(page.getByTestId("bag-rail")).toBeVisible();

    const entries = await page.evaluate(() => window.history.length);
    await pushPath("/forYou");
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await expect(bagRows(page)).toHaveCount(1);
    // The redirect REPLACES /forYou: only the pop's own entry was added.
    expect(await page.evaluate(() => window.history.length)).toBe(entries + 1);

    // A chunk-error reload of the current URL (chunkRecovery) — a full load.
    await expect.poll(() => dexieCartQuantities(page)).toEqual([1]);
    await page.goto("/forYou");
    await expect(page).toHaveURL(/\/cart$/, { timeout: 15_000 });
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(bagRows(page)).toHaveCount(1);
  });

  test("DOUBLE TAP on VIEW MY BAG where it overlaps PAY: the bag opens and the CTA bar's guard swallows the second tap — checkout never starts", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install(); // frozen below, so the 0.5 s guard never races a loaded machine
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    const viewBag = await page.getByTestId("cta-view-bag").boundingBox();
    await page.getByTestId("cta-view-bag").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    const pay = await page.getByTestId("bag-pay").boundingBox();
    await page.getByTestId("bag-close").click();
    await expect(page).toHaveURL(/\/menu$/);
    // The URL moves before the close commits (a navigation is a transition):
    // wait for the commit, so the first open's guard timer is gone before
    // the freeze (pauseAt's jump would fire it into the next open).
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    if (!viewBag || !pay) throw new Error("VIEW MY BAG / PAY are not laid out");
    // VIEW MY BAG's lower edge lies over PAY's top (a 4–5 px band).
    const left = Math.max(viewBag.x, pay.x);
    const right = Math.min(viewBag.x + viewBag.width, pay.x + pay.width);
    const top = Math.max(viewBag.y, pay.y);
    const bottom = Math.min(viewBag.y + viewBag.height, pay.y + pay.height);
    expect(right - left).toBeGreaterThan(0);
    expect(bottom - top).toBeGreaterThan(0);
    const point = { x: (left + right) / 2, y: (top + bottom) / 2 };

    await freezeClock(page);
    await page.mouse.click(point.x, point.y);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid"),
        point
      )
    ).toBe("bag-cta-tap-guard");
    await page.mouse.click(point.x, point.y);
    await page.clock.resume();
    await expect(page.getByTestId("bag-cta-tap-guard")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
  });

  test("RAIL: Complete-Your-Meal shows the flagged items minus in-cart ones; a plain rail tap adds the row and updates every total — no product-added modal, under the bag or on the menu after it", async ({
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
    // UB1: the rail cards price in the deployment's symbol (raw menu prices).
    await expect(page.getByTestId(`bag-rail-item-${GREEK_SALAD}`)).toContainText("£17");
    await expect(page.getByTestId(`bag-rail-item-${LARGE_FRIES}`)).toContainText("£9");

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
    // Every MENU add opens the product-added modal (user 2026-10-14); this one
    // is the bag's: none opened under the bag, so none greets the menu after.
    await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
    await page.getByTestId("bag-close").click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
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

  test("PAY FAILURE IS VISIBLE (G1): a preflight that fails raises the global error over the bag (bag.checkoutFailed, GOT IT on top); GOT IT leaves the bag open with PAY live, and the next PAY proceeds", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await openBag(page);

    // The preflight's server-time read fails (it was silent before G1).
    const serverTimeDown = (route: Route) => route.fulfill({ status: 500, json: {} });
    await page.route("**/api/tenants/getServerTime", serverTimeDown);
    await page.getByTestId("bag-pay").click();
    const dialog = page.getByRole("alertdialog", { name: en.bag.checkoutFailed });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-testid", "global-error");
    const ok = page.getByTestId("global-error-ok");
    await expect(ok).toHaveText(en.offers.gotIt);
    // GOT IT is the top-most element at its centre: nothing paints over it.
    expect(
      await ok.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })
    ).toBe(true);
    await expect(page).toHaveURL(/\/cart$/);

    await ok.click();
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-pay")).toBeEnabled();
    await expect(page.getByTestId("bag-pay")).toContainText("£9.00");

    // The server is back: the same PAY proceeds to the checkout route.
    await page.unroute("**/api/tenants/getServerTime", serverTimeDown);
    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    await expect(page.getByTestId("phone-screen")).toBeVisible();
    await expect(page.getByTestId("global-error")).toHaveCount(0);
  });

  test("SIZE FAST LANE: quick-add → Select a Size → CONTINUE bills the chosen size — the added modal's total agrees with the bar and the bag pays it with VAT, never £NaN", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { sized: true });
    await bootRegisteredToMenu(page);
    const quickAdd = page.getByTestId(`quick-add-${SIZED_ITEM}`);
    await quickAdd.scrollIntoViewIfNeeded();
    await quickAdd.click();
    // UB1: the size tiles price in the deployment's symbol — the cheapest
    // whole, a bigger size as its step up; posistKiosk's format, "£5" / "+£2".
    await expect(page.getByTestId(`size-${SIZE_REGULAR}`)).toContainText(/£5$/);
    await expect(page.getByTestId(`size-${SIZE_LARGE}`)).toContainText(/\+£2$/);
    await page.getByTestId(`size-${SIZE_LARGE}`).click();
    await page.getByTestId("size-continue").click();

    // A VARIANT add always confirms; its Total is the bar's: the bag's own
    // Total before the bag opened (it read the bag-only netAmount mirror,
    // £0.00, then the pre-tax subtotal) — round(7 * 1.15) = £8.
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await expect(page.getByTestId("cta-total")).toHaveText(/: £8$/);
    await expect(page.getByTestId("added-total")).toHaveText(/ £8$/);
    await page.getByTestId("added-continue").click();

    // The bill prices a VARIANT row by its variantPrice (the row lacked it:
    // PAY £NaN). Total = round(7 * 1.15) = £8 — exclusive VAT@15%, header.
    await openBag(page);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£7.00");
    await expect(page.getByTestId("bag-total")).toContainText("£8.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£8.00");
  });

  test("SIZE EDIT: editing a PDP-built VARIANT row from the bag keeps the new size — the whole ×1 row becomes Large; 1 of ×2 splits off as a Regular row beside the kept Large", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { sized: true });
    await bootRegisteredToMenu(page);
    // A card tap (not the quick-add fast lane) runs the PDP size picker.
    const card = page.getByTestId(`item-${SIZED_ITEM}`);
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.getByTestId(`pdp-variant-${SIZE_REGULAR}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£5.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    await openBag(page);
    const itemId = await firstBagRowItemId(page);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£5.00");

    // Whole-row edit (×1): the PDP opens on the row's size; switch to Large.
    await page.getByTestId(`bag-edit-${itemId}`).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await page.getByTestId("pdp-change-size").click();
    await page.getByTestId(`pdp-variant-${SIZE_LARGE}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£7.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId(`bag-row-${itemId}`)).toContainText("Large");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£7.00");

    // Split edit: ×2, edit 1 of them back to Regular → a new row after the
    // kept Large. Sub = 7 + 5; Total = round(12 × 1.15 = 13.8) = £14.
    await page.getByTestId(`bag-inc-${itemId}`).click();
    await expect(page.getByTestId("bag-subtotal")).toContainText("£14.00");
    await page.getByTestId(`bag-edit-${itemId}`).click();
    await page.getByTestId("numpad-key-1").click();
    await page.getByTestId("edit-how-many-confirm").click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await page.getByTestId("pdp-change-size").click();
    await page.getByTestId(`pdp-variant-${SIZE_REGULAR}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£5.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(bagRows(page)).toHaveCount(2);
    await expect(bagRows(page).nth(0)).toHaveAttribute("data-testid", `bag-row-${itemId}`);
    await expect(bagRows(page).nth(0)).toContainText("Large");
    await expect(bagRows(page).nth(1)).toContainText("Regular");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£12.00");
    await expect(page.getByTestId("bag-total")).toContainText("£14.00");
  });

  test("SIZE FAST LANE WITH GROUPS (S1): Large carries a modifier group, so CONTINUE opens the PDP already on Large (no picker); Extra Pickles + ADD TO BAG lands ONE VARIANT row — Sub £8.00, Total with VAT, never NaN", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { sized: true, sizeGroups: true });
    await bootRegisteredToMenu(page);
    const quickAdd = page.getByTestId(`quick-add-${SIZED_ITEM}`);
    await quickAdd.scrollIntoViewIfNeeded();
    await quickAdd.click();

    // S2 (1:5628): nothing chosen — CONTINUE disabled on Grey 3 (#B9B9B9),
    // and no BEST VALUE claim without a data field (D12).
    const sizeContinue = page.getByTestId("size-continue");
    const large = page.getByTestId(`size-${SIZE_LARGE}`);
    await expect(sizeContinue).toBeDisabled();
    await expect(sizeContinue).toHaveCSS("background-color", "rgb(185, 185, 185)");
    await expect(page.getByTestId("size-best-value")).toHaveCount(0);
    await expect(large).toHaveAttribute("aria-pressed", "false");
    await large.click();
    await expect(large).toHaveAttribute("aria-pressed", "true");
    await expect(sizeContinue).toBeEnabled();
    await sizeContinue.click();

    // The PDP opens on the chosen size: no picker, "Large · Change".
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("select-size-modal")).toHaveCount(0);
    await expect(page.getByTestId("pdp-variant-picker")).toHaveCount(0);
    await expect(page.getByTestId("pdp-change-size")).toHaveText(`Large · ${en.pdp.change}`);
    // The chip takes its own line under the description's Show more (user 2026-10-13: it sat inline after it).
    const more = await page.getByTestId("pdp-show-more").boundingBox();
    const chip = await page.getByTestId("pdp-change-size").boundingBox();
    expect(more && chip && chip.y >= more.y + more.height, "the size chip below Show more").toBe(true);
    await expect(page.getByTestId(`pdp-group-${PICKLES_GROUP}`)).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£7.00");
    await page.getByTestId(`pdp-option-${EXTRA_PICKLES}`).click();
    await expect(page.getByTestId(`pdp-option-${EXTRA_PICKLES}`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();

    // ONE VARIANT row (Large + Extra Pickles); round(8 × 1.15 = 9.2) = £9.
    await openBag(page);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toContainText("Large");
    await expect(bagRows(page).first()).toContainText("Extra Pickles");
    const rowType = await page.evaluate(
      () =>
        (
          window as unknown as {
            __kioskStore: { getState: () => { cart: { cartItems: { type?: string }[] } } };
          }
        ).__kioskStore.getState().cart.cartItems.map((row) => row.type)
    );
    expect(rowType).toEqual(["VARIANT"]);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£9.00");
    await expect(page.getByTestId("bag-sheet")).not.toContainText("NaN");
  });

  test("SIZE FAST LANE, REQUIRED GROUP (S1 + G1): an incomplete ADD TO BAG on the preselected size is answered by the completion warning ALONE — never the global error under it — and the size survives GOT IT", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { sized: true, sizeGroups: "required" });
    await bootRegisteredToMenu(page);
    const quickAdd = page.getByTestId(`quick-add-${SIZED_ITEM}`);
    await quickAdd.scrollIntoViewIfNeeded();
    await quickAdd.click();
    await page.getByTestId(`size-${SIZE_LARGE}`).click();
    await page.getByTestId("size-continue").click();
    await expect(page.getByTestId("pdp-change-size")).toHaveText(`Large · ${en.pdp.change}`);

    // The required Extra group is empty: the VARIANT commit refuses once.
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("pdp-incomplete")).toBeVisible();
    await expect(page.getByTestId(`pdp-group-${PICKLES_GROUP}`)).toHaveClass(/ring-red-500/);
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(1);
    await page.getByTestId("pdp-incomplete-gotit").click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(page.getByTestId("pdp-change-size")).toHaveText(`Large · ${en.pdp.change}`);

    // Completed, it lands: one VARIANT row at £8.00.
    await page.getByTestId(`pdp-option-${EXTRA_PICKLES}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    // £8 + VAT = £9.20: the bag's £9.
    await expect(page.getByTestId("cta-total")).toHaveText(/: £9$/);
  });
});

/** The backend's out-of-stock feed: Kiosk partner rows (the PAY engine ignores any other partner). */
const kioskOutOfStock = (itemId: string) => [
  { item_id: itemId, type: "item", partners: { partner_name: "Kiosk", inStock: false } },
];

/** A cart row's itemId (runtime-generated "<stamp>_<entity id>") by its entity. */
async function bagRowItemIdOf(page: Page, entityId: string): Promise<string> {
  const row = page.locator(`[data-testid^="bag-row-"][data-testid$="_${entityId}"]`);
  await expect(row).toBeVisible();
  return ((await row.getAttribute("data-testid")) ?? "").replace("bag-row-", "");
}

test.describe("audit-fixes — PAY's stock re-check (A1) and cooking instructions (U3)", () => {
  test("PAY RE-CHECKS STOCK: the burger went out of stock after the menu loaded — PAY raises the existing notice, stays on /cart with the row Unavailable; removed, PAY proceeds", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await addGreekSaladOneTap(page, "(2)");
    await openBag(page);
    const burgerId = await bagRowItemIdOf(page, CHEESE_BURGER);

    // The menu loaded with an empty feed; from here the burger is out
    // (newest route wins). PAY's request carries the bag's ids.
    const sweepBodies: { items_id: string[] }[] = [];
    await page.route("**/api/cx/kiosk/get_out_of_stock", (route) => {
      const body = route.request().postDataJSON() as { items_id?: string[] } | null;
      if (body?.items_id) sweepBodies.push({ items_id: body.items_id });
      return route.fulfill({ json: kioskOutOfStock(CHEESE_BURGER) });
    });
    await page.getByTestId("bag-pay").click();

    const dialog = page.getByRole("alertdialog", { name: en.bag.itemUnavailable });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-testid", "global-error");
    expect(sweepBodies).toHaveLength(1);
    expect(sweepBodies[0].items_id).toEqual(expect.arrayContaining([CHEESE_BURGER, GREEK_SALAD]));
    await page.getByTestId("global-error-ok").click();
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);

    // The row says so (art at 50 %), its Edit and "+" are gone / inert; the
    // salad is untouched. The line never counts as a row.
    await expect(page.getByTestId(`bag-unavailable-${burgerId}`)).toHaveText(en.menu.unavailable);
    // The art (photo or its grey plate) is the row's first child.
    await expect(page.getByTestId(`bag-row-${burgerId}`).locator(":scope > *").first()).toHaveCSS(
      "opacity",
      "0.5"
    );
    await expect(page.getByTestId(`bag-edit-${burgerId}`)).toHaveCount(0);
    await expect(page.getByTestId(`bag-inc-${burgerId}`)).toHaveAttribute("aria-disabled", "true");
    await expect(bagRows(page)).toHaveCount(2);
    const saladId = await bagRowItemIdOf(page, GREEK_SALAD);
    await expect(page.getByTestId(`bag-unavailable-${saladId}`)).toHaveCount(0);

    // The guest removes it: PAY checks the bag again and proceeds.
    await page.getByTestId(`bag-dec-${burgerId}`).click();
    await page.getByTestId("remove-item-confirm").click();
    await expect(bagRows(page)).toHaveCount(1);
    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    expect(sweepBodies).toHaveLength(2);
    expect(sweepBodies[1].items_id).toEqual([GREEK_SALAD]);
    await expect(page.getByTestId("global-error")).toHaveCount(0);
  });

  test("STOCK CHECK FAILURE NEVER BLOCKS PAY: the feed answers 500 — PAY still lands on the checkout (fail open), no error", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await openBag(page);

    let sweeps = 0;
    await page.route("**/api/cx/kiosk/get_out_of_stock", (route) => {
      sweeps += 1;
      return route.fulfill({ status: 500, json: { message: "stock service down" } });
    });
    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    await expect(page.getByTestId("phone-screen")).toBeVisible();
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    expect(sweeps).toBe(1);
  });

  test("MID-CHECK CHANGE: the guest taps + while PAY's stock check is out — its late answer never overwrites the bag (the burger stays ×2, nothing flagged, no message); the next PAY checks the bag as it is now", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await addGreekSaladOneTap(page, "(2)");
    await openBag(page);
    const burgerId = await bagRowItemIdOf(page, CHEESE_BURGER);
    const saladId = await bagRowItemIdOf(page, GREEK_SALAD);

    // The salad sold out, and PAY's answer is held until the guest has
    // changed the bag (no busy overlay: the steppers stay live — D-A1-5).
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked: string[][] = [];
    await page.route("**/api/cx/kiosk/get_out_of_stock", async (route) => {
      const body = route.request().postDataJSON() as { items_id?: string[] } | null;
      asked.push(body?.items_id ?? []);
      if (asked.length === 1) await held;
      return route.fulfill({ json: kioskOutOfStock(GREEK_SALAD) });
    });
    await page.getByTestId("bag-pay").click();
    await expect.poll(() => asked.length).toBe(1);
    await page.getByTestId(`bag-inc-${burgerId}`).click();
    await expect(page.getByTestId("bag-subtotal")).toContainText("£33.00");

    // The answer lands on a bag that changed under it: no write (its swept
    // rows would put the burger back to ×1), no flag, no message — sampled
    // for a second after the answer arrived.
    const answered = page.waitForResponse("**/api/cx/kiosk/get_out_of_stock");
    release();
    await answered;
    const settledAt = Date.now() + 1_000;
    await expect
      .poll(
        async () => ({
          settled: Date.now() >= settledAt,
          errors: await page.getByTestId("global-error").count(),
          subtotal: await page.getByTestId("bag-subtotal").textContent(),
          saladFlagged: await page.getByTestId(`bag-unavailable-${saladId}`).count(),
          path: new URL(page.url()).pathname,
        }),
        { timeout: 6_000, intervals: [100] }
      )
      .toEqual({ settled: true, errors: 0, subtotal: "£33.00", saladFlagged: 0, path: "/cart" });

    // The next PAY checks the bag as it is now: the salad blocks it, and the
    // write-back keeps the guest's ×2.
    await page.getByTestId("bag-pay").click();
    await expect(page.getByRole("alertdialog", { name: en.bag.itemUnavailable })).toBeVisible();
    expect(asked).toHaveLength(2);
    await page.getByTestId("global-error-ok").click();
    await expect(page.getByTestId(`bag-unavailable-${saladId}`)).toHaveText(en.menu.unavailable);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£33.00");
    await expect(page).toHaveURL(/\/cart$/);
  });

  test("BACK IN STOCK: a row an earlier PAY flagged clears once the feed has it again — PAY proceeds, and BACK from /phone finds it orderable", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await openBag(page);
    const burgerId = await bagRowItemIdOf(page, CHEESE_BURGER);

    await page.route("**/api/cx/kiosk/get_out_of_stock", (route) =>
      route.fulfill({ json: kioskOutOfStock(CHEESE_BURGER) })
    );
    await page.getByTestId("bag-pay").click();
    await expect(page.getByRole("alertdialog", { name: en.bag.itemUnavailable })).toBeVisible();
    await page.getByTestId("global-error-ok").click();
    await expect(page.getByTestId(`bag-unavailable-${burgerId}`)).toBeVisible();
    await expect(page.getByTestId(`bag-inc-${burgerId}`)).toHaveAttribute("aria-disabled", "true");

    // Restocked (newest route wins): the next PAY finds nothing out, clears
    // the stale flag on the live row and goes on.
    await page.route("**/api/cx/kiosk/get_out_of_stock", (route) => route.fulfill({ json: [] }));
    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    await page.getByTestId("phone-back").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`bag-unavailable-${burgerId}`)).toHaveCount(0);
    await expect(page.getByTestId(`bag-inc-${burgerId}`)).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId(`bag-edit-${burgerId}`)).toBeVisible();
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });

  test("PAY RE-CHECKS A SIZE: the Large picked in Select a Size sold out — the fast-lane row (SDK-shaped, B5) is swept, never failed open: PAY stays on /cart and the row reads Unavailable", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { sized: true });
    await bootRegisteredToMenu(page);
    const quickAdd = page.getByTestId(`quick-add-${SIZED_ITEM}`);
    await quickAdd.scrollIntoViewIfNeeded();
    await quickAdd.click();
    await page.getByTestId(`size-${SIZE_LARGE}`).click();
    await page.getByTestId("size-continue").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    await openBag(page);
    const rowId = await firstBagRowItemId(page);

    const sweepBodies: string[][] = [];
    await page.route("**/api/cx/kiosk/get_out_of_stock", (route) => {
      const body = route.request().postDataJSON() as { items_id?: string[] } | null;
      sweepBodies.push(body?.items_id ?? []);
      return route.fulfill({
        json: [
          { item_id: SIZE_LARGE, type: "variant", partners: { partner_name: "Kiosk", inStock: false } },
        ],
      });
    });
    await page.getByTestId("bag-pay").click();
    await expect(page.getByRole("alertdialog", { name: en.bag.itemUnavailable })).toBeVisible();
    // The row carries its base item and its size (a hand-built row would
    // have thrown in the sweep and failed open onto /phone).
    expect(sweepBodies).toHaveLength(1);
    expect(sweepBodies[0]).toEqual(expect.arrayContaining([SIZED_ITEM, SIZE_LARGE]));
    await page.getByTestId("global-error-ok").click();
    await expect(page).toHaveURL(/\/cart$/);
    // The SIZE is what sold out — Unavailable, not "choices unavailable".
    await expect(page.getByTestId(`bag-unavailable-${rowId}`)).toHaveText(en.menu.unavailable);
    await expect(page.getByTestId(`bag-changed-${rowId}`)).toHaveCount(0);
    await expect(page.getByTestId(`bag-row-${rowId}`).locator(":scope > *").first()).toHaveCSS(
      "opacity",
      "0.5"
    );
    // Like a sold-out item: no "+" and no Edit — only − / remove.
    await expect(page.getByTestId(`bag-inc-${rowId}`)).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId(`bag-edit-${rowId}`)).toHaveCount(0);
  });

  test("COOKING INSTRUCTIONS REACH THE ORDER: typed on the kiosk keyboard, kept across a reload on /cart, sent as special_instructions, gone for the next guest", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install(); // Order Complete's 20 s exit is stepped, never slept through
    await mockKioskBackend(page, { skipCRM: true });
    // MUST come second (newest route wins): the pay-at-counter surface.
    const checkout = await mockCheckoutBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page, { expectedCta: "£8.00" });
    await openBag(page);

    const entryText = page.getByTestId("bag-instructions-text");
    await expect(entryText).toHaveText(en.bag.instructions.hint);
    await page.getByTestId("bag-instructions-entry").click();
    const sheet = page.getByTestId("instructions-sheet");
    await expect(sheet.getByRole("dialog", { name: en.bag.instructions.title })).toBeVisible();
    for (const char of "no  onions") {
      if (char === " ") await sheet.getByTestId("keyboard-space").click();
      else await sheet.getByRole("button", { name: char, exact: true }).click();
    }
    // Two spaces collapse to one.
    await expect(sheet.getByTestId("instructions-input")).toHaveText("no onions");
    await expect(sheet.getByTestId("instructions-counter")).toHaveText("9/100");
    await page.getByTestId("instructions-save").click();
    await expect(sheet).toHaveCount(0);
    await expect(entryText).toHaveText("no onions");

    // Crash-reload on /cart: the note is customer state, persisted.
    await page.reload();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("bag-instructions-text")).toHaveText("no onions");

    // PAY → /payment → PAY AT COUNTER → the push carries the note.
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("payment-counter").click();
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.lastPlaceOrderBody).toMatchObject({
      special_instructions: "no onions",
      payments: { type: "COD" },
    });
    expect(checkout.forbiddenUrls).toEqual([]);

    // The next guest starts without it: Order Complete's 20 s exit, then the
    // splash.
    await page.clock.runFor(20_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    await startToSecond(page);
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await addGreekSaladOneTap(page, "(1)");
    await openBag(page);
    await expect(page.getByTestId("bag-instructions-text")).toHaveText(en.bag.instructions.hint);
  });
});
