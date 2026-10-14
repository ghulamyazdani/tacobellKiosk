import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  clone,
  routeOffers,
  CHEESE_BURGER,
  GREEK_SALAD,
  CAESAR_DRESSING,
  TORTILLA_SAUCE,
} from "./fixtures/backend";
import { bootRegisteredToMenu, startOrderTo } from "./pages/boot";
import { addViaPdp, addOneTap, openBag, bagRows } from "./pages/order";

/**
 * Lane offers, item 34 — AUTO-APPLY. With the default scope
 * ("operatorFlagged") the bag applies an offer the operator flagged
 * (`autoApplied: true` in the payload) the moment it opens, with zero taps,
 * through the same swap path as a manual SAVE — so the bill is the APPLY FLAT
 * bill of offers.spec.ts. It never adds food (freebie / BOGO mechanics are
 * never picked), never overrides the customer: Remove — or any SAVE, whatever
 * its outcome — latches it off for the whole session (persisted, so a
 * crash-reload keeps the latch), and only the next customer (/start's reset)
 * gets it again. It also applies mid-bag when the cart reaches an offer's
 * minimum, but never under an open rewards list.
 *
 * "No celebration card" is a ONE-SHOT count read in the commit that applied
 * the offer: the card auto-closes after 2.2 s, so a retrying toHaveCount(0)
 * would sit a wrongly opened card out. A mount-time apply cannot prove it in
 * dev (StrictMode's simulated unmount closes any open card), hence E7's
 * mid-bag apply.
 *
 * Same registered-device boot as offers.spec.ts, on the shared harness
 * (fixtures/backend.ts mock, pages/* steps). Each test registers its OWN
 * get_cx_valid_offers route after the mock (newest wins); E5 keeps the stock
 * fixture (every offer `autoApplied: false`).
 *
 * Money (offers.spec.ts / bag.spec.ts headers; VAT 15% exclusive, whole-unit
 * round-off): flat £2 on the £8 burger → Sub £8.00, Discounts −£2.00,
 * Total £7.00; burger alone → £9.00; burger + Greek Salad, no offer →
 * round(25 × 1.15 = 28.75) = £29.00; with the flat £2 → round(23 × 1.15 =
 * 26.45) = £26.00 (E7, E8). After page.reload() money keeps the persisted
 * "£" (bag.spec.ts header).
 */

const offersFixture = fixtureJson("offers.json");

/** U+2212 MINUS SIGN — the literal character the bag renders, NOT a hyphen. */
const MINUS = "−";

// ---- Offer payloads ----

/** The stock flat £2 (offers.json[1]) as the operator would flag it. */
const AUTO_FLAT = { ...clone(offersFixture[1]), autoApplied: true };

/** The same flagged flat £2 from a £10 bill: the £8 burger alone does not reach it. */
const AUTO_FLAT_MIN10 = {
  ...clone(offersFixture[1]),
  _id: "offer-flat-2-min10",
  autoApplied: true,
  minBillAmount: 10,
};

/** The stock "Free sauce of your choice" (offers.json[3]): SAVE opens the picker. */
const SAUCE_CHOICE = clone(offersFixture[3]);

/** The stock single-"and" free Greek Salad (offers.json[2]), flagged. */
const FLAGGED_FREE_SALAD = {
  ...clone(offersFixture[2]),
  _id: "offer-free-salad-flagged",
  autoApplied: true,
};

/** A flagged plain BOGO the burger already satisfies: buy a burger → Caesar free. */
const FLAGGED_BOGO = {
  ...clone(offersFixture[2]),
  _id: "offer-bogo-burger-flagged",
  name: "Buy a Cheese Burger get a Caesar free",
  getItemOnly: false,
  autoApplied: true,
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [
      { item: { baseItemId: CHEESE_BURGER, name: "Cheese Burger" }, quantity: 1, relation: "and" },
    ],
  },
  getItems: {
    items: [
      {
        _id: "gi-flagged-caesar",
        baseItemId: CAESAR_DRESSING,
        name: "Caesar Dressing",
        relation: "and",
        discountType: "percent",
        value: 100,
        quantity: 1,
      },
    ],
    categories: [],
  },
};

/**
 * The shared boot mock (fixtures/backend.ts) serving the stock P7b offers
 * fixture; each test routes its own list after it (routeOffers, newest wins).
 */
const mockKioskBackend = (page: Page) => mockBackend(page, { offers: fixtureJson("offers.json") });

/** Splash → order type → /menu (the second half of bootRegisteredToMenu). */
const startToMenu = (page: Page) => startOrderTo(page, "menu-screen");

/** Menu card tap → PDP → commit plain (£8) → dismiss the added modal. */
const addCheeseBurgerViaPdp = (page: Page) =>
  addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });

