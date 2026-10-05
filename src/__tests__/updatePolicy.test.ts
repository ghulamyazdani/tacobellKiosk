import { describe, expect, it } from "vitest";
import {
  BOOT_DATA_MAX_AGE_MS,
  BOOT_REFRESH_RETRY_MS,
  SPLASH_APPLY_DELAY_MS,
  SPLASH_COUNTDOWN_SECONDS,
  extractBrandUpdateId,
  isBootDataStale,
  msUntilScheduledRefresh,
  resolveSplashUpdateAction,
} from "@cx-sdk/devices/updates/updatePolicy";

/*
  P9e — the SDK's splash-apply / boot-refresh policy (packages/devices/src/
  updates/updatePolicy.ts, the append-only block), tested here because the
  SDK has no runner. Pure functions: StartScreen picks what to apply with
  resolveSplashUpdateAction, arms its due-instant timer from
  msUntilScheduledRefresh, and the FCM hook accepts a push only through
  extractBrandUpdateId. A stamp the clock cannot vouch for (unset, garbage,
  in the future) must read as "refresh now", never as "fresh for years".
*/

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 1_780_000_000_000;

describe("P9e constants (the calibration knobs)", () => {
  it("15 s dwell, 5 s countdown, 6 h max boot age, 30 min refresh backoff", () => {
    expect(SPLASH_APPLY_DELAY_MS).toBe(15_000);
    expect(SPLASH_COUNTDOWN_SECONDS).toBe(5);
    expect(BOOT_DATA_MAX_AGE_MS).toBe(6 * HOUR);
    expect(BOOT_REFRESH_RETRY_MS).toBe(30 * MIN);
  });
});

describe("resolveSplashUpdateAction — whole_app > brand > scheduled", () => {
  it.each([
    [false, false, false, null],
    [false, false, true, "scheduled"],
    [false, true, false, "brand"],
    [false, true, true, "brand"],
    [true, false, false, "whole_app"],
    [true, false, true, "whole_app"],
    [true, true, false, "whole_app"],
    [true, true, true, "whole_app"],
  ] as const)(
    "wholeApp %s, brand %s, stale %s → %s",
    (shouldWholeAppUpdate, shouldBrandUpdate, bootDataStale, expected) => {
      expect(
        resolveSplashUpdateAction({
          shouldWholeAppUpdate,
          shouldBrandUpdate,
          bootDataStale,
        })
      ).toBe(expected);
    }
  );
});

describe("isBootDataStale — unknown age is stale", () => {
  it.each([
    ["never stamped (0)", 0],
    ["NaN", NaN],
    ["negative", -1],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["1 ms in the future (the clock went back)", NOW + 1],
    ["a year in the future (RTC reset)", NOW + 365 * 24 * HOUR],
    ["exactly maxAge old", NOW - BOOT_DATA_MAX_AGE_MS],
    ["older than maxAge", NOW - 7 * HOUR],
  ])("%s → stale", (_label, lastBootAt) => {
    expect(isBootDataStale(lastBootAt, NOW)).toBe(true);
  });

  it.each([
    ["just booted (stamp === now)", NOW],
    ["maxAge − 1 ms old", NOW - BOOT_DATA_MAX_AGE_MS + 1],
    ["an hour old", NOW - HOUR],
  ])("%s → fresh", (_label, lastBootAt) => {
    expect(isBootDataStale(lastBootAt, NOW)).toBe(false);
  });

  it("honours a custom maxAge", () => {
    expect(isBootDataStale(NOW - 10, NOW, 10)).toBe(true);
    expect(isBootDataStale(NOW - 9, NOW, 10)).toBe(false);
  });

  it("an unreadable clock (NaN now) cannot vouch for any stamp → stale", () => {
    expect(isBootDataStale(NOW - 1, NaN)).toBe(true);
  });

  it("an RTC reset to the epoch: 0 is never a real stamp", () => {
    expect(isBootDataStale(0, 1_000)).toBe(true);
  });
});

