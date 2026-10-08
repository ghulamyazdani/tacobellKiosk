import { describe, expect, it, vi } from "vitest";
import {
  setLastBootAt,
  setLastRefreshFailedAt,
} from "@cx-sdk/devices/updates/autoUpdate.slice";
import { setDiscountOnAddon } from "@cx-sdk/catalog/state/appSettings.slice";
import { setPipelineStatuses } from "@cx-sdk/catalog/state/kioskOpenStatus.slice";
import {
  setBillPaymentInfo,
  setKioskPaymentType,
  setPaytmQrCode,
} from "@cx-sdk/payments/state/payment.slice";
import { persistor, store } from "../store";
import { openConfigurationError } from "../../features/error/error.slice";

/** The four dead slices audit-fixes C3 unregistered (0 dispatchers, 0 readers). */
const DEAD_SLICES = ["paymentInfo", "messageModals", "appImage", "tableSummary"];

/** The payment / auth whitelist fields C3 dropped (never written by TB). */
const DEAD_PAYMENT_FIELDS = [
  "PlutusTransactionReferenceID",
  "paymentInfo",
  "paymentSetting",
  "paytmMid",
  "parkedOrderId",
  "paymentLinkId",
  "isMashReqConnected",
  "dojoSessionInfo",
];
const DEAD_AUTH_FIELDS = ["userNumber", "selectedTabId"];

describe("kiosk store (createKioskStore wiring)", () => {
  it("registers TB's reducer map (22 slices + api) — the four dead slices are gone (C3)", () => {
    const state = store.getState() as Record<string, unknown>;
    const expectedKeys = [
      "auth", "menu", "cart", "payment", "offer", "appSettings", "order",
      "menuSelections", "customerInfo", "pipeline", "theme", "multiLanguage",
      "timer", "makeItAMeal", "errorInfo", "loyalty", "dynamicPricing",
      "autoUpdate", "recommendation", "kioskOpenStatus", "filter",
      "offerSession", "api",
    ];
    for (const key of expectedKeys) {
      expect(state, `missing slice "${key}"`).toHaveProperty(key);
    }
    for (const key of DEAD_SLICES) {
      expect(state, `dead slice "${key}" is registered`).not.toHaveProperty(key);
    }
    // Exactly these (redux-persist adds its own _persist key to the root).
    expect(Object.keys(state).filter((key) => key !== "_persist").sort()).toEqual(
      [...expectedKeys].sort()
    );
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

  /*
    audit-fixes C3: kioskOpenStatus persists through an explicit manifest (its
    only field, pipelinesStatuses — same bytes as the old full-slice leak):
    the bag's order-type switch reads it after a crash-reload and only /second
    re-fetches it. The dead payment / auth whitelist fields never reach disk.
  */
  it("persist:root holds kioskOpenStatus.pipelinesStatuses and none of the dead fields or slices", async () => {
    await bootstrapped(persistor);
    store.dispatch(setPipelineStatuses({ p1: { status: false }, p2: { status: true } }));
    store.dispatch(setKioskPaymentType({ type: "PaytmDynamicQr" }));
    store.dispatch(setBillPaymentInfo({ posBillNo: "17280000000001", posBillTime: 1_728_000_000_001 }));
    store.dispatch(setPaytmQrCode("upi://pay?pa=tb@paytm&am=9.00"));
    await persistor.flush();

    const root = JSON.parse(window.localStorage.getItem("persist:root") ?? "{}") as Record<
      string,
      string
    >;
    expect(JSON.parse(root.kioskOpenStatus ?? "{}")).toEqual({
      pipelinesStatuses: { p1: { status: false }, p2: { status: true } },
    });
    for (const key of DEAD_SLICES) {
      expect(root, `dead slice "${key}" on disk`).not.toHaveProperty(key);
    }
    const payment = JSON.parse(root.payment ?? "{}") as Record<string, unknown>;
    // The Paytm resume set stays (readOpenPaytmSession reads it after a reload)…
    expect(Object.keys(payment).sort()).toEqual(
      ["paymentType", "paytmQrCode", "posBillNo", "posBillTime"].sort()
    );
    // …and nothing else: no dead or credential field.
    for (const field of [...DEAD_PAYMENT_FIELDS, "paytmSecretKey"]) {
      expect(payment, field).not.toHaveProperty(field);
    }
    const auth = JSON.parse(root.auth ?? "{}") as Record<string, unknown>;
    for (const field of DEAD_AUTH_FIELDS) {
      expect(auth, field).not.toHaveProperty(field);
    }
    // UB5: the guest's country pick survives a crash-reload (the session
    // reset, not the persistence policy, ends it per guest).
    expect(auth).toHaveProperty("selectedCountryCode");
    // U2 relies on the operator toggle surviving a relaunch.
    expect(JSON.parse(root.appSettings ?? "{}")).toHaveProperty("mandatoryFullscreen");
  });

  // Last in the file: it re-imports the store (a second instance on the same storage).
  it("lastBootAt, lastRefreshFailedAt, discountOnAddon and kioskOpenStatus.pipelinesStatuses survive a relaunch", async () => {
    await bootstrapped(persistor);
    store.dispatch(setLastBootAt(1_780_000_000_000));
    store.dispatch(setLastRefreshFailedAt(1_780_000_600_000));
    store.dispatch(setDiscountOnAddon(true));
    store.dispatch(setPipelineStatuses({ "p-closed": { status: false } }));
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
    // C3: a closed target pipeline still reads closed after the reload.
    expect(
      (relaunched.store.getState() as unknown as { kioskOpenStatus: { pipelinesStatuses: unknown } })
        .kioskOpenStatus.pipelinesStatuses
    ).toEqual({ "p-closed": { status: false } });
  });
});