/** Applied by the machine: the caption, the APPLY FLAT bill, no celebration card. */
async function expectFlatAutoApplied(page: Page) {
  await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveText("Applied for you");
  // ONE-SHOT, in the commit that applied it: the machine never opens the
  // celebration card. A retrying toHaveCount(0) would sit out the card's own
  // 2.2 s auto-close and pass.
  expect(await page.getByTestId("offer-applied-celebration").count()).toBe(0);
  await expect(page.getByTestId("bag-rewards-applied")).toContainText("£2 off your order");
  await expect(page.getByTestId("bag-rewards-applied")).toContainText(`${MINUS}£2.00`);
  await expect(page.getByTestId("bag-rewards-entry")).toHaveCount(0);
  await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
  await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
  await expect(page.getByTestId("bag-total")).toContainText("£7.00");
  await expect(page.getByTestId("bag-pay")).toContainText("Order & Pay");
  await expect(page.getByTestId("bag-pay")).toContainText("£7.00");
  await expect(page.getByTestId("offer-applied-celebration")).toHaveCount(0);
}

/** Nothing applied: the entry row offers rewards, no Discounts line. */
async function expectNothingApplied(page: Page) {
  await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
  await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
  await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
}

/**
 * Open the rewards list and close it with X (no SAVE — not a customer offer
 * action): the round trip re-runs the auto-apply effect as the list unblocks
 * it, so a "nothing applied" check after it is not just early.
 */
async function rewardsRoundTrip(page: Page) {
  await page.getByTestId("bag-rewards-entry").click();
  await expect(page.getByTestId("rewards-sheet")).toBeVisible();
  await page.getByTestId("rewards-close").click();
  await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
}

