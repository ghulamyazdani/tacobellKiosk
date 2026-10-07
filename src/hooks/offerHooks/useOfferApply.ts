/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offers and cart rows flow through untyped from the SDK cart slice /
 * legacy converters; typed in a later domain pass. Do not add NEW anys.
 */
/**
 * useOfferApply — the app-side apply/remove core for the P7b Offers vertical
 * (contract "APPLY / REMOVE RECIPES", fork Cart.tsx parity).
 *
 * Five members, one job each:
 *  - selectOfferAndCommit  customer SAVE / buy-stage CONTINUE → atomic swap,
 *                          direct freebie apply, or "open the picker" verdict
 *  - removeAppliedOffer    explicit customer removal (bag "Remove" tap)
 *  - handleCartDrivenRemoval  revalidation/auto removal (shows the removal
 *                          notice unless silent)
 *  - commitPickedFreebies  freebie-picker CONFIRM commit
 *  - autoApplyOffer        the machine's apply (useOfferAutoApply only)
 *
 * All cart reads go through store.getState() at CALL time, not the render
 * snapshot — these run from async event handlers and effects, and a stale
 * cartItems list would skip freebie rows added since the last render
 * (removeAllGetItems iterates the list it is handed).
 *
 * Contract trap 3: `applyOffer`/`swapCartOffer` alone never clears a PREVIOUS
 * offer's committed freebie rows (cartItems rows with isGetItem:true) — every
 * apply/remove path here therefore runs removeAllGetItems + emptyGetItems
 * first. (The fork's direct-apply branch had removeAllGetItems commented out,
 * which could orphan the outgoing offer's freebie rows; the contract mandates
 * the sweep, so this port restores it.)
 *
 * Lane "offers" (2026-10-06):
 *  - routing has ONE gate, SDK routeOfferCommit (fixes the G2 £0 swap);
 *  - the sameOrLess ceiling runs on the live cart before every freebie route;
 *  - auto-apply latch (decision 4): EVERY customer offer action latches
 *    `offerSession.autoApplyOptOut` whatever its outcome; machine paths
 *    (handleCartDrivenRemoval, autoApplyOffer) never do;
 *  - celebration: customer applies open `cart.offerModal`; auto-apply never.
 *
 * Lane "loyalty-visual" (D3, fork parity — CartRewardsCard
 * `blockedByLoyalty`): a XENO reward row in the bag locks offers while none
 * is applied (SDK isOfferLockedByLoyaltyReward), checked on the live cart
 * before any write, event or celebration: selectOfferAndCommit answers
 * `blocked: "loyaltyReward"`, commitPickedFreebies and autoApplyOffer
 * answer false. An offer applied BEFORE the reward is not locked: it stays,
 * and swapping it still works (the fork's asymmetry, kept).
 */
import { useDispatch, useStore } from "react-redux";
import {
  applyOffer,
  swapCartOffer,
  removeCartOffer,
  openOfferModal,
  openOfferRemovalModal,
} from "@cx-sdk/ordering/state/cart.slice";
import {
  applySameOrLessCeiling,
  routeOfferCommit,
} from "@cx-sdk/ordering/offer/offerCommitRules";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { hasOffer } from "@cx-sdk/ordering/offer/offersSheetLogic";
import { isOfferLockedByLoyaltyReward } from "@cx-sdk/ordering/loyalty/loyaltyOfferRules";
import useCartHook from "../menuHooks/useCartHook";
import useOfferHook from "./useOfferHook";
import useOfferSavings from "./useOfferSavings";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import { resetAppliedBarCelebration } from "../../utils/offerCelebration";
import {
  markOfferAutoApplied,
  optOutOfAutoApply,
} from "../../redux/features/offerSession/offerSession.slice";

/** Verdict of a customer commit (sheet SAVE / buy-stage CONTINUE). */
export interface OfferCommitResult {
  /** True when the offer landed on the bill in this call. */
  applied: boolean;
  /**
   * True when the offer needs the customer to pick freebies first — the
   * caller must open FreebiePickerSheet and later call commitPickedFreebies.
   */
  needsPicker?: boolean;
  /**
   * Present ONLY when the sameOrLess ceiling filtered the offer — hand THIS
   * to the picker (callers use `result.offer ?? offer`).
   */
  offer?: SavingsOffer;
  /**
   * Refused; nothing was written: the sameOrLess ceiling, an item offer
   * whose get side resolved to nothing (it could only land at £0), or a
   * XENO reward in the bag with no offer applied (D3 lock).
   */
  blocked?: "sameOrLess" | "noGetItems" | "loyaltyReward";
}

export interface CommitPickedFreebiesArgs {
  offer: any;
  /**
   * The picked getItems entries, applyOfferByItem-shaped: each element is
   * `{...getItemsEntry, entities: pickedEntity, quantity}` — i.e. the
   * converter-resolved `offer.getItems.items` entry for the chosen entity
   * (relation "or": exactly one; relation "and": every plain entry;
   * group-wise: the SDK getGroupWisePickState commit lines — exactly
   * getQuantity units, re-stamped with the shared discount).
   */
  picks: any[];
}

