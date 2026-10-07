import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mockCheckoutBackend,
  type CheckoutMockHandle,
  type JsonBody,
} from "./fixtures/checkout";
import {
  EDC_BUSY,
  LOST_BODY,
  PAYTM_DQR_ENTITY,
  PAYTM_DQR_MID,
  PAYTM_DQR_SECRET,
  PAYTM_EDC_DEVICE_ID,
  PAYTM_EDC_ENTITY,
  PAYTM_ENDPOINTS,
  PAYTM_QR,
  httpError,
  mockPaytmBackend,
  paytmStatus,
  statusSequence,
  type EdcInitBody,
  type PaytmMockHandle,
  type PaytmScript,
} from "./fixtures/paytm";

/**
 * P8b — Paytm Dynamic QR + Paytm EDC, end to end: a MONEY PATH.
 *
 * /payment arms a Paytm tile → /receipt INITIATES (the order is parked with
 * the gateway; the BACKEND places it) → /paymentPolling settles it by status
 * reads. Every case proves the money rules, not just the screens:
 *   - the kiosk NEVER places a Paytm order itself (placeOrder stays 0);
 *   - exactly one initiate per tap; an initiate whose outcome is unknown is
 *     NEVER sent again — it is settled by status with the SAME ids;
 *   - an EDC void only ever follows a FRESH "pending" read, at most once;
 *   - every exit through /start does one last status read (and voids only a
 *     still-pending EDC); idle never ends a session under an armed terminal.
 * {@link expectMoneyInvariants} closes every case: the placeOrder count,
 * forbiddenHit === false and both initiate counts.
 *
 * ── MOCK ORDER (newest route wins) ──────────────────────────────────────
 * `mockKioskBackend` (catch-all `**\/api/**` FIRST) → `mockCheckoutBackend`
 * with the two REAL Paytm device-setting rows (FORBIDDEN_PATH_RE guards every
 * gateway prefix with a loud 500; the print agent is aborted) →
 * `mockPaytmBackend` (tests/e2e/fixtures/paytm.ts) LAST, which wins for the
 * five cx kiosk Paytm paths only. The legacy `/api/payments/paytm*` family
 * and `/api/cx/kiosk/createOrder` stay forbidden — the regression guard.
 * Loyalty is off, so no Xeno route is needed.
 *
 * ── TIME: page.clock, FROZEN BEFORE THE INITIATE ────────────────────────
 * `page.clock.install()` runs before the first goto (beforeEach). The boot
 * and the 3 s /payment buffer run on the flowing clock; on /receipt each
 * Paytm case FREEZES it ({@link freezeClock}) before tapping. From then on no
 * poll, tick, deadline or budget fires unless the spec advances time, so
 * every count below is exact. The poll loop is a chained timeout re-armed
 * from React state, so time only moves through {@link stepClockUntil}: small
 * steps, each followed by a check of the STATE it should produce — never one
 * big fastForward. Steps are GATED on `paytm.inFlight() === 0`: RTK's request
 * budgets (status 5 s, initiate/void 10 s) are fake timers too, so advancing
 * under an unanswered request would turn a scripted answer into an error.
 * Exceptions, by design: E7b, E7d, E7e, E7f and E7g reload on the flowing
 * clock (redux-persist flushes on timers — a frozen clock persists nothing; E7e
 * also drops persist:root writes on demand to model that lag; E7f freezes it
 * only once the reload has resumed the session; E19b reloads onto a failing
 * chunk), E18 resumes it for the next guest's walk to /payment, and E12 jumps
 * the idle period in fastForward steps exactly like idle.spec.ts. E19 does
 * all three: it resumes for the walks, jumps the idle period home, then steps
 * /start's update dwell into the splash reload. No case idles on /start
 * except E19 (the clock is frozen there and the boot stamped lastBootAt), so
 * no case seeds autoUpdate/setLastBootAt.
 *
 * ── THE DEV-ONLY STORE SEAM ─────────────────────────────────────────────
 * `window.__kioskStore` (src/redux/app/store.ts, dev builds only) reads the
 * payment slice, the auth token and the splash-reload flag (E19); E8b uses
 * it once to take the Paytm rows away between arming and the initiate (the
 * local-refusal branch).
 *
 * ── E8 vs the contract ──────────────────────────────────────────────────
 * Contract §P8b-16 E8 says busy → PAY ANOTHER WAY. The frozen SDK rule makes
 * busy RETRYABLE (decidePaytmInitiate), so the busy modal offers TRY AGAIN +
 * BACK TO BAG; PAY ANOTHER WAY belongs to the non-retryable local refusals
 * (E8b). Both exits are covered, each where the product offers it.
 *
 * Boot helpers are copied from checkout.spec.ts / idle.spec.ts / ada.spec.ts
 * (no spec exports them — copying is the suite's precedent until the shared
 * harness lands). Fixture money: one Cheese Burger, £8 + VAT 15 % → £9.00.
 */

const readJson = (relative: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8")
  );

const slimMenu = readJson("./fixtures/slim-menu.json");
const en = readJson("../../src/i18n/locales/en/translation.json");
const ar = readJson("../../src/i18n/locales/ar/translation.json");

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

/** £8, a plain PDP commit — the bag checks out at £9.00. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";

/** SDK paytm.ts windows (PAYTM_*_STOP_TIMER_SECONDS) + PAYTM_SETTLE_WINDOW_MS. */
const EDC_WINDOW_MS = 180_000;
const DQR_WINDOW_MS = 135_000;
const SETTLE_WINDOW_MS = 30_000;

/** ADA reach zone — src/components/stage/KioskStage.tsx (ada.spec.ts). */
const STAGE_HEIGHT = 1920;
const ADA_BRAND_ZONE_HEIGHT = 798;

/* ------------------------------------------------------------------ */
/* Boot (copied house helpers)                                         */
/* ------------------------------------------------------------------ */

interface KioskMockOptions {
  /** get_kiosk_settings.ideal_time — "180" is clamped to 120 s. */
  idealTime?: string;
  /** get_kiosk_settings.accessibility_mode — the tenant's ADA gate. */
  ada?: boolean;
  /** Offer Arabic as the secondary language. */
  arabic?: boolean;
}

async function mockKioskBackend(
  page: Page,
  { idealTime = "180", ada = false, arabic = false }: KioskMockOptions
) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: arabic
          ? { name: "العربية", code: "ar", dir: "rtl" }
          : {},
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
        ...(arabic ? { start_order_text_secondary: "ابدأ الطلب" } : {}),
        ideal_time: idealTime,
        // skipCRM: PAY on a dine-in tab goes straight to /payment.
        skip_crm_page: true,
        pay_at_counter: "pay_at_counter",
        accessibility_mode: ada,
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

interface BootOptions extends KioskMockOptions {
  /** Device-setting rows appended to getKisokDeviceData. Default: both Paytm rows. */
  gateways?: JsonBody[];
  script?: PaytmScript;
  printBill?: boolean;
  printViaPos?: boolean;
}

interface Mocks {
  checkout: CheckoutMockHandle;
  paytm: PaytmMockHandle;
}

/**
 * Mocks (in the mandatory order) → register → order type (Arabic chosen
 * there when asked) → /menu (ADA toggled there when asked) → one Cheese
 * Burger → bag (£9.00) → PAY → /payment.
 */
async function bootToPayment(page: Page, opts: BootOptions = {}): Promise<Mocks> {
  await mockKioskBackend(page, opts);
  const checkout = await mockCheckoutBackend(page, {
    extraDeviceSettings: opts.gateways ?? [PAYTM_EDC_ENTITY, PAYTM_DQR_ENTITY],
    printBill: opts.printBill ?? false,
    printViaPos: opts.printViaPos ?? false,
  });
  // LAST: its five routes must beat checkout's FORBIDDEN_PATH_RE.
  const paytm = await mockPaytmBackend(page, opts.script);

  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible({ timeout: 10_000 });
  if (opts.arabic) {
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.getByTestId("footer-language")).toContainText("العربية");
  }
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 20_000 });
  if (opts.ada) {
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
  }

  await burgerToPayment(page);
  return { checkout, paytm };
}

/** /menu → one Cheese Burger → bag (£9.00) → PAY → /payment. */
async function burgerToPayment(page: Page) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("product-added-modal")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId("added-continue").click();

  // The P7d upsell may sit on the first VIEW MY BAG (forYou.spec.ts).
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("bag-pay")).toContainText("9.00");
  await page.getByTestId("bag-pay").click();
  await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
}

/** A method tile → the 3 s cancel window (nothing sent) → /receipt. */
async function chooseMethod(page: Page, tile: string) {
  await page.getByTestId(tile).click();
  await expect(page.getByTestId("payment-buffer")).toBeVisible();
  await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
}

/**
 * Pause the fake clock where it stands (+1 s, nothing due on /receipt): from
 * here on only {@link stepClockUntil} moves time (header, TIME). pauseAt
 * refuses a time in the past, and real time flows between the two calls — a
 * starved runner gets another try instead of a flake.
 */
async function freezeClock(page: Page) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.clock.pauseAt((await fakeNow(page)) + 1_000);
      return;
    } catch (error) {
      if (attempt === 3 || !String(error).includes("past")) throw error;
    }
  }
}

/**
 * Freeze, tap a receipt tile (the Paytm initiate) and land on /paymentPolling.
 * `double`: a {@link doubleTap} instead of one click.
 */
