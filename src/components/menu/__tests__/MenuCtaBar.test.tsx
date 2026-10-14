import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  addItemToCartRdx,
  applyOffer,
  cartQuantity,
  decreaseItemQuantity,
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

/*
  Review 2026-10-14: the bag SETTLES the cart when it opens — revalidation
  drops a reward the cart no longer earns (its freebie rows too), and a
  least-value reward's free unit moves to the cheapest qualifying one. The
  TOTAL is that settled bag's Total from the start, the bag closed: never a
  stale lock (£15 over an £18 bag) nor a reward about to go (£0 over £5).
*/
const main = (id: string, price: number, quantity: number) => ({
  id,
  itemId: `row-${id}`,
  name: id,
  quantity,
  type: "ITEM",
  price,
  total_price: price,
  subCategoryId: "mains",
});
/** Buy any 2 mains, the cheapest one free (untaxed). */
const CHEAPEST_MAIN_FREE = {
  _id: "lv-mains",
  name: "Cheapest main free",
  type: { name: "item", value: 0 },
  getLeastValueItem: true,
  isAvailable: true,
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [{ category: { _id: "mains" } }],
  },
  buyItems: {},
  getItems: {},
  leastItemValueCount: { buyQuantity: 2, getQuantity: 1, getDiscount: 100 },
};
/** Buy a burger, a salad half price: the salad is a committed freebie row. */
const BURGER_HALF_SALAD = {
  _id: "bogo-burger",
  name: "Burger, a salad half price",
  type: { name: "item", value: 0 },
  isAvailable: true,
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [{ relation: "and", quantity: 1, item: { baseItemId: "burger" } }],
  },
  buyItems: {},
  getItems: { items: [] },
};
const HALF_PRICE_SALAD = {
  ...main("salad", 17, 1),
  undiscounted_total_price: 17,
  discounted_total_price: 8.5,
  discountType: "percent",
  discountValue: 50,
  isGetItem: true,
};

const cart = () =>
  (store.getState() as unknown as {
    cart: { cartOffer: { _id?: string }; lockedFreebieAllocation: Record<string, number> };
  }).cart;
const renderBar = () =>
  render(
    <Provider store={store}>
      <MenuCtaBar currency="£" onViewBag={vi.fn()} />
    </Provider>,
  );
const openBag = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );
const bagTotal = () => screen.getByTestId("bag-total").textContent;

describe("MenuCtaBar — TOTAL is the Total of the bag as it opens (settled)", () => {
  beforeEach(() => {
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
  });

  it("least-value: a cheaper main added on the menu takes the free unit — before the bag reconciles the lock", () => {
    store.dispatch(setCartItems([main("taco", 5, 2), main("burrito", 8, 1)]));
    store.dispatch(applyOffer({ offer: CHEAPEST_MAIN_FREE }));
    renderBar();
    // £10 + £8, a £5 taco free.
    expect(total()).toBe("Total: £13");

    act(() => {
      store.dispatch(addItemToCartRdx(main("drink", 2, 1)));
    });
    // The bag is closed, so the lock still frees a taco…
    expect(cart().lockedFreebieAllocation).toEqual({ "row-taco": 1 });
    // …but the TOTAL frees the £2 drink, as the bag will: £20 − £2.
    expect(total()).toBe("Total: £18");

    openBag();
    expect(cart().lockedFreebieAllocation).toEqual({ "row-drink": 1 });
    expect(bagTotal()).toBe("£18.00");
    expect(total()).toBe("Total: £18");
  });

  it("least-value: a decrement on the menu below the buy quantity never reads £0 — the reward the bag drops is out already", () => {
    store.dispatch(setCartItems([main("taco", 5, 1), main("burrito", 8, 1)]));
    store.dispatch(applyOffer({ offer: CHEAPEST_MAIN_FREE }));
    renderBar();
    expect(total()).toBe("Total: £8");

    act(() => {
      store.dispatch(decreaseItemQuantity({ id: "row-burrito", IDKEY: "itemId" }));
    });
    // Still applied (only the open bag drops it), still locked on the taco.
    expect(cart().cartOffer._id).toBe("lv-mains");
    expect(total()).toBe("Total: £5");

    openBag();
    expect(cart().cartOffer).toEqual({});
    expect(bagTotal()).toBe("£5.00");
  });

  it("any reward revalidation drops, with its freebie rows: the burger out, its half-price salad is not in the TOTAL", () => {
    store.dispatch(setCartItems([main("burger", 8, 1), main("drink", 3, 2), HALF_PRICE_SALAD]));
    store.dispatch(applyOffer({ offer: BURGER_HALF_SALAD }));
    renderBar();
    // £8 + £6 + the £17 salad at half price.
    expect(total()).toBe("Total: £22.50");

    act(() => {
      store.dispatch(decreaseItemQuantity({ id: "row-burger", IDKEY: "itemId" }));
    });
    expect(total()).toBe("Total: £6");

    openBag();
    expect(cart().cartOffer).toEqual({});
    expect(bagTotal()).toBe("£6.00");
  });
});
