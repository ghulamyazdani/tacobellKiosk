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
import { expect, test, type Locator, type Page } from "./fixtures/kiosk";
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
 * Lane added-modal — user report 2026-10-09 (on a device): "item recommendation add and then add to
 * order is not working". The contract proved RC1–RC5 on main: only the 44 px "+" added (the card did
 * nothing), "+" added silently, ADD TO ORDER added nothing, a choice suggestion left the modal open
 * behind the PDP / repeat sheet, suggestions chained without end, and the strip had its own lookup.
 *
 * The behaviour under test (Figma 1:4589 frame, the fork's behaviour; sign-off list in PROGRESS):
 *  - the WHOLE card (photo, name, anywhere) or its "+" adds at once through the menu "+"'s path; the
 *    card counts that item in the order (pill + sr-only status) and the Total moves;
 *  - a suggestion that needs a choice CLOSES the modal first and opens what the same item's menu "+"
 *    opens — Select a Size, the PDP (options / pack) or the repeat sheet (in the bag) — with
 *    recommendationDetour set, so the add it ends in confirms WITHOUT a strip (one hop); every exit
 *    clears the flag;
 *  - ADD TO ORDER (Figma's label), X and the scrim only close: every add already happened;
 *  - a refused add (the DP cap) raises the global error and the card does not change.
 *
 * Fixture: slim-menu with Greek Salad (plain £17) suggesting Tortilla Sauce (plain £2), Large Fries
 * (£9, one optional group → PDP) and the Kiddie Meal Beef Burger reshaped into a size-only item
 * (Regular £5 / Large £7; raw price £13 — sizeFastLane.spec's reshape); Large Fries suggests
 * [Cheese Burger, Tortilla Sauce], so a second strip after its PDP would be a second hop.
 *
 * A re-tap of an in-cart PLAIN item only bumps its row (no modal), so a test that needs the salad's
 * modal again starts the next customer's order (CANCEL ORDER → splash → /menu: `newOrder`).
 * Store state is read through `window.__kioskStore` (DEV-only) with expect.poll; the cart is checked
 * in the store, never through the bag UI. The print agent and every non-app origin are denied by the
 * harness (fixtures/kiosk): an unexpected call fails the test.
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

/** slim-menu: Greek Salad suggests `saladRecs`, Large Fries suggests [Cheese Burger, Tortilla Sauce]; the sized reshape. */
function menuWith(saladRecs: string[] = SALAD_RECS) {
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
          ].map(([id, name, price]) => ({ id, name, price, isActive: true, subCategoryId: sub.id }));
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

async function bootToMenu(page: Page, saladRecs?: string[]) {
  await mockKioskBackend(page, { menu: menuWith(saladRecs) });
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
  };
}
type StoreWindow = Window & { __kioskStore: { getState(): KioskState } };

/** The added modal as the store has it, the detour flag and the cart rows ("name (size) xN"). */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as StoreWindow).__kioskStore.getState();
    const modal = s.menuSelections.addToCartModal;
    return {
      open: Boolean(modal?.isOpen),
      item: modal?.isOpen ? (modal.item?.name ?? null) : null,
      noStrip: modal?.isOpen ? Boolean(modal.item?.suppressRecommendations) : null,
      detour: Boolean(s.menuSelections.recommendationDetour),
      cart: s.cart.cartItems.map(
        (row) => `${row.name}${row.selectedVariant?.name ? ` (${row.selectedVariant.name})` : ""} x${row.quantity}`
      ),
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
const tiles = (page: Page) => page.locator('[data-testid^="added-rec-"]:not([data-testid^="added-rec-add-"])');
const tile = (page: Page, id: string) => page.getByTestId(`added-rec-${id}`);
const plus = (page: Page, id: string) => page.getByTestId(`added-rec-add-${id}`);
const pill = (page: Page, id: string) => page.getByTestId(`added-count-${id}`);
/** The tile's one accessible control: the empty overlay (the "+" is its aria-hidden twin). */
const overlay = (card: Locator) => card.locator(":scope > button:not([aria-hidden])");
const tileIds = (page: Page) =>
  tiles(page).evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") ?? "").replace("added-rec-", "")));
const totalText = (amount: number) => `${en.menu.total} £${amount.toFixed(2)}`;

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
  await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: false, cart: [] });
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

