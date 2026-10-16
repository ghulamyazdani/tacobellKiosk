import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CAESAR_DRESSING,
  CHEESE_BURGER,
  DINE_IN,
  DREAM_BOX,
  EXTRA_PICKLES,
  GREEK_SALAD,
  LARGE_FRIES,
  MEALS_COMBOS,
  SIDE_ORDERS,
  TORTILLA_SAUCE,
  clone,
  fixtureJson,
  isBackendApi,
  mockKioskBackend,
  type KioskBackendOptions,
} from "./fixtures/backend";
import { mockCheckoutBackend, type CheckoutMockOptions } from "./fixtures/checkout";
import { LOYALTY_PHONE, LOYALTY_SETTINGS, mockXenoLoyalty } from "./fixtures/loyalty";
import { PAYTM_DQR_ENTITY, mockPaytmBackend, statusSequence } from "./fixtures/paytm";
import { expect, test, type Page } from "./fixtures/kiosk";
import {
  LOW_END_ARGS,
  PERF_LABEL,
  fling,
  flipOf,
  idle,
  load,
  memory,
  reportPath,
  scenario,
  skipped,
  startPerf,
  tap,
  tid,
  until,
  writeTable,
  type Memory,
  type Perf,
  type Sample,
} from "./fixtures/perf";
import { bootRegisteredToMenu, chooseLanguage, registerToStart, startOrderTo, startToSecond } from "./pages/boot";
import { addOneTap, addViaPdp, bagRows, dismissAddedModal, openBag, typeDigits } from "./pages/order";

/**
 * Lane perf-bench — every kiosk page on the PRODUCTION bundle, calibrated to a low-end Windows kiosk
 * (fixtures/perf.ts: CPU 6× slower — PERF_CPU_RATE — and --disable-gpu, this file's launch only):
 *   TB_E2E_PREVIEW=1 TB_E2E_PORT=<lane port> npx playwright test perf.preview --workers=1
 * (`perf` alone also selects every *.preview.ts when the checkout's path contains "perf".)
 * Output: test-results/perf/perf-<PERF_LABEL|run>.json (every metric of every window, the table's rows
 * with their window counts n, the LoAF script hotspots) and .md (the table), both attached to the report;
 * the table is printed after the last test. test-results is wiped at each run start — copy the JSON out to
 * compare runs. PERF_GUEST_CYCLES (default 5) lengthens the memory walk into a soak.
 *
 * THE NUMBERS ARE THE DELIVERABLE. The only assertions: every scenario completed (a throw records it
 * "failed" — an ignored tap throws too, fixtures/perf.ts), the harness's own (no request past the mocks,
 * no page error; getMenu took the path a scenario claims), and a generous heap / DOM / listener growth
 * budget per guest cycle. Absolute numbers move with the host's load: compare runs from one machine, and
 * read the JSON's host.loadavg / each scenario's load1 first.
 *
 * REPEATS. Every interaction the flow can repeat runs 3× (close and reopen, or CANCEL ORDER and start
 * again); the table's n says how many windows a row holds. Single by nature: the cold load, the licence
 * submit, the daily refresh, a page's first (cold) menu entry and first menu download, each screen of the
 * checkout chain and of the Paytm payment.
 *
 * WHAT RUNS REAL: touch taps (hasTouch), motion (no-preference — the confetti, entrances and springs the
 * kiosk plays), the menu photos (a real 618×1099 JPEG for every S3 URL, so decode and raster are in; the
 * harness's 1×1 would hide them), a splash attract loop (the WebM fixture three plays, then a photo slide),
 * getMenu's 304 path (the first fetch downloads and the kiosk stores the menu in Dexie; every later one
 * sends its MENU_ID, gets `{ statusCode: 304 }` and reads the stored menu back, as in production). No
 * page.clock anywhere: it fakes performance.now and rAF, which the measurements read — PAY AT COUNTER's
 * 3 s window, Paytm's polls, Order Complete's 20 s countdown and the idle prompt run in real time.
 *
 * NOT REPRESENTED: the throttle slows the main thread only, so compositor scrolling, raster, image decode,
 * video decode and the confetti run at host speed (optimistic on a real Celeron); the splash video is the
 * 32×32 VP8 fixture (Playwright's Chromium has no H.264), so a real promo's decode cost is absent; the mocks
 * answer at once — no network latency or bandwidth — so "→ visible" of a transition that waits on a fetch
 * (the licence boot, a menu entry, the loyalty lookup, PAY, the order-type switch, the Paytm initiate) is
 * CPU time only; the service worker is blocked (page routes must see every request), so a reload reads
 * its chunks from the HTTP cache, not the precache.
 *
 * MENUS. The walks run the harness's slim menu with two in-memory edits so every screen is reachable:
 * the three Kiddie Meals get two sizes each (Select a Size), the Greek Salad a "You Might Like" strip.
 * LONG MENU clones it to 40 rail rows and 240 cards (deterministic, every machine) for the grid and rail
 * flings. ../posistKiosk-cx-sdk/StandardMenu.json (12 MB, gitignored, local only) adds the production-size
 * boot / entries / scroll / adds / order-type switch, and skips cleanly where it is absent (CI).
 * The VEG / NON-VEG chips are not measured: the app hides them (skip recorded in ENTRY).
 */

test.use({ launchOptions: { args: LOW_END_ARGS }, reducedMotion: "no-preference", hasTouch: true });
// In order on one worker; unlike serial, a failed walk does not skip the walks after it.
test.describe.configure({ mode: "default" });

const slow = expect.configure({ timeout: 60_000 });

const MENU_PHOTOS = "https://itemsposistnet.s3.ap-south-1.amazonaws.com/**";
const MEDIA_ORIGIN = "https://splash-media.e2e.test";
const GET_MEDIA = "**/api/cx/kiosk/getMedia";
const PHOTO = readFileSync(fileURLToPath(new URL("../../src/assets/splash/fullbleed-halfmoon.jpg", import.meta.url)));
const WEBM = readFileSync(fileURLToPath(new URL("./fixtures/splash.webm", import.meta.url)));
const STANDARD_MENU = fileURLToPath(new URL("../../../posistKiosk-cx-sdk/StandardMenu.json", import.meta.url));

