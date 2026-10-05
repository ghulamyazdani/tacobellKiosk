import { afterEach, describe, expect, it, vi } from "vitest";
import { planCrashRecovery } from "../chunkRecovery";

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
