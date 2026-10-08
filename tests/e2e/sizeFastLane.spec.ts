import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * audit-fixes B5 (CX-07) — the Select-a-Size fast lane commits its size-only
 * row through the PDP's own builder (buildVariantCommitPayload over
 * buildVariantTierPayload), so the row carries `baseItem` and its prices like
 * a PDP-built row. What only the running app shows: a fast-lane row edits
 * from the bag like any other — the PDP opens on the row's size, Change size
 * lists both sizes, and the other size re-prices the SAME row (MONEY).
 *
 * The fixture is bag.spec's sizedMenu(): Kiddie Meal Beef Burger with two
 * sizes and no modifier groups — Regular £5, Large £7 (neither is the
 * parent's price). Exclusive VAT@15 % on the slim menu, whole-unit round-off
 * on the total (bag.spec header). bag.spec owns the PDP-built SIZE EDIT and
 * the plain fast lane; this file is the fast lane's own edit.
 *
 * House mock order: the `**\/api/**` catch-all FIRST, the print agent
 * aborted, every specific mock after it (newest wins). Helpers are copied
 * from bag.spec (no spec exports helpers).
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
  readFileSync(fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)), "utf-8")
);

/** Kiddie Meal Beef Burger, re-shaped into a sized item (bag.spec sizedMenu). */
const SIZED_ITEM = "5dd1093a188e72ce1b3eb358";
const SIZE_REGULAR = "e2e-size-regular"; // £5
const SIZE_LARGE = "e2e-size-large"; // £7

function sizedMenu() {
  const menu = JSON.parse(JSON.stringify(slimMenu));
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

async function mockKioskBackend(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // The print agent is cross-origin: the catch-all above never sees it.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
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
    r.fulfill({ json: { start_order_text_primary: "START ORDER", ideal_time: "180" } })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [{ _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" }],
    })
  );
  const menu = sizedMenu();
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: menu }));
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

/** VIEW MY BAG → /cart, declining the first-open upsell (bag.spec openBag). */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

const bagRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');

test.describe("B5 Select-a-Size fast lane — one money shape", () => {
  test("SIZE FAST LANE EDIT: fast-lane Large → bag Edit opens the PDP on Large; Change size lists both; Regular re-prices the SAME row to £5.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);

    const quickAdd = page.getByTestId(`quick-add-${SIZED_ITEM}`);
    await quickAdd.scrollIntoViewIfNeeded();
    await quickAdd.click();
    await page.getByTestId(`size-${SIZE_LARGE}`).click();
    await page.getByTestId("size-continue").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await expect(page.getByTestId("added-total")).toContainText("£7.00");
    await page.getByTestId("added-continue").click();

    await openBag(page);
    await expect(bagRows(page)).toHaveCount(1);
    const itemId = ((await bagRows(page).first().getAttribute("data-testid")) ?? "").replace("bag-row-", "");
    await expect(page.getByTestId(`bag-row-${itemId}`)).toContainText("Large");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£7.00");

    // The PDP opens on the row's own size (its baseItem + selectedVariant).
    await page.getByTestId(`bag-edit-${itemId}`).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-change-size")).toContainText("Large");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£7.00");

    await page.getByTestId("pdp-change-size").click();
    await expect(page.getByTestId(`pdp-variant-${SIZE_REGULAR}`)).toBeVisible();
    await expect(page.getByTestId(`pdp-variant-${SIZE_LARGE}`)).toBeVisible();
    await page.getByTestId(`pdp-variant-${SIZE_REGULAR}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£5.00");
    await page.getByTestId("pdp-add-to-bag").click();

    // The same row, now Regular: Sub £5.00, Total round(5 × 1.15) = £6.00.
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId(`bag-row-${itemId}`)).toContainText("Regular");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£5.00");
    await expect(page.getByTestId("bag-total")).toContainText("£6.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£6.00");
  });
});
