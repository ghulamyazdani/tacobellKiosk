import {
  CAESAR_DRESSING,
  CHEESE_BURGER,
  DREAM_BOX,
  GREEK_SALAD,
  LARGE_FRIES,
  TORTILLA_SAUCE,
  fixtureJson,
  locale,
  mockKioskBackend,
} from "./fixtures/backend";
import { settle } from "./fixtures/capture";
import { expectNothingDangerousWasContacted, mockCheckoutBackend } from "./fixtures/checkout";
import { expect, freezeClock, test, type Locator, type Page } from "./fixtures/kiosk";
import {
  bootRegisteredToMenu,
  chooseLanguage,
  pickPipelineToMenu,
  registerToStart,
  startOrderTo,
  startToSecond,
} from "./pages/boot";
import { addViaPdp, openBag } from "./pages/order";

/**
 * The product-added modal STAGES, as posistKiosk does — user report 2026-10-12: "when item is clicked its
 * directly adding to the cart, this should not happen … the items are not added to cart until the add to
 * order is clicked". (Lane added-modal, 2026-10-09, had made every tap add at once.)
 *
 * The behaviour under test (Figma 1:4589 frame; sign-off list in PROGRESS):
 *  - the WHOLE card (photo, name, anywhere) or its "+" PICKS a one-tap item: the card counts the picks (pill +
 *    sr-only "N selected"), its "−" takes one back (the trash glyph at 1), the Total previews the order — and the
 *    bag is untouched;
 *  - a suggestion that needs a choice HIDES the modal (still open, its picks kept) and opens what the same item's
 *    menu "+" opens — Select a Size, or the PDP (options / pack); never the repeat sheet — with
 *    recommendationDetour set; the add that chooser ends in (CONTINUE / ADD TO BAG) is PARKED back in the modal,
 *    and every exit clears the flag, which brings the modal back (never a second strip);
 *  - ADD TO ORDER (Figma's label) buys the picks; X and the scrim throw them away. With nothing to buy the same
 *    button only closes and says so — NO THANKS over the strip, GOT IT without one (posistKiosk's "No, Thanks" /
 *    "Okay"; user report 2026-10-12: "why add to order button is coming when there is no item to add to order");
 *  - a refused purchase (the DP cap) raises the global error and keeps the modal with the refused pick.
 *
 * Fixture: slim-menu with Greek Salad (plain £17) suggesting Tortilla Sauce (plain £2), Large Fries (£9, one
 * optional group → PDP) and the Kiddie Meal Beef Burger reshaped into a size-only item (Regular £5 / Large £7;
 * raw price £13 — sizeFastLane.spec's reshape); Large Fries suggests [Cheese Burger, Tortilla Sauce], so a strip
 * of its own after its PDP would be a second hop.
 *
 * Every menu add confirms (user 2026-10-14) — a re-tap of an in-cart PLAIN item bumps its row AND opens the modal
 * again —, but a test that needs the salad's FIRST modal (one row) again starts the next customer's order (CANCEL
 * ORDER → splash → /menu: `newOrder`). Store state is read through
 * `window.__kioskStore` (DEV-only) with expect.poll; the cart is checked in the store, never through the bag UI.
 * The print agent and every non-app origin are denied by the harness (fixtures/kiosk): an unexpected call fails
 * the test.
 */

const en = locale("en");
const ar = locale("ar");

const SIZED = "5dd1093a188e72ce1b3eb358";
const SIZE_REGULAR = "e2e-size-regular";
const SIZE_LARGE = "e2e-size-large";
/** The DP session (globalError.spec): one DP unit per order during "Lunch". */
const DP_SESSION = { _id: "dp-lunch", sessionName: "Lunch", _extras: { maxQtyItem: 1 } };
const SPRING_CARD = '[data-testid="product-added-modal"] > div.tb-modal-spring';
const SALAD_RECS = [TORTILLA_SAUCE, LARGE_FRIES, SIZED];

/** Large Fries' one optional group: on the Large size it makes Select a Size's CONTINUE go on to the PDP. */
const FRIES_GROUP = "5dd10938eb1ccee31ca352fa_1573980470_addons";

/**
 * slim-menu: Greek Salad suggests `saladRecs`, Large Fries suggests [Cheese Burger, Tortilla Sauce]; the sized
 * reshape — its Large carries `largeGroups` (bag.spec's shape) when given.
 */
function menuWith(saladRecs: string[] = SALAD_RECS, largeGroups: string[] = []) {
  const menu = fixtureJson("slim-menu.json");
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities) {
        if (entity.id === SIZED) {
          entity.hasVariant = true;
          entity.modifiers = [];
          entity.variants = [
            [SIZE_REGULAR, "Regular", 5],
            [SIZE_LARGE, "Large", 7],
          ].map(([id, name, price]) => ({
            id,
            name,
            price,
            isActive: true,
            subCategoryId: sub.id,
            ...(id === SIZE_LARGE && largeGroups.length ? { modifiers: largeGroups } : {}),
          }));
        }
        if (entity.id === GREEK_SALAD) entity.recommendedItems = saladRecs;
        if (entity.id === LARGE_FRIES) entity.recommendedItems = [CHEESE_BURGER, TORTILLA_SAUCE];
      }
  return menu;
}

/** The menu fixture's Arabic alias of an item (what the AR menu renders). */
function arabicName(id: string): string {
  const menu = fixtureJson("slim-menu.json");
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities)
        if (entity.id === id) return entity.aliases.find((alias: { code: string }) => alias.code === "ar").value;
  throw new Error(`no ${id} in slim-menu`);
}

async function bootToMenu(page: Page, saladRecs?: string[], largeGroups?: string[]) {
  await mockKioskBackend(page, { menu: menuWith(saladRecs, largeGroups) });
  await bootRegisteredToMenu(page);
}

/* ---- the store (window.__kioskStore, DEV-only) ---- */

interface Row {
  name?: string;
  quantity?: number;
  type?: string;
  price?: number;
  variantPrice?: number;
  baseItemPrice?: number;
  total_price?: number;
  selectedVariant?: { id?: string; name?: string; price?: number } | null;
}
interface KioskState {
  cart: { cartItems: Row[]; netAmount?: number };
  menuSelections: {
    addToCartModal?: { isOpen?: boolean; item?: { name?: string; suppressRecommendations?: boolean } };
    recommendationDetour?: boolean;
    upsellStaging?: { pending: Record<string, number>; pendingCustom: Row[] };
  };
}
type StoreWindow = Window & { __kioskStore: { getState(): KioskState } };

