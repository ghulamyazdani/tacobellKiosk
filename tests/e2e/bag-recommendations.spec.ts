import { test, expect, type Page, type Request, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Post-P9 29a/29b: the tenant (S3) co-purchase recommendations behind the
 * bag's Complete-Your-Meal rail, end to end.
 *
 * - 29b: the boot fetches the file in the BACKGROUND, only after it has
 *   committed. A dead, failing or hanging S3 never delays or fails the boot.
 * - The fetch is a raw GET, not the RTK transport: no authorization,
 *   x-access-token or login_code header, and no cookie (credentials omit).
 * - 29a: the bag rail ranks the tenant list for THIS cart by occurrences.
 *   With no tenant list it falls back to the isCartRecommended rail.
 * - The map lives in Dexie + memory, never redux-persist. A relaunch (which
 *   never boots, P9e) serves it from Dexie — only a copy fetched from the
 *   CURRENT URL (D6).
 * - D7: `enable_cart_upsell_screen: false` hides the tenant list too.
 *
 * ── THE URL ─────────────────────────────────────────────────────────────
 * VITE_TENANT_RECOMMENDATIONS_URL is empty in dev (rule 6: never committed).
 * The DEV-only seam `window.__TB_RECS_URL__` is set by addInitScript, so
 * every navigation, reloads included, carries it. Playwright reuses a
 * running dev server, so webServer.env would be ignored. The host is made
 * up and fulfilled by page.route: no DNS, no real S3.
 *
 * ── WHY THE FILE CARRIES TORTILLA SAUCE ─────────────────────────────────
 * The flagged fallback for a Cheese Burger cart is Large Fries then Greek
 * Salad, which is the same order occurrences 5 and 2 give. Those two refers
 * alone could not tell the tenant rail from the fallback. Tortilla Sauce is
 * not flagged, so it can only come from the file. It is listed FIRST with 3
 * occurrences, so the rail must re-rank the file:
 * Large Fries (5) · Tortilla Sauce (3) · Greek Salad (2).
 *
 * ── MOCKS ───────────────────────────────────────────────────────────────
 * House order (idle.spec.ts): the `**\/api/**` catch-all FIRST, the print
 * agent aborted, the Xeno revoke routed, then the specific mocks (newest
 * wins). The S3 host is cross-origin, so the catch-all never sees it.
 * Playwright adds CORS headers to a fulfilled cross-origin response; the
 * mock sends S3's own `*` explicitly. Boot helpers and parkRequests are
 * copied from idle.spec.ts (house precedent).
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

const slimMenu = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/slim-menu.json", import.meta.url)),
    "utf-8"
  )
);

// ---- Fixture ids (tests/e2e/fixtures/slim-menu.json) ----
/** Modifier groups: a card tap opens the PDP. isCartRecommended. */
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
/** isCartRecommended (the flagged fallback). */
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa";
/** isCartRecommended (the flagged fallback). */
const GREEK_SALAD = "5dd1093829754a432f2c32e2";
/** NOT flagged: on the rail only from the tenant file. */
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b";

const RECS_HOST = "https://recommendations.e2e.test";
const RECS_URL = `${RECS_HOST}/data.json`;
/** The tenant file (S3 envelope): who is bought with a Cheese Burger. */
const RECS_BODY = {
  data: [
    {
      baseItem_id: CHEESE_BURGER,
      refers: [
        { refer_baseItem_id: TORTILLA_SAUCE, occurrences: 3 },
        { refer_baseItem_id: LARGE_FRIES, occurrences: 5 },
        { refer_baseItem_id: GREEK_SALAD, occurrences: 2 },
      ],
    },
  ],
};
const TENANT_RAIL = [LARGE_FRIES, TORTILLA_SAUCE, GREEK_SALAD];
const FLAGGED_RAIL = [GREEK_SALAD, LARGE_FRIES].sort();

/** Headers the kiosk's RTK transport would send — none may reach S3. */
const DEVICE_HEADERS = ["authorization", "x-access-token", "login_code", "cookie"];

