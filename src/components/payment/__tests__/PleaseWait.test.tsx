import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import {
  setEnableAccessibilityMode,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import PleaseWait from "../PleaseWait";
import ErrorModal from "../../common/ErrorModal";
import i18n from "../../../i18n";
import tbBell from "../../../assets/brand/tb-bell.svg";

/*
  PleaseWait (Figma 1:4456 = 1:6301): the full-page wait layer for the Paytm
  initiate (/receipt) and settle (/paymentPolling). Pure presentation — no
  timers, no store writes; its owner mounts and unmounts it.
*/

const mount = (ui = <PleaseWait />) => render(<Provider store={store}>{ui}</Provider>);
const bell = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("img")).find((img) => img.getAttribute("src") === tbBell) ?? null;

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PleaseWait", () => {
  it("a polite status region with the frame's title and default subtitle", () => {
    mount();
    const root = screen.getByTestId("please-wait");
    expect(root).toBe(screen.getByRole("status"));
    expect(root).toHaveAttribute("aria-live", "polite");
    expect(root).toHaveTextContent(i18n.t("paytm.wait.title"));
    expect(root).toHaveTextContent(i18n.t("paytm.wait.confirming"));
    expect(screen.getByRole("heading", { name: i18n.t("paytm.wait.title") })).toBeInTheDocument();
  });

  it("the subtitle and testId props replace the defaults", () => {
    mount(<PleaseWait subtitle={i18n.t("paytm.wait.preparing")} testId="paytm-preparing" />);
    const root = screen.getByTestId("paytm-preparing");
    expect(root).toHaveTextContent(i18n.t("paytm.wait.preparing"));
    expect(root).not.toHaveTextContent(i18n.t("paytm.wait.confirming"));
    expect(screen.queryByTestId("please-wait")).not.toBeInTheDocument();
  });

  // motion-v2 MV4: a full-screen status overlay reveals late (tb-reveal-late:
  // invisible for its first 300 ms, so a fast wait never flashes) while it
  // blocks taps from its first frame.
  it("arms no timer and writes nothing to the store (pure-CSS late reveal, z-50, clipped not scrollable)", () => {
    vi.useFakeTimers();
    const dispatched = vi.fn();
    const unsubscribe = store.subscribe(dispatched);
    const view = mount();
    unsubscribe();

    expect(vi.getTimerCount()).toBe(0);
    expect(dispatched).not.toHaveBeenCalled();
    const root = screen.getByTestId("please-wait");
    expect(root).toHaveClass("tb-reveal-late", "z-50", "overflow-clip");
    expect(root).not.toHaveClass("overflow-hidden", "tb-modal-enter", "tb-fade-in");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // motion-v2 review F1: in place of a dialog (TRY AGAIN, YES, CHECK AGAIN) the
  // layer shows at once — the dialog's 80 % scrim unmounts in the same commit,
  // and a layer still invisible would leave the screen bright, and dead to
  // taps, for 300 ms. Decided once, at mount: a later re-render (cancelling →
  // settling) never starts the reveal over a layer already on screen.
  it("in place of a dialog it shows at once, and stays so across re-renders", () => {
    function Owner() {
      const [phase, setPhase] = useState<"confirm" | "cancelling" | "settling">("confirm");
      return (
        <>
          {phase === "confirm" ? (
            <ErrorModal
              testId="confirm"
              title="Cancel?"
              primary={{ label: "YES", testId: "yes", onClick: () => setPhase("cancelling") }}
            />
          ) : (
            <PleaseWait subtitle={phase} />
          )}
          <button type="button" data-testid="settle" onClick={() => setPhase("settling")} />
        </>
      );
    }
    mount(<Owner />);
    fireEvent.click(screen.getByTestId("yes"));
    expect(screen.queryByTestId("confirm")).not.toBeInTheDocument();
    expect(screen.getByTestId("please-wait")).not.toHaveClass("tb-reveal-late");

    fireEvent.click(screen.getByTestId("settle"));
    expect(screen.getByTestId("please-wait")).toHaveTextContent("settling");
    expect(screen.getByTestId("please-wait")).not.toHaveClass("tb-reveal-late");
  });

  it("normal layout: the bell, the card at 560", () => {
    mount();
    const root = screen.getByTestId("please-wait");
    expect(bell(root)).not.toBeNull();
    expect(root.querySelector(".top-\\[560px\\]")).not.toBeNull();
  });

  it("motion §3.7: the hourglass (and only it) turns on the Figma Loader 1 loop", () => {
    mount();
    const turning = screen.getByTestId("please-wait").querySelectorAll(".tb-hourglass");
    expect(turning).toHaveLength(1);
    expect(turning[0].tagName).toBe("IMG");
    expect(turning[0].getAttribute("src")).toMatch(/hourglass/);
    expect(turning[0].closest("button")).toBeNull(); // a transform loop never sits on a tap target
  });

  it("ADA: the bell is dropped and the card sits at 161 in the reach zone", () => {
    store.dispatch(setEnableAccessibilityMode(true));
    store.dispatch(toggleAccessibilityMode());
    mount();
    const root = screen.getByTestId("please-wait");
    expect(bell(root)).toBeNull();
    expect(root.querySelector(".top-\\[161px\\]")).not.toBeNull();
    expect(root.querySelector(".top-\\[560px\\]")).toBeNull();
  });
});
