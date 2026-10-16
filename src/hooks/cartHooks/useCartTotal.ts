/* eslint-disable @typescript-eslint/no-explicit-any --
 * The cart flows through untyped from the SDK cart slice (useCartBill's own
 * header). Do not add NEW anys.
 */
import { useMemo } from "react";
import cartReducer, { swapCartOffer } from "@cx-sdk/ordering/state/cart.slice";
import { settleCart } from "@cx-sdk/ordering/offer/offerRevalidation";
import { useAutoApplyPreview } from "../offerHooks/useOfferAutoApply";
import { billTotal, hasRows, useBillEngine } from "./useCartBill";

/**
 * The bag's Total over `cart` for a surface outside the bag — the menu CTA
 * bar, the product-added modal: the SAME engine and billTotal as the bag's
 * Total, over the cart as the bag leaves it once it opens — settled
 * (settleCart on this same engine: a reward that lapsed goes, its bill
 * minimum included, a least-value lock moves), then
 * carrying the offer it applies by itself (useAutoApplyPreview), through the
 * cart slice's own swapCartOffer and settled again, as the bag's effects
 * run. So the two never disagree (walk 2026-10-14: the menu read the ﷼65.00
 * subtotal over a ﷼34.13 bag, and ﷼47.25 over a bag that applied Happy Hour
 * by itself on open). Computed here, not read off the slice's netAmount,
 * which the bag mirrors only while it is open — 0.00 or stale before (the
 * 2026-10-07 note). 0 for an empty cart. Rule 2: a row the engine cannot
 * price never takes the menu down — the cart's own subtotal stands in (the
 * bag itself would fail on that row too).
 */
export default function useCartTotal(cart: any): number {
  const { getCalculatedBill: calculate, ctx } = useBillEngine();
  const autoApply = useAutoApplyPreview(cart);
  return useMemo(() => {
    if (!hasRows(cart)) return 0;
    try {
      const settled = settleCart(cart, calculate);
      const opened = autoApply
        ? settleCart(cartReducer(settled, swapCartOffer({ next: autoApply, source: "offer" })), calculate)
        : settled;
      return billTotal(calculate(opened));
    } catch {
      return Number(cart?.subTotal) || 0;
    }
    // Keyed on useCartBill's bill inputs — a NEW one joins both keys — plus
    // the catch's subTotal and the offer the bag applies by itself; never the
    // cart object, so a cart write that moves no money prices nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cart?.cartItems,
    cart?.cartOffer,
    cart?.lockedFreebieAllocation,
    cart?.charges,
    ctx.tabId,
    ctx.deploymentInfo,
    ctx.discountOnAddon,
    ctx.cartRdx?.cartOffer,
    cart?.subTotal,
    autoApply,
  ]);
}
