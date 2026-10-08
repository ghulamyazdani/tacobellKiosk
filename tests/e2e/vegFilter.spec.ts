import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * audit-fixes U1 (PAR-05) — the veg / non-veg marks and the VEG / NON-VEG
 * filter chips on /menu, end to end (MENU surfaces only: the PDP mark and the
 * bag-row mark are proven by their own builders' specs). No Figma frame —
 * design language, client sign-off; FSSAI applicability is a legal question.
 *
 * The slim fixture tags every entity with exactly one diet tag: 8 veg
 * (Cheese Burger, BBQ Sauce. and the six Meals / Combos) and 4 non-veg
 * (Greek Salad, Large Fries, Tortilla Sauce, Caesar Dressing — all in Side
 * Orders). The operator's `hide_veg_non_veg` removes the marks and the
 * chips; `hide_filter` removes only the chips. The selection is
 * `state.filter.filters`: it narrows the rail and the sections, and the
 * session reset clears it (CANCEL ORDER → /start → the next guest's menu is
 * whole). ADA: the chips sit in the rail inside the reach zone.
 *
 * House mock order (bag.spec / ada.spec): the `**\/api/**` catch-all FIRST,
 * the cross-origin print agent aborted and the Xeno revoke answered, every
 * specific mock after it (newest wins); item photos are served locally.
 * Helpers are copied, not imported (no spec exports helpers).
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
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8"));
const slimMenu = readJson("./fixtures/slim-menu.json");
const en = readJson("../../src/i18n/locales/en/translation.json") as {
  menu: { veg: string; nonVeg: string; filters: string };
};

/** 1×1 PNG: the item photos are answered locally (no internet in the walk). */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json) ----
const SIDE_ORDERS = "5dd1092ecc7088762eee2659";
const MEALS = "5dd10932188e72ce1b3eb354";
const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // non-veg
const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // veg
const NON_VEG_ITEMS = [
  GREEK_SALAD,
  "5dd10938eb1ccee31ca352fa", // Large Fries
  "5dd109392b29ee1f2a82a49b", // Tortilla Sauce
  "5dd109392b29ee1f2a82a49c", // Caesar Dressing
];
const VEG_ITEMS = [
  CHEESE_BURGER,
  "5dd109392b29ee1f2a82a49f", // BBQ Sauce.
  "5dd1093a188e72ce1b3eb359",
  "5dd1093a188e72ce1b3eb35b",
  "5dd1093a188e72ce1b3eb358",
  "68dd79409030ed3064aee28c",
  "68dd79b84c041931d29d6126",
  "695aae873185125976b3cb8b",
];

// ---- Mirrors src/components/stage/KioskStage.tsx (ada.spec.ts) ----
const STAGE_HEIGHT = 1920;
const ADA_BRAND_ZONE_HEIGHT = 798;

interface MockOptions {
  /** kiosk_settings.hide_veg_non_veg */
  hideVegNonVeg?: boolean;
  /** kiosk_settings.hide_filter */
  hideFilter?: boolean;
}

