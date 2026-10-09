import { test, expect, type CDPSession, type Locator, type Page } from "./fixtures/kiosk";
import {
  mockKioskBackend as mockBackend,
  SIDE_ORDERS,
  CAESAR_DRESSING as CAESAR,
  DREAM_BOX,
  LARGE_FRIES,
} from "./fixtures/backend";
import { stageBox } from "./fixtures/a11y";
import { bootRegisteredToMenu as bootToMenu } from "./pages/boot";

/**
 * Lane scroll-drag (user request 2026-10-08, reverses D3): "the scroll bar in
 * the menu or anywhere should help in quick scrolling — when we hold and
 * scroll from that bar it should scroll up and down". The Figma 1:5263 bar
 * (ScrollIndicator) is draggable at /menu, the PDP and tier-2, end to end.
 *
 * THE GESTURE. The 11 px track (x 1057–1068) is unchanged and still
 * pointer-events-none. A transparent sibling strip `${id}-hit` owns the
 * gesture: x 1056–1080 (the pane's free right gutter) over the bar's
 * y-range, touch-action: none. A press on the thumb grabs it where it lands;
 * a press elsewhere on the strip jumps the thumb's centre under the finger,
 * and the same press keeps dragging. Every write is an instant scrollTop
 * assignment inside the handler, so a press's jump is read back at once,
 * never polled. Moves are rAF-aligned in Chromium, so a move's result IS
 * polled. Pointer capture keeps a drag that wanders over the cards on the
 * bar. Nothing calls preventDefault, so the idle timer still hears the
 * compat mouse events and the touch events.
 *
 * THE GUTTER (the lane's runtime measurement; the CONTENT, PDP and TIER-2
 * cases). Content ends at x 1056 at every site, so the strip is 24 px, not
 * the kiosk's 44 px (sign-off). At the pane's top, middle and end, in EN, AR
 * and ADA:
 *   - no control in the pane (button, a, input, label, [role=button],
 *     [tabindex]) reaches past x 1056 inside the strip's y-range (clipped by
 *     its overflow ancestors, which is what a finger can reach);
 *   - x 1057, 1068 and 1079 hit the strip all the way down its height;
 *   - beside each right-column menu card, x 1055 hits the card.
 *
 * Strip boxes, stage px. The stage is 1:1 in this 1080×1920 viewport
 * (asserted once per boot), so stage px are the mouse's client px:
 *   /menu   1056/505 24×790 · ADA 1056/968 24×578 (798 + 170)
 *   PDP     1056/703 24×790 · ADA 1056/1286 24×394 (798 + 488)
 *   tier-2  as the PDP. In this fixture its EN page FITS, so it has no strip.
 * Drag maths read the live geometry. The fixture's EN menu overflows by only
 * 75 px (a 757 px thumb, 33 px of travel), so EN menu drags are short; the
 * ADA menu overflows by 873 (281 px of travel).
 *
 * TOUCH, the kiosk's real input: CDP Input.dispatchTouchEvent with hasTouch.
 *   - A native pan loses Chromium's 15 px touch slop (a 60 px swipe pans
 *     ~45 px); the bar's absolute mapping does not.
 *   - Touch ADJUSTMENT moves a touch onto the nearest tap target. The strip
 *     is one only through its `active:` style; without it, touches on the
 *     visible bar (radius 1 as well as a 14–15 px fingertip) go to the card
 *     or the Counter + beside it. elementFromPoint and the mouse cannot see
 *     this: only a real touch beside a control can.
 *   - With touch ids, CDP drives several fingers at once (a touchEnd listing
 *     one finger lifts only it), and touchCancel fires a real pointercancel
 *     + lostpointercapture on the captured strip (TOUCH OWNER).
 *
 * ── MOCKS ───────────────────────────────────────────────────────────────
 * The harness house order (newest route wins): the shared mock
 * (fixtures/backend.ts), nothing routed over it. Arabic is always offered
 * (its `arabic` option: getLanguage's secondary language plus
 * start_order_text_secondary). `accessibility_mode: true` puts the ADA
 * toggle in the footer. The print agent and the Xeno revoke are other
 * origins the harness denies by name. The boot is the shared pages/boot.ts
 * plus this file's 1:1 stage check; stageBox is fixtures/a11y.ts. No
 * currency text is asserted.
 */

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json; SIDE_ORDERS, CAESAR, DREAM_BOX, LARGE_FRIES: fixtures/backend.ts) ----
// CAESAR (Caesar Dressing): the right column of the Sauces row; no modifiers, upsell or
//   recommendations, so its quick-add lands it at once. It is inside the bar's y-range at the
//   end of the ADA menu.
// DREAM_BOX: the pack PDP, which overflows (EN 480, ADA 1278).
// LARGE_FRIES: its PDP fits in EN and overflows only in ADA (by 382).
/**
 * Kiddie Meal Beef Burger: the right column, inside the EN bar's y-range at
 * the top; modifiers, so a tap opens its PDP.
 */
const BEEF_BURGER = "5dd1093a188e72ce1b3eb358";
/** Dream box's Sides slot: CUSTOMIZE opens the tier-2 page (pack.spec.ts). */
const G_SIDES = `${DREAM_BOX}_2_combo`;

// ---- Mirrors src/components/stage/KioskStage.tsx (ada.spec.ts) ----
const STAGE_HEIGHT = 1920;
const ADA_BRAND_ZONE_HEIGHT = 798;

