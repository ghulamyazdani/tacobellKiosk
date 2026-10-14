import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  locale,
  LARGE_FRIES,
  CHEESE_BURGER,
  EXTRA_PICKLES,
} from "./fixtures/backend";
import { bootRegisteredToMenu } from "./pages/boot";
import { stageBox } from "./fixtures/a11y";

/**
 * audit-fixes UB2 + U1 on the PDP, end to end over the REAL converters and
 * customization engine with a mocked backend (pack.spec's registered-device
 * pattern):
 * - SIZE FIRST: a sized item's ADD TO BAG before a size is live and answers
 *   with the 1:2855 completion warning naming the size; nothing is
 *   committed. (It used to be a dimmed button that did nothing.)
 * - CHANGE, then ADD TO BAG: the grid open over a chosen size commits that
 *   size; an empty required group below the fold is named, ringed and
 *   scrolled into view (walk 2026-10-14 fixer review).
 * - The PDP diet mark (design language): the veg / non-veg mark leads the
 *   price line; `hide_veg_non_veg` hides it.
 * - MULTI-PUNCH: with the menu's `allow_multiple_punch` on, a group whose
 *   raw bounds are 1/1 takes its multi-punch bounds (0/6): no "Required",
 *   "0 of 6", several picks, and an empty group is accepted. (On a device
 *   this is a Posist menu-setting question, Q1 — the PDP now shows what the
 *   engine enforces.)
 * - STEPPER COUNTER (user report 2026-10-14): stepper rows always carry
 *   "N of M" — against the group max, or with none (0 / 0) against the
 *   rows' item caps — at the header's right edge, the ADA view included.
 *
 * Fixture facts (tests/e2e/fixtures/slim-menu.json): Kiddie Meal Beef Burger
 * (tagged veg) is re-shaped into a sized item with no groups (or, for CHANGE,
 * a Large carrying Cheese Burger's three groups); Large Fries is
 * tagged non-veg (one optional addon group → the PDP); Cheese Burger (veg)
 * carries the "Choose From Extra" addon group (0 / 3, three options).
 *
 * Harness (P9f): the shared mock (fixtures/backend.ts) and the shared boot
 * (pages/boot.ts); mockKioskBackend keeps its name as a thin adapter.
 */

const en = locale("en");
const enLazy = locale("en", "lazy");
const slimMenu = fixtureJson("slim-menu.json");

// ---- Fixture ids (see header; LARGE_FRIES, CHEESE_BURGER, EXTRA_PICKLES: fixtures/backend.ts) ----
const SIZED_ITEM = "5dd1093a188e72ce1b3eb358";
const SIZE_REGULAR = "e2e-size-regular"; // £5
const SIZE_LARGE = "e2e-size-large"; // £7
const EXTRA_GROUP = `${CHEESE_BURGER}_1573980469_addons`;
// Cheese Burger's "Choose From Without" group (order 2, four options, 0 / 4).
const WITHOUT_GROUP = `${CHEESE_BURGER}_1573980470_addons`;
// The last of Cheese Burger's three groups (order 3, one option, 0 / 1).
const EXTRA_CHEESE_GROUP = `${CHEESE_BURGER}_1686482941_addons`;

type MenuJson = {
  settings: Record<string, unknown>;
  categories: { subCategories: { id: string; entities: Record<string, unknown>[] }[] }[];
  modifiers: { _id: string; constituentItems: { id: string }[]; [key: string]: unknown }[];
};

/** SIZED_ITEM as a sized item with two active sizes; no modifier groups unless Large is given some. */
function sizedMenu(largeGroups?: string[]): MenuJson {
  const menu = structuredClone(slimMenu) as MenuJson;
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
            ...(id === SIZE_LARGE && largeGroups ? { modifiers: largeGroups } : {}),
          }));
        }
  return menu;
}

/** Large carries Cheese Burger's three groups, the last (Extra Cheese, below the fold) made required. */
function sizedRequiredGroupMenu(): MenuJson {
  const menu = sizedMenu([EXTRA_GROUP, `${CHEESE_BURGER}_1573980470_addons`, EXTRA_CHEESE_GROUP]);
  const cheese = menu.modifiers.find((group) => group._id === EXTRA_CHEESE_GROUP);
  if (!cheese) throw new Error("fixture: no Extra Cheese group");
  cheese.min = 1;
  return menu;
}

