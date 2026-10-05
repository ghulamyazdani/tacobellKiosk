import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { APP_ORIGIN } from "./fixtures/origin";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * P9e — FCM remote brand updates through the REAL Firebase SDK, end to end:
 * the gates that keep FCM off (never a permission prompt, never a Firebase
 * download while unconfigured), a push reaching the page's onMessage and
 * raising ONLY the brand flag (the splash applies it — autoUpdate.spec.ts),
 * the relay service worker (public/firebase-messaging-sw.js) and the token
 * registration with its D2 exemption.
 *
 * ── BROWSER: the `chromium` channel (new headless) ──────────────────────
 * The default headless shell reports `Notification.permission === "denied"`
 * whatever is granted (only `permissions.query` changes — checked on
 * Chromium 153), so the permission gate would hold for the wrong reason and
 * the granted paths could never run. New headless honours grants and starts
 * at "default", like a real kiosk browser.
 *
 * ── CONFIG / PUSH SERVICE / GOOGLE ──────────────────────────────────────
 * Firebase config comes from the DEV-only `window.__TB_FCM_ENV__` seam
 * (useFcmRegistration; Playwright reuses the running `yarn dev`, so
 * webServer.env would be ignored) — dummy, NON-secret values. A sandbox has
 * no push service, so `PushManager` is scripted per test: `subscribe`
 * rejects (the mint fails before any Firebase backend call) or resolves a
 * fake subscription whose installations + registrations calls are answered
 * below. Every other *.googleapis.com / *.gstatic.com request is recorded
 * and aborted. Messages are posted the way Firebase's worker posts them
 * (`isFirebaseMessaging`, "push-received") — straight to the page's real
 * listener (E9) or through the relay worker via CDP (E10).
 *
 * ── MOCK ORDER ──────────────────────────────────────────────────────────
 * House order (idle.spec.ts): the `**\/api/**` catch-all FIRST, the
 * cross-origin edges after it, specifics last (newest wins). No fake clock:
 * nothing here waits on an in-app timer, and Firebase's own timers stay real.
 */
test.use({ channel: "chromium" });

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

const slimMenu = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)),
    "utf-8"
  )
);

/** £17, no modifiers, no recommendedItems: one tap lands it, no modal. */
const GREEK_SALAD = "5dd1093829754a432f2c32e2";

/** Dummy, NON-secret Firebase web config; the VAPID key decodes as base64url. */
const FCM_ENV = {
  VITE_FIREBASE_API_KEY: "e2e-api-key",
  VITE_FIREBASE_PROJECT_ID: "e2e-project",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  VITE_FIREBASE_APP_ID: "1:1234567890:web:e2e",
  VITE_FIREBASE_VAPID_KEY: "B" + "A".repeat(86),
};
const FCM_TOKEN = "e2e-fcm-token";
const FCM_SCOPE = "/firebase-cloud-messaging-push-scope";

interface Backend {
  acks: unknown[];
  fcmKeyPosts: unknown[];
  fcmKeyStatus: number;
}

