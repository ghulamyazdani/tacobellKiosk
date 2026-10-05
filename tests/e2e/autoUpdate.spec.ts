import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN } from "./fixtures/origin";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * P9e — updates apply ONLY at the splash, end to end (Rule 1), and the boot
 * refresh never strands the kiosk (Rule 2).
 *
 * Covers the StartScreen apply machine (whole_app > brand > scheduled; a
 * 15 s dwell whose last 5 s are a non-dismissable countdown; a guest tap,
 * the Activity Center or being offline disarms it), the refresh-mode boot on
 * /LoadingResources (STAGE → COMMIT: a failed refresh commits nothing,
 * stamps lastRefreshFailedAt and returns straight to /start, then the splash
 * backs off 30 min), the operator "Reload resources", the version report's
 * token gate and the D2 telemetry exemption (a 401/504 on background
 * telemetry never logs the kiosk out).
 *
 * ── TIME: page.clock, NEVER REAL WAITS ──────────────────────────────────
 * `page.clock.install()` runs before the first goto (beforeEach). The
 * installed clock flows in real time between calls, so "not yet" checks keep
 * a wide margin (≥ 5 s) from their deadline and "eventually" steps are
 * driven by `stepClockUntil` (recovery.spec.ts), which waits on the STATE a
 * timer chain produces. Where a test pins the dwell's exact boundaries
 * (nothing at 9 s, "Starting in 5s" at 10 s, the apply at 15 s) it first
 * `pauseClock`s: a paused clock moves only under runFor, so the arming
 * dispatch and every tick land on exact fake instants. Hours are crossed
 * with `fastForward`, which fires the splash's pending re-check (≤ 15 min,
 * it re-reads the wall clock — built for exactly such jumps) ONCE at the
 * target; a `runFor(500)` then lets it re-arm before the next check. No
 * jump crosses the deadline under test (the 6 h age, the 30 min backoff) —
 * the last step to it is short (PROGRESS.md stepping rules).
 *
 * ── STATE ───────────────────────────────────────────────────────────────
 * Flags are raised and boot ages seeded through the DEV-only
 * `window.__kioskStore` (store.ts; `yarn dev` is a development build), always
 * after the splash is visible — i.e. after redux-persist rehydrated.
 *
 * ── MOCK ORDER ──────────────────────────────────────────────────────────
 * House order (idle.spec.ts / recovery.spec.ts): the `**\/api/**` catch-all
 * FIRST, the cross-origin edges it cannot see routed explicitly (print agent
 * aborted, Xeno revoke answered), every specific mock after it (Playwright
 * matches newest-first). The boot endpoints a test breaks are SCRIPTED: each
 * route reads the backend handle per request, so a test re-scripts an
 * answer mid-flow instead of stacking routes. Boot helpers are copied from
 * idle.spec.ts / recovery.spec.ts (no spec exports them — house precedent).
 */

const BASE_URL = APP_ORIGIN;

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
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8")
  );

const slimMenu = readJson("./fixtures/slim-menu.json");
const en = readJson("../../src/i18n/locales/en/translation.json");
/** process.env.PACKAGE_VERSION is package.json's version (vite.config.ts define). */
const VERSION: string = readJson("../../package.json").version;

/** £17, no modifiers, no recommendedItems: one tap lands it, no modal. */
const GREEK_SALAD = "5dd1093829754a432f2c32e2";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Older than BOOT_DATA_MAX_AGE_MS (6 h, @cx-sdk/devices updatePolicy). */
const STALE_AGE_MS = 7 * HOUR;

