import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { setMediaData } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import SplashMedia from "../SplashMedia";
import "../../../i18n";

/*
  P9d — the splash media layer. Layout by PLAYABLE slide count (0 → WELCOME
  1:5617, 1 → full-bleed 1:5604, ≥2 → the 1:2203 peek carousel), the image
  rotation, per-visit skipping of a failed slide, the video lifecycle
  (watchdog, plays, teardown, hidden page, StrictMode) and the rate-limited
  failure report. jsdom decodes nothing: the media methods are stubbed and
  media events are fired by hand. The report limiter is MODULE state keyed by
  url|kind, so every test gets URLs of its own (`u`).
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

/** The 1:2203 card slots, by their Figma x. */
const SLOT = { prev: -592, centre: 200, next: 992 } as const;
type Slot = keyof typeof SLOT;
const card = (slot: Slot) => host().querySelector(`[class*="left-[${SLOT[slot]}px]"]`);
const media = (slot: Slot) => {
  const el = card(slot)?.querySelector("img, video");
  if (!el) throw new Error(`no media in the ${slot} card`);
  return el as HTMLImageElement | HTMLVideoElement;
};
/** prev / centre / next slide URLs (null = a card with no media element). */
const cards = () =>
  (["prev", "centre", "next"] as const).map((slot) => srcOf(card(slot)?.querySelector("img, video")));
/** The one slide of the full-bleed layout — a direct child of the layer. */
const fullBleed = () =>
  host().querySelector(':scope > img[src^="https://cdn.test/"], :scope > video') as
    | HTMLImageElement
    | HTMLVideoElement
    | null;
