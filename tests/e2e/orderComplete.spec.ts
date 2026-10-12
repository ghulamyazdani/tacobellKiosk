import { test, expect, freezeClock, stepClockUntil, type Locator, type Page } from "./fixtures/kiosk";
import { mockKioskBackend, locale, SKIP_CRM, GREEK_SALAD } from "./fixtures/backend";
import { mockCheckoutBackend, expectNothingDangerousWasContacted } from "./fixtures/checkout";
import { mockXenoLoyalty, LOYALTY_PHONE, LOYALTY_SETTINGS } from "./fixtures/loyalty";
import { stageBox } from "./fixtures/a11y";
import { settle, shot } from "./fixtures/capture";
import { registerToStart, startToSecond, chooseLanguage, pickPipelineToMenu } from "./pages/boot";
import { addOneTap, openBag, typeDigits } from "./pages/order";
import { payAtCounter } from "./pages/checkout";

/**
 * Lane order-success — Order Complete as Figma draws it, measured on the 1080×1920 stage at scale 1:
 * 1:5932 (a guest: "THANK YOU / FOR YOUR ORDER", the photo panel at y 792) and 1:3437 (an identified
 * loyalty customer: "ORDER #NNNNN", the merch panel at y 725). Both: the bell at (490, 128), the text
 * block at 345, the 412×900 panel at x 334 — and no control at all: the screen's one exit is its
 * 20 s timer (user decision 2026-10-12). The guest's UNLOCK FREEBIES WITH POINTS shows only where
 * loyalty is on, its arrowhead painted OVER the photo; the QR, points and campaign copy have no
 * source and never show. ADA keeps the panel and the annotation mounted but invisible and centres the
 * text block in the reach zone (design language — neither frame has an ADA variant).
 *
 * TIME: page.clock is installed before the first goto and runs (the 3 s PAY AT COUNTER window is
 * stepped); from the receipt tap it STANDS STILL, so the 20 s exit is pinned: up at 19 s, the splash
 * at 20 s. Shots are capture-only (user decision 2026-10-05: no pixel diffing).
 */

const en = locale("en");
const ar = locale("ar");
/** src/components/stage/KioskStage.tsx (ada.spec.ts). */
const ADA_BRAND_ZONE_HEIGHT = 798;
const STAGE_HEIGHT = 1920;

/** guest = loyalty off; loyaltyGuest = loyalty on, /phone skipped; identified = loyalty on, signed in. */
type Customer = "guest" | "loyaltyGuest" | "identified";

async function mockBackend(page: Page, customer: Customer, { arabic = false } = {}) {
  const loyalty =
    customer === "guest" ? SKIP_CRM : { ...LOYALTY_SETTINGS, crm_phone_mandatory: customer === "identified" };
  await mockKioskBackend(page, { arabic, settings: loyalty });
  // Newest route wins: the checkout edges, then the Xeno surface.
  const checkout = await mockCheckoutBackend(page);
  if (customer !== "guest") await mockXenoLoyalty(page);
  return checkout;
}

