import { test, expect, type Locator, type Page, type Route } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  locale,
  CHUNK,
  DINE_IN,
  TORTILLA_SAUCE,
} from "./fixtures/backend";
import { mockCheckoutBackend } from "./fixtures/checkout";
import {
  mockXenoLoyalty,
  GREEK_SALAD_ID,
  LOYALTY_OTP,
  LOYALTY_PHONE,
  LOYALTY_POINTS_TOTAL,
  LOYALTY_REWARDS,
  LOYALTY_SETTINGS,
} from "./fixtures/loyalty";
import { registerToStart } from "./pages/boot";
import { typeDigits } from "./pages/order";

/**
 * Lane loyalty-visual — the Xeno REWARDS sheet after its reskin (Figma
 * 1:3842 / 1:3948), its lazy load (D9) and the operator's loyalty texts (D6b).
 *
 * - E1: the post-lookup sheet on the pulled geometry — 1480 panel (1026 in
 *   the ADA reach zone), 152 plates, 32 px names, the Figma subtitle
 *   (offers.subtitle), the "You have {n} points" balance line, an 84 px
 *   REDEEM.
 * - E2 / E2b: the sheet rides the ONE lazy UI chunk (bagLazyParts), which
 *   Menu requests at /menu entry. While the chunk is stalled the sheet is a
 *   named, closable scrim that never navigates; a FAILED chunk (dev has no
 *   vite:preloadError, so this is the Menu's local ErrorBoundary) leaves
 *   /menu up — no crash screen — and the same closable scrim. The bag is
 *   never opened under a failed chunk (its own lazy parts would crash it — a
 *   pre-existing residual, not this lane's).
 * - E8: reward_title_* / reward_subtitle_* / loyalty_point_alias_* are
 *   resolved at RENDER only — none of them may reach cart / order / loyalty
 *   state or the order push. E8b: per language slot, no cross-language
 *   fallback (an Arabic guest never sees primary-slot texts).
 *
 * Mocks: the shared boot mock (fixtures/backend.ts) with loyalty.spec.ts's
 * LOYALTY_SETTINGS, then `mockXenoLoyalty` LAST (it answers the cross-origin
 * revoke too). The lazy chunk (CHUNK.bag) is held or aborted by a route
 * registered BEFORE the boot (the offerBuyStage.spec E11 pattern): it is
 * requested the moment /menu mounts.
 */

const en = locale("en");
const ar = locale("ar");

const SALAD_REWARD = LOYALTY_REWARDS.greekSalad;
/** The ONE lazy UI chunk as the dev server serves it. */
const LAZY_CHUNK = CHUNK.bag;
/** LoyaltyRewardsSheet's AUTO_DISMISS_SECONDS, in ms (ada.spec LOYALTY). */
const REWARDS_AUTO_DISMISS_MS = 25_000;

/** D6b operator copy, set in the PRIMARY slot (E8, E8b). */
const OPERATOR = {
  title: "Taco Bell Club Treats",
  subtitle: "Pick one treat, it is on the house today",
  alias: "TacoCoins",
};
const OPERATOR_PRIMARY = {
  reward_title_primary: OPERATOR.title,
  reward_subtitle_primary: OPERATOR.subtitle,
  loyalty_point_alias_primary: OPERATOR.alias,
};

interface BackendOptions {
  /** Extra get_kiosk_settings keys (accessibility_mode, operator texts). */
  settings?: Record<string, unknown>;
  /** Arabic as the secondary language (visual-loyalty.spec mocks). */
  arabic?: boolean;
}

/**
 * The shared boot mock with LOYALTY_SETTINGS and this test's settings; Arabic
 * adds the secondary language and the pipeline's secondary_name.
 */
const mockKioskBackend = (page: Page, opts: BackendOptions = {}) =>
  mockBackend(page, {
    arabic: opts.arabic,
    settings: { ...LOYALTY_SETTINGS, ...opts.settings },
    pipelines: [opts.arabic ? { ...DINE_IN, secondary_name: "تناول في المطعم" } : DINE_IN],
  });

/** Splash → /second (Arabic / the ADA view when asked) → /phone. */
async function startOrderToPhone(page: Page, { ada = false, arabic = false } = {}) {
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible();
  if (arabic) {
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  }
  if (ada) {
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
  }
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
}

