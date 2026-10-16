import { test, expect, PNG_1X1 as PNG, type CDPSession, type Page, type Request } from "./fixtures/kiosk";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { axeSweep, targetProblems } from "./fixtures/a11y";
import { locale, mockKioskBackend } from "./fixtures/backend";
import { registerToStart } from "./pages/boot";

/**
 * P9d — splash (attract) media, end to end: boot fetches `getMedia`, stores
 * only this deployment's `home_screen` list, and /start lays it out by
 * PLAYABLE slide count — 0 → WELCOME (Figma 1:5617), 1 → the 1:2203 centre
 * card alone (2026-10-13; was full-bleed 1:5604), ≥ 2 → the peek carousel
 * (1:2203). A slide that fails drops out,
 * so the layout degrades 2 → 1 → WELCOME and is never blank. A slide that
 * errored or stalled gets one more try 10 min after the last failure
 * (post-P9 44, D9: SPLASH_RETRY_MS); one with no picture (no_video) never.
 * Every layout shows ONE line (user decision 2026-10-16): the backend's
 * start_order_text_primary — the shared mock's START ORDER — else the i18n
 * ORDER HERE, in ORDER HERE's old place (bottom edge at y 1712).
 *
 * ── MOCKS ───────────────────────────────────────────────────────────────
 * House order: the shared backend mock (fixtures/backend.ts) FIRST, every
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

const readFixture = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)));

const en = locale("en");
/** The one line: the shared mock's start_order_text_primary (fixtures/backend.ts). */
const LINE = "START ORDER";
/** A two-line Title/H1 in ORDER HERE's place: its 756 px column (x 162–918), bottom edge at y 1712. */
const LINE_AT = { top: 1516, bottom: 1712, centre: 540 };
const WEBM = readFixture("./fixtures/splash.webm");
const AUDIO_ONLY_WEBM = readFixture("./fixtures/splash-audio-only.webm");

/** SDK kioskInfoApi `getKioskMedia`: POST /api/cx/kiosk/getMedia. */
const GET_MEDIA_URL = "**/api/cx/kiosk/getMedia";
const MEDIA_ORIGIN = "https://splash-media.e2e.test";
/** The WELCOME frame's own photo (1:5617): what tells it from the media layouts. */
const WELCOME_PHOTO = 'img[src*="fullbleed-halfmoon"]';
const SLIDE_A = `${MEDIA_ORIGIN}/slide-a.png`;
const SLIDE_B = `${MEDIA_ORIGIN}/slide-b.png`;
const VIDEO = `${MEDIA_ORIGIN}/promo.webm`;
const AUDIO_ONLY = `${MEDIA_ORIGIN}/audio-only.webm`;

/** The boot surface with this file's own pipeline row ({_id, name}); getMedia stays the catch-all's `{}`. */
const mockBootEndpoints = (page: Page) =>
  mockKioskBackend(page, { pipelines: [{ _id: "p1", name: "Dine In" }] });

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

/**
 * One slide = ONE media element filling the 1:2203 centre card alone
 * (x 200 · y 345 · 680 × 1043 on the stage; user decision 2026-10-13).
 */
async function expectSingleCard(page: Page, selector: string) {
  const media = splashOf(page).locator(selector);
  await expect(media).toHaveCount(1);
  await expect(media).toBeVisible();
  const stage = await splashOf(page).boundingBox();
  const box = await media.boundingBox();
  if (!stage || !box) throw new Error("no box for the single card");
  expect([box.x - stage.x, box.y - stage.y, box.width, box.height].map(Math.round)).toEqual([200, 345, 680, 1043]);
}

/**
 * The carousel's slide images keyed by their x on the stage. Figma 1:2203's
 * 680 × 1043 card box, in focus since 2026-10-16: the centre at 1.10 (748 px
 * wide from x 166), the peeks at 0.88 (598 px) one 751 px pitch out, still
 * showing 88 px — prev −510 · centre 166 · next 992. Image rects include the
 * scale; this suite runs under reduced motion, so they are static.
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

/** Where a line of copy sits on the stage: its top, its bottom and its horizontal centre. */
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
      bottom: Math.round(r.bottom - s.top),
      centre: Math.round(r.left + r.width / 2 - s.left),
    };
  }, copy);
}

