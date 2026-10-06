import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Post-P9 item 26: the Figma "Scroll bar" (1:5263) on /menu and the PDP,
 * end to end.
 *
 * It is an INDICATOR only (D3): an 11 px lilac track with a purple thumb,
 * `right-[12px]` over the pane's padding, aria-hidden and
 * pointer-events-none, so the native touch scroll stays the one gesture.
 * The native bar is hidden on both panes. Placements, in stage px from the
 * page root:
 *   /menu  1:2613 top 505 / h 790 · ADA 1:5412 top 170 / h 578
 *   PDP    1:2920 top 703 / h 790 · ADA 1:5442 top 488 / h 394
 * In ADA the page root starts at the reach zone (y 798), so the ADA boxes sit
 * at 798 + top.
 *
 * What only the running app can show: the geometry, a thumb that follows
 * the pane (scroll, an ADA flip, the PDP's own auto-scroll after a slot
 * pick), taps passing through, and the track hiding when the content fits.
 * The thumb is checked against the pane's live geometry: height ∝
 * clientHeight / scrollHeight, offset ∝ scrollTop / overflow (±1 px). Every
 * thumb in these fixtures is far above the 40 px floor.
 *
 * Headless Chromium hides native bars anyway, so the computed
 * `scrollbar-width: none` is all e2e can assert. The physical check is owed
 * (PROGRESS).
 *
 * ── MOCKS ───────────────────────────────────────────────────────────────
 * House order (idle.spec.ts / ada.spec.ts): the `**\/api/**` catch-all
 * FIRST, the print agent aborted, the Xeno revoke routed, then the specific
 * mocks (newest wins). `accessibility_mode: true` puts the ADA toggle in
 * the footer. Boot helpers and stageBox are copied from ada.spec.ts (house
 * precedent).
 */

const LOGIN_OK = {
  licenseDetails: {
    login_code: "mock-device-token",
    expiry_date: "2099-01-01T00:00:00.000Z",
  },
  deploymentDetails: {
    _id: "dep1",
    brand_id: "brand1",
    tenant_id: "tenant1",
    cluster_id: "cluster1",
  },
};

const slimMenu = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)),
    "utf-8"
  )
);

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json) ----
const SIDE_ORDERS = "5dd1092ecc7088762eee2659";
/** Pack PDP: four `_combo` slot cards + the Snacks group; overflows. */
const DREAM_BOX = "68dd79409030ed3064aee28c";
/** Nuggets slot (min 1): picking it auto-scrolls the PDP to the next group. */
const G_NUGGETS = `${DREAM_BOX}_5_combo`;
const NUGGETS_PICK = "66e952596dd4d13b6564a528";
/** One one-option addon group: its PDP fits the stage. */
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa";

// ---- Mirrors src/components/stage/KioskStage.tsx (ada.spec.ts) ----
const STAGE_HEIGHT = 1920;
const ADA_BRAND_ZONE_HEIGHT = 798;

/** Track boxes (stage px): x = 1080 − right 12 − width 11. */
const MENU_BAR = { x: 1057, y: 505, width: 11, height: 790 };
const MENU_BAR_ADA = { x: 1057, y: ADA_BRAND_ZONE_HEIGHT + 170, width: 11, height: 578 };
const PDP_BAR = { x: 1057, y: 703, width: 11, height: 790 };
const PDP_BAR_ADA = { x: 1057, y: ADA_BRAND_ZONE_HEIGHT + 488, width: 11, height: 394 };

async function mockKioskBackend(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them (header).
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) =>
    r.fulfill({ json: { status: "success" } })
  );
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: {},
      },
    })
  );
  await page.route("**/api/cx/getCxSkinData", (r) =>
    r.fulfill({ json: { skin_id: "skin_1" } })
  );
  await page.route("**/api/cx/kiosk/get_theme", (r) =>
    r.fulfill({
      json: {
        theme_color: [
          { key: "button_text_border_icon", color_hex: "#501098" },
          { key: "button_background", color_hex: "#ffffff" },
        ],
        primary_color_shades: [],
      },
    })
  );
  await page.route("**/api/cx/get_kiosk_settings", (r) =>
    r.fulfill({
      json: {
        start_order_text_primary: "START ORDER",
        ideal_time: "180",
        accessibility_mode: true,
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [
        { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" },
      ],
    })
  );
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/cx/kiosk/get_data", (r) =>
    r.fulfill({
      json: {
        charges: [],
        deployment: { countryCode: "GB", currencySettings: { symbol: "£" } },
      },
    })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
}

/** Register on the on-screen keyboard, then splash → order type → /menu. */
async function bootRegisteredToMenu(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

/** Menu card tap → its PDP. */
async function openPdp(page: Page, itemId: string) {
  const card = page.getByTestId(`item-${itemId}`);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
}

interface StageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The element's box in stage DESIGN px (KioskStage scale divided out), to 1px. */
function stageBox(locator: Locator): Promise<StageBox> {
  return locator.evaluate((el, stageHeight) => {
    const stage = document.querySelector('[data-testid="kiosk-stage"]');
    if (!stage) throw new Error("kiosk-stage is not mounted");
    const s = stage.getBoundingClientRect();
    const k = s.height / stageHeight;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round((b.left - s.left) / k),
      y: Math.round((b.top - s.top) / k),
      width: Math.round(b.width / k),
      height: Math.round(b.height / k),
    };
  }, STAGE_HEIGHT);
}

/** The menu's scroll pane: the parent of the category sections. */
const menuPane = (page: Page) =>
  page.getByTestId(`section-${SIDE_ORDERS}`).locator("xpath=..");
/** The PDP's scroll pane (its id is the SDK autoscroll contract). */
const pdpPane = (page: Page) => page.locator("#scrollCustomizableItem");

/**
 * How far the thumb is from where the pane's live geometry puts it, in px
 * (stage scale cancels out: every term is a ratio of client px).
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

/** Indicator only: a tap at the track's centre lands on the page beneath. */
function hitAtTrackCentre(track: Locator): Promise<string> {
  return track.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return "nothing";
    return el.contains(hit) ? "the indicator" : "the page beneath";
  });
}

