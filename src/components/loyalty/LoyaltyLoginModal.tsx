/* eslint-disable @typescript-eslint/no-explicit-any --
 * The loyalty proxy envelope and the country-code record arrive untyped from
 * the SDK slices (same domain as useLoyalty.ts, which carries the identical
 * header). Typed in a later loyalty domain pass. Do not add NEW anys.
 */
import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import {
  selectCustomerPhone,
  setCustomerName,
  setPhoneNumberRdx,
} from "@cx-sdk/core/customer/customerInfo.slice";
import {
  openLoyaltyItemsModal,
  setLoyaltyCouponAvailable,
} from "@cx-sdk/ordering/state/loyalty.slice";
import useLoyalty from "../../hooks/loyalty/useLoyalty";
import KioskNumpad from "../keyboard/KioskNumpad";
import LoyaltyErrorModal from "./LoyaltyErrorModal";
import tbBell from "../../assets/brand/tb-bell.svg";
import closeIcon from "../../assets/icons/close.svg";

export interface LoyaltyLoginModalProps {
  open: boolean;
  /** X / backdrop / after a successful lookup. */
  onClose: () => void;
}

/** Fork parity: the newest digit stays legible for 2s, then masks. */
const REVEAL_LAST_DIGIT_MS = 2000;
/** Figma's display holds four dots; a longer number simply adds cells. */
const MIN_DISPLAY_CELLS = 4;
/** Backstop when the selected country carries no `max` (E.164). */
const FALLBACK_MAX_DIGITS = 15;
/** BagSheet's inert-CTA idiom: the pressed "coming soon" state, then back. */
const COMING_SOON_MS = 1400;

interface LoginBodyProps {
  onClose: () => void;
}

