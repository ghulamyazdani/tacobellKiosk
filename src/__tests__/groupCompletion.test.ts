import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findFirstMinMaxViolation,
  isGroupMinMaxSatisfied,
  validateVariantSelections,
  type FetchModifierProperties,
} from "@cx-sdk/ordering/customization/groupCompletion";
import { listVariantSelectionViolations } from "@cx-sdk/ordering/customization/incompleteGroups";

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