/** The splash attract loop (splash.spec shapes): the 1 s WebM played 3×, then a photo for 4 s. */
const SPLASH_MEDIA = {
  media: [
    {
      key: "home_screen",
      url: `${MEDIA_ORIGIN}/promo.webm`,
      media_type: "webm",
      iteration_time: "3",
      text: "",
      items: [],
      extra_images: [{ url: `${MEDIA_ORIGIN}/slide.jpg`, media_type: "image", iteration_time: "4", text: "", items: [] }],
    },
  ],
};

/** The second order type (orderTypeSwitch.spec's): the bag's EAT IN ⇄ TAKE OUT switch needs it. */
const TAKE_OUT = { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take Away" };
/** The three Kiddie Meals: two sizes each in the walk menu (sizeFastLane.spec's re-shape). */
const SIZED = ["5dd1093a188e72ce1b3eb358", "5dd1093a188e72ce1b3eb359", "5dd1093a188e72ce1b3eb35b"];
const G_SIDES = `${DREAM_BOX}_2_combo`;
const G_DRINKS = `${DREAM_BOX}_3_combo`;
const WITHOUT_SALT = "5dff2ea756bc05b83f9e34cd";
const PEPSI_SMALL = "5dd27b527973647b693e428b";
/** Five Cheese Burger options inside their groups' limits: Extra ×3 (max 3), Without ×2 (max 4). */
const BURGER_OPTIONS = [EXTRA_PICKLES, "5dd1093f188e72ce1b3eb36a", "5dd2f69029446a316cf7cf0b", "5dd1093f188e72ce1b3eb371", "5dd1093f188e72ce1b3eb376"];
const OFFER_FREE_SAUCE = "offer-free-sauce-choice";
/** offerBuyStage.spec's BOGO on the stock free-salad offer's shape: buy 2 Tortilla Sauce → a Caesar Dressing free. */
const BOGO_SAUCE = {
  ...fixtureJson("offers.json")[2],
  _id: "offer-bogo-sauce",
  name: "Buy 2 Tortilla Sauce get a Caesar free",
  getItemOnly: false,
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [{ item: { baseItemId: TORTILLA_SAUCE, name: "Tortilla Sauce" }, quantity: 2, relation: "and" }],
  },
  getItems: {
    items: [{ _id: "gi-bogo-caesar", baseItemId: CAESAR_DRESSING, name: "Caesar Dressing", relation: "and", discountType: "percent", value: 100, quantity: 1 }],
    categories: [],
  },
};
/** CRM shown at checkout (/phone, /customerName), COD labelled, the ADA toggle in the footer. */
const WALK_SETTINGS = { skip_crm_page: false, pay_at_counter: "pay_at_counter", accessibility_mode: true };

const MENU_READY = `${tid("menu-screen")} [data-testid^="item-"]`;
const ADDED = tid("product-added-modal");

interface MenuCategory {
  id: string;
  name: string;
  order: number;
  subCategories: { id: string; entities: { id: string }[] }[];
}

/** slim-menu with every screen reachable: Select a Size on the Kiddie Meals, the full added card on the Greek Salad. */
function walkMenu() {
  const menu = fixtureJson("slim-menu.json");
  for (const category of menu.categories)
    for (const sub of category.subCategories)
      for (const entity of sub.entities) {
        const n = SIZED.indexOf(entity.id);
        if (n >= 0) {
          entity.hasVariant = true;
          entity.modifiers = [];
          entity.variants = [
            ["regular", "Regular", 5],
            ["large", "Large", 7],
          ].map(([size, name, price]) => ({ id: `perf-${size}-${n}`, name, price, isActive: true, subCategoryId: sub.id }));
        }
        if (entity.id === GREEK_SALAD) entity.recommendedItems = [LARGE_FRIES, TORTILLA_SAUCE, CAESAR_DRESSING];
      }
  return menu;
}

/**
 * The walk menu at a production length, deterministic: its two categories cloned to 40 rail rows (20 fit
 * the 1920 px stage's rail) and 240 cards. Copy 0 keeps the fixture's ids.
 */
function longMenu() {
  const menu = walkMenu();
  const base: MenuCategory[] = menu.categories;
  menu.categories = Array.from({ length: 20 }, (_, copy) => {
    const tag = (id: string) => (copy ? `${id}-perf${copy}` : id);
    return base.map((category) => ({
      ...clone(category),
      id: tag(category.id),
      name: copy ? `${category.name} ${copy + 1}` : category.name,
      order: copy * 10 + category.order,
      subCategories: category.subCategories.map((sub) => ({
        ...clone(sub),
        id: tag(sub.id),
        entities: sub.entities.map((entity) => ({ ...clone(entity), id: tag(entity.id) })),
      })),
    }));
  }).flat();
  return menu;
}

/**
 * getMenu as the backend answers it: the full menu on a first fetch; `{ statusCode: 304 }` when the
 * request carries the MENU_ID the kiosk stored in Dexie, which it then reads back (useMenuConverters).
 * Counts both, so a scenario can say which path it measured.
 */
async function serveMenu(page: Page, menu: { MENU_ID?: string }) {
  const body = JSON.stringify(menu);
  const served = { full: 0, notModified: 0 };
  await page.route(
    (url) => isBackendApi(url) && url.href.endsWith("/api/cx/kiosk/getMenu"),
    (route) => {
      const cached = (route.request().postDataJSON() as { MENU_ID?: string } | null)?.MENU_ID;
      if (cached && cached === menu.MENU_ID) {
        served.notModified += 1;
        return route.fulfill({ json: { statusCode: 304 } });
      }
      served.full += 1;
      return route.fulfill({ body, contentType: "application/json" });
    },
  );
  return served;
}

/**
 * The house mock order: the kiosk backend (getMenu with its 304 path), the splash media, the checkout
 * edges (by default one table tab: PAY → /tent), the media hosts. Resolves to getMenu's served counts.
 */
async function mockKiosk(page: Page, opts: KioskBackendOptions = {}, checkout: CheckoutMockOptions = { tabType: "table" }) {
  const menu = (opts.menu ?? walkMenu()) as { MENU_ID?: string };
  await mockKioskBackend(page, {
    offers: [...fixtureJson("offers.json"), BOGO_SAUCE],
    ...opts,
    menu,
    settings: { ...WALK_SETTINGS, ...opts.settings },
  });
  const served = await serveMenu(page, menu);
  await page.route(GET_MEDIA, (route) => route.fulfill({ json: SPLASH_MEDIA }));
  await mockCheckoutBackend(page, checkout);
  await page.route(`${MEDIA_ORIGIN}/**`, (route) =>
    route.fulfill(route.request().url().endsWith(".webm") ? { body: WEBM, contentType: "video/webm" } : { body: PHOTO, contentType: "image/jpeg" }),
  );
  // Over the harness's 1×1 (page routes win). A reload can hand a settled request back: ignore its throw.
  await page.route(MENU_PHOTOS, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/jpeg", headers: { "Access-Control-Allow-Origin": "*" } }).catch(() => undefined),
  );
  return served;
}

