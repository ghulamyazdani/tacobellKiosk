import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clippedText } from "./fixtures/clippedText";

/**
 * Lane bag-pdp — CAPTURE-ONLY screenshots of the lane's surfaces with the
 * real Archivo fonts (user decision 2026-10-05: no pixel assertions until GT
 * America is licensed and a CI rendering image is fixed). Every walk runs in
 * English, Arabic and the ADA reach-zone view and attaches one PNG per screen
 * (`bagpdp-<mode>-NN-<screen>`) for review against the Figma frames; the
 * assertions only prove the right screen is up, plus one DOM-geometry probe
 * per shot (`clippedText`, fixtures/clippedText.ts — soft, so every shot is
 * still taken) and the one targeted check this pass's fix needs: the
 * in-flight overlay's scrim is 90 % (the bag's real-weight names read
 * through 80 % and ran into its status line).
 *
 * Covered: the bag's live EAT IN / TAKE OUT segment (both states), the
 * "edit how many" numpad (Figma 1:4460), the order-type switch confirm (both
 * ways — "No, keep Take Out" is the longest secondary label), its in-flight
 * overlay, its failure dialog and its removal notice (design language, no
 * frame), the PDP completion warning (1:2855), the slot selection sheet
 * (1:2814: Included + Upgrades, the Customize link) and the tier-2 removal
 * confirm.
 *
 * Content is real-length (TB India item names, Arabic aliases of the same
 * length): the bag row the numpad names, the two rows the switch removes
 * (both named in the notice), the pack, its slot options (two of them priced
 * upgrades). The fixture FILES are never edited — the in-memory copies are.
 * Two tabs as in orderTypeSwitch.spec: p1 dine_in / t1 serves the menu, p2
 * take_away / t2 a copy without those two rows. The t2 menu is HELD for the
 * in-flight shot, then answered 500 (the failure dialog), then served (TRY
 * AGAIN → the notice).
 *
 * Mocks are the house order (visual-offers.spec): the `**\/api/**` catch-all
 * FIRST, the cross-origin edges routed explicitly (print agent aborted, item
 * photos served locally), every specific mock after it (newest wins). The
 * walk never needs the network.
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

const readFixture = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)));
const readJson = (relative: string) =>
  JSON.parse(readFixture(relative).toString("utf-8"));

/** The WELCOME photo stands in for every item photo (served locally). */
const PHOTO = readFixture("../../src/assets/splash/fullbleed-halfmoon.jpg");
const ITEM_IMAGE_HOST = "https://itemsposistnet.s3.ap-south-1.amazonaws.com/**";

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json) ----
const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8, customizable: the ×3 row
const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // £17, one tap: not on t2
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b"; // £2, one tap: not on t2
const DREAM_BOX = "68dd79409030ed3064aee28c"; // pack, £25
const G_SIDES = `${DREAM_BOX}_2_combo`;
const G_DRINKS = `${DREAM_BOX}_3_combo`;
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa"; // the Sides pick, tier-2 capable
const WITHOUT_SALT = "5dff2ea756bc05b83f9e34cd";
const PEPSI_SMALL = "5dd27b527973647b693e428b";
const DIET_PEPSI = "5dd27b857d342f4069dd0065";
const PEPSI_MAX = "66b4a77f29edc63d6fc0889a";

const arabic = (value: string) => ({ value, name: "Arabic", code: "ar", dir: "rtl" });

/** Real-length names, English and Arabic (TB India menu names). */
const NAMES: Record<string, [string, string]> = {
  [CHEESE_BURGER]: [
    "Ultimate Cheese Crunchwrap Non Veg + Seasoned Fries & Pepsi",
    "كرانش راب الجبن الفاخر باللحم + بطاطس متبلة وبيبسي",
  ],
  [GREEK_SALAD]: [
    "2 Value Rice Bowl Non Veg+1 Small Fries+1 Cinnamon Twists+2 Pepsi Zero",
    "2 طبق أرز القيمة باللحم + 1 بطاطس صغيرة + 1 قرفة ملتوية + 2 بيبسي زيرو",
  ],
  [TORTILLA_SAUCE]: [
    "Taco Party Pack (Box of 6 Crunchy Wheat Tacos)- Veg",
    "باقة حفلة التاكو (علبة 6 تاكو قمح مقرمش) - نباتي",
  ],
  [DREAM_BOX]: [
    "Burrito Roll Party Pack (8 Habanero Burritos Box)-Veg",
    "باقة حفلة البوريتو (علبة 8 بوريتو هابانيرو) - نباتي",
  ],
  [LARGE_FRIES]: [
    "Seasoned Fries Large with Nacho Cheese Dip",
    "بطاطس متبلة كبيرة مع صوص جبن الناتشو",
  ],
  [PEPSI_SMALL]: ["Pepsi Black Zero Sugar (Regular, 300 ml)", "بيبسي بلاك بدون سكر (عادي، 300 مل)"],
  [DIET_PEPSI]: ["Hazelnut Coffee Thick Shake", "ميلك شيك قهوة البندق"],
  [PEPSI_MAX]: [
    "Strawberry Freeze With Whipped Cream Topping",
    "فريز الفراولة مع طبقة الكريمة المخفوقة",
  ],
};

