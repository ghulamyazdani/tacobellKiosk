import { test, expect } from "./fixtures/kiosk";
import { mockKioskBackend } from "./fixtures/backend";
import { APP_ORIGIN } from "./fixtures/origin";

test.describe("boot flow smoke (registration-first, posistKiosk parity)", () => {
  // A registered device reports its build version (useAutoUpdate → update_cx_software): the mock
  // answers it, never a real backend (unmocked, it reached VITE_API_ENDPOINT).
  test.beforeEach(({ page }) => mockKioskBackend(page));

  test("unregistered device: / shows Registration; /start redirects back", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("registration-screen")).toBeVisible();

    await page.goto("/start");
    // No token → guard bounces to Registration.
    await expect(page.getByTestId("registration-screen")).toBeVisible();
  });

  test("registered device: / redirects to the splash; tap starts the order", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "token", value: "e2e-device-token", url: APP_ORIGIN },
    ]);
    // P9f: PostHog loads lazily and only behind the production kill switch,
    // which no e2e run sets — so posthog-js is never fetched, neither the
    // static import it used to be nor the posthogRuntime chunk.
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await page.goto("/");
    // Token → guard skips Registration straight to the attract screen.
    const splash = page.getByTestId("start-screen");
    await expect(splash).toBeVisible();
    // No boot ran, so nothing is stored — no splash media (the WELCOME frame,
    // P9d), no kiosk settings: its one line is the i18n fallback (2026-10-16).
    await expect(splash).toHaveText(/^order here$/i);

    // Whole screen is one tap target (kiosk convention).
    await splash.click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
    await expect(page.getByTestId("second-screen")).toContainText(
      /where are you eating/i
    );

    // Not vacuous: the app's own modules were collected (dev serves src/).
    expect(
      requested.some((url) => new URL(url).pathname === "/src/main.tsx")
    ).toBe(true);
    expect(requested.filter((url) => /posthog/i.test(url))).toEqual([]);
  });
});
