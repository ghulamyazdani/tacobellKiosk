import { test, expect, type Page, stepClockUntil } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  fixtureJson,
  locale,
  CHUNK,
  GREEK_SALAD,
  DREAM_BOX,
} from "./fixtures/backend";
import { bootRegisteredToMenu } from "./pages/boot";
import { addOneTap, openBag } from "./pages/order";
import { mockCheckoutBackend } from "./fixtures/checkout";

/**
 * Lane figma-polish G2 — a failed lazy UI chunk never takes an order down.
 *
 * Every lazy UI part lives in the ONE bagLazyParts chunk. A production build
 * answers a failed chunk with `vite:preloadError`, which chunkRecovery turns
 * into a reload — except inside its 60 s no-reload window, where it now
 * calls the healer main.tsx registers (`initiateWholeAppUpdate`: the splash
 * reloads at its next dwell, between guests). The parts themselves degrade
 * behind local error boundaries / named scrims, so the bag stays usable for
 * PAY and the PDP never loses the guest's picks.
 *
 * - BAG / PDP: the chunk is aborted by a route registered BEFORE the boot
 *   (loyaltyRewardsSheet.spec E2b): /menu requests it at entry (the menu's
 *   always-mounted Xeno rewards sheet), the PDP at mount. The dev server
 *   makes a failed import REJECT and never fires vite:preloadError, so these
 *   prove the local boundaries — never the reload.
 * - HEALER: the dev server never dispatches vite:preloadError, so the event
 *   is synthetic (the shape Vite dispatches: a cancelable Event carrying
 *   `payload`). Inside the window = a RELOAD navigation under 60 s old.
 *   Playwright's fake clock fakes `performance` too — its getEntriesByType()
 *   answers [] — so the clock is installed only AFTER the guard has run, just
 *   before the walk back to the splash (autoUpdate.spec's dwell pattern:
 *   10 s quiet, a 5 s countdown, ONE reload).
 *
 * Mocks: the harness house order, NEWEST route wins: the shared mock first
 * (fixtures/backend.ts — its origin-scoped `/api/` catch-all, then every boot
 * endpoint), the checkout fixture last; the harness (fixtures/kiosk.ts)
 * denies any other origin by name. Boot and bag steps are the shared page
 * functions (pages/boot.ts, pages/order.ts).
 */

const en = locale("en");

/** The ONE lazy UI chunk as the dev server serves it. */
const LAZY_CHUNK = CHUNK.bag;

/** DREAM_BOX, the pack (£25): Sandwich / Sides / Nuggets one-option (pre-selected), Drinks the CHOICE slot. */
const G_SIDES = `${DREAM_BOX}_2_combo`;
const G_DRINKS = `${DREAM_BOX}_3_combo`;
const G_SNACKS = `${DREAM_BOX}_6_combo`;
/** Snacks (min 0 / max 2, a stepper group): +£5 each. */
const CHILI_NUGGETS = "696df06f5a77225b771e978a";
const PEPSI_SMALL = "5dd27b527973647b693e428b";

async function mockKioskBackend(page: Page, { offers = false } = {}) {
  await mockBackend(page, { offers: offers ? fixtureJson("offers.json") : [] });
}

/** Counts every request for the lazy chunk and aborts it (register BEFORE the boot). */
async function abortLazyChunk(page: Page): Promise<() => number> {
  let aborted = 0;
  await page.route(LAZY_CHUNK, (route) => {
    aborted += 1;
    return route.abort("failed");
  });
  return () => aborted;
}

const addGreekSaladOneTap = (page: Page) => addOneTap(page, GREEK_SALAD, "(1)");

/**
 * A rejected import reaches an error boundary only on React's retry, a few
 * hundred ms after the fallback first shows (loyaltyRewardsSheet.spec E2b),
 * so "no crash screen" is SAMPLED over a 1.5 s window, never read once.
 */
async function expectNoCrashOverWindow(page: Page, screenTestId: string) {
  const windowEnds = Date.now() + 1_500;
  await expect
    .poll(
      async () => {
        if ((await page.getByTestId("app-error").count()) > 0) return "crash screen";
        if ((await page.getByTestId(screenTestId).count()) === 0) return `no ${screenTestId}`;
        return Date.now() >= windowEnds ? "up" : "waiting";
      },
      { timeout: 8_000, intervals: [100] }
    )
    .toBe("up");
}

interface KioskStore {
  getState: () => Record<string, Record<string, unknown>>;
  dispatch: (action: unknown) => unknown;
}
type KioskWindow = Window & { __kioskStore: KioskStore; __g2Marker?: string };

const shouldWholeAppUpdate = (page: Page) =>
  page.evaluate(
    () => (window as unknown as KioskWindow).__kioskStore.getState().autoUpdate.shouldWholeAppUpdate
  );

