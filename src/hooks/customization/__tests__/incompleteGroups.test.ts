import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findFirstMinMaxViolation,
  validateVariantSelections,
  type FetchModifierProperties,
} from "@cx-sdk/ordering/customization/groupCompletion";
import {
  listMinMaxViolations,
  listVariantSelectionViolations,
} from "@cx-sdk/ordering/customization/incompleteGroups";

/*
  Item 23 (lane bag-pdp): the completion warning lists EVERY incomplete group
  by looping the commit's own first-failure scans — so it can never name a
  group the commit would accept, nor miss one it rejects. Parity is checked
  against the originals directly, on hand-written cases and on a seeded sweep
  of generated selection maps.
*/

type Group = {
  _id: string;
  name: string;
  min?: number;
  max?: number;
  multiplePunchMin?: number;
  multiplePunchMax?: number;
  isActive?: boolean;
};
type Pick = { id: string; quantity?: number };

const group = (id: string, min: number, max: number, extra: Partial<Group> = {}): Group => ({
  _id: id,
  name: id.replace(/_.*/, "").toUpperCase(),
  min,
  max,
  multiplePunchMin: min,
  multiplePunchMax: max + 1,
  isActive: true,
  ...extra,
});

const GROUPS: Record<string, Group> = {
  burrito_combo: group("burrito_combo", 1, 1),
  drink_combo: group("drink_combo", 1, 1),
  side_combo: group("side_combo", 1, 1),
  sauce_addons: group("sauce_addons", 0, 2),
  extra_addons: group("extra_addons", 1, 3),
  off_addons: group("off_addons", 1, 1, { isActive: false }),
};

/** The hook's resolver shape: ids in, fresh group objects out (holes for unknown ids). */
const fetchProps: FetchModifierProperties = (ids) =>
  ids.map((id) => (GROUPS[String(id)] ? { ...GROUPS[String(id)] } : undefined));

const pick = (id: string, quantity = 1): Pick => ({ id, quantity });

