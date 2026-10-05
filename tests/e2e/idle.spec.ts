import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mockCheckoutBackend, PLACE_ORDER_URL } from "./fixtures/checkout";
import {
  mockXenoLoyalty,
  LOYALTY_OTP,
  LOYALTY_PHONE,
  LOYALTY_REWARDS,
  LOYALTY_SETTINGS,
} from "./fixtures/loyalty";

/**
 * P9a — idle timeout + session integrity, end to end.
 *
 * Covers the contract decisions that only show up in the running app: the
 * Rule 1 timing (D1), the prompt and its two ways out (D4/D7), the /start
 * teardown owner and hazard H1 (D3), holds (D5), the guard's placement (D6),
 * the language reset (D9) and the late-navigation guards (D10) — including
 * the guards the integrate/fix stages added to BagSheet, useLoyalty and
 * useMenuConverters.
 *
 * ── TIME: page.clock, NEVER REAL WAITS ──────────────────────────────────
 * The suite timeout is 30 s and the idle period is 120 s, so every idle
 * second here is fake. `page.clock.install()` runs before the first goto
 * (beforeEach) so react-idle-timer binds the fake timers at module load.
 * The installed clock keeps running in real time between calls — boot,
 * mocks and CSS still behave normally — and:
 *   - `fastForward(ms)` jumps, firing each due timer ONCE at the target time.
 *     That is why the prompt and the timeout are always reached in TWO jumps
 *     (100 s, then 20 s): one 120 s jump would fire the prompt timer already
 *     past the whole period, which react-idle-timer (correctly) treats as
 *     straight-to-idle with no prompt — "the laptop lid was closed".
 *   - `runFor(ms)` fires every timer in the range, so it drives the 1 Hz
 *     OrderSuccess countdown and lets late continuations settle.
 * Real time still trickles in between calls, so every "not yet" check keeps
 * a >= 10 s margin from its deadline.
 *
 * ── P9b: EVERY REQUEST IS BOUNDED ───────────────────────────────────────
 * TB's transport now aborts a request after 10 s (getMenu 30 s) — and those
 * budgets are fake-clock timers too, so every jump above also expires any
 * call parked across it. No call can outlive the 100 s prompt any more:
 * the holds (D5) are backstops, a hung push ends on the order-error panel,
 * and the late-answer guards (D10) are reached by a CUSTOMER exit taken
 * inside the budget, not by idle. The recovery surfaces themselves are
 * tests/e2e/recovery.spec.ts's.
 *
 * ── TIMING UNDER TEST (D1) ──────────────────────────────────────────────
 * The fixtures keep the house `ideal_time: "180"`. Rule 1 is a CEILING, so
 * resolveIdleSeconds clamps it to 120 s: prompt at 100 s, Splash at 120 s.
 * A prompt at 160 s would mean the server lengthened the timeout.
 *
 * ── MOCK ORDER ──────────────────────────────────────────────────────────
 * Same house order as bag.spec.ts: the `**\/api/**` catch-all FIRST, every
 * specific mock after it (Playwright matches newest-first). Both cross-origin
 * edges the catch-all cannot see are routed here too: the print agent
 * (https://localhost:65505, aborted) and the Xeno revoke (xeno.in:2223 —
 * unrouted, its raw fetch hangs until its own 10 s bound). Fixture layers
 * (checkout, loyalty) and `parkRequests` come after that, so they win.
 *
 * Boot helpers are copied from bag.spec.ts / loyalty.spec.ts (neither exports
 * them — copying is the established precedent in this suite).
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

/** £17, no modifiers, no recommendedItems: one tap lands it, no modal. */
const GREEK_SALAD = "5dd1093829754a432f2c32e2";
/** Has modifier groups: a card tap opens the /customization PDP. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
/** £2, no modifiers, no upsell: one tap lands it (a paid row beside a reward). */
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b";

/** D1: 120 s total, the prompt is the last 20 s. */
const PROMPT_AFTER_MS = 100_000;
const PROMPT_WINDOW_MS = 20_000;
/** P9b request budgets (src/redux/app/apiSlice.ts): 10 s, getMenu 30 s. */
const REQUEST_BUDGET_MS = 10_000;
const MENU_BUDGET_MS = 30_000;

