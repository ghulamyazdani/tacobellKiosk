/**
 * SDK @cx-sdk/ordering/offer/offerAvailability, run from the TB tree (lane
 * offers-parity, U7). Which offers a guest can ever unlock on this menu
 * (PK offerSavings.ts:269-304 buy side, :349-364 get side), judged at rank
 * time: a dead buy entry is a converter stamp `isRawItemAvailable === false`
 * only (D2), and "sold out" vs "never" is the menu's presence (D1) — the
 * converter path is untouched.
 */
import { describe, expect, it } from "vitest";
import {
  getBuySideState,
  hasUnresolvableGetSide,
  rankOffersForKiosk,
  type MenuPresence,
} from "@cx-sdk/ordering/offer/offerAvailability";
import {
  rankOffers,
  type GetCategoryGroup,
  type SavingsContext,
  type SavingsOffer,
} from "@cx-sdk/ordering/offer/offerSavings";

type Raw = NonNullable<NonNullable<SavingsOffer["applicable"]>["rawItems"]>[number] & {
  relation?: string;
  quantity?: number | null;
};

const itemRaw = (baseItemId: string, relation: string, isRawItemAvailable?: boolean): Raw => ({
  item: { baseItemId, name: baseItemId },
  quantity: 1,
  relation,
  ...(isRawItemAvailable === undefined ? {} : { isRawItemAvailable }),
});
const categoryRaw = (_id: string, relation: string, isRawItemAvailable?: boolean): Raw => ({
  category: { _id, categoryName: _id },
  quantity: 1,
  relation,
  ...(isRawItemAvailable === undefined ? {} : { isRawItemAvailable }),
});

const bogo = (rawItems: Raw[], extra: Partial<SavingsOffer> = {}): SavingsOffer => ({
  _id: "bogo",
  name: "bogo",
  type: { name: "item", value: 0 },
  applicable: { on: "complete", rawItems },
  getItems: {
    items: [{ relation: "and", entities: { price: 2, discounted_total_price: 0 } }],
    categories: [],
  },
  ...extra,
});

/** The menu: the burger and the sauces sub-category are on it (in or out of stock). */
const ON_MENU = new Set(["burger", "sauces"]);
const isOnMenu: MenuPresence = (entry) =>
  ON_MENU.has(String(entry?.item?.baseItemId ?? entry?.category?._id ?? ""));

describe("getBuySideState", () => {
  it("'and': ONE dead entry kills the side; 'or': only when EVERY entry is dead", () => {
    expect(getBuySideState(bogo([itemRaw("burger", "and", true), itemRaw("burger", "and", false)]), isOnMenu)).toBe(
      "soldOut"
    );
    expect(getBuySideState(bogo([itemRaw("burger", "or", true), itemRaw("burger", "or", false)]), isOnMenu)).toBe(
      "ok"
    );
    expect(getBuySideState(bogo([itemRaw("burger", "or", false), categoryRaw("sauces", "or", false)]), isOnMenu)).toBe(
      "soldOut"
    );
  });

  it("no flag means alive (D2 — unit fixtures carry none)", () => {
    expect(getBuySideState(bogo([itemRaw("ghost", "and")]), isOnMenu)).toBe("ok");
  });

  it("dead and every dead entry on the menu → soldOut; any dead entry absent → never", () => {
    expect(getBuySideState(bogo([itemRaw("burger", "and", false)]), isOnMenu)).toBe("soldOut");
    expect(getBuySideState(bogo([categoryRaw("sauces", "and", false)]), isOnMenu)).toBe("soldOut");
    expect(
      getBuySideState(bogo([itemRaw("burger", "and", false), itemRaw("not-on-menu", "and", false)]), isOnMenu)
    ).toBe("never");
    expect(getBuySideState(bogo([categoryRaw("chakhna", "or", false)]), isOnMenu)).toBe("never");
  });

  it("not an item offer, or no buy side → ok", () => {
    expect(
      getBuySideState(
        { ...bogo([itemRaw("x", "and", false)]), type: { name: "percent", value: 10 } },
        isOnMenu
      )
    ).toBe("ok");
    expect(getBuySideState(bogo([]), isOnMenu)).toBe("ok");
  });
});

