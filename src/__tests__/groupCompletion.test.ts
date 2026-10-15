import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findFirstMinMaxViolation,
  isGroupMinMaxSatisfied,
  validateVariantSelections,
  type FetchModifierProperties,
} from "@cx-sdk/ordering/customization/groupCompletion";
import {
  listMinMaxViolations,
  listVariantSelectionViolations,
} from "@cx-sdk/ordering/customization/incompleteGroups";
import { findTier2MinMaxViolation } from "@cx-sdk/ordering/customization/tier2Logic";
import { checkFinalCheckOutMinMax } from "@cx-sdk/catalog/oos/outOfStockEngine";

/*
  User decision 2026-10-14 ("Fix it now"): every commit and re-check counts
  UNITS — summed quantities — as the PDP's "count of max" and the "+" guard
  do. A sized item's required stepper group (2 / 4) read "2 of 4" with Missi
  Roti ×2 while ADD TO BAG refused it: the VARIANT commit
  (validateVariantSelections) counted ROWS. The real SDK functions, tested
  here (the SDK has no runner — groupMaxGuard.test.ts). A plain pick is one
  unit, so plain groups keep counting picks.
*/

/** Stepper rows (item cap 2), required 2 / 4 — the user's Test 1 on a sized item. */
const STEPPER = {
  _id: "test1_addons",
  name: "Test 1",
  min: 2,
  max: 4,
  multiplePunchMin: 2,
  multiplePunchMax: 4,
  multiplePunchMaxItem: 2,
  isActive: true,
};
/** Plain cards (item cap 1): 2 / 3, and 0 / 1 under multi-punch. */
const PLAIN = {
  _id: "extras_addons",
  name: "Extras",
  min: 2,
  max: 3,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  isActive: true,
};
const GROUPS: Record<string, object> = { [STEPPER._id]: STEPPER, [PLAIN._id]: PLAIN };
const fetchProps: FetchModifierProperties = (ids) =>
  ids.map((id) => (GROUPS[String(id)] ? { ...GROUPS[String(id)] } : undefined));

const pick = (id: string, quantity = 1) => ({ id, quantity });
const variantCommit = (groupId: string, rows: unknown[], allowMultiplePunch = false) =>
  validateVariantSelections({
    modifierIds: [groupId],
    mergedCustomizations: { [groupId]: rows },
    fetchModifierProperties: fetchProps,
    allowMultiplePunch,
  }).allPassed;
const customizableCommit = (groupId: string, rows: unknown[], allowMultiplePunch = false) =>
  findFirstMinMaxViolation({ [groupId]: rows }, fetchProps, allowMultiplePunch) === null;
const tier2Check = (group: object, rows: unknown[], tier1CustOpen = false) =>
  isGroupMinMaxSatisfied({
    modifierGroup: group,
    selectedItems: rows,
    allowMultiplePunch: false,
    tier1CustOpen,
    tier2CustOpen: !tier1CustOpen,
  });

