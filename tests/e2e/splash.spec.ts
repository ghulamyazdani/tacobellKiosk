import { test, expect, type Page, type Request } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * P9d — splash (attract) media, end to end: boot fetches `getMedia`, stores
 * only this deployment's `home_screen` list, and /start lays it out by
 * PLAYABLE slide count — 0 → WELCOME (Figma 1:5617), 1 → full-bleed
 * (1:5604), ≥ 2 → the peek carousel (1:2203). A slide that fails drops out,
 * so the layout degrades 2 → 1 → WELCOME and is never blank. A slide that
 * errored or stalled gets one more try 10 min after the last failure
 * (post-P9 44, D9: SPLASH_RETRY_MS); one with no picture (no_video) never.
 *
 * ── MOCKS ───────────────────────────────────────────────────────────────
 * House order (registration.spec.ts): the `**\/api/**` catch-all FIRST, every
 * specific mock after it (Playwright matches newest-first). getMedia is
 * device-persisted media read once per splash visit, so it is mocked BEFORE
 * registration: the boot (/LoadingResources) is what stores it. The slides
 * live on a fake cross-origin CDN (production media sits on S3), served by
 * one route: a 1×1 PNG, the WebM fixture, or a 404.
 *
 * ── VIDEO ───────────────────────────────────────────────────────────────
 * Playwright's Chromium has no proprietary codecs (no H.264), so the video
 * slide is `fixtures/splash.webm` — 593 bytes of VP8, made once with
 *   ffmpeg -f lavfi -i "color=c=0x501098:size=32x32:rate=5:duration=1" \
 *     -c:v libvpx -b:v 20k -an -pix_fmt yuv420p splash.webm
 * The no-picture slide (`no_video`) is `fixtures/splash-audio-only.webm`,
 * 1 s of silent Opus, no video track:
 *   ffmpeg -f lavfi -i "anullsrc=r=8000:cl=mono:duration=1" -c:a libopus \
 *     -b:a 6k -vn -fflags +bitexact -f webm splash-audio-only.webm
 *
 * ── TIME ────────────────────────────────────────────────────────────────
 * Only the carousel and the retry need fake time (`page.clock.install()`
 * before the first goto, so the dwell and retry timers are fake). The
 * installed clock still trickles in real time between calls, hence long
 * dwells and wide "not yet" margins (10 s; the retry's is 1 min).
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

const readFixture = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)));

const en = JSON.parse(
  readFixture("../../src/i18n/locales/en/translation.json").toString("utf-8")
);
const WEBM = readFixture("./fixtures/splash.webm");
const AUDIO_ONLY_WEBM = readFixture("./fixtures/splash-audio-only.webm");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

/** SDK kioskInfoApi `getKioskMedia`: POST /api/cx/kiosk/getMedia. */
const GET_MEDIA_URL = "**/api/cx/kiosk/getMedia";
const MEDIA_ORIGIN = "https://splash-media.e2e.test";
const SLIDE_A = `${MEDIA_ORIGIN}/slide-a.png`;
const SLIDE_B = `${MEDIA_ORIGIN}/slide-b.png`;
const VIDEO = `${MEDIA_ORIGIN}/promo.webm`;
const AUDIO_ONLY = `${MEDIA_ORIGIN}/audio-only.webm`;

async function mockBootEndpoints(page: Page) {
  await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
  // Cross-origin, so the catch-all above never sees it.
  await page.route("https://localhost:65505/**", (r) => r.abort("failed"));
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
  await page.route("**/api/cx/kiosk/getPipelines", (r) =>
    r.fulfill({ json: [{ _id: "p1", name: "Dine In" }] })
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
      json: { start_order_text_primary: "START ORDER", ideal_time: "180" },
    })
  );
  await page.route("**/api/cx/kiosk/login", (r) => r.fulfill({ json: LOGIN_OK }));
}

type MediaEntry = Record<string, unknown>;

/** An image entry as the backend sends it (fork fixture shape). */
const image = (url: string, extra: MediaEntry = {}): MediaEntry => ({
  url,
  media_type: "image",
  iteration_time: "5",
  text: "",
  items: [],
  ...extra,
});

/** getMedia body: the first entry is the home_screen root, the rest its extras. */
const homeScreen = (root: MediaEntry, ...extras: MediaEntry[]) => ({
  media: [{ key: "home_screen", ...root, extra_images: extras }],
});

/** getMedia answers `body` (newer than the catch-all, so it wins). */
async function mockMedia(page: Page, body: unknown): Promise<Request[]> {
  const requests: Request[] = [];
  await page.route(GET_MEDIA_URL, (route) => {
    requests.push(route.request());
    return route.fulfill({ json: body });
  });
  return requests;
}

