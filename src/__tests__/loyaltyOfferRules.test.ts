import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBillLoyaltyDiscount,
  getBillOfferDiscount,
  isOfferLockedByLoyaltyReward,
} from "@cx-sdk/ordering/loyalty/loyaltyOfferRules";
import { getCalculatedBill } from "@cx-sdk/ordering/order/orderBuilder";

/*
  Lane loyalty-visual — the SDK's XENO reward ↔ CX offer rules
  (packages/ordering/src/loyalty/loyaltyOfferRules.ts), tested here because
  the SDK has no runner (cf. splashMedia.test.ts). Pure and TOTAL: the cart
  slice and the legacy bill object are untyped, so junk must answer, never
  throw.
   - D3: isOfferLockedByLoyaltyReward — a reward row locks offers while none
     is applied (fork CartRewardsCard blockedByLoyalty, XENO leg).
   - F1: getBillLoyaltyDiscount / getBillOfferDiscount — split
     bill.getTotalDiscount() into the reward's share (orderBuilder's
     "Loyalty Item" item discounts) and the applied offer's own saving.
*/

/** Paid row — £8. */
const BURGER = {
  id: "burger",
  itemId: "b-1",
  name: "Burger",
  quantity: 1,
  type: "ITEM",
  price: 8,
  total_price: 8,
  customizations: {},
};

/** Redeemed 100 % XENO reward (redeemItem + addLoyaltyItemToCart shape), £17 + a £1.50 add-on. */
const REWARD = {
  id: "greek-salad",
  itemId: "lr-1",
  name: "Greek Salad",
  quantity: 1,
  type: "ITEM",
  isLoyaltyItem: true,
  isRedeemed: true,
  coupon_code: "static6562",
  discount_type: "percentage",
  discount_value: 100,
  price: 0,
  total_price: 0,
  undiscounted_price: 17,
  undiscounted_total_price: 18.5,
  customizations: { dip_addon: [{ id: "dip", name: "Dip", price: 1.5, quantity: 1 }] },
};

const APPLIED_OFFER = { _id: "offer-flat-2", name: "£2 off your order" };

describe("isOfferLockedByLoyaltyReward (D3 — fork parity, XENO leg)", () => {
  it.each([
    ["no rows", [], {}],
    ["cartItems undefined", undefined, {}],
    ["cartItems null", null, {}],
    ["cartItems an object holding a reward", { 0: REWARD }, {}],
    ["cartItems a string", "isLoyaltyItem", {}],
    ["paid rows only", [BURGER], {}],
    ["a falsy isLoyaltyItem", [BURGER, { ...REWARD, isLoyaltyItem: false }], {}],
    ["junk rows only", [null, 0, "x", []], undefined],
  ])("%s → not locked", (_label, cartItems, cartOffer) => {
    expect(isOfferLockedByLoyaltyReward(cartItems, cartOffer)).toBe(false);
  });

  it.each([
    ["a loyalty row only", [REWARD]],
    ["a loyalty row beside paid rows", [BURGER, REWARD]],
    ["an OUT-OF-STOCK loyalty row (still in the bag)", [BURGER, { ...REWARD, outOfStock: true }]],
    ["a loyalty row among junk rows", [null, 1, REWARD]],
  ])("%s and no offer → locked", (_label, cartItems) => {
    expect(isOfferLockedByLoyaltyReward(cartItems, {})).toBe(true);
  });

  it.each([
    ["{}", {}],
    ["null", null],
    ["undefined", undefined],
    ["[] (no keys)", []],
    ["a string", "offer-flat-2"],
  ])("an empty slot (%s) counts as no offer → locked", (_label, cartOffer) => {
    expect(isOfferLockedByLoyaltyReward([BURGER, REWARD], cartOffer)).toBe(true);
  });

  it.each([
    ["an applied offer", APPLIED_OFFER],
    ["a loyalty-owned slot", { _id: "loyalty-redeem", name: "Loyalty offer" }],
  ])("%s → NOT locked (an offer applied before the reward stays — the fork's asymmetry)", (_label, cartOffer) => {
    expect(isOfferLockedByLoyaltyReward([BURGER, REWARD], cartOffer)).toBe(false);
  });

  it("a row whose getter throws answers false, never throws", () => {
    const hostile = Object.defineProperty({}, "isLoyaltyItem", {
      get() {
        throw new Error("unreadable row");
      },
    });
    expect(isOfferLockedByLoyaltyReward([hostile, REWARD], {})).toBe(false);
  });
});

