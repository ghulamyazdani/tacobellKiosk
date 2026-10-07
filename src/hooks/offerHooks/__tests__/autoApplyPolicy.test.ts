/**
 * SDK @cx-sdk/ordering/offer/autoApplyPolicy, run from the TB tree (lane
 * "offers", item 34). The machine may only ever apply a cart-neutral, exact,
 * eligible offer the session has not vetoed — and the session vetoes must
 * short-circuit BEFORE the netAfter bill probe runs.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CART_NEUTRAL_MECHANICS,
  pickSessionAutoApplyOffer,
  type SessionAutoApplyInput,
} from "@cx-sdk/ordering/offer/autoApplyPolicy";
import {
  rankOffers,
  type SavingsContext,
  type SavingsOffer,
} from "@cx-sdk/ordering/offer/offerSavings";
import type {
  OfferMechanicKind,
  RankedOffer,
  SavingCertainty,
} from "@cx-sdk/core/types/offer";

const asOffer = (fixture: object): SavingsOffer =>
  fixture as unknown as SavingsOffer;

interface EntryOptions {
  amount?: number;
  certainty?: SavingCertainty;
  requiresChoice?: boolean;
  eligible?: boolean;
  autoApplied?: boolean;
}

/** A ranked entry built by hand, so each veto is isolated. */
const entry = (
  id: string,
  kind: OfferMechanicKind,
  {
    amount = 2,
    certainty = "exact",
    requiresChoice = false,
    eligible = true,
    autoApplied = true,
  }: EntryOptions = {}
): RankedOffer<SavingsOffer> => ({
  offer: asOffer({ _id: id, name: id, autoApplied }),
  saving: { amount, certainty, kind, requiresChoice },
  eligible,
});

const input = (
  over: Partial<SessionAutoApplyInput> = {}
): SessionAutoApplyInput & { netAfterFor: ReturnType<typeof vi.fn> } => ({
  ranked: [entry("flat-flagged", "amountComplete")],
  scope: "operatorFlagged",
  slotOccupied: false,
  loyaltyOwnsSlot: false,
  customerOverrode: false,
  blocked: false,
  netAfterFor: vi.fn(() => 6),
  ...over,
}) as SessionAutoApplyInput & { netAfterFor: ReturnType<typeof vi.fn> };

const pickedId = (over: Partial<SessionAutoApplyInput> = {}) =>
  pickSessionAutoApplyOffer(input(over))?._id ?? null;

/* Real-engine fixtures (rankOffers), converter-shaped. */
const base = {
  isAvailable: true,
  isComplimentary: false,
  autoApplied: false,
  sameOrLess: false,
  getItemOnly: false,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  minBillAmount: null,
  minItemCount: null,
  maxDiscount: null,
  isAndOffer: true,
  applicable: { on: "complete", isExclude: false, isInclude: false, rawItems: [] as unknown[] },
  getItems: {},
};
const flatOffer = (id: string, value: number, autoApplied: boolean) =>
  asOffer({ ...base, _id: id, name: `£${value} off`, type: { name: "amount", value }, autoApplied });
const CTX: SavingsContext = {
  cartItems: [{ id: "burger", itemId: "b-1", quantity: 1, type: "ITEM", price: 8 }],
  cartValue: 8,
  cartQuantity: 1,
};

describe("pickSessionAutoApplyOffer — scope", () => {
  it("the cart-neutral set is exactly the five mechanics that add no rows", () => {
    expect([...CART_NEUTRAL_MECHANICS].sort()).toEqual(
      ["amountComplete", "amountItems", "leastValue", "percentComplete", "percentItems"].sort()
    );
  });

  it("scope 'off' → null, without a bill probe", () => {
    const args = input({ scope: "off" });
    expect(pickSessionAutoApplyOffer(args)).toBeNull();
    expect(args.netAfterFor).not.toHaveBeenCalled();
  });

  it("scope 'operatorFlagged' → only autoApplied:true offers are candidates", () => {
    const ranked = [
      entry("pct-unflagged", "percentComplete", { amount: 5, autoApplied: false }),
      entry("flat-flagged", "amountComplete", { amount: 2 }),
    ];
    expect(pickedId({ ranked })).toBe("flat-flagged");
    expect(pickedId({ ranked: [ranked[0]] })).toBeNull();
  });

  it("scope 'all' → the best-ranked cart-neutral offer, flagged or not", () => {
    const ranked = [
      entry("bogo-flagged", "bogo", { amount: 17 }),
      entry("pct-unflagged", "percentComplete", { amount: 5, autoApplied: false }),
      entry("flat-flagged", "amountComplete", { amount: 2 }),
    ];
    expect(pickedId({ ranked, scope: "all" })).toBe("pct-unflagged");
  });
});

