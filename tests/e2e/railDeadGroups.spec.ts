import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * UB6 (rail-crash, user report 2026-10-08): "Something went wrong" after an
 * add from the bag's Complete-Your-Meal rail.
 *
 * - An item that lists a modifier-group id missing from the menu's
 *   `modifiers` (a DANGLING id) crashed the PDP's opening effect: the seed
 *   loop read `group._id` off the resolver's `undefined`. Fix A drops those
 *   ids in fetchModifierProperties, for every caller.
 * - Every suggestion surface read the entity map published BEFORE
 *   conversion, so the rail sent the PDP items the menu sells in one tap,
 *   and offered packs the menu hides. Fix B: they read
 *   selectMenuSellableEntityMap (SDK toMenuSellableEntity).
 *
 * E1 (flagged; tenant) · E2 (rail → PDP → back to /cart) · E3 (menu → PDP)
 * · E4 (a dead pack is hidden on the menu AND the rail; inactive; dangling;
 * mixed).
 *
 * ── HOW A CRASH IS READ ─────────────────────────────────────────────────
 * The crash screen (`app-error`, the app ErrorBoundary) renders AFTER the
 * PDP mounts, so "no app-error" read right after a tap proves nothing.
 * `settle` first waits for the expected screen OR the crash screen, then
 * asserts the crash screen is absent.
 *
 * ── MOCKS ───────────────────────────────────────────────────────────────
 * Helpers copied from bag-recommendations.spec.ts (house precedent; the
 * shared harness comes later): the `**\/api/**` catch-all FIRST, the print
 * agent aborted, the Xeno revoke routed. Each test serves a deep clone of
 * slim-menu, mutated, from a getMenu route registered AFTER
 * mockKioskBackend (newest wins).
 *
 * Money is asserted without the currency symbol (audit-fixes changes the
 * currency shape, UB1). `product-added-modal` is never asserted (R1).
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
const en = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../src/i18n/locales/en/translation.json", import.meta.url)),
    "utf-8"
  )
);

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json) ----
/** £17, flagged, no groups: the one-tap anchor added from the menu. */
const GREEK_SALAD = "5dd1093829754a432f2c32e2";
/** £9, flagged; its one group is min 0, so ADD TO BAG needs no pick. */
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa";
const FRIES_GROUP = `${LARGE_FRIES}_1573980470_addons`;
/** £25, five `_combo` groups. Not flagged in the fixture. */
const DREAM_BOX = "68dd79409030ed3064aee28c";
/** The box's neighbour in Meals / Boxes, with its own live groups: the control. */
const DREAM_BOX_SPICY = "68dd79b84c041931d29d6126";
/** Group ids no `menu.modifiers` entry carries. */
const DANGLING = "deadbeefdeadbeefdeadbeef_1234567890_addons";
const DANGLING_2 = "deadbeefdeadbeefdeadbeef_1234567891_addons";
const DANGLING_COMBO = "deadbeefdeadbeefdeadbeef_1234567890_combo";
/**
 * E2/E3: the live group among TWO dangling ids, one listed first. The
 * resolver sorts every unknown id to the END, so a fix that trims only one
 * trailing `undefined` passes a single dangling id and still crashes here.
 */
const FRIES_LIVE_AMONG_DANGLING = [DANGLING, FRIES_GROUP, DANGLING_2];

const RECS_HOST = "https://recommendations.e2e.test";
const RECS_URL = `${RECS_HOST}/data.json`;
/** The tenant file: Large Fries is bought with a Greek Salad. */
const RECS_BODY = {
  data: [
    {
      baseItem_id: GREEK_SALAD,
      refers: [{ refer_baseItem_id: LARGE_FRIES, occurrences: 5 }],
    },
  ],
};

interface MenuEntity {
  id: string;
  modifiers?: string[];
  isCartRecommended?: boolean;
}
interface SlimMenu {
  categories: { subCategories: { entities: MenuEntity[] }[] }[];
  modifiers: { _id: string; isActive?: boolean }[];
}

/** A deep clone of slim-menu with `mutate` applied to the entity `id`. */
function menuWith(id: string, mutate: (entity: MenuEntity, menu: SlimMenu) => void): SlimMenu {
  const menu: SlimMenu = structuredClone(slimMenu);
  const entity = menu.categories
    .flatMap((category) => category.subCategories)
    .flatMap((sub) => sub.entities)
    .find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`slim-menu has no entity ${id}`);
  mutate(entity, menu);
  return menu;
}

