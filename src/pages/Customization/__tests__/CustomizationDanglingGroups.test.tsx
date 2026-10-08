import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { ErrorBoundary } from "../../../ErrorBoundary";
import Customization from "../index";
import "../../../i18n";

/*
  UB6 (2026-10-08, "Something went wrong" from the bag rail): an item can list
  a modifier-group id the menu's `modifiers` lacks. The PDP must open on the
  groups that exist. Before Fix A the seed loop read `group._id` off the
  resolver's undefined entry, and the app's global boundary (mounted here as
  in main.tsx) took the order down.
*/

const SAUCES = {
  _id: "pdp_sauce",
  name: "Sauces",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "salsa", name: "Salsa", price: 0.5, isActive: true }],
};
const GONE = "gone_1234567890_addons";

const openPdp = (modifiers: string[]) => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: { [SAUCES._id]: SAUCES } }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
      selectedEntity: { id: "fries", name: "Large Fries", price: 9, quantity: 1, modifiers },
    })
  );
  render(
    <ErrorBoundary>
      <Provider store={store}>
        <MemoryRouter initialEntries={["/customization"]}>
          <Routes>
            <Route path="/customization" element={<Customization />} />
            <Route path="/menu" element={<div>menu-screen</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    </ErrorBoundary>
  );
};

const cartRows = () =>
  (store.getState() as unknown as { cart: { cartItems: Array<{ id: string }> } }).cart.cartItems;

describe("PDP with a modifier-group id the menu does not have (UB6 Fix A)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the PDP's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("a live group plus a dangling one: opens on the live group, seeds only it, ADD TO BAG commits one row", () => {
    openPdp([SAUCES._id, GONE]);

    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
    expect(screen.getByTestId(`pdp-group-${SAUCES._id}`)).toBeInTheDocument();
    expect(tier1SelectedCustomization(store.getState())).toEqual({ [SAUCES._id]: [] });

    fireEvent.click(screen.getByTestId("pdp-add-to-bag"));

    expect(cartRows().map((row) => row.id)).toEqual(["fries"]);
    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
  });

  it("only a dangling group: opens with no groups, an empty seed, and ADD TO BAG commits the row", () => {
    openPdp([GONE]);

    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^pdp-group-/)).toEqual([]);
    expect(tier1SelectedCustomization(store.getState())).toEqual({});

    fireEvent.click(screen.getByTestId("pdp-add-to-bag"));

    expect(cartRows().map((row) => row.id)).toEqual(["fries"]);
  });
});
