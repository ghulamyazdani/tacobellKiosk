import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  DINE_IN,
  fixtureJson,
  routeOffers,
  clone,
  CHEESE_BURGER,
  GREEK_SALAD,
  TORTILLA_SAUCE,
  CAESAR_DRESSING,
  LARGE_FRIES,
} from "./fixtures/backend";
import {
  bootRegisteredToMenu,
  registerToStart,
  startToSecond,
  chooseLanguage,
  pickPipelineToMenu,
} from "./pages/boot";
import { addOneTap, addViaPdp, openBag, bagRows, openRewardsSheet } from "./pages/order";
import { axeSweep, targetProblems, englishCopy, untranslatedCopy, arabicNotIsolated } from "./fixtures/a11y";
import { settle } from "./fixtures/capture";

/**
 * P7b — Offers vertical: the REWARDS sheet (radio + SAVE SELECTION), the
 * apply/swap/remove core, freebie offers (atomic "and" grant + "or" picker),
 * the bag's Rewards section / Discounts line / ORDER & PAY CTA, and the
 * cart-driven removal notice. The registered-device boot runs on the shared
 * harness (fixtures/backend.ts mock, pages/* steps), its
 * get_cx_valid_offers route serving tests/e2e/fixtures/offers.json (a RAW
 * array — useOfferHook stores result.data verbatim, no envelope).
 *
 * Money math (VERIFIED against @cx-sdk/ordering billCalculation.js +
 * orderBuilder.ts — see bag.spec.ts header for the base VAT facts):
 * - Every fixture item carries VAT@15% treated as EXCLUSIVE; getNetAmount()
 *   = Math.round(TotalBill) to 0 decimals (no round-off settings mocked).
 * - Bill-wise offers discount BEFORE tax (billDiscountAmount prorated per
 *   item; VAT is charged on the discounted base):
 *   · flat £2 on the £8 Cheese Burger: taxable 8−2=6 → VAT 0.90 →
 *     TotalBill 6.90 → Total £7.00; Discounts −£2.00.
 *   · percent-25 on £25 (burger £8 + Greek Salad £17, exactly meeting
 *     minBillAmount 25 — validated "<=" against the un-taxed subtotal):
 *     discount round2(25×0.25)=£6.25 (maxDiscount 10 not binding);
 *     proration 2.00/4.25 → taxes 0.90+1.91=2.81 → TotalBill 21.56 →
 *     Total £22.00; Discounts −£6.25.
 * - Freebie (getItemOnly) offers discount at the ROW: redeemGetItem stamps
 *   isGetItem:true + discounted(0)/undiscounted price; the converter turns
 *   that into a 100% item-wise discount, so getSubtotal COUNTS the freebie
 *   at full price and getTotalDiscount returns it whole; the freebie row's
 *   taxable base is 0 (no VAT on free items). The offer's own type
 *   {name:"item", value:0} yields a 0 bill-wise discount:
 *   · free Greek Salad over the £8 burger: subtotal £25.00, Discounts
 *     −£17.00, tax 1.20 (burger only) → TotalBill 9.20 → Total £9.00.
 *   · free Tortilla Sauce (£2) over the burger: subtotal £10.00, Discounts
 *     −£2.00, tax 1.20 → TotalBill 9.20 → Total £9.00.
 * - The bag's Discounts line and the applied row's amount use U+2212 MINUS
 *   SIGN ("−"), not ASCII hyphen — MINUS below is that literal character.
 *
 * Wiring note (one-line fix applied to BagSheet.tsx alongside this spec):
 * the applied Rewards row (bag-rewards-applied) now reopens the sheet on
 * tap (Remove stops propagation). Without it the sheet was unreachable
 * while an offer is applied, making the swap flow (scenario 3) and the
 * applied/preselected re-open (scenario 6) impossible — decision 3's
 * "applied offer stays IN the list, preselected" state had no entry point.
 *
 * Scenario 7 (cart-driven removal) — what the code actually does, asserted
 * honestly: removing the last PAID row leaves the committed freebie row
 * (cartQuantity counts get-items), so revalidation check 4
 * (qtyExclLoyaltyAndGetItems <= 0) fires first: the removal notice opens
 * and the freebie rows are swept. The now-empty cart then empty-exits the
 * bag; BagSheet snapshots the notice around emptyCart (which resets the
 * modal) and keeps rendering OfferRemovalNotice while open=false, so the
 * notice SURVIVES the exit and sits over the menu until GOT IT. Its "new
 * total" reads £0.00 there — the honest figure for an emptied bag.
 */

// ---- Offer ids (tests/e2e/fixtures/offers.json) ----
const OFFER_PERCENT = "offer-percent-25"; // 25% off, minBill 25, maxDiscount 10
const OFFER_FLAT = "offer-flat-2"; // £2 off, always eligible
const OFFER_FREE_SALAD = "offer-free-salad"; // getItemOnly, single "and" entry
const OFFER_FREE_SAUCE = "offer-free-sauce-choice"; // getItemOnly, two "or" entries

/** U+2212 MINUS SIGN — the literal character the bag renders, NOT a hyphen. */
const MINUS = "−";

/**
 * The shared boot mock (fixtures/backend.ts) with the one P7b divergence:
 * get_cx_valid_offers serves the offers fixture (a raw array) instead of [].
 */
