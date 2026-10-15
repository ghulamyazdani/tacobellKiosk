import { describe, expect, it, vi } from "vitest";
import {
  dropOutOfStockPicks,
  flaggedPicks,
  hasDeadRequiredGroup,
  isOptionOutOfStock,
  markUncompletable,
  stockLast,
} from "@cx-sdk/catalog/oos/optionStock";
import { keepSweptPicksFlagged } from "@cx-sdk/catalog/oos/sweptPicks";
import { checkFinalCheckOutMinMax } from "@cx-sdk/catalog/oos/outOfStockEngine";
import { validateVariantSelections } from "@cx-sdk/ordering/customization/groupCompletion";
import { buildEmptySelectionsForModifiers } from "@cx-sdk/ordering/customization/sessionState";

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

/*
  walk-oos 2 (user 2026-10-14, "Show it Unavailable"): an item with a
  REQUIRED group whose every option is out of stock can never be completed —
  it reads out of stock like a sold-out one. Judged as the PDP judges the
  options (the stamp, PAY's feed map winning); a min-0 group never kills.
*/
describe("hasDeadRequiredGroup / markUncompletable", () => {
  const opt = (id: string, extra: Record<string, unknown> = {}) => ({ id, isActive: true, outOfStock: false, ...extra });
  // A positive max on both scales, so only stock decides here (a required
  // group with no max is dead by itself — user 2026-10-15, below).
  const group = (min: number, constituentItems: object[], extra: Record<string, unknown> = {}) => ({
    isActive: true, min, max: 1, multiplePunchMin: 0, multiplePunchMax: 2, constituentItems, ...extra,
  });
  const MODS = {
    // Every option on offer out: c is switched off, so it is not on offer.
    sauce: group(1, [opt("a", { outOfStock: true }), opt("b", { outOfStock: true }), opt("c", { isActive: false })]),
    sauce_live: group(1, [opt("a", { outOfStock: true }), opt("d")]),
    extras: group(0, [opt("e", { outOfStock: true })]),
    off: group(1, [opt("f", { outOfStock: true })], { isActive: false }),
    no_options: group(1, [opt("g", { isActive: false })]),
    punch: group(0, [opt("h", { outOfStock: true })], { multiplePunchMin: 2 }),
  };
  const dead = (ids: unknown, map: Record<string, unknown> | null = {}, multiPunch = false) =>
    hasDeadRequiredGroup(ids, MODS, map, multiPunch);

  it("a required group with every option on offer out of stock is dead; one option in stock keeps it alive", () => {
    expect(dead(["sauce"])).toBe(true);
    expect(dead(["extras", "sauce"])).toBe(true);
    expect(dead(["sauce_live"])).toBe(false);
  });

  it("a min-0 group never kills, every option out or not; nor does a group the PDP never shows", () => {
    expect(dead(["extras"])).toBe(false);
    expect(dead(["off"])).toBe(false);
    expect(dead(["no_options"])).toBe(false);
    expect(dead([])).toBe(false);
  });

  it("multi-punch on: its min decides, both ways", () => {
    expect(dead(["punch"], {}, true)).toBe(true);
    expect(dead(["punch"], {}, false)).toBe(false);
    expect(dead(["sauce"], {}, true)).toBe(false);
  });

  it("PAY's fresher feed map wins over the stamp, both ways (it re-decides when the map moves)", () => {
    expect(dead(["sauce_live"], { d: { type: "addon", inStock: false } })).toBe(true);
    expect(dead(["sauce"], { b: { type: "combo", inStock: true } })).toBe(false);
    // An item-typed entry is not an option's verdict (isOptionOutOfStock).
    expect(dead(["sauce_live"], { d: { type: "item", inStock: false } })).toBe(false);
  });

  it("never throws: no ids, no map, an unknown or inherited id", () => {
    expect(dead(undefined)).toBe(false);
    expect(dead("sauce")).toBe(false);
    expect(hasDeadRequiredGroup(["sauce"], null, {}, false)).toBe(false);
    expect(dead(["gone", "constructor", "__proto__", null])).toBe(false);
    expect(dead(["sauce"], null)).toBe(true);
  });

  it("markUncompletable: a dead item reads out of stock — a copy, the input untouched; anything else is the same object", () => {
    const burrito = { id: "burrito", name: "Burrito", price: 5, modifiers: ["extras", "sauce"] };
    const before = structuredClone(burrito);

    const out = markUncompletable(burrito, MODS, {}, false);

    expect(out).toEqual({ ...before, outOfStock: true });
    expect(burrito).toEqual(before);
    for (const same of [
      { ...burrito, modifiers: ["sauce_live", "extras"] },
      { ...burrito, outOfStock: true },
      { ...burrito, modifiers: undefined },
      null,
      "burrito",
    ]) {
      expect(markUncompletable(same, MODS, {}, false)).toBe(same);
    }
  });

  it("markUncompletable: a sized item is judged size by size — the size whose own required group is out reads out of stock, the others stay, the item stays", () => {
    const regular = { id: "s-r", name: "Regular", price: 4, isActive: true, modifiers: ["sauce_live"] };
    const large = { id: "s-l", name: "Large", price: 6, isActive: true, modifiers: ["sauce"] };
    const soda = { id: "soda", name: "Soda", hasVariant: true, isVariant: false, modifiers: ["sauce"], variants: [regular, large] };

    const out = markUncompletable(soda, MODS, {}, false);

    expect(out).toEqual({ ...soda, variants: [regular, { ...large, outOfStock: true }] });
    expect(out.variants[0]).toBe(regular);
    expect((out as { outOfStock?: unknown }).outOfStock).toBeUndefined();
    // Every size live → the same object; a size (isVariant) alone is judged by its own groups.
    const live = { ...soda, variants: [regular] };
    expect(markUncompletable(live, MODS, {}, false)).toBe(live);
    const flagged = { ...soda, variants: [regular, { ...large, outOfStock: true }] };
    expect(markUncompletable(flagged, MODS, {}, false)).toBe(flagged);
    expect(markUncompletable({ ...large, isVariant: true }, MODS, {}, false)).toMatchObject({ outOfStock: true });
  });

  it("markUncompletable: no size on offer left to complete — one dead, the rest dead or sold out — and the item reads out of stock too", () => {
    const regular = { id: "s-r", name: "Regular", price: 4, isActive: true, modifiers: ["sauce"] };
    const large = { id: "s-l", name: "Large", price: 6, isActive: true, modifiers: ["sauce"] };
    const nachos = { id: "nachos", name: "Nachos", hasVariant: true, isVariant: false, modifiers: [], variants: [regular] };
    const deadSize = { ...regular, outOfStock: true };

    // A single size, dead: nothing left to open.
    expect(markUncompletable(nachos, MODS, {}, false)).toEqual({ ...nachos, variants: [deadSize], outOfStock: true });
    // Every size dead; one dead beside one sold out; one dead beside a size that is not on offer.
    const soldOut = { ...large, modifiers: ["sauce_live"], outOfStock: true };
    const off = { ...large, modifiers: ["sauce_live"], isActive: false };
    for (const sizes of [[regular, large], [regular, soldOut], [regular, off]]) {
      expect(markUncompletable({ ...nachos, variants: sizes }, MODS, {}, false)).toMatchObject({ outOfStock: true });
    }
    // PAY's map brings the dip back: the size and the item live again — the same object.
    expect(markUncompletable(nachos, MODS, { b: { type: "addon", inStock: true } }, false)).toBe(nachos);
    // Sold out only, no size dead: left as it is (Select a Size shows them greyed — f7c7dfb).
    const allSoldOut = { ...nachos, variants: [soldOut, { ...soldOut, id: "s-x" }] };
    expect(markUncompletable(allSoldOut, MODS, {}, false)).toBe(allSoldOut);
    // A dead size whose siblings are none on offer: no size to judge, the item stays.
    const phantom = { ...nachos, variants: [{ ...regular, isActive: false }] };
    expect((markUncompletable(phantom, MODS, {}, false) as { outOfStock?: unknown }).outOfStock).toBeUndefined();
  });
});