/** Strip boxes (stage px): x = 1080 − 24, the pane's whole right gutter. */
const MENU_STRIP = { x: 1056, y: 505, width: 24, height: 790 };
const MENU_STRIP_ADA = { x: 1056, y: ADA_BRAND_ZONE_HEIGHT + 170, width: 24, height: 578 };
const PDP_STRIP = { x: 1056, y: 703, width: 24, height: 790 };
const PDP_STRIP_ADA = { x: 1056, y: ADA_BRAND_ZONE_HEIGHT + 488, width: 24, height: 394 };
/** Content ends here at every site; the strip starts here. */
const CONTENT_EDGE = 1056;
/** The visible track's centre column (x 1057–1068). */
const BAR_X = 1062;

/**
 * The shared mock (fixtures/backend.ts): Arabic offered, ADA available. Its
 * ideal_time "180" clamps to 120 s: the idle prompt opens at 100 s (idle.spec.ts).
 */
const mockKioskBackend = (page: Page) =>
  mockBackend(page, { arabic: true, settings: { accessibility_mode: true } });

/**
 * Register on the on-screen keyboard, then splash → order type → /menu, and
 * pin the 1:1 stage that lets stage px drive the mouse.
 */
async function bootRegisteredToMenu(page: Page) {
  await bootToMenu(page);
  expect(await page.getByTestId("kiosk-stage").boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 1080,
    height: STAGE_HEIGHT,
  });
}

/** Menu card tap → its PDP. */
async function openPdp(page: Page, itemId: string) {
  const card = page.getByTestId(`item-${itemId}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
}

/** The menu's scroll pane: the parent of the category sections. */
const menuPane = (page: Page) =>
  page.getByTestId(`section-${SIDE_ORDERS}`).locator("xpath=..");
/** The PDP's scroll pane (its id is the SDK autoscroll contract). */
const pdpPane = (page: Page) => page.locator("#scrollCustomizableItem");
/** The tier-2 page's scroll pane (the hook's error AutoScroll target). */
const tier2Pane = (page: Page) => page.locator("#scrollCustomizableItem2");

const scrollTopOf = (pane: Locator) => pane.evaluate((el) => el.scrollTop);
const setScrollTop = (pane: Locator, top: number) =>
  pane.evaluate((el, value) => {
    el.scrollTop = value;
  }, top);

async function expectScrollNear(pane: Locator, expected: number, tolerance: number, message?: string) {
  await expect
    .poll(async () => Math.abs((await scrollTopOf(pane)) - expected), { message })
    .toBeLessThanOrEqual(tolerance);
}

/** The bar's live geometry (client px) and its pane's scroll state. */
interface Bar {
  scrollTop: number;
  overflow: number;
  top: number;
  bottom: number;
  thumbH: number;
  travel: number;
}

function readBar(pane: Locator, testId: string): Promise<Bar> {
  return pane.evaluate((el, id) => {
    const track = document.querySelector(`[data-testid="${id}"]`);
    const thumb = document.querySelector(`[data-testid="${id}-thumb"]`);
    if (!track || !thumb) throw new Error(`${id} is not mounted`);
    const t = track.getBoundingClientRect();
    const thumbH = thumb.getBoundingClientRect().height;
    return {
      scrollTop: el.scrollTop,
      overflow: el.scrollHeight - el.clientHeight,
      top: t.top,
      bottom: t.bottom,
      thumbH,
      travel: t.height - thumbH,
    };
  }, testId);
}

/** Where the component puts the thumb's centre for the live scrollTop (the paint can lag a frame). */
const thumbCentre = (b: Bar) => b.top + (b.scrollTop / b.overflow) * b.travel + b.thumbH / 2;

/** The painted thumb against its track: edge gaps and the thumb's centre (client px). */
function paintedThumb(page: Page, testId: string) {
  return page.evaluate((id) => {
    const track = document.querySelector(`[data-testid="${id}"]`);
    const thumb = document.querySelector(`[data-testid="${id}-thumb"]`);
    if (!track || !thumb) throw new Error(`${id} is not mounted`);
    const t = track.getBoundingClientRect();
    const h = thumb.getBoundingClientRect();
    return {
      topGap: Math.abs(h.top - t.top),
      bottomGap: Math.abs(h.bottom - t.bottom),
      centre: h.top + h.height / 2,
    };
  }, testId);
}

/**
 * How far the painted thumb is from where the pane's live geometry puts it
 * (menu-scroll.spec.ts): the "the paint has caught up" gate after a mode
 * switch or a programmatic scroll.
 */
function thumbError(pane: Locator, testId: string): Promise<number> {
  return pane.evaluate((el, id) => {
    const track = document.querySelector(`[data-testid="${id}"]`);
    const thumb = document.querySelector(`[data-testid="${id}-thumb"]`);
    if (!track || !thumb) return Number.POSITIVE_INFINITY;
    const t = track.getBoundingClientRect();
    const h = thumb.getBoundingClientRect();
    const overflow = el.scrollHeight - el.clientHeight;
    const height = (t.height * el.clientHeight) / el.scrollHeight;
    const offset = (el.scrollTop / overflow) * (t.height - h.height);
    return Math.max(Math.abs(h.height - height), Math.abs(h.top - t.top - offset));
  }, testId);
}

async function expectThumbTracksPane(pane: Locator, testId: string) {
  await expect
    .poll(() => thumbError(pane, testId), {
      message: `${testId}: the thumb follows the pane's scroll geometry`,
    })
    .toBeLessThanOrEqual(1);
}

/**
 * Two frames: Chromium dispatches mouse/touch moves rAF-aligned, so every move
 * sent before this has reached its handlers when it resolves.
 */
const nextFrames = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
  );

/** Scroll the pane to its top and wait for the thumb to be painted there. */
async function toTop(pane: Locator, testId: string) {
  await setScrollTop(pane, 0);
  await expect.poll(() => scrollTopOf(pane)).toBe(0);
  await expectThumbTracksPane(pane, testId);
}