interface KioskMockOptions {
  /** Pay-at-counter fan-out (checkout.spec.ts): PAY → /payment. */
  skipCRM?: boolean;
  /** Xeno loyalty on (loyalty.spec.ts): /second → /phone. */
  loyalty?: boolean;
  /** Offer Arabic as the secondary language. */
  arabic?: boolean;
}

async function mockKioskBackend(page: Page, opts: KioskMockOptions = {}) {
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
        secondary_language: opts.arabic
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
        ...(opts.arabic ? { start_order_text_secondary: "ابدأ الطلب" } : {}),
        // Clamped to 120 s — see the header.
        ideal_time: "180",
        ...(opts.skipCRM
          ? { skip_crm_page: true, pay_at_counter: "pay_at_counter" }
          : {}),
        ...(opts.loyalty ? LOYALTY_SETTINGS : {}),
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

interface ParkedRequests {
  /** Requests parked so far — poll it to know the call is in flight. */
  readonly count: number;
  arm: () => void;
  /**
   * Stop parking WITHOUT answering what is parked — for a request whose
   * budget already aborted it in the page (P9b): it must never be answered.
   */
  disarm: () => void;
  /** Hand every parked request on to the fixture handler: it completes, late. */
  release: () => Promise<void>;
}

/**
 * Parks matching requests while armed — how a call is made to outlive the
 * session (inside its P9b budget). Register it AFTER the mock it shadows
 * (newest wins); release() passes each parked request to that older handler
 * with route.fallback(), so it completes exactly as it would have, only after
 * the kiosk moved on.
 */
async function parkRequests(
  page: Page,
  url: string | RegExp,
  { armed = true } = {}
): Promise<ParkedRequests> {
  const parked: Route[] = [];
  let isArmed = armed;
  await page.route(url, (route) => {
    if (!isArmed) return route.fallback();
    parked.push(route);
    return undefined;
  });
  return {
    get count() {
      return parked.length;
    },
    arm: () => {
      isArmed = true;
    },
    disarm: () => {
      isArmed = false;
    },
    release: async () => {
      isArmed = false;
      await Promise.all(parked.splice(0).map((route) => route.fallback()));
    },
  };
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

/** Splash → order type → /menu (loyalty off). */
async function startOrderToMenu(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

async function bootRegisteredToMenu(page: Page) {
  await registerToStart(page);
  await startOrderToMenu(page);
}

async function addGreekSaladOneTap(page: Page, expectedCount: string) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText(expectedCount);
}

/**
 * VIEW MY BAG → /cart. The first open of a session may meet the P7d upsell
 * (/forYou); declining it mutates no cart state (see bag.spec.ts openBag).
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

/** KioskNumpad is the only numeric keypad mounted at a time. */
async function typeDigits(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByTestId(`numpad-key-${digit}`).click();
  }
}

/** Loyalty on: Splash → order type → /phone (the pre-menu lookup). */
async function startOrderToPhone(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
}

/** Rows in the Dexie cart mirror (KioskDB.cartItems). Read-only. */
function dexieCartCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("KioskDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const count = db
            .transaction("cartItems", "readonly")
            .objectStore("cartItems")
            .count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            db.close();
            reject(count.error);
          };
        };
      })
  );
}

/**
 * `state.loyalty.totalLoyaltyPoints` from the persisted redux root (the
 * loyalty.spec.ts reader) — the balance has no UI surface off the rewards
 * sheet. Read-only.
 */
function persistedLoyaltyPoints(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("persist:root");
    if (!raw) return Number.NaN;
    const root = JSON.parse(raw) as Record<string, string>;
    if (!root.loyalty) return Number.NaN;
    const loyalty = JSON.parse(root.loyalty) as { totalLoyaltyPoints?: number };
    return Number(loyalty.totalLoyaltyPoints);
  });
}

const idleModal = (page: Page) => page.getByTestId("idle-modal");

/** 100 s of inactivity: the prompt opens. */
async function idleToPrompt(page: Page) {
  await page.clock.fastForward(PROMPT_AFTER_MS);
  await expect(idleModal(page)).toBeVisible();
}

