import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { setKioskSettings, setMediaData } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import SplashMedia, { SPLASH_RETRY_MS } from "../SplashMedia";
import { focusAt } from "../splashSwipe";
import i18n, { DEFAULT_LANGUAGE } from "../../../i18n";

/*
  P9d — the splash media layer. Layout by PLAYABLE slide count (0 → WELCOME
  1:5617, 1 → the 1:2203 centre card alone (2026-10-13), ≥2 → the 1:2203 peek carousel), the one
  line on every layout (2026-10-16), the image rotation, skipping a failed slide (load_error / stalled come back after
  SPLASH_RETRY_MS, post-P9 44; no_video stays out for the visit), the video lifecycle
  (watchdog, plays, teardown, hidden page, StrictMode) and the rate-limited
  failure report. jsdom decodes nothing: the media methods are stubbed and
  media events are fired by hand. The report limiter is MODULE state keyed by
  URL path|kind (P9e OV5), so every test gets URLs of its own (`u`).
*/

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

/** SPLASH_VIDEO_STALL_MS (not exported). */
const STALL_MS = 15_000;
const HOUR = 60 * 60 * 1000;

let run = 0;
/** A slide URL unique to this test. */
const u = (name: string) => `https://cdn.test/${run}/${name}`;

const seed = (home_screen: unknown[]) =>
  store.dispatch(setMediaData({ media: { home_screen } }));

const renderSplash = (options: { reactStrictMode?: boolean } = {}) =>
  render(
    <Provider store={store}>
      <div data-testid="splash">
        <SplashMedia />
      </div>
    </Provider>,
    options
  );

const host = () => screen.getByTestId("splash");
const text = () => host().textContent;
const srcOf = (el: Element | null | undefined) => el?.getAttribute("src") ?? null;

/** The 1:2203 movers by slot: all three sit on the Figma box, the slot is their transform (2026-10-16). */
const SLOT = { prev: -1, centre: 0, next: 1 } as const;
type Slot = keyof typeof SLOT;
const card = (slot: Slot) => host().querySelector<HTMLElement>(`.tb-splash-card[data-slot="${SLOT[slot]}"]`);
const media = (slot: Slot) => {
  const el = card(slot)?.querySelector("img, video");
  if (!el) throw new Error(`no media in the ${slot} card`);
  return el as HTMLImageElement | HTMLVideoElement;
};
/** prev / centre / next slide URLs (null = a card with no media element). */
const cards = () =>
  (["prev", "centre", "next"] as const).map((slot) => srcOf(card(slot)?.querySelector("img, video")));
/** The one slide of the single layout: the centre card alone (.tb-splash-single), no peeking cards (user 2026-10-13). */
const single = () =>
  card("prev") || card("next")
    ? null
    : ((host().querySelector(".tb-splash-single")?.querySelector("img, video") ?? null) as
        | HTMLImageElement
        | HTMLVideoElement
        | null);
const layout = () => {
  if (host().querySelector(".tb-splash-single")) return card("prev") || card("next") ? "broken" : "single";
  if (card("centre")) return card("prev") && card("next") ? "carousel" : "broken";
  if (host().querySelector('img[src*="fullbleed-halfmoon"]')) return "welcome";
  return "blank";
};

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const splashEvents = () =>
  mockCapture.mock.calls
    .filter(([, props]) => (props as { error_source?: string })?.error_source === "splash_media")
    .map(([name, props]) => ({ name, ...(props as object) }));
const failure = (failure_kind: string, slide_index: number) => ({
  name: "error_occurred",
  error_source: "splash_media",
  failure_kind,
  slide_index,
});

let play: MockInstance<HTMLMediaElement["play"]>;
let pause: MockInstance<HTMLMediaElement["pause"]>;
let load: MockInstance<HTMLMediaElement["load"]>;

