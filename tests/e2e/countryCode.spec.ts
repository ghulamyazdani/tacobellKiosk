import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mockXenoLoyalty,
  LOYALTY_REWARDS,
  LOYALTY_SETTINGS,
  type XenoMockHandle,
} from "./fixtures/loyalty";

/**
 * audit-fixes UB5 — the country-code picker, end to end ("the multiple
 * country code selection in phone number screen is not happening").
 *
 * /phone's "+91" pill (and the rewards-login chip) opens a searchable list
 * built from the SDK table; a pick drives the keypad cap, the length check
 * and every Xeno call's country code — for ONE guest: the session reset
 * restores IN/+91, the deployment default never overwrites a pick (not even
 * the bag's order-type switch), and the order push keeps sending digits only
 * (fork parity, Q23).
 *
 * ── MOCKS ───────────────────────────────────────────────────────────────
 * House order (loyalty.spec.ts / orderTypeSwitch.spec.ts): the `**\/api/**`
 * catch-all FIRST, the print agent aborted, every specific mock after it,
 * the Xeno surface (mockXenoLoyalty) LAST — newest wins. `get_data` answers
 * the real deployment shape: `countryCode: {name, dial_code, code}` (India)
 * and `currencySettings: {currency, text}`. Two pipelines (Dine In / Take
 * Away, same menu) give the bag's order-type switch a target. Boot helpers
 * are copied (house precedent: no spec exports them). Copy is read from the
 * locale files; Arabic is asserted by substring.
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

const readJson = (relative: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8"));

const slimMenu = readJson("./fixtures/slim-menu.json");
const en = readJson("../../src/i18n/locales/en/translation.json");
const enLazy = readJson("../../src/i18n/locales/en/lazy.json");
const arLazy = readJson("../../src/i18n/locales/ar/lazy.json");

/** £17-class, no modifiers: one tap adds it (recovery.spec.ts). */
const GREEK_SALAD = "5dd1093829754a432f2c32e2";

/** The backend's deployment country (get_data), the real shape. */
const INDIA = { name: "India", dial_code: "+91", code: "IN" };

/** A UAE mobile number as a guest types it locally ("05…") — the 0 is a trunk prefix. */
const UAE_LOCAL = "0501234567";
const UAE_NUMBER = "501234567";

// ---- Mirrors src/components/stage/KioskStage.tsx (ada.spec.ts GEOMETRY) ----
const STAGE_WIDTH = 1080;
const STAGE_HEIGHT = 1920;
const ADA_BRAND_ZONE_HEIGHT = 798;

interface MockOptions {
  /** An Arabic secondary language (the footer's language sheet offers it). */
  arabic?: boolean;
}

async function mockKioskBackend(page: Page, { arabic = false }: MockOptions = {}) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin: the catch-all never sees the print agent.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: arabic ? { name: "العربية", code: "ar", dir: "rtl" } : {},
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
        start_order_text_secondary: "ابدأ الطلب",
        ideal_time: "180",
        accessibility_mode: true,
        // Loyalty on: /second routes through the pre-menu /phone lookup.
        ...LOYALTY_SETTINGS,
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [
        { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" },
        { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take Away" },
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
        deployment: { countryCode: INDIA, currencySettings: { currency: "INR", text: "₹" } },
      },
    })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
  // Newest route wins: the Xeno surface goes last.
  return mockXenoLoyalty(page);
}

/** Register on the on-screen keyboard and land on the splash. */
async function registerToStart(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

/** Splash → Dine In → the pre-menu /phone (loyalty on). */
async function startToPhone(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
}

const pill = (page: Page) => page.getByTestId("phone-country-code");
const sheet = (page: Page) => page.getByTestId("country-sheet");
/** The country rows (the list's buttons — not the sheet's scrim / X / clear). */
const countryRows = (page: Page) =>
  sheet(page).getByTestId("country-list").locator('button[data-testid^="country-"]');

/** Type on the open sheet's on-screen keyboard (letters only). */
async function search(page: Page, text: string) {
  const keyboard = sheet(page).getByTestId("kiosk-keyboard");
  for (const key of text) {
    await keyboard.getByRole("button", { name: key, exact: true }).click();
  }
}

/** Pill → sheet → "emir" → United Arab Emirates. */
async function pickUae(page: Page) {
  await pill(page).click();
  await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
  await search(page, "emir");
  await sheet(page).getByTestId("country-AE").click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(pill(page)).toContainText("+971");
}

async function typeDigits(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByTestId(`numpad-key-${digit}`).click();
  }
}

/** auth.selectedCountryCode from the DEV store seam. */
function selectedCountry(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __kioskStore: {
            getState: () => { auth?: { selectedCountryCode?: Record<string, unknown> } };
          };
        }
      ).__kioskStore.getState().auth?.selectedCountryCode
  );
}

/** The data block of every execute_event call of one Xeno operation. */
const xenoData = (xeno: XenoMockHandle, eventName: string) =>
  xeno.eventCalls
    .filter((call) => call.eventName === eventName)
    .map((call) => (call.body as { data?: Record<string, unknown> } | undefined)?.data);