/** Splash → (language / ADA on /second) → one Greek Salad → PAY AT COUNTER → NO THANKS → Order Complete. */
async function orderToComplete(page: Page, customer: Customer, { arabic = false, ada = false } = {}) {
  await registerToStart(page);
  await startToSecond(page);
  if (arabic) await chooseLanguage(page, "ar");
  if (ada) {
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("footer-ada")).toHaveAttribute("aria-pressed", "true");
  }
  if (customer === "guest") {
    await pickPipelineToMenu(page);
  } else {
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
    if (customer === "identified") {
      await typeDigits(page, LOYALTY_PHONE);
      await page.getByTestId("phone-continue").click();
      // The lookup opens the rewards sheet: closed, nothing claimed.
      await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("loyalty-rewards-close").click();
      await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
    } else {
      await page.getByTestId("phone-skip").click();
    }
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  }
  await addOneTap(page, GREEK_SALAD, "(1)");
  await openBag(page);
  await page.getByTestId("bag-pay").click();
  if (customer !== "guest") {
    // Loyalty on: PAY's preflight asks for a name first (not mandatory).
    await expect(page.getByTestId("customer-name-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("customer-name-continue").click();
  }
  await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
  await payAtCounter(page);
  await freezeClock(page);
  await page.getByTestId("receipt-none").click();
  await stepClockUntil(page, () => page.getByTestId("order-success").isVisible(), { stepMs: 100 });
  await settle(page);
}

/** Each number Figma gives within `tolerance` stage px of `actual`'s. */
function expectNear<K extends string>(
  actual: Record<K, number>,
  figma: Partial<Record<K, number>>,
  tolerance: number,
  what: string
) {
  for (const key of Object.keys(figma) as K[]) {
    const value = figma[key] ?? Number.NaN;
    expect(Math.abs(actual[key] - value), `${what} ${key}: ${actual[key]} vs Figma ${value}`).toBeLessThanOrEqual(tolerance);
  }
}

const success = (page: Page) => page.getByTestId("order-success");
const textBlock = (page: Page) => success(page).locator("h1").locator("xpath=..");
const panel = (page: Page) => page.getByTestId("order-success-panel");
const unlock = (page: Page) => page.getByTestId("order-success-unlock");

/** The frame's fixed geometry (±2 px) on the unscaled stage, the photo decoded, and not one control. */
async function expectFrame(page: Page, panelTop: 792 | 725) {
  expect(await page.getByTestId("kiosk-stage").boundingBox(), "the stage at scale 1").toEqual({
    x: 0,
    y: 0,
    width: 1080,
    height: STAGE_HEIGHT,
  });
  expectNear(await stageBox(success(page).getByAltText("Taco Bell")), { x: 490, y: 128, width: 100, height: 89 }, 2, "bell");
  expectNear(await stageBox(textBlock(page)), { y: 345 }, 2, "text block");
  expectNear(await stageBox(panel(page)), { x: 334, y: panelTop, width: 412, height: 900 }, 2, "panel");
  await expect.poll(() => panel(page).locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(success(page).getByRole("button")).toHaveCount(0);
  await expect(success(page).getByRole("progressbar")).toHaveCount(0);
}

/**
 * Every Order Complete state the DOM holds from now until the screen is gone, one line per change.
 * Its exit must leave it as it is: a store emptied before the route changes commits — and paints —
 * the emptied screen on the OLD route first (hazard H1: RR7 navigates in a transition), i.e. a blank
 * number, the guest frame for an identified customer, the full stage under ADA, English under Arabic.
 */
async function watchUntilGone(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    const read = () => {
      const root = document.querySelector('[data-testid="order-success"]');
      if (!root) return;
      const line = [
        document.querySelector('[data-testid="order-number"]')?.textContent,
        root.querySelector("h1")?.textContent,
        document.querySelector('[data-testid="order-success-panel"]')?.className.match(/top-\[\d+px\]/)?.[0],
        document.documentElement.lang,
        Math.round(root.getBoundingClientRect().height),
      ].join(" | ");
      if (seen.at(-1) !== line) seen.push(line);
    };
    read();
    new MutationObserver(read).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    Object.assign(window, { __orderCompleteSeen: seen });
  });
  return () => page.evaluate(() => (window as unknown as { __orderCompleteSeen: string[] }).__orderCompleteSeen);
}

/** A box's centre in stage px, unrounded (a rotated box's AABB keeps its centre). */
const centre = (locator: Locator) =>
  locator.evaluate((el, stageHeight) => {
    const stage = document.querySelector('[data-testid="kiosk-stage"]');
    if (!stage) throw new Error("kiosk-stage is not mounted");
    const s = stage.getBoundingClientRect();
    const k = s.height / stageHeight;
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - s.left) / k, y: (r.top + r.height / 2 - s.top) / k };
  }, STAGE_HEIGHT);

