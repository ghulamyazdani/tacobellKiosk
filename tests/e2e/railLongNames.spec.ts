import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend,
  fixtureJson,
  MEALS_COMBOS,
  SIDE_ORDERS,
} from "./fixtures/backend";
import { registerToStart, startToSecond, chooseLanguage, pickPipelineToMenu } from "./pages/boot";
import { clippedText } from "./fixtures/clippedText";

/**
 * rail-wrap (user report 2026-10-14: "some category name which are big eg.
 * New Herfy Super Category, is getting cut please fix") — long category names
 * in the menu rail, measured in the running app in EN, AR and ADA.
 *
 * The rail rows were a fixed 64 px of Cm Bd 30/24 in a 179 px text box: two
 * lines fit, and a third ran past the row (over the next row, or cut by the
 * list's scroll box on the last one — the tenant's "NEW HERFY / SUPER /
 * CATGEORY"). A row is now AT LEAST 64 px with 8 px insets: one and two lines
 * keep the 64 px pill, three lines make it 88; a word wider than the box breaks
 * inside it. The selected pill is the row's own fill, so it grows with it.
 *
 * Fixture: the slim menu split into four rows — "Meals / Combos" (2 lines in
 * EN), "Side Orders" (1 line), the tenant's own spelling (3 lines; a longer
 * Arabic alias) and the same name typed without spaces (one word, no alias:
 * Arabic falls back to it). Two sub-categories move into the new rows, so no
 * item is duplicated.
 *
 * EN and ADA read the self-hosted Archivo, so their line counts are pinned.
 * Arabic renders in the machine's fallback face: there only the geometry and
 * "the long alias wraps to 3+ lines" are asserted (its text is ~2.5 boxes wide).
 */

/** The tenant's category, in its own spelling. */
const TENANT = "herfy-super";
const TENANT_NAME = "NEW HERFY SUPER CATGEORY";
const TENANT_AR = "فئة هيرفي سوبر الجديدة المميزة للعائلة";
/** The same name typed as one word: wider than the 179 px box. */
const ONE_WORD = "herfy-one-word";
const ONE_WORD_NAME = "NEWHERFYSUPERCATEGORY";

/** EN / ADA lines per row (Archivo 62 % / 700, 30/24, 179 px box). */
const EN_LINES: Record<string, number> = {
  [MEALS_COMBOS]: 2,
  [SIDE_ORDERS]: 1,
  [TENANT]: 3,
  [ONE_WORD]: 2,
};

/** The design rule: 64 px for 1–2 lines, then 24 px a line inside 8 px insets. */
const rowHeight = (lines: number) => Math.max(64, 8 + 24 * lines + 8);

/** slim-menu with the two long rows (header). */
function railMenu() {
  const menu = fixtureJson("slim-menu.json");
  const category = (id: string) => menu.categories.find((c: { id: string }) => c.id === id);
  const meals = category(MEALS_COMBOS);
  const sides = category(SIDE_ORDERS);
  const [kiddie, boxes] = meals.subCategories;
  const [sideOrders, sauces] = sides.subCategories;
  meals.subCategories = [kiddie];
  sides.subCategories = [sideOrders];
  menu.categories.push(
    {
      ...sides,
      id: TENANT,
      name: TENANT_NAME,
      order: 5,
      aliases: [{ value: TENANT_AR, name: "Arabic", code: "ar", dir: "rtl" }],
      subCategories: [sauces],
    },
    { ...meals, id: ONE_WORD, name: ONE_WORD_NAME, order: 6, aliases: [], subCategories: [boxes] }
  );
  return menu;
}

type Mode = "en" | "ar" | "ada";

async function openMenu(page: Page, mode: Mode) {
  await mockKioskBackend(page, {
    arabic: true,
    settings: { accessibility_mode: true },
    menu: railMenu(),
  });
  await registerToStart(page);
  await startToSecond(page);
  if (mode === "ar") await chooseLanguage(page, "ar");
  await pickPipelineToMenu(page);
  if (mode === "ada") {
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
  }
  const tenant = page.getByTestId(`rail-${TENANT}`);
  await expect(tenant).toContainText(mode === "ar" ? TENANT_AR : TENANT_NAME);
  await expect(page.getByTestId(`rail-${ONE_WORD}`)).toContainText(ONE_WORD_NAME);
}

interface Row {
  id: string;
  lines: number;
  /** Layout px (the stage scale never applies). */
  height: number;
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  /** Line boxes outside the row, text runs outside its 179 px text box. */
  outside: string[];
  selected: boolean;
  filled: boolean;
}

