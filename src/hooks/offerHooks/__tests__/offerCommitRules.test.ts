/**
 * SDK @cx-sdk/ordering/offer/offerCommitRules, run from the TB tree (lane
 * "offers" — the SDK suite stays untouched). Pure functions: the routing gate
 * (G2), the sameOrLess ceiling + 7th revalidation check (31b / G1), the
 * buy-stage gate and the group-wise "pick N" rules (G3). Fixtures are
 * converter-shaped (useOfferConverters output); production getItems entries
 * carry no `type`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHighestAmountGetItemValueFromCart,
  getHighestAmountItemValueFromCartThatMatchesWithOfferBuyItems,
} from "@cx-sdk/ordering/offer/offerEngine";
import {
  applySameOrLessCeiling,
  canAddGroupWiseUnit,
  canCompleteGroupWisePicks,
  canOfferBuyStage,
  getGroupWisePickState,
  isFixedGetEntry,
  isSameOrLessViolated,
  routeOfferCommit,
  type GroupWisePick,
} from "@cx-sdk/ordering/offer/offerCommitRules";
import {
  computeRealisedSaving,
  type SavingsContext,
  type SavingsOffer,
} from "@cx-sdk/ordering/offer/offerSavings";
import type {
  BuyStageMode,
  BuyStageView,
} from "@cx-sdk/ordering/offer/buyStageUtils";
import P7B_FIXTURE_OFFERS from "../../../../tests/e2e/fixtures/offers.json";

// Pass-through spies on the two engine helpers the ceiling / 7th check call,
// so "never evaluated" is asserted directly (offerCommitRules imports them
// relatively — vi.mock matches the resolved module).
vi.mock("@cx-sdk/ordering/offer/offerEngine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@cx-sdk/ordering/offer/offerEngine")>();
  return {
    ...actual,
    getHighestAmountItemValueFromCartThatMatchesWithOfferBuyItems: vi.fn(
      actual.getHighestAmountItemValueFromCartThatMatchesWithOfferBuyItems
    ),
    getHighestAmountGetItemValueFromCart: vi.fn(
      actual.getHighestAmountGetItemValueFromCart
    ),
  };
});

const highestBuySpy = vi.mocked(
  getHighestAmountItemValueFromCartThatMatchesWithOfferBuyItems
);
const highestGetSpy = vi.mocked(getHighestAmountGetItemValueFromCart);

/** Fixtures carry converter fields SavingsOffer does not declare. */
const asOffer = (fixture: object): SavingsOffer =>
  fixture as unknown as SavingsOffer;

/* ----------------------------- cart rows ----------------------------- */

/** Paid CUSTOMIZABLE row (£8 base; a non-combo add-on never counts). */
const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 8.6,
  customizations: {
    sauce_group: [{ id: "onions", name: "Add Onions", price: 0.6, quantity: 1 }],
  },
};

const paidRow = (id: string, price: number, itemId = `${id}-1`) => ({
  id,
  itemId,
  quantity: 1,
  type: "ITEM",
  price,
  total_price: price,
  customizations: {},
});

const freebieRow = (id: string, price: number) => ({
  ...paidRow(id, price, `${id}-free`),
  isGetItem: true,
});

/* ------------------------------ entities ----------------------------- */

const plainEntity = (id: string, name: string, price: number) => ({
  id,
  name,
  price,
  modifiers: [] as string[],
  hasVariant: false,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  type: "ITEM",
  discounted_total_price: 0,
  undiscounted_total_price: price,
});

/** Converter CUSTOMIZABLE branch: customizations seeded, NO price stamps. */
const CUSTOMIZABLE_ENTITY = {
  id: "cheese-burger",
  name: "Cheese Burger",
  price: 8,
  modifiers: ["sauce_group"],
  hasVariant: false,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  type: "CUSTOMIZABLE",
  customizations: { sauce_group: [] as unknown[] },
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8 },
  baseItemPrice: 8,
};

const VARIANT_ENTITY = {
  id: "fries",
  name: "Fries",
  price: 3,
  hasVariant: true,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  type: "VARIANT",
  discounted_total_price: 0,
  undiscounted_total_price: 3,
  variants: [{ id: "fries-m", name: "Medium", price: 3, isActive: true }],
};

const getEntry = (
  baseItemId: string,
  relation: "and" | "or",
  entities: object
) => ({
  _id: `gi-${baseItemId}`,
  baseItemId,
  relation,
  discountType: "percent",
  value: 100,
  quantity: 1,
  entities,
});

const SALAD_AND = getEntry("greek-salad", "and", plainEntity("greek-salad", "Greek Salad", 17));
const SALAD_OR = { ...SALAD_AND, relation: "or" };
const CAESAR_OR = getEntry("caesar-dressing", "or", plainEntity("caesar-dressing", "Caesar Dressing", 2));
const CAESAR_AND = { ...CAESAR_OR, relation: "and" };
const TORTILLA_OR = getEntry("tortilla-sauce", "or", plainEntity("tortilla-sauce", "Tortilla Sauce", 2));

/* ------------------------------- offers ------------------------------ */