/** Drinks that become priced upgrades on the pack (the sheet's Upgrades section). */
const UPGRADES: Record<string, number> = { [DIET_PEPSI]: 0.75, [PEPSI_MAX]: 1.5 };

interface NamedItem {
  id: string;
  name: string;
  aliases?: unknown[];
  calorieCount?: number;
  price?: number;
}

function rename(item: NamedItem) {
  item.calorieCount = 360;
  const names = NAMES[item.id];
  if (!names) return;
  item.name = names[0];
  item.aliases = [arabic(names[1])];
}

interface MenuShape {
  MENU_ID: string;
  categories: { subCategories: { entities: (NamedItem & { price: number })[] }[] }[];
  modifiers: { _id: string; constituentItems: NamedItem[] }[];
}

/** The slim fixture with real-length content — t2 drops `removed` and bills the row £9. */
function captureMenu(tab: "t1" | "t2"): MenuShape {
  const menu = readJson("./fixtures/slim-menu.json") as MenuShape;
  for (const category of menu.categories)
    for (const sub of category.subCategories) {
      if (tab === "t2") {
        sub.entities = sub.entities.filter(
          (entity) => entity.id !== GREEK_SALAD && entity.id !== TORTILLA_SAUCE
        );
      }
      for (const entity of sub.entities) {
        rename(entity);
        if (tab === "t2" && entity.id === CHEESE_BURGER) entity.price = 9;
      }
    }
  for (const group of menu.modifiers)
    for (const item of group.constituentItems) {
      rename(item);
      if (group._id === G_DRINKS && UPGRADES[item.id]) item.price = UPGRADES[item.id];
    }
  if (tab === "t2") menu.MENU_ID = `${menu.MENU_ID}-t2`;
  return menu;
}

/** The take-away tab's one charge (get_data): a fixed, untaxed £2 bag fee. */
const T2_CHARGE = {
  _id: "c-t2",
  name: "Bag fee",
  type: "fixed",
  value: 2,
  tabs: [{ _id: "t2", taxes: [] }],
};

type Mode = "en" | "ar" | "ada";
const MODES: Mode[] = ["en", "ar", "ada"];

interface Net {
  /** How the take-away getMenu answers: "hold" parks it in `held`. */
  t2Menu: "ok" | "hold";
  readonly held: Route[];
}

const tabOf = (route: Route): unknown => {
  try {
    return (route.request().postDataJSON() as { tab_id?: unknown } | null)?.tab_id;
  } catch {
    return undefined;
  }
};

/** House mock order: the `**\/api/**` catch-all FIRST, specific mocks after. */
async function mockKioskBackend(page: Page): Promise<Net> {
  const net: Net = { t2Menu: "ok", held: [] };
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all never sees them.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route(ITEM_IMAGE_HOST, (r) => r.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: { name: "العربية", code: "ar", dir: "rtl" },
      },
    })
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
    })
  );
  await page.route("**/api/cx/get_kiosk_settings", (r) =>
    r.fulfill({
      json: {
        start_order_text_primary: "START ORDER",
        // A secondary language without its splash text fails the boot.
        start_order_text_secondary: "ابدأ الطلب",
        ideal_time: "180",
        accessibility_mode: true,
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [
        {
          _id: "p1",
          tab_id: "t1",
          tab_type: "dine_in",
          primary_name: "Dine In",
          secondary_name: "تناول في المطعم",
        },
        {
          _id: "p2",
          tab_id: "t2",
          tab_type: "take_away",
          primary_name: "Take Away",
          secondary_name: "سفري",
        },
      ],
    })
  );
  const menus = { t1: captureMenu("t1"), t2: captureMenu("t2") };
  await page.route("**/api/cx/kiosk/getMenu", (route) => {
    if (tabOf(route) !== "t2") return route.fulfill({ json: menus.t1 });
    if (net.t2Menu === "hold") {
      net.held.push(route);
      return undefined;
    }
    return route.fulfill({ json: menus.t2 });
  });
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/cx/kiosk/get_data", (route) =>
    route.fulfill({
      json: {
        charges: tabOf(route) === "t2" ? [T2_CHARGE] : [],
        deployment: { countryCode: "GB", currencySettings: { symbol: "£" } },
      },
    })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
  return net;
}