const PIPELINE_P1 = { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" };
const PIPELINE_P2 = { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take Out" };
const KIOSK_SETTINGS = { start_order_text_primary: "START ORDER", ideal_time: "180" };
/** Real rows on the first boot, so "kept" (B3/B4) is distinguishable from the [] default. */
const DEPLOYMENT_ROWS = [{ name: "disable_roundoff", selected: true }];
const DEVICE_ROWS = [{ group: "general", setting_id: "tent_number_range", value: "1-50" }];

/** One scripted answer; the route reads it per request. */
interface Answer {
  status: number;
  json: unknown;
}
const ok = (json: unknown): Answer => ({ status: 200, json });
const fail = (status: number): Answer => ({ status, json: {} });

interface KioskBackend {
  /** Requests per boot endpoint: every boot (first or refresh) hits each once. */
  hits: { getLanguage: number; getPipelines: number; settings: number };
  pipelines: Answer;
  settings: Answer;
  deploymentSettings: Answer;
  deviceSettings: Answer;
  /** update_device_status bodies, in order. */
  acks: unknown[];
  ackStatus: number;
  /** update_cx_software requests, in order. */
  versionReports: { body: unknown; auth: string | undefined }[];
  versionStatus: number;
}

async function mockKioskBackend(page: Page): Promise<KioskBackend> {
  const backend: KioskBackend = {
    hits: { getLanguage: 0, getPipelines: 0, settings: 0 },
    pipelines: ok([PIPELINE_P1]),
    settings: ok(KIOSK_SETTINGS),
    deploymentSettings: ok(DEPLOYMENT_ROWS),
    deviceSettings: ok(DEVICE_ROWS),
    acks: [],
    ackStatus: 200,
    versionReports: [],
    versionStatus: 200,
  };
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them (header).
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) =>
    r.fulfill({ json: { status: "success" } })
  );
  await page.route("**/api/cx/kiosk/getLanguage", (r) => {
    backend.hits.getLanguage += 1;
    return r.fulfill({
      json: {
        primary_language: { name: "English", code: "en", dir: "ltr" },
        secondary_language: {},
      },
    });
  });
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
  await page.route("**/api/cx/get_kiosk_settings", (r) => {
    backend.hits.settings += 1;
    return r.fulfill(backend.settings);
  });
  await page.route("**/api/cx/kiosk/getPipelines", (r) => {
    backend.hits.getPipelines += 1;
    return r.fulfill(backend.pipelines);
  });
  await page.route("**/api/cx/kiosk/getDeploymentSettings", (r) =>
    r.fulfill(backend.deploymentSettings)
  );
  await page.route("**/api/cx/getKisokDeviceData", (r) =>
    r.fulfill(backend.deviceSettings)
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
  await page.route("**/api/cx/update_device_status", (r) => {
    backend.acks.push(r.request().postDataJSON());
    return r.fulfill({ status: backend.ackStatus, json: {} });
  });
  await page.route("**/api/cx/update_cx_software", (r) => {
    backend.versionReports.push({
      body: r.request().postDataJSON(),
      auth: r.request().headers()["authorization"],
    });
    return r.fulfill({ status: backend.versionStatus, json: {} });
  });
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
  return backend;
}

/** The licence on the on-screen keyboard (digits live behind the 123 layer). */
async function typeLicence(page: Page) {
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
}

/** Type the licence and submit — the first boot starts. */
async function submitLicence(page: Page) {
  await page.goto("/");
  await typeLicence(page);
  await page.getByTestId("registration-submit").click();
}

async function registerToStart(page: Page) {
  await submitLicence(page);
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

/** Splash → order type → /menu (loyalty off). */
async function startOrderToMenu(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

async function addGreekSaladOneTap(page: Page, expectedCount: string) {
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText(expectedCount);
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

/**
 * Advances fake time in small steps until `done()` holds — for timer chains
 * the page re-arms itself (recovery.spec.ts). A slow page costs steps, never
 * a skipped or real-time tick.
 */
async function stepClockUntil(
  page: Page,
  done: () => boolean | Promise<boolean>,
  { stepMs = 500, timeout = 20_000 } = {}
) {
  await expect
    .poll(
      async () => {
        await page.clock.runFor(stepMs);
        return done();
      },
      { timeout, intervals: [50] }
    )
    .toBe(true);
}

/**
 * Stops the clock's real-time flow (a short jump ahead first, so the target
 * is never in the past). From here only runFor moves time: what the page
 * arms next starts on an exact fake instant. `page.clock.resume()` undoes it.
 */
async function pauseClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 2_000);
}

interface KioskStore {
  getState: () => Record<string, Record<string, unknown>>;
  dispatch: (action: unknown) => unknown;
}
type KioskWindow = Window & { __kioskStore: KioskStore };

interface AutoUpdateState {
  shouldWholeAppUpdate: boolean;
  shouldBrandUpdate: boolean;
  device_update_id: string;
  kioskDeviceVersion: string;
  lastBootAt: number;
  lastRefreshFailedAt: number;
}

/** state.autoUpdate (+ the page's fake `now`), via the DEV-only window.__kioskStore. */
const readAutoUpdate = (page: Page) =>
  page.evaluate(() => ({
    ...((window as unknown as KioskWindow).__kioskStore.getState()
      .autoUpdate as unknown as AutoUpdateState),
    now: Date.now(),
  }));

const dispatch = (page: Page, action: { type: string; payload?: unknown }) =>
  page.evaluate((a) => {
    (window as unknown as KioskWindow).__kioskStore.dispatch(a);
  }, action);

const WHOLE_APP_UPDATE = { type: "autoUpdate/initiateWholeAppUpdate" };
/** What useFcmRegistration dispatches for an FCM brand-update push. */
const brandPush = (deviceUpdateId: string) => ({
  type: "autoUpdate/receivedUpdateNotif",
  payload: { shouldBrandUpdate: true, device_update_id: deviceUpdateId },
});

/** Stamps the last successful boot `ageMs` ago, on the PAGE's (fake) clock. */
const seedBootAge = (page: Page, ageMs: number) =>
  page.evaluate((age) => {
    (window as unknown as KioskWindow).__kioskStore.dispatch({
      type: "autoUpdate/setLastBootAt",
      payload: Date.now() - age,
    });
  }, ageMs);

/** What a boot commits and the kiosk sells from — a failed refresh must leave it identical. */
const bootData = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as KioskWindow).__kioskStore.getState();
    return JSON.parse(
      JSON.stringify({
        pipelines: s.pipeline.pipelines,
        kioskSettings: s.appSettings.kiosk_settings,
        deploymentInfoSettings: s.appSettings.deploymentInfoSettings,
        generalSettings: s.appSettings.generalSettings,
        paymentSettings: s.appSettings.paymentSettings,
        mediaData: s.appSettings.mediaData,
        language: s.multiLanguage.primary_language,
      })
    ) as Record<string, unknown>;
  });

