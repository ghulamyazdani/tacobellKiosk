/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart-row fixtures and bills flow through untyped from the legacy cart
 * slice / bill engine (useCartBill's own header). Do not add NEW anys.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Provider, useSelector } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { getCalculatedBill } from "@cx-sdk/ordering/order/orderBuilder";
import { settleCart } from "@cx-sdk/ordering/offer/offerRevalidation";
import {
  addGetItemsRdx,
  addItemToCartRdx,
  applyOffer,
  closeOfferModal,
  closeOfferRemovalModal,
  closeRepeatItemBottomSheet,
  decreaseItemQuantity,
  emptyGetItemsState,
  increaseItemQuantity,
  openOfferModal,
  openOfferRemovalModal,
  pushCharges,
  reconcileFreebieAllocation,
  removeCartOffer,
  removeItemFromCart,
  selectCart,
  setAmount,
  setCartInstructions,
  setCartItems,
  setMenuCharges,
  setRepeatItemBottomSheet,
} from "@cx-sdk/ordering/state/cart.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import {
  setCurrency,
  setDeploymentInfo,
  setDiscountOnAddon,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setSelectedTabId } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../../../components/cart/BagSheet";
import MenuCtaBar from "../../../components/menu/MenuCtaBar";
import useCartBill from "../useCartBill";
import useCartTotal from "../useCartTotal";
import "../../../i18n";

/*
  Perf pass, lane bill-memo (BAG-1, MENU-2, REDUX-4, SDK-2; user decision M1
  2026-10-16): the bag's bill (useCartBill) and the menu's Total
  (useCartTotal) are keyed on the bill's INPUTS — the cart rows, its offer,
  the freebie lock, the charges, the tab, the settings, the add-on rule and
  the live offer — not on the cart object. A cart write that moves no money
  (the bag's own setAmount echo, a notice, the celebration, a sheet flag,
  freebie staging) runs no bill; every money write still runs exactly one.
  WHAT the bill computes is unchanged: after every write the memoised result
  equals a fresh mount's, to the bit.
*/

// Call-through spies: the real engine and the real settle run; they count.
vi.mock("@cx-sdk/ordering/order/orderBuilder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cx-sdk/ordering/order/orderBuilder")>();
  return { ...actual, getCalculatedBill: vi.fn(actual.getCalculatedBill) };
});
vi.mock("@cx-sdk/ordering/offer/offerRevalidation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cx-sdk/ordering/offer/offerRevalidation")>();
  return { ...actual, settleCart: vi.fn(actual.settleCart) };
});
const engine = vi.mocked(getCalculatedBill);
const settles = vi.mocked(settleCart);