/** The rest of the window: the session ends on its own, on Splash. */
async function idleToTimeout(page: Page) {
  await page.clock.fastForward(PROMPT_WINDOW_MS);
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/start$/);
  await expect(idleModal(page)).toHaveCount(0);
}

/**
 * Absence check. A timer that fired inside the last jump paints a render
 * later, so give it a beat of fake time first — otherwise this could pass
 * before the prompt it should catch exists.
 */
async function expectNoPrompt(page: Page) {
  await page.clock.runFor(500);
  await expect(idleModal(page)).toHaveCount(0);
}

/**
 * The landing on Splash must HOLD. H1 (and every late continuation) would
 * re-navigate within a few commits, so settle, then look again.
 */
async function expectStaysOnStart(page: Page) {
  await page.clock.runFor(2_000);
  await expect(page).toHaveURL(/\/start$/);
  await expect(page.getByTestId("start-screen")).toBeVisible();
  await expect(page.getByTestId("menu-screen")).toHaveCount(0);
}

test.describe("P9a idle timeout + session integrity", () => {
  // Before ANY page script runs: react-idle-timer captures setTimeout at
  // module load, so a clock installed after goto would never reach it.
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("TIMEOUT: /menu with an item prompts at 100 s (not 90 s), ends on /start at 120 s, and the next session's bag and Dexie mirror are empty", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    await expect.poll(() => dexieCartCount(page)).toBe(1);

    await page.clock.fastForward(90_000);
    await expectNoPrompt(page);
    // 90.5 s → 100 s+: the prompt is the LAST 20 s of 120 (never 180 − 20).
    await page.clock.fastForward(10_000);
    const prompt = page.getByRole("alertdialog");
    await expect(prompt).toBeVisible();
    await expect(prompt).toHaveAccessibleName(/you have been inactive/i);
    await expect(prompt).toHaveAccessibleDescription(
      /starting again in \d+ seconds/i
    );
    // An alertdialog takes focus: one key press extends (WCAG 2.2.1).
    await expect(page.getByTestId("idle-continue")).toBeFocused();
    // Nothing is torn down while the customer can still answer.
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");

    await idleToTimeout(page);
    await expectStaysOnStart(page);
    // /start's mount owns the teardown (D3): the Dexie mirror goes with it.
    await expect.poll(() => dexieCartCount(page)).toBe(0);

    await startOrderToMenu(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toContainText("0.00");
  });

  test("CONTINUE: CONTINUE ORDERING at ~110 s keeps the cart and the screen, re-arms a FULL period, and the backdrop continues too", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");

    await idleToPrompt(page);
    await page.clock.fastForward(10_000);
    await expect(idleModal(page)).toBeVisible();
    await page.getByTestId("idle-continue").click();
    await expect(idleModal(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");

    // The old 120 s deadline passes harmlessly: continue started a fresh
    // period, so the next prompt is 100 s after the tap — not before.
    await page.clock.fastForward(90_000);
    await expectNoPrompt(page);
    await expect(page).toHaveURL(/\/menu$/);
    await page.clock.fastForward(10_000);
    await expect(idleModal(page)).toBeVisible();

    // D4: a backdrop tap is CONTINUE (clear of the centred card).
    await page
      .getByTestId("idle-backdrop")
      .click({ position: { x: 40, y: 40 } });
    await expect(idleModal(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
  });

  test("H1: idle with the bag open on /cart — and on /customization — lands on /start and never re-parks on /menu", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    await openBag(page);

    await idleToPrompt(page);
    // z-[100] clears the bag (z-40) and everything it traps (up to z-[90]):
    // a trial click hit-tests CONTINUE without pressing it.
    await page.getByTestId("idle-continue").click({ trial: true, timeout: 5_000 });
    // Reset-then-navigate would empty the cart under /cart first, and the
    // bag's empty-cart guard would send the kiosk to /menu (hazard H1).
    await idleToTimeout(page);
    await expectStaysOnStart(page);

    // Second session, same hazard via the PDP's no-session guard — and proof
    // the timer re-arms after a teardown.
    await startOrderToMenu(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await idleToPrompt(page);
    await idleToTimeout(page);
    await expectStaysOnStart(page);
  });

  test("START AGAIN: ends the session immediately, and the next customer starts clean", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    await expect.poll(() => dexieCartCount(page)).toBe(1);

    await idleToPrompt(page);
    await page.getByTestId("idle-start-again").click();
    // No time advanced: the tap itself ends the session.
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/start$/);
    await expect(idleModal(page)).toHaveCount(0);
    // The window the tap cut short passes without effect: its timer went
    // with the guard.
    await page.clock.fastForward(PROMPT_WINDOW_MS);
    await expectStaysOnStart(page);
    await expect.poll(() => dexieCartCount(page)).toBe(0);

    await startOrderToMenu(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
  });

  test("SPLASH: /start never prompts — 10 minutes untouched stays on the splash", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await registerToStart(page);

    // D6: /start sits outside IdleGuard — there is no timer to fire. Walk
    // the prompt's own cadence (100 s, then 20 s): an armed timer surfaces
    // as a prompt. A single 120 s jump would skip it straight to idle (see
    // the header), and on /start that idle is an invisible re-navigation.
    for (let i = 0; i < 5; i++) {
      await page.clock.fastForward(PROMPT_AFTER_MS);
      await expectNoPrompt(page);
      await page.clock.fastForward(PROMPT_WINDOW_MS);
      await expectNoPrompt(page);
    }
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.getByTestId("start-screen")).toBeVisible();
  });

  test("HOLD: the push holds idle while in flight — a hung push ends at its 10 s budget (P9b) and the prompt comes a full period after THAT, not after the tap — and /orderSuccess owns its 20 s exit", async ({
    page,
  }) => {
    test.slow();
    const push = await bootToParkedPush(page);

    // P9b: the push can no longer outlast the prompt, so the 120 s cap is a
    // backstop (unit-tested in useIdleTimeout.test.tsx). It fails onto the
    // order-error panel at its budget, and the hold's release starts a FRESH
    // period.
    await page.clock.runFor(REQUEST_BUDGET_MS);
    await expect(page.getByTestId("order-error")).toBeVisible();
    // Tap + 100 s: unheld, the period would have run from the tap and the
    // prompt would be up now. Held, it runs from the release ~10 s later.
    await page.clock.fastForward(PROMPT_AFTER_MS - REQUEST_BUDGET_MS);
    await expectNoPrompt(page);
    await page.clock.fastForward(15_000);
    await expect(idleModal(page)).toBeVisible();
    await page.getByTestId("idle-continue").click();
    await expect(idleModal(page)).toHaveCount(0);

    // The customer's Retry is a NEW request (the parked one was aborted by
    // its budget and is never answered): it lands, and OrderSuccess's own
    // countdown — not idle — takes the kiosk back to the splash.
    push.parked.disarm();
    await page.getByTestId("order-error-retry").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 15_000 });
    expect(push.checkout.placeOrderCount).toBe(1);
    await page.clock.runFor(12_000);
    await expect(page.getByTestId("order-success")).toBeVisible();
    await expect(idleModal(page)).toHaveCount(0);
    await page.clock.runFor(10_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/start$/);
    expect(push.parked.count).toBe(1);
    expect(push.checkout.placeOrderCount).toBe(1);
    expect(push.checkout.forbiddenUrls).toEqual([]);
  });

  test("WALK AWAY: a customer who leaves a timed-out push's order-error panel is still timed out to /start — and the one request is never re-sent", async ({
    page,
  }) => {
    test.slow();
    const push = await bootToParkedPush(page);

    await page.clock.runFor(REQUEST_BUDGET_MS);
    await expect(page.getByTestId("order-error")).toBeVisible();
    // The panel holds nothing ("failed" is not a push in flight), so a full
    // period after the release the session ends as usual (Rule 1).
    await idleToPrompt(page);
    await idleToTimeout(page);
    await expectStaysOnStart(page);

    // U2: a timed-out push is never retried for the customer — not by the
    // ladder, not across the teardown.
    expect(push.parked.count).toBe(1);
    expect(push.checkout.placeOrderCount).toBe(0);
    await expect(page.getByTestId("order-success")).toHaveCount(0);
    expect(push.checkout.forbiddenUrls).toEqual([]);
  });

  test("S7 WALK AWAY WITH A REWARD: a timed-out push carrying a claimed Xeno reward is never auto-refunded — the idle teardown sends NO undoRewardRedemption (the order may exist)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { loyalty: true });
    const checkout = await mockCheckoutBackend(page);
    const xeno = await mockXenoLoyalty(page);
    const parked = await parkRequests(page, PLACE_ORDER_URL);
    await claimRewardThenPayAtCounter(page);
    await expect.poll(() => parked.count).toBe(1);

    await page.clock.runFor(REQUEST_BUDGET_MS);
    await expect(page.getByTestId("order-error")).toContainText(
      en.orderError.uncertainTitle
    );
    await idleToPrompt(page);
    await idleToTimeout(page);
    await expectStaysOnStart(page);

    // User decision 2026-10-01 (P9d S7): the reward rode in a push whose
    // outcome is unknown, so it is left for staff, not refunded.
    expect(xeno.revokeCount).toBe(0);
    // …nor later: the claim went with the session, the next one starts clean.
    await startOrderToPhone(page);
    await expect(page.getByTestId("phone-number-display")).toContainText(
      "Mobile number"
    );
    expect(xeno.revokeCount).toBe(0);
    expect(parked.count).toBe(1);
    expect(checkout.placeOrderCount).toBe(0);
    expect(checkout.forbiddenUrls).toEqual([]);
  });

  test("S7 CONTRAST: the same reward behind CLEAN 5xx push failures (nothing placed) IS refunded — exactly one undoRewardRedemption at the idle teardown", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { loyalty: true });
    // Four 500s exhaust the ladder: the order provably never landed.
    const checkout = await mockCheckoutBackend(page, { failPlaceOrderTimes: 4 });
    const xeno = await mockXenoLoyalty(page);
    await claimRewardThenPayAtCounter(page);

    // The 1/2/3 s backoffs are a page-armed chain: step until all four ran.
    await expect
      .poll(
        async () => {
          await page.clock.runFor(500);
          return checkout.placeOrderCount;
        },
        { timeout: 20_000, intervals: [50] }
      )
      .toBe(4);
    const panel = page.getByTestId("order-error");
    await expect(panel).toContainText(en.orderError.title);
    await expect(panel).not.toContainText(en.orderError.uncertainTitle);
    expect(xeno.revokeCount).toBe(0);

    await idleToPrompt(page);
    await idleToTimeout(page);
    await expect.poll(() => xeno.revokeCount).toBe(1);
    expect(xeno.revokeUrls[0]).toContain("undoRewardRedemption");
    expect(xeno.revokeUrls[0]).toContain(
      `rewardId=${LOYALTY_REWARDS.greekSalad.couponCode}`
    );
    await expectStaysOnStart(page);
    expect(xeno.revokeCount).toBe(1);
  });

  test("LANGUAGE: Arabic chosen on /second, footer CANCEL ORDER → /start, and the next session is English again", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { arabic: true });
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    const second = page.getByTestId("second-screen");
    await expect(second).toContainText("Where are you eating?");

    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(second).toContainText("أين ستتناول طعامك؟");
    await expect(page.getByTestId("footer-language")).toContainText("العربية");

    // /second's cancel only navigates; /start's mount resets — language too.
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    // The splash is named by its visible copy (P9d) — in English again.
    await expect(
      page.getByRole("button", { name: /touch anywhere to start/i })
    ).toBeVisible();

    await page.getByTestId("start-screen").click();
    await expect(second).toContainText("Where are you eating?");
    // Blank name after the reset → the i18n "English" label, in English
    // (D9: `||` not `??`, and "" falls back to DEFAULT_LANGUAGE).
    await expect(page.getByTestId("footer-language")).toContainText("English");
  });

  test("REVOKE: a claimed Xeno reward left on an idle kiosk is revoked exactly once, before the next customer", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { loyalty: true });
    const xeno = await mockXenoLoyalty(page);
    await registerToStart(page);
    await startOrderToPhone(page);
    await typeDigits(page, LOYALTY_PHONE);
    await page.getByTestId("phone-continue").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });

    // Claim the Greek Salad reward (loyalty.spec.ts redeemReward).
    const reward = LOYALTY_REWARDS.greekSalad;
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
    await page.getByTestId(`loyalty-reward-${reward.couponCode}`).click();
    await page.getByTestId("loyalty-redeem").click();
    await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({
      timeout: 10_000,
    });
    await typeDigits(page, LOYALTY_OTP);
    await page.getByTestId("loyalty-otp-submit").click();
    await expect(page.getByTestId("loyalty-success")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("loyalty-success")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    expect(xeno.revokeCount).toBe(0);

    await idleToPrompt(page);
    await idleToTimeout(page);
    // D3: /start's mount revokes BEFORE its reset wipes the claim; the ref
    // latch keeps StrictMode's second mount effect from revoking again.
    await expect.poll(() => xeno.revokeCount).toBe(1);
    expect(xeno.revokeUrls[0]).toContain("undoRewardRedemption");
    expect(xeno.revokeUrls[0]).toContain(`rewardId=${reward.couponCode}`);
    expect(xeno.revokeUrls[0]).toContain(`pointsToBeReturned=${reward.points}`);
    await expectStaysOnStart(page);
    expect(xeno.revokeCount).toBe(1);

    // The identity went with the session: the next customer is looked up anew.
    await startOrderToPhone(page);
    await expect(page.getByTestId("phone-number-display")).toContainText(
      "Mobile number"
    );
  });

  test("LATE CHECKOUT: a PAY preflight that answers after the customer cancelled the order does not pull the splash into checkout", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    // handlePay's getServerTime await — parked only once PAY is tapped.
    const serverTime = await parkRequests(page, "**/api/tenants/getServerTime", {
      armed: false,
    });
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    await openBag(page);

    serverTime.arm();
    await page.getByTestId("bag-pay").click();
    await expect.poll(() => serverTime.count).toBe(1);
    // P9b bounds the preflight (10 s) far inside the idle period, so idle can
    // no longer end the session under it — the customer still can: out of
    // the bag and CANCEL ORDER while it is in flight.
    await page.getByTestId("bag-close").click();
    await page.getByTestId("footer-cancel").click();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    // Released well inside the budget (no clock jump since PAY). Were the
    // budget ever to expire first, `late` would never resolve and the test
    // would fail — it cannot pass without the late answer.
    const late = page.waitForResponse("**/api/tenants/getServerTime");
    await serverTime.release();
    await late;
    // BagSheet's mounted guard (integrate stage): the fan-out on this fixture
    // is /phone — the splash must not be pulled there.
    await expectStaysOnStart(page);
    await startOrderToMenu(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
  });

  test("LATE LOOKUP: once the customer cancels a /phone lookup still in flight, its late answer writes nothing into the next session", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { loyalty: true });
    const xeno = await mockXenoLoyalty(page);
    // Every loyalty op shares execute_event; only the lookup runs while armed.
    const lookup = await parkRequests(page, /\/api\/partners\/execute_event/, {
      armed: false,
    });
    await registerToStart(page);
    await startOrderToPhone(page);
    await typeDigits(page, LOYALTY_PHONE);

    lookup.arm();
    await page.getByTestId("phone-continue").click();
    await expect.poll(() => lookup.count).toBe(1);
    await expect(page.getByTestId("phone-continue")).toBeDisabled();
    // P9b: the lookup is bounded (10 s; on expiry /phone carries on to /menu
    // as a guest), so useLoyalty's idle hold (D5) is a backstop now, and the
    // late answer can only follow a CUSTOMER exit taken inside the budget.
    // No clock jump from here to the release.

    // The customer gives up on the stalled lookup.
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    const late = page.waitForResponse(/event_name=check_loyalty_balance/);
    await lookup.release();
    await late;
    expect(xeno.events.check_loyalty_balance).toBe(1);
    await expectStaysOnStart(page);
    // Fix stage F1: the 6000-point body is dropped, not stored for whoever
    // walks up next (and no rewards sheet opens over the splash).
    expect(await persistedLoyaltyPoints(page)).toBe(0);
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
  });

  test("LATE MENU: a hung menu fetch now ends at its 30 s budget on menu-error (P9b), and idle still ends the session 120 s after the last TOUCH — the dialog appearing is not activity", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    const menu = await parkRequests(page, "**/api/cx/kiosk/getMenu", {
      armed: false,
    });
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();

    menu.arm();
    // The last touch: the idle period runs from here.
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-fetching")).toBeVisible();
    await expect.poll(() => menu.count).toBe(1);
    // The overlay hides the footer, so before P9b idle was the only way out
    // and a late menu the hazard (D10: SecondLayout's mounted guard — now a
    // unit-tested backstop). The budget ends the fetch long before idle can:
    // the overlay gives way to the dialog, still on /second.
    await page.clock.runFor(MENU_BUDGET_MS);
    await expect(page.getByTestId("menu-error")).toBeVisible();
    await expect(page.getByTestId("menu-fetching")).toHaveCount(0);
    await expect(page).toHaveURL(/\/second$/);
    menu.disarm();

    // Nobody answers it. Rule 1 counts from the tap: the dialog grabbing
    // focus must not restart the period, so the prompt paints over the
    // dialog at tap + 100 s…
    await page.clock.fastForward(PROMPT_AFTER_MS - MENU_BUDGET_MS);
    await expect(idleModal(page)).toBeVisible();
    await page.getByTestId("idle-continue").click({ trial: true, timeout: 5_000 });
    // …and the session ends at tap + 120 s.
    await idleToTimeout(page);
    await expectStaysOnStart(page);

    // The next customer gets a normal session.
    await startOrderToMenu(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
  });
});

