import { test, expect, type Locator, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  locale,
  SIDE_ORDERS,
  MEALS_COMBOS as MEALS,
  GREEK_SALAD,
  CHEESE_BURGER,
} from "./fixtures/backend";
import { registerToStart, startOrderTo } from "./pages/boot";

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
 * Harness house order (P9f, newest route wins): the shared mock
 * (fixtures/backend.ts) with this spec's settings. The item photos are the
 * harness's local 1×1 stub (no internet in the walk); the print agent and
 * the Xeno revoke are other origins the harness denies by name. Boot steps
 * are the shared pages/boot.ts.
 */

const en = locale("en") as {
  menu: { veg: string; nonVeg: string; filters: string };
};

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json) ----
// SIDE_ORDERS, MEALS (MEALS_COMBOS), GREEK_SALAD (non-veg), CHEESE_BURGER (veg): fixtures/backend.ts.
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

/** The shared mock (fixtures/backend.ts) with this spec's settings. */
const mockKioskBackend = (page: Page, opts: MockOptions = {}) =>
  mockBackend(page, {
    settings: {
      // The footer shows ADA DISPLAY.
      accessibility_mode: true,
      ...(opts.hideVegNonVeg ? { hide_veg_non_veg: true } : {}),
      ...(opts.hideFilter ? { hide_filter: true } : {}),
    },
  });

/** Splash → /second → Dine In → /menu. */
const startToMenu = (page: Page) => startOrderTo(page, "menu-screen");

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
