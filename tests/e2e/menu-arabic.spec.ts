import { test, expect, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  holdRequests as parkRequests,
  locale,
  SIDE_ORDERS,
  CHEESE_BURGER,
  DREAM_BOX,
  EXTRA_PICKLES,
  GREEK_SALAD,
} from "./fixtures/backend";
import { mockCheckoutBackend } from "./fixtures/checkout";
import {
  submitLicence as submitRegistration,
  registerToStart,
  startToSecond,
  pickPipelineToMenu,
} from "./pages/boot";
import { openBag } from "./pages/order";
import { glyphX } from "./fixtures/glyphs";

/**
 * Post-P9 lane menu-data: the guest's language drives every NAME and the
 * operator copy, end to end, and nothing of it reaches the order.
 *
 * - L0: the language sheet stores the slot `type` with the language. No test
 *   reads it directly; it shows in every SLOT read below (pipeline name,
 *   ticker, MIAM headline). Without it those would stay in the primary slot
 *   even for an Arabic guest; picking English again must go back to it.
 * - 28: menu and pipeline names are resolved AT RENDER (useLocalized). The
 *   rail, the H2, the cards, the PDP title, description, groups and options,
 *   a pack's slot card and SELECT sheet, the MIAM combo, the bag rows and the
 *   bag rail read the menu's `ar` aliases. The pipeline card reads
 *   `secondary_name`.
 * - 27b (D5): the /second ticker shows kiosk_settings.pipeline_text_<slot>
 *   when it is set; otherwise "It's lunch time!" stays. A long line keeps the
 *   design's speed (the cycle scales with its length).
 * - 29c (D8): the MIAM headline is the operator's make_it_meal_<slot> text;
 *   with no text for the guest's slot it is the Figma title (miam.title).
 *   Neither line ever falls back to the other language's operator copy, and
 *   the texts are staged with the boot (P9e: nothing before it commits).
 * - Rule 3: the order push stays in the primary language. A render result
 *   must never be written into cart or order state (a menu-card PDP add and
 *   a bag-rail add are both pushed).
 * - P9f bidi: in RTL, names and operator copy are FSI…PDI isolates. Checked
 *   by RENDERED glyph order (idle.spec.ts tickerGlyphX): a trailing "!" sits
 *   at the Arabic run's left end, and a bag line's "+£" price stays right of
 *   its Arabic name (unisolated, UBA W2/N1 pull it to the left).
 *
 * ── MATCHING ARABIC ─────────────────────────────────────────────────────
 * In an RTL session names are FSI…PDI isolates, and the menu data has double
 * spaces ("بطاطس حجم  كبير"), so every name check is a toContainText. Never
 * use an exact match on Arabic (P9f bidi.test.ts scans for that).
 *
 * ── THE PUSH AND THE PIPELINE ROW ───────────────────────────────────────
 * The push echoes the selected pipeline as the server sent it
 * (`extras.pipeline`, SecondLayout's setSelectedPipeline, fork parity), so its
 * `secondary_name` is server data, not a render result. It is pinned to the
 * mocked row; the regex runs over everything else.
 *
 * ── MOCKS ───────────────────────────────────────────────────────────────
 * The harness house order: the shared mock (fixtures/backend.ts) first, then
 * the checkout fixture, then this spec's own routes. Newest wins. The checkout
 * fixture routes getPipelines only when given a `tabType` (never here), so the
 * shared mock's Arabic row stands; mockPipelines answers the same row again
 * after it. The print agent and the Xeno revoke are other
 * origins: only their fixtures answer them (the harness denies an unrouted
 * call). Boot steps are the shared page functions (pages/*).
 */

const en = locale("en");
const ar = locale("ar");

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json; the shared ids come from fixtures/backend.ts) ----
// CHEESE_BURGER: modifier groups, upsellItems = [Dream box 1,] — MIAM first when combo upsell is on.
// EXTRA_PICKLES: +£1, in EXTRA_GROUP. GREEK_SALAD: isCartRecommended, no modifiers — a one-tap
// add from the bag rail (bag.spec.ts RAIL).
/** Dream box's single-option Nuggets slot — pre-selected and FIXED (D5). */
const G_NUGGETS = `${DREAM_BOX}_5_combo`;
/** Dream box's six-option Drinks slot (pack.spec.ts G_DRINKS / PEPSI_SMALL). */
const G_DRINKS = `${DREAM_BOX}_3_combo`;
const PEPSI_SMALL = "5dd27b527973647b693e428b";
const EXTRA_GROUP = `${CHEESE_BURGER}_1573980469_addons`;
const CHEESE_BURGER_DESCRIPTION = "The classic Cheese Burger with Herfy special take";

