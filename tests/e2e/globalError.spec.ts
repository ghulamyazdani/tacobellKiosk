import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mockCheckoutBackend } from "./fixtures/checkout";

/**
 * Lane figma-polish G1 — the global error has ONE renderer
 * (GlobalErrorHost in IdleGuard: `global-error`, the 1:6288 Icon Modal
 * layout, the message as its title, one GOT IT, z-[95], no auto-dismiss).
 * Before G1 nothing rendered `setShowErrorModalGlobal` outside the menu's
 * loyalty workaround, so these refusals were SILENT: the guest tapped and
 * nothing happened.
 *
 * - CRM: a bad number on /phone (`crm_phone_mandatory`) and an empty
 *   mandatory name on /customerName (`crm_name_mandatory`), in English and
 *   Arabic. GOT IT keeps the guest on the screen; the corrected entry goes on.
 * - DP CAP: a dynamic-pricing session (`_extras.maxQtyItem: 1`) — the
 *   deployment's `enable_dynamic_pricing` row, one always-valid session
 *   (no date/time/day ranges) and two DP items (an entry needs
 *   `status: "active"`, menuRenderingChecks, or the item is dropped from the
 *   menu). The cap's message is now TRANSLATED (toast.dpMaxQuantity — the
 *   SDK's English builder stays for the fork); the cart never changes. On
 *   the PDP the refused commit raises that one modal — the completion
 *   warning stays closed.
 * - NEVER TWO MODALS: an incomplete pack's ADD TO BAG is answered by the
 *   completion warning alone (useCustomization's `if (customization)`
 *   guards) — no global error under it.
 *
 * Arabic runs are FSI…PDI-isolated (PROGRESS P9f): Arabic copy is matched by
 * substring, a template with {{placeholders}} fragment by fragment — never a
 * substring that spans a placeholder.
 *
 * Mocks: the house order (idle.spec / bag.spec — copied, no spec exports
 * them): the `**\/api/**` catch-all FIRST, the cross-origin edges routed
 * explicitly, every specific mock after it (newest wins), the checkout
 * fixture after those.
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
const ar = readJson("../../src/i18n/locales/ar/translation.json");

/** £17, plain: a card tap adds it with no modal. A DP item in the DP walk. */
const GREEK_SALAD = "5dd1093829754a432f2c32e2";
/** £8, modifier groups: a card tap opens the PDP. A DP item in the DP walk. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
/** The pack: Drinks (the CHOICE slot) starts empty. */
const DREAM_BOX = "68dd79409030ed3064aee28c";
const G_DRINKS = `${DREAM_BOX}_3_combo`;

/** The DP session under test: one DP unit per order during "Lunch". */
const DP_SESSION = { _id: "dp-lunch", sessionName: "Lunch", _extras: { maxQtyItem: 1 } };

type Lang = "en" | "ar";

interface MockOptions {
  /** Extra get_kiosk_settings keys. */
  settings?: Record<string, unknown>;
}

async function mockKioskBackend(page: Page, opts: MockOptions = {}) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) =>
    r.fulfill({ json: { status: "success" } })
  );
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: { name: "العربية", code: "ar", dir: "rtl" },
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
        // A secondary language without its splash text fails the boot.
        start_order_text_secondary: "ابدأ الطلب",
        ideal_time: "180",
        ...opts.settings,
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [
        {
          _id: "p1",
          tab_id: "t1",
          tab_type: "dine_in",
          primary_name: "Dine In",
          secondary_name: "تناول في المطعم",
        },
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

/** DP on (the deployment row), the Lunch session, and its two DP items. */
async function mockDynamicPricing(page: Page) {
  await mockCheckoutBackend(page, {
    deploymentSettings: [{ name: "enable_dynamic_pricing", selected: true }],
  });
  await page.route("**/api/cx/get_dp_sessions", (r) => r.fulfill({ json: [DP_SESSION] }));
  await page.route("**/api/cx/get_deployment_items_session", (r) =>
    r.fulfill({
      json: [
        { baseItemId: GREEK_SALAD, session: { modifiedRate: 17, status: "active" } },
        { baseItemId: CHEESE_BURGER, session: { modifiedRate: 8, status: "active" } },
      ],
    })
  );
}

/** Register → splash → /second (Arabic when asked) → Dine In → /menu. */
async function startOrderToMenu(page: Page, lang: Lang) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible();
  if (lang === "ar") {
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  }
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

async function tapGreekSalad(page: Page) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
}

/** VIEW MY BAG → /cart, through the once-per-session /forYou upsell (bag.spec). */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
}

/** KioskNumpad is the only numeric keypad mounted at a time. */
async function typeDigits(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByTestId(`numpad-key-${digit}`).click();
  }
}

/**
 * The global error is up and reads `copy` in the guest's language: English
 * exactly (its accessible name), Arabic by each literal fragment of the
 * template plus the interpolated values (header).
 */