/** The pre-menu lookup (check_loyalty_balance) → /menu as an identified guest. */
async function identifyToMenu(page: Page) {
  await typeDigits(page, LOYALTY_PHONE);
  await page.getByTestId("phone-continue").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/menu$/);
}

/**
 * A failed chunk reaches an error boundary only on React's retry, ~300 ms
 * after the fallback first shows (the Suspense reveal throttle; measured: the
 * global crash screen at +316 ms when the local boundary is missing). So "no
 * crash screen" is sampled over a 1.5 s window (lint bans fixed sleeps — the
 * fcm.spec E10 pattern), never read once: only a window that closes with
 * /menu and the scrim still up passes.
 */
async function expectMenuSurvivesOverWindow(page: Page) {
  const windowEnds = Date.now() + 1_500;
  await expect
    .poll(
      async () => {
        if ((await page.getByTestId("app-error").count()) > 0) return "crash screen";
        if ((await page.getByTestId("menu-screen").count()) === 0) return "no menu";
        return Date.now() >= windowEnds ? "menu up" : "waiting";
      },
      { timeout: 8_000, intervals: [100] }
    )
    .toBe("menu up");
}

/** Rounded box of a locator (sizes only — the entrance slide moves y, not h). */
const size = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return { width: Math.round(box.width), height: Math.round(box.height) };
};