async function mockKioskBackend(page: Page): Promise<Backend> {
  const backend: Backend = { acks: [], fcmKeyPosts: [], fcmKeyStatus: 200 };
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
  await page.route("https://xeno.in:2223/**", (r) =>
    r.fulfill({ json: { status: "success" } })
  );
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
    r.fulfill({ json: { start_order_text_primary: "START ORDER", ideal_time: "180" } })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [{ _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" }],
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
  await page.route("**/api/cx/update_device_status", (r) => {
    backend.acks.push(r.request().postDataJSON());
    return r.fulfill({ json: {} });
  });
  await page.route("**/api/cx/update_cx_fcm_key", (r) => {
    backend.fcmKeyPosts.push(r.request().postDataJSON());
    return r.fulfill({ status: backend.fcmKeyStatus, json: {} });
  });
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
  return backend;
}

interface FcmWatch {
  /** Firebase code the page fetched (dev: fcmRuntime.ts, .vite/deps/firebase_*.js). */
  firebaseModules: string[];
  /** Fetches of the relay worker script (service-worker fetches included). */
  workerScripts: string[];
  /** *.googleapis.com / *.gstatic.com requests no test answered (aborted). */
  googleHits: string[];
  errors: string[];
}

/**
 * Wires the FCM seams BEFORE the first goto: the config (or not), a spy on
 * Notification.requestPermission, the scripted PushManager, the Google
 * abort and the request/error recorders.
 */
async function watchFcm(
  page: Page,
  context: BrowserContext,
  { config, push }: { config: boolean; push: "reject" | "subscribe" }
): Promise<FcmWatch> {
  const watch: FcmWatch = { firebaseModules: [], workerScripts: [], googleHits: [], errors: [] };
  page.on("pageerror", (error) => watch.errors.push(String(error)));
  context.on("request", (request) => {
    const url = request.url();
    if (/fcmRuntime|\/firebase_/.test(url)) watch.firebaseModules.push(url);
    if (url.endsWith("/firebase-messaging-sw.js")) watch.workerScripts.push(url);
  });
  await page.route(/^https:\/\/[^/]*(googleapis|gstatic)\.com\//, (route) => {
    watch.googleHits.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(
    ({ injectConfig, pushMode, env }) => {
      const w = window as unknown as {
        __TB_FCM_ENV__?: Record<string, string>;
        __e2ePermissionRequests: number;
      };
      if (injectConfig) w.__TB_FCM_ENV__ = env;
      w.__e2ePermissionRequests = 0;
      const requestPermission = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = (...args) => {
        w.__e2ePermissionRequests += 1;
        return requestPermission(...args);
      };
      PushManager.prototype.getSubscription = () => Promise.resolve(null);
      PushManager.prototype.subscribe =
        pushMode === "reject"
          ? () => Promise.reject(new DOMException("e2e: no push service", "AbortError"))
          : () =>
              Promise.resolve({
                endpoint: "https://e2e.invalid/push/1",
                expirationTime: null,
                options: { userVisibleOnly: true, applicationServerKey: null },
                getKey: (name: string) =>
                  new Uint8Array(name === "p256dh" ? 65 : 16).buffer,
                toJSON: () => ({}),
                unsubscribe: () => Promise.resolve(true),
              } as unknown as PushSubscription);
    },
    { injectConfig: config, pushMode: push, env: FCM_ENV }
  );
  return watch;
}

/** Firebase's backend for the token path (newer than the Google abort, so it wins). */
async function answerFirebaseBackend(page: Page) {
  const calls = { installations: 0, registrations: 0 };
  await page.route("https://firebaseinstallations.googleapis.com/**", (route) => {
    calls.installations += 1;
    return route.fulfill({
      json: {
        name: "projects/e2e-project/installations/cE2eE2eE2eE2eE2eE2eE2e",
        fid: "cE2eE2eE2eE2eE2eE2eE2e",
        refreshToken: "e2e-refresh",
        authToken: { token: "e2e-fis", expiresIn: "604800s" },
      },
    });
  });
  await page.route("https://fcmregistrations.googleapis.com/**", (route) => {
    calls.registrations += 1;
    return route.fulfill({ json: { token: FCM_TOKEN } });
  });
  return calls;
}

async function registerToStart(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

/** Splash → order type → /menu → one Greek Salad: a guest mid-order. */
async function guestMidOrder(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
  const salad = page.getByTestId(`item-${GREEK_SALAD}`);
  await salad.scrollIntoViewIfNeeded();
  await salad.click();
  await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
}

interface KioskStore {
  getState: () => Record<string, Record<string, unknown>>;
  dispatch: (action: unknown) => unknown;
  subscribe: (listener: () => void) => () => void;
}
type KioskWindow = Window & {
  __kioskStore: KioskStore;
  __e2ePermissionRequests: number;
  __e2eBrandChanges: [boolean, string][];
};

interface AutoUpdateState {
  shouldBrandUpdate: boolean;
  device_update_id: string;
  shouldRegisterFCM: boolean;
  fcmKey: string;
}

const readAutoUpdate = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as KioskWindow).__kioskStore.getState()
        .autoUpdate as unknown as AutoUpdateState
  );

const permissionRequests = (page: Page) =>
  page.evaluate(() => (window as unknown as KioskWindow).__e2ePermissionRequests);

/** A push as Firebase's worker (and the relay) posts it, to the page's real listener. */
const sendPush = (page: Page, data: unknown, messageId = "m1") =>
  page.evaluate(
    ({ payload, id }) => {
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", {
          data: {
            isFirebaseMessaging: true,
            messageType: "push-received",
            from: "1234567890",
            fcmMessageId: id,
            data: payload,
          },
        })
      );
    },
    { payload: data, id: messageId }
  );