const key = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
/** /phone's display right after a key: every digit masked but the newest (CustomerPhone maskExceptLast). */
const masked = (digits: string) => (digits.length <= 1 ? digits : `${"*".repeat(digits.length - 1)}${digits.at(-1)}`);
/** The menu pane (the sections' scroller), the rail's row list and its rows. */
const gridPane = (page: Page) => page.locator('[data-testid^="section-"]').first().locator("xpath=..");
const railList = (page: Page) => page.locator(`${tid("category-rail")} .overflow-y-auto`);
const railRows = (page: Page) => page.getByTestId("category-rail").locator('[data-testid^="rail-"]');
const overflowOf = (pane: ReturnType<typeof gridPane>) => pane.evaluate((el) => el.scrollHeight - el.clientHeight);

/** A fling that moved nothing measured nothing. */
function scrolled(sample: Sample) {
  if (!sample.detail?.scrolledPx) throw new Error(`perf: ${sample.label} did not scroll (overflow ${String(sample.detail?.overflowPx)} px)`);
  return sample;
}

/**
 * The next relaunch finds its boot stamp past the 6 h refresh age: redux-persist's persist:root (the
 * autoUpdate slice) rewritten at that document's start, before it rehydrates — a write from the live page
 * could be overwritten by its next flush, and the production bundle has no store seam to set it.
 */
async function ageBootStampOnRelaunch(page: Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("perf:age-boot") !== "1") return;
    window.sessionStorage.removeItem("perf:age-boot");
    const root = JSON.parse(window.localStorage.getItem("persist:root") ?? "{}") as Record<string, string>;
    root.autoUpdate = JSON.stringify({ ...JSON.parse(root.autoUpdate ?? "{}"), lastBootAt: Date.now() - 7 * 3_600_000 });
    window.localStorage.setItem("persist:root", JSON.stringify(root));
  });
  await page.evaluate(() => window.sessionStorage.setItem("perf:age-boot", "1"));
}

/** CANCEL ORDER → its confirm → the splash (unmeasured). */
async function cancelToSplash(page: Page) {
  await page.getByTestId("footer-cancel").click();
  await page.getByTestId("cancel-order-confirm").click();
  await slow(page.getByTestId("start-screen")).toBeVisible();
}

/**
 * order type → menu, 3 times: cold (getMenu's download, the Dexie write), then twice after CANCEL ORDER →
 * the splash → order type (the 304 path, the Dexie read); the cancel taps are measured on the way.
 * `again` runs on each return to order type. Starts on order type, ends on the menu.
 */
async function menuEntries(perf: Perf, s: Sample[], timeoutMs = 60_000, again?: () => Promise<void>) {
  const { page } = perf;
  for (let i = 0; i < 3; i += 1) {
    s.push(await tap(perf, i ? "warm (304)" : "cold", page.getByTestId("pipeline-p1"), { until: MENU_READY, timeoutMs }));
    if (i === 2) return;
    s.push(await tap(perf, "CANCEL ORDER → modal", page.getByTestId("footer-cancel"), { until: tid("cancel-order-modal") }));
    s.push(await tap(perf, "confirm → splash", page.getByTestId("cancel-order-confirm"), { until: tid("start-screen"), timeoutMs }));
    await startToSecond(page);
    await again?.();
  }
}

/** The bag's EAT IN ⇄ TAKE OUT switch, 4 times: the first downloads TAKE OUT's menu, the rest take the 304 path. */
async function orderTypeSwitches(perf: Perf, s: Sample[], timeoutMs = 60_000) {
  const { page } = perf;
  for (const [i, to] of (["takeout", "eatin", "takeout", "eatin"] as const).entries()) {
    s.push(await tap(perf, "segment → confirm", page.getByTestId(`bag-ordertype-${to}`), { until: tid("bag-ordertype-confirm") }));
    s.push(
      await tap(perf, i ? "YES → switched (304)" : "YES → switched (download)", page.getByTestId("bag-ordertype-confirm-yes"), {
        until: `${tid(`bag-ordertype-${to}`)}[aria-pressed="true"]`,
        timeoutMs,
      }),
    );
  }
}

/** The rail's flings — or a skip when its rows fit. */
async function railFlings(perf: Perf, name: string) {
  const overflowPx = await overflowOf(railList(perf.page));
  if (overflowPx <= 0) return skipped(name, "the rail's rows fit (no overflow)");
  await scenario(perf, name, async (s) => {
    s.push(scrolled(await fling(perf, "down", railList(perf.page), 1_500)));
    s.push(scrolled(await fling(perf, "up", railList(perf.page), -1_500)));
    return { overflowPx };
  });
}

type VideoFrames = { videoElements: number; videoFramesPresented: number; videoFramesDropped: number };
/**
 * The attract loop left alone for 10 s, the frame sampler off (fixtures/perf.ts). Its frames are the videos'
 * own, read passively: every <video> the carousel mounts, its getVideoPlaybackQuality sampled on a 250 ms
 * timer (a frame callback would itself make the main thread render every frame). The main thread's render
 * work is the window's RecalcStyle / Layout counts.
 */
