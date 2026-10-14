import { test, expect, freezeClock, type Locator, type Page } from "./fixtures/kiosk";
import { CHEESE_BURGER, DREAM_BOX, LARGE_FRIES, SKIP_CRM, fixtureJson, locale, mockKioskBackend } from "./fixtures/backend";
import { mockCheckoutBackend, type CheckoutMockHandle } from "./fixtures/checkout";
import { axeSweep, arabicNotIsolated, stageBox, targetProblems } from "./fixtures/a11y";
import { clippedText } from "./fixtures/clippedText";
import { settle, shot } from "./fixtures/capture";
import { bootRegisteredToMenu, chooseLanguage, pickPipelineToMenu, registerToStart, startToSecond } from "./pages/boot";
import { openBag } from "./pages/order";
import { payAtCounter } from "./pages/checkout";

/**
 * Lane addon-customize (user decisions 2026-10-09; contract v3 §10.7): a PDP option card whose item has
 * options of its own is Figma 1:5332's two-button card — CUSTOMIZE (on a pick only, 1:5333) above CHOOSE /
 * REMOVE (CHOOSE alone unpicked, 1:5334) — in every card group, `_combo` and `_addons` alike, with the
 * fork's flow and money through the shared SDK functions: a REQUIRED add-on's CHOOSE opens its customize
 * page NEW, an all-optional one lands pre-shaped, a tap on a pick edits it, a swap away from a customized
 * pick asks first, a customized pick's REMOVE asks first, and every card of such a group is 476 px.
 *
 * Fixtures (slim-menu.json, built here — no option card in either real menu qualifies today):
 * - Kiddie Meal Nuggets (£16, applyAddonsPrice true): "Herfy Snacks" `_combo` 0/2 (9 × £5), "Extra Cheese"
 *   `_addons` 0/1 (Add Cheese +£1), the Drinks slot (Pepsi Small first wherever ADD TO BAG is used).
 * - Large Fries (offered at +£3.00): its own "Without" group is OPTIONAL 0/1; "Without Salt" made +£0.50.
 * - BBQ Sauce. (offered at +£1.00): its own group made REQUIRED 1/1 ("Plain", £0).
 * - Cheese Burger (£8, applyAddonsPrice FALSE): "Extra" `_addons` 0/3.
 * Money (15 % exclusive VAT, PAY rounds to whole pounds): bag Total = round(Sub Total × 1.15).
 * The `_addons` mismatch (E4) is the fork's behaviour, asserted on purpose (contract §6.3, Q1 / S11):
 * orderBuilder drops an `_addons` add-on's own picks from the bill and the POS while the PDP and the bag
 * line include them.
 */

const en = locale("en");
const ar = locale("ar");

const KIDDIE = "5dd1093a188e72ce1b3eb359"; // £16, applyAddonsPrice true
const SNACKS = `${KIDDIE}_5_combo`; // "Herfy Snacks" 0/2 (mp 0/10), item max 1 → cards
const EXTRA_CHEESE = `${KIDDIE}_1686482941_addons`; // "Extra Cheese" 0/1: "Add Cheese" +£1
const DRINKS = `${KIDDIE}_3_combo`; // the Drinks slot (1/1, ten options)
const PEPSI_SMALL = "5dd27b527973647b693e428b";
const ADD_CHEESE = "5dd1093f188e72ce1b3eb36f";
const BURGER_EXTRA = `${CHEESE_BURGER}_1573980469_addons`; // £8, applyAddonsPrice false; 0/3
const CHILI = "696df06f5a77225b771e978a";
const DONUTS = "696df0a73173e810122fe276";
const WITHOUT_SALT = "5dff2ea756bc05b83f9e34cd";
const FRIES_OWN = `${LARGE_FRIES}_1573980470_addons`; // OPTIONAL 0/1
const BBQ = "5dd109392b29ee1f2a82a49f";
const PLAIN = "5dda6a2748c4f95e434fb5e9";
const BBQ_OWN = `${BBQ}_1573980469_addons`; // made REQUIRED 1/1
const LARGE_FRIES_AR = "بطاطس حجم  كبير"; // Large Fries' own `ar` alias (the entity's)

type Item = { id: string; name?: string; price?: number; aliases?: unknown; [key: string]: unknown };
type Group = { _id: string; constituentItems: Item[]; [key: string]: unknown };
type Menu = {
  settings: Record<string, unknown>;
  modifiers: Group[];
  categories: { subCategories: { entities: Item[] }[] }[];
};
type Pushed = {
  items: {
    rate: number;
    addOns: { _id: string; rate: number; quantity: number }[];
    mapComboItems: { _id: string; quantity: number; addOns: { _id: string; quantity: number }[] }[];
  }[];
};

