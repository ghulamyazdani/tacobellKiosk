/* eslint-disable @typescript-eslint/no-explicit-any --
 * Coupons, menu entities and the loyalty proxy's envelopes all arrive
 * untyped from the SDK slices / legacy converters (same domain as
 * useLoyalty.ts and useCartHook.ts, which carry the identical header).
 * Typed in a later loyalty domain pass. Do not add NEW anys.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  closeLoyaltyItemsModal,
  decreaseLoyaltyPoints,
  openLoyaltyModal,
  selectCoupons,
  selectLoyaltyItemsModal,
  selectParkedRedeemedItem,
  selectTotalLoyaltyPoints,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { selectMenu } from "@cx-sdk/catalog/state/Menu.slice";
import { getAllLoyaltyItemsFromMenu } from "@cx-sdk/ordering/loyalty/loyaltyEngine";
import { getLoyaltyRedemptionError } from "@cx-sdk/ordering/loyalty/loyaltyRedemption";
import useLoyalty from "../../hooks/loyalty/useLoyalty";
import useAdaActive from "../../hooks/utils/useAdaActive";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useMenuConverters from "../../hooks/menuHooks/useMenuConverters";
import { resolveEntityImage } from "../../utils/entityImage";
import KioskNumpad from "../keyboard/KioskNumpad";
import LoyaltyErrorModal from "./LoyaltyErrorModal";
import tbBell from "../../assets/brand/tb-bell.svg";
import closeIcon from "../../assets/icons/close.svg";

export interface LoyaltyRewardsSheetProps {
  /**
   * Optional close override. The sheet reads its OWN open state from
   * `selectLoyaltyItemsModal` (the fork's contract — the phone lookup and the
   * menu entry both open it by dispatching `openLoyaltyItemsModal`), so the
   * integrator mounts it with no props at all:  `<LoyaltyRewardsSheet />`.
   * Pass `onClose` only when a host needs to run extra teardown; the default
   * dispatches `closeLoyaltyItemsModal()`.
   */
  onClose?: () => void;
}

/** Fork parity: the auto-dismiss ran 40/10 % per second → 25s. */
const AUTO_DISMISS_SECONDS = 25;
/** The partner sends a 4-digit OTP (authenticate_redemption → redeem_coupon). */
const OTP_LENGTH = 4;

/** Header bell, tinted tb-purple via CSS mask (the SVG's fills are white). */
const bellMaskStyle: CSSProperties = {
  WebkitMaskImage: `url(${tbBell})`,
  maskImage: `url(${tbBell})`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskPosition: "center",
  maskPosition: "center",
};

/** `extra_fields: [{name:"Points Value", value:3000}]` → 3000. */
const pointsValueOf = (entity: any): number =>
  Number(
    entity?.extra_fields?.find((field: any) => field?.name === "Points Value")
      ?.value ?? 0,
  );

/** Sum of the auto-selected customization prices (fork getTotalValue). */
const customizationsTotal = (customizations: Record<string, any[]>): number => {
  let total = 0;
  Object.values(customizations).forEach((items) =>
    (items ?? []).forEach((item: any) => {
      total += Number(item?.price ?? 0);
    }),
  );
  return total;
};

interface SheetBodyProps {
  onClose: () => void;
  isTimerOn: boolean;
}

/**
 * Sheet body — mounted only while open (RepeatItemSheet / RewardsSheet house
 * pattern), so selection, OTP and error state re-seed on every (re)open
 * without a setState-in-effect.
 */