/** The fixture's `ar` aliases (and Cheese Burger's descriptionTranslation). */
const AR = {
  sideOrders: "الطلبات الجانبية",
  cheeseBurger: "تشيز برجر",
  cheeseBurgerDescription: "تشيز برجر",
  dreamBox: "بوكس الحلم 1",
  nuggetsPick: "4 قطع ناجتس + صوص باربيكيو",
  pepsiSmall: "ببسي  صغير",
  extraGroup: "اختر من إضافات إلى تشيز برجر",
  extraPickles: "إضافة كمية المخلل",
  greekSalad: "سلطة يونانية",
};

/** getPipelines: one card carrying its own secondary-language name. */
const PIPELINE = {
  _id: "p1",
  tab_id: "t1",
  tab_type: "dine_in",
  primary_name: "Dine In",
  secondary_name: "تناول في المطعم",
};

/**
 * Operator copy (kiosk settings), one line per language slot. Both ticker
 * lines are longer than the 16-char design line; the Arabic one ends in a
 * neutral "!" (the bidi probe).
 */
const TICKER_EN = "Taco Tuesday every day";
const TICKER_AR = "ثلاثاء التاكو كل يوم!";
const MIAM_EN = "Make it a combo, amigo?";
const MIAM_AR = "هل تريدها وجبة كاملة؟";

/** Arabic letters plus the bidi isolates and marks. */
const ARABIC_OR_ISOLATE = /[؀-ۿ⁦-⁩]/;
const ISOLATE = /[⁦-⁩]/;

/**
 * Arabic is always offered here: what the GUEST picks is under test.
 * `settings` merges into get_kiosk_settings.
 */
const mockKioskBackend = (page: Page, settings: Record<string, unknown>) =>
  mockBackend(page, {
    arabic: true,
    // Cheese Burger's upsellItems → the MIAM prompt.
    settings: { enable_combo_upsell: true, ...settings },
    pipelines: [PIPELINE],
  });

async function mockPipelines(page: Page) {
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({ json: [PIPELINE] })
  );
}

/** [primary, secondary] MIAM headline texts in the store (DEV-only window.__kioskStore). */
const miamTexts = (page: Page) =>
  page.evaluate(() => {
    const { makeItAMeal } = (
      window as unknown as {
        __kioskStore: {
          getState: () => {
            makeItAMeal: { primaryMakeItAMealText: unknown; secondaryMakeItAMealText: unknown };
          };
        };
      }
    ).__kioskStore.getState();
    return [makeItAMeal.primaryMakeItAMealText, makeItAMeal.secondaryMakeItAMealText];
  });

/**
 * The /second marquee's cycle, in seconds: the INLINE duration DaypartTicker
 * sets for an operator line. No inline style (the design copy) means
 * index.css's 18 s design cycle. Never the computed value: the suite runs
 * under reduced motion (playwright.config), where every animation computes 1 ms.
 */
const tickerSeconds = (page: Page) =>
  page
    .locator(".tb-marquee-track")
    .evaluate((el) => Number.parseFloat((el as HTMLElement).style.animationDuration || "18s"));

/** One copy of the /second marquee line (DaypartTicker repeats it). */
const ticker = (page: Page) => page.locator(".tb-marquee-track span").first();

/** No FSI/LRI/RLI/PDI left anywhere on the page. */
async function expectNoIsolate(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => /[⁦-⁩]/.test(document.body.textContent ?? ""))
    )
    .toBe(false);
}

/** Only the fields the Rule 3 checks read. */
interface PushedOrder {
  items: { name?: string }[];
  source?: { name?: string };
  extras?: Record<string, unknown>;
}

