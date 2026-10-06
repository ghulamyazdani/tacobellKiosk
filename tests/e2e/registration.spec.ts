import { test, expect, type Page } from "@playwright/test";
import { APP_ORIGIN } from "./fixtures/origin";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Boot/auth flows with a MOCKED backend — the posistKiosk-parity behavior:
 * registration issues the token; any 401 during boot logs the device out.
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

async function mockBootEndpoints(page: Page) {
  // Catch-all FIRST (later routes win in Playwright): background calls the
  // shell fires (e.g. PWAUpdateHandler's version report) must not leak to a
  // real backend, 401, and log the mocked session out.
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
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
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({ json: [{ _id: "p1", name: "Dine In" }] })
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
}

test.describe("registration + boot (mocked backend)", () => {
  test("license code registers the device and boots to the splash", async ({
    page,
  }) => {
    // Order matters: Playwright matches routes newest-first, so the login
    // mock must be registered AFTER the catch-all inside mockBootEndpoints.
    await mockBootEndpoints(page);
    await page.route("**/api/cx/kiosk/login", (r) =>
      r.fulfill({ json: LOGIN_OK })
    );

    await page.goto("/");
    await expect(page.getByTestId("registration-screen")).toBeVisible();

    // P9f: the error banner is pure CSS now (no framer-motion). An empty
    // ACTIVATE slides it down from above the stage and shakes the button;
    // the banner slides back out by itself 3 s later.
    const banner = page.getByTestId("registration-error");
    const bannerEdges = () =>
      banner.evaluate((el) => {
        const stage = document.querySelector('[data-testid="kiosk-stage"]') as Element;
        const top = stage.getBoundingClientRect().top;
        const box = el.getBoundingClientRect();
        return { top: Math.round(box.top - top), bottom: Math.round(box.bottom - top) };
      });
    expect((await bannerEdges()).bottom).toBeLessThanOrEqual(0);
    await page.getByTestId("registration-submit").click();
    await expect(banner).toHaveText("Length of code should be greater than 0");
    // Same commit as the text, and gone with it after 3 s — check it first.
    await expect(page.getByTestId("registration-submit")).toHaveAttribute(
      "style",
      /tbRegistrationShake/
    );
    // …and the keyframes it names exist (a renamed @keyframes = a dead shake).
    const keyframes = await page.evaluate(() =>
      [...document.styleSheets]
        .flatMap((sheet) => {
          try {
            return [...sheet.cssRules];
          } catch {
            return []; // a cross-origin sheet
          }
        })
        .filter((rule) => rule instanceof CSSKeyframesRule)
        .map((rule) => (rule as CSSKeyframesRule).name)
    );
    expect(keyframes).toContain("tbRegistrationShake");
    await expect.poll(async () => (await bannerEdges()).top).toBe(0);
    await expect.poll(async () => (await bannerEdges()).bottom).toBeLessThanOrEqual(0);

    // Type the license code on the on-screen keyboard.
    // Figma keyboard: digits live behind the 123 layer toggle.
    await page.getByRole("button", { name: "t", exact: true }).click();
    await page.getByRole("button", { name: "b", exact: true }).click();
    await page.getByRole("button", { name: /numbers and symbols/i }).click();
    await page.getByRole("button", { name: "7", exact: true }).click();
    await page.getByTestId("registration-submit").click();

    // Boot runs, then the attract screen.
    await expect(page.getByTestId("start-screen")).toBeVisible({
      timeout: 10_000,
    });

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "token")?.value).toBe(
      "mock-device-token"
    );
  });

  test("STALE TOKEN: first boot call 401s → device is logged out back to Registration", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "token", value: "stale-or-fake", url: APP_ORIGIN },
    ]);
    // Every API call rejects with 401 — the transport's onAuthFailure must
    // clear the token and land on Registration (posistKiosk parity).
    await page.route("**/api/**", (r) => r.fulfill({ status: 401, json: {} }));

    await page.goto("/LoadingResources");

    await expect(page.getByTestId("registration-screen")).toBeVisible({
      timeout: 10_000,
    });
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "token")).toBeUndefined();
  });
});