/*
  User decision 2026-10-15 ("Show it Unavailable"): a REQUIRED group (effective
  min > 0) with NO positive effective max takes no pick (group-limits, "0 of
  0"), so its min is never met — the item is dead exactly like one whose
  required group has nothing in stock, everything in stock or not. A min-0
  group never is; a missing min reads 0 (decision 2), so it is not required.
*/
describe("hasDeadRequiredGroup / markUncompletable — a required group with no max (user 2026-10-15)", () => {
  const live = [{ id: "a", isActive: true, outOfStock: false }];
  const group = (bounds: Record<string, unknown>) => ({ isActive: true, constituentItems: live, ...bounds });
  const MODS = {
    zero: group({ min: 1, max: 0 }),
    nul: group({ min: 1, max: null }),
    missing: group({ min: 1 }),
    text: group({ min: 1, max: "x" }),
    two: group({ min: 1, max: "2" }),
    toggle: group({ min: 0, max: 0 }),
    no_min: group({ max: 0 }),
    null_min: group({ min: null, max: 0 }),
    off: group({ min: 1, max: 0, isActive: false }),
    no_options: group({ min: 1, max: 0, constituentItems: [{ id: "g", isActive: false }] }),
    punch: group({ min: 1, max: 3, multiplePunchMin: 1, multiplePunchMax: 0 }),
    punch_live: group({ min: 1, max: 0, multiplePunchMin: 1, multiplePunchMax: 2 }),
  };
  const dead = (ids: unknown, multiPunch = false) => hasDeadRequiredGroup(ids, MODS, {}, multiPunch);

  it("required with no positive max — 0, null, missing or not a number — is dead, every option in stock; a positive max (a numeric string too) keeps it alive", () => {
    for (const id of ["zero", "nul", "missing", "text"]) expect(dead([id]), id).toBe(true);
    expect(dead(["two"])).toBe(false);
  });

  it("a min-0 group never is — 0, a missing or a null min — nor one the PDP never shows (switched off); a required one with no option on offer still takes no pick", () => {
    for (const id of ["toggle", "no_min", "null_min", "off"]) expect(dead([id]), id).toBe(false);
    expect(dead(["no_options"])).toBe(true);
  });

  it("multi-punch on: the multi-punch bounds decide, both ways", () => {
    expect(dead(["punch"], true)).toBe(true);
    expect(dead(["punch"], false)).toBe(false);
    expect(dead(["punch_live"], true)).toBe(false);
    expect(dead(["punch_live"], false)).toBe(true);
  });

  it("markUncompletable: the item reads out of stock; a sized item size by size — only the dead size, the item stays while a size is left", () => {
    const burrito = { id: "burrito", name: "Burrito", price: 5, modifiers: ["toggle", "zero"] };
    expect(markUncompletable(burrito, MODS, {}, false)).toEqual({ ...burrito, outOfStock: true });

    const regular = { id: "s-r", name: "Regular", price: 4, isActive: true, modifiers: ["two"] };
    const large = { id: "s-l", name: "Large", price: 6, isActive: true, modifiers: ["missing"] };
    const soda = { id: "soda", name: "Soda", hasVariant: true, isVariant: false, modifiers: [], variants: [regular, large] };
    const out = markUncompletable(soda, MODS, {}, false);
    expect(out).toEqual({ ...soda, variants: [regular, { ...large, outOfStock: true }] });
    expect((out as { outOfStock?: unknown }).outOfStock).toBeUndefined();
    // Its only size dead: nothing left to open — the item reads out too.
    expect(markUncompletable({ ...soda, variants: [large] }, MODS, {}, false)).toMatchObject({ outOfStock: true });
  });

  it("a size whose required group carries no isActive key is dead: the sized commit skips that group, but PAY's re-check refuses the row — Unavailable up front, not a dead end at PAY (review r3 #2)", () => {
    const { isActive: _isActive, ...noKey } = MODS.zero;
    const groups = { syrup: { _id: "syrup", name: "Syrup", ...noKey } };
    const large = { id: "s-l", name: "Large", price: 6, isActive: true, modifiers: ["syrup"] };
    const soda = { id: "soda", name: "Soda", hasVariant: true, isVariant: false, modifiers: [], variants: [large] };
    expect(markUncompletable(soda, groups, {}, false)).toMatchObject({ outOfStock: true, variants: [{ outOfStock: true }] });

    // The PDP seeds every size group and its ADD TO BAG skips one whose isActive is falsy …
    const fetch = (ids: unknown[]) => ids.map((id) => groups[id as "syrup"]).filter(Boolean);
    const seeded = buildEmptySelectionsForModifiers(large.modifiers);
    expect(validateVariantSelections({ modifierIds: ["syrup"], mergedCustomizations: seeded, fetchModifierProperties: fetch, allowMultiplePunch: false }).allPassed).toBe(true);
    // … but PAY's sweep never reads a group's isActive: the bag row is flagged, PAY blocked.
    const row = { itemId: "row", type: "VARIANT", customizations: seeded };
    expect(checkFinalCheckOutMinMax([row], undefined, () => false, fetch).minMaxErroredBaseItems).toEqual(["row"]);
  });
});