/** A billCalculation-shaped line (only the fields getTotalDiscount reads). */
const loyalty = (type: string, amounts: { discountAmount?: unknown; value?: unknown }) => ({
  type,
  comment: "Loyalty Item",
  ...amounts,
});

/** orderBuilder's engine rounding, borrowed from a real bill. */
const realRound = (): ((value: number, decimals: unknown) => number) =>
  (
    getCalculatedBill(
      { cartItems: [BURGER], charges: [], cartOffer: {} },
      {
        tabId: "t1",
        deploymentInfo: [],
        discountOnAddon: false,
        cartRdx: {},
        getAmountBasedItemValue: () => 0,
        getImageUrl: () => "",
      }
    ) as { roundNumber: (value: number, decimals: unknown) => number }
  ).roundNumber;

describe("getBillLoyaltyDiscount (F1 — the XENO reward's share of the bill)", () => {
  it("a percentage item discount counts its discountAmount, never its value", () => {
    const bill = {
      decimal_places: 2,
      _items: [
        { discounts: [loyalty("percentage", { value: 100, discountAmount: 17 })], isDiscounted: true },
      ],
    };
    expect(getBillLoyaltyDiscount(bill)).toBe(17);
  });

  it("a fixed item discount counts its value, never a discountAmount", () => {
    const bill = {
      decimal_places: 2,
      _items: [{ discounts: [loyalty("fixed", { value: "3.25", discountAmount: 99 })], isDiscounted: true }],
    };
    expect(getBillLoyaltyDiscount(bill)).toBe(3.25);
  });

  it("add-ons: a percentage discount counts, a fixed one does not (engine parity)", () => {
    const bill = {
      decimal_places: 2,
      _items: [
        {
          discounts: [loyalty("percentage", { discountAmount: 17 })],
          isDiscounted: true,
          addOns: [
            { discounts: [loyalty("percentage", { discountAmount: "1.5" })] },
            { discounts: [loyalty("fixed", { value: 5, discountAmount: 5 })] },
          ],
        },
      ],
    };
    expect(getBillLoyaltyDiscount(bill)).toBe(18.5);
  });

  it("a line that is not discounted (isDiscounted false, or either OWN key missing) counts nothing — add-ons included", () => {
    const discounts = [loyalty("percentage", { discountAmount: 4 })];
    const addOns = [{ discounts: [loyalty("percentage", { discountAmount: 1 })] }];
    const bill = {
      decimal_places: 2,
      _items: [
        { discounts, isDiscounted: false, addOns },
        { discounts, addOns },
        { isDiscounted: true, addOns },
        Object.assign(Object.create({ discounts, isDiscounted: true }), { addOns }),
        { discounts: [loyalty("percentage", { discountAmount: 2 })], isDiscounted: true },
      ],
    };
    expect(getBillLoyaltyDiscount(bill)).toBe(2);
  });

  it("offer, get-item (comment ''), least-value and bill-wise discounts are not the reward's", () => {
    const bill = {
      decimal_places: 2,
      billDiscountAmount: 5,
      _items: [
        {
          isDiscounted: true,
          discounts: [
            { type: "percentage", discountAmount: 2, comment: "" }, // get-item / least-value
            { type: "fixed", value: 1, comment: "" },
            { type: "percentage", discountAmount: 3, comment: "Offer" },
            { type: "percentage", discountAmount: 4, comment: "loyalty item" }, // marker is exact
            loyalty("percentage", { discountAmount: 6 }),
          ],
          addOns: [{ discounts: [{ type: "percentage", discountAmount: 7, comment: "" }] }],
        },
      ],
    };
    expect(getBillLoyaltyDiscount(bill)).toBe(6);
  });

  it("rounds through the bill's own roundNumber with ITS decimal_places", () => {
    const roundNumber = vi.fn((value: number, decimals: unknown) => Math.floor(value * 10 ** Number(decimals)) / 10 ** Number(decimals));
    const bill = {
      decimal_places: 1,
      roundNumber,
      _items: [{ discounts: [loyalty("fixed", { value: 3.37 })], isDiscounted: true }],
    };
    expect(getBillLoyaltyDiscount(bill)).toBe(3.3);
    expect(roundNumber).toHaveBeenCalledWith(3.37, 1);
  });

  it.each([
    [undefined, 3], // the engine: undefined decimal_places ⇒ whole units
    [0, 3],
    [2, 3.33],
    [3, 3.333],
  ])("the engine's roundNumber with decimal_places %s → %s", (decimals, expected) => {
    const bill = {
      decimal_places: decimals,
      roundNumber: realRound(),
      _items: [{ discounts: [loyalty("fixed", { value: 3.3333 })], isDiscounted: true }],
    };
    expect(getBillLoyaltyDiscount(bill)).toBe(expected);
  });

  it("no roundNumber → the 2-dp fallback", () => {
    const bill = {
      _items: [
        {
          discounts: [loyalty("fixed", { value: 3.333 }), loyalty("percentage", { discountAmount: 0.004 })],
          isDiscounted: true,
        },
      ],
    };
    expect(getBillLoyaltyDiscount(bill)).toBe(3.34);
  });

  it("non-numeric amounts count 0 (never NaN the bag)", () => {
    const bill = {
      decimal_places: 2,
      _items: [
        {
          discounts: [loyalty("percentage", { discountAmount: "n/a" }), loyalty("fixed", {}), loyalty("percentage", { discountAmount: 2 })],
          isDiscounted: true,
        },
      ],
    };
    expect(getBillLoyaltyDiscount(bill)).toBe(2);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["{} (the bag's empty bill)", {}],
    ["a number", 7],
    ["missing _items", { decimal_places: 2, getTotalDiscount: () => 5 }],
    ["_items an object", { _items: { 0: { discounts: [loyalty("fixed", { value: 3 })], isDiscounted: true } } }],
    ["junk lines", { _items: [null, 1, "x", { discounts: null, isDiscounted: true }, { discounts: {}, isDiscounted: true }] }],
    [
      "a throwing _items getter",
      Object.defineProperty({}, "_items", {
        get() {
          throw new Error("unreadable bill");
        },
      }),
    ],
    [
      "a throwing discounts getter",
      {
        _items: [
          Object.defineProperty({ isDiscounted: true }, "discounts", {
            enumerable: true,
            get() {
              throw new Error("unreadable line");
            },
          }),
        ],
      },
    ],
  ])("%s → 0", (_label, bill) => {
    expect(getBillLoyaltyDiscount(bill)).toBe(0);
  });
});

