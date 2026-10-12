import {
  CHEESE_BURGER,
  DINE_IN,
  DREAM_BOX,
  EXTRA_PICKLES,
  GREEK_SALAD,
  LARGE_FRIES,
  SIDE_ORDERS,
  SKIP_CRM,
  TORTILLA_SAUCE,
  fixtureJson,
  holdRequests,
  mockKioskBackend,
  type KioskBackendOptions,
} from "./fixtures/backend";
import { settle } from "./fixtures/capture";
import { PIPELINES_URL, PLACE_ORDER_URL, mockCheckoutBackend, type CheckoutMockOptions } from "./fixtures/checkout";
import {
  PNG_1X1,
  PROMPT_AFTER_MS,
  PROMPT_WINDOW_MS,
  expect,
  fakeNow,
  freezeClock,
  test,
  type Locator,
  type Page,
} from "./fixtures/kiosk";
import { EDC_BUSY, PAYTM_EDC_ENTITY, PAYTM_ENDPOINTS, mockPaytmBackend } from "./fixtures/paytm";
import { bootRegisteredToMenu, pickPipelineToMenu, registerToStart, startToSecond, submitLicence } from "./pages/boot";
import { payAtCounter } from "./pages/checkout";
import { addOneTap, openBag, typeDigits } from "./pages/order";

/**
 * Lane motion — the motion contract's §5.3 cases (M0–M13) and lane motion-v2's (M14–M17), the ONE place real motion is proven: the
 * functional suite runs under `reducedMotion: "reduce"` (playwright.config, D-M5), this file under
 * "no-preference" (M9 switches to reduce itself).
 *
 * ── OBSERVING AN ANIMATION ──────────────────────────────────────────────
 * A page entrance is over in ≤ 540 ms, so a trigger runs under CDP slow motion (`slowMotion`: the
 * document timeline at 0.1×) and ONE evaluate reads `document.getAnimations()` straight after it
 * (`animations`). Back at 1×, `settle` (fixtures/capture) waits for the FINITE ones only — an
 * infinite loop never ends (the paytm.spec expectReachable filter). No fixed sleeps: time is the
 * page clock's (M0 / M3 / M10 / M13) or a state poll.
 *
 * ── THE RULES EVERY READING CHECKS ──────────────────────────────────────
 * `animations` asserts contract §4 rule 1 on everything it sees (M12): keyframes move only opacity /
 * transform / translate / scale / rotate. `loops` asserts §4 rule 5 (M8). A CSSAnimation's
 * effect-level easing is always "linear": the spring's curve is read from its computed
 * animation-timing-function.
 */

test.use({ reducedMotion: "no-preference" });

const TAKE_AWAY = { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take Away" };
const COMPOSITED = ["opacity", "transform", "translate", "scale", "rotate"];
const LOOPS = ["tb-marquee", "tb-hourglass", "tb-card-tilt", "tb-attract", "tb-indeterminate"];
const SPRING_CARD = '[data-testid="product-added-modal"] > div.tb-modal-spring';
/** Figma white-button pressed fill (tb-lilac #F3D9FF). */
const LILAC = "rgb(243, 217, 255)";
/** Figma Primary pressed fill (tb-purple-vibrant #9A23F8). */
const VIBRANT = "rgb(154, 35, 248)";
const MEDIA_ORIGIN = "https://splash-media.e2e.test";
/** The burger's "Choose From Extra" group (Extra Pickles). */
const EXTRAS_GROUP = `${CHEESE_BURGER}_1573980469_addons`;

/** The house mock order: the kiosk backend (its catch-all first), then checkout's edges. PAY → /payment. */
async function mockBackend(page: Page, opts: KioskBackendOptions = {}, checkout: CheckoutMockOptions = {}) {
  await mockKioskBackend(page, { ...opts, settings: { ...SKIP_CRM, ...opts.settings } });
  await mockCheckoutBackend(page, checkout);
}

/** slim-menu with the Cheese Burger recommending three sellable items: the full-height added card (Figma 1:4589). */
function menuWithRecommendations(): unknown {
  const menu: unknown = fixtureJson("slim-menu.json");
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const entity = node as Record<string, unknown>;
    if (entity.id === CHEESE_BURGER) entity.recommendedItems = [GREEK_SALAD, LARGE_FRIES, TORTILLA_SAUCE];
    Object.values(entity).forEach(walk);
  };
  walk(menu);
  return menu;
}

/** slim-menu with the burger's Extra group (Extra Pickles) required: ADD TO BAG first meets an unfinished group. */
function menuWithRequiredExtras(): unknown {
  const menu = fixtureJson("slim-menu.json") as { modifiers: { _id: string; min: number }[] };
  for (const group of menu.modifiers) if (group._id === EXTRAS_GROUP) group.min = 1;
  return menu;
}

/** CDP slow motion (contract §5.3): returns a setter for the document timeline's rate (0.1 = 10× slower, 0 = stopped). */
async function slowMotion(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  return async (playbackRate: number) => {
    await cdp.send("Animation.setPlaybackRate", { playbackRate });
  };
}

/**
 * Under 0.1× playback, `go` lands on `screen` FORWARD and its content plays the §2.7 block map: `blocks`
 * tb-enter animations, staggered 0, 40, 80… ms, each from 40 px to the right. `also` reads more while
 * the timeline is still slow; the rate is back at 1× after.
 */
async function arrives(
  page: Page,
  rate: (playbackRate: number) => Promise<void>,
  screen: string,
  blocks: number,
  go: () => Promise<void>,
  also?: () => Promise<void>
) {
  await rate(0.1);
  await go();
  await expect(page.getByTestId(screen)).toHaveAttribute("data-enter", "fwd", { timeout: 20_000 });
  const entering = named(await animations(page, `[data-testid="${screen}"]`), "tb-enter");
  expect(
    entering.map((a) => [a.delay, a.from]).sort(([x], [y]) => Number(x) - Number(y)),
    `${screen}: its ${blocks} content block(s) enter in order from the right`
  ).toEqual(Array.from({ length: blocks }, (_, i) => [i * 40, "translateX(40px)"]));
  await also?.();
  await rate(1);
}

interface Seen {
  name: string;
  kind: string;
  /** The nearest data-testid at or above the animated element. */
  on: string;
  tag: string;
  cls: string;
  duration: number;
  delay: number;
  end: number;
  iterations: number;
  state: string;
  props: string[];
  /** The first keyframe's transform (the entrance's start). */
  from: string;
  /** A <button> at, above or below the animated element. */
  button: boolean;
}

/** Every animation and transition under `scope`, read in ONE evaluate; checks §4 rule 1 on each (M12). */
async function animations(page: Page, scope = "html"): Promise<Seen[]> {
  const seen = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const bookkeeping = ["offset", "easing", "composite", "computedOffset"];
    return document.getAnimations().flatMap((animation) => {
      const effect = animation.effect as KeyframeEffect | null;
      const target = effect?.target ?? null;
      if (!effect || !target || !root?.contains(target)) return [];
      const timing = effect.getComputedTiming();
      const keyframes = effect.getKeyframes();
      const name =
        animation instanceof CSSAnimation
          ? animation.animationName
          : animation instanceof CSSTransition
            ? animation.transitionProperty
            : "script";
      return [
        {
          name,
          kind: animation.constructor.name,
          on: target.closest("[data-testid]")?.getAttribute("data-testid") ?? target.tagName,
          tag: target.tagName,
          cls: target.getAttribute("class") ?? "",
          duration: Number(timing.duration),
          delay: Number(timing.delay),
          end: Number(timing.endTime),
          iterations: Number(timing.iterations),
          state: animation.playState,
          props: [...new Set(keyframes.flatMap((frame) => Object.keys(frame)))].filter(
            (key) => !bookkeeping.includes(key)
          ),
          from: String(keyframes[0]?.transform ?? ""),
          button: target.closest("button") !== null || target.querySelector("button") !== null,
        },
      ];
    });
  }, scope);
  for (const a of seen) {
    expect(
      a.props.filter((prop) => !COMPOSITED.includes(prop)),
      `M12: ${a.name} on ${a.on} animates composited properties only`
    ).toEqual([]);
  }
  return seen;
}

const named = (list: Seen[], name: string) => list.filter((a) => a.name === name);

/** M8: every infinite animation is allow-listed and none moves on or around a tap target (tb-attract only fades). */
async function loops(page: Page): Promise<string[]> {
  const infinite = (await animations(page)).filter((a) => a.iterations === Infinity);
  for (const a of infinite) {
    expect(LOOPS, `M8: ${a.name} on ${a.on} is an allow-listed loop`).toContain(a.name);
    if (a.name === "tb-attract") expect(a.props, "M8: the loop inside a button fades only").toEqual(["opacity"]);
    else expect(a.button, `M8: ${a.name} on ${a.on} has no button ancestor or descendant`).toBe(false);
  }
  return infinite.map((a) => a.name);
}

