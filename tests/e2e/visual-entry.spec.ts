import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mockCheckoutBackend } from "./fixtures/checkout";
import { clippedText } from "./fixtures/clippedText";
import {
  mockXenoLoyalty,
  CUSTOMER_NAME_ROWS,
  LOYALTY_OTP,
  LOYALTY_PHONE,
  LOYALTY_REWARDS,
  LOYALTY_SETTINGS,
} from "./fixtures/loyalty";

/**
 * Lane `fonts` — CAPTURE-ONLY screenshots of the entry, system, checkout and
 * loyalty screens (user decision 2026-10-05: no pixel assertions until GT
 * America is licensed and a CI rendering image is fixed). Each walk attaches
 * one PNG per screen (`entry-NN-<screen>`) to the report for human review
 * against the Figma frames; the assertions only prove the right screen is up,
 * plus one DOM-geometry probe per shot (`clippedText`, fixtures/clippedText.ts:
 * no text cropped by a box, spilling out of a nowrap box, out of its button or
 * under a radio, no contained photo cut — soft, so every shot is still taken)
 * and two targeted checks the fonts lane's fixes need (the Activity Center
 * labels on one line; the loyalty seal's lettering and its two wordmark
 * copies fitting the ring). The menu / PDP / bag / ADA captures live in
 * visual-order.spec.ts.
 *
 * Mocks and helpers are copied from the specs each walk cribs from (splash,
 * idle, checkout, loyalty, autoUpdate — no spec exports them, house
 * precedent): the `**\/api/**` catch-all FIRST, the cross-origin edges routed
 * explicitly (print agent aborted, Xeno revoke answered), every specific mock
 * after it (Playwright matches newest-first). Item images live on S3; they are
 * served locally so a capture never depends on the internet.
 *
 * Time: walks that need it install `page.clock` before the first goto and
 * pause it where a screen only lasts a few seconds (the update countdown, the
 * PAY AT COUNTER window, the REWARDS INCOMING seal).
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

const readFixture = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)));
const readJson = (relative: string) =>
  JSON.parse(readFixture(relative).toString("utf-8"));

const slimMenu = readJson("./fixtures/slim-menu.json");
const en = readJson("../../src/i18n/locales/en/translation.json");
const ar = readJson("../../src/i18n/locales/ar/translation.json");
/** The WELCOME photo doubles as operator media on the fake CDN. */
const PHOTO = readFixture("../../src/assets/splash/fullbleed-halfmoon.jpg");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

/** Cheese Burger, £8: has modifier groups, so a card tap opens the PDP. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
const MEDIA_ORIGIN = "https://splash-media.e2e.test";
const SLIDE_A = `${MEDIA_ORIGIN}/slide-a.jpg`;
const SLIDE_B = `${MEDIA_ORIGIN}/slide-b.jpg`;
/** Every slim-menu item image (the kiosk aggregator entries included). */
const ITEM_IMAGE_HOST = "https://itemsposistnet.s3.ap-south-1.amazonaws.com/**";

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

/**
 * Every <img> settled (loaded or broken) and every finite CSS keyframe
 * animation (the modal/sheet entrances) at rest before the shot. They run in
 * real time under a paused page.clock, and `animations: "disabled"` alone
 * missed an entrance that had only just started (~1 in 4 update-countdown
 * shots). Transitions are left to it: the idle fill re-transitions at 4 Hz.
 */
async function capture(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Array.from(document.images).every((img) => img.complete) &&
          document
            .getAnimations()
            .every(
              (animation) =>
                !(animation instanceof CSSAnimation) ||
                animation.playState !== "running" ||
                !Number.isFinite(
                  animation.effect?.getComputedTiming().endTime ?? Infinity
                )
            )
      )
    )
    .toBe(true);
  await shot(page, name);
  expect.soft(await clippedText(page), `${name}: text the layout cuts off`).toEqual([]);
}


