import { describe, expect, it } from "vitest";
import { wouldExceedGroupMax } from "@cx-sdk/ordering/customization/groupMaxGuard";

/*
  audit-fixes UB2 — the SDK's group-max guard (packages/ordering/src/
  customization/groupMaxGuard.ts), tested here: the SDK has no runner (H09).
  It counts QUANTITIES like the commit's min/max scan (the engines' add
  branches count rows — the Dream box Snacks 0/2 stepper group reached 4
  units), lets the engines' swap / remove / toggle through, and fails open.
*/

const options = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `o${i + 1}`, name: `Option ${i + 1}`, price: 0 }));
const group = (bounds: Record<string, unknown>, n = 3) => ({
  _id: "g",
  name: "Group",
  isActive: true,
  constituentItems: options(n),
  ...bounds,
});
const pick = (id: string, quantity = 1) => ({ id, name: id, quantity });
const [A, B] = options(2);

type Kind = "tap" | "increase";
const guard = (
  modifier: unknown,
  customizations: unknown,
  item: unknown,
  kind: Kind,
  allowMultiplePunch = false,
) => wouldExceedGroupMax({ customizations, modifier, item, allowMultiplePunch, kind });

const ONE_OF_ONE = group({ min: 1, max: 1, multiplePunchMin: 0, multiplePunchMax: 6, multiplePunchMaxItem: 1 });
const UP_TO_TWO = group({ min: 0, max: 2, multiplePunchMin: 0, multiplePunchMax: 4, multiplePunchMaxItem: 2 });

describe("wouldExceedGroupMax — taps", () => {
  it("a new pick in a 1/1 group with 2+ options is the engines' swap → allowed", () => {
    expect(guard(ONE_OF_ONE, { g: [pick("o1")] }, B, "tap")).toBe(false);
    expect(guard(ONE_OF_ONE, { g: [] }, A, "tap")).toBe(false);
  });

  it("a 1/1 group with ONE option, empty → allowed (count 0)", () => {
    expect(guard(group({ min: 1, max: 1 }, 1), { g: [] }, A, "tap")).toBe(false);
  });

  it("a 0/2 group holding A×2: a tap on B is refused, a tap on A (removes / decrements) is not", () => {
    const held = { g: [pick("o1", 2)] };
    expect(guard(UP_TO_TWO, held, B, "tap")).toBe(true);
    expect(guard(UP_TO_TWO, held, A, "tap")).toBe(false);
  });

  it("counts QUANTITIES, not rows: A×1 + B×1 in a 0/2 group refuses a third option", () => {
    expect(guard(UP_TO_TWO, { g: [pick("o1"), pick("o2")] }, options(3)[2], "tap")).toBe(true);
    expect(guard(UP_TO_TWO, { g: [pick("o1")] }, B, "tap")).toBe(false);
  });

  it("a 0/0 (toggle) group is never refused", () => {
    expect(guard(group({ min: 0, max: 0 }), { g: [pick("o1"), pick("o2")] }, options(3)[2], "tap")).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ['"x"', "x"],
    ["-1", -1],
    ["null", null],
  ])("a max of %s fails open", (_label, max) => {
    expect(guard(group({ min: 0, max }), { g: [pick("o1", 9)] }, B, "tap")).toBe(false);
    expect(guard(group({ min: 0, max }), { g: [pick("o1", 9)] }, A, "increase")).toBe(false);
  });

  it('string bounds "1" / "1" holding one pick: a new pick is refused (the engines do not swap strings)', () => {
    expect(guard(group({ min: "1", max: "1" }), { g: [pick("o1")] }, B, "tap")).toBe(true);
  });

  it("a missing group key, a null map or junk rows never throw — count 0", () => {
    expect(guard(UP_TO_TWO, {}, A, "tap")).toBe(false);
    expect(guard(UP_TO_TWO, null, A, "tap")).toBe(false);
    expect(guard(UP_TO_TWO, undefined, A, "increase")).toBe(false);
    expect(guard(UP_TO_TWO, { g: { not: "a list" } }, A, "tap")).toBe(false);
    expect(guard(UP_TO_TWO, { g: [null, pick("o1")] }, B, "tap")).toBe(false);
    expect(guard(null, { g: [] }, A, "tap")).toBe(false);
    expect(guard(UP_TO_TWO, { g: [] }, null, "tap")).toBe(false);
  });
});

describe("wouldExceedGroupMax — the stepper '+' on a pick", () => {
  it("a 1/1 group, picked → refused (no stepper may take it to 2)", () => {
    expect(guard(ONE_OF_ONE, { g: [pick("o1")] }, A, "increase")).toBe(true);
  });

  it("a 0/2 group at A×1 → allowed; at A×2 → refused", () => {
    expect(guard(UP_TO_TWO, { g: [pick("o1")] }, A, "increase")).toBe(false);
    expect(guard(UP_TO_TWO, { g: [pick("o1", 2)] }, A, "increase")).toBe(true);
  });
});

describe("wouldExceedGroupMax — multi-punch reads the multi-punch bounds", () => {
  it("1/1 with mp 0/6: five picks → the 6th is allowed, six picks → the 7th is refused", () => {
    const five = { g: options(5).map((option) => pick(option.id)) };
    const six = { g: options(6).map((option) => pick(option.id)) };
    const seventh = { id: "o7", name: "Option 7" };
    expect(guard(group({ min: 1, max: 1, multiplePunchMin: 0, multiplePunchMax: 6 }, 7), five, { id: "o6" }, "tap", true)).toBe(false);
    expect(guard(group({ min: 1, max: 1, multiplePunchMin: 0, multiplePunchMax: 6 }, 7), six, seventh, "tap", true)).toBe(true);
    // Multi-punch OFF, the same group is the 1/1 swap again.
    expect(guard(group({ min: 1, max: 1, multiplePunchMin: 0, multiplePunchMax: 6 }, 7), six, seventh, "tap", false)).toBe(false);
  });

  it("mp 0/1 holding one pick refuses a second (the S3 shape)", () => {
    const mp01 = group({ min: 1, max: 1, multiplePunchMin: 0, multiplePunchMax: 1 });
    expect(guard(mp01, { g: [pick("o1")] }, B, "tap", true)).toBe(true);
  });
});
