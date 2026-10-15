import { test, expect, type Locator, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend,
  fixtureJson,
  locale,
  CAESAR_DRESSING,
  CHEESE_BURGER,
  LARGE_FRIES,
  MEALS_COMBOS,
  SIDE_ORDERS,
  TORTILLA_SAUCE,
} from "./fixtures/backend";
import { registerToStart, startToSecond, chooseLanguage, pickPipelineToMenu } from "./pages/boot";
import { addOneTap, openBag } from "./pages/order";
import { clippedText } from "./fixtures/clippedText";
import { stageBox } from "./fixtures/a11y";

/**
 * User 2026-10-15: "in posistkiosk the view is subcategory on the basis of the settings which are on
 * please integrate those". posistKiosk's menu layout settings, end to end, in the TB look:
 *
 * - getMenu `settings.send_categories` (per order type) → the rail lists the SUB-categories in the
 *   converter's flat order — `order` across categories: slim-menu's Boxes 4 · Side Orders 7 · Sauces 10
 *   · Kiddie Meal 11 interleave its two categories (the parity proof) — each its own H2, no H3;
 * - kiosk `one_category_at_a_time` → the pane shows only the selected row's section; a tap swaps it,
 *   from its top, and the choice outlives the PDP (Menu remounts; posistKiosk's syncCategoryToRedux);
 * - kiosk `show_only_supercategories` → the categories again, whatever send_categories says;
 * - all off → today's view: the categories, one scroll (every other menu spec).
 *
 * The shared slim-menu has send_categories OFF — the category view the other specs assert;
 * tenantMenu() turns it back on, as its tenant serves it. Each mode runs in EN, AR (the `ar` aliases,
 * FSI…PDI isolated: toContainText only) and ADA (the reach zone), with the clippedText probe clean.
 */

const en = locale("en");

// ---- slim-menu sub-category ids (fixtures/backend.ts has the category ids) ----
const BOXES = "67b18913fdf6f421a9cc4b6c"; // Meals / Combos, order 4: three packs
const SIDE_ORDERS_SUB = "5dd1092e29754a432f2c32d7"; // Side Orders, order 7: salad, burger, fries
const SAUCES = "5dd1092fbec752021df55e1c"; // Side Orders, order 10
const KIDDIE_MEAL = "5dd10932d61b199c2e6bbe77"; // Meals / Combos, order 11

/** The ADA brand panel's height (src/components/stage/KioskStage.tsx; ada.spec.ts). */
const ADA_BRAND_ZONE_HEIGHT = 798;

/** slim-menu as its tenant serves it: send_categories ON. */
function tenantMenu() {
  const menu = fixtureJson("slim-menu.json");
  menu.settings.send_categories = true;
  return menu;
}

interface Row {
  id: string;
  en: string;
  ar: string;
}
const SUB_ROWS: Row[] = [
  { id: BOXES, en: "Boxes", ar: "صناديق" },
  { id: SIDE_ORDERS_SUB, en: "Side Orders", ar: "الطلبات الجانبية" },
  { id: SAUCES, en: "Sauces", ar: "الصلصات" },
  { id: KIDDIE_MEAL, en: "Kiddie Meal", ar: "وجبات الأطفال" },
];
const CATEGORY_ROWS: Row[] = [
  { id: MEALS_COMBOS, en: "Meals / Combos", ar: "الوجبات والكمبو" },
  { id: SIDE_ORDERS, en: "Side Orders", ar: "الطلبات الجانبية" },
];

interface Mode {
  name: string;
  sendCategories: boolean;
  settings: Record<string, unknown>;
  rows: Row[];
  oneAtATime: boolean;
}
const MODES: Mode[] = [
  {
    name: "all off: the categories, one scroll (today's view)",
    sendCategories: false,
    settings: {},
    rows: CATEGORY_ROWS,
    oneAtATime: false,
  },
  {
    name: "send_categories + one_category_at_a_time (the posistKiosk tenant): the sub-categories, the selected one alone",
    sendCategories: true,
    settings: { one_category_at_a_time: true },
    rows: SUB_ROWS,
    oneAtATime: true,
  },
  {
    name: "send_categories: the sub-categories, one scroll",
    sendCategories: true,
    settings: {},
    rows: SUB_ROWS,
    oneAtATime: false,
  },
  {
    name: "one_category_at_a_time: the categories, the selected one alone",
    sendCategories: false,
    settings: { one_category_at_a_time: true },
    rows: CATEGORY_ROWS,
    oneAtATime: true,
  },
  {
    name: "show_only_supercategories over both: the categories, the selected one alone",
    sendCategories: true,
    settings: { one_category_at_a_time: true, show_only_supercategories: true },
    rows: CATEGORY_ROWS,
    oneAtATime: true,
  },
];

type Lang = "en" | "ar" | "ada";