/**
 * motion-v2 MV4, read under slow motion right after the overlay mounted: its root's own tb-fade-in waits 300 ms
 * (the backwards fill holds opacity 0 — a fast wait never flashes), then runs 200 ms.
 */
async function expectLateReveal(page: Page, testId: string) {
  const reveal = named(await animations(page, `[data-testid="${testId}"]`), "tb-fade-in").filter(
    (a) => a.on === testId && a.cls.split(" ").includes("tb-reveal-late")
  );
  expect(
    reveal.map(({ delay, duration }) => ({ delay, duration })),
    `${testId} reveals late`
  ).toEqual([{ delay: 300, duration: 200 }]);
  expect(
    await page.getByTestId(testId).evaluate((el) => getComputedStyle(el).opacity),
    `${testId} is invisible through the delay`
  ).toBe("0");
}

/**
 * motion-v2 review F1, read under slow motion right after a dialog's button: a status layer that REPLACES the dialog
 * never reveals late (the dialog's scrim unmounts in the same commit) — no tb-fade-in on its root, on screen at once.
 */
async function expectAtOnce(page: Page, testId: string) {
  await expect(page.getByTestId(testId)).toBeAttached();
  const reveal = named(await animations(page, `[data-testid="${testId}"]`), "tb-fade-in").filter((a) => a.on === testId);
  expect(reveal.map(({ delay, duration }) => ({ delay, duration })), `${testId}: no late reveal`).toEqual([]);
  expect(
    await page.getByTestId(testId).evaluate((el) => getComputedStyle(el).opacity),
    `${testId} is on screen at once`
  ).toBe("1");
}

/** A loop's period and its angle (whole degrees, 0–359) at fractions of it: paused, seeked, read, resumed. */
const loopAngles = (page: Page, name: string, at: number[]) =>
  page.evaluate(
    ([loop, fractions]) => {
      const animation = document
        .getAnimations()
        .find((a) => a instanceof CSSAnimation && a.animationName === loop);
      const target = (animation?.effect as KeyframeEffect | null)?.target;
      if (!animation || !target) throw new Error(`no ${loop}`);
      const period = Number(animation.effect?.getComputedTiming().duration);
      animation.pause();
      const angles = fractions.map((fraction) => {
        animation.currentTime = fraction * period;
        const m = new DOMMatrix(getComputedStyle(target).transform);
        return (Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI) + 360) % 360;
      });
      animation.play();
      return { period, angles };
    },
    [name, at] as const
  );

/** A same-element handle comparison: a re-keyed node is a NEW node. */
async function replaced(page: Page, target: Locator, change: () => Promise<void>) {
  const before = await target.elementHandle();
  await change();
  const after = await target.elementHandle();
  return page.evaluate(([a, b]) => a !== b, [before, after] as const);
}

/** Press and HOLD at a point of `target` (its centre by default); the caller releases. */
async function hold(page: Page, target: Locator, offsetY?: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to press");
  await page.mouse.move(box.x + box.width / 2, box.y + (offsetY ?? box.height / 2));
  await page.mouse.down();
}

/** A held control: pressed (:active), its computed scale, and whether a scale transition runs on it. */
const pressed = (target: Locator) =>
  target.evaluate((el) => ({
    active: el.matches(":active"),
    scale: getComputedStyle(el).scale,
    squeezing: el.getAnimations().some((a) => a instanceof CSSTransition && a.transitionProperty === "scale"),
  }));

/** The added card against the modal root it centres in (so ADA's zone needs no constants). */
const springBox = (page: Page) =>
  page.locator(SPRING_CARD).evaluate((card) => {
    const c = card.getBoundingClientRect();
    const r = (card.parentElement ?? card).getBoundingClientRect();
    return {
      dx: c.x + c.width / 2 - (r.x + r.width / 2),
      dy: c.y + c.height / 2 - (r.y + r.height / 2),
      scale: c.width / (card as HTMLElement).offsetWidth,
    };
  });

/** Menu → the burger's PDP (prices loaded) → ADD TO BAG: the product-added modal opens over the menu. */
async function addBurgerFromPdp(page: Page) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£");
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("product-added-modal")).toBeVisible({ timeout: 10_000 });
}

/** Tap a rail item INSIDE one task and read the menu pane: a smooth scroll has not moved yet, a jump has landed. */
const railTap = (page: Page, id: string) =>
  page.getByTestId(`rail-${id}`).evaluate((rail, sectionId) => {
    const section = document.querySelector<HTMLElement>(`[data-testid="section-${sectionId}"]`);
    const pane = section?.parentElement;
    if (!section || !pane) throw new Error(`no section-${sectionId} in a pane`);
    const before = pane.scrollTop;
    (rail as HTMLElement).click();
    const target = Math.min(section.offsetTop - 24, pane.scrollHeight - pane.clientHeight);
    return { before, after: pane.scrollTop, target };
  }, id);

/** M9: everything that animates or transitions ends in ≤ 1 ms, at once, in one pass — live and as computed everywhere. */
async function expectReduced(page: Page) {
  for (const a of await animations(page)) {
    expect({ on: a.on, name: a.name, upTo1ms: a.duration <= 1, delay: a.delay, iterations: a.iterations }).toEqual({
      on: a.on,
      name: a.name,
      upTo1ms: true,
      delay: 0,
      iterations: 1,
    });
  }
  const computed = await page.evaluate(() => {
    const seconds = (list: string) =>
      list.split(",").map((v) => Number.parseFloat(v) * (v.trim().endsWith("ms") ? 0.001 : 1));
    return [...document.querySelectorAll("*")].flatMap((el) => {
      const s = getComputedStyle(el);
      const bad = [
        seconds(s.animationDuration).some((d) => d > 0.001) && "animation-duration",
        seconds(s.animationDelay).some((d) => d !== 0) && "animation-delay",
        s.animationIterationCount.split(",").some((n) => n.trim() !== "1") && "animation-iteration-count",
        // 0 s, never 1 ms: transition-property defaults to `all`, so 1 ms would make every change a one-frame transition.
        seconds(s.transitionDuration).some((d) => d !== 0) && "transition-duration",
        seconds(s.transitionDelay).some((d) => d !== 0) && "transition-delay",
      ].filter(Boolean);
      return bad.length ? [`${el.tagName}.${(el.getAttribute("class") ?? "").slice(0, 48)}: ${bad.join(", ")}`] : [];
    });
  });
  expect(computed, "M9: every element computes animations ≤ 1 ms and transitions 0 s, no delay, one pass").toEqual([]);
}

/**
 * M9: a 1 ms animation still PAINTS its from-frame once, so under reduce every full-opacity from-frame must be
 * the end state. The spring's is read on the live card; the selection bump's and the carousel shift's on a
 * throwaway element carrying the app's class (same stylesheet, same media).
 */
const firstFrames = (page: Page) =>
  page.evaluate((card) => {
    const atStart = (el: Element, name: string) => {
      const animation = el
        .getAnimations()
        .find((a) => a instanceof CSSAnimation && a.animationName === name);
      if (!animation) throw new Error(`no ${name}`);
      animation.pause();
      animation.currentTime = 0;
      const frame = getComputedStyle(el).transform;
      animation.finish();
      return frame;
    };
    const spring = document.querySelector(card);
    if (!spring) throw new Error("no added card");
    const throwaway = (cls: string) => {
      const el = document.createElement("div");
      el.className = cls;
      el.setAttribute("aria-pressed", "true");
      document.body.append(el);
      const frame = atStart(el, cls);
      el.remove();
      return frame;
    };
    const springFrame = new DOMMatrix(atStart(spring, "tb-modal-spring"));
    return {
      springScale: Math.round(Math.hypot(springFrame.a, springFrame.b) * 1000) / 1000,
      select: throwaway("tb-select"),
      carousel: throwaway("tb-carousel-in"),
    };
  }, SPRING_CARD);

/** Every computed will-change that is not `auto` (elements and their ::before / ::after). */
const willChange = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("*")].flatMap((el) =>
      [null, "::before", "::after"].flatMap((pseudo) => {
        const value = getComputedStyle(el, pseudo).willChange;
        return value === "auto" ? [] : [`${el.tagName}${pseudo ?? ""}.${(el.getAttribute("class") ?? "").slice(0, 48)}: ${value}`];
      })
    )
  );

