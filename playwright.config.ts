import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT } from "./tests/e2e/fixtures/origin";

// Port 5373 is deliberately unique: 5173 belongs to whatever other Restroworks
// Vite app is running, and 5273 is the posistKiosk E2E port. reuseExistingServer
// would otherwise attach this suite to the wrong app. TB_E2E_PORT overrides it
// for a parallel worktree lane only (never 5173/5273).
const PORT = E2E_PORT;

const config = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 30_000,
  // The suite is load-sensitive (2–3× slower under contention): a 2-vCPU CI
  // runner running Vite + Chromium is contention by construction.
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // CI: PR annotations AND an HTML report (uploaded as an artifact even on
  // green runs — it carries the capture-only screenshots).
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Kiosk hardware resolution — portrait.
    viewport: { width: 1080, height: 1920 },
    // Motion lane: the functional suite and the visual walks run deterministic
    // (every animation ends in 1 ms — index.css reduced-motion block). Real
    // motion is proven by tests/e2e/motion.spec.ts (no-preference).
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "smoke",
      testMatch: "**/smoke.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        // Re-declare AFTER the device spread — Desktop Chrome would force 1280×720.
        viewport: { width: 1080, height: 1920 },
        // window.screen = the kiosk panel. The fullscreen gate (audit-fixes U2)
        // counts a window that fills its screen as locked; Desktop Chrome's
        // screen is 1920×1080, which would trip it on every spec. The runner
        // forwards `screen` only via contextOptions (a top-level `screen` is
        // not a test option — today the page falls back to the viewport, the
        // same 1080×1920). A spec that wants the gate sets a taller screen
        // with test.use({ contextOptions: { screen } }).
        contextOptions: { screen: { width: 1080, height: 1920 } },
      },
    },
    {
      name: "chromium",
      testIgnore: ["**/smoke.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1080, height: 1920 },
        // See the smoke project: keeps the fullscreen gate (U2) quiet.
        contextOptions: { screen: { width: 1080, height: 1920 } },
      },
    },
  ],
  webServer: {
    // --strictPort: fail loudly instead of drifting to another port and leaving
    // Playwright polling a URL that will never come up.
    // = `yarn dev` with the port substituted (the script pins 5373).
    command: `yarn vite --host --mode development --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

/**
 * TB_E2E_PREVIEW=1 — the PRODUCTION bundle, as its own invocation on the same port:
 *   TB_E2E_PREVIEW=1 TB_E2E_PORT=<port> yarn playwright test
 * runs ONLY the "preview" project (tests/e2e/*.preview.ts, which no project above matches) against
 * `vite build` + `vite preview`. Service workers are blocked so page routes see every request;
 * a server already on the port is an error, never reused (it would be the dev server).
 * fixtures/backend.ts reads the same flag (its backend origin comes from .env.production then).
 */
export default process.env.TB_E2E_PREVIEW === "1"
  ? defineConfig({
      ...config,
      projects: [
        {
          name: "preview",
          testMatch: "**/*.preview.ts",
          use: {
            ...devices["Desktop Chrome"],
            viewport: { width: 1080, height: 1920 },
            // See the smoke project: keeps the fullscreen gate (U2) quiet.
            contextOptions: { screen: { width: 1080, height: 1920 } },
            serviceWorkers: "block",
          },
        },
      ],
      webServer: {
        command: `yarn vite build && yarn vite preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 180_000,
      },
    })
  : config;