/** Multi-punch ON, and Cheese Burger's "Extra" group made a raw 1/1 with multi-punch bounds 0 / 6. */
function multiPunchMenu(): MenuJson {
  const menu = structuredClone(slimMenu) as MenuJson;
  menu.settings = { ...menu.settings, allow_multiple_punch: true };
  const extra = menu.modifiers.find((group) => group._id === EXTRA_GROUP);
  if (!extra) throw new Error("fixture: no Extra group");
  Object.assign(extra, { min: 1, max: 1, multiplePunchMin: 0, multiplePunchMax: 6, multiplePunchMaxItem: 1 });
  return menu;
}

/**
 * User report 2026-10-14 (Honey BBQ Wings' "Test 1"): Cheese Burger's
 * "Extra" group on the toggle bounds 0 / 0 with an item cap of 3 (stepper
 * rows, no group max), and its "Without" group a 0 / 4 stepper (item cap 2).
 */
function stepperCounterMenu(): MenuJson {
  const menu = structuredClone(slimMenu) as MenuJson;
  const extra = menu.modifiers.find((group) => group._id === EXTRA_GROUP);
  const without = menu.modifiers.find((group) => group._id === WITHOUT_GROUP);
  if (!extra || !without) throw new Error("fixture: no Extra / Without group");
  Object.assign(extra, { min: 0, max: 0, multiplePunchMin: 0, multiplePunchMax: 0, multiplePunchMaxItem: 3 });
  Object.assign(without, { multiplePunchMaxItem: 2 });
  return menu;
}

/** Multi-punch OFF, and Cheese Burger's "Extra" group a raw 1/1 whose item cap is 3. */
function oneOfOneMenu(): MenuJson {
  const menu = structuredClone(slimMenu) as MenuJson;
  const extra = menu.modifiers.find((group) => group._id === EXTRA_GROUP);
  if (!extra) throw new Error("fixture: no Extra group");
  Object.assign(extra, { min: 1, max: 1, multiplePunchMaxItem: 3 });
  return menu;
}

/**
 * The shared mock (fixtures/backend.ts): `menu` replaces the slim menu,
 * `kioskSettings` merges over its START ORDER / ideal_time settings.
 */
const mockKioskBackend = (
  page: Page,
  { menu, kioskSettings = {} }: { menu?: unknown; kioskSettings?: Record<string, unknown> } = {},
) => mockBackend(page, { menu, settings: kioskSettings });

