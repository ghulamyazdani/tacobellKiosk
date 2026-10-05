import { act, render } from "@testing-library/react";
import { CookiesProvider } from "react-cookie";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setToken } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../../redux/app/store";
import { PWAUpdateHandler } from "../PWAUpdateHandler";

/*
  P9e (D8) — the build-version report's token gate. The fork reported on
  mount, so Registration POSTed "Bearer undefined" (a 401 that de-registered
  nothing only by luck) and a fresh registration waited for the next reload.
  Now it fires once per token per page load: none without a token, one right
  after registration (no reload), one under StrictMode's double effects, and
  again only for a NEW token. The token is the app's own resolution (cookie,
  else redux). jsdom has no navigator.serviceWorker, so the SW poller returns
  early and the gate is isolated.
*/

const { report, flag } = vi.hoisted(() => ({
  report: vi.fn<() => Promise<void>>(),
  flag: vi.fn(),
}));

vi.mock("../../../hooks/autoUpdates/useAutoUpdate", () => ({
  default: () => ({
    checkAndUpdateDeviceVersionDeviceWise: report,
    setAutoUpdateOnNextStartOver: flag,
  }),
}));

const ui = () => (
  <CookiesProvider>
    <Provider store={store}>
      <PWAUpdateHandler />
    </Provider>
  </CookiesProvider>
);

const clearTokenCookie = () => {
  document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
};

const signIn = (token: string | null) =>
  act(() => {
    store.dispatch(setToken(token));
  });

describe("PWAUpdateHandler — the version report's token gate (P9e D8)", () => {
  beforeEach(() => {
    report.mockReset();
    report.mockResolvedValue(undefined);
    flag.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    clearTokenCookie();
  });

  afterEach(() => {
    clearTokenCookie();
  });

  it("precondition: jsdom has no service worker, so only the gate is under test", () => {
    expect("serviceWorker" in navigator).toBe(false);
  });

  it("no token at all (Registration) → no report: never 'Bearer undefined'", () => {
    render(ui());

    expect(report).not.toHaveBeenCalled();
    expect(flag).not.toHaveBeenCalled();
  });

  it("registration without a reload: the token arrives after mount → exactly one report", () => {
    const view = render(ui());
    expect(report).not.toHaveBeenCalled();

    signIn("t1");
    expect(report).toHaveBeenCalledTimes(1);

    view.rerender(ui());
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("StrictMode (double-invoked effects) with a token at mount → exactly one report", () => {
    signIn("t1");

    render(ui(), { reactStrictMode: true });

    expect(report).toHaveBeenCalledTimes(1);
  });

  it("re-renders with the same token never report again", () => {
    signIn("t1");
    const view = render(ui());

    view.rerender(ui());
    view.rerender(ui());

    expect(report).toHaveBeenCalledTimes(1);
  });

  it("a NEW token (re-registration without a reload) reports again; a logout (no token) does not", () => {
    signIn("t1");
    render(ui());
    expect(report).toHaveBeenCalledTimes(1);

    signIn("t2");
    expect(report).toHaveBeenCalledTimes(2);

    signIn(null);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("a cookie-only token (redux empty, e.g. after a relaunch) → one report", () => {
    document.cookie = "token=c1; path=/";

    render(ui());

    expect(report).toHaveBeenCalledTimes(1);
  });

  it("a rejecting report never becomes an unhandled rejection", async () => {
    report.mockRejectedValue(new Error("boom"));
    signIn("t1");

    render(ui());
    await act(async () => {
      await Promise.resolve();
    });

    expect(report).toHaveBeenCalledTimes(1);
  });
});
