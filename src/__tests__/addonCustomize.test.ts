import { describe, expect, it } from "vitest";
import {
  hasOwnPicks,
  isPackSlotGroup,
  isSwapGroup,
  ownGroupsOf,
  planAddonTap,
  resolveAddonCustomize,
  type AddonCustomizeTarget,
} from "@cx-sdk/ordering/customization/addonCustomize";
import {
  buildNestedEntityToAdd,
  buildTier2NewEntity,
  getTotalQuantityOfGroupItem,
  planCustomizationSelect,
} from "@cx-sdk/ordering/customization/nestedCardLogic";

/*
  Lane addon-customize — the SDK planner behind Figma 1:5332's two-button
  option card (packages/ordering/src/customization/addonCustomize.ts), tested
  here: the SDK has no runner (H09). It maps the fork card's taps
  (GroupWiseItemCardNested → nestedCardLogic.planCustomizationSelect) onto
  CUSTOMIZE + CHOOSE / REMOVE, without the fork's defects (contract v3 §2.3,
  §9.1, §11.1). Rows below name the contract's behaviour-table rows.
*/

type Row = Record<string, unknown>;
type Group = Record<string, unknown> & { _id: string };

const OWN: Group = {
  _id: "x_own_addons",
  name: "Own",
  isActive: true,
  min: 0,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  constituentItems: [{ id: "p", name: "P", price: 0.5 }],
};
/** Inactive with min 1: the fork's raw seed keys it, and PAY's sweep then fails the row (§11 D6). */
const OWN_INACTIVE: Group = { ...OWN, _id: "x_inactive_addons", isActive: false, min: 1, multiplePunchMin: 1 };
const OWN_OOS: Group = { ...OWN, _id: "x_oos_addons", outOfStock: true };
const GROUPS: Record<string, Group> = {
  [OWN._id]: OWN,
  [OWN_INACTIVE._id]: OWN_INACTIVE,
  [OWN_OOS._id]: OWN_OOS,
};
/** The fork's resolver shape: a missing id comes back undefined. */
const fetchModifierProperties = (ids: unknown[]) => ids.map((id) => GROUPS[String(id)]);
const generateUniqueId = (id: unknown) => `u_${String(id)}`;

const VARIANT = (isAllModifersOptional?: boolean) => ({
  id: "x",
  name: "X Entity",
  price: 9,
  subCategoryId: "sub",
  modifiers: [OWN._id, OWN_INACTIVE._id, OWN_OOS._id, "gone_addons"],
  ...(isAllModifersOptional === undefined ? {} : { isAllModifersOptional }),
});
const R: AddonCustomizeTarget = { variant: VARIANT(false), required: true };
const O: AddonCustomizeTarget = { variant: VARIANT(true), required: false };

/** The tapped option (a constituent item: options carry modifiers: []). */
const X = { id: "x", name: "X", price: 3, isActive: true, modifiers: [] };
const opt = (id: string) => ({ id, name: id, price: 1, isActive: true, modifiers: [] });
const group = (min: number, max: number, extra: Row = {}): Group => ({
  _id: "g_addons",
  name: "Group",
  min,
  max,
  multiplePunchMin: min,
  multiplePunchMax: max,
  multiplePunchMaxItem: 1,
  isActive: true,
  constituentItems: [X, opt("o1"), opt("o2")],
  ...extra,
});
const FLEX = group(0, 2);
const SWAP = group(1, 1);
const TOGGLE = group(0, 0);

const plain = (id: string, extra: Row = {}) => ({ id, name: id, price: 1, quantity: 1, ...extra });
const preShaped = (id: string) => plain(id, { itemId: `i_${id}`, customizations: { [OWN._id]: [] } });
const customized = (id: string, itemId = `i_${id}`) =>
  plain(id, { itemId, customizations: { [OWN._id]: [{ id: "p", name: "P", price: 0.5, quantity: 1 }] } });

const plan = (
  action: "customize" | "select",
  target: AddonCustomizeTarget | null,
  g: Group,
  rows: Row[] | undefined,
  extra: { replaceConfirmed?: boolean; item?: Row; allowMultiplePunch?: boolean } = {},
) =>
  planAddonTap({
    action,
    customizations: rows === undefined ? {} : { [g._id]: rows, other_addons: [plain("keep")] },
    group: g,
    item: extra.item ?? X,
    target,
    allowMultiplePunch: extra.allowMultiplePunch ?? false,
    fetchModifierProperties,
    generateUniqueId,
    replaceConfirmed: extra.replaceConfirmed,
  });