/** The fake CDN. Returns every URL the page asked it for, in order. */
async function serveMediaHost(page: Page, missing: string[] = []) {
  const requested: string[] = [];
  await page.route(`${MEDIA_ORIGIN}/**`, (route) => {
    const url = route.request().url();
    requested.push(url);
    if (missing.includes(url)) return route.fulfill({ status: 404 });
    return url.endsWith(".webm")
      ? route.fulfill({ body: WEBM, contentType: "video/webm" })
      : route.fulfill({ body: PNG, contentType: "image/png" });
  });
  return requested;
}

/** Register on the on-screen keyboard; the boot (getMedia included) lands on /start. */
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

const splashOf = (page: Page) => page.getByTestId("start-screen");

/** The slide <img> for `url` has decoded real pixels. */
async function expectLoaded(page: Page, url: string) {
  await expect
    .poll(() =>
      splashOf(page)
        .locator(`img[src="${url}"]`)
        .evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))
    )
    .toBeGreaterThan(0);
}

/** Full-bleed = ONE media element, and its box IS the stage box. */
async function expectFullBleed(page: Page, selector: string) {
  const media = splashOf(page).locator(selector);
  await expect(media).toHaveCount(1);
  await expect(media).toBeVisible();
  expect(await media.boundingBox()).toEqual(await splashOf(page).boundingBox());
}

/**
 * The carousel's slide images keyed by their x on the stage — Figma 1:2203
 * puts the cards at prev −592 · centre 200 · next 992.
 */
function cards(page: Page): Promise<Record<string, string | null>> {
  return splashOf(page).evaluate((stage, origin) => {
    const x0 = stage.getBoundingClientRect().left;
    return Object.fromEntries(
      Array.from(stage.querySelectorAll("img"))
        .filter((img) => img.src.startsWith(origin))
        .map((img) => [
          String(Math.round(img.getBoundingClientRect().left - x0)),
          img.getAttribute("src"),
        ])
    );
  }, MEDIA_ORIGIN);
}

/** Where a line of copy sits on the stage: its top and its horizontal centre. */
function copyAt(page: Page, copy: string) {
  return splashOf(page).evaluate((stage, text) => {
    const line = Array.from(stage.querySelectorAll("span")).find(
      (el) => el.textContent === text
    );
    if (!line) return null;
    const s = stage.getBoundingClientRect();
    const r = line.getBoundingClientRect();
    return {
      top: Math.round(r.top - s.top),
      centre: Math.round(r.left + r.width / 2 - s.left),
    };
  }, copy);
}

/** Two slides: both peeks show the other one. */
const showing = (centre: string, peek: string) => ({
  "-592": peek,
  "200": centre,
  "992": peek,
});

/** The tap still starts the order, and the splash's media goes with it. */
async function tapToSecond(page: Page) {
  await splashOf(page).click();
  await expect(page.getByTestId("second-screen")).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
}