/** Every @keyframes rule the document's stylesheets carry → the properties its keyframes declare. */
const keyframeProperties = (page: Page) =>
  page.evaluate(() => {
    const found: Record<string, string[]> = {};
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSKeyframesRule) {
          const props = new Set<string>();
          for (const frame of Array.from(rule.cssRules) as CSSKeyframeRule[]) {
            for (let i = 0; i < frame.style.length; i += 1) props.add(frame.style[i]);
          }
          found[rule.name] = [...props];
        } else if ("cssRules" in rule) {
          walk((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules);
      } catch {
        // A cross-origin sheet hides its rules; the app's own CSS is same-origin.
      }
    }
    return found;
  });

/** Each edge of `box` inside `zone` (half a pixel of rounding). */
function expectInside(
  box: { top: number; bottom: number; left: number; right: number },
  zone: { x: number; y: number; width: number; height: number },
  what: string
) {
  expect(box.top, `${what}: top`).toBeGreaterThanOrEqual(zone.y - 0.5);
  expect(box.bottom, `${what}: bottom`).toBeLessThanOrEqual(zone.y + zone.height + 0.5);
  expect(box.left, `${what}: left`).toBeGreaterThanOrEqual(zone.x - 0.5);
  expect(box.right, `${what}: right`).toBeLessThanOrEqual(zone.x + zone.width + 0.5);
}