/** The splash shows ONE text — `line`, nothing else — and its tap target is named by it. */
async function expectOneLine(page: Page, line: string) {
  await expect(splashOf(page)).toHaveText(line);
  await expect(
    page.getByRole("button", { name: new RegExp(`^${line}$`, "i") })
  ).toBeVisible();
}

/** Two slides: both peeks show the other one. */
const showing = (centre: string, peek: string) => ({
  "-510": peek,
  "166": centre,
  "992": peek,
});

/** The tap still starts the order, and the splash's media goes with it. */
async function tapToSecond(page: Page) {
  await splashOf(page).click();
  await expect(page.getByTestId("second-screen")).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
}

test.describe("P9d splash media", () => {
  test("NO MEDIA: a getMedia body without a media list stores nothing — WELCOME (1:5617) under the one line in ORDER HERE's place, which names it; no slide media; the tap starts the order", async ({
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
    // ONE text, the tap target's accessible name: no WELCOME, no TOUCH
    // ANYWHERE TO START, no ORDER HERE (2026-10-16).
    await expectOneLine(page, LINE);
    // ORDER HERE's place: START / ORDER on two lines, bottom edge at y 1712,
    // centred (polled: the line count waits for the web font).
    await expect.poll(() => copyAt(page, LINE)).toEqual(LINE_AT);
    const splash = splashOf(page);
    await expect(splash.locator(WELCOME_PHOTO)).toHaveCount(1);
    await expect(splash.locator(`img[src^="${MEDIA_ORIGIN}"]`)).toHaveCount(0);
    await expect(splash.locator("video")).toHaveCount(0);
    await tapToSecond(page);
  });

  test("ONE IMAGE: a single home_screen image sits alone in the centre card (1:2203; 2026-10-13) over the one line in ORDER HERE's place, and a relaunch shows both again from the device store without a new boot; the tap starts the order", async ({
    page,
  }) => {
    await mockBootEndpoints(page);
    const getMedia = await mockMedia(page, homeScreen(image(SLIDE_A)));
    await serveMediaHost(page);
    await registerToStart(page);

    await expectSingleCard(page, `img[src="${SLIDE_A}"]`);
    await expectLoaded(page, SLIDE_A);
    await expectOneLine(page, LINE);
    await expect.poll(() => copyAt(page, LINE)).toEqual(LINE_AT);

    // TB boots only at registration: a relaunch lands straight on /start, so
    // the slide must come back from the persisted appSettings.mediaData.
    await expect
      .poll(() => page.evaluate(() => Object.values(window.localStorage).join()))
      .toContain(SLIDE_A);
    await page.reload();
    await expectSingleCard(page, `img[src="${SLIDE_A}"]`);
    await expectLoaded(page, SLIDE_A);
    expect(getMedia).toHaveLength(1);
    // …and the line from the persisted appSettings.kiosk_settings.
    await expectOneLine(page, LINE);
    await tapToSecond(page);
  });

  test("CAROUSEL: two images rotate through the centre card (1:2203) over the one line in ORDER HERE's place, each on its own iteration_time, and wrap; the tap starts the order", async ({
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

    await expectOneLine(page, LINE);
    await expect.poll(() => copyAt(page, LINE)).toEqual(LINE_AT);
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

  test("BROKEN SLIDE: a slide that 404s drops out — two slides degrade to the survivor, alone in the centre card (never a blank card)", async ({
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
    await expectSingleCard(page, `img[src="${SLIDE_B}"]`);
    await expectLoaded(page, SLIDE_B);
    await expectOneLine(page, LINE);
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
    await expect(splash.locator(WELCOME_PHOTO)).toHaveCount(1);
    await expectOneLine(page, LINE);
    await expect(splash.locator(`img[src^="${MEDIA_ORIGIN}"]`)).toHaveCount(0);
    await tapToSecond(page);
  });

  test("SCOPE: an entry scoped to another store, or carrying a malformed (string) scope, never shows — only this store's slide plays, alone in the centre card", async ({
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

    await expectSingleCard(page, `img[src="${SLIDE_A}"]`);
    await expectLoaded(page, SLIDE_A);
    await expectOneLine(page, LINE);
    expect(requested).not.toContain(otherStore);
    expect(requested).not.toContain(malformed);
  });

  test("VIDEO: a WebM slide plays in the centre card and loops (the single-slide layout); leaving the splash tears it down", async ({
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
    await expectSingleCard(page, "video");
    await expectOneLine(page, LINE);
    await tapToSecond(page);
  });

  test("RETRY (D9): a slide whose host 404s sits out (the survivor alone in the centre card), and 10 min after the failure — host healed — it is fetched again and the carousel is back; the tap starts the order", async ({
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

    // B's host 404s: the carousel degrades to A alone in the centre card.
    const splash = splashOf(page);
    await expectOneLine(page, LINE);
    await expect(splash.locator(`img[src="${SLIDE_B}"]`)).toHaveCount(0);
    await expectSingleCard(page, `img[src="${SLIDE_A}"]`);
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
    await expectOneLine(page, LINE);
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
    await expect(splash.locator(WELCOME_PHOTO)).toHaveCount(1);
    await expectOneLine(page, LINE);
    await expect(splash.locator("video")).toHaveCount(0);

    // Past the retry interval (RETRY's steps): the slide is never re-requested.
    const retried = page
      .waitForRequest(AUDIO_ONLY, { timeout: 5_000 })
      .then(() => true, () => false);
    await page.clock.fastForward("09:00");
    await page.clock.fastForward("02:00");
    expect(await retried, "a no_video slide was asked for again").toBe(false);
    await expect(splash.locator(WELCOME_PHOTO)).toHaveCount(1);
    await expectOneLine(page, LINE);
    await tapToSecond(page);
  });

  test("THE ONE LINE (2026-10-16): an operator's start_order_text_primary shows trimmed, in ORDER HERE's place on a media layout", async ({
    page,
  }) => {
    await mockKioskBackend(page, {
      pipelines: [{ _id: "p1", name: "Dine In" }],
      settings: { start_order_text_primary: "  Tap to order  " },
    });
    await mockMedia(page, homeScreen(image(SLIDE_A)));
    await serveMediaHost(page);
    await registerToStart(page);

    await expectSingleCard(page, `img[src="${SLIDE_A}"]`);
    await expectOneLine(page, "Tap to order");
    await expect.poll(() => copyAt(page, "Tap to order")).toEqual(LINE_AT);
    await tapToSecond(page);
  });

  test("THE ONE LINE: a blank start_order_text_primary shows the i18n ORDER HERE fallback, in its own place", async ({
    page,
  }) => {
    await mockKioskBackend(page, {
      pipelines: [{ _id: "p1", name: "Dine In" }],
      settings: { start_order_text_primary: "" },
    });
    await registerToStart(page);

    await expect(splashOf(page).locator(WELCOME_PHOTO)).toHaveCount(1);
    await expectOneLine(page, en.splash.orderHere);
    // ORDER / HERE: exactly where ORDER HERE sat before 2026-10-16.
    await expect.poll(() => copyAt(page, en.splash.orderHere)).toEqual(LINE_AT);
    await tapToSecond(page);
  });

  test("THE ONE LINE: with Arabic as the secondary language the splash still shows only the primary — never start_order_text_secondary", async ({
    page,
  }) => {
    await mockKioskBackend(page, {
      pipelines: [{ _id: "p1", name: "Dine In" }],
      arabic: true,
    });
    await registerToStart(page);

    await expectOneLine(page, LINE);
    await expect(splashOf(page)).not.toContainText("ابدأ الطلب");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await tapToSecond(page);
  });
});

/**
 * THE SWIPE (user request 2026-10-16; design language, sign-off). The
 * carousel follows a finger past a 16 px slop and steps one card at 30 % of
 * a card or on a flick. A drag is never a tap — Chromium sends a touch no
 * click past its 15 DIP slop, and the carousel swallows a mouse's — while a
 * press that stays inside the slop is one: it starts the order. Real input:
 * CDP touches (hasTouch) one 60 Hz frame (16 ms) apart, and the mouse. This
 * file runs under reduced motion, so every step lands at once (the cards
 * follow by translate only); motion.spec M18 drives the real motion.
 */
test.describe("THE SWIPE (2026-10-16)", () => {
  test.use({ hasTouch: true });

  const SLIDE_C = `${MEDIA_ORIGIN}/slide-c.png`;
  const PEEKING = (prev: string, centre: string, next: string) => ({ "-510": prev, "166": centre, "992": next });

  /** Three images on long dwells: only a gesture moves them. */
  async function carouselOfThree(page: Page) {
    await mockBootEndpoints(page);
    await mockMedia(
      page,
      homeScreen(
        image(SLIDE_A, { iteration_time: "600" }),
        image(SLIDE_B, { iteration_time: "600" }),
        image(SLIDE_C, { iteration_time: "600" })
      )
    );
    await serveMediaHost(page);
    await registerToStart(page);
    await expect.poll(() => cards(page)).toEqual(PEEKING(SLIDE_C, SLIDE_A, SLIDE_B));
  }

  const finger = (x: number, y: number) => [{ x, y, radiusX: 1, radiusY: 1 }];
  /** One finger from (x, y) by (dx, dy) in `moves` moves a 60 Hz frame apart, then lifted. */
  async function swipe(cdp: CDPSession, x: number, y: number, dx: number, dy = 0, moves = 10) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: finger(x, y) });
    for (let i = 1; i <= moves; i += 1) {
      await sleep(16);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: finger(x + (dx * i) / moves, y + (dy * i) / moves),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  /** Still on the splash: no order started. */
  async function noOrder(page: Page) {
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.getByTestId("second-screen")).toHaveCount(0);
    await expect(splashOf(page)).toBeVisible();
  }

  test("TOUCH: a swipe left steps to the next slide and a swipe right back, wrapping — never an order; a still tap then starts it", async ({
    page,
  }) => {
    await carouselOfThree(page);
    const cdp = await page.context().newCDPSession(page);

    await swipe(cdp, 800, 900, -300);
    await expect.poll(() => cards(page)).toEqual(PEEKING(SLIDE_A, SLIDE_B, SLIDE_C));
    await noOrder(page);

    await swipe(cdp, 300, 900, 300);
    await expect.poll(() => cards(page)).toEqual(PEEKING(SLIDE_C, SLIDE_A, SLIDE_B));
    await swipe(cdp, 300, 900, 300);
    await expect.poll(() => cards(page)).toEqual(PEEKING(SLIDE_B, SLIDE_C, SLIDE_A));
    await noOrder(page);

    await page.touchscreen.tap(540, 960);
    await expect(page.getByTestId("second-screen")).toBeVisible();
  });

  test("TOUCH: a 14 px wobble is still a tap — it starts the order and moves no card", async ({ page }) => {
    await carouselOfThree(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: finger(540, 960) });
    for (const [x, y] of [[546, 963], [550, 970], [547, 966]]) {
      await sleep(16);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: finger(x, y) });
    }
    expect(await cards(page), "inside the slop nothing follows").toEqual(PEEKING(SLIDE_C, SLIDE_A, SLIDE_B));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByTestId("second-screen")).toBeVisible();
  });

  test("MOUSE: a drag steps the carousel and never orders (its click is swallowed); the next click does", async ({
    page,
  }) => {
    await carouselOfThree(page);
    await page.mouse.move(800, 900);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(800 - 30 * i, 900);
    await page.mouse.up();
    await expect.poll(() => cards(page)).toEqual(PEEKING(SLIDE_A, SLIDE_B, SLIDE_C));
    await noOrder(page);

    await page.mouse.click(540, 960);
    await expect(page.getByTestId("second-screen")).toBeVisible();
  });

  test("A11Y after a swipe: axe A/AA clean, every target a control of 44 px or more, the one button still named by the one line", async ({
    page,
  }) => {
    await carouselOfThree(page);
    const cdp = await page.context().newCDPSession(page);
    await swipe(cdp, 800, 900, -300);
    await expect.poll(() => cards(page)).toEqual(PEEKING(SLIDE_A, SLIDE_B, SLIDE_C));

    expect(await axeSweep(page, "splash-carousel-swiped")).toEqual([]);
    expect(await targetProblems(page)).toEqual([]);
    await expectOneLine(page, LINE);
    await expect(page.getByRole("button")).toHaveCount(1);
  });
});
