/**
 * Lane offers-parity, U1 + U2 — every row's description, composed on the
 * kiosk (PK OffersSheet.descriptionFor parity): the offer's own description,
 * else the buy/get sentence built from the SDK's data-only AST
 * (@cx-sdk/ordering/offer/offerDescription), else the item-criteria scope
 * line, else "" (OfferRow falls back to its mechanic line). Words come from
 * keys; the sentence is joined with the relation of the clause BEFORE each
 * gap and composed from the bodies, never the prefixes (PK buyGetCopy).
 * Fixtures are the user's real payloads (backend-offers.json), converter-
 * shaped: dead buy entries carry isRawItemAvailable false, get entries carry
 * their resolved menu entity.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap, setVariantObject } from "@cx-sdk/catalog/state/Menu.slice";
import { buildBuyGetDescription } from "@cx-sdk/ordering/offer/offerDescription";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import useOfferDescription from "../useOfferDescription";
import i18n from "../../../i18n";

/* ---- the menu (names the payload does not carry) ---- */
const E = {
  heineken: { id: "6412e1ddc805a25c276cbebf", name: "Heineken", price: 300 },
  truffle: { id: "6412e1bac805a25c276cbea5", name: "Choclate Truffle", price: 120 },
  kingfisher: { id: "6412e1bad07b594627daeb99", name: "Kingfisher", price: 250 },
  brownie: { id: "6412e1dd6cea45412590ef48", name: "Choclate Brownie", price: 110 },
  thiramisu: { id: "6412e1dd6cea45412590ef49", name: "Thiramisu Cake", price: 150 },
  maharaja: { id: "6412e1f8c57c1d23252cadbf", name: "Maharaja MAC", price: 200 },
  coffee: { id: "6412e1ddc805a25c276cbec3", name: "Cold Coffee", price: 90 },
  noodles: { id: "noodles-base", name: "Veg Hakka Noodles", price: 0, hasVariant: true },
};
const ENTITY_MAP = Object.fromEntries(Object.values(E).map((e) => [e.id, e]));

/** A converter-resolved get entity: the menu entity + its stamps. */
const resolved = (entity: { id: string; name: string; price: number }) => ({
  ...entity,
  type: "ITEM",
  isGetItem: true,
});
/** The converter's variant-id branch: the base + the ONE granted size. */
const sized = (variant: string) => ({
  ...E.noodles,
  type: "VARIANT",
  isVariantSelected: true,
  selectedVariant: { id: `noodles-${variant.toLowerCase()}`, name: variant, price: 100 },
});

const buyItem = (
  entity: { id: string; name: string },
  quantity: number | null,
  relation: string,
  isRawItemAvailable = true
) => ({
  item: { _id: `map-${entity.id}`, baseItemId: entity.id, name: `POS ${entity.name}` },
  category: { _id: "cat", categoryName: "Cat" },
  quantity,
  relation,
  isRawItemAvailable,
});
const buyCategory = (categoryName: string, quantity: number | null, relation: string, isRawItemAvailable = true) => ({
  category: { _id: `cat-${categoryName}`, categoryName },
  quantity,
  relation,
  isRawItemAvailable,
});
const getItem = (
  entities: object,
  quantity: number,
  relation: string,
  discountType: string,
  value: number | string
) => ({ _id: `gi-${quantity}-${value}`, baseItemId: "x", quantity, relation, discountType, value, entities });
const getCategory = (
  name: string,
  quantity: number | null,
  relation: string,
  discountType: string,
  value: number | string,
  entities: object[] = [{ id: `${name}-1`, price: 10, type: "ITEM" }]
) => ({ _id: `cat-${name}`, name, quantity, relation, discountType, value, entities });

const base = {
  isAvailable: true,
  isComplimentary: false,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  type: { name: "item", value: "" },
};
const offer = (o: Record<string, unknown>): SavingsOffer =>
  ({
    ...base,
    getItemOnly: false,
    applicable: { on: "complete", isInclude: false, isExclude: false, rawItems: [] },
    getItems: { items: [], categories: [] },
    ...o,
  }) as SavingsOffer;

