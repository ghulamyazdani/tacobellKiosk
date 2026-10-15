/**
 * Lane offers-parity, U8 — useOfferSavings' two changes:
 *  - D3: item minimums count PAID units. A freebie row (isGetItem) no longer
 *    closes a minItemCount gap: every commit sweeps the previous offer's
 *    freebies first, and revalidation check 3 (BagSheet) never counted them,
 *    so an offer "unlocked" by one was applied, then removed.
 *  - D1: rank() is rankOffersForKiosk wired to the store's menu maps — an
 *    offer whose dead buy entry is absent from the menu is never listed; one
 *    whose dead entry is on the menu (sold out) is a gone row.
 * Lane dead-offer: a buy entry no guest can complete is dead too, read from
 * the sellable maps the buy stage reads — and re-read when stock moves.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency, setDiscountOnAddon } from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap, setModifiersMap, setVariantObject } from "@cx-sdk/catalog/state/Menu.slice";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { store } from "../../../redux/app/store";
import { setOutOfStockItems } from "../../../redux/features/menuSelections/menuSelections.slice";
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

/* ------------------------------------------------------------------ *
 * Walk 2026-10-14: with "And Offer With Varaint" applied (its reward rows
 * in the bag), the sheet previewed "Maha 50% — Save £34.80" and "Amount
 * Ic — Save £50.00"; the swap sweeps the reward rows first, so Maha
 * applied £12.50. Every preview prices the bag the swap leaves.
 * ------------------------------------------------------------------ */
