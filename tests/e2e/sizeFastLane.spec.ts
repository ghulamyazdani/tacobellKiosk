import { test, expect, type Page } from "./fixtures/kiosk";
import { mockKioskBackend as mockBackend, fixtureJson, locale } from "./fixtures/backend";
import { stageBox } from "./fixtures/a11y";
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

type Size = [id: string, name: string, price: number];
const TWO_SIZES: Size[] = [
  [SIZE_REGULAR, "Regular", 5],
  [SIZE_LARGE, "Large", 7],
];

/** `sizes` per item id, each item re-shaped with no modifier groups. */
function sizedMenu(sizes: Record<string, Size[]> = { [SIZED_ITEM]: TWO_SIZES }) {
  const menu = JSON.parse(JSON.stringify(slimMenu));
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities)
        if (sizes[entity.id]) {
          entity.hasVariant = true;
          entity.modifiers = [];
          entity.variants = sizes[entity.id].map(([id, name, price]) => ({
            id,
            name,
            price,
            isActive: true,
            subCategoryId: sub.id,
          }));
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

/*
 * Residual R3 (figma-polish) — Select a Size in the running app.
 *
 * DIALOG: a modal dialog named "Select a size"; the first size takes focus on
 * open and the opener (the menu "+") gets it back on close — Chromium focuses
 * a clicked button, as the kiosk's does. A CONTINUE that opens the
 * product-added modal never puts focus back behind it (review F1).
 *
 * ADA BAR: in the zone the card is capped at 1074 (ADA_MODAL_MAX_HEIGHT), so
 * the sizes get 1074 − 272 = 802 px: the hero + one tile row (727) fit, four
 * sizes (985) overflow. The list carries the app's ScrollIndicator over its
 * own box, shown only while it overflows; the full view (1500 cap, room for
 * five sizes) mounts none. The bar is draggable (lane scroll-drag): a drag on
 * its strip scrolls the sizes to the last one.
 */
const en = locale("en");
/** Kiddie Meal Nuggets: two sizes, which fit the zone. */
const PAIR_ITEM = "5dd1093a188e72ce1b3eb359";
const FOUR_SIZES: Size[] = [
  ["e2e-size-small", "Small", 4],
  ["e2e-size-medium", "Medium", 5],
  ["e2e-size-big", "Big", 6],
  ["e2e-size-huge", "Huge", 7],
];
const PAIR_SIZES: Size[] = [
  ["e2e-pair-regular", "Regular", 5],
  ["e2e-pair-large", "Large", 7],
];
const sizesMenu = () => sizedMenu({ [SIZED_ITEM]: FOUR_SIZES, [PAIR_ITEM]: PAIR_SIZES });

const sizeModal = (page: Page) => page.getByTestId("select-size-modal");
/** The card's X (the scrim before it carries the same name). */
const sizeX = (page: Page) => sizeModal(page).locator(":scope > div").getByRole("button", { name: en.language.close });

async function openSizes(page: Page, itemId: string) {
  const plus = page.getByTestId(`quick-add-${itemId}`);
  await plus.scrollIntoViewIfNeeded();
  await plus.click();
  await expect(sizeModal(page)).toBeVisible();
  return plus;
}

test.describe("Select a Size — residual R3", () => {
  test("DIALOG: the modal is a named dialog; the first size takes focus on open and the menu '+' gets it back on X, never behind the added modal CONTINUE opens", async ({
    page,
  }) => {
    await mockBackend(page, { menu: sizesMenu() });
    await bootRegisteredToMenu(page);

    const plus = await openSizes(page, SIZED_ITEM);
    await expect(page.getByRole("dialog", { name: en.size.title })).toHaveAttribute("aria-modal", "true");
    await expect(page.getByTestId("size-e2e-size-small")).toBeFocused();

    await sizeX(page).click();
    await expect(sizeModal(page)).toHaveCount(0);
    await expect(plus).toBeFocused();

    await openSizes(page, SIZED_ITEM);
    await page.getByTestId("size-e2e-size-big").click();
    await page.getByTestId("size-continue").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    // Off the "+" behind the modal: on the body (the modal moves no focus) or inside it.
    await expect
      .poll(() => page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('[aria-modal="true"]')))
      .toBe(true);
  });

  test("ADA BAR: four sizes overflow the zone's card and the bar rides the list's box, follows it and drags it to the last size; two sizes fit and show none; the full view mounts none", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { menu: sizesMenu(), settings: { accessibility_mode: true } });
    await bootRegisteredToMenu(page);
    const track = page.getByTestId("size-scrollbar");

    // Full view: 985 px of sizes fit the 1500 cap — no bar at all.
    await openSizes(page, SIZED_ITEM);
    await expect(track).toHaveCount(0);
    await sizeX(page).click();

    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();

    // Two sizes fit the zone: the bar is mounted but hidden.
    await openSizes(page, PAIR_ITEM);
    await expect(page.getByTestId("size-e2e-pair-large")).toBeVisible();
    await expect(track).toBeHidden();
    await sizeX(page).click();

    // Four sizes overflow: the bar shows over the list's own box (stage px).
    await openSizes(page, SIZED_ITEM);
    const list = page.getByTestId("size-e2e-size-small").locator("xpath=..");
    await expect(track).toBeVisible();
    expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);
    await expect
      .poll(async () => {
        const [t, l, card] = await Promise.all([
          stageBox(track),
          stageBox(list),
          stageBox(sizeModal(page).locator(":scope > div")),
        ]);
        return { top: t.y - l.y, bottom: t.y + t.height - (l.y + l.height), right: card.x + card.width - (t.x + t.width) };
      })
      .toEqual({ top: 0, bottom: 0, right: 12 });

    // A drag from the thumb to past the track's foot scrolls the sizes to their end.
    const thumb = await page.getByTestId("size-scrollbar-thumb").boundingBox();
    const bar = await track.boundingBox();
    if (!thumb || !bar) throw new Error("the bar has no box");
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumb.x + thumb.width / 2, bar.y + bar.height + 40, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
      .toBeLessThanOrEqual(1);
    await expect
      .poll(async () => {
        const [t, th] = await Promise.all([track.boundingBox(), page.getByTestId("size-scrollbar-thumb").boundingBox()]);
        return t && th ? Math.round(t.y + t.height - (th.y + th.height)) : null;
      })
      .toBe(0);

    // The last size is in reach, and CONTINUE with it.
    await page.getByTestId("size-e2e-size-huge").click();
    await expect(page.getByTestId("size-e2e-size-huge")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("size-continue")).toBeEnabled();
  });
});