async function expectGlobalError(
  page: Page,
  lang: Lang,
  key: (copy: Record<string, Record<string, string>>) => string,
  values: Record<string, string> = {}
): Promise<Locator> {
  const dialog = page.getByTestId("global-error");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("global-error-ok")).toContainText(
    (lang === "en" ? en : ar).offers.gotIt
  );
  if (lang === "en") {
    const text = Object.entries(values).reduce(
      (out, [name, value]) => out.replace(`{{${name}}}`, value),
      key(en)
    );
    await expect(page.getByRole("alertdialog", { name: text })).toBeVisible();
  } else {
    const template = key(ar);
    const fragments = template
      .split(/\{\{\w+\}\}/)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of [...fragments, ...Object.values(values)]) {
      await expect(dialog).toContainText(part);
    }
  }
  // One modal at a time.
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  return dialog;
}

async function dismissGlobalError(page: Page) {
  await page.getByTestId("global-error-ok").click();
  await expect(page.getByTestId("global-error")).toHaveCount(0);
}

const cartRows = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __kioskStore: {
          getState: () => { cart: { cartItems: { id?: string; quantity?: number }[] } };
        };
      }
    ).__kioskStore
      .getState()
      .cart.cartItems.map((row) => [row.id, row.quantity])
  );

test.describe("figma-polish G1 — the global error is visible and translated", () => {
  for (const lang of ["en", "ar"] as const) {
    test(`CRM (${lang}): a bad number on /phone and an empty mandatory name on /customerName each raise the global error in the guest's language; GOT IT keeps the guest on the screen and the corrected entry goes on`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page, {
        settings: { crm_phone_mandatory: true, crm_name_mandatory: true },
      });
      const checkout = await mockCheckoutBackend(page);
      await startOrderToMenu(page, lang);
      await tapGreekSalad(page);
      await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
      await openBag(page);
      await page.getByTestId("bag-pay").click();

      // /phone (checkout mode): GB numbers are exactly 10 digits.
      await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
      await typeDigits(page, "123");
      await page.getByTestId("phone-continue").click();
      await expectGlobalError(page, lang, (copy) => copy.phone.invalidNumber);
      await dismissGlobalError(page);
      await expect(page).toHaveURL(/\/phone$/);
      await typeDigits(page, "4567890");
      await page.getByTestId("phone-continue").click();

      // /customerName: CONTINUE with nothing typed is refused out loud.
      await expect(page.getByTestId("customer-name-screen")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("customer-name-continue").click();
      await expectGlobalError(page, lang, (copy) => copy.customerName.required);
      await dismissGlobalError(page);
      await expect(page).toHaveURL(/\/customerName$/);
      await page.getByRole("button", { name: "t", exact: true }).click();
      await page.getByRole("button", { name: "b", exact: true }).click();
      await expect(page.getByTestId("customer-name-input")).toContainText("tb");
      await page.getByTestId("customer-name-continue").click();
      await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("global-error")).toHaveCount(0);
      expect(checkout.placeOrderCount).toBe(0);
      expect(checkout.forbiddenUrls).toEqual([]);
    });

    test(`DP CAP (${lang}): at the session's maxQtyItem a one-tap add raises the translated toast.dpMaxQuantity with the cart unchanged; on the PDP the refused commit raises that one modal — the completion warning stays closed`, async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await mockDynamicPricing(page);
      await startOrderToMenu(page, lang);
      const values = { max: "1", session: DP_SESSION.sessionName };

      // The first DP unit lands; the second is over the cap.
      await tapGreekSalad(page);
      await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
      await tapGreekSalad(page);
      await expectGlobalError(page, lang, (copy) => copy.toast.dpMaxQuantity, values);
      expect(await cartRows(page)).toEqual([[GREEK_SALAD, 1]]);
      await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
      await dismissGlobalError(page);
      await expect(page.getByTestId("menu-screen")).toBeVisible();

      // A customised DP item from its PDP: the commit is refused once — the
      // DP modal, never the completion warning beside it, no added modal.
      const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
      await burger.scrollIntoViewIfNeeded();
      await burger.click();
      await expect(page.getByTestId("customization-screen")).toBeVisible();
      await page.getByTestId("pdp-add-to-bag").click();
      await expectGlobalError(page, lang, (copy) => copy.toast.dpMaxQuantity, values);
      await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
      await expect(page.getByTestId("product-added-modal")).toHaveCount(0);
      expect(await cartRows(page)).toEqual([[GREEK_SALAD, 1]]);
      await dismissGlobalError(page);
      await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
      await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    });
  }

  test("NEVER TWO MODALS: an incomplete pack's ADD TO BAG is answered by the completion warning alone — no global error under it — and GOT IT leaves no modal behind", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await startOrderToMenu(page, "en");
    const box = page.getByTestId(`item-${DREAM_BOX}`);
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await expect(page.getByTestId("pack-slot-grid")).toBeVisible();

    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("pdp-incomplete")).toBeVisible();
    await expect(page.getByTestId(`pack-slot-${G_DRINKS}`)).toHaveClass(/ring-red-500/);
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(1);
    await page.getByTestId("pdp-incomplete-gotit").click();
    await expect(page.getByTestId("pdp-incomplete")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByTestId("global-error")).toHaveCount(0);
    await expect(page.getByTestId("customization-screen")).toBeVisible();
  });
});