interface BackendOptions {
  /** Offer Arabic as the secondary language (idle.spec LANGUAGE). */
  arabic?: boolean;
  /** Xeno loyalty on (loyalty.spec); "optional" lets /phone be skipped. */
  loyalty?: "mandatory" | "optional";
  /** skip_crm_page + pay_at_counter (checkout.spec). */
  skipCRM?: boolean;
  /** false: getMenu falls to the catch-all `{}` → the menu-error dialog. */
  menu?: boolean;
}

async function mockKioskBackend(page: Page, opts: BackendOptions = {}) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) =>
    r.fulfill({ json: { status: "success" } })
  );
  await page.route(ITEM_IMAGE_HOST, (r) =>
    r.fulfill({ body: PNG, contentType: "image/png" })
  );
  await page.route("**/api/cx/kiosk/getLanguage", (r) =>
    r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: opts.arabic
          ? { name: "العربية", code: "ar", dir: "rtl" }
          : {},
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
        ...(opts.arabic ? { start_order_text_secondary: "ابدأ الطلب" } : {}),
        ideal_time: "180",
        ...(opts.skipCRM
          ? { skip_crm_page: true, pay_at_counter: "pay_at_counter" }
          : {}),
        ...(opts.loyalty ? LOYALTY_SETTINGS : {}),
        ...(opts.loyalty === "optional" ? { crm_phone_mandatory: false } : {}),
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
          // An Arabic session shows it in the .tb-compressed card label
          // (menu-data lane, useLocalized) — the Arabic fallback at 62 %.
          ...(opts.arabic ? { secondary_name: "تناول في المطعم" } : {}),
        },
      ],
    })
  );
  if (opts.menu !== false) {
    await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
  }
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

/** getMedia answers one home_screen list (registered AFTER the catch-all). */
async function mockSplashMedia(page: Page, slides: string[]) {
  const [root, ...extras] = slides.map((url) => ({
    url,
    media_type: "image",
    // Long dwell: the carousel must not rotate mid-capture.
    iteration_time: "600",
    text: "",
    items: [],
  }));
  await page.route("**/api/cx/kiosk/getMedia", (r) =>
    r.fulfill({
      json: { media: [{ key: "home_screen", ...root, extra_images: extras }] },
    })
  );
  await page.route(`${MEDIA_ORIGIN}/**`, (r) =>
    r.fulfill({ body: PHOTO, contentType: "image/jpeg" })
  );
}

/** The licence on the on-screen keyboard (digits live behind the 123 layer). */
async function typeLicence(page: Page) {
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
}

async function registerToStart(page: Page) {
  await page.goto("/");
  await typeLicence(page);
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

/** Splash → order type → the pipeline's next screen. */
async function startOrderTo(page: Page, testId: "menu-screen" | "phone-screen") {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 15_000 });
}

/** KioskNumpad is the only numeric keypad mounted at a time. */
async function typeDigits(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByTestId(`numpad-key-${digit}`).click();
  }
}

/** Menu card → PDP → ADD TO BAG → dismiss the added modal (checkout.spec). */
async function addCheeseBurgerViaPdp(page: Page) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("product-added-modal")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("product-added-modal")).not.toBeVisible();
}

/** VIEW MY BAG → /cart, through the once-per-session /forYou upsell. */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
}

/** The hidden operator gesture (useLongPress): a 3 s hold, in fake time. */
async function holdHotspot(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(3_000);
  await page.mouse.up();
}

/** Fake time in small steps until `done()` holds (autoUpdate.spec). */
async function stepClockUntil(page: Page, done: () => Promise<boolean>) {
  await expect
    .poll(
      async () => {
        await page.clock.runFor(500);
        return done();
      },
      { timeout: 20_000, intervals: [50] }
    )
    .toBe(true);
}

/** From here only runFor moves time (autoUpdate.spec). */
async function pauseClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 2_000);
}

interface KioskStore {
  dispatch: (action: unknown) => unknown;
}

/** The DEV-only store hook (store.ts): what a new service worker raises. */
const raiseWholeAppUpdate = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __kioskStore: KioskStore }).__kioskStore.dispatch({
      type: "autoUpdate/initiateWholeAppUpdate",
    });
  });

