import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  selectOffers,
  setFilteredOffers,
  setOffers,
} from "@cx-sdk/ordering/state/offer.slice";
import { convertOffersForMenu } from "@cx-sdk/ordering/offer/offerMenuConversion";
import { store } from "../redux/app/store";
import useOfferConverters from "../hooks/offerHooks/useOfferConverters";

/*
  C1a (audit-fixes, MONEY) — the golden master of the offer → menu
  conversion. The snapshots were recorded on the UNCHANGED hook (the
  freebie prices shown in the offer sheets and the discountType /
  discountValue stamps every freebie commit carries), BEFORE its body moved
  verbatim into the SDK. Never run this file with -u: a snapshot diff here is
  a money change. `order` is an FNV digest of JSON.stringify, so the key
  order of every converted row is pinned too (the snapshot printer sorts
  keys). Since the move each case also proves the SDK function returns the
  very payload the hook applies.
*/

type Row = Record<string, unknown>;

const GROUPS: Record<string, Row> = {
  "g-sauce": { _id: "g-sauce", name: "Sauce", isActive: true },
  "g-retired": { _id: "g-retired", name: "Retired", isActive: false },
  "g-cheese": { _id: "g-cheese", name: "Cheese", isActive: true },
  "g-taco": { _id: "g-taco", name: "Taco size", isActive: true },
};
const fetchModifierProperties = (ids: unknown): Row[] =>
  (Array.isArray(ids) ? ids : [])
    .map((id) => GROUPS[String(id)])
    .filter((group): group is Row => Boolean(group));

// ---- Menu entities ----
const BURGER = { id: "burger", name: "Burger", price: 10 }; // ITEM (no modifiers key)
const SIDE = { id: "side", name: "Side", price: 6, modifiers: [] }; // ITEM (empty list)
const WRAP = { id: "wrap", name: "Wrap", price: 8, modifiers: ["g-sauce", "g-retired"] };
const TACO_S = { id: "taco-s", name: "Small", price: 5, isActive: true, modifiers: ["g-cheese"] };
const TACO_L = {
  id: "taco-l",
  name: "Large",
  price: 7,
  isActive: true,
  modifiers: ["g-cheese", "g-retired"],
};
const TACO_X = { id: "taco-x", name: "XL", price: 9, isActive: true, outOfStock: true, modifiers: [] };
const TACO = {
  id: "taco",
  name: "Taco",
  price: 5,
  hasVariant: true,
  modifiers: ["g-taco"],
  variants: [TACO_S, TACO_L, TACO_X],
};
/** No active, in-stock size: its cheapest price stays undefined. */
const NACHOS = {
  id: "nachos",
  name: "Nachos",
  price: 6,
  hasVariant: true,
  modifiers: [],
  variants: [
    { id: "nachos-m", price: 6, isActive: false },
    { id: "nachos-l", price: 8, isActive: true, outOfStock: true },
  ],
};
/** Its cheapest active size is priced 0 — a falsy leastValue skips the entity. */
const KIDS = {
  id: "kids",
  name: "Kids",
  price: 4,
  hasVariant: true,
  modifiers: [],
  variants: [
    { id: "kids-s", price: 2, isActive: true },
    { id: "kids-free", price: 0, isActive: true },
  ],
};
const FRIES_OOS = { id: "fries", name: "Fries", price: 4, outOfStock: true };
/** An out-of-stock base: none of its sizes can be offered by id. */
const PITA = {
  id: "pita",
  name: "Pita",
  price: 6,
  hasVariant: true,
  outOfStock: true,
  modifiers: ["g-cheese"],
  variants: [{ id: "pita-m", price: 6, isActive: true }],
};

interface Maps {
  entityMap: Map<unknown, unknown>;
  categoryMap: Map<unknown, unknown>;
  variantEntityMap: Map<unknown, unknown>;
}

const maps = (): Maps => ({
  entityMap: new Map<unknown, unknown>(
    [BURGER, SIDE, WRAP, TACO, NACHOS, KIDS, FRIES_OOS].map((entity) => [entity.id, entity]),
  ),
  categoryMap: new Map<unknown, unknown>([
    ["c-variants", { taco: TACO, nachos: NACHOS, kids: KIDS }],
    ["c-mixed", { wrap: WRAP, burger: BURGER, side: SIDE, fries: FRIES_OOS }],
    ["c-empty", {}],
    ["c-all-oos", { fries: FRIES_OOS }],
  ]),
  variantEntityMap: new Map<unknown, unknown>([
    ["taco-s", [TACO]],
    ["taco-l", [TACO]],
    ["taco-x", [TACO]],
    ["pita-m", [PITA]],
  ]),
});

const itemOffer = (id: string, items: Row[], extra: Row = {}): Row => ({
  _id: id,
  name: id,
  type: { name: "item" },
  applicable: { rawItems: [] },
  getItems: { items },
  ...extra,
});
const categoryOffer = (id: string, categories: Row[]): Row => ({
  _id: id,
  name: id,
  type: { name: "item" },
  applicable: { rawItems: [] },
  getItems: { categories },
});

