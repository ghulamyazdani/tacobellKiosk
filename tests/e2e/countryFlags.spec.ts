import { test, expect, type Locator, type Page } from "./fixtures/kiosk";
import { mockKioskBackend as mockBackend, locale, DINE_IN } from "./fixtures/backend";
import { registerToStart, startOrderTo } from "./pages/boot";
import { stageBox } from "./fixtures/a11y";
import { settle, shot } from "./fixtures/capture";
import { mockXenoLoyalty, LOYALTY_SETTINGS } from "./fixtures/loyalty";

/**
 * Round country flags (user request 2026-10-12: "there should be flags icons
 * just like how it is in restroGo").
 *
 * restroGo's CountryDropdown look — a round flag before the country name in
 * every picker row, and the selected country's flag beside the dial code in
 * /phone's pill and the rewards-login chip. TB self-hosts the artwork
 * (public/flags/<code>.png, flagcdn.com's w160 files): the harness denies
 * any foreign origin, so a runtime flag CDN would fail every test here.
 * Flags are decorative — the rows and pills keep their names — and an image
 * that fails shows the country code in its circle, never a broken image.
 *
 * Mocks: the shared backend (India deployment, loyalty on with an optional
 * phone so /phone can be skipped to reach the rewards login), Xeno last.
 */

const en = locale("en");

/** The backend's deployment country (get_data), the real shape. */
const INDIA = { name: "India", dial_code: "+91", code: "IN" };

// ---- Mirrors src/components/stage/KioskStage.tsx (countryCode.spec GEOMETRY) ----
const STAGE_HEIGHT = 1920;
const ADA_BRAND_ZONE_HEIGHT = 798;

async function mockKioskBackend(page: Page, { arabic = false } = {}) {
  await mockBackend(page, {
    arabic,
    settings: { accessibility_mode: true, ...LOYALTY_SETTINGS, crm_phone_mandatory: false },
    pipelines: [DINE_IN],
    deployment: { countryCode: INDIA, currencySettings: { currency: "INR", text: "₹" } },
  });
  // Newest route wins: the Xeno surface goes last.
  await mockXenoLoyalty(page);
}

const startToPhone = (page: Page) => startOrderTo(page, "phone-screen");
const pill = (page: Page) => page.getByTestId("phone-country-code");
const sheet = (page: Page) => page.getByTestId("country-sheet");
/** A host's flag circle: its first child (a row, the pill, the chip). */
const flagOf = (host: Locator) => host.locator(":scope > span").first();

/** Type on the open sheet's on-screen keyboard (letters only). */
async function search(page: Page, text: string) {
  const keyboard = sheet(page).getByTestId("kiosk-keyboard");
  for (const key of text) {
    await keyboard.getByRole("button", { name: key, exact: true }).click();
  }
}

/** The host's flag image: its path once decoded, else why not. */
const loadedFlag = (host: Locator) =>
  flagOf(host).evaluate((circle) => {
    const img = circle.querySelector("img");
    if (!img) return `no image (${circle.textContent})`;
    return img.complete && img.naturalWidth > 0 ? new URL(img.src).pathname : `pending ${img.src}`;
  });

/** Rows inside the list's visible box whose flag has not loaded ([] = every one has). */
const unloadedVisibleFlags = (page: Page) =>
  sheet(page)
    .getByTestId("country-list")
    .evaluate((list) => {
      const box = list.getBoundingClientRect();
      const shown = [...list.querySelectorAll<HTMLElement>('button[data-testid^="country-"]')].filter((row) => {
        const r = row.getBoundingClientRect();
        return r.bottom > box.top && r.top < box.bottom;
      });
      if (shown.length === 0) return ["no visible row"];
      return shown.flatMap((row) => {
        const img = row.firstElementChild?.querySelector("img");
        return img && img.complete && img.naturalWidth > 0 ? [] : [row.dataset.testid ?? "?"];
      });
    });

/** A row's flag box and its name leaf's box, in stage px. */
async function rowGeometry(row: Locator) {
  return {
    flag: await stageBox(flagOf(row)),
    name: await stageBox(row.locator('[dir="auto"]')),
    row: await stageBox(row),
  };
}

async function openPicker(page: Page) {
  await pill(page).click();
  await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
  // Let the entrance finish before measuring.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))
  );
}

