/* eslint-disable react-hooks/refs, react-hooks/immutability --
 * Verbatim port of the posistKiosk useOfferSavings hook (P7b). The latest-ref
 * render write and the module-level probe caches are the file's documented,
 * load-bearing perf design (see comments below): the ref must be current on
 * the SAME render that rebuilds the context memo (an effect would leave it one
 * render stale and misprice the baseline), and the caches are deliberately
 * shared across hook instances and keyed on cartSignature, so every write is
 * idempotent per signature. Do not restructure without re-auditing the fork.
 */
/**
 * Binds the pure savings engine (offerSavings.ts) to the live cart and the real
 * bill calculator — docs/OFFERS_REDESIGN.md §5.1 (P2).
 *
 * The whole reason this is cheap: `getCalculatedBill(cart)` is a pure function
 * of the cart object it is handed. `convertCart` reads `cart.cartOffer` off the
 * argument (not Redux), and so does the least-value annotation. So we can price
 * a candidate offer by handing the calculator a cart with that offer spliced in,
 * without applying anything or touching state.
 *
 *     discount(candidate) = getCalculatedBill({ ...cart, cartOffer: candidate })
 *                             .getTotalDiscount()
 *
 * That means "You save ₹X" and "Sorted by best value" need no backend change.
 *
 * COST. Each probe is a full run of billCalculation (~2.2k LOC). Ranking N
 * offers is N+1 runs, so results are memoised on a cart signature and the
 * baseline is computed once. Nothing here runs during render of a list — call
 * `rank()` inside a memo, not per row.
 */

import { useCallback, useMemo, useRef } from "react";
import { useSelector } from "react-redux";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import useOrderHook from "../menuHooks/useOrderHook";
import useOfferHook from "./useOfferHook";
import {
  computeRealisedSaving,
  getOfferGap,
  rankOffers,
  shouldNudgeUnlock,
  type SavingsCartItem,
  type SavingsContext,
  type SavingsOffer,
} from "@cx-sdk/ordering/offer/offerSavings";
import type { RankedOffer, RealisedSaving } from "@cx-sdk/core/types/offer";

interface KioskCart {
  cartItems?: SavingsCartItem[];
  cartOffer?: Record<string, unknown>;
  lockedFreebieAllocation?: Record<string, number>;
}

