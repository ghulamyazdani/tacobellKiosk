import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Lane offers, item 32 — CUSTOMIZABLE freebies in the freebie picker, plus the
 * G2 routing fix: tapping a customizable option opens the real PDP INSIDE the
 * bag (OfferTierHost, URL stays /cart, no stepper, a CTA with no price claim),
 * the customised item is held until CONFIRM, and a single "and" customizable
 * freebie goes through the picker instead of the old £0 atomic swap. The same
 * routing gate refuses an item offer with nothing to grant (decision 2, E5).
 *
 * Same registered-device mocked backend as offers.spec.ts: mockKioskBackend /
 * bootRegisteredToMenu / addCheeseBurgerViaPdp / openBag are copied from it
 * (established precedent), plus the print agent abort. Each test registers
 * its OWN get_cx_valid_offers route after the mocks (newest wins); getItems
 * entries carry no `type`, as the backend sends them.
 *
 * Money (bill engine — offers.spec.ts header): VAT 15% EXCLUSIVE on the paid
 * base; redeemGetItem frees the BASE price and charges add-ons in full
 * (discountOnAddon off, the default):
 * - E1 paid burger 8 + free burger with +Extra Pickles (9 undiscounted, £1
 *   charged): Sub £17.00, Discounts −£8.00, VAT 15% × 9 = 1.35 → 10.35 →
 *   £10.00.
 * - E2 / E4 paid burger 8 + free plain burger (8, £0): Sub £16.00, −£8.00,
 *   VAT 1.20 → 9.20 → £9.00. (Before the G2 fix this SAVE swapped the offer
 *   on with NO row: Discounts £0, the customer got nothing.)
 * - E6 (G3) paid burger 8 + free Greek Salad (17) + free Caesar (2): Sub
 *   £27.00, Discounts −£19.00, VAT 1.20 → 9.20 → £9.00.
 * - E7 (G3) paid burger 8 + free burger with +Extra Pickles (9, £1 charged)
 *   + free Greek Salad (17): Sub £34.00, −£25.00, VAT 1.35 → 10.35 → £10.00.
 * - E10 (G3 + reload) paid burger 8 + free Greek Salad (17) + free Tortilla
 *   Sauce (2): the E6 bill, −£19.00 and £9.00, before AND after the reload.
 * The bag renders U+2212 MINUS SIGN on the Discounts line (MINUS below).
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

// ---- Slim-menu ids ----
const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8, 3 addon groups
const EXTRA_PICKLES = "5dd1093f188e72ce1b3eb36e"; // Cheese Burger add-on, +£1
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b"; // £2, plain
const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // £17, plain
const CAESAR_DRESSING = "5dd109392b29ee1f2a82a49c"; // £2, plain
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa"; // £9, ONE optional modifier group → customizable

/** U+2212 MINUS SIGN — the literal character the bag renders, NOT a hyphen. */
const MINUS = "−";

// ---- Offer payloads (production-shaped getItems entries: no `type`) ----
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const getEntry = (
  _id: string,
  baseItemId: string,
  name: string,
  relation: "and" | "or"
) => ({ _id, baseItemId, name, relation, discountType: "percent", value: 100, quantity: 1 });
/** A getItemOnly freebie on the stock free-salad offer's shape (offers.json[2]). */
const freebieOffer = (over: Record<string, unknown>) => ({
  ...clone(offersFixture[2]),
  ...over,
});

/** "or": a customizable Cheese Burger OR a plain Tortilla Sauce, free. */
const FREE_BURGER_OR_SAUCE = freebieOffer({
  _id: "offer-free-burger-or-sauce",
  name: "Free burger or sauce",
  getItems: {
    items: [
      getEntry("gi-or-burger", CHEESE_BURGER, "Cheese Burger", "or"),
      getEntry("gi-or-sauce", TORTILLA_SAUCE, "Tortilla Sauce", "or"),
    ],
    categories: [],
  },
});