/* #17 BOGO 1 — plain "or", items both sides. */
const BOGO_1 = offer({
  _id: "bogo-1",
  name: "BOGO 1",
  applicable: { on: "complete", rawItems: [buyItem(E.heineken, 2, "or"), buyItem(E.truffle, 2, "or")] },
  getItems: {
    items: [
      getItem(resolved(E.kingfisher), 1, "or", "percent", 50),
      getItem(resolved(E.brownie), 1, "or", "percent", 70),
    ],
    categories: [],
  },
});

/* #25 BOGO OR — an item and a category on the get side. */
const BOGO_OR = offer({
  _id: "bogo-or",
  name: "BOGO OR",
  applicable: { on: "complete", rawItems: [buyItem(E.truffle, 1, "or"), buyItem(E.kingfisher, 2, "or")] },
  getItems: {
    items: [getItem(sized("Half"), 1, "or", "percent", 50)],
    categories: [getCategory("Cakes", 2, "or", "percent", 10)],
  },
});

/* #44 Order any pizza — "and" categories, an amount discount. */
const PIZZA = offer({
  _id: "pizza",
  name: "Order any pizza and get ₹50 off on drinks",
  applicable: { on: "complete", rawItems: [buyCategory("Pizza", 1, "and")] },
  getItems: { items: [], categories: [getCategory("Cold Drinks", 1, "and", "amount", 50)] },
});

/* #57 Item + Addons + Combo — "and", two dead buy entries (not on this menu). */
const ADDONS_COMBO = offer({
  _id: "addons-combo",
  name: "Item + Addons + Combo",
  applicable: {
    on: "complete",
    rawItems: [
      buyItem(E.maharaja, 1, "and"),
      buyItem({ id: "pizza-mania", name: "Pizza Mania" }, 1, "and", false),
      buyItem({ id: "stuffed-crust", name: "Stuffed Crust" }, 1, "and", false),
      buyCategory("Chaap", 1, "and"),
    ],
  },
  getItems: {
    items: [
      getItem(resolved(E.coffee), 1, "and", "percent", 100),
      getItem(resolved(E.thiramisu), 1, "and", "percent", 100),
    ],
    categories: [getCategory("Chaap", 2, "and", "percent", 1)],
  },
});

/* #11 Get Free Cake on 399 — freeItem "or". */
const FREE_CAKE = offer({
  _id: "free-cake",
  name: "Get Free Cake on 399",
  getItemOnly: true,
  getItems: {
    items: [
      getItem(resolved(E.thiramisu), 1, "or", "percent", 100),
      getItem(resolved(E.brownie), 1, "or", "percent", 100),
      getItem(resolved(E.truffle), 1, "or", "percent", 100),
    ],
    categories: [],
  },
});

/* #21 And offer with category — freeItem "and", categories only. */
const AND_CATEGORIES = offer({
  _id: "and-categories",
  name: "And offer with category",
  getItemOnly: true,
  getItems: {
    items: [],
    categories: [getCategory("Beer", 2, "and", "percent", 50), getCategory("Cakes", 1, "and", "percent", 10)],
  },
});

/* #18 Get Variant 2 — two sizes of one base, named "Base (Size)". */
const VARIANT_2 = offer({
  _id: "variant-2",
  name: "Get Variant 2",
  getItemOnly: true,
  getItems: {
    items: [
      getItem(sized("Half"), 2, "or", "percent", 50),
      getItem(resolved(E.truffle), 1, "or", "percent", 70),
      getItem(sized("Full"), 1, "or", "percent", 60),
    ],
    categories: [],
  },
});

/* Synthetic group-wise: the converter normalised the shared discount onto each entry. */
const GROUP_WISE = offer({
  _id: "group-wise",
  name: "Any 2, pick 1",
  buygetGroupWiseOffer: true,
  buygetGroupWiseOfferValues: { discountType: "percent", value: "100", getQuantity: 1, buyQuantity: 2 },
  applicable: { on: "complete", rawItems: [buyItem(E.heineken, null, "or"), buyItem(E.truffle, null, "or")] },
  getItems: {
    items: [
      { ...getItem(resolved(E.brownie), 1, "or", "percent", 100), quantity: null },
      { ...getItem(resolved(E.thiramisu), 1, "or", "percent", 100), quantity: null },
    ],
    categories: [],
  },
});