/** Register → splash → /second → (Arabic) → Dine In → /menu → (ADA). */
async function startOrder(page: Page, mode: Mode) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible();
  if (mode === "ar") {
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  }
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  if (mode === "ada") {
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
  }
}

/** A plain item lands with one tap, no modal. */
async function addOneTap(page: Page, entityId: string, expectedCount: string) {
  const card = page.getByTestId(`item-${entityId}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText(expectedCount);
}

/** The burger (PDP, plain) + the two rows t2 does not serve; the bag open, the burger ×3. */
async function openBagWithBurgerTimesThree(page: Page): Promise<string> {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("product-added-modal")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
  await addOneTap(page, GREEK_SALAD, "(2)");
  await addOneTap(page, TORTILLA_SAUCE, "(3)");

  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  const row = page.locator(`[data-testid^="bag-row-"][data-testid$="_${CHEESE_BURGER}"]`);
  const itemId = ((await row.getAttribute("data-testid")) ?? "").replace("bag-row-", "");
  await page.getByTestId(`bag-inc-${itemId}`).click();
  await page.getByTestId(`bag-inc-${itemId}`).click();
  // 3 burgers + the two one-tap rows.
  await expect(page.getByTestId("bag-sheet")).toContainText("(5)");
  return itemId;
}

/** Menu card → the pack PDP with its slot grid. */
async function openPackPdp(page: Page) {
  const card = page.getByTestId(`item-${DREAM_BOX}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

/**
 * Every <img> settled and every finite CSS keyframe animation (the sheet and
 * dialog entrances) at rest (visual-offers capture: they run in real time;
 * `animations: "disabled"` alone caught the slot sheet and the tier-2 confirm
 * mid-entrance). The in-flight bar's infinite pulse is exempt. Also before a
 * tap inside an entering sheet: Playwright's retried click scrolled the list
 * to the option and hid the section label.
 */
async function settle(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Array.from(document.images).every((img) => img.complete) &&
          document
            .getAnimations()
            .every(
              (animation) =>
                !(animation instanceof CSSAnimation) ||
                animation.playState !== "running" ||
                !Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity)
            )
      )
    )
    .toBe(true);
}

async function capture(page: Page, name: string) {
  await settle(page);
  await shot(page, name);
  expect.soft(await clippedText(page), `${name}: text the layout cuts off`).toEqual([]);
}

/** An element's background alpha: rgba(), or a `/ a` colour (Tailwind's color-mix → oklab). */
const backgroundAlpha = (locator: Locator) =>
  locator.evaluate((el) => {
    const color = getComputedStyle(el).backgroundColor;
    const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
    if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
    const rgba = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/.exec(color);
    return rgba ? Number(rgba[1]) : 1;
  });

