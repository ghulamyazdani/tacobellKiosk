/**
 * SDK @cx-sdk/ordering/offer/offerRevalidation, run from the TB tree (the
 * SDK suite stays untouched): check 8, the bill minimum (user decision
 * 2026-10-14, lane walk-offers-2), in the ONE rule the bag's revalidation
 * and settleCart (the menu TOTAL, the added modal's Total) share. The bill
 * engine is injected, so what it is handed, and when it is never asked, is
 * asserted directly. The real engine's money is BagSheetOffers' and
 * MenuCtaBar's.
 */
import { describe, expect, it, vi } from "vitest";
import { settleCart, shouldDropAppliedOffer } from "@cx-sdk/ordering/offer/offerRevalidation";

type Row = { itemId: string; price: number; quantity: number; isGetItem?: boolean; isLoyaltyItem?: boolean };

/** A bill engine whose item subtotal is its rows' price × quantity. */
const engine = () =>
  vi.fn((cart: { cartItems: Row[] }) => ({
    getSubtotal: () => cart.cartItems.reduce((sum, row) => sum + row.price * row.quantity, 0),
  }));

const paid = (itemId: string, price: number): Row => ({ itemId, price, quantity: 1 });
const FREEBIE: Row = { ...paid("free-salad", 17), isGetItem: true };
const REWARD: Row = { ...paid("xeno-salad", 17), isLoyaltyItem: true };
/** £2 off orders of £10 or more. */
const FLAT_MIN_10 = {
  _id: "flat-min-10",
  name: "£2 off over £10",
  type: { name: "amount", value: 2 },
  minBillAmount: 10,
  isAvailable: true,
  applicable: { on: "complete", categories: [], items: [], isExclude: false, isInclude: false, rawItems: [] },
  buyItems: {},
  getItems: {},
};

type Engine = NonNullable<Parameters<typeof shouldDropAppliedOffer>[2]>["getCalculatedBill"];
const drop = (offer: unknown, items: Row[], getCalculatedBill: Engine, rest = {}) =>
  shouldDropAppliedOffer(offer, items, { cart: { ...rest, cartOffer: offer, cartItems: items }, getCalculatedBill });

describe("shouldDropAppliedOffer — check 8, the bill minimum", () => {
  it("drops a reward the guest's own spend is under; keeps one AT its minimum", () => {
    expect(drop(FLAT_MIN_10, [paid("burger", 9.99)], engine())).toBe(true);
    expect(drop(FLAT_MIN_10, [paid("burger", 10)], engine())).toBe(false);
  });

  it("prices ONE bill of the guest's own rows: loyalty and freebie rows filtered out, the rest of the cart as it is", () => {
    const price = engine();
    const items = [paid("burger", 8.6), FREEBIE, REWARD];
    // £8.60 of the guest's own, under £10, though the bag holds £42.60.
    expect(drop(FLAT_MIN_10, items, price, { charges: ["service"] })).toBe(true);
    expect(price).toHaveBeenCalledTimes(1);
    expect(price).toHaveBeenCalledWith({ charges: ["service"], cartOffer: FLAT_MIN_10, cartItems: [items[0]] });
  });

  it("no minimum never prices, nor drops; a bill that cannot be priced never drops", () => {
    const price = engine();
    for (const minBillAmount of [null, undefined, 0, "", "none"]) {
      expect(drop({ ...FLAT_MIN_10, minBillAmount }, [paid("burger", 1)], price)).toBe(false);
    }
    expect(price).not.toHaveBeenCalled();

    const unpriceable = vi.fn(() => {
      throw new Error("a row the engine cannot price");
    });
    expect(drop(FLAT_MIN_10, [paid("burger", 1)], unpriceable)).toBe(false);
    expect(unpriceable).toHaveBeenCalledTimes(1);
  });

  it("runs LAST: a bag checks 1–7 already drop is never priced", () => {
    const price = engine();
    expect(drop({ ...FLAT_MIN_10, minItemCount: 2 }, [paid("burger", 1)], price)).toBe(true);
    expect(price).not.toHaveBeenCalled();
  });

  it("without the bill engine the verdict is checks 1–7 alone", () => {
    expect(shouldDropAppliedOffer(FLAT_MIN_10, [paid("burger", 1)])).toBe(false);
  });
});

describe("settleCart — the bill minimum too", () => {
  it("a reward under its minimum goes with its freebie rows, the engine handed the cart; at its minimum the very cart comes back", () => {
    const price = engine();
    const under = { cartOffer: FLAT_MIN_10, cartItems: [paid("burger", 8.6), FREEBIE], lockedFreebieAllocation: {} };
    expect(settleCart(under, price)).toEqual({
      ...under,
      cartOffer: {},
      lockedFreebieAllocation: {},
      cartItems: [under.cartItems[0]],
    });
    expect(price).toHaveBeenCalledWith({ ...under, cartItems: [under.cartItems[0]] });

    const at = { ...under, cartItems: [paid("burger", 10), FREEBIE] };
    expect(settleCart(at, price)).toBe(at);
    // Without the engine, checks 1–7 alone keep it.
    expect(settleCart(under)).toBe(under);
  });
});