const wrapper = ({ children }: { children: ReactNode }) => createElement(Provider, { store, children });
const describer = () => renderHook(() => useOfferDescription(), { wrapper }).result;
const text = (o: SavingsOffer) => describer().current(o).text;
/** Every bidi isolate control (LRI, RLI, FSI, PDI) out. */
const strip = (s: string) => s.replace(/[\u2066-\u2069]/g, "");
/** The values i18next isolates (FSI) that open with an RTL isolate (RLI). */
const rtlRuns = (s: string) => s.split("\u2068\u2067").length - 1;

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setEntityMap({ entityMap: ENTITY_MAP }));
  store.dispatch(
    setVariantObject({
      variantObject: {
        "noodles-half": { baseItem: E.noodles, variant: { id: "noodles-half", name: "Half" } },
      },
    })
  );
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("U1 — the buy/get sentence, per mechanic (EN)", () => {
  it("bogo 'or', items both sides (BOGO 1) — buy names from the menu, never the POS name", () => {
    expect(text(BOGO_1)).toBe(
      "Buy 2 Heineken or 2 Choclate Truffle & get 1 Kingfisher at 50% off or 1 Choclate Brownie at 70% off"
    );
  });

  it("bogo, an item + a category on the get side (BOGO OR)", () => {
    expect(text(BOGO_OR)).toBe(
      "Buy 1 Choclate Truffle or 2 Kingfisher & get 1 Veg Hakka Noodles (Half) at 50% off or 2 items from Cakes category at 10% off each"
    );
  });

  it("bogo 'and', categories with an amount discount → 'with £50.00 off'", () => {
    expect(text(PIZZA)).toBe("Buy 1 item from Pizza category & get 1 item from Cold Drinks category with £50.00 off");
  });

  it("bogo 'and': dead buy entries are skipped and the separators stay right", () => {
    expect(text(ADDONS_COMBO)).toBe(
      "Buy 1 Maharaja MAC, 1 item from Chaap category & get 1 Cold Coffee for free, 1 Thiramisu Cake for free, 2 items from Chaap category at 1% off each"
    );
  });

  it("freeItem 'or' (Get Free Cake on 399)", () => {
    expect(text(FREE_CAKE)).toBe(
      "Get 1 Thiramisu Cake for free or 1 Choclate Brownie for free or 1 Choclate Truffle for free"
    );
  });

  it("freeItem 'and' with categories — 'each' only past one unit", () => {
    expect(text(AND_CATEGORIES)).toBe("Get 2 items from Beer category at 50% off each, 1 item from Cakes category at 10% off");
  });

  it("variant names read 'Base (Size)' (Get Variant 2)", () => {
    expect(text(VARIANT_2)).toBe(
      "Get 2 Veg Hakka Noodles (Half) at 50% off each or 1 Choclate Truffle at 70% off or 1 Veg Hakka Noodles (Full) at 60% off"
    );
  });

  it("a buy entry keyed by a VARIANT id names 'Base (Variant)' through variantObject", () => {
    const sizedBuy = offer({
      ...BOGO_1,
      applicable: { on: "complete", rawItems: [buyItem({ id: "noodles-half", name: "Noodles" }, 1, "and")] },
    });
    expect(text(sizedBuy)).toMatch(/^Buy 1 Veg Hakka Noodles \(Half\) & get /);
  });

  it("an item the menu cannot name falls back to the payload's POS name", () => {
    const offMenu = offer({
      ...BOGO_1,
      applicable: { on: "complete", rawItems: [buyItem({ id: "gone", name: "Gone Item" }, 1, "and")] },
    });
    expect(text(offMenu)).toMatch(/^Buy 1 POS Gone Item & get /);
  });

  it("group-wise: no quantity → the bare name", () => {
    expect(text(GROUP_WISE)).toBe(
      "Buy Heineken or Choclate Truffle & get Choclate Brownie for free or Thiramisu Cake for free"
    );
  });
});