/**
 * The mouse drives the bar end to end: hold the thumb a quarter of the way
 * down (off its centre, so the grab offset must hold: no jump) and drag it
 * half its travel (about half the overflow), on past the track's bottom (the
 * pane's end, the thumb's bottom on the track's), and let go. A move after
 * the release does nothing. Then hold it again and drag past the track's top
 * (scrollTop 0, the thumb's top on the track's).
 */
async function dragEndToEnd(page: Page, pane: Locator, testId: string) {
  await toTop(pane, testId);
  const b = await readBar(pane, testId);
  expect(b.travel, `${testId}: the thumb has room to travel`).toBeGreaterThan(10);
  const grip = thumbCentre(b) - b.thumbH / 4;
  await page.mouse.move(BAR_X, grip);
  await page.mouse.down();
  await page.mouse.move(BAR_X, grip + b.travel / 2, { steps: 4 });
  await expectScrollNear(pane, b.overflow / 2, 2, `${testId}: half the travel, half the overflow`);
  await page.mouse.move(BAR_X, b.bottom + 40, { steps: 6 });
  await expectScrollNear(pane, b.overflow, 1, `${testId}: past the track's bottom, the pane's end`);
  await expect.poll(async () => (await paintedThumb(page, testId)).bottomGap).toBeLessThanOrEqual(1);
  await page.mouse.up();

  // Released: the pointer going back up moves nothing.
  await page.mouse.move(BAR_X, grip, { steps: 3 });
  await nextFrames(page);
  expect(await scrollTopOf(pane), `${testId}: the release ended the drag`).toBeGreaterThanOrEqual(
    b.overflow - 1
  );

  const end = await readBar(pane, testId);
  await page.mouse.move(BAR_X, thumbCentre(end));
  await page.mouse.down();
  await page.mouse.move(BAR_X, end.top - 40, { steps: 6 });
  await expectScrollNear(pane, 0, 0, `${testId}: past the track's top, scrollTop 0`);
  await page.mouse.up();
  await expect.poll(async () => (await paintedThumb(page, testId)).topGap).toBeLessThanOrEqual(1);
}

interface GutterRow {
  at: number;
  /** The rightmost visible edge of any control inside the strip's y-range. */
  reach: number;
  /** Right-column menu cards beside the strip. */
  cards: number;
  /** Hit tests that did not land where they should. */
  misses: string[];
}

/**
 * The runtime gutter measurement (header) at the pane's top, middle and end.
 * Restores the pane's scroll position.
 */
function gutterReport(pane: Locator, testId: string): Promise<GutterRow[]> {
  return pane.evaluate(
    (el, { id, edge }) => {
      const strip = document.querySelector(`[data-testid="${id}-hit"]`);
      if (!strip) throw new Error(`${id}-hit is not mounted`);
      const s = strip.getBoundingClientRect();
      const start = el.scrollTop;
      const overflow = el.scrollHeight - el.clientHeight;
      const controls = 'button, a, input, label, [role="button"], [tabindex]';
      const rows: GutterRow[] = [];
      for (const at of [0, Math.round(overflow / 2), overflow]) {
        el.scrollTop = at;
        let reach = 0;
        for (const c of Array.from(el.querySelectorAll(controls))) {
          const r = c.getBoundingClientRect();
          if (!r.width || !r.height || r.bottom <= s.top || r.top >= s.bottom) continue;
          let right = r.right;
          for (let a = c.parentElement; a && a !== el; a = a.parentElement) {
            if (getComputedStyle(a).overflowX !== "visible") {
              right = Math.min(right, a.getBoundingClientRect().right);
            }
          }
          reach = Math.max(reach, right);
        }
        const misses: string[] = [];
        for (let y = s.top + 2; y < s.bottom - 1; y += 24) {
          for (const x of [edge + 1, edge + 12, edge + 23]) {
            if (document.elementFromPoint(x, y) !== strip) misses.push(`strip x${x} y${Math.round(y)}`);
          }
        }
        let cards = 0;
        for (const card of Array.from(el.querySelectorAll('[data-testid^="item-"]'))) {
          const r = card.getBoundingClientRect();
          const mid = (r.top + r.bottom) / 2;
          if (Math.abs(r.right - edge) > 0.5 || mid <= s.top || mid >= s.bottom) continue;
          cards += 1;
          const hit = document.elementFromPoint(edge - 1, mid);
          if (!hit || !card.contains(hit)) misses.push(`card x${edge - 1} y${Math.round(mid)}`);
        }
        rows.push({ at, reach, cards, misses });
      }
      el.scrollTop = start;
      return rows;
    },
    { id: testId, edge: CONTENT_EDGE }
  );
}

async function expectGutterClear(pane: Locator, testId: string, label: string, { cards = false } = {}) {
  const rows = await gutterReport(pane, testId);
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    const where = `${label} @ scrollTop ${row.at}`;
    expect(row.reach, `${where}: no control reaches past x ${CONTENT_EDGE}`).toBeLessThanOrEqual(
      CONTENT_EDGE
    );
    expect(row.misses, `${where}: hit tests`).toEqual([]);
    if (cards) expect(row.cards, `${where}: a right-column card beside the strip`).toBeGreaterThan(0);
  }
}

// ---- CDP touch (the kiosk's real input) ----
interface Finger {
  x: number;
  y: number;
  /** Contact radius: ~15 is a fingertip, 1 is a stylus point. */
  r?: number;
  /** CDP touch id, for more than one finger at once (then every finger carries one). */
  id?: number;
}

const touchPoint = ({ x, y, r = 1, id }: Finger) => ({ x, y, radiusX: r, radiusY: r, ...(id === undefined ? {} : { id }) });

async function fingerDown(cdp: CDPSession, at: Finger) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(at)] });
}