describe("msUntilScheduledRefresh — 0 = due now", () => {
  it.each([
    ["fresh, no failure → the stale remainder", NOW - HOUR, 0, 5 * HOUR],
    ["stale, no failure → due", NOW - 7 * HOUR, 0, 0],
    ["never booted → due", 0, 0, 0],
    ["NaN stamps → due", NaN, NaN, 0],
    ["a future boot stamp (clock went back) → due", NOW + HOUR, 0, 0],
    ["stale + failed 10 min ago → the 20 min backoff remainder", NOW - 7 * HOUR, NOW - 10 * MIN, 20 * MIN],
    ["stale + failed 40 min ago → due", NOW - 7 * HOUR, NOW - 40 * MIN, 0],
    ["stale + backoff exactly elapsed → due", NOW - 7 * HOUR, NOW - BOOT_REFRESH_RETRY_MS, 0],
    ["stale + failed 1 ms short of the backoff → 1 ms", NOW - 7 * HOUR, NOW - BOOT_REFRESH_RETRY_MS + 1, 1],
    // F1: a failed brand/operator refresh on FRESH data is due again after the backoff.
    ["fresh + failed SINCE the boot, 10 min ago → 20 min", NOW - HOUR, NOW - 10 * MIN, 20 * MIN],
    ["fresh + failed since the boot, 30 min ago → due", NOW - HOUR, NOW - 30 * MIN, 0],
    ["fresh + failed since the boot, 45 min ago → due", NOW - 2 * HOUR, NOW - 45 * MIN, 0],
    // A good boot AFTER the failure clears it (no loop).
    ["fresh + a failure OLDER than the boot → the stale remainder", NOW - HOUR, NOW - 2 * HOUR, 5 * HOUR],
    ["a failure stamped in the boot's own ms is not 'since the boot'", NOW - HOUR, NOW - HOUR, 5 * HOUR],
    ["a just-booted kiosk with an older failure → 6 h", NOW, NOW - MIN, 6 * HOUR],
    // A failure stamp the clock cannot vouch for is ignored, never honoured for years.
    ["fresh + a future failure stamp → ignored", NOW - HOUR, NOW + HOUR, 5 * HOUR],
    ["stale + a future failure stamp → ignored (due)", NOW - 7 * HOUR, NOW + HOUR, 0],
    ["stale + a negative failure stamp → ignored (due)", NOW - 7 * HOUR, -5, 0],
    ["fresh + a NaN failure stamp → ignored", NOW - HOUR, NaN, 5 * HOUR],
    // Unknown boot age still respects a real recent failure.
    ["a future boot stamp + failed 1 min ago → the backoff still applies", NOW + HOUR, NOW - MIN, 29 * MIN],
    ["never booted + failed 10 min ago → the backoff", 0, NOW - 10 * MIN, 20 * MIN],
    // Near-stale data and a recent failure: the LONGER wait wins.
    ["1 min short of stale + failed 10 min ago → the backoff", NOW - BOOT_DATA_MAX_AGE_MS + MIN, NOW - 10 * MIN, 20 * MIN],
  ])("%s", (_label, lastBootAt, lastFailedAt, expected) => {
    expect(msUntilScheduledRefresh(lastBootAt, lastFailedAt, NOW)).toBe(expected);
  });

  it("backoff arithmetic with custom knobs: max(stale remainder, failure + retry − now)", () => {
    // Boot 20 ms ago, maxAge 10 → stale; failed 5 ms ago, retry 30 → 25 ms.
    expect(msUntilScheduledRefresh(NOW - 20, NOW - 5, NOW, 10, 30)).toBe(25);
    // Boot 5 ms ago, maxAge 100 → 95 ms left; an old failure (before the boot) is spent.
    expect(msUntilScheduledRefresh(NOW - 5, NOW - 50, NOW, 100, 30)).toBe(95);
  });

  it("is monotone: the instant it reports is exactly when it reaches 0 (StartScreen's due timer)", () => {
    const boot = NOW - HOUR;
    const wait = msUntilScheduledRefresh(boot, 0, NOW);
    expect(msUntilScheduledRefresh(boot, 0, NOW + wait - 1)).toBe(1);
    expect(msUntilScheduledRefresh(boot, 0, NOW + wait)).toBe(0);
  });

  it("F1 timeline: a lost brand refresh retries 30 min later as 'scheduled', then a good boot ends it", () => {
    const kindAt = (lastBootAt: number, lastFailedAt: number, now: number) =>
      resolveSplashUpdateAction({
        shouldWholeAppUpdate: false,
        shouldBrandUpdate: false, // already lowered + acked when its refresh ran
        bootDataStale: msUntilScheduledRefresh(lastBootAt, lastFailedAt, now) === 0,
      });
    const failedAt = NOW;
    const bootedAt = failedAt - HOUR;

    expect(kindAt(bootedAt, failedAt, failedAt)).toBeNull();
    expect(kindAt(bootedAt, failedAt, failedAt + 29 * MIN)).toBeNull();
    expect(kindAt(bootedAt, failedAt, failedAt + 30 * MIN)).toBe("scheduled");
    // That retry fails too: another 30 min, never a tight loop.
    expect(msUntilScheduledRefresh(bootedAt, failedAt + 30 * MIN, failedAt + 30 * MIN)).toBe(30 * MIN);
    // A good boot after the failure: fresh for the full 6 h.
    expect(msUntilScheduledRefresh(failedAt + 60 * MIN, failedAt + 30 * MIN, failedAt + 60 * MIN)).toBe(6 * HOUR);
  });
});

describe("extractBrandUpdateId — the one remote command a push carries", () => {
  it("returns a non-blank string id verbatim (the ack echoes it; not trimmed)", () => {
    expect(extractBrandUpdateId({ device_update_id: "upd-1" })).toBe("upd-1");
    expect(extractBrandUpdateId({ device_update_id: " upd-1 " })).toBe(" upd-1 ");
    expect(extractBrandUpdateId({ device_update_id: "x", other: 1 })).toBe("x");
  });

  const hostileProxy = new Proxy(
    {},
    {
      get() {
        throw new Error("boom");
      },
    }
  );
  const throwingGetter = Object.defineProperty({}, "device_update_id", {
    get() {
      throw new Error("boom");
    },
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 7],
    ["a string body", "upd-1"],
    ["an empty id", { device_update_id: "" }],
    ["a whitespace id", { device_update_id: "  " }],
    ["a tab/newline id", { device_update_id: "\t\n" }],
    ["a numeric id", { device_update_id: 7 }],
    ["a null id", { device_update_id: null }],
    ["an array id", { device_update_id: ["upd-1"] }],
    ["an object id", { device_update_id: { id: "upd-1" } }],
    ["an object without the id", { title: "Brand update" }],
    ["an empty object", {}],
    ["an array", []],
    ["a boolean", true],
    ["a function", () => "upd-1"],
    ["a null-prototype object", Object.create(null) as unknown],
    ["a Proxy whose every read throws", hostileProxy],
    ["a throwing getter", throwingGetter],
  ])("%s → null, never throws", (_label, data) => {
    expect(() => extractBrandUpdateId(data)).not.toThrow();
    expect(extractBrandUpdateId(data)).toBeNull();
  });
});
