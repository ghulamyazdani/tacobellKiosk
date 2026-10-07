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
 */
import { useEffect, useEffectEvent } from "react";
import { useSelector, useStore } from "react-redux";
import type { RankedOffer } from "@cx-sdk/core/types/offer";
import {
  pickSessionAutoApplyOffer,
  type AutoApplyScope,
} from "@cx-sdk/ordering/offer/autoApplyPolicy";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { hasOffer } from "@cx-sdk/ordering/offer/offersSheetLogic";
import { selectAutoApplyOptOut } from "../../redux/features/offerSession/offerSession.slice";
import useOfferApply from "./useOfferApply";
import useOfferSavings from "./useOfferSavings";

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
      const state = store.getState() as AutoApplyRootState;
      if (selectRemovalNoticeOpen(state)) return;
      const pick = pickSessionAutoApplyOffer({
        ranked,
        scope: OFFER_AUTO_APPLY_SCOPE,
        slotOccupied: selectSlotOccupied(state),
        loyaltyOwnsSlot: state?.cart?.cartOfferSource === "loyalty",
        customerOverrode: selectAutoApplyOptOut(state),
        blocked,
        netAfterFor: netAfter,
      });
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
