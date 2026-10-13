/**
 * SDK @cx-sdk/ordering/offer/offerCategoryOwnership, run from the TB tree
 * (lane offers-parity, U6). The crash-reload sweep keeps the freebie rows of
 * the applied offer's get-CATEGORY groups (D5: the row's id is one of the
 * persisted group's entity ids AND it carries that group's stamp); every
 * other verdict is findOrphanedFreebieRows' own.
 */
import { describe, expect, it } from "vitest";
import { findOrphanedFreebieRows } from "@cx-sdk/ordering/offer/offerCommitRules";
import { findOrphanedFreebieRowsWithCategories } from "@cx-sdk/ordering/offer/offerCategoryOwnership";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";

type Row = {
  id?: string;
  itemId?: string;
  isGetItem?: boolean;
  discountType?: string;
  discountValue?: unknown;
};

const freebie = (id: string, itemId: string, discountType: string, discountValue: unknown): Row => ({
  id,
  itemId,
  isGetItem: true,
  discountType,
  discountValue,
});
const PAID: Row = { id: "burger", itemId: "paid-1" };

/** The persisted applied offer: a Greek Salad entry + a Sauces group at 10 %. */
const OFFER: SavingsOffer = {
  _id: "offer-cat",
  type: { name: "item", value: 0 },
  getItemOnly: true,
  getItems: {
    items: [
      {
        _id: "gi-salad",
        baseItemId: "greek-salad",
        relation: "and",
        discountType: "percent",
        value: 100,
        entities: { price: 17 },
      } as never,
    ],
    categories: [
      {
        _id: "sauces",
        name: "Sauces",
        quantity: 1,
        relation: "and",
        value: "10",
        discountType: "percent",
        entities: [{ id: "tortilla", price: 2 } as never, { id: "caesar", price: 2 } as never],
      },
    ],
  },
};

describe("findOrphanedFreebieRowsWithCategories (D5)", () => {
  it("an owned category row is kept: member id + the group's stamp (string '10' vs number 10)", () => {
    const owned = freebie("tortilla", "free-1", "percent", 10);
    expect(findOrphanedFreebieRowsWithCategories(OFFER, [PAID, owned])).toEqual([]);
    // …where the base sweep alone would drop it.
    expect(findOrphanedFreebieRows(OFFER, [PAID, owned])).toEqual([owned]);
  });

  it("a member row with a wrong stamp is an orphan", () => {
    const wrongValue = freebie("tortilla", "free-1", "percent", 100);
    const wrongType = freebie("caesar", "free-2", "amount", 10);
    expect(findOrphanedFreebieRowsWithCategories(OFFER, [wrongValue, wrongType])).toEqual([
      wrongValue,
      wrongType,
    ]);
  });

  it("a non-member row is an orphan, stamp or not", () => {
    const stranger = freebie("bbq", "free-3", "percent", 10);
    expect(findOrphanedFreebieRowsWithCategories(OFFER, [stranger])).toEqual([stranger]);
  });

  it("item-entry rows get exactly findOrphanedFreebieRows' verdict", () => {
    const salad = freebie("greek-salad", "free-4", "percent", 100);
    const badSalad = freebie("greek-salad", "free-5", "percent", 50);
    const rows = [PAID, salad, badSalad];
    expect(findOrphanedFreebieRowsWithCategories(OFFER, rows)).toEqual(findOrphanedFreebieRows(OFFER, rows));
    expect(findOrphanedFreebieRowsWithCategories(OFFER, rows)).toEqual([badSalad]);
  });

  it.each([
    ["least-value", { ...OFFER, getLeastValueItem: true }],
    ["not an item offer", { ...OFFER, type: { name: "percent", value: 10 } }],
    [
      "group-wise",
      {
        ...OFFER,
        buygetGroupWiseOffer: true,
        buygetGroupWiseOfferValues: { discountType: "percent", value: "10", getQuantity: 1, buyQuantity: 1 },
      },
    ],
    ["no applied offer", {}],
  ])("%s → findOrphanedFreebieRows unchanged", (_label, offer) => {
    const owned = freebie("tortilla", "free-1", "percent", 10);
    const rows = [PAID, owned];
    expect(findOrphanedFreebieRowsWithCategories(offer as SavingsOffer, rows)).toEqual(
      findOrphanedFreebieRows(offer as SavingsOffer, rows)
    );
    expect(findOrphanedFreebieRowsWithCategories(offer as SavingsOffer, rows)).toEqual([owned]);
  });

  it("a throw while judging the groups → the base orphans (never keep what cannot be verified)", () => {
    const owned = freebie("tortilla", "free-1", "percent", 10);
    const exploding = {
      ...OFFER,
      getItems: {
        items: OFFER.getItems?.items,
        get categories(): never {
          throw new Error("boom");
        },
      },
    } as SavingsOffer;
    expect(findOrphanedFreebieRowsWithCategories(exploding, [PAID, owned])).toEqual([owned]);
  });

  it("no freebie rows → nothing", () => {
    expect(findOrphanedFreebieRowsWithCategories(OFFER, [PAID])).toEqual([]);
    expect(findOrphanedFreebieRowsWithCategories(OFFER, null)).toEqual([]);
  });
});