/** The finger moves dy from `from` in `steps` moves and stays down. */
async function fingerMove(cdp: CDPSession, from: Finger, dy: number, steps = 6) {
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touchPoint({ ...from, y: from.y + (dy * i) / steps })],
    });
  }
}

/** Lifts every finger, or only `at` (by its id). */
async function fingerUp(cdp: CDPSession, at?: Finger) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: at ? [touchPoint(at)] : [] });
}

async function tap(cdp: CDPSession, at: Finger) {
  await fingerDown(cdp, at);
  await fingerUp(cdp);
}

/**
 * Logs which testid each pointerdown / pointercancel / click reaches. On
 * window, never document: a listener on a node can change what Chromium's
 * touch adjustment treats as a tap target.
 */
async function recordInput(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __input?: string[] };
    w.__input = [];
    for (const type of ["pointerdown", "pointercancel", "click"]) {
      window.addEventListener(
        type,
        (e) => {
          const hit = e.target instanceof Element ? e.target.closest("[data-testid]") : null;
          w.__input?.push(`${type}:${hit?.getAttribute("data-testid") ?? "-"}`);
        },
        { capture: true }
      );
    }
  });
}

const inputLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __input?: string[] }).__input ?? []);
const clearInput = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __input?: string[] }).__input = [];
  });

/** A tap's whole sequence has arrived once its click has. */
async function expectTapOn(page: Page, testId: string) {
  await expect.poll(() => inputLog(page)).toContain(`click:${testId}`);
  expect(await inputLog(page)).toEqual([`pointerdown:${testId}`, `click:${testId}`]);
  await clearInput(page);
}

const bagButton = (page: Page) => page.getByTestId("cta-view-bag");

/**
 * ADA PDP at the top: the title Counter's + (x 992–1056) beside the strip.
 * Returns the middle of its overlap with the strip's y-range.
 */
async function plusBesideStrip(page: Page) {
  const plus = await stageBox(page.getByTestId("pdp-qty-increase"));
  expect(plus.x + plus.width, "precondition: the + ends at the content edge").toBe(CONTENT_EDGE);
  const top = Math.max(plus.y, PDP_STRIP_ADA.y);
  const bottom = Math.min(plus.y + plus.height, PDP_STRIP_ADA.y + PDP_STRIP_ADA.height);
  expect(bottom - top, "precondition: the + overlaps the strip's y-range").toBeGreaterThan(20);
  return (top + bottom) / 2;
}