describe("U1 — rule edges", () => {
  it("value '100' (a string) reads 'for free'", () => {
    const stringValue = offer({
      ...FREE_CAKE,
      getItems: { items: [getItem(resolved(E.brownie), 1, "and", "percent", "100")], categories: [] },
    });
    expect(text(stringValue)).toBe("Get 1 Choclate Brownie for free");
  });

  it("a get entry whose stamp has no number states no discount (never 'NaN% off')", () => {
    const noValue = offer({
      ...FREE_CAKE,
      getItems: { items: [getItem(resolved(E.brownie), 1, "and", "percent", undefined as never)], categories: [] },
    });
    expect(text(noValue)).toBe("Get 1 Choclate Brownie");
  });

  it("a category with no quantity reads 'item from X category'", () => {
    const noQty = offer({
      ...AND_CATEGORIES,
      getItems: { items: [], categories: [getCategory("Cakes", null, "and", "percent", 10)] },
    });
    expect(text(noQty)).toBe("Get item from Cakes category at 10% off");
  });

  it("an unstamped buy entry is kept (D2)", () => {
    const unstamped = offer({
      ...BOGO_1,
      applicable: { on: "complete", rawItems: [{ item: { baseItemId: E.heineken.id }, quantity: 1, relation: "and" }] },
    });
    expect(text(unstamped)).toMatch(/^Buy 1 Heineken & get /);
  });

  it("the AST is data only: clauses, never strings", () => {
    const ast = buildBuyGetDescription(BOGO_OR);
    expect(ast?.buy).toEqual([
      expect.objectContaining({ qty: 1, relation: "or", discount: null, each: false, name: expect.objectContaining({ kind: "item" }) }),
      expect.objectContaining({ qty: 2, relation: "or" }),
    ]);
    expect(ast?.get).toEqual([
      expect.objectContaining({ qty: 1, discount: { kind: "percent", value: 50 }, each: false, name: expect.objectContaining({ kind: "entity" }) }),
      expect.objectContaining({ qty: 2, discount: { kind: "percent", value: 10 }, each: true, name: { kind: "category", name: "Cakes" } }),
    ]);
    expect(buildBuyGetDescription({ ...BOGO_1, type: { name: "percent", value: 10 } })).toBeNull();
    expect(buildBuyGetDescription({ ...BOGO_1, getLeastValueItem: true })).toBeNull();
  });
});

describe("U1 — each separator is the PREVIOUS clause's relation (PK joinOfferClauses)", () => {
  it("an 'or' clause then an 'and' clause reads ' or '; an 'and' then an 'or' reads ', '", () => {
    const mixed = offer({
      ...FREE_CAKE,
      getItems: {
        items: [
          getItem(resolved(E.thiramisu), 1, "or", "percent", 100),
          getItem(resolved(E.brownie), 1, "and", "percent", 100),
          getItem(resolved(E.truffle), 1, "or", "percent", 100),
        ],
        categories: [],
      },
    });
    expect(text(mixed)).toBe(
      "Get 1 Thiramisu Cake for free or 1 Choclate Brownie for free, 1 Choclate Truffle for free"
    );
  });
});

describe("U1 — the composer picks the connector from the BODIES (PK buyGetCopy)", () => {
  it("a dead buy side → 'Get …' (never a dangling 'Buy &')", () => {
    const deadBuy = offer({
      ...PIZZA,
      applicable: { on: "complete", rawItems: [buyCategory("Chakhna", 2, "and", false)] },
    });
    expect(text(deadBuy)).toBe("Get 1 item from Cold Drinks category with £50.00 off");
  });

  it("a dead get side → 'Buy …'", () => {
    const deadGet = offer({ ...BOGO_1, getItems: { items: [{ ...getItem({}, 1, "or", "percent", 50) }], categories: [] } });
    expect(text(deadGet)).toBe("Buy 2 Heineken or 2 Choclate Truffle");
  });

  it("both empty → '' (the row keeps its mechanic line)", () => {
    const empty = offer({
      ...BOGO_1,
      applicable: { on: "complete", rawItems: [buyItem(E.heineken, 2, "and", false)] },
      getItems: { items: [], categories: [{ ...getCategory("Beer", 1, "and", "percent", 50), entities: [] }] },
    });
    expect(text(empty)).toBe("");
  });

  it("the offer's own description wins, trimmed", () => {
    expect(text({ ...BOGO_1, description: "  Two beers, one on us  " } as SavingsOffer)).toBe("Two beers, one on us");
  });
});