describe("swap previews price the bag a swap leaves (no reward rows)", () => {
  const paid = (id: string, price: number) => row(`${id}-1`, { id, name: id, price, total_price: price });
  /** A committed reward row, as redeemGetItem stamps it. */
  const reward = (id: string, price: number, percent: number, quantity = 1) =>
    row(`${id}-g`, {
      id,
      name: id,
      price,
      total_price: price,
      quantity,
      isGetItem: true,
      discountType: "percent",
      discountValue: percent,
      undiscounted_total_price: price,
      discounted_total_price: price - (price * percent) / 100,
    });
  /** £20 + £5 paid; the applied offer's rewards: £10 at 50 %, 2 × £20 at 1 %. */
  const WALK_BAG = [paid("chilli", 20), paid("noodles-q", 5), reward("noodles-h", 10, 50), reward("chilli", 20, 1, 2)];
  const MAHA: SavingsOffer = {
    _id: "maha",
    name: "Maha Offer 50% on all item",
    type: { name: "percent", value: 50 },
    applicable: { on: "complete", rawItems: [] },
  };

  it("Maha 50 % previews £12.50 — half of the £25 the swap leaves, not £34.80", () => {
    store.dispatch(setCartItems(WALK_BAG));
    expect(savings().savingFor(MAHA).amount).toBe(12.5);
    expect(savings().rank([MAHA])[0].saving.amount).toBe(12.5);
  });

  it("a flat £50 off previews the £25 the swap leaves, never £50", () => {
    store.dispatch(setCartItems(WALK_BAG));
    const flat: SavingsOffer = { ...MAHA, _id: "amount-ic", type: { name: "amount", value: 50 } };
    expect(savings().savingFor(flat).amount).toBe(25);
  });

  it("a bill minimum is judged on that bag too: £25 against a £50 minimum is £25 short", () => {
    store.dispatch(setCartItems(WALK_BAG));
    expect(savings().gapFor({ ...MAHA, _id: "min-50", minBillAmount: 50 })).toEqual({
      reason: "minBill",
      amountShort: 25,
    });
  });

  it("without reward rows nothing changes: Maha previews half the bag", () => {
    store.dispatch(setCartItems([paid("chilli", 20), paid("noodles-q", 5)]));
    expect(savings().savingFor(MAHA).amount).toBe(12.5);
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

/* ------------------------------------------------------------------ *
 * Review of the walk fixes: with the deployment's enable_dis_addon on, a
 * get discount covers the add-ons too (redeemGetItem), so a free £9 burger
 * with +£2 bacon saves £11 — the "exact £9" quote was below it. rank()
 * hands the setting to the SDK ranker: no figure for such a reward.
 * ------------------------------------------------------------------ */
describe("enable_dis_addon reaches the ranking", () => {
  const FREE_BURGER = {
    _id: "free-burger",
    name: "Free burger",
    type: { name: "item", value: 0 },
    getItemOnly: true,
    applicable: { on: "complete", rawItems: [] },
    getItems: {
      items: [
        {
          relation: "and",
          quantity: 1,
          discountType: "percent",
          value: 100,
          entities: { id: "burger", price: 9, type: "CUSTOMIZABLE", modifiers: ["extras"] },
        },
      ],
      categories: [],
    },
  } as unknown as SavingsOffer;

  it("off: the burger's £9, exact; on: no figure (an 'up to' £0)", () => {
    store.dispatch(setCartItems(PAID_FIVE));
    try {
      store.dispatch(setDiscountOnAddon(false));
      expect(savings().rank([FREE_BURGER])[0].saving).toMatchObject({ amount: 9, certainty: "exact" });
      store.dispatch(setDiscountOnAddon(true));
      expect(savings().rank([FREE_BURGER])[0].saving).toMatchObject({ amount: 0, certainty: "upTo" });
    } finally {
      store.dispatch(setDiscountOnAddon(false));
    }
  });
});

/* ------------------------------------------------------------------ *
 * Lane dead-offer (user 2026-10-15, "Struck 'Not available' row"): rank()
 * reads "out" from the sellable maps the buy stage reads — sold out, or no
 * guest can complete it (a required group with nothing in stock, or with no
 * positive max) — so a buy side that can never be completed is the gone row
 * a sold-out one is, and it moves with PAY's stock map.
 * ------------------------------------------------------------------ */
describe("lane dead-offer — rank() counts a dead buy entry like a sold-out one", () => {
  /** A required dip (min 1, max 1 unless given) whose only option is salsa. */
  const DIP = (salsaOut: boolean, max = 1) => ({
    dip: { _id: "dip", isActive: true, min: 1, max, constituentItems: [{ id: "salsa", isActive: true, outOfStock: salsaOut }] },
  });
  const NACHOS = { id: "nachos", name: "Nachos", price: 4, modifiers: ["dip"] };
  const TORTILLA = { id: "tortilla", name: "Tortilla Sauce", price: 2, modifiers: [] };
  const raw = (baseItemId: string, relation = "and") => ({ item: { baseItemId, name: baseItemId }, quantity: 1, relation });
  /** Buy side `rawItems`, a fixed £2 grant; no converter stamp anywhere. */
  const buy = (_id: string, rawItems: object[]) =>
    ({
      _id,
      name: _id,
      type: { name: "item", value: 0 },
      applicable: { on: "complete", rawItems },
      getItems: { items: [{ relation: "and", entities: { price: 2, discounted_total_price: 0 } }], categories: [] },
    }) as unknown as SavingsOffer;
  const goneIds = (ranked: ReturnType<ReturnType<typeof savings>["rank"]>) =>
    ranked.filter((entry) => entry.gap?.reason === "unavailable").map((entry) => entry.offer._id);

  beforeEach(() => {
    store.dispatch(setCartItems(PAID_FIVE));
    store.dispatch(setEntityMap({ entityMap: { nachos: NACHOS, tortilla: TORTILLA } }));
  });

  it.each([
    ["has nothing in stock", DIP(true)],
    ["has no positive max", DIP(false, 0)],
  ])("an item whose required group %s → a gone row; a mixed 'or' side keeps its row", (_label, modifiersMap) => {
    store.dispatch(setModifiersMap({ modifiersMap }));
    const ranked = savings().rank([buy("dead", [raw("nachos")]), buy("mixed", [raw("nachos", "or"), raw("tortilla", "or")])]);
    expect(goneIds(ranked)).toEqual(["dead"]);
    expect(ranked.find((entry) => entry.offer._id === "dead")).toMatchObject({ eligible: false, gap: { reason: "unavailable" } });
  });

  it("re-evaluates with stock: PAY's feed puts the dip's only option out → gone; back in stock → not", () => {
    store.dispatch(setModifiersMap({ modifiersMap: DIP(false) }));
    const offer = buy("dead", [raw("nachos")]);
    const { result } = renderHook(() => useOfferSavings(), { wrapper });
    expect(goneIds(result.current.rank([offer]))).toEqual([]);
    act(() => {
      store.dispatch(setOutOfStockItems({ salsa: { _id: "salsa", type: "addon", inStock: false } }));
    });
    expect(goneIds(result.current.rank([offer]))).toEqual(["dead"]);
    act(() => {
      store.dispatch(setOutOfStockItems({ salsa: { _id: "salsa", type: "addon", inStock: true } }));
    });
    expect(goneIds(result.current.rank([offer]))).toEqual([]);
  });

  it("a size entry is judged by its own size: the dead size's offer is gone, the live size's is not", () => {
    store.dispatch(setModifiersMap({ modifiersMap: DIP(true) }));
    const MEDIUM = { id: "fries-m", name: "Medium", price: 3, isActive: true, modifiers: [] };
    const LARGE = { id: "fries-l", name: "Large", price: 5, isActive: true, modifiers: ["dip"] };
    const FRIES = { id: "fries", name: "Fries", price: 0, hasVariant: true, isVariant: false, variants: [MEDIUM, LARGE] };
    store.dispatch(setEntityMap({ entityMap: { fries: FRIES } }));
    store.dispatch(
      setVariantObject({
        variantObject: { "fries-m": { baseItem: FRIES, variant: MEDIUM }, "fries-l": { baseItem: FRIES, variant: LARGE } },
      })
    );
    expect(goneIds(savings().rank([buy("large", [raw("fries-l")]), buy("medium", [raw("fries-m")])]))).toEqual(["large"]);
  });
});