const base = {
  isAvailable: true,
  isComplimentary: false,
  autoApplied: false,
  sameOrLess: false,
  getItemOnly: false,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  minBillAmount: null,
  minItemCount: null,
  maxDiscount: null,
  isAndOffer: true,
  isBuyAndOffer: false,
  applicable: {
    on: "complete",
    isExclude: false,
    isInclude: false,
    rawItems: [] as unknown[],
  },
  getItems: {},
};

const ITEM = { name: "item", value: 0 };

const FLAT = { ...base, _id: "flat-2", name: "£2 off", type: { name: "amount", value: 2 } };
const PERCENT = { ...base, _id: "pct-25", name: "25% off", type: { name: "percent", value: 25 } };
const LEAST_EMPTY_GET = {
  ...base,
  _id: "least-2",
  name: "Buy 2, cheapest free",
  type: ITEM,
  getLeastValueItem: true,
  leastItemValueCount: { buyQuantity: 2, getQuantity: 1, getDiscount: 100 },
  applicable: { ...base.applicable, rawItems: [{ item: { baseItemId: "tortilla-sauce" }, quantity: 1 }] },
  getItems: { items: [], categories: [] },
};
const FIXED_AND_ITEM = {
  ...base,
  _id: "free-salad",
  name: "Free Greek Salad",
  type: ITEM,
  getItemOnly: true,
  getItems: { items: [SALAD_AND], categories: [] },
};
const TWO_OR_ITEMS = {
  ...base,
  _id: "sauce-choice",
  name: "Free sauce of your choice",
  type: ITEM,
  getItemOnly: true,
  isAndOffer: false,
  getItems: { items: [TORTILLA_OR, CAESAR_OR], categories: [] },
};
const SINGLE_AND_CUSTOMIZABLE = {
  ...FIXED_AND_ITEM,
  _id: "free-burger",
  getItems: { items: [getEntry("cheese-burger", "and", CUSTOMIZABLE_ENTITY)], categories: [] },
};
const SINGLE_AND_VARIANT = {
  ...FIXED_AND_ITEM,
  _id: "free-fries",
  getItems: { items: [getEntry("fries", "and", VARIANT_ENTITY)], categories: [] },
};
const GROUP_WISE = {
  ...base,
  _id: "group-wise",
  type: ITEM,
  buygetGroupWiseOffer: true,
  buygetGroupWiseOfferValues: { buyQuantity: 2, getQuantity: 1, value: "100", discountType: "percent" },
  applicable: { ...base.applicable, rawItems: [{ item: { baseItemId: "tortilla-sauce" } }] },
  getItems: { items: [SALAD_AND, CAESAR_AND], categories: [] },
};
const CATEGORY_ONLY = {
  ...FIXED_AND_ITEM,
  _id: "category-only",
  getItems: {
    items: [],
    categories: [
      {
        _id: "sides",
        name: "Sides",
        quantity: 1,
        relation: "and",
        value: 100,
        discountType: "percent",
        entities: [{ id: "greek-salad", price: 17 }],
      },
    ],
  },
};

const CTX: SavingsContext = { cartItems: [BURGER_ROW], cartValue: 8.6, cartQuantity: 1 };
const route = (fixture: object) =>
  routeOfferCommit(asOffer(fixture), computeRealisedSaving(asOffer(fixture), CTX));

/**
 * The P7b regression fixture (tests/e2e/fixtures/offers.json), resolved the
 * way useOfferConverters resolves it against slim-menu: isAndOffer stamped,
 * each getItems entry's `entities` = the menu entity + discount stamps.
 */
const FIXTURE_MENU: Record<string, { name: string; price: number }> = {
  "5dd1093829754a432f2c32e2": { name: "Greek Salad", price: 17 },
  "5dd109392b29ee1f2a82a49b": { name: "Tortilla Sauce", price: 2 },
  "5dd109392b29ee1f2a82a49c": { name: "Caesar Dressing", price: 2 },
};
type FixtureEntry = { baseItemId: string; relation: string };
const resolveLikeConverter = (offer: (typeof P7B_FIXTURE_OFFERS)[number]) => {
  const items = ((offer.getItems as { items?: FixtureEntry[] }).items ?? []).map(
    (entry) => {
      const menu = FIXTURE_MENU[entry.baseItemId];
      return { ...entry, entities: plainEntity(entry.baseItemId, menu.name, menu.price) };
    }
  );
  return {
    ...offer,
    isAvailable: true,
    isBuyAndOffer: false,
    isAndOffer: !items.some((entry) => entry.relation === "or"),
    getItems: { ...offer.getItems, ...(items.length > 0 ? { items } : {}) },
  };
};

const view = (mode: BuyStageMode): BuyStageView => ({
  mode,
  groups: [],
  sharedRequiredQuantity: mode === "least" || mode === "group" ? 2 : 0,
});

beforeEach(() => {
  highestBuySpy.mockClear();
  highestGetSpy.mockClear();
});