async function splashIdle(perf: Perf): Promise<Sample> {
  const { page } = perf;
  await slow
    .poll(() => page.locator(`${tid("start-screen")} video`).first().evaluate((v: HTMLVideoElement) => v.currentTime, null, { timeout: 1_000 }).catch(() => 0))
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const read = (video: HTMLVideoElement) => {
      const quality = video.getVideoPlaybackQuality();
      return { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames };
    };
    // Frames before the window are not its own; a video mounted later counts from zero.
    const last = new Map(Array.from(document.querySelectorAll("video"), (video) => [video, read(video)] as const));
    const sum = { presented: 0, dropped: 0 };
    const sample = () => {
      document.querySelectorAll("video").forEach((video) => {
        if (!last.has(video)) last.set(video, { total: 0, dropped: 0 });
      });
      for (const [video, was] of last) {
        const now = read(video);
        // ponytail: a replay that reloads the source restarts its counters — counted from zero again, so
        // the frames between the last sample and the reload (≤ 250 ms) are lost.
        const from = now.total < was.total ? { total: 0, dropped: 0 } : was;
        sum.dropped += now.dropped - from.dropped;
        sum.presented += now.total - now.dropped - (from.total - from.dropped);
        last.set(video, now);
      }
    };
    const timer = setInterval(sample, 250);
    const stop = (): VideoFrames => {
      clearInterval(timer);
      sample();
      return { videoElements: last.size, videoFramesPresented: sum.presented, videoFramesDropped: sum.dropped };
    };
    Object.assign(window, { __videoFrames: stop });
  });
  const sample = await idle(perf, "idle", 10_000);
  const detail = await page.evaluate(() => ({
    ...(window as unknown as { __videoFrames: () => VideoFrames }).__videoFrames(),
    runningAnimations: document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => `${a instanceof CSSAnimation ? a.animationName : "transition"}${Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity) ? "" : " (infinite)"}`),
  }));
  return { ...sample, detail };
}

test.afterAll(async () => {
  const text = writeTable();
  console.log(`\n${text}\n`);
  await test.info().attach(`perf-${PERF_LABEL}.json`, { path: reportPath(), contentType: "application/json" });
  await test.info().attach("perf-table.md", { body: text, contentType: "text/markdown" });
});

test("ENTRY: the cold load, the licence, the splash at idle, the warm reload, splash ⇄ order type, order type → menu (cold, then the 304 path), the rail, the ADA view", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const getMenu = await mockKiosk(page);
  const perf = await startPerf(page);

  await scenario(perf, "boot · cold load → registration", async (s) => {
    s.push(await load(perf, "cold load", "/", tid("registration-submit")));
  });
  await scenario(perf, "registration · keyboard", async (s) => {
    const code = tid("registration-code");
    s.push(await tap(perf, "key", key(page, "t"), { until: code, text: "t" }));
    s.push(await tap(perf, "key", key(page, "b"), { until: code, text: "tb" }));
    s.push(await tap(perf, "123 → digits", page.getByRole("button", { name: /numbers and symbols/i }), { until: 'button[aria-label="7"]' }));
    s.push(await tap(perf, "key", key(page, "7"), { until: code, text: "tb7" }));
  });
  await scenario(perf, "boot · licence → /LoadingResources → splash", async (s) => {
    s.push(await tap(perf, "submit", page.getByTestId("registration-submit"), { until: tid("start-screen") }));
  });
  await scenario(perf, "splash · idle 10 s (attract loop)", async (s) => void s.push(await splashIdle(perf)));
  // A relaunch with a stored licence goes straight to the splash (persisted boot data)...
  await scenario(perf, "boot · warm reload (stored licence → splash)", async (s) => {
    for (let i = 0; i < 3; i += 1) s.push(await load(perf, "reload", null, tid("start-screen")));
  });
  // ...and boots only once that data is over 6 h old (the daily refresh): the splash's 15 s dwell, its last
  // 5 s a countdown, then /LoadingResources in refresh mode, then the splash again.
  await scenario(perf, "boot · daily refresh (boot data > 6 h old)", async (s) => {
    await ageBootStampOnRelaunch(page);
    s.push(await load(perf, "relaunch → splash", null, tid("start-screen")));
    s.push(await until(perf, "15 s dwell → /LoadingResources → splash", tid("loading-resources"), 60_000, tid("start-screen")));
  });

  await scenario(perf, "splash ⇄ order type", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "START → order type", page.getByTestId("start-screen"), { until: tid("second-screen") }));
      if (i < 2) s.push(await tap(perf, "CANCEL → splash", page.getByTestId("footer-cancel"), { until: tid("start-screen") }));
    }
  });
  await scenario(perf, "order type → menu (cold, then the 304 path)", async (s) => {
    await menuEntries(perf, s);
    return { getMenu: { ...getMenu } };
  });
  expect(getMenu, "getMenu: one download, then the 304 path").toEqual({ full: 1, notModified: 2 });

  await scenario(perf, "menu · rail tap → its section", async (s) => {
    for (const id of [SIDE_ORDERS, MEALS_COMBOS, SIDE_ORDERS])
      s.push(await tap(perf, "tap", page.getByTestId(`rail-${id}`), { until: `${tid(`rail-${id}`)}[aria-current="true"]` }));
  });
  await scenario(perf, "ADA view", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "on", page.getByTestId("footer-ada"), { until: tid("ada-brand-zone") }));
      s.push(await tap(perf, "off", page.getByTestId("footer-ada"), { until: tid("ada-brand-zone"), gone: true }));
    }
  });
  skipped(
    "menu · VEG / NON-VEG chips",
    "the app hides them (user 2026-10-14: MenuFilterChips not enabled in pages/Menu; vegFilter.spec's FILTER test is skipped too)",
  );
});

test("LONG MENU: the walk menu at 40 rail rows and 240 cards — order type → menu, the grid and rail flings, a rail tap across the menu, the ADA view", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const getMenu = await mockKiosk(page, { menu: longMenu() });
  const perf = await startPerf(page);
  await registerToStart(page, 60_000);
  await startToSecond(page);

  await scenario(perf, "long · order type → menu (cold, then the 304 path)", async (s) => {
    await menuEntries(perf, s);
    return { cards: await page.locator(MENU_READY).count(), railRows: await railRows(page).count(), getMenu: { ...getMenu } };
  });
  await scenario(perf, "long · scroll grid", async (s) => {
    for (let i = 0; i < 3; i += 1) s.push(scrolled(await fling(perf, "down 2500 px", gridPane(page), 2_500)));
    s.push(scrolled(await fling(perf, "up 7500 px", gridPane(page), -7_500)));
    return { overflowPx: await overflowOf(gridPane(page)) };
  });
  await scenario(perf, "long · scroll rail", async (s) => {
    s.push(scrolled(await fling(perf, "down", railList(page), 1_500)));
    s.push(scrolled(await fling(perf, "up", railList(page), -1_500)));
    return { overflowPx: await overflowOf(railList(page)) };
  });
  const first = (await railRows(page).first().getAttribute("data-testid")) ?? "";
  const last = (await railRows(page).last().getAttribute("data-testid")) ?? "";
  // Back to the first row last: the ADA view's flings then start from the top of both lists.
  await scenario(perf, "long · rail tap → a far section", async (s) => {
    for (const row of [last, first, last, first]) s.push(await tap(perf, "tap", page.getByTestId(row), { until: `${tid(row)}[aria-current="true"]` }));
  });
  await scenario(perf, "long · ADA view", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "on", page.getByTestId("footer-ada"), { until: tid("ada-brand-zone") }));
      if (i === 0) {
        s.push(scrolled(await fling(perf, "grid down", gridPane(page), 2_500)), scrolled(await fling(perf, "grid up", gridPane(page), -2_500)));
        s.push(scrolled(await fling(perf, "rail down", railList(page), 1_500)), scrolled(await fling(perf, "rail up", railList(page), -1_500)));
      }
      s.push(await tap(perf, "off", page.getByTestId("footer-ada"), { until: tid("ada-brand-zone"), gone: true }));
    }
  });
});