/** The element's box in stage DESIGN px (ada.spec.ts stageBox). */
function stageBox(locator: Locator) {
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

/** Capture-only screenshot: attached for review, never compared. */
async function capture(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

test.describe("UB5: the country-code picker", () => {
  test("/phone: picking the UAE makes the rewards lookup carry +971 (country_code AND countrycode), and the keypad follows the country", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockKioskBackend(page);
    await registerToStart(page);
    await startToPhone(page);

    // The deployment default (India) on a named button.
    await expect(pill(page)).toContainText("+91");
    await expect(pill(page)).toHaveAttribute("aria-haspopup", "dialog");
    await expect(pill(page)).toHaveAccessibleName(
      en.phone.changeCountry.replace("{{dialCode}}", "+91")
    );

    await pill(page).click();
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("dialog", { name: enLazy.country.title })).toBeVisible();
    // India leads (selected), then A→Z; no flags.
    const rows = countryRows(page);
    await expect(rows.first()).toHaveAttribute("data-testid", "country-IN");
    await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(239);
    await capture(page, "country-01-sheet");

    await search(page, "emir");
    await expect(rows).toHaveCount(1);
    await sheet(page).getByTestId("country-AE").click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(pill(page)).toContainText("+971");
    expect(await selectedCountry(page)).toEqual({
      code: "AE",
      dialCode: "+971",
      min: 9,
      max: 9,
      picked: true,
    });

    // "05…": the trunk 0 is ignored and the 9-digit cap holds the rest.
    await typeDigits(page, `${UAE_LOCAL}9`);
    await page.getByTestId("phone-visibility").click();
    await expect(page.getByTestId("phone-number-display")).toHaveText(UAE_NUMBER);

    await page.getByTestId("phone-continue").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    expect(xenoData(xeno, "check_loyalty_balance")).toEqual([
      expect.objectContaining({
        customer_mobile: UAE_NUMBER,
        country_code: "+971",
        countrycode: "+971",
      }),
    ]);
  });

  test("CANCEL ORDER: the pick ends with the guest — the next guest's /phone shows +91", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await registerToStart(page);
    await startToPhone(page);
    await pickUae(page);

    // Pre-menu /phone: CANCEL ORDER goes straight to the splash (empty bag).
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    // /start's mount reset restores the default — no `picked` survives.
    await expect.poll(() => selectedCountry(page)).toEqual({
      code: "IN",
      dialCode: "+91",
      min: 10,
      max: 10,
    });

    await startToPhone(page);
    await expect(pill(page)).toContainText("+91");
    await expect(pill(page)).not.toContainText("+971");
    expect(await selectedCountry(page)).not.toHaveProperty("picked");
  });

  test("the bag's order-type switch keeps +971: the next Xeno call (authenticate_redemption) still carries it", async ({
    page,
  }) => {
    test.slow();
    const xeno = await mockKioskBackend(page);
    await registerToStart(page);
    await startToPhone(page);
    await pickUae(page);
    await typeDigits(page, UAE_NUMBER);
    await page.getByTestId("phone-continue").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("loyalty-rewards-close").click();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);

    // A row, then EAT IN → TAKE OUT in the bag (staged fetch, one commit).
    const salad = page.getByTestId(`item-${GREEK_SALAD}`);
    await salad.scrollIntoViewIfNeeded();
    await salad.click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await page.getByTestId("cta-view-bag").click();
    await page.waitForURL(/\/(forYou|cart)$/);
    if (new URL(page.url()).pathname === "/forYou") {
      await page.getByTestId("foryou-primary").click();
    }
    await expect(page.getByTestId("bag-sheet")).toBeVisible();
    await page.getByTestId("bag-ordertype-takeout").click();
    await expect(page.getByTestId("bag-ordertype-confirm")).toBeVisible();
    await page.getByTestId("bag-ordertype-confirm-yes").click();
    await expect(page.getByTestId("bag-ordertype-takeout")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 15_000 }
    );
    // The staged charges fetch never re-applied the deployment default.
    expect(await selectedCountry(page)).toMatchObject({ code: "AE", dialCode: "+971", picked: true });

    // The next Xeno call: a reward redemption sends its OTP request.
    await page.getByTestId("bag-close").click();
    await page.getByTestId("menu-rewards-link").click();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
    await page.getByTestId(`loyalty-reward-${LOYALTY_REWARDS.greekSalad.couponCode}`).click();
    await page.getByTestId("loyalty-redeem").click();
    await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({ timeout: 10_000 });
    expect(xenoData(xeno, "authenticate_redemption")).toEqual([
      expect.objectContaining({ country_code: "+971" }),
    ]);
  });

  test("no pick: the bag's order-type switch never re-applies the deployment default — even when its get_data names another country (an operator edit mid-session), the guest keeps +91", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    // Newest route wins: get_data answers `deploymentCountry`, India until
    // the switch.
    let deploymentCountry = INDIA;
    const dataCountries: string[] = [];
    await page.route("**/api/cx/kiosk/get_data", (route) => {
      dataCountries.push(deploymentCountry.code);
      return route.fulfill({
        json: {
          charges: [],
          deployment: {
            countryCode: deploymentCountry,
            currencySettings: { currency: "INR", text: "₹" },
          },
        },
      });
    });
    await registerToStart(page);
    await startToPhone(page);
    await expect(pill(page)).toContainText("+91");
    await typeDigits(page, "9876543210");
    await page.getByTestId("phone-continue").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("loyalty-rewards-close").click();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);
    // /second's get_data has answered (India) before the operator's edit.
    await expect.poll(() => dataCountries.length).toBeGreaterThan(0);
    const india = { code: "IN", dialCode: "+91", min: 10, max: 10 };
    expect(await selectedCountry(page)).toEqual(india);

    const salad = page.getByTestId(`item-${GREEK_SALAD}`);
    await salad.scrollIntoViewIfNeeded();
    await salad.click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await page.getByTestId("cta-view-bag").click();
    await page.waitForURL(/\/(forYou|cart)$/);
    if (new URL(page.url()).pathname === "/forYou") {
      await page.getByTestId("foryou-primary").click();
    }
    await expect(page.getByTestId("bag-sheet")).toBeVisible();

    deploymentCountry = { name: "United Arab Emirates", dial_code: "+971", code: "AE" };
    await page.getByTestId("bag-ordertype-takeout").click();
    await expect(page.getByTestId("bag-ordertype-confirm")).toBeVisible();
    await page.getByTestId("bag-ordertype-confirm-yes").click();
    await expect(page.getByTestId("bag-ordertype-takeout")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 15_000 }
    );
    // The switch's staged fetch saw the UAE and committed — the country
    // stayed the session's (no pick, no `picked`).
    expect(dataCountries).toContain("AE");
    expect(await selectedCountry(page)).toEqual(india);
  });

  test("ADA: the sheet fits the 1122 px reach zone, every control inside it, and axe finds no WCAG A/AA violation", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
    await page.getByTestId("footer-ada").click();
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();

    await pill(page).click();
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
    // Let the entrance animation finish before measuring.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))
    );
    for (const testId of ["country-sheet-close", "country-search", "country-IN", "kiosk-keyboard"]) {
      const box = await stageBox(sheet(page).getByTestId(testId));
      expect(box.y, testId).toBeGreaterThanOrEqual(ADA_BRAND_ZONE_HEIGHT);
      expect(box.y + box.height, testId).toBeLessThanOrEqual(STAGE_HEIGHT);
      expect(box.x + box.width, testId).toBeLessThanOrEqual(STAGE_WIDTH);
    }
    await capture(page, "country-02-sheet-ada");

    const results = await new AxeBuilder({ page })
      .include('[data-testid="country-sheet"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)
    ).toEqual([]);
  });

  test("Arabic: the sheet speaks Arabic (الهند first) and a Latin search still finds the UAE", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { arabic: true });
    await registerToStart(page);
    await startToPhone(page);
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();

    await pill(page).click();
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
    await expect(sheet(page).locator("h2")).toContainText(arLazy.country.title);
    const first = countryRows(page).first();
    await expect(first).toHaveAttribute("data-testid", "country-IN");
    await expect(first).toContainText("الهند");
    await expect(first).toContainText("+91");
    await capture(page, "country-03-sheet-ar");

    // Fixer UI-3 (P9f S2): one-line Arabic names keep the list's left edge
    // (they hugged the dial code, ~730 px right of it), and the search box's
    // Arabic placeholder starts at the box's content edge.
    const offEdge = await countryRows(page).evaluateAll((buttons) =>
      buttons.slice(0, 12).flatMap((button) => {
        const label = button.querySelector('[dir="auto"]');
        if (!label) return [`${button.getAttribute("data-testid")}: no name leaf`];
        const range = document.createRange();
        range.selectNodeContents(label);
        const textLeft = Math.min(...Array.from(range.getClientRects(), (rect) => rect.left));
        const style = getComputedStyle(button);
        const contentLeft =
          button.getBoundingClientRect().left +
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.paddingLeft);
        return Math.abs(textLeft - contentLeft) <= 2
          ? []
          : [`${button.getAttribute("data-testid")}: text at ${textLeft}, content edge ${contentLeft}`];
      })
    );
    expect.soft(offEdge, "Arabic country names off the list's left edge").toEqual([]);
    const placeholderOffset = await sheet(page)
      .getByTestId("country-search")
      .evaluate((box) => {
        const range = document.createRange();
        range.selectNodeContents(box);
        const textLeft = Math.min(...Array.from(range.getClientRects(), (rect) => rect.left));
        return textLeft - box.getBoundingClientRect().left;
      });
    expect
      .soft(Math.abs(placeholderOffset), "Arabic search placeholder vs its box")
      .toBeLessThanOrEqual(2);

    await search(page, "emir");
    await expect(countryRows(page)).toHaveCount(1);
    await expect(sheet(page).getByTestId("country-AE")).toBeVisible();
    await capture(page, "country-04-sheet-ar-search");
  });
});