describe("routeOfferCommit — the ONE commit routing gate", () => {
  it.each([
    ["flat (amount) → atomic swap", FLAT, "swap"],
    ["percent → atomic swap", PERCENT, "swap"],
    ["least-value with getItems {items:[],categories:[]} → swap (regression guard)", LEAST_EMPTY_GET, "swap"],
    ["single fixed 'and' ITEM freebie → direct", FIXED_AND_ITEM, "direct"],
    ["two 'or' ITEM freebies → picker", TWO_OR_ITEMS, "picker"],
    ["group-wise → picker", GROUP_WISE, "picker"],
    ["category-only get side → picker", CATEGORY_ONLY, "picker"],
  ])("%s", (_label, offer, expected) => {
    expect(route(offer)).toBe(expected);
  });

  it.each([
    ["CUSTOMIZABLE", SINGLE_AND_CUSTOMIZABLE],
    ["VARIANT", SINGLE_AND_VARIANT],
  ])(
    "G2 pin: a single 'and' %s freebie goes to the picker, although its realised saving alone would have swapped it on at £0",
    (_label, offer) => {
      // The trap: one candidate, no "or" → requiresChoice:false.
      expect(computeRealisedSaving(asOffer(offer), CTX).requiresChoice).toBe(false);
      expect(route(offer)).toBe("picker");
    }
  );

  it("an item offer with nothing resolvable on its get side is blocked, never a £0 swap", () => {
    expect(route({ ...FIXED_AND_ITEM, getItems: {} })).toBe("blocked");
    expect(
      route({ ...FIXED_AND_ITEM, getItems: { items: [{ ...SALAD_AND, entities: {} }] } })
    ).toBe("blocked");
  });

  it("the 4 P7b fixture offers keep their routes (percent, flat → swap; free salad → direct; sauce choice → picker)", () => {
    const resolved = P7B_FIXTURE_OFFERS.map(resolveLikeConverter);
    expect(resolved.map((offer) => offer._id)).toEqual([
      "offer-percent-25",
      "offer-flat-2",
      "offer-free-salad",
      "offer-free-sauce-choice",
    ]);
    expect(resolved.map(route)).toEqual(["swap", "swap", "direct", "picker"]);
  });
});

/* -------------------------- sameOrLess (31b) -------------------------- */

/** Plain BOGO, sameOrLess on: buy one Tortilla Sauce (£2). */
const sameOrLessBogo = (getItems: object, extra: object = {}) => ({
  ...base,
  _id: "sol-bogo",
  name: "Buy a sauce, get one",
  type: ITEM,
  sameOrLess: true,
  isAndOffer: false,
  applicable: {
    ...base.applicable,
    rawItems: [{ item: { baseItemId: "tortilla-sauce", name: "Tortilla Sauce" }, quantity: 1, relation: "or" }],
  },
  getItems,
  ...extra,
});
const BUY_SAUCE_CART = [paidRow("tortilla-sauce", 2)];

