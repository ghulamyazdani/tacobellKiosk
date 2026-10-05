import { useDispatch } from "react-redux";
import useCartIndexedDb from "../cartHooks/useCartIndexedDb";
import useOrderIndexDb from "../indexedDb/useOrderIndexDb";
import {
  emptyCart,
  removeCartOffer,
  resetCartUpsellSeen,
  setCartInstructions,
} from "@cx-sdk/ordering/state/cart.slice";
import { emptyOrder } from "@cx-sdk/ordering/state/order.slice";
import {
  emptyMenuData,
  setExpandedCategories,
  setMenuScrollPosition,
} from "@cx-sdk/catalog/state/Menu.slice";
import { clearFilters } from "@cx-sdk/catalog/state/filter.slice";
import { resetOffersFetchStatus } from "@cx-sdk/ordering/state/offer.slice";
import { removeCustomerDetails } from "@cx-sdk/core/customer/customerInfo.slice";
import {
  closeLoyaltyItemsModal,
  resetLoyaltySession,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { emptySelectedLanguage } from "../../redux/features/multiLanguage/multiLanguage.slice";
import {
  clearMediaDataConvertedItems,
  clearTent,
  closeAccessibilityMode,
  closeStartOverConfirmation,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  closeBottomSheet,
  mutateAddToCartModal,
  setOutOfStockItems,
  setRecommendationDetour,
} from "../../redux/features/menuSelections/menuSelections.slice";
import {
  closeMakeItAMealModal,
  closeMakeItAMealSession,
  resetBlackListedItems,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { emptyPayment } from "@cx-sdk/payments/state/payment.slice";
import { stopTimer } from "@cx-sdk/core/session/timer.slice";

/**
 * THE canonical session reset — TB port of the fork's
 * posistKiosk-cx-sdk/src/hooks/utils/useSessionReset.ts (P7a, contract C2).
 *
 * Two scopes, matching the two real lifecycles:
 * - "full": StartScreen / cancel-order. Everything clears, INCLUDING menu
 *   data — the loaders refetch all resources immediately after.
 * - "nextCustomer": the fast path to /second (order complete, or start-over
 *   taps that skip /start's loading screen). Menu/settings stay loaded —
 *   that is the point of the fast path — but every CUSTOMER-scoped datum
 *   clears.
 *
 * Ordering constraints preserved from the fork:
 * - loyalty revoke (fork IdleTimerModal.checkAndRevokeLoyaltyReward) happens
 *   at the CALLER before this reset — it reads the claimed coupon from
 *   render-time closures that this reset wipes.
 * - offers fetch status resets AFTER the cart offer is removed.
 *
 * Divergences from the fork, each because the slice/util is not (yet) part
 * of the TB app — flagged inline where they would have run.
 */
export type SessionResetScope = "full" | "nextCustomer";

const useSessionReset = () => {
  const dispatch = useDispatch();
  const { clearIndexedDbCart } = useCartIndexedDb();
  // Historical no-op (useOrderIndexDb is a hollowed-out stub) kept verbatim to
  // preserve the legacy reset sequence exactly; delete with the stub upstream.
  const { deleteAllOrdersFromIndexedDb } = useOrderIndexDb();

  const resetSession = (scope: SessionResetScope) => {
    // --- pre-clears that only the StartScreen path performed ---------------
    if (scope === "full") {
      dispatch(closeLoyaltyItemsModal());
      dispatch(resetBlackListedItems());
      dispatch(closeStartOverConfirmation());
    }

    // Payment state must never survive a customer, on either path.
    dispatch(emptyPayment());

    // --- the customer-session core (order preserved from the fork) --------
    dispatch(emptyOrder());
    if (scope === "full") {
      // The loaders refetch the menu right after; the fast path keeps it.
      dispatch(emptyMenuData());
    }
    dispatch(emptyCart());
    clearIndexedDbCart();
    dispatch(emptyCart());
    deleteAllOrdersFromIndexedDb();
    dispatch(clearFilters());
    dispatch(removeCartOffer());
    // An offers-fetch failure must not outlive the customer who hit it —
    // otherwise the next customer is greeted by "Couldn't load offers" for a
    // request that was never made in their session.
    dispatch(resetOffersFetchStatus());
    // Skipped fork step: resetConfetti() (fork src/utils/confettiCelebration)
    // — the offer-celebration util is not ported to TB.
    // Skipped fork step: resetAppliedBarCelebration() (fork
    // src/components/offer/appliedBarCelebration) — offer vertical not in TB.
    dispatch(removeCustomerDetails());
    dispatch(resetLoyaltySession());
    dispatch(emptySelectedLanguage());
    dispatch(clearMediaDataConvertedItems());
    dispatch(clearTent());
    dispatch(closeBottomSheet());
    // The confirmation modal can stay open indefinitely, so a reset must
    // clear it too.
    dispatch(mutateAddToCartModal(false));
    // The pre-cart upsell is shown at most once per CUSTOMER, and the flag
    // deliberately survives emptyCart, so only the session reset clears it.
    dispatch(resetCartUpsellSeen());
    // A detour flag left set by an abandoned customization would suppress
    // the next customer's first recommendation strip.
    dispatch(setRecommendationDetour(false));

    // Menu UI position is customer-scoped even when menu DATA is kept.
    dispatch(setMenuScrollPosition(0));
    dispatch(setExpandedCategories({}));
    dispatch(setCartInstructions(""));

    // --- modal/screen-mode clears ------------------------------------------
    dispatch(closeMakeItAMealModal());
    // An abandoned MIAM session must not greet the next customer on any path.
    dispatch(closeMakeItAMealSession());
    if (scope === "full") {
      dispatch(closeAccessibilityMode());
      dispatch(setOutOfStockItems({}));
    }

    // The session timer's persisted timeRemaining must not leak into the
    // next session.
    dispatch(stopTimer());
  };

  return { resetSession };
};

export default useSessionReset;
