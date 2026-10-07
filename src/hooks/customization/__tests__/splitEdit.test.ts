import { describe, expect, it } from "vitest";
import {
  planSplitEditCommit,
  type SplitEditInput,
  type SplitEditPlan,
} from "@cx-sdk/ordering/cart/splitEdit";
import { buildCustomizableCommitPayload } from "@cx-sdk/ordering/customization/commitPayload";
import { getCalculatedBill } from "@cx-sdk/ordering/order/orderBuilder";

/*
  Item 20 money check: the bag's split edit ("choose how many you want to
  edit", Figma 1:4460) commits k of a row's N units as ONE planned cart write.
  Every row here is priced through the REAL bill engine at the end.
*/

const PICKLES = { id: "pickles", name: "Extra Pickles", price: 1, quantity: 1 };
const CHEESE = { id: "cheese", name: "Add Cheese", price: 1, quantity: 1 };

/** Paid CUSTOMIZABLE row: Cheese Burger + Extra Pickles × 3 (£9 a unit). */
const BURGER = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1",
  name: "Cheese Burger",
  type: "CUSTOMIZABLE",
  price: 8,
  quantity: 3,
  total_price: 9,
  customizations: { burger_addons: [PICKLES] },
  modifiers: ["burger_addons"],
};
const FRIES = { id: "fries", itemId: "fr-1", name: "Fries", type: "ITEM", price: 3, quantity: 1, total_price: 3 };
const COLA = { id: "cola", itemId: "co-1", name: "Cola", type: "ITEM", price: 2, quantity: 2, total_price: 2 };

/**
 * The PDP's real CUSTOMIZABLE commit payload for an edit: the tier-1 entity
 * is the bag row seeded at quantity k (BagSheet I6), so the payload's
 * quantity is the PDP stepper and its itemId is the source's.
 */
const editPayload = (
  customizations: Record<string, unknown[]>,
  stepperQuantity: number,
  row: Record<string, unknown> = BURGER,
) =>
  buildCustomizableCommitPayload({
    selectedEntity: { ...row, quantity: stepperQuantity },
    mergedCustomizations: customizations,
    quantity: 1,
    isMakeItAMealItem: false,
    makeItAMealSelectedItem: {},
  });

const plan = (overrides: Partial<SplitEditInput>): SplitEditPlan =>
  planSplitEditCommit({
    cartItems: [FRIES, BURGER, COLA],
    sourceItemId: "cb-1",
    editQuantity: 2,
    editedPayload: editPayload({ burger_addons: [PICKLES, CHEESE] }, 2),
    itemType: "CUSTOMIZABLE",
    currentSession: null,
    ...overrides,
  });

const rowsOf = (result: SplitEditPlan): Record<string, unknown>[] => {
  if (result.kind !== "split" && result.kind !== "merge") {
    throw new Error(`expected a cart write, got ${result.kind}`);
  }
  return result.nextCartItems as Record<string, unknown>[];
};

/** Sub Total through the real bill engine (no round-off, no charges, no offer). */
const subTotalOf = (cartItems: unknown[]): number => {
  const bill = getCalculatedBill(
    { cartItems, charges: [], cartOffer: {} },
    {
      tabId: "",
      deploymentInfo: [{ name: "disable_roundoff", selected: true }],
      discountOnAddon: false,
      cartRdx: { cartOffer: {} },
      getAmountBasedItemValue: () => 0,
      getImageUrl: () => "",
    }
  );
  return Number(bill.getSubtotal());
};

