import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clippedText } from "./fixtures/clippedText";

/**
 * Lane `fonts` — CAPTURE-ONLY screenshots of the offers / menu-data screens
 * main gained after P1 (user decision 2026-10-05: no pixel assertions until
 * GT America is licensed and a CI rendering image is fixed). Every walk runs
 * in English, Arabic and the ADA reach-zone view and attaches one PNG per
 * screen (`offers-<mode>-NN-<screen>`) for human review against the Figma
 * frames; the assertions only prove the right screen is up, plus one
 * DOM-geometry probe per shot (`clippedText`, fixtures/clippedText.ts — soft,
 * so every shot is still taken) and the targeted checks the fonts lane's
 * fixes need: the least-value stage brings the 70-character bowl's tile on
 * screen for the probe (its name meets the buy-stage tile's two-line box —
 * line-clamp-2, not a sliced third line), and /forYou checks that an in-cart
 * card's count pill covers none of the card's text.
 *
 * Covered: /second with the operator ticker copy and the language sheet; /menu
 * (rail, hero, grid, scroll indicator, top and scrolled) with the Arabic item
 * and category names; Select-a-Size (a variant item); the product-added modal
 * with its You Might Like strip; the MIAM prompt with the operator headline;
 * the repeat sheet; the pack slot sheets; /forYou; the bag with the tenant
 * Complete-Your-Meal rail, its totals and the remove confirm; the rewards
 * sheet (locked nudge, eligible rows, the suggested rail) and its ADD ITEMS
 * rows, the offer-applied celebration and the applied row; the group-mode
 * freebie picker, the in-bag freebie PDP and the single-pick picker; the BOGO
 * and least-value buy stages; the reward-removed notice.
 *
 * Content is real-length (a third of the reference TB India menu's names run
 * past 40 characters): TB India item names on the items every screen shows,
 * with Arabic aliases of the same length, long offer names, a variant item
 * with sized names, and operator copy for both language slots. The fixture
 * FILES are never edited — the in-memory copies are.
 *
 * Mocks and walks are copied from visual-order / visual-entry / offers /
 * offerBuyStage / offerFreebieCustomize / offerCelebration /
 * bag-recommendations / menu-arabic (no spec exports helpers — the house
 * precedent): the `**\/api/**` catch-all FIRST, the cross-origin edges routed
 * explicitly (print agent aborted, Xeno revoke answered, the item photos and
 * the tenant recommendations file served locally), every specific mock after
 * it (newest wins). The walk never needs the network.
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

const readFixture = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)));
const readJson = (relative: string) =>
  JSON.parse(readFixture(relative).toString("utf-8"));

const offersFixture = readJson("./fixtures/offers.json");
/** The WELCOME photo stands in for every item photo (served locally). */
const PHOTO = readFixture("../../src/assets/splash/fullbleed-halfmoon.jpg");
const ITEM_IMAGE_HOST = "https://itemsposistnet.s3.ap-south-1.amazonaws.com/**";

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json) ----
const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // £17, plain: the NEW hero
const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8, 3 addon groups, MIAM → Dream box
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa"; // £9, one optional group
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b"; // £2, plain
const CAESAR_DRESSING = "5dd109392b29ee1f2a82a49c"; // £2, plain, the menu's last card
const EXTRA_PICKLES = "5dd1093f188e72ce1b3eb36e"; // +£1 burger addon
/** Kiddie Meal Beef Burger, turned into a sized drink (Select-a-Size). */
const SHAKE = "5dd1093a188e72ce1b3eb358";
const KIDDIE_SUB = "5dd10932d61b199c2e6bbe77";
const SHAKE_REGULAR = "e2e-shake-regular";
const SHAKE_LARGE = "e2e-shake-large";
const SHAKE_FAMILY = "e2e-shake-family";
const DREAM_BOX = "68dd79409030ed3064aee28c"; // pack, £25
const G_SIDES = `${DREAM_BOX}_2_combo`;
const G_DRINKS = `${DREAM_BOX}_3_combo`;
const DIET_PEPSI = "5dd27b857d342f4069dd0065";
const MT_DEW = "5dd27b951ad8dd90571d1c33";

