/**
 * SDK @cx-sdk/ordering/offer/offerCategoryFreebies, run from the TB tree (lane
 * offers-parity, U5 — the offerCommitRules house pattern). The buy-stage gate
 * without the get-category block, a category group's need and fillability
 * (D7: a customizable entity is ONE unit per group), and the exact commit
 * lines a completed group sends (PK ItemSelection.tsx:300-309 / :445-454
 * shape, stamped from the GROUP).
 */
import { describe, expect, it } from "vitest";
import {
  buildCategoryCommitLines,
  canFillCategoryGroup,
  canOfferBuyStageWithCategories,
  getCategoryGroupNeed,
  type CategoryPick,
} from "@cx-sdk/ordering/offer/offerCategoryFreebies";
import { canCompleteGetSide } from "@cx-sdk/ordering/offer/offerCategoryOwnership";
import type { BuyStageMode, BuyStageView } from "@cx-sdk/ordering/offer/buyStageUtils";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";

const view = (mode: BuyStageMode): BuyStageView => ({ mode, groups: [], sharedRequiredQuantity: 0 });

const plain = (id: string, price = 2) => ({ id, name: id, price, type: "ITEM", discountType: "percent", discountValue: 1 });
const custom = (id: string, price = 8) => ({ id, name: id, price, type: "CUSTOMIZABLE", modifiers: ["m1"] });

/** A converter-resolved get-category group (Sauces ×2 at 100 %). */
const SAUCES = {
  _id: "sauces",
  name: "Sauces",
  quantity: 2,
  relation: "and",
  value: 100,
  discountType: "percent",
  entities: [plain("tortilla"), plain("caesar"), custom("bbq", 1)],
};

const offerWith = (getItems: SavingsOffer["getItems"]): SavingsOffer => ({
  _id: "o",
  type: { name: "item", value: 0 },
  getItems,
});

describe("canOfferBuyStageWithCategories", () => {
  it("a resolvable get-category BOGO now gets a stage (no category block)", () => {
    const offer = offerWith({ items: [], categories: [SAUCES] });
    expect(canOfferBuyStageWithCategories(offer, view("plain-and"))).toBe(true);
    expect(canOfferBuyStageWithCategories(offer, view("plain-or"))).toBe(true);
  });

  it("group mode never; a null view never", () => {
    const offer = offerWith({ items: [], categories: [SAUCES] });
    expect(canOfferBuyStageWithCategories(offer, view("group"))).toBe(false);
    expect(canOfferBuyStageWithCategories(offer, null)).toBe(false);
  });

  it("a plain BOGO with nothing resolvable on its get side → false; least-value needs none", () => {
    const dead = offerWith({ items: [{ relation: "and", entities: {} }], categories: [{ ...SAUCES, entities: [] }] });
    expect(canOfferBuyStageWithCategories(dead, view("plain-and"))).toBe(false);
    expect(canOfferBuyStageWithCategories(dead, view("least"))).toBe(true);
  });

  it("a get side the picker can never complete (D7) gets no stage — CONTINUE would land on a dead picker", () => {
    // "Any 4 from Kiddie Meal" over 3 customizable meals: one unit each, never 4.
    const kiddie = { ...SAUCES, quantity: 4, entities: [custom("m1"), custom("m2"), custom("m3")] };
    expect(canOfferBuyStageWithCategories(offerWith({ items: [], categories: [kiddie] }), view("plain-or"))).toBe(false);
  });
});

/*
 * offerCategoryOwnership.canCompleteGetSide — the picker's CONFIRM rule under
 * D7, on the boot path (the rank filter and the stage gate share it).
 */
describe("canCompleteGetSide (D7)", () => {
  const kiddie = { ...SAUCES, _id: "kiddie", quantity: 4, entities: [custom("m1"), custom("m2"), custom("m3")] };
  const salad = { relation: "and", entities: { id: "salad", type: "ITEM", price: 17 } };

  it("'and': every resolved group must be able to fill; an empty group is skipped (P6)", () => {
    expect(canCompleteGetSide(offerWith({ items: [], categories: [SAUCES] }))).toBe(true);
    expect(canCompleteGetSide(offerWith({ items: [salad], categories: [SAUCES, kiddie] }))).toBe(false);
    expect(canCompleteGetSide(offerWith({ items: [salad], categories: [{ ...kiddie, entities: [] }] }))).toBe(true);
  });

  it("'or': one completable option is enough — a resolved item entry or a group that can fill", () => {
    const orKiddie = { ...kiddie, relation: "or" };
    expect(canCompleteGetSide(offerWith({ items: [], categories: [orKiddie] }))).toBe(false);
    expect(canCompleteGetSide(offerWith({ items: [], categories: [orKiddie, { ...SAUCES, relation: "or" }] }))).toBe(true);
    expect(canCompleteGetSide(offerWith({ items: [{ ...salad, relation: "or" }], categories: [orKiddie] }))).toBe(true);
    // isAndOffer false makes the offer "or" whatever the entries say.
    const andShaped = offerWith({ items: [salad], categories: [kiddie] });
    expect(canCompleteGetSide({ ...andShaped, isAndOffer: false } as SavingsOffer)).toBe(true);
  });

  it("nothing resolvable → false; group-wise keeps the base rule (its picker lists items)", () => {
    expect(canCompleteGetSide(offerWith({ items: [{ relation: "or", entities: {} }], categories: [] }))).toBe(false);
    expect(canCompleteGetSide({ ...offerWith({ items: [], categories: [kiddie] }), buygetGroupWiseOffer: true })).toBe(true);
  });
});