beforeEach(() => {
  run += 1;
  store.dispatch({ type: "RESET_STATE" }); // before the fake clock: persistence schedules a write
  vi.useFakeTimers();
  mockCapture.mockReset();
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  cleanup(); // while the media stubs and the fake clock are still in place
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("layout by PLAYABLE slide count", () => {
  it("0 playable → WELCOME (1:5617): photo, six stars, bell and the one line — a fresh store: 'order here'", () => {
    seed([{ url: "   " }, { media_type: "mp4" }, null]);
    renderSplash();

    expect(layout()).toBe("welcome");
    expect(text()).toBe("order here");
    expect(host().querySelector('img[src*="fullbleed-halfmoon"]')).toBeInTheDocument();
    expect(host().querySelectorAll('img[src*="star-"]')).toHaveLength(6);
    expect(host().querySelector('img[class*="left-[490px]"]')).toBeInTheDocument();
    expect(host().querySelector("video")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("1 playable → the carousel's centre card alone (no peeks) + the one line ('order here')", () => {
    seed([{ url: "" }, { url: u("a.jpg") }]);
    renderSplash();

    expect(layout()).toBe("single");
    expect(cards()).toEqual([null, u("a.jpg"), null]);
    expect(text()).toBe("order here");
    expect(host().querySelector('img[class*="left-[490px]"]')).toBeInTheDocument();
  });

  it("≥2 playable → the carousel: prev / centre / next cards + the one line ('order here')", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();

    expect(layout()).toBe("carousel");
    expect(text()).toBe("order here");
    expect(cards()).toEqual([u("c.jpg"), u("a.jpg"), u("b.jpg")]);
  });

  it("the carousel's sheen is Figma's recipe (UB3): the alpha WebP at 50 %, normal blend, unrotated, never catching a tap", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderSplash();

    const sheens = host().querySelectorAll('img[src*="plastic-overlay"]');
    expect(sheens).toHaveLength(1);
    const sheen = sheens[0];
    expect(sheen.getAttribute("src")).toMatch(/plastic-overlay\.webp$/);
    expect(sheen).toHaveClass("pointer-events-none", "absolute", "inset-0", "h-full", "w-full", "object-cover", "opacity-50");
    expect(sheen.className).not.toMatch(/mix-blend-|rotate|opacity-40/);
  });

  it("WELCOME carries no sheen; the single card sits on the carousel's sheen", () => {
    seed([]);
    const welcome = renderSplash();
    expect(host().querySelector('img[src*="plastic-overlay"]')).toBeNull();
    welcome.unmount();

    seed([{ url: u("a.jpg") }]);
    renderSplash();
    expect(layout()).toBe("single");
    expect(host().querySelectorAll('img[src*="plastic-overlay"]')).toHaveLength(1);
  });
});

describe("image rotation", () => {
  it("a single image never advances — no rotation timer at all, even after 60 s", () => {
    seed([{ url: u("a.jpg"), iteration_time: 5 }]);
    renderSplash();
    const img = single();

    expect(vi.getTimerCount()).toBe(0);
    tick(60_000);
    expect(single()).toBe(img);
    expect(srcOf(img)).toBe(u("a.jpg"));
  });

  it("two images at iteration_time 5 advance at exactly 5000 ms and wrap back", () => {
    seed([
      { url: u("a.jpg"), iteration_time: 5 },
      { url: u("b.jpg"), iteration_time: "5" },
    ]);
    renderSplash();
    expect(cards()).toEqual([u("b.jpg"), u("a.jpg"), u("b.jpg")]);

    tick(4_999);
    expect(cards()[1]).toBe(u("a.jpg"));
    tick(1);
    expect(cards()).toEqual([u("a.jpg"), u("b.jpg"), u("a.jpg")]);
    tick(5_000);
    expect(cards()).toEqual([u("b.jpg"), u("a.jpg"), u("b.jpg")]);
  });

  it("three images keep prev / centre / next order; iteration_time missing or < 3 dwells 8 s; only the centre times it", () => {
    seed([
      { url: u("a.jpg") },
      { url: u("b.jpg"), iteration_time: "1" },
      { url: u("c.jpg"), iteration_time: 2.5 },
    ]);
    renderSplash();
    expect(cards()).toEqual([u("c.jpg"), u("a.jpg"), u("b.jpg")]);
    expect(vi.getTimerCount()).toBe(1);

    tick(7_999);
    expect(cards()[1]).toBe(u("a.jpg"));
    tick(1);
    expect(cards()).toEqual([u("a.jpg"), u("b.jpg"), u("c.jpg")]);
    tick(7_999);
    expect(cards()[1]).toBe(u("b.jpg"));
    tick(1);
    expect(cards()).toEqual([u("b.jpg"), u("c.jpg"), u("a.jpg")]);
    tick(8_000);
    expect(cards()).toEqual([u("c.jpg"), u("a.jpg"), u("b.jpg")]);
  });
});

describe("a failed slide is skipped (until the in-visit retry) — never blank, never stuck", () => {
  it("a centre image error skips it at once and reports load_error with its slide_index", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();

    fireEvent.error(media("centre"));

    expect(cards()[1]).toBe(u("b.jpg"));
    expect(splashEvents()).toEqual([failure("load_error", 0)]);
  });

  it("degrades carousel(3) → carousel(2) → the single card → WELCOME as each centre fails", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();

    fireEvent.error(media("centre")); // a
    expect(layout()).toBe("carousel");
    expect(cards()).toEqual([u("c.jpg"), u("b.jpg"), u("c.jpg")]);

    fireEvent.error(media("centre")); // b
    expect(layout()).toBe("single");
    expect(srcOf(single())).toBe(u("c.jpg"));
    expect(text()).toBe("order here");

    fireEvent.error(single() as HTMLImageElement); // c — everything failed
    expect(layout()).toBe("welcome");
    expect(text()).toBe("order here");
    expect(splashEvents()).toEqual([
      failure("load_error", 0),
      failure("load_error", 1),
      failure("load_error", 2),
    ]);
    expect(vi.getTimerCount()).toBe(1); // only the in-visit retry (SPLASH_RETRY_MS)
  });

  it("a failed PEEK drops out without moving the centre or restarting its dwell", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();
    tick(8_000); // centre b since 8 s, peeks a / c
    tick(3_000);

    fireEvent.error(media("next")); // c

    expect(cards()).toEqual([u("a.jpg"), u("b.jpg"), u("a.jpg")]);
    expect(splashEvents()).toEqual([failure("load_error", 2)]);
    tick(4_999); // b's dwell still counts from 8 s
    expect(cards()[1]).toBe(u("b.jpg"));
    tick(1);
    expect(cards()).toEqual([u("b.jpg"), u("a.jpg"), u("b.jpg")]); // c skipped
  });
});