async function mockKioskBackend(page: Page, opts: MockOptions = {}) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) => r.fulfill({ json: { status: "success" } }));
  await page.route("https://itemsposistnet.s3.ap-south-1.amazonaws.com/**", (r) =>
    r.fulfill({ body: PNG, contentType: "image/png" })
  );
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: {},
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
        ideal_time: "180",
        // The footer shows ADA DISPLAY.
        accessibility_mode: true,
        ...(opts.hideVegNonVeg ? { hide_veg_non_veg: true } : {}),
        ...(opts.hideFilter ? { hide_filter: true } : {}),
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [{ _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" }],
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
        deployment: { countryCode: "GB", currencySettings: { currency: "GBP", text: "£" } },
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

/** Splash → /second → Dine In → /menu. */
async function startToMenu(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

const cards = (page: Page) => page.locator('[data-testid^="item-"]');
const cardMarks = (page: Page) =>
  page.locator('[data-testid^="item-"] [data-testid^="veg-mark-"]');
const railRows = (page: Page) =>
  page.getByTestId("category-rail").locator('[data-testid^="rail-"]');
const chip = (page: Page, tag: "veg" | "non-veg") => page.getByTestId(`menu-filter-${tag}`);

/** The card ids on screen. */
const cardIds = (page: Page) =>
  cards(page).evaluateAll((els) =>
    els.map((el) => (el.getAttribute("data-testid") ?? "").replace("item-", ""))
  );

async function expectWholeMenu(page: Page) {
  await expect(cards(page)).toHaveCount(12);
  await expect(railRows(page)).toHaveCount(2);
}

/** The element's box in stage DESIGN px (ada.spec stageBox). */
function stageBox(locator: Locator) {
  return locator.evaluate((el, stageHeight) => {
    const stage = document.querySelector('[data-testid="kiosk-stage"]');
    if (!stage) throw new Error("kiosk-stage is not mounted");
    const s = stage.getBoundingClientRect();
    const k = s.height / stageHeight;
    const b = el.getBoundingClientRect();
    const centre = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return {
      y: Math.round((b.top - s.top) / k),
      bottom: Math.round((b.bottom - s.top) / k),
      height: Math.round(b.height / k),
      hitsItself: Boolean(centre && el.contains(centre)),
    };
  }, STAGE_HEIGHT);
}

test.describe("U1 veg / non-veg marks and the diet filter (/menu)", () => {
  test("MARKS: every card's price line leads with its diet mark — veg on Cheese Burger, non-veg on Greek Salad; the chips sit under the bell, VEG first", async ({
    page,
  }) => {
    await mockKioskBackend(page);
    await registerToStart(page);
    await startToMenu(page);
    await expectWholeMenu(page);

    await expect(cardMarks(page)).toHaveCount(12);
    await expect(page.locator('[data-testid^="item-"] [data-testid="veg-mark-veg"]')).toHaveCount(8);
    await expect(page.locator('[data-testid^="item-"] [data-testid="veg-mark-non-veg"]')).toHaveCount(4);
    const burgerMark = page.getByTestId(`item-${CHEESE_BURGER}`).getByTestId("veg-mark-veg");
    await expect(burgerMark).toHaveAccessibleName(en.menu.veg);
    await expect(page.getByTestId(`item-${GREEK_SALAD}`).getByTestId("veg-mark-non-veg")).toHaveAccessibleName(
      en.menu.nonVeg
    );
    // The price <p>: mark first, then the price text (no text in the mark).
    const price = burgerMark.locator("xpath=..");
    await expect(price).toHaveText(/^£8\b/);
    // Taps pass through the mark to the card's overlay button.
    await expect(burgerMark).toHaveCSS("pointer-events", "none");

    const group = page.getByRole("group", { name: en.menu.filters });
    await expect(group).toBeVisible();
    const railButtons = page.getByTestId("category-rail").getByRole("button");
    await expect(railButtons.nth(0)).toHaveAttribute("data-testid", "menu-filter-veg");
    await expect(railButtons.nth(1)).toHaveAttribute("data-testid", "menu-filter-non-veg");
    await expect(chip(page, "veg")).toHaveAttribute("aria-pressed", "false");
    await expect(chip(page, "veg")).toHaveCSS("font-stretch", "62%");
    const box = await chip(page, "veg").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("FILTER: NON-VEG keeps its 4 cards and only their category; VEG swaps to its 8; a re-tap restores the whole menu", async ({
    page,
  }) => {
    await mockKioskBackend(page);
    await registerToStart(page);
    await startToMenu(page);
    await expectWholeMenu(page);

    await chip(page, "non-veg").click();
    await expect(chip(page, "non-veg")).toHaveAttribute("aria-pressed", "true");
    await expect(cards(page)).toHaveCount(4);
    expect((await cardIds(page)).sort()).toEqual([...NON_VEG_ITEMS].sort());
    await expect(railRows(page)).toHaveCount(1);
    await expect(page.getByTestId(`rail-${SIDE_ORDERS}`)).toBeVisible();
    await expect(page.getByTestId(`section-${MEALS}`)).toHaveCount(0);
    await expect(cardMarks(page)).toHaveCount(4);
    await expect(page.locator('[data-testid^="item-"] [data-testid="veg-mark-veg"]')).toHaveCount(0);

    await chip(page, "veg").click();
    await expect(chip(page, "veg")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "non-veg")).toHaveAttribute("aria-pressed", "false");
    await expect(cards(page)).toHaveCount(8);
    expect((await cardIds(page)).sort()).toEqual([...VEG_ITEMS].sort());
    await expect(railRows(page)).toHaveCount(2);

    await chip(page, "veg").click();
    await expect(chip(page, "veg")).toHaveAttribute("aria-pressed", "false");
    await expectWholeMenu(page);
  });

  test("HIDE_VEG_NON_VEG: the operator flag removes every mark and both chips; the menu is whole", async ({
    page,
  }) => {
    await mockKioskBackend(page, { hideVegNonVeg: true });
    await registerToStart(page);
    await startToMenu(page);
    await expectWholeMenu(page);

    await expect(page.locator('[data-testid^="veg-mark-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="menu-filter-"]')).toHaveCount(0);
    await expect(page.getByRole("group", { name: en.menu.filters })).toHaveCount(0);
    // The rail starts with a category row again.
    await expect(page.getByTestId("category-rail").getByRole("button").first()).toHaveAttribute(
      "data-testid",
      /^rail-/
    );
  });

  test("HIDE_FILTER: the marks stay, the chips go", async ({ page }) => {
    await mockKioskBackend(page, { hideFilter: true });
    await registerToStart(page);
    await startToMenu(page);
    await expectWholeMenu(page);

    await expect(cardMarks(page)).toHaveCount(12);
    await expect(page.locator('[data-testid^="menu-filter-"]')).toHaveCount(0);
  });

  test("SESSION: a filter is the guest's own — CANCEL ORDER → /start → the next menu is whole, the chips released", async ({
    page,
  }) => {
    await mockKioskBackend(page);
    await registerToStart(page);
    await startToMenu(page);

    await chip(page, "non-veg").click();
    await expect(cards(page)).toHaveCount(4);

    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    await startToMenu(page);
    await expectWholeMenu(page);
    await expect(chip(page, "non-veg")).toHaveAttribute("aria-pressed", "false");
    await expect(chip(page, "veg")).toHaveAttribute("aria-pressed", "false");
  });

  test("ADA: in the reach-zone view the chips sit inside the zone, uncovered, and still filter", async ({ page }) => {
    await mockKioskBackend(page);
    await registerToStart(page);
    await startToMenu(page);
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();

    for (const tag of ["veg", "non-veg"] as const) {
      await expect
        .poll(() => stageBox(chip(page, tag)))
        .toMatchObject({ hitsItself: true, height: 56 });
      const box = await stageBox(chip(page, tag));
      expect(box.y, `${tag} top`).toBeGreaterThanOrEqual(ADA_BRAND_ZONE_HEIGHT);
      expect(box.bottom, `${tag} bottom`).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
    // The category list below them still has room and scrolls.
    await expect(page.getByTestId(`rail-${SIDE_ORDERS}`)).toBeVisible();

    await chip(page, "non-veg").click();
    await expect(cards(page)).toHaveCount(4);
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
  });
});