test.describe("scroll-drag: the Figma 1:5263 bar is draggable (user request 2026-10-08)", () => {
  test("MENU DRAG: hold the thumb — half its travel scrolls half the overflow, past the bottom is the end, back past the top is 0", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);

    const strip = page.getByTestId("menu-scrollbar-hit");
    await expect(strip).toBeVisible();
    expect(await stageBox(strip)).toEqual(MENU_STRIP);
    await dragEndToEnd(page, menuPane(page), "menu-scrollbar");
    await expect(page).toHaveURL(/\/menu$/);
  });

  test("TRACK TAP: a press off the thumb jumps its centre under the finger at once (clamped at both ends) and the same press drags on", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    // ADA: the EN thumb covers 96 % of its track, so there is no track to tap.
    await page.getByTestId("footer-ada").click();
    const strip = page.getByTestId("menu-scrollbar-hit");
    await expect.poll(() => stageBox(strip)).toEqual(MENU_STRIP_ADA);
    const pane = menuPane(page);
    await toTop(pane, "menu-scrollbar");

    const b = await readBar(pane, "menu-scrollbar");
    const at = (fraction: number) => b.top + fraction * (b.bottom - b.top);
    const jump = (y: number) =>
      Math.min(1, Math.max(0, (y - b.top - b.thumbH / 2) / b.travel)) * b.overflow;

    // 60 %: below the thumb, and the jump is not clamped.
    const below = at(0.6);
    expect(below, "precondition: below the thumb").toBeGreaterThan(b.top + b.thumbH);
    expect(jump(below), "precondition: an unclamped jump").toBeLessThan(b.overflow - 10);
    await page.mouse.move(BAR_X, below);
    await page.mouse.down();
    // Read at once, never polled: the jump is an instant scrollTop write.
    expect(Math.abs((await scrollTopOf(pane)) - jump(below))).toBeLessThanOrEqual(2);
    await page.mouse.move(BAR_X, below + 20, { steps: 2 });
    await expectScrollNear(pane, jump(below + 20), 2, "the press that jumped keeps dragging");
    await page.mouse.up();
    await expect
      .poll(async () => Math.abs((await paintedThumb(page, "menu-scrollbar")).centre - (below + 20)))
      .toBeLessThanOrEqual(2);

    // 10 %, above the thumb: the jump clamps at the top.
    const above = at(0.1);
    const now = await readBar(pane, "menu-scrollbar");
    expect(above, "precondition: above the thumb").toBeLessThan(
      now.top + (now.scrollTop / now.overflow) * now.travel
    );
    await page.mouse.click(BAR_X, above);
    expect(await scrollTopOf(pane)).toBe(0);

    // 75 % from the top: the jump clamps at the end.
    await page.mouse.click(BAR_X, at(0.75));
    expect(Math.abs((await scrollTopOf(pane)) - jump(at(0.75)))).toBeLessThanOrEqual(1);
    expect(jump(at(0.75))).toBe(b.overflow);
    await expect(page).toHaveURL(/\/menu$/);
  });

  test("CAPTURE: a thumb drag that wanders left over the cards keeps scrolling the pane and opens nothing", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    const pane = menuPane(page);
    const b = await readBar(pane, "menu-scrollbar");
    const grip = thumbCentre(b);

    // The release point: inside a middle-column card below the grip, deep
    // enough that it stays inside after the pane scrolls under it.
    const target = await page.evaluate((y) => {
      for (const card of Array.from(document.querySelectorAll('[data-testid^="item-"]'))) {
        const r = card.getBoundingClientRect();
        if (r.right < 1000 && r.left > 500 && r.top > y + 20 && r.bottom < 1600) {
          return { x: r.left + r.width / 2, y: r.top + 100 };
        }
      }
      return null;
    }, grip);
    expect(target, "precondition: a card below the grip").not.toBeNull();
    if (!target) return;

    await recordInput(page);
    await page.mouse.move(BAR_X, grip);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    const expected = Math.min(1, (target.y - grip) / b.travel) * b.overflow;
    await expectScrollNear(pane, expected, 2, "the drag follows the pointer's y off the bar");
    expect(
      await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-testid^="item-"]')),
        target
      ),
      "precondition: the release is over a card"
    ).toBe(true);
    await page.mouse.up();

    await expect.poll(() => inputLog(page)).toContainEqual(expect.stringMatching(/^click:/));
    const log = await inputLog(page);
    expect(log[0]).toBe("pointerdown:menu-scrollbar-hit");
    expect(log.filter((e) => /item-|quick-add-/.test(e)), "no card saw the press or the click").toEqual(
      []
    );
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("customization-screen")).toHaveCount(0);
    await expect(bagButton(page)).toContainText("(0)");
  });

  test("CONTENT: the strip steals nothing — the gutter measurement at the top, middle and end in EN, ADA, AR+ADA and AR; a card beside it opens, a quick-add beside it adds", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    const pane = menuPane(page);
    const strip = page.getByTestId("menu-scrollbar-hit");

    // EN
    await expectGutterClear(pane, "menu-scrollbar", "menu EN", { cards: true });
    // A right-column card inside the bar's y-range opens from x 1050.
    const card = page.getByTestId(`item-${BEEF_BURGER}`);
    const box = await stageBox(card);
    expect(box.x + box.width, "precondition: the right column").toBe(CONTENT_EDGE);
    const mid = box.y + box.height / 2;
    expect(mid).toBeGreaterThan(MENU_STRIP.y);
    expect(mid).toBeLessThan(MENU_STRIP.y + MENU_STRIP.height);
    await page.mouse.click(1050, mid);
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible();

    // ADA (EN)
    await page.getByTestId("footer-ada").click();
    await expect.poll(() => stageBox(strip)).toEqual(MENU_STRIP_ADA);
    await expectThumbTracksPane(pane, "menu-scrollbar");
    await expectGutterClear(pane, "menu-scrollbar", "menu ADA", { cards: true });
    // At the end, Caesar's quick-add (x 1000–1044) sits beside the strip.
    await setScrollTop(pane, 1e6);
    const plus = await stageBox(page.getByTestId(`quick-add-${CAESAR}`));
    const plusMid = plus.y + plus.height / 2;
    expect(plus.x + plus.width).toBeLessThanOrEqual(CONTENT_EDGE);
    expect(plusMid).toBeGreaterThan(MENU_STRIP_ADA.y);
    expect(plusMid).toBeLessThan(MENU_STRIP_ADA.y + MENU_STRIP_ADA.height);
    await expect(bagButton(page)).toContainText("(0)");
    await page.mouse.click(1040, plusMid);
    await expect(bagButton(page)).toContainText("(1)");
    await expect(page).toHaveURL(/\/menu$/);

    // AR + ADA
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect.poll(() => stageBox(strip)).toEqual(MENU_STRIP_ADA);
    await expectGutterClear(pane, "menu-scrollbar", "menu AR ADA", { cards: true });

    // AR
    await page.getByTestId("footer-ada").click();
    await expect.poll(() => stageBox(strip)).toEqual(MENU_STRIP);
    await expectThumbTracksPane(pane, "menu-scrollbar");
    await expectGutterClear(pane, "menu-scrollbar", "menu AR", { cards: true });
  });

  test("PDP: the Dream box bar drags #scrollCustomizableItem to its end and back; the gutter is clear in EN, ADA and AR; the title Counter's + beside the strip still counts", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await openPdp(page, DREAM_BOX);
    const pane = pdpPane(page);
    const strip = page.getByTestId("pdp-scrollbar-hit");
    await expect(strip).toBeVisible();
    expect(await stageBox(strip)).toEqual(PDP_STRIP);

    await dragEndToEnd(page, pane, "pdp-scrollbar");
    await expectGutterClear(pane, "pdp-scrollbar", "PDP EN");

    // ADA: the + (x 992–1056) overlaps the strip's y-range at the top.
    await page.getByTestId("footer-ada").click();
    await expect.poll(() => stageBox(strip)).toEqual(PDP_STRIP_ADA);
    await toTop(pane, "pdp-scrollbar");
    await expectGutterClear(pane, "pdp-scrollbar", "PDP ADA");
    const y = await plusBesideStrip(page);
    const qty = page.getByTestId("pdp-qty");
    await expect(qty).toHaveText("1");
    await page.mouse.click(1050, y);
    await expect(qty).toHaveText("2");
    // The same row on the bar (the thumb is there at the top): the bar takes it.
    await page.mouse.click(BAR_X, y);
    expect(await scrollTopOf(pane)).toBe(0);
    await expect(qty).toHaveText("2");

    // AR + ADA, then AR.
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expectGutterClear(pane, "pdp-scrollbar", "PDP AR ADA");
    await page.getByTestId("footer-ada").click();
    await expect.poll(() => stageBox(strip)).toEqual(PDP_STRIP);
    await expectThumbTracksPane(pane, "pdp-scrollbar");
    await expectGutterClear(pane, "pdp-scrollbar", "PDP AR");
  });

  test("ADA MENU: a drag in the reach zone (798+170 / 578) takes the pane to its end and back", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await page.getByTestId("footer-ada").click();
    await expect.poll(() => stageBox(page.getByTestId("menu-scrollbar-hit"))).toEqual(MENU_STRIP_ADA);
    await dragEndToEnd(page, menuPane(page), "menu-scrollbar");
  });

  test("TIER-2: the EN page fits (no strip, nothing captured); in ADA its bar drags the page to its end and back, and the gutter is clear in ADA and AR+ADA", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await openPdp(page, DREAM_BOX);
    const sheet = page.getByTestId("tier2-sheet");
    const strip = page.getByTestId("tier2-scrollbar-hit");
    const pane = tier2Pane(page);

    // EN: the page fits, so neither the track nor the strip shows.
    await page.getByTestId(`pack-slot-customize-${G_SIDES}`).click();
    await expect(sheet).toBeVisible();
    expect(await pane.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId("tier2-scrollbar")).toBeHidden();
    await expect(strip).toBeHidden();
    expect(
      await page.evaluate(
        (x) => document.elementFromPoint(x, 1000)?.getAttribute("data-testid") ?? null,
        BAR_X
      )
    ).not.toBe("tier2-scrollbar-hit");
    await page.getByTestId("tier2-sheet-close").click();
    await expect(sheet).toHaveCount(0);

    // ADA: a shorter pane that overflows.
    await page.getByTestId("footer-ada").click();
    await expect.poll(() => stageBox(page.getByTestId("pdp-scrollbar-hit"))).toEqual(PDP_STRIP_ADA);
    await page.getByTestId(`pack-slot-customize-${G_SIDES}`).click();
    await expect(sheet).toBeVisible();
    await expect(strip).toBeVisible();
    expect(await stageBox(strip)).toEqual(PDP_STRIP_ADA);
    await expectGutterClear(pane, "tier2-scrollbar", "tier-2 ADA");
    await dragEndToEnd(page, pane, "tier2-scrollbar");
    await page.getByTestId("tier2-sheet-close").click();
    await expect(sheet).toHaveCount(0);

    // AR + ADA
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await page.getByTestId(`pack-slot-customize-${G_SIDES}`).click();
    await expect(sheet).toBeVisible();
    await expect(strip).toBeVisible();
    await expectGutterClear(pane, "tier2-scrollbar", "tier-2 AR ADA");
  });

  test("FIT AGAIN: a PDP that overflows only in ADA (Large Fries) — ADA on shows the strip with the track and it drags; ADA off hides both again, so no dead hit zone stays over a page that fits", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await openPdp(page, LARGE_FRIES);
    const pane = pdpPane(page);
    const track = page.getByTestId("pdp-scrollbar");
    const strip = page.getByTestId("pdp-scrollbar-hit");
    const overflow = () => pane.evaluate((el) => el.scrollHeight - el.clientHeight);

    expect(await overflow(), "precondition: the EN page fits").toBeLessThanOrEqual(2);
    await expect(track).toBeHidden();
    await expect(strip).toBeHidden();

    // The same mounted bar: ADA makes the page overflow...
    await page.getByTestId("footer-ada").click();
    await expect.poll(overflow).toBeGreaterThan(100);
    await expect(strip).toBeVisible();
    expect(await stageBox(strip)).toEqual(PDP_STRIP_ADA);
    await dragEndToEnd(page, pane, "pdp-scrollbar");

    // ...and fit again: the strip goes with the track.
    await page.getByTestId("footer-ada").click();
    await expect.poll(overflow).toBeLessThanOrEqual(2);
    await expect(track).toBeHidden();
    await expect(strip).toBeHidden();
  });

  test("IDLE: a drag on the bar is guest activity — 90 s idle, a drag, 20 s more: no prompt (without the drag it opens at 100 s); 100 s after the drag it opens", async ({
    page,
  }) => {
    test.slow();
    // Before ANY page script: react-idle-timer captures the timers at module
    // load (idle.spec.ts). Never jump past the 100 s prompt in one go.
    await page.clock.install();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    const pane = menuPane(page);
    const grip = thumbCentre(await readBar(pane, "menu-scrollbar"));
    const prompt = page.getByTestId("idle-modal");

    // The last activity before the wait: the pointer arrives on the thumb.
    await page.mouse.move(BAR_X, grip);
    await page.clock.fastForward(90_000);
    await page.clock.runFor(500);
    await expect(prompt).toHaveCount(0);

    // The drag is the only input from here on. react-idle-timer hears only
    // its compat mousedown / mousemove (it listens to no pointer event).
    await page.mouse.down();
    await page.mouse.move(BAR_X, grip + 20, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => scrollTopOf(pane), { message: "a real drag" }).toBeGreaterThan(0);

    // 110 s after the pointer arrived: without the drag the prompt opened at 100 s.
    await page.clock.fastForward(20_000);
    await page.clock.runFor(500);
    await expect(prompt).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);

    // Control: the timer is live and counts from the drag.
    await page.clock.fastForward(80_000);
    await expect(prompt).toBeVisible();
  });

  test("A11Y: the track and the strip are aria-hidden, with no role and no tab stop; a press never focuses the strip and Tab cycles the page without landing on it", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    for (const id of ["menu-scrollbar", "menu-scrollbar-hit"]) {
      const node = page.getByTestId(id);
      await expect(node).toHaveAttribute("aria-hidden", "true");
      await expect(node).not.toHaveAttribute("role");
      await expect(node).not.toHaveAttribute("tabindex");
    }

    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return el?.getAttribute("data-testid") ?? el?.tagName ?? "none";
      });
    await page.mouse.click(BAR_X, MENU_STRIP.y + 100);
    expect(await focused()).not.toMatch(/scrollbar/);

    await page.keyboard.press("Tab");
    const first = await focused();
    expect(first).not.toMatch(/scrollbar/);
    const walk: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      await page.keyboard.press("Tab");
      walk.push(await focused());
      if (walk.at(-1) === first) break;
    }
    expect(walk.at(-1), "Tab came back round to the first stop").toBe(first);
    expect(walk.length, "the walk crossed the page").toBeGreaterThan(10);
    expect(walk.filter((id) => /scrollbar/.test(id))).toEqual([]);
  });

  test("SNAP-BACK: grabbing the thumb while a rail tap's smooth scroll runs carries on from where the pane is (ADA menu)", async ({
    page,
  }) => {
    test.slow();
    // The rail tap scrolls smoothly only WITHOUT reduced motion (motion lane:
    // scrollBehavior() jumps under reduce, the suite's default since
    // playwright.config) — this case needs a smooth scroll to grab.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await page.getByTestId("footer-ada").click();
    await expect.poll(() => stageBox(page.getByTestId("menu-scrollbar-hit"))).toEqual(MENU_STRIP_ADA);
    const pane = menuPane(page);
    await toTop(pane, "menu-scrollbar");
    const grip = thumbCentre(await readBar(pane, "menu-scrollbar"));

    // Where the pane is when the press lands.
    await pane.evaluate((el) => {
      const w = window as unknown as { __pressTop?: number };
      window.addEventListener(
        "pointerdown",
        () => {
          w.__pressTop = el.scrollTop;
        },
        { capture: true, once: true }
      );
    });
    // x 1074: the strip's outer half, right of the visible track.
    await page.mouse.move(1074, grip);
    await page.locator('[data-testid^="rail-"]').last().dispatchEvent("click");
    await page.mouse.down();
    let previous = Number.NaN;
    await expect
      .poll(
        async () => {
          const now = await scrollTopOf(pane);
          const settled = now > 0 && now === previous;
          previous = now;
          return settled;
        },
        { message: "the smooth scroll settles under the held thumb", intervals: [150] }
      )
      .toBe(true);
    const held = await readBar(pane, "menu-scrollbar");
    const perPx = held.overflow / held.travel;
    const pressTop = await page.evaluate(() => (window as unknown as { __pressTop?: number }).__pressTop);
    expect(pressTop, "precondition: the press landed").toBeDefined();
    expect(
      held.scrollTop - (pressTop ?? held.scrollTop),
      "precondition: the pane moved on under the held thumb"
    ).toBeGreaterThan(100);
    // 10 px back up in ONE move (the pane settled near its end). A re-base that
    // swallowed the move triggering it would be ~31 px short; a 1 px move
    // (~3 px of scroll) would hide that inside the tolerance.
    expect(held.scrollTop, "precondition: room to move back").toBeGreaterThan(10 * perPx + 3);

    await page.mouse.move(1074, grip - 10);
    await expectScrollNear(
      pane,
      held.scrollTop - 10 * perPx,
      3,
      "10 px back from where the pane is, not from where the press began"
    );
    await page.mouse.up();
  });

  test.describe("touch (CDP, hasTouch)", () => {
    test.use({ hasTouch: true });

    test("TOUCH THUMB: a finger drags the thumb proportionally with no pointercancel; the same 60 px swipe on the cards still pans natively", async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await bootRegisteredToMenu(page);
      await page.getByTestId("footer-ada").click();
      await expect.poll(() => stageBox(page.getByTestId("menu-scrollbar-hit"))).toEqual(MENU_STRIP_ADA);
      const pane = menuPane(page);
      await toTop(pane, "menu-scrollbar");
      const cdp = await page.context().newCDPSession(page);
      await recordInput(page);

      // On the thumb: 60 px of finger is 60/travel of the overflow.
      const b = await readBar(pane, "menu-scrollbar");
      const finger = { x: BAR_X, y: thumbCentre(b) };
      await fingerDown(cdp, finger);
      await fingerMove(cdp, finger, 60);
      await expectScrollNear(pane, (60 / b.travel) * b.overflow, 2, "the bar maps the finger proportionally");
      await fingerUp(cdp);
      expect(await inputLog(page)).toEqual(["pointerdown:menu-scrollbar-hit"]);
      await clearInput(page);

      // On the cards: the native pan, 1:1 less Chromium's 15 px touch slop —
      // and the browser takes the pointer (touch-none is what keeps the
      // bar's pointer stream alive).
      await toTop(pane, "menu-scrollbar");
      const content = { x: 700, y: MENU_STRIP_ADA.y + 300 };
      await fingerDown(cdp, content);
      await fingerMove(cdp, content, -60);
      await expect.poll(() => scrollTopOf(pane)).toBeGreaterThanOrEqual(40);
      expect(await scrollTopOf(pane)).toBeLessThanOrEqual(60);
      await fingerUp(cdp);
      const pan = await inputLog(page);
      expect(pan.some((e) => e.startsWith("pointercancel:")), "the browser took the pointer for its pan").toBe(true);
      expect(pan.filter((e) => /scrollbar/.test(e))).toEqual([]);
    });

    test("TOUCH MENU: a fingertip (r15) on the visible bar beside a card grabs the bar, never the card; content taps at x 1050 / 1054 still open it", async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await bootRegisteredToMenu(page);
      const pane = menuPane(page);
      const cdp = await page.context().newCDPSession(page);
      const card = page.getByTestId(`item-${BEEF_BURGER}`);
      const cardMid = async () => {
        const box = await stageBox(card);
        expect(box.x + box.width, "precondition: the right column").toBe(CONTENT_EDGE);
        const y = box.y + box.height / 2;
        expect(y > MENU_STRIP.y && y < MENU_STRIP.y + MENU_STRIP.height, "precondition: beside the strip").toBe(
          true
        );
        return y;
      };
      await recordInput(page);

      const y = await cardMid();
      for (const r of [1, 15]) {
        await tap(cdp, { x: BAR_X, y, r });
        await expectTapOn(page, "menu-scrollbar-hit");
      }
      await expect(page).toHaveURL(/\/menu$/);
      await expect(bagButton(page)).toContainText("(0)");

      // A fingertip drag from the same spot scrolls the pane.
      const b = await readBar(pane, "menu-scrollbar");
      await fingerDown(cdp, { x: BAR_X, y, r: 15 });
      await fingerMove(cdp, { x: BAR_X, y, r: 15 }, 30);
      await expectScrollNear(pane, Math.min(1, 30 / b.travel) * b.overflow, 2);
      await fingerUp(cdp);
      await clearInput(page);

      // Fingertips just left of the strip stay with the card.
      for (const x of [1050, 1054]) {
        await toTop(pane, "menu-scrollbar");
        await tap(cdp, { x, y: await cardMid(), r: 15 });
        await expect(page.getByTestId("customization-screen")).toBeVisible();
        expect((await inputLog(page))[0]).toBe(`pointerdown:item-${BEEF_BURGER}`);
        await clearInput(page);
        await page.getByTestId("pdp-back").click();
        await expect(page.getByTestId("menu-screen")).toBeVisible();
        await clearInput(page);
      }
    });

    test("TOUCH PDP: in ADA a fingertip on the bar beside the title Counter's + leaves the quantity alone; the + still counts at x 1040 and x 1054 (r14)", async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await bootRegisteredToMenu(page);
      await openPdp(page, DREAM_BOX);
      await page.getByTestId("footer-ada").click();
      await expect.poll(() => stageBox(page.getByTestId("pdp-scrollbar-hit"))).toEqual(PDP_STRIP_ADA);
      const pane = pdpPane(page);
      await toTop(pane, "pdp-scrollbar");
      const cdp = await page.context().newCDPSession(page);
      const y = await plusBesideStrip(page);
      const qty = page.getByTestId("pdp-qty");
      await expect(qty).toHaveText("1");
      await recordInput(page);

      for (const r of [1, 14, 15]) {
        await tap(cdp, { x: BAR_X, y, r });
        await expectTapOn(page, "pdp-scrollbar-hit");
        await expect(qty).toHaveText("1");
      }
      expect(await scrollTopOf(pane)).toBe(0);

      await tap(cdp, { x: 1040, y, r: 1 });
      await expect(qty).toHaveText("2");
      await tap(cdp, { x: 1054, y, r: 14 });
      await expect(qty).toHaveText("3");
    });

    test("TOUCH OWNER: the first finger owns the drag — a second finger on the strip never jumps, drives or ends it; a cancelled touch ends the drag, so the next finger's press jumps", async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await bootRegisteredToMenu(page);
      await page.getByTestId("footer-ada").click();
      await expect.poll(() => stageBox(page.getByTestId("menu-scrollbar-hit"))).toEqual(MENU_STRIP_ADA);
      const pane = menuPane(page);
      await toTop(pane, "menu-scrollbar");
      const cdp = await page.context().newCDPSession(page);
      await recordInput(page);

      const b = await readBar(pane, "menu-scrollbar");
      const at = (fraction: number) => b.top + fraction * (b.bottom - b.top);
      /** Finger A holds the thumb's centre from scrollTop 0: dy of finger is dy/travel of the overflow. */
      const dragged = (dy: number) => (dy / b.travel) * b.overflow;
      const jump = (y: number) => Math.min(1, Math.max(0, (y - b.top - b.thumbH / 2) / b.travel)) * b.overflow;
      /** "Nothing moved" is never polled (it would pass at once): two frames let every move land, then one read. */
      const expectStill = async (expected: number, message: string) => {
        await nextFrames(page);
        expect(Math.abs((await scrollTopOf(pane)) - expected), message).toBeLessThanOrEqual(2);
      };

      const a = { x: BAR_X, y: thumbCentre(b), id: 0 };
      await fingerDown(cdp, a);
      await fingerMove(cdp, a, 30);
      await expectScrollNear(pane, dragged(30), 2, "finger A drags the thumb");

      // Finger B lands below the thumb (a press there would jump to the end), moves, lifts.
      const fingerB = { x: BAR_X, y: at(0.9), id: 1 };
      expect(jump(fingerB.y) - dragged(30), "precondition: B's press would jump").toBeGreaterThan(300);
      await fingerDown(cdp, fingerB);
      await expectStill(dragged(30), "a second finger's press never jumps");
      await fingerMove(cdp, fingerB, -100);
      await expectStill(dragged(30), "nor do its moves drive the bar");
      await fingerUp(cdp, { ...fingerB, y: fingerB.y - 100 });
      await fingerMove(cdp, { ...a, y: a.y + 30 }, 30);
      await expectScrollNear(pane, dragged(60), 2, "nor did its lift end A's drag");
      expect(await inputLog(page), "precondition: both fingers landed on the strip").toEqual([
        "pointerdown:menu-scrollbar-hit",
        "pointerdown:menu-scrollbar-hit",
      ]);

      // The panel cancels the touch (pointercancel): the drag ends where it is...
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await expect.poll(() => inputLog(page)).toContain("pointercancel:menu-scrollbar-hit");
      await expectStill(dragged(60), "the cancel moves nothing");
      // ...so the next finger's press below the thumb jumps (a stuck drag would ignore it).
      const c = { x: BAR_X, y: at(0.7), id: 2 };
      expect(c.y, "precondition: C is below the thumb").toBeGreaterThan(
        b.top + (dragged(60) / b.overflow) * b.travel + b.thumbH
      );
      await fingerDown(cdp, c);
      await expectScrollNear(pane, jump(c.y), 2, "the next finger's press jumps");
      await fingerUp(cdp);
    });
  });
});