/** The shape Vite's preload helper dispatches for a failed chunk. */
const firePreloadError = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("vite:preloadError", { cancelable: true }) as Event & {
      payload?: unknown;
    };
    event.payload = new Error(
      "Failed to fetch dynamically imported module: /assets/bagLazyParts-e2e.js"
    );
    window.dispatchEvent(event);
  });

const setMarker = (page: Page, value: string) =>
  page.evaluate((v) => {
    (window as unknown as KioskWindow).__g2Marker = v;
  }, value);
/** undefined once the page has reloaded (an evaluate cut by the navigation too). */
const readMarker = (page: Page) =>
  page
    .evaluate(() => (window as unknown as KioskWindow).__g2Marker)
    .catch(() => undefined);

/** Full page loads from here on. */
function countLoads(page: Page): () => number {
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  return () => loads;
}

/** The page's own navigation entry and age — the loop guard's two inputs. */
const pageLoad = (page: Page) =>
  page.evaluate(() => ({
    type: (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
      ?.type,
    ageMs: performance.now(),
  }));

test.describe("figma-polish G2 — a failed lazy chunk degrades in place", () => {
  test("BAG: with bagLazyParts aborted, /menu stays up, the bag keeps rows, totals and PAY (no rail, no crash screen), the Rewards entry's scrim closes on tap, and PAY proceeds", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { offers: true });
    const checkout = await mockCheckoutBackend(page);
    const aborted = await abortLazyChunk(page);
    await bootRegisteredToMenu(page);

    // 1. /menu asked for the chunk at entry (its loyalty sheet's boundary
    //    absorbs the failure) and stays up.
    await expect.poll(aborted).toBeGreaterThan(0);
    await expectNoCrashOverWindow(page, "menu-screen");

    // 2. The bag: rows, totals and PAY — the rail is simply absent.
    await addGreekSaladOneTap(page);
    await openBag(page);
    await expect(page.locator('[data-testid^="bag-row-"]')).toHaveCount(1);
    await expect(page.getByTestId("bag-subtotal")).toContainText("£17.00");
    // round(17 × 1.15) = £20 — exclusive VAT@15% (bag.spec header).
    await expect(page.getByTestId("bag-total")).toContainText("£20.00");
    await expect(page.getByTestId("bag-pay")).toBeEnabled();
    await expectNoCrashOverWindow(page, "bag-sheet");
    await expect(page.getByTestId("bag-rail")).toHaveCount(0);

    // 3. The Rewards entry: the sheet's code is dead, so its named scrim
    //    stands in, and a tap closes it back onto the bag.
    await page.getByTestId("bag-rewards-entry").click();
    const scrim = page.getByTestId("rewards-loading");
    await expect(scrim).toBeVisible();
    await expect(scrim).toHaveAccessibleName(en.offers.close);
    await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
    await expectNoCrashOverWindow(page, "bag-sheet");
    await scrim.click();
    await expect(scrim).toHaveCount(0);
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await expect(page).toHaveURL(/\/cart$/);

    // 4. PAY: the preflight resolves this fixture to /phone (bag.spec PAY).
    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    await expect(page.getByTestId("phone-screen")).toBeVisible();
    await expect(page.getByTestId("app-error")).toHaveCount(0);
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    expect(checkout.forbiddenUrls).toEqual([]);
  });

  test("PDP (Dream box): with the chunk aborted an incomplete ADD TO BAG rings the empty slot with NO completion warning and keeps every pick; CUSTOMIZE shows the tier2-loading scrim, a tap closes it with the picks intact, and the pack still commits", async ({
    page,
    kiosk,
  }) => {
    kiosk.allowPageError(
      /There was an error during concurrent rendering but React was able to recover/,
      "this test aborts bagLazyParts on purpose: the PDP's lazy part rejects mid concurrent render and React recovers (harvests 2026-10-08 and 2026-10-09; not an app bug)"
    );
    test.slow();
    await mockKioskBackend(page);
    const aborted = await abortLazyChunk(page);
    await bootRegisteredToMenu(page);
    const box = page.getByTestId(`item-${DREAM_BOX}`);
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
    await expect.poll(aborted).toBeGreaterThan(0);

    // The guest's own pick: one Snacks portion (+£5).
    const chili = page.getByTestId(`pdp-option-${CHILI_NUGGETS}`);
    await chili.getByRole("button", { name: /^Increase quantity/ }).click();
    const snacks = page.getByTestId(`pdp-group-${G_SNACKS}`);
    await expect(snacks).toContainText("1 of 2");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£30.00");

    /** Every pick the guest has: the pre-selected slots and the Snacks portion. */
    const expectPicksIntact = async () => {
      await expect(page.getByTestId(`pack-slot-${G_SIDES}`)).toContainText("Large Fries");
      await expect(snacks).toContainText("1 of 2");
      await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£30.00");
      await expect(page).toHaveURL(/\/customization$/);
    };

    // Drinks (the CHOICE slot) is empty: the ring alone answers the tap.
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId(`pack-slot-${G_DRINKS}`)).toHaveClass(/ring-red-500/);
    await expectNoCrashOverWindow(page, "customization-screen");
    await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expectPicksIntact();

    // CUSTOMIZE on the FIXED Sides card: the tier-2 page's code is dead, so
    // its named scrim — a tap closes tier-2 and the tier-1 picks stay.
    await page.getByTestId(`pack-slot-customize-${G_SIDES}`).click();
    const scrim = page.getByTestId("tier2-loading");
    await expect(scrim).toBeVisible();
    await expect(scrim).toHaveAccessibleName(en.language.close);
    await expect(page.getByTestId("tier2-sheet")).toHaveCount(0);
    await expectNoCrashOverWindow(page, "customization-screen");
    await scrim.click();
    await expect(scrim).toHaveCount(0);
    await expectPicksIntact();

    // Without the chunk the PDP still sells: fill Drinks, ADD TO BAG.
    await page.getByTestId(`pack-slot-open-${G_DRINKS}`).click();
    await page.getByTestId(`slot-option-${PEPSI_SMALL}`).click();
    await page.getByTestId("slot-sheet-save").click();
    await expect(page.getByTestId("slot-sheet")).toHaveCount(0);
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£30.00");
    await expect(page.getByTestId("app-error")).toHaveCount(0);
  });

  test("HEALER inside the 60 s window: on a reloaded page a chunk failure never reloads mid-order — it flags the whole-app update, and back on the splash the dwell reloads the page ONCE", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addGreekSaladOneTap(page);

    // A crash-reload: the page is a RELOAD navigation, well under 60 s old.
    await page.reload();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    const load = await pageLoad(page);
    expect(load.type).toBe("reload");
    expect(load.ageMs).toBeLessThan(60_000);
    expect(await shouldWholeAppUpdate(page)).toBe(false);

    const loads = countLoads(page);
    await setMarker(page, "inside");
    await firePreloadError(page);
    await expect.poll(() => shouldWholeAppUpdate(page)).toBe(true);
    // No reload: the marker survives a 1.5 s window and no load fired.
    const windowEnds = Date.now() + 1_500;
    await expect
      .poll(
        async () => {
          if ((await readMarker(page)) !== "inside") return "reloaded";
          return Date.now() >= windowEnds ? "stayed" : "waiting";
        },
        { timeout: 8_000, intervals: [100] }
      )
      .toBe("stayed");
    expect(loads()).toBe(0);
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");

    // Fake time from here (header): the splash's dwell must arm on it.
    await page.clock.install();

    // The per-page latch (fix F1): this page has held a reload back once, so
    // a LATER failure heals too — even with the guard's own inputs saying
    // "not a reload under 60 s" (the fake clock hides the navigation entry,
    // and the page is now 61 s old). The PDP re-imports at every mount; a
    // reload here would cut the order.
    expect((await pageLoad(page)).type).toBeUndefined();
    await page.clock.fastForward(61_000);
    await firePreloadError(page);
    const latchWindowEnds = Date.now() + 1_500;
    await expect
      .poll(
        async () => {
          if ((await readMarker(page)) !== "inside") return "reloaded";
          return Date.now() >= latchWindowEnds ? "stayed" : "waiting";
        },
        { timeout: 8_000, intervals: [100] }
      )
      .toBe("stayed");
    expect(loads()).toBe(0);
    expect(await shouldWholeAppUpdate(page)).toBe(true);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");

    await page.getByTestId("footer-cancel").click();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    // A fresh boot stamp: only the flagged update may act at this dwell.
    await page.evaluate(() => {
      (window as unknown as KioskWindow).__kioskStore.dispatch({
        type: "autoUpdate/setLastBootAt",
        payload: Date.now(),
      });
    });
    await page.clock.runFor(10_000);
    await expect(page.getByTestId("update-countdown")).toBeVisible();
    expect(loads()).toBe(0);
    const reloaded = page.waitForEvent("load");
    await stepClockUntil(page, () => loads() === 1);
    await reloaded;
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    expect(await readMarker(page)).toBeUndefined();
    // Session-only: the reload itself clears the flag.
    expect(await shouldWholeAppUpdate(page)).toBe(false);
  });

  test("OUTSIDE the window: on a page that is not a reload, the chunk failure reloads at once (the deploy case)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    expect((await pageLoad(page)).type).toBe("navigate");
    await setMarker(page, "outside");

    const reloaded = page.waitForEvent("load");
    await firePreloadError(page);
    await reloaded;
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    expect(await readMarker(page)).toBeUndefined();
    expect((await pageLoad(page)).type).toBe("reload");
    expect(await shouldWholeAppUpdate(page)).toBe(false);
  });
});
