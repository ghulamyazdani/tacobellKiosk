import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { CookiesProvider } from "react-cookie";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setAutenticationDetails } from "@cx-sdk/core/auth/authentication.slice";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../../redux/app/store";
import StartScreen from "../index";
import "../../../i18n";

/*
  P9b R6: loyalty that degraded at boot is retried on each splash visit (a
  relaunch with a token never re-runs the boot). Once per visit, and applied
  only while the splash is still up — never switched on under a guest who
  already started ordering. The partner lookup is the RTK seam; the session
  teardown on this mount runs for real.
*/

const { partnerCalls, mockCapture } = vi.hoisted(() => ({
  partnerCalls: [] as {
    args: unknown;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }[],
  mockCapture: vi.fn(),
}));

vi.mock("@cx-sdk/ordering/services/loyaltyApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/ordering/services/loyaltyApi")>()),
  useGetLoyaltyPartnerMutation: () => [
    (args: unknown) => {
      const answer = new Promise((resolve, reject) => {
        partnerCalls.push({ args, resolve, reject });
      });
      return { unwrap: () => answer };
    },
  ],
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const PARTNER = {
  partner: { partner_name: "Xeno", partner_merchant_id: "xeno-merchant-uuid-1" },
  partnerDetails: { client_id: "xeno-client-1", partner_name: "Xeno" },
};

const renderStart = (options: { reactStrictMode?: boolean } = {}) =>
  render(
    <CookiesProvider>
      <Provider store={store}>
        <MemoryRouter initialEntries={["/start"]}>
          <Routes>
            <Route path="/start" element={<StartScreen />} />
            <Route path="/second" element={<div>second-screen</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    </CookiesProvider>,
    options
  );

const loyalty = () =>
  (store.getState() as { loyalty: { isLoyaltyOn: boolean; loyaltyPartner: unknown } })
    .loyalty;

/** Settle the splash's partner lookup. */
const answer = (settle: (call: (typeof partnerCalls)[number]) => void) =>
  act(async () => {
    settle(partnerCalls[0]);
  });

describe("StartScreen — retries a loyalty partner that failed at boot (P9b R6)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(
      setAutenticationDetails({ deploymentDetails: { _id: "dep-1" }, licenseDetails: {} })
    );
    partnerCalls.length = 0;
    mockCapture.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enabled but off: asks once for this deployment's partner and turns loyalty on", async () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    renderStart();

    expect(partnerCalls).toHaveLength(1);
    expect(partnerCalls[0].args).toEqual({ deployment_id: "dep-1" });

    await answer((call) => call.resolve(PARTNER));

    expect(loyalty().isLoyaltyOn).toBe(true);
    expect(loyalty().loyaltyPartner).toEqual(PARTNER);
  });

  it("once per visit — StrictMode's re-run asks nothing more", () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    renderStart({ reactStrictMode: true });

    expect(partnerCalls).toHaveLength(1);
  });

  it("an answer that arrives after the guest left the splash is dropped — loyalty never switches on mid-order", async () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    renderStart();

    fireEvent.click(screen.getByTestId("start-screen"));
    expect(screen.getByText("second-screen")).toBeInTheDocument();
    await answer((call) => call.resolve(PARTNER));

    expect(loyalty().isLoyaltyOn).toBe(false);
  });

  it("a failed retry stays loyalty-off, reports it, and throws nothing", async () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    renderStart();

    await answer((call) =>
      call.reject({ status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" })
    );

    expect(loyalty().isLoyaltyOn).toBe(false);
    expect(mockCapture).toHaveBeenCalledWith("error_occurred", {
      source: "loyalty_partner",
      stage: "splash_retry",
    });
  });

  it("an empty answer (no partner configured) leaves loyalty off", async () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    renderStart();

    await answer((call) => call.resolve(null));

    expect(loyalty().isLoyaltyOn).toBe(false);
  });

  it("loyalty already on: no request", () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    store.dispatch(setLoyaltyPartner(PARTNER));
    renderStart();

    expect(partnerCalls).toHaveLength(0);
    expect(loyalty().isLoyaltyOn).toBe(true);
  });

  it("loyalty not enabled for this kiosk: no request", () => {
    store.dispatch(setKioskSettings({ enable_loyalty: false }));
    renderStart();

    expect(partnerCalls).toHaveLength(0);
  });
});
