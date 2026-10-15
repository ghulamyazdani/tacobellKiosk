import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend,
  fixtureJson,
  locale,
  clone,
  DINE_IN,
  CHEESE_BURGER,
  TORTILLA_SAUCE,
} from "./fixtures/backend";
import { registerToStart, startToSecond, chooseLanguage, pickPipelineToMenu } from "./pages/boot";
import { addOneTap, addViaPdp, openBag, openRewardsSheet, bagRows } from "./pages/order";
import { arabicNotIsolated, englishCopy, untranslatedCopy } from "./fixtures/a11y";
import { settle, shot } from "./fixtures/capture";
import { clippedText } from "./fixtures/clippedText";

/**
 * Lane bag-ribbon (user 2026-10-15, "Add it, like posistKiosk"): under an
 * applied least-value offer the bag rows it covers wear posistKiosk's ribbon
 * wording on the bag's chip and strike their line to what the bill charges.
 *
 * "Any 4 of the two, your 3 cheapest free" over 2 × burger (£8) + 2 × sauce
 * (£2): both sauces and one burger go free — the sauce row "Free" £4.00 →
 * £0.00, the burger row "1 Free" £16.00 → £8.00 (one chip: the quantity never
 * splits), and the rows' savings are the Discounts line, −£12.00. Real-length
 * names (TB India's, with Arabic aliases of the same length — visual-offers)
 * run each name to 2 lines over its chip; EN, AR and the ADA reach zone are
 * captured with the clippedText probe.
 */

const MINUS = "−";
const NAMES: Record<string, [string, string]> = {
  [CHEESE_BURGER]: [
    "Ultimate Cheese Crunchwrap Non Veg + Seasoned Fries & Pepsi",
    "كرانش راب الجبن الفاخر باللحم + بطاطس متبلة وبيبسي",
  ],
  [TORTILLA_SAUCE]: [
    "Taco Party Pack (Box of 6 Crunchy Wheat Tacos)- Veg",
    "باقة حفلة التاكو (علبة 6 تاكو قمح مقرمش) - نباتي",
  ],
};

/** slim-menu with the real-length names. */
function longNamesMenu() {
  const menu = fixtureJson("slim-menu.json");
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities) {
        const names = NAMES[entity.id];
        if (!names) continue;
        entity.name = names[0];
        entity.aliases = [{ value: names[1], name: "Arabic", code: "ar", dir: "rtl" }];
      }
  return menu;
}

const LEAST_THREE = {
  ...clone(fixtureJson("offers.json")[2]),
  _id: "offer-least-three",
  name: "Any 4 Crunchwraps Or Party Packs, Your 3 Cheapest Free",
  getItemOnly: false,
  getLeastValueItem: true,
  leastItemValueCount: { buyQuantity: 4, getQuantity: 3 },
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [
      { item: { baseItemId: CHEESE_BURGER, name: "Cheese Burger" } },
      { item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" } },
    ],
  },
  getItems: { items: [], categories: [] },
};

type Mode = "en" | "ar" | "ada";

