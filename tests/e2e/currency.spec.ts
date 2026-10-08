import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mockCheckoutBackend, type CheckoutMockHandle } from "./fixtures/checkout";

/**
 * UB1 (user bug 2026-10-08): "there is no currency in anywhere in the ui".
 *
 * Every price site read `currencySettings.symbol` — a key the backend never
 * sends — and the fixtures invented the same key, so the suite stayed green
 * while every price printed bare. This spec answers `cx/kiosk/get_data` with
 * the backend's EXACT Indian body (posistApp kiosk.controller get_data:
 * `currencySettings = {currency, text, uniDec, uniHex}` as Posist admin saves
 * it, `countryCode = {name, dial_code, code}`) and expects ₹ on every money
 * surface of the order flow: a menu card, the menu TOTAL bar, the PDP's
 * ADD TO BAG label, a bag row, the bag Total and PAY, and the /payment TOTAL
 * bar. Case 2 is a deployment that never saved a currency (no
 * `currencySettings` at all): the SDK's getCurrencyText falls back to ₹.
 *
 * Money facts (slim-menu, as bag.spec.ts): Greek Salad ₹17, no modifiers →
 * a one-tap add; VAT@15% exclusive and the total rounds to whole units →
 * Total = round(17 × 1.15) = ₹20.00. Cheese Burger ₹8 opens the PDP.
 *
 * Mock order: Playwright matches routes newest-first, so the `**\/api/**`
 * catch-all goes FIRST, every boot mock after it, and mockCheckoutBackend
 * (the /payment settings + the LOUD 500 gateway guards) last.
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

/** The backend's exact get_data `deployment` for TB India. */
const INDIA_DEPLOYMENT = {
  _id: "dep1",
  mobile: "9999999999",
  currencySettings: { currency: "INR", text: "₹", uniDec: "8377", uniHex: "8377" },
  countryCode: { name: "India", dial_code: "+91", code: "IN" },
};

/** A deployment that never saved a currency: the key is absent. */
const NO_CURRENCY_DEPLOYMENT = {
  _id: "dep1",
  mobile: "9999999999",
  countryCode: { name: "India", dial_code: "+91", code: "IN" },
};

const slimMenu = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)), "utf-8")
);

const GREEK_SALAD = "5dd1093829754a432f2c32e2";
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";

async function mockKioskBackend(page: Page, deployment: Record<string, unknown>) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: {},
      },
    })
  );
  await page.route("**/api/cx/getCxSkinData", (r) => r.fulfill({ json: { skin_id: "skin_1" } }));
  await page.route("**/api/cx/kiosk/get_theme", (r) =>
    r.fulfill({ json: { theme_color: [], primary_color_shades: [] } })
  );
  await page.route("**/api/cx/get_kiosk_settings", (r) =>
    r.fulfill({
      json: {
        start_order_text_primary: "START ORDER",
        ideal_time: "180",
        // PAY on a dine-in tab goes straight to /payment.
        skip_crm_page: true,
        pay_at_counter: "pay_at_counter",
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [{ _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" }],
    })
  );
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } })
  );
  await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: [] }));
  // THE point of this spec: the backend's real body, not a test-shaped one.
  await page.route("**/api/cx/kiosk/get_data", (r) =>
    r.fulfill({ json: { charges: [], deployment } })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
}

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

/** One-tap add (no modifiers): the card prints the whole-rupee menu price. */
async function addGreekSalad(page: Page) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await expect(salad).toContainText("₹17");
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
  await expect(page.getByTestId("cta-total")).toContainText("₹17.00");
}

/** The /forYou upsell may sit on the menu → bag edge (opt-out gate). */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
}

function expectNoGatewayContacted(checkout: CheckoutMockHandle) {
  expect(checkout.forbiddenUrls, "a gateway / terminal endpoint was contacted").toEqual([]);
  expect(checkout.printAgentUrls, "the local print agent was contacted").toEqual([]);
  expect(checkout.placeOrderCount).toBe(0);
}

test.describe("UB1 — prices carry the deployment's currency symbol", () => {
  test("the backend's exact INR body: ₹ on the menu card, TOTAL bar, PDP, bag row, bag Total, PAY and /payment", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, INDIA_DEPLOYMENT);
    const checkout = await mockCheckoutBackend(page);
    await bootRegisteredToMenu(page);

    // The PDP's ADD TO BAG label — opened and left without committing.
    const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
    await burger.scrollIntoViewIfNeeded();
    await expect(burger).toContainText("₹8");
    await burger.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("₹8.00");
    await page.getByTestId("pdp-back").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });

    // A menu card and the menu TOTAL bar.
    await addGreekSalad(page);

    // The bag: the row, Sub Total, Total and PAY.
    await openBag(page);
    const row = page.locator('[data-testid^="bag-row-"]').first();
    await expect(row).toContainText("Greek Salad");
    await expect(row).toContainText("₹17.00");
    await expect(page.getByTestId("bag-subtotal")).toContainText("₹17.00");
    await expect(page.getByTestId("bag-total")).toContainText("₹20.00");
    await expect(page.getByTestId("bag-pay")).toContainText("₹20.00");

    // /payment's TOTAL bar (nothing is placed: the spec stops here).
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("payment-total")).toContainText("₹20.00");

    // The device stored the backend's shape verbatim (no `symbol` key exists).
    const stored = await page.evaluate(() => {
      const raw = window.localStorage.getItem("persist:root");
      return raw ? JSON.parse(JSON.parse(raw).appSettings).currencySettings : null;
    });
    expect(stored).toEqual(INDIA_DEPLOYMENT.currencySettings);

    expectNoGatewayContacted(checkout);
  });

  test("a deployment that never saved a currency still shows ₹ (the SDK fallback)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, NO_CURRENCY_DEPLOYMENT);
    const checkout = await mockCheckoutBackend(page);
    await bootRegisteredToMenu(page);

    await addGreekSalad(page);

    await openBag(page);
    await expect(page.locator('[data-testid^="bag-row-"]').first()).toContainText("₹17.00");
    await expect(page.getByTestId("bag-total")).toContainText("₹20.00");
    await expect(page.getByTestId("bag-pay")).toContainText("₹20.00");

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("payment-total")).toContainText("₹20.00");

    expectNoGatewayContacted(checkout);
  });
});