describe("hasUnresolvableGetSide", () => {
  const getSide = (getItems: SavingsOffer["getItems"], extra: Partial<SavingsOffer> = {}) =>
    hasUnresolvableGetSide({ ...bogo([]), getItems, ...extra });

  it("nothing resolved on a configured get side → hidden", () => {
    expect(getSide({ items: [{ relation: "or", entities: {} as never }], categories: [{ entities: [] }] })).toBe(true);
  });

  it("least-value is exempt (its freebie is a cart row)", () => {
    expect(
      getSide({ items: [{ relation: "or", entities: {} as never }] }, { getLeastValueItem: true })
    ).toBe(false);
  });

  it("an empty get side is exempt", () => {
    expect(getSide({ items: [], categories: [] })).toBe(false);
    expect(getSide({})).toBe(false);
  });

  it("ONE resolved category is enough", () => {
    expect(
      getSide({
        items: [{ relation: "or", entities: {} as never }],
        categories: [{ entities: [] }, { quantity: 1, entities: [SAUCE] }],
      })
    ).toBe(false);
  });

  it("review 1 F-1: a category group the picker can never fill (D7) — 'and' hides it; 'or' keeps it while another option completes", () => {
    expect(getSide({ items: [], categories: [KIDDIE_FOUR] })).toBe(true);
    expect(
      getSide({ items: [{ relation: "or", entities: { price: 2 } }], categories: [{ ...KIDDIE_FOUR, relation: "or" }] })
    ).toBe(false);
  });
});

/** A plain (ITEM) category entity: picked again and again. */
const SAUCE = { id: "sauce", price: 2, type: "ITEM" };
/** "Any 4 from Kiddie Meal" over 3 customizable meals: one unit each (D7), never 4. */
const meal = (id: string, price: number) => ({ id, price, type: "CUSTOMIZABLE" });
const KIDDIE_FOUR = {
  _id: "kiddie",
  name: "Kiddie Meal",
  quantity: 4,
  relation: "and",
  value: 100,
  discountType: "percent",
  entities: [meal("m1", 16), meal("m2", 15), meal("m3", 13)],
};
const freeFrom = (_id: string, group: GetCategoryGroup): SavingsOffer => ({
  ...bogo([]),
  _id,
  getItemOnly: true,
  getItems: { items: [], categories: [group] },
});

