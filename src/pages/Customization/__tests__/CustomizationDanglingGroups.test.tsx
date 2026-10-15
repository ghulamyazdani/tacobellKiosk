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

const openPdp = (modifiers: string[], groups: Record<string, unknown> = {}) => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: { [SAUCES._id]: SAUCES, ...groups } }));
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
  (store.getState() as unknown as { cart: { cartItems: Array<{ id: string; customizations?: unknown }> } }).cart
    .cartItems;

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

/*
  User decision 2026-10-15 ("PAY skips inactive groups") — ONE rule for which
  groups count: isActive true. The PDP shows only those
  (convertModifiersAccordingly), so it seeds only those: a group switched off,
  or with no isActive key, is never seeded — never checked at ADD TO BAG (a
  required one was a dead end, refused under a group the guest cannot see)
  and never in the row (a default in it was ordered unseen).
*/
describe("PDP: a group it does not show is never seeded (user decision 2026-10-15)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  const hidden = (id: string, bounds: Record<string, unknown>, option: Record<string, unknown>) => {
    const { isActive: _isActive, ...group } = { ...SAUCES, _id: id, name: id, ...bounds, constituentItems: [option] };
    return group;
  };
  const REQUIRED = hidden("pdp_required", { min: 1, max: 1, multiplePunchMin: 1, multiplePunchMax: 1 }, { id: "must", name: "Must", price: 0, isActive: true });
  const WITH_DEFAULT = hidden("pdp_default", {}, { id: "extra", name: "Extra", price: 2, isActive: true, isDefault: true });

  it.each([
    ["switched off", { isActive: false }],
    ["with no isActive key", {}],
  ])("a required group and a group with a default, %s: neither shown nor seeded; ADD TO BAG commits the row without them", (_label, flag) => {
    openPdp([SAUCES._id, REQUIRED._id, WITH_DEFAULT._id], {
      [REQUIRED._id]: { ...REQUIRED, ...flag },
      [WITH_DEFAULT._id]: { ...WITH_DEFAULT, ...flag },
    });

    expect(screen.queryAllByTestId(/^pdp-group-/).map((node) => node.dataset.testid)).toEqual([`pdp-group-${SAUCES._id}`]);
    expect(tier1SelectedCustomization(store.getState())).toEqual({ [SAUCES._id]: [] });

    fireEvent.click(screen.getByTestId("pdp-add-to-bag"));

    expect(cartRows().map((row) => row.id)).toEqual(["fries"]);
    expect(cartRows()[0].customizations).toEqual({ [SAUCES._id]: [] });
  });
});
