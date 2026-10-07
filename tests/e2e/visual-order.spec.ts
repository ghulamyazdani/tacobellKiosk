import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clippedText } from "./fixtures/clippedText";

/**
 * Capture-only screenshots of the ORDERING screens (user decision 2026-10-05:
 * no pixel assertions until GT America is licensed and a CI rendering image is
 * fixed). Every screen is attached to the report as `order-NN-<screen>.png`
 * for human review; the only assertions are the ones that prove the right
 * screen is up, plus one DOM-geometry probe per shot (`clippedText`,
 * fixtures/clippedText.ts: no text cropped by a box, spilling out of a nowrap
 * box, out of its button or under its tile's radio, no contained photo cut —
 * soft, so every shot is still taken) and a few targeted layout checks the
 * fonts lane's fixes need (pack-slot CTAs on one line per row). The `fonts`
 * lane used it as its BEFORE/AFTER tool, and any lane that touches text
 * metrics can rerun it.
 *
 * Covered: /menu (rail, hero, grid, CTA total; top and scrolled), the single
 * PDP (long-description clamp + groups), the added modal with its strip, the
 * repeat sheet, the MIAM prompt, the pack PDP with its slot sheet and tier-2
 * sheet, /forYou, the bag (rows with an addon line, totals, rail), the remove
 * confirm, the rewards entry / sheet / applied row / freebie picker, the ADA
 * reach-zone view of /menu and the bag, and Arabic /menu, /forYou, bag and
 * rewards sheet (the Arabic calorie label wraps a card's price line).
 * SelectSizeModal is not reachable: the fixture has no variant item.
 *
 * Mocks and walks are copied from bag.spec / pack.spec / offers.spec /
 * ada.spec / idle.spec (none of them export helpers — the house precedent).
 * The fixture FILE is never edited; the in-memory copy gets Figma-like
 * content so the captures stress what the frames show: a NEW hero card
 * (Greek Salad), "| 360 Cal" on every price line, the long Cheese Burger
 * description (registration.spec's clamp text) and a "You Might Like" strip
 * on the Cheese Burger's added modal — plus real-length names (the reference
 * TB India menu's median name is 32 characters and a third run past 40): on
 * Large Fries, which lands on the menu grid, /forYou, the bag rail, the added
 * modal, the tier-2 sheet title and its pack slot; on the Greek Salad hero
 * (a 4-line name the hero photo yields to; the rewards rail's 2-line title
 * box); and on two imageless options (a PDP addon and the tier-2 pick) whose
 * name shares a row with the radio. Pack constituents carry "360 Cal" too
 * (the slot info line). Item photos load
 * from S3 as in every other spec; a shot waits until each <img> settled
 * (loaded or failed).
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

const readJson = (relative: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8")
  );

const offersFixture = readJson("./fixtures/offers.json");

// ---- Fixture ids ----
const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // £17, plain (one tap)
const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8, 3 addon groups
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa"; // £9, tier-2 capable
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b"; // £2, plain
const CAESAR_DRESSING = "5dd109392b29ee1f2a82a49c"; // the menu's last card
const KIDDIE_CHEESE_BURGER = "5dd1093a188e72ce1b3eb35b"; // long grid name
const EXTRA_PICKLES = "5dd1093f188e72ce1b3eb36e"; // +£1 addon
const DREAM_BOX = "68dd79409030ed3064aee28c"; // pack, £25
const G_SIDES = `${DREAM_BOX}_2_combo`;
const G_DRINKS = `${DREAM_BOX}_3_combo`;
const WITHOUT_SALT = "5dff2ea756bc05b83f9e34cd";
const EXTRA_MUSTARD = "5dd2f69029446a316cf7cf0b"; // imageless PDP addon
const PEPSI_SMALL = "5dd27b527973647b693e428b";
const OFFER_FLAT = "offer-flat-2";
const OFFER_FREE_SAUCE = "offer-free-sauce-choice";

/** Real-length names (header): two TB India item names — 53 characters, and
 * the reference menu's longest (70) on the hero: 4 lines in its 352-px name
 * box, so the photo gives way, and a clamped 2-line title on the rewards
 * rail — and two imageless options (their name shares the row with the
 * tile's radio). */