describe("U1 — robustness and Arabic", () => {
  it("a throw inside → '' (never a crashed sheet)", () => {
    const exploding = { ...BOGO_1 } as SavingsOffer;
    Object.defineProperty(exploding, "applicable", {
      get() {
        throw new Error("boom");
      },
    });
    expect(describer().current(exploding)).toEqual({ text: "" });
  });

  it("AR: the AR templates and the AR separators (composed through i18n.t, compared with the isolates stripped)", async () => {
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    const ar = (key: string, values?: Record<string, unknown>) => strip(i18n.t(key, values));
    const or = ar("offers.desc.or");
    const comma = ar("offers.desc.comma");
    // The separators are the Arabic ones (" أو ", "، "), not the English copy.
    expect(or.trim()).toMatch(/\p{Script=Arabic}/u);
    // U+060C ARABIC COMMA is Script=Common; its script extensions name Arabic.
    expect(comma.trim()).toMatch(/\p{Script_Extensions=Arabic}/u);

    expect(strip(text(BOGO_1))).toBe(
      ar("offers.desc.buyGet", {
        buy: `2 Heineken${or}2 Choclate Truffle`,
        get: `1 Kingfisher ${ar("offers.desc.percentOff", { value: 50 })}${or}1 Choclate Brownie ${ar(
          "offers.desc.percentOff",
          { value: 70 }
        )}`,
      })
    );
    expect(strip(text(AND_CATEGORIES))).toBe(
      ar("offers.desc.getOnly", {
        get: `${ar("offers.desc.each", {
          clause: `${ar("offers.desc.category", { count: 2, category: "Beer" })} ${ar("offers.desc.percentOff", { value: 50 })}`,
        })}${comma}${ar("offers.desc.category", { count: 1, category: "Cakes" })} ${ar("offers.desc.percentOff", { value: 10 })}`,
      })
    );
    // The template is the Arabic one (the sentence opens on Arabic, not "Buy").
    expect(strip(text(BOGO_1))).toMatch(/^\p{Script=Arabic}/u);
    // Every run is isolated (P9f): the result opens with an FSI.
    expect(text(BOGO_1).startsWith("\u2068")).toBe(true);
    // Review 2 (bidi): a value composed in code ("2 Heineken", "<name> <discount>", the
    // joined clauses, the scope list) holds no strong letter outside its nested name
    // isolates, so its FSI resolved LTR and an Arabic reader met the parts backwards
    // ("Heineken 2"). Each one is an RTL isolate inside the interpolation's FSI.
    expect(rtlRuns(text(BOGO_1))).toBe(2); // {{buy}} and {{get}}
    expect(rtlRuns(text(AND_CATEGORIES))).toBe(2); // {{get}} and the "each" {{clause}}
    const scoped = describer().current(EXCEPT_BEER);
    expect(rtlRuns(scoped.text)).toBe(1); // {{scope}}
    expect(rtlRuns(scoped.lockLine ?? "")).toBe(1);
    expect(strip(scoped.lockLine ?? "")).toBe(ar("offers.lockedItemCriteriaExcept", { scope: "Beer" }));
  });

  it("EN output carries no RTL isolate (byte-identical composition)", () => {
    expect(text(BOGO_1)).not.toMatch(/[\u2066-\u2069]/);
  });
});

/* ---- U2: the item-criteria scope line, THROUGH the hook ---- */
/** A scope entry as the payload names it (the POS name is the honest fallback). */
const scopeItem = (baseItemId: string, name: string) => ({ item: { baseItemId, name }, quantity: null, relation: "and" });
const scoped = (o: Record<string, unknown>) =>
  offer({ type: { name: "percent", value: 10 }, getItems: {}, ...o, applicable: { on: "itemCriteria", ...(o.applicable as object) } });

