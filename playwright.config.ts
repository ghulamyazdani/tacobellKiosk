import { defineConfig, devices } from "@playwright/test";

// Port 5373 is deliberately unique: 5173 belongs to whatever other Restroworks
// Vite app is running, and 5273 is the posistKiosk E2E port. reuseExistingServer
// would otherwise attach this suite to the wrong app.
const PORT = 5373;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Kiosk hardware resolution — portrait.
    viewport: { width: 1080, height: 1920 },
  },
  projects: [
    {
      name: "smoke",
      testMatch: "**/smoke.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        // Re-declare AFTER the device spread — Desktop Chrome would force 1280×720.
        viewport: { width: 1080, height: 1920 },
      },
    },
    {
      name: "chromium",
      testIgnore: ["**/smoke.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1080, height: 1920 },
      },
    },
  ],
  webServer: {
    // --strictPort: fail loudly instead of drifting to another port and leaving
    // Playwright polling a URL that will never come up.
    command: `yarn dev`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
