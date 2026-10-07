import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mockCheckoutBackend } from "./fixtures/checkout";
import {
  mockXenoLoyalty,
  LOYALTY_PHONE,
  LOYALTY_SETTINGS,
} from "./fixtures/loyalty";

/**
 * P9c — the ADA ("accessibility") reach-zone view, end to end.
 *
 * The view renders the app UNSCALED into the bottom 1122px of the stage under
 * a purple brand panel (ReachZone.tsx). What only the running app can show:
 * the geometry, that every control a guest needs sits inside the zone and is
 * not covered, that toggling never remounts the screen, and that every way
 * back to the splash lands with the view OFF and never paints the splash
 * inside the zone.
 *
 * ── GEOMETRY ────────────────────────────────────────────────────────────
 * Constants mirror src/components/stage/KioskStage.tsx — ADA_BRAND_ZONE_HEIGHT
 * is the cabinet calibration knob; retune the two together. Every box is read
 * against the stage element's own box with the KioskStage scale divided out,
 * so the assertions are in Figma design px whatever the window size.
 *
 * ── REACHABILITY ────────────────────────────────────────────────────────
 * {@link expectReachable}: with the view on, every visible control (button,
 * [role=button], a, input, textarea, select) under the scope must lie inside
 * the reach zone and not be covered. A control is clipped only by its SCROLL
 * containers (the guest can swipe those into view — one scrolled fully out is
 * skipped); overflow:hidden and the zone's own paint containment are NOT
 * honoured, because a control those clip is exactly the unreachable one this
 * hunts. While an overlay is open the scope is the overlay — the page beneath
 * is covered by design.
 *
 * ── TIME ────────────────────────────────────────────────────────────────
 * The tests that meet a short in-app window (tent error 4 s, pay buffer 3 s,
 * exit guard 0.5 s, idle 120 s) install Playwright's fake clock before the
 * first goto. It runs in real time until {@link freezeClock}, so a window is
 * measured with no wall-clock race on a loaded machine; `resume()` hands time
 * back. Idle is stepped 100 s then 20 s (idle.spec.ts header).
 *
 * ── MOCK ORDER ──────────────────────────────────────────────────────────
 * House order (bag.spec.ts / idle.spec.ts): the `**\/api/**` catch-all FIRST,
 * every specific mock after it (newest wins), plus the two cross-origin edges
 * the catch-all cannot see — the print agent (aborted) and the Xeno revoke.
 * The checkout fixture layers on top. `get_kiosk_settings` carries
 * `accessibility_mode` explicitly: true unless a test is about the gate.
 * Boot helpers are copied from idle.spec.ts (the house precedent).
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

/** £17, no modifiers, no recommendedItems: a card tap adds it, no modal. */
const GREEK_SALAD = "5dd1093829754a432f2c32e2";
/** Modifier groups: a card tap opens the PDP; a second tap, the repeat sheet. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";

// ---- Mirrors src/components/stage/KioskStage.tsx (see GEOMETRY) ----
const STAGE_WIDTH = 1080;
const STAGE_HEIGHT = 1920;
const ADA_BRAND_ZONE_HEIGHT = 798;
const ADA_REACH_ZONE_HEIGHT = STAGE_HEIGHT - ADA_BRAND_ZONE_HEIGHT;
const ADA_SHEET_HEIGHT = 765;
/** ReachZone's EXIT_TAP_GUARD_MS. */
const EXIT_TAP_GUARD_MS = 500;
/** FooterBar's strip height. */
const FOOTER_HEIGHT = 56;

/** LoyaltyRewardsSheet's AUTO_DISMISS_SECONDS, in ms. */
const REWARDS_AUTO_DISMISS_MS = 25_000;
/** P9a idle timing (idle.spec.ts): prompt at 100 s, splash at 120 s. */
const PROMPT_AFTER_MS = 100_000;
const PROMPT_WINDOW_MS = 20_000;

interface KioskMockOptions {
  /** get_kiosk_settings.accessibility_mode — the tenant's feature gate. */
  ada?: boolean;
  /** Xeno loyalty on (loyalty.spec.ts): /second → /phone. */
  loyalty?: boolean;
}

