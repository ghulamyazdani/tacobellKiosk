import {
  test,
  expect,
  type Page,
  type Route,
  REQUEST_BUDGET_MS,
  MENU_BUDGET_MS,
  PROMPT_AFTER_MS,
  persistedLoyaltyPoints,
} from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  locale,
  SKIP_CRM,
  CHEESE_BURGER,
  GREEK_SALAD,
  TORTILLA_SAUCE,
} from "./fixtures/backend";
import { bootRegisteredToMenu, registerToStart, startOrderTo } from "./pages/boot";
import { addOneTap, addViaPdp, openBag, bagRows, loyaltyRows, typeDigits } from "./pages/order";
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
 * The harness house order, newest wins: the shared mock (fixtures/
 * backend.ts — its origin-scoped `/api/` catch-all, then every boot
 * endpoint), then the checkout fixture (print agent aborted, every gateway
 * 500-guarded, the pay-at-counter endpoints), then this spec's per-tab
 * routes — so the two-pipeline getPipelines here replaces the fixture's
 * single row — and, with `loyalty`, the Xeno surface last. Otherwise loyalty
 * is off, so nothing reaches xeno.in. Boot and bag steps are the shared page
 * functions (pages/boot.ts, pages/order.ts). Copy is read from the EN
 * translation files (the lane's strings live in lazy.json), never
 * paraphrased.
 *
 * ── TIME ────────────────────────────────────────────────────────────────
 * Only the HANG test installs Playwright's clock (before the first goto):
 * RTK's request budgets and react-idle-timer run on the page's timers, so
 * the 30 s getMenu budget and the 100 s idle prompt are stepped, never
 * waited (recovery.spec.ts / idle.spec.ts headers).
 */

const slimMenu = fixtureJson("slim-menu.json");
const offersFixture = fixtureJson("offers.json");
const en = locale("en");
const enLazy = locale("en", "lazy");

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json, offers.json) ----
// CHEESE_BURGER (£8 on t1, £9 on t2), GREEK_SALAD (£17, one-tap) and
// TORTILLA_SAUCE (£2, one-tap) come from fixtures/backend.ts.
/** Cheese Burger's optional "Choose From Extra" group (0 / 3). */
const BURGER_EXTRA_GROUP = `${CHEESE_BURGER}_1573980469_addons`;
/** Kiddie Meal Beef Burger, re-shaped by withSizes() into a sized item (`sized` option). */
const SIZED_ITEM = "5dd1093a188e72ce1b3eb358";
const SIZE_REGULAR = "e2e-size-regular"; // £5 on t1, £6 on t2
const SIZE_LARGE = "e2e-size-large"; // £7 on t1, £9 on t2
const OFFER_FLAT = "offer-flat-2";
const OFFER_FLAT_NAME = "£2 off your order";

/** U+2212 MINUS SIGN — the literal character the bag renders. */
const MINUS = "−";

/**
 * P9a idle timing (idle.spec.ts): ideal_time 180 clamps to 120 s; the prompt
 * shows at PROMPT_AFTER_MS (100 s). The request budgets (REQUEST_BUDGET_MS,
 * MENU_BUDGET_MS — src/redux/app/apiSlice.ts) come from fixtures/kiosk.ts.
 */
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

/** bag.spec.ts sizedMenu() over `menu`: SIZED_ITEM sold in two sizes at this tab's prices. */
function withSizes(menu: unknown, regular: number, large: number) {
  const sized = JSON.parse(JSON.stringify(menu));
  for (const category of sized.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities)
        if (entity.id === SIZED_ITEM) {
          entity.hasVariant = true;
          entity.modifiers = [];
          entity.variants = [
            [SIZE_REGULAR, "Regular", regular],
            [SIZE_LARGE, "Large", large],
          ].map(([id, name, price]) => ({ id, name, price, isActive: true, subCategoryId: sub.id }));
        }
  return sized;
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
  /** SIZED_ITEM sold in sizes on both tabs: Regular £5 / Large £7 on t1, £6 / £9 on t2. */
  sized?: boolean;
  /** A modifier group the take-away menu REQUIRES (min 1); dine-in keeps it optional. */
  requiredOnT2?: string;
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
    sized = false,
    requiredOnT2,
  }: SwitchMockOptions = {}
): Promise<SwitchNet> {
  // Pay-at-counter fan-out (checkout.spec.ts): PAY → /payment. Loyalty on
  // routes /second through the /phone lookup (loyalty.spec.ts); its
  // skip_crm_page: false wins over SKIP_CRM's.
  await mockBackend(page, { settings: { ...SKIP_CRM, ...(loyalty ? LOYALTY_SETTINGS : {}) } });
  // Print agent aborted + every gateway 500-guarded (fixture header).
  const checkout = await mockCheckoutBackend(page, checkoutOptions);
  const net: SwitchNet = { t2Menu: "ok", t2Charges: "ok", held: [], calls: [], checkout };
  const t1Menu = sized ? withSizes(slimMenu, 5, 7) : slimMenu;
  const t2Menu = sized ? withSizes(takeAwayMenu(removedOnT2), 6, 9) : takeAwayMenu(removedOnT2);
  if (requiredOnT2) {
    const group = (t2Menu as { modifiers?: { _id: string; min?: number }[] }).modifiers?.find(
      (modifier) => modifier._id === requiredOnT2
    );
    if (!group) throw new Error(`fixture: no group ${requiredOnT2}`);
    group.min = 1;
  }
  const log = (endpoint: string, route: Route) => {
    const body = bodyOf(route);
    net.calls.push({ endpoint, body });
    return body;
  };

  if (pipelineStatuses) {
    await page.route("**/api/cx/get_all_pipeline_status", (r) =>
      r.fulfill({ json: pipelineStatuses })
    );
  }
  // After the checkout fixture: its single-row getPipelines must not win.
  await page.route("**/api/cx/kiosk/getPipelines", (r) => r.fulfill({ json: pipelines }));
  await page.route("**/api/cx/kiosk/getMenu", (route) => {
    const body = log("getMenu", route);
    if (body.tab_id !== TAKE_OUT.tab_id) return route.fulfill({ json: t1Menu });
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
        deployment: { countryCode: "GB", currencySettings: { currency: "GBP", text: "£" } },
      },
    });
  });
  // Newest route wins: the Xeno surface goes last (loyalty.spec.ts header).
  if (loyalty) net.xeno = await mockXenoLoyalty(page);
  return net;
}

