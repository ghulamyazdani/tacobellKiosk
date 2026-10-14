import { test, expect, type Page } from "./fixtures/kiosk";
import { mockKioskBackend, holdRequests, locale } from "./fixtures/backend";
import { registerToStart, startOrderTo, chooseLanguage } from "./pages/boot";
import { typeDigits } from "./pages/order";
import { stageBox, type StageBox } from "./fixtures/a11y";
import { settle, shot } from "./fixtures/capture";
import { clippedText } from "./fixtures/clippedText";
import { mockXenoLoyalty, LOYALTY_PHONE, LOYALTY_SETTINGS } from "./fixtures/loyalty";

/**
 * /phone's layout, measured (user 2026-10-14: "the continue and back button should be at the bottom
 * just like table screen and also content should be at the middle of screen as well").
 *
 * CONTINUE and BACK are /tent's CONFIRM / NO THANKS pair: 1032×84 at x 24, 24 px apart, 24 px off the
 * bottom edge. /phone keeps its 56 px footer (CANCEL ORDER · ADA · language), which /tent has none of,
 * so the edge is the footer's top (1864): CONTINUE 1648, BACK 1756 — /tent's 1704 / 1812 would put
 * BACK under the footer. The pair is bottom-anchored, so the ADA zone (bottom-aligned with the stage)
 * keeps the same stage px. Title, subtitle, entry row, keypad and SKIP are one block, centred in the
 * free area: the stage (ADA: zone) top → CONTINUE's top minus the pair's 24 px.
 *
 * Every box is in stage design px (fixtures/a11y stageBox). Geometry is SOFT, so one run reports all
 * four states (EN / AR × normal / ADA). SKIP is on (an optional phone number), so the block is at its
 * tallest. Each state attaches a capture for the design review.
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
/** The block's centre vs the free area's. */
const CENTRE_TOLERANCE = 8;

async function bootToPhone(page: Page) {
  await mockKioskBackend(page, {
    arabic: true,
    settings: { ...LOYALTY_SETTINGS, crm_phone_mandatory: false, accessibility_mode: true },
  });
  // Newest route wins: the Xeno surface goes last.
  await mockXenoLoyalty(page);
  await registerToStart(page);
  await startOrderTo(page, "phone-screen");
}

/** The parts the layout places, in stage px. */
async function measure(page: Page) {
  await settle(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const block = page.getByTestId("phone-content").locator(":scope > *");
  const parts: Record<string, StageBox> = {};
  const count = await block.count();
  for (let i = 0; i < count; i += 1) parts[`block[${i}]`] = await stageBox(block.nth(i));
  parts.continue = await stageBox(page.getByTestId("phone-continue"));
  parts.back = await stageBox(page.getByTestId("phone-back"));
  parts.footer = await stageBox(page.getByTestId("footer-cancel").locator(".."));
  const bell = page.getByTestId("phone-screen").getByRole("img", { name: "Taco Bell" });
  if (await bell.count()) parts.bell = await stageBox(bell);
  return { parts, blockCount: count };
}

const overlaps = (a: StageBox, b: StageBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

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
  soft(await uncovered(page, "phone-continue"), `${label}: CONTINUE uncovered`).toBe(true);
  soft(await uncovered(page, "phone-back"), `${label}: BACK uncovered`).toBe(true);
  // ONE back: the top-left one is gone. (Arabic labels arrive in bidi isolates, U+2068…U+2069.)
  const backName = new RegExp(`^\\u2068?${(lang === "ar" ? ar : en).phone.back}\\u2069?$`);
  soft(await page.getByRole("button", { name: backName }).count(), `${label}: one BACK`).toBe(1);

  // The block: title, subtitle, entry row, keypad, SKIP — centred in the free area.
  soft(blockCount, `${label}: the block's parts`).toBe(5);
  // The old spacing: the subtitle two title lines (140) under the title's top, so a one-line
  // (Arabic) title's descenders never touch it.
  const [title, subtitle] = [parts["block[0]"], parts["block[1]"]];
  soft(subtitle && title ? subtitle.y - title.y : -1, `${label}: subtitle under the title`).toBeGreaterThanOrEqual(140);
  const boxes = Object.entries(parts).filter(([name]) => name.startsWith("block["));
  const top = Math.min(...boxes.map(([, b]) => b.y));
  const bottom = Math.max(...boxes.map(([, b]) => b.y + b.height));
  const freeTop = ada ? ADA_BRAND_ZONE_HEIGHT : 0;
  const freeBottom = CONTINUE_BOX.y - GAP;
  soft(
    Math.abs((top + bottom) / 2 - (freeTop + freeBottom) / 2),
    `${label}: block centre ${(top + bottom) / 2} vs free-area centre ${(freeTop + freeBottom) / 2}`
  ).toBeLessThanOrEqual(CENTRE_TOLERANCE);
  soft(top, `${label}: block top inside the free area`).toBeGreaterThanOrEqual(parts.bell ? parts.bell.y + parts.bell.height : freeTop);
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
  await shot(page, `phone-${label}`);
}

test.describe("/phone layout (user 2026-10-14)", () => {
  test("the bottom pair sits on the footer as /tent's CONFIRM / NO THANKS and the block is centred above it — EN and AR, normal and ADA; BACK still leaves", async ({
    page,
  }) => {
    test.slow();
    await bootToPhone(page);

    await expectLayout(page, "en", { ada: false, lang: "en" });
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await expectLayout(page, "en-ada", { ada: true, lang: "en" });
    await chooseLanguage(page, "ar");
    await expectLayout(page, "ar-ada", { ada: true, lang: "ar" });
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toHaveCount(0);
    await expectLayout(page, "ar", { ada: false, lang: "ar" });

    // The relocated BACK keeps its exit: pre-menu → /second.
    await page.getByTestId("phone-back").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
  });

  test("CONTINUE on white still reads as disabled while the lookup is in flight, then carries on", async ({ page }) => {
    test.slow();
    await bootToPhone(page);
    const lookup = await holdRequests(page, /\/api\/partners\/execute_event/);
    await typeDigits(page, LOYALTY_PHONE);

    const button = page.getByTestId("phone-continue");
    await expect(button).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(button).toHaveCSS("opacity", "1");
    await button.click();
    await expect.poll(() => lookup.count).toBe(1);
    await expect(button).toBeDisabled();
    await expect(button).toHaveText(en.phone.checking);
    await expect(button).toHaveCSS("opacity", "0.6");

    await lookup.release();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  });
});