test.describe("lane added-modal — the product-added modal's suggestions", () => {
  test("P1 PLAIN: the Tortilla Sauce card's photo, then its name, then its '+' each add one at once — pill 1 → 2 → 3, Total £19 → £21 → £23, the modal open and no detour; ADD TO ORDER closes on Greek Salad ×1 + Tortilla Sauce ×3", async ({
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
    });
    await expect(tiles(page)).toHaveCount(3);
    await expect(total(page)).toHaveText(totalText(17));
    await expect(pill(page, TORTILLA_SAUCE)).toHaveCount(0);

    const sauce = tile(page, TORTILLA_SAUCE);
    const taps: [string, () => Promise<void>][] = [
      ["its photo", () => tapOn(sauce, sauce.locator(":scope > div").first())],
      ["its name", () => tapOn(sauce, sauce.locator("p").first())],
      ["its '+'", () => plus(page, TORTILLA_SAUCE).click()],
    ];
    for (const [index, [part, tap]] of taps.entries()) {
      const count = index + 1;
      await tap();
      await expect(pill(page, TORTILLA_SAUCE), `a tap on ${part} adds one`).toHaveText(String(count));
      await expect(sauce.locator(".sr-only")).toHaveText(en.added.inOrder.replace("{{value}}", String(count)));
      await expect(total(page)).toHaveText(totalText(17 + 2 * count));
      await expect(modal(page)).toBeVisible();
      await expect.poll(() => snapshot(page)).toMatchObject({
        open: true,
        item: "Greek Salad",
        detour: false,
        cart: ["Greek Salad x1", `Tortilla Sauce x${count}`],
      });
    }
    // The SDK resolver feeds the strip: the refs in order, and a size parent reads its lowest active size
    // (£5), never its raw £13 (RC5).
    expect(await tileIds(page)).toEqual(SALAD_RECS);
    await expect(tile(page, SIZED)).toContainText("£5");
    await expect(tile(page, SIZED)).not.toContainText("£13");
    // One control per tile: a one-tap add is a Quick add, a tile that leaves the modal a Customize.
    await expect(overlay(sauce)).toHaveAccessibleName(`${en.menu.quickAdd} Tortilla Sauce`);
    await expect(overlay(tile(page, LARGE_FRIES))).toHaveAccessibleName(`${en.pack.customize} Large Fries`);
    await expect(overlay(tile(page, SIZED))).toHaveAccessibleName(`${en.pack.customize} Kiddie Meal Beef Burger`);

    // ADD TO ORDER only closes: everything tapped is already in the order.
    await page.getByTestId("added-continue").click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toEqual({
      open: false,
      item: null,
      noStrip: null,
      detour: false,
      cart: ["Greek Salad x1", "Tortilla Sauce x3"],
    });
  });

  test("P2 SIZED → SELECT A SIZE: the sized card closes the modal first and opens Select a Size (detour on); its X ends the detour with nothing added and the abandoned pick never comes back; in the next order Large + CONTINUE confirms with no strip at Total £24.00, ADD TO ORDER lands the Large row, and it bills exactly like Large from the menu '+'", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page);
    await openSaladModal(page);
    await tile(page, SIZED).click();
    await expect(page.getByTestId("select-size-modal")).toBeVisible();
    await expect(page.getByTestId("select-size-modal")).toContainText("Kiddie Meal Beef Burger");
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: true, cart: ["Greek Salad x1"] });

    // X (after a pick): the plain menu, nothing added, the detour over.
    await page.getByTestId(`size-${SIZE_REGULAR}`).click();
    await expect(page.getByTestId(`size-${SIZE_REGULAR}`)).toHaveAttribute("aria-pressed", "true");
    await sizeClose(page).click();
    await expect(page.getByTestId("select-size-modal")).toHaveCount(0);
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: false, cart: ["Greek Salad x1"] });
    // The abandoned pick never comes back: the same item's menu '+' opens Select a Size with nothing ticked.
    const quickAdd = page.getByTestId(`quick-add-${SIZED}`);
    await quickAdd.scrollIntoViewIfNeeded();
    await quickAdd.click();
    await expect(page.getByTestId(`size-${SIZE_REGULAR}`)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("size-continue")).toBeDisabled();
    await sizeClose(page).click();
    await expect(page.getByTestId("select-size-modal")).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: false, cart: ["Greek Salad x1"] });

    // Again (the next customer): Large + CONTINUE ends the one hop — the modal confirms WITHOUT a strip.
    await newOrder(page);
    await openSaladModal(page);
    await tile(page, SIZED).click();
    await expect(page.getByTestId(`size-${SIZE_LARGE}`)).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId(`size-${SIZE_LARGE}`).click();
    await page.getByTestId("size-continue").click();
    await expect(modal(page)).toBeVisible();
    await expect(tiles(page)).toHaveCount(0);
    await expect(modal(page)).not.toContainText(en.added.youMightLike);
    await expect(total(page)).toHaveText(totalText(24));
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: true,
      item: "Kiddie Meal Beef Burger",
      noStrip: true,
      detour: false,
    });
    await page.getByTestId("added-continue").click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      detour: false,
      cart: ["Greek Salad x1", "Kiddie Meal Beef Burger (Large) x1"],
    });
    const viaSuggestion = await sizeRowMoney(page);
    expect(viaSuggestion).toMatchObject({ size: "Large", sizePrice: 7, variantPrice: 7, total_price: 7, quantity: 1 });
    await openBag(page);
    // round(24 × 1.15 = 27.6) = £28.
    await expect.poll(() => netAmount(page), { message: "the bag's total, via the suggestion" }).toBe(28);

    // Money parity: the same size from the menu '+' (the next customer again).
    await page.getByTestId("bag-close").click();
    await newOrder(page);
    await openSaladModal(page);
    await page.getByTestId("added-continue").click();
    await quickAdd.scrollIntoViewIfNeeded();
    await quickAdd.click();
    await page.getByTestId(`size-${SIZE_LARGE}`).click();
    await page.getByTestId("size-continue").click();
    await expect(modal(page)).toBeVisible();
    await expect(total(page)).toHaveText(totalText(24));
    await page.getByTestId("added-continue").click();
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      cart: ["Greek Salad x1", "Kiddie Meal Beef Burger (Large) x1"],
    });
    expect(await sizeRowMoney(page), "the same row money as the menu '+'").toEqual(viaSuggestion);
    await openBag(page);
    await expect.poll(() => netAmount(page), { message: "the bag's total, via the menu '+'" }).toBe(28);
  });

  test("P3 CUSTOMIZABLE, ONE HOP: the Large Fries card closes the modal first and opens the PDP (detour on); BACK lands on the plain menu with the detour over; in the next order ADD TO BAG confirms WITHOUT Large Fries' own strip at Total £26.00 and ADD TO ORDER keeps Greek Salad + Large Fries", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page);
    await openSaladModal(page);
    await tile(page, LARGE_FRIES).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: true, cart: ["Greek Salad x1"] });

    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: false, cart: ["Greek Salad x1"] });

    await newOrder(page);
    await openSaladModal(page);
    await tile(page, LARGE_FRIES).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(modal(page)).toBeVisible();
    // Large Fries suggests [Cheese Burger, Tortilla Sauce]: a strip here would be the second hop.
    await expect(tiles(page)).toHaveCount(0);
    await expect(modal(page)).not.toContainText(en.added.youMightLike);
    await expect(total(page)).toHaveText(totalText(26));
    await expect.poll(() => snapshot(page)).toMatchObject({ open: true, item: "Large Fries", noStrip: true, detour: false });

    await page.getByTestId("added-continue").click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      detour: false,
      cart: ["Greek Salad x1", "Large Fries x1"],
    });
  });

  test("P4 PACK: the Dream box card closes the modal first and opens the pack PDP (detour on); BACK lands on the plain menu with the detour over and nothing added", async ({
    page,
  }) => {
    await bootToMenu(page, [DREAM_BOX, TORTILLA_SAUCE, LARGE_FRIES]);
    await openSaladModal(page);
    await tile(page, DREAM_BOX).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: true, cart: ["Greek Salad x1"] });

    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: false, cart: ["Greek Salad x1"] });
  });

  test("P5 IN-BAG REPEAT: with Large Fries already in the bag its card (pill 1) closes the modal first and opens the repeat sheet over the plain menu (detour on); the sheet's X ends the detour with the cart unchanged", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page);
    // Its own confirmation carries Large Fries' strip; addViaPdp dismisses it (ADD TO ORDER).
    await addViaPdp(page, LARGE_FRIES, { expectedCta: "£9.00" });
    await openSaladModal(page);
    await expect(pill(page, LARGE_FRIES)).toHaveText("1");
    await tile(page, LARGE_FRIES).click();
    await expect(page.getByTestId("repeat-sheet")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      detour: true,
      cart: ["Large Fries x1", "Greek Salad x1"],
    });

    await page.getByTestId("repeat-sheet-close").click();
    await expect(page.getByTestId("repeat-sheet")).toHaveCount(0);
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      detour: false,
      cart: ["Large Fries x1", "Greek Salad x1"],
    });
  });

  test("P6 DP CAP (guard): at the session's one DP unit, Tortilla Sauce's '+' and then its card are each refused — the global error is up, no pill, the Total stays £17.00 — and GOT IT returns to the same, unchanged modal", async ({
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
    const refusal = en.toast.dpMaxQuantity_one.replace("{{count}}", "1").replace("{{session}}", DP_SESSION.sessionName);

    // The '+' first (the path main already had), then the whole card.
    const taps: [string, () => Promise<void>][] = [
      ["its '+'", () => plus(page, TORTILLA_SAUCE).click()],
      ["the card", () => tile(page, TORTILLA_SAUCE).click()],
    ];
    for (const [how, tap] of taps) {
      await tap();
      await expect(page.getByRole("alertdialog", { name: refusal }), `${how} at the cap is refused out loud`).toBeVisible();
      await expect(page.getByRole("alertdialog")).toHaveCount(1);
      await expect(pill(page, TORTILLA_SAUCE)).toHaveCount(0);
      await expect(total(page)).toHaveText(totalText(17));
      await expect.poll(() => snapshot(page)).toMatchObject({
        open: true,
        item: "Greek Salad",
        detour: false,
        cart: ["Greek Salad x1"],
      });

      await page.getByTestId("global-error-ok").click();
      await expect(page.getByTestId("global-error")).toHaveCount(0);
      await expect(modal(page)).toBeVisible();
      expect(await tileIds(page)).toEqual(SALAD_RECS);
      await expect(pill(page, TORTILLA_SAUCE)).toHaveCount(0);
      await expect(total(page)).toHaveText(totalText(17));
      await expect.poll(() => snapshot(page)).toMatchObject({ open: true, item: "Greek Salad", cart: ["Greek Salad x1"] });
    }
    expectNothingDangerousWasContacted(checkout);
  });

  test("P7 ONE TAP = ONE ADD: one '+' click adds exactly 1; a double tap on a plain card adds exactly 2 (pill 2); a double tap on the Large Fries card opens the PDP once, adds nothing and ticks no option", async ({
    page,
  }) => {
    await bootToMenu(page, [TORTILLA_SAUCE, CAESAR_DRESSING, LARGE_FRIES]);
    await openSaladModal(page);

    await plus(page, TORTILLA_SAUCE).click();
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    await expect(total(page)).toHaveText(totalText(19));
    await expect.poll(() => snapshot(page)).toMatchObject({ cart: ["Greek Salad x1", "Tortilla Sauce x1"] });

    await tile(page, CAESAR_DRESSING).dblclick();
    await expect(pill(page, CAESAR_DRESSING)).toHaveText("2");
    await expect(total(page)).toHaveText(totalText(23));
    await expect(pill(page, TORTILLA_SAUCE)).toHaveText("1");
    const before = ["Greek Salad x1", "Tortilla Sauce x1", "Caesar Dressing x2"];
    await expect.poll(() => snapshot(page)).toMatchObject({ open: true, detour: false, cart: before });

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
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: true, cart: before });
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

  test("P7b ONE TAP = ONE ADD (same-frame surfaces): a double tap on the sized card opens Select a Size with nothing ticked, and on an in-bag card the repeat sheet stays up — the second half lands nowhere (the 500 ms detour tap guard)", async ({
    page,
  }) => {
    test.slow();
    await bootToMenu(page);
    await openSaladModal(page);
    // Select a Size mounts in the same commit that closes the modal, under the finger.
    await tile(page, SIZED).dblclick();
    await expect(page.getByTestId("select-size-modal")).toBeVisible();
    await expect(page.getByTestId("detour-tap-guard")).toHaveCount(0);
    await expect(page.locator('[data-testid^="size-"][aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByTestId("size-continue")).toBeDisabled();
    await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: true, cart: ["Greek Salad x1"] });
    await sizeClose(page).click();
    await expect.poll(() => snapshot(page)).toMatchObject({ detour: false, cart: ["Greek Salad x1"] });

    // The repeat sheet too: its scrim would take the second tap and drop the guest on a bare menu.
    await newOrder(page);
    await addViaPdp(page, LARGE_FRIES, { expectedCta: "£9.00" });
    await openSaladModal(page);
    await tile(page, LARGE_FRIES).dblclick();
    await expect(page.getByTestId("repeat-sheet")).toBeVisible();
    await expect(page.getByTestId("detour-tap-guard")).toHaveCount(0);
    await expect(page.getByTestId("repeat-sheet")).toBeVisible();
    await expect.poll(() => snapshot(page)).toMatchObject({
      open: false,
      detour: true,
      cart: ["Large Fries x1", "Greek Salad x1"],
    });
  });

  test("AR: the card's control and its count read in Arabic — 'Quick add' / 'Customize' + the Arabic name, and the sr-only 'N in your order' (locale ar)", async ({
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
    for (const part of (ar.added.inOrder as string).split("{{value}}").map((s) => s.trim()).filter(Boolean)) {
      await expect(status).toContainText(part);
    }
    await expect(status).toContainText("1");
    await expect(status).not.toContainText("in your order");
    await expect.poll(() => snapshot(page)).toMatchObject({ open: true, cart: ["Greek Salad x1", "Tortilla Sauce x1"] });
  });
});

