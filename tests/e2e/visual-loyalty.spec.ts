import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clippedText } from "./fixtures/clippedText";
import {
  mockXenoLoyalty,
  LARGE_FRIES_ID,
  LOYALTY_OTP,
  LOYALTY_PHONE,
  LOYALTY_POINTS_TOTAL,
  LOYALTY_REWARDS,
  LOYALTY_SETTINGS,
} from "./fixtures/loyalty";

/**
 * Lane loyalty-visual — CAPTURE-ONLY screenshots of the reskinned Xeno
 * REWARDS sheet (Figma 1:3842 / 1:3948; user decision 2026-10-05: no pixel
 * assertions) in English, Arabic and the ADA reach-zone view: the reward
 * list with an out-of-stock reward and the operator's long loyalty texts
 * (D6b: the primary slot in English and ADA, the secondary slot in Arabic —
 * no cross-language fallback), then the OTP step. Each shot attaches
 * `loyalty-<mode>-NN-<step>`; the assertions prove the right state is up,
 * plus the house DOM probes (soft, so every shot is still taken): no text
 * the layout cuts off (`clippedText`), the header bell keeps its mask, the
 * title stays clear of the X — and in the ADA zone the OTP keypad needs no
 * scrolling with a long title (clamped to 2 lines there).
 *
 * Mocks and capture helpers are copied from visual-entry.spec.ts (no spec
 * exports them): the `**\/api/**` catch-all FIRST, the print agent aborted,
 * item photos served locally, every specific mock after it, then
 * `mockXenoLoyalty` LAST (it also answers the cross-origin revoke). Large
 * Fries (reward static8055) is out of stock through the converter's OOS feed.
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
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);
/** Every slim-menu item image (the kiosk aggregator entries included). */
const ITEM_IMAGE_HOST = "https://itemsposistnet.s3.ap-south-1.amazonaws.com/**";

/** D6b operator copy, real length — both language slots. */
const OPERATOR = {
  primary: {
    title: "Taco Bell Rewards Club Exclusive Member Treats",
    subtitle:
      "Pick any one of these treats below and we will add it to your order today, on the house, no strings attached.",
    alias: "Taco Bell Rewards Coins",
  },
  secondary: {
    title: "مكافآت نادي تاكو بيل الحصرية للأعضاء المميزين",
    subtitle:
      "اختر مكافأة واحدة من المكافآت أدناه وسنضيفها إلى طلبك اليوم مجانًا وبدون أي شروط إضافية على الإطلاق.",
    alias: "عملات مكافآت تاكو بيل",
  },
};
const OPERATOR_SETTINGS = {
  reward_title_primary: OPERATOR.primary.title,
  reward_subtitle_primary: OPERATOR.primary.subtitle,
  loyalty_point_alias_primary: OPERATOR.primary.alias,
  reward_title_secondary: OPERATOR.secondary.title,
  reward_subtitle_secondary: OPERATOR.secondary.subtitle,
  loyalty_point_alias_secondary: OPERATOR.secondary.alias,
};

const OOS_REWARD = LOYALTY_REWARDS.largeFries; // static8055 → Large Fries
const SALAD_REWARD = LOYALTY_REWARDS.greekSalad;

type Mode = "en" | "ar" | "ada";

async function mockKioskBackend(page: Page, mode: Mode) {
  const arabic = mode === "ar";
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route(ITEM_IMAGE_HOST, (r) =>
    r.fulfill({ body: PNG, contentType: "image/png" })
  );
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
        // A secondary language without its splash text fails the boot.
        ...(arabic ? { start_order_text_secondary: "ابدأ الطلب" } : {}),
        ideal_time: "180",
        ...(mode === "ada" ? { accessibility_mode: true } : {}),
        ...LOYALTY_SETTINGS,
        ...OPERATOR_SETTINGS,
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
          ...(arabic ? { secondary_name: "تناول في المطعم" } : {}),
        },
      ],
    })
  );
  await page.route("**/api/cx/kiosk/getMenu", (r) => r.fulfill({ json: slimMenu }));
  // The converter's OOS feed shape (registration.spec).
  await page.route("**/api/cx/kiosk/get_out_of_stock", (r) =>
    r.fulfill({
      json: [{ item_id: LARGE_FRIES_ID, type: "item", partners: { inStock: false } }],
    })
  );
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

/** KioskNumpad is the only numeric keypad mounted at a time. */
async function typeDigits(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByTestId(`numpad-key-${digit}`).click();
  }
}

/** Register → splash → /second (Arabic or the ADA view) → /phone → lookup → /menu. */
async function lookUpRewards(page: Page, mode: Mode) {
  await page.goto("/");
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("start-screen").click();
  await expect(page.getByTestId("second-screen")).toBeVisible();
  if (mode === "ar") {
    await page.getByTestId("footer-language").click();
    await page.getByTestId("language-ar").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  }
  if (mode === "ada") {
    await page.getByTestId("footer-ada").click();
    await expect(page.getByTestId("ada-brand-zone")).toBeVisible();
  }
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("phone-screen")).toBeVisible({ timeout: 15_000 });
  await typeDigits(page, LOYALTY_PHONE);
  await page.getByTestId("phone-continue").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("loyalty-rewards-sheet")).toBeVisible();
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