const arabic = (value: string) => ({ value, name: "Arabic", code: "ar", dir: "rtl" });

/** Real-length names, English and Arabic (TB India menu names, header). */
const NAMES: Record<string, [string, string]> = {
  [CHEESE_BURGER]: [
    "Ultimate Cheese Crunchwrap Non Veg + Seasoned Fries & Pepsi",
    "كرانش راب الجبن الفاخر باللحم + بطاطس متبلة وبيبسي",
  ],
  [GREEK_SALAD]: [
    "2 Value Rice Bowl Non Veg+1 Small Fries+1 Cinnamon Twists+2 Pepsi Zero",
    "2 طبق أرز القيمة باللحم + 1 بطاطس صغيرة + 1 قرفة ملتوية + 2 بيبسي زيرو",
  ],
  [LARGE_FRIES]: [
    "Melted Cheese Quesadilla Veg + Seasoned Fries & Pepsi",
    "كاساديا الجبن الذائب نباتي + بطاطس متبلة وبيبسي",
  ],
  [TORTILLA_SAUCE]: [
    "Taco Party Pack (Box of 6 Crunchy Wheat Tacos)- Veg",
    "باقة حفلة التاكو (علبة 6 تاكو قمح مقرمش) - نباتي",
  ],
  [CAESAR_DRESSING]: [
    "Cheesy Lava Taco - Non Veg + Hazelnut Coffee Thick Shake",
    "تاكو اللافا بالجبن - لحم + ميلك شيك قهوة البندق",
  ],
  [DREAM_BOX]: [
    "Burrito Roll Party Pack (8 Habanero Burritos Box)-Veg",
    "باقة حفلة البوريتو (علبة 8 بوريتو هابانيرو) - نباتي",
  ],
  [SHAKE]: ["Hazelnut Coffee Thick Shake", "ميلك شيك قهوة البندق"],
  [DIET_PEPSI]: ["Hazelnut Coffee Thick Shake", "ميلك شيك قهوة البندق"],
  [MT_DEW]: ["Pepsi Masala Twist", "بيبسي ماسالا تويست"],
};

/** The sized shake: three active variants (Select-a-Size 1:5628 / 1:5683). */
const SHAKE_SIZES: Array<[string, string, string, number]> = [
  [SHAKE_REGULAR, "Regular (350 ml)", "عادي (350 مل)", 3],
  [SHAKE_LARGE, "Large (500 ml)", "كبير (500 مل)", 4.5],
  [SHAKE_FAMILY, "Family Pack (4 × 350 ml) with Churros", "عبوة عائلية (4 × 350 مل) مع تشوروز", 12],
];

interface MenuItem {
  id: string;
  name: string;
  aliases?: unknown[];
  calorieCount?: number;
}

function rename(item: MenuItem) {
  item.calorieCount = 360;
  const names = NAMES[item.id];
  if (!names) return;
  item.name = names[0];
  item.aliases = [arabic(names[1])];
}

/** The slim fixture with real-length content (header) — a fresh copy per test. */
function captureMenu() {
  const menu = readJson("./fixtures/slim-menu.json");
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities) {
        rename(entity);
        if (entity.id === GREEK_SALAD) entity.badges = [{ name: "New" }];
        if (entity.id === CHEESE_BURGER) {
          entity.recommendedItems = [GREEK_SALAD, LARGE_FRIES, TORTILLA_SAUCE];
        }
        if (entity.id === SHAKE) {
          entity.hasVariant = true;
          entity.modifiers = [];
          entity.variants = SHAKE_SIZES.map(([id, name, ar, price]) => ({
            id,
            name,
            aliases: [arabic(ar)],
            price,
            isActive: true,
            calorieCount: 360,
            subCategoryId: KIDDIE_SUB,
            image_url: entity.image_url,
          }));
        }
      }
  for (const group of menu.modifiers) for (const item of group.constituentItems) rename(item);
  return menu;
}

