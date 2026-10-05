import { test, expect } from "@playwright/test";

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
      { name: "token", value: "e2e-device-token", url: "http://localhost:5373" },
    ]);

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
  });
});