function baseMenu() {
  const menu = fixtureJson("slim-menu.json") as Menu;
  const group = (id: string) => {
    const found = menu.modifiers.find((x) => x._id === id);
    if (!found) throw new Error(`fixture: no ${id}`);
    return found;
  };
  const entity = (id: string) => {
    const found = menu.categories.flatMap((c) => c.subCategories).flatMap((s) => s.entities).find((e) => e.id === id);
    if (!found) throw new Error(`fixture: no entity ${id}`);
    return found;
  };
  const withoutSalt = group(FRIES_OWN).constituentItems.find((i) => i.id === WITHOUT_SALT);
  if (!withoutSalt) throw new Error("fixture: no Without Salt");
  withoutSalt.price = 0.5;
  Object.assign(group(BBQ_OWN), { min: 1, multiplePunchMin: 1 });
  // The real cross-link shape (an entity offered inside a group: modifiers: []).
  const cross = group(`${DREAM_BOX}_2_combo`).constituentItems[0];
  const fries: Item = { ...cross, price: 3, aliases: entity(LARGE_FRIES).aliases };
  const bbq: Item = { ...cross, id: BBQ, name: "BBQ Sauce.", price: 1, aliases: entity(BBQ).aliases };
  return { menu, group, fries, bbq };
}
/** Herfy Snacks row 1: CHILI, Large Fries, BBQ — row 2 starts with DONUTS. */
const comboMenu = () => {
  const b = baseMenu();
  b.group(SNACKS).constituentItems.splice(1, 0, b.fries, b.bbq);
  return b.menu;
};
/** comboMenu with a Large Fries name that wraps to two lines (E1b). */
const LONG_FRIES = "Large Fries With Sliced Jalapeños";
const longNameMenu = () => {
  const b = baseMenu();
  b.group(SNACKS).constituentItems.splice(1, 0, { ...b.fries, name: LONG_FRIES }, b.bbq);
  return b.menu;
};
const addonsMenu = () => {
  const b = baseMenu();
  Object.assign(b.group(EXTRA_CHEESE), { max: 2, multiplePunchMax: 2 });
  b.group(EXTRA_CHEESE).constituentItems.push(b.fries, b.bbq);
  return b.menu;
};
const swapMenu = () => {
  const b = baseMenu();
  Object.assign(b.group(EXTRA_CHEESE), { min: 1, max: 1, multiplePunchMin: 1, multiplePunchMax: 1 });
  b.group(EXTRA_CHEESE).constituentItems.push(b.fries, b.bbq);
  return b.menu;
};
/** Both: the combo grid AND the swap group (E10's two dialogs in one session). */
const comboSwapMenu = () => {
  const b = baseMenu();
  b.group(SNACKS).constituentItems.splice(1, 0, b.fries, b.bbq);
  Object.assign(b.group(EXTRA_CHEESE), { min: 1, max: 1, multiplePunchMin: 1, multiplePunchMax: 1 });
  b.group(EXTRA_CHEESE).constituentItems.push(b.fries, b.bbq);
  return b.menu;
};
const burgerMenu = () => {
  const b = baseMenu();
  b.group(BURGER_EXTRA).constituentItems.push(b.fries);
  return b.menu;
};

// ---- Locators (every option locator is group-scoped: Large Fries sits in several groups) ----
const groupOf = (page: Page, gid: string) => page.getByTestId(`pdp-group-${gid}`);
const optionCard = (page: Page, gid: string, id: string) => groupOf(page, gid).getByTestId(`pdp-option-${id}`);
const lowerButton = (page: Page, gid: string, id: string) => groupOf(page, gid).getByTestId(`pdp-option-cta-${id}`);
const customizeButton = (page: Page, gid: string, id: string) => groupOf(page, gid).getByTestId(`pdp-option-customize-${id}`);
const addToBag = (page: Page) => page.getByTestId("pdp-add-to-bag");
const sheet = (page: Page) => page.getByTestId("tier2-sheet");
const tier2Option = (page: Page, id: string) => sheet(page).getByTestId(`tier2-option-${id}`);
const tapGuard = (page: Page) => page.getByTestId("pdp-tier2-tap-guard");
const count = (picked: number, max: number) =>
  en.pdp.groupCount.replace("{{count}}", String(picked)).replace("{{max}}", String(max));

// ---- Flows ----
async function boot(page: Page, menu: unknown, { checkout = false } = {}): Promise<CheckoutMockHandle | undefined> {
  await page.clock.install();
  await mockKioskBackend(page, { menu, settings: SKIP_CRM });
  const handle = checkout ? await mockCheckoutBackend(page) : undefined;
  await bootRegisteredToMenu(page);
  return handle;
}