const mockKioskBackend = (page: Page) => mockBackend(page, { offers: fixtureJson("offers.json") });

/** Menu card tap → PDP → commit plain (£8) → dismiss the added modal. */
const addCheeseBurgerViaPdp = (page: Page) =>
  addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });

/** Radio-pick an eligible offer row and commit via SAVE SELECTION. */
async function pickAndSave(page: Page, offerId: string) {
  await page.getByTestId(`offer-row-${offerId}`).click();
  await expect(page.getByTestId(`offer-row-${offerId}`)).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await page.getByTestId("rewards-save").click();
  await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
}

/**
 * Apply the OR-choice freebie offer end-to-end: sheet pick → SAVE returns
 * the needsPicker verdict → picker → Tortilla Sauce → CONFIRM → freebie
 * row lands and the offer takes the slot (shared by scenarios 6 and 7).
 */
async function applySauceOfferViaPicker(page: Page) {
  await openRewardsSheet(page);
  await pickAndSave(page, OFFER_FREE_SAUCE);
  await expect(page.getByTestId("freebie-picker")).toBeVisible();
  await page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`).click();
  await page.getByTestId("freebie-confirm").click();
  await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
  await expect(bagRows(page)).toHaveCount(2);
  await expect(page.getByTestId("bag-rewards-applied")).toContainText(
    "Free sauce of your choice"
  );
}

test.describe("P7b Offers (rewards sheet, apply/remove, freebies)", () => {
  test("SHEET STATES: £8 cart — flat-2 + both freebies eligible with radios; percent-25 locked with the exact pink nudge and no radio; suggested rail covers the £17 gap", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);

    // Unapplied Rewards entry row: title + the TOP-RANKED offer's name.
    // rankOffers puts the free-salad grant first — its £17.00 freebie
    // ceiling outranks flat-2's £2.00 realised saving.
    await expect(page.getByTestId("bag-rewards-entry")).toContainText(
      "Rewards & Offers"
    );
    await expect(page.getByTestId("bag-rewards-entry")).toContainText(
      "Free Greek Salad with your order"
    );

    await openRewardsSheet(page);
    await expect(page.getByTestId("rewards-sheet")).toContainText(
      "Select 1 reward to redeem with your order."
    );

    // Eligible rows carry radios (decision 2: radio + SAVE, not instant tap).
    await expect(page.getByTestId(`offer-radio-${OFFER_FLAT}`)).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${OFFER_FREE_SALAD}`)).toBeVisible();
    await expect(page.getByTestId(`offer-radio-${OFFER_FREE_SAUCE}`)).toBeVisible();

    // percent-25 is locked (minBill 25 vs £8 cart): no radio, pink nudge
    // with the exact £17 gap wording (decision 1; posistKiosk's amt()).
    await expect(page.getByTestId(`offer-radio-${OFFER_PERCENT}`)).toHaveCount(0);
    await expect(page.getByTestId(`offer-row-nudge-${OFFER_PERCENT}`)).toHaveText(
      "Add £17+ to your order to be eligible to redeem this reward"
    );

    // Suggested rail (decision 4): TOP locked offer has a minBill gap →
    // upsell-pool items priced at/above the £17 short — exactly the
    // plain-add Greek Salad (£17 ≥ £17; Large Fries needs customization).
    await expect(page.getByTestId("offer-suggested-rail")).toBeVisible();
    await expect(page.getByTestId("offer-suggested-rail")).toContainText(
      "Suggested £17+ Items"
    );
    await expect(
      page.getByTestId(`offer-suggested-item-${GREEK_SALAD}`)
    ).toBeVisible();
    await expect(page.locator('[data-testid^="offer-suggested-item-"]')).toHaveCount(
      1
    );

    // X = no change: sheet closes, nothing applied, no discount line.
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
  });

  test("APPLY FLAT: pick offer-flat-2 → SAVE — applied row −£2.00, Discounts −£2.00, ORDER & PAY £7.00 (VAT on the discounted base); menu cta keeps the £8.00 subtotal", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);

    await pickAndSave(page, OFFER_FLAT);

    // Applied Rewards row (Figma 1:3137): name + signed amount + Remove.
    await expect(page.getByTestId("bag-rewards-applied")).toBeVisible();
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      "£2 off your order"
    );
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      new RegExp(`${MINUS}£2(?![\\d.])`)
    );
    await expect(page.getByTestId("bag-rewards-remove")).toBeVisible();
    await expect(page.getByTestId("bag-rewards-entry")).toHaveCount(0);

    // Bill block: Sub Total £8.00 / Discounts −£2.00 / Total £7.00
    // (round(8 − 2 + 0.90) — see header).
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    // U4: VAT on the discounted £6 base, then what the whole-pound Total
    // added — the column adds up: 8.00 − 2.00 + 0.90 + 0.10 = 7.00.
    await expect(page.getByTestId("bag-taxes-charges")).toHaveText("+£0.90");
    await expect(page.getByTestId("bag-round-off")).toHaveText("+£0.10");
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");

    // CTA flips to ORDER & PAY at the discounted total (tb-display
    // uppercases visually; the DOM text is "Order & Pay").
    await expect(page.getByTestId("bag-pay")).toContainText("Order & Pay");
    await expect(page.getByTestId("bag-pay")).toContainText("£7.00");

    // The menu cta bar under the sheet shows the bag's own Total, the
    // reward and VAT in it (user decision 2026-10-14; it showed the
    // undiscounted subtotal) — bag.spec precedent: the covered bar's text.
    await expect(page.getByTestId("cta-total")).toHaveText(/: £7$/);
  });

  test("SWAP + LOCKED→ELIGIBLE: rail add to £25.00 unlocks percent-25 (radio, no nudge); SAVE swaps atomically — applied row/Discounts −£6.25, Total £22.00, flat-2 gone", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);
    await pickAndSave(page, OFFER_FLAT);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);

    // Raise the cart to exactly £25.00 — the bag's Complete-Your-Meal rail
    // one-taps the plain Greek Salad (bag.spec RAIL precedent). minBill 25
    // validates "<=" against the un-taxed subtotal, so £25.00 qualifies.
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).click();
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");

    // Reopen the sheet from the APPLIED row (the P7b wiring fix — see
    // header): flat-2 is preselected with its Applied chip, and percent-25
    // is now eligible: radio present, pink nudge gone.
    await page.getByTestId("bag-rewards-applied").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    // offers-parity D8: the radio is the row's overlay; its text is the body's.
    await expect(page.getByTestId(`offer-row-body-${OFFER_FLAT}`)).toContainText(
      "Applied"
    );
    await expect(page.getByTestId(`offer-row-${OFFER_FLAT}`)).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(page.getByTestId(`offer-radio-${OFFER_PERCENT}`)).toBeVisible();
    await expect(page.getByTestId(`offer-row-nudge-${OFFER_PERCENT}`)).toHaveCount(
      0
    );

    // Swap: percent-25 replaces flat-2 in ONE commit (swapCartOffer).
    await pickAndSave(page, OFFER_PERCENT);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      "25% off your order"
    );
    await expect(page.getByTestId("bag-rewards-applied")).not.toContainText(
      "£2 off your order"
    );
    // min(25% × £25.00, £10 cap) = £6.25 — the cap is not binding.
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      `${MINUS}£6.25`
    );
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£6.25`);
    // round(25 − 6.25 + 2.81) = £22.00 — prorated pre-tax discount, header.
    await expect(page.getByTestId("bag-total")).toContainText("£22.00");
    await expect(page.getByTestId("bag-pay")).toContainText("Order & Pay");
    await expect(page.getByTestId("bag-pay")).toContainText("£22.00");

    // P9f overlay-button pattern: the bell is part of the row's tap target
    // too — the overlay is LAST in the DOM, so it paints over the bell's
    // opacity layer (first in the DOM, the bell would swallow this tap).
    const applied = page.getByTestId("bag-rewards-applied");
    const rowBox = (await applied.boundingBox())!;
    const bellBox = (await applied.locator('span[aria-hidden="true"]').first().boundingBox())!;
    await applied.click({
      position: {
        x: bellBox.x - rowBox.x + bellBox.width / 2,
        y: bellBox.y - rowBox.y + bellBox.height / 2,
      },
    });
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
  });

  test("REMOVE: bag Remove clears the applied row and Discounts line, totals restore to £8/£9, CTA reverts to PAY — and NO removal notice (direct removal is silent)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);
    await pickAndSave(page, OFFER_FLAT);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");

    await page.getByTestId("bag-rewards-remove").click();

    // Remove must NOT bubble into the applied row's open-sheet tap.
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-pay")).not.toContainText("Order & Pay");
    await expect(page.getByTestId("bag-pay")).toContainText("£9.00");

    // The notice is for CART-DRIVEN removal only (fork parity).
    await expect(page.getByTestId("offer-removal-notice")).toHaveCount(0);
  });

  test("ATOMIC FREEBIE: offer-free-salad lands the Greek Salad row directly (no picker) — Free chip, £0.00 with struck £17.00, no stepper, Discounts −£17.00; Remove sweeps it", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);

    // Single-"and" grant is directly applicable — NO picker opens.
    await pickAndSave(page, OFFER_FREE_SALAD);
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);

    // The freebie is a REAL cart row: Free chip, discounted £0.00 with the
    // undiscounted £17.00 struck, and no stepper/edit (not a paid row).
    await expect(bagRows(page)).toHaveCount(2);
    const saladRow = bagRows(page).filter({ hasText: "Greek Salad" });
    await expect(saladRow).toHaveCount(1);
    await expect(saladRow.locator('[data-testid^="bag-free-chip-"]')).toHaveText(
      "Free"
    );
    await expect(saladRow).toContainText("£0.00");
    await expect(saladRow).toContainText("£17.00");
    await expect(saladRow.locator('[data-testid^="bag-dec-"]')).toHaveCount(0);
    await expect(saladRow.locator('[data-testid^="bag-inc-"]')).toHaveCount(0);
    await expect(saladRow.locator('[data-testid^="bag-edit-"]')).toHaveCount(0);

    // Bill: the freebie counts £17.00 into Sub Total and comes back whole
    // on the Discounts line; VAT only on the £8 burger → Total £9.00.
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      "Free Greek Salad with your order"
    );
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      new RegExp(`${MINUS}£17(?![\\d.])`)
    );

    // Remove the offer → the freebie row disappears with it, totals restore.
    await page.getByTestId("bag-rewards-remove").click();
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).filter({ hasText: "Greek Salad" })).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });

  test("PICKER FREEBIE: offer-free-sauce-choice opens the 2-option picker; CONFIRM is inert before a pick; picked sauce lands free and the sheet reopens applied/preselected", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);

    // SAVE on the "or" freebie returns the needsPicker verdict: the sheet
    // closes and the picker opens with BOTH plain options; nothing is
    // applied yet (no discount line under the picker).
    await pickAndSave(page, OFFER_FREE_SAUCE);
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`)).toBeVisible();
    await expect(
      page.getByTestId(`freebie-option-${CAESAR_DRESSING}`)
    ).toBeVisible();
    await expect(page.locator('[data-testid^="freebie-option-"]')).toHaveCount(2);
    // Each plain option prices what CONFIRM will charge: £0, the menu price
    // struck (the offer → menu conversion, audit-fixes C1a) — posistKiosk's
    // OfferItem format (moduloCalcaledValue): the struck £2, then £0.
    const tortilla = page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`);
    await expect(tortilla).toContainText(/£2£0$/);

    // An "or" choice needs a selection — CONFIRM without one is inert
    // (aria-disabled; Playwright rightly refuses to click it, which is
    // itself the guarantee that a customer tap goes nowhere).
    await expect(page.getByTestId("freebie-confirm")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await expect(page.getByTestId("freebie-picker")).toBeVisible();

    // Pick Tortilla Sauce → CONFIRM → row lands + offer takes the slot.
    await page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`).click();
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);

    await expect(bagRows(page)).toHaveCount(2);
    const sauceRow = bagRows(page).filter({ hasText: "Tortilla Sauce" });
    await expect(sauceRow).toHaveCount(1);
    await expect(sauceRow.locator('[data-testid^="bag-free-chip-"]')).toHaveText(
      "Free"
    );
    await expect(sauceRow).toContainText("£0.00");
    await expect(sauceRow).toContainText("£2.00");
    await expect(sauceRow.locator('[data-testid^="bag-dec-"]')).toHaveCount(0);

    // Bill: subtotal £10.00 (burger 8 + sauce 2), Discounts −£2.00, VAT
    // only on the burger → Total £9.00 (round(10 − 2 + 1.20)).
    await expect(page.getByTestId("bag-subtotal")).toContainText("£10.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      "Free sauce of your choice"
    );

    // Reopen from the applied row: the offer shows its Applied chip and is
    // the preselected radio (decision 3). X closes with no change.
    await page.getByTestId("bag-rewards-applied").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    // offers-parity D8: the radio is the row's overlay; its text is the body's.
    await expect(page.getByTestId(`offer-row-body-${OFFER_FREE_SAUCE}`)).toContainText(
      "Applied"
    );
    await expect(page.getByTestId(`offer-row-${OFFER_FREE_SAUCE}`)).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      "Free sauce of your choice"
    );
  });

  test("OUT-OF-STOCK CHOICE AT MENU LOAD (audit-fixes C1a): Tortilla Sauce is out when the menu loads — the 'or' sauce grant still applies, its picker offering Caesar alone", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    // Newest route wins: the menu loads with the sauce out.
    await page.route("**/api/cx/kiosk/get_out_of_stock", (route) =>
      route.fulfill({
        json: [
          { item_id: TORTILLA_SAUCE, type: "item", partners: { partner_name: "Kiosk", inStock: false } },
        ],
      })
    );
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);

    // An "or" grant needs ONE resolvable entry: the sold-out sauce is not on
    // offer, the other one is.
    await pickAndSave(page, OFFER_FREE_SAUCE);
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`)).toHaveCount(0);
    await expect(page.locator('[data-testid^="freebie-option-"]')).toHaveCount(1);
    await page.getByTestId(`freebie-option-${CAESAR_DRESSING}`).click();
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);

    await expect(bagRows(page)).toHaveCount(2);
    const caesarRow = bagRows(page).filter({ hasText: "Caesar Dressing" });
    await expect(caesarRow.locator('[data-testid^="bag-free-chip-"]')).toHaveText("Free");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });

  test("CART-DRIVEN REMOVAL: removing the last paid row auto-removes the freebie offer — notice survives the bag's empty-exit onto /menu, GOT IT clears it", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await applySauceOfferViaPicker(page);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);

    // Remove the ONLY paid row (burger, qty 1 → confirm modal). The freebie
    // row itself has no stepper, so this is the only removable row.
    const burgerRow = bagRows(page).filter({ hasText: "Cheese Burger" });
    const burgerTestId = await burgerRow.getAttribute("data-testid");
    const burgerItemId = (burgerTestId ?? "").replace("bag-row-", "");
    await page.getByTestId(`bag-dec-${burgerItemId}`).click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();
    await page.getByTestId("remove-item-confirm").click();

    // Cascade (header "Scenario 7"): revalidation check 4 fires (no paid
    // rows left) → notice opens + freebie swept → the emptied bag exits to
    // /menu WITH the notice preserved (snapshot/restore around emptyCart).
    await expect(page.getByTestId("offer-removal-notice")).toBeVisible();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("offer-removal-notice")).toContainText(
      "Reward Removed"
    );
    await expect(page.getByTestId("offer-removal-notice")).toContainText(
      "Free sauce of your choice"
    );
    // The honest post-exit figure: the bag is empty (see header).
    await expect(page.getByTestId("offer-removal-notice")).toContainText(
      /Your total is now £0(?![\d.])/
    );
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");

    // GOT IT is the only way out — then the menu is clean: no offer, no
    // discount, empty cart.
    await page.getByTestId("offer-removal-gotit").click();
    await expect(page.getByTestId("offer-removal-notice")).toHaveCount(0);
    await expect(page.getByTestId("cta-total")).toHaveText(/: £0$/);
  });

  test("PAY DROPS AN OUT-OF-STOCK FREEBIE (audit-fixes A1): the free salad sold out after it was granted — PAY removes the offer with the removal notice and sweeps its row, no stock error, still /cart; the next PAY goes on with the paid row", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);
    await pickAndSave(page, OFFER_FREE_SALAD);
    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£17.00`);

    // From here the salad is out (newest route wins; the engine counts only
    // the "Kiosk" partner's inStock: false).
    await page.route("**/api/cx/kiosk/get_out_of_stock", (route) =>
      route.fulfill({
        json: [
          { item_id: GREEK_SALAD, type: "item", partners: { partner_name: "Kiosk", inStock: false } },
        ],
      })
    );
    await page.getByTestId("bag-pay").click();

    // Only the freebie is out, and a guest cannot fix a freebie: the offer
    // goes (out loud — no paid row needs the guest), never a stock error.
    const notice = page.getByTestId("offer-removal-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Free Greek Salad with your order");
    await expect(notice).toContainText(/Your total is now £9(?![\d.])/);
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await page.getByTestId("offer-removal-gotit").click();
    await expect(notice).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).filter({ hasText: "Greek Salad" })).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");

    // The next PAY checks the paid row alone and goes on.
    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    await expect(page.getByTestId("global-error")).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ *
 * Lane offers-parity: category freebies in the picker (E-C6), the rows'
 * descriptions with Show more / Show less (E-D1, Figma 1:4034 / 1:4069),
 * offers that can never unlock hidden and a sold-out buy side struck
 * (E-F1), and the a11y probes on the new surfaces (E-A1). Ids: the slim
 * menu's sub-categories (items carry subCategoryId null; the converter
 * stamps it).
 * ------------------------------------------------------------------ */
