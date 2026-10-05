import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  P9d — safeVideoPlay, the fork's helper ported verbatim: play() never yields
  an unhandled rejection. A teardown abort ("…interrupted by a call to
  pause()") is noise; "…interrupted by a new load request" means the slide
  stalled; anything else (NotAllowedError: autoplay blocked) is a failure.
  Reports are capped at 3 per rolling hour — module state, so every test
  imports a fresh copy.
  jsdom's DOMException comes from another realm (not `instanceof Error`, as it
  is in Chromium), so error_name / error_message are pinned with plain Errors.
*/

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

let safeVideoPlay: typeof import("../safeVideoPlay").safeVideoPlay;

const HOUR = 60 * 60 * 1000;
const PAUSED = "The play() request was interrupted by a call to pause(). https://goo.gl/LdLk22";
const RELOADED =
  "The play() request was interrupted by a new load request. https://goo.gl/LdLk22";

/** A <video> stand-in whose play() does whatever `play` does. */
const videoThat = (play: () => unknown) => {
  const video = { play: vi.fn(play) };
  return video as unknown as HTMLVideoElement & typeof video;
};
const rejecting = (error: unknown) => videoThat(() => Promise.reject(error));
const stalled = () => rejecting(new DOMException(RELOADED, "AbortError"));
const blocked = () => rejecting(new DOMException("play() failed", "NotAllowedError"));
/** Lets every already-queued `.catch` reaction run. */
const settle = () => Promise.resolve();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  mockCapture.mockReset();
  vi.resetModules();
  ({ safeVideoPlay } = await import("../safeVideoPlay"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("safeVideoPlay", () => {
  it("null / undefined is a no-op (callers pass a ref value straight in)", () => {
    expect(() => safeVideoPlay(null, "splash_video")).not.toThrow();
    expect(() => safeVideoPlay(undefined, "splash_video")).not.toThrow();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("a play that starts reports nothing", async () => {
    const video = videoThat(() => Promise.resolve());

    safeVideoPlay(video, "splash_video");
    await settle();

    expect(video.play).toHaveBeenCalledTimes(1);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("a teardown abort ('…by a call to pause()') is swallowed — expected noise", async () => {
    safeVideoPlay(rejecting(new DOMException(PAUSED, "AbortError")), "splash_video");
    await settle();

    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("'…by a new load request' is a stalled slide — reported", async () => {
    safeVideoPlay(stalled(), "splash_video");
    await settle();

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        error_source: "video_playback",
        failure_kind: "stalled",
        video_source: "splash_video",
        occurrence: 1,
      })
    );
  });

  it("any other rejection (NotAllowedError: autoplay blocked) is a failure — reported", async () => {
    safeVideoPlay(blocked(), "home_banner_main");
    safeVideoPlay(
      rejecting(Object.assign(new Error("autoplay blocked"), { name: "NotAllowedError" })),
      "home_banner_main"
    );
    await settle();

    expect(mockCapture).toHaveBeenNthCalledWith(
      1,
      "error_occurred",
      expect.objectContaining({ failure_kind: "failed", video_source: "home_banner_main" })
    );
    expect(mockCapture).toHaveBeenNthCalledWith(2, "error_occurred", {
      error_source: "video_playback",
      failure_kind: "failed",
      video_source: "home_banner_main",
      error_name: "NotAllowedError",
      error_message: "autoplay blocked",
      occurrence: 2,
    });
  });

  it("a non-Error rejection is reported as UnknownError with its text", async () => {
    safeVideoPlay(rejecting("decoder gone"), "splash_video");
    await settle();

    expect(mockCapture).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        failure_kind: "failed",
        error_name: "UnknownError",
        error_message: "decoder gone",
      })
    );
  });

  it("an engine that THROWS synchronously is handled the same way — nothing escapes", () => {
    const thrower = videoThat(() => {
      throw new TypeError("play is not supported");
    });
    const teardown = videoThat(() => {
      throw new DOMException(PAUSED, "AbortError");
    });

    expect(() => safeVideoPlay(thrower, "splash_video")).not.toThrow();
    expect(() => safeVideoPlay(teardown, "splash_video")).not.toThrow();

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({
        failure_kind: "failed",
        error_name: "TypeError",
        error_message: "play is not supported",
      })
    );
  });

  it("an engine whose play() returns no promise is tolerated", () => {
    expect(() => safeVideoPlay(videoThat(() => undefined), "splash_video")).not.toThrow();
    expect(() => safeVideoPlay(videoThat(() => ({})), "splash_video")).not.toThrow();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("reports at most 3 per rolling hour (stalled and failed share the budget); after the hour it reports again", async () => {
    [stalled(), blocked(), stalled(), blocked(), stalled()].forEach((video) =>
      safeVideoPlay(video, "splash_video")
    );
    await settle();
    expect(mockCapture.mock.calls.map(([, props]) => props)).toEqual([
      expect.objectContaining({ failure_kind: "stalled", occurrence: 1 }),
      expect.objectContaining({ failure_kind: "failed", occurrence: 2 }),
      expect.objectContaining({ failure_kind: "stalled", occurrence: 3 }),
    ]);

    vi.advanceTimersByTime(HOUR); // exactly an hour after the window opened
    safeVideoPlay(blocked(), "splash_video");
    await settle();
    expect(mockCapture).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(1); // a new window
    safeVideoPlay(blocked(), "splash_video");
    await settle();
    expect(mockCapture).toHaveBeenCalledTimes(4);
    expect(mockCapture.mock.lastCall?.[1]).toMatchObject({ failure_kind: "failed", occurrence: 1 });
  });
});
