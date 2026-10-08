/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offer/MIAM fixtures mirror the untyped SDK slices (RewardsSheet.test.tsx and
 * MakeItAMealPrompt.test.tsx parity). Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { openMakeItAMealModal } from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../redux/app/store";
import MakeItAMealPrompt from "../components/makeItAMeal/MakeItAMealPrompt";
import RewardsSheet from "../components/offer/RewardsSheet";
import "../i18n";

/*
 * UB6 review F1: Fix A stopped the PDP crash, so a pack whose groups are ALL
 * missing (the menu converter drops it) would open an empty builder and sell
 * at the full pack price from the two PAID raw-map paths — the Make It A Meal
 * prompt and the offer buy stage. Both must offer only what the menu sells.
 */
const DEAD_PACK = {
  id: "deadmeal",
  name: "Dead Meal",
  price: 25,
  isActive: true,
  outOfStock: false,
  modifiers: ["dm_1_combo", "dm_2_combo"],
};
/** Every group missing: the menu sells it as a one-tap item. */
const DEAD_PLAIN = {
  id: "nachos",
  name: "Nachos",
  price: 4,
  isActive: true,
  outOfStock: false,
  modifiers: ["gone_grp"],
};

const cartItems = () => (store.getState() as any).cart.cartItems ?? [];

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: {} }));
});

describe("UB6 F1 — the MIAM prompt never offers a dead pack", () => {
  it("drops the dead pack; a dead plain upsell adds in one tap like the menu", async () => {
    const burrito = {
      id: "burrito",
      name: "Burrito",
      price: 6,
      upsellItems: [DEAD_PACK, DEAD_PLAIN],
    };
    store.dispatch(
      openMakeItAMealModal({
        isOpen: true,
        selectedItem: burrito,
        availableCombos: burrito.upsellItems,
      })
    );
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/menu"]}>
          <MakeItAMealPrompt />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByTestId("miam-combo-deadmeal")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("miam-combo-nachos"));
    expect(cartItems()).toEqual([
      expect.objectContaining({ id: "nachos", type: "ITEM", total_price: 4 }),
    ]);
  });
});

describe("UB6 F1 — the offer buy stage never offers a dead pack", () => {
  const offerBase = {
    isAvailable: true,
    isComplimentary: false,
    autoApplied: false,
    sameOrLess: false,
    getItemOnly: false,
    getLeastValueItem: false,
    buygetItemOnly: false,
    buygetGroupWiseOffer: false,
    dynamicItemExpressOffer: false,
    minBillAmount: null,
    minItemCount: null,
    maxDiscount: null,
    isAndOffer: true,
    type: { name: "item", value: 0 },
    buyItems: {},
    itemQuantities: [],
    leastItemValueCount: { buyQuantity: null, getQuantity: null },
    getItems: {
      items: [
        {
          _id: "gi-dressing",
          baseItemId: "dressing",
          name: "Dressing",
          relation: "and",
          discountType: "percent",
          value: 100,
          quantity: 1,
          entities: { id: "dressing", name: "Dressing", price: 2, modifiers: [] },
        },
      ],
      categories: [],
    },
  };
  /** Buy one `baseItemId` (not in the cart) → a locked bogoBuySide row. */
  const buyOne = (baseItemId: string) => ({
    ...offerBase,
    _id: `offer-${baseItemId}`,
    name: `Buy a ${baseItemId}`,
    applicable: {
      on: "complete",
      categories: [],
      items: [],
      isExclude: false,
      isInclude: false,
      rawItems: [{ item: { baseItemId, name: baseItemId }, quantity: 1, relation: "and" }],
    },
  });

  it("the dead-pack row stays inert; the dead plain item's tile is one-tap", async () => {
    store.dispatch(setEntityMap({ entityMap: { deadmeal: DEAD_PACK, nachos: DEAD_PLAIN } }));
    store.dispatch(
      setCartItems([{ id: "burrito", itemId: "b-1", uniqueItemId: "b-1", quantity: 1, type: "ITEM", price: 6, total_price: 6 }])
    );
    store.dispatch(setFilteredOffers([buyOne("deadmeal"), buyOne("nachos")]));
    const onAddItems = vi.fn();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <RewardsSheet open onClose={vi.fn()} onNeedsPicker={vi.fn()} onAddItems={onAddItems} />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByTestId("offer-row-offer-deadmeal")).toBeInTheDocument();
    expect(screen.queryByTestId("offer-row-add-items-offer-deadmeal")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("offer-row-add-items-offer-nachos"));
    const view = onAddItems.mock.calls[0]?.[1] as any;
    expect(view.groups[0].entities[0]).toMatchObject({ id: "nachos", modifiers: [] });
  });
});
