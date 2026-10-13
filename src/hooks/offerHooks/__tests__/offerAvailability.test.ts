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
