import {
  selectClaimedCoupon,
  setClaimedCoupon,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import { isAnyLoyaltyItemPresentInCart } from "@cx-sdk/ordering/cart/cartEngine";

/*
  S7 (user decision 2026-10-01, P9d; P8b-11): a Xeno reward that rode in an
  order whose outcome is unknown is never auto-refunded — the order, reward
  included, may exist. The MARK lives on the claim in redux (this screen
  unmounts before /start's teardown; resetLoyaltySession drops it with the
  claim) and is read fresh from the store, even after unmount, so a claim a
  reset already wiped is never resurrected. useLoyalty's revoke skips a
  marked claim and reports it for staff (`xeno_revoke_skipped`). One helper
  for both money paths: the pay-at-counter push (usePayAtCounter) and Paytm
  (backend-placed orders: marked at initiate, unmarked only when that SAME
  order is definitively not paid).
*/

/** Non-PII ids staff reconcile a held claim by (never the phone or apikey). */
export interface ClaimReconciliationIds {
  reward_id: unknown;
  claim_datetime: unknown;
  points: unknown;
}

interface ClaimedCoupon {
  isClaimed?: boolean;
  couponData?: {
    couponCode?: unknown;
    datetime?: unknown;
    claimedPoints?: unknown;
    orderOutcomeUnknown?: boolean;
    outcomeUnknownOrderId?: string;
  } & Record<string, unknown>;
}

const claimOf = (state: unknown): ClaimedCoupon | undefined =>
  selectClaimedCoupon(state);

/**
 * The claim is held AND a loyalty reward row is in the cart → its ids; else
 * null. Only that row can be in the order: a row removed earlier (its undo
 * timed out, claim kept) is not, so that claim keeps its /start refund. One
 * reward row at a time ("already availed"), so the row is this claim's.
 */
export function claimRidingInCart(
  state: unknown,
): ClaimReconciliationIds | null {
  const claim = claimOf(state);
  if (!claim?.isClaimed) return null;
  if (!isAnyLoyaltyItemPresentInCart(selectCart(state)?.cartItems ?? [])) {
    return null;
  }
  const coupon = claim.couponData;
  return {
    reward_id: coupon?.couponCode,
    claim_datetime: coupon?.datetime,
    points: coupon?.claimedPoints,
  };
}

/**
 * The claim rides in `orderId`'s order, whose outcome is unknown: mark it
 * (`orderOutcomeUnknown` + `outcomeUnknownOrderId`) and return its ids for
 * the caller's event. An existing mark is NEVER overwritten — the order that
 * set it may still exist — but its ids are still returned. Not riding → null.
 */
export function markClaimOrderOutcomeUnknown(
  getState: () => unknown,
  dispatch: (action: ReturnType<typeof setClaimedCoupon>) => unknown,
  orderId: string,
): ClaimReconciliationIds | null {
  const state = getState();
  const ids = claimRidingInCart(state);
  if (!ids) return null;
  const coupon = claimOf(state)?.couponData;
  if (!coupon?.orderOutcomeUnknown) {
    dispatch(
      setClaimedCoupon({
        ...coupon,
        orderOutcomeUnknown: true,
        outcomeUnknownOrderId: orderId,
      }),
    );
  }
  return ids;
}

/**
 * Undo ONLY a mark `orderId` set — on proof that order was never placed (a
 * clean initiate failure, a definitive not-paid). Any other mark, or none,
 * is left alone: a later attempt's failure says nothing about an earlier one.
 */
export function unmarkClaimOrderOutcomeUnknown(
  getState: () => unknown,
  dispatch: (action: ReturnType<typeof setClaimedCoupon>) => unknown,
  orderId: string,
): void {
  const claim = claimOf(getState());
  const coupon = claim?.couponData;
  if (
    !orderId ||
    !claim?.isClaimed ||
    !coupon?.orderOutcomeUnknown ||
    coupon.outcomeUnknownOrderId !== orderId
  ) {
    return;
  }
  const {
    orderOutcomeUnknown: _mark,
    outcomeUnknownOrderId: _orderId,
    ...unmarked
  } = coupon;
  dispatch(setClaimedCoupon(unmarked));
}