/**
 * Every <img> settled and every finite CSS keyframe animation (the sheet's
 * entrance) at rest before the shot, then the soft clipped-text probe
 * (visual-entry.spec capture).
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
                !Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity)
            )
      )
    )
    .toBe(true);
  await shot(page, name);
  expect.soft(await clippedText(page), `${name}: text the layout cuts off`).toEqual([]);
}

/**
 * The bell placeholders under `testId` (spans masked with the bell SVG): how
 * many, and how many lost their mask (visual-entry.spec bellMasks). Every
 * reward has a photo here, so the header bell is the only one.
 */
const bellMasks = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((root) => {
    const bells = [...root.querySelectorAll<HTMLElement>("span")].filter(
      (span) => span.style.getPropertyValue("mask-size") === "contain"
    );
    return {
      bells: bells.length,
      unmasked: bells.filter((span) => getComputedStyle(span).maskImage === "none").length,
    };
  });

/**
 * Pixels between the title's rightmost glyph run and the X's left edge
 * (negative = the title runs under the X). Text runs, not the box: a wrapped
 * title's lines centre inside it.
 */
const titleRoomBeforeClose = (page: Page) =>
  page.getByTestId("loyalty-rewards-sheet").evaluate((sheet) => {
    const title = sheet.querySelector("#loyalty-rewards-title");
    const close = sheet.querySelector('[data-testid="loyalty-rewards-close"]');
    if (!title || !close) return Number.NaN;
    const range = document.createRange();
    range.selectNodeContents(title);
    const right = Math.max(
      ...[...range.getClientRects()].filter((r) => r.width > 0.5).map((r) => r.right)
    );
    return Math.floor(close.getBoundingClientRect().left - right);
  });

async function probeHeader(page: Page, name: string) {
  expect
    .soft(await bellMasks(page, "loyalty-rewards-sheet"), `${name}: header bell`)
    .toEqual({ bells: 1, unmasked: 0 });
  expect
    .soft(await titleRoomBeforeClose(page), `${name}: px between the title and the X`)
    .toBeGreaterThanOrEqual(0);
}

const MODES: Mode[] = ["en", "ar", "ada"];

test.describe("lane loyalty-visual — the reskinned Xeno REWARDS sheet, captured", () => {
  for (const mode of MODES) {
    test(`REWARDS SHEET (${mode}): the reward list with an out-of-stock reward and the operator's long ${mode === "ar" ? "secondary" : "primary"}-slot texts (1:3842 / 1:3858), then the OTP step`, async ({
      page,
    }) => {
      test.slow();
      const copy = mode === "ar" ? ar : en;
      const operator = mode === "ar" ? OPERATOR.secondary : OPERATOR.primary;
      const other = mode === "ar" ? OPERATOR.primary : OPERATOR.secondary;
      await mockKioskBackend(page, mode);
      await mockXenoLoyalty(page);
      await lookUpRewards(page, mode);

      const sheet = page.getByTestId("loyalty-rewards-sheet");
      const title = page.locator("#loyalty-rewards-title");
      // D6b: the guest's slot only — never the other language's copy.
      await expect(title).toContainText(operator.title);
      await expect(title).not.toContainText(other.title);
      await expect(sheet).toContainText(operator.subtitle);
      const balance = page.getByTestId("loyalty-points-balance");
      await expect(balance).toContainText(String(LOYALTY_POINTS_TOTAL));
      await expect(balance).toContainText(operator.alias);
      if (mode !== "ar") {
        await expect(balance).toHaveText(`You have ${LOYALTY_POINTS_TOTAL} ${operator.alias}`);
      }
      // The out-of-stock reward: informational, never a target (1:3858).
      const oos = page.getByTestId(`loyalty-reward-${OOS_REWARD.couponCode}`);
      await expect(oos).toHaveAttribute("aria-disabled", "true");
      await expect(oos).not.toHaveAttribute("role", "radio");
      await expect(oos).toContainText(copy.menu.unavailable);
      await expect(oos).not.toContainText(String(OOS_REWARD.points));
      const salad = page.getByTestId(`loyalty-reward-${SALAD_REWARD.couponCode}`);
      await expect(salad).toHaveAttribute("role", "radio");
      await expect(salad).toContainText(operator.alias);
      await capture(page, `loyalty-${mode}-01-rewards`);
      await probeHeader(page, `loyalty-${mode}-01-rewards`);

      await salad.click();
      await page.getByTestId("loyalty-redeem").click();
      await expect(page.getByTestId("loyalty-otp-display")).toBeVisible({ timeout: 10_000 });
      await typeDigits(page, LOYALTY_OTP);
      await expect(page.getByTestId("loyalty-otp-display")).toContainText(LOYALTY_OTP.slice(-1));
      await capture(page, `loyalty-${mode}-02-otp`);
      await probeHeader(page, `loyalty-${mode}-02-otp`);
      if (mode === "ada") {
        // UI-1: the long title clamps to 2 lines on this step, so the keypad
        // fits the 1026 px zone sheet without scrolling.
        const fit = await page
          .getByTestId("loyalty-otp-display")
          .evaluate((display) => {
            const scroller = display.closest(".overflow-y-auto");
            return scroller ? scroller.scrollHeight - scroller.clientHeight : Number.NaN;
          });
        expect.soft(fit, "ADA OTP step: px of keypad below the fold").toBeLessThanOrEqual(0);
      }
    });
  }
});