describe("getCategoryGroupNeed", () => {
  it.each([
    [2, 2],
    ["2", 2],
    [0, 0],
    [-1, 0],
    [1.5, 0],
    [Number.NaN, 0],
    [null, 0],
    [undefined, 0],
  ])("quantity %s → need %s", (quantity, need) => {
    expect(getCategoryGroupNeed({ ...SAUCES, quantity: quantity as number })).toBe(need);
  });
});

describe("canFillCategoryGroup (D7)", () => {
  it("any plain entity fills any need", () => {
    expect(canFillCategoryGroup({ ...SAUCES, quantity: 5 })).toBe(true);
  });

  it("only customizable entities: fillable when there are at least as many as the need, not when fewer", () => {
    const burgers = { ...SAUCES, entities: [custom("burger"), custom("fries")] };
    expect(canFillCategoryGroup({ ...burgers, quantity: 2 })).toBe(true);
    expect(canFillCategoryGroup({ ...burgers, quantity: 3 })).toBe(false);
  });

  it("need 0 or no entities → never", () => {
    expect(canFillCategoryGroup({ ...SAUCES, quantity: 0 })).toBe(false);
    expect(canFillCategoryGroup({ ...SAUCES, entities: [] })).toBe(false);
  });
});

describe("buildCategoryCommitLines", () => {
  const tortilla = SAUCES.entities[0];
  const caesar = SAUCES.entities[1];
  const bbq = SAUCES.entities[2];

  it("exactly the need: one line per pick, stamped from the GROUP, PK shape", () => {
    const lines = buildCategoryCommitLines(SAUCES, [
      { entity: tortilla, quantity: 1 },
      { entity: caesar, quantity: 1 },
    ]);
    expect(lines).toEqual([
      {
        _id: "sauces",
        name: "Sauces",
        relation: "and",
        discountType: "percent",
        value: 100,
        type: "ITEM",
        entities: tortilla,
        quantity: 1,
      },
      {
        _id: "sauces",
        name: "Sauces",
        relation: "and",
        discountType: "percent",
        value: 100,
        type: "ITEM",
        entities: caesar,
        quantity: 1,
      },
    ]);
    // The entity's own stamp (discountValue 1) never leaks into the line.
    expect(lines?.every((line) => line.value === 100)).toBe(true);
  });

  it("a plain entity picked twice is ONE line of 2 units", () => {
    expect(buildCategoryCommitLines(SAUCES, [{ entity: tortilla, quantity: 2 }])).toEqual([
      expect.objectContaining({ entities: tortilla, quantity: 2, type: "ITEM" }),
    ]);
  });

  it("under or over the need → null", () => {
    expect(buildCategoryCommitLines(SAUCES, [{ entity: tortilla, quantity: 1 }])).toBeNull();
    expect(buildCategoryCommitLines(SAUCES, [{ entity: tortilla, quantity: 3 }])).toBeNull();
    expect(buildCategoryCommitLines(SAUCES, [])).toBeNull();
  });

  it("a foreign entity → null", () => {
    expect(
      buildCategoryCommitLines(SAUCES, [
        { entity: tortilla, quantity: 1 },
        { entity: plain("greek-salad"), quantity: 1 },
      ])
    ).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN])("a non-whole quantity (%s) → null", (quantity) => {
    expect(
      buildCategoryCommitLines(SAUCES, [
        { entity: tortilla, quantity },
        { entity: caesar, quantity: 1 },
      ])
    ).toBeNull();
  });

  it("a customizable pick: quantity 1 with its staged row; the row wins over the entity and lends its type", () => {
    const row = { id: "bbq", itemId: "staged-1", type: "CUSTOMIZABLE", customizations: { m1: [] } };
    const lines = buildCategoryCommitLines(SAUCES, [
      { entity: tortilla, quantity: 1 },
      { entity: bbq, quantity: 1, row },
    ]);
    expect(lines?.[1]).toEqual(
      expect.objectContaining({ entities: row, type: "CUSTOMIZABLE", quantity: 1, value: 100 })
    );
  });

  it("type falls back to the entity's when the row carries none", () => {
    const row = { id: "bbq", itemId: "staged-1" };
    const lines = buildCategoryCommitLines(SAUCES, [
      { entity: tortilla, quantity: 1 },
      { entity: bbq, quantity: 1, row },
    ]);
    expect(lines?.[1]?.type).toBe("CUSTOMIZABLE");
  });

  it("a customizable pick with quantity 2, or without its staged row → null (D7: one unit per group)", () => {
    const row = { id: "bbq", type: "CUSTOMIZABLE" };
    expect(buildCategoryCommitLines(SAUCES, [{ entity: bbq, quantity: 2, row }])).toBeNull();
    expect(
      buildCategoryCommitLines(SAUCES, [
        { entity: tortilla, quantity: 1 },
        { entity: bbq, quantity: 1 },
      ])
    ).toBeNull();
  });

  it("the same entity in two picks → null", () => {
    const picks: CategoryPick[] = [
      { entity: tortilla, quantity: 1 },
      { entity: tortilla, quantity: 1 },
    ];
    expect(buildCategoryCommitLines(SAUCES, picks)).toBeNull();
  });

  it("need 0 → null", () => {
    expect(buildCategoryCommitLines({ ...SAUCES, quantity: 0 }, [])).toBeNull();
  });
});