/** G2: a single "and" CUSTOMIZABLE freebie. */
const FREE_BURGER = freebieOffer({
  _id: "offer-free-burger",
  name: "Free Cheese Burger",
  getItems: {
    items: [getEntry("gi-and-burger", CHEESE_BURGER, "Cheese Burger", "and")],
    categories: [],
  },
});

/**
 * Decision 2: an item offer with NOTHING to grant — the `getItems: {}` an
 * auto-applied ITEM offer arrives with. Its discount exists only as freebie
 * rows, so a swap would show it applied at £0; SAVE must refuse it inline.
 */
const FREE_NOTHING = freebieOffer({
  _id: "offer-free-nothing",
  name: "Free item, nothing resolved",
  getItems: {},
});

/**
 * G3: a group-wise "pick 2" over FOUR candidates (three plain + the
 * customizable burger), production-shaped — the POS group-wise form is
 * OR-only and has no Qty / Value per get item, so every entry is "or" with a
 * null quantity and the discount lives in buygetGroupWiseOfferValues. Before
 * G3 the picker took this as a one-pick "or" and committed the pick at
 * quantity null: no freebie row, the offer on at £0 (and an "and" list
 * landed EVERY entry free).
 */
const groupEntry = (_id: string, baseItemId: string, name: string) => ({
  _id,
  baseItemId,
  name,
  relation: "or",
  discountType: "percent",
  value: "",
  quantity: null,
});
const PICK_2_SIDES = freebieOffer({
  _id: "offer-gw-pick-2",
  name: "Buy a burger, pick 2 free sides",
  getItemOnly: false,
  buygetGroupWiseOffer: true,
  buygetGroupWiseOfferValues: {
    discountType: "percent",
    value: 100,
    getQuantity: 2,
    buyQuantity: 1,
  },
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [{ item: { baseItemId: CHEESE_BURGER, name: "Cheese Burger" } }],
  },
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

/**
 * "Get 2" over ONE customizable entry: one customization per entry (no
 * per-unit customization yet), so the group can never fill.
 */
const TWO_FREE_FRIES = {
  ...PICK_2_SIDES,
  _id: "offer-gw-two-fries",
  name: "Buy a burger, get 2 free Large Fries",
  getItems: {
    items: [groupEntry("gi-gw-fries", LARGE_FRIES, "Large Fries")],
    categories: [],
  },
};

/** Wipe the Dexie cart mirror (KioskDB.cartItems) under the running app. */
function clearDexieCart(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("KioskDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("cartItems", "readwrite");
          tx.objectStore("cartItems").clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      })
  );
}

/**
 * Boot + menu mocks (copied from offers.spec.ts). Order matters: Playwright
 * matches routes newest-first, so the catch-all is registered FIRST and every
 * specific mock after it. The print agent is cross-origin (the catch-all
 * misses it) and is aborted so nothing can reach real hardware.
 */
async function mockKioskBackend(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
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

/** This spec's own offers (a raw array), registered after the mocks: newest wins. */
async function routeOffers(page: Page, offers: unknown[]) {
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: offers }));
}

/** Register on the on-screen keyboard and land on /menu (copied from offers.spec.ts). */
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

/** Menu card tap → PDP → commit plain (£8) → dismiss the added modal (copied from offers.spec.ts). */
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

/** VIEW MY BAG → /cart, walking through the first-open /forYou upsell (copied from offers.spec.ts). */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

const bagRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');