// ---- Offers (production-shaped; offerBuyStage / offerFreebieCustomize) ----
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const named = (offer: { _id: string }, name: string) => ({ ...clone(offer), name });
const getEntry = (_id: string, baseItemId: string, name: string, relation: "and" | "or") => ({
  _id,
  baseItemId,
  name,
  relation,
  discountType: "percent",
  value: 100,
  quantity: 1,
});
const groupEntry = (_id: string, baseItemId: string, name: string) => ({
  ...getEntry(_id, baseItemId, name, "or"),
  value: "",
  quantity: null,
});
const applicableBuy = (rawItems: unknown[]) => ({
  on: "complete",
  categories: [],
  items: [],
  isExclude: false,
  isInclude: false,
  rawItems,
});
const itemOffer = (over: Record<string, unknown>) => ({ ...clone(offersFixture[2]), ...over });

/** £25 minimum: locked under an £8 cart, with the pink "Add £17.00+" nudge. */
const PERCENT_25 = named(offersFixture[0], "25% Off Your Entire Order Above £25 (Max £10 Off)");
const FLAT_2 = named(offersFixture[1], "£2 Off Any Order — Taco Tuesday Special");
const FREE_SALAD = named(offersFixture[2], "Free Value Rice Bowl Combo With Every Order");
const FREE_SAUCE = named(offersFixture[3], "Free Party Pack Or Lava Taco Of Your Choice");
/** Buy 2 sauces → a Caesar free: a locked bogoBuySide row with ADD ITEMS. */
const BOGO_SAUCE = itemOffer({
  _id: "offer-bogo-sauce",
  name: "Buy 2 Taco Party Packs, Get A Cheesy Lava Taco Free",
  getItemOnly: false,
  applicable: applicableBuy([
    { item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" }, quantity: 2, relation: "and" },
  ]),
  getItems: {
    items: [getEntry("gi-bogo-caesar", CAESAR_DRESSING, "Caesar Dressing", "and")],
    categories: [],
  },
});
/** Any 2 of 3 (the 70-character bowl among them), the cheapest free: the least-value stage. */
const LEAST_SAUCES = itemOffer({
  _id: "offer-least-sauces",
  name: "Any 2 Tacos Or Bowls From The Party Menu, Cheapest One Free",
  getItemOnly: false,
  getLeastValueItem: true,
  leastItemValueCount: { buyQuantity: 2, getQuantity: 1 },
  applicable: applicableBuy([
    { item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" } },
    { item: { baseItemId: CAESAR_DRESSING, name: "Caesar Dressing" } },
    { item: { baseItemId: GREEK_SALAD, name: "Greek Salad" } },
  ]),
  getItems: { items: [], categories: [] },
});
/** Group-wise "pick 2" of 4, one customizable (the burger): picker controls. */
const PICK_2_SIDES = itemOffer({
  _id: "offer-gw-pick-2",
  name: "Buy A Crunchwrap, Pick Any 2 Sides Free (Tacos, Bowls Or Wraps)",
  getItemOnly: false,
  buygetGroupWiseOffer: true,
  buygetGroupWiseOfferValues: { discountType: "percent", value: 100, getQuantity: 2, buyQuantity: 1 },
  applicable: applicableBuy([{ item: { baseItemId: CHEESE_BURGER, name: "Cheese Burger" } }]),
  getItems: {
    items: [
      groupEntry("gi-gw-salad", GREEK_SALAD, "Greek Salad"),
      groupEntry("gi-gw-sauce", TORTILLA_SAUCE, "Tortilla Sauce"),
      groupEntry("gi-gw-caesar", CAESAR_DRESSING, "Caesar Dressing"),
      groupEntry("gi-gw-burger", CHEESE_BURGER, "Cheese Burger"),
    ],
    categories: [],
  },
});
/** The top LOCKED row has the minBill gap, so the sheet shows its suggested rail. */
const REWARDS_OFFERS = [PERCENT_25, FLAT_2, FREE_SALAD, FREE_SAUCE, PICK_2_SIDES];

/** The tenant co-purchase file (bag-recommendations.spec): the bag's rail. */
const RECS_HOST = "https://recommendations.e2e.test";
const RECS_BODY = {
  data: [
    {
      baseItem_id: CHEESE_BURGER,
      refers: [
        { refer_baseItem_id: TORTILLA_SAUCE, occurrences: 3 },
        { refer_baseItem_id: LARGE_FRIES, occurrences: 5 },
        { refer_baseItem_id: GREEK_SALAD, occurrences: 2 },
        { refer_baseItem_id: CAESAR_DRESSING, occurrences: 1 },
      ],
    },
  ],
};

/** Operator copy for both slots (menu-arabic.spec): the ticker and MIAM. */
const OPERATOR_COPY = {
  pipeline_text_primary: "Taco Tuesday every day: 2 Crunchy Tacos for £5!",
  pipeline_text_secondary: "ثلاثاء التاكو كل يوم: 2 تاكو مقرمش مقابل 5 جنيهات!",
  make_it_meal_primary: "Make it a meal with Seasoned Fries & a Pepsi?",
  make_it_meal_secondary: "هل تريدها وجبة مع بطاطس متبلة وبيبسي؟",
};

type Mode = "en" | "ar" | "ada";
const MODES: Mode[] = ["en", "ar", "ada"];

interface MockOptions {
  /** get_cx_valid_offers. */
  offers?: unknown[];
  /** enable_combo_upsell: a burger tap opens the MIAM prompt. */
  comboUpsell?: boolean;
}

/** House mock order: the `**\/api/**` catch-all FIRST, specific mocks after. */
async function mockKioskBackend(page: Page, opts: MockOptions = {}) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all never sees them.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) => r.fulfill({ json: { status: "success" } }));
  await page.route(ITEM_IMAGE_HOST, (r) => r.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
  await page.route(`${RECS_HOST}/**`, (r) =>
    r.fulfill({ json: RECS_BODY, headers: { "Access-Control-Allow-Origin": "*" } })
  );
  // The DEV-only URL seam (bag-recommendations.spec), on every navigation.
  await page.addInitScript((url) => {
    (window as unknown as { __TB_RECS_URL__?: string }).__TB_RECS_URL__ = url;
  }, `${RECS_HOST}/data.json`);
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: { name: "العربية", code: "ar", dir: "rtl" },
      },
    })
  );
  await page.route("**/api/cx/getCxSkinData", (r) => r.fulfill({ json: { skin_id: "skin_1" } }));
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
        accessibility_mode: true,
        ...OPERATOR_COPY,
        ...(opts.comboUpsell ? { enable_combo_upsell: true } : {}),
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [
        {
          _id: "p1",
          tab_id: "t1",
          tab_type: "dine_in",
          primary_name: "Dine In",
          secondary_name: "تناول في المطعم",
        },
        {
          _id: "p2",
          tab_id: "t2",
          tab_type: "take_away",
          primary_name: "Take Away",
          secondary_name: "سفري",
        },
      ],
    })
  );
  const menu = captureMenu();
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: menu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: opts.offers ?? [] }));
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