test.describe("P9d splash media", () => {
  test("NO MEDIA: a getMedia body without a media list stores nothing — WELCOME (1:5617), named by its own copy, no slide media; the tap starts the order", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    // The catch-all's own `{}`, counted: what every other spec boots with.
    const getMedia = await mockMedia(page, {});
    await registerToStart(page);

    expect(getMedia).toHaveLength(1);
    expect(getMedia[0].postDataJSON()).toEqual({
      brand_id: "brand1",
      channel: "Kiosk",
    });
    // The tap target's accessible name is the visible copy.
    await expect(
      page.getByRole("button", { name: new RegExp(en.splash.touchToStart, "i") })
    ).toBeVisible();
    const splash = splashOf(page);
    await expect(splash).toContainText(en.splash.welcome);
    await expect(splash).not.toContainText(en.splash.startOrder);
    // Figma 1:5617: the WELCOME headline at y 1548, the CTA at y 1752, both centred.
    expect(await copyAt(page, en.splash.welcome)).toEqual({ top: 1548, centre: 540 });
    expect(await copyAt(page, en.splash.touchToStart)).toEqual({
      top: 1752,
      centre: 540,
    });
    await expect(splash.locator(`img[src^="${MEDIA_ORIGIN}"]`)).toHaveCount(0);
    await expect(splash.locator("video")).toHaveCount(0);
    await tapToSecond(page);
  });

  test("ONE IMAGE: a single home_screen image fills the stage (1:5604) under START ORDER, and a relaunch shows it again from the device store without a new getMedia; the tap starts the order", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    const getMedia = await mockMedia(page, homeScreen(image(SLIDE_A)));
    await serveMediaHost(page);
    await registerToStart(page);

    await expectFullBleed(page, `img[src="${SLIDE_A}"]`);
    await expectLoaded(page, SLIDE_A);
    const splash = splashOf(page);
    await expect(splash).toContainText(en.splash.startOrder);
    await expect(splash).not.toContainText(en.splash.orderHere);
    await expect(splash).not.toContainText(en.splash.welcome);

    // TB boots only at registration: a relaunch lands straight on /start, so
    // the slide must come back from the persisted appSettings.mediaData.
    await expect
      .poll(() => page.evaluate(() => Object.values(window.localStorage).join()))
      .toContain(SLIDE_A);
    await page.reload();
    await expectFullBleed(page, `img[src="${SLIDE_A}"]`);
    await expectLoaded(page, SLIDE_A);
    expect(getMedia).toHaveLength(1);
    await tapToSecond(page);
  });

  test("CAROUSEL: two images rotate through the centre card (1:2203), each on its own iteration_time, and wrap; the tap starts the order", async ({
    page,
  }) => {
    test.slow();
    // Before the first goto, so the dwell timers are fake-clock timers.
    await page.clock.install();
    await mockBootEndpoints(page);
    await mockMedia(
      page,
      homeScreen(
        image(SLIDE_A, { iteration_time: "30" }),
        image(SLIDE_B, { iteration_time: 60 })
      )
    );
    await serveMediaHost(page);
    await registerToStart(page);

    const splash = splashOf(page);
    await expect(splash).toContainText(en.splash.orderHere);
    await expect(splash).toContainText(en.splash.startOrder);
    await expect.poll(() => cards(page)).toEqual(showing(SLIDE_A, SLIDE_B));
    await expectLoaded(page, SLIDE_A);

    // A dwells its own 30 s — armed at mount, so one runFor reaches it.
    await page.clock.runFor(20_000);
    expect(await cards(page)).toEqual(showing(SLIDE_A, SLIDE_B));
    await page.clock.runFor(10_000);
    await expect.poll(() => cards(page)).toEqual(showing(SLIDE_B, SLIDE_A));

    // B's 60 s is armed by B's own centre mount (a page-armed chain): not
    // yet at 50 s, then step until the rotation wraps back to A.
    await page.clock.runFor(50_000);
    expect(await cards(page)).toEqual(showing(SLIDE_B, SLIDE_A));
    await expect
      .poll(
        async () => {
          await page.clock.runFor(1_000);
          return cards(page);
        },
        { timeout: 20_000, intervals: [50] }
      )
      .toEqual(showing(SLIDE_A, SLIDE_B));

    await tapToSecond(page);
  });

  test("BROKEN SLIDE: a slide that 404s drops out — two slides degrade to the survivor, full-bleed (never a blank card)", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    await mockMedia(page, homeScreen(image(SLIDE_A), image(SLIDE_B)));
    // The CENTRE slide breaks: the rotation must move off it.
    await serveMediaHost(page, [SLIDE_A]);
    await registerToStart(page);

    // While the carousel is up B sits in BOTH peeks; once A fails it is the
    // only slide left — one image.
    const splash = splashOf(page);
    await expect(splash.locator(`img[src="${SLIDE_A}"]`)).toHaveCount(0);
    await expectFullBleed(page, `img[src="${SLIDE_B}"]`);
    await expectLoaded(page, SLIDE_B);
    await expect(splash).toContainText(en.splash.startOrder);
    await expect(splash).not.toContainText(en.splash.orderHere);
    await tapToSecond(page);
  });

  test("ALL BROKEN: when every slide 404s the splash falls back to WELCOME, still tappable", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    await mockMedia(page, homeScreen(image(SLIDE_A), image(SLIDE_B)));
    await serveMediaHost(page, [SLIDE_A, SLIDE_B]);
    await registerToStart(page);

    const splash = splashOf(page);
    await expect(splash).toContainText(en.splash.touchToStart);
    await expect(splash).toContainText(en.splash.welcome);
    await expect(splash.locator(`img[src^="${MEDIA_ORIGIN}"]`)).toHaveCount(0);
    await tapToSecond(page);
  });

  test("SCOPE: an entry scoped to another store, or carrying a malformed (string) scope, never shows — only this store's slide plays, full-bleed", async ({
    page,
  }) => {
    const otherStore = `${MEDIA_ORIGIN}/other-store.png`;
    const malformed = `${MEDIA_ORIGIN}/malformed-scope.png`;
    await mockBootEndpoints(page);
    await mockMedia(
      page,
      homeScreen(
        image(otherStore, { deployments: ["some-other-id"] }),
        // The fork substring-matched a string scope, so "dep1" would show.
        image(malformed, { deployments: "dep1" }),
        image(SLIDE_A, { deployments: ["dep1"] })
      )
    );
    const requested = await serveMediaHost(page);
    await registerToStart(page);

    await expectFullBleed(page, `img[src="${SLIDE_A}"]`);
    await expectLoaded(page, SLIDE_A);
    await expect(splashOf(page)).not.toContainText(en.splash.orderHere);
    expect(requested).not.toContain(otherStore);
    expect(requested).not.toContain(malformed);
  });

  test("VIDEO: a WebM slide plays full-bleed and loops (the single-slide layout); leaving the splash tears it down", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    await mockMedia(
      page,
      homeScreen({ url: VIDEO, media_type: "webm", iteration_time: "2" })
    );
    await serveMediaHost(page);
    await registerToStart(page);

    const video = splashOf(page).locator("video");
    await expect(video).toHaveJSProperty("src", VIDEO);
    await expect(video).toHaveJSProperty("loop", true);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    await expect(video).toHaveJSProperty("paused", false);
    await expectFullBleed(page, "video");
    await expect(splashOf(page)).toContainText(en.splash.startOrder);
    await tapToSecond(page);
  });

  test("RETRY (D9): a slide whose host 404s sits out (full-bleed survivor), and 10 min after the failure — host healed — it is fetched again and the carousel is back; the tap starts the order", async ({
    page,
  }) => {
    test.slow();
    // Before the first goto: the retry (SPLASH_RETRY_MS) is a fake-clock timer.
    // The boot stamps lastBootAt on this clock, so 10 min leaves the data far
    // from P9e's 6 h scheduled refresh.
    await page.clock.install();
    await mockBootEndpoints(page);
    // Long dwells: the restored carousel must hold still while it is read.
    await mockMedia(
      page,
      homeScreen(
        image(SLIDE_A, { iteration_time: "60" }),
        image(SLIDE_B, { iteration_time: "60" })
      )
    );
    const requested = await serveMediaHost(page, [SLIDE_B]);
    await registerToStart(page);

    // B's host 404s: the carousel degrades to A alone, full-bleed.
    const splash = splashOf(page);
    await expect(splash).not.toContainText(en.splash.orderHere);
    await expect(splash.locator(`img[src="${SLIDE_B}"]`)).toHaveCount(0);
    await expectFullBleed(page, `img[src="${SLIDE_A}"]`);
    await expectLoaded(page, SLIDE_A);
    expect(requested).toContain(SLIDE_B);

    // The host heals (newest route wins). Not retried before the 10 min…
    await page.route(SLIDE_B, (route) =>
      route.fulfill({ body: PNG, contentType: "image/png" })
    );
    await page.clock.fastForward("09:00");
    await expect(splash.locator(`img[src="${SLIDE_B}"]`)).toHaveCount(0);

    // …then B goes back on the wire — a NEW request (never a cached failure,
    // and the URL is never cache-busted) — and the 1:2203 carousel returns
    // with B in both peek cards.
    const refetch = page.waitForRequest(SLIDE_B, { timeout: 10_000 });
    await page.clock.fastForward("01:00");
    await refetch;
    await expect.poll(() => cards(page)).toEqual(showing(SLIDE_A, SLIDE_B));
    await expect(splash).toContainText(en.splash.orderHere);
    await expect
      .poll(() =>
        splash
          .locator(`img[src="${SLIDE_B}"]`)
          .first()
          .evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))
      )
      .toBeGreaterThan(0);
    await tapToSecond(page);
  });

  test("NO VIDEO (D9): an audio-only slide drops out as no_video — a codec fact, so the retry leaves it out: 10 min later still WELCOME and never asked for again; the tap starts the order", async ({
    page,
  }) => {
    test.slow();
    await page.clock.install();
    await mockBootEndpoints(page);
    await mockMedia(
      page,
      homeScreen({ url: AUDIO_ONLY, media_type: "webm", iteration_time: "60" })
    );
    // Never cacheable: a retry could only be served from the wire.
    await page.route(AUDIO_ONLY, (route) =>
      route.fulfill({
        body: AUDIO_ONLY_WEBM,
        contentType: "video/webm",
        headers: { "Cache-Control": "no-store" },
      })
    );
    const loaded = page.waitForRequest(AUDIO_ONLY);
    await registerToStart(page);
    await loaded;

    // No picture: the only slide drops out → WELCOME (1:5617).
    const splash = splashOf(page);
    await expect(splash).toContainText(en.splash.welcome);
    await expect(splash.locator("video")).toHaveCount(0);

    // Past the retry interval (RETRY's steps): the slide is never re-requested.
    const retried = page
      .waitForRequest(AUDIO_ONLY, { timeout: 5_000 })
      .then(() => true, () => false);
    await page.clock.fastForward("09:00");
    await page.clock.fastForward("02:00");
    expect(await retried, "a no_video slide was asked for again").toBe(false);
    await expect(splash).toContainText(en.splash.welcome);
    await tapToSecond(page);
  });
});