/** From here on, records every change of [shouldBrandUpdate, device_update_id]. */
const recordBrandChanges = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as KioskWindow;
    const read = (): [boolean, string] => {
      const a = w.__kioskStore.getState().autoUpdate as {
        shouldBrandUpdate: boolean;
        device_update_id: string;
      };
      return [a.shouldBrandUpdate, a.device_update_id];
    };
    let last = JSON.stringify(read());
    w.__e2eBrandChanges = [];
    w.__kioskStore.subscribe(() => {
      const now = read();
      if (JSON.stringify(now) === last) return;
      last = JSON.stringify(now);
      w.__e2eBrandChanges.push(now);
    });
  });

const brandChanges = (page: Page) =>
  page.evaluate(() => (window as unknown as KioskWindow).__e2eBrandChanges);

/** The FCM push worker's registration (scope + script path), once active. */
const fcmWorker = (page: Page) =>
  page.evaluate(async (scope) => {
    const registration = await navigator.serviceWorker.getRegistration(scope);
    return registration?.active
      ? {
          scope: new URL(registration.scope).pathname,
          script: new URL(registration.active.scriptURL).pathname,
        }
      : null;
  }, FCM_SCOPE);

const tokenCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((c) => c.name === "token")?.value;

test.describe("P9e FCM brand updates (real Firebase SDK)", () => {
  const GATED = [
    {
      name: "the config is injected but notifications are NOT granted",
      config: true,
      grant: false,
      permission: "default",
    },
    {
      name: "notifications are granted but there is NO config (the dev .env has none)",
      config: false,
      grant: true,
      permission: "granted",
    },
  ] as const;
  for (const gate of GATED) {
    test(`E8 FCM stays off when ${gate.name}: no prompt, no Firebase download, no worker, nothing sent`, async ({
      page,
      context,
    }) => {
      if (gate.grant) await context.grantPermissions(["notifications"], { origin: BASE_URL });
      const backend = await mockKioskBackend(page);
      const watch = await watchFcm(page, context, { config: gate.config, push: "reject" });

      await registerToStart(page);
      // The gate under test is not the latch: the real registration raised it.
      expect((await readAutoUpdate(page)).shouldRegisterFCM).toBe(true);
      await guestMidOrder(page);

      expect(await page.evaluate(() => Notification.permission)).toBe(gate.permission);
      expect(await permissionRequests(page)).toBe(0);
      expect(watch.firebaseModules).toEqual([]);
      expect(watch.workerScripts).toEqual([]);
      expect(
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)
      ).toBe(0);
      expect(watch.googleHits).toEqual([]);
      expect(backend.fcmKeyPosts).toEqual([]);
      expect(watch.errors).toEqual([]);
    });
  }

  test("E9 a push reaches the REAL Firebase onMessage and mid-order ONLY raises the brand flag; malformed pushes change nothing; never prompts", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["notifications"], { origin: BASE_URL });
    const backend = await mockKioskBackend(page);
    const watch = await watchFcm(page, context, { config: true, push: "reject" });
    await registerToStart(page);
    await guestMidOrder(page);

    // Firebase listens only after its lazy import: push until it hears.
    await expect
      .poll(
        async () => {
          await sendPush(page, { device_update_id: "e2e-fcm-1" });
          const state = await readAutoUpdate(page);
          return state.shouldBrandUpdate ? state.device_update_id : null;
        },
        { timeout: 20_000 }
      )
      .toBe("e2e-fcm-1");
    // Rule 1: the guest keeps the screen and the bag; nothing is acked or applied.
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
    expect(backend.acks).toEqual([]);

    await page.evaluate(() =>
      (window as unknown as KioskWindow).__kioskStore.dispatch({
        type: "autoUpdate/markAsUpdateDone",
      })
    );
    await recordBrandChanges(page);
    for (const junk of [
      {},
      { device_update_id: "" },
      { device_update_id: "   " },
      { device_update_id: 7 },
      { campaign: "e2e" },
    ]) {
      await sendPush(page, junk, "m-junk");
    }
    // The control, sent after the junk: the ONLY change recorded.
    await sendPush(page, { device_update_id: "e2e-fcm-2" }, "m2");
    await expect.poll(() => brandChanges(page)).toEqual([[true, "e2e-fcm-2"]]);

    // getToken without a registration: Firebase registered OUR relay, at its own scope.
    await expect
      .poll(() => fcmWorker(page), { timeout: 20_000 })
      .toEqual({ scope: FCM_SCOPE, script: "/firebase-messaging-sw.js" });
    expect(watch.workerScripts.length).toBeGreaterThan(0);
    expect(watch.firebaseModules.length).toBeGreaterThan(0);
    // The mint failed (no push service): nothing registered or stored, nobody asked.
    expect(backend.fcmKeyPosts).toEqual([]);
    expect((await readAutoUpdate(page)).fcmKey).toBe("");
    expect(await permissionRequests(page)).toBe(0);
    expect(watch.googleHits).toEqual([]);
    expect(watch.errors).toEqual([]);
  });

  test("E10 a REAL push delivered to the relay worker (CDP) reaches the page's onMessage; a non-JSON push is ignored", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["notifications"], { origin: BASE_URL });
    const backend = await mockKioskBackend(page);
    const watch = await watchFcm(page, context, { config: true, push: "reject" });
    await registerToStart(page);
    // In session: a raised flag must not start the splash apply mid-test.
    await page.getByTestId("start-screen").click();
    await expect(page.getByTestId("second-screen")).toBeVisible();
    await expect.poll(() => fcmWorker(page), { timeout: 20_000 }).not.toBeNull();

    const cdp = await context.newCDPSession(page);
    const scopes = new Map<string, string>();
    cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
      for (const r of registrations) scopes.set(new URL(r.scopeURL).pathname, r.registrationId);
    });
    await cdp.send("ServiceWorker.enable");
    await expect.poll(() => scopes.get(FCM_SCOPE)).toBeTruthy();
    const deliver = (data: string) =>
      cdp.send("ServiceWorker.deliverPushMessage", {
        origin: BASE_URL,
        registrationId: scopes.get(FCM_SCOPE) ?? "",
        data,
      });

    await recordBrandChanges(page);
    await deliver("not json");
    await deliver(
      JSON.stringify({
        from: "1234567890",
        fcmMessageId: "m-sw",
        data: { device_update_id: "e2e-sw-1" },
      })
    );
    await expect
      .poll(() => brandChanges(page), { timeout: 10_000 })
      .toEqual([[true, "e2e-sw-1"]]);
    await expect(page).toHaveURL(/\/second$/);
    expect(backend.acks).toEqual([]);
    expect(watch.errors).toEqual([]);
  });

  test("E11 a minted token is registered ONCE per page load with the exact body and stored only after the backend took it; a reload re-registers without re-minting", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["notifications"], { origin: BASE_URL });
    const backend = await mockKioskBackend(page);
    const watch = await watchFcm(page, context, { config: true, push: "subscribe" });
    const firebase = await answerFirebaseBackend(page);
    await registerToStart(page);

    await expect
      .poll(() => backend.fcmKeyPosts, { timeout: 20_000 })
      .toEqual([{ app: "kiosk", fcm_token: FCM_TOKEN }]);
    await expect.poll(async () => (await readAutoUpdate(page)).fcmKey).toBe(FCM_TOKEN);
    expect(firebase.registrations).toBe(1);

    await page.reload();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => backend.fcmKeyPosts.length, { timeout: 20_000 }).toBe(2);
    expect(backend.fcmKeyPosts[1]).toEqual({ app: "kiosk", fcm_token: FCM_TOKEN });
    // Firebase's IndexedDB token was reused: no second mint.
    expect(firebase.registrations).toBe(1);
    expect(await permissionRequests(page)).toBe(0);
    expect(watch.googleHits).toEqual([]);
    expect(watch.errors).toEqual([]);
  });

  for (const status of [401, 504] as const) {
    test(`E12 D2: update_cx_fcm_key answering ${status} never logs the kiosk out, and the token is not stored`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["notifications"], { origin: BASE_URL });
      const backend = await mockKioskBackend(page);
      backend.fcmKeyStatus = status;
      const watch = await watchFcm(page, context, { config: true, push: "subscribe" });
      await answerFirebaseBackend(page);
      await registerToStart(page);

      // 401 is terminal for the retry; 5xx is retried twice (≈1.6 s).
      await expect
        .poll(() => backend.fcmKeyPosts.length, { timeout: 20_000 })
        .toBe(status === 401 ? 1 : 3);
      // Recovery would run as the last answer lands: give it a moment to show.
      await page.waitForTimeout(1_000);
      expect(backend.fcmKeyPosts).toHaveLength(status === 401 ? 1 : 3);
      await expect(page).toHaveURL(/\/start$/);
      await expect(page.getByTestId("start-screen")).toBeVisible();
      await expect(page.getByTestId("registration-screen")).toHaveCount(0);
      expect(await tokenCookie(context)).toBe("mock-device-token");
      expect((await readAutoUpdate(page)).fcmKey).toBe("");
      expect(watch.errors).toEqual([]);
    });
  }
});