/**
 * The added modal as the store has it, the detour flag, the cart rows and the PICKS — `picked`: one-tap units by
 * id; `parked`: chooser rows ("name (size) xN", like the cart).
 */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as StoreWindow).__kioskStore.getState();
    const modal = s.menuSelections.addToCartModal;
    const label = (row: Row) =>
      `${row.name}${row.selectedVariant?.name ? ` (${row.selectedVariant.name})` : ""} x${row.quantity}`;
    return {
      open: Boolean(modal?.isOpen),
      item: modal?.isOpen ? (modal.item?.name ?? null) : null,
      noStrip: modal?.isOpen ? Boolean(modal.item?.suppressRecommendations) : null,
      detour: Boolean(s.menuSelections.recommendationDetour),
      cart: s.cart.cartItems.map(label),
      picked: s.menuSelections.upsellStaging?.pending ?? {},
      parked: (s.menuSelections.upsellStaging?.pendingCustom ?? []).map(label),
    };
  });

/** The size row's money fields (TR2b's parity set). */
const sizeRowMoney = (page: Page) =>
  page.evaluate(() => {
    const row = (window as unknown as StoreWindow).__kioskStore
      .getState()
      .cart.cartItems.find((r) => r.type === "VARIANT");
    return row
      ? {
          size: row.selectedVariant?.name,
          sizePrice: row.selectedVariant?.price,
          price: row.price,
          variantPrice: row.variantPrice,
          baseItemPrice: row.baseItemPrice,
          total_price: row.total_price,
          quantity: row.quantity,
        }
      : null;
  });

/** The payable the open bag mirrors into the slice (BagSheet → setAmount(getCheckoutNetAmount(bill))). */
const netAmount = (page: Page) =>
  page.evaluate(() => (window as unknown as StoreWindow).__kioskStore.getState().cart.netAmount ?? 0);

/* ---- the modal ---- */

const modal = (page: Page) => page.getByTestId("product-added-modal");
const total = (page: Page) => page.getByTestId("added-total");
const tiles = (page: Page) =>
  page.locator(
    '[data-testid^="added-rec-"]:not([data-testid^="added-rec-add-"]):not([data-testid^="added-rec-remove-"])'
  );
const tile = (page: Page, id: string) => page.getByTestId(`added-rec-${id}`);
const plus = (page: Page, id: string) => page.getByTestId(`added-rec-add-${id}`);
const minus = (page: Page, id: string) => page.getByTestId(`added-rec-remove-${id}`);
const pill = (page: Page, id: string) => page.getByTestId(`added-count-${id}`);
/** The modal's ONE CTA: ADD TO ORDER while something is picked; otherwise NO THANKS (strip) / GOT IT (none). */
const cta = (page: Page) => page.getByTestId("added-continue");
/** The tile's one accessible pick control: the empty overlay (the "+" is its aria-hidden twin). */
const overlay = (card: Locator) => card.locator(":scope > button:not([aria-hidden]):not([data-testid])");
const tileIds = (page: Page) =>
  tiles(page).evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") ?? "").replace("added-rec-", "")));
const totalText = (amount: number) => `${en.menu.total} £${amount.toFixed(2)}`;
const selectedText = (count: number) => en.added.selected.replace("{{value}}", String(count));
/** The "−"'s glyph file: the trash at one pick, "−" from two. */
const minusGlyph = (page: Page, id: string) => minus(page, id).locator("img").getAttribute("src");

/** A guest's tap ON a part of the card (its photo, its name): whatever is on top there takes it. */
async function tapOn(card: Locator, part: Locator) {
  const [c, p] = await Promise.all([card.boundingBox(), part.boundingBox()]);
  if (!c || !p) throw new Error("the card part has no box");
  await card.click({ position: { x: p.x + p.width / 2 - c.x, y: p.y + p.height / 2 - c.y } });
}

/** Menu → the Greek Salad card: a fresh plain add with suggestions opens the modal. */
async function openSaladModal(page: Page) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
  await expect(modal(page)).toBeVisible();
}

/** CANCEL ORDER → the splash → the next customer's /menu, with an empty cart. */
async function newOrder(page: Page) {
  await page.getByTestId("footer-cancel").click();
  await page.getByTestId("cancel-order-confirm").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await startOrderTo(page, "menu-screen");
  await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: false, cart: [], picked: {}, parked: [] });
  expect(await netAmount(page), "the reset cleared the last bag's total").toBe(0);
}

/** Select a Size's X (the card's; the scrim carries the same name). */
const sizeClose = (page: Page) =>
  page.getByTestId("select-size-modal").locator(":scope > div").getByRole("button", { name: en.language.close });

/** CDP slow motion (motion.spec): sets the document timeline's playback rate. */
async function slowMotion(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  return async (playbackRate: number) => {
    await cdp.send("Animation.setPlaybackRate", { playbackRate });
  };
}

/** The animations RUNNING on an element (a finished, unfilled one is gone): CSS name + duration. */
const running = (target: Locator) =>
  target.evaluate((el) =>
    el
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => ({
        name: a instanceof CSSAnimation ? a.animationName : a.constructor.name,
        duration: Number(a.effect?.getComputedTiming().duration),
      }))
  );

