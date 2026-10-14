import { describe, expect, it, vi } from "vitest";
import {
  dropOutOfStockPicks,
  flaggedPicks,
  isOptionOutOfStock,
  stockLast,
} from "@cx-sdk/catalog/oos/optionStock";
import { keepSweptPicksFlagged } from "@cx-sdk/catalog/oos/sweptPicks";

/*
  Lane walk-oos — @cx-sdk/catalog/oos/optionStock (the SDK has no test
  project of its own, H09): which options are out of stock (the menu's stamp,
  PAY's feed map winning — posistKiosk GroupCustomizationGrid), deselecting
  them, and (@cx-sdk/catalog/oos/sweptPicks) the bag keeping a pick PAY's
  sweep dropped, flagged.
*/

describe("isOptionOutOfStock", () => {
  it("no map entry: the menu's stamp decides", () => {
    expect(isOptionOutOfStock({ id: "a", outOfStock: true }, {})).toBe(true);
    expect(isOptionOutOfStock({ id: "a", outOfStock: false }, {})).toBe(false);
    expect(isOptionOutOfStock({ id: "a" }, null)).toBe(false);
    expect(isOptionOutOfStock({ id: "a", outOfStock: true }, undefined)).toBe(true);
  });

  it.each(["addon", "combo", "vaddon"])("a %s entry with a known inStock wins over the stamp, both ways", (type) => {
    expect(isOptionOutOfStock({ id: "a", outOfStock: false }, { a: { type, inStock: false } })).toBe(true);
    expect(isOptionOutOfStock({ id: "a", outOfStock: true }, { a: { type, inStock: true } })).toBe(false);
  });

  it("an item / variant entry, or one without inStock, leaves the stamp to decide", () => {
    expect(isOptionOutOfStock({ id: "a", outOfStock: false }, { a: { type: "item", inStock: false } })).toBe(false);
    expect(isOptionOutOfStock({ id: "a", outOfStock: false }, { a: { type: "variant", inStock: false } })).toBe(false);
    expect(isOptionOutOfStock({ id: "a", outOfStock: true }, { a: { type: "addon" } })).toBe(true);
    expect(isOptionOutOfStock({ id: "a", outOfStock: false }, { a: { type: "addon" } })).toBe(false);
    expect(isOptionOutOfStock({ id: "a", outOfStock: false }, { b: { type: "addon", inStock: false } })).toBe(false);
  });

  it("never throws: no option, no id, an inherited key", () => {
    expect(isOptionOutOfStock(null, { a: { type: "addon", inStock: false } })).toBe(false);
    expect(isOptionOutOfStock("a", {})).toBe(false);
    expect(isOptionOutOfStock({ outOfStock: true }, { undefined: { type: "addon", inStock: true } })).toBe(true);
    expect(isOptionOutOfStock({ id: "constructor" }, {})).toBe(false);
    expect(isOptionOutOfStock({ id: "__proto__", outOfStock: true }, {})).toBe(true);
    expect(isOptionOutOfStock({ id: 7 }, { 7: { type: "addon", inStock: false } })).toBe(true);
  });
});

describe("stockLast", () => {
  it("in-stock first, out-of-stock last, each half in its own order", () => {
    const items = [{ id: 1, out: true }, { id: 2 }, { id: 3, out: true }, { id: 4 }];
    expect(stockLast(items, (item) => Boolean(item.out)).map((item) => item.id)).toEqual([2, 4, 1, 3]);
    expect(stockLast([], () => true)).toEqual([]);
  });
});

describe("dropOutOfStockPicks", () => {
  const SELECTIONS = {
    g1: [
      { id: "a", quantity: 1 },
      {
        id: "b",
        quantity: 1,
        outOfStock: true,
        customizations: { n1: [{ id: "x" }, { id: "y" }] },
      },
    ],
    g2: [{ id: "c" }],
  };

  it("removes every out-of-stock pick, tier-1 and nested, and lists them", () => {
    const isOut = vi.fn((pick: Record<string, unknown>) => pick.id === "a" || pick.id === "y");
    const { selections, removed } = dropOutOfStockPicks(SELECTIONS, isOut);

    expect(selections).toEqual({
      g1: [{ id: "b", quantity: 1, outOfStock: false, customizations: { n1: [{ id: "x" }] } }],
      g2: [{ id: "c" }],
    });
    expect(removed.map((pick) => pick.id)).toEqual(["a", "y"]);
    // The predicate hears each pick with its own group.
    expect(isOut).toHaveBeenCalledWith(expect.objectContaining({ id: "y" }), "n1");
    expect(isOut).toHaveBeenCalledWith(expect.objectContaining({ id: "c" }), "g2");
    // The input is never written to.
    expect(SELECTIONS.g1).toHaveLength(2);
    expect(SELECTIONS.g1[1].outOfStock).toBe(true);
  });

  it("a kept pick loses a stale flag; nothing to change hands the same object back", () => {
    const { selections, removed } = dropOutOfStockPicks(SELECTIONS, () => false);
    expect((selections as typeof SELECTIONS).g1[1]).toEqual({
      id: "b",
      quantity: 1,
      outOfStock: false,
      customizations: { n1: [{ id: "x" }, { id: "y" }] },
    });
    expect(removed).toEqual([]);

    const clean = { g: [{ id: "a" }], h: "not a list" };
    expect(dropOutOfStockPicks(clean, () => false).selections).toBe(clean);
    expect(dropOutOfStockPicks(undefined, () => true).selections).toBeUndefined();
    // No key appears from nowhere.
    const { selections: one } = dropOutOfStockPicks({ g: [{ id: "a", outOfStock: true }] }, () => false);
    expect(one).toEqual({ g: [{ id: "a", outOfStock: false }] });
    expect(Object.keys((one as { g: object[] }).g[0])).toEqual(["id", "outOfStock"]);
  });
});