const SAUCES_SUB = "5dd1092fbec752021df55e1c"; // Tortilla £2, Caesar £2, BBQ Sauce. £1 (PDP)
const offersFixture = fixtureJson("offers.json");
const itemOffer = (over: Record<string, unknown>) => ({ ...clone(offersFixture[2]), ...over });
const applicable = (rawItems: unknown[], over: Record<string, unknown> = {}) => ({
  on: "complete",
  categories: [],
  items: [],
  isExclude: false,
  isInclude: false,
  rawItems,
  ...over,
});
const getEntry = (_id: string, baseItemId: string, name: string, relation: "and" | "or") => ({
  _id,
  baseItemId,
  name,
  relation,
  discountType: "percent",
  value: 100,
  quantity: 1,
});

/** "only get item"-shaped: a category-only freebie (was: an empty picker). */
const ANY_SAUCE = itemOffer({
  _id: "offer-any-sauce",
  name: "Any sauce on us",
  getItems: {
    items: [],
    categories: [{ _id: SAUCES_SUB, name: "Sauces", quantity: 1, relation: "and", value: 100, discountType: "percent" }],
  },
});
/** Buy 2 Tortilla Sauce → a Caesar free: locked under a burger, its sentence described. */
const DESC_BOGO = itemOffer({
  _id: "offer-desc-bogo",
  name: "Two sauces, a Caesar on us",
  getItemOnly: false,
  applicable: applicable([{ item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" }, quantity: 2, relation: "and" }]),
  getItems: { items: [getEntry("gi-desc-caesar", CAESAR_DRESSING, "Caesar Dressing", "and")], categories: [] },
});
/** 10 % off everything except Sauces (item criteria, exclude). */
const EXCEPT_SAUCES = {
  ...clone(offersFixture[0]),
  _id: "offer-except-sauces",
  name: "10% off, sauces excluded",
  type: { name: "percent", value: 10 },
  minBillAmount: null,
  maxDiscount: null,
  applicable: applicable(
    [{ category: { _id: SAUCES_SUB, categoryName: "Sauces" }, quantity: null, relation: "and" }],
    { on: "itemCriteria", isExclude: true, categories: [SAUCES_SUB] }
  ),
};
/** A free pick of six: a sentence long enough to clamp at 2 lines. */
const LONG_PICK = itemOffer({
  _id: "offer-long-pick",
  name: "Pick any one, free",
  getItems: {
    items: [
      getEntry("gi-long-1", TORTILLA_SAUCE, "Tortilla Sauce", "or"),
      getEntry("gi-long-2", CAESAR_DRESSING, "Caesar Dressing", "or"),
      getEntry("gi-long-3", GREEK_SALAD, "Greek Salad", "or"),
      getEntry("gi-long-4", LARGE_FRIES, "Large Fries", "or"),
      getEntry("gi-long-5", CHEESE_BURGER, "Cheese Burger", "or"),
      getEntry("gi-long-6", "5dd1093a188e72ce1b3eb359", "Kiddie Meal Nuggets", "or"),
    ],
    categories: [],
  },
});
/** 10 % off two sauces only (item criteria, include): a two-name scope list. */
const SCOPED_SAUCES = {
  ...clone(offersFixture[0]),
  _id: "offer-scoped-sauces",
  name: "10% off two sauces",
  type: { name: "percent", value: 10 },
  minBillAmount: null,
  maxDiscount: null,
  applicable: applicable(
    [
      { item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" }, quantity: null, relation: "or" },
      { item: { baseItemId: CAESAR_DRESSING, name: "Caesar Dressing" }, quantity: null, relation: "or" },
    ],
    { on: "itemCriteria", isInclude: true, items: [TORTILLA_SAUCE, CAESAR_DRESSING] }
  ),
};
/** An "and" buy side with an item the slim menu does not sell: can never unlock. */
const NEVER = itemOffer({
  _id: "offer-never",
  name: "Buy a ghost and a sauce",
  getItemOnly: false,
  applicable: applicable([
    { item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" }, quantity: 1, relation: "and" },
    { item: { baseItemId: "e2e-not-on-menu", name: "Ghost Item" }, quantity: 1, relation: "and" },
  ]),
  getItems: { items: [getEntry("gi-never-salad", GREEK_SALAD, "Greek Salad", "and")], categories: [] },
});
/** Its only buy item (Caesar) is sold out: a gone row until stock returns. */
const SOLD_OUT_BUY = itemOffer({
  _id: "offer-sold-out-buy",
  name: "Buy a Caesar, get a salad",
  getItemOnly: false,
  applicable: applicable([{ item: { baseItemId: CAESAR_DRESSING, name: "Caesar Dressing" }, quantity: 1, relation: "and" }]),
  getItems: { items: [getEntry("gi-sold-salad", GREEK_SALAD, "Greek Salad", "and")], categories: [] },
});
const CAESAR_OUT = [{ item_id: CAESAR_DRESSING, type: "item", partners: { partner_name: "Kiosk", inStock: false } }];

const stripIsolates = (s: string | null) => (s ?? "").replace(/[\u2066-\u2069]/g, "").trim();

/**
 * Review 2 (bidi): the runs of a description in the order an Arabic reader
 * meets them — line by line, right edge first — beside their logical order.
 * A run is the text between bidi controls (a Latin name is one run).
 */
const rtlReadingOrder = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    const runs: { text: string; right: number; mid: number }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = (node as Text).data;
      for (const match of data.matchAll(/[^\u2066-\u2069]+/g)) {
        const text = match[0].trim();
        if (!text) continue;
        const start = (match.index ?? 0) + match[0].indexOf(text);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + text.length);
        const rect = range.getClientRects()[0];
        if (rect) runs.push({ text, right: rect.right, mid: (rect.top + rect.bottom) / 2 });
      }
    }
    const lines: (typeof runs)[] = [];
    for (const run of [...runs].sort((a, b) => a.mid - b.mid)) {
      const line = lines.find((l) => Math.abs(l[0].mid - run.mid) < 10);
      if (line) line.push(run);
      else lines.push([run]);
    }
    return {
      logical: runs.map((run) => run.text),
      read: lines.flatMap((line) => [...line].sort((a, b) => b.right - a.right).map((run) => run.text)),
    };
  });

/** Arabic session on the registered device: splash → /second → AR → /menu. */
async function bootArabicToMenu(page: Page) {
  await registerToStart(page);
  await startToSecond(page);
  await chooseLanguage(page, "ar");
  await pickPipelineToMenu(page);
}

test.describe("Lane offers-parity — category freebies, descriptions, availability", () => {
  test("E-C6 a category-only freebie: SAVE → the picker lists Sauces → Tortilla → CONFIRM → −£2.00, Total £9.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [ANY_SAUCE]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);
    await pickAndSave(page, ANY_SAUCE._id);
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(page.getByTestId(`freebie-cat-${SAUCES_SUB}`)).toContainText("Any 1 from Sauces");
    await page.getByTestId(`freebie-cat-option-${SAUCES_SUB}-${TORTILLA_SAUCE}`).click();
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);

    await expect(bagRows(page)).toHaveCount(2);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(ANY_SAUCE.name);
  });

  test("E-D1 descriptions: the BOGO sentence, a scoped line, the bill-wise line under 'Save £X'; a long one clamps → Show more / Show less, a short one has no toggle, the toggle never picks", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [DESC_BOGO, EXCEPT_SAUCES, offersFixture[1], LONG_PICK]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);

    await expect(page.getByTestId(`offer-row-desc-${DESC_BOGO._id}`)).toHaveText(
      "Buy 2 Tortilla Sauce & get 1 Caesar Dressing for free"
    );
    await expect(page.getByTestId(`offer-row-desc-${EXCEPT_SAUCES._id}`)).toHaveText("10% off everything except Sauces");
    await expect(page.getByTestId("offer-row-body-offer-flat-2")).toContainText(/Save £2(?![\d.])/);
    await expect(page.getByTestId("offer-row-desc-offer-flat-2")).toHaveText("£2 off your order");
    await expect(page.getByTestId("offer-row-more-offer-flat-2")).toHaveCount(0);

    const desc = page.getByTestId(`offer-row-desc-${LONG_PICK._id}`);
    const more = page.getByTestId(`offer-row-more-${LONG_PICK._id}`);
    const radio = page.getByTestId(`offer-row-${LONG_PICK._id}`);
    await more.scrollIntoViewIfNeeded();
    await expect(desc).toHaveText(
      "Get 1 Tortilla Sauce for free or 1 Caesar Dressing for free or 1 Greek Salad for free or 1 Large Fries for free or 1 Cheese Burger for free or 1 Kiddie Meal Nuggets for free"
    );
    await expect(more).toHaveText("Show more");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    const collapsed = (await desc.boundingBox())?.height ?? 0;
    await more.click();
    await expect(more).toHaveText("Show less");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await desc.boundingBox())?.height ?? 0).toBeGreaterThan(collapsed);
    await expect(radio).toHaveAttribute("aria-checked", "false");
    await more.click();
    await expect(more).toHaveText("Show more");
    await expect(radio).toHaveAttribute("aria-checked", "false");
    // A tap elsewhere on the row still picks it.
    await radio.click();
    await expect(radio).toHaveAttribute("aria-checked", "true");
  });

  test("E-D1 AR: the description is the Arabic template with the menu's Arabic names, and it READS in that order (right to left)", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { offers: [DESC_BOGO, SCOPED_SAUCES], arabic: true });
    await bootArabicToMenu(page);
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await openBag(page);
    await openRewardsSheet(page);
    const desc = page.getByTestId(`offer-row-desc-${DESC_BOGO._id}`);
    await expect.poll(async () => stripIsolates(await desc.textContent())).toBe(
      "اشترِ 2 صوص التورتلا واحصل على 1 تتبيلة السيزر مجانًا"
    );
    // Review 2 (bidi): "2" before its name, "مجانًا" after the Caesar — not
    // "صوص التورتلا 2 … مجانًا تتبيلة السيزر 1".
    const bogo = await rtlReadingOrder(page, `offer-row-desc-${DESC_BOGO._id}`);
    expect(bogo.logical).toEqual(["اشترِ", "2", "صوص التورتلا", "واحصل على", "1", "تتبيلة السيزر", "مجانًا"]);
    expect(bogo.read).toEqual(bogo.logical);
    // A two-name scope list reads first name first (locked: the burger is no sauce).
    const scopeId = `offer-row-desc-${SCOPED_SAUCES._id}`;
    await page.getByTestId(scopeId).scrollIntoViewIfNeeded();
    await expect.poll(async () => stripIsolates(await page.getByTestId(scopeId).textContent())).toBe(
      "خصم 10٪ على صوص التورتلا، تتبيلة السيزر"
    );
    const scope = await rtlReadingOrder(page, scopeId);
    expect(scope.read).toEqual(scope.logical);
  });

  test("E-F1 an 'and' buy side the menu cannot sell is not listed; a sold-out buy side is a struck 'Not available right now' row with no description", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { offers: [NEVER, SOLD_OUT_BUY, offersFixture[1]], outOfStock: CAESAR_OUT });
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await openRewardsSheet(page);

    await expect(page.getByTestId("offer-row-body-offer-flat-2")).toBeVisible();
    await expect(page.getByTestId(`offer-row-${NEVER._id}`)).toHaveCount(0);
    await expect(page.getByTestId(`offer-row-body-${NEVER._id}`)).toHaveCount(0);
    const gone = page.getByTestId(`offer-row-${SOLD_OUT_BUY._id}`);
    await expect(gone).toContainText("Not available right now");
    await expect(gone).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId(`offer-row-desc-${SOLD_OUT_BUY._id}`)).toHaveCount(0);
    await expect(page.getByTestId(`offer-row-add-items-${SOLD_OUT_BUY._id}`)).toHaveCount(0);
  });

  test.describe("E-A1 a11y on the new surfaces", () => {
    test.describe.configure({ timeout: 120_000 });

    const expectClean = async (page: Page, label: string) => {
      await settle(page);
      expect(await axeSweep(page, label), `${label}: axe`).toEqual([]);
      await expect.poll(() => targetProblems(page), { message: `${label}: touch targets` }).toEqual([]);
    };

    const expandLong = async (page: Page) => {
      const more = page.getByTestId(`offer-row-more-${LONG_PICK._id}`);
      await more.scrollIntoViewIfNeeded();
      await more.click();
      await expect(more).toHaveAttribute("aria-expanded", "true");
    };

    test("EN: the rewards sheet with an expanded row, and the picker's category section", async ({ page }) => {
      await mockKioskBackend(page);
      await routeOffers(page, [LONG_PICK, DESC_BOGO, EXCEPT_SAUCES, ANY_SAUCE]);
      await bootRegisteredToMenu(page);
      await addCheeseBurgerViaPdp(page);
      await openBag(page);
      await openRewardsSheet(page);
      await expandLong(page);
      await expectClean(page, "e-a1-rewards-expanded-en");

      await pickAndSave(page, ANY_SAUCE._id);
      await expect(page.getByTestId(`freebie-cat-${SAUCES_SUB}`)).toBeVisible();
      await page.getByTestId(`freebie-cat-option-${SAUCES_SUB}-${TORTILLA_SAUCE}`).click();
      await expectClean(page, "e-a1-picker-category-en");
    });

    test("AR: the rewards sheet with an expanded row and the picker — no English left, every Arabic run isolated", async ({
      page,
    }) => {
      // The pipeline's Arabic name is server data (menu-arabic.spec): the bag's toggle names it.
      await mockBackend(page, {
        offers: [LONG_PICK, DESC_BOGO, EXCEPT_SAUCES, ANY_SAUCE],
        arabic: true,
        pipelines: [{ ...DINE_IN, secondary_name: "تناول في المطعم" }],
      });
      await bootArabicToMenu(page);
      await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
      await openBag(page);
      await openRewardsSheet(page);
      await expandLong(page);
      await expectClean(page, "e-a1-rewards-expanded-ar");
      expect(await untranslatedCopy(page, englishCopy())).toEqual([]);
      expect(await arabicNotIsolated(page)).toEqual([]);

      await pickAndSave(page, ANY_SAUCE._id);
      await expect(page.getByTestId(`freebie-cat-${SAUCES_SUB}`)).toBeVisible();
      await expectClean(page, "e-a1-picker-category-ar");
      expect(await untranslatedCopy(page, englishCopy())).toEqual([]);
      expect(await arabicNotIsolated(page)).toEqual([]);
    });

    test("ADA reach zone: the rewards sheet with an expanded row", async ({ page }) => {
      await mockKioskBackend(page);
      await routeOffers(page, [LONG_PICK, DESC_BOGO, EXCEPT_SAUCES]);
      await bootRegisteredToMenu(page);
      await page.getByTestId("footer-ada").click();
      await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
      await addCheeseBurgerViaPdp(page);
      await openBag(page);
      await openRewardsSheet(page);
      await expandLong(page);
      await expectClean(page, "e-a1-rewards-expanded-ada");
    });
  });
});