async function openMenu(
  page: Page,
  lang: Lang,
  opts: { menu?: unknown; settings?: Record<string, unknown>; outOfStock?: unknown[] } = {}
) {
  await mockKioskBackend(page, {
    arabic: true,
    menu: opts.menu,
    outOfStock: opts.outOfStock,
    settings: { accessibility_mode: true, ...opts.settings },
  });
  await registerToStart(page);
  await startToSecond(page);
  if (lang === "ar") await chooseLanguage(page, "ar");
  await pickPipelineToMenu(page);
  if (lang === "ada") {
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
  }
}

const testIds = (scope: Locator) => scope.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
const railRows = (page: Page) => page.getByTestId("category-rail").locator('[data-testid^="rail-"]');
const sections = (page: Page) => page.locator('[data-testid^="section-"]');
const current = (page: Page) => page.locator('[data-testid^="rail-"][aria-current="true"]');
/** The menu's scroll pane: the sections' parent. */
const menuPane = (page: Page) => sections(page).first().locator("xpath=..");
const scrollTopOf = (scroller: Locator) => scroller.evaluate((el) => el.scrollTop);

/** The selected row reads as selected AND shows whole inside the rail's own scroll box. */
async function expectRowShown(page: Page, id: string) {
  const row = page.getByTestId(`rail-${id}`);
  await expect(current(page)).toHaveAttribute("data-testid", `rail-${id}`);
  await expect(row).toBeInViewport({ ratio: 1 });
}

