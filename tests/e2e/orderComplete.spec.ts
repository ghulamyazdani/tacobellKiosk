import { test, expect, freezeClock, stepClockUntil, type Page } from "./fixtures/kiosk";
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
 * 1:5932 (a guest: "THANK YOU / FOR YOUR ORDER") and 1:3437 (an identified loyalty customer: "ORDER
 * #NNNNN"). Both: the bell at (490, 128) and the text block — centred on the stage since the photo
 * panel was removed with the guest's UNLOCK FREEBIES WITH POINTS, whose arrow pointed into it (user
 * 2026-10-14: "remove the static image in the middle"). One control, START NEW ORDER in the CTA slot
 * (user 2026-10-13), counting the 20 s exit down on its label while a fill slides across it (user
 * 2026-10-14; design language): a tap leaves at once, 0 leaves for the splash. The QR, points and
 * campaign copy have no source and never show. ADA drops the bell and centres the text block in the
 * reach zone (design language — neither frame has an ADA variant).
 *
 * TIME: page.clock is installed before the first goto and runs (the 3 s PAY AT COUNTER window is
 * stepped); from the receipt tap it STANDS STILL, so the countdown is pinned: 20 on arrival, 15 at
 * 5 s, 1 at 19 s, the splash at 20 s. The fill is CSS (it runs on the document timeline, not the page
 * clock): the suite's reduced motion does not render it; one test turns motion on to read it. Shots
 * are capture-only (user decision 2026-10-05: no pixel diffing).
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
const newOrder = (page: Page) => page.getByTestId("order-success-new-order");
/** START NEW ORDER's ticking part (aria-hidden): " · 20s". */
const countdown = (page: Page) => page.getByTestId("order-success-countdown");
const fill = (page: Page) => page.getByTestId("order-success-countdown-fill");
/** The English label's seconds, as rendered after the name. */
const secs = (seconds: number) => `· ${en.success.countdown.replace("{{seconds}}", String(seconds))}`;

/**
 * The frame's fixed geometry (±2 px) on the unscaled stage — the text block centred (no panel, no
 * unlock: the sheen and the bell are its only pictures) — and ONE control: START NEW ORDER in the
 * CTA slot (2026-10-13), named without its seconds.
 */
async function expectFrame(page: Page) {
  expect(await page.getByTestId("kiosk-stage").boundingBox(), "the stage at scale 1").toEqual({
    x: 0,
    y: 0,
    width: 1080,
    height: STAGE_HEIGHT,
  });
  expectNear(await stageBox(success(page).getByAltText("Taco Bell")), { x: 490, y: 128, width: 100, height: 89 }, 2, "bell");
  const block = await stageBox(textBlock(page));
  expectNear({ centre: block.y + block.height / 2 }, { centre: STAGE_HEIGHT / 2 }, 2, "text block (centred on the stage)");
  await expect(page.getByTestId("order-success-panel")).toHaveCount(0);
  await expect(page.getByTestId("order-success-unlock")).toHaveCount(0);
  await expect(success(page).locator("img")).toHaveCount(2);
  await expect(success(page).getByRole("button")).toHaveCount(1);
  expectNear(await stageBox(newOrder(page)), { x: 24, y: 1812, width: 1032, height: 84 }, 2, "START NEW ORDER (CTA_Sheet_Fixed)");
  await expect(success(page).getByRole("progressbar")).toHaveCount(0);
}