test("ORDER: one-tap adds, Select a Size, the MIAM prompt, the pack PDP (slot sheet, tier-2 page), a PDP and its options, ADD TO BAG, the repeat sheet", async ({
  page,
}) => {
  test.setTimeout(15 * 60_000);
  await mockKiosk(page, { settings: { enable_combo_upsell: true } });
  const perf = await startPerf(page);
  await bootRegisteredToMenu(page, 60_000);
  const burger = page.getByTestId(`item-${CHEESE_BURGER}`);
  const pdp = tid("customization-screen");

  await scenario(perf, "menu · one-tap add → added modal", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "Greek Salad → added modal", page.getByTestId(`item-${GREEK_SALAD}`), { until: ADDED }));
      s.push(await tap(perf, "close", page.getByTestId("added-continue"), { until: ADDED, gone: true }));
    }
  });
  await scenario(perf, "Select a Size", async (s) => {
    for (const [n, id] of SIZED.entries()) {
      s.push(await tap(perf, "open", page.getByTestId(`quick-add-${id}`), { until: tid("select-size-modal") }));
      s.push(await tap(perf, "pick Large", page.getByTestId(`size-perf-large-${n}`), { until: `${tid(`size-perf-large-${n}`)}[aria-pressed="true"]` }));
      s.push(await tap(perf, "CONTINUE → added modal", page.getByTestId("size-continue"), { until: ADDED }));
      await dismissAddedModal(page);
    }
  });
  // Before any burger is in the bag: then a burger tap answers with the repeat sheet instead.
  await scenario(perf, "MIAM prompt", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "Cheese Burger → prompt", burger, { until: tid("miam-prompt") }));
      s.push(await tap(perf, "close", page.getByTestId("miam-close"), { until: tid("miam-prompt"), gone: true }));
    }
  });
  await scenario(perf, "pack PDP: MIAM combo → slot sheet → tier-2 page → ADD TO BAG", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      await burger.click();
      await slow(page.getByTestId("miam-prompt")).toBeVisible();
      s.push(await tap(perf, "combo → pack PDP", page.getByTestId(`miam-combo-${DREAM_BOX}`), { until: tid("pack-slot-grid") }));
      s.push(await tap(perf, "Drinks → slot sheet", page.getByTestId(`pack-slot-open-${G_DRINKS}`), { until: tid("slot-sheet") }));
      const pepsi = tid(`slot-option-${PEPSI_SMALL}`);
      // The pick's outcome: the row's radio check (the option button carries no state of its own).
      s.push(await tap(perf, "pick Pepsi", page.getByTestId("slot-sheet").locator(pepsi), { until: `${tid("slot-sheet")} div:has(> ${pepsi}) img.tb-pop-in` }));
      s.push(await tap(perf, "slot SAVE", page.getByTestId("slot-sheet-save"), { until: tid("slot-sheet"), gone: true }));
      s.push(await tap(perf, "Sides CUSTOMIZE → tier-2 page", page.getByTestId(`pack-slot-customize-${G_SIDES}`), { until: tid("tier2-sheet") }));
      const salt = page.getByTestId("tier2-sheet").getByTestId(`tier2-option-${WITHOUT_SALT}`);
      s.push(await tap(perf, "tier-2 option", salt, await flipOf(salt)));
      s.push(await tap(perf, "tier-2 SAVE", page.getByTestId("tier2-sheet-save"), { until: tid("tier2-sheet"), gone: true }));
      s.push(await tap(perf, "ADD TO BAG → added modal", page.getByTestId("pdp-add-to-bag"), { until: ADDED }));
      await dismissAddedModal(page);
    }
  });
  await scenario(perf, "PDP · open + BACK", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "Large Fries → PDP", page.getByTestId(`item-${LARGE_FRIES}`), { until: pdp }));
      s.push(await tap(perf, "BACK → menu", page.getByTestId("pdp-back"), { until: pdp, gone: true }));
    }
  });
  await scenario(perf, "MIAM · NOT TODAY → PDP", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      await burger.click();
      await slow(page.getByTestId("miam-prompt")).toBeVisible();
      s.push(await tap(perf, "NOT TODAY → PDP", page.getByTestId("miam-decline"), { until: pdp }));
      if (i === 2) break; // the third PDP stays open for its options
      await page.getByTestId("pdp-back").click();
      await expect(page.getByTestId("customization-screen")).toHaveCount(0);
    }
  });
  await scenario(perf, "PDP · 5 option taps", async (s) => {
    for (const id of BURGER_OPTIONS) {
      const option = page.getByTestId(`pdp-option-${id}`);
      s.push(await tap(perf, "option", option, await flipOf(option)));
    }
  });
  await scenario(perf, "burger: ADD TO BAG, the repeat sheet, NEW CUSTOMIZATIONS", async (s) => {
    s.push(await tap(perf, "ADD TO BAG → added modal", page.getByTestId("pdp-add-to-bag"), { until: ADDED }));
    await dismissAddedModal(page);
    // A customized item in the bag answers a card tap with the repeat sheet.
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "Cheese Burger → repeat sheet", burger, { until: tid("repeat-sheet") }));
      s.push(await tap(perf, "close", page.getByTestId("repeat-sheet-close"), { until: tid("repeat-sheet"), gone: true }));
    }
    // A fresh session asks the meal question again (combo upsell on): NOT TODAY, then the PDP.
    for (let i = 0; i < 2; i += 1) {
      await burger.click();
      await slow(page.getByTestId("repeat-sheet")).toBeVisible();
      s.push(await tap(perf, "NEW CUSTOMIZATIONS → prompt", page.getByTestId("repeat-new-customizations"), { until: tid("miam-prompt") }));
      await page.getByTestId("miam-decline").click();
      await slow(page.getByTestId("customization-screen")).toBeVisible();
      s.push(await tap(perf, "ADD TO BAG → added modal", page.getByTestId("pdp-add-to-bag"), { until: ADDED }));
      await dismissAddedModal(page);
    }
  });
});

