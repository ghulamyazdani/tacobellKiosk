import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  locale,
  LARGE_FRIES,
  CHEESE_BURGER,
  EXTRA_PICKLES,
  SKIP_CRM,
} from "./fixtures/backend";
import { mockCheckoutBackend } from "./fixtures/checkout";
import { bootRegisteredToMenu } from "./pages/boot";
import { payAtCounter } from "./pages/checkout";
import { dismissAddedModal, openBag } from "./pages/order";
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
 * - STEPPER COUNTER (user report 2026-10-14): stepper rows carry "N of M"
 *   against the group max the "+" refuses at, a max of 1 included, at the
 *   header's right edge (the ADA view too); ADD TO BAG takes what they
 *   show. A 0 / 0 stepper takes no pick (user decision 2026-10-14,
 *   posistKiosk parity): "0 of 0", its "+" refused up front.
 * - SIZED STEPPER AT ITS MINIMUM (user decision 2026-10-14): a required
 *   stepper group on a size is met by one option ×2 — the sized item's
 *   commit counts units, as the counter does (it counted rows and refused).
 * - INACTIVE REQUIRED GROUP (user decision 2026-10-15, "PAY skips inactive
 *   groups"): a size whose required group is switched off is paid for, to
 *   the receipt — PAY's re-check skips the group, as the PDP and its commit
 *   do (it refused the row for good); an active required group left empty
 *   is still refused at commit.
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
const ADD_CHEESE = "5dd1093f188e72ce1b3eb36f"; // its one option, +£1

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

/**
 * User decision 2026-10-15 ("PAY skips inactive groups"): Large carries
 * Cheese Burger's "Extra" group SWITCHED OFF yet required (isActive false,
 * 1 / 3) and its "Extra Cheese" group made required (1 / 1, active).
 */
function sizedInactiveRequiredGroupMenu(): MenuJson {
  const menu = sizedMenu([EXTRA_GROUP, EXTRA_CHEESE_GROUP]);
  const extra = menu.modifiers.find((group) => group._id === EXTRA_GROUP);
  const cheese = menu.modifiers.find((group) => group._id === EXTRA_CHEESE_GROUP);
  if (!extra || !cheese) throw new Error("fixture: no Extra / Extra Cheese group");
  Object.assign(extra, { isActive: false, min: 1, multiplePunchMin: 1 });
  cheese.min = 1;
  return menu;
}

/** Large carries Cheese Burger's "Without" group as a REQUIRED stepper: 2 / 4, item cap 2. */
function sizedStepperMinMenu(): MenuJson {
  const menu = sizedMenu([WITHOUT_GROUP]);
  const without = menu.modifiers.find((group) => group._id === WITHOUT_GROUP);
  if (!without) throw new Error("fixture: no Without group");
  Object.assign(without, { min: 2, max: 4, multiplePunchMin: 2, multiplePunchMax: 4, multiplePunchMaxItem: 2 });
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
 * User report 2026-10-14 (Honey BBQ Wings' "Test 1"): Cheese Burger's three
 * groups as stepper rows — "Extra" a 0 / 1 (item cap 3), "Without" a 0 / 4
 * (item cap 2), "Extra Cheese" on 0 / 0 (item cap 3, no group max).
 */
function stepperCounterMenu(): MenuJson {
  const menu = structuredClone(slimMenu) as MenuJson;
  const extra = menu.modifiers.find((group) => group._id === EXTRA_GROUP);
  const without = menu.modifiers.find((group) => group._id === WITHOUT_GROUP);
  const cheese = menu.modifiers.find((group) => group._id === EXTRA_CHEESE_GROUP);
  if (!extra || !without || !cheese) throw new Error("fixture: no Extra / Without / Extra Cheese group");
  Object.assign(extra, { min: 0, max: 1, multiplePunchMin: 0, multiplePunchMax: 1, multiplePunchMaxItem: 3 });
  Object.assign(without, { multiplePunchMaxItem: 2 });
  Object.assign(cheese, { min: 0, max: 0, multiplePunchMin: 0, multiplePunchMax: 0, multiplePunchMaxItem: 3 });
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
    await expect(page.getByTestId("cta-total")).toHaveText(/: £6$/);
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
    // posistKiosk's price format (moduloCalcaledValue): a whole price whole.
    await expect(vegLine).toHaveText("£8");
    await expect(vegLine.getByRole("img", { name: en.menu.veg })).toBeVisible();
    const box = await vegLine.getByTestId("veg-mark-veg").boundingBox();
    expect(box && { w: Math.round(box.width), h: Math.round(box.height) }).toEqual({ w: 24, h: 24 });
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });

    await openPdp(page, LARGE_FRIES);
    const nonVegLine = pdpPriceLine(page, "non-veg");
    await expect(nonVegLine).toHaveText("£9");
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
    await expect(page.getByTestId("customization-screen").getByText("£8", { exact: true })).toBeVisible();
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
    await expect(page.getByTestId("cta-total")).toHaveText(/: £9$/);
  });

  test("STEPPER COUNTER (user report 2026-10-14): a stepper group counts against the max its '+' refuses at, 1 included — 'N of M' follows every + and −, at the header's right edge in the normal and the ADA view; ADD TO BAG takes what the counters show; a 0 / 0 stepper reads '0 of 0' and refuses its '+'", async ({
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
    /** The guard's "You can choose up to {max} …" refusal, then GOT IT. */
    const expectRefusedAt = async (max: number) => {
      await expect(page.getByTestId("global-error")).toContainText(
        (en.pdp.groupMaxReached as string).replace("{{max}}", String(max)).replace(" {{group}}", ""),
      );
      await page.getByTestId("global-error-ok").click();
      await expect(page.getByTestId("global-error")).toHaveCount(0);
    };

    // A group max of 1 (item cap 3): "0 of 1"; the second unit is refused at it.
    await expect(counter(EXTRA_GROUP, 0, 1)).toBeVisible();
    await expect(page.getByTestId(`pdp-group-${EXTRA_GROUP}`)).not.toContainText(en.pdp.required);
    await expectAtRightEdge(EXTRA_GROUP, 0, 1);
    await plus("Extra Pickles").click();
    await expect(counter(EXTRA_GROUP, 1, 1)).toBeVisible();
    await plus("Extra Pickles").click();
    await expectRefusedAt(1);
    await expect(counter(EXTRA_GROUP, 1, 1)).toBeVisible();

    // A group max of 4 (item cap 2): + and − move it; the 5th unit is refused at it.
    const without = page.getByTestId(`pdp-group-${WITHOUT_GROUP}`);
    await without.scrollIntoViewIfNeeded();
    await expect(counter(WITHOUT_GROUP, 0, 4)).toBeVisible();
    await plus("Without Ketchup").click();
    await plus("Without Ketchup").click();
    await expect(counter(WITHOUT_GROUP, 2, 4)).toBeVisible();
    await plus("Without Cheese").click();
    await plus("Without Cheese").click();
    await expect(counter(WITHOUT_GROUP, 4, 4)).toBeVisible();
    await plus("Without Pickles").click();
    await expectRefusedAt(4);
    await minus("Without Ketchup").click();
    await expect(counter(WITHOUT_GROUP, 3, 4)).toBeVisible();
    await expectAtRightEdge(WITHOUT_GROUP, 3, 4);

    // 0 / 0 (no group max): stepper rows that take no pick (user decision
    // 2026-10-14, posistKiosk parity) — "0 of 0" at the right edge, and the
    // "+" is refused up front with the fork's group limit; nothing lands.
    const cheese = page.getByTestId(`pdp-group-${EXTRA_CHEESE_GROUP}`);
    await cheese.scrollIntoViewIfNeeded();
    await expect(plus("Add Cheese")).toBeVisible();
    await expect(counter(EXTRA_CHEESE_GROUP, 0, 0)).toBeVisible();
    await expectAtRightEdge(EXTRA_CHEESE_GROUP, 0, 0);
    await test.info().attach("pdp-stepper-counter", { body: await page.screenshot(), contentType: "image/png" });
    await plus("Add Cheese").click();
    await expect(page.getByTestId("global-error")).toContainText(
      (en.pdp.groupNoMax as string).replace("{{group}}", "Choose From Extra Cheese for Cheese Burger"),
    );
    await page.getByTestId("global-error-ok").click();
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(counter(EXTRA_CHEESE_GROUP, 0, 0)).toBeVisible();
    await expect(cheese.getByText("0", { exact: true })).toBeVisible();

    // The ADA reach-zone view: the same counters, still at the right edge.
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await expect(counter(EXTRA_GROUP, 1, 1)).toBeAttached();
    await expectAtRightEdge(EXTRA_GROUP, 1, 1);
    await expectAtRightEdge(WITHOUT_GROUP, 3, 4);
    await without.scrollIntoViewIfNeeded();
    await plus("Without Pickles").click();
    await expect(counter(WITHOUT_GROUP, 4, 4)).toBeVisible();
    await test.info().attach("pdp-stepper-counter-ada", { body: await page.screenshot(), contentType: "image/png" });

    // The commit agrees with the counters: "1 of 1" and "4 of 4" go to the bag.
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
    await expect.poll(() => cartRowCount(page)).toBe(1);
  });

  test("SIZED STEPPER AT ITS MINIMUM (user decision 2026-10-14): a required 2 / 4 stepper on a size, met by Without Ketchup ×2 — '2 of 4', and ADD TO BAG commits it (the sized commit counts units, like the counter)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { menu: sizedStepperMinMenu() });
    await bootRegisteredToMenu(page);
    await openPdp(page, SIZED_ITEM);
    await page.getByTestId(`pdp-variant-${SIZE_LARGE}`).click();

    const without = page.getByTestId(`pdp-group-${WITHOUT_GROUP}`);
    const count = (picked: number) =>
      (en.pdp.groupCount as string).replace("{{count}}", String(picked)).replace("{{max}}", "4");
    await expect(without).toContainText(en.pdp.required);
    await expect(without).toContainText(count(0));
    const plus = page.getByRole("button", { name: `${en.pdp.increase} Without Ketchup` });
    await plus.click();
    await plus.click();
    await expect(without).toContainText(count(2));
    await test.info().attach("pdp-sized-stepper-min", { body: await page.screenshot(), contentType: "image/png" });

    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
    await expect.poll(() => cartRowCount(page)).toBe(1);
    const committed = await page.evaluate(
      (groupId) =>
        (
          window as unknown as {
            __kioskStore: {
              getState: () => {
                cart: { cartItems: { type: string; customizations: Record<string, { quantity: number }[]> }[] };
              };
            };
          }
        ).__kioskStore
          .getState()
          .cart.cartItems.map((row) => [row.type, row.customizations[groupId]?.map((pick) => pick.quantity)]),
      WITHOUT_GROUP,
    );
    expect(committed).toEqual([["VARIANT", [2]]]);
  });

  test("INACTIVE REQUIRED GROUP (user decision 2026-10-15, 'PAY skips inactive groups'): a size whose required group is switched off goes through PAY to the receipt; an active required group left empty is still refused at commit", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install(); // the payment step's 3 s cancel window is stepped, never slept through
    await mockKioskBackend(page, { menu: sizedInactiveRequiredGroupMenu(), kioskSettings: SKIP_CRM });
    // MUST come second (newest route wins): the pay-at-counter surface.
    const checkout = await mockCheckoutBackend(page);
    await bootRegisteredToMenu(page);
    await openPdp(page, SIZED_ITEM);
    await page.getByTestId(`pdp-variant-${SIZE_LARGE}`).click();

    // The switched-off group is not on the page; the active required one is.
    const cheese = page.getByTestId(`pdp-group-${EXTRA_CHEESE_GROUP}`);
    await expect(cheese).toContainText(en.pdp.required);
    await expect(page.getByTestId(`pdp-group-${EXTRA_GROUP}`)).toHaveCount(0);

    // The ACTIVE required group left empty: refused at commit, and named alone.
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByRole("alertdialog", { name: enLazy.pdp.incomplete.titleItem })).toHaveAccessibleDescription(
      (enLazy.pdp.incomplete.body as string).replace("{{groups}}", "choose from extra cheese for cheese burger"),
    );
    await page.getByTestId("pdp-incomplete-gotit").click();
    expect(await cartRowCount(page)).toBe(0);

    // Filled: ADD TO BAG commits; the switched-off group rides along empty.
    await page.getByTestId(`pdp-option-${ADD_CHEESE}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await dismissAddedModal(page);
    await openBag(page);

    // PAY's re-check skips it too: on to /payment — never "Some items in your
    // bag need changes" — and the order is placed with the size and its pick.
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await payAtCounter(page);
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.lastPlaceOrderBody).toMatchObject({
      items: [{ id: SIZE_LARGE, name: "Large", quantity: 1, addOns: [{ _id: ADD_CHEESE, name: "Add Cheese" }] }],
    });
    expect(checkout.forbiddenUrls).toEqual([]);
  });
});