/** autoUpdate as redux-persist last wrote it (`persist:root`). Read-only. */
const persistedAutoUpdate = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("persist:root");
    const slice = raw
      ? (JSON.parse(raw) as Record<string, string>).autoUpdate
      : undefined;
    return (slice ? JSON.parse(slice) : {}) as Partial<AutoUpdateState>;
  });

/** Rows in a Dexie table (KioskDB). Read-only. */
function dexieCount(page: Page, table: "cartItems" | "menus"): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("KioskDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const count = db.transaction(name, "readonly").objectStore(name).count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            db.close();
            reject(count.error);
          };
        };
      }),
    table
  );
}

const tokenCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((c) => c.name === "token")?.value;

/** Full page loads from here on (a whole-app apply is exactly one). */
function countLoads(page: Page): () => number {
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  return () => loads;
}

/** Main-frame paths from here on, SPA navigations included. */
function trackPaths(page: Page): string[] {
  const paths: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) paths.push(new URL(frame.url()).pathname);
  });
  return paths;
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

const countdown = (page: Page) => page.getByTestId("update-countdown");
const countdownStatus = (page: Page) => page.getByTestId("update-countdown-status");
const countdownCopy = (seconds: number): string =>
  en.update.countdown.replace("{{seconds}}", String(seconds));