test.describe("the product-added modal stages its suggestions (posistKiosk parity)", () => {
  test("P1 PLAIN: the Tortilla Sauce card's photo, then its name, then its '+' each PICK one — pill 1 → 2 → 3, 'N selected', Total £19 → £21 → £23 — with the bag untouched; its '−' takes one back; ADD TO ORDER buys Tortilla Sauce ×2 in one row and closes", async ({
    page,
  }) => {
    await bootToMenu(page);
    await openSaladModal(page);
    await expect.poll(() => snapshot(page)).toEqual({
      open: true,
      item: "Greek Salad",
      noStrip: false,
      detour: false,
      cart: ["Greek Salad x1"],
      picked: {},
      parked: [],
    });
    await expect(tiles(page)).toHaveCount(3);
    await expect(total(page)).toHaveText(totalText(17));
    await expect(pill(page, TORTILLA_SAUCE)).toHaveCount(0);
    await expect(minus(page, TORTILLA_SAUCE)).toHaveCount(0);
    await expect(cta(page), "nothing picked over the strip: no ADD TO ORDER").toHaveText(en.added.noThanks);

    const sauce = tile(page, TORTILLA_SAUCE);
    const taps: [string, () => Promise<void>][] = [
      ["its photo", () => tapOn(sauce, sauce.locator(":scope > div").first())],
      ["its name", () => tapOn(sauce, sauce.locator("p").first())],
      ["its '+'", () => plus(page, TORTILLA_SAUCE).click()],
    ];
    for (const [index, [part, tap]] of taps.entries()) {
      const count = index + 1;
      await tap();
      await expect(pill(page, TORTILLA_SAUCE), `a tap on ${part} picks one`).toHaveText(String(count));
      await expect(sauce.locator(".sr-only")).toHaveText(selectedText(count));
      await expect(total(page), "the Total previews the order with the picks").toHaveText(totalText(17 + 2 * count));
      await expect(cta(page)).toHaveText(en.added.addToOrder);
      await expect(modal(page)).toBeVisible();
      await expect.poll(() => snapshot(page)).toMatchObject({
        open: true,
        item: "Greek Salad",
        detour: false,
        cart: ["Greek Salad x1"],
        picked: { [TORTILLA_SAUCE]: count },
      });
    }
    // The SDK resolver feeds the strip: the refs in order, and a size parent reads its lowest active size
    // (£5), never its raw £13 (RC5).
    expect(await tileIds(page)).toEqual(SALAD_RECS);
    await expect(tile(page, SIZED)).toContainText("£5");
    await expect(tile(page, SIZED)).not.toContainText("£13");
    // One pick control per tile: a one-tap pick is a Quick add, a tile that leaves the modal a Customize.
    await expect(overlay(sauce)).toHaveAccessibleName(`${en.menu.quickAdd} Tortilla Sauce`);
    await expect(overlay(tile(page, LARGE_FRIES))).toHaveAccessibleName(`${en.pack.customize} Large Fries`);
    await expect(overlay(tile(page, SIZED))).toHaveAccessibleName(`${en.pack.customize} Kiddie Meal Beef Burger`);

    // Its "−" ("−" from two picks) takes one back.
    await expect(minus(page, TORTILLA_SAUCE)).toHaveAccessibleName(
      en.added.removeOne.replace("{{name}}", "Tortilla Sauce")
    );
    expect(await minusGlyph(page, TORTILLA_SAUCE)).toContain("qty-minus");
    await minus(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("2");
    await expect(total(page)).toHaveText(totalText(21));
    await expect.poll(() => snapshot(page)).toMatchObject({ cart: ["Greek Salad x1"], picked: { [TORTILLA_SAUCE]: 2 } });

    // ADD TO ORDER buys the picks — both units in one row — and closes.
    await page.getByTestId("added-continue").click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toEqual({
      open: false,
      item: null,
      noStrip: null,
      detour: false,
      cart: ["Greek Salad x1", "Tortilla Sauce x2"],
      picked: {},
      parked: [],
    });
  });

  test("P1b DISCARD: the X throws the picks away — the bag keeps only the salad; the trash glyph is the '−' at one pick", async ({
    page,
  }) => {
    await bootToMenu(page);
    await openSaladModal(page);
    await tile(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    expect(await minusGlyph(page, TORTILLA_SAUCE)).toContain("trash");

    await modal(page).locator(":scope > div").getByRole("button", { name: en.language.close }).click();

    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      detour: false,
      cart: ["Greek Salad x1"],
      picked: {},
      parked: [],
    });
  });

  test("P2 SIZED → SELECT A SIZE: the sized card HIDES the modal (still open, its pick kept) and opens Select a Size (detour on); its X brings the modal back with the pick, nothing added; the abandoned size never comes back ticked; Large + CONTINUE parks the Large row — the bag unchanged — and the same modal is back counting it; ADD TO ORDER lands it, billed exactly like Large from the menu '+'", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page);
    await openSaladModal(page);
    await tile(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");

    await tile(page, SIZED).click();
    await expect(page.getByTestId("select-size-modal")).toBeVisible();
    await expect(page.getByTestId("select-size-modal")).toContainText("Kiddie Meal Beef Burger");
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      detour: true,
      cart: ["Greek Salad x1"],
      picked: { [TORTILLA_SAUCE]: 1 },
    });

    // X (after a pick): the same modal is back with its pick, nothing added, the detour over.
    await page.getByTestId(`size-${SIZE_REGULAR}`).click();
    await expect(page.getByTestId(`size-${SIZE_REGULAR}`)).toHaveAttribute("aria-pressed", "true");
    await sizeClose(page).click();
    await expect(page.getByTestId("select-size-modal")).toHaveCount(0);
    await expect(modal(page)).toBeVisible();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    await expect(total(page)).toHaveText(totalText(19));
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      detour: false,
      cart: ["Greek Salad x1"],
      picked: { [TORTILLA_SAUCE]: 1 },
      parked: [],
    });

    // The sauce goes back (the trash at one pick), so the bill below is the salad and the size alone.
    await minus(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveCount(0);

    // The abandoned size never comes back ticked.
    await tile(page, SIZED).click();
    await expect(page.getByTestId(`size-${SIZE_REGULAR}`)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("size-continue")).toBeDisabled();

    // Large + CONTINUE: PARKED, not bought — the same modal is back counting it (no second strip, no hop).
    await page.getByTestId(`size-${SIZE_LARGE}`).click();
    await page.getByTestId("size-continue").click();
    await expect(modal(page)).toBeVisible();
    await expect(tiles(page)).toHaveCount(3);
    await expect(pill(page, SIZED)).toHaveText("1");
    await expect(total(page)).toHaveText(totalText(24));
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      noStrip: false,
      detour: false,
      cart: ["Greek Salad x1"],
      picked: {},
      parked: ["Kiddie Meal Beef Burger (Large) x1"],
    });

    await page.getByTestId("added-continue").click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      detour: false,
      cart: ["Greek Salad x1", "Kiddie Meal Beef Burger (Large) x1"],
      parked: [],
    });
    const viaSuggestion = await sizeRowMoney(page);
    expect(viaSuggestion).toMatchObject({ size: "Large", sizePrice: 7, variantPrice: 7, total_price: 7, quantity: 1 });
    await openBag(page);
    // round(24 × 1.15 = 27.6) = £28.
    await expect.poll(() => netAmount(page), { message: "the bag's total, via the suggestion" }).toBe(28);

    // Money parity: the same size from the menu '+' (the next customer).
    await page.getByTestId("bag-close").click();
    await newOrder(page);
    await openSaladModal(page);
    await page.getByTestId("added-continue").click();
    const quickAdd = page.getByTestId(`quick-add-${SIZED}`);
    await quickAdd.scrollIntoViewIfNeeded();
    await quickAdd.click();
    await page.getByTestId(`size-${SIZE_LARGE}`).click();
    await page.getByTestId("size-continue").click();
    await expect(modal(page)).toBeVisible();
    await expect(total(page)).toHaveText(totalText(24));
    // A customized add with nothing to suggest (the user's screenshot): nothing to buy, so no ADD TO ORDER.
    await expect(tiles(page)).toHaveCount(0);
    await expect(cta(page)).toHaveText(en.offers.gotIt);
    await page.getByTestId("added-continue").click();
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      cart: ["Greek Salad x1", "Kiddie Meal Beef Burger (Large) x1"],
    });
    expect(await sizeRowMoney(page), "the same row money as the menu '+'").toEqual(viaSuggestion);
    await openBag(page);
    await expect.poll(() => netAmount(page), { message: "the bag's total, via the menu '+'" }).toBe(28);
  });

  test("P3 CUSTOMIZABLE: the Large Fries card hides the modal and opens the PDP (detour on); BACK brings the same modal back with nothing added; ADD TO BAG parks Large Fries — the bag unchanged, never Large Fries' own strip — the modal back counting it at Total £26; ADD TO ORDER lands Greek Salad + Large Fries", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page);
    await openSaladModal(page);
    await tile(page, LARGE_FRIES).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: true, detour: true, cart: ["Greek Salad x1"] });

    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(modal(page)).toBeVisible();
    await expect(pill(page, LARGE_FRIES)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      detour: false,
      cart: ["Greek Salad x1"],
      parked: [],
    });

    await tile(page, LARGE_FRIES).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(modal(page)).toBeVisible();
    // Still the salad's strip: Large Fries' own [Cheese Burger, Tortilla Sauce] would be the second hop.
    expect(await tileIds(page)).toEqual(SALAD_RECS);
    await expect(pill(page, LARGE_FRIES)).toHaveText("1");
    await expect(total(page)).toHaveText(totalText(26));
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      noStrip: false,
      detour: false,
      cart: ["Greek Salad x1"],
      parked: ["Large Fries x1"],
    });

    await page.getByTestId("added-continue").click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      detour: false,
      cart: ["Greek Salad x1", "Large Fries x1"],
      parked: [],
    });
  });

  test("P3b ONE HOP: a PDP opened from a suggestion shows no 'You Might Like' rail of its own — the modal behind it is hidden, not closed, so a rail tap would park there unseen; the same PDP from the menu shows the rail", async ({
    page,
  }) => {
    test.slow();
    // The tenant map through the DEV-only seam and a fake S3 (bag-recommendations.spec):
    // Large Fries suggests Tortilla Sauce.
    const recsUrl = "https://recommendations.e2e.test/data.json";
    await page.addInitScript((url) => {
      (window as unknown as { __TB_RECS_URL__?: string }).__TB_RECS_URL__ = url;
    }, recsUrl);
    await mockKioskBackend(page, { menu: menuWith() });
    await page.route(recsUrl, (r) =>
      r.fulfill({
        json: { data: [{ baseItem_id: LARGE_FRIES, refers: [{ refer_baseItem_id: TORTILLA_SAUCE, occurrences: 3 }] }] },
        headers: { "Access-Control-Allow-Origin": "*" },
      })
    );
    await bootRegisteredToMenu(page);

    // Control: Large Fries' PDP from the menu offers Tortilla Sauce on its rail (the map is loaded).
    const fries = page.getByTestId(`item-${LARGE_FRIES}`);
    await fries.scrollIntoViewIfNeeded();
    await fries.click();
    await expect(page.getByTestId(`pdp-rail-item-${TORTILLA_SAUCE}`)).toBeVisible();
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();

    // The same PDP as a suggestion's detour: no rail.
    await openSaladModal(page);
    await tile(page, LARGE_FRIES).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    await expect(page.getByTestId("pdp-rail")).toHaveCount(0);
    await expect(page.locator('[data-testid^="pdp-rail-item-"]')).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      detour: true,
      cart: ["Greek Salad x1"],
      picked: {},
      parked: [],
    });

    // BACK: the modal returns with nothing hidden in it — NO THANKS, not ADD TO ORDER.
    await page.getByTestId("pdp-back").click();
    await expect(modal(page)).toBeVisible();
    await expect(cta(page)).toHaveText(en.added.noThanks);
  });

  test("P4 PACK: the Dream box card hides the modal and opens the pack PDP (detour on); BACK brings the same modal back with nothing added", async ({
    page,
  }) => {
    await bootToMenu(page, [DREAM_BOX, TORTILLA_SAUCE, LARGE_FRIES]);
    await openSaladModal(page);
    await tile(page, DREAM_BOX).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: true, detour: true, cart: ["Greek Salad x1"] });

    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(modal(page)).toBeVisible();
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      detour: false,
      cart: ["Greek Salad x1"],
      parked: [],
    });
  });

  test("P5 IN-BAG: with Large Fries already in the bag its card counts nothing (the pill is what the guest adds) and still opens the PDP — never the repeat sheet, whose '+' would write to the bag past ADD TO ORDER; ADD TO BAG parks it; ADD TO ORDER lands a second Large Fries row", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page);
    // Its own confirmation carries Large Fries' strip; addViaPdp dismisses it (NO THANKS, nothing picked).
    await addViaPdp(page, LARGE_FRIES, { expectedCta: "£9.00" });
    await openSaladModal(page);
    await expect(pill(page, LARGE_FRIES)).toHaveCount(0);

    await tile(page, LARGE_FRIES).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("repeat-sheet")).toHaveCount(0);
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      detour: true,
      cart: ["Large Fries x1", "Greek Salad x1"],
    });

    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(modal(page)).toBeVisible();
    await expect(pill(page, LARGE_FRIES)).toHaveText("1");
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      detour: false,
      cart: ["Large Fries x1", "Greek Salad x1"],
      parked: ["Large Fries x1"],
    });

    await page.getByTestId("added-continue").click();
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      cart: ["Large Fries x1", "Greek Salad x1", "Large Fries x1"],
      parked: [],
    });
  });

  test("P6 DP CAP: at the session's one DP unit, Tortilla Sauce is still picked (pill 1, Total £19, the bag untouched; NO THANKS → ADD TO ORDER) but ADD TO ORDER is refused — the global error is up, nothing is added and the modal keeps the pick (still ADD TO ORDER); after GOT IT its '−' turns the CTA back into NO THANKS, which closes on the salad alone", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { menu: menuWith() });
    // globalError.spec's DP setup: the deployment row, the Lunch session, and its DP items.
    const checkout = await mockCheckoutBackend(page, {
      deploymentSettings: [{ name: "enable_dynamic_pricing", selected: true }],
    });
    await page.route("**/api/cx/get_dp_sessions", (r) => r.fulfill({ json: [DP_SESSION] }));
    await page.route("**/api/cx/get_deployment_items_session", (r) =>
      r.fulfill({
        json: [
          { baseItemId: GREEK_SALAD, session: { modifiedRate: 17, status: "active" } },
          { baseItemId: TORTILLA_SAUCE, session: { modifiedRate: 2, status: "active" } },
        ],
      })
    );
    await bootRegisteredToMenu(page);
    await openSaladModal(page); // the one DP unit this session allows
    await expect(total(page)).toHaveText(totalText(17));
    await expect(cta(page)).toHaveText(en.added.noThanks);
    const refusal = en.toast.dpMaxQuantity_one.replace("{{count}}", "1").replace("{{session}}", DP_SESSION.sessionName);

    await plus(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    await expect(total(page)).toHaveText(totalText(19));
    await expect(cta(page)).toHaveText(en.added.addToOrder);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ cart: ["Greek Salad x1"], picked: { [TORTILLA_SAUCE]: 1 } });

    await page.getByTestId("added-continue").click();
    await expect(page.getByRole("alertdialog", { name: refusal }), "the refused purchase is said out loud").toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(1);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      detour: false,
      cart: ["Greek Salad x1"],
      picked: { [TORTILLA_SAUCE]: 1 },
    });

    await page.getByTestId("global-error-ok").click();
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(modal(page)).toBeVisible();
    expect(await tileIds(page)).toEqual(SALAD_RECS);
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    await expect(total(page)).toHaveText(totalText(19));
    await expect(cta(page), "the refused pick is still there to buy").toHaveText(en.added.addToOrder);

    await minus(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveCount(0);
    await expect(total(page)).toHaveText(totalText(17));
    await expect(cta(page)).toHaveText(en.added.noThanks);
    await page.getByTestId("added-continue").click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, cart: ["Greek Salad x1"], picked: {} });
    expectNothingDangerousWasContacted(checkout);
  });

  test("P7 ONE TAP = ONE PICK: one '+' click picks exactly 1; a double tap on a plain card picks exactly 2 (pill 2); a double tap on the Large Fries card opens the PDP once, picks nothing and ticks no option — the bag untouched throughout", async ({
    page,
  }) => {
    await bootToMenu(page, [TORTILLA_SAUCE, CAESAR_DRESSING, LARGE_FRIES]);
    await openSaladModal(page);

    await plus(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    await expect(total(page)).toHaveText(totalText(19));

    await tile(page, CAESAR_DRESSING).dblclick();
    await expect(pill(page, CAESAR_DRESSING)).toHaveText("2");
    await expect(total(page)).toHaveText(totalText(23));
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    const picked = { [TORTILLA_SAUCE]: 1, [CAESAR_DRESSING]: 2 };
    await expect.poll(() => snapshot(page)).toMatchObject({ open: true, detour: false, cart: ["Greek Salad x1"], picked });

    // A choice card's double tap: the first tap leaves, the second must land nowhere.
    const pdpOpens: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && new URL(frame.url()).pathname === "/customization") pdpOpens.push(frame.url());
    });
    await tile(page, LARGE_FRIES).dblclick();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    const guardUp = await page.getByTestId("detour-tap-guard").count();
    await expect(page.getByTestId("detour-tap-guard")).toHaveCount(0);
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    await expect(page.locator('[data-testid^="pdp-option-"][aria-pressed="true"]')).toHaveCount(0);
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId("repeat-sheet")).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      detour: true,
      cart: ["Greek Salad x1"],
      picked,
      parked: [],
    });
    expect(pdpOpens, "the PDP opened once").toHaveLength(1);
    const cta = (await page.getByTestId("pdp-add-to-bag").textContent())?.replace(/\s+/g, " ").trim();
    // For the flow lens: what a double tap on a choice suggestion leaves behind.
    test.info().annotations.push({
      type: "flow-lens",
      description: `dblclick on a choice suggestion → ${JSON.stringify({
        url: new URL(page.url()).pathname,
        pdpOpens: pdpOpens.length,
        guardUpRightAfter: guardUp > 0,
        pdpCta: cta,
        ...(await snapshot(page)),
      })}`,
    });
  });

  test("P7b ONE TAP = ONE PICK (same-frame surfaces, both ways): a double tap on the sized card opens Select a Size with nothing ticked; a double tap on its X brings the modal back and the second half lands nowhere — not on the scrim (it would throw the picks away), not on a card (the 500 ms detour tap guard, armed on the way back too)", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page);
    await openSaladModal(page);
    await tile(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");

    // Select a Size mounts in the same commit that hides the modal, under the finger.
    await tile(page, SIZED).dblclick();
    await expect(page.getByTestId("select-size-modal")).toBeVisible();
    await expect(page.getByTestId("detour-tap-guard")).toHaveCount(0);
    await expect(page.locator('[data-testid^="size-"][aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByTestId("size-continue")).toBeDisabled();
    await expect.poll(() => snapshot(page)).toMatchObject({ open: true, detour: true, cart: ["Greek Salad x1"] });

    // And back: the modal returns in the same commit that unmounts Select a Size.
    const x = await sizeClose(page).boundingBox();
    if (!x) throw new Error("Select a Size's X has no box");
    await sizeClose(page).dblclick();
    await expect(page.getByTestId("select-size-modal")).toHaveCount(0);
    await expect(modal(page)).toBeVisible();
    await expect(page.getByTestId("detour-tap-guard")).toHaveCount(0);
    // What the second half would have hit: a closer of the modal (its scrim or its X) — the picks gone.
    const under = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el?.closest('[data-testid="product-added-modal"]') ? el.getAttribute("aria-label") : null;
    }, [x.x + x.width / 2, x.y + x.height / 2]);
    expect(under, "Select a Size's X sits over a closer of the modal").toBe(en.language.close);
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      detour: false,
      cart: ["Greek Salad x1"],
      picked: { [TORTILLA_SAUCE]: 1 },
      parked: [],
    });
  });

  test("P7c HAND-OFF: Select a Size → the PDP (a size with options) — a double tap on CONTINUE opens the PDP once; the sheet covers the menu until the PDP replaces it, so the second half lands nowhere: nothing added, the detour and the pick intact; BACK brings the modal back", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page, SALAD_RECS, [FRIES_GROUP]);
    await openSaladModal(page);
    await tile(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    await tile(page, SIZED).click();
    await page.getByTestId(`size-${SIZE_LARGE}`).click();

    const pdpOpens: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && new URL(frame.url()).pathname === "/customization") pdpOpens.push(frame.url());
    });
    // Over the first card column (x 288–528): a sheet gone before the PDP renders would hand the
    // second half to the menu card beneath.
    await page.getByTestId("size-continue").dblclick({ position: { x: 176, y: 30 } });
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      detour: true,
      cart: ["Greek Salad x1"],
      picked: { [TORTILLA_SAUCE]: 1 },
      parked: [],
    });
    expect(pdpOpens, "the PDP opened once").toHaveLength(1);

    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(modal(page)).toBeVisible();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      detour: false,
      cart: ["Greek Salad x1"],
      picked: { [TORTILLA_SAUCE]: 1 },
    });
  });

  test("AR: the card's pick control, its count and its '−' read in Arabic — 'Quick add' / 'Customize' + the Arabic name, the sr-only 'N selected', 'Remove one <name>' (locale ar)", async ({
    page,
  }) => {
    await mockKioskBackend(page, { arabic: true, menu: menuWith() });
    await registerToStart(page);
    await startToSecond(page);
    await chooseLanguage(page, "ar");
    await pickPipelineToMenu(page);
    await openSaladModal(page);

    const sauce = tile(page, TORTILLA_SAUCE);
    const sauceLabel = (await overlay(sauce).getAttribute("aria-label")) ?? "";
    expect(sauceLabel).toContain(ar.menu.quickAdd);
    expect(sauceLabel).toContain(arabicName(TORTILLA_SAUCE));
    expect(sauceLabel).not.toContain(en.menu.quickAdd);
    const friesLabel = (await overlay(tile(page, LARGE_FRIES)).getAttribute("aria-label")) ?? "";
    expect(friesLabel).toContain(ar.pack.customize);
    expect(friesLabel).toContain(arabicName(LARGE_FRIES));

    await sauce.click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    const status = sauce.locator(".sr-only");
    const parts = (copy: string, slot: string) =>
      copy
        .split(slot)
        .map((s) => s.trim())
        .filter(Boolean);
    for (const part of parts(ar.added.selected as string, "{{value}}")) await expect(status).toContainText(part);
    await expect(status).toContainText("1");
    await expect(status).not.toContainText("selected");
    const minusLabel = (await minus(page, TORTILLA_SAUCE).getAttribute("aria-label")) ?? "";
    for (const part of parts(ar.added.removeOne as string, "{{name}}")) expect(minusLabel).toContain(part);
    expect(minusLabel).toContain(arabicName(TORTILLA_SAUCE));
    expect(minusLabel).not.toContain("Remove one");
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      cart: ["Greek Salad x1"],
      picked: { [TORTILLA_SAUCE]: 1 },
    });
  });

  test("P9 FROM THE BAG (walk 2026-10-14): Complete Your Meal → the Large Fries PDP → ADD TO BAG lands it back in the bag with NO added modal waiting under the bag (the same add from a menu card confirms with one); closing the bag shows a bare /menu", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page);
    await openSaladModal(page);
    await cta(page).click(); // NO THANKS: nothing picked
    await expect(modal(page)).toHaveCount(0);
    await openBag(page);

    // Large Fries' one optional group: the rail detours through the PDP and back to /cart.
    const fries = page.getByTestId(`bag-rail-item-${LARGE_FRIES}`);
    await fries.scrollIntoViewIfNeeded();
    await fries.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page).toHaveURL(/\/cart$/, { timeout: 10_000 });
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      detour: false,
      cart: ["Greek Salad x1", "Large Fries x1"],
    });

    // Nothing was waiting under the bag.
    await page.getByTestId("bag-close").click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    expect((await snapshot(page)).open).toBe(false);
  });
});

