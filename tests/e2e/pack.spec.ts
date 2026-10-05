import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * P6c — Order-a-Pack (slot cards + SELECT sheet + tier-2 nested customize)
 * and the MIAM "Make it a meal" upsell prompt, driven end-to-end over the
 * REAL converters + customization engine with a mocked backend (same
 * registered-device pattern as registration.spec.ts).
 *
 * Fixture facts (tests/e2e/fixtures/slim-menu.json, P6c edits applied):
 * - "Dream box 1," (68dd79409030ed3064aee28c, £25, applyAddonsPrice) carries
 *   four min1/max1 `_combo` slot groups — Sandwich(_1)/Sides(_2)/Drinks(_3)/
 *   Nuggets(_5) — plus the BYO-shaped "Snacks" (_6, min0/max2) which must
 *   stay on the generic group rendering.
 * - Sides' only constituent is Large Fries (5dd10938eb1ccee31ca352fa), whose
 *   entity carries the "Choose From Without for Large Fries" addon group
 *   (min0/max1, "Without Salt") → tier-2 capable → Customize link renders.
 * - Cheese Burger (5dd10936712f5b622a66aab7, £8, 3 modifier groups) has
 *   upsellItems = [Dream box 1,] → MIAM "upsell" intent once the
 *   `enable_combo_upsell` kiosk setting is on.
 * All slot picks are price 0 and no priced addon is selected in these flows,
 * so the committed pack total is exactly the base price: £25.00.
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
const DREAM_BOX = "68dd79409030ed3064aee28c";
const G_SANDWICH = `${DREAM_BOX}_1_combo`;
const G_SIDES = `${DREAM_BOX}_2_combo`;
const G_DRINKS = `${DREAM_BOX}_3_combo`;
const G_NUGGETS = `${DREAM_BOX}_5_combo`;
const G_SNACKS = `${DREAM_BOX}_6_combo`;
const SANDWICH_PICK = "65d4a2d2003967427ed83616"; // Double Max Burger + Nachos Burger
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa";
const FRIES_ADDON_GROUP = `${LARGE_FRIES}_1573980470_addons`;
const WITHOUT_SALT = "5dff2ea756bc05b83f9e34cd";
const PEPSI_SMALL = "5dd27b527973647b693e428b";
const NUGGETS_PICK = "66e952596dd4d13b6564a528"; // 4Pcs Nuggets + Bbq Sauce
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";

/**
 * Boot + menu mocks. Order matters: Playwright matches routes newest-first,
 * so the catch-all is registered FIRST and every specific mock after it.
 * `comboUpsell` adds the top-level `enable_combo_upsell` flag to the
 * get_kiosk_settings payload — the exact field useAddEntityToCart's upsell
 * gate reads out of state.appSettings.kiosk_settings.
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

/** Register on the on-screen keyboard and land on /menu (converted fixture). */
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

