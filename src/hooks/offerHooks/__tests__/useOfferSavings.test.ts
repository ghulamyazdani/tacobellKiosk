/**
 * Lane offers-parity, U8 — useOfferSavings' item minimums:
 *  - D3: item minimums count PAID units. A freebie row (isGetItem) no longer
 *    closes a minItemCount gap: every commit sweeps the previous offer's
 *    freebies first, and revalidation check 3 (BagSheet) never counted them,
 *    so an offer "unlocked" by one was applied, then removed.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { store } from "../../../redux/app/store";
import useOfferSavings from "../useOfferSavings";

const row = (itemId: string, extra: object = {}) => ({
  id: "tortilla",
  itemId,
  uniqueItemId: itemId,
  name: "Tortilla Sauce",
  type: "ITEM",
  price: 2,
  total_price: 2,
  quantity: 1,
  customizations: {},
  ...extra,
});
const PAID_FIVE = ["p1", "p2", "p3", "p4", "p5"].map((id) => row(id));
const FREEBIE = row("f1", {
  isGetItem: true,
  discountType: "percent",
  discountValue: 100,
  discounted_total_price: 0,
  undiscounted_total_price: 2,
});
const LOYALTY = row("l1", { isLoyaltyItem: true, total_price: 0 });

/** £2 off, min 6 items (the "bogo"-shaped minimum). */
const MIN_SIX: SavingsOffer = {
  _id: "min-six",
  name: "Min six",
  type: { name: "amount", value: 2 },
  minItemCount: 6,
  applicable: { on: "complete", rawItems: [] },
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(Provider, { store, children: createElement(MemoryRouter, null, children) });
const savings = () => renderHook(() => useOfferSavings(), { wrapper }).result.current;

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
});

describe("D3 — item minimums count paid units", () => {
  it("5 paid + 1 freebie vs minItemCount 6 → minItems, 1 short", () => {
    store.dispatch(setCartItems([...PAID_FIVE, FREEBIE]));
    expect(savings().gapFor(MIN_SIX)).toEqual({ reason: "minItems", countShort: 1 });
  });

  it("a loyalty row is still excluded", () => {
    store.dispatch(setCartItems([...PAID_FIVE, LOYALTY]));
    expect(savings().gapFor(MIN_SIX)).toEqual({ reason: "minItems", countShort: 1 });
  });

  it("6 paid units close the gap", () => {
    store.dispatch(setCartItems([...PAID_FIVE, row("p6")]));
    expect(savings().gapFor(MIN_SIX)).toBeUndefined();
  });
});