describe("getBillOfferDiscount (F1 — what the applied offer itself saves)", () => {
  const hand = (total: unknown, rewardShare: number) => ({
    decimal_places: 2,
    roundNumber: realRound(),
    getTotalDiscount: () => total,
    _items: [{ discounts: [loyalty("fixed", { value: rewardShare })], isDiscounted: true }],
  });

  it("is the bill's total discount minus the reward's share", () => {
    expect(getBillOfferDiscount(hand(19, 17))).toBe(2);
    expect(getBillOfferDiscount(hand("19", 17))).toBe(2);
  });

  it("is rounded like the engine (no float residue on the bag row)", () => {
    // 7.1 − 4.58 = 2.5199999999999996 in floating point.
    expect(getBillOfferDiscount(hand(7.1, 4.58))).toBe(2.52);
  });

  it("is clamped at 0 when the reward's share exceeds the total", () => {
    expect(getBillOfferDiscount(hand(16, 17))).toBe(0);
  });

  it("with no reward it is the whole total", () => {
    expect(getBillOfferDiscount(hand(2.5, 0))).toBe(2.5);
  });

  it("an engine rounding that answers NaN (a non-integer decimal_places) never reaches the bag: both shares are 0", () => {
    const bill = { ...hand(19, 17), decimal_places: 2.5 };
    expect(bill.roundNumber(17, 2.5)).toBeNaN(); // the engine's own answer
    expect(getBillLoyaltyDiscount(bill)).toBe(0);
    expect(getBillOfferDiscount(bill)).toBe(0);
  });

  it.each([
    ["null", null],
    ["{} (the bag's empty bill)", {}],
    ["no getTotalDiscount", { _items: [] }],
    ["a NaN total", hand(Number.NaN, 0)],
    ["a non-numeric total", hand("n/a", 0)],
    [
      "a throwing getTotalDiscount",
      {
        getTotalDiscount: () => {
          throw new Error("bill engine failed");
        },
      },
    ],
  ])("%s → 0", (_label, bill) => {
    expect(getBillOfferDiscount(bill)).toBe(0);
  });
});