test("BAG & OFFERS: /cart, the stepper, the rewards sheet, the buy stage, the freebie picker and its celebration, the EAT IN ⇄ TAKE OUT switch", async ({
  page,
}) => {
  test.setTimeout(15 * 60_000);
  const getMenu = await mockKiosk(page, { pipelines: [DINE_IN, TAKE_OUT] }, {});
  const perf = await startPerf(page);
  await bootRegisteredToMenu(page, 60_000);
  await addOneTap(page, GREEK_SALAD, "(1)");
  await addViaPdp(page, CHEESE_BURGER, { expectedCta: "£8.00" });

  await scenario(perf, "bag · open (/cart) + close", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "VIEW MY BAG → /cart", page.getByTestId("cta-view-bag"), { until: tid("bag-sheet") }));
      if (i < 2) s.push(await tap(perf, "close", page.getByTestId("bag-close"), { until: tid("bag-sheet"), gone: true }));
    }
  });
  await scenario(perf, "bag · stepper +", async (s) => {
    const item = ((await bagRows(page).first().getAttribute("data-testid")) ?? "").replace("bag-row-", "");
    // The row's quantity: the stepper's <p> right before its + button.
    const quantity = `p:has(+ ${tid(`bag-inc-${item}`)})`;
    const from = Number(await page.locator(quantity).textContent());
    for (let i = 1; i <= 3; i += 1) s.push(await tap(perf, "+", page.getByTestId(`bag-inc-${item}`), { until: quantity, text: String(from + i) }));
  });
  await scenario(perf, "bag · rewards sheet", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "open", page.getByTestId("bag-rewards-entry"), { until: tid("rewards-sheet") }));
      if (i < 2) s.push(await tap(perf, "close", page.getByTestId("rewards-close"), { until: tid("rewards-sheet"), gone: true }));
    }
  });
  await scenario(perf, "bag · buy stage", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "ADD ITEMS → buy stage", page.getByTestId(`offer-row-add-items-${BOGO_SAUCE._id}`), { until: tid("buy-stage-sheet") }));
      s.push(await tap(perf, "add", page.getByTestId(`buy-stage-add-${TORTILLA_SAUCE}`), { until: tid(`buy-stage-qty-${TORTILLA_SAUCE}`) }));
      s.push(await tap(perf, "+ → unlocked", page.getByTestId(`buy-stage-inc-${TORTILLA_SAUCE}`), { until: tid("buy-stage-unlocked") }));
      // BACK rolls the cart back and returns to the rewards list (BagSheet): the next round starts there.
      s.push(await tap(perf, "BACK → rewards sheet", page.getByTestId("buy-stage-back"), { until: tid("rewards-sheet") }));
    }
  });
  await scenario(perf, "bag · freebie picker → celebration", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      if (i) {
        await page.getByTestId("bag-rewards-entry").click();
        await slow(page.getByTestId("rewards-sheet")).toBeVisible();
      }
      const row = `offer-row-${OFFER_FREE_SAUCE}`;
      s.push(await tap(perf, "pick the offer", page.getByTestId(row), { until: `${tid(row)}[aria-checked="true"]` }));
      s.push(await tap(perf, "SAVE → picker", page.getByTestId("rewards-save"), { until: tid("freebie-picker") }));
      const option = page.getByTestId(`freebie-option-${TORTILLA_SAUCE}`);
      s.push(await tap(perf, "option", option, await flipOf(option)));
      s.push(await tap(perf, "CONFIRM → celebration", page.getByTestId("freebie-confirm"), { until: tid("offer-applied-celebration") }));
      // Remove it: a remove-then-reapply celebrates again (BagSheet AppliedRowPop).
      await page.getByTestId("bag-rewards-remove").click();
      await slow(page.getByTestId("bag-rewards-entry")).toBeVisible();
    }
  });
  await scenario(perf, "bag · EAT IN ⇄ TAKE OUT (re-fetches the menu)", async (s) => {
    await orderTypeSwitches(perf, s);
    return { getMenu: { ...getMenu } };
  });
});

test("CHECKOUT: PAY → /tent → /phone → /customerName → /payment → /receipt → Order Complete (confetti) → its countdown back to the splash", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  await mockKiosk(page);
  const perf = await startPerf(page);
  await bootRegisteredToMenu(page, 60_000);
  await addOneTap(page, GREEK_SALAD, "(1)");
  await openBag(page);

  await scenario(perf, "bag · PAY → /tent", async (s) => {
    s.push(await tap(perf, "PAY", page.getByTestId("bag-pay"), { until: tid("tent-screen") }));
  });
  await scenario(perf, "/tent · numpad", async (s) => {
    for (const [name, shown] of [
      ["key-1", "1"],
      ["key-2", "12"],
      ["backspace", "1"],
      ["key-2", "12"],
    ])
      s.push(await tap(perf, name === "backspace" ? "backspace" : "key", page.getByTestId(`numpad-${name}`), { until: tid("tent-display"), text: shown }));
  });
  await scenario(perf, "/tent → /phone", async (s) => {
    s.push(await tap(perf, "CONTINUE", page.getByTestId("tent-confirm"), { until: tid("phone-screen") }));
  });
  await scenario(perf, "/phone · keypad (CRM)", async (s) => {
    const digits = "987654";
    for (let n = 1; n <= digits.length; n += 1)
      s.push(await tap(perf, "key", page.getByTestId(`numpad-key-${digits[n - 1]}`), { until: tid("phone-number-display"), text: masked(digits.slice(0, n)) }));
  });
  await typeDigits(page, "3210");
  await scenario(perf, "/phone → /customerName", async (s) => {
    s.push(await tap(perf, "CONTINUE", page.getByTestId("phone-continue"), { until: tid("customer-name-screen") }));
  });
  await expect(page.getByTestId("customer-name-loading")).toHaveCount(0);
  if (await page.getByTestId("customer-name-clear").isVisible()) await page.getByTestId("customer-name-clear").click();
  await scenario(perf, "/customerName · keyboard", async (s) => {
    const word = "tacobe";
    for (let n = 1; n <= word.length; n += 1) s.push(await tap(perf, "key", key(page, word[n - 1]), { until: tid("customer-name-input"), text: word.slice(0, n) }));
  });
  await scenario(perf, "/customerName → /payment", async (s) => {
    s.push(await tap(perf, "CONTINUE", page.getByTestId("customer-name-continue"), { until: tid("payment-screen") }));
  });
  await scenario(perf, "/payment · PAY AT COUNTER → 3 s window → /receipt", async (s) => {
    s.push(await tap(perf, "PAY AT COUNTER", page.getByTestId("payment-counter"), { until: tid("receipt-screen") }));
  });
  await scenario(perf, "/receipt → Order Complete (confetti) → countdown → splash", async (s) => {
    s.push(await tap(perf, "NO THANKS → Order Complete", page.getByTestId("receipt-none"), { until: `${tid("order-number")} .tb-confetti-piece` }));
    s.push(await until(perf, "countdown → splash", tid("start-screen")));
  });
});

