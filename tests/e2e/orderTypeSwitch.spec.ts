import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mockCheckoutBackend,
  type CheckoutMockHandle,
  type CheckoutMockOptions,
} from "./fixtures/checkout";
import {
  mockXenoLoyalty,
  LOYALTY_OTP,
  LOYALTY_PHONE,
  LOYALTY_POINTS_TOTAL,
  LOYALTY_REWARDS,
  LOYALTY_SETTINGS,
  type XenoMockHandle,
} from "./fixtures/loyalty";

/**
 * Lane bag-pdp, item 19 (decision D1, design language — flagged for client
 * sign-off): the bag's EAT IN / TAKE OUT toggle switches the order type
 * mid-order. Confirm → in-flight (idle held, every request bounded) → the
 * target tab's charges + menu (offers, out-of-stock inside) are fetched with
 * every write STAGED, and only a full success commits — in ONE burst — the
 * /second selection, the staged data and the re-priced bag. A failed or
 * timed-out fetch changes nothing (failure dialog: TRY AGAIN / BACK). Rows the
 * new tab does not serve are removed and named in a notice that survives the
 * bag's empty-cart exit; an applied offer follows D1a (kept and re-checked
 * when the new tab offers it, else dropped with the standard removal notice);
 * an offers-fetch failure aborts the switch (D1b).
 *
 * ── TWO TABS ────────────────────────────────────────────────────────────
 * p1 dine_in / t1 serves the slim menu with no charges. p2 take_away / t2
 * serves a clone with Cheese Burger at £9 and Greek Salad (by default) not
 * served, plus one fixed, untaxed £2 bag fee from get_data. getMenu and
 * get_data are routed on the request body's tab_id, get_cx_valid_offers on
 * its tab_type.
 *
 * ── MONEY (bag.spec.ts / offers.spec.ts headers) ───────────────────────
 * Items carry VAT@15% treated as EXCLUSIVE; the Total rounds to whole units.
 * - t1, burger £8 + salad £17: Sub £25.00, Total round(28.75) = £29.00.
 * - t2, burger £9 (salad removed): Sub £9.00, Total round(9 × 1.15 + 2 =
 *   12.35) = £12.00 — £10.00 if the bag fee were missing.
 * - flat £2 on t1, burger £8: Total round(6 × 1.15 = 6.90) = £7.00; kept on
 *   t2: Sub £9.00, Discounts −£2.00, Total round(7 × 1.15 + 2 = 10.05) =
 *   £10.00.
 *
 * ── MOCK ORDER ──────────────────────────────────────────────────────────
 * House order: the `**\/api/**` catch-all FIRST, then the checkout fixture
 * (print agent aborted, every gateway 500-guarded, the pay-at-counter
 * endpoints), then the specific mocks — newest wins, so the two-pipeline
 * getPipelines here replaces the fixture's single row. Loyalty is off, so
 * nothing reaches xeno.in. Boot helpers are copied from bag.spec.ts (house
 * precedent: no spec exports them). Copy is read from the EN translation
 * files (the lane's strings live in lazy.json), never paraphrased.
 *
 * ── TIME ────────────────────────────────────────────────────────────────
 * Only the HANG test installs Playwright's clock (before the first goto):
 * RTK's request budgets and react-idle-timer run on the page's timers, so
 * the 30 s getMenu budget and the 100 s idle prompt are stepped, never
 * waited (recovery.spec.ts / idle.spec.ts headers).
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
const offersFixture = readJson("./fixtures/offers.json");
const en = readJson("../../src/i18n/locales/en/translation.json");
const enLazy = readJson("../../src/i18n/locales/en/lazy.json");

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json, offers.json) ----
const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8 on t1, £9 on t2
const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // £17, one-tap
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b"; // £2, one-tap
const OFFER_FLAT = "offer-flat-2";
const OFFER_FLAT_NAME = "£2 off your order";

/** U+2212 MINUS SIGN — the literal character the bag renders. */
const MINUS = "−";

/** TB's host-configured budgets (src/redux/app/apiSlice.ts). */
const REQUEST_BUDGET_MS = 10_000;
const MENU_BUDGET_MS = 30_000;
/** P9a idle timing (idle.spec.ts): ideal_time 180 clamps to 120 s, prompt at 100 s. */
const PROMPT_AFTER_MS = 100_000;
const IDLE_TIMEOUT_MS = 120_000;

interface Pipeline {
  _id: string;
  tab_id: string;
  tab_type: string;
  primary_name: string;
}

