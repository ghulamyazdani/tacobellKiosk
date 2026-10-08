import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * audit-fixes U2 — the fullscreen lock (FullscreenGate), end to end.
 *
 * A registered kiosk whose operator left mandatory fullscreen on (the
 * default) covers a window that is not fullscreen with ONE full-window "TAP
 * TO CONTINUE" button: a tap enters fullscreen and the guest is back where
 * they were. Locked = an element is fullscreen, OR display-mode fullscreen,
 * OR the window fills its screen — so Chrome --kiosk never sees the gate.
 *
 * ── THE SCREEN ──────────────────────────────────────────────────────────
 * Both Playwright projects pin `contextOptions.screen` to the 1080×1920
 * viewport: a window that fills its screen, i.e. --kiosk — that keeps the
 * gate out of every other spec (and the last describe here proves it).
 * The windowed browser of the gate walks is a taller screen (1080×2100)
 * under the same viewport. A top-level `screen` test option does not exist
 * in Playwright 1.63 (tsc rejects it, the runner would not forward it).
 *
 * ── FULLSCREEN IN HEADLESS CHROMIUM ─────────────────────────────────────
 * Checked before this spec was written: a real Playwright click (a trusted
 * gesture) makes requestFullscreen() RESOLVE, sets
 * document.fullscreenElement and fires fullscreenchange; exitFullscreen()
 * reverses it. The viewport stays 1080×1920 (emulated), so the gate walks
 * drive the real Fullscreen API. Only the Rule-2 walks stub it (an init
 * script): a browser that refuses fullscreen, or has none, never blocks the
 * guest — the gate fails open.
 *
 * Mocks (registration.spec / splash.spec house order): the `**\/api/**`
 * catch-all FIRST, the print agent aborted, every boot mock after it.
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

const en = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../src/i18n/locales/en/translation.json", import.meta.url))
  ).toString("utf-8")
);

/** A windowed browser: the 1080×1920 window on a taller screen. */
const WINDOWED = { width: 1080, height: 2100 };