/** Register on the on-screen keyboard and land on the splash. */
async function registerToStart(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

/** The reach-zone view on (any footer's ADA DISPLAY). */
async function adaOn(page: Page) {
  await page.getByTestId("footer-ada").click();
  await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
}

/** Splash → /second → (Arabic) → Dine In → /menu → (ADA). */
async function startOrder(page: Page, mode: Mode) {
  await registerToStart(page);
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible();
  if (mode === "ar") {
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  }
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  if (mode === "ada") await adaOn(page);
}

const menuPane = (page: Page) =>
  page.locator('[data-testid^="section-"]').first().locator("xpath=..");

/** Card → PDP → (addon) → ADD TO BAG; leaves the added modal OPEN. */
async function commitBurgerViaPdp(page: Page, addonId?: string) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  if (addonId) await page.getByTestId(`pdp-option-${addonId}`).click();
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("product-added-modal")).toBeVisible();
}

async function addBurger(page: Page) {
  await commitBurgerViaPdp(page);
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
}

/** VIEW MY BAG → /cart, through the once-per-session /forYou upsell. */
async function openBag(page: Page, onUpsell?: () => Promise<void>) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await expect(page.getByTestId("foryou-screen")).toBeVisible();
    if (onUpsell) await onUpsell();
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
}