describe("applySameOrLessCeiling", () => {
  it("a non-sameOrLess offer comes back as the SAME reference and is never evaluated", () => {
    const offer = asOffer({ ...sameOrLessBogo({ items: [SALAD_OR, CAESAR_OR] }), sameOrLess: false });
    const result = applySameOrLessCeiling(offer, BUY_SAUCE_CART);
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.offer).toBe(offer);
    expect(highestBuySpy).not.toHaveBeenCalled();
  });

  // Mutation-verifier pin: every fork flag-gate exclusion, not just a few.
  it.each([
    ["least-value", { getLeastValueItem: true }],
    ["getItemOnly", { getItemOnly: true }],
    ["buyget item-only", { buygetItemOnly: true }],
    ["group-wise", { buygetGroupWiseOffer: true }],
    ["dynamic express", { dynamicItemExpressOffer: true }],
  ])("a sameOrLess %s offer is outside the fork flag gate: the SAME reference, never evaluated", (_label, flags) => {
    const offer = asOffer({ ...sameOrLessBogo({ items: [SALAD_OR, CAESAR_OR] }), ...flags });
    const result = applySameOrLessCeiling(offer, BUY_SAUCE_CART);
    expect(result.kind === "ok" && result.offer).toBe(offer);
    expect(highestBuySpy).not.toHaveBeenCalled();
  });

  it("buy £2 against get £17 and £2 → only the £2 entry survives, in a NEW object; the input is unmutated", () => {
    const offer = asOffer(sameOrLessBogo({ items: [SALAD_OR, CAESAR_OR], categories: [] }));
    const before = structuredClone(offer);
    const result = applySameOrLessCeiling(offer, BUY_SAUCE_CART);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.offer).not.toBe(offer);
    expect(result.offer.getItems?.items).toEqual([CAESAR_OR]);
    expect(result.offer.getItems?.categories).toEqual([]);
    expect(offer).toEqual(before);
    expect(highestBuySpy).toHaveBeenCalledTimes(1);
  });

  it("an isAndOffer that loses an entry is blocked (fork: not applicable)", () => {
    const offer = asOffer(sameOrLessBogo({ items: [SALAD_AND, CAESAR_AND] }, { isAndOffer: true }));
    expect(applySameOrLessCeiling(offer, BUY_SAUCE_CART)).toEqual({ kind: "blocked" });
  });

  it("every entry over the ceiling → blocked up front", () => {
    const offer = asOffer(sameOrLessBogo({ items: [SALAD_OR] }));
    expect(applySameOrLessCeiling(offer, BUY_SAUCE_CART)).toEqual({ kind: "blocked" });
  });

  it("VARIANT: over-ceiling, inactive and sold-out variants are flagged isGetVariantDisabled; the entry is dropped when none remain", () => {
    const drink = getEntry("drink", "or", {
      id: "drink",
      name: "Drink",
      price: 1,
      type: "VARIANT",
      variants: [
        { id: "small", price: 1.5, isActive: true },
        { id: "large", price: 5, isActive: true },
        { id: "inactive", price: 1, isActive: false },
        { id: "sold-out", price: 1, isActive: true, outOfStock: true },
      ],
    });
    const shake = getEntry("shake", "or", {
      id: "shake",
      name: "Shake",
      price: 0,
      type: "VARIANT",
      variants: [{ id: "shake-l", price: 6, isActive: true }],
    });
    const offer = asOffer(sameOrLessBogo({ items: [drink, shake], categories: [] }));
    const before = structuredClone(offer);
    const result = applySameOrLessCeiling(offer, BUY_SAUCE_CART);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const items = result.offer.getItems?.items ?? [];
    expect(items.map((entry) => (entry as { baseItemId?: string }).baseItemId)).toEqual(["drink"]);
    const variants = (items[0].entities as { variants: Array<{ id: string; isGetVariantDisabled?: boolean }> })
      .variants;
    expect(variants.map((v) => [v.id, Boolean(v.isGetVariantDisabled)])).toEqual([
      ["small", false],
      ["large", true],
      ["inactive", true],
      ["sold-out", true],
    ]);
    expect(offer).toEqual(before); // flags live on the copy only
  });

  it("a fixed-size (variant-id) grant is judged by its OWN size — a cheaper sibling cannot carry it", () => {
    const fries = (selected: { id: string; price: number }) =>
      getEntry(selected.id, "or", {
        id: "fries",
        name: "Fries",
        price: 0,
        type: "VARIANT",
        isVariantSelected: true,
        selectedVariant: { ...selected, isActive: true },
        variants: [
          { id: "fries-s", price: 1, isActive: true },
          { id: "fries-l", price: 9, isActive: true },
        ],
      });
    const large = asOffer(sameOrLessBogo({ items: [fries({ id: "fries-l", price: 9 })] }));
    const small = asOffer(sameOrLessBogo({ items: [fries({ id: "fries-s", price: 1 })] }));
    expect(applySameOrLessCeiling(large, BUY_SAUCE_CART)).toEqual({ kind: "blocked" });
    const kept = applySameOrLessCeiling(small, BUY_SAUCE_CART);
    expect(kept.kind === "ok" && kept.offer).toBe(small);
  });

  it.each([
    ["sold out", { outOfStock: true }],
    ["inactive", { isActive: false }],
  ])("a fixed-size grant whose OWN size is %s is dropped even under the ceiling (nothing left → blocked)", (_label, flags) => {
    const smallFries = getEntry("fries-s", "or", {
      id: "fries",
      name: "Fries",
      price: 0,
      type: "VARIANT",
      isVariantSelected: true,
      selectedVariant: { id: "fries-s", price: 1, isActive: true, ...flags },
      variants: [{ id: "fries-s", price: 1, isActive: true, ...flags }],
    });
    const offer = asOffer(sameOrLessBogo({ items: [smallFries] }));
    expect(applySameOrLessCeiling(offer, BUY_SAUCE_CART)).toEqual({ kind: "blocked" });
  });

  it("categories are filtered the same way; an unresolved group rides along untouched", () => {
    const empty = { _id: "empty", entities: [] as object[] };
    const offer = asOffer(
      sameOrLessBogo({
        items: [CAESAR_OR],
        categories: [{ _id: "sides", entities: [{ id: "x", price: 1 }, { id: "y", price: 9 }] }, empty],
      })
    );
    const result = applySameOrLessCeiling(offer, BUY_SAUCE_CART);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const categories = result.offer.getItems?.categories ?? [];
    expect(categories[0].entities?.map((e) => (e as { id: string }).id)).toEqual(["x"]);
    expect(categories[1]).toBe(empty);
    expect(result.offer.getItems?.items).toEqual([CAESAR_OR]);
  });

  it("nothing over the ceiling (items AND categories) → the SAME reference, so the picker verdict carries no `offer`", () => {
    const offer = asOffer(
      sameOrLessBogo({
        items: [CAESAR_OR],
        categories: [{ _id: "sides", entities: [{ id: "x", price: 1 }, { id: "y", price: 2 }] }],
      })
    );
    const result = applySameOrLessCeiling(offer, BUY_SAUCE_CART);
    expect(result.kind === "ok" && result.offer).toBe(offer);
    expect(highestBuySpy).toHaveBeenCalledTimes(1); // evaluated, just nothing to drop
  });

  it("highest buy value 0 (no qualifying buy row) → pass-through, the same reference (fork `if (highestAmountItemValue)`)", () => {
    const offer = asOffer(sameOrLessBogo({ items: [SALAD_OR, CAESAR_OR] }));
    const result = applySameOrLessCeiling(offer, [BURGER_ROW]);
    expect(result.kind === "ok" && result.offer).toBe(offer);
  });

  it("an input that throws inside the engine is blocked — never grant a freebie we could not verify", () => {
    const offer = asOffer(sameOrLessBogo({ items: [CAESAR_OR] }));
    // A CUSTOMIZABLE buy row without `customizations` makes the engine throw.
    const malformed = [{ id: "tortilla-sauce", itemId: "t-1", type: "CUSTOMIZABLE", price: 2, quantity: 1 }];
    expect(applySameOrLessCeiling(offer, malformed)).toEqual({ kind: "blocked" });
  });
});

