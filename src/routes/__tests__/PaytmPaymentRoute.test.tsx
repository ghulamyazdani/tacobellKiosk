import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setBillPaymentInfo, setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { selectShouldWholeAppUpdate } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { store } from "../../redux/app/store";
import i18n from "../../i18n";
import { KioskEventName } from "../../utils/analytics";
import { IdleHoldContext } from "../../hooks/utils/useIdleTimeout";
import PaytmPaymentRoute from "../PaytmPaymentRoute";

/*
  P8b × the P9f boot budget — /paymentPolling is a lazy chunk (paytmRuntime,
  loaded by loadPaytmScreen). A checkout reaches this route with the screen
  in hand (usePaytmCheckout loads it BEFORE the initiate); only a session
  resumed after a reload loads it here. Here: the chunk NEVER arrives. In a
  build, chunkRecovery prevents the preloadError WITHOUT a reload and the
  import resolves with no screen — modelled by a module whose default is
  missing (the dev server's rejected import is paytm.spec E19b). Never
  blank: PleaseWait while it loads, with idle HELD (the terminal may be
  armed); then the staff panel (a named alertdialog) with the order's last 5,
  idle released; FINISH → /start, whose mount releases the session. The
  failure flags the whole-app reload for the next splash: Chromium remembers
  a failed module fetch for the page's life, so only a reload heals it.
*/

const m = vi.hoisted(() => ({ navigate: vi.fn(), capture: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => m.navigate,
}));
vi.mock("../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/analytics")>()),
  captureKioskEvent: m.capture,
}));
vi.mock("../../pages/PaytmPayment/paytmRuntime", () => ({ default: undefined }));

const adjust = vi.fn<(delta: 1 | -1) => void>();
/** IdleGuard's hold counter, as the route drives it. */
const holds = () => adjust.mock.calls.reduce((sum, [delta]) => sum + delta, 0);

const mount = () =>
  render(
    <Provider store={store}>
      <IdleHoldContext.Provider value={adjust}>
        <MemoryRouter initialEntries={["/paymentPolling"]}>
          <PaytmPaymentRoute />
        </MemoryRouter>
      </IdleHoldContext.Provider>
    </Provider>,
  );

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  m.navigate.mockReset();
  m.capture.mockReset();
  adjust.mockReset();
});

describe("PaytmPaymentRoute — the /paymentPolling chunk fails", () => {
  it("PleaseWait (idle held) while loading, then the staff panel (idle released, never blank, never a reload) and the reload flagged for the next splash; FINISH → /start", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    store.dispatch(setBillPaymentInfo({ posBillNo: "17280000000054321", posBillTime: Date.now() }));
    expect(selectShouldWholeAppUpdate(store.getState())).toBe(false);

    const view = mount();
    expect(screen.getByTestId("paytm-loading")).toHaveTextContent(i18n.t("paytm.wait.preparing"));
    expect(holds()).toBe(1);

    const panel = await screen.findByRole("alertdialog", { name: i18n.t("paytm.unknown.title") });
    expect(panel).toHaveAccessibleDescription(i18n.t("paytm.unknown.message", { order: "54321" }));
    expect(screen.queryByTestId("paytm-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("paytm-screen")).not.toBeInTheDocument();
    // The panel is an end panel: idle covers it within the normal period.
    expect(holds()).toBe(0);
    expect(m.capture).toHaveBeenCalledTimes(1);
    expect(m.capture).toHaveBeenCalledWith(KioskEventName.ErrorOccurred, { error_source: "paytm_chunk" });
    expect(selectShouldWholeAppUpdate(store.getState())).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId("paytm-unavailable-finish"));
    });
    expect(m.navigate).toHaveBeenCalledWith("/start");
    view.unmount();

    // A later visit asks again (harmless: Chromium answers from its failure
    // cache) and is never blank meanwhile.
    mount();
    expect(screen.getByTestId("paytm-loading")).toBeInTheDocument();
    await screen.findByTestId("paytm-unavailable");
    expect(m.capture).toHaveBeenCalledTimes(2);
  });
});