/* Fixtures — the shapes the repo's suites price (sources named per row). */
const VAT15 = { _id: "vat15", name: "VAT@ 15%", type: "percentage", value: 15, isGSTOSC: false, cascadingTaxes: [] };
/** BagSheetTotals' Burrito: £8.60, VAT 15 % exclusive. */
const BURRITO = { id: "burrito", itemId: "r-1", name: "Burrito", quantity: 1, type: "ITEM", price: 8.6, total_price: 8.6, taxes: [VAT15] };
/** MenuCtaBar's mains (the least-value and BOGO offers' category). */
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
/** An add-on group (`_addons`: charged per unit of the row). */
const NACHOS = {
  ...main("nachos", 8, 1),
  type: "CUSTOMIZABLE",
  total_price: 8.8,
  taxes: [VAT15],
  customizations: { nachos_extras_addons: [{ id: "cheese", name: "Extra Cheese", price: 0.8, quantity: 1, taxes: [VAT15] }] },
};
/** BagItemRowNestedPrice's Kiddie Meal: a combo pick with its own add-on (charged: applyAddonsPrice). */
const KIDDIE = {
  id: "kiddie",
  itemId: "k-1",
  name: "Kiddie Meal",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 16,
  total_price: 19.5,
  applyAddonsPrice: true,
  taxes: [VAT15],
  customizations: {
    kiddie_snacks_combo: [
      {
        id: "fries",
        name: "Large Fries",
        price: 3,
        quantity: 1,
        taxes: [VAT15],
        customizations: { fries_salt_addons: [{ id: "no-salt", name: "No Salt", price: 0.5, quantity: 1, taxes: [] }] },
      },
    ],
  },
};
/** ProductAddedModal's parked size: a VARIANT row (£7, VAT 15 %). */
const LARGE = {
  id: "r-elsewhere",
  itemId: "p-large",
  name: "Elsewhere",
  type: "VARIANT",
  quantity: 1,
  price: 7,
  variantPrice: 7,
  total_price: 7,
  selectedVariant: { id: "v-large", name: "Large", price: 7 },
  taxes: [VAT15],
};
/** BagSheetTotals' redeemed 100 % XENO reward row. */
const REWARD = {
  id: "salad",
  itemId: "lr-1",
  name: "Greek Salad",
  quantity: 1,
  type: "ITEM",
  isLoyaltyItem: true,
  isRedeemed: true,
  discount_type: "percentage",
  discount_value: 100,
  price: 0,
  total_price: 0,
  undiscounted_price: 17,
  undiscounted_total_price: 17,
  customizations: {},
  taxes: [VAT15],
};
/** MenuCtaBar's "a row the engine cannot price": a size without its variant. */
const UNPRICEABLE = { id: "v", itemId: "v-1", name: "Sized", quantity: 2, type: "VARIANT", price: 4.5, total_price: 4.5 };
const COMPLETE = { on: "complete", categories: [], items: [], isExclude: false, isInclude: false, rawItems: [] };
/** BagSheetTotals' £2 off the order (amount). */
const FLAT_TWO = { _id: "offer-flat-2", name: "£2 off your order", type: { name: "amount", value: 2 }, isAvailable: true, applicable: COMPLETE, buyItems: {}, getItems: {} };
/** e2e offers.json offer-percent-25: 25 % off from £25, at most £10 (percent, bill minimum). */
const PERCENT_25 = { ...FLAT_TWO, _id: "offer-percent-25", name: "25% off your order", type: { name: "percent", value: 25 }, minBillAmount: 25, maxDiscount: 10 };
/** BagSheetTotals' committed free sauce and its get-only offer (freebie). */
const SAUCE_FREE = {
  id: "sauce",
  itemId: "sauce-free",
  name: "Tortilla Sauce",
  quantity: 1,
  type: "ITEM",
  price: 2,
  total_price: 2,
  undiscounted_total_price: 2,
  discounted_total_price: 0,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  customizations: {},
  taxes: [VAT15],
};
const FREE_SAUCE_OFFER = {
  ...FLAT_TWO,
  _id: "offer-free-sauce",
  name: "A free sauce",
  type: { name: "item", value: 0 },
  isAndOffer: true,
  getItemOnly: true,
  getItems: { items: [{ _id: "gi-sauce", baseItemId: "sauce", name: "Tortilla Sauce", relation: "and", discountType: "percent", value: 100, quantity: 1, type: "ITEM" }] },
};
/** MenuCtaBar's buy a burger, a salad half price (BOGO) and its committed salad. */
const BURGER_HALF_SALAD = {
  ...FLAT_TWO,
  _id: "bogo-burger",
  name: "Burger, a salad half price",
  type: { name: "item", value: 0 },
  applicable: { ...COMPLETE, rawItems: [{ relation: "and", quantity: 1, item: { baseItemId: "burger" } }] },
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
/** MenuCtaBar's buy any 2 mains, the cheapest free (least value). */
const CHEAPEST_MAIN_FREE = {
  ...FLAT_TWO,
  _id: "lv-mains",
  name: "Cheapest main free",
  type: { name: "item", value: 0 },
  getLeastValueItem: true,
  applicable: { ...COMPLETE, rawItems: [{ category: { _id: "mains" } }] },
  leastItemValueCount: { buyQuantity: 2, getQuantity: 1, getDiscount: 100 },
};
/** BagSheetTotals' 5 % service charge — taxed on the t1 tab only, so the order type moves money. */
const SERVICE_5 = { _id: "c-5", name: "Service", type: "percentage", value: 5, tabs: [{ _id: "t1", taxes: [VAT15] }] };

interface Case {
  rows: any[];
  offer?: any;
  charges?: any[];
  /** A paid row the steppers move. */
  paid: string;
}

const CASES: [string, Case][] = [
  ["plain row, amount offer, a charge", { rows: [BURRITO], offer: FLAT_TWO, charges: [SERVICE_5], paid: "r-1" }],
  ["add-ons and a combo, percent offer with a bill minimum", { rows: [NACHOS, KIDDIE], offer: PERCENT_25, paid: "row-nachos" }],
  ["a size and a loyalty reward row, no offer", { rows: [LARGE, REWARD], paid: "p-large" }],
  ["a committed freebie under its get-only offer", { rows: [BURRITO, SAUCE_FREE], offer: FREE_SAUCE_OFFER, paid: "r-1" }],
  ["BOGO: a burger, its half-price salad", { rows: [main("burger", 8, 1), main("drink", 3, 2), HALF_PRICE_SALAD], offer: BURGER_HALF_SALAD, paid: "row-drink" }],
  ["least value: the cheapest main free, locked", { rows: [main("taco", 5, 2), main("burrito", 8, 1)], offer: CHEAPEST_MAIN_FREE, paid: "row-burrito" }],
];

/** [label, moves money, write] — money writes interleaved with writes that move none. */
const WRITES: [string, boolean, (c: Case) => void][] = [
  ["setAmount (the bag's mirror)", false, () => store.dispatch(setAmount(12.34))],
  ["qty +", true, (c) => store.dispatch(increaseItemQuantity({ id: c.paid, IDKEY: "itemId" }))],
  ["setAmount (its echo)", false, () => store.dispatch(setAmount(56.78))],
  ["removal notice open", false, () => store.dispatch(openOfferRemovalModal(FLAT_TWO))],
  ["removal notice closed", false, () => store.dispatch(closeOfferRemovalModal())],
  ["charges", true, () => store.dispatch(pushCharges([SERVICE_5]))],
  ["celebration open", false, () => store.dispatch(openOfferModal({ name: "x" }))],
  ["celebration closed", false, () => store.dispatch(closeOfferModal())],
  ["order type: tab t2", true, () => store.dispatch(setSelectedTabId("t2"))],
  ["instructions", false, () => store.dispatch(setCartInstructions("no onions"))],
  ["repeat sheet open", false, () => store.dispatch(setRepeatItemBottomSheet({ isOpen: true, status: "", baseItem: { id: "burrito" } }))],
  ["repeat sheet closed", false, () => store.dispatch(closeRepeatItemBottomSheet())],
  ["freebie staging pick", false, () => store.dispatch(addGetItemsRdx({ ...SAUCE_FREE }))],
  ["freebie staging cleared", false, () => store.dispatch(emptyGetItemsState())],
  ["discountOnAddon", true, () => store.dispatch(setDiscountOnAddon(true))],
  ["the freebie lock", true, () => store.dispatch(reconcileFreebieAllocation())],
  ["offer removed", true, () => store.dispatch(removeCartOffer())],
  ["offer applied", true, (c) => store.dispatch(applyOffer({ offer: c.offer ?? FLAT_TWO }))],
  ["menu charge config (not the bill's charges)", false, () => store.dispatch(setMenuCharges({ menuCharges: [SERVICE_5] }))],
  ["qty −", true, (c) => store.dispatch(decreaseItemQuantity({ id: c.paid, IDKEY: "itemId" }))],
  ["settings: round off on", true, () => store.dispatch(setDeploymentInfo([]))],
  ["row added", true, () => store.dispatch(addItemToCartRdx({ ...main("cola", 3, 1), itemType: "ITEM" }))],
  ["row removed", true, () => store.dispatch(removeItemFromCart({ id: "row-cola", IDKEY: "itemId" }))],
  ["order type: tab t1", true, () => store.dispatch(setSelectedTabId("t1"))],
  ["charges cleared", true, () => store.dispatch(pushCharges([]))],
  ["setAmount", false, () => store.dispatch(setAmount(0))],
];

const arrange = (c: Pick<Case, "rows" | "offer" | "charges">) => {
  store.dispatch(setCartItems(structuredClone(c.rows)));
  if (c.offer) store.dispatch(applyOffer({ offer: structuredClone(c.offer) }));
  if (c.charges) store.dispatch(pushCharges(structuredClone(c.charges)));
};

/**
 * What the bag reads off a bill, in BagSheet's order (getNetAmount first: it
 * re-assigns each charge's amount), then every line, charge and tax the
 * engine wrote on it.
 */
const read = (bill: any) =>
  bill && {
    net: bill.getNetAmount(),
    discount: bill.getTotalDiscount(),
    subtotal: bill.getSubtotal(),
    tax: bill.getTotalTax(),
    charges: bill.getCharges(),
    chargesTax: bill.getChargesTotalTax(),
    lines: JSON.parse(JSON.stringify(bill)),
  };

const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
const useBagBill = () => useCartBill(useSelector(selectCart));
const useMenuTotal = () => useCartTotal(useSelector(selectCart));

/** Every cart object the store held since `track()` — the arguments useCartBill / useCartTotal price as-is. */
let storeCarts = new Set<unknown>();
let untrack = () => {};
const track = () => {
  storeCarts = new Set([store.getState().cart]);
  untrack = store.subscribe(() => storeCarts.add(store.getState().cart));
};
/** Engine runs over a store cart itself: the bag's bill, the menu's Total (no reward to settle). */
const cartRuns = () => engine.mock.calls.filter(([cart]) => storeCarts.has(cart)).length;

/** The menu's surfaces: the CTA bar, and the open bag over it. */
const renderSurfaces = ({ bag, bar }: { bag: boolean; bar: boolean }) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        {bar ? <MenuCtaBar currency="£" onViewBag={vi.fn()} /> : null}
        {bag ? <BagSheet open onClose={vi.fn()} /> : null}
      </MemoryRouter>
    </Provider>,
  );