/*
  GOLDEN — through the REAL engine (the getCalculatedBill path BagSheet takes,
  orderBuilder → billCalculation): the reward's share is its undiscounted
  line, and the offer's share is exactly what the same bill computes with no
  reward in it (a bill-wise offer's base already excludes the £0 reward line).
*/
describe("golden: a 100 % XENO reward beside an applied offer, through getCalculatedBill", () => {
  const PERCENT_BILL_WISE = {
    _id: "offer-pct-10",
    name: "10% off your order",
    type: { name: "percent", value: 10 },
    minBillAmount: null,
    maxDiscount: null,
    minItemCount: null,
    applicable: { on: "complete", categories: [], items: [], isExclude: false, isInclude: false, rawItems: [] },
  };
  const ITEM_WISE = { ...PERCENT_BILL_WISE, _id: "offer-free-sauce", name: "Free sauce", type: { name: "item", value: 0 } };
  /** The committed freebie row ITEM_WISE grants (redeemGetItem stamps). */
  const FREEBIE = {
    id: "sauce",
    itemId: "g-1",
    name: "Tortilla Sauce",
    quantity: 1,
    type: "ITEM",
    price: 2,
    total_price: 0,
    isGetItem: true,
    discountType: "percent",
    discountValue: 100,
    customizations: {},
  };

  const billOf = (cartItems: unknown[], cartOffer: object) => {
    const cart = { cartItems, cartOffer, charges: [] };
    return getCalculatedBill(cart, {
      tabId: "t1",
      deploymentInfo: [],
      discountOnAddon: false,
      cartRdx: cart,
      getAmountBasedItemValue: () => 0,
      getImageUrl: () => "",
    }) as { getTotalDiscount: () => number };
  };

  beforeEach(() => {
    // billCalculation logs every bill-wise offer it prices.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["a bill-wise 10 % offer", [BURGER, REWARD], [BURGER], PERCENT_BILL_WISE, 0.8],
    ["an item-wise freebie offer", [BURGER, REWARD, FREEBIE], [BURGER, FREEBIE], ITEM_WISE, 2],
  ])("%s: reward share = its undiscounted line, offer share = the same bill without the reward", (_label, rows, rowsWithoutReward, offer, offerShare) => {
    const bill = billOf(rows, offer);
    const withoutReward = billOf(rowsWithoutReward, offer);

    expect(getBillLoyaltyDiscount(bill)).toBe(REWARD.undiscounted_total_price);
    expect(getBillOfferDiscount(bill)).toBe(withoutReward.getTotalDiscount());
    expect(getBillOfferDiscount(bill)).toBe(offerShare);
    // The two shares are the bill's whole discount (the Discounts line).
    expect(getBillLoyaltyDiscount(bill) + getBillOfferDiscount(bill)).toBeCloseTo(bill.getTotalDiscount(), 10);
    // No reward: the offer owns the whole discount.
    expect(getBillLoyaltyDiscount(withoutReward)).toBe(0);
  });

  it("a reward alone: its share is the whole discount and the offer's is 0", () => {
    const bill = billOf([BURGER, REWARD], {});
    expect(bill.getTotalDiscount()).toBe(18.5);
    expect(getBillLoyaltyDiscount(bill)).toBe(18.5);
    expect(getBillOfferDiscount(bill)).toBe(0);
  });
});