const bagRow = (page: Page, entityId: string) =>
  page.locator(`[data-testid^="bag-row-"][data-testid$="_${entityId}"]`);

async function openRewards(page: Page) {
  await page.getByTestId("bag-rewards-entry").click();
  await expect(page.getByTestId("rewards-sheet")).toBeVisible();
}

/** Rewards list → radio-pick → SAVE. */
async function pickAndSave(page: Page, offerId: string) {
  await page.getByTestId(`offer-row-${offerId}`).click();
  await expect(page.getByTestId(`offer-row-${offerId}`)).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("rewards-save").click();
  await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
}

/** Fake time in small steps until `done()` holds (autoUpdate.spec). */
async function stepClockUntil(page: Page, done: () => Promise<boolean>) {
  await expect
    .poll(
      async () => {
        await page.clock.runFor(100);
        return done();
      },
      { timeout: 20_000, intervals: [50] }
    )
    .toBe(true);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

/**
 * Every <img> settled and every finite CSS keyframe animation (the sheet and
 * modal entrances, the celebration) at rest before the shot (visual-entry
 * capture: they run in real time even under a paused page.clock).
 */
async function capture(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Array.from(document.images).every((img) => img.complete) &&
          document
            .getAnimations()
            .every(
              (animation) =>
                !(animation instanceof CSSAnimation) ||
                animation.playState !== "running" ||
                !Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity)
            )
      )
    )
    .toBe(true);
  await shot(page, name);
  expect.soft(await clippedText(page), `${name}: text the layout cuts off`).toEqual([]);
}

/** The first text of a card that its in-cart count pill covers ("" = none). */
const textUnderPill = (card: Locator) =>
  card.evaluate((el) => {
    const pill = el.querySelector("span.bg-tb-purple");
    if (!pill) return "no pill";
    const p = pill.getBoundingClientRect();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (pill.contains(n) || !n.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top) {
          return n.textContent.trim();
        }
      }
    }
    return "";
  });

/**
 * The bell placeholders under `root` (spans masked with the bell SVG): how
 * many, and how many lost their mask — an invalid url() drops it and the
 * bell paints as a solid square.
 */
const bellMasks = (root: Locator) =>
  root.evaluate((el) => {
    const bells = [...el.querySelectorAll<HTMLElement>("span")].filter(
      (span) => span.style.getPropertyValue("mask-size") === "contain"
    );
    return {
      bells: bells.length,
      unmasked: bells.filter((span) => getComputedStyle(span).maskImage === "none").length,
    };
  });