async function mockKioskBackend(page: Page, settings: Record<string, unknown> = {}) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees them (header).
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
    r.fulfill({
      json: {
        start_order_text_primary: "START ORDER",
        ideal_time: "180",
        ...settings,
      },
    })
  );
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({
      json: [
        { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" },
      ],
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
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
}

/** The DEV-only URL seam, on every navigation (header). */
async function useTenantRecommendations(page: Page) {
  await page.addInitScript((url) => {
    (window as unknown as { __TB_RECS_URL__?: string }).__TB_RECS_URL__ = url;
  }, RECS_URL);
}

interface S3Mock {
  /** Every S3 request, in order. */
  readonly requests: Request[];
  /** `autoUpdate.lastBootAt` in the store as each request arrived. */
  readonly lastBootAtSeen: unknown[];
}

/**
 * The fake S3. `status` 200 serves RECS_BODY; "hang" parks every request
 * forever. The store is read as each request arrives, so the spec can tell
 * whether the boot had committed (DEV-only window.__kioskStore).
 */
async function mockS3(page: Page, status: 200 | 500 | "hang" = 200): Promise<S3Mock> {
  const mock: S3Mock = { requests: [], lastBootAtSeen: [] };
  await page.route(`${RECS_HOST}/**`, async (route) => {
    const seen = await page
      .evaluate(
        () =>
          (
            window as unknown as {
              __kioskStore?: { getState: () => { autoUpdate?: { lastBootAt?: unknown } } };
            }
          ).__kioskStore?.getState().autoUpdate?.lastBootAt ?? null
      )
      .catch(() => "unreadable");
    // Recorded together, so a poll on `requests` sees both.
    mock.lastBootAtSeen.push(seen);
    mock.requests.push(route.request());
    if (status === "hang") return undefined;
    const headers = { "Access-Control-Allow-Origin": "*" };
    return status === 200
      ? route.fulfill({ json: RECS_BODY, headers })
      : route.fulfill({ status, body: "", headers });
  });
  return mock;
}

interface ParkedRequests {
  /** Requests parked so far — poll it to know the call is in flight. */
  readonly count: number;
  /** Hand every parked request on to the fixture handler: it completes, late. */
  release: () => Promise<void>;
}

/**
 * Parks matching requests until release() (idle.spec.ts parkRequests,
 * trimmed). Register it AFTER the mock it shadows (newest wins): release()
 * passes each parked request on with route.fallback().
 */
async function parkRequests(page: Page, url: string): Promise<ParkedRequests> {
  const parked: Route[] = [];
  let armed = true;
  await page.route(url, (route) => {
    if (!armed) return route.fallback();
    parked.push(route);
    return undefined;
  });
  return {
    get count() {
      return parked.length;
    },
    release: async () => {
      armed = false;
      await Promise.all(parked.splice(0).map((route) => route.fallback()));
    },
  };
}

/** Type the device code on the on-screen keyboard and submit (the boot starts). */
async function submitRegistration(page: Page) {
  await page.goto("/");
  // Figma keyboard: digits live behind the 123 layer toggle.
  await page.getByRole("button", { name: "t", exact: true }).click();
  await page.getByRole("button", { name: "b", exact: true }).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByTestId("registration-submit").click();
}

async function registerToStart(page: Page) {
  await submitRegistration(page);
  await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
}

/** Splash → order type → /menu (loyalty off). */
async function startOrderToMenu(page: Page) {
  await page.getByTestId("start-screen").click();
  await page.getByTestId("pipeline-p1").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 15_000 });
}

/** Card tap → PDP → ADD TO BAG → dismiss the added modal (bag.spec.ts). */
async function addCheeseBurgerViaPdp(page: Page) {
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  await burger.scrollIntoViewIfNeeded();
  await burger.click();
  await expect(page.getByTestId("customization-screen")).toBeVisible();
  await page.getByTestId("pdp-add-to-bag").click();
  await expect(page.getByTestId("menu-screen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("product-added-modal")).toBeVisible();
  await page.getByTestId("added-continue").click();
  await expect(page.getByTestId("cta-view-bag")).toContainText("(1)");
}

/**
 * VIEW MY BAG → /cart. The first open of a session may meet the P7d upsell
 * (/forYou); declining it mutates no cart state (bag.spec.ts openBag).
 */
async function openBag(page: Page) {
  await page.getByTestId("cta-view-bag").click();
  await page.waitForURL(/\/(forYou|cart)$/);
  if (new URL(page.url()).pathname === "/forYou") {
    await page.getByTestId("foryou-primary").click();
  }
  await expect(page.getByTestId("bag-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/cart$/);
}

/** The rail's item ids, left to right. */
async function railIds(page: Page): Promise<string[]> {
  await expect(page.getByTestId("bag-rail")).toBeVisible();
  return page
    .locator('[data-testid^="bag-rail-item-"]')
    .evaluateAll((cards) =>
      cards.map((card) => (card.getAttribute("data-testid") ?? "").replace("bag-rail-item-", ""))
    );
}

type StoreWindow = Window & {
  __kioskStore: {
    getState: () => {
      autoUpdate: { lastBootAt: unknown };
      recommendation: { recommendCategoryMap?: Record<string, unknown> };
    };
  };
};

/** Base items in the in-memory tenant map. */
const tenantMapKeys = (page: Page) =>
  page.evaluate(() =>
    Object.keys(
      (window as unknown as StoreWindow).__kioskStore.getState().recommendation
        .recommendCategoryMap ?? {}
    )
  );

const lastBootAt = (page: Page) =>
  page.evaluate(
    () => (window as unknown as StoreWindow).__kioskStore.getState().autoUpdate.lastBootAt
  );

/** The Dexie copy (KioskDB.recommendations["latest"]): its URL and base items. */
const dexieCopy = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ url: unknown; keys: string[] } | null>((resolve, reject) => {
        const open = indexedDB.open("KioskDB");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const read = open.result
            .transaction("recommendations", "readonly")
            .objectStore("recommendations")
            .get("latest");
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            const row = read.result as { url?: unknown; map?: object } | undefined;
            open.result.close();
            resolve(row ? { url: row.url, keys: Object.keys(row.map ?? {}) } : null);
          };
        };
      })
  );

