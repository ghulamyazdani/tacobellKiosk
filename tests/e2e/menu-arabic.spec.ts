import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mockCheckoutBackend } from "./fixtures/checkout";

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
 * House order (idle.spec.ts): the `**\/api/**` catch-all FIRST, then the two
 * cross-origin edges the catch-all cannot see (the print agent, aborted; the
 * Xeno revoke), then the specific mocks. Newest wins. The checkout fixture
 * re-routes getPipelines with an English-only row, so the Arabic row is
 * routed again AFTER it. Boot helpers are copied from idle.spec.ts (house
 * precedent).
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

const readJson = (relative: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8")
  );

const slimMenu = readJson("./fixtures/slim-menu.json");
const en = readJson("../../src/i18n/locales/en/translation.json");
const ar = readJson("../../src/i18n/locales/ar/translation.json");

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json) ----
const SIDE_ORDERS = "5dd1092ecc7088762eee2659";
/** Modifier groups, upsellItems = [Dream box 1,]: MIAM first when combo upsell is on. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
const DREAM_BOX = "68dd79409030ed3064aee28c";
/** Dream box's single-option Nuggets slot (pack.spec.ts G_NUGGETS / NUGGETS_PICK). */
const G_NUGGETS = `${DREAM_BOX}_5_combo`;
const NUGGETS_PICK = "66e952596dd4d13b6564a528";
const EXTRA_GROUP = `${CHEESE_BURGER}_1573980469_addons`;
/** +£1, in EXTRA_GROUP. */
const EXTRA_PICKLES = "5dd1093f188e72ce1b3eb36e";
/** isCartRecommended, no modifiers: a one-tap add from the bag rail (bag.spec.ts RAIL). */
const GREEK_SALAD = "5dd1093829754a432f2c32e2";
const CHEESE_BURGER_DESCRIPTION = "The classic Cheese Burger with Herfy special take";

/** The fixture's `ar` aliases (and Cheese Burger's descriptionTranslation). */
const AR = {
  sideOrders: "الطلبات الجانبية",
  cheeseBurger: "تشيز برجر",
  cheeseBurgerDescription: "تشيز برجر",
  dreamBox: "بوكس الحلم 1",
  nuggetsPick: "4 قطع ناجتس + صوص باربيكيو",
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
async function mockKioskBackend(page: Page, settings: Record<string, unknown>) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them (header).
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) =>
    r.fulfill({ json: { status: "success" } })
  );
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: { name: "العربية", code: "ar", dir: "rtl" },
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
        // A secondary language without its splash text fails the boot.
        start_order_text_secondary: "ابدأ الطلب",
        ideal_time: "180",
        // Cheese Burger's upsellItems → the MIAM prompt.
        enable_combo_upsell: true,
        ...settings,
      },
    })
  );
  await mockPipelines(page);
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: [] }));
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

async function mockPipelines(page: Page) {
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({ json: [PIPELINE] })
  );
}

/** Type the device code on the on-screen keyboard and submit (the boot starts). */
async function submitRegistration(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
}

/** Register and land on the splash. */
async function registerToStart(page: Page) {
  await submitRegistration(page);
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

/**
 * Parks matching requests until release() (idle.spec.ts parkRequests,
 * trimmed). Register it AFTER the mock it shadows (newest wins): release()
 * passes each parked request on with route.fallback().
 */
async function parkRequests(page: Page, url: string) {
  const parked: Route[] = [];
  let armed = true;
  await page.route(url, (route) => {
    if (!armed) return route.fallback();
    parked.push(route);
    return undefined;
  });
  return {
    get count() {
      return parked.length;
    },
    release: async () => {
      armed = false;
      await Promise.all(parked.splice(0).map((route) => route.fallback()));
    },
  };
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
 * P9f bidi probe (idle.spec.ts tickerGlyphX, over every text node of the
 * element): the on-screen x of the first `a` and `b` glyphs — the RENDERED
 * order, which only the BiDi algorithm decides. One evaluate, so a moving
 * marquee is measured in one frame. NaN (never in order) when a glyph is
 * missing.
 */
function glyphX(locator: Locator, a: string, b: string) {
  return locator.evaluate(
    (el, [first, second]) => {
      const x = (glyph: string) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text;
          const at = text.data.indexOf(glyph);
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(text, at);
          range.setEnd(text, at + glyph.length);
          return range.getBoundingClientRect().x;
        }
        return Number.NaN;
      };
      return { a: x(first), b: x(second) };
    },
    [a, b]
  );
}

/** The /second marquee's computed cycle, in seconds. */
const tickerSeconds = (page: Page) =>
  page
    .locator(".tb-marquee-track")
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).animationDuration));

/** Splash → order type (/second). */
async function startToSecond(page: Page) {
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible();
}

/** /second → /menu (loyalty off). */
async function pickPipelineToMenu(page: Page) {
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

/**
 * VIEW MY BAG → /cart. The first open of a session may meet the P7d upsell
 * (/forYou); declining it mutates no cart state (bag.spec.ts openBag).
 */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

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
  test("ARABIC: the guest's language drives the pipeline name, the ticker, the menu, MIAM, the PDP and the bag — the order push stays English (Rule 3) — and Start Over brings English back with no isolate left", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await mockKioskBackend(page, {
      pipeline_text_primary: TICKER_EN,
      pipeline_text_secondary: TICKER_AR,
      make_it_meal_secondary: MIAM_AR,
      // Pay-at-counter fan-out (checkout.spec.ts): PAY → /payment.
      skip_crm_page: true,
      pay_at_counter: "pay_at_counter",
    });
    const checkout = await mockCheckoutBackend(page);
    // After the checkout fixture: its English-only pipeline row must not win.
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

    // A pack PDP: the slot card names its preview pick, and the SELECT sheet
    // its options, from the aliases. Nothing is picked (back to /menu).
    const box = page.getByTestId(`item-${DREAM_BOX}`);
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
    await expect(pdp.locator("h1")).toContainText(AR.dreamBox);
    await expect(page.getByTestId(`pack-slot-${G_NUGGETS}`)).toContainText(AR.nuggetsPick);
    await page.getByTestId(`pack-slot-open-${G_NUGGETS}`).click();
    const sheet = page.getByTestId("slot-sheet");
    await expect(sheet.getByTestId(`slot-option-${NUGGETS_PICK}`)).toBeVisible();
    await expect(sheet).toContainText(AR.nuggetsPick);
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

    // Start Over: /start's mount resets the language — English names and
    // copy again, and no isolate anywhere.
    await page.getByTestId("order-success-startover").click();
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
