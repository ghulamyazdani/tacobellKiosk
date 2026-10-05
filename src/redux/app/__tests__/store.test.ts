import { describe, expect, it, vi } from "vitest";
import {
  setLastBootAt,
  setLastRefreshFailedAt,
} from "@cx-sdk/devices/updates/autoUpdate.slice";
import { setDiscountOnAddon } from "@cx-sdk/catalog/state/appSettings.slice";
import { persistor, store } from "../store";
import { openConfigurationError } from "../../features/error/error.slice";

describe("kiosk store (createKioskStore wiring)", () => {
  it("registers the full posistKiosk reducer map (25 slices + api)", () => {
    const state = store.getState() as Record<string, unknown>;
    const expectedKeys = [
      "auth", "menu", "cart", "payment", "offer", "appSettings", "order",
      "menuSelections", "paymentInfo", "customerInfo", "appImage",
      "tableSummary", "pipeline", "theme", "multiLanguage", "timer",
      "makeItAMeal", "errorInfo", "loyalty", "dynamicPricing",
      "messageModals", "autoUpdate", "recommendation", "kioskOpenStatus",
      "filter", "api",
    ];
    for (const key of expectedKeys) {
      expect(state, `missing slice "${key}"`).toHaveProperty(key);
    }
  });

  it("RESET_STATE returns every slice to its initial state", () => {
    store.dispatch(openConfigurationError({ message: "boom" }));
    let errorInfo = (store.getState() as { errorInfo: { configurationError: { isOpen: boolean } } }).errorInfo;
    expect(errorInfo.configurationError.isOpen).toBe(true);

    store.dispatch({ type: "RESET_STATE" });
    errorInfo = (store.getState() as { errorInfo: { configurationError: { isOpen: boolean } } }).errorInfo;
    expect(errorInfo.configurationError.isOpen).toBe(false);
  });
});

/*
  P9e — a relaunch with a token goes straight to /start and never boots, so
  what the splash and the bill read from the last boot must be on disk:
  - autoUpdate.lastBootAt: the boot age the scheduled refresh keys on;
  - autoUpdate.lastRefreshFailedAt: a failed refresh's 30 min retry must
    survive a deploy reload or a power cycle;
  - appSettings.discountOnAddon: boot-derived (enable_dis_addon) and read by
    the order, offer and cart discount math — unpersisted it fell to false.
  The round trip is real: write, flush, then a fresh store (a new module
  instance) rehydrates from the same storage.
*/
describe("P9e persistence (device scope)", () => {
  type Persisted = {
    autoUpdate: { lastBootAt: number; lastRefreshFailedAt: number };
    appSettings: { discountOnAddon: boolean };
  };

  /** The persisted root, one JSON string per slice. */
  const onDisk = () => {
    const root = JSON.parse(window.localStorage.getItem("persist:root") ?? "{}") as Record<
      string,
      string
    >;
    return {
      autoUpdate: JSON.parse(root.autoUpdate ?? "{}") as Record<string, unknown>,
      appSettings: JSON.parse(root.appSettings ?? "{}") as Record<string, unknown>,
    };
  };

  const bootstrapped = (handle: { getState: () => { bootstrapped: boolean } }) =>
    vi.waitFor(() => expect(handle.getState().bootstrapped).toBe(true));

  it("RESET_STATE zeroes both stamps (0 = never), in memory and on disk", async () => {
    await bootstrapped(persistor);
    store.dispatch(setLastBootAt(1_780_000_000_000));
    store.dispatch(setLastRefreshFailedAt(1_780_000_600_000));

    store.dispatch({ type: "RESET_STATE" });
    await persistor.flush();

    const state = store.getState() as unknown as Persisted;
    expect(state.autoUpdate.lastBootAt).toBe(0);
    expect(state.autoUpdate.lastRefreshFailedAt).toBe(0);
    expect(onDisk().autoUpdate).toMatchObject({ lastBootAt: 0, lastRefreshFailedAt: 0 });
  });

  // Last in the file: it re-imports the store (a second instance on the same storage).
  it("lastBootAt, lastRefreshFailedAt and discountOnAddon survive a relaunch", async () => {
    await bootstrapped(persistor);
    store.dispatch(setLastBootAt(1_780_000_000_000));
    store.dispatch(setLastRefreshFailedAt(1_780_000_600_000));
    store.dispatch(setDiscountOnAddon(true));
    await persistor.flush();

    expect(onDisk().autoUpdate).toMatchObject({
      lastBootAt: 1_780_000_000_000,
      lastRefreshFailedAt: 1_780_000_600_000,
    });
    expect(onDisk().appSettings.discountOnAddon).toBe(true);
    // Control: the whitelist is real — the session-only flag is not on disk.
    expect(onDisk().autoUpdate).not.toHaveProperty("shouldWholeAppUpdate");

    // The relaunch: a brand-new store rehydrates from the same storage.
    vi.resetModules();
    const relaunched = await import("../store");
    await bootstrapped(relaunched.persistor);
    const state = relaunched.store.getState() as unknown as Persisted;

    expect(state.autoUpdate.lastBootAt).toBe(1_780_000_000_000);
    expect(state.autoUpdate.lastRefreshFailedAt).toBe(1_780_000_600_000);
    expect(state.appSettings.discountOnAddon).toBe(true);
  });
});