describe("pickSessionAutoApplyOffer — session vetoes run BEFORE the netAfter probe", () => {
  it.each([
    ["slotOccupied (never replaces anything)", { slotOccupied: true }],
    ["loyaltyOwnsSlot", { loyaltyOwnsSlot: true }],
    ["customerOverrode (the session latch)", { customerOverrode: true }],
    ["blocked (a sheet, picker, buy stage or notice is open)", { blocked: true }],
  ])("%s → null, netAfterFor never called", (_label, over) => {
    const args = input({ ...over, scope: "all" });
    expect(pickSessionAutoApplyOffer(args)).toBeNull();
    expect(args.netAfterFor).not.toHaveBeenCalled();
  });
});

describe("pickSessionAutoApplyOffer — the machine never adds food", () => {
  it.each(["freeItem", "bogo", "groupWise"] as const)(
    "%s is never picked, flagged and exact, in either scope",
    (kind) => {
      const ranked = [entry(`${kind}-flagged`, kind, { amount: 17 })];
      expect(pickedId({ ranked })).toBeNull();
      expect(pickedId({ ranked, scope: "all" })).toBeNull();
    }
  );

  it("a flagged EXACT single 'and' freebie (canAutoApply alone would accept it) is not picked", () => {
    const freeSalad = asOffer({
      ...base,
      _id: "free-salad-flagged",
      type: { name: "item", value: 0 },
      getItemOnly: true,
      autoApplied: true,
      getItems: {
        items: [
          {
            _id: "gi-salad",
            baseItemId: "greek-salad",
            relation: "and",
            discountType: "percent",
            value: 100,
            quantity: 1,
            entities: { id: "greek-salad", price: 17, discounted_total_price: 0, type: "ITEM" },
          },
        ],
      },
    });
    const ranked = rankOffers([freeSalad], CTX);
    expect(ranked[0].saving).toMatchObject({ kind: "freeItem", certainty: "exact", requiresChoice: false, amount: 17 });
    expect(ranked[0].eligible).toBe(true);
    const args = input({ ranked, scope: "all" });
    expect(pickSessionAutoApplyOffer(args)).toBeNull();
    expect(args.netAfterFor).not.toHaveBeenCalled();
  });
});

describe("pickSessionAutoApplyOffer — money vetoes", () => {
  it.each([0, -1])("netAfter %s (a zero bill) → not picked", (net) => {
    expect(pickedId({ netAfterFor: vi.fn(() => net) })).toBeNull();
  });

  it("amount 0 → not picked: a flagged ITEM offer with empty getItems (backend auto-applied shape) and a £0 cart-neutral offer", () => {
    const autoItem = asOffer({
      ...base,
      _id: "auto-item-empty",
      type: { name: "item", value: 0 },
      getItemOnly: true,
      autoApplied: true,
      getItems: {},
    });
    const zeroFlat = flatOffer("zero-flat", 0, true);
    const ranked = rankOffers([autoItem, zeroFlat], CTX);
    expect(ranked.every((e) => e.saving.amount === 0)).toBe(true);
    expect(pickedId({ ranked, scope: "all" })).toBeNull();
  });

  it("upTo certainty → not picked", () => {
    expect(pickedId({ ranked: [entry("pct-items", "percentItems", { certainty: "upTo" })] })).toBeNull();
  });

  it("eligible:false (locked) → not picked", () => {
    expect(pickedId({ ranked: [entry("flat-locked", "amountComplete", { eligible: false })] })).toBeNull();
  });
});

describe("pickSessionAutoApplyOffer — deterministic", () => {
  it("the first eligible entry in rank order wins; repeated calls agree", () => {
    const ranked = [
      entry("locked", "amountComplete", { eligible: false, amount: 9 }),
      entry("up-to", "percentItems", { certainty: "upTo", amount: 8 }),
      entry("first-ok", "amountComplete", { amount: 3 }),
      entry("second-ok", "percentComplete", { amount: 2 }),
    ];
    expect(pickedId({ ranked })).toBe("first-ok");
    expect(pickedId({ ranked })).toBe("first-ok");
    expect(pickedId({ ranked: [ranked[3], ranked[2]] })).toBe("second-ok");
  });

  it("through rankOffers: equal savings break ties on _id, whatever the input order", () => {
    const a = flatOffer("auto-a", 2, true);
    const b = flatOffer("auto-b", 2, true);
    expect(pickedId({ ranked: rankOffers([b, a], CTX) })).toBe("auto-a");
    expect(pickedId({ ranked: rankOffers([a, b], CTX) })).toBe("auto-a");
  });
});