describe("planSplitEditCommit — item 20 split edit", () => {
  it("k = N (and beyond) is today's whole-row update: replace", () => {
    expect(plan({ editQuantity: 3 })).toEqual({ kind: "replace" });
    expect(plan({ editQuantity: 4 })).toEqual({ kind: "replace" });
  });

  it("split: the source keeps N − k, the edited units land RIGHT AFTER it with a fresh itemId", () => {
    const result = plan({});
    const rows = rowsOf(result);
    expect(result.kind).toBe("split");
    expect(rows.map((row) => row.id)).toEqual(["fries", "cheese-burger", "cheese-burger", "cola"]);
    expect(rows[0]).toBe(FRIES); // untouched rows ride along by reference
    expect(rows[3]).toBe(COLA);
    expect(rows[1]).toMatchObject({ itemId: "cb-1", quantity: 1, customizations: BURGER.customizations });
    const added = rows[2];
    expect(added).toMatchObject({ quantity: 2, type: "CUSTOMIZABLE", total_price: 10 });
    expect(added.itemId).not.toBe("cb-1");
    expect(String(added.itemId)).toMatch(/_cheese-burger$/);
    expect(added.uniqueItemId).toBe(added.itemId);
    expect(result.kind === "split" && result.addedRow).toBe(added);
    // Units are conserved: 1 + 2 = the 3 the guest had.
    expect(Number(rows[1].quantity) + Number(added.quantity)).toBe(3);
  });

  it("noop: the edit configures exactly the source at k units (pick order and empty groups do not count)", () => {
    const source = { ...BURGER, customizations: { burger_addons: [PICKLES, CHEESE] } };
    const payload = editPayload({ burger_addons: [CHEESE, PICKLES], sauce_addons: [] }, 2, source);
    expect(plan({ cartItems: [source], editedPayload: payload })).toEqual({ kind: "noop" });
  });

  it("merge: same configuration at a new stepper quantity q → the source becomes N − k + q", () => {
    const result = plan({ editedPayload: editPayload({ burger_addons: [PICKLES] }, 3) });
    const rows = rowsOf(result);
    expect(result.kind).toBe("merge");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ itemId: "cb-1", quantity: 3 - 2 + 3 });
  });

  it("the DP cap is checked on the cart WITH the shrunk source, and a breach writes nothing", () => {
    const session = { _extras: { maxQtyItem: "4" } };
    const dpBurger = { ...BURGER, isDpItem: true };
    const dpTaco = { id: "taco", itemId: "ta-1", type: "ITEM", price: 2, quantity: 1, isDpItem: true };
    const cartItems = [dpBurger, dpTaco]; // 3 + 1 = 4 DP units: AT the cap
    // Moving 2 units into a new configuration keeps 4 units: allowed (the
    // render-time cart check would have counted 4 + 2 and refused it).
    const allowed = plan({
      cartItems,
      editedPayload: editPayload({ burger_addons: [PICKLES, CHEESE] }, 2, dpBurger),
      currentSession: session,
    });
    expect(allowed.kind).toBe("split");
    // Raising the stepper to 3 would hold 1 + 1 + 3 = 5 > 4.
    expect(
      plan({
        cartItems,
        editedPayload: editPayload({ burger_addons: [PICKLES, CHEESE] }, 3, dpBurger),
        currentSession: session,
      })
    ).toEqual({ kind: "rejected", reason: "dpMax" });
    // The same breach through a merge is refused too.
    expect(
      plan({
        cartItems,
        editedPayload: editPayload({ burger_addons: [PICKLES] }, 3, dpBurger),
        currentSession: session,
      })
    ).toEqual({ kind: "rejected", reason: "dpMax" });
  });

  it("source missing (gone, or not a paid row) and a malformed k are refused without a write", () => {
    expect(plan({ sourceItemId: "gone" })).toEqual({ kind: "rejected", reason: "sourceMissing" });
    expect(plan({ cartItems: [{ ...BURGER, isLoyaltyItem: true }] })).toEqual({
      kind: "rejected",
      reason: "sourceMissing",
    });
    expect(plan({ cartItems: [{ ...BURGER, isGetItem: true }] })).toEqual({
      kind: "rejected",
      reason: "sourceMissing",
    });
    expect(plan({ cartItems: null })).toEqual({ kind: "rejected", reason: "sourceMissing" });
    expect(plan({ editQuantity: 0 })).toEqual({ kind: "rejected", reason: "invalidQuantity" });
    expect(plan({ editQuantity: 1.5 })).toEqual({ kind: "rejected", reason: "invalidQuantity" });
  });

  it("bill (CUSTOMIZABLE): 3× burger+pickles, edit 2 to add cheese → Sub Total 1×9 + 2×10 = 29", () => {
    expect(subTotalOf([BURGER])).toBeCloseTo(27, 2);
    expect(subTotalOf(rowsOf(plan({ cartItems: [BURGER] })))).toBeCloseTo(29, 2);
    // A merge to 4 units of the unchanged burger bills 4 × 9.
    expect(
      subTotalOf(rowsOf(plan({ cartItems: [BURGER], editedPayload: editPayload({ burger_addons: [PICKLES] }, 3) })))
    ).toBeCloseTo(36, 2);
  });

  it("bill (VARIANT): 3× Medium £4 + salsa £0.50, edit 2 to Large £5 → Sub Total 1×4.50 + 2×5.50 = 15.50", () => {
    const SALSA = { id: "salsa", name: "Salsa", price: 0.5, quantity: 1 };
    const variantRow = (variant: { id: string; price: number }, quantity: number, itemId: string) => ({
      id: "pepsi",
      itemId,
      uniqueItemId: itemId,
      name: "Pepsi",
      type: "VARIANT",
      price: 0,
      baseItemPrice: 0,
      selectedVariant: { id: variant.id, name: variant.id, price: variant.price },
      variantPrice: variant.price,
      total_price: variant.price + 0.5,
      customizations: { pepsi_addons: [SALSA] },
      quantity,
    });
    const MEDIUM = { id: "pepsi-m", price: 4 };
    const LARGE = { id: "pepsi-l", price: 5 };
    const source = variantRow(MEDIUM, 3, "pe-1");
    expect(subTotalOf([source])).toBeCloseTo(13.5, 2);

    const result = planSplitEditCommit({
      cartItems: [source],
      sourceItemId: "pe-1",
      editQuantity: 2,
      editedPayload: variantRow(LARGE, 2, "pe-1"),
      itemType: "VARIANT",
      currentSession: null,
    });
    const rows = rowsOf(result);
    expect(result.kind).toBe("split");
    expect(rows.map((row) => [row.type, (row.selectedVariant as { id: string }).id, row.quantity])).toEqual([
      ["VARIANT", "pepsi-m", 1],
      ["VARIANT", "pepsi-l", 2],
    ]);
    expect(subTotalOf(rows)).toBeCloseTo(15.5, 2);

    // Same size + same picks at q = k is a noop (nothing billed twice).
    expect(
      planSplitEditCommit({
        cartItems: [source],
        sourceItemId: "pe-1",
        editQuantity: 2,
        editedPayload: variantRow(MEDIUM, 2, "pe-1"),
        itemType: "VARIANT",
        currentSession: null,
      })
    ).toEqual({ kind: "noop" });
  });
});