const amount = (testId: string) => Number(screen.getByTestId(testId).textContent?.replace(/[^\d.]/g, ""));

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
  store.dispatch(setSelectedTabId("t1"));
  // billCalculation still logs on some bill paths (fork parity).
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  untrack();
  store.dispatch({ type: "RESET_STATE" });
  vi.restoreAllMocks();
});

describe("golden — after every write the memoised result equals a fresh computation; only money writes run the bill", () => {
  it.each(CASES)("useCartBill — %s", (_name, c) => {
    arrange(c);
    const live = renderHook(useBagBill, { wrapper });
    for (const [label, money, write] of WRITES) {
      engine.mockClear();
      act(() => write(c));
      const runs = engine.mock.calls.length;
      const fresh = renderHook(useBagBill, { wrapper });
      expect(read(live.result.current), label).toEqual(read(fresh.result.current));
      fresh.unmount();
      expect(runs, label).toBe(money ? 1 : 0);
    }
  });

  it.each([...CASES, ["a row the engine cannot price (the subtotal stands in)", { rows: [UNPRICEABLE], paid: "v-1" }] as [string, Case]])(
    "useCartTotal — %s",
    (_name, c) => {
      arrange(c);
      const live = renderHook(useMenuTotal, { wrapper });
      for (const [label, money, write] of WRITES) {
        engine.mockClear();
        settles.mockClear();
        act(() => write(c));
        const runs = engine.mock.calls.length;
        const priced = settles.mock.calls.length;
        const fresh = renderHook(useMenuTotal, { wrapper });
        expect(live.result.current, label).toBe(fresh.result.current);
        fresh.unmount();
        expect(priced, label).toBe(money ? 1 : 0);
        if (!money) expect(runs, label).toBe(0);
      }
    },
  );

  it("useCartTotal — the offer the bag applies by itself: the removal notice takes it out and puts it back", () => {
    arrange({ rows: [{ ...BURRITO, quantity: 2 }] });
    store.dispatch(setFilteredOffers([{ ...FLAT_TWO, _id: "auto-flat-2", autoApplied: true }]));
    const live = renderHook(useMenuTotal, { wrapper });
    // £17.20 − £2 = £15.20 + VAT £2.28 (MenuCtaBar's flagged-offer case).
    expect(live.result.current).toBe(17.48);
    // [label, write, Total, settleCart calls: 1 per pricing, 2 with the offer swapped in]
    const steps: [string, () => unknown, number, number][] = [
      ["removal notice open: the bag would not apply it", () => store.dispatch(openOfferRemovalModal(FLAT_TWO)), 19.78, 1],
      ["setAmount", () => store.dispatch(setAmount(1)), 19.78, 0],
      ["removal notice closed", () => store.dispatch(closeOfferRemovalModal()), 17.48, 2],
    ];
    for (const [label, write, total, priced] of steps) {
      settles.mockClear();
      act(() => {
        write();
      });
      expect(settles.mock.calls.length, label).toBe(priced);
      const fresh = renderHook(useMenuTotal, { wrapper });
      expect(live.result.current, label).toBe(fresh.result.current);
      expect(live.result.current, label).toBe(total);
      fresh.unmount();
    }
  });
});