describe("isSameOrLessViolated — revalidation check 7", () => {
  const buyBurgerSol = asOffer({
    ...sameOrLessBogo({ items: [SALAD_OR] }),
    applicable: { ...base.applicable, rawItems: [{ item: { baseItemId: "cheese-burger" }, quantity: 1, relation: "or" }] },
  });
  const buySaladSol = asOffer({
    ...sameOrLessBogo({ items: [CAESAR_OR] }),
    applicable: { ...base.applicable, rawItems: [{ item: { baseItemId: "greek-salad" }, quantity: 1, relation: "or" }] },
  });

  it("buy £8 with a £17 freebie row → violated; buy £17 with an £8 freebie row → not", () => {
    expect(isSameOrLessViolated(buyBurgerSol, [BURGER_ROW, freebieRow("greek-salad", 17)])).toBe(true);
    expect(isSameOrLessViolated(buySaladSol, [paidRow("greek-salad", 17), freebieRow("burger", 8)])).toBe(false);
  });

  it("an engine throw reads as NOT violated (revalidation never removes on an evaluation error)", () => {
    const malformed = [{ id: "cheese-burger", itemId: "cb-x", type: "CUSTOMIZABLE", price: 8, quantity: 1 }];
    expect(isSameOrLessViolated(buyBurgerSol, [...malformed, freebieRow("greek-salad", 17)])).toBe(false);
  });

  it.each([
    ["sameOrLess off", { sameOrLess: false }],
    ["least-value", { getLeastValueItem: true }],
    ["getItemOnly", { getItemOnly: true }],
    ["group-wise", { buygetGroupWiseOffer: true }],
    ["buyget item-only", { buygetItemOnly: true }],
    ["dynamic express", { dynamicItemExpressOffer: true }],
  ])("%s → false, and no engine helper is ever called", (_label, flags) => {
    const offer = asOffer({ ...(buyBurgerSol as object), ...flags });
    expect(isSameOrLessViolated(offer, [BURGER_ROW, freebieRow("greek-salad", 17)])).toBe(false);
    expect(highestBuySpy).not.toHaveBeenCalled();
    expect(highestGetSpy).not.toHaveBeenCalled();
  });
});