test.describe("Lane offers — auto-apply (item 34)", () => {
  test("E1 a flagged flat offer applies itself when the bag opens: zero taps, 'Applied for you', Discounts −£2.00, Total £7.00 (the APPLY FLAT bill), no celebration card; the customer's own re-apply after Remove is uncaptioned and celebrates", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    // The menu never auto-applies: its bar keeps the plain subtotal.
    await expect(page.getByTestId("cta-total")).toContainText("£8.00");
    await openBag(page);

    await expectFlatAutoApplied(page);
    await expect(bagRows(page)).toHaveCount(1);
    // The row still pops once (legible), without the customer's card.
    await expect(
      page.getByTestId("bag-rewards-applied").locator(".tb-chip-pop")
    ).toHaveCount(1);
    await expect(page).toHaveURL(/\/cart$/);

    // Remove, then the customer applies the SAME offer themselves: it is
    // theirs now — no "Applied for you", and it celebrates. Same bill.
    await page.getByTestId("bag-rewards-remove").click();
    await expectNothingApplied(page);
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId(`offer-row-${AUTO_FLAT._id}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("offer-applied-celebration")).toBeVisible();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText("£2 off your order");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");
  });

  test("E2 Remove latches it off: adding an item does not re-apply it, nor does a crash-reload on /cart (the latch is persisted)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectFlatAutoApplied(page);

    await page.getByTestId("bag-rewards-remove").click();
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");

    // A cart change re-ranks the offers while the bag is open: still off.
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).click();
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");
    await rewardsRoundTrip(page);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");

    // Crash-reload on /cart: the Dexie cart and the persisted latch return,
    // and the bag stays open (it waits for the rehydrated rows — E9).
    await page.reload();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(2);
    // The entry row renders only with ranked offers: the flagged offer IS a
    // candidate again, and only the latch keeps it off.
    await expectNothingApplied(page);
    await rewardsRoundTrip(page);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("29.00");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
  });

  test("E3 Cancel Order → /start resets the latch: the next session with the same payload is auto-applied again", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectFlatAutoApplied(page);
    await page.getByTestId("bag-rewards-remove").click();
    await expectNothingApplied(page);

    await page.getByTestId("bag-close").click();
    await expect(page).toHaveURL(/\/menu$/);
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    await startToMenu(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectFlatAutoApplied(page);
  });

  test("E4 flagged freebie and BOGO offers are never auto-applied (the machine never adds food), though both are eligible", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [FLAGGED_FREE_SALAD, FLAGGED_BOGO]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingApplied(page);

    // Both are eligible (radios), so only the mechanic filter keeps them off.
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${FLAGGED_FREE_SALAD._id}`)).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${FLAGGED_BOGO._id}`)).toBeVisible();
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);

    await expectNothingApplied(page);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
  });

  test("E5 the stock fixture (every offer autoApplied:false) is never auto-applied", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingApplied(page);
    await rewardsRoundTrip(page);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(bagRows(page)).toHaveCount(1);
  });

  test("E6 a customer SAVE latches it too: SAVE a picker offer and dismiss the picker, then the bill reaches the flagged offer's £10 minimum — it is not auto-applied", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT_MIN10, SAUCE_CHOICE]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    // £8 < £10: the flagged offer is not eligible yet, so nothing applies.
    await expectNothingApplied(page);

    // The customer acts on offers: SAVE the sauce choice, then X its picker.
    // Nothing lands, but the action latches auto-apply off (decision 4).
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId(`offer-row-${SAUCE_CHOICE._id}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await page.getByTestId("freebie-close").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expectNothingApplied(page);

    // The rail add lifts the bill to £25: the flagged offer is eligible now
    // (its radio shows), and only the SAVE's latch keeps the machine off.
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).click();
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expectNothingApplied(page);
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${AUTO_FLAT_MIN10._id}`)).toBeVisible();
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
  });

  test("E7 the flagged offer becomes eligible while the bag is open (a rail add reaches its £10 minimum): it applies itself then — 'Applied for you', no celebration card, Discounts −£2.00, Total £26.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT_MIN10]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");

    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).click();
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveText("Applied for you");
    // One-shot, in the commit that applied it. This apply runs AFTER the bag
    // mounted, so dev StrictMode's simulated unmount (which closes any open
    // card) cannot hide a wrongly opened one, as it can for a mount-time apply.
    expect(await page.getByTestId("offer-applied-celebration").count()).toBe(0);
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£26.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£26.00");
    await expect(page.getByTestId("offer-applied-celebration")).toHaveCount(0);
  });

  test("E8 never under an open rewards list: a suggested add that reaches the flagged offer's £10 minimum leaves it unapplied while the list is open; closing the list (no SAVE) lets it apply — 'Applied for you', Total £26.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT_MIN10]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectNothingApplied(page);

    // The flagged offer is the top locked row (£2 short), so the list offers
    // its Suggested rail; a rail add changes the cart UNDER the open list.
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${AUTO_FLAT_MIN10._id}`)).toHaveCount(0);
    await page.getByTestId(`offer-suggested-item-${GREEK_SALAD}`).click();
    await expect(page.getByTestId(`offer-radio-${AUTO_FLAT_MIN10._id}`)).toBeVisible();
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    // A radio pick is not a customer offer action (only SAVE is); it also
    // gives every effect of the cart change time to have run.
    await page.getByTestId(`offer-row-${AUTO_FLAT_MIN10._id}`).click();
    await expect(page.getByTestId(`offer-row-${AUTO_FLAT_MIN10._id}`)).toHaveAttribute(
      "aria-checked",
      "true"
    );
    // offers-parity D8: the radio is the row's overlay; its text is the body's.
    await expect(page.getByTestId(`offer-row-body-${AUTO_FLAT_MIN10._id}`)).not.toContainText(
      "Applied"
    );
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);

    // X (no SAVE, so no latch): the list unblocks the machine, which applies it.
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveText("Applied for you");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£26.00");
  });

  test("E9 a crash-reload on /cart keeps the bag, its rows and the customer's SAVED reward: no 'Reward Removed', no /menu bounce, the same bill (the SAVE's latch keeps the machine out)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [AUTO_FLAT]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expectFlatAutoApplied(page);

    // The customer takes the reward over: Remove, then their own SAVE —
    // which latches auto-apply off, so nothing would ever re-apply it.
    await page.getByTestId("bag-rewards-remove").click();
    await expectNothingApplied(page);
    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId(`offer-row-${AUTO_FLAT._id}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText("£2 off your order");
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");

    // The first render after the reload has the persisted reward but not yet
    // the Dexie rows (AppRoutes' rehydrate lands them a moment later): the
    // bag must wait for them instead of empty-exiting.
    await page.reload();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText("£2 off your order");
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);
    await expect(page.getByTestId("offer-removal-notice")).toHaveCount(0);
    // Post-reload money keeps the persisted "£" (bag.spec.ts header).
    await expect(page.getByTestId("bag-discounts")).toContainText("£2.00");
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");
    await expect(page).toHaveURL(/\/cart$/);
  });

  test("E10 walk 2026-10-14: a flagged £2-off-over-£10 onGrossTotal offer on burger + Tortilla (£10.00 of items) lands once and stays though its own £2 takes the bill to £9.00; delete the Tortilla (£8.00) and it goes with REWARD REMOVED 'Add £2.00+…'; GOT IT, nothing re-applies", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [{ ...AUTO_FLAT_MIN10, _id: "offer-flat-2-min10-gross", onGrossTotal: true }]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await addOneTap(page, TORTILLA_SAUCE, "(2)");
    await openBag(page);

    // Judged on its £10.00 of items, like the engine: applied, and kept.
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveText("Applied for you");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£10.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    const start = Date.now();
    await expect
      .poll(
        async () => {
          if ((await page.getByTestId("offer-removal-notice").count()) > 0) return "removed";
          return Date.now() - start >= 1_500 ? "kept" : "waiting";
        },
        { timeout: 5_000, intervals: [250] }
      )
      .toBe("kept");

    // The walk's repro: a line deleted takes the bag under the minimum.
    await bagRows(page).filter({ hasText: "Tortilla Sauce" }).locator('[data-testid^="bag-dec-"]').click();
    await page.getByTestId("remove-item-confirm").click();
    const notice = page.getByTestId("offer-removal-notice");
    await expect(notice).toContainText("Reward Removed");
    await expect(notice).toContainText("Add £2.00+ to your order to be eligible to redeem this reward");
    await expect(notice).toContainText("Your total is now £9.00");
    await page.getByTestId("offer-removal-gotit").click();
    await expect(notice).toHaveCount(0);
    await expectNothingApplied(page);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });
});
