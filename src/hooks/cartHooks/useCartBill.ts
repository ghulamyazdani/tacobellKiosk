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
import { settleCart } from "@cx-sdk/ordering/offer/offerRevalidation";

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