/** Menu card → PDP → commit plain (£8 on t1) → dismiss the added modal (pages/order.ts). */
const addCheeseBurgerViaPdp = (page: Page) =>
  addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });

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
  await registerToStart(page);
  await startOrderTo(page, "phone-screen");
  await typeDigits(page, LOYALTY_PHONE);
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
  await typeDigits(page, LOYALTY_OTP);
  await page.getByTestId("loyalty-otp-submit").click();
  await expect(page.getByTestId("loyalty-success")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("loyalty-success")).toHaveCount(0, { timeout: 10_000 });
}

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

  test("SWITCH, THEN A REQUIRED CHOICE (audit-fixes A1): the take-away menu requires a pick the dine-in burger never made — PAY stays on /cart with 'some items need changes' and the row's red line, Edit still offered; nothing is placed", async ({
    page,
  }) => {
    test.slow();
    const net = await mockKioskBackend(page, { requiredOnT2: BURGER_EXTRA_GROUP });
    await bootToBagWithBurgerAndSalad(page);
    await confirmTakeOut(page);
    await expect(page.getByTestId("bag-ordertype-notice")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("bag-ordertype-notice-gotit").click();
    // The switch re-prices the burger and keeps it (it checks items, not group bounds).
    await expect(bagRows(page)).toHaveCount(1);
    const burgerId = ((await bagRows(page).first().getAttribute("data-testid")) ?? "").replace(
      "bag-row-",
      ""
    );

    // PAY's check finds the empty required group: blocked, out loud.
    await page.getByTestId("bag-pay").click();
    await expect(page.getByRole("alertdialog", { name: en.bag.someNeedChanges })).toBeVisible();
    await page.getByTestId("global-error-ok").click();
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId(`bag-changed-${burgerId}`)).toHaveText(en.bag.choicesUnavailable);
    await expect(page.getByTestId(`bag-unavailable-${burgerId}`)).toHaveCount(0);
    await expect(page.getByTestId(`bag-edit-${burgerId}`)).toBeVisible();
    expect(net.checkout.placeOrderCount).toBe(0);
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
    // PAY stores a COPY of the bill's charges. Storing the memoised bill's own
    // objects (frozen by the store) threw in its next getNetAmount() during
    // render, and React reported the recovery as a page error.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

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
    expect(pageErrors).toEqual([]);
  });

  test("SIZE EDIT AFTER A SWITCH: the edit PDP lists TAKE OUT's size prices, and a size picked there costs what TAKE OUT charges", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { sized: true });
    await bootRegisteredToMenu(page);
    const card = page.getByTestId(`item-${SIZED_ITEM}`);
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.getByTestId(`pdp-variant-${SIZE_REGULAR}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£5.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();
    await openBag(page);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£5.00");

    await confirmTakeOut(page);
    await expect(takeOutSegment(page)).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(page.getByTestId("bag-subtotal")).toContainText("£6.00");
    const itemId = ((await bagRows(page).first().getAttribute("data-testid")) ?? "").replace(
      "bag-row-",
      ""
    );

    // The row's own size list (what the edit PDP lists) is TAKE OUT's.
    await page.getByTestId(`bag-edit-${itemId}`).click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await page.getByTestId("pdp-change-size").click();
    await expect(page.getByTestId(`pdp-variant-${SIZE_REGULAR}`)).toContainText("£6.00");
    await expect(page.getByTestId(`pdp-variant-${SIZE_LARGE}`)).toContainText("£9.00");
    await page.getByTestId(`pdp-variant-${SIZE_LARGE}`).click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`bag-row-${itemId}`)).toContainText("Large");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£9.00");
  });

  test("TENT + SWITCH: a table number typed on the table tab (then BACK) never rides into the take-out order", async ({
    page,
  }) => {
    test.slow();
    const TABLE: Pipeline = { _id: "p1", tab_id: "t1", tab_type: "table", primary_name: "Table Service" };
    const { checkout } = await mockKioskBackend(page, {
      pipelines: [TABLE, TAKE_OUT],
      removedOnT2: [],
    });
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);

    // PAY on the table tab pitches the tent: type 12, then BACK keeps it.
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("tent-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("numpad-key-1").click();
    await page.getByTestId("numpad-key-2").click();
    await expect(page.getByTestId("tent-display")).toHaveText("12");
    await page.getByTestId("tent-back").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });

    await confirmTakeOut(page);
    await expect(takeOutSegment(page)).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("payment-counter").click();
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });

    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.lastPlaceOrderBody).toMatchObject({
      tabId: "t2",
      tabType: "take_away",
      tableNumber: "",
    });
  });

  test("MENU 500:a failed take-away menu fetch shows the failure dialog and changes nothing; TRY AGAIN with the menu back commits the switch", async ({
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