describe("canOfferBuyStage — only journeys the shell can finish", () => {
  const bogo = asOffer(sameOrLessBogo({ items: [CAESAR_OR], categories: [] }, { sameOrLess: false }));

  it("null view, group mode, or resolvable get-categories → false", () => {
    expect(canOfferBuyStage(bogo, null)).toBe(false);
    expect(canOfferBuyStage(bogo, view("group"))).toBe(false);
    const withCategories = asOffer({
      ...(bogo as object),
      getItems: { items: [CAESAR_OR], categories: [{ _id: "sides", entities: [{ id: "x", price: 1 }] }] },
    });
    expect(canOfferBuyStage(withCategories, view("plain-and"))).toBe(false);
  });

  it("plain-and, plain-or and least → true", () => {
    expect(canOfferBuyStage(bogo, view("plain-and"))).toBe(true);
    expect(canOfferBuyStage(bogo, view("plain-or"))).toBe(true);
    // Least grants the cheapest BUY item, so an empty get side is fine.
    expect(canOfferBuyStage(asOffer(LEAST_EMPTY_GET), view("least"))).toBe(true);
  });

  it("a plain BOGO with nothing resolvable on its get side → false (CONTINUE could only swap it on at £0)", () => {
    const nothingToGrant = asOffer({ ...(bogo as object), getItems: { items: [{ ...CAESAR_OR, entities: {} }] } });
    expect(canOfferBuyStage(nothingToGrant, view("plain-and"))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Group-wise "pick N" (G3; fork ItemSelection.tsx:311-360)
 * ------------------------------------------------------------------ */

/**
 * Production-shaped group-wise entries (POS: OR-only, no Qty/Value columns):
 * relation "or", NO quantity, empty value — the commit stamps the shared
 * buygetGroupWiseOfferValues discount and the picked units.
 */
const gwEntry = (baseItemId: string, entities: object) => ({
  _id: `gi-gw-${baseItemId}`,
  baseItemId,
  relation: "or",
  discountType: "percent",
  value: "",
  quantity: null,
  entities,
});
const GW_SALAD = gwEntry("greek-salad", plainEntity("greek-salad", "Greek Salad", 17));
const GW_TORTILLA = gwEntry("tortilla-sauce", plainEntity("tortilla-sauce", "Tortilla Sauce", 2));
const GW_CAESAR = gwEntry("caesar-dressing", plainEntity("caesar-dressing", "Caesar Dressing", 2));
const GW_BURGER = gwEntry("cheese-burger", CUSTOMIZABLE_ENTITY);
/** "Pick 2" over FOUR configured candidates. */
const PICK_2 = {
  ...GROUP_WISE,
  _id: "gw-pick-2",
  isAndOffer: false,
  buygetGroupWiseOfferValues: { buyQuantity: 1, getQuantity: 2, value: "100", discountType: "percent" },
  getItems: { items: [GW_SALAD, GW_TORTILLA, GW_CAESAR, GW_BURGER], categories: [] },
};
/** A customized burger row as the embedded PDP stages it. */
const STAGED_BURGER = { id: "cheese-burger", itemId: "cb-staged-1", type: "CUSTOMIZABLE", quantity: 1, price: 8, total_price: 9 };

type Pick = GroupWisePick;
const pickState = (fixture: object, picks: Pick[]) =>
  getGroupWisePickState(asOffer(fixture), picks);
const stamped = (entry: object, quantity: number, entities?: object) => ({
  ...entry,
  discountType: "percent",
  value: 100,
  quantity,
  ...(entities ? { entities } : {}),
});

describe("group-wise pick N — exactly getQuantity, exactly the picks (G3)", () => {
  it("isFixedGetEntry: ITEM and fixed-size variant-id entries are fixed; a customizable or choose-a-size entry is not", () => {
    expect(isFixedGetEntry(SALAD_AND)).toBe(true);
    expect(isFixedGetEntry(getEntry("fries-l", "or", { ...VARIANT_ENTITY, isVariantSelected: true }))).toBe(true);
    expect(isFixedGetEntry(GW_BURGER)).toBe(false);
    expect(isFixedGetEntry(getEntry("fries", "and", VARIANT_ENTITY))).toBe(false);
    expect(isFixedGetEntry({ entities: {} })).toBe(false);
    expect(isFixedGetEntry(null)).toBe(false);
  });

  it("fewer or more than getQuantity has no commit; exactly N commits the picks, each with the shared discount and the picked units (never the entry's null quantity / empty value)", () => {
    expect(pickState(PICK_2, [])).toEqual({ need: 2, picked: 0, remaining: 2, commitItems: null });
    expect(pickState(PICK_2, [{ entry: GW_SALAD, quantity: 1 }])).toMatchObject({
      picked: 1,
      remaining: 1,
      commitItems: null,
    });
    expect(
      pickState(PICK_2, [
        { entry: GW_SALAD, quantity: 1 },
        { entry: GW_TORTILLA, quantity: 1 },
        { entry: GW_CAESAR, quantity: 1 },
      ])
    ).toMatchObject({ picked: 3, remaining: 0, commitItems: null });

    const exact = pickState(PICK_2, [
      { entry: GW_SALAD, quantity: 1 },
      { entry: GW_CAESAR, quantity: 1 },
    ]);
    expect(exact).toMatchObject({ need: 2, picked: 2, remaining: 0 });
    expect(exact.commitItems).toEqual([stamped(GW_SALAD, 1), stamped(GW_CAESAR, 1)]);
  });

  it("a repeat of one fixed entry is one line carrying its units", () => {
    expect(pickState(PICK_2, [{ entry: GW_TORTILLA, quantity: 2 }]).commitItems).toEqual([
      stamped(GW_TORTILLA, 2),
    ]);
  });

  it("a customizable entry is picked ONCE, with its customized row as the line's entities; twice, row-less, or one row behind two lines → no commit", () => {
    expect(
      pickState(PICK_2, [
        { entry: GW_BURGER, quantity: 1, entities: STAGED_BURGER },
        { entry: GW_SALAD, quantity: 1 },
      ]).commitItems
    ).toEqual([stamped(GW_BURGER, 1, STAGED_BURGER), stamped(GW_SALAD, 1)]);

    expect(pickState(PICK_2, [{ entry: GW_BURGER, quantity: 2, entities: STAGED_BURGER }]).commitItems).toBeNull();
    expect(
      pickState(PICK_2, [
        { entry: GW_BURGER, quantity: 1 },
        { entry: GW_SALAD, quantity: 1 },
      ]).commitItems
    ).toBeNull();
    const twin = { ...GW_BURGER, _id: "gi-gw-burger-twin" };
    const twins = { ...PICK_2, getItems: { items: [GW_BURGER, twin], categories: [] } };
    expect(
      pickState(twins, [
        { entry: GW_BURGER, quantity: 1, entities: STAGED_BURGER },
        { entry: twin, quantity: 1, entities: STAGED_BURGER },
      ]).commitItems
    ).toBeNull();
  });

  it("every line must be one of THIS offer's resolvable entries, once, in whole positive units", () => {
    const foreign = gwEntry("water", plainEntity("water", "Water", 1));
    expect(pickState(PICK_2, [{ entry: GW_SALAD, quantity: 1 }, { entry: foreign, quantity: 1 }]).commitItems).toBeNull();
    // Same entry twice (a clone shares the `_id`).
    expect(pickState(PICK_2, [{ entry: GW_SALAD, quantity: 1 }, { entry: { ...GW_SALAD }, quantity: 1 }]).commitItems).toBeNull();
    expect(pickState(PICK_2, [{ entry: GW_SALAD, quantity: 1.5 }, { entry: GW_CAESAR, quantity: 0.5 }]).commitItems).toBeNull();
    const unresolved = { ...GW_CAESAR, entities: {} };
    const withUnresolved = { ...PICK_2, getItems: { items: [GW_SALAD, unresolved], categories: [] } };
    expect(pickState(withUnresolved, [{ entry: GW_SALAD, quantity: 1 }, { entry: unresolved, quantity: 1 }]).commitItems).toBeNull();
  });

  it("an unconfigured getQuantity, or an offer that is not group-wise, never commits", () => {
    const unconfigured = {
      ...PICK_2,
      buygetGroupWiseOfferValues: { ...PICK_2.buygetGroupWiseOfferValues, getQuantity: null },
    };
    expect(pickState(unconfigured, [{ entry: GW_SALAD, quantity: 1 }])).toMatchObject({ need: 0, commitItems: null });
    expect(pickState(TWO_OR_ITEMS, [{ entry: TORTILLA_OR, quantity: 1 }])).toMatchObject({ need: 0, commitItems: null });
  });

  it("canAddGroupWiseUnit: only with room under getQuantity; a fixed entry repeats, a customizable one is picked once; never a foreign entry or an unconfigured offer", () => {
    const add = (picks: Pick[], entry: Pick["entry"], fixture: object = PICK_2) =>
      canAddGroupWiseUnit(asOffer(fixture), picks, entry);
    expect(add([], GW_SALAD)).toBe(true);
    expect(add([{ entry: GW_TORTILLA, quantity: 1 }], GW_TORTILLA)).toBe(true);
    expect(add([{ entry: GW_TORTILLA, quantity: 2 }], GW_SALAD)).toBe(false);
    expect(add([{ entry: GW_TORTILLA, quantity: 2 }], GW_TORTILLA)).toBe(false);
    expect(add([], GW_BURGER)).toBe(true);
    expect(add([{ entry: GW_BURGER, quantity: 1, entities: STAGED_BURGER }], GW_BURGER)).toBe(false);
    expect(add([], gwEntry("water", plainEntity("water", "Water", 1)))).toBe(false);
    const zero = { ...PICK_2, buygetGroupWiseOfferValues: { ...PICK_2.buygetGroupWiseOfferValues, getQuantity: 0 } };
    expect(add([], GW_SALAD, zero)).toBe(false);
  });

  it("canCompleteGroupWisePicks: a fixed entry can always fill the group, a customizable one adds ONE unit — 'get 2' over one customizable entry never fills; nor do no entries or an unconfigured offer", () => {
    const fill = (fixture: object, entries: Pick["entry"][], picks: Pick[] = []) =>
      canCompleteGroupWisePicks(asOffer(fixture), picks, entries);
    const BURGER_PICK: Pick = { entry: GW_BURGER, quantity: 1, entities: STAGED_BURGER };
    const all = [GW_SALAD, GW_TORTILLA, GW_CAESAR, GW_BURGER];
    expect(fill(PICK_2, all)).toBe(true);
    expect(fill(PICK_2, all, [BURGER_PICK])).toBe(true);
    expect(fill(PICK_2, all, [{ entry: GW_TORTILLA, quantity: 2 }])).toBe(true);

    const onlySauce = { ...PICK_2, getItems: { items: [GW_TORTILLA], categories: [] } };
    expect(fill(onlySauce, [GW_TORTILLA])).toBe(true);
    const onlyBurger = { ...PICK_2, getItems: { items: [GW_BURGER], categories: [] } };
    expect(fill(onlyBurger, [GW_BURGER])).toBe(false);
    expect(fill(onlyBurger, [GW_BURGER], [BURGER_PICK])).toBe(false);
    const twin = { ...GW_BURGER, _id: "gi-gw-burger-twin" };
    const twins = { ...PICK_2, getItems: { items: [GW_BURGER, twin], categories: [] } };
    expect(fill(twins, [GW_BURGER, twin])).toBe(true);
    expect(fill(twins, [GW_BURGER, twin], [BURGER_PICK])).toBe(true);

    // A category-only get side (G4) shows no entries; an unconfigured group never fills.
    expect(fill(PICK_2, [])).toBe(false);
    const zero = { ...PICK_2, buygetGroupWiseOfferValues: { ...PICK_2.buygetGroupWiseOfferValues, getQuantity: null } };
    expect(fill(zero, all)).toBe(false);
  });
});

/** Freeze a fixture all the way down, the way Immer hands redux state out. */
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe("group-wise pick N — production shapes and over-grant probes (G3, test author)", () => {
  /** PICK_2 with some buygetGroupWiseOfferValues fields replaced. */
  const withValues = (values: object) => ({
    ...PICK_2,
    buygetGroupWiseOfferValues: { ...PICK_2.buygetGroupWiseOfferValues, ...values },
  });
  const SALAD_1: Pick = { entry: GW_SALAD, quantity: 1 };
  const CAESAR_1: Pick = { entry: GW_CAESAR, quantity: 1 };

  it.each([
    ["'2' (the backend keeps buygetGroupWiseOfferValues as a Mixed object)", 2, true, "2"],
    ["2.9 (floored)", 2, true, 2.9],
    ["-1", 0, false, -1],
    ["'two'", 0, false, "two"],
  ])("getQuantity %s → need %i; two picks commit: %s", (_label, need, commits, getQuantity) => {
    const state = pickState(withValues({ getQuantity }), [SALAD_1, CAESAR_1]);
    expect(state.need).toBe(need);
    expect(state.commitItems !== null).toBe(commits);
  });

  it("a fixed pick grants its entry's OWN entity: a row riding on the pick cannot swap a dearer item in", () => {
    const state = pickState(PICK_2, [
      { entry: GW_TORTILLA, quantity: 1, entities: STAGED_BURGER },
      CAESAR_1,
    ]);
    expect(state.commitItems?.map((line) => line.entities)).toEqual([
      GW_TORTILLA.entities,
      GW_CAESAR.entities,
    ]);
  });

  it("a negative, zero or NaN line never makes room for an extra unit — the whole pick is refused", () => {
    const TWO_SALADS: Pick = { entry: GW_SALAD, quantity: 2 };
    expect(
      pickState(PICK_2, [TWO_SALADS, CAESAR_1, { entry: GW_TORTILLA, quantity: -1 }])
    ).toMatchObject({ picked: 3, commitItems: null });
    expect(canAddGroupWiseUnit(asOffer(PICK_2), [TWO_SALADS, { entry: GW_TORTILLA, quantity: -1 }], GW_CAESAR)).toBe(false);
    for (const quantity of [0, Number.NaN]) {
      expect(pickState(PICK_2, [SALAD_1, CAESAR_1, { entry: GW_TORTILLA, quantity }]).commitItems).toBeNull();
    }
  });

  it("pick 3 over a repeated fixed entry and a customized one: two lines of [2, 1] units in pick order, each with the shared 'amount' discount (string value coerced)", () => {
    const state = pickState(withValues({ getQuantity: 3, discountType: "amount", value: "1.5" }), [
      { entry: GW_TORTILLA, quantity: 2 },
      { entry: GW_BURGER, quantity: 1, entities: STAGED_BURGER },
    ]);
    expect(state).toMatchObject({ need: 3, picked: 3, remaining: 0 });
    expect(state.commitItems).toEqual([
      { ...GW_TORTILLA, discountType: "amount", value: 1.5, quantity: 2 },
      { ...GW_BURGER, discountType: "amount", value: 1.5, quantity: 1, entities: STAGED_BURGER },
    ]);
  });

  it("never mutates the frozen offer or picks (redux state): every commit line is a fresh object", () => {
    const offer = deepFreeze(structuredClone(PICK_2));
    const salad = offer.getItems.items[0];
    const burger = offer.getItems.items[3];
    const picks = deepFreeze([
      { entry: salad, quantity: 1 },
      { entry: burger, quantity: 1, entities: structuredClone(STAGED_BURGER) },
    ]);
    const state = getGroupWisePickState(asOffer(offer), picks);
    expect(state.commitItems).toHaveLength(2);
    expect(state.commitItems?.[0]).not.toBe(salad);
    expect(salad.quantity).toBeNull();
    expect(salad.value).toBe("");
  });

  it("each offer is its own group: the same picks commit for 'pick 2' only; another offer's entries and a get-category candidate (G4) are foreign", () => {
    const picks = [SALAD_1, CAESAR_1];
    expect(pickState(withValues({ getQuantity: 1 }), picks).commitItems).toBeNull();
    expect(pickState(PICK_2, picks).commitItems).toHaveLength(2);
    expect(pickState(withValues({ getQuantity: 3 }), picks)).toMatchObject({ remaining: 1, commitItems: null });

    const otherOffers = [
      { entry: { ...GW_SALAD, _id: "gi-other-salad" }, quantity: 1 },
      { entry: { ...GW_CAESAR, _id: "gi-other-caesar" }, quantity: 1 },
    ];
    expect(pickState(PICK_2, otherOffers).commitItems).toBeNull();

    const fries = { id: "fries", name: "Fries", price: 3, type: "ITEM" };
    const withCategory = {
      ...PICK_2,
      getItems: { ...PICK_2.getItems, categories: [{ _id: "sides", entities: [fries] }] },
    };
    const categoryPick: Pick = { entry: { entities: fries }, quantity: 1 };
    expect(pickState(withCategory, [SALAD_1, categoryPick]).commitItems).toBeNull();
    expect(canAddGroupWiseUnit(asOffer(withCategory), [SALAD_1], categoryPick.entry)).toBe(false);
  });
});
