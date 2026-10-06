import { afterEach, describe, expect, it, vi } from "vitest";
import { KioskEventName } from "@cx-sdk/core";

/*
  P9f — the lazy PostHog adapter. posthog-js is reached ONLY through the
  ../posthogRuntime seam (its own chunk). Each test shapes that seam with
  vi.doMock and re-imports a fresh adapter (vi.resetModules), because the kill
  switch and the queue are module state. Every PostHog call lands in `calls`,
  in order.
*/

const calls: unknown[][] = [];
const runtimeLoaded = vi.fn();

const fakePostHog = ({ loads = true, initThrows = false } = {}) => {
  const posthog = {
    __loaded: false,
    init: (...args: unknown[]) => {
      calls.push(["init", ...args]);
      if (initThrows) throw new Error("init blew up");
      posthog.__loaded = loads;
    },
    capture: (...args: unknown[]) => calls.push(["capture", ...args]),
    identify: (...args: unknown[]) => calls.push(["identify", ...args]),
  };
  return posthog;
};

/** A fresh adapter with the kill switch on or off and the seam shaped by `runtime`. */
const loadAdapter = async (
  enabled: boolean,
  runtime: () => object = () => ({ default: fakePostHog() })
) => {
  vi.resetModules();
  vi.doMock("../posthogRuntime", () => {
    runtimeLoaded();
    return runtime();
  });
  if (enabled) {
    vi.stubEnv("VITE_POST_HOG_TYPE", "production");
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("VITE_PUBLIC_POSTHOG_HOST", "https://ph.example");
  }
  return import("../trackEvent");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("../posthogRuntime");
  calls.length = 0;
  runtimeLoaded.mockClear();
});

describe("analytics adapter — kill switch OFF (every non-production build)", () => {
  // Unset AND a non-empty non-production value: the switch is `=== "production"`, never truthiness.
  it.each([undefined, "development"])("VITE_POST_HOG_TYPE=%s: never loads the PostHog chunk and drops every call", async (type) => {
    if (type) vi.stubEnv("VITE_POST_HOG_TYPE", type);
    const a = await loadAdapter(false);

    a.captureKioskEvent(KioskEventName.SignInStarted, { x: 1 });
    a.identifyKiosk("tenant-1", {});
    await expect(a.startAnalytics()).resolves.toBeUndefined();
    a.captureKioskEvent(KioskEventName.SignInFinished);

    expect(runtimeLoaded).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("analytics adapter — kill switch ON", () => {
  it("queues the boot burst and replays it in order — identify keeps its place between captures — after exactly one init; later calls go straight through", async () => {
    const a = await loadAdapter(true);

    a.captureKioskEvent(KioskEventName.SignInStarted, { n: 1 });
    a.identifyKiosk("tenant-1", { tenant_id: "tenant-1" });
    a.captureKioskEvent(KioskEventName.SignInFinished);
    expect(calls).toEqual([]);

    // Concurrent and repeated starts are idempotent: one chunk load, one init.
    await Promise.all([a.startAnalytics(), a.startAnalytics()]);
    await a.startAnalytics();
    a.captureKioskEvent(KioskEventName.RegistrationFinished);

    expect(runtimeLoaded).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      ["init", "phc_test", { api_host: "https://ph.example", defaults: "2025-05-24" }],
      ["capture", KioskEventName.SignInStarted, { n: 1 }],
      ["identify", "tenant-1", { tenant_id: "tenant-1" }],
      ["capture", KioskEventName.SignInFinished, undefined],
      ["capture", KioskEventName.RegistrationFinished, undefined],
    ]);
  });

  it("caps the queue: 150 calls before load → the first 100 are replayed", async () => {
    const a = await loadAdapter(true);

    for (let i = 0; i < 150; i++) {
      a.captureKioskEvent(KioskEventName.SignInStarted, { i });
    }
    await a.startAnalytics();

    const captured = calls.filter(([kind]) => kind === "capture");
    expect(a.MAX_QUEUED_ANALYTICS_CALLS).toBe(100);
    expect(captured).toHaveLength(100);
    expect(captured.at(-1)).toEqual(["capture", KioskEventName.SignInStarted, { i: 99 }]);
  });

  it.each([
    ["init leaves __loaded unset (empty key)", () => ({ default: fakePostHog({ loads: false }) })],
    ["init throws", () => ({ default: fakePostHog({ initThrows: true }) })],
    ["the chunk resolves without a module (Vite's helper after a prevented chunk error)", () => ({ default: undefined })],
    [
      "the chunk import rejects",
      () => {
        throw new Error("Failed to fetch dynamically imported module: /assets/posthogRuntime-x.js");
      },
    ],
  ])("%s: resolves, drops the burst, later calls are no-ops — and it stays off (no re-import)", async (_label, runtime) => {
    const a = await loadAdapter(true, runtime);

    a.captureKioskEvent(KioskEventName.SignInStarted);
    a.identifyKiosk("tenant-1", {});
    await expect(a.startAnalytics()).resolves.toBeUndefined();
    a.captureKioskEvent(KioskEventName.SignInFinished);
    await expect(a.startAnalytics()).resolves.toBeUndefined();
    await expect(a.startAnalytics()).resolves.toBeUndefined();
    a.identifyKiosk("tenant-1", {});

    expect(calls.filter(([kind]) => kind !== "init")).toEqual([]);
    // Off for the page load: one chunk request, at most one init — never a retry.
    expect(runtimeLoaded).toHaveBeenCalledTimes(1);
    expect(calls.filter(([kind]) => kind === "init").length).toBeLessThanOrEqual(1);
  });

  it("a capture that throws after load is swallowed and never stops the replay", async () => {
    const posthog = fakePostHog();
    const capture = posthog.capture;
    posthog.capture = (...args: unknown[]) => {
      if (args[0] === KioskEventName.SignInStarted) throw new Error("capture blew up");
      return capture(...args);
    };
    const a = await loadAdapter(true, () => ({ default: posthog }));

    a.captureKioskEvent(KioskEventName.SignInStarted);
    a.captureKioskEvent(KioskEventName.SignInFinished);
    await a.startAnalytics();
    expect(() => a.captureKioskEvent(KioskEventName.SignInStarted)).not.toThrow();

    expect(calls.filter(([kind]) => kind === "capture")).toEqual([
      ["capture", KioskEventName.SignInFinished, undefined],
    ]);
  });

  it.each(["capture", "identify"] as const)(
    "%s throwing AFTER load is swallowed, and the next calls still go through",
    async (kind) => {
      const posthog = fakePostHog();
      const real = posthog[kind];
      let throwOnce = true;
      posthog[kind] = (...args: unknown[]) => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error(`${kind} blew up`);
        }
        return real(...args);
      };
      const a = await loadAdapter(true, () => ({ default: posthog }));
      await a.startAnalytics();
      calls.length = 0; // drop the init

      const send = () =>
        kind === "capture"
          ? a.captureKioskEvent(KioskEventName.SignInStarted, { n: 1 })
          : a.identifyKiosk("tenant-1", { tenant_id: "tenant-1" });
      expect(send).not.toThrow(); // the throwing call
      send();
      a.captureKioskEvent(KioskEventName.SignInFinished);

      expect(calls).toEqual([
        kind === "capture"
          ? ["capture", KioskEventName.SignInStarted, { n: 1 }]
          : ["identify", "tenant-1", { tenant_id: "tenant-1" }],
        ["capture", KioskEventName.SignInFinished, undefined],
      ]);
    }
  );
});