const EAT_IN: Pipeline = { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" };
const TAKE_OUT: Pipeline = {
  _id: "p2",
  tab_id: "t2",
  tab_type: "take_away",
  primary_name: "Take Away",
};

/** The take-away tab's one charge (get_data): a fixed, untaxed £2 bag fee. */
const T2_CHARGE = {
  _id: "c-t2",
  name: "Bag fee",
  type: "fixed",
  value: 2,
  tabs: [{ _id: "t2", taxes: [] }],
};

interface MenuEntity {
  id: string;
  price: number;
}
interface MenuShape {
  MENU_ID: string;
  categories: { subCategories: { entities: MenuEntity[] }[] }[];
}

/** The take-away tab's menu: Cheese Burger at £9, `removed` not served. */
function takeAwayMenu(removed: readonly string[]): MenuShape {
  const menu = structuredClone(slimMenu) as MenuShape;
  menu.MENU_ID = `${menu.MENU_ID}-t2`;
  for (const category of menu.categories) {
    for (const sub of category.subCategories) {
      sub.entities = sub.entities.filter((entity) => !removed.includes(entity.id));
      for (const entity of sub.entities) {
        if (entity.id === CHEESE_BURGER) entity.price = 9;
      }
    }
  }
  return menu;
}

type Body = Record<string, unknown>;

const bodyOf = (route: Route): Body => {
  try {
    const body: unknown = route.request().postDataJSON();
    return body && typeof body === "object" ? (body as Body) : {};
  } catch {
    return {};
  }
};

interface SwitchMockOptions {
  pipelines?: Pipeline[];
  /** What the take-away tab no longer serves. Default: Greek Salad. */
  removedOnT2?: readonly string[];
  /** get_cx_valid_offers per tab_type; "fail" answers 500. Default: none. */
  offersFor?: (tabType: unknown) => unknown[] | "fail";
  /** Passed to the checkout fixture (e.g. extraDeviceSettings → general settings). */
  checkout?: CheckoutMockOptions;
  /** get_all_pipeline_status body (/second's open-state refresh). Default: the catch-all `{}` = all open. */
  pipelineStatuses?: Record<string, { status: boolean; reason?: string }>;
  /** Loyalty on: LOYALTY_SETTINGS + the Xeno surface (loyalty.spec.ts), registered last. */
  loyalty?: boolean;
}

interface SwitchNet {
  /** How the take-away getMenu answers — flip it mid-test. "hang" parks it. */
  t2Menu: "ok" | "500" | "hang";
  /** How the take-away get_data (charges) answers. */
  t2Charges: "ok" | "500";
  /** The Xeno handle when `loyalty` is on. */
  xeno?: XenoMockHandle;
  /** Parked (hung) take-away getMenu routes — never answered. */
  readonly held: Route[];
  /** Every getMenu / get_data / offers / out-of-stock request, in order. */
  readonly calls: { endpoint: string; body: Body }[];
  checkout: CheckoutMockHandle;
}

async function mockKioskBackend(
  page: Page,
  {
    pipelines = [EAT_IN, TAKE_OUT],
    removedOnT2 = [GREEK_SALAD],
    offersFor,
    checkout: checkoutOptions,
    pipelineStatuses,
    loyalty = false,
  }: SwitchMockOptions = {}
): Promise<SwitchNet> {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Print agent aborted + every gateway 500-guarded (fixture header).
  const checkout = await mockCheckoutBackend(page, checkoutOptions);
  const net: SwitchNet = { t2Menu: "ok", t2Charges: "ok", held: [], calls: [], checkout };
  const t2Menu = takeAwayMenu(removedOnT2);
  const log = (endpoint: string, route: Route) => {
    const body = bodyOf(route);
    net.calls.push({ endpoint, body });
    return body;
  };

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
        // Pay-at-counter fan-out (checkout.spec.ts): PAY → /payment.
        skip_crm_page: true,
        pay_at_counter: "pay_at_counter",
        // Loyalty on routes /second through the /phone lookup (loyalty.spec.ts).
        ...(loyalty ? LOYALTY_SETTINGS : {}),
      },
    })
  );
  if (pipelineStatuses) {
    await page.route("**/api/cx/get_all_pipeline_status", (r) =>
      r.fulfill({ json: pipelineStatuses })
    );
  }
  // After the checkout fixture: its single-row getPipelines must not win.
  await page.route("**/api/cx/kiosk/getPipelines", (r) => r.fulfill({ json: pipelines }));
  await page.route("**/api/cx/kiosk/getMenu", (route) => {
    const body = log("getMenu", route);
    if (body.tab_id !== TAKE_OUT.tab_id) return route.fulfill({ json: slimMenu });
    if (net.t2Menu === "500") {
      return route.fulfill({ status: 500, json: { message: "menu down" } });
    }
    if (net.t2Menu === "hang") {
      // Never answered: the page's own 30 s budget aborts it.
      net.held.push(route);
      return undefined;
    }
    return route.fulfill({ json: t2Menu });
  });
  await page.route("**/api/cx/kiosk/get_out_of_stock", (route) => {
    log("get_out_of_stock", route);
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (route) => {
    const body = log("offers", route);
    const offers = offersFor ? offersFor(body.tab_type) : [];
    if (offers === "fail") {
      return route.fulfill({ status: 500, json: { message: "offers down" } });
    }
    return route.fulfill({ json: offers });
  });
  await page.route("**/api/cx/kiosk/get_data", (route) => {
    const body = log("get_data", route);
    if (body.tab_id === TAKE_OUT.tab_id && net.t2Charges === "500") {
      return route.fulfill({ status: 500, json: { message: "charges down" } });
    }
    return route.fulfill({
      json: {
        charges: body.tab_id === TAKE_OUT.tab_id ? [T2_CHARGE] : [],
        deployment: { countryCode: "GB", currencySettings: { symbol: "£" } },
      },
    });
  });
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
  // Newest route wins: the Xeno surface goes last (loyalty.spec.ts header).
  if (loyalty) net.xeno = await mockXenoLoyalty(page);
  return net;
}

