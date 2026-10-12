import { test, expect, dexieRows, freezeClock, stepClockUntil } from "../fixtures/kiosk";
import {
  mockKioskBackend,
  locale,
  SKIP_CRM,
  CHEESE_BURGER,
  GREEK_SALAD,
  MEALS_COMBOS,
  SIDE_ORDERS,
} from "../fixtures/backend";
import { mockCheckoutBackend, expectNothingDangerousWasContacted, orderIdOf } from "../fixtures/checkout";
import { settle, shot } from "../fixtures/capture";
import { registerToStart, startToSecond, chooseLanguage, pickPipelineToMenu } from "../pages/boot";
import { selectCategory, addViaPdp, addOneTap, openBag } from "../pages/order";
import { payAtCounter } from "../pages/checkout";

/**
 * Rulebook flow 1 — the happy path as ONE linear English walk (P9f §4.1): splash → a real
 * language round trip → a rail browse → a PDP add and a one-tap add → bag money → PAY AT COUNTER →
 * Order Complete → nobody touches the kiosk → its own 20 s timer hands the next guest a clean
 * session. Screenshots are capture-only (attached to the report).
 * TIME: page.clock is installed before the first goto and RUNS; the 3 s cancel window is stepped
 * with runFor. From the receipt tap on it STANDS STILL, so Order Complete's 20 s timer
 * (OrderSuccess ORDER_SUCCESS_COUNTDOWN_SECONDS) is pinned to the step: up at 19 s, the
 * splash at 20 s. On a running clock an expect's own 10 s wait would pass a timer of up to ~30 s.
 */
test.use({ strictConsole: true });

const en = locale("en");
const ar = locale("ar");

test.describe("Flow 1 — happy path", () => {
  test("ONE GUEST, START TO FINISH: language round trip, rail browse, two items, COD, and the unattended reset to a clean next session", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install();
    // Arabic on, so the language sheet offers a real choice.
    await mockKioskBackend(page, { arabic: true, settings: SKIP_CRM });
    const checkout = await mockCheckoutBackend(page);

    // 1 — the splash.
    await registerToStart(page);
    await expect(page.getByTestId("start-screen")).toContainText(en.splash.welcome);
    await settle(page);
    await shot(page, "flow1-01-splash");

    // 2 — order type, with a language round trip.
    await startToSecond(page);
    await chooseLanguage(page, "ar");
    await expect(page.getByTestId("second-screen")).toContainText(ar.second.title);
    await chooseLanguage(page, "en");
    await expect(page.getByTestId("second-screen")).toContainText(en.second.title);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await settle(page);
    await shot(page, "flow1-02-order-type");

    // 3 — the rail: each tap scrolls the pane to its section and moves the mark (colour only: no
    // aria-current, CategoryRail). The first row starts marked, so the walk leaves it and comes back.
    // slim-menu's two sections both fit the pane at load (it scrolls 75 px at most), so "in viewport"
    // cannot prove a scroll: Side Orders itself must move up, then back.
    await pickPipelineToMenu(page);
    const marked = /bg-tb-purple-vibrant/;
    const sideTop = () =>
      page.getByTestId(`section-${SIDE_ORDERS}`).evaluate((el) => Math.round(el.getBoundingClientRect().top));
    const atLoad = await sideTop();
    await expect(page.getByTestId(`rail-${MEALS_COMBOS}`)).toHaveClass(marked);
    await selectCategory(page, SIDE_ORDERS);
    await expect.poll(sideTop).toBeLessThan(atLoad);
    await expect(page.getByTestId(`rail-${SIDE_ORDERS}`)).toHaveClass(marked);
    await expect(page.getByTestId(`rail-${MEALS_COMBOS}`)).not.toHaveClass(marked);
    await selectCategory(page, MEALS_COMBOS);
    await expect.poll(sideTop).toBe(atLoad);
    await expect(page.getByTestId(`rail-${MEALS_COMBOS}`)).toHaveClass(marked);
    await expect(page.getByTestId(`rail-${SIDE_ORDERS}`)).not.toHaveClass(marked);
    await settle(page);
    await shot(page, "flow1-03-menu");

    // 4 — one item through the PDP, one with a tap.
    await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
    await addOneTap(page, GREEK_SALAD, "(2)");
    await expect(page.getByTestId("cta-total")).toContainText("£25.00");

    // 5 — the bag: 25.00 + 15 % VAT = 28.75 → £29.00.
    await openBag(page);
    await expect(page.getByTestId("bag-sheet")).toContainText("My Bag (2)");
    await expect(page.getByTestId("bag-subtotal")).toContainText("£25.00");
    await expect(page.getByTestId("bag-total")).toContainText("£29.00");
    await expect(page.getByTestId("bag-pay")).toContainText("£29.00");
    await settle(page);
    await shot(page, "flow1-04-bag");

    // 6 — /payment carries the bag's total; nothing is placed yet.
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible();
    await expect(page.getByTestId("payment-total")).toContainText("£29.00");
    expect(checkout.placeOrderCount).toBe(0);
    await settle(page);
    await shot(page, "flow1-05-payment");

    // 7 — PAY AT COUNTER → no receipt → Order Complete shows the pushed order's last 5. The clock
    // stops before the tap and steps 100 ms at a time, so the 20 s timer is caught within its 1st second.
    await payAtCounter(page);
    await freezeClock(page);
    await page.getByTestId("receipt-none").click();
    await stepClockUntil(page, () => page.getByTestId("order-success").isVisible(), { stepMs: 100 });
    await expect(page.getByTestId("order-number")).toHaveText(/^#\d{5}$/);
    await expect(page.getByTestId("order-number")).toHaveText(
      `#${orderIdOf(checkout.lastPlaceOrderBody).slice(-5)}`,
    );
    await settle(page);
    await shot(page, "flow1-06-complete");

    // 8 — exactly one COD push, nothing dangerous.
    expect(checkout.placeOrderCount).toBe(1);
    expect(checkout.lastPlaceOrderBody).toMatchObject({ payments: { type: "COD" } });
    expectNothingDangerousWasContacted(checkout);

    // 9/10 — unattended (the clock still stands): up at 19 s, the splash at 20 s, the cart mirror empty.
    await page.clock.runFor(19_000);
    await expect(page.getByTestId("order-success")).toBeVisible();
    await page.clock.runFor(1_000);
    await expect(page).toHaveURL(/\/start$/);
    await page.clock.resume();
    await expect(page.getByTestId("start-screen")).toBeVisible();
    await expect.poll(async () => (await dexieRows(page)).length).toBe(0);
    await settle(page);
    await shot(page, "flow1-07-next-guest");

    // 11 — the next guest starts clean: English, an empty bag.
    await startToSecond(page);
    await pickPipelineToMenu(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toContainText("£0.00");
    expect(checkout.placeOrderCount).toBe(1);
  });
});
