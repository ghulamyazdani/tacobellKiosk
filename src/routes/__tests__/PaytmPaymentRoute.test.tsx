import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setBillPaymentInfo, setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { store } from "../../redux/app/store";
import i18n from "../../i18n";
import { KioskEventName } from "../../utils/analytics";
import PaytmPaymentRoute from "../PaytmPaymentRoute";

/*
  P8b × the P9f boot budget — /paymentPolling is a lazy chunk (paytmRuntime).
  Here: the chunk NEVER arrives. In a build, chunkRecovery prevents the
  preloadError WITHOUT a reload and the import resolves with no screen —
  modelled by a module whose default is missing (the dev server's rejected
  import is paytm.spec E19). Never blank: PleaseWait while it loads, then the
  staff panel (a named alertdialog) with the order's last 5; FINISH → /start,
  whose mount releases the session. A failure is not kept: the next mount
  loads again. The happy load is every paytm.spec case.
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

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  m.navigate.mockReset();
  m.capture.mockReset();
});

describe("PaytmPaymentRoute — the /paymentPolling chunk fails", () => {
  it("PleaseWait while loading, then the staff panel (never blank, never a reload); FINISH → /start; the next visit loads again", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    store.dispatch(setBillPaymentInfo({ posBillNo: "17280000000054321", posBillTime: Date.now() }));

    const view = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/paymentPolling"]}>
          <PaytmPaymentRoute />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByTestId("paytm-loading")).toHaveTextContent(i18n.t("paytm.wait.preparing"));

    const panel = await screen.findByRole("alertdialog", { name: i18n.t("paytm.unknown.title") });
    expect(panel).toHaveAccessibleDescription(i18n.t("paytm.unknown.message", { order: "54321" }));
    expect(screen.queryByTestId("paytm-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("paytm-screen")).not.toBeInTheDocument();
    expect(m.capture).toHaveBeenCalledTimes(1);
    expect(m.capture).toHaveBeenCalledWith(KioskEventName.ErrorOccurred, { error_source: "paytm_chunk" });

    act(() => {
      fireEvent.click(screen.getByTestId("paytm-unavailable-finish"));
    });
    expect(m.navigate).toHaveBeenCalledWith("/start");
    view.unmount();

    // The next visit tries the chunk again (and is never blank meanwhile).
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/paymentPolling"]}>
          <PaytmPaymentRoute />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByTestId("paytm-loading")).toBeInTheDocument();
    await screen.findByTestId("paytm-unavailable");
    expect(m.capture).toHaveBeenCalledTimes(2);
  });
});