/** Menu card tap → modifiers intent → pack PDP with the slot grid up. */
async function openDreamBoxPack(page: Page) {
  const card = page.getByTestId(`item-${DREAM_BOX}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
}

/** Open one slot's SELECT sheet, pick an option by id, SAVE. */
async function pickSlot(page: Page, groupId: string, itemId: string) {
  await page.getByTestId(`pack-slot-open-${groupId}`).click();
  await expect(page.getByTestId("slot-sheet")).toBeVisible();
  await page.getByTestId(`slot-option-${itemId}`).click();
  await page.getByTestId("slot-sheet-save").click();
  await expect(page.getByTestId("slot-sheet")).not.toBeVisible();
}

test.describe("P6c pack PDP (slot cards + SELECT sheet + tier-2 customize)", () => {
  test("Dream box: slot cards render, Drinks pick via sheet, Sides customized through tier-2, full pack commits at £25.00", async ({
    page,
  }) => {
    // Long multi-surface flow (registration → 4 slot sheets + tier-2 → cart).
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await openDreamBoxPack(page);

    // The four min1/max1 `_combo` groups are slot cards…
    await expect(page.getByTestId(`pack-slot-${G_SANDWICH}`)).toBeVisible();
    await expect(page.getByTestId(`pack-slot-${G_SIDES}`)).toBeVisible();
    await expect(page.getByTestId(`pack-slot-${G_DRINKS}`)).toBeVisible();
    await expect(page.getByTestId(`pack-slot-${G_NUGGETS}`)).toBeVisible();
    // …while the BYO-shaped "Snacks" (min0/max2) stays on the classic
    // group rendering, never a slot card.
    await expect(page.getByTestId(`pack-slot-${G_SNACKS}`)).toHaveCount(0);
    const snacks = page.getByTestId(`pdp-group-${G_SNACKS}`);
    await expect(snacks).toContainText("Snacks");
    await expect(snacks).toContainText("3 pcs Chili Cheese Nuggets.");
    await expect(snacks).toContainText("3 pcs Mini Smoky Cheese Donuts.");

    // Base price on the CTA before any pick (all constituents are price 0).
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£25.00");

    // --- Drinks slot: 6 included options, pick Pepsi Small ---
    await page.getByTestId(`pack-slot-open-${G_DRINKS}`).click();
    const sheet = page.getByTestId("slot-sheet");
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: "Select Drinks" })
    ).toBeVisible();
    await expect(sheet.getByText("Included", { exact: true })).toBeVisible();
    await expect(sheet.locator('[data-testid^="slot-option-"]')).toHaveCount(6);
    // All six drinks are price 0 → no Upgrades section.
    await expect(sheet.getByText("Upgrades", { exact: true })).toHaveCount(0);
    await sheet.getByTestId(`slot-option-${PEPSI_SMALL}`).click();
    await page.getByTestId("slot-sheet-save").click();
    await expect(sheet).not.toBeVisible();
    const drinksCard = page.getByTestId(`pack-slot-${G_DRINKS}`);
    await expect(drinksCard).toContainText("Pepsi Small");
    await expect(drinksCard).toContainText("Swap");

    // --- Sides slot: Large Fries is tier-2 capable → Customize link ---
    await page.getByTestId(`pack-slot-open-${G_SIDES}`).click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId(`slot-option-${LARGE_FRIES}`)).toBeVisible();
    await sheet.getByTestId(`slot-customize-${LARGE_FRIES}`).click();

    // Tier-2 sheet: the Large Fries addon group with Without Salt.
    const tier2 = page.getByTestId("tier2-sheet");
    await expect(tier2).toBeVisible();
    await expect(page.getByTestId("slot-sheet")).not.toBeVisible();
    const friesGroup = tier2.getByTestId(`tier2-group-${FRIES_ADDON_GROUP}`);
    await expect(friesGroup).toBeVisible();
    await expect(friesGroup).toContainText("Choose From Without for Large Fries");
    await tier2.getByTestId(`tier2-option-${WITHOUT_SALT}`).click();
    await page.getByTestId("tier2-sheet-save").click();
    await expect(tier2).not.toBeVisible();

    // Back on the PDP the Sides slot carries the customized pick.
    const sidesCard = page.getByTestId(`pack-slot-${G_SIDES}`);
    await expect(sidesCard).toContainText("Large Fries");
    await expect(sidesCard).toContainText("Swap");

    // --- Fill the two single-option slots ---
    await pickSlot(page, G_SANDWICH, SANDWICH_PICK);
    await expect(page.getByTestId(`pack-slot-${G_SANDWICH}`)).toContainText("Swap");
    await pickSlot(page, G_NUGGETS, NUGGETS_PICK);
    await expect(page.getByTestId(`pack-slot-${G_NUGGETS}`)).toContainText("Swap");

    // --- Commit: pack 25 + all picks price 0 = £25.00 ---
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£25.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£25.00");
  });

  test("VALIDATION: an empty required slot blocks ADD TO BAG — errored ring on that slot, bag stays empty", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await openDreamBoxPack(page);

    // Fill Sandwich, Sides (plain pick — no tier-2 detour) and Drinks;
    // leave Nuggets (min 1) empty.
    await pickSlot(page, G_SANDWICH, SANDWICH_PICK);
    await pickSlot(page, G_SIDES, LARGE_FRIES);
    await pickSlot(page, G_DRINKS, PEPSI_SMALL);

    await page.getByTestId("pdp-add-to-bag").click();

    // No commit: still on the PDP, no added modal, and the empty slot's
    // card carries the min/max errored ring (first violating group).
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("product-added-modal")).not.toBeVisible();
    await expect(page.getByTestId(`pack-slot-${G_NUGGETS}`)).toHaveClass(
      /ring-red-500/
    );
    // Filled slots stay clean.
    await expect(page.getByTestId(`pack-slot-${G_SANDWICH}`)).not.toHaveClass(
      /ring-red-500/
    );

    // Leave the PDP: nothing landed in the bag.
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toContainText("£0.00");
  });
});

test.describe("P6c MIAM upsell prompt (enable_combo_upsell on)", () => {
  test("Cheese Burger tap opens the prompt; decline routes to its own customization (customizable shape) and lands £8.00 in the bag", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { comboUpsell: true });
    await bootRegisteredToMenu(page);

    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();

    // Upsell intent → MIAM prompt with the Dream box combo card.
    const prompt = page.getByTestId("miam-prompt");
    await expect(prompt).toBeVisible();
    const comboCard = prompt.getByTestId(`miam-combo-${DREAM_BOX}`);
    await expect(comboCard).toBeVisible();
    await expect(comboCard).toContainText("Dream box 1,");
    await expect(comboCard).toContainText("£25.00");
    // Decline shows the original item's price.
    await expect(prompt.getByTestId("miam-decline")).toContainText("£8.00");

    // Decline. Cheese Burger is a CUSTOMIZABLE item (3 modifier groups), so
    // the decline path opens its own customization instead of a direct add
    // (brief: "customizable/variant → openDoubleTierModal(item)").
    await prompt.getByTestId("miam-decline").click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("miam-prompt")).not.toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");

    // Commit as-is: £8.00 lands in the bag.
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£8.00");

    // Second tap opens the REPEAT sheet, NOT the prompt: with the item
    // already in the cart, classifyAddIntent's repeat branch wins before
    // the upsell check (showRepeatCustomization defaults true — useLoaders
    // negates the absent remove_repeat_customization_modal setting), and
    // since P7a the menu routes repeat intent to addEntity → the
    // RepeatItemSheet, no longer to a fresh customization PDP.
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("repeat-sheet")).toBeVisible();
    await expect(page.getByTestId("miam-prompt")).not.toBeVisible();
    await expect(
      page.locator('[data-testid^="repeat-row-"]').first()
    ).toContainText("Cheese Burger");

    // Close the sheet: bag untouched.
    await page.getByTestId("repeat-sheet-close").click();
    await expect(page.getByTestId("repeat-sheet")).toHaveCount(0);
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£8.00");
  });

  test("accepting via the combo card lands on /customization with the pack open", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { comboUpsell: true });
    await bootRegisteredToMenu(page);

    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    const prompt = page.getByTestId("miam-prompt");
    await expect(prompt).toBeVisible();

    // X close: prompt tears down, nothing lands in the bag, and the next
    // tap re-prompts (the X never blacklists the item).
    await prompt.getByTestId("miam-close").click();
    await expect(prompt).not.toBeVisible();
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(prompt).toBeVisible();

    await prompt.getByTestId(`miam-combo-${DREAM_BOX}`).click();

    // openDoubleTierModal(combo) → pack PDP, prompt gone.
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("miam-prompt")).not.toBeVisible();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
    await expect(page.getByTestId(`pack-slot-${G_SANDWICH}`)).toBeVisible();
    await expect(page.getByTestId(`pack-slot-${G_DRINKS}`)).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£25.00");
  });
});