test.describe("order type (mocked backend)", () => {
  test("splash → pipelines; a failed menu fetch keeps the guest on /second behind the menu-error dialog (never an empty menu)", async ({ page }) => {
    await mockBootEndpoints(page);
    await page.route("**/api/cx/kiosk/getPipelines", (r) =>
      r.fulfill({
        json: [
          { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" },
          { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take Out" },
        ],
      })
    );
    await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));

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
    await expect(page.getByTestId("second-screen")).toContainText(/where are you eating/i);
    await expect(page.getByTestId("pipeline-p1")).toContainText("Dine In");

    await page.getByTestId("pipeline-p2").click();
    // getMenu is NOT mocked here (the catch-all answers a malformed {}).
    // fetchMenu still swallows the failure and resolves {} (fork parity), but
    // P9b judges that result: the guest stays on /second behind the
    // menu-error dialog instead of landing on an empty "Menu is loading…"
    // /menu that never loads (Rule 2). TRY AGAIN → /menu is covered by
    // recovery.spec.ts.
    const dialog = page.getByTestId("menu-error");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(/we couldn't load the menu/i);
    await expect(page).toHaveURL(/\/second$/);
    await expect(page.getByTestId("menu-screen")).toHaveCount(0);
    // BACK closes the dialog onto the live order-type cards — no dead end.
    await page.getByTestId("menu-error-back").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("pipeline-p1")).toBeVisible();
  });
});

test.describe("menu via REAL converters (mocked backend, slim fixture)", () => {
  test("pipeline selection fetches + converts the menu; Figma menu renders", async ({
    page,
  }) => {
    const slimMenu = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)),
        "utf-8"
      )
    );
    await mockBootEndpoints(page);
    await page.route("**/api/cx/kiosk/getPipelines", (r) =>
      r.fulfill({
        json: [
          { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" },
        ],
      })
    );
    await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
    // Large Fries is out of stock (the converter's OOS feed shape).
    const LARGE_FRIES = "5dd10938eb1ccee31ca352fa";
    await page.route("**/api/cx/kiosk/get_out_of_stock", (r) =>
      r.fulfill({
        json: [{ item_id: LARGE_FRIES, type: "item", partners: { inStock: false } }],
      })
    );
    await page.route("**/api/tenants/getServerTime", (r) =>
      r.fulfill({ json: { serverTime: new Date().toISOString() } })
    );
    // NOTE: the hook uses get_cx_VALID_offers (get_cx_offers is the legacy list)
    await page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: [] }));
    // charges/country/currency (drives the £ symbol on cards)
    await page.route("**/api/cx/kiosk/get_data", (r) =>
      r.fulfill({
        json: {
          charges: [],
          deployment: { countryCode: "GB", currencySettings: { symbol: "£" } },
        },
      })
    );
    await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));

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

    // The REAL legacy converter ran over the slim StandardMenu fixture.
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("category-rail")).toContainText("Side Orders");
    await expect(page.getByTestId("category-rail")).toContainText(/Meals/);
    // At least one entity card rendered from converted data.
    await expect(page.locator('[data-testid^="item-"]').first()).toBeVisible();

    // P9f overlay-button pattern: an out-of-stock card is inert — no open
    // overlay, no quick-add — and says so.
    const fries = page.getByTestId(`item-${LARGE_FRIES}`);
    await expect(fries).toHaveAttribute("aria-disabled", "true");
    await expect(fries).toContainText(/unavailable/i);
    await expect(fries.getByRole("button")).toHaveCount(0);
  });
});

test.describe("operator activity center", () => {
  test("3s top-left hold on the splash opens diagnostics; short tap does not", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "token", value: "e2e-device-token", url: APP_ORIGIN },
    ]);
    // Background shell calls (PWAUpdateHandler version report) must not
    // reach a real backend and 401 the fake token mid-test.
    await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
    await page.goto("/start");
    await expect(page.getByTestId("start-screen")).toBeVisible();

    const hotspot = page.getByTestId("activity-hotspot");
    // Short tap: nothing happens (and no accidental order start).
    await hotspot.click({ force: true });
    await expect(page.getByTestId("activity-modal")).not.toBeVisible();
    await expect(page.getByTestId("start-screen")).toBeVisible();

    // Real 3-second hold: useLongPress fires its timer WHILE pressed, so keep
    // the button down until the modal shows, then release.
    const box = (await hotspot.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await expect(page.getByTestId("activity-modal")).toBeVisible({ timeout: 10_000 });
    await page.mouse.up();
    await expect(page.getByTestId("activity-modal")).toBeVisible();
    await expect(page.getByTestId("activity-modal")).toContainText(/activity center/i);

    // Close returns to the splash, order flow intact.
    await page.getByTestId("activity-close").click();
    await expect(page.getByTestId("activity-modal")).not.toBeVisible();
  });
});