/**
 * The shared opening of both HOLD tests: pay-at-counter fan-out (skipCRM,
 * loyalty off), one Greek Salad, PAY → /payment → PAY AT COUNTER → /receipt →
 * NO THANKS, with placeOrder parked so the push stays in flight.
 */
async function bootToParkedPush(page: Page) {
  await mockKioskBackend(page, { skipCRM: true });
  const checkout = await mockCheckoutBackend(page);
  const parked = await parkRequests(page, PLACE_ORDER_URL);
  await bootRegisteredToMenu(page);
  await addGreekSaladOneTap(page, "(1)");
  await openBag(page);

  await page.getByTestId("bag-pay").click();
  await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("payment-counter").click();
  // /payment's own 3 s cancel window ends by routing to /receipt.
  await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("receipt-none").click();
  await expect.poll(() => parked.count).toBe(1);
  await expect(page.getByTestId("payment-buffer")).toBeVisible();
  return { checkout, parked };
}

/**
 * The shared opening of both S7 tests (the caller registers the mocks, Xeno
 * on): the Greek Salad reward claimed — its free row — beside a paid Tortilla
 * Sauce (a zero bill would push from /customerName, not PAY AT COUNTER), then
 * PAY → /customerName → /payment → PAY AT COUNTER → /receipt → NO THANKS. The
 * push leaves carrying the reward row.
 */
