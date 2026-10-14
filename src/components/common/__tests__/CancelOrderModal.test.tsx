import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { KioskEventName } from "@cx-sdk/core";
import CancelOrderModal from "../CancelOrderModal";
import i18n from "../../../i18n";

/*
  audit-fixes B3 — the confirm-cancellation modal reports the guest's answer
  (fork StartOverConfirmationModal): YES → StartOverAffirmFromFooter +
  KioskReset {reason: user_start_over, route_path} (IdleGuard's shape); NO
  and the backdrop → StartOverCancelFromFooter + AccountSignoutCancel. The
  events go out BEFORE the callbacks, and the modal still touches no redux
  (it renders without a store here).
*/

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

/** Events and callbacks, in the order they happened. */
let order: unknown[];
const onConfirm = vi.fn(() => order.push("onConfirm"));
const onCancel = vi.fn(() => order.push("onCancel"));

const mount = (open = true) =>
  render(<CancelOrderModal open={open} onConfirm={onConfirm} onCancel={onCancel} />);

describe("CancelOrderModal — the guest's answer is reported (audit-fixes B3)", () => {
  beforeEach(() => {
    order = [];
    mockCapture.mockReset();
    mockCapture.mockImplementation((event: string, props: unknown) => order.push([event, props]));
    onConfirm.mockClear();
    onCancel.mockClear();
    window.history.replaceState(null, "", "/menu");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("YES, CANCEL: StartOverAffirmFromFooter + KioskReset with the route, then onConfirm (once, no onCancel)", () => {
    mount();

    fireEvent.click(screen.getByTestId("cancel-order-confirm"));

    expect(order).toEqual([
      [KioskEventName.StartOverAffirmFromFooter, { route_path: "/menu" }],
      [KioskEventName.KioskReset, { reason: "user_start_over", route_path: "/menu" }],
      "onConfirm",
    ]);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("NO: StartOverCancelFromFooter + AccountSignoutCancel, then onCancel", () => {
    mount();

    fireEvent.click(screen.getByTestId("cancel-order-cancel"));

    expect(order).toEqual([
      [KioskEventName.StartOverCancelFromFooter, {}],
      [KioskEventName.AccountSignoutCancel, {}],
      "onCancel",
    ]);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the backdrop answers like NO", () => {
    mount();
    const [backdrop] = screen.getAllByRole("button", { name: i18n.t("cancelOrder.cancel") });
    expect(backdrop).not.toBe(screen.getByTestId("cancel-order-cancel"));

    fireEvent.click(backdrop);

    expect(order).toEqual([
      [KioskEventName.StartOverCancelFromFooter, {}],
      [KioskEventName.AccountSignoutCancel, {}],
      "onCancel",
    ]);
  });

  it("motion §3.1: YES, CANCEL presses to Figma's CTA Error red (#C02121); NO keeps its own press", () => {
    mount();
    expect(screen.getByTestId("cancel-order-confirm")).toHaveClass("bg-tb-red", "active:bg-tb-red-press");
    expect(screen.getByTestId("cancel-order-cancel")).not.toHaveClass("active:bg-tb-red-press");
  });

  // Walk 2026-10-14: focus moves into the dialog on the safe choice, so a
  // keypad Enter keeps the order (it stayed on the footer's CANCEL ORDER).
  it("focus starts on NO, BACK TO MENU — never YES, CANCEL ORDER", () => {
    mount();
    expect(screen.getByTestId("cancel-order-cancel")).toHaveFocus();
    expect(screen.getByTestId("cancel-order-confirm")).not.toHaveFocus();
  });

  // User 2026-10-14 ("the button should say back not back to menu"): a host
  // NO returns to that is not the menu names NO for what it does.
  it("NO says NO, BACK TO MENU by default; a host's keepLabel names NO and the backdrop, which still answer NO", () => {
    const menuHost = mount();
    expect(screen.getByTestId("cancel-order-cancel")).toHaveTextContent(i18n.t("cancelOrder.cancel"));
    menuHost.unmount();

    render(
      <CancelOrderModal open onConfirm={onConfirm} onCancel={onCancel} keepLabel={i18n.t("cancelOrder.back")} />
    );
    const no = screen.getByTestId("cancel-order-cancel");
    expect(no).toHaveTextContent(i18n.t("cancelOrder.back"));
    const [backdrop] = screen.getAllByRole("button", { name: i18n.t("cancelOrder.back") });
    expect(backdrop).not.toBe(no);
    fireEvent.click(backdrop);
    fireEvent.click(no);

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closed: nothing rendered, nothing reported", () => {
    const { container } = mount(false);

    expect(container).toBeEmptyDOMElement();
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