/** buildNestedEntityToAdd's row with the ACTIVE, in-stock own keys only (D6). */
const preShapedRow = (g: Group, target: AddonCustomizeTarget) => ({
  ...buildNestedEntityToAdd({
    entity: X,
    isAllModifersOptional: true,
    foundAppropriateVariant: target.variant,
    group: g,
    generateUniqueId,
  }),
  customizations: { [OWN._id]: [] },
});

describe("resolveAddonCustomize — who gets the two-button card (D2)", () => {
  const resolve = (g: Row, resolveVariant: (item: unknown) => unknown = () => VARIANT(true)) =>
    resolveAddonCustomize({ group: g, item: X, allowMultiplePunch: false, resolveVariant });

  it.each([
    ["a `_combo` 0/2 card group", { ...group(0, 2), _id: "p_snacks_combo" }],
    ["an `_addons` 0/1 card group", { ...group(0, 1), _id: "p_extra_addons" }],
    ["any other suffix (0/3)", { ...group(0, 3), _id: "p_x_extras" }],
    ["a swap `_addons` 1/1 whose item max is 2 (still cards)", { ...group(1, 1), multiplePunchMaxItem: 2 }],
  ])("a target for %s — no group-type gate", (_label, g) => {
    expect(resolve(g)).toEqual({ variant: VARIANT(true), required: false });
  });

  it.each([
    ["isAllModifersOptional true → all-optional", true, false],
    ["false → required", false, true],
    ["missing → required (the fork card's non-boolean rule)", undefined, true],
  ])("`required` mirrors the fork's flag: %s", (_label, flag, required) => {
    expect(resolve(FLEX, () => VARIANT(flag))?.required).toBe(required);
  });

  it.each([
    ["a pack slot (`_combo` raw 1/1): PackSlotCard keeps its own CUSTOMIZE", { ...group(1, 1), _id: "p_side_combo" }, () => VARIANT(true)],
    ["a stepper group (item max 2, 0/4): OptionRow's surface", { ...group(0, 4), multiplePunchMaxItem: 2 }, () => VARIANT(true)],
    ["a resolver answering {} (no active own group)", FLEX, () => ({})],
    ["a resolver answering null", FLEX, () => null],
    [
      "a resolver that throws (a malformed menu map, Rule 2)",
      FLEX,
      () => {
        throw new TypeError("boom");
      },
    ],
  ])("null for %s", (_label, g, resolveVariant) => {
    expect(resolve(g, resolveVariant)).toBeNull();
  });

  it("isPackSlotGroup is the PDP's isSlotGroup: `_combo` AND raw 1/1 (numbers or numeric strings)", () => {
    expect(isPackSlotGroup({ _id: "a_combo", min: 1, max: 1 })).toBe(true);
    expect(isPackSlotGroup({ _id: "a_combo", min: "1", max: "1" })).toBe(true);
    expect(isPackSlotGroup({ _id: "a_combo", min: 0, max: 2 })).toBe(false);
    expect(isPackSlotGroup({ _id: "a_addons", min: 1, max: 1 })).toBe(false);
    expect(isPackSlotGroup(null)).toBe(false);
  });
});

describe("the helpers", () => {
  it("ownGroupsOf keeps active, in-stock groups and drops inactive, out-of-stock and missing ids", () => {
    expect(ownGroupsOf(VARIANT(true), fetchModifierProperties)).toEqual([OWN]);
    expect(ownGroupsOf({}, fetchModifierProperties)).toEqual([]);
    expect(ownGroupsOf(null, () => undefined as unknown as unknown[])).toEqual([]);
  });

  it("hasOwnPicks: true iff some own list is non-empty; never throws", () => {
    expect(hasOwnPicks(customized("x"))).toBe(true);
    expect(hasOwnPicks({ customizations: { a: [], b: [{ id: "p" }] } })).toBe(true);
    for (const row of [undefined, null, {}, { customizations: {} }, { customizations: { g: [] } }, preShaped("x")]) {
      expect(hasOwnPicks(row)).toBe(false);
    }
    expect(hasOwnPicks({ customizations: { g: null } })).toBe(false);
  });

  it("isSwapGroup: the engines' strict 1/1 over MORE than one option", () => {
    expect(isSwapGroup(SWAP, false)).toBe(true);
    expect(isSwapGroup({ ...SWAP, constituentItems: [X] }, false)).toBe(false);
    expect(isSwapGroup({ ...SWAP, min: "1", max: "1" }, false)).toBe(false);
    expect(isSwapGroup(FLEX, false)).toBe(false);
    // Multi-punch on: the effective bounds decide.
    expect(isSwapGroup({ ...FLEX, multiplePunchMin: 1, multiplePunchMax: 1 }, true)).toBe(true);
  });
});

