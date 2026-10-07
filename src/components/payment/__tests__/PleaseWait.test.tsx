import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import {
  setEnableAccessibilityMode,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import PleaseWait from "../PleaseWait";
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

  it("arms no timer and writes nothing to the store (pure-CSS entrance, z-50, clipped not scrollable)", () => {
    vi.useFakeTimers();
    const dispatched = vi.fn();
    const unsubscribe = store.subscribe(dispatched);
    const view = mount();
    unsubscribe();

    expect(vi.getTimerCount()).toBe(0);
    expect(dispatched).not.toHaveBeenCalled();
    const root = screen.getByTestId("please-wait");
    expect(root).toHaveClass("tb-fade-in", "z-50", "overflow-clip");
    expect(root).not.toHaveClass("overflow-hidden", "tb-modal-enter");
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("normal layout: the bell, the card at 560", () => {
    mount();
    const root = screen.getByTestId("please-wait");
    expect(bell(root)).not.toBeNull();
    expect(root.querySelector(".top-\\[560px\\]")).not.toBeNull();
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
