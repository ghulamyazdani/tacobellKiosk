/**
 * Lane offers-parity, U8 — useOfferSavings' two changes:
 *  - D3: item minimums count PAID units. A freebie row (isGetItem) no longer
 *    closes a minItemCount gap: every commit sweeps the previous offer's
 *    freebies first, and revalidation check 3 (BagSheet) never counted them,
 *    so an offer "unlocked" by one was applied, then removed.
 *  - D1: rank() is rankOffersForKiosk wired to the store's menu maps — an
 *    offer whose dead buy entry is absent from the menu is never listed; one
 *    whose dead entry is on the menu (sold out) is a gone row.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap, setVariantObject } from "@cx-sdk/catalog/state/Menu.slice";
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

describe("D1 — rank() hides what can never unlock on this menu", () => {
  const buyOn = (_id: string, baseItemId: string): SavingsOffer => ({
    _id,
    name: _id,
    type: { name: "item", value: 0 },
    applicable: {
      on: "complete",
      rawItems: [
        { item: { baseItemId, name: baseItemId }, isRawItemAvailable: false, quantity: 1, relation: "and" } as never,
      ],
    },
    getItems: { items: [{ relation: "and", entities: { price: 2, discounted_total_price: 0 } }], categories: [] },
  });

  it("a stamped dead buy entry absent from the menu → not listed; on the menu (sold out) → a gone row", () => {
    store.dispatch(setCartItems(PAID_FIVE));
    store.dispatch(
      setEntityMap({ entityMap: { "sold-out": { id: "sold-out", name: "Sold Out", price: 2, outOfStock: true } } })
    );
    const ranked = savings().rank([buyOn("absent", "not-on-menu"), buyOn("sold", "sold-out"), MIN_SIX]);
    expect(ranked.map((entry) => entry.offer._id)).not.toContain("absent");
    expect(ranked.find((entry) => entry.offer._id === "sold")).toMatchObject({
      eligible: false,
      gap: { reason: "unavailable" },
    });
  });

  // The other two D1 lookups (mutation verifier): a variant id, and a category entry.
  const buyCategory = (_id: string, categoryId: string): SavingsOffer => ({
    ...buyOn(_id, ""),
    applicable: {
      on: "complete",
      rawItems: [
        { category: { _id: categoryId, categoryName: categoryId }, isRawItemAvailable: false, quantity: 1, relation: "and" } as never,
      ],
    },
  });

  it("a dead buy entry the menu carries only as a VARIANT (variantObject) → a gone row, not hidden", () => {
    store.dispatch(setCartItems(PAID_FIVE));
    store.dispatch(setEntityMap({ entityMap: {} }));
    store.dispatch(
      setVariantObject({ variantObject: { "large-cola": { baseItem: { name: "Cola" }, variant: { name: "Large" } } } })
    );
    const ranked = savings().rank([buyOn("variant", "large-cola"), buyOn("absent", "not-on-menu")]);
    expect(ranked.map((entry) => entry.offer._id)).toEqual(["variant"]);
    expect(ranked[0]).toMatchObject({ eligible: false, gap: { reason: "unavailable" } });
  });

  it("a dead CATEGORY buy entry: its sub-category on an entity or an entity's variant → a gone row; one the menu lacks → not listed", () => {
    store.dispatch(setCartItems(PAID_FIVE));
    store.dispatch(
      setEntityMap({
        entityMap: {
          burger: { id: "burger", subCategoryId: "sub-burgers", outOfStock: true },
          cola: { id: "cola", subCategoryId: "sub-drinks", variants: [{ subCategoryId: "sub-sizes" }] },
        },
      })
    );
    const ranked = savings().rank([
      buyCategory("cat-entity", "sub-burgers"),
      buyCategory("cat-variant", "sub-sizes"),
      buyCategory("cat-absent", "sub-desserts"),
    ]);
    expect(ranked.map((entry) => entry.offer._id).sort()).toEqual(["cat-entity", "cat-variant"]);
    ranked.forEach((entry) => expect(entry).toMatchObject({ eligible: false, gap: { reason: "unavailable" } }));
  });
});