describe("the findings, one regression each", () => {
  it("BAG-1 — the open bag prices a '+' once (its setAmount echo reuses the bill); the celebration and instructions price nothing", () => {
    arrange({ rows: [BURRITO] });
    renderSurfaces({ bag: true, bar: false });
    track();
    engine.mockClear();

    fireEvent.click(screen.getByTestId("bag-inc-r-1"));
    // One bag bill for the new rows — the echo of its own setAmount mirror
    // ran a second, identical one.
    expect(cartRuns()).toBe(1);
    // £17.20 + VAT £2.58, mirrored for the checkout screens.
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£19.78");
    expect(store.getState().cart.netAmount).toBe(19.78);

    engine.mockClear();
    act(() => {
      store.dispatch(openOfferModal({ name: "x" }));
    });
    act(() => {
      store.dispatch(closeOfferModal());
    });
    act(() => {
      store.dispatch(setCartInstructions("no onions"));
    });
    expect(engine).not.toHaveBeenCalled();
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£19.78");
  });

  it("MENU-2 — the menu TOTAL prices no cart write that moves no money (setAmount, the repeat sheet, the removal notice)", () => {
    // A bill minimum: each pricing also runs revalidation's check-8 bill.
    arrange({ rows: [{ ...BURRITO, quantity: 3 }], offer: PERCENT_25 });
    renderSurfaces({ bag: false, bar: true });
    track();
    const before = screen.getByTestId("cta-total").textContent;
    engine.mockClear();
    settles.mockClear();

    for (const write of [
      () => store.dispatch(setAmount(9.99)),
      () => store.dispatch(setRepeatItemBottomSheet({ isOpen: true, status: "", baseItem: { id: "burrito" } })),
      () => store.dispatch(closeRepeatItemBottomSheet()),
      () => store.dispatch(openOfferRemovalModal(FLAT_TWO)),
      () => store.dispatch(closeOfferRemovalModal()),
    ]) {
      act(() => {
        write();
      });
    }
    expect(engine).not.toHaveBeenCalled();
    expect(settles).not.toHaveBeenCalled();
    expect(screen.getByTestId("cta-total").textContent).toBe(before);

    // A money write still prices, once: £34.40 − 25 % (£8.60) + VAT £3.87.
    act(() => {
      store.dispatch(increaseItemQuantity({ id: "r-1", IDKEY: "itemId" }));
    });
    expect(settles).toHaveBeenCalledTimes(1);
    expect(cartRuns()).toBe(1);
    expect(screen.getByTestId("cta-total")).toHaveTextContent("£29.67");
  });

  it("REDUX-4 — a bag '+' and '−' price the bag and the menu TOTAL under it once each: the echo's second pass is gone", () => {
    arrange({ rows: [{ ...BURRITO, quantity: 2 }] });
    renderSurfaces({ bag: true, bar: true });
    track();

    for (const testId of ["bag-inc-r-1", "bag-dec-r-1"]) {
      engine.mockClear();
      fireEvent.click(screen.getByTestId(testId));
      expect(cartRuns(), testId).toBe(2);
      expect(amount("cta-total"), testId).toBe(amount("bag-total"));
    }
    expect(amount("bag-total")).toBe(19.78);
  });

  it("SDK-2 — with the bag open, freebie staging and the removal notice price nothing; a quantity change prices the bag once and the menu TOTAL once", () => {
    arrange({ rows: [BURRITO] });
    renderSurfaces({ bag: true, bar: true });
    track();
    engine.mockClear();

    for (const write of [
      () => store.dispatch(addGetItemsRdx({ ...SAUCE_FREE })),
      () => store.dispatch(emptyGetItemsState()),
      () => store.dispatch(openOfferRemovalModal(FLAT_TWO)),
      () => store.dispatch(closeOfferRemovalModal()),
    ]) {
      act(() => {
        write();
      });
    }
    expect(engine).not.toHaveBeenCalled();

    act(() => {
      store.dispatch(increaseItemQuantity({ id: "r-1", IDKEY: "itemId" }));
    });
    expect(cartRuns()).toBe(2);
    expect(amount("cta-total")).toBe(amount("bag-total"));
    expect(store.getState().cart.netAmount).toBe(amount("bag-total"));
  });
});
