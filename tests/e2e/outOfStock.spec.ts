import { test, expect, type Page, type Route } from "./fixtures/kiosk";
import {
  mockKioskBackend,
  fixtureJson,
  locale,
  CHEESE_BURGER,
  GREEK_SALAD,
  LARGE_FRIES,
  EXTRA_PICKLES,
  DREAM_BOX,
} from "./fixtures/backend";
import { bootRegisteredToMenu } from "./pages/boot";
import { addOneTap, addViaPdp, openBag, bagRows } from "./pages/order";

/**
 * Lane walk-oos — out of stock, end to end (user report 2026-10-14: "in
 * posistKiosk items are visible as unavailable but in this its showing
 * available … out of stock is not working fine in cart as well … proper
 * error message and indication of which item is out of stock").
 *
 * The backend's feed is posistKiosk's: POST /api/cx/kiosk/get_out_of_stock,
 * Kiosk partner rows keyed by item_id and type ("item" / "variant" /
 * "addon" / "combo"). The menu is converted with it at /second (every
 * constituent item stamped); PAY asks again for the bag's ids.
 *
 * slim-menu facts: Cheese Burger (£8) — its "Extra" group (0–3) holds Extra
 * Pickles (+£1), Extra Ketchup and Extra Mustard (free); Large Fries a plain
 * card; Greek Salad a one-tap item.
 */

const en = locale("en");
const PICKLES_GROUP = `${CHEESE_BURGER}_1573980469_addons`;
const EXTRA_KETCHUP = "5dd1093f188e72ce1b3eb36a";
const EXTRA_MUSTARD = "5dd2f69029446a316cf7cf0b";

/** A Kiosk feed row: out of stock. */
const soldOut = (item_id: string, type: string) => ({
  item_id,
  type,
  partners: { partner_name: "Kiosk", inStock: false },
});
const outOfStock = (names: string) => en.bag.outOfStock.replace("{{names}}", names);

/** slim-menu with Extra Ketchup (sold out below) and Extra Mustard as the Extra group's defaults. */
function menuWithDefaults() {
  const menu = fixtureJson("slim-menu.json");
  for (const group of menu.modifiers)
    if (group._id === PICKLES_GROUP)
      for (const item of group.constituentItems)
        if (item.id === EXTRA_KETCHUP || item.id === EXTRA_MUSTARD) item.isDefault = true;
  return menu;
}

/** The option testids of a PDP group, in order (the card / row roots only). */
const optionOrder = (page: Page, groupId: string) =>
  page
    .getByTestId(`pdp-group-${groupId}`)
    .locator('[data-testid^="pdp-option-"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("data-testid") ?? "")
        .filter((id) => !/-(cta|select|customize)-/.test(id)),
    );

/** A cart row's itemId (runtime-generated "<stamp>_<entity id>") by its entity. */
async function rowIdOf(page: Page, entityId: string): Promise<string> {
  const row = page.locator(`[data-testid^="bag-row-"][data-testid$="_${entityId}"]`);
  await expect(row).toBeVisible();
  return ((await row.getAttribute("data-testid")) ?? "").replace("bag-row-", "");
}

