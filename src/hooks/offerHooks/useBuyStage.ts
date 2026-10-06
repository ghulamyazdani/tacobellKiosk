/**
 * useBuyStage — the in-bag BOGO "buy stage" journey host (lane "offers",
 * item 31; fork Cart.tsx:693-840 parity minus the 900 ms auto-advance).
 *
 * A locked bogoBuySide reward opens a stage where the customer adds the
 * qualifying PAID rows, then CONTINUE hands the offer to the one commit path
 * (useOfferApply.selectOfferAndCommit). Those rows are real cart rows (the
 * sameOrLess ceiling and the freebie lock read cartItems), so abandoning the
 * journey must restore the cart: ONE snapshot per journey, taken before the
 * first row lands, restored on BACK / X / picker dismiss / bag close unless
 * the journey's offer made it onto the bill.
 *
 * The snapshot is a ref here, never redux: BagSheet stays mounted on the Menu
 * page, so it survives the RewardsSheet → stage → picker hand-offs. Nothing
 * rolls back in an unmount cleanup — idle → /start's reset owns that (and a
 * StrictMode remount must not undo the cart). Nothing here navigates.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useSelector, useStore } from "react-redux";
import type {
  BuyStageMode,
  BuyStageView,
} from "@cx-sdk/ordering/offer/buyStageUtils";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import type { CartSnapshotRow } from "@cx-sdk/ordering/cart/cartEngine";
import useCartHook from "../menuHooks/useCartHook";
import useOfferApply, { type OfferCommitResult } from "./useOfferApply";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

export interface BuyStage {
  offer: SavingsOffer;
  view: BuyStageView;
}

export interface BuyStageApi {
  /** The open stage, or null. */
  buyStage: BuyStage | null;
  /** True while CONTINUE's commit is in flight. */
  continuing: boolean;
  /** ADD ITEMS on a locked bogoBuySide row: arm the snapshot, open the stage. */
  start(offer: SavingsOffer, view: BuyStageView): void;
  /** BACK and X/backdrop: roll the journey back and close the stage. */
  abandon(): void;
  /**
   * CONTINUE: commit through selectOfferAndCommit. Applied or needsPicker
   * closes the stage (the snapshot stays ARMED for the picker); blocked or
   * failed keeps it open.
   */
  continueStage(): Promise<OfferCommitResult>;
  /** The picker closed: completed if the offer landed, else roll back. */
  rollbackIfAbandoned(): void;
}

interface BuyStageSnapshot {
  offerId: string | undefined;
  mode: BuyStageMode;
  items: CartSnapshotRow[];
}

/** Only the slice this hook reads (house pattern). */
interface BuyStageRootState {
  cart?: {
    cartItems?: CartSnapshotRow[];
    cartOffer?: { _id?: string } | null;
  };
}

const selectCartOfferId = (state: BuyStageRootState): string | undefined =>
  state?.cart?.cartOffer?._id;

const report = (
  event: KioskEventName,
  offerId: string | undefined,
  mode: BuyStageMode,
) => captureKioskEvent(event, { offer_id: offerId, mode });

export default function useBuyStage(open: boolean): BuyStageApi {
  const store = useStore();
  const { restoreCartItemsSnapshot } = useCartHook();
  const { selectOfferAndCommit } = useOfferApply();
  const cartOfferId = useSelector(selectCartOfferId);

  const [buyStage, setBuyStage] = useState<BuyStage | null>(null);
  const [continuing, setContinuing] = useState(false);
  const snapshotRef = useRef<BuyStageSnapshot | null>(null);
  const mountedRef = useRef(true);

  // The bag closing takes the open stage with it (React's "adjust state
  // while rendering" pattern — no effect, no extra commit). The cart
  // rollback itself is the effect below.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) setBuyStage(null);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const liveCart = () => (store.getState() as BuyStageRootState)?.cart;

  /**
   * Settle the armed journey, reading the LIVE slot: its offer landed →
   * Completed; otherwise restore the snapshot + Abandoned. Disarms first, so
   * each event fires once per journey (the release effect shares the ref).
   */
  const settle = (): void => {
    const snapshot = snapshotRef.current;
    if (!snapshot) return;
    snapshotRef.current = null;
    if (snapshot.offerId && liveCart()?.cartOffer?._id === snapshot.offerId) {
      report(KioskEventName.OfferBuyStageCompleted, snapshot.offerId, snapshot.mode);
      return;
    }
    try {
      // Paid rows only (planCartSnapshotRestore); never emptyCart — that
      // would also wipe offerRemovalModal / offerModal.
      restoreCartItemsSnapshot(snapshot.items);
    } catch {
      // Rule 2: a failed rollback leaves the cart as it is and still closes.
    }
    report(KioskEventName.OfferBuyStageAbandoned, snapshot.offerId, snapshot.mode);
  };

  const start = (offer: SavingsOffer, view: BuyStageView): void => {
    try {
      // A snapshot armed by a DIFFERENT offer's journey is settled first, so
      // this one never runs under a foreign baseline (fork :700-712); the
      // fresh snapshot then reads the restored live cart.
      if (snapshotRef.current && snapshotRef.current.offerId !== offer?._id) {
        settle();
      }
      if (!snapshotRef.current) {
        snapshotRef.current = {
          offerId: offer?._id,
          mode: view.mode,
          items: JSON.parse(
            JSON.stringify(liveCart()?.cartItems ?? []),
          ) as CartSnapshotRow[],
        };
        report(KioskEventName.OfferBuyStageOpened, offer?._id, view.mode);
      }
      setBuyStage({ offer, view });
    } catch {
      // Rule 2: a journey that cannot start leaves the bag as it was.
    }
  };

  const abandon = (): void => {
    settle();
    setBuyStage(null);
  };

  const continueStage = async (): Promise<OfferCommitResult> => {
    const stage = buyStage;
    if (!stage) return { applied: false };
    setContinuing(true);
    try {
      const result = await selectOfferAndCommit(stage.offer);
      // Applied: the release effect settles the snapshot. needsPicker: the
      // snapshot stays armed for the picker. Blocked/failed: stay open.
      if (mountedRef.current && (result.applied || result.needsPicker)) {
        setBuyStage(null);
      }
      return result;
    } catch {
      return { applied: false };
    } finally {
      if (mountedRef.current) setContinuing(false);
    }
  };

  const rollbackIfAbandoned = (): void => settle();

  // Release: the journey completed the moment its offer holds the slot —
  // from then on the paid rows belong to the applied offer.
  useEffect(() => {
    const snapshot = snapshotRef.current;
    if (!snapshot?.offerId || cartOfferId !== snapshot.offerId) return;
    snapshotRef.current = null;
    report(KioskEventName.OfferBuyStageCompleted, snapshot.offerId, snapshot.mode);
  }, [cartOfferId]);

  // Bag closed mid-journey (stage or picker open) → roll back (dispatch
  // only). A no-op when nothing is armed, including the first mount.
  const onBagClosed = useEffectEvent(() => settle());
  useEffect(() => {
    if (!open) onBagClosed();
  }, [open]);

  return {
    buyStage,
    continuing,
    start,
    abandon,
    continueStage,
    rollbackIfAbandoned,
  };
}