/* ---- test-author additions (lane bag-pdp, item 20) ---- */

describe("planSplitEditCommit — MIAM rows, purity and edge inputs", () => {
  const MEAL = {
    ...BURGER,
    itemId: "meal-1",
    uniqueItemId: "meal-1",
    quantity: 2,
    isMakeItAMealItem: true,
    makeItAMealSelectedItem: { id: "cheese-burger", name: "Cheese Burger" },
  };

  it("a MIAM meal row splits like any CUSTOMIZABLE row: both rows keep the meal, units are conserved, the bill adds up", () => {
    const result = planSplitEditCommit({
      cartItems: [MEAL, FRIES],
      sourceItemId: "meal-1",
      editQuantity: 1,
      editedPayload: buildCustomizableCommitPayload({
        selectedEntity: { ...MEAL, quantity: 1 },
        mergedCustomizations: { burger_addons: [PICKLES, CHEESE] },
        quantity: 1,
        isMakeItAMealItem: true,
        makeItAMealSelectedItem: MEAL.makeItAMealSelectedItem,
      }),
      itemType: "CUSTOMIZABLE",
      currentSession: null,
    });
    const rows = rowsOf(result);
    expect(result.kind).toBe("split");
    expect(rows.map((row) => [row.itemId === "meal-1", row.quantity])).toEqual([
      [true, 1],
      [false, 1],
      [false, 1],
    ]);
    for (const row of rows.slice(0, 2)) {
      expect(row).toMatchObject({ isMakeItAMealItem: true, makeItAMealSelectedItem: MEAL.makeItAMealSelectedItem });
    }
    expect(rows[2]).toBe(FRIES);
    expect(subTotalOf(rows)).toBeCloseTo(9 + 10 + 3, 2);
  });

  it("never mutates the live cart it plans against", () => {
    const cartItems = [FRIES, { ...BURGER }, COLA];
    const before = JSON.stringify(cartItems);
    rowsOf(plan({ cartItems }));
    rowsOf(plan({ cartItems, editedPayload: editPayload({ burger_addons: [PICKLES] }, 3) }));
    expect(JSON.stringify(cartItems)).toBe(before);
  });

  it("an unreadable source quantity is today's whole-row update (replace), never NaN rows", () => {
    expect(plan({ cartItems: [{ ...BURGER, quantity: "lots" }] })).toEqual({ kind: "replace" });
    expect(plan({ cartItems: [{ ...BURGER, quantity: undefined }] })).toEqual({ kind: "replace" });
  });

  it("a stepper left at 0 counts as one unit (buildCartItemContent's own default)", () => {
    const result = plan({ editedPayload: { ...editPayload({ burger_addons: [PICKLES, CHEESE] }, 2), quantity: 0 } });
    const rows = rowsOf(result);
    expect(rows.map((row) => row.quantity)).toEqual([1, 1, 1, 2]);
  });
});

