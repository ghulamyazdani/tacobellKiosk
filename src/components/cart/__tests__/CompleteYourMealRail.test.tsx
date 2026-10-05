/* eslint-disable @typescript-eslint/no-explicit-any --
 * Entity-map fixtures mirror the untyped converted-menu entities the engine
 * consumes; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import CompleteYourMealRail from "../CompleteYourMealRail";
import "../../../i18n";

/** Converted-menu entityMap — only `isCartRecommended: true` entities count. */
const ENTITY_MAP = {
  fries: {
    id: "fries",
    name: "Large Fries",
    price: 2.5,
    calorieCount: 360,
    isActive: true,
    isCartRecommended: true,
  },
  pepsi: {
    id: "pepsi",
    name: "Pepsi",
    price: 3,
    isActive: true,
    isCartRecommended: true,
  },
  // Flagged but inactive → engine drops it.
  churros: {
    id: "churros",
    name: "Churros",
    price: 5,
    isActive: false,
    isCartRecommended: true,
  },
  // Not flagged → never offered.
  burger: { id: "burger", name: "Cheese Burger", price: 8, isActive: true },
};

const renderRail = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <CompleteYourMealRail />
      </MemoryRouter>
    </Provider>
  );

describe("CompleteYourMealRail (locked decision 6 — source-2 isCartRecommended engine)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
  });

  it("renders null with no entityMap at all", () => {
    renderRail();
    expect(screen.queryByTestId("bag-rail")).not.toBeInTheDocument();
  });

  it("renders null when no entity carries isCartRecommended", () => {
    store.dispatch(
      setEntityMap({ entityMap: { burger: ENTITY_MAP.burger } } as any)
    );
    renderRail();
    expect(screen.queryByTestId("bag-rail")).not.toBeInTheDocument();
  });

  it("flagged entities render as rail cards; unflagged and inactive ones never do", () => {
    store.dispatch(setEntityMap({ entityMap: ENTITY_MAP } as any));
    renderRail();
    const rail = screen.getByTestId("bag-rail");
    expect(rail).toBeInTheDocument();
    expect(screen.getByTestId("bag-rail-item-fries")).toHaveTextContent(
      "Large Fries"
    );
    expect(screen.getByTestId("bag-rail-item-fries")).toHaveTextContent("£2.5");
    expect(screen.getByTestId("bag-rail-item-pepsi")).toBeInTheDocument();
    expect(screen.queryByTestId("bag-rail-item-burger")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("bag-rail-item-churros")
    ).not.toBeInTheDocument();
  });

  it("entities already in the cart are filtered out of the rail", () => {
    store.dispatch(setEntityMap({ entityMap: ENTITY_MAP } as any));
    store.dispatch(
      setCartItems([
        {
          id: "fries",
          itemId: "fries-1",
          name: "Large Fries",
          quantity: 1,
          type: "ITEM",
          total_price: 2.5,
        },
      ])
    );
    renderRail();
    expect(screen.queryByTestId("bag-rail-item-fries")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-rail-item-pepsi")).toBeInTheDocument();
  });

  it("renders null when EVERY eligible entity is already in the cart (a rail that can render empty is a broken rail)", () => {
    store.dispatch(
      setEntityMap({
        entityMap: { fries: ENTITY_MAP.fries, pepsi: ENTITY_MAP.pepsi },
      } as any)
    );
    store.dispatch(
      setCartItems([
        {
          id: "fries",
          itemId: "fries-1",
          name: "Large Fries",
          quantity: 1,
          type: "ITEM",
          total_price: 2.5,
        },
        {
          id: "pepsi",
          itemId: "pep-1",
          name: "Pepsi",
          quantity: 1,
          type: "ITEM",
          total_price: 3,
        },
      ])
    );
    renderRail();
    expect(screen.queryByTestId("bag-rail")).not.toBeInTheDocument();
  });

  it("out-of-stock flagged entities are dropped by the engine", () => {
    store.dispatch(
      setEntityMap({
        entityMap: {
          fries: { ...ENTITY_MAP.fries, outOfStock: true },
          pepsi: ENTITY_MAP.pepsi,
        },
      } as any)
    );
    renderRail();
    expect(screen.queryByTestId("bag-rail-item-fries")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-rail-item-pepsi")).toBeInTheDocument();
  });
});