describe("planAddonTap — the behaviour table (§2.3)", () => {
  it("rows 1 / 10: a REQUIRED CHOOSE with room opens the page NEW, the group key ensured, other rows untouched", () => {
    expect(plan("select", R, FLEX, [])).toEqual({
      kind: "open-new",
      tier1: { g_addons: [], other_addons: [plain("keep")] },
    });
    expect(plan("select", R, SWAP, [])).toMatchObject({ kind: "open-new" });
    // A map without the key gets it (else the page's UPDATE is a silent no-op).
    expect(
      planAddonTap({
        action: "select",
        customizations: { other_addons: [] },
        group: FLEX,
        item: X,
        target: R,
        allowMultiplePunch: false,
        fetchModifierProperties,
        generateUniqueId,
      }),
    ).toEqual({ kind: "open-new", tier1: { other_addons: [], g_addons: [] } });
  });

  it("rows 2 / 11: an all-optional CHOOSE is the fork's pre-shaped add — only active, in-stock own keys seeded", () => {
    const flex = plan("select", O, FLEX, []);
    expect(flex).toEqual({ kind: "list", item: preShapedRow(FLEX, O) });
    if (flex.kind !== "list") throw new Error("not a list plan");
    expect(Object.keys(flex.item.customizations)).toEqual([OWN._id]);
    expect(flex.item).toMatchObject({
      id: "x",
      price: 3,
      quantity: 1,
      itemId: "u_x",
      min: 0,
      max: 2,
      multiplePunchMaxItem: 1,
      modifiers: VARIANT(true).modifiers,
    });
    expect(plan("select", O, SWAP, [])).toEqual({ kind: "list", item: preShapedRow(SWAP, O) });
  });

  it("row 3 / 19: a plain card's CHOOSE is today's tap (the option as is)", () => {
    expect(plan("select", null, FLEX, [])).toEqual({ kind: "list", item: X });
    expect(plan("select", null, TOGGLE, [])).toEqual({ kind: "list", item: X });
  });

  it.each([
    ["R + 0/2 full", R, group(0, 2), [plain("o1"), plain("o2")]],
    ["R + 0/1 full", R, group(0, 1), [plain("o1")]],
    ["R + 1/2 full", R, group(1, 2), [plain("o1"), plain("o2")]],
    ["R + 0/0 (row 18)", R, TOGGLE, []],
    ["O + 0/2 full", O, group(0, 2), [plain("o1"), plain("o2")]],
    ["O + 0/1 full", O, group(0, 1), [plain("o1")]],
    ["O + 1/2 full", O, group(1, 2), [plain("o1"), plain("o2")]],
    ["O + 0/0 (row 18)", O, TOGGLE, []],
  ])("rows 4 / 5 / 18: %s → refuse (never a page, never a row)", (_label, target, g, rows) => {
    expect(plan("select", target, g, rows)).toEqual({ kind: "refuse" });
  });

  it("row 6: a plain card in a full group → list (the hook's UB2 guard refuses it out loud)", () => {
    expect(plan("select", null, FLEX, [plain("o1"), plain("o2")])).toEqual({ kind: "list", item: X });
  });

  it.each([
    ["flexible R", R, FLEX],
    ["flexible O", O, FLEX],
    ["toggle R", R, TOGGLE],
    ["toggle O", O, TOGGLE],
  ])("row 7: REMOVE on a %s pick with no own pick → list (removed at once)", (_label, target, g) => {
    expect(plan("select", target, g, [preShaped("x")])).toEqual({ kind: "list", item: X });
    expect(plan("select", target, g, [plain("x")])).toEqual({ kind: "list", item: X });
  });

  it.each([
    ["flexible R", R, FLEX],
    ["flexible O", O, FLEX],
    ["toggle O", O, TOGGLE],
  ])("row 8: REMOVE on a CUSTOMIZED %s pick → confirm-remove (decision 5)", (_label, target, g) => {
    expect(plan("select", target, g, [customized("x")])).toEqual({ kind: "confirm-remove" });
  });

  it("row 8 / M36: two rows of one id where only the SECOND carries own picks → confirm-remove", () => {
    expect(plan("select", O, FLEX, [preShaped("x"), customized("x", "i_2")])).toEqual({ kind: "confirm-remove" });
  });

  it("row 9: REMOVE on a plain card's pick → list", () => {
    expect(plan("select", null, FLEX, [plain("x")])).toEqual({ kind: "list", item: X });
  });

  it("row 12 (A3): a REQUIRED CHOOSE in a swap group holding a PLAIN pick opens NEW (UPDATE swaps; the fork refuses)", () => {
    expect(plan("select", R, SWAP, [plain("o1")])).toEqual({
      kind: "open-new",
      tier1: { g_addons: [plain("o1")], other_addons: [plain("keep")] },
    });
    // …and a pick whose own lists are all empty is plain too (no prompt).
    expect(plan("select", R, SWAP, [preShaped("o1")])).toMatchObject({ kind: "open-new" });
  });

  it("row 13: an all-optional / plain CHOOSE in a swap group holding a plain pick → list (the engine swaps)", () => {
    expect(plan("select", O, SWAP, [plain("o1")])).toEqual({ kind: "list", item: preShapedRow(SWAP, O) });
    expect(plan("select", null, SWAP, [plain("o1")])).toEqual({ kind: "list", item: X });
    expect(plan("select", null, SWAP, [preShaped("o1")])).toEqual({ kind: "list", item: X });
  });

  it.each([
    ["row 14: R", R, { kind: "open-new" }],
    ["row 15: O", O, { kind: "list", item: preShapedRow(SWAP, O) }],
    ["row 16: a plain card (the fork asks only at item max 1 — D2b)", null, { kind: "list", item: X }],
  ])("%s — CHOOSE in a swap group holding a CUSTOMIZED pick asks first; YES re-plans", (_label, target, confirmed) => {
    const current = customized("o1");
    expect(plan("select", target, SWAP, [current])).toEqual({ kind: "confirm-replace", current });
    expect(plan("select", target, SWAP, [current], { replaceConfirmed: true })).toMatchObject(confirmed);
  });

  it("row 17: the body / lower tap on a swap pick with a target → none (re-selecting would rewrite it plain); a plain swap pick re-selects as today", () => {
    expect(plan("select", R, SWAP, [customized("x")])).toEqual({ kind: "none" });
    expect(plan("select", O, SWAP, [preShaped("x")])).toEqual({ kind: "none" });
    expect(plan("select", null, SWAP, [plain("x")])).toEqual({ kind: "list", item: X });
  });

  it("CUSTOMIZE on an unpicked card, or on a card without a target → none", () => {
    expect(plan("customize", R, FLEX, [])).toEqual({ kind: "none" });
    expect(plan("customize", O, FLEX, [plain("o1")])).toEqual({ kind: "none" });
    expect(plan("customize", null, FLEX, [plain("x")])).toEqual({ kind: "none" });
  });

  it("CUSTOMIZE → open-edit: the row's own itemId kept; tier1 differs only in that row; the entity from the VARIANT", () => {
    const row = { ...customized("x", "i_keep"), modifiers: [] };
    const result = plan("customize", O, FLEX, [plain("o1"), row]);
    if (result.kind !== "open-edit") throw new Error(`expected open-edit, got ${result.kind}`);

    expect(result.tier1).toEqual({ g_addons: [plain("o1"), row], other_addons: [plain("keep")] });
    expect(result.entity).toEqual({
      ...buildTier2NewEntity({ variant: O.variant, entity: row, group: FLEX }),
      quantity: 1,
      itemId: "i_keep",
    });
    // The VARIANT's modifiers win (a plain row's modifiers: [] would open an empty page — M15).
    expect(result.entity).toMatchObject({ id: "x", name: "x", price: 1, min: 0, max: 2, modifiers: VARIANT(true).modifiers });
    expect(result.selections).toEqual({ [OWN._id]: [{ id: "p", name: "P", price: 0.5, quantity: 1 }] });
  });

  it("CUSTOMIZE stamps a row without an itemId first (D5) and seeds every active own group, stale / inactive keys dropped", () => {
    const legacy = plain("x", { quantity: 2, customizations: { gone_addons: [{ id: "z" }], [OWN_INACTIVE._id]: [] } });
    const result = plan("customize", R, FLEX, [legacy, plain("o1")]);
    if (result.kind !== "open-edit") throw new Error(`expected open-edit, got ${result.kind}`);

    expect(result.tier1.g_addons).toEqual([{ ...legacy, itemId: "u_x" }, plain("o1")]);
    expect(result.tier1.other_addons).toEqual([plain("keep")]);
    expect(result.entity).toMatchObject({ itemId: "u_x", quantity: 2 });
    expect(result.selections).toEqual({ [OWN._id]: [] });
  });

  it("CUSTOMIZE on a swap pick or a toggle pick → open-edit too", () => {
    expect(plan("customize", R, SWAP, [customized("x")])).toMatchObject({ kind: "open-edit" });
    expect(plan("customize", O, TOGGLE, [preShaped("x")])).toMatchObject({ kind: "open-edit" });
  });

  it("legacy duplicates: CUSTOMIZE edits the FIRST row of the id", () => {
    const result = plan("customize", O, FLEX, [preShaped("o1"), customized("x", "first"), customized("x", "second")]);
    expect(result).toMatchObject({ kind: "open-edit", entity: { itemId: "first" } });
  });

  it("never throws: a throwing group → none with a target (never a plain required add), list without", () => {
    const hostile = {
      ...SWAP,
      get constituentItems(): unknown[] {
        throw new TypeError("boom");
      },
    };
    expect(plan("select", R, hostile, [])).toEqual({ kind: "none" });
    expect(plan("select", O, hostile, [])).toEqual({ kind: "none" });
    expect(plan("select", null, hostile, [])).toEqual({ kind: "list", item: X });
  });

  it("multi-punch ON reads the effective bounds: a raw 0/2 group with multi-punch 1/1 is a swap", () => {
    const g = group(0, 2, { multiplePunchMin: 1, multiplePunchMax: 1 });
    const current = customized("o1");
    expect(plan("select", O, g, [current], { allowMultiplePunch: true })).toEqual({ kind: "confirm-replace", current });
    // Off, the raw 0/2 bounds: no swap, one unit of room → the pre-shaped add.
    expect(plan("select", O, g, [current], { allowMultiplePunch: false })).toMatchObject({ kind: "list" });
  });
});