test.describe("round country flags (restroGo parity)", () => {
  test("/phone: the pill shows India's flag; every visible picker row shows its flag before the name; a pick swaps the pill's flag", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await registerToStart(page);
    await startToPhone(page);

    // The pill: the deployment default's flag (self-hosted), then "+91".
    await expect.poll(() => loadedFlag(pill(page))).toBe("/flags/in.png");
    await expect(flagOf(pill(page))).toHaveAttribute("aria-hidden", "true");
    await expect(pill(page)).toHaveAccessibleName(en.phone.changeCountry.replace("{{dialCode}}", "+91"));
    const pillFlag = await stageBox(flagOf(pill(page)));
    const dialCode = await stageBox(pill(page).locator('[dir="ltr"]'));
    expect(pillFlag.width).toBe(60);
    expect(pillFlag.height).toBe(60);
    expect(pillFlag.x + pillFlag.width).toBeLessThanOrEqual(dialCode.x);
    await settle(page);
    await shot(page, "flags-01-phone-pill-in");

    await openPicker(page);
    await expect.poll(() => unloadedVisibleFlags(page)).toEqual([]);
    const india = sheet(page).getByTestId("country-IN");
    await expect(india).toHaveAccessibleName(/^India\s?\+91$/);
    const { flag, name, row } = await rowGeometry(india);
    expect(flag.width).toBe(56);
    expect(flag.height).toBe(56);
    expect(flag.x + flag.width).toBeLessThanOrEqual(name.x);
    // Centred in the 96 px row (±1 px).
    expect(Math.abs(flag.y + flag.height / 2 - (row.y + row.height / 2))).toBeLessThanOrEqual(1);
    expect(row.height).toBeGreaterThanOrEqual(96);
    await settle(page);
    await shot(page, "flags-02-picker-en");

    await search(page, "emir");
    await expect.poll(() => loadedFlag(sheet(page).getByTestId("country-AE"))).toBe("/flags/ae.png");
    await sheet(page).getByTestId("country-AE").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(pill(page)).toContainText("+971");
    await expect.poll(() => loadedFlag(pill(page))).toBe("/flags/ae.png");
    await settle(page);
    await shot(page, "flags-03-phone-pill-ae");
  });

  test("Arabic: the rows keep their flags at the row's start (the layout stays LTR)", async ({ page }) => {
    test.slow();
    await mockKioskBackend(page, { arabic: true });
    await registerToStart(page);
    await startToPhone(page);
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();

    await openPicker(page);
    const india = sheet(page).getByTestId("country-IN");
    await expect(india).toContainText("الهند");
    await expect.poll(() => unloadedVisibleFlags(page)).toEqual([]);
    const { flag, name, row } = await rowGeometry(india);
    expect(flag.x).toBe(row.x + 24); // the row's start padding
    expect(flag.x + flag.width).toBeLessThanOrEqual(name.x);
    await settle(page);
    await shot(page, "flags-04-picker-ar");
  });

  test("ADA: the capped sheet's rows keep their flags, inside the reach zone", async ({ page }) => {
    test.slow();
    await mockKioskBackend(page);
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
    await page.getByTestId("footer-ada").click();
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
    await expect.poll(() => loadedFlag(pill(page))).toBe("/flags/in.png");

    await openPicker(page);
    await expect.poll(() => unloadedVisibleFlags(page)).toEqual([]);
    const flag = await stageBox(flagOf(sheet(page).getByTestId("country-IN")));
    expect(flag.y).toBeGreaterThanOrEqual(ADA_BRAND_ZONE_HEIGHT);
    expect(flag.y + flag.height).toBeLessThanOrEqual(STAGE_HEIGHT);
    await settle(page);
    await shot(page, "flags-05-picker-ada");
  });

  test("the rewards-login chip shows the selected country's flag and follows a pick", async ({ page }) => {
    test.slow();
    await mockKioskBackend(page);
    await registerToStart(page);
    await startToPhone(page);
    // An unidentified guest: the menu's REWARDS link opens the login modal.
    await page.getByTestId("phone-skip").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("menu-rewards-link").click();
    await expect(page.getByTestId("loyalty-login")).toBeVisible();

    const chip = page.getByTestId("loyalty-country-code");
    await expect.poll(() => loadedFlag(chip)).toBe("/flags/in.png");
    await expect(chip).toHaveAccessibleName(en.phone.changeCountry.replace("{{dialCode}}", "+91"));
    const chipFlag = await stageBox(flagOf(chip));
    expect(chipFlag.width).toBe(48);
    expect(chipFlag.height).toBe(48);
    await settle(page);
    await shot(page, "flags-06-login-chip-in");

    await chip.click();
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
    await search(page, "emir");
    await sheet(page).getByTestId("country-AE").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(chip).toContainText("+971");
    await expect.poll(() => loadedFlag(chip)).toBe("/flags/ae.png");
    await settle(page);
    await shot(page, "flags-07-login-chip-ae");
  });

  test("a flag that fails shows the country code in its circle (a 404: the pill's and the row's IN)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await page.route("**/flags/in.png", (route) => route.fulfill({ status: 404, body: "" }));
    await registerToStart(page);
    await startToPhone(page);

    await expect(flagOf(pill(page))).toHaveText("IN");
    await expect(flagOf(pill(page)).locator("img")).toHaveCount(0);
    await expect(pill(page)).toHaveAccessibleName(en.phone.changeCountry.replace("{{dialCode}}", "+91"));

    await openPicker(page);
    await expect(flagOf(sheet(page).getByTestId("country-IN"))).toHaveText("IN");
    await expect(sheet(page).getByTestId("country-IN")).toHaveAccessibleName(/^India\s?\+91$/);
    await settle(page);
    await shot(page, "flags-08-fallback");
  });

  test("a flag still in its failed state paints no broken-image icon, only the disc", async ({ page }) => {
    test.slow();
    await mockKioskBackend(page);
    await page.route("**/flags/in.png", (route) => route.fulfill({ status: 404, body: "" }));
    // Chrome paints its broken-image icon in a sized <img> from the moment a
    // load fails, often a frame before the error event that swaps in the
    // code. Hold that state: the error event never reaches the app.
    await page.addInitScript(() =>
      window.addEventListener(
        "error",
        (event) => {
          if (event.target instanceof HTMLImageElement && event.target.src.includes("/flags/")) {
            event.stopImmediatePropagation();
          }
        },
        true
      )
    );
    await registerToStart(page);
    await startToPhone(page);

    const circle = flagOf(pill(page));
    await expect
      .poll(() => circle.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 0))
      .toBe(true);
    // The disc and its ring are near-grey; the icon is green and blue.
    const png = await circle.screenshot({ path: test.info().outputPath("flags-09-failed-held.png") });
    const iconPixels = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) return -1;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let colourful = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const channels = [pixels[i], pixels[i + 1], pixels[i + 2]];
        if (Math.max(...channels) - Math.min(...channels) > 60) colourful += 1;
      }
      return colourful;
    }, png.toString("base64"));
    expect(iconPixels).toBe(0);
  });
});