test("PAYTM: /payment → the UPI QR tile → its 3 s window → /paymentPolling (lazy chunk, QR) → polling → paid → /receipt", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  // paytm.spec's mock order: the kiosk backend, the checkout edges with the Paytm DQR row, the Paytm routes
  // LAST. Dine in with CRM skipped: PAY → /payment.
  await mockKiosk(page, { settings: { skip_crm_page: true } }, { extraDeviceSettings: [PAYTM_DQR_ENTITY] });
  await mockPaytmBackend(page, { dqrStatus: statusSequence("pending", "pending", "paid") });
  const perf = await startPerf(page);
  await bootRegisteredToMenu(page, 60_000);
  await addOneTap(page, GREEK_SALAD, "(1)");
  await openBag(page);
  await page.getByTestId("bag-pay").click();
  await slow(page.getByTestId("payment-screen")).toBeVisible();

  await scenario(perf, "/payment · UPI QR → 3 s window → /paymentPolling", async (s) => {
    s.push(await tap(perf, "QR tile → the QR", page.getByTestId("payment-qr"), { until: `${tid("paytm-qr")} svg` }));
  });
  await scenario(perf, "/paymentPolling · the QR up, a poll every 3 s → paid → /receipt", async (s) => {
    s.push(await until(perf, "polling → paid → /receipt", tid("receipt-screen")));
  });
});

test("IDLE: the menu left alone until the idle prompt, the prompt's countdown, CONTINUE", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  // The 60 s floor (resolveIdleSeconds): the prompt opens 40 s after the last touch, for 20 s.
  await mockKiosk(page, { settings: { ideal_time: "60" } });
  const perf = await startPerf(page);
  await bootRegisteredToMenu(page, 60_000);
  await addOneTap(page, GREEK_SALAD, "(1)");

  // One section: its GC runs once, after CONTINUE — inside the prompt's 20 s it would eat the window.
  await scenario(perf, "menu idle 40 s → idle prompt → CONTINUE", async (s) => {
    s.push(await until(perf, "menu idle → prompt", tid("idle-modal"), 90_000));
    s.push(await idle(perf, "prompt counting down", 5_000));
    s.push(await tap(perf, "CONTINUE", page.getByTestId("idle-continue"), { until: tid("idle-modal"), gone: true }));
  });
});

test("LOYALTY: order type → the pre-menu /phone, its keypad, the lookup → the loyalty rewards sheet → the menu, 3 guests", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await mockKiosk(page, { settings: LOYALTY_SETTINGS });
  await mockXenoLoyalty(page);
  const perf = await startPerf(page);
  await registerToStart(page, 60_000);

  await scenario(perf, "loyalty · /phone → lookup → rewards sheet → menu", async (s) => {
    for (let guest = 0; guest < 3; guest += 1) {
      await startToSecond(page);
      s.push(await tap(perf, "Dine In → /phone", page.getByTestId("pipeline-p1"), { until: tid("phone-screen") }));
      for (let n = 1; n <= 6; n += 1)
        s.push(
          await tap(perf, "key", page.getByTestId(`numpad-key-${LOYALTY_PHONE[n - 1]}`), {
            until: tid("phone-number-display"),
            text: masked(LOYALTY_PHONE.slice(0, n)),
          }),
        );
      await typeDigits(page, LOYALTY_PHONE.slice(6));
      s.push(await tap(perf, "CONTINUE → lookup → rewards sheet", page.getByTestId("phone-continue"), { until: tid("loyalty-rewards-sheet") }));
      s.push(await tap(perf, "close → menu", page.getByTestId("loyalty-rewards-close"), { until: tid("loyalty-rewards-sheet"), gone: true }));
      await cancelToSplash(page);
    }
  });
});

test("LANGUAGE: the language sheet, English ⇄ Arabic on the order type and on the menu, the Arabic menu entry", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await mockKiosk(page, { arabic: true });
  const perf = await startPerf(page);
  await registerToStart(page, 60_000);
  await startToSecond(page);
  const sheet = tid("language-sheet");
  const open = (label: string) => tap(perf, label, page.getByTestId("footer-language"), { until: sheet });
  const choose = (label: string, code: "en" | "ar") => tap(perf, label, page.getByTestId(`language-${code}`), { until: `html[lang="${code}"]` });
  // Both languages from both screens, 3 rounds each.
  const rounds = async (s: Sample[], first: "en" | "ar") => {
    const second = first === "en" ? "ar" : "en";
    const name = { en: "English", ar: "Arabic" };
    for (let i = 0; i < 3; i += 1) {
      s.push(await open("open"));
      s.push(await choose(`${name[second]} → ${name[first]}`, first));
      s.push(await open("open"));
      s.push(await choose(`${name[first]} → ${name[second]}`, second));
    }
  };

  await scenario(perf, "language sheet · order type", async (s) => {
    for (let i = 0; i < 3; i += 1) {
      // The first open pays the sheet's first render: its own row.
      s.push(await open(i ? "open" : "open (first)"));
      s.push(await tap(perf, "close", page.locator(`${sheet} .tb-sheet-enter > button`), { until: sheet, gone: true }));
    }
    await rounds(s, "ar");
  });
  await chooseLanguage(page, "ar");
  await scenario(perf, "order type → menu (Arabic: cold, then the 304 path)", async (s) => {
    await menuEntries(perf, s, 60_000, async () => {
      if ((await page.locator("html").getAttribute("lang")) !== "ar") await chooseLanguage(page, "ar");
    });
  });
  await scenario(perf, "language sheet · menu", async (s) => rounds(s, "en"));
});