test.describe("Post-P9 tenant recommendations (bag rail)", () => {
  test("TENANT RAIL: fetched once, after the boot commits, without device credentials; the bag ranks it by occurrences; a relaunch serves it from Dexie without booting", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await useTenantRecommendations(page);
    // A cookie FOR the S3 host: sent only if the fetch carried credentials.
    await page.context().addCookies([
      {
        name: "tb_probe",
        value: "1",
        domain: "recommendations.e2e.test",
        path: "/",
        secure: true,
        sameSite: "None",
      },
    ]);
    await mockKioskBackend(page);
    // The boot's LAST fetch with loyalty off (device settings), held open.
    const lastBootFetch = await parkRequests(page, "**/api/cx/getKisokDeviceData");
    const s3 = await mockS3(page);
    await submitRegistration(page);

    // 29b: while the boot is still out, S3 has not been asked.
    await expect.poll(() => lastBootFetch.count).toBe(1);
    expect(s3.requests).toHaveLength(0);
    await lastBootFetch.release();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => s3.requests.length).toBe(1);
    // The commit stamped lastBootAt before the request left.
    expect(typeof s3.lastBootAtSeen[0]).toBe("number");
    const headers = await s3.requests[0].allHeaders();
    for (const name of DEVICE_HEADERS) {
      expect(headers[name], `${name} reached S3`).toBeUndefined();
    }
    expect(s3.requests[0].method()).toBe("GET");
    await expect.poll(() => tenantMapKeys(page)).toEqual([CHEESE_BURGER]);

    // 29a: the rail ranks the file for this cart (header: Tortilla Sauce).
    await startOrderToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expect.poll(() => railIds(page)).toEqual(TENANT_RAIL);

    // The map is device data: Dexie (bound to its URL), never redux-persist.
    expect(await dexieCopy(page)).toEqual({ url: RECS_URL, keys: [CHEESE_BURGER] });
    expect(
      await page.evaluate(() => Object.values(window.localStorage).join(""))
    ).not.toContain("refer_baseItem_id");

    // Back to the splash, then a relaunch: it lands on /start and does NOT
    // boot (lastBootAt unchanged, no second S3 call).
    await page.getByTestId("bag-close").click();
    await page.getByTestId("footer-cancel").click();
    await page.getByTestId("cancel-order-confirm").click();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 10_000 });
    const bootedAt = await lastBootAt(page);
    await page.reload();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => tenantMapKeys(page)).toEqual([CHEESE_BURGER]);
    expect(await lastBootAt(page)).toBe(bootedAt);

    // A new order: the tenant order again, served from Dexie.
    await startOrderToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expect.poll(() => railIds(page)).toEqual(TENANT_RAIL);
    expect(s3.requests).toHaveLength(1);
  });

  test("URL CHANGE (D6): a relaunch under another recommendations URL ignores the Dexie copy of the old one — the bag keeps the flagged rail", async ({
    page,
  }) => {
    test.slow();
    // The seam, switchable for the NEXT load through sessionStorage: one init
    // script, because Playwright does not order several.
    const urlKey = "e2e:recs-url";
    await page.addInitScript(
      ({ url, key }) => {
        let override: string | null = null;
        try {
          override = window.sessionStorage.getItem(key);
        } catch {
          // An opaque document (about:blank) has no storage.
        }
        (window as unknown as { __TB_RECS_URL__?: string }).__TB_RECS_URL__ = override ?? url;
      },
      { url: RECS_URL, key: urlKey }
    );
    await mockKioskBackend(page);
    const s3 = await mockS3(page);
    await registerToStart(page);
    await expect.poll(() => tenantMapKeys(page)).toEqual([CHEESE_BURGER]);
    await expect.poll(() => dexieCopy(page)).toEqual({ url: RECS_URL, keys: [CHEESE_BURGER] });
    // redux-persist writes after the commit: reload only once the boot's
    // stamp is on disk (splash.spec ONE IMAGE), or the relaunch is not one.
    const bootedAt = String(await lastBootAt(page));
    await expect
      .poll(() => page.evaluate(() => Object.values(window.localStorage).join()))
      .toContain(bootedAt);

    // The deployment's URL changes; the relaunch lands on /start (no boot).
    await page.evaluate(
      ({ key, url }) => window.sessionStorage.setItem(key, url),
      { key: urlKey, url: `${RECS_HOST}/other.json` }
    );
    await page.reload();
    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 15_000 });
    await startOrderToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expect.poll(async () => (await railIds(page)).sort()).toEqual(FLAGGED_RAIL);
    await expect(page.getByTestId(`bag-rail-item-${TORTILLA_SAUCE}`)).toHaveCount(0);
    expect(await tenantMapKeys(page)).toEqual([]);
    expect(s3.requests).toHaveLength(1);
  });

  test("S3 500: the boot is unaffected, the request is retried once, and the bag keeps the flagged rail", async ({
    page,
  }) => {
    test.slow();
    await useTenantRecommendations(page);
    await mockKioskBackend(page);
    const s3 = await mockS3(page, 500);
    await registerToStart(page);

    await expect.poll(() => s3.requests.length).toBe(2);
    expect(await tenantMapKeys(page)).toEqual([]);
    await startOrderToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await expect.poll(async () => (await railIds(page)).sort()).toEqual(FLAGGED_RAIL);
    await expect(page.getByTestId(`bag-rail-item-${TORTILLA_SAUCE}`)).toHaveCount(0);
  });

  test("S3 HANGS: a request that never answers delays nothing — /LoadingResources reaches /start and the order goes on", async ({
    page,
  }) => {
    test.slow();
    await useTenantRecommendations(page);
    await mockKioskBackend(page);
    const s3 = await mockS3(page, "hang");
    await registerToStart(page);

    // Reached /start with the S3 request still out.
    await expect.poll(() => s3.requests.length).toBe(1);
    await expect(page.getByTestId("start-screen")).toBeVisible();
    await startOrderToMenu(page);
    await addCheeseBurgerViaPdp(page);
  });

  test("D7: enable_cart_upsell_screen:false hides the rail even with a tenant list loaded", async ({
    page,
  }) => {
    test.slow();
    await useTenantRecommendations(page);
    await mockKioskBackend(page, { enable_cart_upsell_screen: false });
    const s3 = await mockS3(page);
    await registerToStart(page);

    // Precondition: the tenant list IS loaded.
    await expect.poll(() => tenantMapKeys(page)).toEqual([CHEESE_BURGER]);
    expect(s3.requests).toHaveLength(1);

    // The rail is a lazy chunk (BagSheet), so "no rail" right after the
    // first open could just mean "not loaded yet". Wait for the chunk (dev
    // server module path), then reopen the bag: the resolved rail now renders
    // in the SAME commit as the sheet, so its absence is final. The chunk
    // loads at /menu entry (the Menu's lazy loyalty rewards sheet shares it —
    // lane loyalty-visual D9), so the wait starts before /menu.
    const railChunk = page.waitForResponse((r) =>
      r.url().includes("/src/components/cart/CompleteYourMealRail")
    );
    await startOrderToMenu(page);
    await addCheeseBurgerViaPdp(page);
    await openBag(page);
    await railChunk;
    await page.getByTestId("bag-close").click();
    await expect(page.getByTestId("bag-sheet")).toHaveCount(0);
    await openBag(page);
    await expect(page.locator('[data-testid^="bag-row-"]')).toHaveCount(1);
    await expect(page.getByTestId("bag-rail")).toHaveCount(0);
  });
});