async function claimRewardThenPayAtCounter(page: Page) {
  await registerToStart(page);
  await startOrderToPhone(page);
  await typeDigits(page, LOYALTY_PHONE);
  await page.getByTestId("phone-continue").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });

  // The redemption chain (loyalty.spec.ts redeemReward) in the auto-opened sheet.
  await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
  await page
    .getByTestId(`loyalty-reward-${LOYALTY_REWARDS.greekSalad.couponCode}`)
    .click();
  await page.getByTestId("loyalty-redeem").click();
  await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({
    timeout: 10_000,
  });
  await typeDigits(page, LOYALTY_OTP);
  await page.getByTestId("loyalty-otp-submit").click();
  await expect(page.getByTestId("loyalty-success")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("loyalty-success")).toHaveCount(0, {
    timeout: 10_000,
  });

  const sauce = page.getByTestId(`item-${TORTILLA_SAUCE}`);
  await sauce.scrollIntoViewIfNeeded();
  await sauce.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText("(2)");
  await openBag(page);
  await expect(page.locator('[data-testid^="bag-loyalty-row-"]')).toHaveCount(1);

  await page.getByTestId("bag-pay").click();
  // Loyalty on, not a table tab: the name step comes first.
  await expect(page.getByTestId("customer-name-screen")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("customer-name-continue").click();
  await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("payment-counter").click();
  // /payment's own 3 s cancel window ends by routing to /receipt.
  await page.clock.runFor(3_000);
  await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("receipt-none").click();
}