async function initiateToPolling(page: Page, receipt = "receipt-none", double = false) {
  await freezeClock(page);
  await (double ? doubleTap(page, receipt) : page.getByTestId(receipt).click());
  await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/paymentPolling$/);
}

/**
 * Two clicks in ONE task, before React can re-render the control inert — so
 * only the hook's own latch (initiate in-flight / status-read join) stands
 * between a double tap and a second request. Playwright's click() waits for
 * actionability, so two of those never land in the same render.
 */
const doubleTap = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    (el as HTMLElement).click();
    (el as HTMLElement).click();
  });

const fakeNow = (page: Page) => page.evaluate(() => Date.now());

/**
 * Advance fake time in small steps until `done()` holds — for timer chains
 * the page re-arms itself (recovery.spec.ts). GATED: time never moves while
 * a Paytm request is unanswered (header).
 */
async function stepClockUntil(
  page: Page,
  paytm: PaytmMockHandle,
  done: () => boolean | Promise<boolean>,
  { stepMs = 1_000, timeout = 60_000 } = {}
) {
  await expect
    .poll(
      async () => {
        if ((await paytm.inFlight()) === 0) await page.clock.runFor(stepMs);
        return done();
      },
      { timeout, intervals: [50] }
    )
    .toBe(true);
}

/** Step (gated) until the page's fake now reaches `at`; overshoots by < stepMs. */
async function stepClockTo(
  page: Page,
  paytm: PaytmMockHandle,
  at: number,
  stepMs = 4_000
) {
  await stepClockUntil(page, paytm, async () => (await fakeNow(page)) >= at, {
    stepMs,
    timeout: 90_000,
  });
}

const visible = (page: Page, testId: string) => async () =>
  (await page.getByTestId(testId).count()) > 0;

/**
 * Any one of these end panels is up. Wait on ALL of them and then assert the
 * expected one: a wrong outcome fails at once instead of at the step timeout.
 */
const anyVisible =
  (page: Page, ...testIds: string[]) =>
  async () => {
    for (const testId of testIds) {
      if ((await page.getByTestId(testId).count()) > 0) return true;
    }
    return false;
  };

interface PaymentSlice {
  paymentType: string;
  posBillNo: string;
  posBillTime: number | string;
  paytmQrCode: string;
}

interface KioskStore {
  getState: () => {
    payment: PaymentSlice;
    auth: { token?: string };
    autoUpdate: { shouldWholeAppUpdate: boolean };
  };
  dispatch: (action: { type: string; payload?: unknown }) => unknown;
}

/** state.payment via the DEV-only window.__kioskStore seam. */
const paymentSlice = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __kioskStore: KioskStore }).__kioskStore.getState()
        .payment
  );

/** state.payment as redux-persist last wrote it (`persist:root`). Read-only. */
const persistedPayment = (page: Page): Promise<Partial<PaymentSlice>> =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("persist:root");
    const slice = raw ? (JSON.parse(raw) as Record<string, string>).payment : undefined;
    return slice ? JSON.parse(slice) : {};
  });

/**
 * ⛔ Closes every case: the kiosk's placeOrder count, no forbidden endpoint
 * (legacy Paytm, gateway prefixes, backend-ordering) and both initiates.
 */
function expectMoneyInvariants(
  { checkout, paytm }: Mocks,
  expected: { placeOrder: number; dqrInit: number; edcInit: number }
) {
  expect(checkout.placeOrderCount, "kiosk placeOrder calls").toBe(expected.placeOrder);
  expect(
    checkout.forbiddenUrls,
    "a legacy Paytm / gateway / backend-ordering endpoint was contacted"
  ).toEqual([]);
  expect(checkout.forbiddenHit).toBe(false);
  expect(paytm.counts.dqrInit, "createQR calls").toBe(expected.dqrInit);
  expect(paytm.counts.edcInit, "EDC initiate calls").toBe(expected.edcInit);
}

/** The ids every EDC status / void body must carry: the initiate's. */
function edcIds(paytm: PaytmMockHandle) {
  const init = paytm.bodies.edcInit[0];
  return {
    deployment_id: "dep1",
    posBillNo: init.posBillNo,
    posBillTime: init.posBillTime,
    deviceId: PAYTM_EDC_DEVICE_ID,
  };
}

function expectEdcReadsCarry(paytm: PaytmMockHandle) {
  const ids = edcIds(paytm);
  expect(paytm.bodies.edcStatus.length).toBeGreaterThan(0);
  for (const body of paytm.bodies.edcStatus) {
    expect(body).toEqual({ ...ids, order_id: ids.posBillNo });
  }
  for (const body of paytm.bodies.edcCancel) {
    expect(body).toEqual(ids);
  }
}