/** Only the slice this hook reads at call time (house pattern). */
interface OfferApplyRootState {
  cart?: {
    cartItems?: any[];
    cartOffer?: any;
    cartOfferSource?: "offer" | "loyalty";
  };
}

function useOfferApply() {
  const dispatch = useDispatch();
  const store = useStore();
  const { removeAllGetItems, emptyGetItems } = useCartHook();
  const { applyDirectlyApplicableGetItemsOffer, applyOfferByItem } =
    useOfferHook();
  const { savingFor } = useOfferSavings();

  const liveCart = (): NonNullable<OfferApplyRootState["cart"]> =>
    (store.getState() as OfferApplyRootState)?.cart ?? {};

  /** D3: a XENO reward in the live bag locks offers while none is applied. */
  const lockedByReward = (): boolean => {
    const cart = liveCart();
    return isOfferLockedByLoyaltyReward(cart?.cartItems, cart?.cartOffer);
  };

  /**
   * Sweep the OUTGOING offer's freebies before any slot write (trap 3):
   * committed rows (cartItems, isGetItem:true) and staged picker rows
   * (cart.getItems) both go.
   */
  const clearFreebieRows = () => {
    removeAllGetItems(liveCart()?.cartItems);
    emptyGetItems();
  };

  /** Item 33: a CUSTOMER apply opens the non-blocking celebration card. */
  const celebrate = (offer: Pick<SavingsOffer, "_id" | "name"> | null | undefined) => {
    dispatch(openOfferModal({ id: offer?._id, name: offer?.name }));
  };

  /**
   * Customer SAVE / buy-stage CONTINUE — contract "Sheet select" + "Choice
   * path" recipes, routed by the ONE SDK gate (routeOfferCommit):
   *  - "swap": ATOMIC swap (swapCartOffer replaces the slot and the get-item
   *    rows in one action, so a rejected commit can never leave discounted
   *    rows attached to no offer). Bill-wise and least-value offers.
   *  - "direct": a fixed grant (single item / "and" list of plain items)
   *    lands as real isGetItem rows, then the offer takes the slot.
   *  - "picker": a genuine choice (or a customizable/variant freebie) —
   *    `needsPicker` for the caller to open FreebiePickerSheet. An item offer
   *    with get candidates NEVER swaps: swapCartOffer stamps no row, so a
   *    single "and" customizable freebie used to realise £0 (G2).
   *  - "blocked": an item offer whose get side resolved to nothing — it
   *    could only land at £0 behind a "Reward applied!" card; refused with
   *    `blocked`, nothing written (decision 2: blocked, never faked).
   * Before "direct"/"picker" the sameOrLess ceiling (31b) runs on the LIVE
   * cart; blocked → no cart writes at all.
   */
  const selectOfferAndCommit = async (offer: any): Promise<OfferCommitResult> => {
    try {
      if (!offer || Object.keys(offer).length === 0) {
        return { applied: false };
      }
      // Decision 4 — every customer offer action latches auto-apply off for
      // the session, whatever its outcome.
      dispatch(optOutOfAutoApply());
      // Loyalty owns the slot: applyOffer would refuse the cross-source
      // write AFTER the freebie rows landed, orphaning them. Refuse up
      // front instead (P7c wires the explicit loyalty↔offer swap).
      if (liveCart()?.cartOfferSource === "loyalty") {
        return { applied: false };
      }
      if (lockedByReward()) {
        return { applied: false, blocked: "loyaltyReward" };
      }

      const saving = savingFor(offer);
      const route = routeOfferCommit(offer, saving);

      if (route === "blocked") {
        return { applied: false, blocked: "noGetItems" };
      }

      if (route === "swap") {
        clearFreebieRows();
        dispatch(swapCartOffer({ next: offer, source: "offer" }));
        captureKioskEvent(KioskEventName.OfferSwapped, {
          to: offer?._id,
          saving: saving.amount,
          certainty: saving.certainty,
        });
        celebrate(offer);
        return { applied: true };
      }

      const ceiling = applySameOrLessCeiling(offer, liveCart()?.cartItems);
      if (ceiling.kind === "blocked") {
        return { applied: false, blocked: "sameOrLess" };
      }

      if (route === "picker") {
        // `offer` rides along ONLY when the ceiling filtered it, so the
        // pass-through verdict stays exactly { applied:false, needsPicker:true }.
        return ceiling.offer === offer
          ? { applied: false, needsPicker: true }
          : { applied: false, needsPicker: true, offer: ceiling.offer };
      }

      const directOffer = ceiling.offer;
      clearFreebieRows();
      await applyDirectlyApplicableGetItemsOffer(directOffer);
      dispatch(applyOffer({ offer: directOffer }));
      // Fork parity: the direct-apply commit emits no analytics event
      // (only the atomic swap path carries OfferSwapped).
      celebrate(directOffer);
      return { applied: true };
    } catch {
      // A failed commit must never take the bag down (Rule 2). Sweep any
      // half-landed freebie rows so nothing discounted survives unattached.
      try {
        clearFreebieRows();
      } catch {
        /* the sweep itself must never throw further */
      }
      return { applied: false };
    }
  };

  /**
   * Explicit removal (bag "Remove" tap) — contract "Remove" recipe. Direct
   * removal shows NO notice (the notice is for cart-driven removal only).
   * A customer action: latches auto-apply off (decision 4) BEFORE the slot
   * empties, so nothing can re-apply into the gap.
   */
  const removeAppliedOffer = (): void => {
    dispatch(optOutOfAutoApply());
    clearFreebieRows();
    dispatch(removeCartOffer({ source: "offer" }));
    // A remove-then-reapply of the same offer must pop the row again.
    resetAppliedBarCelebration();
    captureKioskEvent(KioskEventName.OfferOptedOut, {});
  };

  /**
   * Cart-driven (auto) removal — fork handleRemoveOffer(silent) parity: the
   * revalidation effect calls this when the applied offer no longer holds.
   * `silent` skips the "reward removed" notice — used when another modal
   * (e.g. the out-of-stock error) is already being shown. A MACHINE path:
   * never latches auto-apply (an auto offer may re-apply once eligible).
   */
  const handleCartDrivenRemoval = (silent: boolean): void => {
    const cartOffer = liveCart()?.cartOffer;
    if (!cartOffer || Object.keys(cartOffer).length === 0) return;
    if (!silent) {
      dispatch(openOfferRemovalModal(cartOffer));
    }
    clearFreebieRows();
    // Unconditional clear (no source), fork parity — auto-removal must win
    // regardless of which system owns the slot.
    dispatch(removeCartOffer());
    resetAppliedBarCelebration();
    // Fork parity: no analytics event on the auto-removal path.
  };

  /**
   * Freebie-picker CONFIRM — contract "Picker commit" recipe:
   * emptyGetItems → Promise.all(picks.map(applyOfferByItem)) → applyOffer.
   * applyOfferByItem loops redeemGetItem(...) → addGetItemToCart(...), so
   * the picks land as REAL cart rows (isGetItem:true, discounted /
   * undiscounted prices stamped) before the offer takes the slot.
   * Resolves true once applyOffer was dispatched, false otherwise.
   */
  const commitPickedFreebies = async ({
    offer,
    picks,
  }: CommitPickedFreebiesArgs): Promise<boolean> => {
    try {
      // Decision 4: a picker commit is a customer offer action.
      dispatch(optOutOfAutoApply());
      if (liveCart()?.cartOfferSource === "loyalty") {
        // Same guard as selectOfferAndCommit: applyOffer would refuse after
        // the rows landed.
        return false;
      }
      if (lockedByReward()) return false;
      // Trap-3 sweep: a previously applied offer's committed freebie rows
      // must not survive the new offer's commit.
      removeAllGetItems(liveCart()?.cartItems);
      emptyGetItems();
      await Promise.all(
        (Array.isArray(picks) ? picks : []).map((item: any) => {
          if (item?.entities && Object.keys(item.entities).length > 0) {
            return applyOfferByItem(item);
          }
          return undefined;
        }),
      );
      dispatch(applyOffer({ offer }));
      // Fork parity: the picker commit emits no analytics event.
      celebrate(offer);
      return true;
    } catch {
      // Partial commit (some rows landed, offer did not) would charge or
      // discount wrongly — roll the freebie rows back and stay silent
      // (Rule 2: the picker stays usable, nothing crashes).
      try {
        clearFreebieRows();
      } catch {
        /* the rollback itself must never throw further */
      }
      return false;
    }
  };

  /**
   * Item 34 — the MACHINE's apply, called only by useOfferAutoApply with a
   * cart-neutral offer pickSessionAutoApplyOffer chose. Same money path as a
   * manual SAVE of that offer (sweep → swapCartOffer), but no celebration
   * card and no latch: it gets the row pop + "Applied for you" caption.
   * Never replaces an occupied slot, never applies under the D3 lock.
   * Returns whether the slot now holds it.
   */
  const autoApplyOffer = (offer: SavingsOffer): boolean => {
    try {
      if (lockedByReward()) return false;
      if (!hasOffer(offer)) return false;
      const current = liveCart()?.cartOffer;
      if (hasOffer(current)) return current?._id === offer._id;
      const saving = savingFor(offer);
      clearFreebieRows();
      dispatch(swapCartOffer({ next: offer, source: "offer" }));
      dispatch(markOfferAutoApplied(String(offer._id ?? "")));
      captureKioskEvent(KioskEventName.OfferAutoApplied, {
        offer_id: offer._id,
        saving: saving.amount,
        certainty: saving.certainty,
      });
      return liveCart()?.cartOffer?._id === offer._id;
    } catch {
      return false;
    }
  };

  return {
    selectOfferAndCommit,
    removeAppliedOffer,
    handleCartDrivenRemoval,
    commitPickedFreebies,
    autoApplyOffer,
  };
}

export default useOfferApply;