/*
  Fork parity (§2.4): the fork card's decision (planCustomizationSelect, the
  card's toggle branch for plain cards) beside planAddonTap on the planner's
  states. Divergences are the contract's listed ones only: A3 (1/1 + a plain
  pick → open-new), D2b (plain cards always ask), and the full / 0-0 add-new
  the fork's hook refuses later.
*/
describe("fork parity — planCustomizationSelect beside planAddonTap", () => {
  const forkKind = (target: AddonCustomizeTarget, g: Group, rows: Row[], pill = false) => {
    const map = { [g._id]: rows };
    const args = {
      foundAppropriateVariant: target.variant,
      selectedCustomizations: map,
      group: g,
      entity: X,
      min: g.min,
      max: g.max,
      groupQuantity: rows.reduce((sum, r) => sum + Number(r.quantity ?? 0), 0),
      totalQuantityOfGroupItem: getTotalQuantityOfGroupItem(map, g._id, X.id),
      showRepeatCustomization: false,
      multiplePunchMaxItem: 1,
    };
    return planCustomizationSelect({ ...args, isAllNotModifersOptional: pill ? true : target.required });
  };

  it("open-tier2-new ↔ open-new, with the same tier-2 entity the page opens on", () => {
    const fork = forkKind(R, FLEX, []);
    expect(fork.kind).toBe("open-tier2-new");
    expect(fork.kind === "open-tier2-new" && fork.entity).toEqual(buildTier2NewEntity({ variant: R.variant, entity: X, group: FLEX }));
    expect(plan("select", R, FLEX, [])).toMatchObject({ kind: "open-new" });
  });

  it.each([
    ["R, 0/2 full", R, group(0, 2), [plain("o1"), plain("o2")], "notify-max-customizations"],
    ["R, 0/1 full", R, group(0, 1), [plain("o1")], "notify-max-customizations"],
    ["R, 1/2 full", R, group(1, 2), [plain("o1"), plain("o2")], "notify-max-customizations"],
    ["R, 0/0", R, TOGGLE, [], "notify-max-customizations"],
    ["O, 0/2 full", O, group(0, 2), [plain("o1"), plain("o2")], "notify-group-limit"],
    ["O, 0/0", O, TOGGLE, [], "notify-group-limit"],
    ["O, 0/1 full (the fork's hook refuses the add)", O, group(0, 1), [plain("o1")], "add-new"],
    ["O, 1/2 full (the fork's hook refuses the add)", O, group(1, 2), [plain("o1"), plain("o2")], "add-new"],
  ])("%s: the fork refuses (%s) → refuse", (_label, target, g, rows, kind) => {
    expect(forkKind(target, g, rows).kind).toBe(kind);
    expect(plan("select", target, g, rows)).toEqual({ kind: "refuse" });
  });

  it("A3 — R, 1/1 holding a plain pick: the fork refuses (notify-max-customizations), TB opens NEW", () => {
    expect(forkKind(R, SWAP, [plain("o1")]).kind).toBe("notify-max-customizations");
    expect(plan("select", R, SWAP, [plain("o1")])).toMatchObject({ kind: "open-new" });
  });

  it("add-new ↔ list (pre-shaped) with room", () => {
    expect(forkKind(O, FLEX, []).kind).toBe("add-new");
    expect(forkKind(O, SWAP, [plain("o1")]).kind).toBe("add-new");
    expect(plan("select", O, FLEX, [])).toEqual({ kind: "list", item: preShapedRow(FLEX, O) });
    expect(plan("select", O, SWAP, [plain("o1")])).toEqual({ kind: "list", item: preShapedRow(SWAP, O) });
  });

  it("replace-item ↔ confirm-replace (R and O on a customized 1/1 pick); a pick with empty own lists never asks", () => {
    for (const target of [R, O]) {
      expect(forkKind(target, SWAP, [customized("o1")]).kind).toBe("replace-item");
      expect(plan("select", target, SWAP, [customized("o1")])).toMatchObject({ kind: "confirm-replace" });
      expect(forkKind(target, SWAP, [preShaped("o1")]).kind).not.toBe("replace-item");
      expect(plan("select", target, SWAP, [preShaped("o1")]).kind).not.toBe("confirm-replace");
    }
  });

  it("open-tier2-edit (the pill / an R body tap) ↔ open-edit", () => {
    expect(forkKind(R, FLEX, [customized("x")]).kind).toBe("open-tier2-edit");
    expect(forkKind(O, FLEX, [preShaped("x")], true).kind).toBe("open-tier2-edit");
    expect(plan("customize", R, FLEX, [customized("x")])).toMatchObject({ kind: "open-edit" });
    expect(plan("customize", O, FLEX, [preShaped("x")])).toMatchObject({ kind: "open-edit" });
  });

  it("edit-or-delete ↔ CUSTOMIZE = open-edit, REMOVE = confirm-remove (customized) / list (not)", () => {
    expect(forkKind(O, FLEX, [preShaped("x")]).kind).toBe("edit-or-delete");
    expect(plan("customize", O, FLEX, [preShaped("x")])).toMatchObject({ kind: "open-edit" });
    expect(plan("select", O, FLEX, [preShaped("x")])).toEqual({ kind: "list", item: X });
    expect(forkKind(O, FLEX, [customized("x")]).kind).toBe("edit-or-delete");
    expect(plan("select", O, FLEX, [customized("x")])).toEqual({ kind: "confirm-remove" });
  });

  it("increase-optional (an O pick without customizations) ↔ REMOVE = list", () => {
    expect(forkKind(O, FLEX, [plain("x")]).kind).toBe("increase-optional");
    expect(plan("select", O, FLEX, [plain("x")])).toEqual({ kind: "list", item: X });
  });

  it("open-repeat-fallthrough (two rows of one id) ↔ CUSTOMIZE edits the first row", () => {
    expect(forkKind(R, group(0, 3), [customized("x", "a"), customized("x", "b")]).kind).toBe("open-repeat-fallthrough");
    expect(plan("customize", R, group(0, 3), [customized("x", "a"), customized("x", "b")])).toMatchObject({
      kind: "open-edit",
      entity: { itemId: "a" },
    });
  });
});
