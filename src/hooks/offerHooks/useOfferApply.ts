/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offers and cart rows flow through untyped from the SDK cart slice /
 * legacy converters; typed in a later domain pass. Do not add NEW anys.
 */
/**
 * useOfferApply — the app-side apply/remove core for the P7b Offers vertical
 * (contract "APPLY / REMOVE RECIPES", fork Cart.tsx parity).
 *
 * Four members, one job each:
 *  - selectOfferAndCommit  sheet SAVE tap → atomic swap, direct freebie
 *                          apply, or "open the picker" verdict
 *  - removeAppliedOffer    explicit customer removal (bag "Remove" tap)
 *  - handleCartDrivenRemoval  revalidation/auto removal (shows the removal
 *                          notice unless silent)
 *  - commitPickedFreebies  freebie-picker CONFIRM commit
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
 */
import { useDispatch, useStore } from "react-redux";
import {
  applyOffer,
  swapCartOffer,
  removeCartOffer,
  openOfferRemovalModal,
} from "@cx-sdk/ordering/state/cart.slice";
import useCartHook from "../menuHooks/useCartHook";
import useOfferHook from "./useOfferHook";
import useOfferSavings from "./useOfferSavings";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/** Verdict of a sheet SAVE commit. */
export interface OfferCommitResult {
  /** True when the offer landed on the bill in this call. */
  applied: boolean;
  /**
   * True when the offer needs the customer to pick freebies first — the
   * caller must open FreebiePickerSheet and later call commitPickedFreebies.
   */
  needsPicker?: boolean;
}

export interface CommitPickedFreebiesArgs {
  offer: any;
  /**
   * The picked getItems entries, applyOfferByItem-shaped: each element is
   * `{...getItemsEntry, entities: pickedEntity, quantity}` — i.e. the
   * converter-resolved `offer.getItems.items` entry for the chosen entity
   * (relation "or": exactly one; relation "and": every plain entry).
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
  const {
    applyDirectlyApplicableGetItemsOffer,
    applyOfferByItem,
    isItemBasedGetOnlyOfferDirectlyApplicable,
  } = useOfferHook();
  const { savingFor } = useOfferSavings();

  const liveCart = (): NonNullable<OfferApplyRootState["cart"]> =>
    (store.getState() as OfferApplyRootState)?.cart ?? {};

  /**
   * Sweep the OUTGOING offer's freebies before any slot write (trap 3):
   * committed rows (cartItems, isGetItem:true) and staged picker rows
   * (cart.getItems) both go.
   */
  const clearFreebieRows = () => {
    removeAllGetItems(liveCart()?.cartItems);
    emptyGetItems();
  };

  /**
   * Sheet SAVE tap — contract "Sheet select" + "Choice path" recipes.
   *
   * No choice needed → ATOMIC swap (swapCartOffer replaces the slot and the
   * get-item rows in one action, so a rejected commit can never leave
   * discounted rows attached to no offer). Choice needed → the directly
   * applicable subset (single fixed grant / "and" list of plain items) is
   * applied here; a genuine choice returns `needsPicker` for the caller to
   * open FreebiePickerSheet.
   */
  const selectOfferAndCommit = async (offer: any): Promise<OfferCommitResult> => {
    try {
      if (!offer || Object.keys(offer).length === 0) {
        return { applied: false };
      }
      // Loyalty owns the slot: applyOffer would refuse the cross-source
      // write AFTER the freebie rows landed, orphaning them. Refuse up
      // front instead (P7c wires the explicit loyalty↔offer swap).
      if (liveCart()?.cartOfferSource === "loyalty") {
        return { applied: false };
      }

      const saving = savingFor(offer);

      // INTEGRATOR FIX (P7b trace): the direct-apply check must be gated on
      // the OFFER SHAPE (contract "Choice path": type.name==="item" +
      // getItems — fork handleApplyOffer's exact guard, Cart.tsx:855), NOT
      // nested under requiresChoice. A single-"and" fixed freebie reports
      // requiresChoice:false (offerSavings' documented "choice-free"
      // regression case), and the atomic swap stamps NO cart row — the
      // freebie would never land and the bill would realise £0 (scenario 5).
      const hasItemGetSide =
        offer?.type?.name === "item" &&
        offer?.getItems &&
        Object.keys(offer.getItems).length > 0 &&
        offer?.isAvailable;

      if (hasItemGetSide && isItemBasedGetOnlyOfferDirectlyApplicable(offer)) {
        clearFreebieRows();
        await applyDirectlyApplicableGetItemsOffer(offer);
        dispatch(applyOffer({ offer }));
        // Fork parity: the direct-apply commit emits no analytics event
        // (only the atomic swap path carries OfferSwapped).
        return { applied: true };
      }
      if (saving.requiresChoice) {
        return { applied: false, needsPicker: true };
      }

      clearFreebieRows();
      dispatch(swapCartOffer({ next: offer, source: "offer" }));
      captureKioskEvent(KioskEventName.OfferSwapped, {
        to: offer?._id,
        saving: saving.amount,
        certainty: saving.certainty,
      });
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
   */
  const removeAppliedOffer = (): void => {
    clearFreebieRows();
    dispatch(removeCartOffer({ source: "offer" }));
    // TODO(P7b-deferred): resetAppliedBarCelebration — the applied-bar
    // celebration module is not ported in P7b (contract: leave the TODO).
    captureKioskEvent(KioskEventName.OfferOptedOut, {});
  };

  /**
   * Cart-driven (auto) removal — fork handleRemoveOffer(silent) parity: the
   * revalidation effect calls this when the applied offer no longer holds.
   * `silent` skips the "reward removed" notice — used when another modal
   * (e.g. the out-of-stock error) is already being shown.
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
    // TODO(P7b-deferred): resetAppliedBarCelebration (see removeAppliedOffer).
    // Fork parity: no analytics event on the auto-removal path.
  };

  /**
   * Freebie-picker CONFIRM — contract "Picker commit" recipe:
   * emptyGetItems → Promise.all(picks.map(applyOfferByItem)) → applyOffer.
   * applyOfferByItem loops redeemGetItem(...) → addGetItemToCart(...), so
   * the picks land as REAL cart rows (isGetItem:true, discounted /
   * undiscounted prices stamped) before the offer takes the slot.
   */
  const commitPickedFreebies = async ({
    offer,
    picks,
  }: CommitPickedFreebiesArgs): Promise<void> => {
    try {
      if (liveCart()?.cartOfferSource === "loyalty") {
        // Same guard as selectOfferAndCommit: applyOffer would refuse after
        // the rows landed.
        return;
      }
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
    } catch {
      // Partial commit (some rows landed, offer did not) would charge or
      // discount wrongly — roll the freebie rows back and stay silent
      // (Rule 2: the picker stays usable, nothing crashes).
      try {
        clearFreebieRows();
      } catch {
        /* the rollback itself must never throw further */
      }
    }
  };

  return {
    selectOfferAndCommit,
    removeAppliedOffer,
    handleCartDrivenRemoval,
    commitPickedFreebies,
  };
}

export default useOfferApply;
