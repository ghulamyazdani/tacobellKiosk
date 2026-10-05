import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { store } from "../../../redux/app/store";
import CustomerName from "../index";
import i18n from "../../../i18n";

/*
  P9b R4 (U2): /customerName (the zero-bill loyalty push) renders the same
  order-error panel as /receipt. The push itself is the hook's (pinned in
  usePayAtCounter.test and ReceiptPreference.test); here the hook is a stub
  so the panel's copy switch can be driven directly.
*/

const pay = vi.hoisted(() => ({
  failed: true,
  onTimeout: false,
  retry: vi.fn(),
  dismissError: vi.fn(),
}));

vi.mock("../../../hooks/paymentsHooks/usePayAtCounter", () => ({
  default: () => ({
    start: () => {},
    isBuffering: false,
    isPushing: false,
    hasFailed: pay.failed,
    failedOnTimeout: pay.failed && pay.onTimeout,
    retry: pay.retry,
    dismissError: pay.dismissError,
  }),
}));

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customerName"]}>
        <CustomerName />
      </MemoryRouter>
    </Provider>
  );

describe("/customerName order-error panel (P9b R4)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = true;
    pay.onTimeout = false;
    pay.retry.mockReset();
    pay.dismissError.mockReset();
  });

  it("after a timeout: the UNCERTAIN copy — never 'didn't reach the restaurant'", () => {
    pay.onTimeout = true;
    mount();

    const panel = screen.getByTestId("order-error");
    expect(panel).toHaveTextContent(i18n.t("orderError.uncertainTitle"));
    expect(panel).toHaveTextContent(i18n.t("orderError.uncertainMessage"));
    expect(panel).not.toHaveTextContent(i18n.t("orderError.message"));
  });

  it("after a clean, exhausted ladder: the ordinary copy", () => {
    mount();

    const panel = screen.getByTestId("order-error");
    expect(panel).toHaveTextContent(i18n.t("orderError.title"));
    expect(panel).toHaveTextContent(i18n.t("orderError.message"));
    expect(panel).not.toHaveTextContent(i18n.t("orderError.uncertainTitle"));
  });

  it("Retry goes back to the SAME hook instance (same order id) — no new push path", () => {
    pay.onTimeout = true;
    mount();

    fireEvent.click(screen.getByTestId("order-error-retry"));

    expect(pay.retry).toHaveBeenCalledTimes(1);
    expect(pay.dismissError).not.toHaveBeenCalled();
  });
});
