import { test, expect, type Page } from "./fixtures/kiosk";
import { mockKioskBackend, locale, GREEK_SALAD } from "./fixtures/backend";
import { registerToStart, startToSecond, pickPipelineToMenu, chooseLanguage } from "./pages/boot";
import { addOneTap, openBag } from "./pages/order";
import { stageBox, type StageBox } from "./fixtures/a11y";
import { settle, shot } from "./fixtures/capture";
import { clippedText } from "./fixtures/clippedText";

/**
 * /customerName's layout, measured (user 2026-10-15: "whatever you did for phone number screen do same
 * for customer name screen" — /phone's is phoneLayout.spec.ts, and this mirrors it).
 *
 * CONTINUE and BACK are /tent's CONFIRM / NO THANKS pair, 24 px above the footer as on /phone: 1032×84
 * at x 24, CONTINUE 1648, BACK 1756, footer 1864. Bottom-anchored, so the ADA zone (bottom-aligned with
 * the stage) keeps the same stage px. One BACK: the top-left one is gone. Title, subtitle, name field
 * and keyboard are one block, centred in the free area: 24 px under the bell (ADA: the zone's top, no
 * bell) → 24 px above CONTINUE. So, as on /tent and /phone, the block sits as far under the bell as
 * above CONTINUE. The keyboard keeps its size.
 *
 * Every box is in stage design px (fixtures/a11y stageBox). Geometry is SOFT, so one run reports all
 * four states (EN / AR × normal / ADA). A typed name puts the field's clear button up, so the field is
 * measured at its fullest. Each state attaches a capture for the design review.
 */

const en = locale("en");
const ar = locale("ar");

// ---- Mirrors KioskStage (ADA_BRAND_ZONE_HEIGHT) and FooterBar (56 px) ----
const STAGE_HEIGHT = 1920;
const ADA_BRAND_ZONE_HEIGHT = 798;
const FOOTER_TOP = STAGE_HEIGHT - 56;
/** /tent's pair rhythm: between the two buttons, and to the bottom edge. */
const GAP = 24;
const BACK_BOX: StageBox = { x: 24, y: FOOTER_TOP - GAP - 84, width: 1032, height: 84 }; // 1756
const CONTINUE_BOX: StageBox = { x: 24, y: BACK_BOX.y - GAP - 84, width: 1032, height: 84 }; // 1648
/** /tent's bell, 135–224 (normal mode). */
const BELL_BOTTOM = 135 + 89;
/** The block's centre vs the free area's; the room under the bell vs above CONTINUE. */
const CENTRE_TOLERANCE = 8;
/** KioskKeyboard as it always was: 1000 wide, four rows of 90 px keys 23 px apart. */
const KEYBOARD = { width: 1000, height: 4 * 90 + 3 * 23 };
/** The name field: a fixed 100 px in the flex column, which flex must never shrink. */
const FIELD = { width: 844, height: 100 };

/**
 * PAY with CRM shown and loyalty off: the bag → /phone (checkout mode) → SKIP → here. No number, so no
 * CRM lookup: the screen is up at once. BACK returns to /phone (back-nav).
 */
async function bootToName(page: Page) {
  await mockKioskBackend(page, {
    arabic: true,
    settings: { skip_crm_page: false, accessibility_mode: true },
  });
  await registerToStart(page);
  await startToSecond(page);
  await pickPipelineToMenu(page);
  await addOneTap(page, GREEK_SALAD, "(1)");
  await openBag(page);
  await page.getByTestId("bag-pay").click();
  await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("phone-skip").click();
  await expect(page.getByTestId("customer-name-screen")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("customer-name-loading")).toHaveCount(0);
}

/** The parts the layout places, in stage px. */
async function measure(page: Page) {
  await settle(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const block = page.getByTestId("customer-name-content").locator(":scope > *");
  const parts: Record<string, StageBox> = {};
  const count = await block.count();
  for (let i = 0; i < count; i += 1) parts[`block[${i}]`] = await stageBox(block.nth(i));
  parts.continue = await stageBox(page.getByTestId("customer-name-continue"));
  parts.back = await stageBox(page.getByTestId("customer-name-back"));
  parts.footer = await stageBox(page.getByTestId("footer-cancel").locator(".."));
  const bell = page.getByTestId("customer-name-screen").getByRole("img", { name: "Taco Bell" });
  if (await bell.count()) parts.bell = await stageBox(bell);
  return { parts, blockCount: count };
}

const overlaps = (a: StageBox, b: StageBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: StageBox, b: StageBox) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/** The topmost element at a control's centre is the control (or inside it): nothing covers it. */
const uncovered = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && el.contains(hit);
  });