async function mockBootEndpoints(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees it.
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
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({ json: [{ _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" }] })
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
      json: { start_order_text_primary: "START ORDER", ideal_time: "180" },
    })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
}

/** The licence on the on-screen keyboard (digits live behind the 123 layer). */
async function register(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("registration-screen")).toBeVisible();
  // Registration is never gated: no token yet.
  await expect(page.getByTestId("fullscreen-gate")).toHaveCount(0);
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await page.waitForURL(/\/start$/, { timeout: 15_000 });
  await expect(page.getByTestId("start-screen")).toBeVisible();
}

const isFullscreen = (page: Page) =>
  page.evaluate(() => document.fullscreenElement !== null);

/** The element a guest's finger lands on, mid-screen. */
const topTestIdAtCentre = (page: Page) =>
  page.evaluate(
    () =>
      document
        .elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
        ?.closest("[data-testid]")
        ?.getAttribute("data-testid") ?? null
  );

/** The operator gesture: a 3 s hold on the splash's top-left corner (real time). */
async function holdHotspot(page: Page) {
  const box = await page.getByTestId("activity-hotspot").boundingBox();
  if (!box) throw new Error("activity-hotspot has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Keep the finger down until the Activity Center is up (house rule).
  await expect(page.getByTestId("activity-modal")).toBeVisible({ timeout: 10_000 });
  await page.mouse.up();
}

/** Types on the docked KioskKeyboard: shift is single-shot, symbols / digits behind 123. */
async function typeOnKeyboard(page: Page, keys: string[]) {
  const keyboard = page.getByTestId("kiosk-keyboard");
  for (const key of keys) {
    await keyboard.getByRole("button", { name: key, exact: true }).click();
  }
}

test.describe("U2 — a windowed browser is gated (screen 1080×2100)", () => {
  test.use({ contextOptions: { screen: WINDOWED } });

  test("GATE BLOCKS: a registered kiosk shows the gate on /start; the first tap only enters fullscreen, the next one starts the order", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    await register(page);

    const gate = page.getByTestId("fullscreen-gate");
    await expect(gate).toBeVisible();
    // One button, named by its copy (the two lines are flex items: blocks).
    await expect(gate).toHaveAccessibleName(`${en.fullscreen.title} ${en.fullscreen.body}`);
    // It owns the whole window: the splash under it cannot be tapped.
    expect(await topTestIdAtCentre(page)).toBe("fullscreen-gate");
    expect(await isFullscreen(page)).toBe(false);

    await gate.click();

    await expect.poll(() => isFullscreen(page)).toBe(true);
    await expect(gate).toHaveCount(0);
    // The tap was the gate's, not the splash's: still /start.
    await expect(page).toHaveURL(/\/start$/);

    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
  });

  test("EXIT RE-ARMS: leaving fullscreen brings the gate back over the guest's screen; one tap and they are back where they were", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    await register(page);
    await page.getByTestId("fullscreen-gate").click();
    await expect.poll(() => isFullscreen(page)).toBe(true);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();

    await page.evaluate(() => document.exitFullscreen());

    const gate = page.getByTestId("fullscreen-gate");
    await expect(gate).toBeVisible();
    expect(await topTestIdAtCentre(page)).toBe("fullscreen-gate");

    await gate.click();

    await expect.poll(() => isFullscreen(page)).toBe(true);
    await expect(gate).toHaveCount(0);
    await expect(page).toHaveURL(/\/second$/);
    await expect(page.getByTestId("second-screen")).toBeVisible();
  });

  test("OPERATOR OFF: the passcode, typed on the on-screen keyboard, turns the lock off and leaves fullscreen — the gate stays gone; turning it back on re-arms it at once", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    await register(page);
    await page.getByTestId("fullscreen-gate").click();
    await expect.poll(() => isFullscreen(page)).toBe(true);

    await holdHotspot(page);
    const toggle = page.getByTestId("activity-fullscreen-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(page.getByTestId("kiosk-keyboard")).toBeVisible();
    // The docked keyboard leaves the lifted card's controls tappable.
    const card = await page.getByTestId("activity-passcode").boundingBox();
    const keyboard = await page.getByTestId("kiosk-keyboard").boundingBox();
    if (!card || !keyboard) throw new Error("no passcode block or keyboard box");
    expect(card.y + card.height).toBeLessThan(keyboard.y);

    // The inherited constant (PROGRESS open decision: a server-issued secret is owed).
    await typeOnKeyboard(page, [
      en.keyboard.shift,
      "p",
      "o",
      "s",
      en.keyboard.layerToggle,
      "@",
      "1",
      "2",
      "3",
    ]);
    await expect(page.getByTestId("activity-passcode-input")).toHaveValue("Pos@123");
    await page.getByTestId("keyboard-go").click();

    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("kiosk-keyboard")).toHaveCount(0);
    await expect.poll(() => isFullscreen(page)).toBe(false);
    // Windowed again, and no gate: sampled over 1.5 s (fcm.spec E10).
    const sampleUntil = Date.now() + 1_500;
    await expect
      .poll(
        async () =>
          (await page.getByTestId("fullscreen-gate").count()) === 0 && Date.now() >= sampleUntil,
        { timeout: 5_000, intervals: [100] }
      )
      .toBe(true);

    // Back on: the gate covers the Activity Center at once; a tap re-enters
    // fullscreen and the operator is where they were.
    await toggle.click();
    const gate = page.getByTestId("fullscreen-gate");
    await expect(gate).toBeVisible();
    await gate.click();
    await expect.poll(() => isFullscreen(page)).toBe(true);
    await expect(page.getByTestId("activity-modal")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

/** No gate over a sampled window (fcm.spec E10: prove a negative over time). */
async function expectNoGateFor(page: Page, ms: number) {
  const sampleUntil = Date.now() + ms;
  await expect
    .poll(
      async () =>
        (await page.getByTestId("fullscreen-gate").count()) === 0 && Date.now() >= sampleUntil,
      { timeout: ms + 5_000, intervals: [100] }
    )
    .toBe(true);
}

test.describe("U2 — the gate never blocks the guest (Rule 2; screen 1080×2100)", () => {
  test.use({ contextOptions: { screen: WINDOWED } });

  test("REFUSED: the browser refuses fullscreen — the first tap takes the gate down for the page load and the guest orders on; the next page load re-arms it", async ({
    page,
  }) => {
    // Before any page script: every request is refused (an iframe, a
    // permissions policy, a kiosk shell that forbids the API).
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = () =>
        Promise.reject(new TypeError("Permissions check failed"));
    });
    await mockBootEndpoints(page);
    await register(page);

    const gate = page.getByTestId("fullscreen-gate");
    await expect(gate).toBeVisible();
    await gate.click();

    // Fail open: the gate goes, the window stays windowed, still /start.
    await expect(gate).toHaveCount(0);
    expect(await isFullscreen(page)).toBe(false);
    await expect(page).toHaveURL(/\/start$/);
    // Its own re-check (a resize) never brings it back for this page load.
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await expectNoGateFor(page, 1_000);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
    await expect(gate).toHaveCount(0);

    // A new page load asks again — and fails open again.
    await page.reload();
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await gate.click();
    await expect(gate).toHaveCount(0);
    expect(await isFullscreen(page)).toBe(false);
  });

  test("NO FULLSCREEN: a browser that cannot go fullscreen (fullscreenEnabled false) never shows the gate", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Document.prototype, "fullscreenEnabled", {
        configurable: true,
        get: () => false,
      });
    });
    await mockBootEndpoints(page);
    await register(page);

    await expectNoGateFor(page, 1_000);
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
    await expect(page.getByTestId("fullscreen-gate")).toHaveCount(0);
  });
});

test.describe("U2 — a window that fills its screen (--kiosk) is never gated", () => {
  test("the default 1080×1920 screen: registration, /start and /second stay ungated", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    await register(page);
    expect(await isFullscreen(page)).toBe(false);
    await expect(page.getByTestId("fullscreen-gate")).toHaveCount(0);

    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
    await expect(page.getByTestId("fullscreen-gate")).toHaveCount(0);
  });
});