test.describe("Order Complete — Figma 1:5932 / 1:3437 (lane order-success)", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("GUEST, loyalty off (1:5932): the frame's geometry, THANK YOU on two lines, Figma's PROCEED, no control and no unlock pitch — up at 19 s, the splash at 20 s with the screen unchanged until it goes, and the next guest's bag is empty", async ({
    page,
  }) => {
    test.slow();
    const checkout = await mockBackend(page, "guest");
    await orderToComplete(page, "guest");

    await expectFrame(page, 792);
    await expect(success(page).locator("h1")).toHaveText(en.success.thankYou);
    expectNear(await stageBox(success(page).locator("h1")), { height: 88 }, 2, "THANK YOU / FOR YOUR ORDER (two 44 px lines)");
    // Broken where 1:5932 breaks it: a soft wrap of the one-line copy is 88 px too ("THANK YOU FOR YOUR /
    // ORDER"), and innerText keeps only the copy's own break.
    expect(
      await success(page).locator("h1").evaluate((h1) => (h1 as HTMLElement).innerText.toUpperCase().split("\n")),
      "Figma's two lines"
    ).toEqual(["THANK YOU", "FOR YOUR ORDER"]);
    await expect(page.getByTestId("order-success-proceed")).toHaveText(en.success.proceedToCounter);
    await expect(unlock(page)).toHaveCount(0);
    await shot(page, "oc-01-guest-en");

    const committed = await watchUntilGone(page);
    await page.clock.runFor(19_000);
    await expect(success(page)).toBeVisible();
    await expect(page).toHaveURL(/\/orderSuccess$/);
    await page.clock.runFor(1_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/start$/);
    expect(await committed(), "Order Complete on its way out (H1: never the emptied store)").toHaveLength(1);

    await page.clock.resume();
    await startToSecond(page);
    await pickPipelineToMenu(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await expect(page.getByTestId("cta-total")).toContainText("0.00");
    expect(checkout.placeOrderCount).toBe(1);
    expectNothingDangerousWasContacted(checkout);
  });

  test("GUEST, loyalty on (1:5932): UNLOCK / FREEBIES / WITH POINTS at the frame's place, FREEBIES yellow, and the arrowhead painted over the photo", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, "loyaltyGuest");
    await orderToComplete(page, "loyaltyGuest");

    await expectFrame(page, 792);
    await expect(success(page).locator("h1")).toHaveText(en.success.thankYou);
    // The wrapper is a zero-height static box: its arrow and lines are what shows.
    await expect(unlock(page).locator("img")).toBeVisible();
    await expect(unlock(page).locator("span")).toHaveText([
      en.success.unlockTop,
      en.success.unlockFreebies,
      en.success.unlockBottom,
    ]);
    await expect(unlock(page).locator("span").nth(1)).toHaveCSS("color", "rgb(250, 219, 60)");
    const arrow = unlock(page).locator("img");
    expectNear(await centre(arrow), { x: 779.9, y: 1304.3 }, 3, "arrow centre");
    // 1:5932 paints the arrowhead over the photo's right edge (x 746).
    const hit = await page.evaluate((stageHeight) => {
      const stage = document.querySelector('[data-testid="kiosk-stage"]');
      if (!stage) return "no stage";
      const s = stage.getBoundingClientRect();
      const k = s.height / stageHeight;
      const el = document.elementFromPoint(s.left + 730 * k, s.top + 1281 * k);
      return el?.closest('[data-testid="order-success-unlock"]') && el.tagName === "IMG" ? "arrow" : (el?.outerHTML.slice(0, 120) ?? "nothing");
    }, STAGE_HEIGHT);
    expect(hit, "what (730, 1281) hits").toBe("arrow");
    await expect(success(page)).not.toContainText(/scan to earn|110 points|for your meal|merch|tuesday/i);
    await shot(page, "oc-02-guest-loyalty-en");

    // With motion on, the arrow waits one page entrance + one stagger and each line three staggers
    // (the tokens, read live). Those delays hold only while .tb-pop-in's shorthand sits in
    // @layer components, under the utilities layer — out of it, it resets them to 0 s.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const offBy = await unlock(page).evaluate((wrap) => {
      const ms = (css: string) => parseFloat(css) * (css.trim().endsWith("ms") ? 1 : 1000);
      const tokens = getComputedStyle(document.documentElement);
      const [dur, stagger] = ["--tb-dur-page", "--tb-stagger"].map((name) => ms(tokens.getPropertyValue(name)));
      const delay = (el: Element | null | undefined) => (el ? ms(getComputedStyle(el).animationDelay) : Number.NaN);
      return {
        tokensSet: dur > 0 && stagger > 0,
        arrow: Math.round(delay(wrap.querySelector("img")) - (dur + stagger)),
        lines: [...wrap.querySelectorAll("span")].map((line) => Math.round(delay(line.parentElement) - (dur + 3 * stagger))),
      };
    });
    expect(offBy, "the unlock pops' delays vs the tokens (ms)").toEqual({ tokensSet: true, arrow: 0, lines: [0, 0, 0] });
  });

  test("LOYALTY, identified (1:3437): ORDER and the number are one 116 px H1 block, the merch panel at y 725, no unlock pitch and no campaign footer", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, "identified");
    await orderToComplete(page, "identified");

    await expectFrame(page, 725);
    const heading = success(page).locator("h1");
    const number = page.getByTestId("order-number");
    await expect(heading).toHaveText(en.success.orderHeading);
    await expect(number).toHaveText(/^#\d{5}$/);
    await expect(heading).toHaveCSS("font-size", "116px");
    await expect(number).toHaveCSS("font-size", "116px");
    const [h1, n] = [await stageBox(heading), await stageBox(number)];
    expect(Math.abs(n.y - (h1.y + h1.height)), "the number sits right under ORDER (no gap)").toBeLessThanOrEqual(1);
    await expect(unlock(page)).toHaveCount(0);
    await expect(success(page)).not.toContainText(/checkout next|tuesday drops|merch|scan to earn/i);
    await expect(success(page)).not.toContainText(en.success.thankYou);
    await shot(page, "oc-03-identified-en");

    // The exit: the identified frame stays as it is until /start replaces it — never the guest frame.
    const committed = await watchUntilGone(page);
    await page.clock.runFor(20_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    expect(await committed(), "Order Complete on its way out (H1: never the emptied store)").toHaveLength(1);
  });

  test("ARABIC guest, loyalty on: the thank-you on ONE line, the Arabic PROCEED and the three Arabic unlock lines — no English, no raw key", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, "loyaltyGuest", { arabic: true });
    await orderToComplete(page, "loyaltyGuest", { arabic: true });

    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expectFrame(page, 792);
    const heading = success(page).locator("h1");
    await expect(heading).toContainText(ar.success.thankYou);
    expectNear(await stageBox(heading), { height: 44 }, 2, "the Arabic thank-you (one 44 px line)");
    await expect(page.getByTestId("order-success-proceed")).toContainText(ar.success.proceedToCounter);
    const lines = unlock(page).locator("span");
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toContainText(ar.success.unlockTop);
    await expect(lines.nth(1)).toContainText(ar.success.unlockFreebies);
    await expect(lines.nth(2)).toContainText(ar.success.unlockBottom);
    for (const english of [en.success.proceedToCounter, en.success.unlockTop, en.success.unlockFreebies, en.success.unlockBottom]) {
      await expect(success(page)).not.toContainText(english);
    }
    await shot(page, "oc-04-guest-loyalty-ar");
  });

  test("ADA guest, loyalty on: the panel and the unlock stay mounted but hidden, the text block is centred in the reach zone, and nothing of the screen shows above it", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, "loyaltyGuest");
    await orderToComplete(page, "loyaltyGuest", { ada: true });

    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await expect(panel(page)).toHaveCSS("visibility", "hidden");
    await expect(unlock(page)).toHaveCSS("visibility", "hidden");
    await expect(unlock(page).locator("img")).toHaveCSS("visibility", "hidden");
    await expect(success(page).getByAltText("Taco Bell")).toHaveCount(0);
    await expect(success(page).getByRole("button")).toHaveCount(0);

    const zone = await stageBox(success(page));
    expect(zone, "the screen IS the reach zone").toEqual({ x: 0, y: ADA_BRAND_ZONE_HEIGHT, width: 1080, height: STAGE_HEIGHT - ADA_BRAND_ZONE_HEIGHT });
    const block = await stageBox(textBlock(page));
    expectNear({ centre: block.y + block.height / 2 }, { centre: (ADA_BRAND_ZONE_HEIGHT + STAGE_HEIGHT) / 2 }, 4, "text block");
    const above = await success(page).evaluate(
      (root, { brand, stageHeight }) => {
        const stage = document.querySelector('[data-testid="kiosk-stage"]');
        if (!stage) return ["no stage"];
        const s = stage.getBoundingClientRect();
        const k = s.height / stageHeight;
        return [...root.querySelectorAll("*")]
          .filter((el) => !el.closest('[aria-hidden="true"]'))
          .filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0 && (r.top - s.top) / k < brand - 1)
          .map(({ el, r }) => `${el.tagName} ${el.getAttribute("data-testid") ?? ""} at y ${Math.round((r.top - s.top) / k)}`);
      },
      { brand: ADA_BRAND_ZONE_HEIGHT, stageHeight: STAGE_HEIGHT }
    );
    expect(above, "visible content above the reach zone").toEqual([]);
    await shot(page, "oc-05-guest-loyalty-ada");

    // The exit: the screen stays in the zone until /start replaces it — never the full stage first.
    const committed = await watchUntilGone(page);
    await page.clock.runFor(20_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    expect(await committed(), "Order Complete on its way out (H1: never the emptied store)").toHaveLength(1);
  });
});
