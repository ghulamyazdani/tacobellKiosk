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

/**
 * The SDK bill engine bound to the store's pricing context (tab, settings,
 * the add-on discount rule, the live cart's offer) — gathered in this ONE
 * place: useOrderHook converts and prices with it (the bag, the checkout),
 * useOfferSavings probes with it, useCartBill (the bag) and useCartTotal
 * (outside it) total with it. Selectors only — no router, no order
 * machinery — so a menu surface can price the bag too.
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
    /** The pricing context, for the bill memos' keys (useCartBill, useCartTotal). */
    ctx,
  };
}

export const hasRows = (cart: any): boolean => (cart?.cartItems?.length ?? 0) > 0;

/** A bill's Total — after rewards, taxes and round off (getNetAmount); 0 without one. */
export const billTotal = (bill: any): number =>
  bill && Object.keys(bill).length > 0 ? Number(bill.getNetAmount()) : 0;

/**
 * The bag's bill over `cart`, recomputed when a bill input changes (the
 * engine call is pure) — never on a cart write that moves no money, such as
 * the bag's own setAmount echo, a notice or a sheet flag; null with no cart
 * or no rows. Never the slice's netAmount for display (trap 8).
 *
 * The memo key is EVERY input of getCalculatedBill(cart), by identity: the
 * four cart fields convertCart reads off the priced cart (settleCart and
 * swapCartOffer read no others), then the pricing context — the tab (charge
 * taxes), the settings billCalculation reads, the add-on rule and the live
 * cart's offer (get-item discount labels); ctx's functions are pure over
 * these. A NEW bill input must join this key and useCartTotal's.
 */
export default function useCartBill(cart: any): any {
  const { getCalculatedBill: calculate, ctx } = useBillEngine();
  return useMemo(
    () => (hasRows(cart) ? calculate(cart) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      cart?.cartItems,
      cart?.cartOffer,
      cart?.lockedFreebieAllocation,
      cart?.charges,
      ctx.tabId,
      ctx.deploymentInfo,
      ctx.discountOnAddon,
      ctx.cartRdx?.cartOffer,
    ],
  );
}