/**
 * Every category row, measured once the fonts and the rail's animations
 * (the tb-select bump) have settled. A line box is its text run's centre
 * ± half the line height (one face per line: the run's box is centred on it).
 */
async function probeRows(page: Page): Promise<Row[]> {
  const rail = page.getByTestId("category-rail");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await rail.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)))
  );
  return rail.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>('[data-testid^="rail-"]')].map((row) => {
      const box = row.getBoundingClientRect();
      const k = box.width / row.offsetWidth; // the stage's scale
      const style = getComputedStyle(row);
      const half = (parseFloat(style.lineHeight) * k) / 2;
      const textLeft = box.left + parseFloat(style.paddingLeft) * k;
      const textRight = box.right - parseFloat(style.paddingRight) * k;
      const range = document.createRange();
      range.selectNodeContents(row);
      const runs = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      const centres = [...new Set(runs.map((r) => Math.round((r.top + r.bottom) / 2)))];
      const outside = [
        ...centres
          .filter((c) => c - half < box.top - 0.5 || c + half > box.bottom + 0.5)
          .map((c) => `line box ${Math.round(c - half - box.top)}..${Math.round(c + half - box.top)} of ${Math.round(box.height)}`),
        ...runs
          .filter((r) => r.left < textLeft - 0.5 || r.right > textRight + 0.5)
          .map((r) => `run ${Math.round(r.left - textLeft)}..${Math.round(r.right - textLeft)} of ${Math.round(textRight - textLeft)}`),
      ];
      return {
        id: (row.dataset.testid ?? "").replace(/^rail-/, ""),
        lines: centres.length,
        height: row.offsetHeight,
        scrollHeight: row.scrollHeight,
        clientHeight: row.clientHeight,
        scrollWidth: row.scrollWidth,
        clientWidth: row.clientWidth,
        outside,
        selected: row.getAttribute("aria-current") === "true",
        filled: style.backgroundColor !== "rgba(0, 0, 0, 0)",
      };
    })
  );
}

function expectWholeRows(rows: Row[], mode: Mode) {
  expect(rows.map((r) => r.id).sort()).toEqual(Object.keys(EN_LINES).sort());
  for (const row of rows) {
    const label = `${mode} rail-${row.id}`;
    expect.soft(row.outside, `${label}: text outside its row`).toEqual([]);
    expect.soft(row.scrollHeight, `${label}: scrollHeight`).toBeLessThanOrEqual(row.clientHeight);
    expect.soft(row.scrollWidth, `${label}: scrollWidth`).toBeLessThanOrEqual(row.clientWidth);
    expect.soft(row.height, `${label}: ${row.lines} line(s)`).toBe(rowHeight(row.lines));
  }
  const lines = Object.fromEntries(rows.map((r) => [r.id, r.lines]));
  if (mode === "ar") {
    expect.soft(lines[TENANT], "ar: the long alias wraps to 3+ lines").toBeGreaterThanOrEqual(3);
  } else {
    expect.soft(lines, `${mode}: lines per row`).toEqual(EN_LINES);
  }
}

test.describe("rail-wrap — long category names grow their rail row", () => {
  for (const mode of ["en", "ar", "ada"] as const) {
    test(`${mode.toUpperCase()}: every rail name shows whole — 1 and 2 lines keep the 64 px row, 3+ lines grow it (88 for 3), one long word breaks inside the 179 px box; the selected pill grows with its row`, async ({
      page,
    }) => {
      test.slow();
      await openMenu(page, mode);

      expectWholeRows(await probeRows(page), mode);
      const railCuts = (await clippedText(page)).filter((s) => s.includes(" in rail-"));
      expect.soft(railCuts, `${mode}: rail text the layout cuts off`).toEqual([]);

      // The tenant row selected: the vibrant pill is the whole grown row.
      await page.getByTestId(`rail-${TENANT}`).click();
      await expect(page.getByTestId(`rail-${TENANT}`)).toHaveAttribute("aria-current", "true");
      const rows = await probeRows(page);
      expectWholeRows(rows, mode);
      const tenant = rows.find((r) => r.id === TENANT);
      expect(tenant).toMatchObject({ selected: true, filled: true });
      if (mode !== "ar") expect(tenant?.height).toBe(88);
      expect(rows.filter((r) => r.selected).map((r) => r.id)).toEqual([TENANT]);
    });
  }
});