async function mockKioskBackend(
  page: Page,
  { ada = true, loyalty = false }: KioskMockOptions = {}
) {
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
        // Label only (checkout.spec.ts) — the counter tile renders either way.
        pay_at_counter: "pay_at_counter",
        accessibility_mode: ada,
        ...(loyalty ? LOYALTY_SETTINGS : {}),
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

async function bootRegisteredToMenu(page: Page) {
  await registerToStart(page);
  await startToSecond(page);
  await pickPipelineToMenu(page);
}

async function addGreekSaladOneTap(page: Page, expectedCount: string) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText(expectedCount);
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

/** KioskNumpad is the only numeric keypad mounted at a time. */
async function typeDigits(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByTestId(`numpad-key-${digit}`).click();
  }
}

const brandZone = (page: Page) => page.getByTestId("ada-brand-zone");
const reachZone = (page: Page) => page.getByTestId("reach-zone");
const footerAda = (page: Page) => page.getByTestId("footer-ada");

interface StageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The element's box in stage DESIGN px (KioskStage scale divided out), to 1px. */
function stageBox(locator: Locator): Promise<StageBox> {
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

const ZONE_BOX: StageBox = {
  x: 0,
  y: ADA_BRAND_ZONE_HEIGHT,
  width: STAGE_WIDTH,
  height: ADA_REACH_ZONE_HEIGHT,
};
const FULL_BOX: StageBox = { x: 0, y: 0, width: STAGE_WIDTH, height: STAGE_HEIGHT };

/** View ON: brand panel over 0..798, the routes' container over 798..1920. */
async function expectAdaLayout(page: Page) {
  await expect(brandZone(page)).toBeVisible();
  await expect
    .poll(() => stageBox(brandZone(page)))
    .toEqual({ x: 0, y: 0, width: STAGE_WIDTH, height: ADA_BRAND_ZONE_HEIGHT });
  await expect.poll(() => stageBox(reachZone(page))).toEqual(ZONE_BOX);
}

/** View OFF: no panel, the container is the whole stage again. */
async function expectFullLayout(page: Page) {
  await expect(brandZone(page)).toHaveCount(0);
  await expect.poll(() => stageBox(reachZone(page))).toEqual(FULL_BOX);
}

/** Problems found by one reachability pass (empty = reachable). */
function reachProblems(scope: Locator): Promise<string[]> {
  return scope.evaluate(
    (root, { brandHeight, stageHeight }) => {
      const stage = document.querySelector('[data-testid="kiosk-stage"]');
      if (!stage) return ["kiosk-stage is not mounted"];
      const s = stage.getBoundingClientRect();
      const k = s.height / stageHeight;
      const zone = {
        top: s.top + brandHeight * k,
        bottom: s.bottom,
        left: s.left,
        right: s.right,
      };
      const name = (el: Element) =>
        el.getAttribute("data-testid") ??
        el.getAttribute("aria-label") ??
        `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
      const scrolls = (el: Element) =>
        /auto|scroll/.test(
          `${getComputedStyle(el).overflowX} ${getComputedStyle(el).overflowY}`
        );
      const out: string[] = [];
      const controls = root.querySelectorAll(
        'button, [role="button"], a, input:not([type="hidden"]), textarea, select'
      );
      let checked = 0;
      for (const el of controls) {
        const style = getComputedStyle(el);
        if (style.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        let { top, bottom, left, right } = r;
        for (let a = el.parentElement; a && a !== stage; a = a.parentElement) {
          if (!scrolls(a)) continue;
          const ar = a.getBoundingClientRect();
          top = Math.max(top, ar.top);
          bottom = Math.min(bottom, ar.bottom);
          left = Math.max(left, ar.left);
          right = Math.min(right, ar.right);
        }
        // Scrolled fully out of its container: a swipe brings it back.
        if (bottom - top < 1 || right - left < 1) continue;
        checked += 1;
        const y = (v: number) => Math.round((v - s.top) / k);
        if (
          top < zone.top - 1 ||
          bottom > zone.bottom + 1 ||
          left < zone.left - 1 ||
          right > zone.right + 1
        ) {
          out.push(`${name(el)}: outside the reach zone (stage y ${y(top)}–${y(bottom)})`);
          continue;
        }
        // A scrim spanning the whole zone sits under its own sheet by design.
        const backdrop =
          r.width >= zone.right - zone.left - 1 && r.height >= zone.bottom - zone.top - 1;
        if (backdrop || style.pointerEvents === "none") continue;
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        if (!hit || !el.contains(hit)) {
          out.push(
            `${name(el)}: covered at its centre (stage y ${y((top + bottom) / 2)}) by ${hit ? name(hit) : "nothing"}`
          );
        }
      }
      // A scope with nothing to check would pass vacuously.
      if (checked === 0) out.push("no visible control under the scope");
      return out;
    },
    { brandHeight: ADA_BRAND_ZONE_HEIGHT, stageHeight: STAGE_HEIGHT }
  );
}

/**
 * View ON: every visible control under `scope` is inside the reach zone and
 * not covered (header, REACHABILITY). Entrance keyframes settle first — a
 * sheet still sliding up could hide a control that ends above the zone.
 */
async function expectReachable(page: Page, scope: Locator = reachZone(page)) {
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

/** Pause the installed fake clock where it stands (header, TIME). */
async function freezeClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
}

/**
 * Latches if the splash ever COMMITS inside the zone — next to the brand
 * panel or in a short container — for even one frame before /start's mount
 * reset closes the view (ReachZone's exempt routes). Read the latch after.
 */
async function watchSplashNeverInZone(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __splashInZone?: string };
    w.__splashInZone = "";
    const check = () => {
      if (!document.querySelector('[data-testid="start-screen"]')) return;
      const zone = document.querySelector<HTMLElement>('[data-testid="reach-zone"]');
      if (document.querySelector('[data-testid="ada-brand-zone"]')) {
        w.__splashInZone = "brand zone painted with the splash";
      } else if (zone?.style.height !== "1920px") {
        w.__splashInZone = `splash container ${zone?.style.height}`;
      }
    };
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { __splashInZone?: string }).__splashInZone
    );
}

/** The next customer meets the full-stage view, toggle released. */
async function expectNextSessionStartsOff(page: Page) {
  await startToSecond(page);
  await expectFullLayout(page);
  await expect(footerAda(page)).toHaveAttribute("aria-pressed", "false");
  await pickPipelineToMenu(page);
  await expectFullLayout(page);
  await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
}

test.describe("P9c ADA reach-zone view", () => {
  test("TOGGLE + REACH (browse): the /menu footer opens the zone view; /menu, the PDP and its footer strip, the added modal, the repeat sheet, /forYou and the 765px bag are all reachable", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);

    // Normal mode first: full stage, toggle released.
    await expectFullLayout(page);
    await expect(footerAda(page)).toHaveAttribute("aria-pressed", "false");

    await footerAda(page).click();
    await expectAdaLayout(page);
    await expect(footerAda(page)).toHaveAttribute("aria-pressed", "true");
    // The page fills the zone (h-full), not the stage.
    await expect.poll(() => stageBox(page.getByTestId("menu-screen"))).toEqual(ZONE_BOX);
    await expectReachable(page);

    // PDP: fills the zone, and the Figma footer strip sits on its bottom edge.
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect
      .poll(() => stageBox(page.getByTestId("customization-screen")))
      .toEqual(ZONE_BOX);
    for (const id of ["footer-cancel", "footer-ada", "footer-language"]) {
      const box = await stageBox(page.getByTestId(id));
      expect(box.y, id).toBe(STAGE_HEIGHT - FOOTER_HEIGHT);
      expect(box.height, id).toBe(FOOTER_HEIGHT);
    }
    await expect(footerAda(page)).toHaveAttribute("aria-pressed", "true");
    await expectReachable(page);

    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    const added = page.getByTestId("product-added-modal");
    await expect(added).toBeVisible();
    await expectReachable(page, added);
    await page.getByTestId("added-continue").click();
    await expect(added).toHaveCount(0);

    // Repeat sheet: the 1026px cap keeps its title/X and CTA in the zone.
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    const repeat = page.getByTestId("repeat-sheet");
    await expect(repeat).toBeVisible();
    await expectReachable(page, repeat);
    await page.getByTestId("repeat-sheet-close").click();
    await expect(repeat).toHaveCount(0);

    // First VIEW MY BAG of the session meets the upsell (bag.spec openBag).
    await page.getByTestId("cta-view-bag").click();
    await expect(page.getByTestId("foryou-screen")).toBeVisible();
    await expect
      .poll(() => stageBox(page.getByTestId("foryou-screen")))
      .toEqual(ZONE_BOX);
    await expectReachable(page);
    await page.getByTestId("foryou-primary").click();

    // Figma 1:5465: the ADA bag is 765 tall, its top at stage y 1155.
    const bag = page.getByTestId("bag-sheet");
    await expect(bag).toBeVisible();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId("bag-rail")).toBeVisible();
    // The panel is the bag's FIRST div child; the offers lane's always-mounted
    // celebration live region (role=status, zero height) is a later sibling.
    await expect
      .poll(() => stageBox(bag.locator(":scope > div").first()))
      .toEqual({
        x: 0,
        y: STAGE_HEIGHT - ADA_SHEET_HEIGHT,
        width: STAGE_WIDTH,
        height: ADA_SHEET_HEIGHT,
      });
    await expectReachable(page, bag);
    await expect(page.getByTestId("bag-close")).toBeVisible();
    await page.getByTestId("bag-close").click();
    await expect(bag).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expectAdaLayout(page);
  });

  test("REACH (checkout): toggled on /second, the view carries through /tent (range error above the display), /phone, /customerName, /payment and its buffer, /receipt and /orderSuccess — and START OVER lands on a full-stage splash", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.clock.install();
    await mockKioskBackend(page);
    // Table tab + skipCRM off + loyalty off: PAY → /tent → /phone →
    // /customerName → /payment (checkout.spec.ts / CustomerPhone header).
    const checkout = await mockCheckoutBackend(page, { tabType: "table" });
    await registerToStart(page);
    await startToSecond(page);

    await footerAda(page).click();
    await expectAdaLayout(page);
    await expectReachable(page);

    await pickPipelineToMenu(page);
    await expectAdaLayout(page);
    await addGreekSaladOneTap(page, "(1)");
    await openBag(page);
    await page.getByTestId("bag-pay").click();

    const tent = page.getByTestId("tent-screen");
    await expect(tent).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => stageBox(tent)).toEqual(ZONE_BOX);
    await expectReachable(page);

    // The range error replaces the title, its bottom edge 16px above the
    // display (zone y 330 / 346) — measured from the TOP, so it holds at
    // any calibration. Frozen: it auto-hides after 4 s.
    await freezeClock(page);
    await typeDigits(page, "0");
    await page.getByTestId("tent-confirm").click();
    const error = page.getByTestId("tent-error");
    await expect(error).toBeVisible();
    const errorBox = await stageBox(error);
    expect(
      Math.abs(errorBox.y + errorBox.height - (ADA_BRAND_ZONE_HEIGHT + 330))
    ).toBeLessThanOrEqual(1);
    expect(errorBox.y).toBeGreaterThanOrEqual(ADA_BRAND_ZONE_HEIGHT);
    expect((await stageBox(page.getByTestId("tent-display"))).y).toBe(
      ADA_BRAND_ZONE_HEIGHT + 346
    );
    await expect(tent.locator("h1")).toBeHidden();
    await expectReachable(page);
    await page.clock.resume();

    await page.getByTestId("numpad-clear").click();
    await typeDigits(page, "12");
    await page.getByTestId("tent-confirm").click();

    await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
    await expectReachable(page);
    await page.getByTestId("phone-skip").click();

    await expect(page.getByTestId("customer-name-screen")).toBeVisible();
    await expectReachable(page);
    await page.getByTestId("customer-name-continue").click();

    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expectReachable(page);
    // The 3 s cancel window, held open while it is measured.
    await freezeClock(page);
    await page.getByTestId("payment-counter").click();
    const buffer = page.getByTestId("payment-buffer");
    await expect(buffer).toBeVisible();
    await expectReachable(page, buffer);
    await page.clock.resume();

    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await expectReachable(page);
    await page.getByTestId("receipt-none").click();

    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    await expectAdaLayout(page);
    await expectReachable(page);

    // START OVER resets ("full" closes the view) then navigates.
    const splashInZone = await watchSplashNeverInZone(page);
    await page.getByTestId("order-success-startover").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    await expectFullLayout(page);
    expect(await splashInZone()).toBe("");
    await startToSecond(page);
    await expectFullLayout(page);
    await expect(footerAda(page)).toHaveAttribute("aria-pressed", "false");

    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.forbiddenUrls).toEqual([]);
    expect(checkout.printAgentUrls).toEqual([]);
  });

  test("BRAND-ZONE EXIT: a tap on the panel closes the view, and the second tap of a double tap is swallowed by the exit guard instead of landing on the PDP control now under it", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();

    // Normal mode: the quantity + sits inside what becomes the brand panel.
    // Its centre is where the double tap lands.
    const increase = page.getByTestId("pdp-qty-increase");
    const qty = page.getByTestId("pdp-qty");
    await expect(qty).toHaveText("1");
    const box = await stageBox(increase);
    expect(box.y + box.height).toBeLessThan(ADA_BRAND_ZONE_HEIGHT);
    const point = await increase.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    await footerAda(page).click();
    await expectAdaLayout(page);

    // First tap: the panel. Frozen, so the 0.5 s guard cannot expire under
    // a slow second tap on a loaded machine.
    await freezeClock(page);
    await page.mouse.click(point.x, point.y);
    await expectFullLayout(page);
    await expect(footerAda(page)).toHaveAttribute("aria-pressed", "false");
    const guard = page.getByTestId("ada-exit-guard");
    await expect(guard).toHaveCount(1);
    // Full height again: the + is back under that spot, the guard above it.
    await expect.poll(() => stageBox(increase)).toEqual(box);
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid"),
        point
      )
    ).toBe("ada-exit-guard");

    // Second tap: swallowed — the quantity holds and the view stays off.
    await page.mouse.click(point.x, point.y);
    await expect(qty).toHaveText("1");
    await expect(brandZone(page)).toHaveCount(0);

    // The guard lives exactly its window.
    await page.clock.runFor(EXIT_TAP_GUARD_MS - 100);
    await expect(guard).toHaveCount(1);
    await page.clock.runFor(200);
    await expect(guard).toHaveCount(0);
    await page.clock.resume();

    // Positive control: the same spot IS live — the guard was what held it.
    await page.mouse.click(point.x, point.y);
    await expect(qty).toHaveText("2");
    await expectFullLayout(page);
  });

  test("PDP: the new footer strip toggles the view both ways without remounting the PDP (quantity kept), and its CANCEL ORDER only navigates — /start never paints in the zone and the next session starts off", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    const pdp = page.getByTestId("customization-screen");
    await expect(pdp).toBeVisible();

    // Normal mode (A6): the strip is part of the PDP chrome in both modes.
    await expect.poll(() => stageBox(pdp)).toEqual(FULL_BOX);
    expect((await stageBox(footerAda(page))).y).toBe(STAGE_HEIGHT - FOOTER_HEIGHT);
    await page.getByTestId("pdp-qty-increase").click();
    await expect(page.getByTestId("pdp-qty")).toHaveText("2");
    // A remount would replace this node (and reset the tier-1 session).
    await pdp.evaluate((el) => {
      (el as unknown as { __adaMark?: boolean }).__adaMark = true;
    });
    const sameNode = () =>
      pdp.evaluate((el) => (el as unknown as { __adaMark?: boolean }).__adaMark === true);

    await footerAda(page).click();
    await expectAdaLayout(page);
    await expect.poll(() => stageBox(pdp)).toEqual(ZONE_BOX);
    await expect(page.getByTestId("pdp-qty")).toHaveText("2");
    expect(await sameNode()).toBe(true);

    await footerAda(page).click();
    await expectFullLayout(page);
    await expect.poll(() => stageBox(pdp)).toEqual(FULL_BOX);
    await expect(page.getByTestId("pdp-qty")).toHaveText("2");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£16.00");
    expect(await sameNode()).toBe(true);

    await footerAda(page).click();
    await expectAdaLayout(page);
    expect(await sameNode()).toBe(true);

    // H1: the PDP's no-session guard would bounce a reset-first exit to
    // /menu. The cancel only navigates; /start's mount closes the view —
    // one commit AFTER the splash first renders, which is why /start is an
    // exempt route.
    await page.getByTestId("footer-cancel").click();
    const cancel = page.getByTestId("cancel-order-modal");
    await expect(cancel).toBeVisible();
    await expectReachable(page, cancel);
    const splashInZone = await watchSplashNeverInZone(page);
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/start$/);
    await expectFullLayout(page);
    expect(await splashInZone()).toBe("");

    await expectNextSessionStartsOff(page);
  });

  test("CANCEL from /menu in the view: the reset-then-navigate exit lands on a full-stage splash and the next session starts off", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    await footerAda(page).click();
    await expectAdaLayout(page);

    await page.getByTestId("footer-cancel").click();
    const cancel = page.getByTestId("cancel-order-modal");
    await expect(cancel).toBeVisible();
    await expectReachable(page, cancel);
    const splashInZone = await watchSplashNeverInZone(page);
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expectFullLayout(page);
    expect(await splashInZone()).toBe("");

    await expectNextSessionStartsOff(page);
  });

  test("GATE: accessibility_mode false hides the ADA toggle on every footer (/second, /menu, PDP) and the stage stays full", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { ada: false });
    await registerToStart(page);
    await startToSecond(page);
    // The footer itself is there — only the toggle is gated.
    await expect(page.getByTestId("footer-language")).toBeVisible();
    await expect(footerAda(page)).toHaveCount(0);
    await expectFullLayout(page);

    await pickPipelineToMenu(page);
    await expect(page.getByTestId("footer-language")).toBeVisible();
    await expect(footerAda(page)).toHaveCount(0);

    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("footer-language")).toBeVisible();
    await expect(footerAda(page)).toHaveCount(0);
    await expectFullLayout(page);
  });

  test("IDLE in the view: the prompt opens inside the zone, and the timeout lands on a full-stage splash with the view off for the next customer", async ({
    page,
  }) => {
    test.slow();
    // Before any page script: react-idle-timer binds the timers at load.
    await page.clock.install();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page, "(1)");
    await footerAda(page).click();
    await expectAdaLayout(page);

    await page.clock.fastForward(PROMPT_AFTER_MS);
    const prompt = page.getByTestId("idle-modal");
    await expect(prompt).toBeVisible();
    // Measured with the 20 s window frozen, so a slow pass cannot time out.
    await freezeClock(page);
    await expectAdaLayout(page);
    await expectReachable(page, prompt);

    const splashInZone = await watchSplashNeverInZone(page);
    await page.clock.fastForward(PROMPT_WINDOW_MS);
    await page.clock.resume();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/start$/);
    await expectFullLayout(page);
    expect(await splashInZone()).toBe("");

    await expectNextSessionStartsOff(page);
  });

  test("LOYALTY: the rewards sheet's 25 s auto-dismiss and drain bar run in the full view but are OFF for a sheet opened in the zone view, even after the guest leaves the view (WCAG 2.2.1)", async ({
    page,
  }) => {
    test.slow();
    // runFor drives the sheet's 1 Hz countdown tick by tick (idle.spec header).
    await page.clock.install();
    await mockKioskBackend(page, { loyalty: true });
    await mockXenoLoyalty(page);
    await registerToStart(page);
    const sheet = page.getByTestId("loyalty-rewards-sheet");
    // The decorative countdown bar (no testid): the sheet's 6px pink strip.
    const drainBar = sheet.locator("span.h-\\[6px\\]");

    /** /second → /phone lookup → /menu with the rewards sheet auto-opened. */
    const lookUpRewards = async () => {
      await page.getByTestId("pipeline-p1").click();
      await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
      await typeDigits(page, LOYALTY_PHONE);
      await page.getByTestId("phone-continue").click();
      await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
      await expect(sheet).toBeVisible();
    };

    // Control, full view: the countdown runs and closes the sheet.
    await startToSecond(page);
    await lookUpRewards();
    await expect(drainBar).toBeVisible();
    await page.clock.runFor(REWARDS_AUTO_DISMISS_MS + 1_000);
    await expect(sheet).toHaveCount(0);
    await page.getByTestId("footer-cancel").click();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    // Zone view: no bar, no time limit — and the sheet fits the zone.
    await startToSecond(page);
    await footerAda(page).click();
    await expectAdaLayout(page);
    await lookUpRewards();
    await expectAdaLayout(page);
    await expect(drainBar).toHaveCount(0);
    await expectReachable(page, sheet);
    await page.clock.runFor(REWARDS_AUTO_DISMISS_MS + 5_000);
    await expect(sheet).toBeVisible();

    // Latched at open: leaving the view (the panel sits outside the sheet,
    // so this is no interaction with it) must not start a countdown now.
    await brandZone(page).click();
    await expectFullLayout(page);
    await expect(drainBar).toHaveCount(0);
    await page.clock.runFor(REWARDS_AUTO_DISMISS_MS + 5_000);
    await expect(sheet).toBeVisible();
  });
});