/** The menu's repeat sheet (a tap on the in-bag burger): its row's +, then closed. */
async function repeatInc(page: Page, entityId: string) {
  const card = page.getByTestId(`item-${entityId}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("repeat-sheet")).toBeVisible();
  const row = page.locator('[data-testid^="repeat-row-"]').first();
  const itemId = ((await row.getAttribute("data-testid")) ?? "").replace("repeat-row-", "");
  await page.getByTestId(`repeat-inc-${itemId}`).click();
  await page.getByTestId("repeat-sheet-close").click();
  await expect(page.getByTestId("repeat-sheet")).toHaveCount(0);
}

/** The bag row's itemId, by the item's name in this mode. */
async function rowId(page: Page, entityId: string, mode: Mode) {
  const row = bagRows(page).filter({ hasText: NAMES[entityId][mode === "ar" ? 1 : 0] });
  return ((await row.getAttribute("data-testid")) ?? "").replace("bag-row-", "");
}

/** A node's text without the Arabic isolates (i18n wraps every AR string and value). */
const bare = (page: Page, testId: string) => async () =>
  ((await page.getByTestId(testId).textContent()) ?? "").replace(/[\u2066-\u2069]/g, "");
const figure = (text: string | null) => Number((text ?? "").replace(/[^\d.]/g, ""));

test.describe("bag-ribbon — a least-value offer marks the bag rows it covers", () => {
  for (const mode of ["en", "ar", "ada"] as const) {
    test(`${mode.toUpperCase()}: Free / 1 Free chips over 2-line names, struck line prices, the rows' savings = the Discounts line`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page, {
        arabic: true,
        settings: { accessibility_mode: true },
        menu: longNamesMenu(),
        offers: [LEAST_THREE],
        // The bag's order-type toggle names the pipeline: Arabic server data (offers.spec).
        pipelines: [{ ...DINE_IN, secondary_name: "تناول في المطعم" }],
      });
      await registerToStart(page);
      await startToSecond(page);
      if (mode === "ar") await chooseLanguage(page, "ar");
      await pickPipelineToMenu(page);
      if (mode === "ada") {
        await page.getByTestId("footer-ada").click();
        await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
      }

      await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
      await repeatInc(page, CHEESE_BURGER);
      await addOneTap(page, TORTILLA_SAUCE, "(3)");
      await addOneTap(page, TORTILLA_SAUCE, "(4)");
      await openBag(page);
      await expect(bagRows(page)).toHaveCount(2);
      // Not applied yet: no chip, no strike.
      await expect(page.locator('[data-testid^="bag-least-chip-"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="bag-was-"]')).toHaveCount(0);

      await openRewardsSheet(page);
      await page.getByTestId(`offer-row-${LEAST_THREE._id}`).click();
      await page.getByTestId("rewards-save").click();
      await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
      await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£12.00`);

      const copy = locale(mode === "ar" ? "ar" : "en").offers;
      const sauce = await rowId(page, TORTILLA_SAUCE, mode);
      const burger = await rowId(page, CHEESE_BURGER, mode);
      await expect.poll(bare(page, `bag-least-chip-${sauce}`)).toBe(copy.free);
      await expect.poll(bare(page, `bag-least-chip-${burger}`)).toBe(copy.unitsFree.replace("{{units}}", "1"));
      await expect(page.locator('[data-testid^="bag-least-chip-"]')).toHaveCount(2);
      await expect(page.getByTestId(`bag-was-${sauce}`)).toHaveText("£4.00");
      await expect(page.getByTestId(`bag-price-${sauce}`)).toHaveText("£0.00");
      await expect(page.getByTestId(`bag-was-${burger}`)).toHaveText("£16.00");
      await expect(page.getByTestId(`bag-price-${burger}`)).toHaveText("£8.00");

      // What the rows strike adds up to the Discounts figure.
      let saved = 0;
      for (const id of [sauce, burger]) {
        saved += figure(await page.getByTestId(`bag-was-${id}`).textContent());
        saved -= figure(await page.getByTestId(`bag-price-${id}`).textContent());
      }
      expect(saved).toBe(figure(await page.getByTestId("bag-discounts").textContent()));

      // Each name runs to 2 lines; its chip sits whole below it.
      for (const id of [sauce, burger]) {
        const lines = await page
          .getByTestId(`bag-row-${id}`)
          .locator("p")
          .first()
          .evaluate((p: HTMLElement) => Math.round(p.offsetHeight / parseFloat(getComputedStyle(p).lineHeight)));
        expect.soft(lines, `${mode}: ${id}'s name lines`).toBeGreaterThanOrEqual(2);
      }

      await expect(page.getByTestId("offer-applied-celebration")).toHaveCount(0);
      // The applied row's pop scrolls the short ADA sheet past the rows: both back on screen.
      await bagRows(page).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
      await expect(page.getByTestId(`bag-was-${sauce}`)).toBeInViewport();
      await settle(page);
      await shot(page, `bag-least-value-${mode}`);
      expect.soft(await clippedText(page), `${mode}: text the layout cuts off`).toEqual([]);
      if (mode === "ar") {
        const chips = (found: string[]) => found.filter((s) => s.startsWith("bag-least-chip-"));
        expect.soft(chips(await untranslatedCopy(page, englishCopy())), "ar: English chips").toEqual([]);
        expect.soft(chips(await arabicNotIsolated(page)), "ar: chips outside an isolate").toEqual([]);
      }
    });
  }
});
