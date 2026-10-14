/**
 * useOfferAutoApply — the machine applies the best eligible offer while the
 * bag is open (lane "offers", item 34; SDK pickSessionAutoApplyOffer).
 *
 * Changes money without a tap, so every guard is a veto: never while a sheet,
 * picker, buy stage or removal notice is open; never over an occupied slot;
 * never after the customer acted on offers this session (the latch); only
 * cart-neutral mechanics (the machine never adds food); never to a zero bill.
 * The apply is the same swapCartOffer path as a manual SAVE.
 *
 * BagSheet must declare this AFTER its revalidation effect (effects run in
 * declaration order). The effect re-reads the slot, its source, the latch
 * and the removal notice from the store, so a removal earlier in the same
 * commit — or a StrictMode double effect — can never double-apply.
 *
 * The vetoes live in ONE function, pickAutoApply: the open bag's effect
 * applies its pick, and useAutoApplyPreview hands the same pick to the
 * surfaces that price the bag before it opens (useCartTotal: the menu TOTAL,
 * the added modal's Total — lane cards-prices, 2026-10-14).
 */
import { useEffect, useEffectEvent, useMemo } from "react";
import { useSelector, useStore } from "react-redux";
import type { RankedOffer } from "@cx-sdk/core/types/offer";
import {
  isOperatorFlagged,
  pickSessionAutoApplyOffer,
  type AutoApplyScope,
} from "@cx-sdk/ordering/offer/autoApplyPolicy";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { hasOffer } from "@cx-sdk/ordering/offer/offersSheetLogic";
import { isOfferLockedByLoyaltyReward } from "@cx-sdk/ordering/loyalty/loyaltyOfferRules";
import { selectFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { selectAutoApplyOptOut } from "../../redux/features/offerSession/offerSession.slice";
import useOfferApply from "./useOfferApply";
import useOfferSavings, { type KioskCart } from "./useOfferSavings";

/**
 * THE auto-apply knob — PENDING USER DECISION (lane "offers", decision 1).
 * "operatorFlagged" (default): only offers the operator flagged auto-apply in
 * POS/Cockpit (payload `autoApplied: true`). Alternatives: "all" (best
 * eligible cart-neutral offer) or "off" (ship dark).
 */
export const OFFER_AUTO_APPLY_SCOPE: AutoApplyScope = "operatorFlagged";

interface UseOfferAutoApplyArgs {
  /** The bag is open. */
  open: boolean;
  /** BagSheet's ranked offers (rankOffers order). */
  ranked: RankedOffer<SavingsOffer>[];
  /** RewardsSheet, the freebie picker or the buy stage is open. */
  blocked: boolean;
}

/** Only the slices this hook reads (house pattern). */
interface AutoApplyRootState {
  cart?: {
    cartItems?: unknown[];
    cartOffer?: Record<string, unknown> | null;
    cartOfferSource?: "offer" | "loyalty";
    offerRemovalModal?: { isOpen?: boolean } | null;
  };
  offerSession?: { autoApplyOptOut?: boolean } | null;
}

const selectSlotOccupied = (state: AutoApplyRootState): boolean =>
  hasOffer(state?.cart?.cartOffer);

const selectRemovalNoticeOpen = (state: AutoApplyRootState): boolean =>
  state?.cart?.offerRemovalModal?.isOpen === true;

/**
 * The offer the machine applies over `state`, or null — every veto in one
 * place: the removal notice, the D3 lock (a XENO reward in the bag, the slot
 * empty; autoApplyOffer re-checks it at the write), then the SDK session
 * policy (the slot, loyalty, the latch, `blocked`, the zero-bill veto).
 */
const pickAutoApply = (
  state: AutoApplyRootState,
  ranked: RankedOffer<SavingsOffer>[],
  blocked: boolean,
  netAfterFor: (offer: SavingsOffer) => number,
): SavingsOffer | null => {
  const cart = state?.cart;
  if (
    selectRemovalNoticeOpen(state) ||
    isOfferLockedByLoyaltyReward(cart?.cartItems, cart?.cartOffer)
  ) {
    return null;
  }
  return pickSessionAutoApplyOffer({
    ranked,
    scope: OFFER_AUTO_APPLY_SCOPE,
    slotOccupied: selectSlotOccupied(state),
    loyaltyOwnsSlot: cart?.cartOfferSource === "loyalty",
    customerOverrode: selectAutoApplyOptOut(state),
    blocked,
    netAfterFor,
  });
};

/**
 * The offers the scope lets the machine choose from (the SDK policy's own
 * flag test) — all a surface outside the bag has to rank: rankOffers sorts
 * on per-offer keys, so a subset keeps the full list's order and
 * pickAutoApply makes the same pick, while the menu probes the flagged
 * offers only, never all N (the bag ranks all N, and only while open).
 */
const autoApplyPool = (
  offers: SavingsOffer[] | null | undefined,
  scope: AutoApplyScope = OFFER_AUTO_APPLY_SCOPE,
): SavingsOffer[] => {
  if (scope === "off") return [];
  const all = offers ?? [];
  return scope === "all" ? all : all.filter(isOperatorFlagged);
};

/**
 * The offer the bag will apply by itself when it opens over `cart`, or null —
 * for the surfaces that price the bag before it opens (useCartTotal). `cart`
 * may hold picks the store has not got (the added modal's preview), so it is
 * ranked as given. The open bag's own pick: pickAutoApply with no sheet up —
 * a bag opens without one.
 */
export function useAutoApplyPreview(
  cart: (KioskCart & AutoApplyRootState["cart"]) | null | undefined,
): SavingsOffer | null {
  const offers = useSelector(selectFilteredOffers) as SavingsOffer[] | null | undefined;
  const optOut = useSelector(selectAutoApplyOptOut);
  const { rank, netAfter } = useOfferSavings(cart);
  return useMemo(() => {
    // The cheap vetoes first: ranking runs bill probes.
    if (!cart?.cartItems?.length || hasOffer(cart.cartOffer) || optOut) return null;
    try {
      return pickAutoApply(
        { cart, offerSession: { autoApplyOptOut: optOut } },
        rank(autoApplyPool(offers)),
        false,
        netAfter,
      );
    } catch {
      // A preview must never take the menu down (Rule 2).
      return null;
    }
  }, [cart, offers, optOut, rank, netAfter]);
}

export default function useOfferAutoApply({
  open,
  ranked,
  blocked,
}: UseOfferAutoApplyArgs): void {
  const store = useStore();
  const { autoApplyOffer } = useOfferApply();
  const { netAfter } = useOfferSavings();
  const slotOccupied = useSelector(selectSlotOccupied);
  const optOut = useSelector(selectAutoApplyOptOut);
  const noticeOpen = useSelector(selectRemovalNoticeOpen);

  const tryAutoApply = useEffectEvent(() => {
    try {
      const pick = pickAutoApply(
        store.getState() as AutoApplyRootState,
        ranked,
        blocked,
        netAfter,
      );
      if (pick) autoApplyOffer(pick);
    } catch {
      // Auto-apply is a convenience: it must never take the bag down (Rule 2).
    }
  });

  useEffect(() => {
    if (!open || blocked || noticeOpen) return;
    tryAutoApply();
  }, [open, ranked, slotOccupied, optOut, blocked, noticeOpen]);
}