describe("commits and re-checks count units, never rows (user decision 2026-10-14)", () => {
  beforeEach(() => {
    // The SDK scans keep their legacy debug logs (fork byte-identity).
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("validateVariantSelections — the sized item's commit", () => {
    it("Missi Roti ×2 meets a minimum of 2: one row, two units", () => {
      expect(variantCommit(STEPPER._id, [pick("missi", 2)])).toBe(true);
    });

    it("below the minimum in units: ×1 is refused, and names the group", () => {
      expect(
        validateVariantSelections({
          modifierIds: [STEPPER._id],
          mergedCustomizations: { [STEPPER._id]: [pick("missi", 1)] },
          fetchModifierProperties: fetchProps,
          allowMultiplePunch: false,
        }),
      ).toEqual({ allPassed: false, errorModifierId: STEPPER._id });
    });

    it("the max is units too: ×2 + ×2 is '4 of 4' and passes; ×2 + ×2 + ×1 is 5 in three rows and is refused", () => {
      expect(variantCommit(STEPPER._id, [pick("missi", 2), pick("garlic", 2)])).toBe(true);
      expect(variantCommit(STEPPER._id, [pick("missi", 2), pick("garlic", 2), pick("tandoori", 1)])).toBe(false);
    });

    it("plain groups keep counting picks (one unit each): 2 / 3 takes two or three, never one or four", () => {
      const picks = ["a", "b", "c", "d"].map((id) => pick(id));
      expect(variantCommit(PLAIN._id, picks.slice(0, 1))).toBe(false);
      expect(variantCommit(PLAIN._id, picks.slice(0, 2))).toBe(true);
      expect(variantCommit(PLAIN._id, picks.slice(0, 3))).toBe(true);
      expect(variantCommit(PLAIN._id, picks)).toBe(false);
    });

    it("multi-punch on: the multi-punch bounds, in units", () => {
      expect(variantCommit(PLAIN._id, [pick("a")], true)).toBe(true);
      expect(variantCommit(PLAIN._id, [pick("a"), pick("b")], true)).toBe(false);
      expect(variantCommit(STEPPER._id, [pick("missi", 2)], true)).toBe(true);
    });

    it("agrees with the CUSTOMIZABLE commit (findFirstMinMaxViolation) on every stepper shape up to 3 rows × 3 units", () => {
      const quantities = [1, 2, 3];
      const shapes: number[][] = [[]];
      for (let rows = 1; rows <= 3; rows += 1) {
        for (const shape of shapes.filter((s) => s.length === rows - 1)) {
          for (const q of quantities) shapes.push([...shape, q]);
        }
      }
      for (const amp of [false, true]) {
        for (const shape of shapes) {
          const rows = shape.map((q, i) => pick(`o${i}`, q));
          expect(variantCommit(STEPPER._id, rows, amp), `${shape} amp ${amp}`).toBe(
            customizableCommit(STEPPER._id, rows, amp),
          );
        }
      }
    });
  });

  it("findFirstMinMaxViolation (the CUSTOMIZABLE commit) already counted units: ×2 meets 2, ×1 does not", () => {
    expect(customizableCommit(STEPPER._id, [pick("missi", 2)])).toBe(true);
    expect(customizableCommit(STEPPER._id, [pick("missi", 1)])).toBe(false);
  });

  it("the completion warning (incompleteGroups) loops the same scan: Missi Roti ×2 leaves nothing to name", () => {
    expect(
      listVariantSelectionViolations({
        modifierIds: [STEPPER._id, PLAIN._id],
        mergedCustomizations: { [STEPPER._id]: [pick("missi", 2)], [PLAIN._id]: [pick("a")] },
        fetchModifierProperties: fetchProps,
        allowMultiplePunch: false,
      }),
    ).toEqual([{ modifierID: PLAIN._id, name: "Extras" }]);
  });

  describe("isGroupMinMaxSatisfied — the tier-2 count", () => {
    it("tier-2 counts units like tier-1: ×2 meets 2; 5 units in three rows break 4", () => {
      const over = [pick("missi", 2), pick("garlic", 2), pick("tandoori", 1)];
      expect(tier2Check(STEPPER, [pick("missi", 2)])).toBe(true);
      expect(tier2Check(STEPPER, over)).toBe(false);
      expect(tier2Check(STEPPER, [pick("missi", 2)], true)).toBe(true);
      expect(tier2Check(STEPPER, over, true)).toBe(false);
    });

    it("plain picks on tier-2 still count one each: 2 / 3 takes two, not one", () => {
      expect(tier2Check(PLAIN, [pick("a"), pick("b")])).toBe(true);
      expect(tier2Check(PLAIN, [pick("a")])).toBe(false);
    });

    it("with neither tier open the total stays 0, as before", () => {
      const closed = (group: object) =>
        isGroupMinMaxSatisfied({
          modifierGroup: group,
          selectedItems: [pick("missi", 2)],
          allowMultiplePunch: false,
          tier1CustOpen: false,
          tier2CustOpen: false,
        });
      expect(closed(STEPPER)).toBe(false);
      expect(closed({ ...PLAIN, min: 0 })).toBe(true);
    });
  });
});

/*
  User decision 2026-10-15 ("Treat missing as 0"): a min or max the menu
  leaves out entirely (undefined) reads 0 in every commit and re-check,
  exactly as null already did — an EMPTY such group commits, and a pick is
  still refused ("0 of 0", the group-limits rule). Pinned on every scan: the
  customizable and the sized commit, tier-2's SAVE and group check, the
  completion warning's lists (incompleteGroups loops the commit scans) and
  PAY's re-check (review r3 #1: checkoutStockSweep's min / max sweep read a
  missing max as no cap, so a pick the PDP refuses was ordered). A bound that
  is not a positive number reads 0 the same way (review r3 #3).
*/
describe("a missing min / max reads 0, as null does (user decision 2026-10-15)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** PAY's re-check (checkFinalCheckOutMinMax): G on a bag row, or inside a slot pick (tier-2). It counts live picks. */
  const pay = (group: object, rows: unknown[], amp: boolean, nested: boolean) => {
    const slot = { _id: "slot", name: "Slot", isActive: true, min: 0, max: 1, multiplePunchMin: 0, multiplePunchMax: 1 };
    const fetch: FetchModifierProperties = (ids) => ids.map((id) => (id === "g" ? { ...group } : id === "slot" ? { ...slot } : undefined));
    const live = rows.map((row) => ({ ...(row as object), isActive: true }));
    const customizations = nested ? { slot: [{ id: "s", isActive: true, quantity: 1, customizations: { g: live } }] } : { g: live };
    const row = { itemId: "row", type: "CUSTOMIZABLE", customizations };
    return checkFinalCheckOutMinMax([row], undefined, () => amp, fetch).minMaxErroredBaseItems.length === 0;
  };

  /** Does each scan pass ONE group with these bounds holding these rows? */
  const verdicts = (bounds: Record<string, unknown>, rows: unknown[], amp: boolean) => {
    const group = { _id: "g", name: "G", isActive: true, ...bounds };
    const fetch: FetchModifierProperties = (ids) => ids.map((id) => (id === "g" ? { ...group } : undefined));
    const sized = { modifierIds: ["g"], mergedCustomizations: { g: rows }, fetchModifierProperties: fetch, allowMultiplePunch: amp };
    const tier = (tier1CustOpen: boolean) =>
      isGroupMinMaxSatisfied({ modifierGroup: group, selectedItems: rows, allowMultiplePunch: amp, tier1CustOpen, tier2CustOpen: !tier1CustOpen });
    return {
      customizable: findFirstMinMaxViolation({ g: rows }, fetch, amp) === null,
      sized: validateVariantSelections(sized).allPassed,
      tier2Save: findTier2MinMaxViolation({ g: rows }, fetch, amp) === null,
      tier1Group: tier(true),
      tier2Group: tier(false),
      warning: listMinMaxViolations({ g: rows }, fetch, amp).length === 0,
      warningSized: listVariantSelectionViolations(sized).length === 0,
      pay: pay(group, rows, amp, false),
      payTier2: pay(group, rows, amp, true),
    };
  };
  const every = (pass: boolean) => ({
    customizable: pass,
    sized: pass,
    tier2Save: pass,
    tier1Group: pass,
    tier2Group: pass,
    warning: pass,
    warningSized: pass,
    pay: pass,
    payTier2: pass,
  });

  it.each([
    ["left out", {}, {}],
    ["null", { min: null, max: null }, { multiplePunchMin: null, multiplePunchMax: null }],
  ])("both bounds %s, multi-punch off and on: the EMPTY group passes every scan; a pick fails every scan", (_label, raw, punch) => {
    for (const [bounds, amp] of [[raw, false], [punch, true]] as const) {
      expect(verdicts(bounds, [], amp)).toEqual(every(true));
      expect(verdicts(bounds, [pick("a")], amp)).toEqual(every(false));
    }
  });

  it("one bound left out reads 0 beside the other: min 0 with no max takes nothing; max 2 with no min takes 0 to 2 units", () => {
    expect(verdicts({ min: 0 }, [], false)).toEqual(every(true));
    expect(verdicts({ min: 0 }, [pick("a")], false)).toEqual(every(false));
    expect(verdicts({ max: 2 }, [], false)).toEqual(every(true));
    expect(verdicts({ max: 2 }, [pick("a", 2)], false)).toEqual(every(true));
    expect(verdicts({ max: 2 }, [pick("a", 2), pick("b")], false)).toEqual(every(false));
  });

  it("left out reads exactly as null on every scan — each bound, beside any other, for any rows, multi-punch off and on", () => {
    const shapes = [[], [pick("a")], [pick("a", 2)], [pick("a"), pick("b", 3)]];
    for (const amp of [false, true]) {
      const [minKey, maxKey] = amp ? ["multiplePunchMin", "multiplePunchMax"] : ["min", "max"];
      for (const other of [undefined, 0, 1, 3]) {
        const max = other === undefined ? {} : { [maxKey]: other };
        const min = other === undefined ? {} : { [minKey]: other };
        for (const rows of shapes) {
          expect(verdicts(max, rows, amp), `no ${minKey} / ${maxKey} ${other}`).toEqual(verdicts({ [minKey]: null, ...max }, rows, amp));
          expect(verdicts(min, rows, amp), `${minKey} ${other} / no ${maxKey}`).toEqual(verdicts({ ...min, [maxKey]: null }, rows, amp));
        }
      }
    }
  });

  it("a bound that is not a positive number — text or negative — reads 0 like a missing one on every scan, as the PDP reads it ('0 of 0', no Required; review r3 #3)", () => {
    const shapes = [[], [pick("a")], [pick("a", 2)], [pick("a"), pick("b", 3)]];
    for (const amp of [false, true]) {
      const [minKey, maxKey] = amp ? ["multiplePunchMin", "multiplePunchMax"] : ["min", "max"];
      for (const bad of ["x", -1]) {
        for (const other of [undefined, 0, 1, 3]) {
          const max = other === undefined ? {} : { [maxKey]: other };
          const min = other === undefined ? {} : { [minKey]: other };
          for (const rows of shapes) {
            expect(verdicts({ [minKey]: bad, ...max }, rows, amp), `${minKey} ${bad} / ${maxKey} ${other}`).toEqual(verdicts(max, rows, amp));
            expect(verdicts({ ...min, [maxKey]: bad }, rows, amp), `${minKey} ${other} / ${maxKey} ${bad}`).toEqual(verdicts(min, rows, amp));
          }
        }
      }
    }
    // The review's dead end: min 0 beside a text max — the EMPTY group commits; a pick is refused.
    expect(verdicts({ min: 0, max: "x" }, [], false)).toEqual(every(true));
    expect(verdicts({ min: 0, max: "x" }, [pick("a")], false)).toEqual(every(false));
  });

  it("PAY's tier-2 re-check still skips a group the menu does not have, as its tier-1 loop does — only a known group's bound reads 0", () => {
    const slot = { _id: "slot", name: "Slot", isActive: true, min: 0, max: 1 };
    const fetch: FetchModifierProperties = (ids) => ids.map((id) => (id === "slot" ? { ...slot } : undefined));
    const gone = { gone: [{ ...pick("a"), isActive: true }] };
    const row = { itemId: "row", type: "CUSTOMIZABLE", customizations: { slot: [{ id: "s", isActive: true, quantity: 1, customizations: gone }] } };
    expect(checkFinalCheckOutMinMax([row], undefined, () => false, fetch).minMaxErroredBaseItems).toEqual([]);
  });
});

/*
  User decision 2026-10-15 ("PAY skips inactive groups"): PAY's re-check
  counts a group only when its isActive is true — false, or no key at all, is
  inactive, as the PDP shows groups and the sized commit's
  validateVariantSelections skips them. A size whose inactive required group
  the PDP seeds empty was added fine, then refused at PAY for good: Edit
  cannot fill a group it never shows. Known gap: the customizable commit and
  tier-2 SAVE (findFirstMinMaxViolation, findTier2MinMaxViolation) count every
  key they are handed. Fresh seeds hold active groups only, but an Edit session
  restores the row's keys, so a group switched off after the add counts there.
*/
describe("PAY's re-check skips inactive groups, at either tier (user decision 2026-10-15)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Does PAY pass one row whose required group G (1 / 1) is left empty — on the row, or inside a slot pick (tier-2)? */
  const payPasses = (flag: Record<string, unknown>, type: string, nested: boolean) => {
    const g = { _id: "g", name: "G", min: 1, max: 1, multiplePunchMin: 1, multiplePunchMax: 1, ...flag };
    const slot = { _id: "slot", name: "Slot", isActive: true, min: 0, max: 1 };
    const fetch: FetchModifierProperties = (ids) => ids.map((id) => (id === "g" ? { ...g } : id === "slot" ? { ...slot } : undefined));
    const customizations = nested ? { slot: [{ id: "s", isActive: true, quantity: 1, customizations: { g: [] } }] } : { g: [] };
    return checkFinalCheckOutMinMax([{ itemId: "row", type, customizations }], undefined, () => false, fetch)
      .minMaxErroredBaseItems.length === 0;
  };

  it.each(["VARIANT", "CUSTOMIZABLE"])("a %s row: the empty required group passes when its isActive is false or missing, and is still refused when it is true — on the row and inside a slot pick", (type) => {
    for (const nested of [false, true]) {
      expect(payPasses({ isActive: false }, type, nested), `isActive false, tier-2 ${nested}`).toBe(true);
      expect(payPasses({}, type, nested), `no isActive key, tier-2 ${nested}`).toBe(true);
      expect(payPasses({ isActive: true }, type, nested), `isActive true, tier-2 ${nested}`).toBe(false);
    }
  });

  it("a row group the menu does not have is skipped too — the fork's resolver answers [undefined] for it, and the sweep never throws (a throw fails PAY's whole check open)", () => {
    const row = { itemId: "row", type: "VARIANT", customizations: { gone: [] } };
    expect(checkFinalCheckOutMinMax([row], undefined, () => false, (ids) => ids.map(() => undefined)).minMaxErroredBaseItems).toEqual([]);
  });
});