test.describe("lane loyalty-visual — the Xeno REWARDS sheet (39a, D9, D6b)", () => {
  for (const [mode, panelHeight] of [
    ["full view", 1480],
    ["ADA view", 1026],
  ] as const) {
    test(`E1 LOOKUP geometry (${mode}): after /phone the sheet is the ${panelHeight} px panel (Figma 1:3842), 152 plates, 32 px names, the Figma subtitle, "You have 6000 points" and an 84 px REDEEM`, async ({
      page,
    }) => {
      test.slow();
      const ada = mode === "ADA view";
      await mockKioskBackend(page, { settings: ada ? { accessibility_mode: true } : {} });
      await mockXenoLoyalty(page);
      await registerToStart(page);
      await startOrderToPhone(page, { ada });
      await identifyToMenu(page);

      const sheet = page.getByTestId("loyalty-rewards-sheet");
      const panel = sheet.getByRole("dialog", { name: en.loyalty.title });
      await expect(panel).toBeVisible();
      expect((await size(panel)).height).toBe(panelHeight);
      // The Figma heading: H3 48 px title over the Rg 24 px subtitle.
      await expect(panel.locator("#loyalty-rewards-title")).toHaveCSS("font-size", "48px");
      await expect(sheet.getByText(en.offers.subtitle, { exact: true })).toHaveCSS(
        "font-size",
        "24px"
      );

      const firstRow = sheet.locator('[data-testid^="loyalty-reward-"]').first();
      await expect(firstRow).toBeVisible();
      const code = (await firstRow.getAttribute("data-testid"))?.replace("loyalty-reward-", "");
      const reward = Object.values(LOYALTY_REWARDS).find((r) => r.couponCode === code);
      expect(reward, `first row ${code} is a fixture reward`).toBeDefined();
      expect(await size(firstRow.locator(":scope > span").first())).toEqual({
        width: 152,
        height: 152,
      });
      await expect(firstRow.getByText(reward?.name ?? "", { exact: true })).toHaveCSS(
        "font-size",
        "32px"
      );

      await expect(sheet.getByText(en.offers.subtitle, { exact: true })).toBeVisible();
      await expect(page.getByTestId("loyalty-points-balance")).toHaveText(
        `You have ${LOYALTY_POINTS_TOTAL} points`
      );
      expect((await size(page.getByTestId("loyalty-redeem"))).height).toBe(84);
    });
  }

  test("E2 stalled chunk: after the /phone lookup the sheet is a named scrim ('Close rewards') with no sheet behind it; a tap closes it, the guest stays on a usable /menu, and once the code arrives MY REWARDS opens the sheet", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await mockXenoLoyalty(page);
    const held: Route[] = [];
    await page.route(LAZY_CHUNK, (route) => {
      held.push(route);
    });
    await registerToStart(page);
    await startOrderToPhone(page);
    await identifyToMenu(page);

    const loading = page.getByTestId("loyalty-rewards-loading");
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAccessibleName(en.loyalty.close);
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
    await expect.poll(() => held.length).toBeGreaterThan(0);

    await loading.click();
    await expect(loading).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    // The menu works under the stall: a one-tap add lands in the bag count.
    const sauce = page.getByTestId(`item-${TORTILLA_SAUCE}`);
    await sauce.scrollIntoViewIfNeeded();
    await sauce.click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page).toHaveURL(/\/menu$/);

    // MY REWARDS under the same stall: the scrim again — and closing it, now
    // with an item in the bag, still routes nowhere (a stray navigation to
    // the bag would stay on /cart; on the empty bag above it bounces back).
    await page.getByTestId("menu-rewards-link").click();
    await expect(loading).toBeVisible();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
    await loading.click();
    await expect(loading).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);

    for (const route of held.splice(0)) await route.continue();
    await expect(page.getByTestId("menu-rewards-link")).toContainText("My Rewards (3)");
    await page.getByTestId("menu-rewards-link").click();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expect(
      page.getByTestId(`loyalty-reward-${SALAD_REWARD.couponCode}`)
    ).toBeVisible();
  });

  test("E2b failed chunk: /menu stays up with no crash screen (the Menu's local boundary) and MY REWARDS shows the same closable scrim — never the sheet", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await mockXenoLoyalty(page);
    let aborted = 0;
    await page.route(LAZY_CHUNK, (route) => {
      aborted += 1;
      return route.abort("failed");
    });
    await registerToStart(page);
    await startOrderToPhone(page);
    await identifyToMenu(page);

    // The post-lookup auto-open: the scrim, then — once React retries the
    // rejected import — the local boundary's same scrim, never the crash screen.
    const loading = page.getByTestId("loyalty-rewards-loading");
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAccessibleName(en.loyalty.close);
    await expect.poll(() => aborted).toBeGreaterThan(0);
    await expectMenuSurvivesOverWindow(page);
    await expect(loading).toBeVisible();
    await loading.click();
    await expect(loading).toHaveCount(0);
    await expect(page.getByTestId("menu-screen")).toBeVisible();

    await page.getByTestId("menu-rewards-link").click();
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAccessibleName(en.loyalty.close);
    await expectMenuSurvivesOverWindow(page);
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
    await loading.click();
    await expect(loading).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("menu-screen")).toBeVisible();
    await expect(page.getByTestId("app-error")).toHaveCount(0);
  });

  test("G3 drain bar: the post-lookup auto-open shows the countdown bar; the guest's first touch takes the bar DOWN (the element, not a frozen width) and the sheet stays open past the 25 s dismissal", async ({
    page,
  }) => {
    test.slow();
    // Before the first goto: the 1 Hz countdown runs on the fake clock.
    await page.clock.install();
    await mockKioskBackend(page);
    await mockXenoLoyalty(page);
    await registerToStart(page);
    await startOrderToPhone(page);
    await identifyToMenu(page);

    const sheet = page.getByTestId("loyalty-rewards-sheet");
    // The decorative countdown bar (no testid): the sheet's 6 px pink strip.
    const drainBar = sheet.locator("span.h-\\[6px\\]");
    await expect(sheet).toBeVisible();
    await expect(drainBar).toHaveCount(1);
    await expect(drainBar).toBeVisible();

    // A touch on the heading — no control under it, so the touch is all
    // that happens. Before G3 the bar stayed painted at its frozen width.
    await sheet.locator("#loyalty-rewards-title").click();
    await expect(drainBar).toHaveCount(0);
    await expect(sheet).toBeVisible();
    // The countdown is gone with it: well past 25 s the sheet is still up.
    await page.clock.runFor(REWARDS_AUTO_DISMISS_MS + 5_000);
    await expect(sheet).toBeVisible();
    await expect(drainBar).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);
  });

  test("E8 D6b: the operator's reward title, subtitle and points alias show on the sheet but never reach the order push (pay at counter)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { settings: OPERATOR_PRIMARY });
    const checkout = await mockCheckoutBackend(page);
    await mockXenoLoyalty(page);
    await registerToStart(page);
    await startOrderToPhone(page);
    await identifyToMenu(page);

    // The texts are really in play on the sheet…
    const sheet = page.getByTestId("loyalty-rewards-sheet");
    await expect(sheet.getByRole("dialog", { name: OPERATOR.title })).toBeVisible();
    await expect(sheet.getByText(OPERATOR.subtitle, { exact: true })).toBeVisible();
    await expect(page.getByTestId("loyalty-points-balance")).toHaveText(
      `You have ${LOYALTY_POINTS_TOTAL} ${OPERATOR.alias}`
    );
    const saladRow = page.getByTestId(`loyalty-reward-${SALAD_REWARD.couponCode}`);
    await expect(saladRow).toContainText(`${SALAD_REWARD.points} ${OPERATOR.alias}`);

    // …the reward is claimed, a paid row joins it, and the order is placed.
    await saladRow.click();
    await page.getByTestId("loyalty-redeem").click();
    await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({ timeout: 10_000 });
    await typeDigits(page, LOYALTY_OTP);
    await page.getByTestId("loyalty-otp-submit").click();
    await expect(page.getByTestId("loyalty-success")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("loyalty-success")).toHaveCount(0, { timeout: 10_000 });
    const sauce = page.getByTestId(`item-${TORTILLA_SAUCE}`);
    await sauce.scrollIntoViewIfNeeded();
    await sauce.click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(2)");
    // D6b: resolved at RENDER only — never written into cart / order /
    // loyalty state (the DEV-only window.__kioskStore seam), where any later
    // read could carry it on. Positive control: the reward row is there.
    const orderState = await page.evaluate(() => {
      const store = (
        window as unknown as { __kioskStore: { getState(): Record<string, unknown> } }
      ).__kioskStore.getState();
      return JSON.stringify({ cart: store.cart, order: store.order, loyalty: store.loyalty });
    });
    expect(orderState).toContain(GREEK_SALAD_ID);
    for (const text of Object.values(OPERATOR)) {
      expect(orderState, `"${text}" written into order state`).not.toContain(text);
    }
    await page.getByTestId("cta-view-bag").click();
    await page.waitForURL(/\/(forYou|cart)$/);
    if (new URL(page.url()).pathname === "/forYou") {
      await page.getByTestId("foryou-primary").click();
    }
    await expect(page.locator('[data-testid^="bag-loyalty-row-"]')).toHaveCount(1);
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("customer-name-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("customer-name-continue").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("payment-counter").click();
    // /payment's 3 s cancel window ends by routing to /receipt.
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });

    expect(checkout.placeOrderCount).toBe(1);
    // Positive control: the claimed reward rode in this very push.
    const pushed = checkout.lastPlaceOrderBody as {
      items?: Array<{ id?: string; discounts?: Array<{ comment?: string }> }>;
    };
    const rewardLine = pushed.items?.find((item) => item.id === GREEK_SALAD_ID);
    expect(rewardLine?.discounts?.map((discount) => discount.comment)).toEqual([
      "Loyalty Item",
    ]);
    const body = JSON.stringify(checkout.lastPlaceOrderBody);
    for (const text of Object.values(OPERATOR)) {
      expect(body, `"${text}" leaked into the order push`).not.toContain(text);
    }
    expect(checkout.forbiddenUrls).toEqual([]);
  });

  test("E8b D6b no cross-language fallback: with the operator texts in the PRIMARY slot only, an Arabic guest gets today's Arabic copy — never the English operator texts (E8 is the positive control)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { arabic: true, settings: OPERATOR_PRIMARY });
    await mockXenoLoyalty(page);
    await registerToStart(page);
    await startOrderToPhone(page, { arabic: true });
    await identifyToMenu(page);

    const sheet = page.getByTestId("loyalty-rewards-sheet");
    await expect(page.getByTestId(`loyalty-reward-${SALAD_REWARD.couponCode}`)).toBeVisible();
    // Arabic runs are FSI…PDI-isolated: substrings only (PROGRESS P9f).
    await expect(page.locator("#loyalty-rewards-title")).toContainText(ar.loyalty.title);
    await expect(sheet).toContainText(ar.offers.subtitle);
    for (const text of Object.values(OPERATOR)) {
      await expect(sheet, `"${text}" fell back from the primary slot`).not.toContainText(text);
    }
  });
});
