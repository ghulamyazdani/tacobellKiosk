/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart rows / bill / menu data flow through untyped from the legacy slices
 * and converters; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import moment from "dayjs";
import {
  selectCart,
  cartQuantity,
  selectCartOffer,
  emptyCart,
  setCartInstructions,
  setAmount,
  openOfferRemovalModal,
  reconcileFreebieAllocation,
} from "@cx-sdk/ordering/state/cart.slice";
import { selectFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { isSameOrLessViolated } from "@cx-sdk/ordering/offer/offerCommitRules";
import { getBillOfferDiscount } from "@cx-sdk/ordering/loyalty/loyaltyOfferRules";
import {
  addLoyaltyPoints,
  selectCoupons,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { selectPhoneNumber } from "@cx-sdk/core/customer/customerInfo.slice";
import {
  openMakeItAMealModal,
  openMakeItAMealSession,
  openTier1Modal,
  setTeir1SelectedEntity,
  setTier1BottomSheet,
  setTier1SelectedCustomization,
  setIsForceOpenMakeItAMealModal,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setAppliedCharges } from "@cx-sdk/ordering/state/order.slice";
import { consolidateGetItemsForDisplay } from "@cx-sdk/ordering/cart/cartDisplayUtils";
import {
  evaluateCheckoutEntryGuards,
  getCheckoutNetAmount,
  resolveCheckoutStockDecision,
} from "@cx-sdk/ordering/checkout/checkoutPreflight";
import {
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { selectTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import {
  selectEntpShowCategory,
  setMinMaxErroredBaseItems,
  setUpdatedBaseItems,
} from "@cx-sdk/catalog/state/Menu.slice";
import { useLazyGetServerTimeQuery } from "@cx-sdk/catalog/services/settingsApi";
import { useGetOutOfStockMutation } from "@cx-sdk/catalog/services/outOfStockApi";
import type { CheckoutStockSweep } from "@cx-sdk/catalog/oos/checkoutStockSweep";
import { getTotalValueWithApplyAddonPrice } from "@cx-sdk/ordering/customization/pricing";
import {
  selectLicenseDetails,
  selectTabId,
} from "@cx-sdk/core/auth/authentication.slice";
import {
  setOutOfStockItems,
  setSelectedEntity,
} from "../../redux/features/menuSelections/menuSelections.slice";
import { selectAutoAppliedOfferId } from "../../redux/features/offerSession/offerSession.slice";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useCartBill, { billTotal } from "../../hooks/cartHooks/useCartBill";
import useMenuConverters from "../../hooks/menuHooks/useMenuConverters";
import useSchedulerConverter from "../../hooks/schedulerHooks/useSchedulerConverter";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useOfferHook from "../../hooks/offerHooks/useOfferHook";
import useOfferSavings from "../../hooks/offerHooks/useOfferSavings";
import useOfferApply from "../../hooks/offerHooks/useOfferApply";
import useBuyStage from "../../hooks/offerHooks/useBuyStage";
import useOfferAutoApply from "../../hooks/offerHooks/useOfferAutoApply";
import useLoyalty from "../../hooks/loyalty/useLoyalty";
import useAdaActive from "../../hooks/utils/useAdaActive";
import { useCartRehydrated } from "../../hooks/utils/useCartRehydrated";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import {
  getCelebratedBarKey,
  setCelebratedBarKey,
} from "../../utils/offerCelebration";
import { ADA_SHEET_HEIGHT } from "../stage/KioskStage";
import BagItemRow, { isRowUnavailable } from "./BagItemRow";
import RemoveItemModal from "./RemoveItemModal";
import OfferTierHost from "../offer/OfferTierHost";
import OfferRemovalNotice from "../offer/OfferRemovalNotice";
import closeIcon from "../../assets/icons/close.svg";
import tbBell from "../../assets/brand/tb-bell.svg";
import {
  orderTypeKindOf,
  resolveOrderTypeSwitchTarget,
  type SwitchablePipeline,
} from "@cx-sdk/ordering/cart/orderTypeTarget";
import {
  selectPipelines,
  selectSelectedPipeline,
} from "@cx-sdk/catalog/state/pipeline.slice";
import { selectOrderTypeSwitchNotice } from "../../redux/features/menuSelections/menuSelections.slice";
import useKioskOpenServices from "../../hooks/kioskOpen/useKioskOpenServices";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import useLocalized, { type PipelineLabel } from "../../hooks/utils/useLocalized";
import { ErrorBoundary } from "../../ErrorBoundary";

// Lazy bag parts — ONE dynamic module (see bagLazyParts: a second dynamic
// entry would grow the boot path). `await import()`, never `.then`: a failed
// chunk must reach chunkRecovery's reload. Each mount sits behind a local
// ErrorBoundary (outside its Suspense), so a chunk that fails inside
// chunkRecovery's no-reload window degrades that part only — rows, totals
// and PAY stay usable. The rail's locked prop contract
// is { onDetour? }; the offer-only sheets (rewards, freebie picker, buy
// stage) and the celebration keep the boot path inside its P9f budget.
const CompleteYourMealRail = lazy(async () => ({
  default: (await import("./bagLazyParts")).CompleteYourMealRail,
}));
const RewardsSheet = lazy(async () => ({
  default: (await import("./bagLazyParts")).RewardsSheet,
}));
const FreebiePickerSheet = lazy(async () => ({
  default: (await import("./bagLazyParts")).FreebiePickerSheet,
}));
const BuyStageSheet = lazy(async () => ({
  default: (await import("./bagLazyParts")).BuyStageSheet,
}));
const OfferAppliedCelebration = lazy(async () => ({
  default: (await import("./bagLazyParts")).OfferAppliedCelebration,
}));

/** Figma 1:3171: the sheet's top sits at stage y 244. ADA: ADA_SHEET_HEIGHT. */
const BAG_SHEET_HEIGHT = 1676;

// bag-pdp lane — the order-type switch flow + its removal notice and the
// "edit how many" numpad, in the same ONE dynamic module.
const OrderTypeSwitchFlow = lazy(async () => ({
  default: (await import("./bagLazyParts")).OrderTypeSwitchFlow,
}));
const OrderTypeSwitchNotice = lazy(async () => ({
  default: (await import("./bagLazyParts")).OrderTypeSwitchNotice,
}));
const EditHowManyModal = lazy(async () => ({
  default: (await import("./bagLazyParts")).EditHowManyModal,
}));
// audit-fixes U3 — the cooking-instructions sheet, same chunk.
const InstructionsSheet = lazy(async () => ({
  default: (await import("./bagLazyParts")).InstructionsSheet,
}));

/**
 * How long the CTA bar swallows taps after a rewards / picker / buy-stage
 * sheet closes, or the bag opens (ReachZone's exit-guard pattern). SAVE,
 * CONFIRM and CONTINUE sit over PAY / LOG-IN and close instantly, and the
 * menu's VIEW MY BAG overlaps PAY, so the second tap of a double tap would
 * start checkout.
 */
const CTA_TAP_GUARD_MS = 500;

/** A bill figure at the cent (U4: the column must add up on screen). */
const round2 = (value: number) => Math.round(value * 100) / 100;

interface BagSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * P7c (locked decision 5b) — LOG-IN & GET REWARDS stops being inert. The
   * loyalty overlays (LoyaltyLoginModal / LoyaltyRewardsSheet) are mounted by
   * the Menu page, so the bag asks for them through these two callbacks
   * instead of importing the components (avoids a bag↔loyalty import cycle
   * and keeps overlay ownership on one page). Both optional: with neither
   * wired — or with loyalty off — the button keeps P7a's inert "coming soon"
   * pressed state, so nothing regresses before the integrator lands.
   *
   * INTEGRATOR: pass `onOpenLoyaltyLogin` (open LoyaltyLoginModal) and
   * `onOpenLoyaltyRewards` (open LoyaltyRewardsSheet with isTimerOn:false).
   * The bag already applies the contract's entry-tap branch table before
   * calling `onOpenLoyaltyRewards`, so the sheet may assume it is allowed.
   */
  onOpenLoyaltyLogin?: () => void;
  onOpenLoyaltyRewards?: () => void;
}

/**
 * A XENO coupon carries its cost in `extra_fields` as a name/value pair, not
 * a typed field (contract §SLICE SURFACE). Refunds read it back off the cart
 * row, which keeps the coupon blob through getAllLoyaltyItemsFromMenu.
 */
const getLoyaltyPointsValue = (row: any) =>
  row?.extra_fields?.find((field: any) => field?.name === "Points Value")?.value;

/**
 * A PAY whose stock check flagged nothing: every row is in stock and on
 * schedule, so a stale flag from an earlier PAY clears — on the LIVE row,
 * everything else as the bill priced it.
 */
const clearStockFlags = (row: unknown): unknown => {
  if (!isRowUnavailable(row)) return row;
  const flagged = row as { selectedVariant?: Record<string, unknown> | null };
  return {
    ...flagged,
    outOfStock: false,
    isAvailable: true,
    ...(flagged.selectedVariant
      ? { selectedVariant: { ...flagged.selectedVariant, outOfStock: false } }
      : {}),
  };
};

/**
 * Offer photos are DEFERRED in P7b (resolveLivePhotoUrl not wired) — the
 * rewards rows render the brand bell, purple-tinted via CSS mask, over the
 * grey plate (OfferRow precedent; the SVG's own fills are white). The url()
 * is quoted: the inlined SVG data URI carries ' ( ), so an unquoted url() is
 * invalid and the bell paints as a solid square.
 */
const bellMaskStyle: CSSProperties = {
  WebkitMaskImage: `url("${tbBell}")`,
  maskImage: `url("${tbBell}")`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskPosition: "center",
  maskPosition: "center",
};

/**
 * Applied-row celebration (lane offers, item 33; fork OffersSheet applied-bar
 * parity). Remounted per `key={barKey}` (`${offerId}:${amount}`), it plays
 * the "Save £X" chip pop + plate pulse once per applied VALUE: the spent key
 * lives outside React (utils/offerCelebration), so a bag reopen with the same
 * offer and amount renders quiet, while a new offer, a changed amount, or a
 * remove-then-reapply (the removal paths reset the key) plays again. `play`
 * is fixed at first render, so the first painted frame already carries the
 * classes (no blink). Pure CSS that ends on its own — no timers, no text.
 */
function AppliedRowPop({
  barKey,
  children,
}: {
  barKey: string;
  children: (play: boolean) => ReactNode;
}) {
  const [play] = useState(() => barKey !== getCelebratedBarKey());
  useEffect(() => {
    setCelebratedBarKey(barKey);
  }, [barKey]);
  return children(play);
}

/**
 * MY BAG — Figma "My Bag / Populated" (1:3171 / 1:3236): white rounded-top
 * sheet over the purple-tinted menu. Header MY BAG (n) + X, the EAT IN /
 * TAKE OUT toggle (bag-pdp lane: switches via OrderTypeSwitchFlow),
 * consolidated cart rows, Complete Your Meal rail, Sub Total / Total bill
 * lines, LOG-IN & GET REWARDS + PAY (checkout preflight, locked decision 5).
 *
 * Route-driven (locked decision 1): /cart renders the Menu page with this
 * sheet open; onClose navigates back to /menu. Reads redux directly; the
 * bill is LOCAL state recomputed per cart change (contract A3, fork parity)
 * with setAmount(getCheckoutNetAmount(bill)) mirrored to the slice.
 *
 * P7b adds the Offers vertical: Rewards section (entry row → RewardsSheet;
 * applied row with Remove + −£X per Figma 1:3137), Discounts bill line,
 * ORDER & PAY CTA while discounting, the contract revalidation effect
 * (cart-driven removal → OfferRemovalNotice), and the FreebiePickerSheet
 * hand-off for choice-requiring freebie offers.
 *
 * P7c adds the XENO loyalty legs the bag owns: the reward-row reversal recipe
 * handed to BagItemRow (remove + refund "Points Value" + revoke), the
 * auto-reversal effect that undoes a redemption once the paid order is gone,
 * and the LOG-IN & GET REWARDS entry point (decision 5b). Rewards are
 * ORDINARY cart rows and never touch `cartOffer` — a XENO reward and an
 * applied offer coexist (contract trap 8).
 *
 * Lane offers adds: the BOGO buy stage (useBuyStage journey host — it lives
 * here because its snapshot must survive the RewardsSheet → picker hand-off),
 * revalidation check 7 (sameOrLess), auto-apply (useOfferAutoApply, after the
 * revalidation effect), the in-bag tier host for customizable freebies / buy
 * items, and the non-blocking offer-applied celebration + applied-row pop.
 */
export default function BagSheet({
  open,
  onClose,
  onOpenLoyaltyLogin,
  onOpenLoyaltyRewards,
}: BagSheetProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const store = useStore();

  const cartRdx = useSelector(selectCart) as any;
  const totalQuantity = Number(useSelector(cartQuantity) ?? 0);
  const cartOffer = useSelector(selectCartOffer) as any;
  const filteredOffers = useSelector(selectFilteredOffers) as any[] | null;
  const currency = useCurrencySymbol();
  const tabType = useSelector(selectTabType) as any;
  const showEntpCategory = useSelector(selectEntpShowCategory) as any;
  const tabId = useSelector(selectTabId) as any;
  const licenseDetails = useSelector(selectLicenseDetails) as
    | { deployment_id?: string }
    | null
    | undefined;
  // P7c loyalty reads: the partner coupon list drives the entry-tap branch
  // table, the customer phone is the XENO identity (set by /phone).
  const loyaltyCoupons = useSelector(selectCoupons) as any[] | null;
  const customerPhone = useSelector(selectPhoneNumber) as any;
  const autoAppliedOfferId = useSelector(selectAutoAppliedOfferId);
  const pipelines = useSelector(selectPipelines) as SwitchablePipeline[] | null;
  const selectedPipeline = useSelector(selectSelectedPipeline) as
    | (PipelineLabel & { _id?: string })
    | null;
  const orderTypeSwitchNotice = useSelector(selectOrderTypeSwitchNotice);
  const { pipelineName } = useLocalized();
  const adaActive = useAdaActive();
  const cartRehydrated = useCartRehydrated();

  const {
    decreaseItemQuantityById,
    removeLoyaltyItemFromCart,
    isAnyLoyaltyItemPresentInCart,
    replaceCartItems,
  } = useCartHook();
  const { checkAndRevokeLoyaltyReward } = useLoyalty();
  const { fetchMenu, isAllowMultiplePunch, fetchModifierProperties } =
    useMenuConverters();
  const { updateCartItemsByMenu } = useSchedulerConverter();
  const { getIsLoyaltyOn, shouldSkipCRM, getDeactivatedPipelines } =
    useAppSettings();
  const { checkPipelineClosedFromRedux } = useKioskOpenServices();
  const { isItemWiseOfferApplicable, isBOGOOfferApplicable, isLeastValueItemOffer } =
    useOfferHook();
  const { rank } = useOfferSavings();
  const { handleCartDrivenRemoval, removeAppliedOffer } = useOfferApply();
  const [getServerTimeApi] = useLazyGetServerTimeQuery();
  const [getOutOfStock] = useGetOutOfStockMutation();

  const [checkoutInProgress, setCheckoutInProgress] = useState(false);
  const [removeCandidate, setRemoveCandidate] = useState<any>(null);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  /** Offer whose freebie choice is pending — owns FreebiePickerSheet's open state. */
  const [pickerOffer, setPickerOffer] = useState<any>(null);
  /** Inline "can't be applied" for a blocked/failed buy-stage CONTINUE (TB mounts no global error modal). */
  const [stageBlocked, setStageBlocked] = useState<string | null>(null);
  /** The pipeline the order-type switch flow is open for (null = closed). */
  const [switchTarget, setSwitchTarget] = useState<SwitchablePipeline | null>(null);
  /** The multi-quantity row whose "edit how many" numpad is open. */
  const [editHowManyRow, setEditHowManyRow] = useState<unknown>(null);
  /** U3: the cooking-instructions sheet is open. */
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const comingSoonTimer = useRef<number | null>(null);
  const stage = useBuyStage(open);

  // Arm the CTA guard on a sheet's open → closed edge (adjust state while
  // rendering); Rule 5: its timer never outlives it (or the bag).
  const sheetOpen = rewardsOpen || !!pickerOffer || !!stage.buyStage;
  const [prevSheetOpen, setPrevSheetOpen] = useState(sheetOpen);
  const [ctaTapGuard, setCtaTapGuard] = useState(false);
  if (prevSheetOpen !== sheetOpen) {
    setPrevSheetOpen(sheetOpen);
    setCtaTapGuard(!sheetOpen);
  }
  // …and on the bag's own open edge: the menu's VIEW MY BAG overlaps PAY by
  // 4–5 px, so a double tap there would start checkout.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    setCtaTapGuard(open);
  }
  useEffect(() => {
    if (!ctaTapGuard) return;
    const id = window.setTimeout(() => setCtaTapGuard(false), CTA_TAP_GUARD_MS);
    return () => window.clearTimeout(id);
  }, [ctaTapGuard]);

  const displayRows: any[] = consolidateGetItemsForDisplay(cartRdx?.cartItems);
  // Motion §3.3: only a row ADDED while the bag is open rises in — the rows
  // it opened with arrive with the panel. Latched on the OPEN edge (adjust
  // state while rendering), not at mount: BagSheet stays mounted under Menu
  // across /menu ↔ /cart. A reload on /cart opens over an EMPTY cart (the
  // Dexie restore is async), so the latch also waits for the rows or the
  // settled rehydrate (the empty-cart exit's rule below).
  const [openRows, setOpenRows] = useState<ReadonlySet<unknown> | null>(null);
  const latchRows = open && (cartRehydrated || displayRows.length > 0);
  if (latchRows !== (openRows !== null)) {
    setOpenRows(latchRows ? new Set(displayRows.map((row) => row?.itemId)) : null);
  }
  const isTakeOut = orderTypeKindOf(tabType) === "takeOut";
  const hasAppliedOffer = Boolean(cartOffer && Object.keys(cartOffer).length > 0);
  // "Identified" = the XENO lookup has a phone to key on (setPhoneNumberRdx on
  // /phone, or from the login modal). No phone ⇒ the login modal, not the
  // rewards sheet.
  const isLoyaltyIdentified = String(customerPhone ?? "").trim().length > 0;

  // Ranked offers for the Rewards entry row (decision 5). rank() is memoised
  // on the cart signature inside useOfferSavings, and calling it here warms
  // the SHARED probe caches, so the sheet later opens over precomputed
  // figures (the documented cache design). Gated on open — a closed bag on
  // the menu must not spend N+1 bill runs per cart change.
  const rankedOffers = useMemo(
    () => (open ? rank(filteredOffers ?? []) : []),
    [open, rank, filteredOffers],
  );

  // Bill — contract A3: computed here (never read the slice's netAmount for
  // display — trap 8), recomputed per cart change, on the engine and with
  // the billTotal the menu bar and the product-added Total use too.
  const bill = useCartBill(open ? cartRdx : null);

  // Mirror the net amount into the slice on each recompute so the
  // downstream checkout screens read a real value.
  useEffect(() => {
    if (!open || !bill) return;
    dispatch(setAmount(getCheckoutNetAmount(bill)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bill]);

  // Empty-cart auto-exit (contract A3 / fork Cart.tsx:536-545). P7b: the
  // applied offer goes first, WITH the removal notice (fork parity —
  // handleRemoveOffer() leads the empty-exit branch).
  // Latched like cartHadPaidRowsRef below: it fires only once the cart HELD
  // rows while the bag was open, or once AppRoutes' Dexie rehydrate has
  // settled (CartRehydratedContext). A crash-reload on /cart renders the
  // persisted cartOffer before the rehydrate lands the rows, and exiting on
  // that transient zero dropped the customer's reward; a rehydrate that
  // restores NOTHING still exits, the stale reward going with its notice.
  const bagHeldRowsRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (totalQuantity > 0) {
      bagHeldRowsRef.current = true;
      return;
    }
    if (bagHeldRowsRef.current || cartRehydrated) {
      bagHeldRowsRef.current = false;
      handleCartDrivenRemoval(false);
      dispatch(setCartInstructions(""));
      // The SDK's emptyCart also resets offerRemovalModal (session-reset
      // hygiene in the reducer) — snapshot the notice and restore it after,
      // so a cart-driven removal notice survives the bag's empty-exit
      // (scenario 7; ORIG fork kept the notice up here). Both dispatches
      // land in one batched render — no flicker.
      const notice = (store.getState() as any)?.cart?.offerRemovalModal;
      dispatch(emptyCart());
      if (notice?.isOpen) dispatch(openOfferRemovalModal(notice.data));
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, totalQuantity, cartRehydrated]);

  /**
   * AUTO-REVERSAL (contract step 8 / fork Cart.tsx:1167-1202) — a loyalty
   * benefit cannot outlive the paid order it rode in on. The moment every
   * non-loyalty row has left the cart while reward rows remain, each reward is
   * removed, its "Points Value" refunded, and the claim revoked ONCE (revoke
   * early-returns unless claimedCoupon.isClaimed — trap 1).
   *
   * The ref is load-bearing fork parity: a reward redeemed straight into an
   * EMPTY cart (off the rewards sheet, before any paid item) must NOT be
   * reversed — only a cart that once held paid rows can fall into this state.
   *
   * Deliberately NOT gated on `open`: BagSheet is mounted for the whole Menu
   * page and the last paid row can also leave the cart from the PDP or an
   * offer/out-of-stock sweep. Reelo's `redeemedLoyalty` leg of the fork effect
   * is DEFERRED (brief decision 9 — Reelo partner path is out of P7c scope).
   */
  const cartHadPaidRowsRef = useRef(false);
  useEffect(() => {
    const items: any[] = cartRdx?.cartItems ?? [];
    // Fork parity: an offer freebie counts as a "regular" row here.
    const hasPaidRows = items.some((item: any) => !item?.isLoyaltyItem);
    if (hasPaidRows) {
      cartHadPaidRowsRef.current = true;
      return;
    }
    if (!cartHadPaidRowsRef.current) return;
    cartHadPaidRowsRef.current = false;

    const loyaltyRows = items.filter((item: any) => item?.isLoyaltyItem);
    if (loyaltyRows.length === 0) return;
    loyaltyRows.forEach((item: any) => {
      removeLoyaltyItemFromCart(item?.itemId);
      const pointsValue = getLoyaltyPointsValue(item);
      // Guarded (fork guards it here too): addLoyaltyPoints has no coercion,
      // so an undefined value would NaN the balance for the rest of the
      // session.
      if (pointsValue) dispatch(addLoyaltyPoints(pointsValue));
    });
    // Rule 2: the revoke is bounded (10 s) and swallows its own failures
    // (P9b); the catch stays so a rejection can never reach the boundary.
    checkAndRevokeLoyaltyReward().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartRdx?.cartItems]);

  /**
   * REVALIDATION (contract) — drop the applied offer the moment the cart no
   * longer qualifies, via handleCartDrivenRemoval(false) → removal notice.
   * Keyed on cart changes while the bag is open (+ on open). The six checks
   * are fork Cart.tsx parity; minBillAmount is deliberately NOT revalidated
   * (billCalculation refuses the discount instead — documented, keep).
   */
  useEffect(() => {
    if (!open) return;
    if (!hasAppliedOffer) return;
    const items: any[] = cartRdx?.cartItems ?? [];
    // An EMPTY cart is the empty-cart exit's to settle (it removes the offer
    // once the bag has held rows or the rehydrate settled); judging it here
    // would drop a persisted reward on the first render after a
    // crash-reload, before the Dexie rehydrate lands the rows.
    if (items.length === 0) return;
    const qtyExclLoyalty = items.reduce(
      (acc: number, it: any) =>
        !it?.isLoyaltyItem ? acc + Number(it?.quantity ?? 0) : acc,
      0,
    );
    const qtyExclLoyaltyAndGetItems = items.reduce(
      (acc: number, it: any) =>
        !it?.isLoyaltyItem && !it?.isGetItem
          ? acc + Number(it?.quantity ?? 0)
          : acc,
      0,
    );
    const shouldRemove =
      // 1 + 3: minItemCount against both quantity views.
      (cartOffer?.minItemCount && qtyExclLoyalty < cartOffer.minItemCount) ||
      (cartOffer?.minItemCount &&
        qtyExclLoyaltyAndGetItems < cartOffer.minItemCount) ||
      // 2 + 4: nothing payable left under the offer.
      qtyExclLoyalty <= 0 ||
      qtyExclLoyaltyAndGetItems <= 0 ||
      // 5: itemCriteria — guarded on applicable.on (contract trap 6: the
      // matcher returns undefined for itemCriteria with neither include
      // nor exclude, and must not fire for non-itemCriteria offers).
      (cartOffer?.applicable?.on === "itemCriteria" &&
        items.length > 0 &&
        !isItemWiseOfferApplicable(
          cartOffer?.applicable,
          items,
          cartOffer?.minBillAmount,
        )) ||
      // 6: bogo mechanics (called unconditionally like the fork — the
      // engine returns true for every non-bogo mechanic).
      (items.length > 0 &&
        !isBOGOOfferApplicable(cartOffer, cartOffer?.applicable, items)) ||
      // 7: sameOrLess ceiling (fork Cart.tsx:1327-1346) — false for every
      // offer that is not a sameOrLess plain BOGO.
      isSameOrLessViolated(cartOffer, items);
    if (shouldRemove) {
      handleCartDrivenRemoval(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cartOffer, cartRdx?.cartItems]);

  // Auto-apply (lane offers, item 34) — declared AFTER the revalidation
  // effect on purpose: effects run in declaration order, so it only ever
  // sees a slot that revalidation has already settled. Never while a sheet,
  // picker or buy stage is open (the removal notice is checked inside).
  useOfferAutoApply({
    open,
    ranked: rankedOffers,
    blocked:
      rewardsOpen ||
      !!pickerOffer ||
      !!stage.buyStage ||
      !!switchTarget ||
      !!editHowManyRow,
  });

  // Least-value freebie allocation follows the cart (contract / fork
  // Cart.tsx:393): reconcile whenever the items change under such an offer.
  useEffect(() => {
    if (!open) return;
    if (isLeastValueItemOffer(cartOffer)) {
      dispatch(reconcileFreebieAllocation());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cartOffer, cartRdx?.cartItems]);

  // cart_viewed on open (fork parity).
  useEffect(() => {
    if (!open) return;
    captureKioskEvent(KioskEventName.CartViewed, {
      item_count: totalQuantity,
      offer_applied: !!(cartOffer && Object.keys(cartOffer).length > 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clean the coming-soon timeout on unmount (kiosk memory hygiene, Rule 5).
  useEffect(
    () => () => {
      if (comingSoonTimer.current) window.clearTimeout(comingSoonTimer.current);
    },
    [],
  );

  // handlePay's continuation must know the sheet is gone (see there).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The order-type switch's removal notice: redux-driven like the offer one
  // (it survives the empty-cart exit when the switch emptied the bag). Its
  // chunk is in by then (the switch ran from it); a notice that fails to
  // render hides itself.
  const orderTypeNotice = orderTypeSwitchNotice && (
    <ErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <OrderTypeSwitchNotice />
      </Suspense>
    </ErrorBoundary>
  );

  if (!open) {
    // The removal notice is redux-driven and must survive the bag's
    // empty-exit (scenario 7: the customer lands back on the menu and the
    // "reward removed" notice is still up until GOT IT). It renders null
    // while cart.offerRemovalModal is closed.
    return (
      <>
        <OfferRemovalNotice />
        {orderTypeNotice}
      </>
    );
  }

  /**
   * Edit-from-bag — the FULL contract-B1 dispatch recipe lives HERE (not a
   * page callback): seed the MIAM tier-1 session in edit mode and detour to
   * the PDP with direction:"cart" so the return path reopens this sheet.
   * `setTeir1SelectedEntity({...row})` MUST carry itemId — the PDP commit
   * spreads selectedEntity into the update payload and updateItemCartRdx
   * matches on itemId (trap 2).
   *
   * Split edit (Figma 1:4460, I6): editQuantity k < the row's N seeds the PDP
   * with k units and tells the commit to split k off the source row
   * (`splitEdit`, read by useCustomization). No k, or k ≥ N, is the
   * whole-row edit with byte-identical dispatches.
   */
  const handleEditRow = (row: any, editQuantity?: number) => {
    const split =
      editQuantity !== undefined && editQuantity < Number(row?.quantity);
    dispatch(
      openMakeItAMealModal({
        isOpen: false,
        selectedItem: row?.makeItAMealSelectedItem ?? {},
        availableCombos: [],
      }),
    );
    dispatch(openMakeItAMealSession());
    dispatch(openTier1Modal());
    dispatch(
      setTeir1SelectedEntity({
        ...row,
        itemId: row?.itemId,
        quantity: split ? editQuantity : row?.quantity,
        subcategoryId: row?.subCategoryId,
      }),
    );
    dispatch(
      setTier1BottomSheet({
        isOpen: true,
        type: row?.type === "VARIANT" ? "variant" : "customizableItem",
        status: row?.type === "VARIANT" ? "variant" : "customizableItem",
        openType: "edit",
        editCustomizationContent: row,
        ...(split
          ? { splitEdit: { sourceItemId: row?.itemId, editQuantity } }
          : {}),
      }),
    );
    dispatch(setTier1SelectedCustomization(row?.customizations));
    dispatch(setSelectedEntity({ ...row?.baseItem, itemId: row?.itemId }));
    dispatch(setIsForceOpenMakeItAMealModal(false));
    captureKioskEvent(KioskEventName.ItemCustomizeInCartClicked, {
      item_id: row?.id,
    });
    navigate("/customization", { state: { direction: "cart" } });
  };

  // Edit on a multi-unit row asks how many to edit first; one unit edits
  // straight away (today's path).
  const handleEditTap = (row: { quantity?: unknown }) => {
    if (Number(row?.quantity) > 1) setEditHowManyRow(row);
    else handleEditRow(row);
  };

  const handleEditHowManyConfirm = (editQuantity: number) => {
    const row = editHowManyRow;
    setEditHowManyRow(null);
    if (row && editQuantity >= 1) handleEditRow(row, editQuantity);
  };

  const handleConfirmRemove = () => {
    const row = removeCandidate;
    setRemoveCandidate(null);
    if (!row) return;
    // At qty 1 the decrease reducer deletes the row (contract A2); Dexie
    // mirror + cart_modified analytics live inside the hook.
    decreaseItemQuantityById(row?.itemId, "ITEM", "itemId");
  };

  /**
   * Buy-stage CONTINUE: commit through the one apply path (useBuyStage →
   * selectOfferAndCommit). Applied → the stage closes itself and the
   * celebration fires; needs a freebie choice → the picker (the snapshot stays
   * armed, so dismissing the picker rolls the stage's rows back); blocked or
   * failed → the stage stays open with an inline message.
   */
  const handleStageContinue = async () => {
    const stagedOffer = stage.buyStage?.offer;
    setStageBlocked(null);
    try {
      const result = await stage.continueStage();
      if (!mountedRef.current) return;
      if (result.needsPicker) {
        setPickerOffer(result.offer ?? stagedOffer);
        return;
      }
      if (!result.applied) setStageBlocked(t("offers.notApplicable"));
    } catch {
      if (mountedRef.current) setStageBlocked(t("offers.notApplicable"));
    }
  };

  /**
   * PAY — checkout preflight (contract C1): entry guards → menu/scheduler
   * revalidation → stock decision → resolveCheckoutRoute. P8a replaced the
   * single /checkout stub with the four real screens, and the four
   * CheckoutRoute literals ARE the four registered path segments, so the
   * decision is navigated to directly; `state.checkoutRoute` is still carried
   * because /phone reads it to enter checkout mode.
   */
  const handlePay = async () => {
    const entryGuard = evaluateCheckoutEntryGuards({
      bill,
      isLoyaltyOn: getIsLoyaltyOn(),
      isCheckoutInProgress: checkoutInProgress,
      cartItems: cartRdx?.cartItems,
    });
    if (
      !entryGuard.allowed &&
      (entryGuard.reason === "invalidBill" || entryGuard.reason === "zeroNetAmount")
    ) {
      return;
    }
    try {
      if (!entryGuard.allowed) {
        if (entryGuard.reason === "emptyCart") {
          dispatch(
            setShowErrorModalGlobal({
              showErrorModal: true,
              errorMessage: t("bag.emptyCartError"),
            }),
          );
        }
        // "checkoutInProgress" returns silently, as in the fork.
        return;
      }
      setCheckoutInProgress(true);

      // Revalidation ladder — the parts TB has ported (contract C1):
      // fetchMenu early-returns the redux menu when fresh (fork-identical
      // arguments, including the historical stray 4th `true`).
      const menuData = await fetchMenu(tabId, true, false, true);
      let currentServerDateWithTime = moment();
      const serverTimeData = await getServerTimeApi({}).unwrap();
      if (serverTimeData?.serverTime) {
        currentServerDateWithTime = moment(new Date(serverTimeData.serverTime));
      }
      // The scheduler's rows are structuredClone'd (mutable) — the stock
      // sweep below runs on THEM, never on the frozen redux rows.
      const preSweepRows = cartRdx?.cartItems;
      const { updatedCart, invalidSchedulerItemIds } = await updateCartItemsByMenu(
        preSweepRows,
        menuData,
        showEntpCategory,
        currentServerDateWithTime,
      );
      // Rule 1 (the SecondLayout guard): these awaits are transport-bounded
      // (P9b: 10 s, getMenu 30 s) but not idle-held, so the session can end
      // (idle → /start) while they run. A late result must neither write
      // into the next session nor drive the emptied kiosk off the splash
      // into the checkout fan-out.
      if (!mountedRef.current) return;
      const isAnyItemUnavailable = invalidSchedulerItemIds.length > 0;
      if (isAnyItemUnavailable) {
        dispatch(
          setShowErrorModalGlobal({
            showErrorModal: true,
            errorMessage: t("bag.itemUnavailable"),
          }),
        );
      }

      // A1 — the stock re-check (the fork's updateOutOfStockFromApis): the
      // SDK sweep, lazy with the bag's chunk (the 838-line engine stays off
      // the boot path). FAIL-OPEN (D-A1-1, fork parity): a failed chunk, a
      // failed / timed-out feed (10 s transport bound), a non-array feed or
      // any throw lets PAY through on today's path. No second check before
      // the Paytm initiate (D-A1-4).
      let sweep: CheckoutStockSweep | null = null;
      let sameRows: ((a: unknown, b: unknown) => boolean) | null = null;
      try {
        const parts = await import("./bagLazyParts");
        if (!mountedRef.current) return;
        sameRows = parts.sameCartRows;
        sweep = await parts.runCheckoutStockSweep(
          updatedCart,
          (ids) =>
            getOutOfStock({
              items_id: ids,
              deployment_id: licenseDetails?.deployment_id,
              tab_id: tabId,
            }).unwrap(),
          {
            getTotalValueWithApplyAddonPrice,
            isAllowMultiplePunch,
            fetchModifierProperties,
          },
        );
      } catch {
        sweep = null;
      }
      if (!mountedRef.current) return;

      if (!sweep || !sameRows) {
        captureKioskEvent(KioskEventName.ErrorOccurred, {
          error_source: "checkout_stock_sweep",
        });
      } else {
        // CAS (D-A1-5): the guest changed the bag while the check ran — no
        // write; the next PAY checks the bag as it is now.
        const liveRows = (store.getState() as { cart?: { cartItems?: unknown } })
          ?.cart?.cartItems;
        if (!sameRows(liveRows, preSweepRows)) {
          setCheckoutInProgress(false);
          return;
        }
        dispatch(setOutOfStockItems(sweep.feedMap));
        dispatch(setUpdatedBaseItems({ updatedBaseItems: sweep.updatedBaseItems }));
        dispatch(
          setMinMaxErroredBaseItems({
            minMaxErroredBaseItems: sweep.minMaxErroredBaseItems,
          }),
        );
        // ONE write (one dispatch + one Dexie replace), only when something
        // is flagged or a live row carries a stale flag (D-A1-3). Flagged =
        // a blocked PAY: the swept rows land and the guest sees the bag.
        // Stale flags alone: this PAY proceeds on the bill it rendered, so
        // only the flags clear — the swept rows would also land the
        // scheduler's silent drops (an add-on out of its window) under an
        // order priced and charged with them.
        if (
          sweep.updatedBaseItems.length > 0 ||
          sweep.minMaxErroredBaseItems.length > 0 ||
          isAnyItemUnavailable
        ) {
          replaceCartItems(sweep.updatedCart);
        } else if (Array.isArray(liveRows) && liveRows.some(isRowUnavailable)) {
          replaceCartItems(liveRows.map(clearStockFlags));
        }
      }

      const decision = resolveCheckoutStockDecision({
        cartItems: preSweepRows,
        outOfStockData: sweep ?? undefined,
        isAnyItemUnavailable,
        tabType,
        skipCRM: shouldSkipCRM(),
        isLoyaltyOn: getIsLoyaltyOn(),
      });

      if (decision.kind === "blocked") {
        if (decision.reason === "outOfStock") {
          // An out-of-stock freebie drops its offer (silently while paid
          // rows still need the guest — the two notices never stack).
          if (decision.removeOffer) {
            handleCartDrivenRemoval(decision.removeOffer.silent);
          }
          // The existing notice (decision 2026-10-08: no new key).
          if (decision.showOutOfStockError) {
            dispatch(
              setShowErrorModalGlobal({
                showErrorModal: true,
                errorMessage: t("bag.itemUnavailable"),
              }),
            );
          }
        } else if (decision.reason === "minMaxError" && !isAnyItemUnavailable) {
          // A TB addition — the fork blocks here silently.
          dispatch(
            setShowErrorModalGlobal({
              showErrorModal: true,
              errorMessage: t("bag.someNeedChanges"),
            }),
          );
        }
        // "itemUnavailable": its error modal is already up.
        setCheckoutInProgress(false);
        return;
      }

      dispatch(setAmount(getCheckoutNetAmount(bill)));
      captureKioskEvent(KioskEventName.CheckoutStarted, {
        item_count: totalQuantity,
        cart_total: getCheckoutNetAmount(bill),
      });
      // A COPY: Immer freezes what the store holds, and this memoised bill's
      // next getNetAmount() re-assigns each charge's `amount`.
      dispatch(setAppliedCharges(structuredClone(bill?.charges?.detail)));
      setCheckoutInProgress(false);
      navigate(`/${decision.route}`, { state: { checkoutRoute: decision.route } });
    } catch {
      // Same late-result rule: the global error is redux, so it would greet
      // the next customer.
      if (!mountedRef.current) return;
      // Never a frozen sheet (Rule 2): release the latch and surface the
      // failure through the global error modal.
      setCheckoutInProgress(false);
      dispatch(
        setShowErrorModalGlobal({
          showErrorModal: true,
          errorMessage: t("bag.checkoutFailed"),
        }),
      );
    }
  };

  /**
   * Reward row Remove (contract branch table / fork CartItem.tsx:94-103) —
   * reachable ONLY from an out-of-stock / unavailable reward row, since a
   * served reward is not the customer's to drop. Same three beats as the
   * fork's handleCloseLoyaltyItem: drop the row, refund its points, revoke.
   */
  const handleRemoveLoyaltyRow = (row: any) => {
    removeLoyaltyItemFromCart(row?.itemId);
    const pointsValue = getLoyaltyPointsValue(row);
    // DIVERGENCE (safety): the fork dispatches this unguarded, so a coupon
    // without a "Points Value" field NaNs the balance. Guarded here.
    if (pointsValue) dispatch(addLoyaltyPoints(pointsValue));
    checkAndRevokeLoyaltyReward().catch(() => {});
  };

  /**
   * LOG-IN & GET REWARDS (locked decision 5b). Rendered only with loyalty
   * on (user decision 2026-10-05: hidden on loyalty-off deployments); until
   * the integrator wires the overlays it stays P7a's inert "coming soon".
   * Otherwise it is the bag's rewards entry point and runs the SAME
   * branch table as the menu link (contract §Partner-branch table):
   * unidentified → login modal; reward already in the cart → "already
   * availed"; no coupons → "no coupons"; otherwise → the rewards sheet.
   */
  const handleLoginRewards = () => {
    if (getIsLoyaltyOn()) {
      if (!isLoyaltyIdentified) {
        if (onOpenLoyaltyLogin) {
          onOpenLoyaltyLogin();
          return;
        }
      } else if (isAnyLoyaltyItemPresentInCart()) {
        dispatch(
          setShowErrorModalGlobal({
            showErrorModal: true,
            errorMessage: t("loyalty.alreadyAvailed"),
          }),
        );
        return;
      } else if (!loyaltyCoupons?.length) {
        dispatch(
          setShowErrorModalGlobal({
            showErrorModal: true,
            errorMessage: t("loyalty.noCoupons"),
          }),
        );
        return;
      } else if (onOpenLoyaltyRewards) {
        onOpenLoyaltyRewards();
        return;
      }
    }
    setShowComingSoon(true);
    if (comingSoonTimer.current) window.clearTimeout(comingSoonTimer.current);
    comingSoonTimer.current = window.setTimeout(
      () => setShowComingSoon(false),
      1400,
    );
  };

  // U3 — cooking instructions (fork Cart.tsx:1286-1294 / CartItemList
  // :106-158): only the note's LENGTH reaches analytics.
  const instructions = String(cartRdx?.instructions ?? "");
  const openInstructions = () => {
    captureKioskEvent(KioskEventName.AddInstructionClicked, {
      has_existing_instruction: instructions !== "",
    });
    setInstructionsOpen(true);
  };
  const dismissInstructions = () => {
    captureKioskEvent(KioskEventName.AddInstructionDismissed, {});
    setInstructionsOpen(false);
  };
  const saveInstructions = (text: string) => {
    captureKioskEvent(KioskEventName.InstructionAdded, {
      instruction_length: text.length,
    });
    dispatch(setCartInstructions(text));
    setInstructionsOpen(false);
  };

  const payTotal = billTotal(bill);
  // Live applied discount — always the BILL's figure (resolveShownSaving
  // policy: applied → live getTotalDiscount wins), never a cached quote.
  const appliedDiscount =
    bill && Object.keys(bill).length > 0
      ? Number(bill.getTotalDiscount?.() ?? 0)
      : 0;
  // U4 (design language, the 1:3348 row geometry — sign-off): every figure
  // from the SAME bill, read AFTER getNetAmount (above), which recomputes
  // the charges (getCharges is undefined without any). Display only — never
  // dispatched. Round off is what the engine's rounding added, so Sub Total
  // − Discounts + Taxes & charges ± Round off = Total, to the cent.
  const hasBill = !!bill && Object.keys(bill).length > 0;
  const subTotal = hasBill ? round2(Number(bill.getSubtotal())) : 0;
  const taxesAndCharges = hasBill
    ? round2(
        Number(bill.getTotalTax()) +
          (Number(bill.getCharges()) || 0) +
          Number(bill.getChargesTotalTax()),
      )
    : 0;
  const roundOff = round2(
    payTotal - (subTotal - round2(appliedDiscount) + taxesAndCharges),
  );
  // F1: the applied offer row and its celebration show the OFFER's own
  // saving — a XENO reward's item discount is in the total, not the offer's.
  const offerDiscount = getBillOfferDiscount(bill);
  // Never a "Not available right now" offer (lane offers-parity: a sold-out
  // buy side ranks as the gone row).
  const bestRankedName: string =
    rankedOffers.find((entry) => entry.gap?.reason !== "unavailable")?.offer?.name ?? "";
  const sheetHeight = adaActive ? ADA_SHEET_HEIGHT : BAG_SHEET_HEIGHT;
  // One celebration per applied VALUE (see AppliedRowPop).
  const barKey = `${cartOffer?._id}:${offerDiscount.toFixed(2)}`;
  const loyaltyOn = getIsLoyaltyOn();

  // The other order type's pipeline (first in list order: not the current
  // one, has a tab, not device-deactivated, open), or null → inert segment.
  const switchCandidate = resolveOrderTypeSwitchTarget({
    pipelines,
    currentPipelineId: selectedPipeline?._id,
    targetKind: isTakeOut ? "eatIn" : "takeOut",
    deactivatedPipelineIds: getDeactivatedPipelines(),
    isPipelineOpen: (id) => checkPipelineClosedFromRedux(id).status,
  });
  const canSwitch = !!switchCandidate && !checkoutInProgress;
  // Each segment — and the switch prompt — names its pipeline as /second
  // does (user 2026-10-13); the fixed copy only for no name or no target.
  const orderTypeName = (pipeline: PipelineLabel | null, takeOut: boolean) =>
    pipelineName(pipeline) || t(takeOut ? "bag.takeOut" : "bag.eatIn");
  const currentName = orderTypeName(selectedPipeline, isTakeOut);
  const otherName = orderTypeName(switchCandidate, !isTakeOut);

  // Chevron — the decorative "opens a sheet" affordance of the bag's entry
  // rows (Rewards, cooking instructions).
  const chevron = (
    <svg
      viewBox="0 0 24 24"
      className="h-[36px] w-[36px] shrink-0 text-tb-purple"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.29 5.29a1 1 0 0 1 1.42 0l6 6a1 1 0 0 1 0 1.42l-6 6a1 1 0 0 1-1.42-1.42L13.59 12 8.29 6.71a1 1 0 0 1 0-1.42Z"
        fill="currentColor"
      />
    </svg>
  );

  // A lazy overlay's loading / failed-chunk stand-in: its scrim, which closes
  // it (BuyStageSheet's buy-stage-loading precedent).
  const lazyDismiss = (testId: string, z: string, close: () => void) => (
    <button
      type="button"
      aria-label={t("language.close")}
      data-testid={testId}
      onClick={close}
      className={`absolute inset-0 ${z} h-full w-full bg-tb-purple/80`}
    />
  );
  const switchDismiss = lazyDismiss("bag-ordertype-loading", "z-[80]", () =>
    setSwitchTarget(null),
  );
  const editHowManyDismiss = lazyDismiss("edit-how-many-loading", "z-50", () =>
    setEditHowManyRow(null),
  );
  const instructionsDismiss = lazyDismiss(
    "instructions-loading",
    "z-50",
    dismissInstructions,
  );
  // The rewards sheet / buy stage while their code is not here (loading, or
  // a failed chunk): their own scrim, closing like them — the bag stays
  // covered and a stalled download never traps the customer.
  const rewardsLoading = rewardsOpen ? (
    <button
      type="button"
      aria-label={t("offers.close")}
      data-testid="rewards-loading"
      onClick={() => setRewardsOpen(false)}
      className="absolute inset-0 z-50 h-full w-full bg-tb-purple/80"
    />
  ) : null;
  const buyStageLoading = (
    <button
      type="button"
      aria-label={t("offers.close")}
      data-testid="buy-stage-loading"
      onClick={() => stage.abandon()}
      className="absolute inset-0 z-50 h-full w-full bg-tb-purple/80"
    />
  );

  const orderTypeSegment = (
    key: "eatin" | "takeout",
    label: string,
    active: boolean,
  ) => (
    <button
      type="button"
      data-testid={`bag-ordertype-${key}`}
      aria-pressed={active}
      aria-disabled={!active && !canSwitch}
      onClick={
        !active && canSwitch ? () => setSwitchTarget(switchCandidate) : undefined
      }
      className={`tb-select flex h-[52px] min-w-[44px] flex-1 items-center justify-center gap-[8px] rounded-[30px] px-[24px] ${
        active ? "bg-tb-surface" : ""
      }`}
    >
      {/* One line: a long name ends in an ellipsis inside the pill, the
          button keeps it whole for screen readers. dir="auto" on this LEAF
          only: an Arabic name is cut at its own end. */}
      <span dir="auto" className="tb-display min-w-0 truncate text-[18px] leading-[20px] text-tb-purple">
        {label}
      </span>
      {active ? (
        <span className="tb-pop-in flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-tb-purple">
          {/* Check glyph (Figma icon 8544a14e) inlined. */}
          <svg viewBox="0 0 13.34 13.34" className="h-[13px] w-[13px]" aria-hidden="true">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M11.6717 2.8984C12.0233 3.23355 12.0367 3.79034 11.7016 4.14202L5.47493 10.676L1.63034 6.62296C1.296 6.2705 1.31069 5.71375 1.66315 5.37941C2.01561 5.04508 2.57237 5.05977 2.9067 5.41223L5.47787 8.12279L10.428 2.92835C10.7632 2.57666 11.32 2.56325 11.6717 2.8984Z"
              fill="white"
            />
          </svg>
        </span>
      ) : (
        <span className="h-[20px] w-[20px] shrink-0 rounded-full border border-tb-purple" />
      )}
    </button>
  );

  return (
    <div className="absolute inset-0 z-40" data-testid="bag-sheet">
      {/* The scrim never animates (motion D-M3); the panel rises (tb-sheet-enter). */}
      <button
        type="button"
        aria-label={t("bag.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* ADA (Figma 1:5445): only the height changes — the header, the
          scroll body (507px) and the pinned CTA row re-flow inside it, and
          the scrim above covers the reach zone only (ReachZone confines
          this whole subtree). */}
      <div
        style={{ height: sheetHeight }}
        className="tb-sheet-enter absolute bottom-0 left-0 flex w-[1080px] flex-col overflow-hidden rounded-t-[60px] bg-tb-surface"
      >
        <div className="relative shrink-0 pb-[40px] pt-[54px]">
          <p className="tb-display text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple">
            {t("bag.title")} (<span key={totalQuantity} className="tb-bump inline-block">{totalQuantity}</span>)
          </p>
          <button
            type="button"
            data-testid="bag-close"
            aria-label={t("bag.close")}
            onClick={onClose}
            className="absolute right-[44px] top-[44px] h-[48px] min-h-[44px] w-[48px] min-w-[44px]"
          >
            <img alt="" src={closeIcon} className="h-full w-full" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-[24px]">
            {/* EAT IN / TAKE OUT (the eat-in kind left), each segment named
                after its pipeline — active = the current pipeline; the other
                segment opens the switch flow (inert without a target or
                while PAY runs). */}
            <div className="mb-[24px] flex w-full items-center rounded-[60px] bg-tb-grey-4 p-[4px]">
              {orderTypeSegment("eatin", isTakeOut ? otherName : currentName, !isTakeOut)}
              {orderTypeSegment("takeout", isTakeOut ? currentName : otherName, isTakeOut)}
            </div>

            <div className="flex w-full flex-col">
              {displayRows.map((row: any, index: number) => (
                <BagItemRow
                  key={row?.itemId ?? index}
                  row={row}
                  rise={openRows !== null && !openRows.has(row?.itemId)}
                  currency={currency}
                  onEdit={handleEditTap}
                  onRequestRemove={setRemoveCandidate}
                  onRemoveLoyalty={handleRemoveLoyaltyRow}
                />
              ))}
            </div>

            {/* Rewards — Figma mybag-rewards 1:3137 (applied row) + locked
                decision 5 (entry row is design-language: no Figma frame for
                the unapplied state — flagged for client sign-off). */}
            {(hasAppliedOffer || rankedOffers.length > 0) && (
              <div className="w-full border-t border-tb-grey-4 pt-[24px]">
                <p className="text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
                  {t("offers.title")}
                </p>
                {hasAppliedOffer ? (
                  // Tapping the applied row reopens the sheet — the ONLY path
                  // to the swap flow while an offer is applied (decision 3
                  // keeps the applied offer in the list, preselected, with an
                  // Applied chip — unreachable without this). Overlay-button
                  // pattern: a button cannot nest the Remove button, so the
                  // row stays a div and a named full-row button opens the
                  // sheet. The overlay is LAST in the DOM so it paints over
                  // the bell's opacity/mask layer (first, the bell would
                  // swallow taps); Remove sits above it (relative z-10).
                  <AppliedRowPop key={barKey} barKey={barKey}>
                    {(play) => (
                      <div
                        data-testid="bag-rewards-applied"
                        className="tb-press-card relative flex w-full items-start gap-[24px] py-[24px]"
                      >
                        <span className="relative flex h-[152px] w-[152px] shrink-0 items-center justify-center rounded-[8px] bg-tb-grey-6">
                          <span
                            aria-hidden="true"
                            className="h-[64px] w-[72px] bg-tb-purple opacity-25"
                            style={bellMaskStyle}
                          />
                          {play && (
                            <span
                              aria-hidden="true"
                              className="tb-success-pulse pointer-events-none absolute inset-0 rounded-[8px] border-[3px] border-tb-purple"
                            />
                          )}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col items-start gap-[10px]">
                          <p className="text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black">
                            {cartOffer?.name}
                          </p>
                          {/* Design language (no frame): the RewardsSheet
                              "Applied" chip, for an offer the machine
                              applied — flagged for client sign-off. */}
                          {autoAppliedOfferId === cartOffer?._id && (
                            <span
                              data-testid="bag-rewards-applied-for-you"
                              className="rounded-full bg-tb-purple px-[16px] py-[6px] text-[18px] font-bold uppercase leading-[20px] text-tb-surface"
                            >
                              {t("offers.auto.appliedForYou")}
                            </span>
                          )}
                          {offerDiscount > 0 && (
                            <p
                              className={`text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple ${
                                play ? "tb-chip-pop" : ""
                              }`}
                            >
                              {t("offers.save", {
                                amount: `${currency}${offerDiscount.toFixed(2)}`,
                              })}
                            </p>
                          )}
                          <button
                            type="button"
                            data-testid="bag-rewards-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeAppliedOffer();
                            }}
                            className="relative z-10 -ml-[8px] inline-flex min-h-[44px] min-w-[44px] items-center px-[8px] text-[16px] font-bold tracking-[-0.08px] text-tb-purple underline"
                          >
                            {t("offers.remove")}
                          </button>
                        </div>
                        <p className="shrink-0 text-[32px] font-medium leading-[36px] tracking-[-1px] text-black">
                          −{currency}
                          {offerDiscount.toFixed(2)}
                        </p>
                        <button
                          type="button"
                          aria-label={t("offers.entryTitle")}
                          onClick={() => setRewardsOpen(true)}
                          className="absolute inset-0"
                        />
                      </div>
                    )}
                  </AppliedRowPop>
                ) : (
                  <button
                    type="button"
                    data-testid="bag-rewards-entry"
                    onClick={() => setRewardsOpen(true)}
                    className="flex min-h-[44px] w-full items-center gap-[24px] py-[24px] text-left"
                  >
                    <span className="flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-[8px] bg-tb-grey-6">
                      <span
                        aria-hidden="true"
                        className="h-[40px] w-[45px] bg-tb-purple opacity-25"
                        style={bellMaskStyle}
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col items-start gap-[8px]">
                      <span className="text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black">
                        {t("offers.entryTitle")}
                      </span>
                      {bestRankedName && (
                        // capitalize: the offer name's one casing (the rows').
                        <span className="text-[24px] capitalize leading-[24px] tracking-[-0.12px] text-tb-ink-purple">
                          {bestRankedName}
                        </span>
                      )}
                    </span>
                    {chevron}
                  </button>
                )}
              </div>
            )}

            {/* U3 — cooking instructions (design language, no frame —
                sign-off): the Rewards entry-row geometry. The note persists
                per customer and rides special_instructions on both order
                paths; the empty-cart exit and the session reset clear it. */}
            <div className="w-full border-t border-tb-grey-4 pt-[24px]">
              <p
                id="bag-instructions-title"
                className="text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black"
              >
                {t("bag.instructions.title")}
              </p>
              {/* Named by the header AND the hint / note: the text alone
                  ("no onions") says nothing about the button's purpose. */}
              <button
                type="button"
                data-testid="bag-instructions-entry"
                aria-labelledby="bag-instructions-title bag-instructions-text"
                onClick={openInstructions}
                className="flex min-h-[44px] w-full items-center gap-[24px] py-[24px] text-left"
              >
                {/* A shrink-to-fit dir="auto" leaf (P9f S2): one Arabic line
                    keeps the header's left edge, a wrapped one right-aligns
                    in its own box — never across the full row. */}
                <span className="min-w-0 flex-1">
                  <span
                    id="bag-instructions-text"
                    data-testid="bag-instructions-text"
                    dir="auto"
                    className="line-clamp-2 w-fit max-w-full text-start text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple [overflow-wrap:anywhere]"
                  >
                    {instructions || t("bag.instructions.hint")}
                  </span>
                </span>
                {chevron}
              </button>
            </div>
          </div>

          {/* Complete Your Meal — the rail gates itself (renders null when
              the upsell engine yields too few items) and owns its heading. */}
          <ErrorBoundary fallback={null}>
            <Suspense fallback={null}>
              <CompleteYourMealRail onDetour={onClose} />
            </Suspense>
          </ErrorBoundary>

          {/* The order summary sits on the bag's own 24 px margin, its prices in line
              with the rows' (user 2026-10-13: "the space ... should be lesser"). */}
          <div className="mt-[40px] px-[24px] pb-[32px]">
            <div className="flex w-full items-center justify-between border-t border-tb-grey-4 pb-[16px] pt-[16px] text-[28px] leading-[32px] text-black">
              <p>{t("bag.subTotal")}</p>
              <p data-testid="bag-subtotal" className="text-right">
                {currency}
                {subTotal.toFixed(2)}
              </p>
            </div>
            {/* Discounts — Figma 1:3137: signed line between Sub Total and
                Total, only while an applied offer is actually discounting. */}
            {appliedDiscount > 0 && (
              <div className="flex w-full items-center justify-between pb-[16px] text-[28px] leading-[32px] text-black">
                <p>{t("bag.discounts")}</p>
                <p data-testid="bag-discounts" className="text-right">
                  −{currency}
                  {appliedDiscount.toFixed(2)}
                </p>
              </div>
            )}
            {/* U4 — the tax the Total carries, then what its rounding added
                (signed); each hidden at zero. */}
            {taxesAndCharges >= 0.005 && (
              <div className="flex w-full items-center justify-between pb-[16px] text-[28px] leading-[32px] text-black">
                <p>{t("bag.taxesAndCharges")}</p>
                <p data-testid="bag-taxes-charges" className="text-right">
                  +{currency}
                  {taxesAndCharges.toFixed(2)}
                </p>
              </div>
            )}
            {Math.abs(roundOff) >= 0.005 && (
              <div className="flex w-full items-center justify-between pb-[16px] text-[28px] leading-[32px] text-black">
                <p>{t("bag.roundOff")}</p>
                <p data-testid="bag-round-off" className="text-right">
                  {roundOff < 0 ? "−" : "+"}
                  {currency}
                  {Math.abs(roundOff).toFixed(2)}
                </p>
              </div>
            )}
            <div className="flex w-full items-center justify-between border-t border-[#9a9898] pt-[8px] text-[36px] font-medium capitalize leading-[64px] tracking-[-0.5px] text-black">
              <p>{t("bag.total")}</p>
              <p data-testid="bag-total" className="text-right">
                {currency}
                {payTotal.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        <div className="relative flex shrink-0 items-center gap-[24px] p-[24px] drop-shadow-[0px_0px_64px_rgba(0,0,0,0.08)]">
          {/* Loyalty-off deployments hide LOG-IN & GET REWARDS and PAY takes
              the full row (user decision 2026-10-05; no Figma frame). */}
          {loyaltyOn && (
            <button
              type="button"
              data-testid="bag-login-rewards"
              // Live once the integrator has wired an overlay opener; the
              // P7a inert "coming soon" otherwise.
              aria-disabled={
                onOpenLoyaltyLogin || onOpenLoyaltyRewards ? undefined : "true"
              }
              onClick={handleLoginRewards}
              className={`tb-display min-h-[84px] flex-1 rounded-[8px] border border-tb-purple py-[32px] text-center text-[24px] leading-[20px] text-tb-purple ${
                showComingSoon ? "opacity-60" : ""
              }`}
            >
              {showComingSoon ? t("bag.comingSoon") : t("bag.loginRewards")}
            </button>
          )}
          <button
            type="button"
            data-testid="bag-pay"
            onClick={handlePay}
            className={`tb-display min-h-[84px] ${loyaltyOn ? "w-[400px]" : "flex-1"} rounded-[8px] bg-tb-purple py-[32px] text-center text-[24px] leading-[20px] text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)]`}
          >
            {/* Figma 1:3137: "ORDER & PAY £33.39" once a reward discounts
                the order (tb-display uppercases the label). */}
            {appliedDiscount > 0 ? t("bag.orderAndPay") : t("bag.pay")} {currency}
            {payTotal.toFixed(2)}
          </button>
          {ctaTapGuard && (
            <div
              aria-hidden="true"
              data-testid="bag-cta-tap-guard"
              className="absolute inset-0"
            />
          )}
        </div>
      </div>

      <RemoveItemModal
        open={!!removeCandidate}
        onCancel={() => setRemoveCandidate(null)}
        onConfirm={handleConfirmRemove}
      />

      {/* Offer overlays — z-stack inside the bag's z-40 context:
          RewardsSheet / BuyStageSheet z-50 · FreebiePickerSheet z-[80] ·
          OfferTierHost z-[85] (in-bag PDP for customizable freebies and buy
          items) · OfferAppliedCelebration z-[86] (pointer-events-none) ·
          OfferRemovalNotice z-[90] (fixed). onNeedsPicker / onAddItems fire
          BEFORE the sheet's onClose, handing this page the offer. */}
      {/* The rewards sheet and the picker stay mounted while the bag is
          open (each renders null closed), so their chunk loads with the bag.
          Rewards OPEN while its code still loads, or after it failed = its
          own scrim, closing like it (nothing was chosen yet). */}
      <ErrorBoundary fallback={rewardsLoading}>
        <Suspense fallback={rewardsLoading}>
          <RewardsSheet
            open={rewardsOpen}
            appliedSaving={offerDiscount}
            onClose={() => setRewardsOpen(false)}
            onNeedsPicker={(offer) => setPickerOffer(offer)}
            onAddItems={(offer, view) => {
              setStageBlocked(null);
              stage.start(offer, view);
            }}
          />
        </Suspense>
      </ErrorBoundary>
      {stage.buyStage && (
        // Fallback = the sheet's own scrim, closing like it (nothing was
        // added yet — abandon is a no-op rollback).
        <ErrorBoundary fallback={buyStageLoading}>
          <Suspense fallback={buyStageLoading}>
            <BuyStageSheet
              stage={stage.buyStage}
              continuing={stage.continuing}
              blockedMessage={stageBlocked}
              onBack={() => {
                stage.abandon();
                setRewardsOpen(true);
              }}
              onClose={() => stage.abandon()}
              onContinue={handleStageContinue}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {/* null fallback: only the rewards sheet or the buy stage (this same
          chunk) can open the picker, so its code is always in by then. */}
      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <FreebiePickerSheet
            open={!!pickerOffer}
            offer={pickerOffer}
            onClose={() => {
              // A buy-stage journey that ends here without the offer landing
              // rolls its paid rows back (no-op when no stage is armed).
              stage.rollbackIfAbandoned();
              setPickerOffer(null);
            }}
          />
        </Suspense>
      </ErrorBoundary>
      <OfferTierHost />
      {/* null fallback = its idle look (it is invisible until a customer
          apply, seconds after the bag opens); it reads cart.offerModal on
          mount, so an apply that lands while the chunk loads still plays. */}
      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <OfferAppliedCelebration
            discount={offerDiscount}
            currency={currency}
            sheetHeight={sheetHeight}
          />
        </Suspense>
      </ErrorBoundary>
      <OfferRemovalNotice bill={bill ?? undefined} />
      {/* bag-pdp lane overlays (z-stack above): EditHowManyModal z-50 ·
          switch dialogs z-[80] · switch in-flight z-[85] · switch notice
          z-[89] (fixed). Lazy, each behind a scrim that closes it — while the
          chunk loads, and (boundary) for a part that fails to load or render.
          Every lazy part of the bag is guarded the same way: a chunk that
          fails to LOAD reloads via chunkRecovery (cart kept) or, on a page
          under 60 s old, degrades only its own part while chunkRecovery's
          healer schedules the reload for the splash's next dwell. */}
      {switchTarget && (
        <ErrorBoundary fallback={switchDismiss}>
          <Suspense fallback={switchDismiss}>
            <OrderTypeSwitchFlow
              target={switchTarget}
              type={orderTypeName(switchTarget, orderTypeKindOf(switchTarget.tab_type) === "takeOut")}
              current={currentName}
              onDone={() => setSwitchTarget(null)}
              onRemoveLoyaltyRow={handleRemoveLoyaltyRow}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {!!editHowManyRow && (
        <ErrorBoundary fallback={editHowManyDismiss}>
          <Suspense fallback={editHowManyDismiss}>
            <EditHowManyModal
              row={editHowManyRow}
              onCancel={() => setEditHowManyRow(null)}
              onConfirm={handleEditHowManyConfirm}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {/* U3: the instructions sheet (z-50), its scrim while the chunk loads
          or after it failed — closing like X (the draft discarded). */}
      {instructionsOpen && (
        <ErrorBoundary fallback={instructionsDismiss}>
          <Suspense fallback={instructionsDismiss}>
            <InstructionsSheet
              initialValue={instructions}
              onSave={saveInstructions}
              onClose={dismissInstructions}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {orderTypeNotice}
    </div>
  );
}