describe("video slides", () => {
  it("the centre video gets its src on mount, plays via safeVideoPlay, replays per 'ended' × plays, then advances and is released", () => {
    seed([{ url: u("v.mp4"), media_type: "mp4", iteration_time: 2 }, { url: u("b.jpg") }]);
    renderSplash();
    const v = media("centre") as HTMLVideoElement;

    expect(v.tagName).toBe("VIDEO");
    expect(v.getAttribute("src")).toBe(u("v.mp4"));
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(false);
    expect(play.mock.contexts).toEqual([v]);

    fireEvent.ended(v); // play 1 of 2 → the same element replays
    expect(play.mock.contexts).toEqual([v, v]);
    expect(media("centre")).toBe(v);
    expect(pause).not.toHaveBeenCalled();

    fireEvent.ended(v); // play 2 of 2 → next slide
    expect(cards()).toEqual([null, u("b.jpg"), null]); // the video now peeks: no element
    expect(host().querySelector("video")).toBeNull();
    // Released, not left to GC: paused, src stripped, load() frees the decoder.
    expect(pause.mock.contexts).toEqual([v]);
    expect(v.hasAttribute("src")).toBe(false);
    expect(load.mock.contexts).toEqual([v]);
  });

  it("a blocked autoplay goes through safeVideoPlay — reported, never an unhandled rejection", async () => {
    play.mockRejectedValue(new DOMException("play() failed", "NotAllowedError"));
    seed([{ url: u("v.mp4") }]);
    renderSplash();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCapture).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        error_source: "video_playback",
        failure_kind: "failed",
        video_source: "splash_video",
      })
    );
  });

  it("a single video loops (never 'ended') and never advances while it plays", () => {
    seed([{ url: u("v.mp4"), media_type: "mp4", iteration_time: 3 }]);
    renderSplash();
    const v = single() as HTMLVideoElement;

    expect(v.tagName).toBe("VIDEO");
    expect(v).toHaveAttribute("loop");
    for (let i = 0; i < 6; i += 1) {
      tick(10_000);
      fireEvent.timeUpdate(v);
    }
    expect(single()).toBe(v);
    expect(v.getAttribute("src")).toBe(u("v.mp4"));
    expect(play).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    expect(splashEvents()).toEqual([]);
  });

  it("a video 'error' skips it at once (load_error)", () => {
    seed([{ url: u("v.mov"), media_type: " MOV " }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();

    fireEvent.error(media("centre"));

    expect(cards()[1]).toBe(u("b.jpg"));
    expect(splashEvents()).toEqual([failure("load_error", 0)]);
  });

  it("15 s without 'playing'/'timeupdate' = stalled → skipped; every progress event re-arms the watchdog", () => {
    seed([{ url: u("v.webm") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();
    const v = media("centre");

    tick(STALL_MS - 1_000);
    fireEvent.timeUpdate(v);
    tick(STALL_MS - 1_000);
    fireEvent.playing(v);
    tick(STALL_MS - 1);
    expect(media("centre")).toBe(v);
    expect(splashEvents()).toEqual([]);

    tick(1);
    expect(cards()[1]).toBe(u("b.jpg"));
    expect(v.hasAttribute("src")).toBe(false);
    expect(splashEvents()).toEqual([failure("stalled", 0)]);
  });

  it("an audio-only video (loadedmetadata with videoWidth 0) fails at once as no_video; one with a picture plays on", () => {
    seed([{ url: u("ok.mp4") }, { url: u("hevc.mp4") }, { url: u("c.jpg") }]);
    renderSplash();
    const ok = media("centre");
    Object.defineProperty(ok, "videoWidth", { configurable: true, value: 1080 });

    fireEvent.loadedMetadata(ok);
    expect(media("centre")).toBe(ok);
    fireEvent.ended(ok);

    fireEvent.loadedMetadata(media("centre")); // jsdom: videoWidth 0
    expect(cards()[1]).toBe(u("c.jpg"));
    expect(splashEvents()).toEqual([failure("no_video", 1)]);
  });

  it("a peeking video renders no element — never more than one <video> and three media elements", () => {
    seed([
      { url: u("v1.mp4") },
      { url: u("a.jpg") },
      { url: u("v2.mp4") },
      { url: u("b.jpg") },
      { url: u("v3.mp4") },
    ]);
    renderSplash();
    const census = () => ({
      videos: host().querySelectorAll("video").length,
      media: host().querySelectorAll('img[src^="https://cdn.test/"], video').length,
    });

    expect(cards()).toEqual([null, u("v1.mp4"), u("a.jpg")]); // prev v3 = card colour
    expect(card("prev")?.querySelector("img, video")).toBeNull(); // the mover holds the card box and its veil
    expect(census()).toEqual({ videos: 1, media: 2 });

    fireEvent.ended(media("centre")); // → a, between two videos
    expect(cards()).toEqual([null, u("a.jpg"), null]);
    expect(census()).toEqual({ videos: 0, media: 1 });

    tick(8_000); // → v2, between two images
    expect(cards()).toEqual([u("a.jpg"), u("v2.mp4"), u("b.jpg")]);
    expect(census()).toEqual({ videos: 1, media: 3 });

    fireEvent.ended(media("centre")); // → b
    tick(8_000); // → v3
    fireEvent.ended(media("centre")); // → v1 (wraps)
    expect(cards()).toEqual([null, u("v1.mp4"), u("a.jpg")]);
    expect(census()).toEqual({ videos: 1, media: 2 });
  });
});

describe("a hidden page pauses video — the watchdog waits", () => {
  let hidden = false;
  const setHidden = (value: boolean) => {
    hidden = value;
    fireEvent(document, new Event("visibilitychange"));
  };

  beforeEach(() => {
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  });

  it("while hidden the watchdog never fails the slide, however long", () => {
    seed([{ url: u("v.mp4") }, { url: u("b.jpg") }]);
    renderSplash();
    const v = media("centre");

    tick(5_000);
    setHidden(true);
    tick(10 * 60_000); // ten minutes asleep

    expect(media("centre")).toBe(v);
    expect(v.getAttribute("src")).toBe(u("v.mp4"));
    expect(splashEvents()).toEqual([]);
  });

  it("becoming visible starts a FRESH 15 s window — the overdue check never fires early", () => {
    hidden = true;
    seed([{ url: u("v.mp4") }, { url: u("b.jpg") }]);
    renderSplash();
    const v = media("centre");

    tick(20_000); // the 15 s check found the page hidden and re-armed (next at 30 s)
    setHidden(false); // at 20 s → due at 35 s
    tick(10_001); // 30.001 s
    expect(media("centre")).toBe(v);
    tick(STALL_MS - 10_001 - 1); // 34.999 s
    expect(media("centre")).toBe(v);
    expect(splashEvents()).toEqual([]);

    tick(1); // 35 s
    expect(layout()).toBe("single");
    expect(splashEvents()).toEqual([failure("stalled", 0)]);
  });
});

describe("failure reporting — one event per URL path|kind per hour", () => {
  it("the same broken asset on the next visits is silent until the hour is up, then reports again", () => {
    seed([{ url: u("broken.jpg") }]);
    const visit = () => {
      const view = renderSplash();
      fireEvent.error(single() as HTMLImageElement);
      expect(layout()).toBe("welcome");
      view.unmount();
    };

    visit();
    visit(); // the next guest: same path|kind
    expect(splashEvents()).toEqual([failure("load_error", 0)]);

    tick(HOUR - 1);
    visit();
    expect(splashEvents()).toHaveLength(1);

    tick(1);
    visit();
    expect(splashEvents()).toEqual([failure("load_error", 0), failure("load_error", 0)]);
  });

  it("the key is path AND kind: the same asset failing another way still reports", () => {
    seed([{ url: u("v.mp4") }]);
    const visit = (breakIt: (video: HTMLVideoElement) => void) => {
      const view = renderSplash();
      breakIt(single() as HTMLVideoElement);
      expect(layout()).toBe("welcome");
      view.unmount();
    };

    visit((video) => fireEvent.error(video));
    visit(() => tick(STALL_MS));
    visit((video) => fireEvent.error(video));

    expect(splashEvents()).toEqual([failure("load_error", 0), failure("stalled", 0)]);
  });

  it("the key is the URL PATH (OV5): a re-signed URL — new query or hash after a refresh — is the same asset, one report per hour", () => {
    const visit = (url: string) => {
      seed([{ url }]);
      const view = renderSplash();
      fireEvent.error(single() as HTMLImageElement);
      expect(layout()).toBe("welcome");
      view.unmount();
    };

    visit(`${u("a.jpg")}?X-Amz-Signature=one&X-Amz-Expires=3600`);
    visit(`${u("a.jpg")}?X-Amz-Signature=two`);
    visit(`${u("a.jpg")}#t=1`);
    visit(u("a.jpg"));
    expect(splashEvents()).toEqual([failure("load_error", 0)]);

    visit(`${u("b.jpg")}?X-Amz-Signature=one`); // another PATH is another asset
    expect(splashEvents()).toHaveLength(2);

    tick(HOUR);
    visit(`${u("a.jpg")}?X-Amz-Signature=three`);
    expect(splashEvents()).toHaveLength(3);
  });

  it("with two slides the broken peek is shown twice and errors twice — reported ONCE", () => {
    seed([{ url: u("a.jpg") }, { url: u("broken.jpg") }]);
    renderSplash();
    const [left, right] = [media("prev"), media("next")];
    expect([srcOf(left), srcOf(right)]).toEqual([u("broken.jpg"), u("broken.jpg")]);

    act(() => {
      // Both requests fail before React re-renders.
      fireEvent.error(left);
      fireEvent.error(right);
    });

    expect(splashEvents()).toEqual([failure("load_error", 1)]);
    expect(layout()).toBe("single");
    expect(srcOf(single())).toBe(u("a.jpg"));
  });
});

// Post-P9 44 (D9): load_error / stalled slides get one more try SPLASH_RETRY_MS
// after the LAST failure, within the same visit; no_video never comes back.
describe("in-visit retry (post-P9 44, contract §7(7) a–f)", () => {
  const MIN = 60_000;
  const HOLD = 3_600; // max image dwell (s): no rotation inside the windows below

  it("the ops knob is 10 minutes", () => {
    expect(SPLASH_RETRY_MS).toBe(10 * MIN);
  });

  it("(a) a centre image error, then +SPLASH_RETRY_MS, restores the carousel and re-requests the src", () => {
    seed([
      { url: u("a.jpg"), iteration_time: HOLD },
      { url: u("b.jpg"), iteration_time: HOLD },
      { url: u("c.jpg"), iteration_time: HOLD },
    ]);
    renderSplash();
    const broken = media("centre");

    fireEvent.error(broken);
    expect(cards()).toEqual([u("c.jpg"), u("b.jpg"), u("c.jpg")]);
    expect(broken.isConnected).toBe(false);

    tick(SPLASH_RETRY_MS - 1);
    expect(cards()).toEqual([u("c.jpg"), u("b.jpg"), u("c.jpg")]);

    tick(1);
    expect(layout()).toBe("carousel");
    expect(cards()).toEqual([u("a.jpg"), u("b.jpg"), u("c.jpg")]);
    // A NEW element carries the src again — the browser requests it afresh.
    expect(media("prev")).not.toBe(broken);
    expect(srcOf(media("prev"))).toBe(u("a.jpg"));
  });

  it("(b) no_video is never retried and arms no timer", () => {
    seed([{ url: u("v.mp4") }]);
    renderSplash();

    fireEvent.loadedMetadata(single() as HTMLVideoElement); // jsdom: videoWidth 0
    expect(layout()).toBe("welcome");
    expect(splashEvents()).toEqual([failure("no_video", 0)]);
    expect(vi.getTimerCount()).toBe(0);

    tick(5 * SPLASH_RETRY_MS);
    expect(layout()).toBe("welcome");
    expect(host().querySelector("video")).toBeNull();
  });

  it("(c) H1: slide 0 stalled then slide 1 no_video → WELCOME; at +10 min slide 0 shows as the single card, never slide 1", () => {
    seed([{ url: u("v0.mp4") }, { url: u("v1.mp4") }]);
    renderSplash();
    expect(srcOf(media("centre"))).toBe(u("v0.mp4"));

    tick(STALL_MS); // slide 0 stalls → the rotation moves to slide 1
    expect(srcOf(single())).toBe(u("v1.mp4"));
    fireEvent.loadedMetadata(single() as HTMLVideoElement); // slide 1: no_video
    expect(layout()).toBe("welcome");
    expect(splashEvents()).toEqual([failure("stalled", 0), failure("no_video", 1)]);
    expect(vi.getTimerCount()).toBe(1);

    tick(SPLASH_RETRY_MS);
    // `cur` sat on slide 1 (every slide failed); the retry keeps its no_video
    // and must move off it — rendering it again would stick on a dead card.
    expect(layout()).toBe("single");
    expect(srcOf(single())).toBe(u("v0.mp4"));
    expect(host().querySelector(`video[src="${u("v1.mp4")}"]`)).toBeNull();

    for (let i = 0; i < 6; i += 1) {
      tick(STALL_MS - 1_000);
      fireEvent.timeUpdate(single() as HTMLVideoElement); // slide 0 plays on
    }
    expect(srcOf(single())).toBe(u("v0.mp4"));
    expect(host().querySelectorAll("video")).toHaveLength(1);
  });

  it("(d) a second failure at +9 min postpones the retry to +19 min", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderSplash();

    fireEvent.error(media("centre")); // a fails at 0 → b alone on the single card (no dwell)
    expect(srcOf(single())).toBe(u("b.jpg"));
    tick(9 * MIN);
    fireEvent.error(single() as HTMLImageElement); // b fails at +9 min
    expect(layout()).toBe("welcome");

    tick(MIN); // +10 min: the first failure's retry no longer applies
    expect(layout()).toBe("welcome");
    tick(9 * MIN - 1);
    expect(layout()).toBe("welcome");
    expect(vi.getTimerCount()).toBe(1);

    tick(1); // +19 min = 10 min after the LAST failure
    expect(layout()).toBe("carousel");
    expect(cards()).toEqual([u("a.jpg"), u("b.jpg"), u("a.jpg")]); // cur stayed on b
  });

  it("(e) unmount clears the retry timer (StrictMode's replay arms exactly one)", () => {
    seed([{ url: u("a.jpg") }]);
    const view = renderSplash({ reactStrictMode: true });

    fireEvent.error(single() as HTMLImageElement);
    expect(layout()).toBe("welcome");
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("(f) a re-failure inside the hour emits no second event — and the retry is re-armed", () => {
    seed([{ url: u("x.jpg") }]);
    renderSplash();

    fireEvent.error(single() as HTMLImageElement);
    expect(splashEvents()).toEqual([failure("load_error", 0)]);

    tick(SPLASH_RETRY_MS);
    expect(layout()).toBe("single");
    fireEvent.error(single() as HTMLImageElement); // still broken, 10 min later

    expect(layout()).toBe("welcome");
    expect(splashEvents()).toEqual([failure("load_error", 0)]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("advancing slides never postpones a pending retry (only a NEW failure does)", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();

    fireEvent.error(media("next")); // b (a peek) fails at 0; a / c rotate every 8 s
    expect(cards().includes(u("b.jpg"))).toBe(false);

    tick(SPLASH_RETRY_MS);
    expect(cards()).toContain(u("b.jpg"));
  });
});

describe("lifecycle", () => {
  it("StrictMode's simulated unmount strips the src — the re-run restores it and plays again", () => {
    seed([{ url: u("v.mp4") }]);
    renderSplash({ reactStrictMode: true });
    const v = single() as HTMLVideoElement;

    expect(load.mock.contexts).toEqual([v]); // the simulated unmount released it…
    expect(v.getAttribute("src")).toBe(u("v.mp4")); // …the re-run put it back
    expect(play.mock.contexts).toEqual([v, v]);
    expect(vi.getTimerCount()).toBe(1); // one watchdog: the first run's was cleared

    tick(STALL_MS - 1_000);
    fireEvent.timeUpdate(v);
    tick(STALL_MS - 1_000);
    expect(single()).toBe(v);
    expect(splashEvents()).toEqual([]);
  });

  // H3: the layer re-renders on unrelated ticks (redux, the language reset on
  // arrival); unstable callbacks would re-run the video effect = a restart.
  it.each([
    ["single", ["v.mp4"]],
    ["carousel", ["v.mp4", "a.jpg", "b.jpg"]],
  ])("%s: the slides are a per-visit snapshot — a media refresh mid-visit changes nothing and never restarts the video", (_layout, names) => {
    seed(names.map((name) => ({ url: u(name) })));
    renderSplash();
    const v = host().querySelector("video");
    const before = host().innerHTML;

    act(() => {
      seed([{ url: u("refreshed.jpg") }]);
    });

    expect(host().innerHTML).toBe(before);
    expect(host().querySelector("video")).toBe(v);
    expect(play.mock.contexts).toEqual([v]);
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("unmount clears every timer, stops listening for visibility, and releases the video", () => {
    seed([{ url: u("v.mp4") }, { url: u("b.jpg") }]);
    const view = renderSplash();
    const v = media("centre");
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(pause.mock.contexts).toEqual([v]);
    expect(v.hasAttribute("src")).toBe(false);
    expect(load.mock.contexts).toEqual([v]);
    fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmount mid-dwell clears the image rotation timer", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    const view = renderSplash();
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

/*
  Lane motion §3.6, the carousel since 2026-10-16. The idle return lands on a
  STILL splash: the track carries no data-dir, so no card enters and nothing
  fades at mount. An advance RE-SLOTS the movers (keyed by position): the old
  next's node becomes the centre — its image never re-mounts, so never
  re-decodes —, the old centre the prev, the old prev leaves at once, and
  only the entrant mounts, from the side the step comes from (data-dir;
  index.css @starting-style, e2e motion M3). A skipped (failed) slide is not
  a step: its content swaps inside the same movers, still (dir 0, a 0 s
  settle). Nothing pulses: tb-attract went with the START ORDER CTA
  (2026-10-16) — e2e motion M8 pins /start to no infinite animation (jsdom
  runs none).
*/
describe("motion (lane motion §3.6; the carousel, 2026-10-16)", () => {
  const track = () => host().querySelector<HTMLElement>(".tb-splash-track");

  it("the first frame is still (no data-dir); an advance re-slots the movers — the old next's NODE is the centre, its image kept — and only the entrant mounts, from the right", () => {
    seed([
      { url: u("a.jpg"), iteration_time: 5 },
      { url: u("b.jpg"), iteration_time: 5 },
      { url: u("c.jpg"), iteration_time: 5 },
    ]);
    renderSplash();
    expect(track()).not.toHaveAttribute("data-dir");
    expect(track()?.style.getPropertyValue("--tb-settle")).toBe("");
    const [prev, centre, next] = [card("prev"), card("centre"), card("next")];
    const nextImage = media("next");

    tick(5_000);
    expect(cards()).toEqual([u("a.jpg"), u("b.jpg"), u("c.jpg")]);
    expect(track()).toHaveAttribute("data-dir", "1");
    // The auto-advance: the default settle (--tb-dur-carousel), nothing inline.
    expect(track()?.style.getPropertyValue("--tb-settle")).toBe("");
    expect(card("centre")).toBe(next);
    expect(media("centre")).toBe(nextImage);
    expect(card("prev")).toBe(centre);
    expect(prev?.isConnected).toBe(false);
    expect([prev, centre, next]).not.toContain(card("next"));
    expect(host().querySelectorAll(".tb-splash-card")).toHaveLength(3);
    expect(host().querySelector(".tb-carousel-in, .tb-fade-in")).toBeNull();
  });

  it("a skipped (failed) centre is not a step: the content swaps inside the same movers, in place (dir 0, a 0 s settle)", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();
    tick(8_000); // an advance first: data-dir="1"
    expect(track()).toHaveAttribute("data-dir", "1");
    const movers = [card("prev"), card("centre"), card("next")];

    fireEvent.error(media("centre")); // b
    expect(cards()).toEqual([u("a.jpg"), u("c.jpg"), u("a.jpg")]);
    expect([card("prev"), card("centre"), card("next")]).toEqual(movers);
    expect(track()).not.toHaveAttribute("data-dir");
    expect(track()?.style.getPropertyValue("--tb-settle")).toBe("0s");
  });

  it("the peeks dim under a veil of their own, beside the card box; the single card has none and is the plain Figma card", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    const view = renderSplash();
    for (const slot of ["prev", "centre", "next"] as const) {
      const [box, veil] = Array.from(card(slot)?.children ?? []);
      expect(box).toHaveClass("overflow-hidden", "rounded-[16px]", "bg-tb-purple-vibrant");
      expect(veil).toHaveClass("tb-splash-veil", "pointer-events-none", "absolute", "inset-0", "rounded-[16px]", "bg-black");
      expect(veil).toHaveAttribute("aria-hidden", "true");
    }
    expect(track()).toHaveClass("tb-splash-track", "tb-splash-carousel");
    view.unmount();

    seed([{ url: u("a.jpg") }]);
    renderSplash();
    expect(card("centre")).toHaveClass("tb-splash-card", "tb-splash-single");
    expect(card("centre")?.querySelector(".tb-splash-veil")).toBeNull();
    expect(track()).not.toHaveClass("tb-splash-carousel");
  });
});

/*
  The swipe (user request 2026-10-16; design language). The carousel follows
  a finger 1:1 past a 16 px slop (stage px; jsdom's stage is 1:1), steps at
  30 % of a card or on a 0.30 px/ms flick, and snaps back otherwise; one
  commit at the release, nothing per move but inline styles on the movers.
  A drag is never a tap; a press inside the slop is. The rotation waits under
  a finger. jsdom has no style engine: the catch reads an empty transform
  (x 0, scale 1) unless getComputedStyle is stubbed.
*/
describe("swipe", () => {
  const start = vi.fn();
  const renderButton = () =>
    render(
      <Provider store={store}>
        <button type="button" data-testid="splash" onClick={start}>
          <SplashMedia />
        </button>
      </Provider>
    );
  /** The gesture layer: the media layout's root inside the button. */
  const surface = () => host().firstElementChild as HTMLElement;
  const track = () => host().querySelector<HTMLElement>(".tb-splash-track");
  const veil = (slot: Slot) => card(slot)?.querySelector<HTMLElement>(".tb-splash-veil");
  const pointer = (x: number, y = 900, { id = 1, primary = true, type = "touch" } = {}) => ({
    pointerId: id,
    isPrimary: primary,
    pointerType: type,
    button: 0,
    clientX: x,
    clientY: y,
  });
  type Lift = "pointerUp" | "pointerCancel" | "lostPointerCapture" | null;
  /**
   * The first finger from x 700: two moves `every` ms apart to dx (dy), then
   * — `rest` ms later — lifted where it is. A rest past 100 ms reads 0 px/ms
   * (no flick).
   */
  function drag(dx: number, { dy = 0, every = 60, rest = 120, lift = "pointerUp" as Lift, type = "touch", id = 1 } = {}) {
    fireEvent.pointerDown(surface(), pointer(700, 900, { type, id }));
    tick(every);
    fireEvent.pointerMove(surface(), pointer(700 + dx / 2, 900 + dy / 2, { type, id }));
    tick(every);
    fireEvent.pointerMove(surface(), pointer(700 + dx, 900 + dy, { type, id }));
    if (!lift) return;
    tick(rest);
    fireEvent[lift](surface(), pointer(700 + dx, 900 + dy, { type, id }));
  }
  const settle = () => track()?.style.getPropertyValue("--tb-settle");
  const enter = () => track()?.style.getPropertyValue("--tb-enter");

  beforeEach(() => start.mockReset());

  it("left steps to the next, right to the previous, wrapping — the entrant from the side it steps from, in formation with the release; a slow release settles in 500 ms", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderButton();
    expect(cards()).toEqual([u("c.jpg"), u("a.jpg"), u("b.jpg")]);

    drag(-300);
    expect(cards()).toEqual([u("a.jpg"), u("b.jpg"), u("c.jpg")]);
    expect(track()).toHaveAttribute("data-dir", "1");
    expect(settle()).toBe("500ms"); // a still finger: 4·d/v clamps at 500
    expect(enter()).toBe("1218px"); // released at o −284: one pitch beyond the new peek (2 × 751 − 284)

    drag(300);
    expect(cards()).toEqual([u("c.jpg"), u("a.jpg"), u("b.jpg")]);
    expect(track()).toHaveAttribute("data-dir", "-1");
    expect(enter()).toBe("-1218px");
    drag(300);
    expect(cards()).toEqual([u("b.jpg"), u("c.jpg"), u("a.jpg")]);
    expect(start).not.toHaveBeenCalled();

    tick(8_000); // the auto-advance: its entrant from two pitches out (the CSS fallback)
    expect(cards()).toEqual([u("c.jpg"), u("a.jpg"), u("b.jpg")]);
    expect([settle(), enter()]).toEqual(["", ""]);
  });

  it("a flick steps at once and settles at about the finger's speed (4·d/v, 250–500 ms); a fling back cancels", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderButton();

    // −400 px in 100 ms (4 px/ms): p = 384 / 751, so 367 px to go → 4 · 367 / 4.
    drag(-400, { every: 50, rest: 0 });
    expect(cards()[1]).toBe(u("b.jpg"));
    expect(settle()).toBe("367ms");

    // A short quick flick: 60 px in 40 ms — under the 30 % distance, still a step.
    drag(-60, { every: 20, rest: 0 });
    expect(cards()[1]).toBe(u("c.jpg"));

    // Out to the left past 30 %, then flung back right: back to the slots.
    fireEvent.pointerDown(surface(), pointer(700));
    tick(200);
    fireEvent.pointerMove(surface(), pointer(300));
    tick(200);
    fireEvent.pointerMove(surface(), pointer(320));
    tick(20);
    fireEvent.pointerMove(surface(), pointer(380));
    fireEvent.pointerUp(surface(), pointer(380));
    expect(cards()[1]).toBe(u("c.jpg"));
    expect(settle()).toBe("var(--tb-dur-snap)");
  });

  it("the cards follow the finger inline (transition none) past the slop — focus by position — and are handed back to their slots' CSS at the release", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();

    drag(-200, { lift: null });
    const o = -200 + 16; // re-based at the slop: no catch-up jump
    for (const [slot, n] of [["prev", -1], ["centre", 0], ["next", 1]] as const) {
      const focus = focusAt(n, o);
      expect(card(slot)?.style.transform, slot).toBe(`translateX(${n * 751 + o}px) scale(${focus.scale})`);
      expect(card(slot)?.style.transition, slot).toBe("none");
      expect(veil(slot)?.style.opacity, slot).toBe(String(focus.veil));
      expect(veil(slot)?.style.transition, slot).toBe("none");
    }
    expect(track()).toHaveAttribute("data-held");

    fireEvent.pointerUp(surface(), pointer(500));
    for (const slot of ["prev", "centre", "next"] as const) {
      expect([card(slot)?.style.transform, card(slot)?.style.transition], slot).toEqual(["", ""]);
      expect([veil(slot)?.style.opacity, veil(slot)?.style.transition], slot).toEqual(["", ""]);
    }
    expect(track()).not.toHaveAttribute("data-held");
  });

  it("a press that stays inside the 16 px slop is a tap: nothing moves or steps, and its click starts the order", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-12, { dy: 9 }); // 15 px

    expect(cards()[1]).toBe(u("a.jpg"));
    expect(card("centre")?.style.transform).toBe("");
    fireEvent.click(surface());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("a short slow drag (under 30 %) changes no slide — back to the slots in --tb-dur-snap — and is not a tap", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-150, { type: "mouse" });

    expect(cards()[1]).toBe(u("a.jpg"));
    expect(track()).not.toHaveAttribute("data-dir");
    expect(settle()).toBe("var(--tb-dur-snap)");
    fireEvent.click(surface());
    expect(start).not.toHaveBeenCalled();
  });

  it("a mouse drag's click never reaches the start button; the next press's does", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-300, { type: "mouse" });
    expect(cards()[1]).toBe(u("b.jpg"));
    fireEvent.click(surface());
    expect(start).not.toHaveBeenCalled();

    fireEvent.pointerDown(surface(), pointer(540, 900, { type: "mouse" }));
    fireEvent.pointerUp(surface(), pointer(540, 900, { type: "mouse" }));
    fireEvent.click(surface());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("a vertical drag is not a swipe — nothing follows or steps — and not a tap either", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-20, { dy: 300, lift: null });
    expect(card("centre")?.style.transform).toBe("translateX(0px) scale(1)"); // the catch's (jsdom: x 0, scale 1)
    fireEvent.pointerUp(surface(), pointer(680, 1200));

    expect(cards()[1]).toBe(u("a.jpg"));
    expect(card("centre")?.style.transform).toBe("");
    fireEvent.click(surface());
    expect(start).not.toHaveBeenCalled();
  });

  it("the dwell waits while a finger is down and re-arms in FULL at the release", () => {
    seed([
      { url: u("a.jpg"), iteration_time: 5 },
      { url: u("b.jpg"), iteration_time: 5 },
    ]);
    renderButton();
    tick(4_000);
    drag(-40, { lift: null });
    tick(10_000);
    expect(cards()[1]).toBe(u("a.jpg"));

    fireEvent.pointerUp(surface(), pointer(660));
    tick(4_999);
    expect(cards()[1]).toBe(u("a.jpg"));
    tick(1);
    expect(cards()[1]).toBe(u("b.jpg"));
  });

  it("a video that ends under the finger advances at the release — never read as a stall, however long the hold", () => {
    seed([{ url: u("v.mp4"), media_type: "mp4", iteration_time: 1 }, { url: u("b.jpg") }]);
    renderButton();
    drag(-40, { lift: null });
    fireEvent.ended(media("centre"));
    tick(20_000); // past the 15 s watchdog
    expect(cards()[1]).toBe(u("v.mp4"));
    expect(splashEvents()).toEqual([]);

    fireEvent.pointerUp(surface(), pointer(660));
    expect(cards()[1]).toBe(u("b.jpg"));
    expect(track()).toHaveAttribute("data-dir", "1");
    expect(settle()).toBe(""); // the advance's own 500 ms
    expect(enter()).toBe("1478px"); // from where the finger left the row (o −24)
    expect(host().querySelector("video")).toBeNull();
  });

  it("a second finger is ignored; a cancel (or a lost capture) sends the cards back without a step, and the rotation resumes", () => {
    seed([
      { url: u("a.jpg"), iteration_time: 5 },
      { url: u("b.jpg"), iteration_time: 5 },
    ]);
    renderButton();
    drag(-300, { lift: null });
    const held = card("centre")?.style.transform;
    fireEvent.pointerDown(surface(), pointer(100, 900, { id: 9, primary: false }));
    fireEvent.pointerMove(surface(), pointer(900, 900, { id: 9, primary: false }));
    expect(card("centre")?.style.transform).toBe(held);

    fireEvent.pointerCancel(surface(), pointer(0, 0));
    expect(cards()[1]).toBe(u("a.jpg"));
    expect(card("centre")?.style.transform).toBe("");
    expect(settle()).toBe("var(--tb-dur-snap)");

    drag(-300, { lift: "lostPointerCapture" });
    expect(cards()[1]).toBe(u("a.jpg"));
    tick(5_000);
    expect(cards()[1]).toBe(u("b.jpg"));
  });

  it("the single card is inert: no follow, no hold, no step — its tap still starts the order", () => {
    seed([{ url: u("a.jpg") }]);
    renderButton();
    drag(-300);

    expect(layout()).toBe("single");
    expect(card("centre")?.style.transform).toBe("");
    expect(track()).not.toHaveAttribute("data-held");
    fireEvent.click(surface());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("every slide failing under a held finger (WELCOME) lets the hold go: the retry's carousel rotates again, and the next press drags it", () => {
    seed([
      { url: u("a.jpg"), iteration_time: 5 },
      { url: u("b.jpg"), iteration_time: 5 },
    ]);
    renderButton();
    drag(-40, { lift: null });
    fireEvent.error(media("next")); // b → a alone (the single card)
    fireEvent.error(single() as HTMLImageElement); // a → WELCOME: the layer (and its capture) is gone
    expect(layout()).toBe("welcome");

    tick(SPLASH_RETRY_MS);
    expect(layout()).toBe("carousel");
    expect(cards()[1]).toBe(u("a.jpg"));
    tick(5_000); // not held: the dwell runs
    expect(cards()[1]).toBe(u("b.jpg"));
    drag(-300, { id: 2 }); // a new touch (a new pointer id): the lost gesture's record never blocks it
    expect(cards()[1]).toBe(u("a.jpg"));
  });

  it("a centre failure after a back swipe skips FORWARD, in place (no data-dir)", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderButton();
    drag(300); // back → c
    expect(cards()[1]).toBe(u("c.jpg"));
    expect(track()).toHaveAttribute("data-dir", "-1");

    fireEvent.error(media("centre"));
    expect(cards()[1]).toBe(u("a.jpg"));
    expect(track()).not.toHaveAttribute("data-dir");
  });

  it("under reduced motion the drag only translates: every card keeps its slot's focus until the cut", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query }) as MediaQueryList
    );
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-200, { lift: null });

    expect(card("prev")?.style.transform).toBe("translateX(-935px) scale(0.88)");
    expect(card("centre")?.style.transform).toBe("translateX(-184px) scale(1.1)");
    expect(card("next")?.style.transform).toBe("translateX(567px) scale(0.88)");
    expect([veil("prev"), veil("centre"), veil("next")].map((v) => v?.style.opacity)).toEqual(["0.45", "0", "0.45"]);
  });

  it("the catch: a press freezes every card where it is — its computed transform and veil written back inline — and the drag goes on from the centre's x", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderButton();
    // Mid-settle (as Chromium reports it): the centre at +451 (0.968, veil 0.27), the others on its offset.
    const live: Record<string, [string, string]> = {
      "-1": ["matrix(0.88, 0, 0, 0.88, -300, 0)", "0.45"],
      "0": ["matrix(0.968, 0, 0, 0.968, 451, 0)", "0.27"],
      "1": ["matrix(0.88, 0, 0, 0.88, 1202, 0)", "0.45"],
    };
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      const mover = el.closest<HTMLElement>(".tb-splash-card");
      const [transform, opacity] = live[mover?.dataset.slot ?? ""] ?? ["none", "1"];
      return { transform, opacity } as CSSStyleDeclaration;
    });

    fireEvent.pointerDown(surface(), pointer(700));
    expect(card("prev")?.style.transform).toBe("translateX(-300px) scale(0.88)");
    expect(card("centre")?.style.transform).toBe("translateX(451px) scale(0.968)");
    expect(card("next")?.style.transform).toBe("translateX(1202px) scale(0.88)");
    expect([veil("prev"), veil("centre"), veil("next")].map((v) => v?.style.opacity)).toEqual(["0.45", "0.27", "0.45"]);
    expect(card("centre")?.style.transition).toBe("none");

    // The finger takes it from there: 40 px left = 24 px past the slop.
    tick(16);
    fireEvent.pointerMove(surface(), pointer(660));
    expect(card("centre")?.style.transform).toBe(`translateX(${451 - 24}px) scale(${focusAt(0, 427).scale})`);
  });

  it("after a catch a slow release never steps against the drag: caught mid-advance at +549, a slow 50 px LEFT drag lets the incoming card land — never back to the previous one", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderButton();
    const live: Record<string, string> = {
      "-1": "matrix(0.95, 0, 0, 0.95, -202, 0)",
      "0": "matrix(0.98, 0, 0, 0.98, 549, 0)",
      "1": "matrix(0.88, 0, 0, 0.88, 1300, 0)",
    };
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element) =>
        ({ transform: live[el.closest<HTMLElement>(".tb-splash-card")?.dataset.slot ?? ""] ?? "none", opacity: "0.3" }) as CSSStyleDeclaration
    );
    drag(-50, { rest: 150 }); // o 515: p −0.69, all of it the catch's — the finger took it 0.05 the other way

    expect(cards()[1]).toBe(u("a.jpg"));
    expect(track()).not.toHaveAttribute("data-dir");
    expect(settle()).toBe("var(--tb-dur-snap)");
  });

  it("an advance that lands just before a press is committed first: the press catches all three movers — the entrant too — so the first move never jumps them a pitch", () => {
    seed([{ url: u("v.mp4"), media_type: "mp4", iteration_time: 1 }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderButton();
    act(() => {
      media("centre").dispatchEvent(new Event("ended")); // the last play: advance()
      surface().dispatchEvent(createEvent.pointerDown(surface(), pointer(700))); // before React's own task
    });

    expect(track()).toHaveAttribute("data-dir", "1");
    expect(track()).toHaveAttribute("data-held");
    for (const slot of ["prev", "centre", "next"] as const) expect(card(slot)?.style.transform, slot).not.toBe("");
  });

  it("the slop is the browser's px, not the stage's: on a stage scaled to 0.8 a 13 px wobble (16.25 stage px) is still a tap; 17 px is not, and follows from the slop on", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 864 } as DOMRect);
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-13, { type: "mouse" });
    expect(card("centre")?.style.transform).toBe("");
    fireEvent.click(surface());
    expect(start).toHaveBeenCalledTimes(1);

    drag(-17, { type: "mouse", lift: null }); // 21.25 stage px, 1.25 of them past the 16 px (20 stage px) slop
    expect(card("centre")?.style.transform).toBe(`translateX(-1.25px) scale(${focusAt(0, -1.25).scale})`);
    fireEvent.pointerUp(surface(), pointer(683, 900, { type: "mouse" }));
    fireEvent.click(surface());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("the slop is Euclidean: a 17 px diagonal (−12, −12) is past it — a mouse's click is not a tap", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-12, { dy: -12, type: "mouse" });
    fireEvent.click(surface());
    expect(start).not.toHaveBeenCalled();
  });

  it("20 px sideways follows from the slop on (−4 px), and its click is not a tap", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-20, { type: "mouse", lift: null });
    expect(card("centre")?.style.transform).toBe(`translateX(-4px) scale(${focusAt(0, -4).scale})`);
    fireEvent.pointerUp(surface(), pointer(680, 900, { type: "mouse" }));
    fireEvent.click(surface());
    expect(start).not.toHaveBeenCalled();
  });

  it("a purely vertical drag (0, +300) is neither a swipe nor a tap", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(0, { dy: 300, type: "mouse", lift: null });
    expect(card("centre")?.style.transform).toBe("translateX(0px) scale(1)"); // the catch's (jsdom)
    fireEvent.pointerUp(surface(), pointer(700, 1200, { type: "mouse" }));
    fireEvent.click(surface());
    expect(start).not.toHaveBeenCalled();
  });

  it("a touch swipe gets no click (Chromium drops it), so the next press re-arms the tap: its click starts the order", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-300);
    fireEvent.pointerDown(surface(), pointer(540, 900, { id: 2 }));
    fireEvent.pointerUp(surface(), pointer(540, 900, { id: 2 }));
    fireEvent.click(surface());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("a quick 40 px flick (24 px of visible follow) is a flick by its RAW travel: it steps", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }]);
    renderButton();
    drag(-40, { every: 20, rest: 0 }); // 1 px/ms
    expect(cards()[1]).toBe(u("b.jpg"));
  });
});

