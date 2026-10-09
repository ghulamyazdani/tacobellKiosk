import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import { setRecommendationDetour } from "../../../redux/features/menuSelections/menuSelections.slice";
import DetourTapGuard from "../DetourTapGuard";

/*
  Lane added-modal, review R1 — a suggestion that needs a choice closes the
  product-added modal at once and Select a Size, the PDP or the repeat sheet
  takes its place under the finger, so the second tap of a double tap ticked
  a size, picked a paid option, opened a pack slot or closed the repeat sheet.
  The stage swallows taps for 500 ms from the detour's start
  (recommendationDetour false → true, set only by Menu.leaveAddedModal) —
  ReachZone's exit-guard pattern.
*/

const guard = () => screen.queryByTestId("detour-tap-guard");
const mount = () =>
  render(
    <Provider store={store}>
      <DetourTapGuard />
    </Provider>
  );
const setDetour = (on: boolean) =>
  act(() => {
    store.dispatch(setRecommendationDetour(on));
  });

describe("DetourTapGuard (review R1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a detour's start raises a transparent, hit-testable stage guard for 500 ms — its end inside the window does not lift it", () => {
    mount();
    expect(guard()).toBeNull();

    setDetour(true);

    const shield = guard();
    expect(shield).toHaveClass("absolute", "inset-0", "z-[58]");
    expect(shield?.className).not.toContain("pointer-events-none");
    expect(shield).toHaveAttribute("aria-hidden", "true");
    expect(shield).toBeEmptyDOMElement();

    // An exit inside the window (the size modal's X) changes nothing.
    setDetour(false);
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(guard()).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(guard()).toBeNull();
  });

  it("never armed by a flag already set at mount, nor by a detour ending", () => {
    store.dispatch(setRecommendationDetour(true));
    mount();
    expect(guard()).toBeNull();

    setDetour(false);
    expect(guard()).toBeNull();
  });

  it("clears its timer on unmount (Rule 5)", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = mount();

    setDetour(true);
    const index = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === 500);
    expect(index).toBeGreaterThanOrEqual(0);
    const timerId = setTimeoutSpy.mock.results[index].value;

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
  });
});
