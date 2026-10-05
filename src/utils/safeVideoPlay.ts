import { captureKioskEvent, KioskEventName } from "./analytics";

/**
 * Reporting budget. A kiosk runs for days without reloading, so a per-page-load
 * cap would permanently blind us after the first three events. Instead we allow
 * a small number of reports per rolling window.
 */
const MAX_REPORTED_PLAY_FAILURES = 3;
const REPORT_WINDOW_MS = 60 * 60 * 1000;

let reportedPlayFailures = 0;
let reportWindowStart = 0;

type PlayFailureKind = "stalled" | "failed";

/**
 * `HTMLMediaElement.play()` rejects with `AbortError` whenever a pending play
 * request is interrupted. Chromium emits two distinct flavours, and they mean
 * very different things — see https://goo.gl/LdLk22.
 */
function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * True for "The play() request was interrupted by a new load request."
 *
 * This one is a genuine signal, not noise. Swapping `src` only rejects a play
 * promise that is *still pending* — i.e. the previous slide never reached
 * `playing`. When that happens its `ended` event never fires either, so the
 * banner can stick on one slide indefinitely in front of customers. A healthy
 * rotation produces none of these.
 *
 * The other flavour ("...interrupted by a call to pause()") is the expected
 * result of tearing the banner down — navigating away, or switching from a
 * video slide to an image slide — and is silently ignored.
 */
function isStalledPlayback(error: DOMException): boolean {
  return error.message.includes("new load request");
}

function reportPlayFailure(
  error: unknown,
  source: string,
  kind: PlayFailureKind,
): void {
  const now = Date.now();
  if (now - reportWindowStart > REPORT_WINDOW_MS) {
    reportWindowStart = now;
    reportedPlayFailures = 0;
  }
  if (reportedPlayFailures >= MAX_REPORTED_PLAY_FAILURES) {
    return;
  }
  reportedPlayFailures += 1;

  captureKioskEvent(KioskEventName.ErrorOccurred, {
    error_source: "video_playback",
    failure_kind: kind,
    video_source: source,
    error_name: error instanceof Error ? error.name : "UnknownError",
    error_message: error instanceof Error ? error.message : String(error),
    occurrence: reportedPlayFailures,
  });
}

/**
 * Starts playback without ever producing an unhandled promise rejection.
 *
 * Teardown interruptions are swallowed — they are expected and harmless. A
 * stalled slide (`"new load request"`) and any real failure (most importantly
 * `NotAllowedError`, i.e. autoplay blocked, which leaves the kiosk showing a
 * frozen frame) are reported through the normal analytics channel,
 * rate-limited, so they stay visible without flooding.
 *
 * @param video  The element to play. `null` is a no-op, so callers can pass a
 *               ref value directly.
 * @param source Short identifier for the call site, e.g. `"home_banner_main"`.
 */
export function safeVideoPlay(
  video: HTMLVideoElement | null | undefined,
  source: string,
): void {
  if (!video) {
    return;
  }

  const handleFailure = (error: unknown): void => {
    if (isAbortError(error)) {
      if (isStalledPlayback(error)) {
        reportPlayFailure(error, source, "stalled");
      }
      // Otherwise: interrupted by pause() during teardown. Expected, ignore.
      return;
    }
    reportPlayFailure(error, source, "failed");
  };

  let playPromise: Promise<void> | undefined;
  try {
    playPromise = video.play();
  } catch (error) {
    // Some engines throw synchronously instead of returning a rejected promise.
    handleFailure(error);
    return;
  }

  // Older implementations return undefined rather than a promise.
  if (!playPromise || typeof playPromise.catch !== "function") {
    return;
  }

  playPromise.catch(handleFailure);
}