test.describe("P9e updates apply only at the splash", () => {
  // Before ANY page script runs: timers captured at module load must be fake.
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test.describe("whole-app update (a new build)", () => {
    test("E1 at the splash: invisible for 10 s, a non-dismissable 5 s countdown, then exactly ONE reload to /start that clears the flag and runs no boot", async ({
      page,
    }) => {
      const backend = await mockKioskBackend(page);
      await registerToStart(page);
      const booted = (await readAutoUpdate(page)).lastBootAt;
      const loads = countLoads(page);

      await pauseClock(page);
      await dispatch(page, WHOLE_APP_UPDATE);
      // The splash stays fully usable for the first 10 s: nothing on screen.
      await page.clock.runFor(9_000);
      await expect(countdown(page)).toHaveCount(0);
      await page.clock.runFor(1_000);
      await expect(countdown(page)).toBeVisible();
      await expect(countdown(page)).toContainText(en.update.title);
      await expect(countdownStatus(page)).toHaveText(countdownCopy(5));
      // Non-dismissable: a tap on it is swallowed, the guest is not let in.
      await page.mouse.click(540, 960);
      await page.clock.runFor(4_000);
      await expect(countdownStatus(page)).toHaveText(countdownCopy(1));
      await expect(page).toHaveURL(/\/start$/);
      expect(loads()).toBe(0);

      const load = page.waitForEvent("load");
      await page.clock.runFor(1_000);
      await load;
      await page.clock.resume();
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/start$/);
      expect(loads()).toBe(1);
      const after = await readAutoUpdate(page);
      // Session-only (store.ts manifest): the reload itself clears it.
      expect(after.shouldWholeAppUpdate).toBe(false);
      // A reload, not a boot: the token cookie lands on /start directly.
      expect(after.lastBootAt).toBe(booted);
      expect(backend.hits.getLanguage).toBe(1);

      // No reload loop.
      await page.clock.runFor(20_000);
      await expect(countdown(page)).toHaveCount(0);
      expect(loads()).toBe(1);
    });

    test("E2 never mid-order: flagged on /menu with a bag, nothing in 120 s; the guest's cancel → /start → ONE reload 15 s later, and the next bag is empty", async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await registerToStart(page);
      await startOrderToMenu(page);
      await addGreekSaladOneTap(page, "(1)");
      const loads = countLoads(page);

      await dispatch(page, WHOLE_APP_UPDATE);
      // 120 s mid-order; a touch at 60 s keeps the guest under the 100 s idle prompt.
      await page.clock.runFor(60_000);
      await page.mouse.move(540, 700);
      await page.clock.runFor(60_000);
      await expect(page).toHaveURL(/\/menu$/);
      await expect(page.getByTestId("idle-modal")).toHaveCount(0);
      await expect(countdown(page)).toHaveCount(0);
      await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
      expect(loads()).toBe(0);
      expect((await readAutoUpdate(page)).shouldWholeAppUpdate).toBe(true);

      await page.getByTestId("footer-cancel").click();
      await page.getByTestId("cancel-order-confirm").click();
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await page.clock.runFor(5_000);
      await expect(countdown(page)).toHaveCount(0);
      const load = page.waitForEvent("load");
      await stepClockUntil(page, () => loads() === 1);
      await load;
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/start$/);
      expect((await readAutoUpdate(page)).shouldWholeAppUpdate).toBe(false);
      await expect.poll(() => dexieCount(page, "cartItems")).toBe(0);
      await startOrderToMenu(page);
      await expect(page.getByTestId("cta-view-bag")).toContainText("(0)");
      expect(loads()).toBe(1);
    });

    test("E3 a tap in the first 10 s lets the guest in (/second) and the update waits; idle brings the kiosk home and it applies 15 s later", async ({
      page,
    }) => {
      test.slow();
      await mockKioskBackend(page);
      await registerToStart(page);
      const loads = countLoads(page);

      await dispatch(page, WHOLE_APP_UPDATE);
      await page.clock.runFor(5_000);
      await expect(countdown(page)).toHaveCount(0);
      await page.getByTestId("start-screen").click();
      await expect(page.getByTestId("second-screen")).toBeVisible();
      await page.clock.runFor(30_000);
      await expect(page).toHaveURL(/\/second$/);
      expect(loads()).toBe(0);
      expect((await readAutoUpdate(page)).shouldWholeAppUpdate).toBe(true);

      // P9a: the deferral ends by itself — prompt 100 s after the tap, splash at 120 s.
      await page.clock.fastForward(70_000);
      await expect(page.getByTestId("idle-modal")).toBeVisible();
      await page.clock.fastForward(20_000);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      expect(loads()).toBe(0);
      const load = page.waitForEvent("load");
      await stepClockUntil(page, () => loads() === 1);
      await load;
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      expect((await readAutoUpdate(page)).shouldWholeAppUpdate).toBe(false);
    });

    test("E4 the Activity Center pauses the dwell: nothing while it is open; closing it starts a FULL fresh 15 s", async ({
      page,
    }) => {
      await mockKioskBackend(page);
      await registerToStart(page);
      const loads = countLoads(page);

      await dispatch(page, WHOLE_APP_UPDATE);
      // 3 s of the dwell pass during the operator's hold.
      await holdHotspot(page, "activity-hotspot");
      await expect(page.getByTestId("activity-modal")).toBeVisible();
      await page.clock.runFor(30_000);
      await expect(countdown(page)).toHaveCount(0);
      await expect(page.getByTestId("activity-modal")).toBeVisible();
      expect(loads()).toBe(0);

      await pauseClock(page);
      await page.getByTestId("activity-close").dispatchEvent("click");
      await expect(page.getByTestId("activity-modal")).toHaveCount(0);
      // A dwell RESUMED from the hold (3 s in) would be counting down by now.
      await page.clock.runFor(9_000);
      await expect(countdown(page)).toHaveCount(0);
      await page.clock.runFor(1_000);
      await expect(countdownStatus(page)).toHaveText(countdownCopy(5));
      const load = page.waitForEvent("load");
      await page.clock.runFor(5_000);
      await load;
      await page.clock.resume();
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      expect(loads()).toBe(1);
    });

    test("R9 precedence: a new build beats a pending brand push — the reload comes first with NO ack; the persisted push applies after it (one ack, one refresh)", async ({
      page,
    }) => {
      const backend = await mockKioskBackend(page);
      await registerToStart(page);
      const loads = countLoads(page);

      await dispatch(page, brandPush("e2e-upd-9"));
      await dispatch(page, WHOLE_APP_UPDATE);
      const load = page.waitForEvent("load");
      await stepClockUntil(page, () => loads() === 1);
      await load;
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      expect(backend.acks).toEqual([]);
      expect(backend.hits.getLanguage).toBe(1);
      const reloaded = await readAutoUpdate(page);
      expect(reloaded.shouldWholeAppUpdate).toBe(false);
      // Persisted (device scope): a push survives the reload.
      expect(reloaded.shouldBrandUpdate).toBe(true);

      await stepClockUntil(page, () => backend.hits.getLanguage === 2);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => backend.acks).toEqual([
        { app: "kiosk", device_update_id: "e2e-upd-9" },
      ]);
      expect((await readAutoUpdate(page)).shouldBrandUpdate).toBe(false);
      expect(loads()).toBe(1);
    });
  });

  test.describe("brand update (an FCM push)", () => {
    test("E5 15 s after the push: ONE ack with the exact body, a refresh through /LoadingResources that commits the NEW data, back on /start — and no second ack", async ({
      page,
    }) => {
      const backend = await mockKioskBackend(page);
      await registerToStart(page);
      const booted = (await readAutoUpdate(page)).lastBootAt;
      // What Cockpit changed: a second order type.
      backend.pipelines = ok([PIPELINE_P1, PIPELINE_P2]);
      const paths = trackPaths(page);

      await dispatch(page, brandPush("e2e-upd-1"));
      await page.clock.runFor(5_000);
      await expect(countdown(page)).toHaveCount(0);
      expect(backend.acks).toEqual([]);
      await stepClockUntil(page, () => backend.hits.getLanguage === 2);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/start$/);

      expect(backend.acks).toEqual([{ app: "kiosk", device_update_id: "e2e-upd-1" }]);
      expect(paths).toEqual(["/LoadingResources", "/start"]);
      expect(backend.hits).toEqual({ getLanguage: 2, getPipelines: 2, settings: 2 });
      expect((await bootData(page)).pipelines).toEqual([PIPELINE_P1, PIPELINE_P2]);
      const after = await readAutoUpdate(page);
      expect(after.shouldBrandUpdate).toBe(false);
      expect(after.lastBootAt).toBeGreaterThan(booted);

      await page.clock.runFor(30_000);
      expect(backend.acks).toHaveLength(1);
      expect(backend.hits.getLanguage).toBe(2);
      await expect(countdown(page)).toHaveCount(0);

      // The id is never cleared — a later SCHEDULED refresh must not re-ack it.
      expect(after.device_update_id).toBe("e2e-upd-1");
      await seedBootAge(page, STALE_AGE_MS);
      await stepClockUntil(page, () => backend.hits.getLanguage === 3);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      expect(backend.acks).toHaveLength(1);
    });

    for (const status of [500, 504] as const) {
      test(`E6 an ack answering ${status} (3 attempts) still refreshes exactly ONCE: no loop, no logout, no page error`, async ({
        page,
        context,
      }) => {
        const errors = collectPageErrors(page);
        const backend = await mockKioskBackend(page);
        backend.ackStatus = status;
        await registerToStart(page);

        await dispatch(page, brandPush("e2e-upd-1"));
        await stepClockUntil(page, () => backend.hits.getLanguage === 2);
        await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
        // 5xx is retried twice (withTimeoutRetry: 400 ms, then 1.2 s).
        await stepClockUntil(page, () => backend.acks.length === 3);
        await page.clock.runFor(60_000);
        expect(backend.acks).toEqual(
          Array(3).fill({ app: "kiosk", device_update_id: "e2e-upd-1" })
        );
        expect(backend.hits.getLanguage).toBe(2);
        expect((await readAutoUpdate(page)).shouldBrandUpdate).toBe(false);
        // D2: background telemetry never tears the session down.
        await expect(page).toHaveURL(/\/start$/);
        await expect(page.getByTestId("start-screen")).toBeVisible();
        expect(await tokenCookie(context)).toBe("mock-device-token");
        expect(
          await page.evaluate(
            () => (window as unknown as KioskWindow).__kioskStore.getState().auth.token
          )
        ).toBe("mock-device-token");
        expect(errors).toEqual([]);
      });
    }
  });

  test.describe("scheduled refresh (boot data older than 6 h)", () => {
    test("S1 a stale boot record → 15 s on an untouched splash → a refresh (no ack) → /start with a fresh stamp; best-effort rows and the Dexie menu cache survive it", async ({
      page,
    }) => {
      const backend = await mockKioskBackend(page);
      await registerToStart(page);
      // Cache the menu (the 304 path reuses it), then back to the splash.
      await startOrderToMenu(page);
      await expect.poll(() => dexieCount(page, "menus")).toBe(1);
      await page.getByTestId("footer-cancel").click();
      await page.getByTestId("cancel-order-confirm").click();
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      const before = await bootData(page);
      expect(before.deploymentInfoSettings).toEqual(DEPLOYMENT_ROWS);
      expect(before.generalSettings).toEqual(DEVICE_ROWS);
      // The best-effort steps blip during the refresh (B3/B4): it still succeeds.
      backend.deploymentSettings = ok({});
      backend.deviceSettings = fail(500);
      const paths = trackPaths(page);

      await seedBootAge(page, STALE_AGE_MS);
      const seeded = (await readAutoUpdate(page)).lastBootAt;
      await page.clock.runFor(5_000);
      await expect(countdown(page)).toHaveCount(0);
      await stepClockUntil(page, () => backend.hits.getLanguage === 2);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/start$/);

      expect(paths).toEqual(["/LoadingResources", "/start"]);
      expect(backend.hits).toEqual({ getLanguage: 2, getPipelines: 2, settings: 2 });
      expect(backend.acks).toEqual([]);
      await expect
        .poll(async () => (await readAutoUpdate(page)).lastBootAt)
        .toBeGreaterThan(seeded);
      const fresh = await readAutoUpdate(page);
      expect(fresh.now - fresh.lastBootAt).toBeLessThan(MINUTE);
      expect(fresh.lastRefreshFailedAt).toBe(0);
      expect(await bootData(page)).toEqual(before);
      expect(await dexieCount(page, "menus")).toBe(1);

      // Fresh again: nothing more.
      await page.clock.runFor(60_000);
      expect(backend.hits.getLanguage).toBe(2);
    });

    test("S1 a splash left up past 6 h refreshes by itself (the due-instant re-check), not a minute early", async ({
      page,
    }) => {
      const backend = await mockKioskBackend(page);
      await registerToStart(page);
      const booted = (await readAutoUpdate(page)).lastBootAt;

      // One jump fires the pending ≤15 min re-check ONCE at the target — the
      // wall-clock jump it exists to notice; it re-arms for the remaining minute.
      await page.clock.fastForward("05:59:00");
      await page.clock.runFor(500);
      await expect(countdown(page)).toHaveCount(0);
      expect(backend.hits.getLanguage).toBe(1);

      await page.clock.fastForward(2 * MINUTE);
      await stepClockUntil(page, () => backend.hits.getLanguage === 2);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      const fresh = await readAutoUpdate(page);
      expect(fresh.lastBootAt).toBeGreaterThanOrEqual(booted + 6 * HOUR);
      expect(backend.acks).toEqual([]);
    });

    test("S2 a FAILED refresh (getPipelines 500) returns straight to /start on the OLD data, stamps the failure (persisted), and backs off 30 min before the next attempt", async ({
      page,
    }) => {
      test.slow();
      const backend = await mockKioskBackend(page);
      await registerToStart(page);
      const before = await bootData(page);
      backend.pipelines = fail(500);
      const paths = trackPaths(page);

      await seedBootAge(page, STALE_AGE_MS);
      const seeded = (await readAutoUpdate(page)).lastBootAt;
      await stepClockUntil(
        page,
        async () => (await readAutoUpdate(page)).lastRefreshFailedAt > 0
      );
      // No dialog, no retry ladder: the backend is still down, yet the kiosk is back.
      await expect(page).toHaveURL(/\/start$/);
      await expect(page.getByTestId("start-screen")).toBeVisible();
      expect(paths).toEqual(["/LoadingResources", "/start"]);
      expect(backend.hits.getPipelines).toBe(2);
      const failed = await readAutoUpdate(page);
      expect(failed.lastBootAt).toBe(seeded);
      expect(await bootData(page)).toEqual(before);
      // The guest still sells from the old data.
      await page.getByTestId("start-screen").click();
      await expect(page.getByTestId("pipeline-p1")).toBeVisible();
      await page.getByTestId("footer-cancel").click();
      await expect(page.getByTestId("start-screen")).toBeVisible();

      // The backoff survives a reload (lastRefreshFailedAt is persisted).
      await expect
        .poll(async () => (await persistedAutoUpdate(page)).lastRefreshFailedAt)
        .toBe(failed.lastRefreshFailedAt);
      await page.reload();
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      expect((await readAutoUpdate(page)).lastRefreshFailedAt).toBe(
        failed.lastRefreshFailedAt
      );

      // No hot loop: nothing for the 30 min backoff. The jump fires the
      // pending 15 min re-check once; it re-arms for the remaining ~2 min.
      await page.clock.runFor(60_000);
      expect(backend.hits.getPipelines).toBe(2);
      await page.clock.fastForward(27 * MINUTE);
      await page.clock.runFor(500);
      expect(backend.hits.getPipelines).toBe(2);
      await expect(countdown(page)).toHaveCount(0);

      // Past 30 min → the next attempt; the backend is back.
      backend.pipelines = ok([PIPELINE_P1]);
      await page.clock.fastForward(3 * MINUTE);
      await stepClockUntil(page, () => backend.hits.getPipelines === 3);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await expect
        .poll(async () => (await readAutoUpdate(page)).lastBootAt)
        .toBeGreaterThan(seeded);
      // The good boot outranks the failure stamp: no further attempt.
      await page.clock.runFor(60_000);
      expect(backend.hits.getPipelines).toBe(3);
    });

    const COMMITS_NOTHING: [string, (backend: KioskBackend) => void][] = [
      [
        "getPipelines answers [] (B1)",
        (backend) => {
          backend.pipelines = ok([]);
        },
      ],
      [
        "get_kiosk_settings lacks the start text (B2)",
        (backend) => {
          backend.settings = ok({ ideal_time: "180" });
        },
      ],
    ];
    for (const [name, breakBackend] of COMMITS_NOTHING) {
      test(`S2 ${name}: the refresh commits NOTHING — the old pipelines and settings stay and the guest still gets the old order types`, async ({
        page,
      }) => {
        const backend = await mockKioskBackend(page);
        await registerToStart(page);
        const before = await bootData(page);
        breakBackend(backend);

        await seedBootAge(page, STALE_AGE_MS);
        const seeded = (await readAutoUpdate(page)).lastBootAt;
        await stepClockUntil(
          page,
          async () => (await readAutoUpdate(page)).lastRefreshFailedAt > 0
        );
        await expect(page).toHaveURL(/\/start$/);
        await expect(page.getByTestId("start-screen")).toBeVisible();
        expect(backend.hits.getLanguage).toBe(2);
        expect(await bootData(page)).toEqual(before);
        expect((await readAutoUpdate(page)).lastBootAt).toBe(seeded);
        await page.getByTestId("start-screen").click();
        await expect(page.getByTestId("pipeline-p1")).toBeVisible();
      });
    }

    test("S4 offline: nothing arms however stale the data; back online → a full dwell, then the refresh", async ({
      page,
      context,
    }) => {
      const backend = await mockKioskBackend(page);
      await registerToStart(page);

      await context.setOffline(true);
      await seedBootAge(page, STALE_AGE_MS);
      await page.clock.runFor(60_000);
      await expect(countdown(page)).toHaveCount(0);
      expect(backend.hits.getLanguage).toBe(1);
      expect((await readAutoUpdate(page)).lastRefreshFailedAt).toBe(0);

      await context.setOffline(false);
      await page.clock.runFor(5_000);
      await expect(countdown(page)).toHaveCount(0);
      await stepClockUntil(page, () => backend.hits.getLanguage === 2);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      expect((await readAutoUpdate(page)).lastRefreshFailedAt).toBe(0);
    });

    test("R12 a relaunch that never booted (token cookie only, nothing stored) heals itself with a NORMAL boot — whose failure keeps the retry ladder instead of bouncing to an empty splash", async ({
      page,
      context,
    }) => {
      await context.addCookies([{ name: "token", value: "mock-device-token", url: BASE_URL }]);
      const backend = await mockKioskBackend(page);
      backend.settings = fail(500);
      await page.goto("/start");
      await expect(page.getByTestId("start-screen")).toBeVisible();

      // lastBootAt 0 = unknown age = stale; no pipelines → no refresh state (OV4).
      await stepClockUntil(page, () => backend.hits.settings === 1);
      await expect(page.getByTestId("loading-error")).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/LoadingResources$/);
      expect((await readAutoUpdate(page)).lastRefreshFailedAt).toBe(0);

      backend.settings = ok(KIOSK_SETTINGS);
      await stepClockUntil(page, () => backend.hits.settings === 2);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      expect((await bootData(page)).pipelines).toEqual([PIPELINE_P1]);
      expect((await readAutoUpdate(page)).lastBootAt).toBeGreaterThan(0);
    });
  });

  test.describe("operator Reload resources", () => {
    test("S3 Activity Center → Reload resources (≥44 px) → a refresh → /start with a fresh stamp and NO ack", async ({
      page,
    }) => {
      const backend = await mockKioskBackend(page);
      await registerToStart(page);
      const booted = (await readAutoUpdate(page)).lastBootAt;
      const paths = trackPaths(page);

      await holdHotspot(page, "activity-hotspot");
      await expect(page.getByTestId("activity-modal")).toContainText(
        en.activity.dataLoaded
      );
      const reload = page.getByTestId("activity-reload-resources");
      await expect(reload).toHaveText(en.activity.reloadResources);
      expect((await reload.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await reload.click();

      await expect.poll(() => backend.hits.getLanguage).toBe(2);
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/start$/);
      expect(paths).toEqual(["/LoadingResources", "/start"]);
      expect(backend.hits).toEqual({ getLanguage: 2, getPipelines: 2, settings: 2 });
      expect((await readAutoUpdate(page)).lastBootAt).toBeGreaterThan(booted);
      expect(backend.acks).toEqual([]);
    });

    test("S3 the boot screen's Activity Center offers no Reload resources (only the splash does)", async ({
      page,
    }) => {
      const backend = await mockKioskBackend(page);
      backend.settings = fail(500);
      await submitLicence(page);
      await expect(page.getByTestId("loading-error")).toBeVisible({ timeout: 15_000 });

      await holdHotspot(page, "loading-activity-hotspot");
      await expect(page.getByTestId("activity-modal")).toBeVisible();
      await expect(page.getByTestId("activity-logout")).toBeVisible();
      await expect(page.getByTestId("activity-reload-resources")).toHaveCount(0);
    });
  });

  test.describe("version report and the D2 telemetry exemption", () => {
    test("E7 none on Registration; exactly ONE authenticated POST right after registration (no reload, StrictMode dev server); none after a reload once recorded", async ({
      page,
    }) => {
      const backend = await mockKioskBackend(page);
      await page.goto("/");
      await expect(page.getByTestId("registration-screen")).toBeVisible();
      await typeLicence(page);
      expect(backend.versionReports).toEqual([]);
      const loads = countLoads(page);

      await page.getByTestId("registration-submit").click();
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => backend.versionReports.length).toBe(1);
      expect(backend.versionReports[0]).toEqual({
        body: { app: "kiosk", version: VERSION },
        auth: "Bearer mock-device-token",
      });
      await expect
        .poll(async () => (await readAutoUpdate(page)).kioskDeviceVersion)
        .toBe(VERSION);
      await page.clock.runFor(5_000);
      expect(backend.versionReports).toHaveLength(1);
      expect(loads()).toBe(0);

      // Recorded only on success, and persisted: the next page load is quiet.
      await expect
        .poll(async () => (await persistedAutoUpdate(page)).kioskDeviceVersion)
        .toBe(VERSION);
      await page.reload();
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await page.clock.runFor(5_000);
      expect(backend.versionReports).toHaveLength(1);
    });

    test("E7 a report that fails (500 ×3) is not recorded and is sent again on the next page load", async ({
      page,
    }) => {
      const backend = await mockKioskBackend(page);
      backend.versionStatus = 500;
      await registerToStart(page);
      await stepClockUntil(page, () => backend.versionReports.length === 3);
      await page.clock.runFor(5_000);
      expect(backend.versionReports).toHaveLength(3);
      expect((await readAutoUpdate(page)).kioskDeviceVersion).toBe("");

      backend.versionStatus = 200;
      await page.reload();
      await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => backend.versionReports.length).toBe(4);
      await expect
        .poll(async () => (await readAutoUpdate(page)).kioskDeviceVersion)
        .toBe(VERSION);
    });

    for (const status of [401, 504] as const) {
      test(`E12 D2: update_cx_software answering ${status} never logs the kiosk out`, async ({
        page,
        context,
      }) => {
        await context.addCookies([{ name: "token", value: "e2e-device-token", url: BASE_URL }]);
        const backend = await mockKioskBackend(page);
        backend.versionStatus = status;
        await page.goto("/start");
        await expect(page.getByTestId("start-screen")).toBeVisible();
        // A fresh boot record: this splash must not start a refresh mid-test.
        await seedBootAge(page, 0);

        // 401 is terminal for the retry; 5xx is retried twice.
        const attempts = status === 401 ? 1 : 3;
        await stepClockUntil(page, () => backend.versionReports.length === attempts);
        await page.clock.runFor(5_000);
        expect(backend.versionReports).toHaveLength(attempts);
        await expect(page).toHaveURL(/\/start$/);
        await expect(page.getByTestId("start-screen")).toBeVisible();
        await expect(page.getByTestId("registration-screen")).toHaveCount(0);
        expect(await tokenCookie(context)).toBe("e2e-device-token");
        expect((await readAutoUpdate(page)).kioskDeviceVersion).toBe("");
      });
    }

    test("E12 control: a NON-exempt call answering 504 still de-registers the kiosk (the exemption is by endpoint name)", async ({
      page,
      context,
    }) => {
      await context.addCookies([{ name: "token", value: "e2e-device-token", url: BASE_URL }]);
      await mockKioskBackend(page);
      await page.route("**/api/cx/getCxSkinData", (r) => r.fulfill({ status: 504, json: {} }));
      await page.goto("/LoadingResources");
      await expect(page.getByTestId("registration-screen")).toBeVisible({ timeout: 15_000 });
      expect(await tokenCookie(context)).toBeUndefined();
    });
  });
});