test.describe("lane fonts — offers / menu-data captures", () => {
  test("ORDER TYPE: /second with the operator ticker (1:2581) in EN, ADA and AR, and the language sheet (1:4488)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    const second = page.getByTestId("second-screen");
    await expect(second).toContainText(OPERATOR_COPY.pipeline_text_primary);
    await expect(page.getByTestId("pipeline-p2")).toBeVisible();
    await capture(page, "offers-en-01-second");

    await page.getByTestId("footer-language").click();
    await expect(page.getByTestId("language-ar")).toBeVisible();
    await capture(page, "offers-en-02-language-sheet");
    await page.getByTestId("language-en").click();
    await expect(page.getByTestId("language-sheet")).toHaveCount(0);

    await adaOn(page);
    await capture(page, "offers-ada-01-second");
    await page.getByTestId("footer-language").click();
    await expect(page.getByTestId("language-ar")).toBeVisible();
    await capture(page, "offers-ada-02-language-sheet");
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(second).toContainText("ثلاثاء التاكو");
    await capture(page, "offers-ar-03-second-ada");

    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toHaveCount(0);
    await capture(page, "offers-ar-01-second");
    await page.getByTestId("footer-language").click();
    await expect(page.getByTestId("language-en")).toBeVisible();
    await capture(page, "offers-ar-02-language-sheet");
  });

  for (const mode of MODES) {
    test(`MENU (${mode}): /menu top and scrolled (1:2595, scroll bar 1:5263), Select-a-Size (1:5628/1:5683), the product-added modal (1:4571), the repeat sheet`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await startOrder(page, mode);
      await expect(page.getByTestId("menu-scrollbar")).toBeVisible();
      await capture(page, `offers-${mode}-04-menu-top`);

      await menuPane(page).evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(page.getByTestId(`item-${CAESAR_DRESSING}`)).toBeInViewport();
      await capture(page, `offers-${mode}-05-menu-scrolled`);

      // The sized shake's quick-add opens the Select-a-Size fast lane.
      const quick = page.getByTestId(`quick-add-${SHAKE}`);
      await quick.scrollIntoViewIfNeeded();
      await quick.click();
      const sizes = page.getByTestId("select-size-modal");
      await expect(sizes.getByTestId(`size-${SHAKE_FAMILY}`)).toBeVisible();
      await sizes.getByTestId(`size-${SHAKE_LARGE}`).click();
      await expect(sizes.getByTestId("size-continue")).toBeEnabled();
      await capture(page, `offers-${mode}-06-select-size`);
      // Out through the backdrop (its corner: the card covers its centre).
      await sizes.locator(":scope > button").first().click({ position: { x: 8, y: 8 } });
      await expect(sizes).toHaveCount(0);

      await commitBurgerViaPdp(page, EXTRA_PICKLES);
      await expect(page.getByTestId(`added-rec-${LARGE_FRIES}`)).toBeVisible();
      await capture(page, `offers-${mode}-07-product-added`);
      await page.getByTestId("added-continue").click();
      await expect(page.getByTestId("product-added-modal")).toHaveCount(0);

      // The in-cart burger again: the repeat sheet.
      await page.getByTestId(`item-${CHEESE_BURGER}`).click();
      await expect(page.getByTestId("repeat-sheet")).toBeVisible();
      await capture(page, `offers-${mode}-08-repeat-sheet`);
    });

    test(`MIAM + SLOT SHEETS (${mode}): the MIAM prompt with the operator headline (1:3070), the pack's slot sheets (1:4761)`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page, { comboUpsell: true });
      await startOrder(page, mode);
      const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
      await burger.scrollIntoViewIfNeeded();
      await burger.click();
      const prompt = page.getByTestId("miam-prompt");
      await expect(prompt.getByTestId(`miam-combo-${DREAM_BOX}`)).toBeVisible();
      await capture(page, `offers-${mode}-09-miam`);

      await prompt.getByTestId(`miam-combo-${DREAM_BOX}`).click();
      await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
      await page.getByTestId(`pack-slot-open-${G_SIDES}`).click();
      const sheet = page.getByTestId("slot-sheet");
      await expect(sheet.getByTestId(`slot-option-${LARGE_FRIES}`)).toBeVisible();
      await capture(page, `offers-${mode}-10-slot-sheet-sides`);
      await page.getByTestId("slot-sheet-close").click();
      await expect(sheet).toHaveCount(0);

      await page.getByTestId(`pack-slot-open-${G_DRINKS}`).click();
      await sheet.getByTestId(`slot-option-${DIET_PEPSI}`).click();
      await capture(page, `offers-${mode}-11-slot-sheet-drinks`);
    });

    test(`BAG (${mode}): /forYou, the bag with its tenant Complete-Your-Meal rail (1:3171/1:3236), its totals, the remove confirm (1:4533)`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await startOrder(page, mode);
      await addBurger(page);
      const hero = page.getByTestId(`quick-add-${GREEK_SALAD}`);
      await hero.scrollIntoViewIfNeeded();
      await hero.click();
      await expect(page.getByTestId("cta-view-bag")).toContainText("(2)");

      await openBag(page, async () => {
        await capture(page, `offers-${mode}-12-foryou`);
        // An in-cart suggestion's count pill sits clear of every glyph of
        // the card (at the top-left it hid the name's first letters).
        const pills = page.locator('[data-testid^="foryou-card-"]').filter({
          has: page.locator("span.bg-tb-purple"),
        });
        await expect(pills).toHaveCount(2);
        for (const card of await pills.all()) {
          expect.soft(await textUnderPill(card), "text under the count pill").toBe("");
        }
      });
      await expect(bagRow(page, GREEK_SALAD)).toBeVisible();
      await capture(page, `offers-${mode}-13-bag`);
      const rail = page.getByTestId("bag-rail");
      await rail.scrollIntoViewIfNeeded();
      await expect(rail.getByTestId(`bag-rail-item-${TORTILLA_SAUCE}`)).toBeVisible();
      await capture(page, `offers-${mode}-14-bag-rail`);
      await page.getByTestId("bag-total").scrollIntoViewIfNeeded();
      await capture(page, `offers-${mode}-15-bag-totals`);

      const burgerRow = bagRow(page, CHEESE_BURGER);
      await burgerRow.scrollIntoViewIfNeeded();
      const itemId = ((await burgerRow.getAttribute("data-testid")) ?? "").replace("bag-row-", "");
      await page.getByTestId(`bag-dec-${itemId}`).click();
      await expect(page.getByTestId("remove-item-modal")).toBeVisible();
      await capture(page, `offers-${mode}-16-remove-item`);
    });

    test(`REWARDS (${mode}): the rewards sheet (1:3824/1:3858), the celebration, the applied row (1:3924/1:3137)`, async ({
      page,
    }) => {
      test.slow();
      // The celebration lasts 2.2 s: the clock is held for its shot.
      await page.clock.install();
      await mockKioskBackend(page, { offers: REWARDS_OFFERS });
      await startOrder(page, mode);
      await addBurger(page);
      await openBag(page);
      await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
      await openRewards(page);
      await expect(page.getByTestId(`offer-row-nudge-${PERCENT_25._id}`)).toBeVisible();
      await capture(page, `offers-${mode}-17-rewards-sheet`);
      // The header bell and the six row thumbs are bells, not squares.
      expect
        .soft(await bellMasks(page.getByTestId("rewards-sheet")), "rewards sheet bells")
        .toEqual({ bells: 6, unmasked: 0 });
      const rail = page.getByTestId("offer-suggested-rail");
      await rail.scrollIntoViewIfNeeded();
      await capture(page, `offers-${mode}-18-rewards-sheet-rail`);

      await page.getByTestId(`offer-row-${FLAT_2._id}`).scrollIntoViewIfNeeded();
      const now = await page.evaluate(() => Date.now());
      await page.clock.pauseAt(now + 1_000);
      await pickAndSave(page, FLAT_2._id);
      const card = page.getByTestId("offer-applied-celebration");
      await stepClockUntil(page, () => card.isVisible());
      await capture(page, `offers-${mode}-19-celebration`);
      await page.clock.resume();
      await expect(card).toHaveCount(0, { timeout: 10_000 });
      await page.getByTestId("bag-rewards-applied").scrollIntoViewIfNeeded();
      await capture(page, `offers-${mode}-20-bag-reward-applied`);
      expect
        .soft(await bellMasks(page.getByTestId("bag-rewards-applied")), "applied row bell")
        .toEqual({ bells: 1, unmasked: 0 });
    });

    test(`FREEBIE (${mode}): the group-mode picker, the in-bag freebie PDP, the picker's group controls`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page, { offers: [PICK_2_SIDES] });
      await startOrder(page, mode);
      await addBurger(page);
      await openBag(page);
      await openRewards(page);
      await pickAndSave(page, PICK_2_SIDES._id);
      const picker = page.getByTestId("freebie-picker");
      await expect(picker).toBeVisible();
      await expect(page.getByTestId("freebie-group-hint")).not.toBeEmpty();
      await capture(page, `offers-${mode}-21-freebie-group`);

      await page.getByTestId(`freebie-option-${CHEESE_BURGER}`).click();
      const host = page.getByTestId("offer-tier-host");
      await expect(host.getByTestId("customization-screen")).toHaveAttribute("data-embedded", "true");
      await host.getByTestId(`pdp-option-${EXTRA_PICKLES}`).click();
      await capture(page, `offers-${mode}-22-freebie-pdp`);
      await host.getByTestId("pdp-add-to-bag").click();
      await expect(host).toHaveCount(0);

      await page.getByTestId(`freebie-option-${GREEK_SALAD}`).click();
      await expect(page.getByTestId("freebie-group-hint")).toBeEmpty();
      await expect(page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`)).toBeDisabled();
      await capture(page, `offers-${mode}-23-freebie-group-picked`);
    });

    test(`BUY STAGE (${mode}): the BOGO stage locked and unlocked, the least-value stage`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page, { offers: [BOGO_SAUCE, LEAST_SAUCES] });
      await startOrder(page, mode);
      await addBurger(page);
      await openBag(page);
      await openRewards(page);
      await expect(page.getByTestId(`offer-row-add-items-${LEAST_SAUCES._id}`)).toBeVisible();
      await capture(page, `offers-${mode}-24-rewards-add-items`);
      await page.getByTestId(`offer-row-add-items-${BOGO_SAUCE._id}`).click();
      const stage = page.getByTestId("buy-stage-sheet");
      await expect(stage).toBeVisible();
      await expect(page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`)).toBeVisible();
      // A tap on the locked CONTINUE names the gap inline.
      await page.getByTestId("buy-stage-continue").click({ force: true });
      await expect(page.getByTestId("buy-stage-hint")).not.toBeEmpty();
      await capture(page, `offers-${mode}-25-buy-stage`);

      await page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`).click();
      await page.getByTestId(`buy-stage-inc-${TORTILLA_SAUCE}`).click();
      await expect(page.getByTestId("buy-stage-unlocked")).toBeVisible();
      await capture(page, `offers-${mode}-26-buy-stage-unlocked`);

      // BACK rolls the stage back to the list; the least-value stage next.
      await page.getByTestId("buy-stage-back").click();
      await expect(page.getByTestId("rewards-sheet")).toBeVisible();
      await page.getByTestId(`offer-row-add-items-${LEAST_SAUCES._id}`).click();
      await expect(page.getByTestId("buy-stage-least-note")).toBeVisible();
      // The 70-character bowl's tile on screen: its name meets the
      // two-line box (the probe would see a sliced third line).
      await page.getByTestId(`buy-stage-tile-${GREEK_SALAD}`).scrollIntoViewIfNeeded();
      await capture(page, `offers-${mode}-27-buy-stage-least`);
    });

    test(`REMOVED (${mode}): the single-pick freebie picker, the reward-removed notice`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page, { offers: [FREE_SAUCE] });
      await startOrder(page, mode);
      await addBurger(page);
      await openBag(page);
      await openRewards(page);
      await pickAndSave(page, FREE_SAUCE._id);
      await page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`).click();
      await capture(page, `offers-${mode}-28-freebie-single`);
      await page.getByTestId("freebie-confirm").click();
      await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
      await expect(page.getByTestId("bag-rewards-applied")).toBeVisible();

      // The only paid row goes: the freebie offer goes with it, noticed.
      const burgerRow = bagRow(page, CHEESE_BURGER);
      const itemId = ((await burgerRow.getAttribute("data-testid")) ?? "").replace("bag-row-", "");
      await page.getByTestId(`bag-dec-${itemId}`).click();
      await page.getByTestId("remove-item-confirm").click();
      const notice = page.getByTestId("offer-removal-notice");
      await expect(notice).toBeVisible();
      await expect(notice).toContainText(FREE_SAUCE.name);
      await capture(page, `offers-${mode}-29-reward-removed`);
    });
  }
});
