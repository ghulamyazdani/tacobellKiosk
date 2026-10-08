/**
 * P9f harness — the ONE kiosk-backend mock, fixture data and request parking.
 * House order (Playwright: the NEWEST matching route wins): this mock first, then
 * mockCheckoutBackend / mockXenoLoyalty / mockPaytmBackend, then a spec's own overrides.
 */
import type { Page, Request, Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { APP_ORIGIN } from "./origin"; // = playwright.config's baseURL (TB_E2E_PORT-aware)

const HERE = new URL("./", import.meta.url);

/** A FRESH parse of tests/e2e/fixtures/<name> per call — never share a mutable fixture between tests. */
export const fixtureJson = (name: string) => JSON.parse(readFileSync(new URL(name, HERE), "utf-8"));
/** The copy the app renders: src/i18n/locales/<lang>/<file>.json. Arabic: toContainText only. */
export const locale = (lang: "en" | "ar", file: "translation" | "lazy" = "translation") =>
  JSON.parse(readFileSync(new URL(`../../../src/i18n/locales/${lang}/${file}.json`, HERE), "utf-8"));
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export const LOGIN_OK = {
  licenseDetails: { login_code: "mock-device-token", expiry_date: "2099-01-01T00:00:00.000Z" },
  deploymentDetails: { _id: "dep1", brand_id: "brand1", tenant_id: "tenant1", cluster_id: "cluster1" },
};

// slim-menu.json ids. Prices exclude the fixture's 15 % exclusive VAT: bag Total = round(SubTotal × 1.15).
export const CHEESE_BURGER = "5dd10936712f5b622a66aab7"; // £8, 3 addon groups → PDP
export const GREEK_SALAD = "5dd1093829754a432f2c32e2"; // £17, plain → one tap
export const LARGE_FRIES = "5dd10938eb1ccee31ca352fa"; // £9
export const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b"; // £2
export const CAESAR_DRESSING = "5dd109392b29ee1f2a82a49c"; // £2, the menu's last card
export const EXTRA_PICKLES = "5dd1093f188e72ce1b3eb36e"; // +£1 burger addon
export const DREAM_BOX = "68dd79409030ed3064aee28c"; // pack, £25
export const SIDE_ORDERS = "5dd1092ecc7088762eee2659"; // rail category 1: salad, burger, fries, sauces
export const MEALS_COMBOS = "5dd10932188e72ce1b3eb354"; // rail category 2: kiddie meals, packs

export const DINE_IN = { _id: "p1", tab_id: "t1", tab_type: "dine_in", primary_name: "Dine In" };
/** PAY → /payment on a dine-in tab. pay_at_counter is the COD tile's LABEL key. */
export const SKIP_CRM = { skip_crm_page: true, pay_at_counter: "pay_at_counter" };

export interface KioskBackendOptions {
  /** Merged over { start_order_text_primary: "START ORDER", ideal_time: "180" } (ideal_time clamps to 120 s). */
  settings?: Record<string, unknown>;
  /** Arabic as the secondary language + start_order_text_secondary (boot fails without it). */
  arabic?: boolean;
  /** getPipelines body. Default [DINE_IN]. */
  pipelines?: unknown[];
  /** getMenu body. Default: a fresh slim-menu.json. `{}` = the malformed body (registration.spec "menu-error"). */
  menu?: unknown;
  /** get_cx_valid_offers body, a raw array. Default []. */
  offers?: unknown[];
  /** get_out_of_stock body. Default []. */
  outOfStock?: unknown[];
  /** get_data's deployment. Default GB/£ (fonts + visual-payment use IN/₹). charges are always []. */
  deployment?: { countryCode: string; currencySettings: { symbol: string } };
}

let origins: string[] | undefined;
/**
 * The kiosk backend = the app origin (CI has no .env: RTK calls go relative) + VITE_API_ENDPOINT's origin,
 * read in the mode of the bundle under test: the dev server's, or the preview project's `vite build`
 * (production: .env.production).
 * WHY not "**\/api/**": in Playwright 1.63 that glob matches ANY origin (re-verified 2026-10-07), so it
 * answered the print agent and the Xeno revoke with a silent 200 {}. Partners get their own fixture,
 * or the harness denies them.
 * ponytail: assumes VITE_API_ENDPOINT is an origin (SDK paths are absolute "/api/…"); a base path
 * would make every call hit the deny — loud on the first run.
 */
function backendOrigins(): string[] {
  if (!origins) {
    const mode = process.env.TB_E2E_PREVIEW === "1" ? "production" : "development"; // = playwright.config
    const api = loadEnv(mode, fileURLToPath(new URL("../../../", HERE)), "VITE_").VITE_API_ENDPOINT;
    origins = api ? [APP_ORIGIN, new URL(api).origin] : [APP_ORIGIN];
  }
  return origins;
}

export async function mockKioskBackend(page: Page, opts: KioskBackendOptions = {}) {
  const backend = backendOrigins();
  await page.route(
    (url) => backend.includes(url.origin) && url.pathname.startsWith("/api/"),
    (r) => r.fulfill({ json: {} }),
  );
  const json = (path: string, body: unknown) => page.route(`**/api/${path}`, (r) => r.fulfill({ json: body }));
  await json("cx/kiosk/getLanguage", {
    primary_language: { name: "English", code: "en", dir: "ltr" },
    secondary_language: opts.arabic ? { name: "العربية", code: "ar", dir: "rtl" } : {},
  });
  await json("cx/getCxSkinData", { skin_id: "skin_1" });
  await json("cx/kiosk/get_theme", {
    theme_color: [
      { key: "button_text_border_icon", color_hex: "#501098" },
      { key: "button_background", color_hex: "#ffffff" },
    ],
    primary_color_shades: [],
  });
  await json("cx/get_kiosk_settings", {
    start_order_text_primary: "START ORDER",
    ...(opts.arabic ? { start_order_text_secondary: "ابدأ الطلب" } : {}),
    ideal_time: "180",
    ...opts.settings,
  });
  await json("cx/kiosk/getPipelines", opts.pipelines ?? [DINE_IN]);
  await json("cx/kiosk/getMenu", opts.menu ?? fixtureJson("slim-menu.json"));
  await json("cx/kiosk/get_out_of_stock", opts.outOfStock ?? []);
  await page.route("**/api/tenants/getServerTime", (r) =>
    r.fulfill({ json: { serverTime: new Date().toISOString() } }),
  );
  await json("cx/get_cx_valid_offers", opts.offers ?? []);
  await json("cx/kiosk/get_data", {
    charges: [],
    deployment: opts.deployment ?? { countryCode: "GB", currencySettings: { symbol: "£" } },
  });
  await json("cx/kiosk/login", LOGIN_OK);
}

/** The offer list a test swaps in mid-setup (offerAutoApply/offerBuyStage/offerFreebieCustomize copies). */
export const routeOffers = (page: Page, offers: unknown[]) =>
  page.route("**/api/cx/get_cx_valid_offers", (r) => r.fulfill({ json: offers }));

/**
 * A hung backend or a late answer: parks matching requests while armed (up to `times`), never answers
 * them; release() hands them to the OLDER route with fallback(). Register AFTER the route it shadows.
 * Superset of recovery.holdRequests / idle.parkRequests / bag-recommendations + menu-arabic parkRequests.
 */
export interface Held {
  readonly count: number;
  readonly requests: Request[];
  readonly routes: Route[];
  arm(): void;
  disarm(): void;
  release(): Promise<void>;
}
export async function holdRequests(
  page: Page,
  url: string | RegExp,
  { armed = true, times = Number.POSITIVE_INFINITY } = {},
): Promise<Held> {
  const routes: Route[] = [];
  let isArmed = armed;
  await page.route(url, (route) => {
    if (!isArmed || routes.length >= times) return route.fallback();
    routes.push(route);
    return undefined;
  });
  return {
    get count() {
      return routes.length;
    },
    get requests() {
      return routes.map((route) => route.request());
    },
    routes,
    arm: () => {
      isArmed = true;
    },
    disarm: () => {
      isArmed = false;
    },
    release: async () => {
      isArmed = false;
      await Promise.all(routes.splice(0).map((route) => route.fallback()));
    },
  };
}

/**
 * The lazy chunks as the DEV server serves them (a build serves assets/<name>-<hash>.js; there
 * chunkRecovery reloads, here an import just rejects). Stall: holdRequests(page, CHUNK.bag) + release().
 * Fail: page.route(CHUNK.bag, (r) => r.abort("failed")).
 */
export const CHUNK = {
  /**
   * bagLazyParts: rail, rewards + Xeno sheets, picker, buy stage, celebration, Activity Center, switch,
   * numpad, the PDP's completion warning + Tier-2 sheet + split-edit planner. /menu requests it at entry.
   */
  bag: "**/src/components/cart/bagLazyParts.ts*",
  /** The /paymentPolling screen. */
  paytm: "**/src/pages/PaytmPayment/paytmRuntime.ts*",
} as const;