/* #50 item criteria excluded — 10 % off everything except Beer. */
const EXCEPT_BEER = scoped({
  _id: "ic-ex",
  applicable: { isExclude: true, isInclude: false, rawItems: [buyCategory("Beer", null, "and")] },
});
/* #51 item criteria included — ₹100 off Burger. */
const ONLY_BURGER = scoped({
  _id: "ic-in",
  type: { name: "amount", value: 100 },
  applicable: { isInclude: true, isExclude: false, rawItems: [buyCategory("Burger", 1, "and")] },
});
/* #32 Test % IC include — 7 entries, capped at ₹150. */
const SEVEN = scoped({
  _id: "ic-seven",
  type: { name: "percent", value: 50 },
  maxDiscount: 150,
  applicable: {
    isInclude: true,
    isExclude: false,
    rawItems: [
      buyCategory("Burger", null, "and"),
      scopeItem("afghani", "Afghani Chaap"),
      scopeItem("garlic", "Baked Garlic Bread"),
      buyCategory("Breads", null, "and"),
      scopeItem("monk", "Old Monk"),
      buyCategory("Chinese", null, "and"),
      scopeItem("mania", "Pizza Mania"),
    ],
  },
});
/* #33 amount ic — ₹50 off everything except Breads, Burger; capped at ₹45. */
const AMOUNT_CAPPED = scoped({
  _id: "ic-amount",
  type: { name: "amount", value: 50 },
  maxDiscount: 45,
  applicable: {
    isExclude: true,
    isInclude: false,
    rawItems: [buyCategory("Breads", 1, "and"), buyCategory("Burger", null, "and")],
  },
});

describe("U2 — the item-criteria scope line, through useOfferDescription", () => {
  it("'10% off everything except Beer', locked: 'Not valid on Beer'", () => {
    expect(describer().current(EXCEPT_BEER)).toEqual({
      text: "10% off everything except Beer",
      lockLine: "Not valid on Beer",
    });
  });

  it("'£100.00 off Burger', locked: 'Add something from Burger'", () => {
    expect(describer().current(ONLY_BURGER)).toEqual({
      text: "£100.00 off Burger",
      lockLine: "Add something from Burger",
    });
  });

  it("two names then '+N more', and the percent cap: '· up to £150.00' (F5)", () => {
    expect(text(SEVEN)).toBe("50% off Burger, Afghani Chaap, +5 more · up to £150.00");
  });

  it("walk w3, AR: 'and N more' joins the list with its own 'و' — no comma before it ('، و5 أخرى' was a doubled joiner)", async () => {
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    const ar = (key: string, values?: Record<string, unknown>) => strip(i18n.t(key, values));
    const scope = `Burger${ar("offers.scopeSeparator")}Afghani Chaap و5 أخرى`;
    expect(strip(text(SEVEN))).toBe(
      ar("offers.upTo", { line: ar("offers.mechPercentItemsOnly", { value: 50, scope }), max: "£150.00" })
    );
    expect(strip(text(SEVEN))).not.toMatch(/،\s*و/);
  });

  it("the amount cap prints min(value, maxDiscount) (F5)", () => {
    expect(text(AMOUNT_CAPPED)).toBe("£45.00 off everything except Breads, Burger");
  });

  it("a mixed item + category exclude list cannot be stated honestly → '' and no lock line", () => {
    const mixed = scoped({
      _id: "ic-mixed",
      applicable: {
        isExclude: true,
        isInclude: false,
        rawItems: [buyCategory("Beer", null, "and"), scopeItem("w", "Wine")],
      },
    });
    expect(describer().current(mixed)).toEqual({ text: "" });
  });

  it("an item on the menu reads its MENU name (resolveName), the POS name otherwise", () => {
    const aliased = scoped({
      _id: "ic-alias",
      applicable: { isInclude: true, isExclude: false, rawItems: [buyItem(E.maharaja, null, "and")] },
    });
    expect(text(aliased)).toBe("10% off Maharaja MAC");
  });

  it("a bill-wise offer has no description of its own → ''", () => {
    expect(text(offer({ type: { name: "percent", value: 10 }, getItems: {} }))).toBe("");
  });
});