const LONG_NAMES: Record<string, string> = {
  [LARGE_FRIES]: "Melted Cheese Quesadilla Veg + Seasoned Fries & Pepsi",
  [GREEK_SALAD]: "2 Value Rice Bowl Non Veg+1 Small Fries+1 Cinnamon Twists+2 Pepsi Zero",
  [EXTRA_MUSTARD]: "Extra Creamy Chipotle Mustard Sauce",
  [WITHOUT_SALT]: "Without Salt & Peri Peri Seasoning",
};
const LONG_DESCRIPTION = Array(6)
  .fill("The classic Cheese Burger with Herfy special take, grilled to order.")
  .join(" ");

/** The slim fixture with Figma-like content (header) — a fresh copy per test. */
function captureMenu() {
  const menu = readJson("./fixtures/slim-menu.json");
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities) {
        entity.calorieCount = 360;
        entity.name = LONG_NAMES[entity.id] ?? entity.name;
        if (entity.id === GREEK_SALAD) entity.badges = [{ name: "New" }];
        if (entity.id === CHEESE_BURGER) {
          entity.description = LONG_DESCRIPTION;
          entity.recommendedItems = [GREEK_SALAD, LARGE_FRIES, TORTILLA_SAUCE];
        }
      }
  // Pack constituents and addons too: slot info lines, tier-2 and PDP tiles.
  for (const group of menu.modifiers)
    for (const item of group.constituentItems) {
      item.calorieCount = 360;
      item.name = LONG_NAMES[item.id] ?? item.name;
    }
  return menu;
}

interface MockOptions {
  /** enable_combo_upsell: a Cheese Burger tap opens the MIAM prompt. */
  comboUpsell?: boolean;
  /** get_cx_valid_offers serves tests/e2e/fixtures/offers.json. */
  offers?: boolean;
  /** Arabic offered as the secondary language. */
  arabic?: boolean;
}

/** House mock order: the `**\/api/**` catch-all FIRST, specific mocks after. */
async function mockKioskBackend(page: Page, opts: MockOptions = {}) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all never sees them (ada.spec header).
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) =>
    r.fulfill({ json: { status: "success" } })
  );
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: opts.arabic
          ? { name: "العربية", code: "ar", dir: "rtl" }
          : {},
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
        // A secondary language without its splash text fails the boot.
        ...(opts.arabic ? { start_order_text_secondary: "ابدأ الطلب" } : {}),
        ideal_time: "180",
        // The footer shows ADA DISPLAY as in the Figma frames.
        accessibility_mode: true,
        ...(opts.comboUpsell ? { enable_combo_upsell: true } : {}),
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
  const menu = captureMenu();
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: menu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) =>
    r.fulfill({ json: opts.offers ? offersFixture : [] })
  );
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

/** Register on the on-screen keyboard and land on the splash. */
async function registerToStart(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

async function bootRegisteredToMenu(page: Page) {
  await registerToStart(page);
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

/** The hero card's quick-add: Greek Salad is plain, so no modal opens. */
async function quickAddGreekSalad(page: Page, expectedCount: string) {
  const add = page.getByTestId(`quick-add-${GREEK_SALAD}`);
  await add.scrollIntoViewIfNeeded();
  await add.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText(expectedCount);
}

/** Card → PDP → (optional addon) → ADD TO BAG; leaves the added modal OPEN. */
async function commitCheeseBurgerViaPdp(page: Page, addonId?: string) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  if (addonId) await page.getByTestId(`pdp-option-${addonId}`).click();
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("product-added-modal")).toBeVisible();
}

async function dismissAddedModal(page: Page) {
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
}

/**
 * VIEW MY BAG → /cart. The first open of a session meets /forYou (bag.spec
 * openBag); `onUpsell` runs while it is up, then NOT TODAY declines it.
 */
async function openBag(page: Page, onUpsell?: () => Promise<void>) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await expect(page.getByTestId("foryou-screen")).toBeVisible();
    if (onUpsell) await onUpsell();
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

const bagRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');

/**
 * Every <img> has settled (loaded or failed) — S3 photos arrive late — and
 * every finite animation has finished (ada.spec expectReachable): a sheet
 * still running its entrance keyframe would be captured half-faded. The
 * photo wait is best effort: a slow CDN must never fail a capture-only spec,
 * so after 10 s the screen is shot as it is.
 */
async function settle(page: Page) {
  await page
    .waitForFunction(() => [...document.images].every((img) => img.complete), undefined, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  );
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function capture(page: Page, name: string) {
  await settle(page);
  await shot(page, name);
  expect.soft(await clippedText(page), `${name}: text the layout cuts off`).toEqual([]);
}


test.describe("visual capture — ordering screens", () => {
  test("MENU + PDP SINGLE: /menu top and grid, the single PDP, the added modal, the repeat sheet", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);

    // Rail + NEW hero + grid + a CTA bar carrying a total.
    await quickAddGreekSalad(page, "(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£17.00");
    await expect(page.getByTestId("category-rail")).toContainText("Side Orders");
    // The pane scrolls an inner container: back to its top for the first shot.
    await page
      .locator('[data-testid^="section-"]')
      .first()
      .evaluate((section) => section.scrollIntoView({ block: "start" }));
    await expect(page.getByTestId(`item-${KIDDIE_CHEESE_BURGER}`)).toBeInViewport();
    await capture(page, "order-01-menu-top");

    // …and to its end: the Side Orders grid under the hero, then Sauces.
    await page.getByTestId(`item-${CAESAR_DRESSING}`).scrollIntoViewIfNeeded();
    await capture(page, "order-02-menu-scrolled");

    // Single PDP: title, clamped description + Show more, the first group.
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-show-more")).toBeVisible();
    await capture(page, "order-03-pdp-single");
    await page.getByTestId("pdp-show-more").click();
    await expect(page.getByTestId("pdp-show-more")).toHaveText("Show less");
    await capture(page, "order-04-pdp-single-expanded");

    // Customized commit → the added modal with its You Might Like strip.
    await page.getByTestId(`pdp-option-${EXTRA_PICKLES}`).click();
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await expect(page.getByTestId(`added-rec-${LARGE_FRIES}`)).toBeVisible();
    await capture(page, "order-05-product-added");
    await dismissAddedModal(page);

    // In-cart item → the repeat sheet.
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("repeat-sheet")).toBeVisible();
    await capture(page, "order-06-repeat-sheet");
  });

  test("PACK: MIAM prompt, pack PDP, slot sheet, tier-2 sheet, picked slots", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { comboUpsell: true });
    await bootRegisteredToMenu(page);

    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    const prompt = page.getByTestId("miam-prompt");
    await expect(prompt.getByTestId(`miam-combo-${DREAM_BOX}`)).toBeVisible();
    await capture(page, "order-07-miam-prompt");

    await prompt.getByTestId(`miam-combo-${DREAM_BOX}`).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
    await capture(page, "order-08-pdp-pack");

    await page.getByTestId(`pack-slot-open-${G_SIDES}`).click();
    const sheet = page.getByTestId("slot-sheet");
    await expect(sheet.getByTestId(`slot-option-${LARGE_FRIES}`)).toBeVisible();
    await capture(page, "order-09-slot-sheet");

    await sheet.getByTestId(`slot-customize-${LARGE_FRIES}`).click();
    const tier2 = page.getByTestId("tier2-sheet");
    await expect(tier2.getByTestId(`tier2-option-${WITHOUT_SALT}`)).toBeVisible();
    await capture(page, "order-10-tier2-sheet");

    await tier2.getByTestId(`tier2-option-${WITHOUT_SALT}`).click();
    await page.getByTestId("tier2-sheet-save").click();
    await expect(tier2).toHaveCount(0);
    await page.getByTestId(`pack-slot-open-${G_DRINKS}`).click();
    await expect(sheet).toBeVisible();
    await sheet.getByTestId(`slot-option-${PEPSI_SMALL}`).click();
    await page.getByTestId("slot-sheet-save").click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId(`pack-slot-${G_DRINKS}`)).toContainText("Pepsi Small");
    await page.getByTestId("pack-slot-grid").scrollIntoViewIfNeeded();
    await capture(page, "order-11-pdp-pack-picked");
    // The 2-line pick + info line makes its card the tallest: the row's other
    // cards still fill the row, so its CTAs (mt-auto) line up.
    const rows = await page
      .locator('[data-testid^="pack-slot-open-"]')
      .evaluateAll((opens) => {
        const feet = new Map<number, number[]>();
        for (const open of opens) {
          const top = Math.round((open.parentElement ?? open).getBoundingClientRect().top);
          const cta = open.lastElementChild?.getBoundingClientRect().bottom ?? 0;
          feet.set(top, [...(feet.get(top) ?? []), Math.round(cta)]);
        }
        return [...feet.values()];
      });
    for (const row of rows) {
      expect.soft(new Set(row).size, `slot CTA feet in one row: ${row}`).toBe(1);
    }
  });

  test("BAG: /forYou, the bag (rows with an addon line, rail, totals), the remove confirm", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await commitCheeseBurgerViaPdp(page, EXTRA_PICKLES);
    await dismissAddedModal(page);
    await quickAddGreekSalad(page, "(2)");

    await openBag(page, () => capture(page, "order-12-foryou"));
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-sheet")).toContainText("Extra Pickles");
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await capture(page, "order-13-bag");

    const burgerRow = bagRows(page).filter({ hasText: "Cheese Burger" });
    const itemId = ((await burgerRow.getAttribute("data-testid")) ?? "").replace(
      "bag-row-",
      ""
    );
    await page.getByTestId(`bag-dec-${itemId}`).click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();
    await capture(page, "order-14-remove-item");
  });

  test("REWARDS: entry row, the rewards sheet, an applied reward, the freebie picker", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { offers: true });
    await bootRegisteredToMenu(page);
    await commitCheeseBurgerViaPdp(page);
    await dismissAddedModal(page);
    await openBag(page);
    await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await capture(page, "order-15-bag-rewards-entry");

    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("offer-suggested-rail")).toBeVisible();
    await capture(page, "order-16-rewards-sheet");

    await page.getByTestId(`offer-row-${OFFER_FLAT}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toBeVisible();
    await page.getByTestId("bag-total").scrollIntoViewIfNeeded();
    await capture(page, "order-17-bag-reward-applied");

    await page.getByTestId("bag-rewards-applied").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId(`offer-row-${OFFER_FREE_SAUCE}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`)).toBeVisible();
    await capture(page, "order-18-freebie-picker");
  });

  test("ADA: the reach-zone view of /menu and of the 765px bag", async ({ page }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await expect(page.getByTestId("footer-ada")).toHaveAttribute("aria-pressed", "true");
    await quickAddGreekSalad(page, "(1)");
    await capture(page, "order-19-ada-menu");

    await openBag(page);
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await capture(page, "order-20-ada-bag");
    // The 765px sheet scrolls: its totals and PAY row.
    await page.getByTestId("bag-total").scrollIntoViewIfNeeded();
    await capture(page, "order-21-ada-bag-totals");
  });

  test("ARABIC: /menu, /forYou, the bag and the rewards sheet after choosing Arabic on /second", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { arabic: true, offers: true });
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    // £8: under the 25 % offer's minimum, so the rewards sheet shows its rail.
    await commitCheeseBurgerViaPdp(page);
    await dismissAddedModal(page);
    await page
      .locator('[data-testid^="section-"]')
      .first()
      .evaluate((section) => section.scrollIntoView({ block: "start" }));
    await expect(page.getByTestId("footer-language")).toContainText("العربية");
    await capture(page, "order-22-ar-menu");

    // The Arabic calorie label wraps a card's price line: its photo gives way.
    await openBag(page, () => capture(page, "order-23-ar-foryou"));
    await capture(page, "order-24-ar-bag");
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("offer-suggested-rail")).toBeVisible();
    await capture(page, "order-25-ar-rewards-sheet");
  });
});
