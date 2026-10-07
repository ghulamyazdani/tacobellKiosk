import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  holdReloadsUntil,
  installChunkErrorRecovery,
  planCrashRecovery,
  reloadTo,
} from "../chunkRecovery";

/*
  P9b R9 — where (and how soon) the app ErrorBoundary reloads to. Time-boxed
  with the same 60 s window chunk recovery uses, never stored (Rule 3).
*/

describe("planCrashRecovery (P9b R9)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it.each([
    [120_000, "/menu", "/start", 10_000, "a healthy page: back to the splash after 10 s"],
    [60_000, "/cart", "/start", 10_000, "exactly one window old counts as healthy"],
    [59_999, "/cart", "/LoadingResources", 60_000, "a crash inside the first minute is a probable loop: re-boot after a full minute"],
    [5_000, "/start", "/LoadingResources", 60_000, "a crash right after a reload"],
    [600_000, "/LoadingResources", "/LoadingResources", 60_000, "a crash ON the boot screen re-boots (/start would skip the unfinished boot)"],
  ])("age %i ms on %s → %s after %i ms (%s)", (age, path, target, delay) => {
    expect(planCrashRecovery(age, path)).toEqual({ path: target, delayMs: delay });
  });

  it("defaults to the page's own age and path", () => {
    vi.spyOn(performance, "now").mockReturnValue(120_000);
    window.history.replaceState(null, "", "/menu");
    expect(planCrashRecovery()).toEqual({ path: "/start", delayMs: 10_000 });

    window.history.replaceState(null, "", "/LoadingResources");
    expect(planCrashRecovery()).toEqual({ path: "/LoadingResources", delayMs: 60_000 });

    window.history.replaceState(null, "", "/menu");
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    expect(planCrashRecovery()).toEqual({ path: "/LoadingResources", delayMs: 60_000 });
  });
});

/*
  P9e/P9f — a failed lazy chunk normally reloads the page (a deploy re-hashed
  it), but FCM and analytics are optional: their chunks (fcmRuntime,
  posthogRuntime) failing must never reload the kiosk, least of all mid-order.
  The handler still preventDefault()s them, so import() resolves undefined:
  useFcmRegistration reports "import" and leaves FCM off, startAnalytics leaves
  analytics off. Every other chunk keeps the P9b recovery.
*/
describe("installChunkErrorRecovery — the FCM, PostHog and Paytm-screen chunks are exempt (P9e/P9f/P8b)", () => {
  const reload = vi.fn();
  const replace = vi.fn();

  /** What Vite's preload helper dispatches for a chunk that failed to load. */
  const preloadError = (payload?: Error) => {
    const event = new Event("vite:preloadError", { cancelable: true });
    Object.assign(event, { payload });
    window.dispatchEvent(event);
    return event;
  };

  beforeAll(() => {
    // Once per file: every call adds a window listener.
    installChunkErrorRecovery();
  });

  beforeEach(() => {
    reload.mockReset();
    replace.mockReset();
    // jsdom's location.reload is unforgeable; swap the whole location.
    vi.stubGlobal("location", { reload, replace });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    [
      "the FCM production chunk",
      "Failed to fetch dynamically imported module: https://kiosk.example/assets/fcmRuntime-9ypKZIdg.js",
    ],
    [
      "the FCM dev-server module",
      "Failed to fetch dynamically imported module: http://localhost:5373/src/hooks/firebase/fcmRuntime.ts",
    ],
    [
      "the PostHog production chunk",
      "Failed to fetch dynamically imported module: https://kiosk.example/assets/posthogRuntime-C3xq0Lr9.js",
    ],
    [
      "the PostHog dev-server module",
      "Failed to fetch dynamically imported module: http://localhost:5373/src/utils/analytics/posthogRuntime.ts",
    ],
    // P8b: /paymentPolling loads right after an initiate — a payment may be
    // live, so PaytmPaymentRoute shows its staff panel instead of a reload.
    [
      "the Paytm screen production chunk",
      "Failed to fetch dynamically imported module: https://kiosk.example/assets/paytmRuntime-DOoFgvtw.js",
    ],
    [
      "the Paytm screen dev-server module",
      "Failed to fetch dynamically imported module: http://localhost:5373/src/pages/PaytmPayment/paytmRuntime.ts",
    ],
  ])("%s failing: handled (no crash screen) but NEVER reloads", (_label, message) => {
    const event = preloadError(new Error(message));

    expect(event.defaultPrevented).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    [
      "any other chunk",
      new Error(
        "Failed to fetch dynamically imported module: https://kiosk.example/assets/CompleteYourMealRail-DUeHLWT_.js"
      ),
    ],
    ["a stylesheet", new Error("Unable to preload CSS for /assets/index-Dx-ze_Wk.css")],
    ["a payload without a message", undefined],
  ])("%s failing on a healthy page still reloads once to pick up the current build", (_label, payload) => {
    const event = preloadError(payload);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a failure on a page that IS a fresh reload does not reload again (loop guard, unchanged)", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { type: "reload" } as unknown as PerformanceEntry,
    ]);
    vi.spyOn(performance, "now").mockReturnValue(1_000);

    preloadError(new Error("Failed to fetch dynamically imported module: /assets/Menu-x.js"));

    expect(reload).not.toHaveBeenCalled();
  });

  /*
    P8b-12 — the splash's Paytm session release (one status read, maybe one
    EDC void, never retried; the session is already wiped from disk) holds
    every reload: chunk recovery's, and reloadTo's (the whole-app update,
    crash recovery). Capped, so a hung release never holds the kiosk.
  */
  describe("held work (holdReloadsUntil) defers every reload until it settles", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("a failed chunk and reloadTo both wait for the held work, then each runs once; free again after", async () => {
      let settle!: () => void;
      holdReloadsUntil(new Promise<void>((resolve) => (settle = resolve)));

      preloadError(new Error("Failed to fetch dynamically imported module: /assets/bagLazyParts-x.js"));
      reloadTo("/start");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reload).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();

      settle();
      await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith("/start");

      reloadTo("/LoadingResources"); // nothing held: at once
      expect(replace).toHaveBeenLastCalledWith("/LoadingResources");
    });

    it("work that never settles holds reloads for 20 s at most (Rule 2)", async () => {
      vi.useFakeTimers();
      holdReloadsUntil(new Promise(() => undefined));
      reloadTo("/start");

      await vi.advanceTimersByTimeAsync(19_999);
      expect(replace).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith("/start");
    });
  });
});