/** Register AFTER mockKioskBackend: newest wins. */
async function serveMenu(page: Page, menu: SlimMenu) {
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: menu }));
}

async function mockKioskBackend(page: Page, settings: Record<string, unknown> = {}) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them (header).
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) =>
    r.fulfill({ json: { status: "success" } })
  );
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
        ...settings,
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

/** The DEV-only URL seam, on every navigation (bag-recommendations header). */
async function useTenantRecommendations(page: Page) {
  await page.addInitScript((url) => {
    (window as unknown as { __TB_RECS_URL__?: string }).__TB_RECS_URL__ = url;
  }, RECS_URL);
}

/** The fake S3, serving `body` (cross-origin: S3's own CORS header). */
async function mockS3(page: Page, body: unknown) {
  await page.route(`${RECS_HOST}/**`, (route) =>
    route.fulfill({ json: body, headers: { "Access-Control-Allow-Origin": "*" } })
  );
}

/** Type the device code on the on-screen keyboard and submit (the boot starts). */
async function submitRegistration(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
}

async function registerToStart(page: Page) {
  await submitRegistration(page);
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 20_000 });
}

/** Splash → order type → /menu (loyalty off). */
async function startOrderToMenu(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 20_000 });
}

/** The anchor: Greek Salad in one tap from the menu (no groups, no modal). */
async function addGreekSaladFromMenu(page: Page) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
}

/**
 * VIEW MY BAG → /cart. The first open of a session may meet the P7d upsell
 * (/forYou); declining it mutates no cart state (bag.spec.ts openBag).
 */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

/** The rail's item ids, left to right. */
async function railIds(page: Page): Promise<string[]> {
  await expect(page.getByTestId("bag-rail")).toBeVisible();
  return page
    .locator('[data-testid^="bag-rail-item-"]')
    .evaluateAll((cards) =>
      cards.map((card) => (card.getAttribute("data-testid") ?? "").replace("bag-rail-item-", ""))
    );
}

type StoreWindow = Window & {
  __kioskStore: {
    getState: () => {
      recommendation: { recommendCategoryMap?: Record<string, unknown> };
    };
  };
};

/** Base items in the in-memory tenant map. */
const tenantMapKeys = (page: Page) =>
  page.evaluate(() =>
    Object.keys(
      (window as unknown as StoreWindow).__kioskStore.getState().recommendation
        .recommendCategoryMap ?? {}
    )
  );

const bagRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');
const pdpGroups = (page: Page) => page.locator('[data-testid^="pdp-group-"]');

/**
 * Waits for `expected` OR the crash screen, then asserts no crash screen
 * (header: a read before the crash could render proves nothing).
 */
async function settle(page: Page, expected: Locator) {
  const appError = page.getByTestId("app-error");
  await expect(expected.or(appError).first()).toBeVisible({ timeout: 20_000 });
  await expect(appError).toHaveCount(0);
}