test.describe("walk-oos — out of stock on the menu, the PDP and the bag", () => {
  test("MENU + PDP: the feed at load greys the sold-out card and the sold-out add-ons — last, Unavailable, not pickable — and a sold-out default is never pre-picked", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, {
      menu: menuWithDefaults(),
      outOfStock: [
        soldOut(LARGE_FRIES, "item"),
        soldOut(EXTRA_PICKLES, "addon"),
        soldOut(EXTRA_KETCHUP, "addon"),
      ],
    });
    await bootRegisteredToMenu(page);

    // The menu card: MenuItemCard's unavailable look, inert.
    const fries = page.getByTestId(`item-${LARGE_FRIES}`);
    await fries.scrollIntoViewIfNeeded();
    await expect(fries).toHaveAttribute("aria-disabled", "true");
    await expect(fries).toContainText(en.menu.unavailable);
    await expect(fries.getByRole("button")).toHaveCount(0);

    // The PDP: the sold-out add-ons last, the in-stock default picked.
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect.poll(() => optionOrder(page, PICKLES_GROUP)).toEqual([
      `pdp-option-${EXTRA_MUSTARD}`,
      `pdp-option-${EXTRA_PICKLES}`,
      `pdp-option-${EXTRA_KETCHUP}`,
    ]);
    const pickles = page.getByRole("group", { name: "Extra Pickles, unavailable" });
    await expect(pickles).toHaveAttribute("aria-disabled", "true");
    await expect(pickles).toContainText(en.menu.unavailable);
    await expect(pickles.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Extra Ketchup, unavailable" })).toBeVisible();
    await expect(page.getByTestId(`pdp-option-${EXTRA_MUSTARD}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`pdp-group-${PICKLES_GROUP}`)).toContainText("1 of 3");

    // A tap on a sold-out card picks nothing: the price stays £8.
    await pickles.click({ force: true });
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");

    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("added-continue").click();
    await openBag(page);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toContainText("Extra Mustard");
    await expect(bagRows(page).first()).not.toContainText("Extra Ketchup");
    await expect(bagRows(page).first()).not.toContainText("Extra Pickles");
  });

  test("walk-oos 2 — MENU: a pack whose required slot has nothing in stock can never be completed — its card is the sold-out card; the sister pack stays live", async ({
    page,
  }) => {
    // Dream box 1's Sandwich slot (min 1) holds one option; the spicy box's
    // Sandwich is another. The feed sells the first out (a combo row).
    const DREAM_SANDWICH = "65d4a2d2003967427ed83616";
    const DREAM_BOX_SPICY = "68dd79b84c041931d29d6126";
    await mockKioskBackend(page, { outOfStock: [soldOut(DREAM_SANDWICH, "combo")] });
    await bootRegisteredToMenu(page);

    const box = page.getByTestId(`item-${DREAM_BOX}`);
    await box.scrollIntoViewIfNeeded();
    await expect(box).toHaveAttribute("aria-disabled", "true");
    await expect(box).toContainText(en.menu.unavailable);
    await expect(box.getByRole("button")).toHaveCount(0);

    const spicy = page.getByTestId(`item-${DREAM_BOX_SPICY}`);
    await expect(spicy).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId(`quick-add-${DREAM_BOX_SPICY}`)).toBeVisible();
  });

  test("walk-oos 2 — MIAM: the Cheese Burger's only meal is that dead pack — no upsell: the tap opens the burger's own PDP, never a meal prompt with no meal on it", async ({
    page,
  }) => {
    const DREAM_SANDWICH = "65d4a2d2003967427ed83616";
    await mockKioskBackend(page, {
      outOfStock: [soldOut(DREAM_SANDWICH, "combo")],
      settings: { enable_combo_upsell: true },
    });
    await bootRegisteredToMenu(page);

    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();

    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
    await expect(page.getByTestId("miam-prompt")).toHaveCount(0);
  });

  test("BAG: an add-on sells out after the menu loaded — PAY's notice and the row NAME it (the pick kept, its line red), PAY stays blocked while it is in the row; Edit shows it Unavailable and deselected; UPDATE; PAY proceeds", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addViaPdp(page, CHEESE_BURGER, { addonId: EXTRA_PICKLES, expectedCta: "£9.00" });
    await openBag(page);
    const burgerId = await rowIdOf(page, CHEESE_BURGER);

    // From here on Extra Pickles is sold out (newest route wins).
    await page.route("**/api/cx/kiosk/get_out_of_stock", (route) =>
      route.fulfill({ json: [soldOut(EXTRA_PICKLES, "addon")] }),
    );
    await page.getByTestId("bag-pay").click();
    await expect(page.getByRole("alertdialog", { name: outOfStock("Extra Pickles") })).toBeVisible();
    await page.getByTestId("global-error-ok").click();
    await expect(page).toHaveURL(/\/cart$/);

    // The row names it, keeps it (its line red) and keeps the money it showed.
    await expect(page.getByTestId(`bag-changed-${burgerId}`)).toHaveText(outOfStock("Extra Pickles"));
    const pickLine = page.getByTestId(`bag-pick-oos-${burgerId}-${EXTRA_PICKLES}`);
    await expect(pickLine).toContainText("Extra Pickles +£1.00");
    await expect(pickLine).toHaveClass(/text-tb-red/);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£9.00");
    await expect(page.getByTestId(`bag-edit-${burgerId}`)).toBeVisible();

    // Still sold out: PAY never goes through with — or silently without — it.
    await page.getByTestId("bag-pay").click();
    await expect(page.getByRole("alertdialog", { name: outOfStock("Extra Pickles") })).toBeVisible();
    await page.getByTestId("global-error-ok").click();
    await expect(page).toHaveURL(/\/cart$/);

    // Review F1: the stock check cannot run (a 500) — fail-open never passes
    // what the row still flags: the same named notice, PAY stays.
    const feedDown = (route: Route) => route.fulfill({ status: 500, json: { message: "stock down" } });
    await page.route("**/api/cx/kiosk/get_out_of_stock", feedDown);
    await page.getByTestId("bag-pay").click();
    await expect(page.getByRole("alertdialog", { name: outOfStock("Extra Pickles") })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("global-error-ok").click();
    await expect(page).toHaveURL(/\/cart$/);
    await page.unroute("**/api/cx/kiosk/get_out_of_stock", feedDown);

    // Edit: the PDP shows it Unavailable (PAY's feed) and has deselected it.
    await page.getByTestId(`bag-edit-${burgerId}`).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByRole("group", { name: "Extra Pickles, unavailable" })).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText(`${en.bag.update} · £8.00`);
    await page.getByTestId("pdp-add-to-bag").click();

    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).not.toContainText("Extra Pickles");
    await expect(page.getByTestId(`bag-changed-${burgerId}`)).toHaveCount(0);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");

    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    await expect(page.getByTestId("global-error")).toHaveCount(0);
  });

  test("W4 #1 — PAY is busy (disabled, aria-busy) while its stock check runs, then goes on", async ({ page }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = 0;
    await page.route("**/api/cx/kiosk/get_out_of_stock", async (route) => {
      asked += 1;
      await held;
      return route.fulfill({ json: [] });
    });
    const pay = page.getByTestId("bag-pay");
    await expect(pay).toHaveAttribute("aria-busy", "false");
    await pay.click();
    await expect.poll(() => asked).toBe(1);
    await expect(pay).toHaveAttribute("aria-busy", "true");
    await expect(pay).toBeDisabled();

    release();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    expect(asked).toBe(1);
  });

  test("W4 #1 — the server clock fails at PAY: PAY goes on with the device clock, never 'Something went wrong'", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);

    let clockAsked = 0;
    await page.route("**/api/tenants/getServerTime", (route) => {
      clockAsked += 1;
      return route.fulfill({ status: 500, json: { message: "clock down" } });
    });
    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    expect(clockAsked).toBe(1);
    await expect(page.getByTestId("global-error")).toHaveCount(0);
  });
});
