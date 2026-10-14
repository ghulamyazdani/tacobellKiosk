import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { cartQuantity, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import MenuCtaBar from "../MenuCtaBar";

/*
  Walk 2026-10-14: a bag of Latte, Cold Coffee, 5 Meat Medium and Chilli
  Manchurian ×2 read "VIEW MY BAG (4)" on the menu (cart rows) and "MY BAG (5)"
  in the bag (units). The bar now counts what the bag header counts:
  cartQuantity.
*/

const row = (id: string, quantity: number) => ({ id, itemId: `${id}-1`, name: id, total_price: 2.5, quantity });

afterEach(() => {
  store.dispatch({ type: "RESET_STATE" });
});

describe("MenuCtaBar — VIEW MY BAG (n)", () => {
  it("counts units, the bag header's cartQuantity: 4 rows, one of them ×2 → (5)", () => {
    render(
      <Provider store={store}>
        <MenuCtaBar currency="£" onViewBag={vi.fn()} />
      </Provider>,
    );
    expect(screen.getByTestId("cta-view-bag")).toHaveTextContent("(0)");

    act(() => {
      store.dispatch(setCartItems([row("latte", 1), row("cold-coffee", 1), row("meat", 1), row("chilli", 2)]));
    });

    expect(cartQuantity(store.getState())).toBe(5);
    expect(screen.getByTestId("cta-view-bag")).toHaveTextContent("(5)");
  });
});
