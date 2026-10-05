/* eslint-disable @typescript-eslint/no-explicit-any --
 * The removed offer and the calculated bill flow through untyped from the
 * SDK cart slice / bill engine; typed in a later domain pass. Do not add
 * NEW anys.
 */
import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  closeOfferRemovalModal,
  offerRemovalModal,
  selectCart,
} from "@cx-sdk/ordering/state/cart.slice";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import type { OfferGap, OfferLockReason } from "@cx-sdk/core/types/offer";
import useOfferSavings from "../../hooks/offerHooks/useOfferSavings";
import useOrderHook from "../../hooks/menuHooks/useOrderHook";

interface OfferRemovalNoticeProps {
  /**
   * The bag's already-computed bill, when the notice is mounted where one
   * exists (BagSheet). Omitted, the new total is recomputed here from the
   * live cart via getCalculatedBill (never read off the slice — trap 8).
   */
  bill?: any;
}

/**
 * REWARD REMOVED notice — locked decision 6: design-language centered modal
 * (no dedicated Figma frame — flagged for client sign-off) driven by
 * `cart.offerRemovalModal`, opened by useOfferApply.handleCartDrivenRemoval.
 * Restates the removed offer's name, WHY it no longer applies (gapFor
 * against the current cart), and the new total. Single GOT IT button, no
 * auto-dismiss, no scrim tap-through — a price increase never disappears on
 * a timer or an accidental touch.
 *
 * Centered modal, so the shared position-dependent tb-modal-enter keyframe
 * applies (RemoveItemModal precedent).
 */
export default function OfferRemovalNotice({ bill }: OfferRemovalNoticeProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const removalModal = useSelector(offerRemovalModal) as any;
  const cartRdx = useSelector(selectCart) as any;
  const currencySettings = useSelector(selectCurrency) as any;
  const { gapFor } = useOfferSavings();
  const { getCalculatedBill } = useOrderHook();

  const isOpen = Boolean(removalModal?.isOpen);
  const removedOffer = removalModal?.data;
  const currency =
    currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";

  // New total: caller's bill when provided, else a local recompute on the
  // live cart. An empty cart is an honest 0.00 (the bag may already be
  // auto-exiting underneath this notice).
  const newTotal = useMemo(() => {
    try {
      if (!isOpen) return 0;
      if (bill && Object.keys(bill).length > 0) {
        return Number(bill?.getNetAmount?.() ?? 0);
      }
      if ((cartRdx?.cartItems?.length ?? 0) === 0) return 0;
      const localBill = getCalculatedBill(cartRdx);
      return Number(localBill?.getNetAmount?.() ?? 0);
    } catch {
      // A malformed cart must never take the notice (or the bag) down.
      return 0;
    }
    // getCalculatedBill is a pure engine call re-created per render (house
    // pattern, BagSheet parity) — keying on it would recompute every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, bill, cartRdx]);

  if (!isOpen) return null;

  // The offer is already out of the slot, but the gap is computed against
  // the offer's own criteria and the CURRENT cart — so it still explains
  // correctly (ORIG OfferRemovalModal parity).
  let gap: OfferGap | undefined;
  try {
    gap =
      removedOffer && Object.keys(removedOffer).length > 0
        ? gapFor(removedOffer)
        : undefined;
  } catch {
    gap = undefined;
  }

  const reasonLine = (reason?: OfferLockReason): string | null => {
    switch (reason) {
      case "minBill":
        // Same wording as the sheet's pink eligibility nudge (Figma
        // rewards-ineligible) — the gap the customer must close.
        return t("offers.addNudge", {
          amount: `${currency}${Number(gap?.amountShort ?? 0).toFixed(2)}`,
        });
      case "minItems": {
        const short = Number(gap?.countShort) || 0;
        return short === 1
          ? t("offers.removedReasonItemsOne")
          : t("offers.removedReasonItemsOther", { count: short });
      }
      case "itemCriteria":
        return t("offers.lockedItemCriteria");
      case "bogoBuySide":
        return t("offers.lockedBogoBuySide");
      case "unavailable":
        return t("offers.lockedUnavailable");
      default:
        return null;
    }
  };

  const reason = reasonLine(gap?.reason);

  return (
    // `fixed`, not `absolute` (RemoveItemModal precedent): the bag can
    // empty-exit underneath this notice (e2e scenario 7), so it must not
    // depend on a positioned ancestor to cover the screen.
    <div className="fixed inset-0 z-[90]" data-testid="offer-removal-notice">
      {/* Non-interactive scrim — decision 6: GOT IT is the only way out. */}
      <div className="absolute inset-0 h-full w-full bg-tb-purple/60" />
      <div
        role="alertdialog"
        aria-label={t("offers.removedTitle")}
        className="tb-modal-enter absolute left-1/2 top-1/2 w-[760px] rounded-[16px] bg-tb-surface px-[48px] pb-[56px] pt-[72px] text-center"
      >
        <h2 className="tb-display mb-[24px] text-[40px] leading-[40px] tracking-[-1px] text-tb-purple">
          {t("offers.removedTitle")}
        </h2>
        {removedOffer?.name ? (
          <p className="mx-auto mb-[16px] max-w-[560px] text-[26px] leading-[34px] text-black">
            {t("offers.removedBody", { name: removedOffer.name })}
          </p>
        ) : null}
        {reason ? (
          <p className="mx-auto mb-[16px] max-w-[560px] text-[22px] font-medium leading-[28px] text-tb-pink-dark">
            {reason}
          </p>
        ) : null}
        <p className="mx-auto mb-[48px] max-w-[560px] text-[22px] leading-[28px] text-tb-ink-purple/80">
          {t("offers.removedNewTotal", {
            amount: `${currency}${newTotal.toFixed(2)}`,
          })}
        </p>
        <button
          type="button"
          data-testid="offer-removal-gotit"
          onClick={() => dispatch(closeOfferRemovalModal())}
          className="tb-display min-h-[64px] w-full rounded-[4px] bg-tb-purple px-[32px] py-[20px] text-[18px] leading-[20px] text-tb-surface"
        >
          {t("offers.gotIt")}
        </button>
      </div>
    </div>
  );
}