test.describe("lane bag-pdp — captures with the real fonts", () => {
  // The in-flight shot parks a route; drop it without waiting.
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  for (const mode of MODES) {
    test(`BAG (${mode}): the live segment, the edit-how-many numpad (1:4460), the switch confirm, in-flight, failure and removal notice`, async ({
      page,
    }) => {
      test.slow();
      const net = await mockKioskBackend(page);
      await startOrder(page, mode);
      const itemId = await openBagWithBurgerTimesThree(page);
      const eatIn = page.getByTestId("bag-ordertype-eatin");
      const takeOut = page.getByTestId("bag-ordertype-takeout");
      await expect(eatIn).toHaveAttribute("aria-pressed", "true");
      await expect(takeOut).toHaveAttribute("aria-disabled", "false");
      // The stepper taps scrolled the 765 px ADA bag past its segment.
      await eatIn.scrollIntoViewIfNeeded();
      await capture(page, `bagpdp-${mode}-01-bag-eat-in`);

      // Item 20: Edit on the ×3 row asks how many first.
      await page.getByTestId(`bag-edit-${itemId}`).click();
      const numpad = page.getByTestId("edit-how-many");
      await expect(numpad).toBeVisible();
      await page.getByTestId("numpad-key-2").click();
      await expect(page.getByTestId("edit-how-many-value")).toHaveText("2");
      await capture(page, `bagpdp-${mode}-02-edit-how-many`);
      await page.getByTestId("edit-how-many-close").click();
      await expect(numpad).toHaveCount(0);

      // Item 19: confirm → in flight (t2 menu held) → failure (500).
      await takeOut.click();
      const confirm = page.getByTestId("bag-ordertype-confirm");
      await expect(confirm).toBeVisible();
      await capture(page, `bagpdp-${mode}-03-switch-confirm`);
      net.t2Menu = "hold";
      await page.getByTestId("bag-ordertype-confirm-yes").click();
      const switching = page.getByTestId("bag-ordertype-switching");
      await expect(switching).toBeVisible();
      await expect.poll(() => net.held.length).toBe(1);
      await capture(page, `bagpdp-${mode}-04-switch-in-flight`);
      // The status sits on the scrim, no card: at 80 % the bag's Medium-weight
      // names read through (black ink ~2.0:1 on the scrimmed white) and ran
      // into the status line — /second's menu-fetching 90 % (~1.4:1) hides them.
      expect
        .soft(await backgroundAlpha(switching), "in-flight scrim alpha")
        .toBeGreaterThanOrEqual(0.9);
      await net.held[0].fulfill({ status: 500, json: { message: "menu down" } });
      await expect(page.getByTestId("bag-ordertype-failed")).toBeVisible({ timeout: 20_000 });
      await capture(page, `bagpdp-${mode}-05-switch-failed`);

      // TRY AGAIN with the menu served: committed, two rows removed and named.
      net.t2Menu = "ok";
      await page.getByTestId("bag-ordertype-retry").click();
      const notice = page.getByTestId("bag-ordertype-notice");
      await expect(notice).toBeVisible({ timeout: 20_000 });
      await expect(notice).toContainText(NAMES[GREEK_SALAD][mode === "ar" ? 1 : 0]);
      await capture(page, `bagpdp-${mode}-06-switch-notice`);
      await page.getByTestId("bag-ordertype-notice-gotit").click();
      await expect(notice).toHaveCount(0);
      await expect(takeOut).toHaveAttribute("aria-pressed", "true");
      await capture(page, `bagpdp-${mode}-07-bag-take-out`);

      // The way back: the longest secondary label ("No, keep Take Out").
      await eatIn.click();
      await expect(confirm).toBeVisible();
      await capture(page, `bagpdp-${mode}-08-switch-confirm-back`);
      await page.getByTestId("bag-ordertype-confirm-no").click();
      await expect(confirm).toHaveCount(0);
    });

    test(`PDP (${mode}): the completion warning (1:2855), the slot sheets (1:2814), the tier-2 removal confirm`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await startOrder(page, mode);
      await openPackPdp(page);

      // Item 23: ADD TO BAG with every slot empty names all four groups.
      await page.getByTestId("pdp-add-to-bag").click();
      const warning = page.getByTestId("pdp-incomplete");
      await expect(warning).toBeVisible();
      await capture(page, `bagpdp-${mode}-09-pdp-incomplete`);
      await page.getByTestId("pdp-incomplete-gotit").click();
      await expect(warning).toHaveCount(0);

      // The restyled SELECT sheet: Included + priced Upgrades, one picked.
      const sheet = page.getByTestId("slot-sheet");
      await page.getByTestId(`pack-slot-open-${G_DRINKS}`).click();
      await expect(sheet.getByTestId(`slot-option-${PEPSI_MAX}`)).toBeAttached();
      await settle(page);
      await sheet.getByTestId(`slot-option-${PEPSI_SMALL}`).click();
      await expect(page.getByTestId("slot-sheet-save")).toBeEnabled();
      await capture(page, `bagpdp-${mode}-10-slot-sheet-drinks`);
      await page.getByTestId("slot-sheet-close").click();
      await expect(sheet).toHaveCount(0);

      // The Customize link row, then item 24's flow (pack.spec helpers).
      await page.getByTestId(`pack-slot-open-${G_SIDES}`).click();
      await expect(page.getByTestId(`slot-customize-${LARGE_FRIES}`)).toBeVisible();
      await capture(page, `bagpdp-${mode}-11-slot-sheet-sides`);
      await page.getByTestId(`slot-customize-${LARGE_FRIES}`).click();
      const tier2 = page.getByTestId("tier2-sheet");
      await expect(tier2).toBeVisible();
      await tier2.getByTestId(`tier2-option-${WITHOUT_SALT}`).click();
      await page.getByTestId("tier2-sheet-save").click();
      await expect(tier2).not.toBeVisible();
      await page.getByTestId(`pack-slot-open-${G_SIDES}`).click();
      await page.getByTestId(`slot-customize-${LARGE_FRIES}`).click();
      await expect(tier2).toBeVisible();
      await expect(page.getByTestId("tier2-qty")).toHaveText("1");
      await page.getByTestId("tier2-qty-decrease").click();
      await expect(page.getByTestId("tier2-remove-overlay")).toBeVisible();
      await capture(page, `bagpdp-${mode}-12-tier2-remove-confirm`);
    });
  }
});
