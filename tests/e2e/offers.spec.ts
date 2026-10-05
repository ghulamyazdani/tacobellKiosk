import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * P7b — Offers vertical: the REWARDS sheet (radio + SAVE SELECTION), the
 * apply/swap/remove core, freebie offers (atomic "and" grant + "or" picker),
 * the bag's Rewards section / Discounts line / ORDER & PAY CTA, and the
 * cart-driven removal notice. Same registered-device mocked-backend pattern
 * as bag.spec.ts — mockKioskBackend/bootRegisteredToMenu are copied from
 * there (established precedent: that file does not export them), with the
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

const LOGIN_OK = {
  licenseDetails: {
    login_code: "mock-device-token",
    expiry_date: "2099-01-01T00:00:00.000Z",
  },
  deploymentDetails: {
    _id: "dep1",
    brand_id: "brand1",
    tenant_id: "tenant1",
    cluster_id: "cluster1",
  },
};

const slimMenu = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)),
    "utf-8"
  )
);

const offersFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/offers.json", import.meta.url)),
    "utf-8"
  )
);

// ---- Fixture ids ----
const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8, 3 addon groups (PDP path)
const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // £17, plain (rail one-tap)
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b"; // £2, plain (picker option)
const CAESAR_DRESSING = "5dd109392b29ee1f2a82a49c"; // £2, plain (picker option)

// ---- Offer ids (tests/e2e/fixtures/offers.json) ----
const OFFER_PERCENT = "offer-percent-25"; // 25% off, minBill 25, maxDiscount 10
const OFFER_FLAT = "offer-flat-2"; // £2 off, always eligible
const OFFER_FREE_SALAD = "offer-free-salad"; // getItemOnly, single "and" entry
const OFFER_FREE_SAUCE = "offer-free-sauce-choice"; // getItemOnly, two "or" entries

/** U+2212 MINUS SIGN — the literal character the bag renders, NOT a hyphen. */
const MINUS = "−";

/**
 * Boot + menu mocks (copied from bag.spec.ts, which copied them from
 * pack.spec.ts — the established precedent). One deliberate change: the
 * get_cx_valid_offers route serves the P7b offers fixture instead of [].
 * Order matters: Playwright matches routes newest-first, so the catch-all
 * is registered FIRST and every specific mock after it.
 */
async function mockKioskBackend(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: {},
      },
    })
  );
  await page.route("**/api/cx/getCxSkinData", (r) =>
    r.fulfill({ json: { skin_id: "skin_1" } })
  );
  await page.route("**/api/cx/kiosk/get_theme", (r) =>
    r.fulfill({
      json: {
        theme_color: [
          { key: "button_text_border_icon", color_hex: "#501098" },
          { key: "button_background", color_hex: "#ffffff" },
        ],
        primary_color_shades: [],
      },
    })
  );
  await page.route("**/api/cx/get_kiosk_settings", (r) =>
    r.fulfill({
      json: {
        start_order_text_primary: "START ORDER",
        ideal_time: "180",
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [
        { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" },
      ],
    })
  );
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  // THE P7b divergence from bag.spec.ts: real offers, served as a raw array.
  await page.route("**/api/cx/get_cx_valid_offers", (r) =>
    r.fulfill({ json: offersFixture })
  );
  await page.route("**/api/cx/kiosk/get_data", (r) =>
    r.fulfill({
      json: {
        charges: [],
        deployment: { countryCode: "GB", currencySettings: { symbol: "£" } },
      },
    })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
}

/** Register on the on-screen keyboard and land on /menu (copied from bag.spec.ts). */
async function bootRegisteredToMenu(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

/** Menu card tap → PDP → commit plain (£8) → dismiss the added modal. */
async function addCheeseBurgerViaPdp(page: Page) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("product-added-modal")).toBeVisible();
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).not.toBeVisible();
}

/** VIEW MY BAG → /cart renders the Menu page with the bag sheet open. */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

const bagRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');

/** Rewards entry row (unapplied state) → the REWARDS sheet. */
async function openRewardsSheet(page: Page) {
  await page.getByTestId("bag-rewards-entry").click();
  await expect(page.getByTestId("rewards-sheet")).toBeVisible();
}

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
  test("SHEET STATES: £8 cart — flat-2 + both freebies eligible with radios; percent-25 locked with the exact pink nudge and no radio; suggested rail covers the £17.00 gap", async ({
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
    // with the exact £17.00 gap wording (decision 1).
    await expect(page.getByTestId(`offer-radio-${OFFER_PERCENT}`)).toHaveCount(0);
    await expect(page.getByTestId(`offer-row-nudge-${OFFER_PERCENT}`)).toHaveText(
      "Add £17.00+ to your order to be eligible to redeem this reward"
    );

    // Suggested rail (decision 4): TOP locked offer has a minBill gap →
    // upsell-pool items priced at/above the £17.00 short — exactly the
    // plain-add Greek Salad (£17 ≥ £17; Large Fries needs customization).
    await expect(page.getByTestId("offer-suggested-rail")).toBeVisible();
    await expect(page.getByTestId("offer-suggested-rail")).toContainText(
      "Suggested £17.00+ Items"
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
      `${MINUS}£2.00`
    );
    await expect(page.getByTestId("bag-rewards-remove")).toBeVisible();
    await expect(page.getByTestId("bag-rewards-entry")).toHaveCount(0);

    // Bill block: Sub Total £8.00 / Discounts −£2.00 / Total £7.00
    // (round(8 − 2 + 0.90) — see header).
    await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");

    // CTA flips to ORDER & PAY at the discounted total (tb-display
    // uppercases visually; the DOM text is "Order & Pay").
    await expect(page.getByTestId("bag-pay")).toContainText("Order & Pay");
    await expect(page.getByTestId("bag-pay")).toContainText("£7.00");

    // The menu cta bar under the sheet still shows the UNdiscounted
    // subtotal (bag.spec precedent: toContainText reads the covered bar).
    await expect(page.getByTestId("cta-total")).toContainText("£8.00");
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
    await expect(page.getByTestId(`offer-row-${OFFER_FLAT}`)).toContainText(
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
      `${MINUS}£17.00`
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
    await expect(page.getByTestId(`offer-row-${OFFER_FREE_SAUCE}`)).toContainText(
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
      "Your total is now £0.00"
    );
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");

    // GOT IT is the only way out — then the menu is clean: no offer, no
    // discount, empty cart.
    await page.getByTestId("offer-removal-gotit").click();
    await expect(page.getByTestId("offer-removal-notice")).toHaveCount(0);
    await expect(page.getByTestId("cta-total")).toContainText("£0.00");
  });
});
