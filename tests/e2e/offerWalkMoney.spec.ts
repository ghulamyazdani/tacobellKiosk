import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  clone,
  CHEESE_BURGER,
  GREEK_SALAD,
} from "./fixtures/backend";
import { bootRegisteredToMenu } from "./pages/boot";
import { addViaPdp, openBag, bagRows, openRewardsSheet } from "./pages/order";

/**
 * Walk 2026-10-14 (offers lane): the money the rewards sheet quotes is the
 * money the bag applies — end to end through the real converter, the bill
 * engine and the screens.
 * - A fixed-SIZE reward is quoted at its size: the converter spreads the
 *   BASE item into the grant (here a £13 parent over a £7 Large), so the
 *   estimate read the parent's price (walk: £1.20 quoted, £5.40 applied).
 * - With that reward applied, a swap preview prices the bag the swap leaves
 *   (its reward row swept first — walk: £34.80 quoted, £12.50 applied).
 * - The picker says "free" only at 100 % (walk: "CHOOSE YOUR FREE ITEM"
 *   over 50 %-off options).
 * - A buy-stage tile for a size prices that size, not the parent.
 *
 * Menu: slim-menu with the Kiddie Meal Beef Burger (£13) re-shaped into a
 * sized item — bag.spec's sizedMenu: Regular £5, Large £7, no add-ons.
 */
const SIZED_ITEM = "5dd1093a188e72ce1b3eb358";
const SIZE_LARGE = "e2e-size-large";

function sizedMenu() {
  const menu = fixtureJson("slim-menu.json");
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities)
        if (entity.id === SIZED_ITEM) {
          entity.hasVariant = true;
          entity.modifiers = [];
          entity.variants = [
            ["e2e-size-regular", "Regular", 5],
            [SIZE_LARGE, "Large", 7],
          ].map(([id, name, price]) => ({ id, name, price, isActive: true, subCategoryId: sub.id }));
        }
  return menu;
}

const offersFixture = fixtureJson("offers.json");
/** An item offer on the stock free-salad offer's production shape (offers.json[2]). */
const itemOffer = (over: Record<string, unknown>) => ({ ...clone(offersFixture[2]), ...over });

/** The LARGE size at 50 % off — a variant-id grant (baseItemId is the size's id). */
const HALF_LARGE = itemOffer({
  _id: "offer-half-large",
  name: "Half price large kiddie burger",
  getItems: {
    items: [
      {
        _id: "gi-half-large",
        baseItemId: SIZE_LARGE,
        name: "Kiddie Meal Beef Burger",
        relation: "and",
        discountType: "percent",
        value: 50,
        quantity: 1,
      },
    ],
    categories: [],
  },
});

/** 50 % off the whole order, no minimum, no cap. */
const HALF_ORDER = {
  ...clone(offersFixture[0]),
  _id: "offer-half-order",
  name: "Half off your order",
  type: { name: "percent", value: 50 },
  minBillAmount: null,
  maxDiscount: null,
};

/** Buy a LARGE kiddie burger, get a Greek Salad free — a size-specific buy tile. */
const BUY_LARGE = itemOffer({
  _id: "offer-buy-large",
  name: "Buy a large kiddie burger get a salad free",
  getItemOnly: false,
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [{ item: { baseItemId: SIZE_LARGE, name: "Large Kiddie Burger" }, quantity: 1, relation: "and" }],
  },
  getItems: {
    items: [
      {
        _id: "gi-buy-large-salad",
        baseItemId: GREEK_SALAD,
        name: "Greek Salad",
        relation: "and",
        discountType: "percent",
        value: 100,
        quantity: 1,
      },
    ],
    categories: [],
  },
});

/** Radio-pick an eligible row and commit via SAVE SELECTION. */
async function pickAndSave(page: Page, offerId: string) {
  await page.getByTestId(`offer-row-${offerId}`).click();
  await expect(page.getByTestId(`offer-row-${offerId}`)).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("rewards-save").click();
  await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
}

test.describe("Walk 2026-10-14 — the quoted saving is the applied saving", () => {
  test("a 50 %-off Large is quoted £3.50 (its £7, not the £13 parent) and the bag applies £3.50; with it applied, 50 % off the order previews £4.00 — the swap applies £4.00", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { menu: sizedMenu(), offers: [HALF_LARGE, HALF_ORDER] });
    await bootRegisteredToMenu(page);
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await openBag(page);
    await openRewardsSheet(page);

    await expect(page.getByTestId(`offer-row-body-${HALF_LARGE._id}`)).toContainText("Save £3.50");
    await pickAndSave(page, HALF_LARGE._id);

    // A fixed size goes through the picker: its header names the 50 %.
    await expect(page.getByRole("dialog", { name: "Choose Your 50% off Item" })).toBeVisible();
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText("Save £3.50");

    // The applied row reopens the sheet: the swap preview prices the £8 the
    // swap leaves (never 50 % of £8 + the £3.50 reward row = £5.75).
    await page.getByTestId("bag-rewards-applied").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId(`offer-row-body-${HALF_ORDER._id}`)).toContainText("Save £4.00");
    await pickAndSave(page, HALF_ORDER._id);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText("Save £4.00");
    await expect(bagRows(page)).toHaveCount(1); // the reward row went with the swap
  });

  test("a buy-stage tile for the Large size prices the Large (£7), never the £13 parent", async ({ page }) => {
    await mockBackend(page, { menu: sizedMenu(), offers: [BUY_LARGE] });
    await bootRegisteredToMenu(page);
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await openBag(page);
    await openRewardsSheet(page);
    await page.getByTestId(`offer-row-add-items-${BUY_LARGE._id}`).click();
    await expect(page.getByTestId("buy-stage-sheet")).toBeVisible();

    const tile = page.getByTestId(`buy-stage-tile-${SIZED_ITEM}`);
    await expect(tile).toContainText("(Large)");
    await expect(tile).toContainText("£7");
    await expect(tile).not.toContainText("£13");
  });
});