describe("flaggedPicks", () => {
  it("every pick flagged outOfStock: true, each tier-1 before its nested ones", () => {
    expect(
      flaggedPicks({
        g1: [
          { id: "a", outOfStock: true, customizations: { n: [{ id: "n1", outOfStock: true }, { id: "n2" }] } },
          { id: "b", outOfStock: false },
        ],
        g2: [{ id: "c", outOfStock: true }, null],
        g3: "junk",
      }).map((pick) => pick.id),
    ).toEqual(["a", "n1", "c"]);
    expect(flaggedPicks(undefined)).toEqual([]);
  });
});

describe("keepSweptPicksFlagged", () => {
  const total = vi.fn((customizations: unknown) =>
    Object.values(customizations as Record<string, { price?: number; customizations?: unknown }[]>)
      .flat()
      .reduce((sum, pick) => sum + Number(pick.price ?? 0), 0),
  );
  const before = {
    itemId: "r-1",
    type: "CUSTOMIZABLE",
    price: 5,
    total_price: 9,
    customizations: {
      g1: [
        { id: "a", price: 1 },
        { id: "b", itemId: "b-1", price: 3, customizations: { n: [{ id: "n1" }, { id: "n2" }] } },
      ],
      g2: [{ id: "c", price: 0 }],
    },
  };

  it("brings back, flagged, every pick the sweep dropped (tier-1 and nested); the rest is the swept row's; total_price counts the flagged picks", () => {
    const after = {
      ...before,
      outOfStock: false,
      total_price: 8,
      customizations: {
        g1: [{ id: "b", itemId: "b-1", price: 3, outOfStock: false, customizations: { n: [{ id: "n1" }] } }],
        g2: [{ id: "c", price: 0, outOfStock: false }],
      },
    };
    const row = keepSweptPicksFlagged(before, after, total) as typeof after;

    expect(row.customizations).toEqual({
      g1: [
        { id: "a", price: 1, outOfStock: true },
        {
          id: "b",
          itemId: "b-1",
          price: 3,
          outOfStock: false,
          customizations: { n: [{ id: "n1" }, { id: "n2", outOfStock: true }] },
        },
      ],
      g2: [{ id: "c", price: 0, outOfStock: false }],
    });
    expect(row.outOfStock).toBe(false);
    expect(row.total_price).toBe(1 + 3 + 0 + 5);
    expect(total).toHaveBeenLastCalledWith(row.customizations, undefined);
  });

  it("a VARIANT row adds its variantPrice; picks match on itemId before id (two picks of one item)", () => {
    const twin = {
      itemId: "v-1",
      type: "VARIANT",
      price: 99,
      variantPrice: 4,
      applyAddonsPrice: true,
      customizations: { g: [{ id: "x", itemId: "x-1", price: 1 }, { id: "x", itemId: "x-2", price: 2 }] },
    };
    const swept = { ...twin, customizations: { g: [{ id: "x", itemId: "x-2", price: 2 }] } };
    const row = keepSweptPicksFlagged(twin, swept, total) as typeof twin & { total_price?: number };

    expect(row.customizations.g).toEqual([
      { id: "x", itemId: "x-1", price: 1, outOfStock: true },
      { id: "x", itemId: "x-2", price: 2 },
    ]);
    expect(row.total_price).toBe(3 + 4);
    expect(total).toHaveBeenLastCalledWith(row.customizations, true);
  });

  it("nothing dropped, or nothing to compare: the swept row itself", () => {
    const after = { ...before, customizations: structuredClone(before.customizations) };
    expect(keepSweptPicksFlagged(before, after, total)).toBe(after);
    expect(keepSweptPicksFlagged(null, after, total)).toBe(after);
    expect(keepSweptPicksFlagged(before, null, total)).toBeNull();
    const plain = { itemId: "p-1", type: "ITEM", price: 2 };
    expect(keepSweptPicksFlagged(plain, { ...plain }, total)).toEqual(plain);
  });
});
