import { test, expect, type Locator, type Page } from "./fixtures/kiosk";
import { mockKioskBackend, DINE_IN, CHEESE_BURGER, GREEK_SALAD, TORTILLA_SAUCE } from "./fixtures/backend";
import { bootRegisteredToMenu, registerToStart, startToSecond } from "./pages/boot";
import { addOneTap, addViaPdp, openBag } from "./pages/order";

/**
 * Perf pass, lane paint-touch — the paint and touch contract in a real Chromium (src/__tests__/paintCss.test.ts
 * pins the CSS text; this proves the cascade and the behaviour).
 *
 * PAINT-1: a scroller paints an opaque tb-surface of its own (at a device scale below 1.5 Chromium composites a
 * scroller only then; without it every scroll frame was a main-thread repaint) — the bag list here. A bg-*
 * utility beats the components layer, so the opt-outs keep today's paint: the menu pane and rail (their photos
 * multiply-blend) and /second's swipe row over the texture.
 * PAINT-4: the root is pan-only — desktop Chrome / Edge ignore the viewport meta's user-scalable=no, so a
 * two-finger pinch used to zoom the stage for every later guest — while every scroller still pans, vertically and
 * sideways; no picture lifts a drag ghost.
 *
 * Touch input is CDP's synthetic gestures (the perf bench's fling): touch events through the compositor, as the
 * kiosk's panel sends them.
 */

test.use({ hasTouch: true });

const WHITE = "rgb(255, 255, 255)";
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const MORE_PIPELINES = [
  ["take_away", "Take Away"],
  ["drive_thru", "Drive-Thru"],
  ["delivery", "Delivery"],
  ["kerbside", "Kerbside"],
].map(([tab_type, primary_name], i) => ({ _id: `p${i + 2}`, tab_id: `t${i + 2}`, tab_type, primary_name }));

/** A touch drag from the box's centre by (x, y) px, through the compositor (CDP Input.synthesizeScrollGesture). */
async function touchPan(page: Page, target: Locator, x: number, y: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("no box to pan");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    xDistance: x,
    yDistance: y,
    speed: 1_500,
    gestureSourceType: "touch",
  });
  await cdp.detach();
}

const scrollTop = (scroller: Locator) => scroller.evaluate((el) => el.scrollTop);

test("/menu: the root is pan-only and no picture drags; the pane and the rail keep today's paint; a touch pan scrolls the pane and a two-finger pinch zooms nothing", async ({
  page,
}) => {
  await mockKioskBackend(page);
  await bootRegisteredToMenu(page);

  expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe("pan-x pan-y");
  const drags = await page.evaluate(() => [
    ...new Set([...document.images].map((img) => getComputedStyle(img).getPropertyValue("-webkit-user-drag"))),
  ]);
  expect(drags).toEqual(["none"]);

  const pane = page.getByTestId("menu-screen").locator("[data-testid^='section-']").first().locator("xpath=..");
  await expect(pane).toHaveCSS("background-color", TRANSPARENT);
  await expect(page.getByTestId("category-rail").locator(".overflow-y-auto")).toHaveCSS("background-color", TRANSPARENT);
  await touchPan(page, pane, 0, -400);
  await expect.poll(() => scrollTop(pane)).toBeGreaterThan(0);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizePinchGesture", { x: 540, y: 960, scaleFactor: 2, gestureSourceType: "touch" });
  await cdp.detach();
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
});

test("/cart (ADA, the 765 px bag that always scrolls): the bag list paints its own white and still pans by touch", async ({
  page,
}) => {
  await mockKioskBackend(page, { settings: { accessibility_mode: true } });
  await bootRegisteredToMenu(page);
  await page.getByTestId("footer-ada").click();
  await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
  await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });
  await addOneTap(page, GREEK_SALAD, "(2)");
  await addOneTap(page, TORTILLA_SAUCE, "(3)");
  await openBag(page);
  const list = page.getByTestId("bag-sheet").locator(".overflow-y-auto");
  await expect(list).toHaveCSS("background-color", WHITE);
  expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight), "the bag overflows").toBeGreaterThan(0);
  await touchPan(page, list, 0, -300);
  await expect.poll(() => scrollTop(list)).toBeGreaterThan(0);
});

test("/second: the five-card swipe row over the texture stays transparent and still pans sideways by touch", async ({ page }) => {
  await mockKioskBackend(page, { pipelines: [DINE_IN, ...MORE_PIPELINES] });
  await registerToStart(page);
  await startToSecond(page);
  const row = page.getByTestId("pipeline-p1").locator("xpath=..");
  await expect(row).toHaveCSS("overflow-x", "auto");
  await expect(row).toHaveCSS("background-color", TRANSPARENT);
  await touchPan(page, row, -300, 0);
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});