/** Body mounted only while open, so the entry re-seeds blank on every open. */
function LoginBody({ onClose }: LoginBodyProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  const countryCode = useSelector(selectCountryCode) as any;
  const storedPhone = useSelector(selectCustomerPhone) as string | undefined;

  const { executeLoyalty, isLoyaltyEventLoading } = useLoyalty();

  const [digits, setDigits] = useState("");
  const [showLastDigit, setShowLastDigit] = useState(false);
  const [scanPressed, setScanPressed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const comingSoonTimer = useRef<number | null>(null);

  const maxDigits = Number(countryCode?.max ?? 0) || FALLBACK_MAX_DIGITS;

  /**
   * Privacy mask (fork CustomerPhone): the newest digit is revealed at the
   * keypress and re-masked 2s later. The reveal is set in the change handler,
   * never synchronously inside the effect — the effect only owns the timer.
   */
  const handleDigitsChange = (next: string) => {
    setDigits(next);
    setShowLastDigit(next.length > 0);
  };

  useEffect(() => {
    if (!showLastDigit) return;
    const timer = window.setTimeout(
      () => setShowLastDigit(false),
      REVEAL_LAST_DIGIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [showLastDigit, digits]);

  // Rule 5 — the coming-soon timer never outlives the modal.
  useEffect(
    () => () => {
      if (comingSoonTimer.current !== null) {
        window.clearTimeout(comingSoonTimer.current);
      }
    },
    [],
  );

  const handleScanTap = () => {
    // LOCKED decision 3: SCAN APP renders but is inert — there is no scanner
    // integration on this hardware. Same pressed "coming soon" affordance the
    // bag's inert rewards CTA uses. FLAGGED for client sign-off.
    setScanPressed(true);
    if (comingSoonTimer.current !== null) {
      window.clearTimeout(comingSoonTimer.current);
    }
    comingSoonTimer.current = window.setTimeout(
      () => setScanPressed(false),
      COMING_SOON_MS,
    );
  };

  /**
   * Submit — the SAME path `/phone` runs (contract step 3/4), minus the
   * navigation (the customer is already on /menu):
   *   country min/max validation (skipped when the country carries neither)
   *   → clear the stored name if the number changed → setPhoneNumberRdx
   *   → executeLoyalty (check_loyalty_balance — a pure lookup, no OTP)
   *   → coupons && points ? openLoyaltyItemsModal({isTimerOn:true}) +
   *     setLoyaltyCouponAvailable(true) : setLoyaltyCouponAvailable(false).
   *
   * DIVERGENCE (deliberate, brief decision 8 in spirit): the fork leaves the
   * screen on every branch. Here a failed lookup keeps the modal open behind
   * the error dialog so TRY AGAIN can re-enter the number — a failed lookup
   * must never block ordering, and closing silently would look like a crash.
   */
  const handleSubmit = async () => {
    if (busy || isLoyaltyEventLoading) return;

    const min = Number(countryCode?.min ?? 0);
    const max = Number(countryCode?.max ?? 0);
    const hasBounds = min > 0 && max > 0;
    if (
      digits.length === 0 ||
      (hasBounds && (digits.length < min || digits.length > max))
    ) {
      setError(t("loyalty.invalidPhone"));
      return;
    }

    setBusy(true);
    try {
      if (storedPhone !== digits) {
        // A different customer — the cached name must not follow them.
        dispatch(setCustomerName(""));
      }
      // Must land BEFORE the lookup: validate_coupon / authenticate_redemption
      // / redeem_coupon all read the phone number back out of redux.
      dispatch(setPhoneNumberRdx(digits));

      const resp: any = await executeLoyalty({
        countryCode: countryCode?.dialCode,
        phoneNumber: digits,
      });

      if (resp?.status_code === 200) {
        const res = resp?.response;
        if (res?.coupons?.length > 0 && res?.loyalty_points > 0) {
          dispatch(openLoyaltyItemsModal({ isTimerOn: true }));
          dispatch(setLoyaltyCouponAvailable(true));
          onClose();
          return;
        }
        dispatch(setLoyaltyCouponAvailable(false));
        setError(t("loyalty.noCoupons"));
        return;
      }

      dispatch(setLoyaltyCouponAvailable(false));
      setError(t("loyalty.lookupFailed"));
    } catch {
      // Rule 2 — never a frozen modal: the customer retries or closes out.
      dispatch(setLoyaltyCouponAvailable(false));
      setError(t("loyalty.lookupFailed"));
    } finally {
      setBusy(false);
    }
  };

  const cellCount = Math.max(MIN_DISPLAY_CELLS, digits.length);
  const cells = Array.from({ length: cellCount }, (_, index) => {
    if (index >= digits.length) {
      return (
        <span
          key={index}
          className="h-[16px] w-[16px] shrink-0 rounded-full bg-tb-grey-4"
        />
      );
    }
    const isNewest = index === digits.length - 1;
    if (isNewest && showLastDigit) {
      return (
        <span
          key={index}
          className="shrink-0 text-[28px] font-bold leading-none text-tb-ink-purple"
        >
          {digits[index]}
        </span>
      );
    }
    return (
      <span
        key={index}
        className="h-[16px] w-[16px] shrink-0 rounded-full bg-tb-ink-purple/60"
      />
    );
  });

  const locked = busy || isLoyaltyEventLoading;
  const segmentBase =
    "flex min-h-[52px] flex-1 items-center justify-center rounded-full px-[16px] text-[20px] font-bold uppercase tracking-[0.5px]";

  return (
    <div
      className="absolute inset-0 z-[60]"
      data-testid="loyalty-login"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loyalty-login-title"
    >
      <button
        type="button"
        aria-label={t("loyalty.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70"
      />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 w-[684px] rounded-[12px] bg-tb-surface px-[48px] pb-[48px] pt-[56px]">
        <button
          type="button"
          data-testid="loyalty-login-close"
          aria-label={t("loyalty.close")}
          onClick={onClose}
          className="absolute right-[32px] top-[32px] h-[48px] min-h-[44px] w-[48px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div className="flex items-center justify-center gap-[16px]">
          <span
            aria-hidden="true"
            className="h-[36px] w-[40px] bg-tb-purple"
            style={{
              WebkitMaskImage: `url("${tbBell}")`,
              maskImage: `url("${tbBell}")`,
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskSize: "contain",
              maskSize: "contain",
              WebkitMaskPosition: "center",
              maskPosition: "center",
            }}
          />
          <p
            id="loyalty-login-title"
            className="tb-display text-center text-[40px] leading-[40px] tracking-[-1px] text-tb-purple"
          >
            {t("loyalty.title")}
          </p>
        </div>

        {/* Segmented control — SCAN APP is present but inert (decision 3);
            ENTER CODE is the live segment and, for P7c, means the mobile
            number (the CX identity), so it carries the phone copy. */}
        <div
          role="group"
          aria-label={t("loyalty.title")}
          className="mx-auto mt-[32px] flex w-[422px] items-center gap-[4px] rounded-full bg-tb-grey-4 p-[5px]"
        >
          <button
            type="button"
            data-testid="loyalty-tab-scan"
            aria-disabled="true"
            aria-pressed={false}
            onClick={handleScanTap}
            className={`${segmentBase} text-tb-ink-purple/60 ${
              scanPressed ? "bg-tb-surface/60 opacity-60" : ""
            }`}
          >
            {scanPressed ? t("loyalty.comingSoon") : t("loyalty.scanApp")}
          </button>
          <button
            type="button"
            data-testid="loyalty-tab-code"
            aria-pressed={true}
            className={`${segmentBase} bg-tb-surface text-tb-purple shadow-[0px_2px_8px_0px_rgba(0,0,0,0.12)]`}
          >
            {t("loyalty.enterCode")}
          </button>
        </div>

        <p className="mt-[28px] text-center text-[22px] leading-[26px] text-tb-ink-purple/80">
          {t("loyalty.phonePrompt")}
        </p>

        {/* Masked entry display — Figma's dot row, extended to a phone-length
            entry: one cell per digit (minimum four), newest digit legible for
            two seconds, dial code shown read-only (the country picker stays
            on the /phone screen). */}
        <div
          data-testid="loyalty-phone-display"
          role="textbox"
          aria-readonly="true"
          aria-label={t("loyalty.phonePrompt")}
          dir="ltr"
          className="mx-auto mt-[20px] flex h-[88px] w-[392px] items-center gap-[16px] overflow-hidden rounded-[12px] border-2 border-tb-pink px-[20px]"
        >
          {countryCode?.dialCode && (
            <span className="shrink-0 text-[24px] font-medium leading-none text-tb-ink-purple/60">
              {countryCode.dialCode}
            </span>
          )}
          <span className="flex flex-1 items-center justify-center gap-[12px]">
            {cells}
          </span>
        </div>

        <div className="mt-[28px] flex justify-center" dir="ltr">
          {/* No onSubmit: Figma 1:4174's bottom row is CLEAR / 0 / backspace,
              and a variable-length phone number cannot auto-submit. The
              CONTINUE bar below is the submit. */}
          <KioskNumpad
            value={digits}
            onChange={handleDigitsChange}
            maxLength={maxDigits}
          />
        </div>

        <button
          type="button"
          data-testid="loyalty-login-submit"
          aria-busy={locked}
          disabled={locked}
          onClick={handleSubmit}
          className={`tb-display mt-[32px] min-h-[84px] w-full rounded-[8px] bg-tb-purple py-[28px] text-center text-[24px] leading-[20px] text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)] ${
            locked ? "opacity-40" : ""
          }`}
        >
          {t("loyalty.continue")}
        </button>
      </div>

      <LoyaltyErrorModal
        open={error !== null}
        message={error ?? ""}
        onRetry={() => setError(null)}
      />
    </div>
  );
}

/**
 * Loyalty login modal — Figma loyalty-code-default (1:4174): white card over
 * the purple-tinted menu, bell + REWARDS display header, a two-segment
 * SCAN APP | ENTER CODE pill, the masked entry display and the vibrant-purple
 * numpad.
 *
 * Mechanic (USER DIRECTIVE — Xeno verbatim): the live segment is a PHONE
 * lookup, not a code. Submitting runs the same `executeLoyalty`
 * (check_loyalty_balance) path `/phone` runs and, when the customer has
 * coupons and points, dispatches `openLoyaltyItemsModal({ isTimerOn: true })`
 * — which is what opens `LoyaltyRewardsSheet` (it reads that slice state
 * itself, so no prop plumbing between the two).
 *
 * Body mounted only while open so the entry never re-opens pre-filled.
 * z-60: above BagSheet (z-40) and the rewards sheet (z-50).
 */
export default function LoyaltyLoginModal({
  open,
  onClose,
}: LoyaltyLoginModalProps) {
  if (!open) return null;
  return <LoginBody onClose={onClose} />;
}