async function expectLayout(page: Page, label: string, { ada, lang }: { ada: boolean; lang: "en" | "ar" }) {
  const { parts, blockCount } = await measure(page);
  const soft = expect.soft;

  // The pair: /tent's boxes, on the footer, in both modes.
  soft(parts.continue, `${label}: CONTINUE`).toEqual(CONTINUE_BOX);
  soft(parts.back, `${label}: BACK`).toEqual(BACK_BOX);
  soft(parts.footer.y, `${label}: the footer`).toBe(FOOTER_TOP);
  soft(await uncovered(page, "customer-name-continue"), `${label}: CONTINUE uncovered`).toBe(true);
  soft(await uncovered(page, "customer-name-back"), `${label}: BACK uncovered`).toBe(true);
  // ONE back: the top-left one is gone. (Arabic labels arrive in bidi isolates, U+2068…U+2069.)
  const backName = new RegExp(`^\\u2068?${(lang === "ar" ? ar : en).customerName.back}\\u2069?$`);
  soft(await page.getByRole("button", { name: backName }).count(), `${label}: one BACK`).toBe(1);

  // The block: title, subtitle, name field, keyboard — centred in the free area.
  soft(blockCount, `${label}: the block's parts`).toBe(4);
  // The old spacing: the subtitle 150 px under the title's top (two title lines + 10), so a one-line
  // title's descenders never touch it.
  const [title, subtitle, field, keyboard] = [0, 1, 2, 3].map((i) => parts[`block[${i}]`]);
  soft(subtitle && title ? subtitle.y - title.y : -1, `${label}: subtitle under the title`).toBeGreaterThanOrEqual(150);
  soft(
    keyboard && { width: keyboard.width, height: keyboard.height },
    `${label}: the keyboard keeps its size`
  ).toEqual(KEYBOARD);
  soft(field && { width: field.width, height: field.height }, `${label}: the field keeps its size`).toEqual(FIELD);
  // The field's clear button stays inside the field.
  const clear = await stageBox(page.getByTestId("customer-name-clear"));
  soft(Boolean(field) && inside(clear, field), `${label}: the clear button inside the field`).toBe(true);
  const boxes = Object.entries(parts).filter(([name]) => name.startsWith("block["));
  const top = Math.min(...boxes.map(([, b]) => b.y));
  const bottom = Math.max(...boxes.map(([, b]) => b.y + b.height));
  const freeTop = ada ? ADA_BRAND_ZONE_HEIGHT : BELL_BOTTOM + GAP;
  const freeBottom = CONTINUE_BOX.y - GAP;
  if (!ada) {
    // /tent's rule (342 px under the bell, 344 above CONFIRM): the middle of what the guest sees.
    const [under, over] = [top - BELL_BOTTOM, CONTINUE_BOX.y - bottom];
    soft(Math.abs(under - over), `${label}: ${under} px under the bell vs ${over} px above CONTINUE`).toBeLessThanOrEqual(
      CENTRE_TOLERANCE
    );
  }
  soft(
    Math.abs((top + bottom) / 2 - (freeTop + freeBottom) / 2),
    `${label}: block centre ${(top + bottom) / 2} vs free-area centre ${(freeTop + freeBottom) / 2}`
  ).toBeLessThanOrEqual(CENTRE_TOLERANCE);
  soft(top, `${label}: block top inside the free area`).toBeGreaterThanOrEqual(freeTop);
  soft(bottom, `${label}: block bottom clear of CONTINUE`).toBeLessThanOrEqual(freeBottom);
  soft(Boolean(parts.bell), `${label}: the bell (normal mode only)`).toBe(!ada);
  if (parts.bell) soft(parts.bell.y, `${label}: the bell at /tent's 135`).toBe(135);

  // Nothing overlaps anything else.
  const names = Object.keys(parts);
  const hits = names.flatMap((a, i) =>
    names.slice(i + 1).filter((b) => overlaps(parts[a], parts[b])).map((b) => `${a} × ${b}`)
  );
  soft(hits, `${label}: overlapping parts`).toEqual([]);
  soft(await clippedText(page), `${label}: text the layout cuts off`).toEqual([]);
  await shot(page, `name-${label}`);
}

test.describe("/customerName layout (user 2026-10-15)", () => {
  test("the bottom pair sits on the footer as /tent's CONFIRM / NO THANKS and the block is centred above it — EN and AR, normal and ADA; BACK still leaves for /phone", async ({
    page,
  }) => {
    test.slow();
    await bootToName(page);
    await page.getByRole("button", { name: "t", exact: true }).click();
    await page.getByRole("button", { name: "b", exact: true }).click();
    await expect(page.getByTestId("customer-name-input")).toHaveText("tb");

    await expectLayout(page, "en", { ada: false, lang: "en" });
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await expectLayout(page, "en-ada", { ada: true, lang: "en" });
    // Past the ADA ceiling (869, CustomerName's ponytail note) the block overflows, so expectLayout's
    // free-area and clippedText checks fail; it never squashes the field to fit them. A 900 brand zone,
    // emulated on the reach zone:
    const zone = page.getByTestId("reach-zone");
    const zoneHeight = await zone.evaluate((el) => el.style.height);
    await zone.evaluate((el, height) => {
      el.style.height = height;
    }, `${STAGE_HEIGHT - 900}px`);
    const squeezed = await stageBox(page.getByTestId("customer-name-content").locator(":scope > *").nth(2));
    expect
      .soft({ width: squeezed.width, height: squeezed.height }, "en-ada at a 900 brand zone: the field keeps its size")
      .toEqual(FIELD);
    await zone.evaluate((el, height) => {
      el.style.height = height;
    }, zoneHeight);
    await chooseLanguage(page, "ar");
    await expectLayout(page, "ar-ada", { ada: true, lang: "ar" });
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toHaveCount(0);
    await expectLayout(page, "ar", { ada: false, lang: "ar" });

    // The relocated BACK keeps its exit (back-nav): CRM shown, loyalty off → /phone.
    await page.getByTestId("customer-name-back").click();
    await expect(page).toHaveURL(/\/phone$/);
    await expect(page.getByTestId("phone-screen")).toBeVisible();
  });
});