describe("incompleteGroups — the warning loops the commit's own scans (item 23)", () => {
  beforeEach(() => {
    // The SDK scans keep their legacy debug logs (fork byte-identity).
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("listMinMaxViolations ≡ findFirstMinMaxViolation, repeated", () => {
    const SELECTION = {
      burrito_combo: [pick("b")],
      drink_combo: [],
      sauce_addons: [pick("s"), pick("t"), pick("u")], // 3 > max 2
      side_combo: [],
      extra_addons: [pick("x", 2)],
    };

    it("the first element IS the first-failure scan; every violation follows in map order", () => {
      const list = listMinMaxViolations(SELECTION, fetchProps, false);
      expect(list[0]).toEqual(findFirstMinMaxViolation(SELECTION, fetchProps, false));
      expect(list).toEqual([
        { modifierID: "drink_combo", name: "DRINK" },
        { modifierID: "sauce_addons", name: "SAUCE" },
        { modifierID: "side_combo", name: "SIDE" },
      ]);
    });

    it("a complete map lists nothing — exactly when the commit passes", () => {
      const done = { burrito_combo: [pick("b")], drink_combo: [pick("d")], extra_addons: [pick("x")] };
      expect(findFirstMinMaxViolation(done, fetchProps, false)).toBeNull();
      expect(listMinMaxViolations(done, fetchProps, false)).toEqual([]);
    });

    it("multiple punch reads multiplePunchMin / Max, like the commit", () => {
      const three = { sauce_addons: [pick("s"), pick("t"), pick("u")] };
      expect(listMinMaxViolations(three, fetchProps, false)).toHaveLength(1);
      expect(findFirstMinMaxViolation(three, fetchProps, true)).toBeNull();
      expect(listMinMaxViolations(three, fetchProps, true)).toEqual([]);
    });

    it("inactive, unknown and nullish groups behave exactly like the original (it does not skip them)", () => {
      const odd = {
        off_addons: [], // inactive, min 1: the min/max scan does not skip inactive groups
        ghost_addons: [pick("g")], // unknown to the resolver: no min/max → fails
        drink_combo: null, // nullish list: NaN total → fails
        burrito_combo: [{ id: "b" }], // a missing quantity: NaN total → fails
      };
      const list = listMinMaxViolations(odd, fetchProps, false);
      expect(list[0]).toEqual(findFirstMinMaxViolation(odd, fetchProps, false));
      expect(list.map((v) => v.modifierID)).toEqual(["off_addons", "ghost_addons", "drink_combo", "burrito_combo"]);
      expect(list[1].name).toBeUndefined();
    });

    it("never mutates the selections; junk input lists nothing", () => {
      const before = JSON.stringify(SELECTION);
      listMinMaxViolations(SELECTION, fetchProps, false);
      expect(JSON.stringify(SELECTION)).toBe(before);
      for (const junk of [null, undefined, "x", 7]) {
        expect(listMinMaxViolations(junk, fetchProps, false)).toEqual([]);
      }
    });
  });

  describe("listVariantSelectionViolations ≡ validateVariantSelections, repeated", () => {
    const IDS = ["burrito_combo", "off_addons", "drink_combo", "sauce_addons", "side_combo", "drink_combo", "ghost_addons"];
    const MERGED = { burrito_combo: [pick("b")], sauce_addons: [pick("s"), pick("t"), pick("u")] };
    const input = (modifierIds: unknown[], mergedCustomizations: unknown, allowMultiplePunch = false) => ({
      modifierIds,
      mergedCustomizations,
      fetchModifierProperties: fetchProps,
      allowMultiplePunch,
    });

    it("the first element IS the original's errorModifierId; the rest follow in modifierIds order, each once", () => {
      const verdict = validateVariantSelections(input(IDS, MERGED));
      const list = listVariantSelectionViolations(input(IDS, MERGED));
      expect(verdict.allPassed).toBe(false);
      expect(list[0].modifierID).toBe(verdict.allPassed ? undefined : verdict.errorModifierId);
      expect(list).toEqual([
        { modifierID: "drink_combo", name: "DRINK" },
        { modifierID: "sauce_addons", name: "SAUCE" },
        { modifierID: "side_combo", name: "SIDE" },
      ]);
    });

    it("inactive and unknown groups pass, as in the original; a missing selection map fails every active group", () => {
      expect(validateVariantSelections(input(["off_addons", "ghost_addons"], {})).allPassed).toBe(true);
      expect(listVariantSelectionViolations(input(["off_addons", "ghost_addons"], {}))).toEqual([]);
      expect(listVariantSelectionViolations(input(["burrito_combo", "off_addons", "sauce_addons"], null))).toEqual([
        { modifierID: "burrito_combo", name: "BURRITO" },
        { modifierID: "sauce_addons", name: "SAUCE" },
      ]);
    });

    it("all passing → empty, exactly when the original passes", () => {
      const done = { burrito_combo: [pick("b")], drink_combo: [pick("d")] };
      expect(validateVariantSelections(input(["burrito_combo", "drink_combo", "off_addons"], done)).allPassed).toBe(true);
      expect(listVariantSelectionViolations(input(["burrito_combo", "drink_combo", "off_addons"], done))).toEqual([]);
      expect(listVariantSelectionViolations(input([], done))).toEqual([]);
    });

    it("never mutates its inputs", () => {
      const ids = [...IDS];
      const merged = JSON.stringify(MERGED);
      listVariantSelectionViolations(input(ids, MERGED));
      expect(ids).toEqual(IDS);
      expect(JSON.stringify(MERGED)).toBe(merged);
    });
  });

  describe("seeded sweep: the list is exactly the set of groups the original rejects, in order", () => {
    /** mulberry32 — deterministic, so a failure reproduces. */
    const rng = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const POOL = [...Object.keys(GROUPS), "ghost_addons"];

    const randomSelections = (next: () => number) => {
      const map: Record<string, unknown> = {};
      for (const id of POOL) {
        const roll = next();
        if (roll < 0.15) continue; // absent
        if (roll < 0.22) {
          map[id] = null;
          continue;
        }
        const count = Math.floor(next() * 4);
        map[id] = Array.from({ length: count }, (_, i) => pick(`${id}-${i}`, 1 + Math.floor(next() * 2)));
      }
      return map;
    };

    it("listMinMaxViolations over 300 generated maps", () => {
      const next = rng(20261007);
      for (let run = 0; run < 300; run += 1) {
        const map = randomSelections(next);
        const amp = next() < 0.5;
        const list = listMinMaxViolations(map, fetchProps, amp);
        const listed = list.map((v) => v.modifierID);
        expect(list[0] ?? null, `run ${run}`).toEqual(findFirstMinMaxViolation(map, fetchProps, amp));
        for (const id of Object.keys(map)) {
          const alone = findFirstMinMaxViolation({ [id]: map[id] }, fetchProps, amp);
          expect(listed.includes(id), `run ${run} ${id}`).toBe(alone !== null);
        }
        const order = listed.map((id) => Object.keys(map).indexOf(id));
        expect(order, `run ${run}`).toEqual([...order].sort((a, b) => a - b));
      }
    });

    it("listVariantSelectionViolations over 300 generated maps", () => {
      const next = rng(19);
      for (let run = 0; run < 300; run += 1) {
        const map = randomSelections(next);
        const ids = POOL.filter(() => next() < 0.8).concat(next() < 0.3 ? ["drink_combo"] : []);
        const amp = next() < 0.5;
        const verdict = validateVariantSelections({
          modifierIds: ids,
          mergedCustomizations: map,
          fetchModifierProperties: fetchProps,
          allowMultiplePunch: amp,
        });
        const list = listVariantSelectionViolations({
          modifierIds: ids,
          mergedCustomizations: map,
          fetchModifierProperties: fetchProps,
          allowMultiplePunch: amp,
        });
        const listed = list.map((v) => v.modifierID);
        expect(listed[0], `run ${run}`).toBe(verdict.allPassed ? undefined : verdict.errorModifierId);
        for (const id of new Set(ids)) {
          const alone = validateVariantSelections({
            modifierIds: [id],
            mergedCustomizations: map,
            fetchModifierProperties: fetchProps,
            allowMultiplePunch: amp,
          });
          expect(listed.includes(id), `run ${run} ${id}`).toBe(!alone.allPassed);
        }
        expect(new Set(listed).size, `run ${run}`).toBe(listed.length);
        const order = listed.map((id) => ids.indexOf(id));
        expect(order, `run ${run}`).toEqual([...order].sort((a, b) => a - b));
      }
    });
  });
});
