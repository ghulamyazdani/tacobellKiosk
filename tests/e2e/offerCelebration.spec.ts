import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Lane offers, item 33 — the offer-applied celebration: a NON-BLOCKING 2.2 s
 * status card ("Reward applied!", the offer name, "You save £X" from the live
 * bill) with CSS confetti over the bag header band, plus a one-time chip pop
 * on the applied row. Non-blocking is the contract the P7b suite relies on:
 * the card is pointer-events-none all the way down, so every tap reaches the
 * bag while it shows. It plays once per applied value and never replays on a
 * bag reopen or a return from checkout.
 *
 * Same registered-device mocked backend as offers.spec.ts (helpers copied —
 * established precedent), serving the stock P7b offers fixture, plus the
 * print agent abort. APPLY FLAT money (offers.spec.ts header): Sub £8.00,
 * Discounts −£2.00, Total £7.00; after Remove, Total £9.00.
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

const offersFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/offers.json", import.meta.url)),
    "utf-8"
  )
);

const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8, 3 addon groups (PDP path)
const OFFER_FLAT = "offer-flat-2"; // £2 off, always eligible (offers.json)

/** U+2212 MINUS SIGN — the literal character the bag renders, NOT a hyphen. */
const MINUS = "−";

/**
 * Boot + menu mocks (copied from offers.spec.ts). Order matters: Playwright
 * matches routes newest-first, so the catch-all is registered FIRST and every
 * specific mock after it. The print agent is cross-origin (the catch-all
 * misses it) and is aborted so nothing can reach real hardware.
 */
async function mockKioskBackend(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
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
  await page.route("**/api/cx/get_cx_valid_offers", (r) =>
    r.fulfill({ json: offersFixture })
  );
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

/** Register on the on-screen keyboard and land on /menu (copied from offers.spec.ts). */
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

/** Menu card tap → PDP → commit plain (£8) → dismiss the added modal (copied from offers.spec.ts). */
async function addCheeseBurgerViaPdp(page: Page) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("product-added-modal")).toBeVisible();
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).not.toBeVisible();
}

/** VIEW MY BAG → /cart, walking through the first-open /forYou upsell (copied from offers.spec.ts). */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

/** Rewards entry → radio-pick flat-2 → SAVE (offers.spec.ts pickAndSave). */
async function applyFlat(page: Page) {
  await page.getByTestId("bag-rewards-entry").click();
  await expect(page.getByTestId("rewards-sheet")).toBeVisible();
  await page.getByTestId(`offer-row-${OFFER_FLAT}`).click();
  await expect(page.getByTestId(`offer-row-${OFFER_FLAT}`)).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await page.getByTestId("rewards-save").click();
  await expect(page.getByTestId("rewards-sheet")).toHaveCount(0);
}

const card = (page: Page) => page.getByTestId("offer-applied-celebration");

/**
 * "No card" is a ONE-SHOT count, read right after the commit the caller just
 * waited for (the card renders in the same commit as the bag state that
 * drives it). Never a retrying toHaveCount(0): a wrongly shown card leaves on
 * its own after 2.2 s, so a retrying wait would sit it out and pass.
 */
const cardCountNow = (page: Page) => card(page).count();
const rowPop = (page: Page) =>
  page.getByTestId("bag-rewards-applied").locator(".tb-chip-pop, .tb-success-pulse");

/**
 * Hit-test at the card's centre: true when a tap there reaches the bag beneath
 * (the card is pointer-events-none), null when no card is mounted.
 */
const tapPassesThroughCard = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="offer-applied-celebration"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && !el.contains(hit);
  });

/** The flat-2 bill: Sub £8.00, Discounts −£2.00, Total £7.00. */
async function expectFlatApplied(page: Page) {
  await expect(page.getByTestId("bag-rewards-applied")).toContainText("£2 off your order");
  await expect(page.getByTestId("bag-subtotal")).toContainText("£8.00");
  await expect(page.getByTestId("bag-discounts")).toHaveText(`${MINUS}£2.00`);
  await expect(page.getByTestId("bag-total")).toContainText("£7.00");
}

