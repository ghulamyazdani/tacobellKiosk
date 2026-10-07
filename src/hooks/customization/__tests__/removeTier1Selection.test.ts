import { describe, expect, it } from "vitest";
import { removeTier1Selection } from "@cx-sdk/ordering/customization/tier2Logic";
import { getTotalValueWithApplyAddonPrice } from "@cx-sdk/ordering/customization/pricing";

/*
  Item 24 money check: the tier-2 EDIT "−" at qty 1 removes ONE tier-1 pick
  (the fork's ConfirmFirstTierDeleteCustomization YES). The fork keyed the
  group off `group.id` (groups carry `_id`), wrote an "undefined" key and made
  PDP pricing throw — this is the fixed, pure SDK version.
*/

const GROUP = "pack1_3_combo";
const FRIES = { id: "fries", name: "Large Fries", price: 0.75, quantity: 1, itemId: "1700000000001_fries" };
const FRIES_TOO = { ...FRIES, itemId: "1700000000002_fries" };
const NACHOS = { id: "nachos", name: "Nachos", price: 0, quantity: 1 };
const DRINK = { id: "cola", name: "Cola", price: 0, quantity: 1, itemId: "1700000000003_cola" };

const selections = () => ({
  [GROUP]: [FRIES, NACHOS, FRIES_TOO],
  pack1_2_combo: [DRINK],
});

describe("removeTier1Selection — item 24 tier-1 removal confirm", () => {
  it("matches by itemId when the entity has one: only that pick goes, other groups untouched", () => {
    const before = selections();
    const after = removeTier1Selection({ selectedCustomizations: before, groupId: GROUP, entity: FRIES_TOO });
    expect(after[GROUP]).toEqual([FRIES, NACHOS]);
    expect(after.pack1_2_combo).toBe(before.pack1_2_combo);
    expect(before[GROUP]).toHaveLength(3); // pure: the input map is not mutated
  });

  it("falls back to id for an entity without an itemId", () => {
    const after = removeTier1Selection({
      selectedCustomizations: selections(),
      groupId: GROUP,
      entity: { id: "nachos" },
    });
    expect(after[GROUP]).toEqual([FRIES, FRIES_TOO]);
  });

  it("duplicate picks of the same item: only ONE is removed", () => {
    const after = removeTier1Selection({
      selectedCustomizations: selections(),
      groupId: GROUP,
      entity: { id: "fries" },
    });
    expect(after[GROUP]).toEqual([NACHOS, FRIES_TOO]);
  });

  it("unknown group, non-array list, id-less entity or no match → the SAME input object", () => {
    const before = selections();
    expect(removeTier1Selection({ selectedCustomizations: before, groupId: "nope", entity: FRIES })).toBe(before);
    expect(removeTier1Selection({ selectedCustomizations: before, groupId: undefined, entity: FRIES })).toBe(before);
    expect(removeTier1Selection({ selectedCustomizations: before, groupId: GROUP, entity: {} })).toBe(before);
    expect(removeTier1Selection({ selectedCustomizations: before, groupId: GROUP, entity: null })).toBe(before);
    expect(
      removeTier1Selection({ selectedCustomizations: before, groupId: GROUP, entity: { itemId: "missing" } })
    ).toBe(before);
    const broken = { [GROUP]: null as unknown as unknown[] };
    expect(removeTier1Selection({ selectedCustomizations: broken, groupId: GROUP, entity: FRIES })).toBe(broken);
  });

  it("never writes a new key — no 'undefined' group (the fork bug), whatever the inputs", () => {
    const cases = [
      { groupId: GROUP, entity: FRIES },
      { groupId: undefined, entity: FRIES },
      { groupId: "undefined", entity: FRIES },
      { groupId: GROUP, entity: undefined },
    ];
    for (const { groupId, entity } of cases) {
      const after = removeTier1Selection({ selectedCustomizations: selections(), groupId, entity });
      expect(Object.keys(after).sort()).toEqual([GROUP, "pack1_2_combo"].sort());
      expect(after).not.toHaveProperty("undefined");
    }
  });

  it("PDP pricing over the result never throws and drops the removed pick's price", () => {
    const before = selections();
    expect(getTotalValueWithApplyAddonPrice(before, true)).toBeCloseTo(1.5, 2);
    const after = removeTier1Selection({ selectedCustomizations: before, groupId: GROUP, entity: FRIES });
    expect(() => getTotalValueWithApplyAddonPrice(after, true)).not.toThrow();
    expect(getTotalValueWithApplyAddonPrice(after, true)).toBeCloseTo(0.75, 2);
    // A null map is priced as empty, never thrown on.
    const empty = removeTier1Selection({ selectedCustomizations: null, groupId: GROUP, entity: FRIES });
    expect(getTotalValueWithApplyAddonPrice(empty, true)).toBe(0);
  });
});
