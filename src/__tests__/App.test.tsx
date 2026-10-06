import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { Provider } from "react-redux";
import { setAutenticationDetails } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../redux/app/store";
import App from "../App";

/*
  P9f — the shell's tenant identity goes through the lazy adapter's
  identifyKiosk (posthog-js is never imported statically). The payload is
  kept as is (user decision 2026-10-05): all six license fields, including
  license_key and login_code, and nothing at all before a tenant_id exists.
  Only the shell's identify effect is under test.
*/

const { identifyKiosk, loadCached } = vi.hoisted(() => ({
  identifyKiosk: vi.fn(),
  loadCached: vi.fn(() => Promise.resolve()),
}));

vi.mock("../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/analytics")>()),
  identifyKiosk,
}));
vi.mock("../routes", () => ({ AppRoutes: () => null }));
vi.mock("../components/autoUpdate/PWAUpdateHandler", () => ({
  PWAUpdateHandler: () => null,
}));
// Post-P9 29a: the shell's once-per-launch Dexie load. Stable callbacks, as
// the real hook's useCallback gives.
vi.mock("../hooks/recommendation/useTenantRecommendations", () => {
  const api = { refresh: () => Promise.resolve(), loadCached };
  return { default: () => api };
});

const LICENSE = {
  tenant_id: "tenant-42",
  login_code: "TB-LOGIN-1",
  license_key: "lk-123",
  deployment_id: "dep-9",
  type: "kiosk",
  expiry_date: "2027-01-01",
};

const renderApp = (options: { reactStrictMode?: boolean } = {}) =>
  render(
    <Provider store={store}>
      <App />
    </Provider>,
    options
  );

describe("App — analytics identity (P9f)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    identifyKiosk.mockReset();
  });

  it("identifies the kiosk once, by tenant_id, with all six license fields", () => {
    store.dispatch(
      setAutenticationDetails({ deploymentDetails: {}, licenseDetails: { ...LICENSE, extra: "not sent" } })
    );
    renderApp();

    expect(identifyKiosk).toHaveBeenCalledTimes(1);
    expect(identifyKiosk).toHaveBeenCalledWith("tenant-42", {
      login_code: "TB-LOGIN-1",
      license_key: "lk-123",
      deployment_id: "dep-9",
      type: "kiosk",
      expiry_date: "2027-01-01",
      tenant_id: "tenant-42",
    });
  });

  it("does not identify without a tenant_id, then identifies once one arrives (registered after boot)", () => {
    store.dispatch(
      setAutenticationDetails({ deploymentDetails: {}, licenseDetails: { ...LICENSE, tenant_id: undefined } })
    );
    renderApp();

    expect(identifyKiosk).not.toHaveBeenCalled();

    act(() => {
      store.dispatch(setAutenticationDetails({ deploymentDetails: {}, licenseDetails: LICENSE }));
    });
    expect(identifyKiosk).toHaveBeenCalledTimes(1);
    expect(identifyKiosk).toHaveBeenCalledWith("tenant-42", LICENSE);
  });
});

/*
  Post-P9 29a: a relaunch never boots (P9e), so the tenant recommendations'
  Dexie copy loads once per launch from the shell — exactly once, even under
  StrictMode's effect replay and across re-renders.
*/
describe("App — tenant recommendations cache (post-P9 29a)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    loadCached.mockClear();
  });

  it("loadCached runs once on mount (StrictMode replays the effect; the ref latch holds)", () => {
    renderApp({ reactStrictMode: true });

    expect(loadCached).toHaveBeenCalledTimes(1);
    expect(loadCached).toHaveBeenCalledWith();
  });

  it("re-renders never run it again", () => {
    renderApp();

    act(() => {
      store.dispatch(
        setAutenticationDetails({ deploymentDetails: {}, licenseDetails: LICENSE })
      );
    });

    expect(loadCached).toHaveBeenCalledTimes(1);
  });
});