/** Register on the on-screen keyboard and land on /menu as Dine In (copied from bag.spec.ts). */
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

/** Menu card → PDP → commit plain (£8 on t1) → dismiss the added modal (bag.spec.ts). */
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

/** A plain item lands with one tap, no modal (bag.spec.ts). */
async function addOneTap(page: Page, entityId: string, expectedCount: string) {
  const card = page.getByTestId(`item-${entityId}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText(expectedCount);
}

/** VIEW MY BAG → /cart, through the first-open upsell if it shows (bag.spec.ts openBag). */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

/** Burger (PDP) + Greek Salad (one tap) on Dine In, bag open at £25.00 / £29.00. */
async function bootToBagWithBurgerAndSalad(page: Page) {
  await bootRegisteredToMenu(page);
  await addCheeseBurgerViaPdp(page);
  await addOneTap(page, GREEK_SALAD, "(2)");
  await openBag(page);
  await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
  await expect(page.getByTestId("bag-total")).toContainText("£29.00");
}

/**
 * Loyalty on (loyalty.spec.ts helpers): register → START → Dine In → the
 * /phone lookup → /menu as an identified guest, the auto-opened rewards
 * sheet dismissed.
 */
async function bootIdentifiedToMenu(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
  for (const digit of LOYALTY_PHONE) await page.getByTestId(`numpad-key-${digit}`).click();
  await page.getByTestId("phone-continue").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("loyalty-rewards-close").click();
  await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
}

/** Menu rewards link → reward tile → validate → authenticate → OTP → redeem (loyalty.spec.ts). */
async function redeemFromMenu(page: Page, couponCode: string) {
  await page.getByTestId("menu-rewards-link").click();
  await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
  await page.getByTestId(`loyalty-reward-${couponCode}`).click();
  await page.getByTestId("loyalty-redeem").click();
  await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({ timeout: 10_000 });
  for (const digit of LOYALTY_OTP) await page.getByTestId(`numpad-key-${digit}`).click();
  await page.getByTestId("loyalty-otp-submit").click();
  await expect(page.getByTestId("loyalty-success")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("loyalty-success")).toHaveCount(0, { timeout: 10_000 });
}

/** `state.loyalty.totalLoyaltyPoints` from persist:root (loyalty.spec.ts). */
function persistedLoyaltyPoints(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("persist:root");
    if (!raw) return Number.NaN;
    const root = JSON.parse(raw) as Record<string, string>;
    if (!root.loyalty) return Number.NaN;
    return Number((JSON.parse(root.loyalty) as { totalLoyaltyPoints?: number }).totalLoyaltyPoints);
  });
}

const bagRows = (page: Page) => page.locator('[data-testid^="bag-row-"]');
const loyaltyRows = (page: Page) => page.locator('[data-testid^="bag-loyalty-row-"]');
const eatInSegment = (page: Page) => page.getByTestId("bag-ordertype-eatin");
const takeOutSegment = (page: Page) => page.getByTestId("bag-ordertype-takeout");
const idleModal = (page: Page) => page.getByTestId("idle-modal");

/** `{{name}}` interpolation over the EN copy. */
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/{{(\w+)}}/g, (_, key: string) => values[key] ?? "");

const COPY = {
  confirmTitle: fill(enLazy.bag.orderType.confirmTitle, { type: en.bag.takeOut }),
  confirmBody: enLazy.bag.orderType.confirmBody as string,
  confirmYes: enLazy.bag.orderType.confirmYes as string,
  confirmNo: fill(enLazy.bag.orderType.confirmNo, { current: en.bag.eatIn }),
  failedTitle: fill(enLazy.bag.orderType.failedTitle, { type: en.bag.takeOut }),
  failedBody: enLazy.bag.orderType.failedBody as string,
  removedTitle: enLazy.bag.orderType.removedTitle as string,
  removedBody: (items: string) =>
    fill(enLazy.bag.orderType.removedBody, { type: en.bag.takeOut, items }),
};

/** Capture-only screenshot (user decision 2026-10-05): attached for review, never compared. */
async function capture(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

interface KioskView {
  pipelineId?: string;
  tabId?: string;
  tabType?: string;
  charges: (string | undefined)[];
  offerId?: string;
  rows: { id?: string; price?: unknown; quantity?: unknown; isGetItem?: unknown }[];
}

/** The switch's state, read from the DEV-only window.__kioskStore. */
function kioskView(page: Page): Promise<KioskView> {
  return page.evaluate(() => {
    type Row = { id?: string; price?: unknown; quantity?: unknown; isGetItem?: unknown };
    const state = (
      window as unknown as {
        __kioskStore: {
          getState: () => {
            pipeline?: { selectedPipeline?: { _id?: string }; tabType?: string };
            auth?: { tab_id?: string };
            cart?: { cartItems?: Row[]; charges?: { _id?: string }[]; cartOffer?: { _id?: string } };
          };
        };
      }
    ).__kioskStore.getState();
    return {
      pipelineId: state.pipeline?.selectedPipeline?._id,
      tabId: state.auth?.tab_id,
      tabType: state.pipeline?.tabType,
      charges: (state.cart?.charges ?? []).map((charge) => charge?._id),
      offerId: state.cart?.cartOffer?._id,
      rows: (state.cart?.cartItems ?? []).map((row) => ({
        id: row.id,
        price: row.price,
        quantity: row.quantity,
        isGetItem: row.isGetItem,
      })),
    };
  });
}

/** The Dexie cart mirror (KioskDB.cartItems) — what a crash-reload restores. */
function readDexieCart(page: Page): Promise<{ id?: string; price?: unknown }[]> {
  return page.evaluate(
    () =>
      new Promise<{ id?: string; price?: unknown }[]>((resolve, reject) => {
        const open = indexedDB.open("KioskDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction("cartItems", "readonly").objectStore("cartItems").getAll();
          request.onsuccess = () => {
            db.close();
            resolve(
              (request.result as { id?: string; price?: unknown }[]).map((row) => ({
                id: row.id,
                price: row.price,
              }))
            );
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      })
  );
}

/** The redux-persist copy of the selected order type (persist:root → pipeline). */
function persistedTabType(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    try {
      const root = JSON.parse(window.localStorage.getItem("persist:root") ?? "{}") as Record<
        string,
        string
      >;
      return (JSON.parse(root.pipeline ?? "{}") as { tabType?: unknown }).tabType;
    } catch {
      return undefined;
    }
  });
}

/** What the guest sees in the bag + what the store holds — "nothing changed" compares it. */
async function bagSnapshot(page: Page) {
  return {
    subtotal: await page.getByTestId("bag-subtotal").textContent(),
    total: await page.getByTestId("bag-total").textContent(),
    rows: await bagRows(page).count(),
    eatIn: await eatInSegment(page).getAttribute("aria-pressed"),
    store: await kioskView(page),
  };
}

/** TAKE OUT → the confirm dialog (lazy chunk) → YES. */
async function confirmTakeOut(page: Page) {
  await takeOutSegment(page).click();
  await expect(page.getByTestId("bag-ordertype-confirm")).toBeVisible();
  await page.getByTestId("bag-ordertype-confirm-yes").click();
}

/** Absence check after a jump: give a timer that fired a render first (idle.spec.ts). */
async function expectNoPrompt(page: Page) {
  await page.clock.runFor(500);
  await expect(idleModal(page)).toHaveCount(0);
}

test.describe("bag-pdp item 19: in-bag EAT IN / TAKE OUT switch", () => {
  // The HANG test parks a route the page abandons; drop it without waiting.
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("SINGLE PIPELINE: with no take-away pipeline the TAKE OUT segment is aria-disabled and inert", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page, { pipelines: [EAT_IN] });
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);

    await expect(eatInSegment(page)).toHaveAttribute("aria-pressed", "true");
    await expect(takeOutSegment(page)).toHaveAttribute("aria-pressed", "false");
    await expect(takeOutSegment(page)).toHaveAttribute("aria-disabled", "true");
    // Playwright refuses a normal click on aria-disabled; forced, it is a
    // no-op — no confirm, no lazy stand-in, no fetch for another tab.
    const before = net.calls.length;
    await takeOutSegment(page).click({ force: true });
    await expect(page.getByTestId("bag-ordertype-confirm")).toHaveCount(0);
    await expect(page.getByTestId("bag-ordertype-loading")).toHaveCount(0);
    expect(net.calls.slice(before)).toEqual([]);
    expect((await kioskView(page)).pipelineId).toBe("p1");
  });

  test("CONFIRM → NO: the confirm names the target and warns about prices; NO keeps EAT IN and fetches nothing", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page);
    await bootToBagWithBurgerAndSalad(page);
    const before = await bagSnapshot(page);
    expect(before.store).toMatchObject({ pipelineId: "p1", tabId: "t1", charges: [] });

    await expect(takeOutSegment(page)).toHaveAttribute("aria-disabled", "false");
    const callsBefore = net.calls.length;
    await takeOutSegment(page).click();
    const confirm = page.getByRole("alertdialog", { name: COPY.confirmTitle });
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveAccessibleDescription(COPY.confirmBody);
    await expect(page.getByTestId("bag-ordertype-confirm-yes")).toHaveText(COPY.confirmYes);
    await expect(page.getByTestId("bag-ordertype-confirm-no")).toHaveText(COPY.confirmNo);
    await capture(page, "order-type-confirm");

    await page.getByTestId("bag-ordertype-confirm-no").click();
    await expect(page.getByTestId("bag-ordertype-confirm")).toHaveCount(0);
    await expect(eatInSegment(page)).toHaveAttribute("aria-pressed", "true");
    expect(await bagSnapshot(page)).toEqual(before);
    expect(net.calls.slice(callsBefore)).toEqual([]);
  });

  test("SUCCESS: YES commits TAKE OUT — the burger is re-priced to £9, Greek Salad is removed and named, the bag fee joins the total, and a reload keeps the pipeline and the re-priced row (Dexie)", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page);
    await bootToBagWithBurgerAndSalad(page);
    const callsBefore = net.calls.length;

    await confirmTakeOut(page);
    const notice = page.getByRole("alertdialog", { name: COPY.removedTitle });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bag-ordertype-notice")).toBeVisible();
    await expect(notice).toHaveAccessibleDescription(COPY.removedBody("Greek Salad"));
    await capture(page, "order-type-notice");

    // The switch fetched the TARGET tab's data, nothing else.
    const switchCalls = net.calls.slice(callsBefore);
    expect(switchCalls.filter((c) => c.endpoint === "getMenu").map((c) => c.body.tab_id)).toEqual([
      "t2",
    ]);
    expect(switchCalls.filter((c) => c.endpoint === "get_data").map((c) => c.body.tab_id)).toEqual([
      "t2",
    ]);
    expect(
      switchCalls.filter((c) => c.endpoint === "offers").map((c) => c.body.tab_type)
    ).toEqual(["take_away"]);

    // The committed state: the /second selection, the t2 charges, one row at £9.
    expect(await kioskView(page)).toEqual({
      pipelineId: "p2",
      tabId: "t2",
      tabType: "take_away",
      charges: ["c-t2"],
      offerId: undefined,
      rows: [{ id: CHEESE_BURGER, price: 9, quantity: 1, isGetItem: undefined }],
    });

    await page.getByTestId("bag-ordertype-notice-gotit").click();
    await expect(page.getByTestId("bag-ordertype-notice")).toHaveCount(0);
    await expect(takeOutSegment(page)).toHaveAttribute("aria-pressed", "true");
    await expect(eatInSegment(page)).toHaveAttribute("aria-pressed", "false");
    // The way back is now the switch target.
    await expect(eatInSegment(page)).toHaveAttribute("aria-disabled", "false");
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toContainText("Cheese Burger");
    await expect(bagRows(page).first()).toContainText("£9.00");
    await expect(page.getByTestId("bag-sheet")).not.toContainText("Greek Salad");
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (1)");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£9.00");
    // round(9 × 1.15 + 2) — the t2 bag fee is in the total.
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£12.00");

    // Both stores the crash-reload reads have the switch before the reload.
    await expect.poll(() => readDexieCart(page)).toEqual([{ id: CHEESE_BURGER, price: 9 }]);
    await expect.poll(() => persistedTabType(page)).toBe("take_away");

    const beforeReload = net.calls.length;
    await page.reload();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toContainText("Cheese Burger");
    await expect(takeOutSegment(page)).toHaveAttribute("aria-pressed", "true");
    // The re-boot refetches the menu for the persisted pipeline: t2, never t1.
    const reloadCalls = () => {
      const calls = net.calls.slice(beforeReload);
      return {
        menus: calls.filter((c) => c.endpoint === "getMenu").map((c) => c.body.tab_id),
        offers: calls.filter((c) => c.endpoint === "offers").map((c) => c.body.tab_type),
      };
    };
    await expect.poll(reloadCalls).toEqual({ menus: ["t2"], offers: ["take_away"] });
    // Post-reload money may lack "£" until get_data (bag.spec.ts header).
    await expect(page.getByTestId("bag-subtotal")).toContainText("9.00");
    await expect(page.getByTestId("bag-total")).toContainText("12.00");
    await expect(page.getByTestId("bag-sheet")).not.toContainText("Greek Salad");
    expect(await kioskView(page)).toMatchObject({
      pipelineId: "p2",
      tabId: "t2",
      tabType: "take_away",
      rows: [{ id: CHEESE_BURGER, price: 9, quantity: 1 }],
    });
  });

  test("SUCCESS → PAY: after the switch every PAY request carries tab t2, and the pushed order is take_away at £9 with the bag fee", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page);
    await bootToBagWithBurgerAndSalad(page);
    await confirmTakeOut(page);
    await expect(page.getByTestId("bag-ordertype-notice")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("bag-ordertype-notice-gotit").click();
    await expect(page.getByTestId("bag-pay")).toContainText("£12.00");

    // Every request from PAY on that names a tab must name the new one.
    const tabbed: { path: string; tab: unknown }[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      let body: unknown;
      try {
        body = request.postDataJSON();
      } catch {
        return;
      }
      if (!body || typeof body !== "object") return;
      const record = body as Body;
      for (const key of ["tab_id", "tabId"]) {
        if (key in record) tabbed.push({ path: new URL(request.url()).pathname, tab: record[key] });
      }
    });

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("payment-total")).toContainText("£12.00");
    await page.getByTestId("payment-counter").click();
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });

    const { checkout } = net;
    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.lastPlaceOrderBody).toMatchObject({
      tabId: "t2",
      tabType: "take_away",
      payments: { type: "COD" },
      charges: [{ name: "Bag fee", type: "fixed", value: 2 }],
      items: [{ id: CHEESE_BURGER, quantity: 1, rate: 9 }],
    });
    expect(tabbed.length).toBeGreaterThan(0);
    expect(tabbed.filter((request) => request.tab !== "t2")).toEqual([]);
    expect(checkout.forbiddenUrls).toEqual([]);
    expect(checkout.printAgentUrls).toEqual([]);
  });

  test("MENU 500: a failed take-away menu fetch shows the failure dialog and changes nothing; TRY AGAIN with the menu back commits the switch", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page);
    net.t2Menu = "500";
    await bootToBagWithBurgerAndSalad(page);
    const before = await bagSnapshot(page);

    await confirmTakeOut(page);
    const failed = page.getByRole("alertdialog", { name: COPY.failedTitle });
    await expect(failed).toBeVisible({ timeout: 20_000 });
    await expect(failed).toHaveAccessibleDescription(COPY.failedBody);
    await expect(page.getByTestId("bag-ordertype-retry")).toHaveText(en.menuError.retry);
    await expect(page.getByTestId("bag-ordertype-back")).toHaveText(en.menuError.back);
    await expect(page.getByTestId("bag-ordertype-switching")).toHaveCount(0);
    await capture(page, "order-type-failed");
    // Nothing staged leaked: EAT IN, both rows, both totals, the store.
    expect(await bagSnapshot(page)).toEqual(before);
    expect(net.calls.filter((c) => c.endpoint === "getMenu" && c.body.tab_id === "t2")).toHaveLength(1);

    net.t2Menu = "ok";
    await page.getByTestId("bag-ordertype-retry").click();
    await expect(page.getByTestId("bag-ordertype-notice")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bag-ordertype-failed")).toHaveCount(0);
    await page.getByTestId("bag-ordertype-notice-gotit").click();
    await expect(takeOutSegment(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£9.00");
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
    expect(await kioskView(page)).toMatchObject({ pipelineId: "p2", tabId: "t2", charges: ["c-t2"] });
  });

  test("HANG: a take-away menu that never answers holds idle while in flight, ends on the failure dialog at its 30 s budget with nothing changed, and idle runs a full period from the release", async ({
    page,
  }) => {
    test.slow();
    // Before ANY page script: RTK's budget and react-idle-timer bind the page timers.
    await page.clock.install();
    const net = await mockKioskBackend(page);
    net.t2Menu = "hang";
    await bootToBagWithBurgerAndSalad(page);
    const before = await bagSnapshot(page);

    // YES is the last touch: an unheld idle period would prompt 100 s later.
    await confirmTakeOut(page);
    const switching = page.getByTestId("bag-ordertype-switching");
    await expect(switching).toBeVisible();
    await expect(switching).toHaveAttribute("role", "status");
    await expect(switching).toHaveText(enLazy.bag.orderType.switching);
    await expect.poll(() => net.held.length).toBe(1);
    await capture(page, "order-type-switching");

    // Past the 10 s default: still in flight (getMenu's budget is 30 s).
    await page.clock.runFor(REQUEST_BUDGET_MS + 500);
    await page.clock.runFor(500);
    await expect(switching).toBeVisible();
    await expect(page.getByTestId("bag-ordertype-failed")).toHaveCount(0);

    // Past 30 s: the transport aborts the download → the failure dialog.
    await page.clock.runFor(MENU_BUDGET_MS - REQUEST_BUDGET_MS);
    await expect(page.getByTestId("bag-ordertype-failed")).toBeVisible();
    await expect(switching).toHaveCount(0);
    expect(await bagSnapshot(page)).toEqual(before);

    // Tap + 100 s: no prompt — the hold paused idle while the switch ran, and
    // its release (~30 s) started a fresh period…
    await page.clock.fastForward(PROMPT_AFTER_MS - MENU_BUDGET_MS);
    await expectNoPrompt(page);
    // …which still ends: the prompt comes a full period after the release.
    await page.clock.fastForward(32_000);
    await expect(idleModal(page)).toBeVisible();
    expect(net.held).toHaveLength(1);
  });

  test("OFFERS FAIL (D1b): when the take-away offers cannot load (bounded retries) the switch aborts on the failure dialog and nothing changes; BACK keeps EAT IN", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page, {
      offersFor: (tabType) => (tabType === "take_away" ? "fail" : []),
    });
    await bootToBagWithBurgerAndSalad(page);
    const before = await bagSnapshot(page);

    await confirmTakeOut(page);
    await expect(page.getByTestId("bag-ordertype-failed")).toBeVisible({ timeout: 20_000 });
    // 8 s × 3 attempts at most (withTimeoutRetry): three 500s, then the abort.
    expect(
      net.calls.filter((c) => c.endpoint === "offers" && c.body.tab_type === "take_away")
    ).toHaveLength(3);
    // The menu itself loaded — the offers alone abort the commit.
    expect(net.calls.filter((c) => c.endpoint === "getMenu" && c.body.tab_id === "t2")).toHaveLength(1);
    expect(await bagSnapshot(page)).toEqual(before);

    await page.getByTestId("bag-ordertype-back").click();
    await expect(page.getByTestId("bag-ordertype-failed")).toHaveCount(0);
    await expect(eatInSegment(page)).toHaveAttribute("aria-pressed", "true");
    expect(await bagSnapshot(page)).toEqual(before);
  });

  test("OFFER KEPT (D1a): a flat offer both tabs offer stays applied through the switch and re-applies to the re-priced bag", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page, { offersFor: () => offersFixture });
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await page.getByTestId("bag-rewards-entry").click();
    await page.getByTestId(`offer-row-${OFFER_FLAT}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    await expect(page.getByTestId("bag-total")).toContainText("£7.00");

    await confirmTakeOut(page);
    await expect(takeOutSegment(page)).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    // Re-checked against the take-away offers (fetched for that tab) and kept.
    expect(
      net.calls.filter((c) => c.endpoint === "offers").map((c) => c.body.tab_type)
    ).toContain("take_away");
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(OFFER_FLAT_NAME);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£9.00");
    await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
    // round((9 − 2) × 1.15 + 2) = round(10.05).
    await expect(page.getByTestId("bag-total")).toContainText("£10.00");
    await expect(page.getByTestId("offer-removal-notice")).toHaveCount(0);
    // Nothing was removed, so no order-type notice either.
    await expect(page.getByTestId("bag-ordertype-notice")).toHaveCount(0);
    expect((await kioskView(page)).offerId).toBe(OFFER_FLAT);
  });

  test("OFFER DROPPED (D1a): an applied offer the take-away tab does not offer is removed with the standard removal notice", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, {
      offersFor: (tabType) => (tabType === "take_away" ? [] : offersFixture),
    });
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await page.getByTestId("bag-rewards-entry").click();
    await page.getByTestId(`offer-row-${OFFER_FLAT}`).click();
    await page.getByTestId("rewards-save").click();
    await expect(page.getByTestId("bag-rewards-applied")).toContainText(OFFER_FLAT_NAME);

    await confirmTakeOut(page);
    const removal = page.getByTestId("offer-removal-notice");
    await expect(removal).toBeVisible({ timeout: 20_000 });
    await expect(removal).toContainText(en.offers.removedTitle);
    await expect(removal).toContainText(OFFER_FLAT_NAME);
    await page.getByTestId("offer-removal-gotit").click();
    await expect(removal).toHaveCount(0);

    await expect(takeOutSegment(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£9.00");
    await expect(page.getByTestId("bag-total")).toContainText("£12.00");
    expect((await kioskView(page)).offerId).toBeUndefined();
  });

  test("ALL REMOVED: when the take-away tab serves none of the rows the bag empties and closes, the notice still names them on /menu, and GOT IT clears it", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { removedOnT2: [GREEK_SALAD, TORTILLA_SAUCE] });
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await addOneTap(page, TORTILLA_SAUCE, "(2)");
    await openBag(page);

    await confirmTakeOut(page);
    const notice = page.getByRole("alertdialog", { name: COPY.removedTitle });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(notice).toHaveAccessibleDescription(
      COPY.removedBody("Greek Salad and Tortilla Sauce")
    );
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    expect(await kioskView(page)).toMatchObject({ pipelineId: "p2", tabId: "t2", rows: [] });
    await expect.poll(() => readDexieCart(page)).toEqual([]);

    await page.getByTestId("bag-ordertype-notice-gotit").click();
    await expect(page.getByTestId("bag-ordertype-notice")).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-total")).toContainText("£0.00");
  });

  test("CHARGES 500: a failed take-away charges fetch shows the failure dialog and changes nothing — not the bag, not the store, not the menu beneath; BACK keeps EAT IN", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page);
    net.t2Charges = "500";
    await bootToBagWithBurgerAndSalad(page);
    const before = await bagSnapshot(page);

    await confirmTakeOut(page);
    await expect(page.getByRole("alertdialog", { name: COPY.failedTitle })).toBeVisible({
      timeout: 20_000,
    });
    // Only the charges leg failed: the menu leg answered (and staged) in full.
    const t2 = (endpoint: string) =>
      net.calls.filter((c) => c.endpoint === endpoint && c.body.tab_id === "t2");
    expect(t2("get_data")).toHaveLength(1);
    expect(t2("getMenu")).toHaveLength(1);
    expect(await bagSnapshot(page)).toEqual(before);

    await page.getByTestId("bag-ordertype-back").click();
    await expect(page.getByTestId("bag-ordertype-failed")).toHaveCount(0);
    await expect(eatInSegment(page)).toHaveAttribute("aria-pressed", "true");
    expect(await bagSnapshot(page)).toEqual(before);
    // Nothing the menu leg staged leaked: the dine-in menu beneath still
    // serves Greek Salad, which the take-away menu does not.
    await page.getByTestId("bag-close").click();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    const salad = page.getByTestId(`item-${GREEK_SALAD}`);
    await expect(salad).toHaveCount(1);
    await salad.scrollIntoViewIfNeeded();
    await expect(salad).toBeVisible();
  });

  // The target resolver's two fork-parity filters (/second's open state and
  // the device's deactivated_pipelines general setting).
  for (const blocked of [
    {
      label: "CLOSED",
      why: "closed (get_all_pipeline_status)",
      options: { pipelineStatuses: { p2: { status: false, reason: "Closed" } } },
    },
    {
      label: "DEACTIVATED",
      why: "deactivated on this device (deactivated_pipelines)",
      options: {
        checkout: {
          extraDeviceSettings: [
            {
              _id: "general_deactivated_pipelines",
              setting_id: "deactivated_pipelines",
              setting_label: "deactivated_pipelines",
              group: "general",
              channel: "Kiosk",
              value: { value: [TAKE_OUT._id] },
            },
          ],
        },
      },
    },
  ] satisfies { label: string; why: string; options: SwitchMockOptions }[]) {
    test(`${blocked.label} TARGET: a take-away pipeline that is ${blocked.why} is no switch target — TAKE OUT stays aria-disabled and inert`, async ({
      page,
    }) => {
      test.slow();
      const net = await mockKioskBackend(page, blocked.options);
      await bootRegisteredToMenu(page);
      await addOneTap(page, GREEK_SALAD, "(1)");
      await openBag(page);

      await expect(eatInSegment(page)).toHaveAttribute("aria-pressed", "true");
      await expect(takeOutSegment(page)).toHaveAttribute("aria-disabled", "true");
      const before = net.calls.length;
      await takeOutSegment(page).click({ force: true });
      await expect(page.getByTestId("bag-ordertype-confirm")).toHaveCount(0);
      expect(net.calls.slice(before)).toEqual([]);
      expect((await kioskView(page)).pipelineId).toBe("p1");
    });
  }

  test("LOYALTY REWARD: a redeemed reward the take-away tab does not serve is reversed by the switch — named in the notice, removed from the bag, its points refunded and its claim revoked", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page, { loyalty: true });
    const reward = LOYALTY_REWARDS.greekSalad;
    await bootIdentifiedToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await redeemFromMenu(page, reward.couponCode);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(2)");
    await expect
      .poll(() => persistedLoyaltyPoints(page), { timeout: 10_000 })
      .toBe(LOYALTY_POINTS_TOTAL - reward.points);
    await openBag(page);
    await expect(loyaltyRows(page)).toHaveCount(1);
    await expect(loyaltyRows(page).first()).toContainText(reward.name);

    await confirmTakeOut(page);
    const notice = page.getByRole("alertdialog", { name: COPY.removedTitle });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toHaveAccessibleDescription(COPY.removedBody(reward.name));
    await page.getByTestId("bag-ordertype-notice-gotit").click();
    await expect(notice).toHaveCount(0);

    // Reversed, never kept on the old tab's terms: gone, points back, claim revoked.
    await expect(loyaltyRows(page)).toHaveCount(0);
    await expect.poll(() => net.xeno?.revokeCount, { timeout: 10_000 }).toBe(1);
    await expect
      .poll(() => persistedLoyaltyPoints(page), { timeout: 10_000 })
      .toBe(LOYALTY_POINTS_TOTAL);
    // The paid row is re-priced for take-away.
    await expect(takeOutSegment(page)).toHaveAttribute("aria-pressed", "true");
    await expect(bagRows(page)).toHaveCount(1);
    await expect(bagRows(page).first()).toContainText("£9.00");
    expect((await kioskView(page)).rows).toEqual([
      { id: CHEESE_BURGER, price: 9, quantity: 1, isGetItem: undefined },
    ]);
  });

  test("NEXT CUSTOMER: a removal notice left up when the session idles out does not greet the next customer", async ({
    page,
  }) => {
    test.slow();
    // Before ANY page script (idle.spec.ts): react-idle-timer binds the page timers.
    await page.clock.install();
    await mockKioskBackend(page, { removedOnT2: [GREEK_SALAD, TORTILLA_SAUCE] });
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await addOneTap(page, TORTILLA_SAUCE, "(2)");
    await openBag(page);
    await confirmTakeOut(page);
    const notice = page.getByTestId("bag-ordertype-notice");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/menu$/);

    // The guest walks away: prompt at 100 s, Splash at 120 s (two jumps — idle.spec.ts).
    await page.clock.fastForward(PROMPT_AFTER_MS);
    await expect(idleModal(page)).toBeVisible();
    await page.clock.fastForward(IDLE_TIMEOUT_MS - PROMPT_AFTER_MS);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    // The next customer orders Dine In: an empty bag and no previous notice.
    await page.getByTestId("start-screen").click();
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await page.clock.runFor(500);
    await expect(notice).toHaveCount(0);
  });
});