const layout = () => {
  if (card("centre")) return "carousel";
  if (fullBleed()) return "full-bleed";
  if (/touch anywhere to start/i.test(text() ?? "")) return "welcome";
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
  it("0 playable → WELCOME (1:5617): photo, six stars, bell, 'welcome' + 'touch anywhere to start'", () => {
    seed([{ url: "   " }, { media_type: "mp4" }, null]);
    renderSplash();

    expect(layout()).toBe("welcome");
    expect(text()).toMatch(/^welcome\s*touch anywhere to start$/i);
    expect(host().querySelector('img[src*="fullbleed-halfmoon"]')).toBeInTheDocument();
    expect(host().querySelectorAll('img[src*="star-"]')).toHaveLength(6);
    expect(host().querySelector('img[class*="left-[490px]"]')).toBeInTheDocument();
    expect(host().querySelector("video")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("1 playable → full-bleed media + 'start order' only", () => {
    seed([{ url: "" }, { url: u("a.jpg") }]);
    renderSplash();

    expect(layout()).toBe("full-bleed");
    expect(srcOf(fullBleed())).toBe(u("a.jpg"));
    expect(text()).toMatch(/^start order$/i);
    expect(host().querySelector('img[class*="left-[490px]"]')).toBeInTheDocument();
  });

  it("≥2 playable → the carousel: prev / centre / next cards + 'order here' + 'start order'", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();

    expect(layout()).toBe("carousel");
    expect(text()).toMatch(/^order here\s*start order$/i);
    expect(cards()).toEqual([u("c.jpg"), u("a.jpg"), u("b.jpg")]);
  });
});

describe("image rotation", () => {
  it("a single image never advances — no rotation timer at all, even after 60 s", () => {
    seed([{ url: u("a.jpg"), iteration_time: 5 }]);
    renderSplash();
    const img = fullBleed();

    expect(vi.getTimerCount()).toBe(0);
    tick(60_000);
    expect(fullBleed()).toBe(img);
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

describe("a failed slide is skipped for the visit — never blank, never stuck", () => {
  it("a centre image error skips it at once and reports load_error with its slide_index", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();

    fireEvent.error(media("centre"));

    expect(cards()[1]).toBe(u("b.jpg"));
    expect(splashEvents()).toEqual([failure("load_error", 0)]);
  });

  it("degrades carousel(3) → carousel(2) → full-bleed → WELCOME as each centre fails", () => {
    seed([{ url: u("a.jpg") }, { url: u("b.jpg") }, { url: u("c.jpg") }]);
    renderSplash();

    fireEvent.error(media("centre")); // a
    expect(layout()).toBe("carousel");
    expect(cards()).toEqual([u("c.jpg"), u("b.jpg"), u("c.jpg")]);

    fireEvent.error(media("centre")); // b
    expect(layout()).toBe("full-bleed");
    expect(srcOf(fullBleed())).toBe(u("c.jpg"));
    expect(text()).toMatch(/^start order$/i);

    fireEvent.error(fullBleed() as HTMLImageElement); // c — everything failed
    expect(layout()).toBe("welcome");
    expect(text()).toMatch(/^welcome\s*touch anywhere to start$/i);
    expect(splashEvents()).toEqual([
      failure("load_error", 0),
      failure("load_error", 1),
      failure("load_error", 2),
    ]);
    expect(vi.getTimerCount()).toBe(0);
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
    const v = fullBleed() as HTMLVideoElement;

    expect(v.tagName).toBe("VIDEO");
    expect(v).toHaveAttribute("loop");
    for (let i = 0; i < 6; i += 1) {
      tick(10_000);
      fireEvent.timeUpdate(v);
    }
    expect(fullBleed()).toBe(v);
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
    expect(card("prev")?.childElementCount).toBe(0);
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
    expect(layout()).toBe("full-bleed");
    expect(splashEvents()).toEqual([failure("stalled", 0)]);
  });
});

describe("failure reporting — one event per url|kind per hour", () => {
  it("the same broken asset on the next visits is silent until the hour is up, then reports again", () => {
    seed([{ url: u("broken.jpg") }]);
    const visit = () => {
      const view = renderSplash();
      fireEvent.error(fullBleed() as HTMLImageElement);
      expect(layout()).toBe("welcome");
      view.unmount();
    };

    visit();
    visit(); // the next guest: same url|kind
    expect(splashEvents()).toEqual([failure("load_error", 0)]);

    tick(HOUR - 1);
    visit();
    expect(splashEvents()).toHaveLength(1);

    tick(1);
    visit();
    expect(splashEvents()).toEqual([failure("load_error", 0), failure("load_error", 0)]);
  });

  it("the key is url AND kind: the same asset failing another way still reports", () => {
    seed([{ url: u("v.mp4") }]);
    const visit = (breakIt: (video: HTMLVideoElement) => void) => {
      const view = renderSplash();
      breakIt(fullBleed() as HTMLVideoElement);
      expect(layout()).toBe("welcome");
      view.unmount();
    };

    visit((video) => fireEvent.error(video));
    visit(() => tick(STALL_MS));
    visit((video) => fireEvent.error(video));

    expect(splashEvents()).toEqual([failure("load_error", 0), failure("stalled", 0)]);
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
    expect(layout()).toBe("full-bleed");
    expect(srcOf(fullBleed())).toBe(u("a.jpg"));
  });
});

describe("lifecycle", () => {
  it("StrictMode's simulated unmount strips the src — the re-run restores it and plays again", () => {
    seed([{ url: u("v.mp4") }]);
    renderSplash({ reactStrictMode: true });
    const v = fullBleed() as HTMLVideoElement;

    expect(load.mock.contexts).toEqual([v]); // the simulated unmount released it…
    expect(v.getAttribute("src")).toBe(u("v.mp4")); // …the re-run put it back
    expect(play.mock.contexts).toEqual([v, v]);
    expect(vi.getTimerCount()).toBe(1); // one watchdog: the first run's was cleared

    tick(STALL_MS - 1_000);
    fireEvent.timeUpdate(v);
    tick(STALL_MS - 1_000);
    expect(fullBleed()).toBe(v);
    expect(splashEvents()).toEqual([]);
  });

  // H3: the layer re-renders on unrelated ticks (redux, the language reset on
  // arrival); unstable callbacks would re-run the video effect = a restart.
  it.each([
    ["full-bleed", ["v.mp4"]],
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
