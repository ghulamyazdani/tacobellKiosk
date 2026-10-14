import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  applyOffer,
  cartQuantity,
  removeCartOffer,
  setCartItems,
} from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency, setDeploymentInfo } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../../cart/BagSheet";
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

/*
  Walk 2026-10-14 / user decision: the menu's "TOTAL:" read the pre-tax
  subtotal (﷼65.00) over a ﷼34.13 bag with a 50 % reward. It is the bag's
  own Total now — after rewards, taxes and round off — from the bag's bill
  (useCartBill), computed on the menu itself: live as items and rewards
  change, never 0 or stale before the bag has been opened. posistKiosk's
  MenuFooter prints it with moduloCalcaledValue: "£17.48", "£17".
*/
const VAT15 = { _id: "vat15", name: "VAT@ 15%", type: "percentage", value: 15, isGSTOSC: false, cascadingTaxes: [] };
/** 2 × £8.60, VAT 15 % exclusive (BagSheetTotals' Burrito). */
const BURRITO = {
  id: "burrito",
  itemId: "r-1",
  name: "Burrito",
  quantity: 2,
  type: "ITEM",
  price: 8.6,
  total_price: 8.6,
  taxes: [VAT15],
};
const FLAT_TWO = {
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
  isAvailable: true,
  applicable: { on: "complete", categories: [], items: [], isExclude: false, isInclude: false, rawItems: [] },
  buyItems: {},
  getItems: {},
};

const total = () => screen.getByTestId("cta-total").textContent;

describe("MenuCtaBar — TOTAL is the bag's Total", () => {
  it("with the bag never opened: the taxed total, then the reward, live — never the subtotal", () => {
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
    render(
      <Provider store={store}>
        <MenuCtaBar currency="£" onViewBag={vi.fn()} />
      </Provider>,
    );
    expect(total()).toBe("Total: £0");

    // £17.20 + VAT £2.58 (it showed the £17.20 subtotal).
    act(() => {
      store.dispatch(setCartItems([{ ...BURRITO }]));
    });
    expect(total()).toBe("Total: £19.78");

    // £17.20 − £2 = £15.20 + VAT £2.28.
    act(() => {
      store.dispatch(applyOffer({ offer: FLAT_TWO }));
    });
    expect(total()).toBe("Total: £17.48");

    act(() => {
      store.dispatch(removeCartOffer());
    });
    expect(total()).toBe("Total: £19.78");
  });

  it("the bag's round off applies too; a whole Total prints whole (posistKiosk's MenuFooter)", () => {
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setCartItems([{ ...BURRITO }]));
    store.dispatch(applyOffer({ offer: FLAT_TWO }));
    render(
      <Provider store={store}>
        <MenuCtaBar currency="£" onViewBag={vi.fn()} />
      </Provider>,
    );
    // £17.48 rounds to £17 — BagSheetTotals' "a £2 order offer on two rows".
    expect(total()).toBe("Total: £17");
  });

  // Rule 2: the bar is on screen all through the menu, so a row the bill
  // engine cannot price (a VARIANT row without its size) must never take the
  // menu down — the cart's own subtotal stands in.
  it("a row the engine cannot price: no crash — the cart subtotal stands in", () => {
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(
      setCartItems([{ id: "v", itemId: "v-1", name: "Sized", quantity: 2, type: "VARIANT", price: 4.5, total_price: 4.5 }]),
    );
    render(
      <Provider store={store}>
        <MenuCtaBar currency="£" onViewBag={vi.fn()} />
      </Provider>,
    );
    expect(total()).toBe("Total: £9");
  });

  it("agrees with the open bag's Total as rows and rewards change", () => {
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
    store.dispatch(setCartItems([{ ...BURRITO, quantity: 1 }]));
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <MenuCtaBar currency="£" onViewBag={vi.fn()} />
          <BagSheet open onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>,
    );
    const amount = (testId: string) => Number(screen.getByTestId(testId).textContent?.replace(/[^\d.]/g, ""));
    const agree = () => expect(amount("cta-total")).toBe(amount("bag-total"));

    agree();
    expect(amount("cta-total")).toBe(9.89);
    act(() => {
      store.dispatch(setCartItems([{ ...BURRITO, quantity: 3 }]));
    });
    agree();
    act(() => {
      store.dispatch(applyOffer({ offer: FLAT_TWO }));
    });
    agree();
    // £25.80 − £2 = £23.80 + VAT £3.57.
    expect(amount("cta-total")).toBe(27.37);
  });
});