/** Rewards entry → radio-pick → SAVE: a freebie offer with a choice opens the picker. */
async function saveOfferToPicker(page: Page, offerId: string) {
  await page.getByTestId("bag-rewards-entry").click();
  await expect(page.getByTestId("rewards-sheet")).toBeVisible();
  await page.getByTestId(`offer-row-${offerId}`).click();
  await expect(page.getByTestId(`offer-row-${offerId}`)).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await page.getByTestId("rewards-save").click();
  await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
  await expect(page.getByTestId("freebie-picker")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

/** The embedded freebie PDP: in the bag, no stepper, no price claim, no CANCEL ORDER. */
async function expectEmbeddedFreebiePdp(page: Page): Promise<Locator> {
  const host = page.getByTestId("offer-tier-host");
  await expect(host).toBeVisible();
  await expect(host.getByTestId("customization-screen")).toHaveAttribute(
    "data-embedded",
    "true"
  );
  await expect(host.getByTestId("pdp-qty")).toHaveCount(0);
  await expect(host.getByTestId("pdp-add-to-bag")).toHaveText("ADD TO REWARD");
  await expect(host.getByTestId("footer-cancel")).toHaveCount(0);
  await expect(page).toHaveURL(/\/cart$/);
  return host;
}

/** What the store holds for the picker: staged freebies, the slot, the tier session. */
const readOfferStaging = (page: Page) =>
  page.evaluate(() => {
    const state = (
      window as unknown as {
        __kioskStore: {
          getState: () => {
            cart: { getItems?: unknown[]; cartOffer?: Record<string, unknown> | null };
            makeItAMeal: { makeItAMealModal: { isMakeItAMealSessionActive?: boolean } };
          };
        };
      }
    ).__kioskStore.getState();
    return {
      staged: state.cart.getItems?.length ?? 0,
      slotTaken: Object.keys(state.cart.cartOffer ?? {}).length > 0,
      tierSession: Boolean(state.makeItAMeal.makeItAMealModal.isMakeItAMealSessionActive),
    };
  });

// ---- ADA geometry (mirrors tests/e2e/ada.spec.ts / KioskStage.tsx) ----
const STAGE_WIDTH = 1080;
const STAGE_HEIGHT = 1920;
const ADA_BRAND_ZONE_HEIGHT = 798;
const ZONE_BOX = {
  x: 0,
  y: ADA_BRAND_ZONE_HEIGHT,
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT - ADA_BRAND_ZONE_HEIGHT,
};

/** The element's box in stage DESIGN px (KioskStage scale divided out), to 1px (copied from ada.spec.ts). */
function stageBox(locator: Locator) {
  return locator.evaluate((el, stageHeight) => {
    const stage = document.querySelector('[data-testid="kiosk-stage"]');
    if (!stage) throw new Error("kiosk-stage is not mounted");
    const s = stage.getBoundingClientRect();
    const k = s.height / stageHeight;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round((b.left - s.left) / k),
      y: Math.round((b.top - s.top) / k),
      width: Math.round(b.width / k),
      height: Math.round(b.height / k),
    };
  }, STAGE_HEIGHT);
}

/** A tap at the control's centre reaches the control itself (nothing paints over it). */
function isUncoveredAtCentre(locator: Locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && el.contains(hit);
  });
}

