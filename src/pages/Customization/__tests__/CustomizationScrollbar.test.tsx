import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  setCurrency,
  setEnableAccessibilityMode,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import "../../../i18n";

/*
  Post-P9 26 on the PDP: the Figma 1:5263 scroll indicator at 703/790
  (PDP 1:2920) and 488/394 in the ADA reach zone (1:5442), mounted right
  after the scroll pane as a child of the page root. The pane keeps its id —
  `#scrollCustomizableItem` is the SDK autoscroll contract — and hides its
  native bar.
*/

const BURGER = { id: "cheese-burger", name: "Cheese Burger", price: 8, modifiers: [] as string[] };

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Routes>
          <Route path="/customization" element={<Customization />} />
          <Route path="/menu" element={<div>menu-screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

describe("PDP scroll indicator (post-P9 26)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the hook's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: {
          isOpen: true,
          status: "",
          type: "customizableItem",
          openType: "new",
          editCustomizationContent: {},
        },
        selectedEntity: BURGER,
      })
    );
  });

  it("pdp-scrollbar sits at 703 / 790, right after #scrollCustomizableItem, a child of the page root", () => {
    renderPdp();
    const bar = screen.getByTestId("pdp-scrollbar");
    const scroller = document.getElementById("scrollCustomizableItem");

    expect(bar.style.top).toBe("703px");
    expect(bar.style.height).toBe("790px");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(scroller).not.toBeNull();
    expect(bar.previousElementSibling).toBe(scroller);
    expect(bar.parentElement).toBe(screen.getByTestId("customization-screen"));
    expect(screen.getByTestId("pdp-scrollbar-thumb")).toBeInTheDocument();
  });

  it("ADA on: 488 / 394 on the same node (no remount)", () => {
    renderPdp();
    const bar = screen.getByTestId("pdp-scrollbar");

    act(() => {
      store.dispatch(setEnableAccessibilityMode(true));
      store.dispatch(toggleAccessibilityMode());
    });

    expect(screen.getByTestId("pdp-scrollbar")).toBe(bar);
    expect(bar.style.top).toBe("488px");
    expect(bar.style.height).toBe("394px");
  });

  it("#scrollCustomizableItem is kept — still the scroll pane — and hides its native scrollbar", () => {
    renderPdp();
    const scroller = document.getElementById("scrollCustomizableItem");

    expect(scroller).toHaveClass("overflow-y-auto", "[scrollbar-width:none]", "[&::-webkit-scrollbar]:hidden");
    expect(scroller).toContainElement(screen.getByRole("heading", { level: 1 }));
  });
});
