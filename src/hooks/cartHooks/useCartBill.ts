/* eslint-disable @typescript-eslint/no-explicit-any --
 * The cart and the calculated bill flow through untyped from the SDK cart
 * slice / bill engine (BagSheet's own types). Do not add NEW anys.
 */
import { useMemo } from "react";
import { useSelector } from "react-redux";
import {
  selectDeploymentInfo,
  selectDiscountOnAddon,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { getAmountBasedItemValue, getTabId } from "@cx-sdk/catalog/settings/settingsEngine";
import { getImageUrlFromAggregator } from "@cx-sdk/catalog/menu/menuUtils";
import { selectTabId } from "@cx-sdk/core/auth/authentication.slice";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import {
  convertCart,
  getCalculatedBill,
  type CartConversionContext,
} from "@cx-sdk/ordering/order/orderBuilder";
import {
  isBOGOOfferApplicable,
  isItemWiseOfferApplicable,
} from "@cx-sdk/ordering/offer/offerEngine";
import { isSameOrLessViolated } from "@cx-sdk/ordering/offer/offerCommitRules";
import {
  isLeastValueItemOffer,
  reconcileFreebieLock,
} from "@cx-sdk/ordering/offer/leastValueOfferUtils";

/**
 * The SDK bill engine bound to the store's pricing context (tab, settings,
 * the add-on discount rule, the live cart's offer) — gathered in this ONE
 * place: useOrderHook converts and prices with it (the bag, the checkout,
 * the offer probes) and the hooks below total with it. Selectors only — no
 * router, no order machinery — so a menu surface can price the bag too.
 */
export function useBillEngine() {
  const tabIdRdx = useSelector(selectTabId);
  const deploymentInfo = useSelector(selectDeploymentInfo);
  const discountOnAddon = useSelector(selectDiscountOnAddon);
  const cartRdx = useSelector(selectCart);
  const ctx: CartConversionContext = {
    tabId: tabIdRdx || getTabId(tabIdRdx),
    deploymentInfo,
    discountOnAddon,
    cartRdx,
    getAmountBasedItemValue: (item: any) => getAmountBasedItemValue(item, discountOnAddon),
    getImageUrl: getImageUrlFromAggregator,
  };
  return {
    convertCart: (cart: any) => convertCart(cart, ctx),
    getCalculatedBill: (cart: any) => getCalculatedBill(cart, ctx),
  };
}

const hasRows = (cart: any): boolean => (cart?.cartItems?.length ?? 0) > 0;

/**
 * The bag's REVALIDATION verdict: the applied `cartOffer` no longer
 * qualifies on `items`. The open bag drops it on this (BagSheet, with the
 * removal notice); settleCart prices the cart as if it had. Checks 1–6 are
 * fork Cart.tsx parity, 7 the sameOrLess ceiling; minBillAmount is
 * deliberately NOT revalidated (billCalculation refuses the discount instead
 * — documented, keep).
 */
export const shouldDropAppliedOffer = (cartOffer: any, items: any[]): boolean => {
  const qtyExclLoyalty = items.reduce(
    (acc: number, it: any) => (!it?.isLoyaltyItem ? acc + Number(it?.quantity ?? 0) : acc),
    0,
  );
  const qtyExclLoyaltyAndGetItems = items.reduce(
    (acc: number, it: any) =>
      !it?.isLoyaltyItem && !it?.isGetItem ? acc + Number(it?.quantity ?? 0) : acc,
    0,
  );
  return Boolean(
    // 1 + 3: minItemCount against both quantity views.
    (cartOffer?.minItemCount && qtyExclLoyalty < cartOffer.minItemCount) ||
      (cartOffer?.minItemCount && qtyExclLoyaltyAndGetItems < cartOffer.minItemCount) ||
      // 2 + 4: nothing payable left under the offer.
      qtyExclLoyalty <= 0 ||
      qtyExclLoyaltyAndGetItems <= 0 ||
      // 5: itemCriteria — guarded on applicable.on (contract trap 6: the
      // matcher returns undefined for itemCriteria with neither include
      // nor exclude, and must not fire for non-itemCriteria offers).
      (cartOffer?.applicable?.on === "itemCriteria" &&
        items.length > 0 &&
        !isItemWiseOfferApplicable(cartOffer?.applicable, items, cartOffer?.minBillAmount)) ||
      // 6: bogo mechanics (called unconditionally like the fork — the
      // engine returns true for every non-bogo mechanic).
      (items.length > 0 && !isBOGOOfferApplicable(cartOffer, cartOffer?.applicable, items)) ||
      // 7: sameOrLess ceiling (fork Cart.tsx:1327-1346) — false for every
      // offer that is not a sameOrLess plain BOGO.
      isSameOrLessViolated(cartOffer, items),
  );
};

/**
 * The cart as the OPEN bag leaves it — what its effects write the moment it
 * opens, or the cart changes under it: an offer that no longer qualifies goes
 * with its freebie rows (revalidation → handleCartDrivenRemoval), and a
 * least-value lock moves to today's cheapest units (reconcileFreebieAllocation).
 * Pure. A surface outside the bag prices this, never the raw cart: only the
 * open bag settles its lock and its offer (review 2026-10-14: a cheaper
 * qualifying item added on the menu read £15 over an £18 bag, a decrement
 * below the buy quantity £0 over a £5 one).
 */
export const settleCart = (cart: any): any => {
  const offer = cart?.cartOffer;
  const items: any[] = cart?.cartItems ?? [];
  if (!offer || Object.keys(offer).length === 0 || items.length === 0) return cart;
  if (shouldDropAppliedOffer(offer, items)) {
    return {
      ...cart,
      cartOffer: {},
      lockedFreebieAllocation: {},
      cartItems: items.filter((row) => !row?.isGetItem),
    };
  }
  return isLeastValueItemOffer(offer)
    ? { ...cart, lockedFreebieAllocation: reconcileFreebieLock(offer, items) }
    : cart;
};

/** A bill's Total — after rewards, taxes and round off (getNetAmount); 0 without one. */
export const billTotal = (bill: any): number =>
  bill && Object.keys(bill).length > 0 ? Number(bill.getNetAmount()) : 0;

/**
 * The bag's bill over `cart`, recomputed per cart change (keyed on the cart
 * alone, BagSheet's fork parity: the engine call is pure); null with no cart
 * or no rows. Never the slice's netAmount for display (trap 8).
 */
export default function useCartBill(cart: any): any {
  const { getCalculatedBill: calculate } = useBillEngine();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (hasRows(cart) ? calculate(cart) : null), [cart]);
}

/**
 * The bag's Total over `cart` for a surface outside the bag — the menu CTA
 * bar, the product-added modal: the SAME engine and billTotal as the bag's
 * Total, over the cart as the open bag settles it (settleCart), so the two
 * never disagree (walk 2026-10-14: the menu read the ﷼65.00 subtotal over a
 * ﷼34.13 bag). Computed here, not read off the slice's netAmount, which the
 * bag mirrors only while it is open — 0.00 or stale before (the 2026-10-07
 * note). 0 for an empty cart. Rule 2: a row the engine cannot price never
 * takes the menu down — the cart's own subtotal stands in (the bag itself
 * would fail on that row too).
 */
export function useCartTotal(cart: any): number {
  const { getCalculatedBill: calculate } = useBillEngine();
  return useMemo(() => {
    if (!hasRows(cart)) return 0;
    try {
      return billTotal(calculate(settleCart(cart)));
    } catch {
      return Number(cart?.subTotal) || 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);
}