/* ------------------------------------------------------------------ *
 * Review 2026-10-14 — the menu TOTAL is the bag's Total as the bag will
 * open: its least-value lock and its revalidation only run while it is
 * open, so the TOTAL prices the cart they will leave (settleCart). The
 * walk's own case: a least-value reward, the bag closed, the menu changed.
 * ------------------------------------------------------------------ */
/** Least-value: any 2 of Cheese Burger (£8) / Tortilla Sauce (£2), the cheapest one free. */
const LEAST_BURGER_SAUCE = itemOffer({
  _id: "offer-least-burger-sauce",
  name: "Any 2, the cheapest free",
  getItemOnly: false,
  getLeastValueItem: true,
  leastItemValueCount: { buyQuantity: 2, getQuantity: 1 },
  applicable: applicable([
    { item: { baseItemId: CHEESE_BURGER, name: "Cheese Burger" } },
    { item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" } },
  ]),
  getItems: { items: [], categories: [] },
});

/** The menu's repeat sheet (a tap on the in-bag burger): its row's + or −, then closed. */
async function repeatBurger(page: Page, step: "inc" | "dec") {
  const card = page.getByTestId(`item-${CHEESE_BURGER}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("repeat-sheet")).toBeVisible();
  const row = page.locator('[data-testid^="repeat-row-"]').first();
  const itemId = ((await row.getAttribute("data-testid")) ?? "").replace("repeat-row-", "");
  await page.getByTestId(`repeat-${step}-${itemId}`).click();
  await page.getByTestId("repeat-sheet-close").click();
  await expect(page.getByTestId("repeat-sheet")).toHaveCount(0);
}

/** Two burgers, the reward applied from the sheet (one £8 burger free: £9), the bag closed. */
async function twoBurgersOneFree(page: Page) {
  await mockKioskBackend(page);
  await routeOffers(page, [LEAST_BURGER_SAUCE]);
  await bootRegisteredToMenu(page);
  await addCheeseBurgerViaPdp(page);
  await repeatBurger(page, "inc");
  await openBag(page);
  await openRewardsSheet(page);
  await pickAndSave(page, LEAST_BURGER_SAUCE._id);
  await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£8.00`);
  await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  await page.getByTestId("bag-close").click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect(page.getByTestId("cta-total")).toHaveText(/: £9$/);
}

test.describe("Review 2026-10-14 — the menu TOTAL is the bag's Total as the bag will open", () => {
  test("least-value: a £2 sauce added on the menu takes the free unit in the TOTAL at once — the figure the bag then shows", async ({
    page,
  }) => {
    test.slow();
    await twoBurgersOneFree(page);

    // The bag is closed: only the TOTAL can move the free unit to the sauce
    // (the stale lock kept a burger free: £12).
    await addOneTap(page, TORTILLA_SAUCE, "(3)");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £18$/);
    await openBag(page);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£18.00");
  });

  test("least-value: a menu-side − below the buy quantity never reads £0 — the TOTAL leaves out the reward the bag drops", async ({
    page,
  }) => {
    test.slow();
    await twoBurgersOneFree(page);

    // One burger left: the reward no longer applies — £8 + VAT, never the
    // stale lock's free burger (£0).
    await repeatBurger(page, "dec");
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toHaveText(/: £9$/);
    await openBag(page);
    const notice = page.getByTestId("offer-removal-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/Your total is now £9(?![\d.])/);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });
});