/** 100 s untouched (never the whole 120 s period in one jump): the prompt. */
async function idlePrompt(page: Page) {
  await page.clock.fastForward(100_000);
  await expect(page.getByTestId("idle-modal")).toBeVisible();
}

/** Order type with no menu behind it: the P9b menu-error dialog. */
async function menuError(page: Page) {
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-error")).toBeVisible({ timeout: 15_000 });
}

test.describe("lane fonts — entry/system/checkout/loyalty captures", () => {
  test("SPLASH WELCOME + SYSTEM: registration, the boot, WELCOME (1:5617), the Activity Center and the update countdown", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install();
    await mockKioskBackend(page);
    // Parks the boot's first call so the loading screen holds for its shot.
    let releaseBoot = () => {};
    const bootGate = new Promise<void>((resolve) => {
      releaseBoot = resolve;
    });
    await page.route("**/api/cx/kiosk/getLanguage", async (route) => {
      await bootGate;
      await route.fallback();
    });

    await page.goto("/");
    await expect(page.getByTestId("registration-screen")).toBeVisible();
    await capture(page, "entry-01-registration");

    await typeLicence(page);
    await page.getByTestId("registration-submit").click();
    await expect(page.getByTestId("loading-resources")).toBeVisible();
    // Paused: the parked request's budget cannot run out during the shot.
    await pauseClock(page);
    await capture(page, "entry-02-loading-resources");
    releaseBoot();
    await page.clock.resume();

    const splash = page.getByTestId("start-screen");
    await expect(splash).toBeVisible({ timeout: 10_000 });
    await expect(splash).toContainText(en.splash.welcome);
    await capture(page, "entry-03-splash-welcome");

    await holdHotspot(page, "activity-hotspot");
    await expect(page.getByTestId("activity-modal")).toContainText(
      en.activity.title
    );
    await capture(page, "entry-04-activity-center");
    // The three Archivo Black labels share the row, one line each (px-8).
    for (const id of ["activity-logout", "activity-reload-resources", "activity-close"]) {
      const lines = await page.getByTestId(id).evaluate((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      });
      expect.soft(lines, `${id}: label lines`).toBe(1);
    }
    await page.getByTestId("activity-close").click();
    await expect(page.getByTestId("activity-modal")).toHaveCount(0);

    await pauseClock(page);
    await raiseWholeAppUpdate(page);
    const countdown = page.getByTestId("update-countdown");
    await stepClockUntil(page, () => countdown.isVisible());
    await expect(countdown).toContainText(en.update.title);
    await capture(page, "entry-05-update-countdown");
  });

  test("SPLASH ONE IMAGE: a single home_screen image fills the stage under START ORDER (1:5604)", async ({
    page,
  }) => {
    await mockKioskBackend(page);
    await mockSplashMedia(page, [SLIDE_A]);
    await registerToStart(page);

    const splash = page.getByTestId("start-screen");
    await expect(splash.locator(`img[src="${SLIDE_A}"]`)).toHaveCount(1);
    await expect(splash).toContainText(en.splash.startOrder);
    await expect(splash).not.toContainText(en.splash.welcome);
    await capture(page, "entry-06-splash-full-bleed");
  });

  test("SPLASH CAROUSEL: two images in the peek carousel under ORDER HERE (1:2203)", async ({
    page,
  }) => {
    await mockKioskBackend(page);
    await mockSplashMedia(page, [SLIDE_A, SLIDE_B]);
    await registerToStart(page);

    const splash = page.getByTestId("start-screen");
    await expect(splash).toContainText(en.splash.orderHere);
    await expect(splash).toContainText(en.splash.startOrder);
    // Centre card plus both peeks.
    await expect(splash.locator(`img[src^="${MEDIA_ORIGIN}"]`)).toHaveCount(3);
    await capture(page, "entry-07-splash-carousel");
  });

  test("ORDER TYPE: /second (1:2581) in English and Arabic, the language sheet (1:4488), the idle prompt (1:4514) and the menu-error dialog in both languages", async ({
    page,
  }) => {
    test.slow();
    // Before the first goto: react-idle-timer captures setTimeout at load.
    await page.clock.install();
    await mockKioskBackend(page, { arabic: true, menu: false });
    await registerToStart(page);
    await page.getByTestId("start-screen").click();
    const second = page.getByTestId("second-screen");
    await expect(second).toContainText(en.second.title);
    await expect(page.getByTestId("pipeline-p1")).toContainText("Dine In");
    await capture(page, "entry-08-second-en");

    await idlePrompt(page);
    await expect(page.getByTestId("idle-modal")).toContainText(en.idle.body);
    await capture(page, "entry-09-idle-en");
    await page.getByTestId("idle-continue").click();
    await expect(page.getByTestId("idle-modal")).toHaveCount(0);

    await menuError(page);
    await expect(page.getByTestId("menu-error")).toContainText(en.menuError.message);
    await capture(page, "entry-10-menu-error-en");
    await page.getByTestId("menu-error-back").click();
    await expect(page.getByTestId("menu-error")).toHaveCount(0);

    await page.getByTestId("footer-language").click();
    await expect(page.getByTestId("language-ar")).toBeVisible();
    await capture(page, "entry-11-language-sheet");

    await page.getByTestId("language-ar").click();
    await expect(page.getByTestId("language-sheet")).toHaveCount(0);
    await expect(second).toContainText(ar.second.title);
    await expect(page.getByTestId("footer-language")).toContainText("العربية");
    await capture(page, "entry-12-second-ar");

    await idlePrompt(page);
    await expect(page.getByTestId("idle-modal")).toContainText(ar.idle.body);
    await capture(page, "entry-13-idle-ar");
    await page.getByTestId("idle-continue").click();
    await expect(page.getByTestId("idle-modal")).toHaveCount(0);

    await menuError(page);
    await expect(page.getByTestId("menu-error")).toContainText(ar.menuError.message);
    await capture(page, "entry-14-menu-error-ar");
  });

  test("CHECKOUT: /tent (1:4447) and its error banner, /payment (1:3364) and its PAY AT COUNTER window, /receipt (1:3377), Order Complete (1:5932)", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install();
    await mockKioskBackend(page, { skipCRM: true });
    // AFTER the base mocks (newest wins); a table tab routes PAY via /tent.
    await mockCheckoutBackend(page, { tabType: "table" });
    await registerToStart(page);
    await startOrderTo(page, "menu-screen");
    await addCheeseBurgerViaPdp(page);
    await openBag(page);

    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("tent-screen")).toBeVisible({ timeout: 15_000 });
    await capture(page, "entry-15-tent");

    // Below the 1..99 range: refused at CONFIRM with the red banner.
    await typeDigits(page, "0");
    await page.getByTestId("tent-confirm").click();
    await expect(page.getByTestId("tent-error")).toBeVisible();
    await capture(page, "entry-16-tent-error");

    await page.getByTestId("numpad-clear").click();
    await typeDigits(page, "12");
    await expect(page.getByTestId("tent-display")).toHaveText("12");
    await page.getByTestId("tent-confirm").click();
    await expect(page.getByTestId("payment-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("payment-total")).toContainText("£9.00");
    await capture(page, "entry-17-payment");

    // The 3 s cancel window, held still for its shot.
    await pauseClock(page);
    await page.getByTestId("payment-counter").click();
    await expect(page.getByTestId("payment-buffer")).toBeVisible();
    await capture(page, "entry-18-payment-buffer");
    await page.clock.runFor(3_500);
    await page.clock.resume();

    await expect(page.getByTestId("receipt-screen")).toBeVisible({ timeout: 15_000 });
    await capture(page, "entry-19-receipt");

    await page.getByTestId("receipt-none").click();
    await expect(page.getByTestId("order-success")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("order-number")).toHaveText(/^#\d{5}$/);
    await capture(page, "entry-20-order-success");
  });

  test("LOYALTY CHECKOUT: /phone, the rewards sheet after the lookup, /customerName and the cancel-order modal (1:4552)", async ({
    page,
  }) => {
    test.slow();
    await mockKioskBackend(page, { loyalty: "mandatory" });
    await mockXenoLoyalty(page);
    await registerToStart(page);
    await startOrderTo(page, "phone-screen");
    await expect(page.getByTestId("phone-number-display")).toContainText(
      en.phone.placeholder
    );
    await capture(page, "entry-21-phone");

    await typeDigits(page, LOYALTY_PHONE);
    await expect(page.getByTestId("phone-visibility")).toBeVisible();
    await capture(page, "entry-22-phone-filled");

    await page.getByTestId("phone-continue").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId(`loyalty-reward-${LOYALTY_REWARDS.cheeseBurger.couponCode}`)
    ).toBeVisible();
    await capture(page, "entry-23-loyalty-rewards");
    await page.getByTestId("loyalty-rewards-close").click();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toHaveCount(0);

    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await page.getByTestId("bag-pay").click();
    await expect(page.getByTestId("customer-name-screen")).toBeVisible({
      timeout: 10_000,
    });
    // The CRM prefill (getCustomerNameByNumber) has landed.
    await expect(page.getByTestId("customer-name-input")).toHaveText(
      CUSTOMER_NAME_ROWS[0].firstname
    );
    await capture(page, "entry-24-customer-name");

    await page.getByTestId("footer-cancel").click();
    await expect(page.getByTestId("cancel-order-modal")).toBeVisible();
    await capture(page, "entry-25-cancel-order");
  });

  test("LOYALTY LOGIN: the rewards login modal (1:4174), the OTP step and the REWARDS INCOMING seal (1:4079)", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install();
    await mockKioskBackend(page, { loyalty: "optional" });
    await mockXenoLoyalty(page);
    await registerToStart(page);
    await startOrderTo(page, "phone-screen");
    // An unidentified guest: the menu's REWARDS link opens the login modal.
    await page.getByTestId("phone-skip").click();
    await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("menu-rewards-link").click();
    await expect(page.getByTestId("loyalty-login")).toBeVisible();
    await typeDigits(page, LOYALTY_PHONE);
    await capture(page, "entry-26-loyalty-login");

    await page.getByTestId("loyalty-login-submit").click();
    await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("loyalty-login")).toHaveCount(0);
    await page
      .getByTestId(`loyalty-reward-${LOYALTY_REWARDS.greekSalad.couponCode}`)
      .click();
    await page.getByTestId("loyalty-redeem").click();
    await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({
      timeout: 10_000,
    });
    await typeDigits(page, LOYALTY_OTP);
    await capture(page, "entry-27-loyalty-otp");

    // The seal auto-closes after ~3 s: held still for its shot.
    await pauseClock(page);
    await page.getByTestId("loyalty-otp-submit").click();
    await expect(page.getByTestId("loyalty-success")).toBeVisible({
      timeout: 10_000,
    });
    await capture(page, "entry-28-loyalty-success");
    // The seal lettering is Exp Md (1:4079), and each wordmark copy ends
    // before the next one starts / the ring path ends — SVG drops the glyphs
    // that overrun a textPath without a trace, so the text probe cannot see it.
    const seal = page.getByTestId("loyalty-success").locator("svg text");
    await expect.soft(seal).toHaveCSS("font-stretch", "125%");
    await expect.soft(seal).toHaveCSS("font-weight", "500");
    const room = await seal.evaluate((text) => {
      const copies = [...text.querySelectorAll("textPath")];
      const ring = document.querySelector<SVGPathElement>(copies[0].getAttribute("href") ?? "");
      const length = ring?.getTotalLength() ?? 0;
      const starts = copies.map((copy) => {
        const offset = copy.getAttribute("startOffset") ?? "0";
        return offset.endsWith("%") ? (parseFloat(offset) / 100) * length : parseFloat(offset);
      });
      return copies.map((copy, i) =>
        Math.round((starts[i + 1] ?? length) - starts[i] - copy.getComputedTextLength())
      );
    });
    expect.soft(room.length, "wordmark copies").toBe(2);
    expect.soft(Math.min(...room), `seal: px left after each copy ${room}`).toBeGreaterThanOrEqual(0);
  });
});
