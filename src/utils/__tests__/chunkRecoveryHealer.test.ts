import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Lane figma-polish G2(a) — inside chunkRecovery's 60 s no-reload window (this
  page load is itself a fresh reload) a failed chunk must not reload again
  (a loop) and must not dead-end either: the listener calls the HEALER main.tsx
  registers once the store exists (setChunkFailureHealer → the whole-app
  update the splash applies at its next dwell, between guests). Outside the
  window nothing changed: it reloads (after any held work) and never heals.
  The optional runtime chunks do neither, and a missing or throwing healer
  can never throw out of the listener.

  Module state (the healer, the G2a latch, the reload hold) persists within a
  module instance, so every test loads a FRESH chunkRecovery and removes the
  listener it installed (chunkRecovery.test.ts keeps the shared-module cases).
*/

type ChunkRecovery = typeof import("../chunkRecovery");

const reload = vi.fn();
const replace = vi.fn();
let listener: EventListener | undefined;

/** A fresh module with its listener installed (and remembered for removal). */
const freshModule = async (): Promise<ChunkRecovery> => {
  vi.resetModules();
  const recovery = await import("../chunkRecovery");
  const add = vi.spyOn(window, "addEventListener");
  recovery.installChunkErrorRecovery();
  listener = add.mock.calls.find(([type]) => type === "vite:preloadError")?.[1] as EventListener;
  add.mockRestore();
  expect(listener).toBeTypeOf("function");
  return recovery;
};

/** What Vite's preload helper dispatches for a chunk that failed to load. */
const preloadErrorEvent = (message: string) => {
  const event = new Event("vite:preloadError", { cancelable: true });
  Object.assign(event, { payload: new Error(message) });
  return event;
};
const preloadError = (message: string) => {
  const event = preloadErrorEvent(message);
  window.dispatchEvent(event);
  return event;
};

const BAG_CHUNK = "Failed to fetch dynamically imported module: https://kiosk.example/assets/bagLazyParts-0ld.js";

/** This page load is a reload (`navigation.type`), `ageMs` old. */
const pageIs = (type: "reload" | "navigate", ageMs: number) => {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type } as unknown as PerformanceEntry]);
  vi.spyOn(performance, "now").mockReturnValue(ageMs);
};

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("chunkRecovery's healer (G2a)", () => {
  beforeEach(() => {
    reload.mockReset();
    replace.mockReset();
    vi.stubGlobal("location", { reload, replace });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (listener) window.removeEventListener("vite:preloadError", listener);
    listener = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("inside the window (a 'reload' entry, page < 60 s): handled, the registered healer runs once, never a reload", async () => {
    const { setChunkFailureHealer } = await freshModule();
    const heal = vi.fn();
    setChunkFailureHealer(heal);
    pageIs("reload", 59_999);

    const event = preloadError(BAG_CHUNK);

    expect(event.defaultPrevented).toBe(true);
    expect(heal).toHaveBeenCalledTimes(1);
    await flush();
    expect(reload).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ["a fresh page load ('navigate')", "navigate", 1_000],
    ["a reload exactly one window old", "reload", 60_000],
    ["a reload long past the window", "reload", 600_000],
  ] as const)("outside the window — %s: it reloads once and never calls the healer", async (_label, type, ageMs) => {
    const { setChunkFailureHealer } = await freshModule();
    const heal = vi.fn();
    setChunkFailureHealer(heal);
    pageIs(type, ageMs);

    const event = preloadError(BAG_CHUNK);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(heal).not.toHaveBeenCalled();
  });

  it("outside the window the reload still waits for held work (holdReloadsUntil) — and never heals meanwhile", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { holdReloadsUntil, setChunkFailureHealer } = await freshModule();
    const heal = vi.fn();
    setChunkFailureHealer(heal);
    pageIs("navigate", 120_000);
    let release!: () => void;
    holdReloadsUntil(new Promise<void>((resolve) => (release = resolve)));

    preloadError(BAG_CHUNK);
    await flush();
    expect(reload).not.toHaveBeenCalled();

    release();
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(heal).not.toHaveBeenCalled();
  });

  it.each([
    ["fcmRuntime", "Failed to fetch dynamically imported module: https://kiosk.example/assets/fcmRuntime-9ypKZIdg.js"],
    ["posthogRuntime", "Failed to fetch dynamically imported module: https://kiosk.example/assets/posthogRuntime-C3xq0Lr9.js"],
    ["paytmRuntime", "Failed to fetch dynamically imported module: https://kiosk.example/assets/paytmRuntime-DOoFgvtw.js"],
  ])("the optional %s chunk does neither — inside or outside the window", async (_chunk, message) => {
    const { setChunkFailureHealer } = await freshModule();
    const heal = vi.fn();
    setChunkFailureHealer(heal);

    pageIs("reload", 1_000);
    expect(preloadError(message).defaultPrevented).toBe(true);
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    pageIs("navigate", 120_000);
    expect(preloadError(message).defaultPrevented).toBe(true);

    await flush();
    expect(heal).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("no healer registered yet: inside the window nothing throws and nothing reloads", async () => {
    await freshModule();
    pageIs("reload", 1_000);
    const event = preloadErrorEvent(BAG_CHUNK);

    expect(() => listener?.(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("a throwing healer never escapes the listener; the next failure calls it again", async () => {
    const { setChunkFailureHealer } = await freshModule();
    const heal = vi.fn(() => {
      throw new Error("store gone");
    });
    setChunkFailureHealer(heal);
    pageIs("reload", 1_000);

    expect(() => listener?.(preloadErrorEvent(BAG_CHUNK))).not.toThrow();
    expect(() => listener?.(preloadErrorEvent(BAG_CHUNK))).not.toThrow();

    expect(heal).toHaveBeenCalledTimes(2);
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("the latest registration wins (main.tsx registers once; a re-registration replaces it)", async () => {
    const { setChunkFailureHealer } = await freshModule();
    const first = vi.fn();
    const second = vi.fn();
    setChunkFailureHealer(first);
    setChunkFailureHealer(second);
    pageIs("reload", 1_000);

    preloadError(BAG_CHUNK);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
