import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * audit-fixes UB2 + U1 on the PDP, end to end over the REAL converters and
 * customization engine with a mocked backend (pack.spec's registered-device
 * pattern):
 * - SIZE FIRST: a sized item's ADD TO BAG before a size is live and answers
 *   with the 1:2855 completion warning naming the size; nothing is
 *   committed. (It used to be a dimmed button that did nothing.)
 * - The PDP diet mark (design language): the veg / non-veg mark leads the
 *   price line; `hide_veg_non_veg` hides it.
 * - MULTI-PUNCH: with the menu's `allow_multiple_punch` on, a group whose
 *   raw bounds are 1/1 takes its multi-punch bounds (0/6): no "Required",
 *   "0 of 6", several picks, and an empty group is accepted. (On a device
 *   this is a Posist menu-setting question, Q1 — the PDP now shows what the
 *   engine enforces.)
 *
 * Fixture facts (tests/e2e/fixtures/slim-menu.json): Kiddie Meal Beef Burger
 * (tagged veg) is re-shaped into a sized item with no groups; Large Fries is
 * tagged non-veg (one optional addon group → the PDP); Cheese Burger (veg)
 * carries the "Choose From Extra" addon group (0 / 3, three options).
 */

const readJson = (relative: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8"));
const en = readJson("../../src/i18n/locales/en/translation.json");
const enLazy = readJson("../../src/i18n/locales/en/lazy.json");
const slimMenu = readJson("./fixtures/slim-menu.json");

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

// ---- Fixture ids (see header) ----
const SIZED_ITEM = "5dd1093a188e72ce1b3eb358";
const SIZE_REGULAR = "e2e-size-regular"; // £5
const SIZE_LARGE = "e2e-size-large"; // £7
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa";
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
const EXTRA_GROUP = `${CHEESE_BURGER}_1573980469_addons`;
const EXTRA_PICKLES = "5dd1093f188e72ce1b3eb36e";

type MenuJson = {
  settings: Record<string, unknown>;
  categories: { subCategories: { id: string; entities: Record<string, unknown>[] }[] }[];
  modifiers: { _id: string; constituentItems: { id: string }[]; [key: string]: unknown }[];
};

/** SIZED_ITEM as a sized item with two active sizes and no modifier groups. */
function sizedMenu(): MenuJson {
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
          ].map(([id, name, price]) => ({ id, name, price, isActive: true, subCategoryId: sub.id }));
        }
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

/** Multi-punch OFF, and Cheese Burger's "Extra" group a raw 1/1 whose item cap is 3. */
function oneOfOneMenu(): MenuJson {
  const menu = structuredClone(slimMenu) as MenuJson;
  const extra = menu.modifiers.find((group) => group._id === EXTRA_GROUP);
  if (!extra) throw new Error("fixture: no Extra group");
  Object.assign(extra, { min: 1, max: 1, multiplePunchMaxItem: 3 });
  return menu;
}

/**
 * Boot + menu mocks (copied from pack.spec.ts). Order matters: Playwright
 * matches routes newest-first, so the catch-all is registered FIRST and
 * every specific mock after it.
 */
async function mockKioskBackend(
  page: Page,
  { menu = slimMenu as unknown, kioskSettings = {} }: { menu?: unknown; kioskSettings?: Record<string, unknown> } = {},
) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // The print agent is cross-origin: the catch-all above never sees it.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: {},
      },
    }),
  );
  await page.route("**/api/cx/getCxSkinData", (r) => r.fulfill({ json: { skin_id: "skin_1" } }));
  await page.route("**/api/cx/kiosk/get_theme", (r) =>
    r.fulfill({
      json: {
        theme_color: [
          { key: "button_text_border_icon", color_hex: "#501098" },
          { key: "button_background", color_hex: "#ffffff" },
        ],
        primary_color_shades: [],
      },
    }),
  );
  await page.route("**/api/cx/get_kiosk_settings", (r) =>
    r.fulfill({
      json: { start_order_text_primary: "START ORDER", ideal_time: "180", ...kioskSettings },
    }),
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [{ _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" }],
    }),
  );
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: menu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } }),
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/cx/kiosk/get_data", (r) =>
    r.fulfill({
      json: {
        charges: [],
        deployment: { countryCode: "GB", currencySettings: { currency: "GBP", text: "£" } },
      },
    }),
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
    const options = extra.locator('[data-testid^="pdp-option-"]');
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
    const options = extra.locator('[data-testid^="pdp-option-"]');
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
});