/**
 * User 2026-10-14: "item added modal should also come when normal item without customization is added". Every
 * menu add of a plain item confirms — a card tap or its '+', a new row or +1 on the row the bag already has: with
 * suggestions the strip (NO THANKS), without them the title, the Total and GOT IT. Adds made in the bag (its
 * steppers, Complete Your Meal) still confirm by the row itself.
 */
test.describe("every menu add confirms — a plain one too (user 2026-10-14)", () => {
  test("A1 NO SUGGESTIONS: a Tortilla Sauce card tap lands it and opens the modal — the title, Total £2, GOT IT, no strip; GOT IT closes on the bag as it is; a second tap (+1) and its '+' (+1) bump the SAME row to ×2, ×3 and confirm each time (Total £4, £6)", async ({
    page,
  }) => {
    await bootToMenu(page);
    const sauce = page.getByTestId(`item-${TORTILLA_SAUCE}`);
    await sauce.scrollIntoViewIfNeeded();
    await sauce.click();

    await expect(modal(page)).toBeVisible();
    await expect(page.getByRole("dialog", { name: en.added.title })).toBeVisible();
    await expect(tiles(page), "nothing to suggest: no strip").toHaveCount(0);
    await expect(total(page)).toHaveText(totalText(2));
    await expect(cta(page)).toHaveText(en.offers.gotIt);
    await expect.poll(() => snapshot(page)).toEqual({
      open: true,
      item: "Tortilla Sauce",
      noStrip: false,
      detour: false,
      cart: ["Tortilla Sauce x1"],
      picked: {},
      parked: [],
    });
    await cta(page).click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, cart: ["Tortilla Sauce x1"], picked: {} });

    const adds: [string, () => Promise<void>][] = [
      ["the card again", () => sauce.click()],
      ["its '+'", () => page.getByTestId(`quick-add-${TORTILLA_SAUCE}`).click()],
    ];
    for (const [index, [how, add]] of adds.entries()) {
      const units = index + 2;
      await add();
      await expect(modal(page), `${how}: +1 confirms too`).toBeVisible();
      await expect(tiles(page)).toHaveCount(0);
      await expect(total(page)).toHaveText(totalText(2 * units));
      await expect(cta(page)).toHaveText(en.offers.gotIt);
      await expect.poll(() => snapshot(page), `${how}: one row, bumped`).toMatchObject({
        open: true,
        item: "Tortilla Sauce",
        cart: [`Tortilla Sauce x${units}`],
      });
      await cta(page).click();
      await expect(modal(page)).toHaveCount(0);
    }
    await expect(page.getByTestId("cta-view-bag")).toContainText("(3)");
  });

  test("A2 +1 WITH SUGGESTIONS: the Greek Salad already in the bag — a second tap bumps its row to ×2 and opens the modal with its strip (NO THANKS); in the bag, its '+' bumps it to ×3 with no modal, and closing the bag shows a bare /menu", async ({
    page,
  }) => {
    await bootToMenu(page);
    await openSaladModal(page);
    await cta(page).click(); // NO THANKS: nothing picked
    await expect(modal(page)).toHaveCount(0);

    const salad = page.getByTestId(`item-${GREEK_SALAD}`);
    await salad.click();
    await expect(modal(page)).toBeVisible();
    expect(await tileIds(page)).toEqual(SALAD_RECS);
    await expect(total(page)).toHaveText(totalText(34));
    await expect(cta(page)).toHaveText(en.added.noThanks);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Greek Salad",
      noStrip: false,
      cart: ["Greek Salad x2"],
      picked: {},
    });
    await cta(page).click();
    await expect(modal(page)).toHaveCount(0);

    // In the bag the row is the confirmation: its stepper never opens the modal.
    await openBag(page);
    await page.locator('[data-testid^="bag-inc-"]').first().click();
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, cart: ["Greek Salad x3"] });
    await page.getByTestId("bag-close").click();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
  });

  /*
    Review: the modal mounts in the commit of the card's tap, its scrim under the finger, so the second half of a
    double tap closed it ~100 ms after it opened; its GOT IT hands the menu back the same way. The detour tap guard
    (500 ms) is armed on both edges. Two REAL taps 120 ms apart (page.mouse: two tasks, the screen changes between
    them) on a frozen clock, so the window cannot run out between them (paytm R7's pattern).
  */
  test("A3 DOUBLE TAP: two taps 120 ms apart on a plain card add ONE and the modal stays up — the second half met the guard, never the scrim under it; on GOT IT they close it and add nothing — never the menu card under it", async ({
    page,
  }) => {
    await page.clock.install();
    await bootToMenu(page);
    const guard = page.getByTestId("detour-tap-guard");
    const doubleTap = async ({ x, y }: { x: number; y: number }) => {
      await page.mouse.click(x, y);
      await page.clock.runFor(120);
      await page.mouse.click(x, y);
    };
    /** A point `across` the way along `target`, half way down. */
    const pointOn = async (target: Locator, across = 1 / 2) => {
      const box = await target.boundingBox();
      if (!box) throw new Error("nothing to tap");
      return { x: box.x + box.width * across, y: box.y + box.height / 2 };
    };
    /** What a tap at `at` meets now: the modal's closer (its accessible name) or a menu card (its testid). */
    const under = (at: { x: number; y: number }) =>
      page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('[data-testid="product-added-modal"]')
          ? el.getAttribute("aria-label")
          : (el?.closest('[data-testid^="item-"]')?.getAttribute("data-testid") ?? null);
      }, at);

    const sauce = page.getByTestId(`item-${TORTILLA_SAUCE}`);
    await sauce.scrollIntoViewIfNeeded();
    const card = await pointOn(sauce);
    await freezeClock(page);
    await doubleTap(card);
    await expect(modal(page)).toBeVisible();
    await expect(guard).toHaveCount(1);
    await page.clock.runFor(500);
    await expect(guard).toHaveCount(0);
    await expect(modal(page), "the window is over and the modal is still up").toBeVisible();
    expect(await under(card), "the card's tap point sits over the modal's scrim").toBe(en.language.close);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: true, item: "Tortilla Sauce", cart: ["Tortilla Sauce x1"] });

    // A quarter along: its centre sits over the gap between two cards.
    const gotIt = await pointOn(cta(page), 1 / 4);
    await expect(cta(page)).toHaveText(en.offers.gotIt);
    await doubleTap(gotIt);
    await expect(modal(page)).toHaveCount(0);
    await expect(guard).toHaveCount(1);
    await page.clock.runFor(500);
    await expect(guard).toHaveCount(0);
    await expect(page, "still the menu: no PDP opened under the finger").toHaveURL(/\/menu$/);
    await expect(modal(page), "no add reopened it").toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, cart: ["Tortilla Sauce x1"] });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    expect(await under(gotIt), "GOT IT sat over a menu card").toMatch(/^item-/);
  });

  test("A4 KEYBOARD: Enter on a plain card's '+' adds it and moves focus into the dialog, on GOT IT — the next Enter closes it, never a second add behind it — and focus goes back to the '+'", async ({
    page,
  }) => {
    await bootToMenu(page);
    const plusButton = page.getByTestId(`quick-add-${TORTILLA_SAUCE}`);
    await plusButton.scrollIntoViewIfNeeded();
    await plusButton.focus();

    await page.keyboard.press("Enter");
    await expect(modal(page)).toBeVisible();
    await expect(cta(page)).toBeFocused();
    await expect.poll(() => snapshot(page)).toMatchObject({ open: true, cart: ["Tortilla Sauce x1"] });

    await page.keyboard.press("Enter");
    await expect(modal(page)).toHaveCount(0);
    await expect(plusButton).toBeFocused();
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, cart: ["Tortilla Sauce x1"] });
  });
});