function SheetBody({ onClose, isTimerOn }: SheetBodyProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  const coupons = useSelector(selectCoupons) as any[] | undefined;
  const menuData = useSelector(selectMenu) as any;
  const totalPoints = Number(useSelector(selectTotalLoyaltyPoints) ?? 0);
  const parkedItem = useSelector(selectParkedRedeemedItem) as any;

  const {
    validateCoupon,
    redeemLoyaltyPoints,
    redeemItem,
    addItemToLoyaltyParking,
    finalLoyaltyRedemption,
    setClaimedCouponToRedux,
    isLoyaltyEventLoading,
  } = useLoyalty();
  const { addLoyaltyItemToCart, isAnyLoyaltyItemPresentInCart } = useCartHook();
  const { fetchModifierProperties } = useMenuConverters();

  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [availedPoint, setAvailedPoint] = useState(0);
  const [isOtpNeeded, setIsOtpNeeded] = useState(false);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(AUTO_DISMISS_SECONDS);

  // WCAG 2.2.1 (Timing Adjustable): in the ADA view the auto-dismiss is a
  // content-set time limit, and the guests who turn ADA on are exactly the
  // ones who cannot race it — the fork's own OffersSheet rule
  // (`autoReturn={!accessibilityMode}`), which its LoyaltyItemsModal missed.
  // Latched at open as well: leaving ADA mid-sheet (the brand zone stays
  // tappable above it) must not start a countdown on a guest — possibly
  // mid-pick — who was given none.
  const adaActive = useAdaActive();
  const [openedInAda] = useState(adaActive);
  const timed = isTimerOn && !adaActive && !openedInAda;

  const timerRef = useRef<number | null>(null);

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Auto-dismiss (fork: only on the post-lookup auto-open, isTimerOn:true).
  // Rule 5 — one interval, cleared on unmount and on the first interaction;
  // the fork re-created it on every tick, which leaked on fast unmounts.
  useEffect(() => {
    if (!timed) return;
    timerRef.current = window.setInterval(
      () => setRemaining((prev) => (prev > 0 ? prev - 1 : 0)),
      1000,
    );
    return cancelTimer;
  }, [timed, cancelTimer]);

  // Closing is a side effect of the countdown, not of the tick callback — a
  // dispatch inside a state updater would double-fire under StrictMode.
  useEffect(() => {
    if (!timed || remaining > 0) return;
    cancelTimer();
    dispatch(closeLoyaltyItemsModal());
  }, [timed, remaining, cancelTimer, dispatch]);

  /**
   * Reward tiles. Built from the RAW coupon list joined against the menu —
   * NOT `selectLoyaltyItems` (fork contract: the modal re-derives the list so
   * a menu refresh is reflected). This calls the same pure engine function
   * `useLoyalty.getAllLoyaltyItemsFromMenu` wraps; the wrapper only adds a
   * console log, and going direct keeps the memo deps honest (the wrapper is
   * re-created every render, which would re-walk the whole menu per render).
   * Rewards whose product has no price / no image are dropped by the engine.
   */
  const rewards = useMemo(
    () =>
      coupons && coupons.length > 0
        ? (getAllLoyaltyItemsFromMenu(coupons, menuData) as any[])
        : [],
    [coupons, menuData],
  );

  /**
   * The item handed to validate_coupon / redeemItem — fork LoyaltyItemCard
   * `handleParkItem`, verbatim: a customizable reward auto-selects every
   * single-option required modifier group and rides as a CUSTOMIZABLE row;
   * everything else is a plain ITEM priced at the menu price. (The trailing
   * `...entity` spread is the fork's — it lets the merged coupon/menu fields
   * win over the literals above it. Kept for dispatch parity.)
   */
  const buildRedemptionItem = (entity: any): any => {
    const needsModifiers =
      entity?.modifiers?.length > 0 && !entity?.isVariant && !entity?.hasVariant;

    if (!needsModifiers) {
      return {
        ...entity,
        total_price: entity?.price,
        subCategoryId: entity?.subcategoryId,
        type: "ITEM",
      };
    }

    const groups = fetchModifierProperties(entity?.modifiers) ?? [];
    const customizations: Record<string, any[]> = {};
    groups.forEach((modifier: any) => {
      const activeItems = (modifier?.constituentItems ?? []).filter(
        (item: any) => item?.isActive && !item?.outOfStock,
      );
      if (modifier?.min === 1 && modifier?.max === 1 && activeItems.length === 1) {
        const first = modifier?.constituentItems?.[0];
        // Groups from fetchModifierProperties carry `_id`, not `id`. The fork
        // keys this map with `.id` and so writes a literal "undefined" group
        // (ORIG LoyaltyItemCard.tsx:227): totals survive it because they walk
        // Object.values, but the order payload and every group-keyed lookup
        // downstream do not. Keyed here the way the rest of the app keys groups.
        const groupId = modifier?._id ?? modifier?.id;
        if (groupId && first && !first.outOfStock && first.isActive) {
          customizations[groupId] = [first];
        }
      }
    });

    return {
      baseItem: entity,
      customizations,
      quantity: 1,
      type: "CUSTOMIZABLE",
      baseItemPrice: entity?.price,
      total_price: customizationsTotal(customizations) + Number(entity?.price ?? 0),
      ...entity,
    };
  };

  const locked = busy || isLoyaltyEventLoading;

  const handlePick = (entity: any) => {
    cancelTimer();
    if (locked || entity?.outOfStock) return;
    const id = String(entity?.id ?? "");
    if (selectedId === id) {
      setSelectedId(null);
      setSelectedItem(null);
      setAvailedPoint(0);
      return;
    }
    setSelectedId(id);
    setSelectedItem(buildRedemptionItem(entity));
    setAvailedPoint(pointsValueOf(entity));
  };

  /**
   * REDEEM — fork LoyaltyItemsModal:370-471, dispatch-exact:
   *   validate_coupon → authenticate_redemption (this is what SENDS the OTP)
   *   → park redeemItem(selected) → OTP step.
   * Failure detection is `getLoyaltyRedemptionError` (the SDK parser) rather
   * than the fork's hand-rolled `status_code === 200`: the proxy wraps real
   * failures in an HTTP 200 and also signals them via `success:false`, which
   * the fork's check misses.
   */
  const handleRedeem = async () => {
    cancelTimer();
    if (locked) return;
    if (!selectedItem?.id) {
      setError(t("loyalty.selectReward"));
      return;
    }
    // One reward per order (contract entry-tap guard) — re-checked here
    // because the bag can change under an open sheet.
    if (isAnyLoyaltyItemPresentInCart()) {
      setError(t("loyalty.alreadyAvailed"));
      return;
    }

    setBusy(true);
    try {
      const validation: any = await validateCoupon({ items: [selectedItem] });
      if (getLoyaltyRedemptionError(validation)) {
        setError(t("loyalty.validateError"));
        return;
      }

      const authentication: any = await redeemLoyaltyPoints({
        items: [selectedItem],
        totalPoints,
      });
      if (getLoyaltyRedemptionError(authentication)) {
        // Partner copy when present ("Minimum purchase amount is not met…")
        // — strictly more useful on a kiosk than the fork's fixed string.
        setError(
          authentication?.response?.message || t("loyalty.redeemError"),
        );
        return;
      }

      addItemToLoyaltyParking(redeemItem(selectedItem));
      setOtp("");
      setIsOtpNeeded(true);
    } catch {
      // Rule 2 — a thrown transport never freezes the sheet; the customer
      // gets TRY AGAIN and lands back on the reward list.
      setError(t("loyalty.redeemError"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * OTP confirm — `redeem_coupon`, then the contract's EXACT success
   * sequence: addLoyaltyItemToCart → closeLoyaltyItemsModal →
   * openLoyaltyModal (celebration) → setClaimedCouponToRedux (with
   * claimedPoints, the revoke ledger) → decreaseLoyaltyPoints.
   */
  const handleOtpSubmit = async () => {
    cancelTimer();
    if (locked) return;
    if (otp.length !== OTP_LENGTH) {
      setError(t("loyalty.invalidOtp"));
      return;
    }

    // The parked item is the source of truth (fork passes the redux value).
    const item = parkedItem;
    setBusy(true);
    try {
      const res: any = await finalLoyaltyRedemption(item?.coupon_code, otp, item);
      // Success must be POSITIVE (fork LoyaltyItemsModal: status_code === 200):
      // the parser alone reads a 2xx body with no status ({}, {error}) as
      // success, which would grant the reward with no Xeno confirmation.
      if (res?.status_code !== 200 || getLoyaltyRedemptionError(res)) {
        setError(res?.response?.message || t("loyalty.redeemError"));
        return;
      }

      addLoyaltyItemToCart(item, item?.type ?? "ITEM");
      dispatch(closeLoyaltyItemsModal());
      dispatch(openLoyaltyModal({ isOpen: true, item }));
      setClaimedCouponToRedux({
        ...res?.infoForClaim,
        claimedPoints: availedPoint,
      });
      dispatch(decreaseLoyaltyPoints(availedPoint));
    } catch {
      setError(t("loyalty.redeemError"));
    } finally {
      setBusy(false);
    }
  };

  // Render helper, NOT a component (react-hooks/static-components) — the
  // P7b RewardsSheet row geometry: 84px thumb, 24px gutter, 24px rhythm,
  // hairline separator, radio on the right.
  const renderRewardRow = (entity: any) => {
    const id = String(entity?.id ?? "");
    const code = String(entity?.coupon_code ?? id);
    const selected = selectedId === id;
    const outOfStock = Boolean(entity?.outOfStock);
    // Reward tiles are the coupon with the menu entity merged over it, so
    // `aggregator_image` survives the join.
    const imageUrl = resolveEntityImage(entity);
    const cost = pointsValueOf(entity);
    const chip =
      Number(entity?.discount_value) === 100
        ? t("loyalty.free")
        : t("loyalty.percentOff", { value: entity?.discount_value });

    return (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={outOfStock}
        disabled={locked || outOfStock}
        data-testid={`loyalty-reward-${code}`}
        onClick={() => handlePick(entity)}
        className={`flex min-h-[44px] w-full items-center gap-[24px] border-b border-tb-grey-4 py-[24px] text-left ${
          outOfStock ? "opacity-50" : ""
        } ${locked ? "opacity-60" : ""}`}
      >
        <span className="flex h-[84px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-tb-grey-6">
          {imageUrl ? (
            <img
              alt=""
              src={imageUrl}
              className="h-full w-full object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="h-[40px] w-[45px] bg-tb-purple opacity-25"
              style={bellMaskStyle}
            />
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col items-start gap-[8px] text-left">
          <span className="flex flex-wrap items-center gap-[12px]">
            <span className="text-[24px] font-bold leading-[28px] tracking-[-0.5px] text-black">
              {entity?.name ?? entity?.coupon_name}
            </span>
            <span className="rounded-full bg-tb-purple px-[12px] py-[4px] text-[14px] font-bold uppercase leading-[16px] text-tb-surface">
              {chip}
            </span>
          </span>
          <span className="text-[20px] leading-[24px] text-tb-ink-purple/70">
            {outOfStock
              ? t("menu.unavailable")
              : t("loyalty.pointsCost", { points: cost })}
          </span>
        </span>

        <span
          aria-hidden="true"
          className={`flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border-2 ${
            selected ? "border-tb-purple" : "border-[#b9b9b9]"
          }`}
        >
          {selected && (
            <span className="h-[20px] w-[20px] rounded-full bg-tb-purple" />
          )}
        </span>
      </button>
    );
  };

  const otpCells = Array.from({ length: OTP_LENGTH }, (_, index) => (
    <span
      key={index}
      className={`flex h-[96px] w-[96px] items-center justify-center rounded-[12px] border-2 text-[44px] font-bold leading-none text-tb-ink-purple ${
        index === otp.length ? "border-tb-purple" : "border-tb-grey-4"
      }`}
    >
      {otp[index] ?? ""}
    </span>
  ));

  return (
    <div className="absolute inset-0 z-50" data-testid="loyalty-rewards-sheet">
      {/* Position-neutral scoped keyframe — `tb-modal-enter` carries a -50%
          translate and is reserved for centered modals. */}
      <style>{`@keyframes tbLoyaltySheetEnter{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <button
        type="button"
        aria-label={t("loyalty.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* Capped by the containing block (Menu's h-full root → the reach
          container) minus a 96 px scrim band, as RewardsSheet: 1470 on the
          1920 stage, 1026 in the 1122 ADA reach zone — still room for the
          whole OTP step (header 160 + prompt/cells/numpad 668 + bar 132 =
          960) without scrolling the keypad. */}
      <div
        style={{ animation: "tbLoyaltySheetEnter 0.2s ease-out both" }}
        onPointerDownCapture={cancelTimer}
        onScrollCapture={cancelTimer}
        className="absolute bottom-0 left-0 flex h-[min(1470px,calc(100%_-_96px))] w-[1080px] flex-col overflow-hidden rounded-t-[60px] bg-tb-surface"
      >
        {/* Auto-dismiss progress — purely decorative; disappears the moment
            the customer touches the sheet. */}
        {timed && remaining > 0 && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 h-[6px] bg-tb-pink"
            style={{ width: `${(remaining / AUTO_DISMISS_SECONDS) * 100}%` }}
          />
        )}

        <div className="relative shrink-0 pb-[24px] pt-[54px]">
          <div className="flex items-center justify-center gap-[16px]">
            <span
              aria-hidden="true"
              className="h-[36px] w-[40px] bg-tb-purple"
              style={bellMaskStyle}
            />
            <p className="tb-display text-center text-[40px] leading-[40px] tracking-[-1px] text-tb-purple">
              {t("loyalty.title")}
            </p>
          </div>
          <p
            data-testid="loyalty-points-balance"
            className="mt-[16px] text-center text-[22px] leading-[26px] text-tb-ink-purple/80"
          >
            {t("loyalty.pointsBalance", { points: totalPoints })}
          </p>
          <button
            type="button"
            data-testid="loyalty-rewards-close"
            aria-label={t("loyalty.close")}
            onClick={onClose}
            className="absolute right-[44px] top-[44px] h-[48px] min-h-[44px] w-[48px] min-w-[44px]"
          >
            <img alt="" src={closeIcon} className="h-full w-full" />
          </button>
        </div>

        {isOtpNeeded ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-[48px]">
              <p className="mt-[24px] text-center text-[26px] leading-[32px] text-tb-ink-purple">
                {t("loyalty.otpPrompt")}
              </p>
              <div
                data-testid="loyalty-otp-display"
                className="mt-[40px] flex items-center justify-center gap-[24px]"
                dir="ltr"
              >
                {otpCells}
              </div>
              <div className="mt-[56px] flex justify-center" dir="ltr">
                <KioskNumpad
                  value={otp}
                  onChange={setOtp}
                  maxLength={OTP_LENGTH}
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-[24px] p-[24px] drop-shadow-[0px_0px_64px_rgba(0,0,0,0.08)]">
              <button
                type="button"
                data-testid="loyalty-otp-back"
                disabled={locked}
                onClick={() => {
                  cancelTimer();
                  setIsOtpNeeded(false);
                  setOtp("");
                }}
                className={`tb-display min-h-[84px] w-[320px] rounded-[8px] border-2 border-tb-purple py-[28px] text-center text-[24px] leading-[20px] text-tb-purple ${
                  locked ? "opacity-40" : ""
                }`}
              >
                {t("loyalty.back")}
              </button>
              <button
                type="button"
                data-testid="loyalty-otp-submit"
                aria-busy={locked}
                disabled={locked}
                onClick={handleOtpSubmit}
                className={`tb-display min-h-[84px] flex-1 rounded-[8px] bg-tb-purple py-[28px] text-center text-[24px] leading-[20px] text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)] ${
                  locked ? "opacity-40" : ""
                }`}
              >
                {t("loyalty.confirm")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rewards.length === 0 ? (
                <div className="flex flex-col items-center gap-[12px] px-[48px] py-[120px] text-center">
                  <p className="text-[28px] font-bold text-black">
                    {t("loyalty.noCoupons")}
                  </p>
                </div>
              ) : (
                <div
                  role="radiogroup"
                  aria-label={t("loyalty.title")}
                  className="border-t border-tb-grey-4 px-[24px]"
                >
                  {rewards.map(renderRewardRow)}
                </div>
              )}
            </div>
            <div className="shrink-0 p-[24px] drop-shadow-[0px_0px_64px_rgba(0,0,0,0.08)]">
              <button
                type="button"
                data-testid="loyalty-redeem"
                aria-busy={locked}
                disabled={locked || rewards.length === 0}
                onClick={handleRedeem}
                className={`tb-display min-h-[84px] w-full rounded-[8px] bg-tb-purple py-[32px] text-center text-[24px] leading-[20px] text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)] ${
                  locked || rewards.length === 0 ? "opacity-40" : ""
                }`}
              >
                {t("loyalty.redeem")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* TRY AGAIN returns to whichever step failed — the sheet keeps its
          selection and its OTP step (see LoyaltyErrorModal's ownership note). */}
      <LoyaltyErrorModal
        open={error !== null}
        message={error ?? ""}
        onRetry={() => setError(null)}
      />
    </div>
  );
}

/**
 * Loyalty REWARDS sheet — the Xeno redemption surface (fork
 * LoyaltyItemsModal.tsx:195-227 + :370-471), wearing the P7b RewardsSheet
 * skin (Figma rewards-default 1:3824 / rewards-active 1:3924): white
 * rounded-top sheet over the purple-tinted menu, bell + REWARDS header,
 * points balance, flat reward rows with a radio, full-width purple CTA.
 *
 * NOT the offers sheet: it never touches `cartOffer`. A Xeno reward lands in
 * the cart as an ordinary (discounted) cart row, so offers and a reward
 * coexist.
 *
 * Open state comes from `selectLoyaltyItemsModal` — the phone lookup opens it
 * with `isTimerOn: true` (auto-dismiss), the menu/bag entry with `false`.
 */
export default function LoyaltyRewardsSheet({
  onClose,
}: LoyaltyRewardsSheetProps) {
  const dispatch = useDispatch();
  const itemsModal = useSelector(selectLoyaltyItemsModal) as
    | { isOpen?: boolean; isTimerOn?: boolean }
    | undefined;

  const close = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    dispatch(closeLoyaltyItemsModal());
  }, [onClose, dispatch]);

  if (!itemsModal?.isOpen) return null;

  return (
    <SheetBody onClose={close} isTimerOn={Boolean(itemsModal?.isTimerOn)} />
  );
}