/*
  The one line (user decision 2026-10-16): the backend's
  start_order_text_primary (kiosk_settings), trimmed, on EVERY layout — never
  start_order_text_secondary; anything but a non-blank string shows the i18n
  "order here", in the default language. ORDER HERE's place: Title/H1 in its
  756 px column, bottom edge at y 1712 (bottom 208), so a longer text grows
  upward.
*/
describe("the one line — start_order_text_primary, else 'order here' (2026-10-16)", () => {
  const LAYOUTS = [
    ["welcome", []],
    ["single", [{ url: "https://cdn.test/one.jpg" }]],
    ["carousel", [{ url: "https://cdn.test/one.jpg" }, { url: "https://cdn.test/two.jpg" }]],
  ] as const;
  const settings = (kioskSettings: unknown) => store.dispatch(setKioskSettings(kioskSettings));
  /** Every element that carries text of its own (no element children). */
  const texts = () =>
    [...host().querySelectorAll("*")].filter((el) => el.childElementCount === 0 && el.textContent?.trim());

  it.each(LAYOUTS)("%s: exactly ONE text — the backend's primary, trimmed", (name, slides) => {
    settings({ start_order_text_primary: "  Tap to order  " });
    seed([...slides]);
    renderSplash();

    expect(layout()).toBe(name);
    expect(text()).toBe("Tap to order");
    expect(texts().map((el) => el.textContent)).toEqual(["Tap to order"]);
  });

  it.each(LAYOUTS)("%s: start_order_text_secondary set too — still only the primary", (name, slides) => {
    settings({ start_order_text_primary: "START ORDER", start_order_text_secondary: "ابدأ الطلب" });
    seed([...slides]);
    renderSplash();

    expect(layout()).toBe(name);
    expect(text()).toBe("START ORDER");
  });

  it.each([
    ["missing", {}],
    ["empty", { start_order_text_primary: "" }],
    ["blank", { start_order_text_primary: "   " }],
    ["a number", { start_order_text_primary: 42 }],
    ["an object", { start_order_text_primary: {} }],
    ["null", { start_order_text_primary: null }],
    ["kiosk_settings null", null],
  ])("%s → the 'order here' fallback", (_case, kioskSettings) => {
    settings(kioskSettings);
    seed([{ url: "https://cdn.test/one.jpg" }]);
    renderSplash();

    expect(layout()).toBe("single");
    expect(text()).toBe("order here");
  });

  it("an Arabic session ending on the splash: the fallback is 'order here' from the first render (i18n catches up one effect later)", async () => {
    await i18n.changeLanguage("ar");
    try {
      seed([{ url: "https://cdn.test/one.jpg" }]);
      renderSplash();

      expect(text()).toBe("order here");
    } finally {
      await i18n.changeLanguage(DEFAULT_LANGUAGE);
    }
  });

  it.each(LAYOUTS)("%s: ORDER HERE's place — Title/H1, its 756 px column (a longer word widens it, never breaks mid-word), bottom 208, dir=auto on the leaf only, no clamp", (_name, slides) => {
    settings({ start_order_text_primary: "Tap to order" });
    seed([...slides]);
    renderSplash();

    const line = screen.getByText("Tap to order");
    expect(line.tagName).toBe("SPAN");
    expect(line).toHaveClass(
      "tb-display", "text-[116px]", "leading-[98px]", "tracking-[-3.27px]", "text-tb-surface",
      "w-max", "min-w-min", "max-w-[756px]", "text-center"
    );
    expect(line.parentElement).toHaveClass("absolute", "inset-x-[24px]", "bottom-[208px]", "flex", "justify-center");
    expect(line.className).not.toMatch(/nowrap|line-clamp|truncate|overflow-hidden|overflow-wrap/);
    expect(line).toHaveAttribute("dir", "auto");
    expect(host().querySelectorAll("[dir]")).toHaveLength(1);
  });
});
