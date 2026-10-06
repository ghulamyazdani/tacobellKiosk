import { test, expect } from "@playwright/test";
import { APP_ORIGIN } from "./fixtures/origin";

test.describe("boot flow smoke (registration-first, posistKiosk parity)", () => {
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
    // No boot ran, so no splash media is stored: the WELCOME frame (P9d).
    await expect(splash).toContainText(/touch anywhere to start/i);

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