test.describe("Lane offers — offer-applied celebration (item 33)", () => {
  test("E1 APPLY FLAT: the card shows 'You save £2.00' with confetti, taps pass through it, it hides within 5 s; on a re-apply, Remove works at once while the card shows", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await applyFlat(page);

    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("Reward applied!");
    await expect(card(page)).toContainText("£2 off your order");
    await expect(card(page)).toContainText("You save £2.00");
    await expect(card(page).locator(".tb-confetti-piece")).toHaveCount(28);
    // Non-blocking: a tap on the card lands on the bag under it.
    expect(await tapPassesThroughCard(page)).toBe(true);
    // The first apply pops the applied row once.
    await expect(rowPop(page)).toHaveCount(2);
    // The customer's own apply is never captioned as the machine's.
    await expect(page.getByTestId("bag-rewards-applied-for-you")).toHaveCount(0);

    // It leaves on its own (2.2 s) — the bill it celebrated stays.
    await expect(card(page)).toHaveCount(0, { timeout: 5_000 });
    await expectFlatApplied(page);
    await expect(page).toHaveURL(/\/cart$/);

    // Remove → re-apply: the card plays again, and Remove is live under it.
    await page.getByTestId("bag-rewards-remove").click();
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await applyFlat(page);
    await expect(card(page)).toBeVisible();
    // Remove spent nothing: the SAME offer and amount pops the row again.
    await expect(rowPop(page)).toHaveCount(2);
    await page.getByTestId("bag-rewards-remove").click();
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    // A card for an offer that is gone leaves in the same commit (one-shot).
    expect(await cardCountNow(page)).toBe(0);
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId("bag-discounts")).toHaveCount(0);
    await expect(page.getByTestId("bag-total")).toContainText("£9.00");
    await expect(page.getByTestId("bag-rewards-entry")).toBeVisible();
  });

  test("E2 closing the bag mid-card and reopening it: the applied row is quiet (no tb-chip-pop / pulse) and the card does not replay", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await applyFlat(page);
    await expect(card(page)).toBeVisible();
    await expect(page.getByTestId("bag-rewards-applied").locator(".tb-chip-pop")).toHaveCount(1);

    await page.getByTestId("bag-close").click();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu$/);

    await openBag(page);
    await expect(page.getByTestId("bag-rewards-applied")).toBeVisible();
    // One-shot: a replay would render with the reopened bag.
    expect(await cardCountNow(page)).toBe(0);
    await expect(rowPop(page)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    await expectFlatApplied(page);
  });

  test("E3 PAY while the card shows, then back to the bag from /phone: no replayed card or row pop, the discount is intact", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await applyFlat(page);
    await expect(card(page)).toBeVisible();

    // PAY waits out the bar's 500 ms tap guard, well inside the 2.2 s card.
    await page.getByTestId("bag-pay").click();
    await expect(page).toHaveURL(/\/phone$/, { timeout: 10_000 });
    await page.getByTestId("phone-back").click();
    await expect(page.getByTestId("bag-sheet")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/cart$/);

    await expect(page.getByTestId("bag-rewards-applied")).toBeVisible();
    // One-shot: a replay would render with the returning bag.
    expect(await cardCountNow(page)).toBe(0);
    await expect(card(page)).toHaveCount(0);
    await expect(rowPop(page)).toHaveCount(0);
    await expectFlatApplied(page);
    await expect(page.getByTestId("bag-pay")).toContainText("£7.00");
  });

  test("E4 the next customer starts clean: an order cancelled with the reward still applied, then the same reward in the next session pops the row and celebrates again", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page);
    await bootRegisteredToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await applyFlat(page);
    await expect(rowPop(page)).toHaveCount(2);
    await expect(card(page)).toHaveCount(0, { timeout: 5_000 });

    // Leave with the reward still applied (no Remove), Cancel Order → /start.
    await page.getByTestId("bag-close").click();
    await expect(page).toHaveURL(/\/menu$/);
    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });

    // Next customer, same offer, same amount: /start's reset cleared the
    // spent key, so this first apply of THEIR session pops again.
    await page.getByTestId("start-screen").click();
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expect(page.getByTestId("bag-rewards-applied")).toHaveCount(0);
    await applyFlat(page);
    await expect(card(page)).toBeVisible();
    await expect(rowPop(page)).toHaveCount(2);
    await expectFlatApplied(page);
  });
});