test.describe("Post-P9 names + operator copy in the guest's language", () => {
  test("ARABIC: the guest's language drives the pipeline name, the ticker, the menu, MIAM, the PDP and the bag — the order push stays English (Rule 3) — and Order Complete's 20 s exit brings English back with no isolate left", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.clock.install(); // Order Complete's 20 s exit is stepped, never slept through
    await mockKioskBackend(page, {
      pipeline_text_primary: TICKER_EN,
      pipeline_text_secondary: TICKER_AR,
      make_it_meal_secondary: MIAM_AR,
      // Pay-at-counter fan-out (checkout.spec.ts): PAY → /payment.
      skip_crm_page: true,
      pay_at_counter: "pay_at_counter",
    });
    const checkout = await mockCheckoutBackend(page);
    // The shared mock's row again (the checkout fixture leaves getPipelines alone without a tabType).
    await mockPipelines(page);
    await registerToStart(page);
    await startToSecond(page);

    // English first: the primary slot of every operator line and name.
    const second = page.getByTestId("second-screen");
    const card = page.getByTestId("pipeline-p1");
    await expect(second).toContainText(en.second.title);
    await expect(ticker(page)).toContainText(TICKER_EN);
    await expect(card).toContainText(PIPELINE.primary_name);

    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(second).toContainText(ar.second.title);
    // 28 + L0: the card reads secondary_name.
    await expect(card).toContainText(PIPELINE.secondary_name);
    await expect(card).not.toContainText(PIPELINE.primary_name);
    // 27b: the secondary operator line replaces both the English line and
    // the Arabic "lunch time" copy…
    await expect(ticker(page)).toContainText(TICKER_AR);
    await expect(ticker(page)).not.toContainText(ar.ticker.lunch);
    // …isolated like a translated string: its trailing "!" renders at the
    // run's LEFT end, left of the first letter (header: bidi).
    const bang = await glyphX(ticker(page), "!", "ث");
    expect(bang.a, "the operator line renders as an RTL isolate").toBeLessThan(bang.b);

    // L0 both ways: English picked again reads the primary slot again.
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-en").click();
    await expect(second).toContainText(en.second.title);
    await expect(ticker(page)).toContainText(TICKER_EN);
    await expect(card).toContainText(PIPELINE.primary_name);
    await expect(card).not.toContainText(PIPELINE.secondary_name);
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(ticker(page)).toContainText(TICKER_AR);

    // 28 on /menu: rail, section heading and card from the `ar` aliases.
    await pickPipelineToMenu(page);
    await expect(page.getByTestId(`rail-${SIDE_ORDERS}`)).toContainText(AR.sideOrders);
    const heading = page.getByTestId(`section-${SIDE_ORDERS}`).locator("h2");
    await expect(heading).toContainText(AR.sideOrders);
    await expect(heading).not.toContainText("Side Orders");
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await expect(burger).toContainText(AR.cheeseBurger);

    // 29c: the MIAM headline is the operator's SECONDARY line; the combo
    // card is named from its alias.
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    const prompt = page.getByTestId("miam-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt.locator("h2")).toContainText(MIAM_AR);
    await expect(prompt.getByTestId(`miam-combo-${DREAM_BOX}`)).toContainText(
      AR.dreamBox
    );
    await prompt.getByTestId("miam-decline").click();

    // 28 on the PDP: title, group and option.
    const pdp = page.getByTestId("customization-screen");
    await expect(pdp).toBeVisible();
    await expect(pdp.locator("h1")).toContainText(AR.cheeseBurger);
    // The description is the descriptionTranslation, never the English.
    await expect(pdp.locator('p[dir="auto"]')).toContainText(AR.cheeseBurgerDescription);
    await expect(pdp).not.toContainText(CHEESE_BURGER_DESCRIPTION);
    await expect(page.getByTestId(`pdp-group-${EXTRA_GROUP}`).locator("h3")).toContainText(
      AR.extraGroup
    );
    const pickles = page.getByTestId(`pdp-option-${EXTRA_PICKLES}`);
    await expect(pickles).toContainText(AR.extraPickles);
    await pickles.click();
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();

    // A pack PDP: the FIXED Nuggets card names its pre-selected pick (D5),
    // and the Drinks SELECT sheet its options, from the aliases. Nothing is
    // committed (back to /menu).
    const box = page.getByTestId(`item-${DREAM_BOX}`);
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
    await expect(pdp.locator("h1")).toContainText(AR.dreamBox);
    await expect(page.getByTestId(`pack-slot-${G_NUGGETS}`)).toContainText(AR.nuggetsPick);
    await page.getByTestId(`pack-slot-open-${G_DRINKS}`).click();
    const sheet = page.getByTestId("slot-sheet");
    await expect(sheet.getByTestId(`slot-option-${PEPSI_SMALL}`)).toBeVisible();
    await expect(sheet).toContainText(AR.pepsiSmall);
    await page.getByTestId("slot-sheet-close").click();
    await expect(sheet).toHaveCount(0);
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();

    // The bag row and its add-on line.
    await openBag(page);
    const row = page.locator('[data-testid^="bag-row-"]').first();
    await expect(row).toContainText(AR.cheeseBurger);
    await expect(row).toContainText(AR.extraPickles);
    // "name +£1.00" in one line: the isolated name keeps the price at the
    // line's right end (unisolated, UBA W2/N1 pull "+£1.00" left of it).
    const addOn = await glyphX(row.locator("p", { hasText: AR.extraPickles }), "£", "إ");
    expect(addOn.a, "the add-on price renders right of its Arabic name").toBeGreaterThan(addOn.b);
    // The bag rail names its cards from the aliases; a one-tap add from it
    // is pushed in English like the PDP add (Rule 3, below).
    const salad = page.getByTestId(`bag-rail-item-${GREEK_SALAD}`);
    await expect(salad).toContainText(AR.greekSalad);
    await salad.click();
    await expect(page.locator('[data-testid^="bag-row-"]')).toHaveCount(2);

    // PAY AT COUNTER → /payment → /receipt → Order Complete.
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("payment-counter").click();
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 15_000 });

    // Rule 3: the push carries no isolate at all, and no Arabic outside the
    // server's own pipeline row (header).
    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.forbiddenHit).toBe(false);
    const pushed = checkout.lastPlaceOrderBody as PushedOrder;
    expect(JSON.stringify(pushed), "an isolate reached the push").not.toMatch(ISOLATE);
    const { pipeline, ...extras } = pushed.extras ?? {};
    expect(pipeline).toMatchObject(PIPELINE);
    expect(
      JSON.stringify({ ...pushed, extras }),
      "a render-time name reached the push"
    ).not.toMatch(ARABIC_OR_ISOLATE);
    expect(pushed.items.map((item) => item.name)).toEqual(["Cheese Burger", "Greek Salad"]);
    expect(JSON.stringify(pushed.items)).toContain("Extra Pickles");
    expect(pushed.source?.name).toContain(PIPELINE.primary_name);

    // Order Complete's 20 s exit: /start's mount resets the
    // language — English names and copy again, and no isolate anywhere.
    await page.clock.runFor(20_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expectNoIsolate(page);
    await startToSecond(page);
    await expect(second).toContainText(en.second.title);
    await expect(card).toContainText(PIPELINE.primary_name);
    await expect(ticker(page)).toContainText(TICKER_EN);
    await pickPipelineToMenu(page);
    await expect(page.getByTestId(`rail-${SIDE_ORDERS}`)).toContainText("Side Orders");
    await expect(page.getByTestId(`item-${CHEESE_BURGER}`)).toContainText("Cheese Burger");
    await expectNoIsolate(page);
  });

  test("ENGLISH CONTROL: with operator copy for the Arabic slot only, an English guest sees today's screens — \"It's lunch time!\", the English names and the Figma MIAM title — with no isolate", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, {
      pipeline_text_secondary: TICKER_AR,
      make_it_meal_secondary: MIAM_AR,
    });
    await registerToStart(page);
    await startToSecond(page);

    // 27b: no primary operator line → the design's copy; never the Arabic one.
    await expect(ticker(page)).toContainText(en.ticker.lunch);
    await expect(ticker(page)).not.toContainText(TICKER_AR);
    await expect(page.getByTestId("pipeline-p1")).toContainText(PIPELINE.primary_name);

    await pickPipelineToMenu(page);
    await expect(page.getByTestId(`rail-${SIDE_ORDERS}`)).toContainText("Side Orders");
    await expect(page.getByTestId(`section-${SIDE_ORDERS}`).locator("h2")).toContainText(
      "Side Orders"
    );
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await expect(burger).toContainText("Cheese Burger");

    // 29c: no primary operator text → the Figma title, never the Arabic line.
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    const prompt = page.getByTestId("miam-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt.locator("h2")).toContainText(en.miam.title);
    await expect(prompt.locator("h2")).not.toContainText(MIAM_AR);
    await prompt.getByTestId("miam-decline").click();
    const pdp = page.getByTestId("customization-screen");
    await expect(pdp).toBeVisible();
    await expect(pdp.locator("h1")).toContainText("Cheese Burger");
    await expectNoIsolate(page);
  });

  test("ARABIC CONTROL: operator copy for the English slot only commits with the boot and never reaches an Arabic guest — the translated defaults show — and the long English line keeps the design's speed", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, {
      pipeline_text_primary: TICKER_EN,
      make_it_meal_primary: MIAM_EN,
    });
    // P9e: the boot's LAST fetch (loyalty off), held open. The MIAM texts are
    // staged, so none of them is in the store before the commit.
    const lastBootFetch = await parkRequests(page, "**/api/cx/getKisokDeviceData");
    await submitRegistration(page);
    await expect.poll(() => lastBootFetch.count).toBe(1);
    expect(await miamTexts(page)).not.toContain(MIAM_EN);
    await lastBootFetch.release();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    expect(await miamTexts(page)).toEqual([MIAM_EN, ""]);

    // 27b: the English guest reads the English line, on a longer cycle than
    // the 16-char design copy (one speed)…
    await startToSecond(page);
    await expect(ticker(page)).toContainText(TICKER_EN);
    const operatorSeconds = await tickerSeconds(page);
    // …and an Arabic guest never does: no secondary line → the design copy.
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(ticker(page)).toContainText(ar.ticker.lunch);
    await expect(ticker(page)).not.toContainText(TICKER_EN);
    expect(operatorSeconds).toBeGreaterThan(await tickerSeconds(page));

    // 29c: likewise the MIAM headline — the Arabic Figma title, never MIAM_EN.
    await pickPipelineToMenu(page);
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    const prompt = page.getByTestId("miam-prompt");
    await expect(prompt).toBeVisible();
    await expect(prompt.locator("h2")).toContainText(ar.miam.title);
    await expect(prompt.locator("h2")).not.toContainText(MIAM_EN);
  });
});