/** Menu card tap → the item's PDP. */
async function openPdp(page: Page, itemId: string) {
  const card = page.getByTestId(`item-${itemId}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
}

/** The committed bag rows (DEV-only window.__kioskStore). */
function cartRowCount(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __kioskStore: { getState: () => { cart?: { cartItems?: unknown[] } } };
        }
      ).__kioskStore.getState().cart?.cartItems?.length ?? 0,
  );
}

/** The PDP price line: the <p> led by the diet mark. */
const pdpPriceLine = (page: Page, mark: "veg" | "non-veg") =>
  page
    .getByTestId("customization-screen")
    .locator("p", { has: page.getByTestId(`veg-mark-${mark}`) });

test.describe("PDP limits (audit-fixes UB2)", () => {
  test("SIZE FIRST: ADD TO BAG before a size is live — the completion warning names the size and the bag stays empty; after a size the same button commits", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { menu: sizedMenu() });
    await bootRegisteredToMenu(page);
    await openPdp(page, SIZED_ITEM);

    await expect(page.getByTestId("pdp-variant-picker")).toBeVisible();
    const addToBag = page.getByTestId("pdp-add-to-bag");
    await expect(addToBag).toBeEnabled();
    await addToBag.click();

    const warning = page.getByRole("alertdialog", { name: enLazy.pdp.incomplete.titleItem });
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAccessibleDescription(
      (enLazy.pdp.incomplete.body as string).replace("{{groups}}", enLazy.pdp.incomplete.size),
    );
    expect(enLazy.pdp.incomplete.size).toBe("size");
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await test.info().attach("pdp-size-first", { body: await page.screenshot(), contentType: "image/png" });
    await page.getByTestId("pdp-incomplete-gotit").click();
    await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
    await expect(page.getByTestId("pdp-variant-picker")).toBeVisible();
    expect(await cartRowCount(page)).toBe(0);

    await page.getByTestId(`pdp-variant-${SIZE_REGULAR}`).click();
    await expect(addToBag).toContainText("£5.00");
    await addToBag.click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£5.00");
  });

  test("CHANGE, then ADD TO BAG on an incomplete size: the grid closes, the warning names the group, and after GOT IT the ringed group is on screen", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { menu: sizedRequiredGroupMenu() });
    await bootRegisteredToMenu(page);
    await openPdp(page, SIZED_ITEM);

    await page.getByTestId(`pdp-variant-${SIZE_LARGE}`).click();
    await page.getByTestId("pdp-change-size").click();
    await expect(page.getByTestId(`pdp-variant-${SIZE_LARGE}`)).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("pdp-add-to-bag").click();

    const warning = page.getByRole("alertdialog", { name: enLazy.pdp.incomplete.titleItem });
    await expect(warning).toHaveAccessibleDescription(
      (enLazy.pdp.incomplete.body as string).replace("{{groups}}", "choose from extra cheese for cheese burger"),
    );
    await page.getByTestId("pdp-incomplete-gotit").click();
    await expect(page.getByTestId("pdp-variant-picker")).toHaveCount(0);
    const ringed = page.getByTestId(`pdp-group-${EXTRA_CHEESE_GROUP}`);
    await expect(ringed).toHaveClass(/ring-red-500/);
    // The commit scrolled the pane to it; a jump to the top left it below the fold.
    await expect(ringed).toBeInViewport({ ratio: 1 });
    expect(await cartRowCount(page)).toBe(0);
  });

  test("PDP DIET MARK (U1): the veg mark leads a veg item's price line, the non-veg mark a non-veg one's; hide_veg_non_veg hides it", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);

    await openPdp(page, CHEESE_BURGER);
    const vegLine = pdpPriceLine(page, "veg");
    await expect(vegLine).toHaveCount(1);
    await expect(vegLine).toHaveText("£8.00");
    await expect(vegLine.getByRole("img", { name: en.menu.veg })).toBeVisible();
    const box = await vegLine.getByTestId("veg-mark-veg").boundingBox();
    expect(box && { w: Math.round(box.width), h: Math.round(box.height) }).toEqual({ w: 24, h: 24 });
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });

    await openPdp(page, LARGE_FRIES);
    const nonVegLine = pdpPriceLine(page, "non-veg");
    await expect(nonVegLine).toHaveText("£9.00");
    await expect(nonVegLine.getByRole("img", { name: en.menu.nonVeg })).toBeVisible();
    await expect(pdpPriceLine(page, "veg")).toHaveCount(0);
  });

  test("PDP DIET MARK hidden by the operator: hide_veg_non_veg → no mark on the PDP, the price line intact", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { kioskSettings: { hide_veg_non_veg: true } });
    await bootRegisteredToMenu(page);
    await openPdp(page, CHEESE_BURGER);

    await expect(page.getByTestId("customization-screen").getByTestId(/^veg-mark-/)).toHaveCount(0);
    await expect(page.getByTestId("customization-screen").getByText("£8.00", { exact: true })).toBeVisible();
  });

  test("ONE OF ONE IS A RADIO: a 1/1 group whose item cap is 3 draws radio cards, never steppers — a second pick swaps the first, never refused", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { menu: oneOfOneMenu() });
    await bootRegisteredToMenu(page);
    await openPdp(page, CHEESE_BURGER);

    // A radio group: "Required", no "n of max" count.
    const extra = page.getByTestId(`pdp-group-${EXTRA_GROUP}`);
    await expect(extra).toContainText(en.pdp.required);
    const options = extra.locator('[data-testid^="pdp-option-"]:not([data-testid^="pdp-option-cta-"])');
    await expect(options).toHaveCount(3);
    // Cards, not stepper rows (the item cap would have drawn steppers).
    await expect(extra.getByRole("button", { name: /^Increase quantity/ })).toHaveCount(0);

    const pickles = page.getByTestId(`pdp-option-${EXTRA_PICKLES}`);
    const second = options.nth(1);
    await pickles.click();
    await expect(pickles).toHaveAttribute("aria-pressed", "true");
    await second.click();
    // The swap: the new pick replaces the old one, no refusal.
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(pickles).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("global-error")).toHaveCount(0);
  });

  test("MULTI-PUNCH ON: a raw 1/1 group with multi-punch 0 / 6 shows no Required and '0 of 6', takes several picks (never a swap), and an empty group is accepted", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { menu: multiPunchMenu() });
    await bootRegisteredToMenu(page);
    await openPdp(page, CHEESE_BURGER);

    const extra = page.getByTestId(`pdp-group-${EXTRA_GROUP}`);
    const count = (picked: number) =>
      (en.pdp.groupCount as string).replace("{{count}}", String(picked)).replace("{{max}}", "6");
    await expect(extra).toContainText(count(0));
    await expect(extra).not.toContainText(en.pdp.required);

    // Several picks, never a swap (radio cards: the item cap is 1).
    const options = extra.locator('[data-testid^="pdp-option-"]:not([data-testid^="pdp-option-cta-"])');
    await expect(options).toHaveCount(3);
    const pickles = page.getByTestId(`pdp-option-${EXTRA_PICKLES}`);
    const second = options.nth(1);
    await pickles.click();
    await second.click();
    await expect(extra).toContainText(count(2));
    await expect(pickles).toHaveAttribute("aria-pressed", "true");
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("global-error")).toHaveCount(0);

    // Both off again: the empty group is fine (multi-punch min 0).
    await pickles.click();
    await second.click();
    await expect(extra).toContainText(count(0));
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£8.00");
  });

  test("STEPPER COUNTER (user report 2026-10-14): a stepper group with no group max counts against its rows' caps and one with a max against it — 'N of M' follows every + and −, at the header's right edge in the normal and the ADA view", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { menu: stepperCounterMenu(), kioskSettings: { accessibility_mode: true } });
    await bootRegisteredToMenu(page);
    await openPdp(page, CHEESE_BURGER);

    const counter = (groupId: string, picked: number, max: number) =>
      page
        .getByTestId(`pdp-group-${groupId}`)
        .getByText(
          (en.pdp.groupCount as string).replace("{{count}}", String(picked)).replace("{{max}}", String(max)),
          { exact: true },
        );
    const plus = (option: string) => page.getByRole("button", { name: `${en.pdp.increase} ${option}` });
    const minus = (option: string) => page.getByRole("button", { name: `${en.pdp.decrease} ${option}` });
    /** The extreme right of the 1032 px contents (x 24): stage x 1056 in both views. */
    const expectAtRightEdge = async (groupId: string, picked: number, max: number) =>
      expect.poll(async () => {
        const box = await stageBox(counter(groupId, picked, max));
        return box.x + box.width;
      }).toBe(1056);

    // No group max: 3 rows × cap 3. Stepper rows, no "Required".
    await expect(counter(EXTRA_GROUP, 0, 9)).toBeVisible();
    await expect(page.getByTestId(`pdp-group-${EXTRA_GROUP}`)).not.toContainText(en.pdp.required);
    await expectAtRightEdge(EXTRA_GROUP, 0, 9);
    await plus("Extra Pickles").click();
    await expect(counter(EXTRA_GROUP, 1, 9)).toBeVisible();
    await plus("Extra Pickles").click();
    await expect(counter(EXTRA_GROUP, 2, 9)).toBeVisible();
    await plus("Extra Ketchup").click();
    await expect(counter(EXTRA_GROUP, 3, 9)).toBeVisible();
    await minus("Extra Pickles").click();
    await expect(counter(EXTRA_GROUP, 2, 9)).toBeVisible();
    await expect(page.getByTestId("global-error")).toHaveCount(0);

    // A group max: the 0 / 4 stepper counts against 4.
    const without = page.getByTestId(`pdp-group-${WITHOUT_GROUP}`);
    await without.scrollIntoViewIfNeeded();
    await expect(counter(WITHOUT_GROUP, 0, 4)).toBeVisible();
    await plus("Without Ketchup").click();
    await plus("Without Ketchup").click();
    await expect(counter(WITHOUT_GROUP, 2, 4)).toBeVisible();
    await expectAtRightEdge(WITHOUT_GROUP, 2, 4);
    await test.info().attach("pdp-stepper-counter", { body: await page.screenshot(), contentType: "image/png" });

    // The ADA reach-zone view: the same counters, still at the right edge.
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await expect(counter(EXTRA_GROUP, 2, 9)).toBeAttached();
    await expectAtRightEdge(EXTRA_GROUP, 2, 9);
    await expectAtRightEdge(WITHOUT_GROUP, 2, 4);
    await without.scrollIntoViewIfNeeded();
    await plus("Without Cheese").click();
    await expect(counter(WITHOUT_GROUP, 3, 4)).toBeVisible();
    await test.info().attach("pdp-stepper-counter-ada", { body: await page.screenshot(), contentType: "image/png" });
  });
});