async function openPdp(page: Page, id = KIDDIE) {
  const card = page.getByTestId(`item-${id}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
}

/** The Kiddie Meal's one required choice (its Drinks slot). */
async function pickDrink(page: Page) {
  await page.getByTestId(`pack-slot-open-${DRINKS}`).click();
  await expect(page.getByTestId("slot-sheet")).toBeVisible();
  await page.getByTestId(`slot-option-${PEPSI_SMALL}`).click();
  await page.getByTestId("slot-sheet-save").click();
  await expect(page.getByTestId("slot-sheet")).toHaveCount(0);
}

/** CUSTOMIZE (on a pick) → Without Salt → UPDATE. */
async function customizeWithoutSalt(page: Page, gid: string) {
  await customizeButton(page, gid, LARGE_FRIES).click();
  await expect(sheet(page)).toBeVisible();
  await tier2Option(page, WITHOUT_SALT).click();
  await page.getByTestId("tier2-sheet-save").click();
  await expect(sheet(page)).toHaveCount(0);
}

async function addToBagAndOpen(page: Page, expected: string) {
  await expect(addToBag(page)).toContainText(expected);
  await addToBag(page).click();
  await expect(page.getByTestId("product-added-modal")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
  await openBag(page);
}

async function payAndPlace(page: Page, checkout: CheckoutMockHandle | undefined): Promise<Pushed> {
  if (!checkout) throw new Error("boot without the checkout mock");
  await page.getByTestId("bag-pay").click();
  await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
  await payAtCounter(page);
  await page.getByTestId("receipt-none").click();
  await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
  expect(checkout.placeOrderCount).toBe(1);
  return checkout.lastPlaceOrderBody as Pushed;
}

/** A box relative to its card (design px = CSS px: the stage is 1:1 at 1080 × 1920). */
async function within(cardLocator: Locator, child: Locator) {
  const [outer, inner] = await Promise.all([cardLocator.boundingBox(), child.boundingBox()]);
  if (!outer || !inner) throw new Error("no box");
  return {
    x: Math.round(inner.x - outer.x),
    y: Math.round(inner.y - outer.y),
    width: Math.round(inner.width),
    height: Math.round(inner.height),
  };
}
const roundedBox = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
};
const nameTop = (cardLocator: Locator, name: string) =>
  cardLocator.evaluate((el, label) => {
    const span = [...el.querySelectorAll("span")].find((s) => s.textContent === label);
    return Math.round((span?.getBoundingClientRect().top ?? Number.NaN) - el.getBoundingClientRect().top);
  }, name);
const ctaLook = (locator: Locator) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.borderTopWidth, s.borderTopColor, s.borderTopLeftRadius, s.color, s.fontSize, s.lineHeight, s.fontWeight, s.textTransform];
  });
const centre = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const testIdAt = (page: Page, point: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid") ?? null, point);
/** The card alone (capture-only, 328 × 476 — beside Figma 1:5333 / 1:5334). */
async function cardShot(locator: Locator, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await locator.screenshot({ path, animations: "disabled", caret: "hide" });
  await test.info().attach(name, { path, contentType: "image/png" });
}
/** The whole card in the PDP pane (the shots frame row 1; the group is taller than the pane). */
const centreInPane = (locator: Locator) => locator.evaluate((el) => el.scrollIntoView({ block: "center" }));

test.describe("PDP add-on CUSTOMIZE — Figma 1:5332's two-button card, the fork's flow (lane addon-customize)", () => {
  test("E1 LAYOUT (1:5332 / 1:5333 / 1:5334): the whole Herfy Snacks group is 328 × 476 — row 2 too; CHOOSE alone unpicked at (24, 392); picked: CUSTOMIZE (24, 316) above REMOVE (24, 392), one look; nothing moves", async ({
    page,
  }) => {
    test.slow();
    await boot(page, comboMenu());
    await openPdp(page);
    await centreInPane(optionCard(page, SNACKS, LARGE_FRIES));
    const ids = [CHILI, LARGE_FRIES, BBQ, DONUTS];
    const boxes = () => Promise.all(ids.map((id) => roundedBox(optionCard(page, SNACKS, id))));

    const before = await boxes();
    for (const [, , width, height] of before) expect([width, height]).toEqual([328, 476]);
    expect(before[3][1], "DONUTS opens row 2").toBeGreaterThan(before[0][1]);
    for (const id of [LARGE_FRIES, BBQ]) {
      expect(await within(optionCard(page, SNACKS, id), lowerButton(page, SNACKS, id))).toEqual({ x: 24, y: 392, width: 280, height: 60 });
      await expect(customizeButton(page, SNACKS, id)).toHaveCount(0);
      await expect(lowerButton(page, SNACKS, id)).toHaveText(en.pack.choose);
    }
    expect(await nameTop(optionCard(page, SNACKS, LARGE_FRIES), "Large Fries")).toBe(242);
    // Extra Cheese holds no such card: 400.
    expect((await roundedBox(optionCard(page, EXTRA_CHEESE, ADD_CHEESE)))[3]).toBe(400);
    await settle(page);
    await shot(page, "addon-en-unpicked");
    await cardShot(optionCard(page, SNACKS, LARGE_FRIES), "card-en-unpicked");

    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
    await expect(lowerButton(page, SNACKS, LARGE_FRIES)).toHaveText(en.pack.remove);
    await settle(page);
    const fries = optionCard(page, SNACKS, LARGE_FRIES);
    expect(await within(fries, customizeButton(page, SNACKS, LARGE_FRIES))).toEqual({ x: 24, y: 316, width: 280, height: 60 });
    expect(await within(fries, lowerButton(page, SNACKS, LARGE_FRIES))).toEqual({ x: 24, y: 392, width: 280, height: 60 });
    const look = ["1px", "rgb(80, 16, 152)", "4px", "rgb(80, 16, 152)", "18px", "16px", "900", "uppercase"];
    expect(await ctaLook(customizeButton(page, SNACKS, LARGE_FRIES))).toEqual(look);
    expect(await ctaLook(lowerButton(page, SNACKS, LARGE_FRIES))).toEqual(look);
    // "Selected" is CUSTOMIZE's description only — never stray text read again after REMOVE.
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toHaveAccessibleDescription(`${en.pdp.selected} +£3.00`);
    expect(await fries.ariaSnapshot()).not.toContain(en.pdp.selected);
    expect(await nameTop(fries, "Large Fries")).toBe(242);
    expect(await boxes()).toEqual(before);
    await shot(page, "addon-en-picked");
    await cardShot(optionCard(page, SNACKS, LARGE_FRIES), "card-en-picked");

    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toHaveCount(0);
    expect(await boxes()).toEqual(before);
  });

  test("E1b LONG NAME: a two-line name sits at card y 220 picked or not — CUSTOMIZE's box is kept while unpicked, so a pick never moves the name, the card or the row", async ({
    page,
  }) => {
    await boot(page, longNameMenu());
    await openPdp(page);
    const fries = optionCard(page, SNACKS, LARGE_FRIES);
    await centreInPane(fries);
    const ids = [CHILI, LARGE_FRIES, BBQ, DONUTS];
    const boxes = () => Promise.all(ids.map((id) => roundedBox(optionCard(page, SNACKS, id))));
    const lines = () =>
      fries.evaluate((el, label) => {
        const span = [...el.querySelectorAll("span")].find((s) => s.textContent === label);
        return Math.round((span?.getBoundingClientRect().height ?? Number.NaN) / 24);
      }, LONG_FRIES);
    expect(await lines(), "the fixture name wraps").toBe(2);
    const before = await boxes();
    expect(await nameTop(fries, LONG_FRIES)).toBe(220);

    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
    expect(await nameTop(fries, LONG_FRIES)).toBe(220);
    expect(await boxes()).toEqual(before);
    expect(await within(fries, customizeButton(page, SNACKS, LARGE_FRIES))).toEqual({ x: 24, y: 316, width: 280, height: 60 });
    expect(await within(fries, lowerButton(page, SNACKS, LARGE_FRIES))).toEqual({ x: 24, y: 392, width: 280, height: 60 });
  });

  test("E2 `_combo` MONEY (G1): CHOOSE £19.00 → CUSTOMIZE £3.00 → Without Salt £3.50 → UPDATE £19.50; bag +£3.00 / +£0.50, Sub Total £19.50, PAY £22.00; the POS item rate 19.5 with Without Salt nested under Large Fries", async ({
    page,
  }) => {
    test.slow();
    const checkout = await boot(page, comboMenu(), { checkout: true });
    await openPdp(page);
    await pickDrink(page);

    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await expect(addToBag(page)).toContainText("£19.00");
    await customizeButton(page, SNACKS, LARGE_FRIES).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText(en.pack.customize);
    await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText("Large Fries");
    await expect(page.getByTestId("tier2-price-line")).toContainText("£3.00");
    await tier2Option(page, WITHOUT_SALT).click();
    await expect(page.getByTestId("tier2-price-line")).toContainText("£3.50");
    await page.getByTestId("tier2-sheet-save").click();
    await expect(sheet(page)).toHaveCount(0);

    await expect(lowerButton(page, SNACKS, LARGE_FRIES)).toHaveText(en.pack.remove);
    await expect(groupOf(page, SNACKS)).toContainText(count(1, 2));
    await addToBagAndOpen(page, "£19.50");

    const row = page.locator('[data-testid^="bag-row-"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Large Fries +£3.00");
    await expect(row).toContainText("Without Salt +£0.50");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£19.50");
    await expect(page.getByTestId("bag-pay")).toContainText("£22.00");

    const pushed = await payAndPlace(page, checkout);
    expect(pushed.items[0].rate).toBe(19.5);
    const fries = pushed.items[0].mapComboItems.find((m) => m._id === LARGE_FRIES);
    expect(fries).toMatchObject({ quantity: 1, addOns: [{ _id: WITHOUT_SALT, quantity: 1 }] });
  });

  test("E3 `_combo` REQUIRED (G3): CHOOSE opens the page; BACK commits nothing; an empty UPDATE is refused; Plain → UPDATE £17.00 → PAY: BBQ goes to the kitchen with Plain", async ({
    page,
  }) => {
    test.slow();
    const checkout = await boot(page, comboMenu(), { checkout: true });
    await openPdp(page);
    await pickDrink(page);

    await lowerButton(page, SNACKS, BBQ).click();
    await expect(sheet(page)).toBeVisible();
    await page.getByTestId("tier2-sheet-close").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByTestId("tier2-discard-overlay")).toHaveCount(0);
    await expect(lowerButton(page, SNACKS, BBQ)).toHaveText(en.pack.choose);
    await expect(groupOf(page, SNACKS)).toContainText(count(0, 2));

    await lowerButton(page, SNACKS, BBQ).click();
    await expect(sheet(page)).toBeVisible();
    // TB's own validation: the fork would pre-pick this fixed one-option group (contract A9 / R15).
    await page.getByTestId("tier2-sheet-save").click();
    await expect(page.getByTestId("global-error")).toContainText(en.pdp.customizationErrors);
    await page.getByTestId("global-error-ok").click();
    await tier2Option(page, PLAIN).click();
    await page.getByTestId("tier2-sheet-save").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(customizeButton(page, SNACKS, BBQ)).toBeVisible();
    await addToBagAndOpen(page, "£17.00");

    const pushed = await payAndPlace(page, checkout);
    expect(pushed.items[0].rate).toBe(17);
    expect(pushed.items[0].mapComboItems.find((m) => m._id === BBQ)).toMatchObject({ addOns: [{ _id: PLAIN }] });
  });

  test("E4 `_addons` MONEY — the documented mismatch (G2 + G4, contract §6.3 / Q1): PDP and bag line £20.50, Sub Total £20.00; the POS gets the add-ons flat and NEITHER own pick", async ({
    page,
  }) => {
    test.slow();
    const checkout = await boot(page, addonsMenu(), { checkout: true });
    await openPdp(page);
    await pickDrink(page);

    await lowerButton(page, EXTRA_CHEESE, LARGE_FRIES).click();
    await customizeWithoutSalt(page, EXTRA_CHEESE);
    await lowerButton(page, EXTRA_CHEESE, BBQ).click();
    await expect(sheet(page)).toBeVisible();
    await tier2Option(page, PLAIN).click();
    await page.getByTestId("tier2-sheet-save").click();
    await expect(sheet(page)).toHaveCount(0);
    await addToBagAndOpen(page, "£20.50");

    const row = page.locator('[data-testid^="bag-row-"]');
    await expect(row).toContainText("£20.50");
    // ASSERTED ON PURPOSE: this changes when the backend answers Q1.
    await expect(page.getByTestId("bag-subtotal")).toContainText("£20.00");

    const pushed = await payAndPlace(page, checkout);
    expect(pushed.items[0].rate).toBe(16);
    expect(pushed.items[0].addOns.map(({ _id, rate, quantity }) => ({ _id, rate, quantity }))).toEqual([
      { _id: LARGE_FRIES, rate: 3, quantity: 1 },
      { _id: BBQ, rate: 1, quantity: 1 },
    ]);
    const body = JSON.stringify(checkout?.lastPlaceOrderBody);
    expect(body).not.toContain(WITHOUT_SALT);
    expect(body).not.toContain(PLAIN);
  });

  test("E5 REMOVE CONFIRM (decision 5): REMOVE on a customized pick asks (focus on NO, KEEP IT — the safe choice); NO keeps it, YES drops it; a plain pick's REMOVE is immediate", async ({
    page,
  }) => {
    test.slow();
    await boot(page, comboMenu());
    await openPdp(page);
    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await customizeWithoutSalt(page, SNACKS);
    await expect(addToBag(page)).toContainText("£19.50");

    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    const dialog = page.getByTestId("pdp-addon-remove");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(en.pdp.discardTitle);
    await expect(dialog).toContainText(en.pdp.discardBody);
    await expect(page.getByTestId("pdp-addon-remove-cancel")).toHaveText(en.pdp.keepItem);
    await expect(page.getByTestId("pdp-addon-remove-confirm")).toHaveText(en.pdp.removeThisItem);
    // Focus on NO, KEEP IT — the safe choice (walk 2026-10-14).
    await expect(page.getByTestId("pdp-addon-remove-cancel")).toBeFocused();
    expect(await clippedText(page)).toEqual([]);
    await settle(page);
    await shot(page, "addon-en-remove-confirm");
    await page.getByTestId("pdp-addon-remove-cancel").click();
    await expect(dialog).toHaveCount(0);
    await expect(addToBag(page)).toContainText("£19.50");

    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await page.getByTestId("pdp-addon-remove-confirm").click();
    await expect(dialog).toHaveCount(0);
    await expect(addToBag(page)).toContainText("£16.00");
    await expect(groupOf(page, SNACKS)).toContainText(count(0, 2));

    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await expect(dialog).toHaveCount(0);
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toHaveCount(0);
    await expect(addToBag(page)).toContainText("£16.00");
  });

  test("E6 REPLACE PROMPT (the fork's replace-item): swapping away from a customized pick asks — a plain card too; a REQUIRED card over a plain pick opens the page with no prompt (A3); BACK keeps the old pick", async ({
    page,
  }) => {
    test.slow();
    await boot(page, swapMenu());
    await openPdp(page);
    const replace = page.getByTestId("pdp-addon-replace");
    const title = (name: string) => en.pdp.replaceTitle.replace("{{name}}", name);

    await lowerButton(page, EXTRA_CHEESE, LARGE_FRIES).click();
    await expect(replace).toHaveCount(0);
    await customizeWithoutSalt(page, EXTRA_CHEESE);

    await optionCard(page, EXTRA_CHEESE, ADD_CHEESE).click();
    await expect(replace).toContainText(title("Large Fries"));
    await expect(page.getByTestId("pdp-addon-replace-confirm")).toHaveText(en.pdp.replaceConfirm);
    expect(await clippedText(page)).toEqual([]);
    await settle(page);
    await shot(page, "addon-en-replace-prompt");
    await page.getByTestId("pdp-addon-replace-cancel").click();
    await expect(replace).toHaveCount(0);
    await expect(customizeButton(page, EXTRA_CHEESE, LARGE_FRIES)).toBeVisible();
    await optionCard(page, EXTRA_CHEESE, ADD_CHEESE).click();
    await page.getByTestId("pdp-addon-replace-confirm").click();
    await expect(optionCard(page, EXTRA_CHEESE, ADD_CHEESE)).toHaveAttribute("aria-pressed", "true");
    await expect(customizeButton(page, EXTRA_CHEESE, LARGE_FRIES)).toHaveCount(0);

    await lowerButton(page, EXTRA_CHEESE, BBQ).click();
    await expect(replace).toHaveCount(0);
    await expect(sheet(page)).toBeVisible();
    await page.getByTestId("tier2-sheet-close").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(optionCard(page, EXTRA_CHEESE, ADD_CHEESE)).toHaveAttribute("aria-pressed", "true");

    await lowerButton(page, EXTRA_CHEESE, LARGE_FRIES).click();
    await expect(replace).toHaveCount(0);
    await customizeWithoutSalt(page, EXTRA_CHEESE);
    await lowerButton(page, EXTRA_CHEESE, BBQ).click();
    await expect(replace).toContainText(title("Large Fries"));
    await page.getByTestId("pdp-addon-replace-confirm").click();
    await expect(sheet(page)).toBeVisible();
    await page.getByTestId("tier2-sheet-close").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(customizeButton(page, EXTRA_CHEESE, LARGE_FRIES)).toBeVisible();
    await expect(addToBag(page)).toContainText("£19.50");

    await lowerButton(page, EXTRA_CHEESE, BBQ).click();
    await page.getByTestId("pdp-addon-replace-confirm").click();
    await tier2Option(page, PLAIN).click();
    await page.getByTestId("tier2-sheet-save").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(customizeButton(page, EXTRA_CHEESE, BBQ)).toBeVisible();
    await expect(customizeButton(page, EXTRA_CHEESE, LARGE_FRIES)).toHaveCount(0);
    await expect(addToBag(page)).toContainText("£17.00");
  });

  test("E7 GROUP FULL: with 2 of 2 picked, CHOOSE on a REQUIRED or an all-optional add-on is refused out loud — no page, no row", async ({
    page,
  }) => {
    test.slow();
    await boot(page, comboMenu());
    await openPdp(page);
    await optionCard(page, SNACKS, CHILI).click();
    await optionCard(page, SNACKS, DONUTS).click();
    await expect(addToBag(page)).toContainText("£26.00");
    await expect(groupOf(page, SNACKS)).toContainText(count(2, 2));
    const refusal = en.pdp.groupMaxReached.replace("{{max}}", "2").replace("{{group}}", "Herfy Snacks");

    for (const id of [BBQ, LARGE_FRIES]) {
      await lowerButton(page, SNACKS, id).click();
      await expect(page.getByTestId("global-error")).toContainText(refusal);
      await expect(sheet(page)).toHaveCount(0);
      await page.getByTestId("global-error-ok").click();
      await expect(lowerButton(page, SNACKS, id)).toHaveText(en.pack.choose);
    }
    await expect(addToBag(page)).toContainText("£26.00");
  });

  test("E8 applyAddonsPrice FALSE (G5, §3.5, §7): Cheese Burger's CUSTOMIZE page shows no own-pick price; the bag's sub-line claims none; the POS gets Large Fries flat and no Without Salt", async ({
    page,
  }) => {
    test.slow();
    const checkout = await boot(page, burgerMenu(), { checkout: true });
    await openPdp(page, CHEESE_BURGER);

    await lowerButton(page, BURGER_EXTRA, LARGE_FRIES).click();
    await expect(addToBag(page)).toContainText("£11.00");
    await customizeButton(page, BURGER_EXTRA, LARGE_FRIES).click();
    await expect(sheet(page)).toBeVisible();
    await expect(tier2Option(page, WITHOUT_SALT)).toBeVisible();
    await expect(page.getByTestId("tier2-price-line")).not.toContainText("£");
    await expect(tier2Option(page, WITHOUT_SALT)).not.toContainText("+£");
    await tier2Option(page, WITHOUT_SALT).click();
    await page.getByTestId("tier2-sheet-save").click();
    await expect(sheet(page)).toHaveCount(0);
    await addToBagAndOpen(page, "£11.00");

    const row = page.locator('[data-testid^="bag-row-"]');
    await expect(row).toContainText("Without Salt");
    await expect(row).not.toContainText("Without Salt +£");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£11.00");

    const pushed = await payAndPlace(page, checkout);
    expect(pushed.items[0].addOns.map((a) => a._id)).toEqual([LARGE_FRIES]);
    expect(JSON.stringify(checkout?.lastPlaceOrderBody)).not.toContain(WITHOUT_SALT);
  });

  test("E9 DOUBLE TAPS (D13): a double tap on the page's BACK or on a prompt's NO never reaches the PDP under it — the 500 ms tap guard", async ({
    page,
  }) => {
    test.slow();
    await boot(page, comboMenu());
    await openPdp(page);
    await lowerButton(page, SNACKS, LARGE_FRIES).click();

    // (a) The page's BACK overlaps the PDP's BACK by 92 px.
    await customizeButton(page, SNACKS, LARGE_FRIES).click();
    await expect(sheet(page)).toBeVisible();
    await page.getByTestId("tier2-sheet-close").dblclick();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
    await expect(addToBag(page)).toContainText("£19.00");
    await expect(tapGuard(page)).toHaveCount(0);
    // The deterministic twin: one click, the clock held — the guard sits where BACK was.
    await customizeButton(page, SNACKS, LARGE_FRIES).click();
    await expect(sheet(page)).toBeVisible();
    const backAt = await centre(page.getByTestId("tier2-sheet-close"));
    await freezeClock(page);
    await page.getByTestId("tier2-sheet-close").click();
    expect(await testIdAt(page, backAt)).toBe("pdp-tier2-tap-guard");
    await page.clock.resume();
    await expect(tapGuard(page)).toHaveCount(0);

    // (b) A prompt's NO sits over the option grid.
    await customizeWithoutSalt(page, SNACKS);
    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await page.getByTestId("pdp-addon-remove-cancel").dblclick();
    await expect(page.getByTestId("pdp-addon-remove")).toHaveCount(0);
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
    await expect(addToBag(page)).toContainText("£19.50");
    await expect(groupOf(page, SNACKS)).toContainText(count(1, 2));
    await expect(tapGuard(page)).toHaveCount(0);
    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    const noAt = await centre(page.getByTestId("pdp-addon-remove-cancel"));
    await freezeClock(page);
    await page.getByTestId("pdp-addon-remove-cancel").click();
    expect(await testIdAt(page, noAt)).toBe("pdp-tier2-tap-guard");
    await page.clock.resume();
    await expect(tapGuard(page)).toHaveCount(0);
  });

  test("E10a ARABIC + COPY FIT: CUSTOMIZE, both dialogs and their 280 px buttons in Arabic — isolated, nothing clipped", async ({ page }) => {
    test.slow();
    await page.clock.install();
    await mockKioskBackend(page, { menu: comboSwapMenu(), settings: SKIP_CRM, arabic: true });
    await registerToStart(page);
    await startToSecond(page);
    await chooseLanguage(page, "ar");
    await pickPipelineToMenu(page);
    await openPdp(page);

    await expect(lowerButton(page, SNACKS, LARGE_FRIES)).toContainText(ar.pack.choose);
    await centreInPane(optionCard(page, SNACKS, LARGE_FRIES));
    await settle(page);
    await shot(page, "addon-ar-unpicked");
    await cardShot(optionCard(page, SNACKS, LARGE_FRIES), "card-ar-unpicked");
    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    const customize = customizeButton(page, SNACKS, LARGE_FRIES);
    await expect(customize).toContainText(ar.pack.customize);
    expect(await customize.getAttribute("aria-label")).toContain(LARGE_FRIES_AR);
    await expect(lowerButton(page, SNACKS, LARGE_FRIES)).toContainText(ar.pack.remove);
    expect(await arabicNotIsolated(page)).toEqual([]);
    expect(await clippedText(page)).toEqual([]);
    await settle(page);
    await shot(page, "addon-ar-picked");
    await cardShot(optionCard(page, SNACKS, LARGE_FRIES), "card-ar-picked");

    await customizeWithoutSalt(page, SNACKS);
    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    const remove = page.getByTestId("pdp-addon-remove");
    for (const copy of [ar.pdp.discardTitle, ar.pdp.discardBody, ar.pdp.keepItem, ar.pdp.removeThisItem]) {
      await expect(remove).toContainText(copy);
    }
    expect(await arabicNotIsolated(page)).toEqual([]);
    expect(await clippedText(page)).toEqual([]);
    await settle(page);
    await shot(page, "addon-ar-remove-confirm");
    await page.getByTestId("pdp-addon-remove-cancel").click();

    await lowerButton(page, EXTRA_CHEESE, LARGE_FRIES).click();
    await customizeWithoutSalt(page, EXTRA_CHEESE);
    await optionCard(page, EXTRA_CHEESE, ADD_CHEESE).click();
    const replace = page.getByTestId("pdp-addon-replace");
    for (const copy of [ar.pdp.discardBody, ar.pdp.keepItem, ar.pdp.replaceConfirm]) {
      await expect(replace).toContainText(copy);
    }
    for (const word of ar.pdp.replaceTitle.split("{{name}}").map((part: string) => part.trim()).filter(Boolean)) {
      await expect(replace).toContainText(word);
    }
    await expect(replace).toContainText(LARGE_FRIES_AR);
    expect(await arabicNotIsolated(page)).toEqual([]);
    expect(await clippedText(page)).toEqual([]);
    await settle(page);
    await shot(page, "addon-ar-replace-prompt");
    await page.getByTestId("pdp-addon-replace-cancel").click();
  });

  test("E10b ADA + AXE: in the reach zone the tall card fits and works (CHOOSE → CUSTOMIZE → UPDATE); every target ≥ 44 px; axe finds nothing on the card or the remove dialog", async ({
    page,
  }) => {
    test.slow();
    await boot(page, comboMenu());
    await openPdp(page);
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();

    const fries = optionCard(page, SNACKS, LARGE_FRIES);
    await fries.scrollIntoViewIfNeeded();
    await settle(page);
    await shot(page, "addon-ada-unpicked");
    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
    await settle(page);
    const scroller = await stageBox(page.locator("#scrollCustomizableItem"));
    const card = await stageBox(fries);
    expect(card.height).toBe(476);
    expect(scroller.height, "the ADA scroller holds a whole tall card").toBeGreaterThanOrEqual(476);
    await expect(fries).toBeInViewport({ ratio: 1 });
    await shot(page, "addon-ada-picked");
    await expect.poll(() => targetProblems(page)).toEqual([]);
    expect(await axeSweep(page, "pdp-addon-customize")).toEqual([]);

    await customizeButton(page, SNACKS, LARGE_FRIES).click();
    await expect(sheet(page)).toBeVisible();
    await tier2Option(page, WITHOUT_SALT).click();
    await page.getByTestId("tier2-sheet-save").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(addToBag(page)).toContainText("£19.50");

    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await expect(page.getByTestId("pdp-addon-remove")).toBeVisible();
    await settle(page);
    await shot(page, "addon-ada-remove-confirm");
    expect(await axeSweep(page, "pdp-addon-remove-dialog")).toEqual([]);
    await expect.poll(() => targetProblems(page)).toEqual([]);
    await page.getByTestId("pdp-addon-remove-cancel").click();
  });

  test("E11 BODY TAP (the pointer-only overlay): the photo of an unpicked card is CHOOSE; on a pick the photo, and the gap between the buttons, open EDIT — never the remove prompt", async ({
    page,
  }) => {
    test.slow();
    await boot(page, comboMenu());
    await openPdp(page);
    const fries = optionCard(page, SNACKS, LARGE_FRIES);
    await fries.scrollIntoViewIfNeeded();
    const at = async (dx: number, dy: number) => {
      const box = await fries.boundingBox();
      if (!box) throw new Error("no card box");
      await page.mouse.click(box.x + dx, box.y + dy);
    };

    await at(164, 110); // the photo
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
    await customizeWithoutSalt(page, SNACKS);
    await expect(tapGuard(page)).toHaveCount(0);

    await at(164, 110);
    await expect(sheet(page)).toBeVisible();
    await expect(tier2Option(page, WITHOUT_SALT)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("pdp-addon-remove")).toHaveCount(0);
    await page.getByTestId("tier2-sheet-close").click();
    await expect(tapGuard(page)).toHaveCount(0);

    await at(164, 384); // the 16 px gap between CUSTOMIZE (316–376) and REMOVE (392–452)
    await expect(sheet(page)).toBeVisible();
    await expect(page.getByTestId("pdp-addon-remove")).toHaveCount(0);
    await page.getByTestId("tier2-sheet-close").click();
    await expect(addToBag(page)).toContainText("£19.50");
  });

  test("E11b BODY TAP on a SWAP pick opens EDIT too; BACK leaves the pick and its own pick", async ({ page }) => {
    test.slow();
    await boot(page, swapMenu());
    await openPdp(page);
    await lowerButton(page, EXTRA_CHEESE, LARGE_FRIES).click();
    await customizeWithoutSalt(page, EXTRA_CHEESE);
    await expect(tapGuard(page)).toHaveCount(0);
    const fries = optionCard(page, EXTRA_CHEESE, LARGE_FRIES);
    await fries.scrollIntoViewIfNeeded();
    const box = await fries.boundingBox();
    if (!box) throw new Error("no card box");

    await page.mouse.click(box.x + 164, box.y + 110);
    await expect(sheet(page)).toBeVisible();
    await expect(tier2Option(page, WITHOUT_SALT)).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("tier2-sheet-close").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(customizeButton(page, EXTRA_CHEESE, LARGE_FRIES)).toBeVisible();
    await expect(addToBag(page)).toContainText("£19.50");
  });

  test("E12 EDIT FROM BAG: the bag's Edit reopens the PDP with CUSTOMIZE + REMOVE on the add-on; CUSTOMIZE shows Without Salt picked; deselect → UPDATE → UPDATE: the line is £19.00 with no Without Salt", async ({
    page,
  }) => {
    test.slow();
    await boot(page, comboMenu());
    await openPdp(page);
    await pickDrink(page);
    await lowerButton(page, SNACKS, LARGE_FRIES).click();
    await customizeWithoutSalt(page, SNACKS);
    await addToBagAndOpen(page, "£19.50");

    await page.locator('[data-testid^="bag-edit-"]').first().click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
    await expect(lowerButton(page, SNACKS, LARGE_FRIES)).toHaveText(en.pack.remove);
    await customizeButton(page, SNACKS, LARGE_FRIES).click();
    await expect(tier2Option(page, WITHOUT_SALT)).toHaveAttribute("aria-pressed", "true");
    await tier2Option(page, WITHOUT_SALT).click();
    await page.getByTestId("tier2-sheet-save").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(addToBag(page)).toContainText("£19.00");
    await addToBag(page).click();

    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    const row = page.locator('[data-testid^="bag-row-"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("£19.00");
    await expect(row).toContainText("Large Fries +£3.00");
    await expect(row).not.toContainText("Without Salt");
  });

  // The kiosk's real input: Chromium hit-tests a touch tap AFTER :active applies (index.css), which a
  // dispatched touch event never sets — only the synthetic gesture pipeline does.
  test.describe("held touch (CDP Input.synthesizeTapGesture, hasTouch), motion on", () => {
    test.use({ hasTouch: true });

    test("E13 HELD PRESS: 300 ms in the gap's lower half opens EDIT (the squeezed card lifts REMOVE under the finger); 300 ms 2 px inside REMOVE's edge removes the pick (the shrunken REMOVE keeps its hit area)", async ({
      page,
    }) => {
      test.slow();
      await boot(page, comboMenu());
      await openPdp(page);
      await lowerButton(page, SNACKS, LARGE_FRIES).click();
      await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
      await expect(addToBag(page)).toContainText("£19.00");

      await page.emulateMedia({ reducedMotion: "no-preference" });
      const fries = optionCard(page, SNACKS, LARGE_FRIES);
      await centreInPane(fries);
      await settle(page);
      const cdp = await page.context().newCDPSession(page);
      const heldTouch = (x: number, y: number) =>
        cdp.send("Input.synthesizeTapGesture", { x, y, duration: 300, tapCount: 1, gestureSourceType: "touch" });

      // Card y 389: the gap at rest (CUSTOMIZE 316–376, REMOVE 392–452); squeezed to 0.97, REMOVE's top is 387.4.
      const card = await fries.boundingBox();
      if (!card) throw new Error("no card box");
      const gap = { x: card.x + 164, y: card.y + 389 };
      expect(await testIdAt(page, gap)).toBe(`pdp-option-select-${LARGE_FRIES}`);
      await heldTouch(gap.x, gap.y);
      await expect(sheet(page)).toBeVisible();
      await page.getByTestId("tier2-sheet-close").click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(tapGuard(page)).toHaveCount(0);
      await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toBeVisible();
      await expect(addToBag(page)).toContainText("£19.00");

      // REMOVE's left edge + 2 px: pressed, REMOVE shrinks 4.2 px off that point.
      await settle(page);
      const remove = await lowerButton(page, SNACKS, LARGE_FRIES).boundingBox();
      if (!remove) throw new Error("no REMOVE box");
      await heldTouch(remove.x + 2, remove.y + remove.height / 2);
      await expect(customizeButton(page, SNACKS, LARGE_FRIES)).toHaveCount(0);
      await expect(lowerButton(page, SNACKS, LARGE_FRIES)).toHaveText(en.pack.choose);
      await expect(sheet(page)).toHaveCount(0);
      await expect(addToBag(page)).toContainText("£16.00");
    });
  });
});