/* ---- mutation-verifier additions (lane bag-pdp, item 20): what counts as the SAME configuration ---- */

describe("planSplitEditCommit — the configuration key (noop / merge vs split)", () => {
  const MILD = { id: "mild", name: "Mild", price: 0, quantity: 1 };

  it("group order does not count: the same picks keyed in another order are the same item (noop at q = k)", () => {
    const source = { ...BURGER, customizations: { burger_addons: [PICKLES], sauce_addons: [MILD] } };
    const payload = editPayload({ sauce_addons: [MILD], burger_addons: [PICKLES] }, 2, source);
    expect(Object.keys(payload.customizations as object)).toEqual(["sauce_addons", "burger_addons"]); // precondition
    expect(plan({ cartItems: [source], editedPayload: payload })).toEqual({ kind: "noop" });
  });

  it("a pick with no quantity is one unit, as the bill reads it (mod.quantity || 1)", () => {
    const source = { ...BURGER, customizations: { burger_addons: [PICKLES] } };
    const picklesNoQuantity = { id: PICKLES.id, name: PICKLES.name, price: PICKLES.price };
    const payload = editPayload({ burger_addons: [picklesNoQuantity] }, 2, source);
    expect(plan({ cartItems: [source], editedPayload: payload })).toEqual({ kind: "noop" });
    expect(subTotalOf([{ ...source, customizations: payload.customizations }])).toBeCloseTo(subTotalOf([source]), 2);
  });

  it("nested (tier-2) picks count: changing only a slot pick's own pick splits — never a silent noop", () => {
    const SALT = { id: "no-salt", name: "Without Salt", price: 0.25, quantity: 1 };
    const fries = (picks: unknown[]) => ({
      id: "fries-l",
      name: "Large Fries",
      price: 0,
      quantity: 1,
      itemId: "t2-fries",
      customizations: { fries_addons: picks },
    });
    const box = {
      ...BURGER,
      id: "dream-box",
      itemId: "bx-1",
      uniqueItemId: "bx-1",
      name: "Dream Box",
      price: 25,
      total_price: 25.25,
      quantity: 2,
      customizations: { box_2_combo: [fries([SALT])] },
    };
    const edit = (picks: unknown[]) =>
      plan({ cartItems: [box], sourceItemId: "bx-1", editQuantity: 1, editedPayload: editPayload({ box_2_combo: [fries(picks)] }, 1, box) });

    const result = edit([]);
    expect(result.kind).toBe("split");
    const nestedPicks = (row: Record<string, unknown>) =>
      ((row.customizations as Record<string, { customizations: Record<string, unknown[]> }[]>).box_2_combo[0]
        .customizations.fries_addons).length;
    expect(rowsOf(result).map((row) => [row.quantity, nestedPicks(row)])).toEqual([
      [1, 1],
      [1, 0],
    ]);
    // The same nested pick at q = k IS the source.
    expect(edit([SALT])).toEqual({ kind: "noop" });
  });

  it("a stepper at 0 is one unit for noop and merge too (never a lost unit)", () => {
    const sameAtZero = (k: number) =>
      plan({ editQuantity: k, editedPayload: { ...editPayload({ burger_addons: [PICKLES] }, 2), quantity: 0 } });
    expect(sameAtZero(1)).toEqual({ kind: "noop" });
    expect(rowsOf(sameAtZero(2)).map((row) => [row.itemId, row.quantity])).toEqual([
      ["fr-1", 1],
      ["cb-1", 3 - 2 + 1],
      ["co-1", 2],
    ]);
  });
});
