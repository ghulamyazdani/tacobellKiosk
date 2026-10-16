import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import ActivityCenter from "../ActivityCenter";
import "../../../i18n";

/*
  Perf ENTRY-2 — once the Activity Center has opened in this page load its
  code is cached (loadedActivityModal), and every later splash or boot screen
  mounts ActivityCenter closed. Until that visit's first open it renders
  nothing: the modal (the real one holds ~25 store subscriptions) is not
  mounted. Once opened it stays mounted while closed, as before, so its own
  state survives a close and reopen.
*/

const { modalRenders } = vi.hoisted(() => ({ modalRenders: vi.fn() }));

// The code already arrived (an earlier open). The probe is shaped like the
// real modal: its hooks (a store subscription, local state) first, then null
// while closed.
vi.mock("../loadActivityModal", async () => {
  const { useState } = await import("react");
  const { useSelector } = await import("react-redux");
  const { selectCart } = await import("@cx-sdk/ordering/state/cart.slice");
  function ActivityModalProbe({ isOpen }: { isOpen: boolean }) {
    useSelector(selectCart);
    const [step, setStep] = useState("info");
    modalRenders(isOpen);
    if (!isOpen) return null;
    return (
      <div data-testid="activity-modal">
        {step}
        <button type="button" onClick={() => setStep("passcode")}>
          disable fullscreen
        </button>
      </div>
    );
  }
  return {
    loadedActivityModal: () => ActivityModalProbe,
    loadActivityModal: () => Promise.resolve(ActivityModalProbe),
  };
});

const ui = (isOpen: boolean) => (
  <Provider store={store}>
    <ActivityCenter isOpen={isOpen} onClose={() => {}} />
  </Provider>
);
const cartWrite = (quantity: number) =>
  act(() => {
    store.dispatch(
      setCartItems([{ id: "fries", itemId: "f-1", name: "Large Fries", quantity, type: "ITEM", price: 2.5, total_price: 2.5 }])
    );
  });

describe("ActivityCenter — no modal until the visit's first open, its code at hand (perf ENTRY-2)", () => {
  it("unopened: no modal render, a store write renders none; opened: its state survives a close and reopen", () => {
    const view = render(ui(false));
    cartWrite(1);
    expect(modalRenders).not.toHaveBeenCalled();
    expect(view.container).toBeEmptyDOMElement();

    view.rerender(ui(true));
    expect(screen.getByTestId("activity-modal")).toHaveTextContent("info");
    fireEvent.click(screen.getByRole("button", { name: "disable fullscreen" }));
    expect(screen.getByTestId("activity-modal")).toHaveTextContent("passcode");

    view.rerender(ui(false));
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(ui(true));
    expect(screen.getByTestId("activity-modal")).toHaveTextContent("passcode");
  });
});
