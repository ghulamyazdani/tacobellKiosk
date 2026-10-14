import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  clone,
  CHEESE_BURGER,
  GREEK_SALAD,
  TORTILLA_SAUCE,
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
  test("a 50 %-off Large is quoted £3.50 (its £7, not the £13 parent) and the bag applies £3.50; with it applied, 50 % off the order previews £4 — the swap applies £4", async ({
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
    // The second line itself: the row's text runs it into "50% off your order".
    await expect(
      page.getByTestId(`offer-row-body-${HALF_ORDER._id}`).getByText("Save £4", { exact: true })
    ).toBeVisible();
    await pickAndSave(page, HALF_ORDER._id);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(/Save £4(?![\d.])/);
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

/* Review of the walk fixes — the picker asks for what CONFIRM needs, and the applied row is the bag's figure. */
const SAUCES_SUB = "5dd1092fbec752021df55e1c"; // Tortilla £2, Caesar £2, BBQ Sauce £1 (PDP)
const freeEntry = (_id: string, baseItemId: string, name: string, relation: "and" | "or") => ({
  _id,
  baseItemId,
  name,
  relation,
  discountType: "percent",
  value: 100,
  quantity: 1,
});

/** "And Offer With Varaint"-shaped: a Greek Salad AND any 2 sauces. */
const SALAD_AND_TWO_SAUCES = itemOffer({
  _id: "offer-salad-and-two-sauces",
  name: "A salad and any 2 sauces",
  getItems: {
    items: [freeEntry("gi-and-salad", GREEK_SALAD, "Greek Salad", "and")],
    categories: [{ _id: SAUCES_SUB, name: "Sauces", quantity: 2, relation: "and", value: 100, discountType: "percent" }],
  },
});

/** A Greek Salad (£17) OR a Tortilla Sauce (£2): "up to £17", the guest takes the sauce. */
const SALAD_OR_SAUCE = itemOffer({
  _id: "offer-salad-or-sauce",
  name: "A salad or a sauce",
  getItems: {
    items: [
      freeEntry("gi-or-salad", GREEK_SALAD, "Greek Salad", "or"),
      freeEntry("gi-or-sauce", TORTILLA_SAUCE, "Tortilla Sauce", "or"),
    ],
    categories: [],
  },
});

test.describe("Review of the walk fixes — what the picker asks for, what the applied row says", () => {
  test("an 'and' reward with a group says 'Select 2 items…' and CONFIRM waits for both picks", async ({ page }) => {
    test.slow();
    await mockBackend(page, { offers: [SALAD_AND_TWO_SAUCES] });
    await bootRegisteredToMenu(page);
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await openBag(page);
    await openRewardsSheet(page);
    await pickAndSave(page, SALAD_AND_TWO_SAUCES._id);

    const picker = page.getByTestId("freebie-picker");
    await expect(picker).toContainText("Select 2 items to redeem with your reward.");
    await expect(picker).not.toContainText("These items come with your reward.");
    const confirm = page.getByTestId("freebie-confirm");
    const tortilla = page.getByTestId(`freebie-cat-option-${SAUCES_SUB}-${TORTILLA_SAUCE}`);
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await tortilla.click();
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await tortilla.click();
    await expect(confirm).toHaveAttribute("aria-disabled", "false");
    await confirm.click();
    await expect(picker).toHaveCount(0);
    // £17 salad + 2 × £2 sauces, all free.
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(/Save £21(?![\d.])/);
  });

  test("an 'or' reward quoted 'up to £17' and applied at £2: the reopened sheet's applied row reads the bag's £2", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { offers: [SALAD_OR_SAUCE] });
    await bootRegisteredToMenu(page);
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await openBag(page);
    await openRewardsSheet(page);
    await expect(page.getByTestId(`offer-row-body-${SALAD_OR_SAUCE._id}`)).toContainText(/Save up to £17(?![\d.])/);
    await pickAndSave(page, SALAD_OR_SAUCE._id);

    await page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`).click();
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(/Save £2(?![\d.])/);

    await page.getByTestId("bag-rewards-applied").click();
    const applied = page.getByTestId(`offer-row-body-${SALAD_OR_SAUCE._id}`);
    await expect(applied).toContainText("Applied");
    await expect(applied).toContainText(/Save £2(?![\d.])/);
    await expect(applied).not.toContainText("up to");
  });
});
