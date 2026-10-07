import { beforeEach, describe, expect, it, vi } from "vitest";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  removeClaimedCoupon,
  setClaimedCoupon,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../../redux/app/store";
import {
  claimRidingInCart,
  markClaimOrderOutcomeUnknown,
  unmarkClaimOrderOutcomeUnknown,
} from "../orderOutcomeClaim";

/*
  S7 (P9d; P8b-11) — the claim mark that stops /start refunding a Xeno reward
  whose order may exist. One helper for both money paths (the COD push and
  Paytm). Real store: the helpers read it fresh through getState.
*/

const CLAIMED = {
  couponCode: "static6562",
  claimedPoints: 3000,
  availedCouponCode: "static6562",
  datetime: "2026-09-30%2010%3A00%3A00",
  phoneNumber: "9953833675",
  merchantId: "xeno-merchant-uuid-1",
};
const PAID_ROW = { id: "cw", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 5 };
const REWARD_ROW = { id: "r", itemId: "lr-1", name: "Salad", quantity: 1, type: "ITEM", isLoyaltyItem: true, total_price: 0 };
/** Non-PII reconciliation ids — never the phone or the merchant id. */
const IDS = { reward_id: "static6562", claim_datetime: CLAIMED.datetime, points: 3000 };

const getState = () => store.getState();
const dispatch = store.dispatch;
const claim = () =>
  (store.getState() as unknown as {
    loyalty: { claimedCoupon: { isClaimed: boolean; couponData: Record<string, unknown> } };
  }).loyalty.claimedCoupon;
const riding = () => {
  store.dispatch(setClaimedCoupon(CLAIMED));
  store.dispatch(setCartItems([PAID_ROW, REWARD_ROW]));
};

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
});

describe("claimRidingInCart", () => {
  it("ids only when a claim is held AND a reward row is in the bag", () => {
    expect(claimRidingInCart(getState())).toBeNull();
    store.dispatch(setClaimedCoupon(CLAIMED));
    expect(claimRidingInCart(getState())).toBeNull(); // no reward row
    store.dispatch(setCartItems([PAID_ROW, REWARD_ROW]));
    expect(claimRidingInCart(getState())).toEqual(IDS);
    store.dispatch(removeClaimedCoupon());
    expect(claimRidingInCart(getState())).toBeNull(); // the row alone is not a claim
  });

  it("never carries the phone or the merchant id", () => {
    riding();
    const sent = JSON.stringify(claimRidingInCart(getState()));
    expect(sent).not.toContain(CLAIMED.phoneNumber);
    expect(sent).not.toContain(CLAIMED.merchantId);
  });
});

describe("markClaimOrderOutcomeUnknown", () => {
  it("marks the claim for THIS order and returns its ids", () => {
    riding();
    expect(markClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-A")).toEqual(IDS);
    expect(claim()).toEqual({
      isClaimed: true,
      couponData: { ...CLAIMED, orderOutcomeUnknown: true, outcomeUnknownOrderId: "ORDER-A" },
    });
  });

  it("never overwrites an existing mark — the earlier order may exist — but still returns the ids", () => {
    riding();
    markClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-A");
    expect(markClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-B")).toEqual(IDS);
    expect(claim().couponData.outcomeUnknownOrderId).toBe("ORDER-A");
  });

  it("a P9d-era mark (no order id) is kept as it is", () => {
    store.dispatch(setClaimedCoupon({ ...CLAIMED, orderOutcomeUnknown: true }));
    store.dispatch(setCartItems([PAID_ROW, REWARD_ROW]));
    markClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-B");
    expect(claim().couponData).toEqual({ ...CLAIMED, orderOutcomeUnknown: true });
  });

  it("not riding (no reward row, or no claim) → null, nothing written", () => {
    store.dispatch(setClaimedCoupon(CLAIMED));
    store.dispatch(setCartItems([PAID_ROW]));
    expect(markClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-A")).toBeNull();
    expect(claim()).toEqual({ isClaimed: true, couponData: CLAIMED });

    store.dispatch(removeClaimedCoupon());
    store.dispatch(setCartItems([PAID_ROW, REWARD_ROW]));
    expect(markClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-A")).toBeNull();
    expect(claim().isClaimed).toBe(false);
    expect(claim().couponData).not.toHaveProperty("orderOutcomeUnknown");
  });
});

describe("unmarkClaimOrderOutcomeUnknown", () => {
  it("only the order that set the mark can undo it — restoring the exact pre-mark claim", () => {
    riding();
    markClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-A");

    unmarkClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-B");
    unmarkClaimOrderOutcomeUnknown(getState, dispatch, "");
    expect(claim().couponData).toMatchObject({ orderOutcomeUnknown: true, outcomeUnknownOrderId: "ORDER-A" });

    unmarkClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-A");
    expect(claim()).toEqual({ isClaimed: true, couponData: CLAIMED });
  });

  it("a no-op on an unmarked claim and on no claim (a wiped claim is never resurrected)", () => {
    riding();
    unmarkClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-A");
    expect(claim()).toEqual({ isClaimed: true, couponData: CLAIMED });

    store.dispatch(setClaimedCoupon({ ...CLAIMED, orderOutcomeUnknown: true, outcomeUnknownOrderId: "ORDER-A" }));
    store.dispatch(removeClaimedCoupon());
    unmarkClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-A");
    expect(claim().isClaimed).toBe(false);
  });

  it("a record that is no longer claimed is never re-claimed, even if it still carries THIS order's mark", () => {
    const dispatched = vi.fn();
    const unclaimed = {
      loyalty: {
        claimedCoupon: {
          isClaimed: false,
          couponData: { ...CLAIMED, orderOutcomeUnknown: true, outcomeUnknownOrderId: "ORDER-A" },
        },
      },
    };
    unmarkClaimOrderOutcomeUnknown(() => unclaimed, dispatched, "ORDER-A");
    expect(dispatched).not.toHaveBeenCalled();
  });

  it("a P9d-era mark (no order id) is never undone by any order", () => {
    store.dispatch(setClaimedCoupon({ ...CLAIMED, orderOutcomeUnknown: true }));
    unmarkClaimOrderOutcomeUnknown(getState, dispatch, "ORDER-A");
    unmarkClaimOrderOutcomeUnknown(getState, dispatch, "");
    expect(claim().couponData).toEqual({ ...CLAIMED, orderOutcomeUnknown: true });
  });
});