interface CalculatedBill {
  getTotalDiscount?: () => number;
  getNetAmount?: () => number;
  getSubtotal?: () => number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Cheap identity for "has the cart changed in a way that moves money". Used as
 * the memo key so a re-render that does not touch the cart costs no bill runs.
 */
const cartSignature = (cart: KioskCart | undefined): string => {
  const items = cart?.cartItems ?? [];
  return items
    .map((i) =>
      [
        i?.itemId ?? i?.id ?? "",
        i?.selectedVariant?.id ?? "",
        i?.quantity ?? 0,
        i?.selectedVariant?.price ?? i?.price ?? 0,
        i?.isGetItem ? "g" : "",
        i?.isLoyaltyItem ? "l" : "",
      ].join(":"),
    )
    .join("|");
};


/**
 * Shared, module-level probe caches keyed by cart signature. Deliberately NOT
 * per-hook-instance: the cart's SavingsLine and the offers sheet each mount
 * this hook, and instance-local caches meant the sheet opened cold and re-ran
 * every bill probe during its entrance animation. Shared, the cart warms the
 * cache before the sheet ever opens, so opening it costs ~zero bill runs and
 * the entrance animates over a silent main thread.
 */
const sharedProbeCache: { signature: string; map: Map<string, number> } = {
  signature: "",
  map: new Map(),
};
const sharedNetCache: { signature: string; map: Map<string, number> } = {
  signature: "",
  map: new Map(),
};
/** Baseline (no-offer) subtotal per signature — read on every context build. */
const sharedBaselineCache: { signature: string; subtotal: number | null } = {
  signature: "",
  subtotal: null,
};

function useOfferSavings() {
  const cartRdx = useSelector(selectCart) as KioskCart | undefined;
  const { getCalculatedBill } = useOrderHook();
  const { isItemWiseOfferApplicable, isBOGOOfferApplicable } = useOfferHook();

  const signature = cartSignature(cartRdx);

  /**
   * Price a cart with `offer` spliced in.
   *
   * `lockedFreebieAllocation` is deliberately dropped: the stored lock belongs
   * to whichever offer is currently applied, so leaving it in would make the
   * least-value annotation reuse another offer's freebie distribution and
   * misprice the candidate. Cleared, the distribution is recomputed for the
   * candidate, which is what we want to quote.
   */
  /**
   * getCalculatedBill and cartRdx get fresh identities from useOrderHook /
   * useSelector on every render, so a useCallback keyed on them is a new
   * function every render — which cascaded into context/quoteDiscount/netAfter
   * and re-ran a full baseline bill probe on EVERY render of any subscriber,
   * exactly inside animation windows. Latest values live in a ref; every
   * consumer below is keyed on `signature` alone, which only changes when the
   * cart's MONEY changes.
   */
  const latest = useRef({ cartRdx, getCalculatedBill });
  latest.current = { cartRdx, getCalculatedBill };

  const billFor = useCallback(
    (offer: Record<string, unknown>): CalculatedBill | null => {
      const { cartRdx: cart, getCalculatedBill: calc } = latest.current;
      if (!cart) return null;
      try {
        return calc({
          ...cart,
          cartOffer: offer,
          lockedFreebieAllocation: undefined,
        }) as CalculatedBill;
      } catch {
        // A malformed candidate must never break the cart it was quoted
        // against. The engine falls back to closed-form arithmetic.
        return null;
      }
    },
    [],
  );

  /**
   * Memoised probe. The baseline (no offer) is computed once per cart, and each
   * candidate is cached by offer id, so ranking N offers costs N+1 bill runs
   * rather than 2N.
   */

  const quoteDiscount = useCallback(
    (offer: Record<string, unknown>): number => {
      if (sharedProbeCache.signature !== signature) {
        sharedProbeCache.signature = signature;
        sharedProbeCache.map = new Map();
      }
      const key = (offer?._id as string) || "__baseline__";
      const cached = sharedProbeCache.map.get(key);
      if (cached !== undefined) return cached;

      const bill = billFor(offer);
      const value = num(bill?.getTotalDiscount?.());
      sharedProbeCache.map.set(key, value);
      return value;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  /**
   * Net payable if `offer` were applied — feeds the zero-bill auto-apply veto
   * and the confirmation view's "To pay". Cached: uncached, every render of
   * the confirmation view cost a full ~2.2k-LOC bill run on the same frames
   * the view transition was animating.
   */
  const netAfter = useCallback(
    (offer: SavingsOffer): number => {
      if (sharedNetCache.signature !== signature) {
        sharedNetCache.signature = signature;
        sharedNetCache.map = new Map();
      }
      const key = (offer?._id as string) || "__none__";
      const cached = sharedNetCache.map.get(key);
      if (cached !== undefined) return cached;
      const bill = billFor(offer as unknown as Record<string, unknown>);
      const value = num(bill?.getNetAmount?.());
      sharedNetCache.map.set(key, value);
      return value;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );

  const context = useMemo<SavingsContext>(() => {
    const items = cartRdx?.cartItems ?? [];
    // minBillAmount / minItemCount are compared against the cart EXCLUDING
    // loyalty lines, matching every existing eligibility check.
    const payable = items.filter((i) => !i?.isLoyaltyItem);
    const cartQuantity = payable.reduce((sum, i) => sum + num(i?.quantity), 0);
    // Baseline subtotal cached per signature — this ran a FULL bill on every
    // context rebuild before billFor was ref-stabilized.
    if (
      sharedBaselineCache.signature !== signature ||
      sharedBaselineCache.subtotal === null
    ) {
      const baseBill = billFor({});
      sharedBaselineCache.signature = signature;
      sharedBaselineCache.subtotal = num(baseBill?.getSubtotal?.());
    }
    const subtotal = sharedBaselineCache.subtotal ?? 0;
    const loyaltyTotal = items.reduce(
      (sum, i) =>
        i?.isLoyaltyItem
          ? sum + num((i as { undiscounted_total_price?: number })?.undiscounted_total_price)
          : sum,
      0,
    );

    return {
      cartItems: items,
      cartValue: Math.max(0, subtotal - loyaltyTotal),
      cartQuantity,
      quoteDiscount,
      isItemCriteriaMet: (offer: SavingsOffer) =>
        Boolean(
          isItemWiseOfferApplicable(
            offer?.applicable,
            items,
            offer?.minBillAmount,
          ),
        ),
      isBogoBuySideMet: (offer: SavingsOffer) =>
        Boolean(isBOGOOfferApplicable(offer, offer?.applicable, items)),
    };
    // Keyed on the SIGNATURE alone: quoteDiscount is signature-stable, and the
    // matcher closures read items captured above. useOfferHook's matchers get
    // fresh identities every render but are pure — depending on them would
    // rebuild context (and re-rank) on every render for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, quoteDiscount]);

  const savingFor = useCallback(
    (offer: SavingsOffer | null | undefined): RealisedSaving =>
      computeRealisedSaving(offer, context),
    [context],
  );

  const rank = useCallback(
    (offers: SavingsOffer[] | null | undefined): RankedOffer<SavingsOffer>[] =>
      rankOffers(offers, context),
    [context],
  );

  const gapFor = useCallback(
    (offer: SavingsOffer) => getOfferGap(offer, context),
    [context],
  );

  const nudgeFor = useCallback(
    (offer: SavingsOffer, cheapestQualifyingUnitPrice?: number) =>
      shouldNudgeUnlock(
        offer,
        context,
        getOfferGap(offer, context),
        cheapestQualifyingUnitPrice,
      ),
    [context],
  );

  /**
   * Warm the shared probe cache during idle time so the offers sheet opens
   * with every figure precomputed and its entrance animates over a silent
   * main thread. Safe to call repeatedly; each probe is cached by signature.
   */
  const prewarm = useCallback(
    (offersToWarm: SavingsOffer[] | null | undefined) => {
      if (!offersToWarm?.length) return;
      const run = () => {
        try {
          rankOffers(offersToWarm, context);
          offersToWarm.forEach((o) => netAfter(o));
        } catch {
          /* prewarming must never break anything */
        }
      };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(run, { timeout: 2000 });
      } else {
        setTimeout(run, 300);
      }
    },
    [context, netAfter],
  );

  return {
    /** Rank a list by realised customer saving. Call inside a memo. */
    rank,
    /** Idle-time cache warm for a list the sheet will rank later. */
    prewarm,
    /** Realised saving for one offer against the current cart. */
    savingFor,
    /** Why an offer is locked, if it is. */
    gapFor,
    /** Unlock nudge for a locked offer, or null if it fails the honesty gate. */
    nudgeFor,
    /** Net payable if an offer were applied. */
    netAfter,
    /** The context handed to the pure engine — exposed for debugging. */
    savingsContext: context,
  };
}

export default useOfferSavings;