describe("rankOffersForKiosk", () => {
  const ctx: SavingsContext = { cartItems: [], cartValue: 10, cartQuantity: 1 };
  const FLAT: SavingsOffer = {
    _id: "flat",
    name: "flat",
    type: { name: "amount", value: 2 },
    applicable: { on: "complete", rawItems: [] },
  };
  const MIN_BILL: SavingsOffer = { ...FLAT, _id: "min-bill", minBillAmount: 50 };

  it("'never' and unresolvable offers are filtered out; unstamped ones stay", () => {
    const never = { ...bogo([itemRaw("not-on-menu", "and", false)]), _id: "never" };
    const noGet = { ...bogo([]), _id: "no-get", getItems: { items: [{ relation: "or", entities: {} as never }] } };
    const unstamped = { ...bogo([itemRaw("ghost", "and")]), _id: "unstamped" };
    const ids = rankOffersForKiosk([never, noGet, unstamped, FLAT], ctx, isOnMenu).map((e) => e.offer._id);
    expect(ids).toContain("unstamped");
    expect(ids).toContain("flat");
    expect(ids).not.toContain("never");
    expect(ids).not.toContain("no-get");
  });

  it("a soldOut entry is re-gapped 'unavailable' and sorted below every eligible entry", () => {
    const soldOut = { ...bogo([itemRaw("burger", "and", false)]), _id: "a-sold-out" };
    const ranked = rankOffersForKiosk([MIN_BILL, soldOut, FLAT], ctx, isOnMenu);
    const sold = ranked.find((e) => e.offer._id === "a-sold-out");
    expect(sold).toMatchObject({
      eligible: false,
      gap: { reason: "unavailable" },
      saving: expect.objectContaining({ lockReason: "unavailable" }),
    });
    const lastEligible = Math.max(...ranked.map((e, i) => (e.eligible ? i : -1)));
    expect(ranked.indexOf(sold as (typeof ranked)[number])).toBeGreaterThan(lastEligible);
    expect(ranked[0].offer._id).toBe("flat");
  });

  it("review 1 F-1: an offer whose category group can never fill (D7) is not listed — SAVE would open a dead picker", () => {
    const ids = rankOffersForKiosk([freeFrom("free-four", KIDDIE_FOUR), FLAT], ctx, isOnMenu).map((e) => e.offer._id);
    expect(ids).toEqual(["flat"]);
  });

  // sameOrLess plain BOGO: buy 1 from Side Orders, get 1 from Side Orders free.
  const SIDES = [
    { id: "salad", price: 17, type: "ITEM" },
    { id: "burger", price: 8, type: "CUSTOMIZABLE" },
    { id: "fries", price: 9, type: "CUSTOMIZABLE" },
  ];
  const SOL: SavingsOffer = {
    _id: "sol",
    name: "Buy a side get a side",
    type: { name: "item", value: 0 },
    sameOrLess: true,
    applicable: { on: "complete", rawItems: [categoryRaw("side-orders", "or")] },
    getItems: {
      items: [],
      categories: [
        { _id: "side-orders", name: "Side Orders", quantity: 1, relation: "or", value: 100, discountType: "percent", entities: SIDES },
      ],
    },
  };
  const row = (id: string, price: number) => ({
    id,
    itemId: `${id}-1`,
    type: "ITEM",
    price,
    quantity: 1,
    subCategoryId: "side-orders",
  });

  it("a same-or-less category offer is PRICED on its ceiling-filtered copy ('up to' the bought price); the entry keeps the original offer", () => {
    const sol = { ...ctx, cartItems: [row("burger", 8)] };
    const plain = rankOffers([SOL], sol)[0];
    expect(plain.saving.amount).toBe(17);

    const entry = rankOffersForKiosk([SOL], sol, isOnMenu)[0];
    expect(entry.saving).toMatchObject({ amount: 8, certainty: "upTo" });
    // Review 1 F-3: never the rank-time copy — the stage and SAVE hand the
    // apply core the original, which re-applies the ceiling on the LIVE cart
    // (a stage that raises it must not keep the dearer candidates out).
    expect(entry.offer).toBe(SOL);
  });

  it("a 'blocked' ceiling keeps the original offer", () => {
    const tooCheap = { ...ctx, cartItems: [row("sauce", 2)] };
    const entry = rankOffersForKiosk([SOL], tooCheap, isOnMenu)[0];
    expect(entry.offer).toBe(SOL);
    expect(entry.saving.amount).toBe(17);
  });

  it("review 1 F-2: 'Save up to' is what the picker can give (D7) — a customizable entity once, every other unit at the best plain pick", () => {
    // "Any 2 from Combo" free over two customizable combos (£20, £10): £30, never 2 × £20.
    const combos = { _id: "combo", name: "Combo", quantity: 2, relation: "and", value: 100, discountType: "percent" };
    const two = freeFrom("free-two", { ...combos, entities: [meal("a", 20), meal("b", 10)] });
    expect(rankOffers([two], ctx)[0].saving.amount).toBe(40);
    expect(rankOffersForKiosk([two], ctx, isOnMenu)[0]).toMatchObject({
      offer: two,
      saving: { amount: 30, certainty: "upTo" },
    });
    // A plain £12 entity repeats: £20 once + £12 = £32.
    const mixed = freeFrom("free-mixed", { ...combos, entities: [meal("a", 20), { id: "p", price: 12, type: "ITEM" }] });
    expect(rankOffersForKiosk([mixed], ctx, isOnMenu)[0].saving.amount).toBe(32);
    // "or" groups are alternatives: one that can never fill adds nothing (£16 × 4 before).
    const either = freeFrom("free-either", { ...combos, relation: "or", entities: [meal("a", 20), meal("b", 10)] });
    either.getItems?.categories?.push({ ...KIDDIE_FOUR, relation: "or" });
    expect(rankOffersForKiosk([either], ctx, isOnMenu)[0].saving.amount).toBe(30);
  });

  /* ---------------------------------------------------------------- *
   * Walk 2026-10-14: "And Offer With Varaint" (Noodles HALF at 50 % +
   * any 2 Chinese at 1 %) read "Save up to £1.20" and saved £5.40 — the
   * fixed size priced off the BASE item (£5 − its £5 stamp = £0). An "up
   * to" covers every get component: each fixed entry at the dearest unit
   * it can be × its units, and every category group (F5).
   * ---------------------------------------------------------------- */
  const SIZES = [
    { id: "noodles-q", name: "QUARTER", price: 5, isActive: true },
    { id: "noodles-h", name: "HALF", price: 10, isActive: true },
    { id: "noodles-f", name: "FULL", price: 15, isActive: true },
  ];
  const NOODLES_BASE = { id: "noodles", name: "Noodles", price: 5, hasVariant: true, variants: SIZES };
  /** The converter's variant-id grant: the BASE spread, stamps from the size. */
  const sizeGrant = (size: (typeof SIZES)[number], percent: number) => ({
    ...NOODLES_BASE,
    type: "VARIANT",
    isVariantSelected: true,
    selectedVariant: { ...size, discounted_total_price: size.price - (size.price * percent) / 100 },
    undiscounted_total_price: size.price,
    discounted_total_price: size.price - (size.price * percent) / 100,
  });
  const entry = (entities: object, percent: number, extra: object = {}) => ({
    relation: "and",
    quantity: 1,
    discountType: "percent",
    value: percent,
    entities,
    ...extra,
  });
  /** The converter's `isAndOffer` stamp rides on top (SavingsOffer does not declare it). */
  type OfferExtra = Partial<SavingsOffer> & { isAndOffer?: boolean };
  const getOffer = (_id: string, items: object[], categories: object[] = [], extra: OfferExtra = {}) =>
    ({
      ...bogo([]),
      _id,
      getItemOnly: true,
      getItems: { items, categories },
      ...extra,
    }) as SavingsOffer;
  const priced = (offer: SavingsOffer) => rankOffersForKiosk([offer], ctx, isOnMenu)[0];

  it("the walk's fixed size + category: up to £6.20 (HALF £5 + the picks' £1.20), never below the £5.40 it applies", () => {
    const chinese = {
      _id: "chinese",
      name: "Chinese",
      quantity: 2,
      relation: "and",
      value: 1,
      discountType: "percent",
      entities: [
        { id: "chilli", price: 20, type: "ITEM", discounted_total_price: 19.8, undiscounted_total_price: 20 },
        meal("five-meat", 100),
        { ...NOODLES_BASE, type: "VARIANT" },
      ],
    };
    const offer = getOffer("and-offer-with-variant", [entry(sizeGrant(SIZES[1], 50), 50)], [chinese]);
    const row = priced(offer);
    expect(row.saving).toMatchObject({ certainty: "upTo" });
    expect(row.saving.amount).toBeCloseTo(6.2, 10);
    expect(row.saving.amount).toBeGreaterThanOrEqual(5.4);
    expect(row.offer).toBe(offer); // the rank-time copy never leaves rankOffersForKiosk
  });

  it("a fixed size alone is exact at its own size: HALF at 50 % → £5 (the base price gave £0)", () => {
    expect(priced(getOffer("half", [entry(sizeGrant(SIZES[1], 50), 50)])).saving).toMatchObject({
      amount: 5,
      certainty: "exact",
    });
  });

  it("an entry's units count: 2 × HALF or 1 × FULL at 50 % → up to £10", () => {
    const offer = getOffer("get-variant-2", [
      entry(sizeGrant(SIZES[1], 50), 50, { relation: "or", quantity: 2 }),
      entry(sizeGrant(SIZES[2], 50), 50, { relation: "or" }),
    ]);
    expect(priced(offer).saving).toMatchObject({ amount: 10, certainty: "upTo" });
  });

  it("a customizable grant (no converter stamps) counts at its base: a free £9 burger → £9", () => {
    expect(priced(getOffer("free-burger", [entry(meal("burger", 9), 100)])).saving).toMatchObject({
      amount: 9,
      certainty: "exact",
    });
  });

  it("an open size choice is 'up to' its dearest pickable size — a sold-out or ceiling-disabled size never counts", () => {
    const open = {
      ...NOODLES_BASE,
      type: "VARIANT",
      variants: [
        ...SIZES,
        { id: "noodles-xl", name: "XL", price: 30, isActive: true, outOfStock: true },
        { id: "noodles-xxl", name: "XXL", price: 40, isActive: true, isGetVariantDisabled: true },
        { id: "noodles-off", name: "OFF", price: 50, isActive: false },
      ],
    };
    expect(priced(getOffer("open-size", [entry(open, 50)])).saving).toMatchObject({
      amount: 7.5,
      certainty: "upTo",
    });
  });

  it("a category pick with a size choice is 'up to' its dearest size: any 1 Noodles free → £15, not the £5 base", () => {
    const noodles = {
      _id: "noodles-group",
      name: "Noodles",
      quantity: 1,
      relation: "and",
      value: 100,
      discountType: "percent",
      entities: [{ ...NOODLES_BASE, type: "VARIANT" }],
    };
    expect(priced(getOffer("any-noodles", [], [noodles])).saving).toMatchObject({ amount: 15, certainty: "upTo" });
  });

  it("an out-of-stock grant gives nothing; plain items keep their price (and/or)", () => {
    const sauce = { id: "sauce", price: 2, type: "ITEM", discounted_total_price: 0, undiscounted_total_price: 2 };
    const salad = { id: "salad", price: 17, type: "ITEM", discounted_total_price: 0, undiscounted_total_price: 17 };
    expect(
      priced(getOffer("and", [entry(sauce, 100), entry({ ...meal("burger", 9), outOfStock: true }, 100)])).saving
    ).toMatchObject({ amount: 2, certainty: "exact" });
    expect(
      priced(getOffer("or", [entry(sauce, 100, { relation: "or" }), entry(salad, 100, { relation: "or" })])).saving
    ).toMatchObject({ amount: 17, certainty: "upTo" });
  });

  it("group-wise: N units, a fixed entry repeating and any other once (the picker's rule)", () => {
    const sauce = { id: "sauce", price: 2, type: "ITEM", discounted_total_price: 1, undiscounted_total_price: 2 };
    const groupWise = (getQuantity: number, items: object[]) =>
      getOffer(`gw-${getQuantity}`, items, [], {
        getItemOnly: false,
        buygetGroupWiseOffer: true,
        buygetGroupWiseOfferValues: { discountType: "percent", value: "50", getQuantity, buyQuantity: 1 },
      });
    // Pick 2: the burger once (£4.50), then a sauce (£1) — never 2 × £4.50.
    expect(priced(groupWise(2, [entry(sauce, 50), entry(meal("burger", 9), 50)])).saving.amount).toBe(5.5);
    // Pick 3 over one plain sauce: it repeats — 3 × £1 (the top-3 list gave £1).
    expect(priced(groupWise(3, [entry(sauce, 50)])).saving.amount).toBe(3);
    // Pick 2 over two fixed sizes: FULL twice at 50 % — 2 × £7.50.
    expect(
      priced(groupWise(2, [entry(sizeGrant(SIZES[1], 50), 50), entry(sizeGrant(SIZES[2], 50), 50)])).saving.amount
    ).toBe(15);
  });

  /* ---------------------------------------------------------------- *
   * Review of the walk fixes: the figure is what the picker can give.
   * ---------------------------------------------------------------- */
  const FRIES_SIZES = [
    { id: "fries-s", name: "S", price: 2, isActive: true },
    { id: "fries-m", name: "M", price: 4, isActive: true },
    { id: "fries-l", name: "L", price: 6, isActive: true },
  ];
  const FRIES_OPEN = { id: "fries", name: "Fries", price: 2, hasVariant: true, type: "VARIANT", variants: FRIES_SIZES };
  /** The converter's variant-id grant of one fries size. */
  const friesSize = (size: (typeof FRIES_SIZES)[number]) => ({
    ...FRIES_OPEN,
    isVariantSelected: true,
    selectedVariant: { ...size, discounted_total_price: 0 },
    undiscounted_total_price: size.price,
    discounted_total_price: 0,
  });
  /** Plain BOGO, same-or-less: buy a burger, get fries no dearer than it. */
  const sameOrLess = (_id: string, items: object[], extra: OfferExtra = {}) =>
    ({ ...bogo([itemRaw("burger", "and")]), _id, sameOrLess: true, getItems: { items, categories: [] }, ...extra }) as SavingsOffer;
  const fiveBurger: SavingsContext = {
    ...ctx,
    cartItems: [{ id: "burger", itemId: "burger-1", type: "ITEM", price: 5, quantity: 1 }],
  };

  it("same-or-less with ONLY fixed get entries is priced under SAVE's ceiling: an open size up to £4 (M) under a £5 burger, never £6 (L)", () => {
    const open = rankOffersForKiosk([sameOrLess("sol-open", [entry(FRIES_OPEN, 100)])], fiveBurger, isOnMenu)[0];
    expect(open.saving).toMatchObject({ amount: 4, certainty: "upTo" });
    // Two fixed sizes as alternatives: the ceiling drops Large, so Medium's £4.
    const either = sameOrLess(
      "sol-either",
      [entry(friesSize(FRIES_SIZES[2]), 100, { relation: "or" }), entry(friesSize(FRIES_SIZES[1]), 100, { relation: "or" })],
      { isAndOffer: false }
    );
    expect(rankOffersForKiosk([either], fiveBurger, isOnMenu)[0].saving).toMatchObject({ amount: 4, certainty: "upTo" });
  });

  it("an 'or' offer is ONE option, never the sum: a £17 salad or any 2 £2 sauces → up to £17", () => {
    const salad = { id: "salad", price: 17, type: "ITEM", discounted_total_price: 0, undiscounted_total_price: 17 };
    const sauces = { _id: "sauces", name: "Sauces", quantity: 2, relation: "or", value: 100, discountType: "percent", entities: [SAUCE] };
    const offer = getOffer("salad-or-sauces", [entry(salad, 100, { relation: "or" })], [sauces], { isAndOffer: false });
    expect(priced(offer).saving).toMatchObject({ amount: 17, certainty: "upTo" });
    // The picker's "or" mode, whatever carries it: the converter's isAndOffer
    // false over "and" entries (£5 or £3), or a group's "or" beside an item.
    const five = { id: "five", price: 5, type: "ITEM" };
    const three = { id: "three", price: 3, type: "ITEM" };
    expect(
      priced(getOffer("flag-or", [entry(five, 100), entry(three, 100)], [], { isAndOffer: false })).saving
    ).toMatchObject({ amount: 5, certainty: "upTo" });
    expect(priced(getOffer("group-or", [entry(five, 100)], [sauces])).saving).toMatchObject({
      amount: 5,
      certainty: "upTo",
    });
    // A group can be the best option: a £2 sauce or any 2 £17 salads → £34.
    const salads = { ...sauces, _id: "salads", name: "Salads", entities: [{ id: "salad", price: 17, type: "ITEM" }] };
    expect(priced(getOffer("salads-or", [entry(SAUCE, 100, { relation: "or" })], [salads])).saving).toMatchObject({
      amount: 34,
      certainty: "upTo",
    });
  });

  describe("enable_dis_addon: a reward the guest builds with add-ons quotes no figure", () => {
    const burger = { ...meal("burger", 9), modifiers: ["extras"] };
    const rank = (offer: SavingsOffer, addonsDiscounted: boolean) =>
      rankOffersForKiosk([offer], ctx, isOnMenu, addonsDiscounted)[0].saving;

    it("a customizable grant: £9 exact with the setting off; no figure (an 'up to' £0) with it on — never an 'exact' below what CONFIRM stamps", () => {
      const offer = getOffer("free-burger-addons", [entry(burger, 100)]);
      expect(rank(offer, false)).toMatchObject({ amount: 9, certainty: "exact" });
      expect(rank(offer, true)).toMatchObject({ amount: 0, certainty: "upTo" });
    });

    it("a customizable category pick, or an open size whose sizes carry add-ons, takes the figure with it", () => {
      const chinese = { _id: "chinese", name: "Chinese", quantity: 1, relation: "and", value: 50, discountType: "percent" };
      const withBurger = getOffer("cat-addons", [], [{ ...chinese, entities: [SAUCE, burger] }]);
      expect(rank(withBurger, false).amount).toBe(4.5);
      expect(rank(withBurger, true)).toMatchObject({ amount: 0, certainty: "upTo" });
      const sized = { ...NOODLES_BASE, type: "VARIANT", variants: SIZES.map((size) => ({ ...size, modifiers: ["toppings"] })) };
      expect(rank(getOffer("size-addons", [entry(sized, 50)]), true)).toMatchObject({ amount: 0, certainty: "upTo" });
    });

    it("nothing built with add-ons keeps its figure: a fixed size, a plain item, a size choice without add-ons", () => {
      // The menu's plain items carry an empty group list.
      const half = getOffer("half-on", [entry(sizeGrant(SIZES[1], 50), 50), entry({ ...SAUCE, modifiers: [] }, 100)]);
      expect(rank(half, true)).toMatchObject({ amount: 7, certainty: "exact" });
      // A fixed size is granted as-is, even when its sizes carry add-on groups.
      const toppedHalf = {
        ...sizeGrant(SIZES[1], 50),
        variants: SIZES.map((size) => ({ ...size, modifiers: ["toppings"] })),
      };
      expect(rank(getOffer("topped-half-on", [entry(toppedHalf, 50)]), true)).toMatchObject({
        amount: 5,
        certainty: "exact",
      });
      const open = { ...NOODLES_BASE, type: "VARIANT" };
      expect(rank(getOffer("open-on", [entry(open, 50)]), true)).toMatchObject({ amount: 7.5, certainty: "upTo" });
    });
  });

  it("a throw anywhere → plain rankOffers (the bag never breaks)", () => {
    const exploding: MenuPresence = () => {
      throw new Error("boom");
    };
    const never = { ...bogo([itemRaw("not-on-menu", "and", false)]), _id: "never" };
    expect(rankOffersForKiosk([never, FLAT], ctx, exploding)).toEqual(rankOffers([never, FLAT], ctx));
  });

  it("null offers → []", () => {
    expect(rankOffersForKiosk(null, ctx, isOnMenu)).toEqual([]);
  });
});