test.describe("UB6 — dead modifier groups on the bag rail", () => {
  for (const source of ["flagged", "tenant"] as const) {
    test(`E1 ${source.toUpperCase()}: a plain item whose only group is dangling is a one-tap 'Quick add' on the rail, as on the menu — the tap adds it in the bag, no crash screen`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await serveMenu(
        page,
        menuWith(LARGE_FRIES, (fries) => {
          fries.modifiers = [DANGLING];
        })
      );
      if (source === "tenant") {
        await useTenantRecommendations(page);
        await mockS3(page, RECS_BODY);
      }
      await registerToStart(page);
      // Wider than the fetch's own budget (10 s, one retry).
      if (source === "tenant") {
        await expect
          .poll(() => tenantMapKeys(page), { timeout: 25_000 })
          .toEqual([GREEK_SALAD]);
      }
      await startOrderToMenu(page);
      await addGreekSaladFromMenu(page);
      await openBag(page);

      // The tenant list alone: the flagged fallback would add Cheese Burger.
      if (source === "tenant") {
        await expect.poll(() => railIds(page)).toEqual([LARGE_FRIES]);
      }
      const fries = page.getByTestId(`bag-rail-item-${LARGE_FRIES}`);
      await expect(fries).toBeVisible();
      // Soft, so a run without Fix B ("Customize Large Fries") still taps
      // and reports what the tap does.
      await expect.soft(fries).toHaveAccessibleName(`${en.menu.quickAdd} Large Fries`);
      await fries.click();

      await settle(page, bagRows(page).nth(1));
      await expect(page).toHaveURL(/\/cart$/);
      await expect(page.getByTestId("bag-sheet")).toBeVisible();
      await expect(bagRows(page)).toHaveCount(2);
      // 17 + 9.
      await expect(page.getByTestId("bag-subtotal")).toContainText("26.00");
    });
  }

  test("E2: a live group among dangling ids — the rail tap opens the PDP on the live group alone, and ADD TO BAG returns to /cart with the bag open and both rows", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await serveMenu(
      page,
      menuWith(LARGE_FRIES, (fries) => {
        fries.modifiers = [...FRIES_LIVE_AMONG_DANGLING];
      })
    );
    await registerToStart(page);
    await startOrderToMenu(page);
    await addGreekSaladFromMenu(page);
    await openBag(page);

    await page.getByTestId(`bag-rail-item-${LARGE_FRIES}`).click();
    await settle(page, page.getByTestId(`pdp-group-${FRIES_GROUP}`));
    await expect(page).toHaveURL(/\/customization$/);
    await expect(pdpGroups(page)).toHaveCount(1);

    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page).toHaveURL(/\/cart$/, { timeout: 15_000 });
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-subtotal")).toContainText("26.00");
    await expect(page.getByTestId("app-error")).toHaveCount(0);
  });

  test("E3: the same item tapped on the MENU opens its PDP on the live group alone, no crash screen", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await serveMenu(
      page,
      menuWith(LARGE_FRIES, (fries) => {
        fries.modifiers = [...FRIES_LIVE_AMONG_DANGLING];
      })
    );
    await registerToStart(page);
    await startOrderToMenu(page);

    const fries = page.getByTestId(`item-${LARGE_FRIES}`);
    await fries.scrollIntoViewIfNeeded();
    await fries.click();
    await settle(page, page.getByTestId(`pdp-group-${FRIES_GROUP}`));
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(pdpGroups(page)).toHaveCount(1);
  });

  const deadPacks: [string, (box: MenuEntity, menu: SlimMenu) => void][] = [
    [
      "INACTIVE: every group of the flagged pack is inactive",
      (box, menu) => {
        for (const group of menu.modifiers)
          if (box.modifiers?.includes(group._id)) group.isActive = false;
      },
    ],
    [
      "DANGLING: the flagged pack's only group id is a dangling _combo",
      (box) => {
        box.modifiers = [DANGLING_COMBO];
      },
    ],
    [
      "MIXED: the flagged pack lists a dangling plain group and a dangling _combo",
      (box) => {
        // ONE `_combo` id makes a pack (the converter's find(); the Kiddie
        // Meals list an `_addons` group too): dead, it is dropped, never
        // sold as a one-tap item.
        box.modifiers = [DANGLING, DANGLING_COMBO];
      },
    ],
  ];
  for (const [label, kill] of deadPacks) {
    test(`E4 ${label} — the pack is hidden on the menu AND the bag rail`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await serveMenu(
        page,
        menuWith(DREAM_BOX, (box, menu) => {
          box.isCartRecommended = true;
          kill(box, menu);
        })
      );
      await registerToStart(page);
      await startOrderToMenu(page);

      // The whole menu renders in one list: the box's neighbour is there.
      await expect(page.getByTestId(`item-${DREAM_BOX_SPICY}`)).toHaveCount(1);
      await expect(page.getByTestId(`item-${DREAM_BOX}`)).toHaveCount(0);

      await addGreekSaladFromMenu(page);
      await openBag(page);
      // Large Fries keeps the rail up; the rail renders every card at once.
      await expect(page.getByTestId("bag-rail")).toBeVisible();
      await expect(page.getByTestId(`bag-rail-item-${LARGE_FRIES}`)).toBeVisible();
      await expect(page.getByTestId(`bag-rail-item-${DREAM_BOX}`)).toHaveCount(0);
    });
  }
});