/** Customer cancel: CANCEL PAYMENT → the confirm → YES, CANCEL. */
async function cancelPayment(page: Page, message: string) {
  await page.getByTestId("paytm-cancel").click();
  const confirm = page.getByTestId("paytm-cancel-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(message);
  await page.getByTestId("paytm-cancel-yes").click();
}

/**
 * Latches if `testId` is EVER in the DOM from now on (a MutationObserver —
 * microtask-driven, so the frozen clock does not starve it). Read it after.
 */
async function latchIfEverShown(page: Page, testId: string) {
  await page.evaluate((id) => {
    const w = window as unknown as { __everShown?: Record<string, boolean> };
    const seen = w.__everShown ?? {};
    w.__everShown = seen;
    seen[id] = false;
    const check = () => {
      if (document.querySelector(`[data-testid="${id}"]`)) seen[id] = true;
    };
    check();
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }, testId);
  return () =>
    page.evaluate(
      (id) =>
        (window as unknown as { __everShown?: Record<string, boolean> })
          .__everShown?.[id] === true,
      testId
    );
}

/** Same reach pass as ada.spec.ts: every visible control in the 1122 zone, uncovered. */
function reachProblems(scope: Locator): Promise<string[]> {
  return scope.evaluate(
    (root, { brandHeight, stageHeight }) => {
      const stage = document.querySelector('[data-testid="kiosk-stage"]');
      if (!stage) return ["kiosk-stage is not mounted"];
      const s = stage.getBoundingClientRect();
      const k = s.height / stageHeight;
      const zoneTop = s.top + brandHeight * k;
      const name = (el: Element) =>
        el.getAttribute("data-testid") ??
        el.getAttribute("aria-label") ??
        `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
      const out: string[] = [];
      let checked = 0;
      for (const el of root.querySelectorAll(
        'button, [role="button"], a, input:not([type="hidden"]), textarea, select'
      )) {
        const style = getComputedStyle(el);
        if (style.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        checked += 1;
        const y = (v: number) => Math.round((v - s.top) / k);
        if (
          r.top < zoneTop - 1 ||
          r.bottom > s.bottom + 1 ||
          r.left < s.left - 1 ||
          r.right > s.right + 1
        ) {
          out.push(`${name(el)}: outside the reach zone (stage y ${y(r.top)}–${y(r.bottom)})`);
          continue;
        }
        const backdrop =
          r.width >= s.width - 1 && r.height >= s.bottom - zoneTop - 1;
        if (backdrop || style.pointerEvents === "none") continue;
        const hit = document.elementFromPoint(
          (r.left + r.right) / 2,
          (r.top + r.bottom) / 2
        );
        if (!hit || !el.contains(hit)) {
          out.push(`${name(el)}: covered at its centre by ${hit ? name(hit) : "nothing"}`);
        }
      }
      if (checked === 0) out.push("no visible control under the scope");
      return out;
    },
    { brandHeight: ADA_BRAND_ZONE_HEIGHT, stageHeight: STAGE_HEIGHT }
  );
}

/** Entrance keyframes settle first, then every control under `scope` is reachable. */
async function expectReachable(page: Page, scope: Locator) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  );
  await expect.poll(() => reachProblems(scope)).toEqual([]);
}

/** Non-control boxes that must sit inside the reach zone too. */
function boxesOutsideZone(page: Page, testIds: string[]): Promise<string[]> {
  return page.evaluate(
    ({ ids, brandHeight, stageHeight }) => {
      const stage = document.querySelector('[data-testid="kiosk-stage"]');
      if (!stage) return ["kiosk-stage is not mounted"];
      const s = stage.getBoundingClientRect();
      const k = s.height / stageHeight;
      const zoneTop = s.top + brandHeight * k;
      return ids.flatMap((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) return [`${id}: missing`];
        const r = el.getBoundingClientRect();
        return r.top < zoneTop - 1 || r.bottom > s.bottom + 1
          ? [`${id}: stage y ${Math.round((r.top - s.top) / k)}–${Math.round((r.bottom - s.top) / k)}`]
          : [];
      });
    },
    { ids: testIds, brandHeight: ADA_BRAND_ZONE_HEIGHT, stageHeight: STAGE_HEIGHT }
  );
}

/** A translated template's text before its first {{placeholder}}. */
const staticPart = (template: string) => template.split("{{")[0].trim();

/**
 * The lazy /paymentPolling screen as the DEV server serves it (its source
 * module). A build serves assets/paytmRuntime-<hash>.js, which chunkRecovery
 * never reloads for (chunkRecovery.test, PaytmPaymentRoute.test).
 */
const PAYTM_CHUNK = "**/src/pages/PaytmPayment/paytmRuntime.ts*";

/** Counts the screen chunk's requests from now on. */
function countChunkRequests(page: Page) {
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/src/pages/PaytmPayment/paytmRuntime.ts")) requests += 1;
  });
  return () => requests;
}

/** Marks this document: a reload drops the marker. */
const markDocument = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
  });
const sameDocument = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true
  );

/** The whole-app reload the splash applies at its next dwell (P9e). */
const reloadFlagged = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __kioskStore: KioskStore }).__kioskStore.getState()
        .autoUpdate.shouldWholeAppUpdate
  );

test.describe("P8b Paytm DQR + EDC — exactly once", () => {
  // Before ANY page script: the app's timers must be fake from the start.
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("E1 DQR HAPPY: the QR renders as an svg, pending → pending → paid lands on Order Complete #last5, with one createQR carrying the parked ONLINE order", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      script: { dqrStatus: statusSequence("pending", "pending", "paid") },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-qr");
    await initiateToPolling(page);

    const qr = page.getByTestId("paytm-qr");
    await expect(qr).toBeVisible();
    await expect(qr.locator("svg")).toHaveCount(1);
    await expect(page.getByTestId("paytm-qr-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("paytm-total")).toContainText("£9.00");
    // The QR string lives in the slice; the DQR secret never does (D11).
    const slice = await paymentSlice(page);
    expect(slice.paymentType).toBe("PaytmDynamicQr");
    expect(slice.paytmQrCode).toBe(PAYTM_QR);
    expect(JSON.stringify(slice)).not.toContain(PAYTM_DQR_SECRET);

    await stepClockUntil(page, paytm, visible(page, "order-success"));
    await expect(page).toHaveURL(/\/orderSuccess$/);

    const init = paytm.bodies.dqrInit[0];
    const posBillId = init.posBillId;
    expect(posBillId).toMatch(/^\d{13,}$/);
    expect(init).toMatchObject({
      mid: PAYTM_DQR_MID,
      secretKey: PAYTM_DQR_SECRET,
      deployment_id: "dep1",
      posBillId,
      payload: {
        mid: PAYTM_DQR_MID,
        orderId: posBillId,
        amount: 9,
        businessType: "UPI_QR_CODE",
        posId: "dep1",
      },
    });
    expect(init.order_details.payments?.type).toBe("ONLINE");
    expect(
      init.order_details.originalPayments?.cards?.[0]?.detail?.[0]?.otherName
    ).toBe("PaytmDynamicQR");
    expect(init.order_details.source?.order_id).toBe(posBillId);
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${posBillId.slice(-5)}`
    );

    // pending, pending, paid — and NOT ONE read after "paid" (each read is a
    // backend placement trigger).
    expect(paytm.counts.dqrStatus).toBe(3);
    for (const body of paytm.bodies.dqrStatus) {
      expect(body).toEqual({
        deployment_id: "dep1",
        order_id: posBillId,
        mid: PAYTM_DQR_MID,
        secretKey: PAYTM_DQR_SECRET,
      });
    }

    // Order Complete's own exit resets first: /start finds no open session,
    // so its release sends nothing.
    await page.getByTestId("order-success-startover").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    expect(paytm.total).toBe(4);
    expect(paytm.counts.edcInit + paytm.counts.edcStatus + paytm.counts.edcCancel).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 1, edcInit: 0 });
  });

  test("E2 EDC HAPPY: one initiate (deviceId, billId === posBillNo, PaytmEDC) even from a double tap, every read carries the same ids, no void; PRINT with POS printing ON never contacts the print agent; browser Back re-runs nothing", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      printBill: true,
      printViaPos: true,
      script: { edcStatus: statusSequence("pending", "pending", "paid") },
    });
    const { checkout, paytm } = mocks;
    await chooseMethod(page, "payment-card");
    // A DOUBLE tap on PRINT: one terminal arming, never two (the initiate's
    // in-flight latch — the tiles only go inert a render later).
    await initiateToPolling(page, "receipt-print", true);
    await expect.poll(() => paytm.inFlight()).toBe(0);
    expect(paytm.counts.edcInit, "EDC initiate calls after a double tap").toBe(1);
    await expect(page.getByTestId("paytm-total")).toContainText("£9.00");
    await expect(page.getByTestId("paytm-countdown")).toBeVisible();

    // A trusted Back never reaches the router (AppRoutes trap): no /receipt,
    // so no second initiate can be tapped.
    const before = await paymentSlice(page);
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/paymentPolling$/);
    await expect(page.getByTestId("paytm-screen")).toBeVisible();
    await expect(page.getByTestId("receipt-screen")).toHaveCount(0);
    expect((await paymentSlice(page)).posBillNo).toBe(before.posBillNo);

    await stepClockUntil(page, paytm, visible(page, "order-success"));
    const init = paytm.bodies.edcInit[0];
    expect(init).toMatchObject({
      deployment_id: "dep1",
      posBillNo: before.posBillNo,
      billId: before.posBillNo,
      amount: 9,
      deviceId: PAYTM_EDC_DEVICE_ID,
      _customer: { phone: "" },
    });
    expect(typeof init.posBillTime).toBe("number");
    expect(init.order_details.payments?.type).toBe("ONLINE");
    expect(
      init.order_details.originalPayments?.cards?.[0]?.detail?.[0]?.otherName
    ).toBe("PaytmEDC");
    expect(init.order_details.source?.order_id).toBe(init.posBillNo);
    expect(paytm.counts.edcStatus).toBe(3);
    expectEdcReadsCarry(paytm);
    expect(paytm.counts.edcCancel).toBe(0);
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${init.posBillNo.slice(-5)}`
    );

    // Back on Order Complete: the screen stays, nothing re-reads or re-records.
    await page.goBack();
    await expect(page).toHaveURL(/\/orderSuccess$/);
    await expect(page.getByTestId("paytm-screen")).toHaveCount(0);

    await page.getByTestId("order-success-startover").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    // The POS prints the Paytm ticket: the kiosk sends nothing (checked after
    // Order Complete's exit, its last chance to print).
    expect(paytm.printBodies).toEqual([]);
    expect(checkout.printAgentUrls).toEqual([]);
    expect(paytm.total).toBe(4);
    expect(paytm.counts.dqrInit + paytm.counts.dqrStatus).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E2b EDC + PRINT with POS printing OFF: exactly one print POST, 'Payment Mode: Online', never '(UnPaid)'", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      printBill: true,
      printViaPos: false,
      script: { edcStatus: statusSequence("paid") },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page, "receipt-print");
    await stepClockUntil(page, paytm, visible(page, "order-success"));

    await expect.poll(() => paytm.printBodies.length).toBe(1);
    expect(paytm.printBodies[0]).toContain("Payment Mode: Online");
    expect(paytm.printBodies[0]).not.toContain("(UnPaid)");
    expect(paytm.printBodies[0]).toContain(paytm.bodies.edcInit[0].posBillNo.slice(-5));

    // Back cannot re-mount the paid tail (AppRoutes trap), and the exit's
    // belt-and-braces print is latched: still one POST.
    await page.goBack();
    await expect(page).toHaveURL(/\/orderSuccess$/);
    await page.getByTestId("order-success-startover").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    expect(paytm.printBodies).toHaveLength(1);
    expect(paytm.counts.edcStatus).toBe(1);
    expect(paytm.counts.edcCancel).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E3 EDC CUSTOMER CANCEL: YES → fresh pending read → ONE void (same ids) → 'press YES' → cancelled → /payment; then PAY AT COUNTER places exactly one COD order", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      script: {
        // The terminal reports "cancelled" once the void has reached it.
        edcStatus: (_call, handle) =>
          paytmStatus(handle.counts.edcCancel > 0 ? "cancelled" : "pending"),
      },
    });
    const { checkout, paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    await stepClockUntil(page, paytm, () => paytm.counts.edcStatus === 1);

    await cancelPayment(page, en.paytm.cancelConfirm.message);
    // No time moved: the fresh read and the void are effect-driven.
    await expect(page.getByTestId("paytm-terminal-prompt")).toHaveText(
      en.paytm.edc.pressYesToCancel,
      { timeout: 15_000 }
    );
    await expect(page.getByTestId("paytm-confirming")).toHaveCount(0);
    expect(paytm.counts.edcStatus).toBe(2);
    expect(paytm.counts.edcCancel).toBe(1);
    expect(paytm.bodies.edcCancel[0]).toEqual(edcIds(paytm));

    // The next read says "cancelled": back to the method choice, slice empty.
    await stepClockUntil(page, paytm, visible(page, "payment-screen"));
    await expect(page).toHaveURL(/\/payment$/);
    const slice = await paymentSlice(page);
    expect(slice.posBillNo).toBe("");
    expect(slice.paymentType).toBe("");
    expect(paytm.counts.edcCancel).toBe(1);
    expectEdcReadsCarry(paytm);
    const paytmCalls = paytm.total;

    // One order overall: the customer now pays at the counter.
    await page.clock.resume();
    await chooseMethod(page, "payment-counter");
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    expect(checkout.lastPlaceOrderBody).toMatchObject({ payments: { type: "COD" } });
    expect(paytm.total).toBe(paytmCalls);
    expectMoneyInvariants(mocks, { placeOrder: 1, dqrInit: 0, edcInit: 1 });
  });

  test("E4 CANCEL RACE: the fresh read after YES says paid — paid wins, Order Complete, and no void is ever sent", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page);
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    await stepClockUntil(page, paytm, () => paytm.counts.edcStatus === 1);

    // The guest completed the card payment as they tapped cancel.
    paytm.script.edcStatus = () => paytmStatus("paid");
    await cancelPayment(page, en.paytm.cancelConfirm.message);
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${paytm.bodies.edcInit[0].posBillNo.slice(-5)}`
    );
    // Exactly the one fresh read after YES — and no void.
    expect(paytm.counts.edcStatus).toBe(2);
    expect(paytm.counts.edcCancel).toBe(0);
    expectEdcReadsCarry(paytm);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E5 EDC EXPIRY: no void before 180 s, ONE void at the deadline, then 'cancelled' → the expired panel; BACK TO BAG returns to an intact bag", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const mocks = await bootToPayment(page, {
      script: {
        edcStatus: (_call, handle) =>
          paytmStatus(handle.counts.edcCancel > 0 ? "cancelled" : "pending"),
      },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    const posBillTime = paytm.bodies.edcInit[0].posBillTime;

    await stepClockTo(page, paytm, posBillTime + EDC_WINDOW_MS - 10_000);
    expect(paytm.counts.edcCancel).toBe(0);
    await expect(page.getByTestId("paytm-cancel")).toBeVisible();

    let voidAt = 0;
    await stepClockUntil(
      page,
      paytm,
      async () => {
        if (paytm.counts.edcCancel === 0) return false;
        voidAt = await fakeNow(page);
        return true;
      },
      { timeout: 30_000 }
    );
    expect(voidAt - posBillTime).toBeGreaterThanOrEqual(EDC_WINDOW_MS);
    expect(voidAt - posBillTime).toBeLessThan(EDC_WINDOW_MS + 5_000);

    await stepClockUntil(page, paytm, visible(page, "paytm-failed"));
    const failed = page.getByTestId("paytm-failed");
    await expect(failed).toContainText(en.paytm.failed.title);
    await expect(failed).toContainText(en.paytm.failed.expired);
    expect(paytm.counts.edcCancel).toBe(1);
    expectEdcReadsCarry(paytm);

    await page.getByTestId("paytm-failed-bag").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    const rows = page.locator('[data-testid^="bag-row-"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Cheese Burger");
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    expect((await paymentSlice(page)).posBillNo).toBe("");
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E6 EDC UNKNOWN (pending forever, void 500): the staff panel; CHECK AGAIN is one read and never an initiate; FINISH → /start, whose teardown sends one status + one void", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const mocks = await bootToPayment(page, {
      script: { edcCancel: () => httpError(500) },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    const { posBillNo, posBillTime } = paytm.bodies.edcInit[0];

    await stepClockTo(page, paytm, posBillTime + EDC_WINDOW_MS - 4_000);
    await stepClockUntil(page, paytm, visible(page, "paytm-unknown"), {
      timeout: 60_000,
    });
    const panel = page.getByTestId("paytm-unknown");
    await expect(panel).toContainText(en.paytm.unknown.title);
    await expect(panel).toContainText(posBillNo.slice(-5));
    // The void failed, so no terminal prompt — and it is never retried.
    await expect(page.getByTestId("paytm-terminal-prompt")).toHaveCount(0);
    expect(paytm.counts.edcCancel).toBe(1);
    // The panel waited the settle window after the deadline.
    expect((await fakeNow(page)) - posBillTime).toBeGreaterThanOrEqual(
      EDC_WINDOW_MS + SETTLE_WINDOW_MS
    );

    const reads = paytm.counts.edcStatus;
    // A DOUBLE tap joins the read in flight: still exactly one status read.
    await doubleTap(page, "paytm-unknown-check");
    await expect.poll(() => paytm.counts.edcStatus).toBe(reads + 1);
    await expect.poll(() => paytm.inFlight()).toBe(0);
    expect(paytm.counts.edcStatus, "status reads after a CHECK AGAIN double tap").toBe(
      reads + 1
    );
    await expect(page.getByTestId("paytm-unknown-note")).toHaveCount(0);
    await expect(panel).toBeVisible();
    // The panel does not poll by itself.
    await stepClockTo(page, paytm, (await fakeNow(page)) + 12_000);
    expect(paytm.counts.edcStatus).toBe(reads + 1);
    expect(paytm.counts.edcCancel).toBe(1);

    await page.getByTestId("paytm-unknown-finish").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/start$/);
    // /start's release: one last status read, still pending → one void.
    await expect.poll(() => paytm.counts.edcCancel).toBe(2);
    expect(paytm.counts.edcStatus).toBe(reads + 2);
    expectEdcReadsCarry(paytm);
    expect((await paymentSlice(page)).posBillNo).toBe("");
    // A user-level barrier, then the counts again: nothing ran twice.
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible({ timeout: 10_000 });
    expect(paytm.counts.edcStatus).toBe(reads + 2);
    expect(paytm.counts.edcCancel).toBe(2);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E6b EDC UNKNOWN → CHECK AGAIN answers paid: Order Complete with the same order, nothing placed by the kiosk", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      // A gateway 504 on the void: outcome unknown, and (D3) it never tears
      // the session down mid-payment.
      script: { edcCancel: () => httpError(504) },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);

    await cancelPayment(page, en.paytm.cancelConfirm.message);
    await expect.poll(() => paytm.counts.edcCancel).toBe(1);
    // A failed void leaves no prompt: PleaseWait covers the settle window.
    await expect(page.getByTestId("paytm-confirming")).toContainText(
      en.paytm.wait.cancelling
    );
    await stepClockUntil(page, paytm, visible(page, "paytm-unknown"), {
      stepMs: 2_000,
    });

    paytm.script.edcStatus = () => paytmStatus("paid");
    await page.getByTestId("paytm-unknown-check").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${paytm.bodies.edcInit[0].posBillNo.slice(-5)}`
    );
    expect(paytm.counts.edcCancel).toBe(1);
    expectEdcReadsCarry(paytm);
    const calls = paytm.total;

    await page.getByTestId("order-success-startover").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    expect(paytm.total).toBe(calls);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E6c EDC error reads never license a void: a cancel whose reads all fail ends on the staff panel with NO void, and /start's release reads once and voids nothing", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      script: { edcStatus: () => httpError(500) },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    await stepClockUntil(page, paytm, () => paytm.counts.edcStatus === 1);

    await cancelPayment(page, en.paytm.cancelConfirm.message);
    await stepClockUntil(page, paytm, visible(page, "paytm-unknown"), {
      stepMs: 2_000,
    });
    expect(paytm.counts.edcStatus).toBeGreaterThanOrEqual(2);
    expect(paytm.counts.edcCancel).toBe(0);

    const reads = paytm.counts.edcStatus;
    await page.getByTestId("paytm-unknown-finish").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => paytm.counts.edcStatus).toBe(reads + 1);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible({ timeout: 10_000 });
    expect(paytm.counts.edcStatus).toBe(reads + 1);
    expect(paytm.counts.edcCancel).toBe(0);
    expectEdcReadsCarry(paytm);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E6d EDC UNKNOWN → FINISH after the guest DID pay: /start's release reads 'paid' and never voids it", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      script: { edcCancel: () => httpError(500) },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);

    await cancelPayment(page, en.paytm.cancelConfirm.message);
    await expect.poll(() => paytm.counts.edcCancel).toBe(1);
    await stepClockUntil(page, paytm, visible(page, "paytm-unknown"), {
      stepMs: 2_000,
    });

    // The terminal took the card after all: the release's one read says paid,
    // and a void after it could reverse a captured payment (backend Q3).
    paytm.script.edcStatus = () => paytmStatus("paid");
    const reads = paytm.counts.edcStatus;
    await page.getByTestId("paytm-unknown-finish").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => paytm.counts.edcStatus).toBe(reads + 1);
    // A user-level barrier, then the counts again: no void followed the read.
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => paytm.inFlight()).toBe(0);
    expect(paytm.counts.edcStatus).toBe(reads + 1);
    expect(paytm.counts.edcCancel, "voids after a 'paid' release read").toBe(1);
    expectEdcReadsCarry(paytm);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  for (const { label, reply } of [
    { label: "E7 EDC initiate with a LOST BODY", reply: LOST_BODY },
    // The request left and a proxy answered 504: the terminal MAY be armed.
    // Also D3 — a 504 on the initiate never tears the session down.
    { label: "E7c EDC initiate answered by a gateway 504", reply: httpError(504) },
  ]) {
    test(`${label}: never sent again — /paymentPolling settles it by status with the SAME posBillNo → paid`, async ({
      page,
    }) => {
      test.slow();
      const mocks = await bootToPayment(page, {
        script: {
          edcInit: () => reply,
          edcStatus: statusSequence("pending", "paid"),
        },
      });
      const { paytm } = mocks;
      await chooseMethod(page, "payment-card");
      await initiateToPolling(page);
      await expect(page.getByTestId("paytm-initiate-failed")).toHaveCount(0);
      expect(paytm.counts.edcInit).toBe(1);

      await stepClockUntil(page, paytm, visible(page, "order-success"));
      const { posBillNo } = paytm.bodies.edcInit[0];
      await expect(page.getByTestId("order-number")).toHaveText(`#${posBillNo.slice(-5)}`);
      expect(paytm.counts.edcStatus).toBe(2);
      expectEdcReadsCarry(paytm);
      expect(paytm.counts.edcCancel).toBe(0);
      expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
    });
  }

  test("E7b RELOAD mid-EDC: the kiosk resumes the SAME session (same ids, no second initiate) and settles paid", async ({
    page,
  }) => {
    test.slow();
    // The flowing clock on purpose: redux-persist flushes on timers (header).
    const mocks = await bootToPayment(page);
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => paytm.counts.edcStatus, { timeout: 15_000 }).toBeGreaterThan(0);

    await page.reload();
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/paymentPolling$/);
    await expect(page.getByTestId("paytm-cancel")).toBeVisible();
    const reads = paytm.counts.edcStatus;
    paytm.script.edcStatus = () => paytmStatus("paid");
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });

    expect(paytm.counts.edcStatus).toBeGreaterThan(reads);
    expectEdcReadsCarry(paytm);
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${paytm.bodies.edcInit[0].posBillNo.slice(-5)}`
    );
    expect(paytm.counts.edcCancel).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E7d RELOAD mid-EDC-INITIATE on /receipt (F1): the reload resumes the SAME ids on /paymentPolling — never a re-tap with new ids — and settles paid", async ({
    page,
  }) => {
    test.slow();
    // The flowing clock on purpose: redux-persist flushes on timers (header).
    const mocks = await bootToPayment(page, {
      script: { edcStatus: statusSequence("pending", "paid") },
    });
    const { paytm } = mocks;
    // Registered last, so it shadows the fixture: the initiate LEFT (the
    // terminal may be armed) and its answer never comes. It stays armed, so
    // any second initiate would be caught here too.
    const parked: EdcInitBody[] = [];
    await page.route(PAYTM_ENDPOINTS.edcInit, (route) => {
      parked.push(route.request().postDataJSON() as EdcInitBody);
    });
    await chooseMethod(page, "payment-card");
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("paytm-preparing")).toBeVisible();
    await expect.poll(() => parked.length).toBe(1);
    const { posBillNo, posBillTime } = parked[0];
    // Stored BEFORE the call, and on disk before the reload.
    await expect
      .poll(async () => (await persistedPayment(page)).posBillNo)
      .toBe(posBillNo);
    // Still mid-initiate (the 10 s budget has not turned it into an EDC
    // outcome-unknown navigation of its own).
    await expect(page).toHaveURL(/\/receipt$/);

    await page.reload();
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/paymentPolling$/);
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("order-number")).toHaveText(`#${posBillNo.slice(-5)}`);

    expect(parked, "initiates after the reload").toHaveLength(1);
    expect(paytm.counts.edcStatus).toBe(2);
    for (const body of paytm.bodies.edcStatus) {
      expect(body).toEqual({
        deployment_id: "dep1",
        order_id: posBillNo,
        posBillNo,
        posBillTime,
        deviceId: PAYTM_EDC_DEVICE_ID,
      });
    }
    expect(paytm.counts.edcCancel).toBe(0);
    // The fixture's initiate route never ran: the parked call is the only one.
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 0 });
  });

  test("E7e RELOAD on /payment before a customer cancel's clear reached disk (F1, the /payment half of the guard): the session resumes on /paymentPolling with the SAME ids, settles 'cancelled', and TRY AGAIN lands on /payment — no strand, no loop", async ({
    page,
  }) => {
    test.slow();
    // Stand-in for redux-persist's write lag (~10 ms after each change; the
    // initiate flushes, this exit does not): once armed, persist:root writes
    // are dropped. The init script re-runs per document, so the reload
    // starts unarmed.
    await page.addInitScript(() => {
      const w = window as unknown as { __freezeDisk?: boolean };
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === "persist:root" && w.__freezeDisk) return;
        setItem.call(this, key, value);
      };
    });
    // The flowing clock on purpose: redux-persist flushes on timers (header).
    const mocks = await bootToPayment(page, {
      script: {
        // The terminal reports "cancelled" once the void has reached it.
        edcStatus: (_call, handle) =>
          paytmStatus(handle.counts.edcCancel > 0 ? "cancelled" : "pending"),
      },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });
    const { posBillNo } = paytm.bodies.edcInit[0];
    await expect.poll(async () => (await persistedPayment(page)).posBillNo).toBe(posBillNo);
    await page.evaluate(() => {
      (window as unknown as { __freezeDisk?: boolean }).__freezeDisk = true;
    });

    await cancelPayment(page, en.paytm.cancelConfirm.message);
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 20_000 });
    expect(paytm.counts.edcCancel).toBe(1);
    // Cleared in memory, still open on disk: the reload lands on /payment.
    expect((await paymentSlice(page)).posBillNo).toBe("");
    expect((await persistedPayment(page)).posBillNo).toBe(posBillNo);

    await page.reload();
    await page.waitForURL(/\/paymentPolling$/, { timeout: 20_000 });
    const failed = page.getByTestId("paytm-failed");
    await expect(failed).toBeVisible({ timeout: 20_000 });
    await expect(failed).toContainText(en.paytm.failed.cancelled);
    await page.getByTestId("paytm-failed-retry").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/payment$/);
    const calls = paytm.total;
    // Off disk too, so no later mount can resume it; nothing more was sent.
    await expect.poll(async () => (await persistedPayment(page)).posBillNo).toBe("");
    await expect(page).toHaveURL(/\/payment$/);
    expect(paytm.total).toBe(calls);

    expectEdcReadsCarry(paytm);
    expect(paytm.counts.edcCancel).toBe(1);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E7f RELOAD mid-EDC-INITIATE, never paid (F1 trade-off): the resumed EDC screen runs out the SAME window — ONE void with the SAME ids, the YES-only prompt — then the staff panel; FINISH releases it; no second initiate, ever", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    // Status "pending" forever, the void delivered (fixture defaults).
    const mocks = await bootToPayment(page);
    const { paytm } = mocks;
    // Registered last, so it shadows the fixture: the initiate LEFT (the
    // terminal may be armed) and its answer never comes. It stays armed, so
    // any second initiate would be parked — and counted — here too.
    const parked: EdcInitBody[] = [];
    await page.route(PAYTM_ENDPOINTS.edcInit, (route) => {
      parked.push(route.request().postDataJSON() as EdcInitBody);
    });
    await chooseMethod(page, "payment-card");
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("paytm-preparing")).toBeVisible();
    await expect.poll(() => parked.length).toBe(1);
    const { posBillNo, posBillTime } = parked[0];
    const ids = { deployment_id: "dep1", posBillNo, posBillTime, deviceId: PAYTM_EDC_DEVICE_ID };
    await expect
      .poll(async () => (await persistedPayment(page)).posBillNo)
      .toBe(posBillNo);
    await expect(page).toHaveURL(/\/receipt$/);

    await page.reload();
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/paymentPolling$/);
    await expect(page.getByTestId("paytm-cancel")).toBeVisible();
    // Resumed: from here only stepClockUntil moves time.
    await freezeClock(page);

    await stepClockTo(page, paytm, posBillTime + EDC_WINDOW_MS - 4_000);
    expect(paytm.counts.edcCancel, "voids before the deadline").toBe(0);
    await stepClockUntil(page, paytm, () => paytm.counts.edcCancel > 0, { timeout: 30_000 });
    await expect.poll(() => paytm.inFlight()).toBe(0);
    // F2: the void reached the terminal — YES-only copy, no NO option.
    await expect(page.getByTestId("paytm-terminal-prompt")).toHaveText(
      en.paytm.edc.pressYesToCancel
    );

    await stepClockUntil(
      page,
      paytm,
      anyVisible(page, "paytm-unknown", "paytm-failed", "order-success"),
      { timeout: 60_000 }
    );
    const panel = page.getByTestId("paytm-unknown");
    await expect(panel).toContainText(en.paytm.unknown.title);
    await expect(panel).toContainText(posBillNo.slice(-5));
    expect((await fakeNow(page)) - posBillTime).toBeGreaterThanOrEqual(
      EDC_WINDOW_MS + SETTLE_WINDOW_MS
    );
    expect(paytm.counts.edcCancel).toBe(1);
    expect(paytm.counts.edcStatus).toBeGreaterThan(1);

    // FINISH: /start's release (one status read, still pending → one void)
    // ends the session — with the same ids, and still never an initiate.
    const reads = paytm.counts.edcStatus;
    await page.getByTestId("paytm-unknown-finish").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => paytm.counts.edcCancel).toBe(2);
    expect(paytm.counts.edcStatus).toBe(reads + 1);
    expect((await paymentSlice(page)).posBillNo).toBe("");
    await page.clock.resume(); // redux-persist writes on timers
    await expect.poll(async () => (await persistedPayment(page)).posBillNo).toBe("");

    expect(parked, "initiates, before and after the reload").toHaveLength(1);
    for (const body of paytm.bodies.edcStatus) {
      expect(body).toEqual({ ...ids, order_id: posBillNo });
    }
    for (const body of paytm.bodies.edcCancel) expect(body).toEqual(ids);
    // The fixture's initiate route never ran: the parked call is the only one.
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 0 });
  });

  test("E7g RELOAD mid-DQR polling: the SAME QR comes back (same string, same svg, no second createQR), every read carries the same order id, and it settles paid; the QR leaves the disk with the session", async ({
    page,
  }) => {
    test.slow();
    // The flowing clock on purpose: redux-persist flushes on timers (header).
    const mocks = await bootToPayment(page);
    const { paytm } = mocks;
    await chooseMethod(page, "payment-qr");
    await page.getByTestId("receipt-none").click();
    const qr = page.getByTestId("paytm-qr");
    await expect(qr).toBeVisible({ timeout: 15_000 });
    const svg = await qr.locator("svg").innerHTML();
    const { posBillId } = paytm.bodies.dqrInit[0];
    await expect.poll(() => paytm.counts.dqrStatus, { timeout: 15_000 }).toBeGreaterThan(0);
    // In-session crash recovery: the open session (QR included) is on disk.
    await expect
      .poll(async () => (await persistedPayment(page)).paytmQrCode)
      .toBe(PAYTM_QR);
    expect((await persistedPayment(page)).posBillNo).toBe(posBillId);

    await page.reload();
    await expect(page).toHaveURL(/\/paymentPolling$/);
    await expect(qr).toBeVisible({ timeout: 20_000 });
    expect(await qr.locator("svg").innerHTML(), "the QR after the reload").toBe(svg);
    expect((await paymentSlice(page)).paytmQrCode).toBe(PAYTM_QR);
    await expect(page.getByTestId("paytm-countdown")).toBeVisible();

    const reads = paytm.counts.dqrStatus;
    paytm.script.dqrStatus = () => paytmStatus("paid");
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("order-number")).toHaveText(`#${posBillId.slice(-5)}`);
    expect(paytm.counts.dqrStatus).toBeGreaterThan(reads);
    for (const body of paytm.bodies.dqrStatus) {
      expect(body).toEqual({
        deployment_id: "dep1",
        order_id: posBillId,
        mid: PAYTM_DQR_MID,
        secretKey: PAYTM_DQR_SECRET,
      });
    }
    expect(paytm.counts.dqrInit, "createQR calls").toBe(1);

    // Order Complete's exit ends the session: nothing is released (already
    // settled) and the QR string is gone from the disk too.
    const calls = paytm.total;
    await page.getByTestId("order-success-startover").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await persistedPayment(page)).paytmQrCode).toBe("");
    expect((await persistedPayment(page)).posBillNo).toBe("");
    expect(paytm.total).toBe(calls);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 1, edcInit: 0 });
  });

  test("E7h NO STALE RESUME: after a Paytm session ENDED (paid → NEW ORDER, the fast path that skips /start), the next guest's /payment renders and stays, and their EDC initiate gets NEW ids — the old order is never read again", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      // Guest 1: pending, paid. Guest 2: paid on the first read.
      script: { edcStatus: statusSequence("pending", "paid") },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    await stepClockUntil(page, paytm, visible(page, "order-success"));
    const first = paytm.bodies.edcInit[0];
    const callsOfFirst = paytm.total;
    const readsOfFirst = paytm.counts.edcStatus;

    // The next guest walks the kiosk on the flowing clock.
    await page.clock.resume();
    await page.getByTestId("order-success-neworder").click();
    await expect(page.getByTestId("second-screen")).toBeVisible({ timeout: 10_000 });

    const everPolling = await latchIfEverShown(page, "paytm-screen");
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 20_000 });
    await burgerToPayment(page);
    // The guard rendered the page (a resume renders nothing and leaves).
    await expect(page).toHaveURL(/\/payment$/);
    await expect(page.getByTestId("payment-card")).toBeVisible();
    expect(await everPolling(), "/paymentPolling shown to the next guest").toBe(false);
    expect(paytm.total, "Paytm calls for the ended session").toBe(callsOfFirst);
    // Why: the session is over — nothing open in memory, nor on disk.
    const slice = await paymentSlice(page);
    expect(slice.posBillNo).toBe("");
    expect(slice.paymentType).toBe("");
    await expect.poll(async () => (await persistedPayment(page)).posBillNo).toBe("");

    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    await stepClockUntil(page, paytm, visible(page, "order-success"));
    const second = paytm.bodies.edcInit[1];
    expect(second.posBillNo).not.toBe(first.posBillNo);
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${second.posBillNo.slice(-5)}`
    );
    // Every read since the first session ended is the NEW order's.
    const later = paytm.bodies.edcStatus.slice(readsOfFirst);
    expect(later.length).toBeGreaterThan(0);
    for (const body of later) {
      expect(body).toEqual({
        deployment_id: "dep1",
        order_id: second.posBillNo,
        posBillNo: second.posBillNo,
        posBillTime: second.posBillTime,
        deviceId: PAYTM_EDC_DEVICE_ID,
      });
    }
    expect(paytm.counts.edcCancel).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 2 });
  });

  test("E8 EDC BUSY: the busy modal (retryable: TRY AGAIN with NEW ids, no PAY ANOTHER WAY), BACK TO BAG → intact bag; no status, no void", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, { script: { edcInit: () => EDC_BUSY } });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await page.getByTestId("receipt-none").click();

    const modal = page.getByTestId("paytm-initiate-failed");
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal).toContainText(en.paytm.failed.busy);
    await expect(page.getByTestId("paytm-initiate-retry")).toBeVisible();
    await expect(page.getByTestId("paytm-initiate-other")).toHaveCount(0);
    await expect(page.getByTestId("paytm-initiate-bag")).toBeVisible();
    // A clean refusal clears the ids: /start has nothing to release.
    expect((await paymentSlice(page)).posBillNo).toBe("");

    await page.getByTestId("paytm-initiate-retry").click();
    await expect.poll(() => paytm.counts.edcInit).toBe(2);
    await expect(modal).toBeVisible();
    expect(paytm.bodies.edcInit[1].posBillNo).not.toBe(paytm.bodies.edcInit[0].posBillNo);

    await page.getByTestId("paytm-initiate-bag").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.locator('[data-testid^="bag-row-"]')).toHaveCount(1);
    await expect(page.getByTestId("bag-pay")).toContainText("9.00");
    expect(paytm.counts.edcStatus).toBe(0);
    expect(paytm.counts.edcCancel).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 2 });
  });

  test("E8b a LOCAL refusal (no usable Paytm row at initiate time) sends nothing and offers PAY ANOTHER WAY → /payment", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page);
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    // The rows disappear between arming and the tap (DEV store seam).
    await page.evaluate(() =>
      (window as unknown as { __kioskStore: KioskStore }).__kioskStore.dispatch({
        type: "appSettings/setPaymentSettings",
        payload: [],
      })
    );
    await page.getByTestId("receipt-none").click();

    const modal = page.getByTestId("paytm-initiate-failed");
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal).toContainText(en.paytm.failed.start);
    await expect(page.getByTestId("paytm-initiate-retry")).toHaveCount(0);
    await page.getByTestId("paytm-initiate-other").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/payment$/);
    // Only the counter is left to offer.
    await expect(page.getByTestId("payment-counter")).toBeVisible();
    await expect(page.getByTestId("payment-card")).toHaveCount(0);
    expect(paytm.total).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 0 });
  });

  test("E9 DQR createQR 504: TRY AGAIN sends a SECOND createQR with a DIFFERENT orderId, which settles paid", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      script: {
        // A gateway 504 (classified like a 500: no QR was ever shown, so NEW
        // ids are safe) — and D3: it never tears the session down.
        dqrInit: (call) =>
          call === 1 ? httpError(504) : { json: { qrCode: PAYTM_QR } },
        dqrStatus: statusSequence("paid"),
      },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-qr");
    await freezeClock(page);
    await page.getByTestId("receipt-none").click();

    const modal = page.getByTestId("paytm-initiate-failed");
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal).toContainText(en.paytm.failed.start);
    expect((await paymentSlice(page)).posBillNo).toBe("");
    await page.getByTestId("paytm-initiate-retry").click();
    await expect(page.getByTestId("paytm-qr")).toBeVisible({ timeout: 15_000 });

    const [first, second] = paytm.bodies.dqrInit;
    expect(second.posBillId).not.toBe(first.posBillId);
    expect(second.payload.orderId).toBe(second.posBillId);
    expect(second.payload.orderId).not.toBe(first.payload.orderId);

    await stepClockUntil(page, paytm, visible(page, "order-success"));
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${second.posBillId.slice(-5)}`
    );
    expect(paytm.counts.dqrStatus).toBe(1);
    expect(paytm.bodies.dqrStatus[0].order_id).toBe(second.posBillId);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 2, edcInit: 0 });
  });

  test("E10 DQR EXPIRY: pending past 135 s + the 30 s settle → the expired panel, the QR gone, and no cancel endpoint at all; TRY AGAIN → /payment", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const mocks = await bootToPayment(page);
    const { paytm } = mocks;
    await chooseMethod(page, "payment-qr");
    await initiateToPolling(page);
    await expect(page.getByTestId("paytm-qr")).toBeVisible();
    const deadline = Number((await paymentSlice(page)).posBillTime) + DQR_WINDOW_MS;

    await stepClockTo(page, paytm, deadline + SETTLE_WINDOW_MS - 10_000);
    // Settling: the QR is no longer scannable, the verdict not yet in.
    await expect(page.getByTestId("paytm-qr")).toHaveCount(0);
    await expect(page.getByTestId("paytm-confirming")).toBeVisible();
    await expect(page.getByTestId("paytm-failed")).toHaveCount(0);

    await stepClockUntil(page, paytm, anyVisible(page, "paytm-failed", "paytm-unknown"));
    expect(await fakeNow(page)).toBeGreaterThanOrEqual(deadline + SETTLE_WINDOW_MS);
    await expect(page.getByTestId("paytm-unknown")).toHaveCount(0);
    await expect(page.getByTestId("paytm-failed")).toContainText(en.paytm.failed.expired);
    await expect(page.getByTestId("paytm-qr")).toHaveCount(0);
    expect(paytm.counts.edcCancel).toBe(0);

    await page.getByTestId("paytm-failed-retry").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 10_000 });
    const slice = await paymentSlice(page);
    expect(slice.posBillNo).toBe("");
    expect(slice.paytmQrCode).toBe("");
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 1, edcInit: 0 });
  });

  test("E10b DQR reads that only ever fail past expiry end on the UNKNOWN panel, never 'expired'; FINISH → /start's release reads the QR session once", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const mocks = await bootToPayment(page, {
      // 504 first (D3: a gateway timeout never tears the session down), then
      // alternating with app 500s.
      script: { dqrStatus: (call) => httpError(call % 2 === 1 ? 504 : 500) },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-qr");
    await initiateToPolling(page);
    const deadline = Number((await paymentSlice(page)).posBillTime) + DQR_WINDOW_MS;

    await stepClockTo(page, paytm, deadline - 4_000);
    await stepClockUntil(page, paytm, anyVisible(page, "paytm-unknown", "paytm-failed"), {
      timeout: 60_000,
    });
    await expect(page.getByTestId("paytm-unknown")).toContainText(en.paytm.unknown.title);
    await expect(page.getByTestId("paytm-failed")).toHaveCount(0);
    await expect(page.getByTestId("paytm-qr")).toHaveCount(0);
    expect(paytm.counts.dqrStatus).toBeGreaterThan(1);

    // FINISH: /start's release reads the open QR session ONE last time (the
    // read itself can make the backend place a paid order). DQR has no void.
    const reads = paytm.counts.dqrStatus;
    await page.getByTestId("paytm-unknown-finish").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => paytm.counts.dqrStatus).toBe(reads + 1);
    expect(paytm.bodies.dqrStatus[reads].order_id).toBe(paytm.bodies.dqrInit[0].posBillId);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible({ timeout: 10_000 });
    expect(paytm.counts.dqrStatus).toBe(reads + 1);
    expect(paytm.counts.edcCancel).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 1, edcInit: 0 });
  });

  test("E11 DQR CUSTOMER CANCEL: exactly one status read after YES, then /payment with the QR cleared", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page);
    const { paytm } = mocks;
    await chooseMethod(page, "payment-qr");
    await initiateToPolling(page);
    await stepClockUntil(page, paytm, () => paytm.counts.dqrStatus === 1);

    await cancelPayment(page, en.paytm.cancelConfirm.messageQr);
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/payment$/);
    expect(paytm.counts.dqrStatus).toBe(2);
    expect(paytm.bodies.dqrStatus[1].order_id).toBe(paytm.bodies.dqrInit[0].posBillId);
    expect(paytm.counts.edcCancel).toBe(0);
    const slice = await paymentSlice(page);
    expect(slice.paytmQrCode).toBe("");
    expect(slice.posBillNo).toBe("");
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 1, edcInit: 0 });
  });

  test("E12 IDLE (ideal_time 60): 150 s of an armed EDC terminal never prompts; the unknown panel releases the hold, the prompt follows a full period, then /start releases the session (status + void)", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const mocks = await bootToPayment(page, { idealTime: "60" });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    const { posBillTime } = paytm.bodies.edcInit[0];
    const everPrompted = await latchIfEverShown(page, "idle-modal");

    // 60 s idle would prompt at 40 s and end the session at 60 s.
    await stepClockTo(page, paytm, posBillTime + 150_000);
    await expect(page).toHaveURL(/\/paymentPolling$/);
    await expect(page.getByTestId("paytm-cancel")).toBeVisible();
    expect(await everPrompted()).toBe(false);

    // Window → fresh pending → void → "press YES" → settle → unknown. Stops
    // at once if idle prompts or ends the session first (fail fast).
    await stepClockUntil(
      page,
      paytm,
      async () =>
        (await visible(page, "paytm-unknown")()) ||
        (await everPrompted()) ||
        !/\/paymentPolling$/.test(page.url()),
      { timeout: 90_000 }
    );
    expect(await everPrompted()).toBe(false);
    await expect(page.getByTestId("paytm-unknown")).toBeVisible();
    expect(paytm.counts.edcCancel).toBe(1);
    const reads = paytm.counts.edcStatus;

    // A FULL fresh period from the release (idle.spec.ts: two jumps).
    await page.clock.fastForward(30_000);
    await page.clock.runFor(500);
    await expect(page.getByTestId("idle-modal")).toHaveCount(0);
    await page.clock.fastForward(11_000);
    await expect(page.getByTestId("idle-modal")).toBeVisible();
    // Not vacuous: the latch does see a prompt once there is one.
    expect(await everPrompted()).toBe(true);
    // The idle timeout is armed when the prompt fires (at the last jump's
    // target): one more full 20 s window, plus a second of margin.
    await page.clock.fastForward(21_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    await expect.poll(() => paytm.counts.edcCancel).toBe(2);
    expect(paytm.counts.edcStatus).toBe(reads + 1);
    expectEdcReadsCarry(paytm);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E13 a 504 and a 401 on status polls never tear the session down (D3): /paymentPolling stays, the token stays, no navigation to '/'", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      script: {
        edcStatus: (call) =>
          call === 1 ? httpError(504) : call === 2 ? httpError(401) : paytmStatus("pending"),
      },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname);
    });

    // The third read only exists if both failures were handled in place;
    // leaving the screen (session recovery) ends the wait at once.
    await stepClockUntil(
      page,
      paytm,
      () => paytm.counts.edcStatus >= 3 || !/\/paymentPolling$/.test(page.url())
    );
    await expect(page).toHaveURL(/\/paymentPolling$/);
    await expect(page.getByTestId("paytm-screen")).toBeVisible();
    await expect(page.getByTestId("paytm-cancel")).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === "token")?.value).toBe(
      "mock-device-token"
    );
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __kioskStore: KioskStore }).__kioskStore.getState()
            .auth.token
      )
    ).toBeTruthy();
    expect(navigations).not.toContain("/");

    paytm.script.edcStatus = () => paytmStatus("paid");
    await stepClockUntil(page, paytm, visible(page, "order-success"));
    // Not vacuous: the recorder sees in-app navigations too.
    expect(navigations).toContain("/orderSuccess");
    expect(navigations).not.toContain("/");
    expectEdcReadsCarry(paytm);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E14 + E15 three tiles in one row; a guest who picks PAY AT COUNTER gets exactly one COD order and zero Paytm calls", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page);
    const { checkout, paytm } = mocks;

    const tiles = ["payment-card", "payment-qr", "payment-counter"];
    const boxes: ({ y: number; width: number } | null)[] = [];
    for (const id of tiles) {
      await expect(page.getByTestId(id)).toBeVisible();
      boxes.push(await page.getByTestId(id).boundingBox());
    }
    await expect(page.getByTestId("payment-card")).toContainText(en.payment.payWithCard);
    await expect(page.getByTestId("payment-qr")).toContainText(en.paytm.methodQr);
    for (const box of boxes) {
      // D9: (848 − 24·2) / 3 = 266.67 px, all on one row.
      expect(Math.abs((box?.width ?? 0) - 800 / 3)).toBeLessThan(1);
      expect(box?.y).toBe(boxes[0]?.y);
    }

    await chooseMethod(page, "payment-counter");
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    expect(checkout.lastPlaceOrderBody).toMatchObject({ payments: { type: "COD" } });
    expect(paytm.total).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 1, dqrInit: 0, edcInit: 0 });
  });

  test("E15b a COD-only deployment shows the single 412 px PAY AT COUNTER tile", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, { gateways: [] });
    await expect(page.getByTestId("payment-counter")).toBeVisible();
    await expect(page.getByTestId("payment-card")).toHaveCount(0);
    await expect(page.getByTestId("payment-qr")).toHaveCount(0);
    const box = await page.getByTestId("payment-counter").boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(412);
    expect(mocks.paytm.total).toBe(0);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 0 });
  });

  test("E16 ADA, EDC: every /paymentPolling control — CANCEL, the confirm, the staff panel — sits inside the 1122 reach zone, and the sheen root never scrolls", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      ada: true,
      script: { edcCancel: () => httpError(500) },
    });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);

    await expectReachable(page, page.getByTestId("reach-zone"));
    expect(
      await boxesOutsideZone(page, ["paytm-total", "paytm-countdown", "paytm-cancel"])
    ).toEqual([]);
    await page.getByTestId("paytm-cancel").click();
    await expectReachable(page, page.getByTestId("paytm-cancel-confirm"));
    await page.getByTestId("paytm-cancel-keep").click();
    await expect(page.getByTestId("paytm-cancel-confirm")).toHaveCount(0);
    expect(paytm.counts.edcCancel).toBe(0);

    await cancelPayment(page, en.paytm.cancelConfirm.message);
    await expect(page.getByTestId("paytm-confirming")).toBeVisible();
    // overflow-clip roots: the turned 1920-tall sheen overflows the 1122 zone,
    // and a click must never scroll the screen (UI-F2).
    for (const id of ["paytm-screen", "paytm-confirming"]) {
      expect(await page.getByTestId(id).evaluate((el) => el.scrollTop), id).toBe(0);
    }

    await stepClockUntil(page, paytm, visible(page, "paytm-unknown"), {
      stepMs: 2_000,
    });
    await expectReachable(page, page.getByTestId("paytm-unknown"));
    expect(paytm.counts.edcCancel).toBe(1);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E16b ADA, DQR: the 360 px QR and every control sit inside the reach zone; a terminal 'cancelled' opens the not-paid panel there too", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, { ada: true });
    const { paytm } = mocks;
    await chooseMethod(page, "payment-qr");
    await initiateToPolling(page);

    const qr = page.getByTestId("paytm-qr");
    await expect(qr.locator("svg")).toHaveCount(1);
    expect(Math.round((await qr.boundingBox())?.width ?? 0)).toBe(360);
    await expectReachable(page, page.getByTestId("reach-zone"));
    expect(
      await boxesOutsideZone(page, ["paytm-qr", "paytm-total", "paytm-countdown", "paytm-cancel"])
    ).toEqual([]);

    paytm.script.dqrStatus = () => paytmStatus("cancelled");
    await stepClockUntil(page, paytm, visible(page, "paytm-failed"));
    await expect(page.getByTestId("paytm-failed")).toContainText(en.paytm.failed.cancelled);
    await expectReachable(page, page.getByTestId("paytm-failed"));
    await page.getByTestId("paytm-failed-bag").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 1, edcInit: 0 });
  });

  test("E17 ARABIC: the paytm.* copy renders translated — tiles, buffer, the EDC screen, the confirm, PleaseWait and the staff panel — with no raw keys", async ({
    page,
  }) => {
    test.slow();
    const mocks = await bootToPayment(page, {
      arabic: true,
      script: { edcCancel: () => httpError(500) },
    });
    const { paytm } = mocks;
    const noRawKeys = async () =>
      expect(await page.locator("body").innerText()).not.toMatch(/\bpaytm\.[a-z]/i);

    await expect(page.getByTestId("payment-card")).toContainText(ar.payment.payWithCard);
    await expect(page.getByTestId("payment-qr")).toContainText(ar.paytm.methodQr);
    await noRawKeys();
    await page.getByTestId("payment-card").click();
    await expect(page.getByTestId("payment-buffer")).toContainText(ar.paytm.redirecting);
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await initiateToPolling(page);

    const screen = page.getByTestId("paytm-screen");
    await expect(screen).toContainText(ar.paytm.instructions.title);
    await expect(screen).toContainText(ar.paytm.edc.hint);
    await expect(screen).toContainText(ar.paytm.instructions.downHere);
    await expect(page.getByTestId("paytm-cancel")).toContainText(ar.paytm.cancel);
    await expect(page.getByTestId("paytm-countdown")).toContainText(
      staticPart(ar.paytm.timeLeft)
    );
    await noRawKeys();

    await page.getByTestId("paytm-cancel").click();
    const confirm = page.getByTestId("paytm-cancel-confirm");
    await expect(confirm).toContainText(ar.paytm.cancelConfirm.title);
    await expect(confirm).toContainText(ar.paytm.cancelConfirm.message);
    await expect(confirm).toContainText(ar.paytm.cancelConfirm.keep);
    await expect(confirm).toContainText(ar.paytm.cancelConfirm.confirm);
    await noRawKeys();
    await page.getByTestId("paytm-cancel-yes").click();

    const wait = page.getByTestId("paytm-confirming");
    await expect(wait).toContainText(ar.paytm.wait.title);
    await expect(wait).toContainText(ar.paytm.wait.cancelling);
    await noRawKeys();

    await stepClockUntil(page, paytm, visible(page, "paytm-unknown"), {
      stepMs: 2_000,
    });
    const panel = page.getByTestId("paytm-unknown");
    await expect(panel).toContainText(ar.paytm.unknown.title);
    await expect(panel).toContainText(staticPart(ar.paytm.unknown.message));
    await expect(panel).toContainText(paytm.bodies.edcInit[0].posBillNo.slice(-5));
    await expect(page.getByTestId("paytm-unknown-check")).toContainText(
      ar.paytm.unknown.checkAgain
    );
    await expect(page.getByTestId("paytm-unknown-finish")).toContainText(
      ar.paytm.unknown.finish
    );
    await noRawKeys();
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E19 CHUNK FAILURE before the initiate: the lazy /paymentPolling screen never arrives — a LOCAL refusal (PAY ANOTHER WAY, nothing sent, never a reload mid-session); with the network back the same document refuses again; the next splash reloads it and the next guest's checkout initiates once onto the screen", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const mocks = await bootToPayment(page, { idealTime: "60" });
    const { paytm } = mocks;
    const chunkRequests = countChunkRequests(page);
    const abort = (route: Route) => route.abort();
    await page.route(PAYTM_CHUNK, abort);
    await chooseMethod(page, "payment-card");
    await markDocument(page);
    await freezeClock(page);
    await page.getByTestId("receipt-none").click();

    /** Refused BEFORE any id or request: the non-retryable modal, on /receipt. */
    const expectRefusedWithNothingSent = async () => {
      const modal = page.getByTestId("paytm-initiate-failed");
      await expect(modal).toBeVisible({ timeout: 15_000 });
      await expect(modal).toContainText(en.paytm.failed.start);
      await expect(page.getByTestId("paytm-initiate-retry")).toHaveCount(0);
      await expect(page).toHaveURL(/\/receipt$/);
      expect(paytm.total, "Paytm calls without the screen").toBe(0);
      expect((await paymentSlice(page)).posBillNo).toBe("");
      expect(await sameDocument(page), "reloaded mid-session").toBe(true);
    };
    await expectRefusedWithNothingSent();
    expect(chunkRequests()).toBe(1);
    // The reload is owed to the NEXT splash.
    expect(await reloadFlagged(page)).toBe(true);

    // The network is back, but this document remembers the failed fetch (the
    // module map): PAY ANOTHER WAY → the same tile → refused again, nothing
    // sent — an initiate here would arm a terminal no screen can settle.
    await page.unroute(PAYTM_CHUNK, abort);
    await page.getByTestId("paytm-initiate-other").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 10_000 });
    await page.clock.resume();
    await chooseMethod(page, "payment-card");
    await freezeClock(page);
    await page.getByTestId("receipt-none").click();
    await expectRefusedWithNothingSent();
    expect(chunkRequests(), "the browser answered from its failure cache").toBe(1);

    // The guest walks away: a FULL idle period from the refusal (E12's
    // jumps) brings the kiosk home, still on the poisoned document ...
    await page.clock.fastForward(30_000);
    await page.clock.runFor(500);
    await expect(page.getByTestId("idle-modal")).toHaveCount(0);
    await page.clock.fastForward(11_000);
    await expect(page.getByTestId("idle-modal")).toBeVisible();
    await page.clock.fastForward(21_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    expect(await sameDocument(page)).toBe(true);
    // ... where the update dwell (10 s + a 5 s countdown) reloads the page.
    // Ungated steps: nothing Paytm is open, and the page navigates mid-poll.
    let loads = 0;
    page.on("load", () => {
      loads += 1;
    });
    await expect
      .poll(
        async () => {
          await page.clock.runFor(1_000);
          return loads;
        },
        { timeout: 30_000, intervals: [50] }
      )
      .toBe(1);
    await page.clock.resume();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    expect(await sameDocument(page), "the splash reload").toBe(false);
    expect(await reloadFlagged(page)).toBe(false);
    expect(paytm.total).toBe(0);

    // The next guest, on the fresh document: the chunk loads, ONE initiate,
    // the settlement screen.
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 20_000 });
    await burgerToPayment(page);
    await chooseMethod(page, "payment-card");
    await initiateToPolling(page);
    await expect(page.getByTestId("paytm-cancel")).toBeVisible();
    expect(chunkRequests()).toBe(2);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });

  test("E19b CHUNK FAILURE on a RESUMED session: a reload mid-EDC whose screen chunk never arrives shows the staff panel (never blank, never a reload) — nothing polls or voids from it; FINISH → /start, whose release sends one status + one void; no second initiate", async ({
    page,
  }) => {
    test.slow();
    // The flowing clock on purpose: redux-persist flushes on timers (header).
    const mocks = await bootToPayment(page);
    const { paytm } = mocks;
    await chooseMethod(page, "payment-card");
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => paytm.counts.edcStatus, { timeout: 15_000 }).toBeGreaterThan(0);

    await page.route(PAYTM_CHUNK, (route) => route.abort());
    await page.reload();
    const panel = page.getByRole("alertdialog", { name: en.paytm.unknown.title });
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/paymentPolling$/);
    await expect(panel).toContainText(paytm.bodies.edcInit[0].posBillNo.slice(-5));
    await expect(page.getByTestId("paytm-screen")).toHaveCount(0);
    // A reload from here on would drop this marker.
    await markDocument(page);
    expect(await reloadFlagged(page)).toBe(true);
    await freezeClock(page);
    // Nothing on the panel polls or voids.
    const reads = paytm.counts.edcStatus;
    expect(paytm.counts.edcCancel).toBe(0);

    await page.getByTestId("paytm-unavailable-finish").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    // /start's release: one status read, still pending → one void.
    await expect.poll(() => paytm.counts.edcCancel).toBe(1);
    expect(paytm.counts.edcStatus).toBe(reads + 1);
    expectEdcReadsCarry(paytm);
    expect((await paymentSlice(page)).posBillNo).toBe("");
    expect(await sameDocument(page), "reloaded before the splash dwell").toBe(true);
    expectMoneyInvariants(mocks, { placeOrder: 0, dqrInit: 0, edcInit: 1 });
  });
});