/**
 * P8 MOTION: one body, both modes. Under no-preference the card is tapped ~120 ms into its spring (paused there,
 * read live, once the modal's 500 ms double-tap guard has lifted), the pill pops in (tb-pop-in) and the next tap
 * bumps its number (tb-bump), and a choice tap removes the modal from the screen in the same frame (hiding is
 * instant: no exit animation) while Select a Size appears. Under the suite's default reduce the same taps land with
 * every animation ≤ 1 ms.
 */
async function motionPaths(page: Page, real: boolean) {
  await bootToMenu(page);
  const rate = await slowMotion(page);
  await openSaladModal(page);
  // The menu behind the modal is not under test: its bag icon bumps on the salad's add, and the CDP rate changes
  // below re-anchor a running animation's start into the future (it read −8 s at rest), so settle() would wait it
  // out. A pick no longer re-keys that icon (the bag is untouched), which used to hide this.
  await page.evaluate(() => {
    const added = document.querySelector('[data-testid="product-added-modal"]');
    for (const a of document.getAnimations()) {
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (target && !added?.contains(target) && Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
    }
  });

  // ~120 ms into the spring: paused there, the tile read at its LIVE centre and tapped.
  const at120 = await page.locator(SPRING_CARD).evaluate((card, id) => {
    const spring = card
      .getAnimations()
      .find((a) => a instanceof CSSAnimation && a.animationName === "tb-modal-spring");
    const duration = Number(spring?.effect?.getComputedTiming().duration ?? 0);
    if (spring) {
      spring.pause();
      spring.currentTime = Math.min(120, duration);
    }
    const r = document.querySelector(`[data-testid="added-rec-${id}"]`)?.getBoundingClientRect();
    if (!r) throw new Error(`no added-rec-${id}`);
    return {
      duration,
      scale: card.getBoundingClientRect().width / (card as HTMLElement).offsetWidth,
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    };
  }, TORTILLA_SAUCE);
  if (real) {
    expect(at120.duration, "the Figma spring").toBe(958);
    expect(Math.abs(at120.scale - 1), "mid-spring: the card is not at rest").toBeGreaterThan(0.05);
  } else {
    expect(at120.duration, "reduce: the spring ends in 1 ms").toBeLessThanOrEqual(1);
    expect(at120.scale, "reduce: at rest").toBeCloseTo(1, 2);
  }
  // The modal's first 500 ms swallow taps (the double-tap guard, armed as it opens — user 2026-10-14): the spring is
  // held at 120 ms while the guard lifts, so the tap still meets the tile mid-spring.
  await expect(page.getByTestId("detour-tap-guard")).toHaveCount(0);
  await rate(0.1);
  await page.mouse.click(at120.x, at120.y);
  await expect(pill(page, TORTILLA_SAUCE), "the tap mid-spring lands").toHaveText("1");
  await expect(total(page)).toHaveText(totalText(19));
  if (real) {
    await expect.poll(() => running(pill(page, TORTILLA_SAUCE)), { message: "the pill pops in" }).toContainEqual({
      name: "tb-pop-in",
      duration: 200,
    });
  } else {
    for (const a of await running(pill(page, TORTILLA_SAUCE))) expect(a.duration, `reduce: ${a.name}`).toBeLessThanOrEqual(1);
  }
  await page
    .locator(SPRING_CARD)
    .evaluate((card) => card.getAnimations().forEach((a) => a.playState === "paused" && a.play()));
  await rate(1);
  await settle(page);

  // The next tap: the number bumps; the pill itself does not pop again.
  await rate(0.1);
  await tile(page, TORTILLA_SAUCE).click();
  await expect(pill(page, TORTILLA_SAUCE)).toHaveText("2");
  await expect(total(page)).toHaveText(totalText(21));
  const number = pill(page, TORTILLA_SAUCE).locator("span");
  if (real) {
    await expect.poll(() => running(number), { message: "the number bumps" }).toContainEqual({ name: "tb-bump", duration: 250 });
    expect(await running(pill(page, TORTILLA_SAUCE)), "the pill pops in once").toEqual([]);
  } else {
    for (const a of await running(number)) expect(a.duration, `reduce: ${a.name}`).toBeLessThanOrEqual(1);
  }
  await rate(1);
  await settle(page);

  // A choice tap: the modal is off the screen in the same frame and Select a Size is up.
  await rate(0.1);
  await tile(page, SIZED).click();
  const after = await page.evaluate(() => ({
    added: document.querySelector('[data-testid="product-added-modal"]') !== null,
    size: document.querySelector('[data-testid="select-size-modal"]') !== null,
  }));
  expect(after, "hiding is instant: no exit animation holds the modal").toEqual({ added: false, size: true });
  await expect(page.getByTestId("select-size-modal")).toBeVisible();
  await expect.poll(() => snapshot(page)).toMatchObject({ open: true, detour: true });
  await rate(1);
  await sizeClose(page).click();
  await expect(page.getByTestId("select-size-modal")).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
  await expect(pill(page, TORTILLA_SAUCE)).toHaveText("2");
  await expect.poll(() => snapshot(page)).toMatchObject({
    open: true,
    detour: false,
    cart: ["Greek Salad x1"],
    picked: { [TORTILLA_SAUCE]: 2 },
  });
}

test.describe("the product-added modal — P8 MOTION (no-preference)", () => {
  test.use({ reducedMotion: "no-preference" });
  test("P8 MOTION: a card tap ~120 ms into the spring lands; the pill pops in (tb-pop-in) and the next tap bumps its number (tb-bump); a choice tap hides the modal at once and Select a Size appears; its X brings it back with the picks", async ({
    page,
  }) => {
    test.slow();
    await motionPaths(page, true);
  });
});

test.describe("the product-added modal — P8 MOTION (reduce, the suite default)", () => {
  test("P8 MOTION (reduce): the same taps land — the spring, the pop and the bump end in ≤ 1 ms; the choice tap still swaps the modal for Select a Size at once, and its X brings it back with the picks", async ({
    page,
  }) => {
    test.slow();
    await motionPaths(page, false);
  });
});