const scrollbarWidth = (pane: Locator) =>
  pane.evaluate((el) => getComputedStyle(el).getPropertyValue("scrollbar-width"));

test.describe("Post-P9 scroll indicator (Figma 1:5263)", () => {
  test("MENU: the bar sits at 505/790 (ADA 798+170/578), indicator only — thumb at the top, at the bottom with the pane, taps pass through, native bar hidden", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);

    const track = page.getByTestId("menu-scrollbar");
    const thumb = page.getByTestId("menu-scrollbar-thumb");
    const pane = menuPane(page);
    await expect(track).toBeVisible();
    await expect(track).toHaveAttribute("aria-hidden", "true");
    expect(await stageBox(track)).toEqual(MENU_BAR);
    expect(await scrollbarWidth(pane)).toBe("none");
    expect(await hitAtTrackCentre(track)).toBe("the page beneath");

    // At the top: no offset, a thumb sized to the visible share of the pane.
    await expect
      .poll(() => thumb.evaluate((el) => (el as HTMLElement).style.transform))
      .toBe("translateY(0px)");
    await expectThumbTracksPane(pane, "menu-scrollbar");

    // Scrolled to the end: the thumb's bottom edge meets the track's.
    await pane.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(async () => {
        const [t, h] = await Promise.all([stageBox(track), stageBox(thumb)]);
        return Math.abs(h.y + h.height - (t.y + t.height));
      })
      .toBeLessThanOrEqual(1);
    await expectThumbTracksPane(pane, "menu-scrollbar");

    // ADA: the same bar moves into the reach zone and keeps tracking.
    await page.getByTestId("footer-ada").click();
    await expect.poll(() => stageBox(track)).toEqual(MENU_BAR_ADA);
    await expect(track).toBeVisible();
    await expectThumbTracksPane(pane, "menu-scrollbar");
    expect(await hitAtTrackCentre(track)).toBe("the page beneath");
  });

  test("PDP: the Dream box bar sits at 703/790 (ADA 798+488/394), native bar hidden, and the thumb stays fresh when a slot pick auto-scrolls the PDP", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await openPdp(page, DREAM_BOX);

    const track = page.getByTestId("pdp-scrollbar");
    const pane = pdpPane(page);
    await expect(track).toBeVisible();
    await expect(track).toHaveAttribute("aria-hidden", "true");
    expect(await stageBox(track)).toEqual(PDP_BAR);
    expect(await scrollbarWidth(pane)).toBe("none");
    expect(await hitAtTrackCentre(track)).toBe("the page beneath");
    await expectThumbTracksPane(pane, "pdp-scrollbar");

    // ADA on the PDP: same bar, reach-zone placement, a shorter pane.
    await page.getByTestId("footer-ada").click();
    await expect.poll(() => stageBox(track)).toEqual(PDP_BAR_ADA);
    await expect(track).toBeVisible();
    await expectThumbTracksPane(pane, "pdp-scrollbar");

    // A slot pick: the SDK auto-scrolls the PDP to the next group, and the
    // thumb follows (no variants in this fixture — a slot is the change).
    expect(await pane.evaluate((el) => el.scrollTop)).toBe(0);
    await page.getByTestId(`pack-slot-open-${G_NUGGETS}`).click();
    await expect(page.getByTestId("slot-sheet")).toBeVisible();
    await page.getByTestId(`slot-option-${NUGGETS_PICK}`).click();
    await page.getByTestId("slot-sheet-save").click();
    await expect(page.getByTestId("slot-sheet")).not.toBeVisible();
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expectThumbTracksPane(pane, "pdp-scrollbar");
    expect(
      await page
        .getByTestId("pdp-scrollbar-thumb")
        .evaluate((el) => (el as HTMLElement).style.transform)
    ).not.toBe("translateY(0px)");
  });

  test("FITS: a PDP whose content fits (Large Fries) shows no bar", async ({ page }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await openPdp(page, LARGE_FRIES);

    const pane = pdpPane(page);
    // Precondition: nothing to scroll.
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight)
    ).toBeLessThanOrEqual(2);
    await expect(page.getByTestId("pdp-scrollbar")).toBeHidden();
    // Control: back on /menu, whose content overflows, the bar shows.
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-scrollbar")).toBeVisible();
  });
});