/**
 * P8 MOTION: one body, both modes. Under no-preference the card is tapped ~120 ms into its spring (paused
 * there, read live), the pill pops in (tb-pop-in) and the next tap bumps its number (tb-bump), and a
 * choice tap removes the modal in the same frame (closing is instant: no exit animation) while Select a
 * Size appears. Under the suite's default reduce the same taps land with every animation ≤ 1 ms.
 */
async function motionPaths(page: Page, real: boolean) {
  await bootToMenu(page);
  const rate = await slowMotion(page);
  await openSaladModal(page);

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

  // A choice tap: the modal is gone in the same frame and Select a Size is up.
  await rate(0.1);
  await tile(page, SIZED).click();
  const after = await page.evaluate(() => ({
    added: document.querySelector('[data-testid="product-added-modal"]') !== null,
    size: document.querySelector('[data-testid="select-size-modal"]') !== null,
  }));
  expect(after, "closing is instant: no exit animation holds the modal").toEqual({ added: false, size: true });
  await expect(page.getByTestId("select-size-modal")).toBeVisible();
  await expect.poll(() => snapshot(page)).toMatchObject({ open: false, detour: true });
  await rate(1);
  await sizeClose(page).click();
  await expect(page.getByTestId("select-size-modal")).toHaveCount(0);
  await expect.poll(() => snapshot(page)).toMatchObject({
    open: false,
    detour: false,
    cart: ["Greek Salad x1", "Tortilla Sauce x2"],
  });
}

test.describe("lane added-modal — P8 MOTION (no-preference)", () => {
  test.use({ reducedMotion: "no-preference" });
  test("P8 MOTION: a card tap ~120 ms into the spring lands; the pill pops in (tb-pop-in) and the next tap bumps its number (tb-bump); a choice tap removes the modal at once and Select a Size appears", async ({
    page,
  }) => {
    test.slow();
    await motionPaths(page, true);
  });
});

test.describe("lane added-modal — P8 MOTION (reduce, the suite default)", () => {
  test("P8 MOTION (reduce): the same taps land — the spring, the pop and the bump end in ≤ 1 ms; the choice tap still swaps the modal for Select a Size at once", async ({
    page,
  }) => {
    test.slow();
    await motionPaths(page, false);
  });
});
