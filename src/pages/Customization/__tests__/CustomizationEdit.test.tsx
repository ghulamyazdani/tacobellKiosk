/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart-row / group fixtures mirror the untyped legacy converters + slices;
 * typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  openMakeItAMealModal,
  openMakeItAMealSession,
  openTier1Modal,
  setTeir1SelectedEntity,
  setTier1BottomSheet,
  setTier1SelectedCustomization,
  setIsForceOpenMakeItAMealModal,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setSelectedEntity } from "../../../redux/features/menuSelections/menuSelections.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import "../../../i18n";

/** Optional addon group (min 0 / max 2) — the edit must NOT reseed defaults. */
const SAUCE_GROUP = {
  _id: "sauce_group",
  name: "Sauces",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "onions", name: "Add Onions", price: 0.6, isActive: true },
    // isDefault on the UNSELECTED option: if the edit branch wrongly reseeded
    // defaults, cheese would show selected and the assertions below fail.
    { id: "cheese", name: "Extra Cheese", price: 1.2, isActive: true, isDefault: true },
  ],
};

/** The bag row being edited — customized with onions only (NOT the default). */
const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 8.6,
  customizations: {
    sauce_group: [{ id: "onions", name: "Add Onions", price: 0.6, quantity: 1 }],
  },
  baseItem: {
    id: "cheese-burger",
    name: "Cheese Burger",
    price: 8,
    modifiers: ["sauce_group"],
  },
  modifiers: ["sauce_group"],
};

/**
 * BagSheet.handleEditRow's exact contract-B1 recipe (CUSTOMIZABLE flavor) —
 * dispatched here the way the sheet dispatches it before navigating to the
 * PDP with direction:"cart".
 */
const seedEditSession = (row: any = BURGER_ROW) => {
  store.dispatch(setModifiersMap({ modifiersMap: { sauce_group: SAUCE_GROUP } }));
  store.dispatch(setCartItems([{ ...row }]));
  store.dispatch(
    openMakeItAMealModal({ isOpen: false, selectedItem: {}, availableCombos: [] })
  );
  store.dispatch(openMakeItAMealSession());
  store.dispatch(openTier1Modal());
  store.dispatch(
    setTeir1SelectedEntity({
      ...row,
      itemId: row.itemId,
      quantity: row.quantity,
      subcategoryId: row.subCategoryId,
    })
  );
  store.dispatch(
    setTier1BottomSheet({
      isOpen: true,
      type: "customizableItem",
      status: "customizableItem",
      openType: "edit",
      editCustomizationContent: row,
    })
  );
  store.dispatch(setTier1SelectedCustomization(row.customizations));
  store.dispatch(setSelectedEntity({ ...row.baseItem, itemId: row.itemId }));
  store.dispatch(setIsForceOpenMakeItAMealModal(false));
};

const renderEditPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[
          { pathname: "/customization", state: { direction: "cart" } },
        ]}
      >
        <Customization />
      </MemoryRouter>
    </Provider>
  );

const cartState = () => (store.getState() as any).cart;

describe("Customization edit-from-bag branch (contract B1)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the min/max error path auto-scrolls.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("opens with the row's selections pre-applied and defaults NOT reseeded over them", () => {
    seedEditSession();
    renderEditPdp();
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-group-sauce_group")).toHaveTextContent("Sauces");
    // The row's own selection is pre-applied…
    expect(screen.getByTestId("pdp-option-onions").className).toContain(
      "border-tb-purple"
    );
    // …and the group's isDefault option was NOT seeded on top (edit branch
    // must never reseed defaults — contract B1).
    expect(screen.getByTestId("pdp-option-cheese").className).not.toContain(
      "border-tb-purple"
    );
  });

  it('CTA label reads UPDATE (t("bag.update")) instead of ADD TO BAG while editing', () => {
    seedEditSession();
    renderEditPdp();
    const cta = screen.getByTestId("pdp-add-to-bag");
    expect(cta).toHaveTextContent(/update/i);
    expect(cta).not.toHaveTextContent(/add to bag/i);
  });

  it("commit routes through updateItemCartRdx: the row is REPLACED, never duplicated", async () => {
    seedEditSession();
    renderEditPdp();
    // Change the selection: add the second sauce.
    await userEvent.click(screen.getByTestId("pdp-option-cheese"));
    await userEvent.click(screen.getByTestId("pdp-add-to-bag"));

    const items = cartState().cartItems;
    // THE assertion of trap 2: itemId survived into the commit payload, so
    // the reducer matched and replaced — one row, not two.
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("cb-1");
    expect(items[0].type).toBe("CUSTOMIZABLE");
    const sauces = items[0].customizations.sauce_group.map((s: any) => s.id);
    expect(sauces).toContain("onions");
    expect(sauces).toContain("cheese");
    // total_price recomputed: 8 base + 0.60 + 1.20 addons.
    expect(items[0].total_price).toBeCloseTo(9.8, 2);
    expect(cartState().totalQuantity).toBe(1);
  });

  it("commit with UNCHANGED selections still updates in place (no duplicate, same addon set)", async () => {
    seedEditSession();
    renderEditPdp();
    await userEvent.click(screen.getByTestId("pdp-add-to-bag"));
    const items = cartState().cartItems;
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("cb-1");
    expect(items[0].customizations.sauce_group.map((s: any) => s.id)).toEqual([
      "onions",
    ]);
    expect(items[0].total_price).toBeCloseTo(8.6, 2);
  });

  it("preserves a qty>1 row's quantity on UPDATE (no collapse to 1)", async () => {
    seedEditSession({ ...BURGER_ROW, quantity: 2, total_price: 8.6 });
    renderEditPdp();
    expect(screen.getByTestId("pdp-qty")).toHaveTextContent("2");
    await userEvent.click(screen.getByTestId("pdp-add-to-bag"));
    const items = cartState().cartItems;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });
});