test("MEMORY: guest cycles (splash → menu → 3 adds → the bag → CANCEL ORDER → splash) — heap after GC, DOM nodes and JS listeners per cycle", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const getMenu = await mockKiosk(page);
  const perf = await startPerf(page);
  await registerToStart(page, 60_000);

  const total = Math.max(2, Number(process.env.PERF_GUEST_CYCLES) || 5);
  const cycles: (Memory & { cycle: number; wallMs: number })[] = [];
  let growth: Record<"heapMB" | "nodes" | "listeners", number> = { heapMB: 0, nodes: 0, listeners: 0 };
  await scenario(perf, `memory · ${total} guest cycles`, async () => {
    const baseline = await memory(perf);
    for (let cycle = 1; cycle <= total; cycle += 1) {
      const start = Date.now();
      await startOrderTo(page, "menu-screen", 60_000);
      await addOneTap(page, GREEK_SALAD, "(1)");
      await addOneTap(page, TORTILLA_SAUCE, "(2)");
      await addOneTap(page, CAESAR_DRESSING, "(3)");
      await openBag(page);
      await page.getByTestId("bag-close").click();
      await cancelToSplash(page);
      cycles.push({ cycle, wallMs: Date.now() - start, ...(await memory(perf)) });
    }
    // Cycle 1 pays the one-time costs (lazy chunks, caches): growth is cycle 1 → the last, per cycle.
    const per = (key: keyof typeof growth) => Math.round(((cycles[total - 1][key] - cycles[0][key]) / (total - 1)) * 100) / 100;
    growth = { heapMB: per("heapMB"), nodes: per("nodes"), listeners: per("listeners") };
    return { baseline, cycles, growthPerCycle: growth, getMenu: { ...getMenu } };
  });
  // Generous: a leak the size of one guest's menu would blow these; GC noise stays far inside them.
  expect(growth.heapMB, "JS heap growth per guest cycle (MB)").toBeLessThan(1.5);
  expect(growth.nodes, "DOM node growth per guest cycle").toBeLessThan(500);
  expect(growth.listeners, "JS listener growth per guest cycle").toBeLessThan(100);
});

test("STANDARD MENU (local only): ../posistKiosk-cx-sdk/StandardMenu.json as getMenu — the licence boot, order type → menu (cold, then the 304 path), its scroll and rail, the ADA view, one-tap adds, the bag's EAT IN ⇄ TAKE OUT", async ({
  page,
}) => {
  const names = {
    boot: "standard · licence → splash",
    entry: "standard · order type → menu (cold, then the 304 path)",
    grid: "standard · scroll grid",
    rail: "standard · scroll rail",
    ada: "standard · ADA view",
    adaRail: "standard · scroll rail (ADA view)",
    add: "standard · one-tap add → added modal",
    switch: "standard · bag EAT IN ⇄ TAKE OUT (re-fetches the menu)",
  };
  const absent = "../posistKiosk-cx-sdk/StandardMenu.json is absent (gitignored, local only)";
  if (!existsSync(STANDARD_MENU)) for (const name of Object.values(names)) skipped(name, absent);
  test.skip(!existsSync(STANDARD_MENU), absent);
  test.setTimeout(15 * 60_000);

  const menu = JSON.parse(readFileSync(STANDARD_MENU, "utf-8"));
  /** Plain, sellable items: a card tap adds them at once. */
  const plain = new Set<string>();
  for (const category of menu.categories ?? [])
    for (const sub of category.subCategories ?? [])
      for (const entity of sub.entities ?? [])
        if (entity.isActive !== false && !entity.hasVariant && !(entity.modifiers ?? []).length && Number(entity.price) > 0) plain.add(entity.id);

  const getMenu = await mockKiosk(page, { menu, pipelines: [DINE_IN, TAKE_OUT] }, {});
  const perf = await startPerf(page);
  await page.goto("/");
  for (const name of ["t", "b"]) await key(page, name).click();
  await page.getByRole("button", { name: /numbers and symbols/i }).click();
  await key(page, "7").click();
  await scenario(perf, names.boot, async (s) => {
    s.push(await tap(perf, "submit", page.getByTestId("registration-submit"), { until: tid("start-screen"), timeoutMs: 120_000 }));
  });
  await startToSecond(page);
  await scenario(perf, names.entry, async (s) => {
    await menuEntries(perf, s, 120_000);
    return { cards: await page.locator(MENU_READY).count(), railRows: await railRows(page).count(), getMenu: { ...getMenu } };
  });
  await scenario(perf, names.grid, async (s) => {
    for (let i = 0; i < 3; i += 1) s.push(scrolled(await fling(perf, "down 2500 px", gridPane(page), 2_500)));
    s.push(scrolled(await fling(perf, "up 7500 px", gridPane(page), -7_500)));
    return { overflowPx: await overflowOf(gridPane(page)) };
  });
  await railFlings(perf, names.rail);
  await scenario(perf, names.ada, async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "on", page.getByTestId("footer-ada"), { until: tid("ada-brand-zone"), timeoutMs: 120_000 }));
      // The reach zone's rail box is shorter: its rows may overflow there.
      if (i === 0) await railFlings(perf, names.adaRail);
      s.push(await tap(perf, "off", page.getByTestId("footer-ada"), { until: tid("ada-brand-zone"), gone: true, timeoutMs: 120_000 }));
    }
  });

  const ids = await page.locator(`${MENU_READY}:not([aria-disabled="true"])`).evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")?.slice(5) ?? ""));
  const target = ids.find((id) => plain.has(id));
  if (!target) {
    skipped(names.add, "no plain, sellable card in the rendered menu");
    skipped(names.switch, "no plain card to fill the bag with");
    return;
  }
  await scenario(perf, names.add, async (s) => {
    for (let i = 0; i < 3; i += 1) {
      s.push(await tap(perf, "plain card → added modal", page.getByTestId(`item-${target}`), { until: ADDED, timeoutMs: 120_000 }));
      await dismissAddedModal(page);
    }
    return { item: target };
  });
  await openBag(page);
  await scenario(perf, names.switch, async (s) => {
    await orderTypeSwitches(perf, s, 120_000);
    return { getMenu: { ...getMenu } };
  });
});
