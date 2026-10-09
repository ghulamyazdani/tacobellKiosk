import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { store } from "../../../redux/app/store";
import { notePath } from "../../../hooks/utils/usePageEnter";
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
    expect(
      screen.getByRole("alertdialog", {
        name: i18n.t("orderError.uncertainTitle"),
        description: i18n.t("orderError.uncertainMessage"),
      })
    ).toBe(panel);
    expect(panel).toHaveTextContent(i18n.t("orderError.uncertainTitle"));
    expect(panel).toHaveTextContent(i18n.t("orderError.uncertainMessage"));
    expect(panel).not.toHaveTextContent(i18n.t("orderError.message"));
  });

  it("after a clean, exhausted ladder: the ordinary copy", () => {
    mount();

    const panel = screen.getByTestId("order-error");
    expect(
      screen.getByRole("alertdialog", {
        name: i18n.t("orderError.title"),
        description: i18n.t("orderError.message"),
      })
    ).toBe(panel);
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

  it("the empty-name placeholder is 55 % black (P9f contrast: 35 % was 2.43:1)", () => {
    pay.failed = false;
    mount();

    const placeholder = screen.getByText(i18n.t("customerName.placeholder"));
    expect(placeholder).toHaveClass("text-black/55");
    expect(placeholder).not.toHaveClass("text-black/35");
  });
});

/*
  Lane motion (§2.3 / §2.7). The root's data-enter is latched at mount: none
  on a page load (POP), fwd on a PUSH, back on a PUSH to a screen already on
  the session trail (AppRoutes' notePath; seeded here). Only the content
  blocks carry tb-enter [--i]; BACK, the footer and the overlays never move.
*/
describe("/customerName — the route entrance (lane motion)", () => {
  /** A PUSH from another route: <Navigate> fires after the first commit. */
  const mountPushed = () =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/from"]}>
          <Routes>
            <Route path="/from" element={<Navigate to="/customerName" />} />
            <Route path="/customerName" element={<CustomerName />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  const root = () => screen.getByTestId("customer-name-screen");

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = false;
    pay.onTimeout = false;
    notePath("/start");
  });

  it("a page load (POP) mounts still; a PUSH arrives fwd; a PUSH back to a visited /customerName arrives back", () => {
    const pop = mount();
    expect(root()).not.toHaveAttribute("data-enter");
    pop.unmount();

    const pushed = mountPushed();
    expect(root()).toHaveAttribute("data-enter", "fwd");
    pushed.unmount();

    notePath("/customerName");
    notePath("/payment");
    mountPushed();
    expect(root()).toHaveAttribute("data-enter", "back");
  });

  it("tb-enter [--i] on the title, copy, field, CONTINUE and keyboard (0–4) — never BACK, the footer or the error panel", () => {
    pay.failed = true;
    mountPushed();
    const blocks = [...root().querySelectorAll(".tb-enter")];
    expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0", "1", "2", "3", "4"]);
    expect(blocks[2]).toContainElement(screen.getByTestId("customer-name-input"));
    expect(blocks[3]).toBe(screen.getByTestId("customer-name-continue"));
    for (const id of ["customer-name-back", "footer-cancel", "order-error"]) {
      expect(screen.getByTestId(id).closest(".tb-enter")).toBeNull();
    }
  });
});