test.describe("menu layout settings — send_categories / one_category_at_a_time (user 2026-10-15)", () => {
  for (const mode of MODES) {
    for (const lang of ["en", "ar", "ada"] as const) {
      test(`${lang.toUpperCase()} · ${mode.name}`, async ({ page }) => {
        test.slow();
        await openMenu(page, lang, {
          menu: mode.sendCategories ? tenantMenu() : undefined,
          settings: mode.settings,
        });
        const { rows } = mode;
        const sub = rows === SUB_ROWS;
        const label = (row: Row) => (lang === "ar" ? row.ar : row.en);
        const [first, last] = [rows[0], rows[rows.length - 1]];

        // The rail: this mode's rows in order, in the guest's language; the first one marked.
        await expect.poll(() => testIds(railRows(page))).toEqual(rows.map((row) => `rail-${row.id}`));
        for (const row of rows) await expect(page.getByTestId(`rail-${row.id}`)).toContainText(label(row));
        await expectRowShown(page, first.id);

        // The pane: the first row alone, or every row in the rail's order. A section's H2 is its row's
        // name; a sub-category section has no H3 (Meals / Combos keeps its two).
        expect(await testIds(sections(page))).toEqual((mode.oneAtATime ? [first] : rows).map((row) => `section-${row.id}`));
        const firstHeading = page.getByTestId(`section-${first.id}`).locator("h2");
        await expect(firstHeading).toContainText(label(first));
        await expect(page.getByTestId(`section-${first.id}`).locator("h3")).toHaveCount(sub ? 0 : 2);
        if (sub) await expect(sections(page).locator("h3")).toHaveCount(0);

        if (lang === "ada") {
          // The reach zone holds the rail and the pane: both start below the brand panel, on screen.
          for (const target of [page.getByTestId(`rail-${first.id}`), firstHeading]) {
            await expect(target).toBeInViewport();
            expect((await stageBox(target)).y).toBeGreaterThanOrEqual(ADA_BRAND_ZONE_HEIGHT);
          }
        }
        expect.soft(await clippedText(page), `${lang}: text the layout cuts off`).toEqual([]);

        // A tap on the last row.
        const pane = menuPane(page);
        if (mode.oneAtATime) {
          // The pane swaps to that section alone, from its top.
          await pane.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          await page.getByTestId(`rail-${last.id}`).click();
          await expect.poll(() => testIds(sections(page))).toEqual([`section-${last.id}`]);
          expect(await scrollTopOf(pane)).toBe(0);
        } else {
          // One scroll: the pane jumps (reduced motion, the suite's default) to the section; all stay.
          await page.getByTestId(`rail-${last.id}`).click();
          const landed = await page.getByTestId(`section-${last.id}`).evaluate((section) => {
            const scroller = section.parentElement as HTMLElement;
            const top = (section as HTMLElement).offsetTop;
            const target = Math.min(top - 24, scroller.scrollHeight - scroller.clientHeight);
            return { target, scrollTop: scroller.scrollTop };
          });
          expect(landed.target, "the pane has somewhere to go").toBeGreaterThan(0);
          expect(Math.abs(landed.scrollTop - landed.target)).toBeLessThanOrEqual(1);
          expect(await testIds(sections(page))).toEqual(rows.map((row) => `section-${row.id}`));
        }
        await expectRowShown(page, last.id);
        const lastHeading = page.getByTestId(`section-${last.id}`).locator("h2");
        await expect(lastHeading).toContainText(label(last));
        await expect(lastHeading).toBeInViewport();
        expect.soft(await clippedText(page), `${lang}: text the layout cuts off, after the tap`).toEqual([]);
      });
    }
  }

  test("EN · the tenant's view: a sold-out card, a one-tap add (the added modal, the bag CTA), MIAM → the PDP and back, and the bag — the selected sub-category stays", async ({
    page,
  }) => {
    test.slow();
    await openMenu(page, "en", {
      menu: tenantMenu(),
      settings: { one_category_at_a_time: true, enable_combo_upsell: true },
      outOfStock: [{ item_id: CAESAR_DRESSING, type: "item", partners: { partner_name: "Kiosk", inStock: false } }],
    });

    // Sauces: the sold-out Caesar is the inert Unavailable card; Tortilla Sauce lands with one tap.
    await page.getByTestId(`rail-${SAUCES}`).click();
    const caesar = page.getByTestId(`item-${CAESAR_DRESSING}`);
    await expect(caesar).toHaveAttribute("aria-disabled", "true");
    await expect(caesar).toContainText(en.menu.unavailable);
    await expect(caesar.getByRole("button")).toHaveCount(0);
    await addOneTap(page, TORTILLA_SAUCE, "(1)");
    await expectRowShown(page, SAUCES);

    // Side Orders: the burger offers the meal first (MIAM); "not today" goes on to its PDP; BACK lands on
    // the same sub-category (the menu remounted).
    await page.getByTestId(`rail-${SIDE_ORDERS_SUB}`).click();
    await page.getByTestId(`item-${CHEESE_BURGER}`).click();
    const prompt = page.getByTestId("miam-prompt");
    await expect(prompt).toBeVisible();
    await prompt.getByTestId("miam-decline").click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expectRowShown(page, SIDE_ORDERS_SUB);
    expect(await testIds(sections(page))).toEqual([`section-${SIDE_ORDERS_SUB}`]);

    // The bag (/cart: the same page under its sheet) and back.
    await openBag(page);
    await page.getByTestId("bag-close").click();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await expectRowShown(page, SIDE_ORDERS_SUB);
    expect(await testIds(sections(page))).toEqual([`section-${SIDE_ORDERS_SUB}`]);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
  });

  /**
   * A long rail in the ADA reach zone (~12 rows): every slim item in each of 16 sub-categories, so the
   * rail AND each section overflow. A row picked far down, a PDP and BACK: the remounted rail shows it.
   */
  test("ADA · a long rail: a row far down is still in view after the PDP round trip; a tap shows the next section from its top", async ({
    page,
  }) => {
    test.slow();
    const menu = tenantMenu();
    const everyItem = menu.categories.flatMap((category: { subCategories: { entities: unknown[] }[] }) =>
      category.subCategories.flatMap((subCategory) => subCategory.entities)
    );
    const meals = menu.categories.find((category: { id: string }) => category.id === MEALS_COMBOS);
    meals.subCategories = Array.from({ length: 16 }, (_, i) => ({
      ...meals.subCategories[0],
      id: `long-${i + 1}`,
      name: `Row ${i + 1}`,
      aliases: [],
      order: i + 1,
      entities: everyItem,
    }));
    menu.categories = [meals];
    await openMenu(page, "ada", { menu, settings: { one_category_at_a_time: true } });

    const list = page.getByTestId("category-rail").locator("> div").last();
    const overflows = (scroller: Locator) => scroller.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(await overflows(list), "the ADA rail overflows").toBe(true);
    expect(await overflows(menuPane(page)), "a section overflows the ADA pane").toBe(true);

    // Down the rail by touch scroll; pick row 14, then scroll its section down and pick row 15.
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.getByTestId("rail-long-14").click();
    await expect.poll(() => testIds(sections(page))).toEqual(["section-long-14"]);
    await menuPane(page).evaluate((el) => {
      el.scrollTop = 400;
    });
    await page.getByTestId("rail-long-15").click();
    await expect.poll(() => testIds(sections(page))).toEqual(["section-long-15"]);
    expect(await scrollTopOf(menuPane(page)), "the new section starts at its top").toBe(0);

    // The PDP and BACK: Menu remounts; the rail opens on row 15, whole in its box.
    const fries = page.getByTestId(`item-${LARGE_FRIES}`);
    await fries.scrollIntoViewIfNeeded();
    await fries.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    expect(await testIds(sections(page))).toEqual(["section-long-15"]);
    await expectRowShown(page, "long-15");
    expect(await scrollTopOf(list), "the rail opened scrolled to it").toBeGreaterThan(0);
    expect.soft(await clippedText(page), "text the layout cuts off").toEqual([]);
  });
});
