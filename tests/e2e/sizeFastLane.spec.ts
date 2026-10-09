import { test, expect, type Page } from "./fixtures/kiosk";
import { mockKioskBackend as mockBackend, fixtureJson } from "./fixtures/backend";
import { bootRegisteredToMenu } from "./pages/boot";
import { openBag, bagRows } from "./pages/order";

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
 * Harness (P9f): the shared mock (fixtures/backend.ts) serves this file's
 * menu; boot and bag steps are the shared page functions (pages/boot.ts,
 * pages/order.ts).
 */

const slimMenu = fixtureJson("slim-menu.json");

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

/** The shared mock (fixtures/backend.ts) with the sized menu. */
const mockKioskBackend = (page: Page) => mockBackend(page, { menu: sizedMenu() });

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