test.describe("Lane offers — customizable freebies (item 32)", () => {
  test("E1 'or' offer: the burger opens the in-bag PDP → +Extra Pickles → ADD TO REWARD (no price) → picked 'Customized' at £1.00 → CONFIRM: Free row £1.00 struck £9.00, Discounts −£8.00, Total £10.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [FREE_BURGER_OR_SAUCE]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await saveOfferToPicker(page, FREE_BURGER_OR_SAUCE._id);

    // Customizable row: enabled, "Customize", no price pair until customised.
    const burgerOption = page.getByTestId(`freebie-option-${CHEESE_BURGER}`);
    await expect(burgerOption).toBeEnabled();
    await expect(burgerOption).toHaveAttribute("aria-pressed", "false");
    await expect(burgerOption).toContainText("Customize");
    await expect(burgerOption).not.toContainText("£");
    await expect(page.getByTestId("freebie-confirm")).toHaveAttribute("aria-disabled", "true");

    await burgerOption.click();
    const host = await expectEmbeddedFreebiePdp(page);
    await host.getByTestId(`pdp-option-${EXTRA_PICKLES}`).click();
    // Still no price claim: the offer prices the pick at CONFIRM.
    await expect(host.getByTestId("pdp-add-to-bag")).toHaveText("ADD TO REWARD");
    await host.getByTestId("pdp-add-to-bag").click();
    await expect(host).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);

    // Held, not committed: the picker shows it picked, priced as CONFIRM will.
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(burgerOption).toHaveAttribute("aria-pressed", "true");
    await expect(burgerOption).toContainText("Customized");
    await expect(burgerOption.locator(".line-through")).toHaveText("£9.00");
    await expect(burgerOption).toContainText("£1.00");
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);

    // CONFIRM is a customer apply: it celebrates (item 33) with the live
    // saving — checked first, the card is 2.2 s.
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("offer-applied-celebration")).toBeVisible();
    await expect(page.getByTestId("offer-applied-celebration")).toContainText(
      "You save £8.00"
    );
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);

    await expect(bagRows(page)).toHaveCount(2);
    const freeRow = bagRows(page).filter({
      has: page.locator('[data-testid^="bag-free-chip-"]'),
    });
    await expect(freeRow).toHaveCount(1);
    await expect(freeRow).toContainText("Cheese Burger");
    await expect(freeRow).toContainText("Extra Pickles");
    await expect(freeRow.locator(".line-through")).toHaveText("£9.00");
    await expect(freeRow).toContainText("£1.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£17.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£8.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£10.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£10.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(
      FREE_BURGER_OR_SAUCE.name
    );
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: true,
      tierSession: false,
    });
  });

  test("E2 G2: a single 'and' customizable freebie — SAVE opens the picker (no £0 swap, nothing applied); customise + CONFIRM → Discounts −£8.00, Total £9.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [FREE_BURGER]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await saveOfferToPicker(page, FREE_BURGER._id);

    // The old route swapped the offer on with no row (£0). Now: nothing
    // applied until the customer customises and confirms.
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId("freebie-confirm")).toHaveAttribute("aria-disabled", "true");
    expect((await readOfferStaging(page)).slotTaken).toBe(false);

    const burgerOption = page.getByTestId(`freebie-option-${CHEESE_BURGER}`);
    await burgerOption.click();
    const host = await expectEmbeddedFreebiePdp(page);
    await host.getByTestId("pdp-add-to-bag").click();
    await expect(host).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(burgerOption).toContainText("Customized");
    await expect(page.getByTestId("freebie-confirm")).not.toHaveAttribute(
      "aria-disabled",
      "true"
    );

    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(2);
    const freeRow = bagRows(page).filter({
      has: page.locator('[data-testid^="bag-free-chip-"]'),
    });
    await expect(freeRow.locator(".line-through")).toHaveText("£8.00");
    await expect(freeRow).toContainText("£0.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£16.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£8.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(FREE_BURGER.name);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(`${MINUS}£8.00`);
  });

  test("E3 PDP BACK keeps the picker intact with nothing staged; X after a held customisation applies nothing and leaves no orphan rows or tier session", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [FREE_BURGER_OR_SAUCE]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await saveOfferToPicker(page, FREE_BURGER_OR_SAUCE._id);

    const burgerOption = page.getByTestId(`freebie-option-${CHEESE_BURGER}`);
    await burgerOption.click();
    const host = await expectEmbeddedFreebiePdp(page);
    await host.getByTestId("pdp-back").click();
    await expect(host).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(page.locator('[data-testid^="freebie-option-"]')).toHaveCount(2);
    await expect(burgerOption).toHaveAttribute("aria-pressed", "false");
    await expect(burgerOption).not.toContainText("Customized");
    await expect(page.getByTestId("freebie-confirm")).toHaveAttribute("aria-disabled", "true");
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: false,
      tierSession: false,
    });

    // Hold a customisation, then walk away with X.
    await burgerOption.click();
    await (await expectEmbeddedFreebiePdp(page)).getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("offer-tier-host")).toHaveCount(0);
    await expect(burgerOption).toContainText("Customized");
    expect((await readOfferStaging(page)).staged).toBe(1);

    await page.getByTestId("freebie-close").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: false,
      tierSession: false,
    });
  });

  test("E4 ADA on: the embedded freebie PDP fills the 1122 px reach zone and its ADD TO REWARD sits inside it, uncovered and clickable → CONFIRM → Discounts −£8.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    // The tenant's ADA gate (ada.spec.ts), layered over the copied mocks.
    await page.route("**/api/cx/get_kiosk_settings", (r) =>
      r.fulfill({
        json: {
          start_order_text_primary: "START ORDER",
          ideal_time: "180",
          accessibility_mode: true,
        },
      })
    );
    await routeOffers(page, [FREE_BURGER]);
    await bootRegisteredToMenu(page);
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("footer-ada")).toHaveAttribute("aria-pressed", "true");
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await saveOfferToPicker(page, FREE_BURGER._id);
    await page.getByTestId(`freebie-option-${CHEESE_BURGER}`).click();
    const host = await expectEmbeddedFreebiePdp(page);

    // Geometry in stage design px (ada.spec.ts constants): the zone is the
    // bottom 1122 px under the 798 px brand panel; the host fills it.
    await expect.poll(() => stageBox(host)).toEqual(ZONE_BOX);
    const cta = host.getByTestId("pdp-add-to-bag");
    await expect(cta).toBeVisible();
    const box = await stageBox(cta);
    expect(box.y).toBeGreaterThanOrEqual(ZONE_BOX.y);
    expect(box.y + box.height).toBeLessThanOrEqual(ZONE_BOX.y + ZONE_BOX.height);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await isUncoveredAtCentre(cta)).toBe(true);

    await cta.click();
    await expect(host).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId(`freebie-option-${CHEESE_BURGER}`)).toContainText(
      "Customized"
    );
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£8.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });

  test("E5 decision 2: an item offer whose get side resolved to nothing is refused inline on SAVE — the list stays open, nothing applied, never a £0 'Reward applied!'", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [FREE_NOTHING]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);

    await page.getByTestId("bag-rewards-entry").click();
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await page.getByTestId(`offer-row-${FREE_NOTHING._id}`).click();
    await expect(page.getByTestId(`offer-row-${FREE_NOTHING._id}`)).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("rewards-not-applicable")).toHaveText(
      "This reward can't be applied to your current order"
    );
    // One-shot right after the refusal rendered: no card was ever opened.
    expect(await page.getByTestId("offer-applied-celebration").count()).toBe(0);
    await expect(page.getByTestId("rewards-sheet")).toBeVisible();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: false,
      tierSession: false,
    });

    await page.getByTestId("rewards-close").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
  });
  test("E6 G3 group-wise 'pick 2' of 4 (production entries: 'or', no quantity): CONFIRM is locked with a hint until exactly 2, the other rows lock at 2, '−' swaps a pick; CONFIRM grants exactly the 2 picks — Discounts −£19.00, Total £9.00", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [PICK_2_SIDES]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await saveOfferToPicker(page, PICK_2_SIDES._id);

    const option = (id: string) => page.getByTestId(`freebie-option-${id}`);
    const hint = page.getByTestId("freebie-group-hint");
    const confirm = page.getByTestId("freebie-confirm");
    await expect(page.getByTestId("freebie-picker")).toContainText(
      "Select 2 items to redeem with your reward."
    );
    await expect(hint).toHaveText("Select 2 more items to continue");
    await expect(confirm).toHaveAttribute("aria-disabled", "true");

    await option(GREEK_SALAD).click();
    await expect(hint).toHaveText("Select 1 more item to continue");
    await option(TORTILLA_SAUCE).click();
    await expect(hint).toBeEmpty();
    await expect(confirm).toHaveAttribute("aria-disabled", "false");
    // A third pick is impossible: the unpicked rows are locked.
    await expect(option(CAESAR_DRESSING)).toBeDisabled();
    await expect(option(CHEESE_BURGER)).toBeDisabled();

    // "−" frees the slot: swap the sauce for the dressing.
    await page.getByTestId(`freebie-dec-${TORTILLA_SAUCE}`).click();
    await expect(option(TORTILLA_SAUCE)).toHaveAttribute("aria-pressed", "false");
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await option(CAESAR_DRESSING).click();
    await expect(confirm).toHaveAttribute("aria-disabled", "false");

    await confirm.click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    // The paid burger + EXACTLY the two picks.
    await expect(bagRows(page)).toHaveCount(3);
    const freeRows = bagRows(page).filter({
      has: page.locator('[data-testid^="bag-free-chip-"]'),
    });
    await expect(freeRows).toHaveCount(2);
    await expect(freeRows.filter({ hasText: "Greek Salad" })).toHaveCount(1);
    await expect(freeRows.filter({ hasText: "Caesar Dressing" })).toHaveCount(1);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£27.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£19.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(PICK_2_SIDES.name);
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: true,
      tierSession: false,
    });
  });

  test("E7 G3 group-wise with a customizable candidate: the burger is ONE pick customised in the in-bag PDP (+Extra Pickles), the salad the other — Discounts −£25.00, Total £10.00, the URL stays /cart", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [PICK_2_SIDES]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await saveOfferToPicker(page, PICK_2_SIDES._id);

    const burgerOption = page.getByTestId(`freebie-option-${CHEESE_BURGER}`);
    await expect(burgerOption).toContainText("Customize");
    await burgerOption.click();
    const host = await expectEmbeddedFreebiePdp(page);
    await host.getByTestId(`pdp-option-${EXTRA_PICKLES}`).click();
    await host.getByTestId("pdp-add-to-bag").click();
    await expect(host).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);

    // Held: one unit of the two, priced as CONFIRM will charge it.
    await expect(burgerOption).toHaveAttribute("aria-pressed", "true");
    await expect(burgerOption).toContainText("Customized");
    await expect(burgerOption).toContainText("£1.00");
    await expect(page.getByTestId("freebie-group-hint")).toHaveText(
      "Select 1 more item to continue"
    );
    await page.getByTestId(`freebie-option-${GREEK_SALAD}`).click();
    await expect(page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`)).toBeDisabled();

    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(3);
    const freeRows = bagRows(page).filter({
      has: page.locator('[data-testid^="bag-free-chip-"]'),
    });
    await expect(freeRows).toHaveCount(2);
    const freeBurger = freeRows.filter({ hasText: "Cheese Burger" });
    await expect(freeBurger).toContainText("Extra Pickles");
    await expect(freeBurger.locator(".line-through")).toHaveText("£9.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£34.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£25.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£10.00");
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: true,
      tierSession: false,
    });
  });

  test("E8 G3 'get 2' over ONE customizable entry (Large Fries: one optional modifier group) can never fill — the picker says it can't be applied up front, the row is locked (no PDP), CONFIRM stays locked; X leaves nothing applied", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [TWO_FREE_FRIES]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await saveOfferToPicker(page, TWO_FREE_FRIES._id);

    await expect(page.getByTestId("freebie-group-hint")).toHaveText(
      "This reward can't be applied to your current order"
    );
    await expect(page.getByTestId(`freebie-option-${LARGE_FRIES}`)).toBeDisabled();
    await expect(page.getByTestId("freebie-confirm")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("offer-tier-host")).toHaveCount(0);

    await page.getByTestId("freebie-close").click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: false,
      tierSession: false,
    });
  });

  test("E9 the Dexie cart lost under a persisted group-wise reward: a reload on /cart exits to /menu with 'Reward Removed' once the rehydrate settles — never a −£0.00 reward left in the slot; a fresh SAVE then opens the picker", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [PICK_2_SIDES]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await saveOfferToPicker(page, PICK_2_SIDES._id);
    await page.getByTestId(`freebie-option-${GREEK_SALAD}`).click();
    await page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`).click();
    await page.getByTestId("freebie-confirm").click();
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£19.00`);

    // A lost Dexie write / a crash between the two stores: the rows are
    // gone, the redux-persisted reward is not.
    await clearDexieCart(page);
    await page.reload();
    await expect(page.getByTestId("offer-removal-notice")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: false,
      tierSession: false,
    });
    await page.getByTestId("offer-removal-gotit").click();
    await expect(page.getByTestId("offer-removal-notice")).toHaveCount(0);

    // The guest starts again: nothing stale in the slot, so SAVE works.
    // (Post-reload money is matched without "£" — offerAutoApply.spec E9.)
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("added-continue").click();
    await openBag(page);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await saveOfferToPicker(page, PICK_2_SIDES._id);
    await expect(page.getByTestId("freebie-group-hint")).toHaveText(
      "Select 2 more items to continue"
    );
  });

  test("E10 G3 + crash-reload: a tap on the locked CONFIRM commits nothing and a double tap on the last open slot adds ONE unit; after CONFIRM a reload on /cart keeps the bag, the paid burger, exactly the 2 free picks and the reward (Discounts 19.00, Total 9.00, no 'Reward Removed'); removing the burger then really empties the bag — the reward goes with its notice, the bag exits to /menu", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await routeOffers(page, [PICK_2_SIDES]);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await saveOfferToPicker(page, PICK_2_SIDES._id);

    const option = (id: string) => page.getByTestId(`freebie-option-${id}`);
    const hint = page.getByTestId("freebie-group-hint");
    const confirm = page.getByTestId("freebie-confirm");

    // Fewer than N: the guest's tap on the dimmed CONFIRM lands nothing
    // (force: Playwright treats aria-disabled as not clickable).
    await option(GREEK_SALAD).click();
    await expect(hint).toHaveText("Select 1 more item to continue");
    await confirm.click({ force: true });
    await expect(page.getByTestId("freebie-picker")).toBeVisible();
    await expect(hint).toHaveText("Select 1 more item to continue");
    expect((await readOfferStaging(page)).slotTaken).toBe(false);

    // More than N is impossible: the browser renders between the two taps,
    // so the second one finds the group full (unit test: a same-render burst).
    await option(TORTILLA_SAUCE).dblclick();
    await expect(option(TORTILLA_SAUCE)).toHaveAttribute("aria-pressed", "true");
    await expect(option(TORTILLA_SAUCE)).not.toContainText("2 x");
    await expect(hint).toBeEmpty();
    await expect(option(CAESAR_DRESSING)).toBeDisabled();
    await expect(confirm).toHaveAttribute("aria-disabled", "false");

    await confirm.click();
    await expect(page.getByTestId("freebie-picker")).toHaveCount(0);
    await expect(bagRows(page)).toHaveCount(3);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£19.00`);
    await expect(page.getByTestId("bag-total")).toHaveText("£9.00");

    // Crash-reload on /cart: the first render has the persisted reward but
    // not yet the Dexie rows — the bag waits for them instead of exiting.
    // (Post-reload money may lack "£" until get_data — E9.)
    await page.reload();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(bagRows(page)).toHaveCount(3);
    await expect(page).toHaveURL(/\/cart$/);
    const freeRows = bagRows(page).filter({
      has: page.locator('[data-testid^="bag-free-chip-"]'),
    });
    await expect(freeRows).toHaveCount(2);
    await expect(freeRows.filter({ hasText: "Greek Salad" })).toHaveCount(1);
    await expect(freeRows.filter({ hasText: "Tortilla Sauce" })).toHaveCount(1);
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(PICK_2_SIDES.name);
    await expect(page.getByTestId("bag-discounts")).toHaveText(new RegExp(`^${MINUS}£?19\\.00$`));
    await expect(page.getByTestId("bag-total")).toHaveText(/^£?9\.00$/);
    await expect(page.getByTestId("offer-removal-notice")).toHaveCount(0);
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: true,
      tierSession: false,
    });

    // A REAL empty still exits: the burger (the only paid row) goes, the
    // reward follows with its notice, its free rows are swept, /menu.
    const burgerRow = bagRows(page).filter({ hasText: "Cheese Burger" });
    const burgerItemId = ((await burgerRow.getAttribute("data-testid")) ?? "").replace(
      "bag-row-",
      ""
    );
    await page.getByTestId(`bag-dec-${burgerItemId}`).click();
    await expect(page.getByTestId("remove-item-modal")).toBeVisible();
    await page.getByTestId("remove-item-confirm").click();
    const notice = page.getByTestId("offer-removal-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Reward Removed");
    await expect(notice).toContainText(PICK_2_SIDES.name);
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    expect(await readOfferStaging(page)).toEqual({
      staged: 0,
      slotTaken: false,
      tierSession: false,
    });
  });
});