test.describe("motion (contract §5.3, no-preference)", () => {
  test("M0 WALK: splash → /second → menu → PDP → ADD → bag → PAY AT COUNTER → receipt → Order Complete, then the 20 s exit and the next guest — every arrival plays its §2.7 blocks forward and every control takes its tap with no test-side waits; Order Complete pops its number and bursts once; a reload replays none of it", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install(); // the 3 s PAY AT COUNTER window and Order Complete's 20 s exit are stepped, never slept through
    await mockBackend(page);
    await registerToStart(page);
    const rate = await slowMotion(page);
    await arrives(page, rate, "second-screen", 2, () => page.getByTestId("start-screen").click()); // title + 1 card
    await arrives(page, rate, "menu-screen", 1, () => page.getByTestId("pipeline-p1").click());
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await arrives(page, rate, "customization-screen", 1, () => burger.click());
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
    await page.getByTestId("pdp-add-to-bag").click();
    await page.getByTestId("added-continue").click();
    await openBag(page);
    await arrives(page, rate, "payment-screen", 3, () => page.getByTestId("bag-pay").click());
    await arrives(page, rate, "receipt-screen", 2, () => payAtCounter(page));
    const success = page.getByTestId("order-success");
    await arrives(page, rate, "order-success", 2, () => page.getByTestId("receipt-none").click(), async () => {
      const pops = named(await animations(page, '[data-testid="order-success"]'), "tb-pop-in");
      expect(pops.map((a) => a.on), "only the order number pops (loyalty off: no unlock pitch)").toEqual(["order-number"]);
    });
    // The in-session arrival celebrates once (a reload never does: the burst needs data-enter).
    await expect(page.getByTestId("order-number").locator(".tb-confetti-piece")).toHaveCount(28);

    // Its 20 s timer hands the next customer the splash: a NEW trail, so Order Complete arrives fwd again.
    await page.clock.runFor(20_000);
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toHaveAttribute("data-enter", "fwd");
    await pickPipelineToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);
    await page.getByTestId("bag-pay").click();
    await payAtCounter(page);
    // The 2nd customer's Order Complete arrives forward.
    await arrives(page, rate, "order-success", 2, () => page.getByTestId("receipt-none").click());

    // A reload (POP) on Order Complete replays nothing: no entrance, no burst.
    await page.reload();
    await expect(success).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-enter]")).toHaveCount(0);
    await expect(success.locator(".tb-confetti-piece")).toHaveCount(0);
  });

  test("M1 FORWARD: /start → /second — the title and the cards slide in from the right (260 ms, 40 ms stagger, ≤ 540 ms, opacity + transform only) and rest untransformed", async ({
    page,
  }) => {
    await mockBackend(page);
    // Two order types over the shared mock's one (newest route wins); checkout's mock routes getPipelines only with a tabType.
    await page.route(PIPELINES_URL, (route) => route.fulfill({ json: [DINE_IN, TAKE_AWAY] }));
    await registerToStart(page);
    const rate = await slowMotion(page);
    await rate(0.1);
    await page.getByTestId("start-screen").click();
    const second = page.getByTestId("second-screen");
    await expect(second).toHaveAttribute("data-enter", "fwd");
    const enter = named(await animations(page, '[data-testid="second-screen"]'), "tb-enter");
    expect(enter.length, "the title + two order-type cards").toBeGreaterThanOrEqual(2);
    for (const a of enter) {
      expect(a.iterations, `${a.on}: finite`).toBe(1);
      expect(a.duration, `${a.on}: 260 ms`).toBe(260);
      expect(a.delay, `${a.on}: stagger ≤ 7 × 40 ms`).toBeLessThanOrEqual(280);
      expect(a.end, `${a.on}: done by 540 ms`).toBeLessThanOrEqual(540);
      expect([...a.props].sort(), `${a.on}: keyframes`).toEqual(["opacity", "transform"]);
      expect(a.from, `${a.on}: from the right`).toBe("translateX(40px)");
    }
    // Title first (--i 0), then each card at index + 1.
    expect(enter.map((a) => a.delay).sort((x, y) => x - y)).toEqual([0, 40, 80]);

    await rate(1);
    await settle(page);
    const rest = await second
      .locator(".tb-enter")
      .evaluateAll((blocks) => blocks.map((el) => [getComputedStyle(el).transform, getComputedStyle(el).opacity]));
    expect(rest).toHaveLength(enter.length);
    for (const block of rest) expect(block, "at rest: untransformed, opaque").toEqual(["none", "1"]);
  });

  test("M2 BACK + QUIET: menu → PDP enters fwd and BACK returns the menu from the left; ADD TO BAG leaves the menu still under the Figma spring (958 ms, linear() Bouncy), which comes to rest centred", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { menu: menuWithRecommendations() });
    await bootRegisteredToMenu(page);
    const rate = await slowMotion(page);
    const menu = page.getByTestId("menu-screen");

    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toHaveAttribute("data-enter", "fwd");
    await settle(page);
    await rate(0.1);
    await page.getByTestId("pdp-back").click();
    await expect(menu).toHaveAttribute("data-enter", "back");
    const back = named(await animations(page, '[data-testid="menu-screen"]'), "tb-enter");
    expect(back.map((a) => a.from), "the rail-and-pane row returns from the left").toEqual(["translateX(-40px)"]);
    await rate(1);
    await settle(page);

    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£");
    await settle(page);
    await rate(0.1);
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible({ timeout: 10_000 });
    // Figma 1:5502: the menu, rail and CTA bar stay still under the card — Menu mounts quiet.
    await expect(menu).not.toHaveAttribute("data-enter");
    expect(named(await animations(page, '[data-testid="menu-screen"]'), "tb-enter")).toEqual([]);
    const spring = named(await animations(page, SPRING_CARD), "tb-modal-spring");
    expect(spring).toHaveLength(1);
    expect(spring[0]).toMatchObject({ duration: 958, iterations: 1, delay: 0 });
    expect(spring[0].from, "springs open from 301.683 / 680").toContain("scale(0.4437)");
    expect(
      await page.locator(SPRING_CARD).evaluate((card) => getComputedStyle(card).animationTimingFunction),
      "the Figma Bouncy curve"
    ).toMatch(/^linear\(/);

    await rate(1);
    await expect
      .poll(() => page.locator(SPRING_CARD).evaluate((card) => card.getAnimations().map((a) => a.playState).join()))
      .toBe("finished");
    const rest = await springBox(page);
    expect(Math.abs(rest.dx), "centred: x").toBeLessThanOrEqual(1);
    expect(Math.abs(rest.dy), "centred: y").toBeLessThanOrEqual(1);
    expect(rest.scale, "full size").toBeCloseTo(1, 2);
  });

  test("M3 NEVER ANIMATES: a reload on /menu (POP) and an empty-cart REPLACE guard (/payment → /menu) carry no data-enter, so nothing enters; after a reload on /cart the restored rows never rise", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page);
    await bootRegisteredToMenu(page);
    // The in-session arrival does enter (the control).
    await expect(page.getByTestId("menu-screen")).toHaveAttribute("data-enter", "fwd");

    await page.reload();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-enter]")).toHaveCount(0);
    expect(named(await animations(page), "tb-enter")).toEqual([]);

    // PaymentSelection's empty-cart guard: navigate("/menu", { replace: true }).
    await page.goto("/payment");
    await expect(page).toHaveURL(/\/menu$/, { timeout: 15_000 });
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-enter]")).toHaveCount(0);
    expect(named(await animations(page), "tb-enter")).toEqual([]);

    // A reload on /cart: the rows the Dexie restore lands arrive with the panel — none rises as if added.
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);
    await settle(page);
    await page.reload();
    const rows = page.locator('[data-testid^="bag-row-"]');
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    await expect(rows.first(), "a restored row never rises").not.toHaveClass(/\btb-rise\b/);
    expect(named(await animations(page), "tb-rise")).toEqual([]);
    await expect(page.locator("[data-enter]")).toHaveCount(0);
    // The fresh menu's photos land before teardown: one still in its route at context close fails
    // the harness's fulfil ("Route is already handled!").
    await settle(page);
  });

  test("M3 NEVER ANIMATES: the idle timeout lands on a still splash — no data-enter, no carousel shift at mount (the shift waits for an advance)", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install(); // before the first goto: the idle and dwell timers are fake
    await mockBackend(page);
    // A two-slide splash (the 1:2203 carousel): newer than the catch-all, stored by the boot.
    const slide = (name: string) => ({ url: `${MEDIA_ORIGIN}/${name}.png`, media_type: "image", iteration_time: "5", text: "", items: [] });
    await page.route("**/api/cx/kiosk/getMedia", (route) =>
      route.fulfill({ json: { media: [{ key: "home_screen", ...slide("a"), extra_images: [slide("b")] }] } })
    );
    await page.route(`${MEDIA_ORIGIN}/**`, (route) => route.fulfill({ body: PNG_1X1, contentType: "image/png" }));
    await registerToStart(page);
    const splash = page.getByTestId("start-screen");
    await expect(splash.locator(`img[src="${MEDIA_ORIGIN}/b.png"]`), "the carousel: B peeks on both sides").toHaveCount(2);
    await expect(splash.locator(".tb-carousel-in")).toHaveCount(0);

    await startToSecond(page);
    await pickPipelineToMenu(page);
    // Idle in two jumps (idle.spec TIME): the prompt at 100 s, the session ends at 120 s.
    await page.clock.fastForward(PROMPT_AFTER_MS);
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.clock.fastForward(PROMPT_WINDOW_MS);
    await expect(splash).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/start$/);
    await expect(splash.locator(`img[src="${MEDIA_ORIGIN}/b.png"]`)).toHaveCount(2);
    await expect(page.locator("[data-enter]")).toHaveCount(0);
    await expect(splash.locator(".tb-carousel-in")).toHaveCount(0);
    expect(named(await animations(page), "tb-carousel-in")).toEqual([]);

    // Control: an advance DOES shift the three remounted cards in.
    await expect
      .poll(
        async () => {
          await page.clock.runFor(1_000);
          return splash.locator(".tb-carousel-in").count();
        },
        { timeout: 20_000, intervals: [50] }
      )
      .toBe(3);
  });

  test("M4 TAPS: the /second entrance paused at 50 % — the card mid-flight still takes the tap and /menu loads", async ({
    page,
  }) => {
    await mockBackend(page);
    await registerToStart(page);
    const rate = await slowMotion(page);
    await rate(0.1);
    await page.getByTestId("start-screen").click();
    const second = page.getByTestId("second-screen");
    await expect(second).toHaveAttribute("data-enter", "fwd");
    const paused = await second.evaluate((root) =>
      root
        .getAnimations({ subtree: true })
        .filter((a) => a instanceof CSSAnimation && a.animationName === "tb-enter")
        .map((a) => {
          const end = Number(a.effect?.getComputedTiming().endTime);
          a.pause();
          a.currentTime = end / 2;
          return end;
        })
    );
    expect(paused.length).toBeGreaterThanOrEqual(2);
    await rate(1);
    const card = page.getByTestId("pipeline-p1");
    const midFlight = await card.evaluate((el) => [Number(getComputedStyle(el).opacity), getComputedStyle(el).transform] as const);
    expect(midFlight[0], "half faded in").toBeGreaterThan(0);
    expect(midFlight[0], "half faded in").toBeLessThan(1);
    expect(midFlight[1], "still sliding").not.toBe("none");
    await card.click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  });

  test("M4 TAPS: at 0.1× playback a mouse tap at the card's LIVE centre, mid-entrance, navigates", async ({ page }) => {
    await mockBackend(page);
    await registerToStart(page);
    const rate = await slowMotion(page);
    await rate(0.1);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toHaveAttribute("data-enter", "fwd");
    const live = await page.getByTestId("pipeline-p1").evaluate((el) => {
      const entering = el
        .getAnimations()
        .some((a) => a instanceof CSSAnimation && a.animationName === "tb-enter" && a.playState === "running");
      const r = el.getBoundingClientRect();
      return { entering, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    expect(live.entering, "the card is still entering").toBe(true);
    await page.mouse.click(live.x, live.y);
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await rate(1);
  });

  test("M5 SHEETS: the bag panel and the language panel rise (tb-sheet-enter, 240 ms, finite); their scrims never animate; no inline <style> keyframes", async ({
    page,
  }) => {
    await mockBackend(page);
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);
    const sheet = page.getByTestId("bag-sheet");
    // `both` fill: the panel's entrance stays listed (finished) once over — nothing to race.
    const rise = named(await animations(page, '[data-testid="bag-sheet"]'), "tb-sheet-enter");
    expect(rise).toHaveLength(1);
    expect(rise[0]).toMatchObject({ duration: 240, delay: 0, iterations: 1 });
    expect(rise[0].cls).toContain("tb-sheet-enter");
    const scrim = sheet.locator(":scope > button");
    expect(await scrim.evaluate((el) => [el.matches(":empty"), el.getAnimations().length])).toEqual([true, 0]);
    await expect(sheet.locator("style")).toHaveCount(0);

    // The language sheet lost its 480 px slide and its scrim fade: the same panel rise over a still scrim.
    await page.getByTestId("bag-close").click();
    await expect(sheet).toHaveCount(0);
    await page.getByTestId("footer-language").click();
    const language = page.getByTestId("language-sheet");
    await expect(language).toBeVisible();
    const lift = named(await animations(page, '[data-testid="language-sheet"]'), "tb-sheet-enter");
    expect(lift).toHaveLength(1);
    expect(lift[0]).toMatchObject({ duration: 240, delay: 0, iterations: 1, from: "translateY(80px)" });
    expect(await language.locator(":scope > button").evaluate((el) => el.getAnimations().length), "a still scrim").toBe(0);
    await expect(language.locator("style")).toHaveCount(0);
  });

  test("M6 SELECTION + COUNTS (menu): a rail tap bumps the item it selects (tb-select, aria-current) and scrolls smoothly; a quick add swaps in a NEW bag mark that bumps", async ({
    page,
  }) => {
    await mockBackend(page);
    await bootRegisteredToMenu(page);
    await settle(page);
    const rate = await slowMotion(page);
    const rail = page.getByTestId(`rail-${SIDE_ORDERS}`);
    await expect(rail).not.toHaveAttribute("aria-current", "true");

    await rate(0.1);
    const tap = await railTap(page, SIDE_ORDERS);
    await expect(rail).toHaveAttribute("aria-current", "true");
    const select = named(await animations(page, `[data-testid="rail-${SIDE_ORDERS}"]`), "tb-select");
    expect(select).toHaveLength(1);
    expect(select[0]).toMatchObject({ duration: 250, iterations: 1, tag: "BUTTON" });
    expect(await page.locator('[data-testid^="rail-"][aria-current="true"]').count(), "one current item").toBe(1);
    // No-preference: scrollBehavior() is smooth — nothing moved inside the tapping task, the pane gets there after.
    expect(tap.after, "smooth: not in the same frame").toBe(tap.before);
    expect(Math.abs(tap.target - tap.before), "the tap has somewhere to go").toBeGreaterThan(1);
    await expect.poll(() => railTap(page, SIDE_ORDERS).then((t) => Math.abs(t.before - t.target))).toBeLessThanOrEqual(1);
    await rate(1);
    await settle(page);

    const mark = page.locator('[data-testid="cta-view-bag"] img');
    const fresh = await replaced(page, mark, async () => {
      await rate(0.1);
      await page.getByTestId(`quick-add-${GREEK_SALAD}`).click();
      await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    });
    expect(fresh, "the bag mark is re-keyed: a NEW node").toBe(true);
    const bump = named(await animations(page, '[data-testid="cta-view-bag"]'), "tb-bump");
    expect(bump).toHaveLength(1);
    expect(bump[0]).toMatchObject({ duration: 250, iterations: 1, tag: "IMG" });
    await rate(1);
  });

  test("M6 SELECTION + COUNTS (PDP + bag): an option card bumps and its check pops; the bag's + bumps MY BAG (n); a row added from the bag rail rises while the row present at open stays still", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page);
    await bootRegisteredToMenu(page);
    const rate = await slowMotion(page);

    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£");
    await settle(page);
    const option = page.getByTestId(`pdp-option-${EXTRA_PICKLES}`);
    await option.scrollIntoViewIfNeeded();
    await rate(0.1);
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    const picked = await animations(page, `[data-testid="pdp-option-${EXTRA_PICKLES}"]`);
    expect(named(picked, "tb-select").map((a) => a.tag), "the card bumps").toEqual(["BUTTON"]);
    expect(named(picked, "tb-pop-in").map((a) => a.tag), "its check pops in").toEqual(["IMG"]);
    await rate(1);
    await settle(page);
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("added-continue").click();
    await openBag(page);

    const count = page.getByTestId("bag-sheet").locator("p.tb-display > span.tb-bump");
    await expect(count).toHaveText("1");
    await settle(page);
    const bumped = await replaced(page, count, async () => {
      await rate(0.1);
      await page.locator('[data-testid^="bag-inc-"]').first().click();
      await expect(count).toHaveText("2");
    });
    expect(bumped, "MY BAG (n) is re-keyed: a NEW node").toBe(true);
    expect(named(await animations(page, '[data-testid="bag-sheet"] p.tb-display'), "tb-bump")).toHaveLength(1);
    await rate(1);
    await settle(page);

    const rows = page.locator('[data-testid^="bag-row-"]');
    const burgerRow = page.locator(`[data-testid^="bag-row-"][data-testid$="_${CHEESE_BURGER}"]`);
    const saladRow = page.locator(`[data-testid^="bag-row-"][data-testid$="_${GREEK_SALAD}"]`);
    await expect(rows).toHaveCount(1);
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).scrollIntoViewIfNeeded();
    await rate(0.1);
    await page.getByTestId(`bag-rail-item-${GREEK_SALAD}`).click();
    await expect(rows).toHaveCount(2);
    await expect(saladRow).toHaveClass(/\btb-rise\b/);
    await expect(burgerRow).not.toHaveClass(/\btb-rise\b/);
    const risen = named(await animations(page, '[data-testid="bag-sheet"]'), "tb-rise");
    expect(risen.map((a) => a.on), "only the added row rises").toEqual([await saladRow.getAttribute("data-testid")]);
    expect(risen[0]).toMatchObject({ duration: 260, iterations: 1 });
    await rate(1);
  });

  test("M6 ERRORS: ADD TO BAG over an unfinished required group shakes the group beside its ring; every refused tent key re-shakes the range banner — a NEW node per refusal, running tb-shake", async ({
    page,
  }) => {
    test.slow();
    // The burger's Extra group required; a table tab: PAY → /tent (range 1..99).
    await mockBackend(page, { menu: menuWithRequiredExtras() }, { tabType: "table" });
    await bootRegisteredToMenu(page);
    const rate = await slowMotion(page);
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await burger.click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£");
    await settle(page);
    const group = page.getByTestId(`pdp-group-${EXTRAS_GROUP}`);
    await rate(0.1);
    await page.getByTestId("pdp-add-to-bag").click(); // refused: the group is unfinished
    await expect(group).toHaveClass(/\bring-red-500\b/);
    const groupShake = named(await animations(page, `[data-testid="pdp-group-${EXTRAS_GROUP}"]`), "tb-shake");
    expect(groupShake.map((a) => a.on), "the errored group shakes").toEqual([`pdp-group-${EXTRAS_GROUP}`]);
    expect(groupShake[0]).toMatchObject({ duration: 300, iterations: 1 });
    await rate(1);
    await page.getByTestId("pdp-incomplete-gotit").click(); // the refusal's warning
    await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
    await page.getByTestId(`pdp-option-${EXTRA_PICKLES}`).click(); // finishes the group
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("product-added-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("added-continue").click();
    await openBag(page);
    await arrives(page, rate, "tent-screen", 3, () => page.getByTestId("bag-pay").click());
    await typeDigits(page, "99");
    await expect(page.getByTestId("tent-display")).toHaveText("99");

    const banner = page.getByTestId("tent-error");
    await page.getByTestId("numpad-key-9").click(); // refused: above the ceiling
    await expect(banner).toBeVisible();
    await settle(page);
    const again = await replaced(page, banner, async () => {
      await rate(0.1);
      await page.getByTestId("numpad-key-9").click(); // refused again
      await expect(banner).toHaveCount(1);
    });
    expect(again, "the banner remounts per refusal").toBe(true);
    const shake = named(await animations(page, '[data-testid="tent-error"]'), "tb-shake");
    expect(shake).toHaveLength(1);
    expect(shake[0]).toMatchObject({ duration: 300, iterations: 1 });
    await expect(page.getByTestId("tent-display")).toHaveText("99");
    await rate(1);
  });

  test("M7 PRESS: a held button squeezes to .97 and springs back; a held card squeezes while its overlay keeps the hit area whole, and the tap still lands; the full-surface splash and an :empty scrim never squeeze; Figma's pressed fills — the /second card and the added modal's quick-add go lilac (never 15 % white), a purple primary goes vibrant", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { menu: menuWithRecommendations() });
    await registerToStart(page);

    const splash = page.getByTestId("start-screen");
    await hold(page, splash);
    expect(await pressed(splash), "tb-no-press").toEqual({ active: true, scale: "none", squeezing: false });
    await page.mouse.up(); // released on the splash: the tap starts the order
    await expect(page.getByTestId("second-screen")).toBeVisible();
    await settle(page);

    const card = page.getByTestId("pipeline-p1");
    await hold(page, card);
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).backgroundColor), { message: "border-tb-surface + bg-tb-surface: lilac wins" }).toBe(LILAC);
    await page.mouse.up();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await settle(page);

    const viewBag = page.getByTestId("cta-view-bag");
    await hold(page, viewBag);
    await expect.poll(() => viewBag.evaluate((el) => getComputedStyle(el).scale)).toBe("0.97");
    // motion-v2 MV1 mirrors TOUCH presses only: a mouse's :active is already instant.
    await expect(viewBag).not.toHaveAttribute("data-pressed");
    // Released off the control (on the CTA bar's total): the press ends, no tap is taken.
    const total = await page.getByTestId("cta-total").boundingBox();
    if (!total) throw new Error("no cta-total");
    await page.mouse.move(total.x + total.width / 2, total.y + total.height / 2);
    await page.mouse.up();
    await expect.poll(() => viewBag.evaluate((el) => getComputedStyle(el).scale)).toBe("none");
    await expect(page).toHaveURL(/\/menu$/);

    // An overlay-button card (tb-press-card): the card squeezes, its empty overlay counter-scales.
    const salad = page.getByTestId(`item-${GREEK_SALAD}`);
    await salad.scrollIntoViewIfNeeded();
    await hold(page, salad);
    const scales = () =>
      salad.evaluate((el) => {
        const card = getComputedStyle(el).scale;
        const overlay = getComputedStyle(el.querySelector(":scope > button:empty") ?? el).scale;
        return { card, hitArea: Math.round(Number(card) * Number(overlay) * 1000) / 1000 };
      });
    await expect.poll(scales, { message: "the card at .97, its overlay at 1 / .97" }).toEqual({ card: "0.97", hitArea: 1 });
    await page.mouse.up(); // released on the card: the tap lands
    await expect(viewBag).toContainText("(1)");

    // The product-added modal's quick-add: its circle takes the Figma Quick Add pressed fill.
    await addBurgerFromPdp(page);
    await settle(page);
    const plus = page.getByTestId(`added-rec-add-${GREEK_SALAD}`);
    await hold(page, plus);
    await expect.poll(() => plus.locator("span").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(LILAC);
    const heading = await page.locator("#added-title").boundingBox();
    if (!heading) throw new Error("no added-title");
    await page.mouse.move(heading.x + heading.width / 2, heading.y + heading.height / 2); // off the control
    await page.mouse.up();
    await expect(viewBag).toContainText("(2)");
    await page.getByTestId("added-continue").click();

    await openBag(page);
    await settle(page);
    // A purple primary presses vibrant (Figma Primary 1:638); released off it, nothing pays.
    const pay = page.getByTestId("bag-pay");
    await hold(page, pay);
    await expect.poll(() => pay.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(VIBRANT);
    const title = await page.getByTestId("bag-sheet").locator("p.tb-display").first().boundingBox();
    if (!title) throw new Error("no bag title");
    await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
    await page.mouse.up();
    await expect(page).toHaveURL(/\/cart$/);

    const scrim = page.getByTestId("bag-sheet").locator(":scope > button");
    await hold(page, scrim, 100); // the scrim above the panel
    expect(await pressed(scrim), ":empty").toEqual({ active: true, scale: "none", squeezing: false });
    await page.mouse.up(); // the scrim's tap closes the bag
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
  });

  test("M8 LOOPS: the splash prompt pulses, the ticker scrolls, the menu fetch sweeps — the only infinite animations, none a transform loop on or around a tap target; the menu-fetch overlay reveals late (motion-v2 MV4)", async ({
    page,
  }) => {
    await mockBackend(page);
    const menuFetch = await holdRequests(page, "**/api/cx/kiosk/getMenu", { armed: false });
    await registerToStart(page);
    expect(await loops(page), "/start").toContain("tb-attract");
    await startToSecond(page);
    expect(await loops(page), "/second").toContain("tb-marquee");
    await settle(page);
    const rate = await slowMotion(page);
    await rate(0.1); // the late reveal's 300 ms delay holds while it is read
    menuFetch.arm();
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-fetching")).toBeVisible();
    await expectLateReveal(page, "menu-fetching");
    expect(await loops(page), "menu fetching").toContain("tb-indeterminate");
    await rate(1);
    await menuFetch.release();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await loops(page);
  });

  test("M8 LOOPS: PleaseWait's hourglass flips at the Figma Loader 1 angles (3.96 s) and the EDC card tilts −12° (Figma Credit card 1, 3.12 s), both clear of every tap target; /paymentPolling's content enters and the DOWN HERE arrow nudges three times toward the card machine (motion-v2 MV6); under reduce the EDC screen is still", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { settings: SKIP_CRM });
    await mockCheckoutBackend(page, { extraDeviceSettings: [PAYTM_EDC_ENTITY] });
    await mockPaytmBackend(page); // LAST of the three: its routes beat checkout's forbidden gateways
    const initiate = await holdRequests(page, PAYTM_ENDPOINTS.edcInit, { times: 1 });
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);
    await page.getByTestId("bag-pay").click();
    await page.getByTestId("payment-card").click();
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("paytm-preparing")).toBeVisible();
    await expect.poll(() => initiate.count).toBe(1);
    expect(await loops(page), "PleaseWait").toContain("tb-hourglass");
    // Figma Loader 1: 3.96 s, two clockwise half-turns, each overshooting (200°, 380°) and settling back.
    expect(await loopAngles(page, "tb-hourglass", [0.05, 0.34, 0.46, 0.76, 0.9])).toEqual({
      period: 3960,
      angles: [0, 200, 180, 20, 0],
    });
    await arrives(page, await slowMotion(page), "paytm-screen", 1, () => initiate.release(), async () => {
      // MV6, read while the timeline is slow (the run is over by 3.86 s): 3 × 1.2 s after the entrance, no target near.
      const nudge = named(await animations(page), "tb-nudge");
      expect(nudge.map(({ on, duration, iterations, delay, button }) => ({ on, duration, iterations, delay, button }))).toEqual([
        { on: "paytm-down-here-arrow", duration: 1200, iterations: 3, delay: 260, button: false },
      ]);
    });
    expect(await loops(page), "the EDC screen").toContain("tb-card-tilt");
    // Figma Credit card 1: 3.12 s, −12° (about the bottom-left corner), held, back.
    expect(await loopAngles(page, "tb-card-tilt", [0.1, 0.4, 0.8])).toEqual({ period: 3120, angles: [0, 348, 0] });

    // The one reduce read on a motion-v2 surface: the EDC screen at rest, at once.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expectReduced(page);
  });

  test("M9 REDUCED MOTION: every animation ends in ≤ 1 ms and every transition in 0 s, at once, in one pass (/second, menu, the spring, the bag); no from-frame flashes (the spring, a selection, the carousel start at rest); a held button never squeezes; the spring card rests centred; a rail tap scrolls in the same frame", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { menu: menuWithRecommendations() });
    await registerToStart(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

    await startToSecond(page);
    await expect(page.getByTestId("second-screen")).toHaveAttribute("data-enter", "fwd");
    await expectReduced(page);
    // motion-v2 MV8a: the /second card takes the house squeeze, which reduce turns off (its own 0.98 never did).
    const card = page.getByTestId("pipeline-p1");
    await hold(page, card);
    expect(await pressed(card), "the /second card: no squeeze under reduce").toEqual({
      active: true,
      scale: "1",
      squeezing: false,
    });
    const title = await page.getByTestId("second-screen").locator("h1").boundingBox();
    if (!title) throw new Error("no /second title");
    await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2); // released off the card: no tap
    await page.mouse.up();
    await pickPipelineToMenu(page);
    await expectReduced(page);

    // The squeeze is motion too: under reduce a held button keeps its size (only the Figma fills answer).
    const viewBag = page.getByTestId("cta-view-bag");
    await hold(page, viewBag);
    expect(await pressed(viewBag), "no squeeze under reduce").toEqual({ active: true, scale: "1", squeezing: false });
    const total = await page.getByTestId("cta-total").boundingBox();
    if (!total) throw new Error("no cta-total");
    await page.mouse.move(total.x + total.width / 2, total.y + total.height / 2);
    await page.mouse.up();

    const tap = await railTap(page, SIDE_ORDERS);
    expect(Math.abs(tap.target - tap.before), "the tap has somewhere to go").toBeGreaterThan(1);
    expect(Math.abs(tap.after - tap.target), "landed inside the tapping task").toBeLessThanOrEqual(1);
    await expectReduced(page);

    await addBurgerFromPdp(page);
    const spring = await springBox(page);
    expect(Math.abs(spring.dx), "centred: x").toBeLessThanOrEqual(1);
    expect(Math.abs(spring.dy), "centred: y").toBeLessThanOrEqual(1);
    expect(spring.scale, "full size — no 44 % frame").toBeCloseTo(1, 2);
    await expectReduced(page);
    expect(await firstFrames(page), "every full-opacity from-frame is the end state").toEqual({
      springScale: 1,
      select: "matrix(1, 0, 0, 1, 0, 0)",
      carousel: "matrix(1, 0, 0, 1, 0, 0)",
    });

    await page.getByTestId("added-continue").click();
    await openBag(page);
    expect(named(await animations(page, '[data-testid="bag-sheet"]'), "tb-sheet-enter")).toHaveLength(1);
    await expectReduced(page);
  });

  test("M10 CSS-ONLY: with the page clock paused (timers and rAF frozen) the /second entrance still plays to its end", async ({
    page,
  }) => {
    await page.clock.install();
    await mockBackend(page);
    await registerToStart(page);
    await freezeClock(page);
    const frozen = await fakeNow(page);
    const rate = await slowMotion(page);
    await rate(0.1);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toHaveAttribute("data-enter", "fwd");
    const entering = await page.evaluate(() => {
      const list = document
        .getAnimations()
        .filter((a) => a instanceof CSSAnimation && a.animationName === "tb-enter" && a.playState === "running");
      const flag = window as unknown as { __tbEnterDone?: boolean };
      flag.__tbEnterDone = false;
      void (async () => {
        await Promise.all(list.map((a) => a.finished));
        flag.__tbEnterDone = true;
      })();
      return list.length;
    });
    expect(entering).toBeGreaterThanOrEqual(2);
    await rate(1);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __tbEnterDone?: boolean }).__tbEnterDone), {
        message: "every tb-enter finished on the CSS timeline",
        timeout: 5_000,
      })
      .toBe(true);
    expect(await fakeNow(page), "no page time passed").toBe(frozen);
  });

  test("M11 ADA: motion stays in the reach zone — the product-added card at its spring peak (~14 % of 958 ms) and the risen bag panel lie within y 798–1920; leaving ADA on Order Complete replays nothing", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { menu: menuWithRecommendations(), settings: { accessibility_mode: true } });
    await bootRegisteredToMenu(page);
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("footer-ada")).toHaveAttribute("aria-pressed", "true");
    const zone = await page.getByTestId("reach-zone").boundingBox();
    if (!zone) throw new Error("no reach zone");
    expect([zone.y, zone.y + zone.height], "the 1122 px zone at the bottom of the stage").toEqual([798, 1920]);

    await addBurgerFromPdp(page);
    const run = await page.locator(SPRING_CARD).evaluate((card) => {
      const spring = card
        .getAnimations()
        .find((a) => a instanceof CSSAnimation && a.animationName === "tb-modal-spring");
      if (!spring) throw new Error("no spring on the added card");
      const duration = Number(spring.effect?.getComputedTiming().duration);
      spring.pause();
      const box = () => {
        const r = card.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
      };
      const frames: { t: number; box: ReturnType<typeof box> }[] = [];
      for (let t = 0; t <= duration; t += 2) {
        spring.currentTime = t;
        frames.push({ t, box: box() });
      }
      const peak = frames.reduce((best, frame) => (frame.box.width > best.box.width ? frame : best));
      spring.currentTime = peak.t; // paused AT the peak
      const atPeak = box();
      spring.play();
      return {
        peakAt: peak.t / duration,
        peakScale: atPeak.width / (card as HTMLElement).offsetWidth,
        atPeak,
        frames: frames.map((frame) => frame.box),
      };
    });
    expect(run.peakAt, "the Bouncy peak, ~14 % in").toBeGreaterThan(0.1);
    expect(run.peakAt, "the Bouncy peak, ~14 % in").toBeLessThan(0.2);
    expect(run.peakScale, "it overshoots").toBeGreaterThan(1);
    expectInside(run.atPeak, zone, "the card paused at its peak");
    for (const frame of run.frames) expectInside(frame, zone, "every spring frame");

    await page.getByTestId("added-continue").click();
    await openBag(page);
    const panel = page.getByTestId("bag-sheet").locator(":scope > .tb-sheet-enter");
    await expect.poll(() => panel.evaluate((el) => el.getAnimations().map((a) => a.playState).join())).toBe("finished");
    const box = await panel.boundingBox();
    if (!box) throw new Error("no bag panel");
    expectInside({ top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width }, zone, "the risen bag panel");

    // The ADA switch itself never animates (D-M6): leaving ADA on Order Complete replays no entrance and no burst.
    await page.getByTestId("bag-pay").click();
    await page.getByTestId("payment-counter").click();
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 }); // past the 3 s window
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    await settle(page); // its entrance and its one burst are over
    const rate = await slowMotion(page);
    await rate(0.1); // a replay would still be running when read
    await page.getByTestId("ada-brand-zone").click();
    await expect(page.getByTestId("ada-brand-zone")).toHaveCount(0);
    const replayed = (await animations(page, '[data-testid="order-success"]')).filter(
      (a) => a.kind === "CSSAnimation" && a.state === "running"
    );
    expect(replayed.map((a) => `${a.name} on ${a.on}`), "nothing replays on the ADA exit").toEqual([]);
    await rate(1);
  });

  test("M12 PERFORMANCE: every @keyframes moves only opacity / transform / translate / scale / rotate, and nothing carries will-change (splash, /second, menu, PDP, the spring, the bag)", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, { menu: menuWithRecommendations() });
    await registerToStart(page);
    const keyframes = await keyframeProperties(page);
    expect(Object.keys(keyframes), "the sweep reads the app's own CSS").toEqual(
      expect.arrayContaining([
        "tb-enter",
        "tb-rise",
        "tb-sheet-enter",
        "tb-modal-enter",
        "tb-modal-spring",
        "tb-pop-in",
        "tb-bump",
        "tb-select",
        "tb-shake",
        "tb-wiggle",
        "tb-carousel-in",
        "tb-attract",
        "tb-indeterminate",
        "tb-hourglass",
        "tb-card-tilt",
      ])
    );
    for (const [name, props] of Object.entries(keyframes)) {
      // A keyframe's own animation-timing-function is its segment's easing, not a moved property.
      const moved = props.filter((prop) => prop !== "animation-timing-function");
      expect(moved.filter((prop) => !COMPOSITED.includes(prop)), `@keyframes ${name}`).toEqual([]);
    }

    const screen = async (where: string) => {
      expect(await willChange(page), `will-change on ${where}`).toEqual([]);
      await animations(page); // §4 rule 1 on whatever is running here
    };
    await screen("/start");
    await startToSecond(page);
    await screen("/second");
    await pickPipelineToMenu(page);
    await screen("/menu");
    await addBurgerFromPdp(page);
    await screen("the product-added spring");
    await page.getByTestId("added-continue").click();
    await openBag(page);
    await screen("the bag");
  });

  test("M13 CLOSING IS INSTANT: with the page clock frozen (timers, rAF) and every animation stopped (playback rate 0), the bag's scrim and the language sheet's ✕ still close their sheet — no exit waits on a timer, a frame or an animation", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install();
    await mockBackend(page);
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);
    await settle(page);
    await freezeClock(page);
    const rate = await slowMotion(page);
    await rate(0);

    const bag = page.getByTestId("bag-sheet");
    await bag.locator(":scope > button").click({ position: { x: 540, y: 100 } }); // the scrim above the panel
    await expect(bag).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);

    await page.getByTestId("footer-language").click();
    const language = page.getByTestId("language-sheet");
    await expect(language).toBeVisible();
    const panel = language.locator(":scope > .tb-sheet-enter");
    expect(
      await panel.evaluate((el) => [getComputedStyle(el).opacity, el.getAnimations().map((a) => a.playState).join()]),
      "rate 0 holds the entrance at its first frame"
    ).toEqual(["0", "running"]);
    await panel.locator(":scope > button").click(); // the ✕ — tappable at opacity 0
    await expect(language).toHaveCount(0);
    await rate(1);
  });

  // The kiosk's real input. A dispatched CDP touch never sets :active (only the synthetic gesture pipeline does,
  // at GestureShowPress), so what shows here is the touch-down press state alone.
  test.describe("M14 PRESS AT TOUCH-DOWN (motion-v2 MV1, CDP touches, hasTouch)", () => {
    test.use({ hasTouch: true });

    test("M14 PRESS AT TOUCH-DOWN: a finger on a button takes the Figma pressed fill at once (no squeeze: that stays :active's); where a pan can start the fill waits 90 ms, and a pan never shows it", async ({
      page,
    }) => {
      test.slow();
      await page.clock.install(); // the 90 ms is a page timer: stepped, never slept through
      await mockBackend(page);
      await registerToStart(page);
      await startToSecond(page);
      await settle(page);
      const cdp = await page.context().newCDPSession(page);
      const finger = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: at ? [{ x: at.x, y: at.y, radiusX: 1, radiusY: 1 }] : [],
        });
      const centre = async (target: Locator) => {
        const box = await target.boundingBox();
        if (!box) throw new Error("nothing to touch");
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const state = (target: Locator) =>
        target.evaluate((el) => ({
          pressed: el.hasAttribute("data-pressed"),
          active: el.matches(":active"),
          fill: getComputedStyle(el).backgroundColor,
          scale: getComputedStyle(el).scale,
        }));

      // 1. /second: nothing around the card can pan — the lilac at touch-down; the tap still lands.
      const card = page.getByTestId("pipeline-p1");
      await finger("touchStart", await centre(card));
      expect(await state(card), "pressed at touch-down").toEqual({ pressed: true, active: false, fill: LILAC, scale: "none" });
      await finger("touchEnd");
      await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
      await settle(page);

      // 2. /menu: the quick add sits in the pane, which overflows — a pan can start, so the fill waits 90 ms.
      const add = page.getByTestId(`quick-add-${GREEK_SALAD}`);
      await add.scrollIntoViewIfNeeded();
      const atAdd = await centre(add);
      await freezeClock(page);
      await finger("touchStart", atAdd);
      expect((await state(add)).pressed, "not yet: a pan may start").toBe(false);
      await page.clock.runFor(90);
      expect(await state(add), "pressed after 90 ms").toMatchObject({ pressed: true, fill: LILAC });
      await page.clock.resume();
      await finger("touchEnd");
      await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");

      // 3. A pan: the browser takes the touch (pointercancel) before 90 ms — the fill never shows, nothing is added.
      const dy = await add.evaluate((el) => ((el.closest(".overflow-y-auto")?.scrollTop ?? 0) > 0 ? 80 : -80));
      await freezeClock(page);
      await finger("touchStart", atAdd);
      for (let i = 1; i <= 6; i += 1) await finger("touchMove", { x: atAdd.x, y: atAdd.y + (dy * i) / 6 });
      await page.clock.runFor(150);
      expect((await state(add)).pressed, "a pan never shows the fill").toBe(false);
      await finger("touchEnd");
      await page.clock.resume();
      await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    });
  });

  test("M15 WAITS (motion-v2 MV3): every silent wait shows the house sweep — the boot, /customerName's CRM lookup, the /payment window and /receipt's PLACING — a loop on no tap target", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install(); // the /payment window is stepped, never slept through
    await mockBackend(page, { settings: { skip_crm_page: false } }); // PAY → /phone → /customerName
    const boot = await holdRequests(page, "**/api/cx/kiosk/getLanguage", { times: 1 }); // the boot's first call
    const crm = await holdRequests(page, "**/api/cx/kiosk/getCustomerNameByNumber");
    const push = await holdRequests(page, PLACE_ORDER_URL);

    await submitLicence(page);
    await expect(page.getByTestId("loading-resources")).toBeVisible();
    await expect.poll(() => boot.count).toBe(1);
    expect(await loops(page), "the boot").toContain("tb-indeterminate");
    await boot.release();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });

    await startToSecond(page);
    await pickPipelineToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
    await typeDigits(page, "1234567890"); // GB: exactly 10 digits
    await page.getByTestId("phone-continue").click();
    await expect(page.getByTestId("customer-name-loading")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => crm.count).toBe(1);
    expect(await loops(page), "/customerName's CRM lookup").toContain("tb-indeterminate");
    await crm.release();
    await expect(page.getByTestId("customer-name-loading")).toHaveCount(0);
    await page.getByRole("button", { name: "t", exact: true }).click();
    await page.getByTestId("customer-name-continue").click();

    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await freezeClock(page); // the 3 s window holds while it is read
    await page.getByTestId("payment-counter").click();
    await expect(page.getByTestId("payment-buffer-cancel")).toBeVisible();
    expect(await loops(page), "the /payment window").toContain("tb-indeterminate");
    await page.clock.runFor(3_000);
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await page.clock.resume();

    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("payment-buffer")).toBeVisible();
    await expect.poll(() => push.count).toBe(1);
    expect(await loops(page), "/receipt PLACING").toContain("tb-indeterminate");
    await push.release();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
  });

  test("M15 LATE REVEAL (motion-v2 MV4): PleaseWait over the Paytm initiate is invisible for its first 300 ms (tb-fade-in after 300 ms, over 200 ms) yet takes a repeat tap from its first frame — exactly one initiate", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { settings: SKIP_CRM });
    await mockCheckoutBackend(page, { extraDeviceSettings: [PAYTM_EDC_ENTITY] });
    const paytm = await mockPaytmBackend(page); // LAST of the three: its routes beat checkout's forbidden gateways
    const initiate = await holdRequests(page, PAYTM_ENDPOINTS.edcInit); // EVERY initiate parks: a second would count
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);
    await page.getByTestId("bag-pay").click();
    await page.getByTestId("payment-card").click();
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await settle(page);
    const none = await page.getByTestId("receipt-none").boundingBox();
    if (!none) throw new Error("no receipt-none");
    const at = { x: none.x + none.width / 2, y: none.y + none.height / 2 };

    const rate = await slowMotion(page);
    await rate(0.1); // the 300 ms delay holds while it is read
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("paytm-preparing")).toBeAttached();
    await expectLateReveal(page, "paytm-preparing");
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid"),
        at
      ),
      "what a tap on NO THANKS hits now"
    ).toBe("paytm-preparing");
    await page.mouse.click(at.x, at.y); // the guest taps again while nothing shows yet
    await expect.poll(() => initiate.count).toBe(1);
    await initiate.release();
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });
    expect(paytm.counts.edcInit, "exactly one initiate reached Paytm").toBe(1);
    await rate(1);
  });

  test("M16 CONFORMANCE (motion-v2 MV8): the /second card squeezes to the house .97 and a mouse hold 3 px inside its top edge still lands; the idle START AGAIN fill slides (transform, never width); tier-2 enters like a page with no inline <style> or animation", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install(); // the idle prompt is a fast-forward, never a wait
    await mockBackend(page);
    await registerToStart(page);
    await startToSecond(page);
    await settle(page);

    // (a) The house squeeze, not a 0.98 of its own; tb-press-hit keeps the squeezed card's hit area whole.
    const card = page.getByTestId("pipeline-p1");
    await hold(page, card, 3);
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).scale)).toBe("0.97");
    await expect
      .poll(() => card.evaluate((el) => el.getAnimations({ subtree: true }).length), { message: "the squeeze settled" })
      .toBe(0);
    await page.mouse.up(); // released where it was pressed: outside the squeezed box, inside its hit area
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });

    // (e) The idle prompt's START AGAIN fill slides: a composited transform, never a width (a relayout per tick).
    await page.clock.fastForward(PROMPT_AFTER_MS);
    await expect(page.getByRole("alertdialog")).toBeVisible();
    const fill = page.getByTestId("idle-start-again").locator('[aria-hidden="true"]');
    expect(await fill.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe(
      "transform, translate, scale, rotate"
    );
    await page.getByTestId("idle-continue").click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // (c) Tier-2 enters like a pushed page (its scroll body from the right) — the house class, nothing inline.
    const box = page.getByTestId(`item-${DREAM_BOX}`);
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();
    await settle(page);
    await arrives(page, await slowMotion(page), "tier2-sheet", 1, () =>
      page.getByTestId(`pack-slot-customize-${DREAM_BOX}_2_combo`).click()
    );
    const tier2 = page.getByTestId("tier2-sheet");
    await expect(tier2.locator("style")).toHaveCount(0);
    expect(
      await tier2.evaluate((root) => [
        root.getAttribute("style"),
        [...root.querySelectorAll<HTMLElement>("[style]")].filter((el) => el.style.animation !== "").length,
      ]),
      "no inline style on the page, no inline animation inside it"
    ).toEqual([null, 0]);
  });

  test("M17 HAND-OFF (motion-v2 MV4, review F1): a status layer that REPLACES a dialog shows at once — the bag's order-type switch after YES, PleaseWait after /receipt's TRY AGAIN and after the EDC cancel's YES — never a bright, dead screen while the late reveal waits", async ({
    page,
  }) => {
    test.slow();
    await mockBackend(page, {}, { extraDeviceSettings: [PAYTM_EDC_ENTITY] });
    const paytm = await mockPaytmBackend(page, { edcInit: () => EDC_BUSY }); // LAST: its routes beat checkout's gateways
    await page.route(PIPELINES_URL, (route) => route.fulfill({ json: [DINE_IN, TAKE_AWAY] }));
    const menu = await holdRequests(page, "**/api/cx/kiosk/getMenu", { armed: false });
    const initiate = await holdRequests(page, PAYTM_ENDPOINTS.edcInit, { armed: false });
    const voids = await holdRequests(page, PAYTM_ENDPOINTS.edcCancel);
    const rate = await slowMotion(page);

    // 1. The bag: EAT IN → TAKE OUT, YES. The switch layer is only ever entered from a dialog.
    await bootRegisteredToMenu(page);
    await addOneTap(page, GREEK_SALAD, "(1)");
    await openBag(page);
    await page.getByTestId("bag-ordertype-takeout").click();
    await expect(page.getByTestId("bag-ordertype-confirm")).toBeVisible();
    await settle(page);
    menu.arm();
    await rate(0.1); // a late reveal's 300 ms would hold for 3 s here
    await page.getByTestId("bag-ordertype-confirm-yes").click();
    await expect(page.getByTestId("bag-ordertype-confirm")).toHaveCount(0);
    await expectAtOnce(page, "bag-ordertype-switching");
    await rate(1);
    await expect.poll(() => menu.count).toBeGreaterThan(0);
    await menu.release();
    await expect(page.getByTestId("bag-ordertype-switching")).toHaveCount(0, { timeout: 15_000 });

    // 2. /receipt: the terminal is busy; TRY AGAIN replaces the failure dialog with PleaseWait.
    await page.getByTestId("bag-pay").click();
    await page.getByTestId("payment-card").click();
    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("paytm-initiate-failed")).toBeVisible({ timeout: 15_000 });
    await settle(page);
    delete paytm.script.edcInit; // the retry is answered (once released)
    initiate.arm();
    await rate(0.1);
    await page.getByTestId("paytm-initiate-retry").click();
    await expect(page.getByTestId("paytm-initiate-failed")).toHaveCount(0);
    await expectAtOnce(page, "paytm-preparing");
    await rate(1);
    await expect.poll(() => initiate.count).toBe(1);
    await initiate.release();
    await expect(page.getByTestId("paytm-screen")).toBeVisible({ timeout: 15_000 });

    // 3. /paymentPolling: CANCEL PAYMENT → YES replaces the confirm with PleaseWait (cancelling; the void parks).
    await page.getByTestId("paytm-cancel").click();
    await expect(page.getByTestId("paytm-cancel-confirm")).toBeVisible();
    await settle(page);
    await rate(0.1);
    await page.getByTestId("paytm-cancel-yes").click();
    await expect(page.getByTestId("paytm-cancel-confirm")).toHaveCount(0);
    await expectAtOnce(page, "paytm-confirming");
    await rate(1);
    await expect.poll(() => voids.count).toBe(1);
    await voids.release();
    await expect(page.getByTestId("paytm-terminal-prompt")).toBeVisible({ timeout: 15_000 });
    expect(paytm.counts.edcInit, "the busy initiate + the retry").toBe(2);
  });
});