test.describe("P6a add-to-cart (mocked backend, real converter + cart engine)", () => {
  test("quick-add a simple item updates totals; re-add increments; modifier item routes to customization", async ({
    page,
  }) => {
    const slimMenu = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)),
        "utf-8"
      )
    );
    await mockBootEndpoints(page);
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

    // Greek Salad: 0 modifiers, 0 variants → direct add. Price 17 (fixture).
    const salad = page.getByTestId("quick-add-5dd1093829754a432f2c32e2");
    await salad.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
    await salad.click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£17.00");

    // Re-add the same simple item → same row, quantity bumps, total doubles.
    await salad.click();
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£34.00");

    // Cheese Burger (3 modifier groups) → customization placeholder (P6b).
    // A card opens through its named overlay button, which covers its text.
    await page.getByRole("button", { name: /cheese burger/i }).first().click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();
  });
});

test.describe("P6b PDP customization (real converter + useCustomization + commit)", () => {
  test("Cheese Burger → PDP groups render → pick Extra Pickles → ADD TO BAG → confirmed in cart", async ({
    page,
  }) => {
    const slimMenu = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)),
        "utf-8"
      )
    );
    // The fixture's description fits on one line: give Cheese Burger one
    // long enough for the PDP's 2-line clamp to bite.
    const LONG_DESCRIPTION = Array(6)
      .fill("The classic Cheese Burger with Herfy special take, grilled to order.")
      .join(" ");
    for (const category of slimMenu.categories)
      for (const sub of category.subCategories)
        for (const entity of sub.entities)
          if (entity.id === "5dd10936712f5b622a66aab7") entity.description = LONG_DESCRIPTION;
    await mockBootEndpoints(page);
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

    await page.goto("/");
    await page.getByRole("button", { name: "t", exact: true }).click();
    await page.getByRole("button", { name: "b", exact: true }).click();
    await page.getByRole("button", { name: /numbers and symbols/i }).click();
    await page.getByRole("button", { name: "7", exact: true }).click();
    await page.getByTestId("registration-submit").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("start-screen").click();
    await page.getByTestId("pipeline-p1").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });

    // Open Cheese Burger (3 real modifier groups, price £8) — by exact id
    // ("Kiddie Meal Cheese burger" also substring-matches the name).
    const card = page.getByTestId("item-5dd10936712f5b622a66aab7");
    // P9f overlay-button pattern: the card opens through a full-card button
    // named by the item (the tap below lands on it).
    await expect(
      card.getByRole("button", { name: "Cheese Burger", exact: true })
    ).toHaveCount(1);
    await card.click();
    await expect(page.getByTestId("customization-screen")).toBeVisible();

    // P9f: "Show more" sits below the clamped description as a ≥44 design-px
    // touch target, and flips the clamp both ways.
    const showMore = page.getByTestId("pdp-show-more");
    const description = page.getByText(LONG_DESCRIPTION);
    await expect(showMore).toHaveText("Show more");
    const showMoreDesignHeight = await showMore.evaluate((button) => {
      const stage = document.querySelector('[data-testid="kiosk-stage"]') as Element;
      const scale = stage.getBoundingClientRect().height / 1920;
      return button.getBoundingClientRect().height / scale;
    });
    expect(showMoreDesignHeight).toBeGreaterThanOrEqual(44);
    // OUTSIDE the clamp: inside it, the long text would clip the toggle away.
    expect(
      await showMore.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return button.contains(hit);
      })
    ).toBe(true);
    const clampedHeight = (await description.boundingBox())!.height;
    await showMore.click();
    await expect(showMore).toHaveText("Show less");
    await expect
      .poll(async () => (await description.boundingBox())!.height)
      .toBeGreaterThan(clampedHeight);
    await showMore.click();
    await expect(showMore).toHaveText("Show more");
    await expect
      .poll(async () => (await description.boundingBox())!.height)
      .toBe(clampedHeight);
    // All three groups render from the converter's modifierMap.
    await expect(page.getByText("Choose From Extra for Cheese Burger")).toBeVisible();
    await expect(page.getByText("Choose From Without for Cheese Burger")).toBeVisible();
    await expect(page.getByText("Choose From Extra Cheese for Cheese Burger")).toBeVisible();
    // Base price shows on the ADD TO BAG bar.
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£8.00");

    // Select "Extra Pickles" (+£1) → total updates to £9.00.
    await page.getByText("Extra Pickles", { exact: false }).first().click();
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£9.00");

    // Quantity stepper: 2 × £9 = £18.
    await page.getByTestId("pdp-qty-increase").click();
    await expect(page.getByTestId("pdp-qty")).toHaveText("2");
    await expect(page.getByTestId("pdp-add-to-bag")).toContainText("£18.00");
    await page.getByTestId("pdp-qty-decrease").click();

    // Commit — customized adds always confirm via the added modal.
    await page.getByTestId("pdp-add-to-bag").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("product-added-modal")).toBeVisible();
    await page.getByTestId("added-continue").click();

    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    await expect(page.getByTestId("cta-total")).toContainText("£9.00");
  });
});