/** shot() with the animations left as they are: "disabled" would finish a paused fill. */
async function shotAsIs(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "allow", caret: "hide" });
  await test.info().attach(name, { path, contentType: "image/png" });
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
      // Never the countdown: its digits tick by design.
      const line = [
        document.querySelector('[data-testid="order-number"]')?.textContent,
        root.querySelector("h1")?.textContent,
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

test.describe("Order Complete — Figma 1:5932 / 1:3437 (lane order-success)", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("GUEST, loyalty off (1:5932): the frame's geometry with the text block centred, THANK YOU on two lines, Figma's PROCEED, no photo and no unlock pitch — START NEW ORDER counts 20, 15 … 1 and the splash comes at 0 with the screen unchanged until it goes, and the next guest's bag is empty", async ({
    page,
  }) => {
    test.slow();
    const checkout = await mockBackend(page, "guest");
    await orderToComplete(page, "guest");

    await expectFrame(page);
    await expect(success(page).locator("h1")).toHaveText(en.success.thankYou);
    expectNear(await stageBox(success(page).locator("h1")), { height: 88 }, 2, "THANK YOU / FOR YOUR ORDER (two 44 px lines)");
    // Broken where 1:5932 breaks it: a soft wrap of the one-line copy is 88 px too ("THANK YOU FOR YOUR /
    // ORDER"), and innerText keeps only the copy's own break.
    expect(
      await success(page).locator("h1").evaluate((h1) => (h1 as HTMLElement).innerText.toUpperCase().split("\n")),
      "Figma's two lines"
    ).toEqual(["THANK YOU", "FOR YOUR ORDER"]);
    await expect(page.getByTestId("order-success-proceed")).toHaveText(en.success.proceedToCounter);
    // The label shows the seconds; the name never carries them (the digits are aria-hidden).
    await expect(newOrder(page)).toHaveText(`${en.success.startNewOrder} ${secs(20)}`);
    await expect(newOrder(page)).toHaveAccessibleName(en.success.startNewOrder);
    await expect(countdown(page)).toHaveAttribute("aria-hidden", "true");
    // The screen reader's one sentence: the live region is there, EMPTY, before its text (a region
    // that mounts already filled is not announced)…
    const status = success(page).getByRole("status");
    await expect(status).toHaveCount(1);
    await expect(status).toHaveText("");
    // The suite runs reduced motion: the fill is not rendered there — the digits carry the countdown.
    await expect(fill(page)).toBeHidden();
    await shot(page, "oc-01-guest-en");

    const committed = await watchUntilGone(page);
    // …the first tick fills it with that tick's seconds, and it never changes after.
    await page.clock.runFor(1_000);
    await expect(countdown(page)).toHaveText(secs(19));
    const announced = en.success.countdownA11y.replace("{{seconds}}", "19");
    await expect(status).toHaveText(announced);
    await page.clock.runFor(4_000);
    await expect(countdown(page)).toHaveText(secs(15));
    await expect(status).toHaveText(announced);
    await page.clock.runFor(14_000);
    await expect(countdown(page)).toHaveText(secs(1));
    await expect(success(page)).toBeVisible();
    await expect(page).toHaveURL(/\/orderSuccess$/);
    await expect(newOrder(page)).toHaveAccessibleName(en.success.startNewOrder);
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

  test("START NEW ORDER: a tap leaves at once for the splash — the same exit as the timer — and the next guest's bag is empty", async ({
    page,
  }) => {
    const checkout = await mockBackend(page, "guest");
    await orderToComplete(page, "guest");
    await page.clock.runFor(3_000);
    await expect(countdown(page)).toHaveText(secs(17));

    await newOrder(page).click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/start$/);

    await page.clock.resume();
    await startToSecond(page);
    await pickPipelineToMenu(page);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    expect(checkout.placeOrderCount).toBe(1);
    expectNothingDangerousWasContacted(checkout);
  });

  test("GUEST, loyalty on (1:5932): the plain guest frame — no unlock pitch, no photo, no points copy; with motion on, START NEW ORDER's fill is ONE linear CSS transform run over the 20 s from the left edge, at 15 % white, and nothing waits on it", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, "loyaltyGuest");
    await orderToComplete(page, "loyaltyGuest");

    await expectFrame(page);
    await expect(success(page).locator("h1")).toHaveText(en.success.thankYou);
    await expect(success(page)).not.toContainText(/unlock|freebies|with points|scan to earn|110 points|for your meal|merch|tuesday/i);
    await expect(fill(page)).toBeHidden();
    await shot(page, "oc-02-guest-loyalty-en");

    // Motion on, halfway through: the digits read 10 (page clock), the fill is read on its own
    // timeline (it started when motion came on), then paused at 10 s for the shot.
    await page.clock.runFor(10_000);
    await expect(countdown(page)).toHaveText(secs(10));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(fill(page)).toBeVisible();
    await settle(page); // the burst, now rendered, has flown; the fill runs on (settle exempts it)
    const run = await fill(page).evaluate((el) => {
      const animations = el.getAnimations();
      const slide = animations[0];
      if (animations.length !== 1 || !(slide instanceof CSSAnimation)) return { animations: animations.length };
      const effect = slide.effect as KeyframeEffect;
      const duration = Number(effect.getComputedTiming().duration);
      slide.pause();
      // Never seek to the very end: a paused run there leaves getAnimations() (and the
      // compositor keeps the frame it paused on).
      const offsetAt = (ms: number) => {
        slide.currentTime = ms;
        return Math.round(new DOMMatrix(getComputedStyle(el).transform).m41) + 0;
      };
      const offsets = [offsetAt(0), offsetAt(duration / 2), offsetAt(duration - 1)];
      return {
        animations: 1,
        name: slide.animationName,
        duration,
        iterations: effect.getComputedTiming().iterations,
        easing: getComputedStyle(el).animationTimingFunction,
        props: [...new Set(effect.getKeyframes().flatMap((frame) => Object.keys(frame)))].filter(
          (key) => !["offset", "easing", "composite", "computedOffset"].includes(key)
        ),
        width: (el as HTMLElement).offsetWidth,
        offsets,
      };
    });
    expect(run, "the fill's one run").toEqual({
      animations: 1,
      name: "tb-countdown-fill",
      duration: 20_000,
      iterations: 1,
      easing: "linear",
      props: ["transform"],
      width: 1030, // the button's 1032 inside its 1 px border
      offsets: [-1030, -515, 0], // from the left edge: wholly left of it, half in, home
    });
    // Paused at 10 s for the shot, to match the digits (its own task: a seek the compositor sees).
    await fill(page).evaluate((el) => {
      el.getAnimations()[0].currentTime = 10_000;
    });
    // tb-surface at 15 % (Tailwind 4 mixes the alpha in oklab): the white label over it keeps large
    // text's 3:1 on tb-orchid (20 % gave 2.93 — contrast.test).
    await expect(fill(page)).toHaveCSS("background-color", /^(rgba\(255, 255, 255, 0\.15\)|oklab\(0\.99\d* \S+ \S+ \/ 0\.15\))$/);
    await shotAsIs(page, "oc-06-countdown-half-en");

    // The exit never waits on the fill: paused, the page clock still ends the screen at 0.
    await page.clock.runFor(10_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/start$/);
  });

  test("LOYALTY, identified (1:3437): ORDER and the number are one 116 px H1 block, centred like the guest's, with no merch photo and no campaign footer; START NEW ORDER counts down", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, "identified");
    await orderToComplete(page, "identified");

    await expectFrame(page);
    const heading = success(page).locator("h1");
    const number = page.getByTestId("order-number");
    await expect(heading).toHaveText(en.success.orderHeading);
    await expect(number).toHaveText(/^#\d{5}$/);
    await expect(heading).toHaveCSS("font-size", "116px");
    await expect(number).toHaveCSS("font-size", "116px");
    const [h1, n] = [await stageBox(heading), await stageBox(number)];
    expect(Math.abs(n.y - (h1.y + h1.height)), "the number sits right under ORDER (no gap)").toBeLessThanOrEqual(1);
    await expect(success(page)).not.toContainText(/checkout next|tuesday drops|merch|scan to earn/i);
    await expect(success(page)).not.toContainText(en.success.thankYou);
    await expect(newOrder(page)).toHaveText(`${en.success.startNewOrder} ${secs(20)}`);
    await shot(page, "oc-03-identified-en");

    // The exit: the identified frame stays as it is until /start replaces it — never the guest frame.
    const committed = await watchUntilGone(page);
    await page.clock.runFor(20_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    expect(await committed(), "Order Complete on its way out (H1: never the emptied store)").toHaveLength(1);
  });

  test("ARABIC guest, loyalty on: the thank-you on ONE line, the Arabic PROCEED, and START NEW ORDER in Arabic counting down in Western digits, read right to left — no English, no raw key", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, "loyaltyGuest", { arabic: true });
    await orderToComplete(page, "loyaltyGuest", { arabic: true });

    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expectFrame(page);
    const heading = success(page).locator("h1");
    await expect(heading).toContainText(ar.success.thankYou);
    expectNear(await stageBox(heading), { height: 44 }, 2, "the Arabic thank-you (one 44 px line)");
    await expect(page.getByTestId("order-success-proceed")).toContainText(ar.success.proceedToCounter);
    await expect(newOrder(page)).toContainText(ar.success.startNewOrder);
    await expect(newOrder(page)).toHaveAccessibleName(new RegExp(ar.success.startNewOrder));
    // The seconds as the number shows them: Western digits, the Arabic unit (each value its own isolate).
    const unit = ar.success.countdown.replace("{{seconds}}", "").trim();
    await expect(countdown(page)).toContainText("20");
    await expect(countdown(page)).toContainText(unit);
    await expect(countdown(page)).not.toContainText(/[\u0660-\u0669]/);
    // One dir=auto leaf: the label and its seconds resolve right to left (the name on the right).
    await expect(countdown(page).locator("xpath=..")).toHaveCSS("direction", "rtl");
    await expect(success(page).getByRole("status")).toHaveText(""); // filled by the first tick
    await shot(page, "oc-04-guest-loyalty-ar");
    await page.clock.runFor(1_000);
    await expect(countdown(page)).toContainText("19");
    await expect(success(page).getByRole("status")).toContainText(ar.success.countdownA11y.split("{{seconds}}")[0].trim());
    await expect(success(page).getByRole("status")).toContainText("19");
    for (const english of [en.success.proceedToCounter, en.success.startNewOrder, secs(19).slice(2), "seconds"]) {
      await expect(success(page)).not.toContainText(english);
    }
  });

  test("ADA guest, loyalty on: no panel and no unlock, no bell; the text block centred in the reach zone, START NEW ORDER counting down at its foot, and nothing of the screen shows above it", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, "loyaltyGuest");
    await orderToComplete(page, "loyaltyGuest", { ada: true });

    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await expect(page.getByTestId("order-success-panel")).toHaveCount(0);
    await expect(page.getByTestId("order-success-unlock")).toHaveCount(0);
    await expect(success(page).getByAltText("Taco Bell")).toHaveCount(0);
    await expect(success(page).locator("img")).toHaveCount(1); // the sheen
    await expect(success(page).getByRole("button")).toHaveCount(1);
    await expect(newOrder(page)).toBeVisible();
    await expect(newOrder(page)).toHaveText(`${en.success.startNewOrder} ${secs(20)}`);
    expectNear(await stageBox(newOrder(page)), { x: 24, y: 1812, width: 1032, height: 84 }, 2, "START NEW ORDER at the zone's foot");

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