/** FNV-1a 32-bit over JSON.stringify — pins key order as well as values. */
const order = (value: unknown): string => {
  const text = JSON.stringify(value) ?? "undefined";
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(Provider, { store, children });

/** The hook exactly as useMenuConverters drives it; returns the ONE staged payload. */
const convert = (offers: unknown, input: Maps = maps()): unknown => {
  const captured: UnknownAction[] = [];
  const { result } = renderHook(() => useOfferConverters(), { wrapper });
  act(() => {
    result.current.converOffersForGetItemByMenu(
      input.entityMap,
      input.categoryMap,
      input.variantEntityMap,
      fetchModifierProperties,
      offers,
      (action) => captured.push(action),
    );
  });
  expect(captured).toHaveLength(1);
  expect(setFilteredOffers.match(captured[0])).toBe(true);
  return captured[0].payload;
};

/** One golden: the payload (values) + its JSON digest (key order), and the SDK parity. */
const golden = (offers: unknown, input: Maps = maps()) => {
  const payload = convert(offers, input);
  expect({ payload, order: order(payload) }).toMatchSnapshot();
  const direct = convertOffersForMenu(
    (offers ? offers : selectOffers(store.getState())) as unknown[] | null | undefined,
    input.entityMap,
    input.categoryMap,
    input.variantEntityMap,
    fetchModifierProperties,
  );
  expect(direct).toEqual(payload);
  expect(order(direct)).toBe(order(payload));
  return payload;
};

describe("offer → menu conversion goldens (C1a; recorded on the unchanged hook)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("group-wise discount normalisation: value '10' / 5 / missing (NaN) / missing type", () => {
    const groupWise = (id: string, values: Row) =>
      itemOffer(
        id,
        [
          { _id: "burger", discountType: "amount", value: 99, quantity: 1 },
          { _id: "side", relation: "and" },
        ],
        { buygetGroupWiseOffer: true, buygetGroupWiseOfferValues: values },
      );
    golden([
      groupWise("gw-string", { discountType: "percent", value: "10" }),
      groupWise("gw-number", { discountType: "amount", value: 5 }),
      groupWise("gw-no-value", { discountType: "percent" }),
      groupWise("gw-no-type", { value: 5 }),
    ]);
  });

  it("relation 'or' clears isAndOffer (items and categories)", () => {
    golden([
      itemOffer("or-item", [{ _id: "burger", relation: "or", discountType: "percent", value: 100 }]),
      categoryOffer("or-category", [{ _id: "c-mixed", relation: "or", discountType: "percent", value: 100 }]),
      itemOffer("and-item", [{ _id: "burger", relation: "and", discountType: "percent", value: 100 }]),
    ]);
  });

  it("ITEM: percent / amount / amount over the price / value 0 / no type; baseItemId wins over _id", () => {
    golden([
      itemOffer("item-mix", [
        { _id: "burger", discountType: "percent", value: 50 },
        { _id: "not-in-menu", baseItemId: "burger", discountType: "amount", value: 3 },
        { _id: "burger", discountType: "amount", value: 15 },
        { _id: "side", discountType: "percent", value: 0 },
        { _id: "side", value: 2 },
      ]),
    ]);
  });

  it("CUSTOMIZABLE (only active groups seed customizations) and a VARIANT entity", () => {
    golden([
      itemOffer("customizable", [{ _id: "wrap", discountType: "percent", value: 25 }]),
      itemOffer("variant-entity", [{ _id: "taco", discountType: "amount", value: 1 }]),
    ]);
  });

  it("an out-of-stock entity converts to entities {}", () => {
    golden([itemOffer("oos", [{ _id: "fries", discountType: "percent", value: 100 }])]);
  });

  it("variant ids: a hit, an out-of-stock size, no available base", () => {
    golden([
      itemOffer("variant-ids", [
        { _id: "taco-l", discountType: "percent", value: 10 },
        { _id: "taco-x", discountType: "percent", value: 10 },
        { _id: "pita-m", discountType: "amount", value: 2 },
        { _id: "nowhere", discountType: "amount", value: 2 },
      ]),
    ]);
  });

  it("categories: sized entities (active size / none / cheapest priced 0), customizable, item, OOS, empty, map miss", () => {
    golden([
      categoryOffer("categories", [
        { _id: "c-variants", discountType: "percent", value: 20 },
        { _id: "c-mixed", discountType: "amount", value: 3 },
        { _id: "c-empty", discountType: "amount", value: 3 },
        { _id: "c-all-oos", discountType: "amount", value: 3 },
        { _id: "c-missing", discountType: "percent", value: 50 },
      ]),
    ]);
  });

  /*
    No golden above takes an AMOUNT past the price on the category or the
    size-id path (only the ITEM path's £15 on £10), so those two clamps are
    pinned here by value — no new snapshot (this file never runs with -u).
    The values were cross-checked against the unchanged pre-move hook.
  */
  it("an amount at or past the price clamps the freebie at 0 on the category and size paths too (never negative)", () => {
    const [category, size, exact] = convert([
      categoryOffer("cat-over", [{ _id: "c-mixed", discountType: "amount", value: 7 }]),
      itemOffer("size-over", [{ _id: "taco-l", discountType: "amount", value: 9 }]),
      itemOffer("size-exact", [{ _id: "taco-s", discountType: "amount", value: 5 }]),
    ]) as Row[];

    const categoryPrices = (category.getItems as { categories: { entities: Row[] }[] }).categories[0].entities.map(
      (entity) => [entity.id, entity.discounted_total_price, entity.undiscounted_total_price],
    );
    // Burger £10 − 7 = £3; Side £6 − 7 → £0; the Wrap is customizable (priced later); Fries out of stock.
    expect(categoryPrices).toEqual([
      ["wrap", undefined, undefined],
      ["burger", 3, 10],
      ["side", 0, 6],
    ]);
    const sized = (offer: Row) => {
      const entity = (offer.getItems as { items: { entities: Row }[] }).items[0].entities;
      return [entity.discounted_total_price, entity.undiscounted_total_price, (entity.selectedVariant as Row).discounted_total_price];
    };
    expect(sized(size)).toEqual([0, 7, 0]); // Large £7 − 9 → £0
    expect(sized(exact)).toEqual([0, 5, 0]); // Small £5 − 5 = £0
  });

  it("rawItems availability + isBuyAndOffer", () => {
    const withRaw = (id: string, rawItems: Row[]) => ({
      ...itemOffer(id, [{ _id: "burger", discountType: "percent", value: 100 }]),
      applicable: { rawItems, minimumQuantity: 1 },
    });
    golden([
      withRaw("raw-and", [
        { item: { baseItemId: "burger" }, relation: "and" },
        { item: { baseItemId: "fries" }, relation: "or" },
        { item: { baseItemId: "taco-l" } },
        { item: { baseItemId: "pita-m" } },
        { category: { _id: "c-mixed" } },
        { category: { _id: "c-all-oos" } },
        { category: { _id: "c-missing" } },
        { item: {}, category: {} },
      ]),
      withRaw("raw-or", [
        { item: { baseItemId: "burger" }, relation: "or" },
        { category: { _id: "c-empty" }, relation: "or" },
      ]),
      withRaw("raw-empty", []),
    ]);
  });

  it("a non-item offer type and an item offer without getItems pass through (rawItems still resolved)", () => {
    golden([
      {
        _id: "bill-offer",
        type: { name: "bill" },
        applicable: { rawItems: [{ item: { baseItemId: "burger" }, relation: "and" }] },
        getItems: { items: [{ _id: "burger", discountType: "percent", value: 10 }] },
      },
      { _id: "no-get-items", type: { name: "item" }, applicable: { rawItems: [] } },
    ]);
  });

  it("passedOffers null → the stored offers (selectOffers)", () => {
    store.dispatch(
      setOffers([itemOffer("stored", [{ _id: "burger", discountType: "percent", value: 30 }])]),
    );
    golden(null);
  });

  it("no offers anywhere → setFilteredOffers(undefined); an empty list → []", () => {
    store.dispatch(setOffers(null));
    expect(convert(undefined)).toBeUndefined();
    store.dispatch({ type: "RESET_STATE" });
    expect(convert(null)).toEqual([]);
    const input = maps();
    for (const none of [null, undefined]) {
      expect(
        convertOffersForMenu(
          none,
          input.entityMap,
          input.categoryMap,
          input.variantEntityMap,
          fetchModifierProperties,
        ),
      ).toBeUndefined();
    }
  });

  it("an offer without applicable.rawItems throws a TypeError (verbatim fork behaviour, kept)", () => {
    const { result } = renderHook(() => useOfferConverters(), { wrapper });
    const input = maps();
    for (const offer of [
      { _id: "no-raw", type: { name: "item" }, applicable: {} },
      { _id: "no-applicable", type: { name: "item" } },
    ]) {
      expect(() =>
        result.current.converOffersForGetItemByMenu(
          input.entityMap,
          input.categoryMap,
          input.variantEntityMap,
          fetchModifierProperties,
          [offer],
          () => undefined,
        ),
      ).toThrow(TypeError);
      expect(() =>
        convertOffersForMenu(
          [offer],
          input.entityMap,
          input.categoryMap,
          input.variantEntityMap,
          fetchModifierProperties,
        ),
      ).toThrow(TypeError);
    }
  });

  it("deep-frozen inputs (redux-held offers and menu rows) convert without a throw — the inputs are never mutated", () => {
    const offers = deepFreeze([
      itemOffer("frozen-items", [
        { _id: "wrap", discountType: "percent", value: 25 },
        { _id: "taco-l", discountType: "amount", value: 1 },
        { _id: "burger", discountType: "percent", value: 50 },
      ]),
      categoryOffer("frozen-categories", [
        { _id: "c-variants", discountType: "percent", value: 20 },
        { _id: "c-mixed", discountType: "amount", value: 3 },
      ]),
    ]);
    const input = maps();
    for (const values of [input.entityMap, input.categoryMap, input.variantEntityMap]) {
      values.forEach(deepFreeze);
    }
    const before = JSON.stringify(offers);
    golden(offers, input);
    expect(JSON.stringify(offers)).toBe(before);
  });
});
